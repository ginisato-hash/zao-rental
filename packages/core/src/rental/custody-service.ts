import {preparationMembers,recordPreparation,preparationStillValid,type PreparationItem} from '../../../contracts/src/preparation';
import {centimetres,type Profile} from '../../../contracts/src/recommendation';
import {bookingConfirmed} from '../../../contracts/src/booking-state';
import {randomUUID} from 'node:crypto';
import {pickupTiming} from '../../../contracts/src/pickup';
import type {PoolClient} from 'pg';
import {BookingService} from '../payment/booking-service';
import {FlowError,flowHash,flowId,flowObject,flowStore,flowVersion} from '../../../contracts/src/rental-flow';
import {GROUP_CONFIRMATION_BASIS,memberKey,settlementOf} from '../../../contracts/src/group-order';
import {isWear,isAccessoryPole,normalizePeriod,variantMatches,type HoldConditions,type PromiseVariant} from '../../../contracts/src/hold';
type Conn=Pick<PoolClient,'query'>;
type Loan={id:string;cycle_id:string;booking_id:string;requirement_key:string;asset_id:string|null;pole_id:string|null;pole_slot:number|null;variant_id:string;family:string;state:string;version:number};
type Candidate={id:string;batch_id:string;loan_item_id:string|null;cycle_id:string|null;asset_id:string|null;pole_id:string|null;loan_version:number|null;scanned_at:Date;state:string;outcome:string};
type GroupPartRow={id:string;group_id:string;part_no:number;hold_id:string;active:boolean;member_count:number;group_number:string;group_label:string;group_status:string;group_revision:number;confirmation_basis:string|null;confirmed_total_jpy:string|null;pickup_store:string;return_store:string};
type GroupMemberRow={id:string;ordinal:number;label:string;profile:Record<string,unknown>;selection:unknown;fit:Record<string,unknown>|null};
/** MANUAL_FIT_REQUIRED however the fit record spells it (group status, or the size-edge FitMeta kind). Same predicate as the database (group_member_manual_fit). */
export function groupMemberNeedsManualFit(fit:Record<string,unknown>|null|undefined){
 if(!fit)return false;const f=fit as {status?:unknown;kind?:unknown;fit?:{kind?:unknown}};
 return f.status==='MANUAL_FIT_REQUIRED'||f.kind==='MANUAL_FIT_REQUIRED'||f.fit?.kind==='MANUAL_FIT_REQUIRED';
}
/** The stored raw profile, normalized to the Profile the preparation contract expects (key = the stable member key of the part). Missing data stays missing. */
function groupProfile(m:GroupMemberRow,conditions:HoldConditions):Profile{
 const key=memberKey(m.ordinal),hm=conditions.members.find(x=>x.key===key),raw=m.profile as Partial<Profile>;
 const sport=raw.sport??(hm?.product==='WEAR_SET'?'WEAR':hm?.items.some(i=>i.family.startsWith('SNOWBOARD'))?'SNOWBOARD':'SKI');
 return {...raw,key,sport,heightCm:(raw.heightCm??null) as number|null,footCm:(raw.footCm??null) as number|null,adultAtStart:raw.adultAtStart??hm?.age==='ADULT',tier:raw.tier??(hm?.tier as Profile['tier']),ski:(raw.ski??null) as Profile['ski']} as Profile;
}
const note=(v:unknown)=>{if(typeof v!=='string'||!v.trim()||v.length>160)throw new FlowError('INVALID_EVIDENCE',422);return v.trim();};
// Service identity comes exclusively from the maintained server-verified session.
// The role cannot change locations/history or loan state: UUID-only database functions do that.
export class CustodyService extends BookingService{
 private async tx<T>(permission:'RENTAL_CHECKOUT'|'RENTAL_RETURN',stores:string[],key:string,input:unknown,preflight:(c:Conn)=>Promise<void>,fn:(c:PoolClient,now:Date)=>Promise<T>){
  flowId(key);const fingerprint=flowHash(input);return this.transaction(permission,stores,preflight,async(c,now)=>{
   await c.query("SELECT set_config('zao.session',$1,true)",[this.identity.sessionId]);
   const prior=(await c.query('SELECT fingerprint,result FROM rental_requests WHERE actor=$1 AND request_key=$2',[this.identity.subject,key])).rows[0];
   if(prior){if(prior.fingerprint!==fingerprint)throw new FlowError('IDEMPOTENCY_MISMATCH');// Reconcile saved operation identity, then show the current authorized state.
    // Do not display an old OUT/candidate result after another terminal received it.
    const request=input as {operation:string;v?:{bookingId?:string;batchId?:string;partId?:string}};
    if(request.operation==='prepare'||request.operation==='checkout'||request.operation==='completeNoPickup')return await this.assignment(c,request.v!.bookingId!) as T;
    if(request.operation==='groupPrepare'||request.operation==='groupCheckout')return await this.groupAssignment(c,request.v!.partId!) as T;
    if(['batch','scan','confirm'].includes(request.operation))return await this.batchView(c,request.operation==='batch'?prior.result.id:request.v!.batchId!) as T;
    return prior.result as T;}
   const result=await fn(c,now);await c.query('INSERT INTO rental_requests(actor,request_key,fingerprint,result) VALUES($1,$2,$3,$4)',[this.identity.subject,key,fingerprint,JSON.stringify(result)]);return result;
  });
 }
 private async pickup(c:Conn,id:string){const b=await this.booking(c,id);await this.authorize('RENTAL_CHECKOUT',[b.conditions.pickupStore]);const h=(await c.query<{conditions:HoldConditions}>('SELECT conditions FROM inventory_holds WHERE id=$1',[b.hold_id])).rows[0]!;return {...b,conditions:h.conditions};}
 private async assignment(c:Conn,id:string){const b=await this.pickup(c,id);await this.authorize('BOOKING_VIEW',[b.conditions.pickupStore]);const h=(await c.query('SELECT * FROM inventory_holds WHERE id=$1',[b.hold_id])).rows[0];
  const items=(await c.query<PreparationItem>(`SELECT DISTINCT cl.requirement_key,cl.asset_id,cl.pole_id,coalesce(a.variant_id,p.variant_id) AS variant_id,v.family,v.size,m.name,m.catalog_season,a.bsl_status,a.bsl_mm FROM inventory_claims cl LEFT JOIN ledger_assets a ON a.id=cl.asset_id LEFT JOIN ledger_poles p ON p.id=cl.pole_id JOIN ledger_variants v ON v.id=coalesce(a.variant_id,p.variant_id) JOIN ledger_models m ON m.id=v.model_id WHERE cl.hold_id=$1 AND cl.active ORDER BY cl.requirement_key`,[b.hold_id])).rows;
  const sel=(await c.query<{input:{members:Profile[]};selection:{fit?:Record<string,unknown>}}>('SELECT p.input,s.selection FROM recommendation_selections s JOIN recommendation_previews p ON p.id=s.preview_id WHERE s.quote_id=$1',[b.quote_id])).rows[0],profiles=sel?.input.members??[],fitByMember=sel?.selection.fit??null;
  const wearIds=b.conditions.members.flatMap(m=>m.items.filter(i=>isWear(i.family)).flatMap(i=>i.variantIds));
  const wearVariants=(await c.query<{id:string;family:string;size:string}>('SELECT id,family,size FROM ledger_variants WHERE id=ANY($1::uuid[])',[wearIds])).rows;
  const poleSizes=(await c.query<{size:string}>("SELECT DISTINCT v.size FROM ledger_poles p JOIN ledger_variants v ON v.id=p.variant_id WHERE p.store_id=$1 AND p.status='AVAILABLE' AND p.quantity>0",[b.conditions.pickupStore])).rows.map(p=>centimetres(p.size)).filter((n):n is number=>n!==null);
  const preparation=(await c.query('SELECT * FROM rental_preparations WHERE id=$1',[b.id])).rows[0]??null;
  return {bookingId:b.id,bookingVersion:b.version,holdVersion:h.version,conditions:b.conditions,customerName:b.contact.displayName,preparationMembers:preparationMembers(b.conditions,profiles,items,wearVariants,poleSizes),fitByMember,preparationValid:!!preparation?.prepared_at&&['PREPARATION_FIXED','RENTAL_FIXED'].includes(h.allocation_stage)&&preparationStillValid(preparation.fit_evidence,items,b.conditions),pickupTiming:pickupTiming(b.conditions.period,await this.time(c)),noPickup:(await c.query('SELECT outcome,completed_at FROM rental_no_pickup_events WHERE booking_id=$1',[b.id])).rows[0]??null,items,preparation,loans:(await c.query('SELECT * FROM rental_loan_items WHERE booking_id=$1 ORDER BY requirement_key',[b.id])).rows};
 }
 async checkoutView(id:string){await this.authorize('RENTAL_CHECKOUT');return this.assignment(this.pool,id);}
 async prepare(key:string,value:unknown){const v=flowObject(value,['bookingId','expectedBookingVersion','expectedHoldVersion','selections','fitEvidence']);flowId(v.bookingId);flowVersion(v.expectedBookingVersion);flowVersion(v.expectedHoldVersion);
  if(!Array.isArray(v.selections)||v.selections.length>60)throw new FlowError('INVALID_SELECTION',422);
  const selections=v.selections.map(x=>{const p=flowObject(x,['requirementKey','assetId','poleId']);if(typeof p.requirementKey!=='string'||p.requirementKey.length>100)throw new FlowError('INVALID_SELECTION',422);if(p.assetId!==null)flowId(p.assetId);if(p.poleId!==null)flowId(p.poleId);if((p.assetId===null)===(p.poleId===null))throw new FlowError('INVALID_SELECTION',422);return p;});
  return this.tx('RENTAL_CHECKOUT',[],key,{operation:'prepare',v},async c=>{await this.pickup(c,v.bookingId as string);},async(c,now)=>{
   const b=await this.pickup(c,v.bookingId as string),h=(await c.query('SELECT * FROM inventory_holds WHERE id=$1',[b.hold_id])).rows[0];
   if(b.version!==v.expectedBookingVersion||h.version!==v.expectedHoldVersion)throw new FlowError('STALE_VERSION');
   if(!bookingConfirmed(b.mode,b.state)||h.state!=='ACTIVE'||h.payment_state!=='SUCCESS'||!h.confirmed_at||h.transfer_attention||!['PROVISIONAL','PREPARATION_FIXED'].includes(h.allocation_stage))throw new FlowError('PREPARATION_NOT_ALLOWED');
   await this.verifyClaims(c,h,now);await this.verifyPhysicalHandoff(c,h.id);const a=await this.assignment(c,b.id);
   const expected=a.items.map(i=>({requirementKey:i.requirement_key,assetId:i.asset_id,poleId:i.pole_id})).sort((a,b)=>a.requirementKey.localeCompare(b.requirementKey));
   if(flowHash([...selections].sort((a,b)=>String(a.requirementKey).localeCompare(String(b.requirementKey))))!==flowHash(expected))throw new FlowError('EXACT_FULL_PERIOD_ASSIGNMENT_REQUIRED');
   // Only untracked SKI_SET accessory poles may be absent; paid standalone poles need claims.
   const wanted=b.conditions.members.flatMap(m=>m.items.filter(i=>!isWear(i.family)).map(i=>({key:m.key+':'+i.family,m,i})));
   const wantedByKey=new Map(wanted.map(w=>[w.key,w]));
   if(a.items.some((i:{requirement_key:string})=>!wantedByKey.has(i.requirement_key))||wanted.some(w=>!isAccessoryPole(w.m,w.i.family)&&!a.items.some((i:{requirement_key:string})=>i.requirement_key===w.key)))throw new FlowError('INCOMPLETE_EQUIPMENT_GROUP');
   const variants=(await c.query<PromiseVariant>(`SELECT v.*,m.catalog_season FROM ledger_variants v JOIN ledger_models m ON m.id=v.model_id WHERE v.id=ANY($1::uuid[])`,[a.items.map(i=>i.variant_id)])).rows;
   for(const i of a.items){const req=wanted.find(r=>r.key===i.requirement_key);if(!req||!variantMatches(req.m,req.i,variants.find(v=>v.id===i.variant_id)))throw new FlowError('PROMISE_MISMATCH');}
   const evidence=recordPreparation(v.fitEvidence,a.preparationMembers,this.identity.subject,now.toISOString(),expected,b.conditions);
   if(!preparationStillValid(evidence,a.items,b.conditions))throw new FlowError('PREPARED_ASSIGNMENT_CHANGED');
   await c.query('INSERT INTO rental_preparations(id,store_id,checked_in_at,checked_in_by,prepared_at,prepared_by,fit_evidence) VALUES($1,$2,$3,$4,$3,$4,$5) ON CONFLICT(id) DO UPDATE SET prepared_at=EXCLUDED.prepared_at,prepared_by=EXCLUDED.prepared_by,fit_evidence=EXCLUDED.fit_evidence,version=rental_preparations.version+1',[b.id,b.conditions.pickupStore,now,this.identity.subject,JSON.stringify(evidence)]);
   await c.query("UPDATE inventory_holds SET allocation_stage='PREPARATION_FIXED',version=version+1 WHERE id=$1",[h.id]);return this.assignment(c,b.id);
  });
 }
 async checkout(key:string,value:unknown){const v=flowObject(value,['bookingId','expectedPreparationVersion']);flowId(v.bookingId);flowVersion(v.expectedPreparationVersion);
  return this.tx('RENTAL_CHECKOUT',[],key,{operation:'checkout',v},async c=>{await this.pickup(c,v.bookingId as string);},async(c,now)=>{
   const b=await this.pickup(c,v.bookingId as string),p=(await c.query('SELECT * FROM rental_preparations WHERE id=$1',[b.id])).rows[0];
   if(!bookingConfirmed(b.mode,b.state))throw new FlowError('CHECKOUT_NOT_ALLOWED');
   if(!p||p.version!==v.expectedPreparationVersion||!p.prepared_at)throw new FlowError('STALE_PREPARATION');
   if((await c.query('SELECT 1 FROM rental_loan_items WHERE booking_id=$1',[b.id])).rowCount)throw new FlowError('ALREADY_CHECKED_OUT');
   const h=(await c.query('SELECT * FROM inventory_holds WHERE id=$1',[b.hold_id])).rows[0];await this.verifyClaims(c,h,now);await this.verifyPhysicalHandoff(c,h.id);
   // Legacy evidence stays as history only: current checkout needs a valid ZAO_PREP_V2 preparation.
   if(p.fit_evidence?.version!=='ZAO_PREP_V2')throw new FlowError('REPREPARATION_REQUIRED');
   if(!((await this.assignment(c,b.id)).preparationValid))throw new FlowError('PREPARED_ASSIGNMENT_CHANGED');
   if(h.allocation_stage!=='PREPARATION_FIXED')throw new FlowError('PREPARATION_NOT_FIXED');
   const rows=(await c.query(`SELECT DISTINCT ON(requirement_key) cl.*,coalesce(a.variant_id,p.variant_id) AS variant_id,v.family FROM inventory_claims cl LEFT JOIN ledger_assets a ON a.id=cl.asset_id LEFT JOIN ledger_poles p ON p.id=cl.pole_id JOIN ledger_variants v ON v.id=coalesce(a.variant_id,p.variant_id) WHERE cl.hold_id=$1 AND cl.active ORDER BY requirement_key,day`,[b.hold_id])).rows;
   if(flowHash(rows.map(i=>({requirementKey:i.requirement_key,assetId:i.asset_id,poleId:i.pole_id})))!==flowHash(p.fit_evidence.selections)){const amendment=(await c.query("SELECT q.assignment FROM ops_amendments a JOIN ops_amendment_quotes q ON q.id=a.id WHERE a.booking_id=$1 AND q.expected_hold_version+1=$2 AND length(btrim(a.fit_evidence))>0",[b.id,h.version])).rows[0];if(!amendment||flowHash(rows.map(i=>({key:i.requirement_key,asset:i.asset_id,pole:i.pole_id})))!==flowHash(amendment.assignment.equipment.map((i:{key:string;asset:string|null;pole:string|null})=>({key:i.key,asset:i.asset,pole:i.pole}))))throw new FlowError('PREPARED_ASSIGNMENT_CHANGED');}
   const period=normalizePeriod(b.conditions.period);
   for(const i of rows)await c.query(`INSERT INTO rental_loan_items(id,cycle_id,booking_id,requirement_key,asset_id,pole_id,pole_slot,family,variant_id,unit,quantity,pickup_store,checked_out_at,checked_out_by,due_at,state) VALUES($1,$2,$2,$3,$4,$5,$6,$7,$8,$9,1,$10,$11,$12,$13,'OUT')`,[randomUUID(),b.id,i.requirement_key,i.asset_id,i.pole_id,i.pole_slot,i.family,i.variant_id,i.family==='SNOWBOARD'?'BOARD':'PAIR',b.conditions.pickupStore,now,this.identity.subject,period.dueAt]);
   await c.query("UPDATE inventory_holds SET allocation_stage='RENTAL_FIXED',version=version+1 WHERE id=$1",[b.hold_id]);return this.assignment(c,b.id);
  });
 }
 async completeNoPickup(key:string,value:unknown){const v=flowObject(value,['bookingId']);flowId(v.bookingId);
  return this.tx('RENTAL_CHECKOUT',[],key,{operation:'completeNoPickup',v},async c=>{await this.pickup(c,v.bookingId as string);},async c=>{await c.query('SELECT public.rental_complete_no_pickup($1)',[v.bookingId]);return this.assignment(c,v.bookingId as string);});
 }
 private async batch(c:Conn,id:string){flowId(id);const b=(await c.query('SELECT * FROM rental_return_batches WHERE id=$1',[id])).rows[0];if(!b||b.owner_id!==this.identity.subject)throw new FlowError('FORBIDDEN',403);await this.authorize('RENTAL_RETURN',[b.store_id]);return b;}
 private async batchView(c:Conn,id:string){const b=await this.batch(c,id);const candidates=(await c.query<{group_part_id:string|null}>(`SELECT c.*,l.booking_id,l.group_part_id,l.requirement_key,l.family FROM rental_return_candidates c LEFT JOIN rental_loan_items l ON l.id=c.loan_item_id WHERE c.batch_id=$1 ORDER BY c.scanned_at,c.id`,[id])).rows;return {...b,candidates:await this.withGroupNumbers(c,candidates)};}
 // A group item is shown under its parent group number (no booking exists). Only touched when a group loan is present.
 private async withGroupNumbers<T extends {group_part_id:string|null}>(c:Conn,rows:T[]){const ids=[...new Set(rows.map(r=>r.group_part_id).filter((x):x is string=>!!x))];if(!ids.length)return rows.map(r=>({...r,group_number:null as string|null}));const g=new Map((await c.query<{id:string;group_number:string}>('SELECT p.id,o.group_number FROM group_order_parts p JOIN group_orders o ON o.id=p.group_id WHERE p.id=ANY($1::uuid[])',[ids])).rows.map(x=>[x.id,x.group_number]));return rows.map(r=>({...r,group_number:r.group_part_id?g.get(r.group_part_id)??null:null}));}
 async getBatch(id:string){await this.authorize('RENTAL_RETURN');return this.batchView(this.pool,id);}
 async createBatch(key:string,store:string){flowStore(store);return this.tx('RENTAL_RETURN',[store],key,{operation:'batch',store},async()=>{},async(c,now)=>{const id=randomUUID();await c.query('INSERT INTO rental_return_batches(id,owner_id,store_id,created_at) VALUES($1,$2,$3,$4)',[id,this.identity.subject,store,now]);return this.batchView(c,id);});}
 async scan(key:string,value:unknown){const v=flowObject(value,['batchId','expectedVersion','assetId','poleLoanId']);flowId(v.batchId);flowVersion(v.expectedVersion);if(v.assetId!==null)flowId(v.assetId);if(v.poleLoanId!==null)flowId(v.poleLoanId);if((v.assetId===null)===(v.poleLoanId===null))throw new FlowError('INVALID_SCAN',422);
  return this.tx('RENTAL_RETURN',[],key,{operation:'scan',v},async c=>{await this.batch(c,v.batchId as string);},async(c,now)=>{const b=await this.batch(c,v.batchId as string);if(b.version!==v.expectedVersion)throw new FlowError('STALE_VERSION');
   const loan=(await c.query<Loan>(v.assetId?"SELECT * FROM rental_loan_items WHERE asset_id=$1 AND state='OUT'":"SELECT * FROM rental_loan_items WHERE id=$1 AND pole_id IS NOT NULL AND state='OUT'",[v.assetId??v.poleLoanId])).rows[0];
   if(loan&&(await c.query('SELECT 1 FROM rental_return_candidates WHERE batch_id=$1 AND loan_item_id=$2',[b.id,loan.id])).rowCount)return this.batchView(c,b.id);
   if(Number((await c.query('SELECT count(*) n FROM rental_return_candidates WHERE batch_id=$1',[b.id])).rows[0].n)>=200)throw new FlowError('BATCH_LIMIT',422);
   await c.query(`INSERT INTO rental_return_candidates(id,batch_id,request_key,scan_sha256,asset_id,pole_id,loan_item_id,cycle_id,loan_version,scanned_at,state,outcome) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,[randomUUID(),b.id,key,flowHash({assetId:v.assetId,poleLoanId:v.poleLoanId}),loan?.asset_id??v.assetId,loan?.pole_id??null,loan?.id??null,loan?.cycle_id??null,loan?.version??null,now,loan?'CANDIDATE':'REVIEW',loan?'PINNED_LOAN_CYCLE':'UNKNOWN_OR_ALREADY_RECEIVED']);
   await c.query('UPDATE rental_return_batches SET version=version+1 WHERE id=$1',[b.id]);return this.batchView(c,b.id);
  });
 }
 async confirm(key:string,value:unknown){const v=flowObject(value,['batchId','expectedVersion']);flowId(v.batchId);flowVersion(v.expectedVersion);
  return this.tx('RENTAL_RETURN',[],key,{operation:'confirm',v},async c=>{await this.batch(c,v.batchId as string);},async(c,now)=>{const b=await this.batch(c,v.batchId as string);if(b.version!==v.expectedVersion)throw new FlowError('STALE_VERSION');
   const candidates=(await c.query<Candidate>("SELECT * FROM rental_return_candidates WHERE batch_id=$1 AND state='CANDIDATE' ORDER BY id",[b.id])).rows;
   for(const candidate of candidates){const l=(await c.query<Loan>('SELECT * FROM rental_loan_items WHERE id=$1',[candidate.loan_item_id])).rows[0];
    if(!l||l.state!=='OUT'||l.version!==candidate.loan_version||l.cycle_id!==candidate.cycle_id){await c.query("UPDATE rental_return_candidates SET state='REVIEW',outcome='STALE_LOAN_CYCLE' WHERE id=$1",[candidate.id]);continue;}
    const receipt=randomUUID();await c.query('INSERT INTO rental_receipts(id,loan_item_id,candidate_id,received_store,actor,scanned_at,confirmed_at,actual_received_at) VALUES($1,$2,$3,$4,$5,$6,$7,$7)',[receipt,l.id,candidate.id,b.store_id,this.identity.subject,candidate.scanned_at,now]);
    await c.query('SELECT public.rental_apply_receipt($1)',[receipt]);
   }
   await c.query('UPDATE rental_return_batches SET version=version+1 WHERE id=$1',[b.id]);return this.batchView(c,b.id);
  });
 }
 async inspection(key:string,value:unknown){const v=flowObject(value,['loanItemId','expectedVersion','store','evidence']);flowId(v.loanItemId);flowVersion(v.expectedVersion);flowStore(v.store);const evidence=note(v.evidence);
  return this.tx('RENTAL_RETURN',[v.store as string],key,{operation:'inspect',v},async c=>{if(!(await c.query('SELECT 1 FROM rental_custody_events WHERE loan_item_id=$1 AND actual_store=$2',[v.loanItemId,v.store])).rowCount)throw new FlowError('FORBIDDEN',403);},async(c,now)=>{const id=randomUUID();await c.query("INSERT INTO rental_inspections(id,loan_item_id,actor,store_id,inspected_at,result,evidence,expected_version) VALUES($1,$2,$3,$4,$5,'READY',$6,$7)",[id,v.loanItemId,this.identity.subject,v.store,now,evidence,v.expectedVersion]);await c.query('SELECT public.rental_apply_inspection($1)',[id]);return {id,loanItemId:v.loanItemId,state:'INSPECTED_CALENDAR_BLOCK_REMAINS'};});
 }
 async returns(store:string){flowStore(store);await this.authorize('RENTAL_RETURN',[store]);return {batches:(await this.pool.query('SELECT * FROM rental_return_batches WHERE owner_id=$1 AND store_id=$2 ORDER BY created_at DESC LIMIT 100',[this.identity.subject,store])).rows,received:await this.withGroupNumbers(this.pool,(await this.pool.query<{group_part_id:string|null}>(`SELECT e.*,l.family,l.requirement_key,l.version,l.asset_id,l.pole_id,l.group_part_id,i.inspection_id FROM rental_custody_events e JOIN rental_loan_items l ON l.id=e.loan_item_id LEFT JOIN rental_inspection_events i ON i.loan_item_id=l.id WHERE e.actual_store=$1 ORDER BY e.applied_at DESC LIMIT 200`,[store])).rows)};}

 // ------------------------------------------------------------------------------------------------------------------
 // GROUP CUSTODY (Issue #47 B4). A CONFIRMED group (confirmation_basis GROUP_ADMIN_APPROVED, settled on site, usually still
 // UNPAID) is prepared / checked out per PART (<=20 members, one hold) through the very same physical rules as a booking:
 // exact full-period asset assignment, prepared fit evidence, promise match, store boundary, PAIR conservation. It never needs a
 // booking or payment_state=SUCCESS, and it never creates one: the ordinary gate above is untouched. The database enforces the same
 // conditions again (rental_validate_group_loan / rental_stage_guard), so this layer is not the only barrier.
 private async groupPartRow(c:Conn,partId:string){
  flowId(partId);
  const r=(await c.query<GroupPartRow>('SELECT p.id,p.group_id,p.part_no,p.hold_id,p.active,p.member_count,g.group_number,g.group_label,g.status AS group_status,g.revision AS group_revision,g.confirmation_basis,g.confirmed_total_jpy,g.pickup_store,g.return_store FROM group_order_parts p JOIN group_orders g ON g.id=p.group_id WHERE p.id=$1',[partId])).rows[0];
  if(!r)throw new FlowError('NOT_FOUND',404);
  await this.authorize('RENTAL_CHECKOUT',[r.pickup_store]);return r;
 }
 /** Who may custody-handle this part: staff with RENTAL_CHECKOUT + BOOKING_VIEW for the pickup store (re-read per call). */
 private async groupPickup(c:Conn,partId:string){const p=await this.groupPartRow(c,partId);const h=(await c.query('SELECT * FROM inventory_holds WHERE id=$1',[p.hold_id])).rows[0]!;return {p,h};}
 private groupConfirmed(p:GroupPartRow){return p.active&&p.group_status==='CONFIRMED'&&p.confirmation_basis===GROUP_CONFIRMATION_BASIS;}
 private async groupAssignment(c:Conn,partId:string){
  const {p,h}=await this.groupPickup(c,partId);await this.authorize('BOOKING_VIEW',[p.pickup_store]);
  const conditions=h.conditions as HoldConditions;
  const items=(await c.query<PreparationItem>(`SELECT DISTINCT cl.requirement_key,cl.asset_id,cl.pole_id,coalesce(a.variant_id,po.variant_id) AS variant_id,v.family,v.size,m.name,m.catalog_season,a.bsl_status,a.bsl_mm FROM inventory_claims cl LEFT JOIN ledger_assets a ON a.id=cl.asset_id LEFT JOIN ledger_poles po ON po.id=cl.pole_id JOIN ledger_variants v ON v.id=coalesce(a.variant_id,po.variant_id) JOIN ledger_models m ON m.id=v.model_id WHERE cl.hold_id=$1 AND cl.active ORDER BY cl.requirement_key`,[p.hold_id])).rows;
  const members=(await c.query<GroupMemberRow>('SELECT id,ordinal,label,profile,selection,fit FROM group_members WHERE group_id=$1 AND part_no=$2 ORDER BY ordinal',[p.group_id,p.part_no])).rows;
  const profiles=members.map(m=>groupProfile(m,conditions));
  const wearIds=conditions.members.flatMap(m=>m.items.filter(i=>isWear(i.family)).flatMap(i=>i.variantIds));
  const wearVariants=(await c.query<{id:string;family:string;size:string}>('SELECT id,family,size FROM ledger_variants WHERE id=ANY($1::uuid[])',[wearIds])).rows;
  const poleSizes=(await c.query<{size:string}>("SELECT DISTINCT v.size FROM ledger_poles po JOIN ledger_variants v ON v.id=po.variant_id WHERE po.store_id=$1 AND po.status='AVAILABLE' AND po.quantity>0",[p.pickup_store])).rows.map(x=>centimetres(x.size)).filter((n):n is number=>n!==null);
  const preparation=(await c.query('SELECT * FROM group_part_preparations WHERE id=$1',[p.id])).rows[0]??null;
  const receipts=(await c.query<{kind:'RECEIPT'|'REVERSAL';amount_jpy:string}>('SELECT kind,amount_jpy FROM group_payments WHERE group_id=$1',[p.group_id])).rows;
  const manualFit=members.filter(m=>groupMemberNeedsManualFit(m.fit)).map(m=>memberKey(m.ordinal));
  return {
   kind:'GROUP_PART' as const,partId:p.id,groupId:p.group_id,groupNumber:p.group_number,groupLabel:p.group_label,partNo:p.part_no,memberCount:p.member_count,
   groupStatus:p.group_status,groupRevision:p.group_revision,confirmationBasis:p.confirmation_basis,
   // Settlement is shown as what it is: on site, usually not yet settled. It is not a custody condition (settlement happens at the counter).
   settlement:settlementOf(p.confirmed_total_jpy===null?null:Number(p.confirmed_total_jpy),receipts.map(r=>({kind:r.kind,amountJpy:Number(r.amount_jpy)}))),
   holdVersion:h.version as number,holdStage:h.allocation_stage as string,conditions,
   members:members.map(m=>({memberId:m.id,memberKey:memberKey(m.ordinal),ordinal:m.ordinal,label:m.label,manualFitRequired:groupMemberNeedsManualFit(m.fit),fit:m.fit})),
   manualFitMemberKeys:manualFit,
   preparationMembers:preparationMembers(conditions,profiles,items,wearVariants,poleSizes),
   preparationValid:!!preparation?.prepared_at&&['PREPARATION_FIXED','RENTAL_FIXED'].includes(h.allocation_stage)&&preparationStillValid(preparation.fit_evidence,items,conditions)&&manualFit.every(k=>preparation.fit_evidence?.manualFit?.[k]?.confirmed===true),
   items,preparation,
   loans:(await c.query('SELECT * FROM rental_loan_items WHERE group_part_id=$1 ORDER BY requirement_key',[p.id])).rows,
  };
 }
 async groupCheckoutView(partId:string){await this.authorize('RENTAL_CHECKOUT');return this.groupAssignment(this.pool,partId);}
 /** Parent view: the group number and, per part, the members with their equipment, size/fit flag and loan state. No contact data. */
 async groupOverview(groupId:string){
  flowId(groupId);await this.authorize('RENTAL_CHECKOUT');
  const g=(await this.pool.query<{id:string;group_number:string;group_label:string;status:string;confirmation_basis:string|null;confirmed_total_jpy:string|null;pickup_store:string;return_store:string;member_count:number;period:unknown}>('SELECT id,group_number,group_label,status,confirmation_basis,confirmed_total_jpy,pickup_store,return_store,member_count,period FROM group_orders WHERE id=$1',[groupId])).rows[0];
  if(!g)throw new FlowError('NOT_FOUND',404);
  await this.authorize('RENTAL_CHECKOUT',[g.pickup_store]);await this.authorize('BOOKING_VIEW',[g.pickup_store]);
  const parts=(await this.pool.query<{id:string;part_no:number;hold_id:string;member_count:number}>('SELECT id,part_no,hold_id,member_count FROM group_order_parts WHERE group_id=$1 AND active ORDER BY part_no',[g.id])).rows;
  const members=(await this.pool.query<GroupMemberRow&{part_no:number}>('SELECT id,ordinal,label,profile,selection,fit,part_no FROM group_members WHERE group_id=$1 ORDER BY ordinal',[g.id])).rows;
  const loans=(await this.pool.query<{group_part_id:string;requirement_key:string;family:string;state:string;asset_id:string|null;pole_id:string|null}>('SELECT l.group_part_id,l.requirement_key,l.family,l.state,l.asset_id,l.pole_id FROM rental_loan_items l JOIN group_order_parts p ON p.id=l.group_part_id WHERE p.group_id=$1',[g.id])).rows;
  const holds=new Map((await this.pool.query<{id:string;allocation_stage:string;version:number}>('SELECT id,allocation_stage,version FROM inventory_holds WHERE id=ANY($1::uuid[])',[parts.map(p=>p.hold_id)])).rows.map(h=>[h.id,h]));
  const prep=new Map((await this.pool.query<{id:string;prepared_at:Date|null}>('SELECT id,prepared_at FROM group_part_preparations WHERE id=ANY($1::uuid[])',[parts.map(p=>p.id)])).rows.map(r=>[r.id,r]));
  const receipts=(await this.pool.query<{kind:'RECEIPT'|'REVERSAL';amount_jpy:string}>('SELECT kind,amount_jpy FROM group_payments WHERE group_id=$1',[g.id])).rows;
  return {
   groupId:g.id,groupNumber:g.group_number,groupLabel:g.group_label,status:g.status,confirmationBasis:g.confirmation_basis,period:g.period,pickupStore:g.pickup_store,returnStore:g.return_store,memberCount:g.member_count,
   settlement:settlementOf(g.confirmed_total_jpy===null?null:Number(g.confirmed_total_jpy),receipts.map(r=>({kind:r.kind,amountJpy:Number(r.amount_jpy)}))),
   // Only the confirmed group can be lent; every other state is shown but cannot be prepared or lent (REVIEW_HELD / RELEASED / CANCELLED ...).
   lendable:g.status==='CONFIRMED'&&g.confirmation_basis===GROUP_CONFIRMATION_BASIS,
   parts:parts.map(p=>({partId:p.id,partNo:p.part_no,memberCount:p.member_count,holdStage:holds.get(p.hold_id)?.allocation_stage??null,prepared:!!prep.get(p.id)?.prepared_at,
    loansOut:loans.filter(l=>l.group_part_id===p.id&&l.state==='OUT').length,loansReceived:loans.filter(l=>l.group_part_id===p.id&&l.state==='RECEIVED').length,
    members:members.filter(m=>m.part_no===p.part_no).map(m=>({memberId:m.id,memberKey:memberKey(m.ordinal),ordinal:m.ordinal,label:m.label,manualFitRequired:groupMemberNeedsManualFit(m.fit),fit:m.fit,
     equipment:loans.filter(l=>l.group_part_id===p.id&&l.requirement_key.startsWith(memberKey(m.ordinal)+':')).map(l=>({family:l.family,state:l.state,assetId:l.asset_id,poleId:l.pole_id}))}))}))
  };
 }
 async groupByNumber(number:string){
  if(typeof number!=='string'||!/^G-\d{6}$/.test(number))throw new FlowError('INVALID_GROUP_NUMBER',422);
  await this.authorize('RENTAL_CHECKOUT');const id=(await this.pool.query<{id:string}>('SELECT id FROM group_orders WHERE group_number=$1',[number])).rows[0]?.id;
  if(!id)throw new FlowError('NOT_FOUND',404);return this.groupOverview(id);
 }
 private groupUsable(p:GroupPartRow,h:{state:string;payment_state:string;transfer_attention:string|null;allocation_stage:string},stages:string[]){
  // NOT the ordinary booking gate: this is the group-only condition. payment_state must be NONE (never a fabricated SUCCESS).
  if(!this.groupConfirmed(p)||h.state!=='ACTIVE'||h.payment_state!=='NONE'||h.transfer_attention||!stages.includes(h.allocation_stage))throw new FlowError('GROUP_CUSTODY_NOT_ALLOWED');
 }
 async groupPrepare(key:string,value:unknown){
  const v=flowObject(value,['partId','expectedGroupRevision','expectedHoldVersion','selections','fitEvidence','manualFit']);flowId(v.partId);flowVersion(v.expectedGroupRevision);flowVersion(v.expectedHoldVersion);
  if(!Array.isArray(v.selections)||v.selections.length>60)throw new FlowError('INVALID_SELECTION',422);
  const selections=v.selections.map(x=>{const q=flowObject(x,['requirementKey','assetId','poleId']);if(typeof q.requirementKey!=='string'||q.requirementKey.length>100)throw new FlowError('INVALID_SELECTION',422);if(q.assetId!==null)flowId(q.assetId);if(q.poleId!==null)flowId(q.poleId);if((q.assetId===null)===(q.poleId===null))throw new FlowError('INVALID_SELECTION',422);return q;});
  if(!Array.isArray(v.manualFit)||v.manualFit.length>100)throw new FlowError('INVALID_MANUAL_FIT',422);
  const manual=v.manualFit.map(x=>{const q=flowObject(x,['memberKey','confirmed','note']);if(typeof q.memberKey!=='string'||!/^p\d{3}$/.test(q.memberKey)||typeof q.confirmed!=='boolean')throw new FlowError('INVALID_MANUAL_FIT',422);return {memberKey:q.memberKey,confirmed:q.confirmed,note:note(q.note)};});
  if(new Set(manual.map(m=>m.memberKey)).size!==manual.length)throw new FlowError('INVALID_MANUAL_FIT',422);
  return this.tx('RENTAL_CHECKOUT',[],key,{operation:'groupPrepare',v},async c=>{await this.groupPickup(c,v.partId as string);},async(c,now)=>{
   const {p,h}=await this.groupPickup(c,v.partId as string);
   if(p.group_revision!==v.expectedGroupRevision||h.version!==v.expectedHoldVersion)throw new FlowError('STALE_VERSION');
   this.groupUsable(p,h,['GROUP_RESERVED','PREPARATION_FIXED']);
   await this.verifyClaims(c,h,now);await this.verifyPhysicalHandoff(c,h.id);const a=await this.groupAssignment(c,p.id);
   const expected=a.items.map(i=>({requirementKey:i.requirement_key,assetId:i.asset_id,poleId:i.pole_id})).sort((x,y)=>x.requirementKey.localeCompare(y.requirementKey));
   if(flowHash([...selections].sort((x,y)=>String(x.requirementKey).localeCompare(String(y.requirementKey))))!==flowHash(expected))throw new FlowError('EXACT_FULL_PERIOD_ASSIGNMENT_REQUIRED');
   const conditions=h.conditions as HoldConditions;
   const wanted=conditions.members.flatMap(m=>m.items.filter(i=>!isWear(i.family)).map(i=>({key:m.key+':'+i.family,m,i})));
   const wantedByKey=new Map(wanted.map(w=>[w.key,w]));
   if(a.items.some(i=>!wantedByKey.has(i.requirement_key))||wanted.some(w=>!isAccessoryPole(w.m,w.i.family)&&!a.items.some(i=>i.requirement_key===w.key)))throw new FlowError('INCOMPLETE_EQUIPMENT_GROUP');
   const variants=(await c.query<PromiseVariant>(`SELECT v.*,m.catalog_season FROM ledger_variants v JOIN ledger_models m ON m.id=v.model_id WHERE v.id=ANY($1::uuid[])`,[a.items.map(i=>i.variant_id)])).rows;
   for(const i of a.items){const req=wanted.find(r=>r.key===i.requirement_key);if(!req||!variantMatches(req.m,req.i,variants.find(x=>x.id===i.variant_id)))throw new FlowError('PROMISE_MISMATCH');}
   // A size outside what can be fitted online needs the physical in-store fit recorded for exactly those members. A refused fit blocks the loan.
   const need=new Set(a.manualFitMemberKeys);
   if(manual.some(m=>!need.has(m.memberKey))||[...need].some(k=>!manual.some(m=>m.memberKey===k)))throw new FlowError('MANUAL_FIT_CONFIRMATION_REQUIRED',422);
   if(manual.some(m=>!m.confirmed))throw new FlowError('FIT_NOT_CONFIRMED',422);
   const base=recordPreparation(v.fitEvidence,a.preparationMembers,this.identity.subject,now.toISOString(),expected,conditions);
   const evidence={...base,manualFit:Object.fromEntries(manual.map(m=>[m.memberKey,{confirmed:true,note:m.note,confirmedBy:this.identity.subject,confirmedAt:now.toISOString()}]))};
   if(!preparationStillValid(evidence,a.items,conditions))throw new FlowError('PREPARED_ASSIGNMENT_CHANGED');
   await c.query('INSERT INTO group_part_preparations(id,store_id,checked_in_at,checked_in_by,prepared_at,prepared_by,fit_evidence) VALUES($1,$2,$3,$4,$3,$4,$5) ON CONFLICT(id) DO UPDATE SET prepared_at=EXCLUDED.prepared_at,prepared_by=EXCLUDED.prepared_by,fit_evidence=EXCLUDED.fit_evidence,version=group_part_preparations.version+1',[p.id,p.pickup_store,now,this.identity.subject,JSON.stringify(evidence)]);
   await c.query("UPDATE inventory_holds SET allocation_stage='PREPARATION_FIXED',version=version+1 WHERE id=$1",[h.id]);return this.groupAssignment(c,p.id);
  });
 }
 async groupCheckout(key:string,value:unknown){
  const v=flowObject(value,['partId','expectedPreparationVersion']);flowId(v.partId);flowVersion(v.expectedPreparationVersion);
  return this.tx('RENTAL_CHECKOUT',[],key,{operation:'groupCheckout',v},async c=>{await this.groupPickup(c,v.partId as string);},async(c,now)=>{
   const {p,h}=await this.groupPickup(c,v.partId as string),prep=(await c.query('SELECT * FROM group_part_preparations WHERE id=$1',[p.id])).rows[0];
   if(!this.groupConfirmed(p))throw new FlowError('CHECKOUT_NOT_ALLOWED');
   if(!prep||prep.version!==v.expectedPreparationVersion||!prep.prepared_at)throw new FlowError('STALE_PREPARATION');
   if((await c.query('SELECT 1 FROM rental_loan_items WHERE group_part_id=$1',[p.id])).rowCount)throw new FlowError('ALREADY_CHECKED_OUT');
   this.groupUsable(p,h,['PREPARATION_FIXED']);
   await this.verifyClaims(c,h,now);await this.verifyPhysicalHandoff(c,h.id);
   if(prep.fit_evidence?.version!=='ZAO_PREP_V2')throw new FlowError('REPREPARATION_REQUIRED');
   const a=await this.groupAssignment(c,p.id);
   if(!a.preparationValid)throw new FlowError(a.manualFitMemberKeys.some(k=>prep.fit_evidence?.manualFit?.[k]?.confirmed!==true)?'MANUAL_FIT_CONFIRMATION_REQUIRED':'PREPARED_ASSIGNMENT_CHANGED');
   const rows=(await c.query(`SELECT DISTINCT ON(requirement_key) cl.*,coalesce(a.variant_id,po.variant_id) AS variant_id,v.family FROM inventory_claims cl LEFT JOIN ledger_assets a ON a.id=cl.asset_id LEFT JOIN ledger_poles po ON po.id=cl.pole_id JOIN ledger_variants v ON v.id=coalesce(a.variant_id,po.variant_id) WHERE cl.hold_id=$1 AND cl.active ORDER BY requirement_key,day`,[h.id])).rows;
   if(flowHash(rows.map(i=>({requirementKey:i.requirement_key,assetId:i.asset_id,poleId:i.pole_id})))!==flowHash(prep.fit_evidence.selections))throw new FlowError('PREPARED_ASSIGNMENT_CHANGED');
   const period=normalizePeriod((h.conditions as HoldConditions).period);
   for(const i of rows)await c.query(`INSERT INTO rental_loan_items(id,cycle_id,booking_id,group_part_id,hold_id,requirement_key,asset_id,pole_id,pole_slot,family,variant_id,unit,quantity,pickup_store,checked_out_at,checked_out_by,due_at,state) VALUES($1,$2,NULL,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13,$14,'OUT')`,[randomUUID(),p.id,h.id,i.requirement_key,i.asset_id,i.pole_id,i.pole_slot,i.family,i.variant_id,i.family==='SNOWBOARD'?'BOARD':'PAIR',p.pickup_store,now,this.identity.subject,period.dueAt]);
   await c.query("UPDATE inventory_holds SET allocation_stage='RENTAL_FIXED',version=version+1 WHERE id=$1",[h.id]);return this.groupAssignment(c,p.id);
  });
 }
}
export type CustodyConditions=HoldConditions;

export async function receiveExchangeLoan(c:PoolClient,actor:string,store:string,loan:Loan,now:Date){
 const batch=randomUUID(),candidate=randomUUID(),receipt=randomUUID();
 await c.query('INSERT INTO rental_return_batches(id,owner_id,store_id,created_at) VALUES($1,$2,$3,$4)',[batch,actor,store,now]);
 await c.query("INSERT INTO rental_return_candidates(id,batch_id,request_key,scan_sha256,asset_id,pole_id,loan_item_id,cycle_id,loan_version,scanned_at,state,outcome) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'CANDIDATE','PINNED_LOAN_CYCLE')",[candidate,batch,randomUUID(),flowHash({loanId:loan.id,version:loan.version}),loan.asset_id,loan.pole_id,loan.id,loan.cycle_id,loan.version,now]);
 await c.query('INSERT INTO rental_receipts(id,loan_item_id,candidate_id,received_store,actor,scanned_at,confirmed_at,actual_received_at) VALUES($1,$2,$3,$4,$5,$6,$6,$6)',[receipt,loan.id,candidate,store,actor,now]);
 await c.query('SELECT public.rental_apply_receipt($1)',[receipt]);
}
