import {writeWearClaims} from './wear-capacity';
import {planAllocation,writeAllocationClaims} from './allocation';
import {createHash,randomUUID} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {loadStaff,type StaffPrincipal} from '../../../auth/src/staff-auth';
import {HoldError,parseConditions,normalizePeriod,canonical,HOLD_TTL_SECONDS,paymentDecision,type HoldConditions,type Feasibility,type PaymentBoundary} from '../../../contracts/src/hold';
import {heldIntake} from './intake-context';
import type {CandidateContext} from '../../../contracts/src/hold-intake';
import {expireInventoryHolds} from './expiry';
type Conn=Pick<PoolClient,'query'>;
type HoldRow={id:string;reservation_id:string;owner_id:string;pickup_store:string;return_store:string;conditions:HoldConditions;expires_at:Date;due_at:Date;state:'ACTIVE'|'EXPIRED'|'RELEASED';payment_state:PaymentBoundary;allocation_stage:string;version:number;transfer_attention:string|null};
type Outcome={result:Feasibility|'CREATED'|'AMENDED'|'RELEASED'|'EXPIRED'|'UNCHANGED';holdId?:string};
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
function id(value:string){if(!UUID.test(value))throw new HoldError('INVALID_ID');}
function effective(h:HoldRow,now:Date){return h.state==='ACTIVE'&&h.allocation_stage==='PROVISIONAL'&&h.expires_at<=now&&['NONE','FAILURE'].includes(h.payment_state)?'EXPIRED':h.state;}
export class HoldService {
 // Clock is a dependency for controlled tests only. Normal runtime always obtains database time.
 constructor(private pool:Pool,private principal:StaffPrincipal,private clock?:()=>Date){}
 private async now(c:Conn){return this.clock?this.clock():(await c.query<{now:Date}>('SELECT inventory_clock() AS now')).rows[0]!.now;}
 private async authorize(c:Conn,edit:boolean,stores:string[]=[]){
  const p=await loadStaff(c as Pick<Pool,'query'>,this.principal.subject);
  if(!p||p.revision!==this.principal.revision||!p.permissions.includes('HOLD_VIEW')||edit&&!p.permissions.includes('HOLD_EDIT')||stores.some(s=>!p.storeIds.includes(s as never)))throw new HoldError('FORBIDDEN',403);
  return p;
 }
 private async owned(c:Conn,holdId:string,edit:boolean){
  id(holdId);await this.authorize(c,edit);
  const h=(await c.query<HoldRow>('SELECT * FROM inventory_holds WHERE id=$1 AND owner_id=$2',[holdId,this.principal.subject])).rows[0];
  if(!h)throw new HoldError('FORBIDDEN',403);await this.authorize(c,edit,[h.pickup_store,h.return_store]);return h;
 }
 private normalizeError(e:unknown):never{
  if(e instanceof HoldError)throw e;
  const code=(e as {code?:string}|null)?.code;
  // pg-pool acquisition timeouts have no SQLSTATE. Match the timeout category, not version-specific prose.
  // Coded auth/permission failures and unrelated errors must retain their separate fail-closed result.
  const uncodedTimeout=e instanceof Error&&code===undefined&&/\b(?:timeout|timed out)\b/i.test(e.message);
  if(['55P03','57014','40P01','40001'].includes(code??'')||uncodedTimeout)throw new HoldError('INDETERMINATE',503);
  if(['23505','23514','23503'].includes(code??''))throw new HoldError('CONFLICT',409);
  throw new HoldError('HOLD_OPERATION_FAILED',500);
 }
 private async read<T>(fn:(c:PoolClient,now:Date)=>Promise<T>):Promise<T>{
  let c:PoolClient|undefined;
  try{c=await this.pool.connect();await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
   await c.query("SET LOCAL statement_timeout='5000ms'; SET LOCAL idle_in_transaction_session_timeout='10000ms'");
   await this.authorize(c,false);const result=await fn(c,await this.now(c));await c.query('COMMIT');return result;
  }catch(e){await c?.query('ROLLBACK').catch(()=>{});return this.normalizeError(e);}finally{c?.release();}
 }
 private async transaction<T>(edit:boolean,preflight:(c:Conn)=>Promise<void>,fn:(c:PoolClient,now:Date)=>Promise<T>):Promise<T>{
  let c:PoolClient|undefined;
  try{
   await this.authorize(this.pool,edit);await preflight(this.pool); // No allocation/row lock for forbidden requests.
   c=await this.pool.connect();await c.query('BEGIN');await c.query("SET LOCAL lock_timeout='1500ms'; SET LOCAL statement_timeout='5000ms'; SET LOCAL idle_in_transaction_session_timeout='10000ms'");
   await this.authorize(c,edit);await preflight(c);
   await c.query('SELECT pg_advisory_xact_lock(71820600)');
   await this.authorize(c,edit);await preflight(c);const now=await this.now(c);
   await c.query("SELECT set_config('zao.actor',$1,true)",[this.principal.subject]);
   const value=await fn(c,now);await c.query('COMMIT');return value;
  }catch(e){await c?.query('ROLLBACK').catch(()=>{});return this.normalizeError(e);}finally{c?.release();}
 }
 private summary(h:HoldRow,now:Date,history:Record<string,unknown>[]){
  return {id:h.id,reservationId:h.reservation_id,conditions:h.conditions,state:effective(h,now),paymentState:h.payment_state,expiresAt:h.expires_at.toISOString(),version:h.version,allocationStage:h.allocation_stage,transferAttention:h.transfer_attention,period:normalizePeriod(h.conditions.period),history,meaning:'TEMPORARY_HOLD_NOT_BOOKING_PAYMENT_OR_HANDOFF'};
 }
 private async attention(c:Conn,ids:string[],now:Date){return (await c.query<{hold_id:string}>(`SELECT DISTINCT cl.hold_id FROM inventory_claims cl JOIN transfer_pieces p ON p.id=cl.transfer_piece_id JOIN transfer_batches b ON b.id=p.batch_id WHERE cl.active AND cl.hold_id=ANY($1::uuid[]) AND (b.issue IS NOT NULL OR (b.planned_ready_at<$2 AND p.state NOT IN ('READY','CLOSED')))`,[ids,now])).rows.map(x=>x.hold_id);}
 private async view(c:Conn,h:HoldRow,now:Date){
  if((await this.attention(c,[h.id],now)).length)h={...h,transfer_attention:'TRANSFER_RECONCILIATION_REQUIRED'};
  const history=(await c.query('SELECT event,actor,occurred_at FROM inventory_history WHERE hold_id=$1 ORDER BY id',[h.id])).rows;
  return this.summary(h,now,history);
 }
 async get(holdId:string){return this.read(async(c,now)=>this.view(c,await this.owned(c,holdId,false),now));}
 async list(){return this.read(async(c,now)=>{
  const p=await this.authorize(c,false);
  const rows=(await c.query<HoldRow>('SELECT * FROM inventory_holds WHERE owner_id=$1 AND pickup_store=ANY($2::text[]) AND return_store=ANY($2::text[]) ORDER BY created_at DESC,id LIMIT 100',[p.subject,p.storeIds])).rows;
  const histories=(await c.query('SELECT hold_id,event,actor,occurred_at FROM inventory_history WHERE hold_id=ANY($1::uuid[]) ORDER BY hold_id,id',[rows.map(h=>h.id)])).rows;
  const grouped=new Map<string,Record<string,unknown>[]>();for(const {hold_id,...event} of histories){const items=grouped.get(hold_id)??[];items.push(event);grouped.set(hold_id,items);}
  const attention=await this.attention(c,rows.map(h=>h.id),now);return rows.map(h=>this.summary(attention.includes(h.id)?{...h,transfer_attention:'TRANSFER_RECONCILIATION_REQUIRED'}:h,now,grouped.get(h.id)??[]));
 });}
 // Narrow catalog read through the existing authorized inventory reader. Recommendation
 // has no model-table grants; never broaden its DB role to obtain display metadata.
 async recommendationCatalog(){return this.read(async c=>{const rows=(await c.query<import('../../../contracts/src/recommendation').Variant>('SELECT v.id,v.family,v.age,v.tier,v.size,v.model_id,v.compatible_sports,m.catalog_season,m.name AS model_name FROM ledger_variants v JOIN ledger_models m ON m.id=v.model_id ORDER BY v.id LIMIT 2001')).rows;if(rows.length>2000)throw new HoldError('INDETERMINATE_CATALOG_LIMIT',503);return rows;});}
 async options(){return this.read(async c=>(await c.query("SELECT v.id,v.family,v.age,v.tier,v.size,m.name FROM ledger_variants v JOIN ledger_models m ON m.id=v.model_id ORDER BY v.family,v.size,v.id LIMIT 500")).rows);}
 async availability(input:unknown,replaceHoldId?:string,context?:CandidateContext){const conditions=parseConditions(input);return this.transaction(false,async c=>{
  await this.authorize(c,false,[conditions.pickupStore,conditions.returnStore]);if(replaceHoldId){const old=await this.owned(c,replaceHoldId,false);if(old.reservation_id!==conditions.reservationId)throw new HoldError('IMMUTABLE_RESERVATION');if(old.allocation_stage!=='PROVISIONAL'||!['NONE','FAILURE'].includes(old.payment_state))throw new HoldError('ALLOCATION_FIXED',409);}
 },async(c,now)=>{const h=replaceHoldId?await this.owned(c,replaceHoldId,false):null;await heldIntake(c,conditions,now,h,context);return {result:(await planAllocation(c,conditions,now,replaceHoldId??null)).result,period:normalizePeriod(conditions.period),advisory:true};});}
 async command(op:'create'|'amend'|'cancel'|'expire'|'reassign',key:string,input?:unknown,holdId?:string,expectedVersion?:number){
  if(expectedVersion!==undefined&&(!Number.isInteger(expectedVersion)||expectedVersion<1))throw new HoldError('INVALID_VERSION');
  id(key);if(op!=='create'&&!holdId)throw new HoldError('INVALID_ID');
  let conditions=op==='create'||op==='amend'?parseConditions(input):null;
  let pin:{requirementKey:string;assetId:string}|undefined;
  if(op==='reassign'){if(!input||typeof input!=='object'||Object.keys(input).sort().join(',')!=='assetId,requirementKey')throw new HoldError('INVALID_INPUT');pin=input as typeof pin;if(!pin||typeof pin.requirementKey!=='string'||typeof pin.assetId!=='string')throw new HoldError('INVALID_INPUT');id(pin.assetId);}
  const fingerprint=createHash('sha256').update(canonical({op,holdId:holdId??null,conditions,pin:pin??null,...(expectedVersion===undefined?{}:{expectedVersion})})).digest('hex');
  const preflight=async(c:Conn)=>{if(conditions)await this.authorize(c,true,[conditions.pickupStore,conditions.returnStore]);if(holdId){const old=await this.owned(c,holdId,true);if(pin){conditions=old.conditions;if(!conditions.members.some(m=>m.items.some(i=>i.family!=='POLE'&&!i.family.startsWith('WEAR_')&&m.key+':'+i.family===pin!.requirementKey)))throw new HoldError('INVALID_REQUIREMENT');}if(conditions&&conditions.reservationId!==old.reservation_id)throw new HoldError('IMMUTABLE_RESERVATION');}if(conditions){const r=(await c.query('SELECT owner_id FROM inventory_reservations WHERE id=$1',[conditions.reservationId])).rows[0];if(r&&r.owner_id!==this.principal.subject)throw new HoldError('FORBIDDEN',403);}};
  return this.transaction(true,preflight,async(c,now)=>{
   const previous=(await c.query<{fingerprint:string;result:Outcome}>('SELECT fingerprint,result FROM inventory_requests WHERE owner_id=$1 AND request_key=$2',[this.principal.subject,key])).rows[0];
   if(previous&&previous.fingerprint!==fingerprint)throw new HoldError('IDEMPOTENCY_MISMATCH',409);
   if(previous)return {...previous.result,hold:previous.result.holdId?await this.view(c,await this.owned(c,previous.result.holdId,false),now):null,replayed:true};
   if(expectedVersion!==undefined&&holdId&&(await this.owned(c,holdId,true)).version!==expectedVersion)throw new HoldError('STALE_HOLD_VERSION',409);
   await expireInventoryHolds(c,now);let outcome:Outcome;
   const old=holdId?await this.owned(c,holdId,true):null;
   if(old&&old.state!=='ACTIVE')outcome={result:old.state,holdId:old.id};
   else if(old&&old.allocation_stage!=='PROVISIONAL')throw new HoldError('ALLOCATION_FIXED',409);
   else if(old&&paymentDecision(old.payment_state,true,old.expires_at<=now,false)!=='MAY_CHANGE')throw new HoldError('PAYMENT_RECONCILIATION_REQUIRED',409);
   else if(op==='cancel'){
    await c.query("UPDATE inventory_holds SET state='RELEASED',version=version+1 WHERE id=$1",[holdId]);await c.query('UPDATE inventory_claims SET active=false WHERE hold_id=$1 AND active',[holdId]);outcome={result:'RELEASED',holdId:holdId!};
   }else if(op==='expire')outcome={result:'UNCHANGED',holdId:holdId!};
   else{
    if(!conditions)throw new HoldError('INVALID_CONDITIONS');
    if(op==='create'&&(await c.query("SELECT 1 FROM inventory_holds WHERE reservation_id=$1 AND state='ACTIVE'",[conditions.reservationId])).rowCount)throw new HoldError('RESERVATION_ALREADY_HELD',409);
    // Same-key reconciliation above is distinct from permission to start new work.
    const admit=async(at:Date)=>{const intake=await heldIntake(c,conditions!,at,old);if(op==='amend'&&intake.mode==='HOLD_CONTINUATION'&&expectedVersion===undefined)throw new HoldError('EXPECTED_VERSION_REQUIRED',409);};
    await admit(now);
    const plan=await planAllocation(c,conditions,now,old?.id??null,pin);
    if(plan.result!=='FEASIBLE')outcome={result:plan.result,...(old?{holdId:old.id}:{})};
    else {
     // Recheck at the write boundary too, after planning and any awaited SQL.
     await admit(await this.now(c));
     const period=normalizePeriod(conditions.period);const target=old?.id??randomUUID();
     if(old){
      await c.query('UPDATE inventory_holds SET conditions=$2,pickup_store=$3,return_store=$4,starts_at=$5,due_at=$6,occupancy_start=$7,occupancy_end=$8,version=version+1 WHERE id=$1',[old.id,conditions,conditions.pickupStore,conditions.returnStore,period.startsAt,period.dueAt,conditions.period.startDate,conditions.period.endDate]);
     }else{
      await c.query('INSERT INTO inventory_reservations VALUES($1,$2) ON CONFLICT DO NOTHING',[conditions.reservationId,this.principal.subject]);
      await c.query(`INSERT INTO inventory_holds(id,reservation_id,owner_id,pickup_store,return_store,conditions,starts_at,due_at,occupancy_start,occupancy_end,expires_at,state) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'ACTIVE')`,[target,conditions.reservationId,this.principal.subject,conditions.pickupStore,conditions.returnStore,conditions,period.startsAt,period.dueAt,conditions.period.startDate,conditions.period.endDate,new Date(now.getTime()+HOLD_TTL_SECONDS*1000)]);
     }
     // Replan every affected provisional witness atomically, preserving each original promise/TTL.
     const replanIds=[...plan.replanned,...(old?[old.id]:[])];
     const before=(await c.query('SELECT hold_id,requirement_key,asset_id,pole_id,pole_slot,day FROM inventory_claims WHERE hold_id=ANY($1::uuid[]) AND active ORDER BY id',[replanIds])).rows;
     await c.query('UPDATE inventory_claims SET active=false WHERE hold_id=ANY($1::uuid[]) AND active',[replanIds]);
     for(const otherId of plan.replanned){const other=(await c.query<HoldRow>('SELECT * FROM inventory_holds WHERE id=$1',[otherId])).rows[0]!;await writeAllocationClaims(c,otherId,other.conditions,plan.witness.filter(w=>w.holdId===otherId));}
     await writeAllocationClaims(c,target,conditions,plan.witness.filter(w=>w.holdId==='candidate'));
     if([conditions,old?.conditions].some(value=>value?.members.some(m=>m.items.some(i=>i.family.startsWith('WEAR_')))))await writeWearClaims(c,target,conditions,now);
     const after=(await c.query('SELECT hold_id,requirement_key,asset_id,pole_id,pole_slot,day FROM inventory_claims WHERE hold_id=ANY($1::uuid[]) AND active ORDER BY id',[[...replanIds,target]])).rows;
     await c.query('SELECT inventory_record_replan($1::jsonb,$2::jsonb)',[JSON.stringify(before),JSON.stringify(after)]);
     outcome={result:old?'AMENDED':'CREATED',holdId:target};
    }
   }
   await c.query('INSERT INTO inventory_requests VALUES($1,$2,$3,$4)',[this.principal.subject,key,fingerprint,outcome]);
   return {...outcome,hold:outcome.holdId?await this.view(c,await this.owned(c,outcome.holdId,false),now):null,replayed:false};
  });
 }
}
