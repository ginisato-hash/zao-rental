import {randomUUID} from 'node:crypto';
import {pickupTiming} from '../../../contracts/src/pickup';
import type {PoolClient} from 'pg';
import {BookingService} from '../payment/booking-service';
import {FlowError,flowHash,flowId,flowObject,flowStore,flowVersion} from '../../../contracts/src/rental-flow';
import {isWear,normalizePeriod,variantMatches,type HoldConditions,type PromiseVariant} from '../../../contracts/src/hold';
type Conn=Pick<PoolClient,'query'>;
type Loan={id:string;cycle_id:string;booking_id:string;requirement_key:string;asset_id:string|null;pole_id:string|null;pole_slot:number|null;variant_id:string;family:string;state:string;version:number};
type Candidate={id:string;batch_id:string;loan_item_id:string|null;cycle_id:string|null;asset_id:string|null;pole_id:string|null;loan_version:number|null;scanned_at:Date;state:string;outcome:string};
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
    const request=input as {operation:string;v?:{bookingId?:string;batchId?:string}};
    if(request.operation==='prepare'||request.operation==='checkout'||request.operation==='completeNoPickup')return await this.assignment(c,request.v!.bookingId!) as T;
    if(['batch','scan','confirm'].includes(request.operation))return await this.batchView(c,request.operation==='batch'?prior.result.id:request.v!.batchId!) as T;
    return prior.result as T;}
   const result=await fn(c,now);await c.query('INSERT INTO rental_requests(actor,request_key,fingerprint,result) VALUES($1,$2,$3,$4)',[this.identity.subject,key,fingerprint,JSON.stringify(result)]);return result;
  });
 }
 private async pickup(c:Conn,id:string){const b=await this.booking(c,id);await this.authorize('RENTAL_CHECKOUT',[b.conditions.pickupStore]);const h=(await c.query<{conditions:HoldConditions}>('SELECT conditions FROM inventory_holds WHERE id=$1',[b.hold_id])).rows[0]!;return {...b,conditions:h.conditions};}
 private async assignment(c:Conn,id:string){const b=await this.pickup(c,id);const h=(await c.query('SELECT * FROM inventory_holds WHERE id=$1',[b.hold_id])).rows[0];
  const items=(await c.query(`SELECT DISTINCT cl.requirement_key,cl.asset_id,cl.pole_id,coalesce(a.variant_id,p.variant_id) AS variant_id,v.family,v.size,m.name,a.bsl_status,a.bsl_mm FROM inventory_claims cl LEFT JOIN ledger_assets a ON a.id=cl.asset_id LEFT JOIN ledger_poles p ON p.id=cl.pole_id JOIN ledger_variants v ON v.id=coalesce(a.variant_id,p.variant_id) JOIN ledger_models m ON m.id=v.model_id WHERE cl.hold_id=$1 AND cl.active ORDER BY cl.requirement_key`,[b.hold_id])).rows;
  return {bookingId:b.id,bookingVersion:b.version,holdVersion:h.version,conditions:b.conditions,pickupTiming:pickupTiming(b.conditions.period,await this.time(c)),noPickup:(await c.query('SELECT outcome,completed_at FROM rental_no_pickup_events WHERE booking_id=$1',[b.id])).rows[0]??null,items,preparation:(await c.query('SELECT * FROM rental_preparations WHERE id=$1',[b.id])).rows[0]??null,loans:(await c.query('SELECT * FROM rental_loan_items WHERE booking_id=$1 ORDER BY requirement_key',[b.id])).rows};
 }
 async checkoutView(id:string){await this.authorize('RENTAL_CHECKOUT');return this.assignment(this.pool,id);}
 async prepare(key:string,value:unknown){const v=flowObject(value,['bookingId','expectedBookingVersion','expectedHoldVersion','selections','fitEvidence']);flowId(v.bookingId);flowVersion(v.expectedBookingVersion);flowVersion(v.expectedHoldVersion);const evidence=note(v.fitEvidence);
  if(!Array.isArray(v.selections)||!v.selections.length||v.selections.length>60)throw new FlowError('INVALID_SELECTION',422);
  const selections=v.selections.map(x=>{const p=flowObject(x,['requirementKey','assetId','poleId']);if(typeof p.requirementKey!=='string'||p.requirementKey.length>100)throw new FlowError('INVALID_SELECTION',422);if(p.assetId!==null)flowId(p.assetId);if(p.poleId!==null)flowId(p.poleId);if((p.assetId===null)===(p.poleId===null))throw new FlowError('INVALID_SELECTION',422);return p;});
  return this.tx('RENTAL_CHECKOUT',[],key,{operation:'prepare',v},async c=>{await this.pickup(c,v.bookingId as string);},async(c,now)=>{
   const b=await this.pickup(c,v.bookingId as string),h=(await c.query('SELECT * FROM inventory_holds WHERE id=$1',[b.hold_id])).rows[0];
   if(b.version!==v.expectedBookingVersion||h.version!==v.expectedHoldVersion)throw new FlowError('STALE_VERSION');
   if(b.state!=='CONFIRMED_DEV'||h.state!=='ACTIVE'||h.payment_state!=='SUCCESS'||!h.confirmed_at||h.transfer_attention||h.allocation_stage!=='PROVISIONAL')throw new FlowError('PREPARATION_NOT_ALLOWED');
   await this.verifyClaims(c,h,now);const a=await this.assignment(c,b.id);
   const expected=a.items.map(i=>({requirementKey:i.requirement_key,assetId:i.asset_id,poleId:i.pole_id})).sort((a,b)=>a.requirementKey.localeCompare(b.requirementKey));
   if(flowHash([...selections].sort((a,b)=>String(a.requirementKey).localeCompare(String(b.requirementKey))))!==flowHash(expected))throw new FlowError('EXACT_FULL_PERIOD_ASSIGNMENT_REQUIRED');
   const wanted=b.conditions.members.flatMap(m=>m.items.filter(i=>!isWear(i.family)).map(i=>({key:m.key+':'+i.family,m,i})));
   if(wanted.length!==a.items.length)throw new FlowError('INCOMPLETE_EQUIPMENT_GROUP');
   const variants=(await c.query<PromiseVariant>(`SELECT v.*,m.catalog_season FROM ledger_variants v JOIN ledger_models m ON m.id=v.model_id WHERE v.id=ANY($1::uuid[])`,[a.items.map(i=>i.variant_id)])).rows;
   for(const i of a.items){const req=wanted.find(r=>r.key===i.requirement_key);if(!req||!variantMatches(req.m,req.i,variants.find(v=>v.id===i.variant_id)))throw new FlowError('PROMISE_MISMATCH');}
   await c.query('INSERT INTO rental_preparations(id,store_id,checked_in_at,checked_in_by,prepared_at,prepared_by,fit_evidence) VALUES($1,$2,$3,$4,$3,$4,$5)',[b.id,b.conditions.pickupStore,now,this.identity.subject,JSON.stringify({selections:expected,evidence,meaning:'HUMAN_RECORDED_SYNTHETIC_CHECK_NOT_AUTOMATIC_DIN_OR_SAFETY_CERTIFICATION'})]);
   await c.query("UPDATE inventory_holds SET allocation_stage='PREPARATION_FIXED',version=version+1 WHERE id=$1",[h.id]);return this.assignment(c,b.id);
  });
 }
 async checkout(key:string,value:unknown){const v=flowObject(value,['bookingId','expectedPreparationVersion']);flowId(v.bookingId);flowVersion(v.expectedPreparationVersion);
  return this.tx('RENTAL_CHECKOUT',[],key,{operation:'checkout',v},async c=>{await this.pickup(c,v.bookingId as string);},async(c,now)=>{
   const b=await this.pickup(c,v.bookingId as string),p=(await c.query('SELECT * FROM rental_preparations WHERE id=$1',[b.id])).rows[0];
   if(!p||p.version!==v.expectedPreparationVersion||!p.prepared_at)throw new FlowError('STALE_PREPARATION');
   if((await c.query('SELECT 1 FROM rental_loan_items WHERE booking_id=$1',[b.id])).rowCount)throw new FlowError('ALREADY_CHECKED_OUT');
   const h=(await c.query('SELECT * FROM inventory_holds WHERE id=$1',[b.hold_id])).rows[0];await this.verifyClaims(c,h,now);
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
 private async batchView(c:Conn,id:string){const b=await this.batch(c,id);return {...b,candidates:(await c.query(`SELECT c.*,l.booking_id,l.requirement_key,l.family FROM rental_return_candidates c LEFT JOIN rental_loan_items l ON l.id=c.loan_item_id WHERE c.batch_id=$1 ORDER BY c.scanned_at,c.id`,[id])).rows};}
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
 async returns(store:string){flowStore(store);await this.authorize('RENTAL_RETURN',[store]);return {batches:(await this.pool.query('SELECT * FROM rental_return_batches WHERE owner_id=$1 AND store_id=$2 ORDER BY created_at DESC LIMIT 100',[this.identity.subject,store])).rows,received:(await this.pool.query(`SELECT e.*,l.family,l.requirement_key,l.version,l.asset_id,l.pole_id,i.inspection_id FROM rental_custody_events e JOIN rental_loan_items l ON l.id=e.loan_item_id LEFT JOIN rental_inspection_events i ON i.loan_item_id=l.id WHERE e.actual_store=$1 ORDER BY e.applied_at DESC LIMIT 200`,[store])).rows};}
}
export type CustodyConditions=HoldConditions;

export async function receiveExchangeLoan(c:PoolClient,actor:string,store:string,loan:Loan,now:Date){
 const batch=randomUUID(),candidate=randomUUID(),receipt=randomUUID();
 await c.query('INSERT INTO rental_return_batches(id,owner_id,store_id,created_at) VALUES($1,$2,$3,$4)',[batch,actor,store,now]);
 await c.query("INSERT INTO rental_return_candidates(id,batch_id,request_key,scan_sha256,asset_id,pole_id,loan_item_id,cycle_id,loan_version,scanned_at,state,outcome) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'CANDIDATE','PINNED_LOAN_CYCLE')",[candidate,batch,randomUUID(),flowHash({loanId:loan.id,version:loan.version}),loan.asset_id,loan.pole_id,loan.id,loan.cycle_id,loan.version,now]);
 await c.query('INSERT INTO rental_receipts(id,loan_item_id,candidate_id,received_store,actor,scanned_at,confirmed_at,actual_received_at) VALUES($1,$2,$3,$4,$5,$6,$6,$6)',[receipt,loan.id,candidate,store,actor,now]);
 await c.query('SELECT public.rental_apply_receipt($1)',[receipt]);
}
