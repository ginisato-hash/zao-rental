import {createHash,randomUUID} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {loadStaff,type StaffPrincipal} from '../../../auth/src/staff-auth';
import {HoldError,parseConditions,normalizePeriod,canonical,HOLD_TTL_SECONDS,paymentDecision,type HoldConditions,type Feasibility,type PaymentBoundary} from '../../../contracts/src/hold';
import {matchPeriods,type Demand,type Placement} from './period-matching';
type Conn=Pick<PoolClient,'query'>;
type HoldRow={id:string;reservation_id:string;owner_id:string;pickup_store:string;return_store:string;conditions:HoldConditions;expires_at:Date;state:'ACTIVE'|'EXPIRED'|'RELEASED';payment_state:PaymentBoundary;allocation_stage:string;version:number};
type Unit={id:string;variant_id:string;family:string;age:string;tier:string;store_id:string;quantity:number;status:string};
type Claim={hold_id:string;requirement_key:string;asset_id:string|null;pole_id:string|null;pole_slot:number|null;day:string;start:string;end:string;pickup_store:string;return_store:string};
type Witness={holdId:string;key:string;asset:string|null;pole:string|null;slots:Record<string,number>};
type Outcome={result:Feasibility|'CREATED'|'AMENDED'|'RELEASED'|'EXPIRED'|'UNCHANGED';holdId?:string};
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
function id(value:string){if(!UUID.test(value))throw new HoldError('INVALID_ID');}
function effective(h:HoldRow,now:Date){return h.state==='ACTIVE'&&h.allocation_stage==='PROVISIONAL'&&h.expires_at<=now&&['NONE','FAILURE'].includes(h.payment_state)?'EXPIRED':h.state;}
export class HoldService {
 // Clock is a dependency for controlled tests only. Normal runtime always obtains database time.
 constructor(private pool:Pool,private principal:StaffPrincipal,private clock?:()=>Date){}
 private async now(c:Conn){return this.clock?this.clock():(await c.query<{now:Date}>('SELECT clock_timestamp() AS now')).rows[0]!.now;}
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
 private async expire(c:Conn,now:Date){
  const rows=(await c.query<{id:string}>("UPDATE inventory_holds SET state='EXPIRED',version=version+1 WHERE state='ACTIVE' AND allocation_stage='PROVISIONAL' AND expires_at<=$1 AND payment_state IN ('NONE','FAILURE') RETURNING id",[now])).rows;
  if(rows.length)await c.query('UPDATE inventory_claims SET active=false WHERE hold_id=ANY($1::uuid[]) AND active',[rows.map(r=>r.id)]);
 }
 private summary(h:HoldRow,now:Date,history:Record<string,unknown>[]){
  return {id:h.id,reservationId:h.reservation_id,conditions:h.conditions,state:effective(h,now),paymentState:h.payment_state,expiresAt:h.expires_at.toISOString(),version:h.version,allocationStage:h.allocation_stage,period:normalizePeriod(h.conditions.period),history,meaning:'TEMPORARY_HOLD_NOT_BOOKING_PAYMENT_OR_HANDOFF'};
 }
 private async view(c:Conn,h:HoldRow,now:Date){
  const history=(await c.query('SELECT event,actor,occurred_at FROM inventory_history WHERE hold_id=$1 ORDER BY id',[h.id])).rows;
  return this.summary(h,now,history);
 }
 async get(holdId:string){return this.read(async(c,now)=>this.view(c,await this.owned(c,holdId,false),now));}
 async list(){return this.read(async(c,now)=>{
  const p=await this.authorize(c,false);
  const rows=(await c.query<HoldRow>('SELECT * FROM inventory_holds WHERE owner_id=$1 AND pickup_store=ANY($2::text[]) AND return_store=ANY($2::text[]) ORDER BY created_at DESC,id LIMIT 100',[p.subject,p.storeIds])).rows;
  const histories=(await c.query('SELECT hold_id,event,actor,occurred_at FROM inventory_history WHERE hold_id=ANY($1::uuid[]) ORDER BY hold_id,id',[rows.map(h=>h.id)])).rows;
  const grouped=new Map<string,Record<string,unknown>[]>();for(const {hold_id,...event} of histories){const items=grouped.get(hold_id)??[];items.push(event);grouped.set(hold_id,items);}
  return rows.map(h=>this.summary(h,now,grouped.get(h.id)??[]));
 });}
 async options(){return this.read(async c=>(await c.query("SELECT v.id,v.family,v.age,v.tier,v.size,m.name FROM ledger_variants v JOIN ledger_models m ON m.id=v.model_id ORDER BY v.family,v.size,v.id LIMIT 500")).rows);}
 private async plan(c:Conn,conditions:HoldConditions,now:Date,ignore:string|null=null,pin?:{requirementKey:string;assetId:string}):Promise<{result:Feasibility;witness:Witness[];replanned:string[]}>{
  if(new Date(normalizePeriod(conditions.period).dueAt)<=now)throw new HoldError('PERIOD_ENDED');
  const live=(await c.query<HoldRow>(`SELECT * FROM inventory_holds WHERE state='ACTIVE' AND (expires_at>$1 OR payment_state IN ('PENDING','UNKNOWN','SUCCESS') OR allocation_stage<>'PROVISIONAL') AND ($2::uuid IS NULL OR id<>$2) ORDER BY id LIMIT 81`,[now,ignore])).rows;
  if(live.length>80)return {result:'INDETERMINATE',witness:[],replanned:[]};
  const mutable=live.filter(h=>h.allocation_stage==='PROVISIONAL'&&['NONE','FAILURE'].includes(h.payment_state));
  const fixedIds=live.filter(h=>!mutable.includes(h)).map(h=>h.id);
  const jobs=[...mutable.map(h=>({id:h.id,c:h.conditions})),{id:'candidate',c:conditions}];
  const requirements=jobs.flatMap(j=>j.c.members.flatMap(m=>m.items.map(item=>({...item,age:m.age,tier:m.tier,key:j.id+'/'+m.key+':'+item.family,memberKey:m.key+':'+item.family,job:j}))));
  if(requirements.length>240)return {result:'INDETERMINATE',witness:[],replanned:[]};
  const variantIds=[...new Set(requirements.flatMap(r=>r.variantIds))];
  const variants=(await c.query<{id:string;family:string;age:string;tier:string}>('SELECT id,family,age,tier FROM ledger_variants WHERE id=ANY($1::uuid[])',[variantIds])).rows;
  for(const r of requirements)for(const variantId of r.variantIds){const v=variants.find(v=>v.id===variantId);if(!v||v.family!==r.family||v.age!==r.age||v.tier!==r.tier)throw new HoldError('VARIANT_MISMATCH');}
  const units=(await c.query<Unit>(`SELECT a.id,a.variant_id,a.family,v.age,v.tier,a.store_id,1 AS quantity,a.status FROM ledger_assets a JOIN ledger_variants v ON v.id=a.variant_id WHERE a.variant_id=ANY($1::uuid[]) UNION ALL SELECT p.id,p.variant_id,p.family,v.age,v.tier,p.store_id,p.quantity,p.status FROM ledger_poles p JOIN ledger_variants v ON v.id=p.variant_id WHERE p.variant_id=ANY($1::uuid[]) ORDER BY id LIMIT 3001`,[variantIds])).rows;
  if(units.length>3000)return {result:'INDETERMINATE',witness:[],replanned:[]};
  const fixedClaims=(await c.query<Claim>(`SELECT c.hold_id,c.requirement_key,c.asset_id,c.pole_id,c.pole_slot,c.day::text,h.occupancy_start::text AS start,h.occupancy_end::text AS end,h.pickup_store,h.return_store FROM inventory_claims c JOIN inventory_holds h ON h.id=c.hold_id WHERE c.active AND h.id=ANY($1::uuid[]) LIMIT 100001`,[fixedIds])).rows;
  const constraints=(await c.query<{asset_id:string|null;pole_id:string|null;kind:string;start:string;end:string}>(`SELECT asset_id,pole_id,kind,starts_on::text AS start,ends_on::text AS end FROM inventory_constraints LIMIT 10001`)).rows;
  if(fixedClaims.length>100000||constraints.length>10000)return {result:'INDETERMINATE',witness:[],replanned:[]};
  const fixed:Placement[]=[...new Map(fixedClaims.map(x=>[x.hold_id+'/'+x.requirement_key,{key:x.hold_id+'/'+x.requirement_key,unit:(x.asset_id??x.pole_id)!,start:x.start,end:x.pickup_store===x.return_store?x.end:'9999-12-31'}])).values()];
  // A second, diagnostic-only match relaxes custody/transfer constraints. It never creates claims.
  // Only report a transfer prerequisite if those constraints actually explain infeasibility.
  const demandsFor=(diagnostic:boolean):Demand[]=>requirements.map(r=>{
   const start=r.job.c.period.startDate,end=diagnostic||r.job.c.pickupStore===r.job.c.returnStore?r.job.c.period.endDate:'9999-12-31';
   const candidates=units.filter(u=>{
    if(pin&&r.job.id==='candidate'&&r.memberKey===pin.requirementKey&&u.id!==pin.assetId)return false;
    if(!r.variantIds.includes(u.variant_id)||u.status!=='AVAILABLE'||u.quantity<1)return false;
    if(!diagnostic&&u.store_id!==r.job.c.pickupStore)return false;
    return !constraints.some(x=>(x.asset_id===u.id||x.pole_id===u.id)&&x.start<=r.job.c.period.endDate&&x.end>=start&&(!diagnostic||x.kind!=='TRANSFER_UNVERIFIED'));
   }).map(u=>u.id);
   return {key:r.key,start,end,candidates};
  });
  try{
   const capacities=new Map(units.map(u=>[u.id,u.quantity]));
   const matching=matchPeriods(demandsFor(false),capacities,fixed);
   if(!matching){
    const diagnosticFixed=fixed.map(p=>({...p,end:fixedClaims.find(c=>c.hold_id+'/'+c.requirement_key===p.key)!.end}));
    const diagnostic=matchPeriods(demandsFor(true),capacities,diagnosticFixed);
    return {result:diagnostic?'TRANSFER_PLAN_REQUIRED':'INSUFFICIENT',witness:[],replanned:[]};
   }
   const used=new Map<string,Set<number>>();for(const x of fixedClaims)if(x.pole_id){const k=x.pole_id+'/'+x.day;const slots=used.get(k)??new Set();slots.add(x.pole_slot!);used.set(k,slots);}
   const witness:Witness[]=matching.map(p=>{
    const r=requirements.find(r=>r.key===p.key)!,u=units.find(u=>u.id===p.unit)!,slots:Record<string,number>={};
    if(u.family==='POLE')for(const day of normalizePeriod(r.job.c.period).dates){const k=u.id+'/'+day,occupied=used.get(k)??new Set();let slot=1;while(occupied.has(slot))slot++;if(slot>u.quantity)throw new HoldError('INDETERMINATE',503);occupied.add(slot);used.set(k,occupied);slots[day]=slot;}
    return {holdId:r.job.id,key:r.memberKey,asset:u.family==='POLE'?null:u.id,pole:u.family==='POLE'?u.id:null,slots};
   });
   return {result:'FEASIBLE',witness,replanned:mutable.map(h=>h.id)};
  }catch(e){if(e instanceof HoldError&&e.code==='INDETERMINATE')return {result:'INDETERMINATE',witness:[],replanned:[]};throw e;}
 }
 async availability(input:unknown,replaceHoldId?:string){const conditions=parseConditions(input);return this.transaction(false,async c=>{
  await this.authorize(c,false,[conditions.pickupStore,conditions.returnStore]);if(replaceHoldId){const old=await this.owned(c,replaceHoldId,false);if(old.reservation_id!==conditions.reservationId)throw new HoldError('IMMUTABLE_RESERVATION');if(old.allocation_stage!=='PROVISIONAL'||!['NONE','FAILURE'].includes(old.payment_state))throw new HoldError('ALLOCATION_FIXED',409);}
 },async(c,now)=>({result:(await this.plan(c,conditions,now,replaceHoldId??null)).result,period:normalizePeriod(conditions.period),advisory:true}));}
 private async claims(c:Conn,holdId:string,conditions:HoldConditions,witness:Witness[]){
  const rows=witness.flatMap(w=>normalizePeriod(conditions.period).dates.map(day=>({hold_id:holdId,requirement_key:w.key,asset_id:w.asset,pole_id:w.pole,pole_slot:w.slots[day]??null,day})));
  await c.query(`INSERT INTO inventory_claims(hold_id,requirement_key,asset_id,pole_id,pole_slot,day) SELECT hold_id,requirement_key,asset_id,pole_id,pole_slot,day FROM jsonb_to_recordset($1::jsonb) AS x(hold_id uuid,requirement_key text,asset_id uuid,pole_id uuid,pole_slot integer,day date)`,[JSON.stringify(rows)]);
 }
 async command(op:'create'|'amend'|'cancel'|'expire'|'reassign',key:string,input?:unknown,holdId?:string){
  id(key);if(op!=='create'&&!holdId)throw new HoldError('INVALID_ID');
  let conditions=op==='create'||op==='amend'?parseConditions(input):null;
  let pin:{requirementKey:string;assetId:string}|undefined;
  if(op==='reassign'){if(!input||typeof input!=='object'||Object.keys(input).sort().join(',')!=='assetId,requirementKey')throw new HoldError('INVALID_INPUT');pin=input as typeof pin;if(!pin||typeof pin.requirementKey!=='string'||typeof pin.assetId!=='string')throw new HoldError('INVALID_INPUT');id(pin.assetId);}
  const fingerprint=createHash('sha256').update(canonical({op,holdId:holdId??null,conditions,pin:pin??null})).digest('hex');
  const preflight=async(c:Conn)=>{if(conditions)await this.authorize(c,true,[conditions.pickupStore,conditions.returnStore]);if(holdId){const old=await this.owned(c,holdId,true);if(pin){conditions=old.conditions;if(!conditions.members.some(m=>m.items.some(i=>i.family!=='POLE'&&m.key+':'+i.family===pin!.requirementKey)))throw new HoldError('INVALID_REQUIREMENT');}if(conditions&&conditions.reservationId!==old.reservation_id)throw new HoldError('IMMUTABLE_RESERVATION');}if(conditions){const r=(await c.query('SELECT owner_id FROM inventory_reservations WHERE id=$1',[conditions.reservationId])).rows[0];if(r&&r.owner_id!==this.principal.subject)throw new HoldError('FORBIDDEN',403);}};
  return this.transaction(true,preflight,async(c,now)=>{
   const previous=(await c.query<{fingerprint:string;result:Outcome}>('SELECT fingerprint,result FROM inventory_requests WHERE owner_id=$1 AND request_key=$2',[this.principal.subject,key])).rows[0];
   if(previous&&previous.fingerprint!==fingerprint)throw new HoldError('IDEMPOTENCY_MISMATCH',409);
   if(previous)return {...previous.result,hold:previous.result.holdId?await this.view(c,await this.owned(c,previous.result.holdId,false),now):null,replayed:true};
   await this.expire(c,now);let outcome:Outcome;
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
    const plan=await this.plan(c,conditions,now,old?.id??null,pin);
    if(plan.result!=='FEASIBLE')outcome={result:plan.result,...(old?{holdId:old.id}:{})};
    else {
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
     for(const otherId of plan.replanned){const other=(await c.query<HoldRow>('SELECT * FROM inventory_holds WHERE id=$1',[otherId])).rows[0]!;await this.claims(c,otherId,other.conditions,plan.witness.filter(w=>w.holdId===otherId));}
     await this.claims(c,target,conditions,plan.witness.filter(w=>w.holdId==='candidate'));
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
