import {physicalPickupWindow} from '../../../contracts/src/pickup';
import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {amendmentConditions,amendmentPrice} from '../../../contracts/src/amendment';
import {canonical,isWear,normalizePeriod,type HoldConditions} from '../../../contracts/src/hold';
import {FlowError,flowHash,flowId,flowObject,flowVersion} from '../../../contracts/src/rental-flow';
import type {PriceTable} from '../../../contracts/src/pricing';
import {planAllocation,writeAllocationClaims} from '../inventory/allocation';
import {wearCapacity,writeWearClaims} from '../inventory/wear-capacity';
import {receiveExchangeLoan} from '../rental/custody-service';
import {receiveWearInTransaction} from '../wear/service';
import {OperationsContext,operationalReason,type OpsConnection} from './context';
type Contract={id:string;hold_id:string;state:string;price_snapshot:Record<string,unknown>;price_sha256:string;conditions:HoldConditions;version:number;allocation_stage:string;transfer_attention:string|null;payment_state:string;hold_state:string};
type Loan={id:string;cycle_id:string;booking_id:string;requirement_key:string;asset_id:string|null;pole_id:string|null;pole_slot:number|null;variant_id:string;family:string;state:string;version:number};
type WearLoan={id:string;requirement_key:string;pool_id:string;variant_id:string;quantity:number;returned:number;revision:number};
type Equipment={key:string;asset:string|null;pole:string|null;poleSlot:number|null;variantId:string;family:string};
type Assignment={equipment:Equipment[];wear:{key:string;pool:string;variantId:string}[]};
type SavedQuote={id:string;booking_id:string;actor:string;expected_hold_version:number;before_conditions:HoldConditions;conditions:HoldConditions;quote:ReturnType<typeof amendmentPrice>;quote_sha256:string;loan_versions:unknown;assignment:Assignment;expires_at:Date};
// The existing allocator/receipt/custody functions remain the inventory authority.
// Preview is advisory; acceptance revalidates under the same inventory transaction.
export class AmendmentService{
 constructor(private ctx:OperationsContext){}
 private async source(c:OpsConnection,id:string){
  flowId(id);const b=(await c.query<Contract>(`SELECT b.id,b.hold_id,b.state,b.price_snapshot,b.price_sha256,h.conditions,h.version,h.allocation_stage,h.transfer_attention,h.payment_state,h.state AS hold_state FROM rental_bookings b JOIN inventory_holds h ON h.id=b.hold_id WHERE b.id=$1`,[id])).rows[0];
  if(!b)throw new FlowError('BOOKING_NOT_FOUND',404);await this.ctx.authorize('BOOKING_VIEW',[b.conditions.pickupStore,b.conditions.returnStore]);
  if(b.state!=='CONFIRMED_DEV'||b.hold_state!=='ACTIVE'||b.payment_state!=='SUCCESS'||b.transfer_attention)throw new FlowError('AMENDMENT_NOT_ALLOWED',409);
  if(flowHash(b.price_snapshot)!==b.price_sha256)throw new FlowError('SNAPSHOT_INTEGRITY_ERROR',409);return b;
 }
 private async loans(c:OpsConnection,id:string){
  return {equipment:(await c.query<Loan>("SELECT id,cycle_id,booking_id,requirement_key,asset_id,pole_id,pole_slot,variant_id,family,state,version FROM rental_loan_items WHERE booking_id=$1 ORDER BY id",[id])).rows,wear:(await c.query<WearLoan>('SELECT id,requirement_key,pool_id,variant_id,quantity,returned,revision FROM wear_loans WHERE booking_id=$1 ORDER BY id',[id])).rows};
 }
 async options(){await this.ctx.authorize('RENTAL_AMEND');return (await this.ctx.pool.query<{id:string;family:string;age:string;tier:string;model_id:string;catalog_season:string|null;size:string;name:string}>(`SELECT v.id,v.family,v.age,v.tier,v.model_id,m.catalog_season,v.size,m.name FROM ledger_variants v JOIN ledger_models m ON m.id=v.model_id ORDER BY v.family,v.size,v.id LIMIT 3000`)).rows;}
 async view(id:string){await this.ctx.authorize('RENTAL_AMEND');const b=await this.source(this.ctx.pool,id);return {bookingId:id,conditions:b.conditions,holdVersion:b.version,originalPrice:b.price_snapshot,loans:await this.loans(this.ctx.pool,id),amendments:(await this.ctx.pool.query('SELECT q.id,q.quote,q.created_at,a.applied_at FROM ops_amendment_quotes q LEFT JOIN ops_amendments a ON a.id=q.id WHERE q.booking_id=$1 ORDER BY q.created_at DESC LIMIT 50',[id])).rows,providerConnected:false};}
 private async plan(c:PoolClient,b:Contract,next:HoldConditions,now:Date){
  const loans=await this.loans(c,b.id),pins=new Map<string,string>();
  // Partially returned groups are handled by return/inspection, not silently re-lent.
  if(loans.equipment.some(l=>l.state!=='OUT'&&!loans.equipment.some(n=>n.requirement_key===l.requirement_key&&n.state==='OUT'))||loans.wear.some(l=>l.returned>0&&!loans.wear.some(n=>n.requirement_key===l.requirement_key&&n.returned===0)))throw new FlowError('PARTIAL_RETURN_REQUIRES_REVIEW',409);
  for(const l of loans.equipment.filter(l=>l.state==='OUT')){
   const old=b.conditions.members.flatMap(m=>m.items.map(i=>({key:m.key+':'+i.family,i}))).find(i=>i.key===l.requirement_key);
   const wanted=next.members.flatMap(m=>m.items.map(i=>({key:m.key+':'+i.family,i}))).find(i=>i.key===l.requirement_key);
   if(old&&wanted&&canonical(old.i)===canonical(wanted.i))pins.set(l.requirement_key,(l.asset_id??l.pole_id)!);
  }
  const plan=await planAllocation(c,next,now,b.hold_id,pins);if(plan.result!=='FEASIBLE')throw new FlowError(plan.result,409);
  const equipment:Equipment[]=[];
  for(const w of plan.witness.filter(w=>w.holdId==='candidate')){const u=(await c.query<{variant_id:string;family:string}>('SELECT variant_id,family FROM ledger_assets WHERE id=$1 UNION ALL SELECT variant_id,family FROM ledger_poles WHERE id=$1',[w.asset??w.pole])).rows[0]!;equipment.push({key:w.key,asset:w.asset,pole:w.pole,poleSlot:Object.values(w.slots)[0]??null,variantId:u.variant_id,family:u.family});}
  const wear=await wearCapacity(c,next,now,b.hold_id);if(!wear.feasible)throw new FlowError('WEAR_CAPACITY_CHANGED',409);
  const assignment:Assignment={equipment:equipment.sort((a,b)=>a.key.localeCompare(b.key)),wear:next.members.flatMap(m=>m.items.filter(i=>isWear(i.family)).map(i=>({key:m.key+':'+i.family,pool:wear.rows.find(r=>r.key===m.key+':'+i.family)!.pool,variantId:i.variantIds[0]!}))).sort((a,b)=>a.key.localeCompare(b.key))};
  return {plan,assignment,loans};
 }
 async quote(key:string,value:unknown){
  flowId(key);const v=flowObject(value,['bookingId','expectedHoldVersion','conditions','reason']);flowId(v.bookingId);flowVersion(v.expectedHoldVersion);const reason=operationalReason(v.reason);
  await this.ctx.authorize('RENTAL_AMEND');const before=await this.source(this.ctx.pool,v.bookingId);
  return this.ctx.transaction('RENTAL_AMEND',[before.conditions.pickupStore,before.conditions.returnStore],reason,(c,now)=>this.ctx.idempotent(c,key,{op:'amendmentQuote',v},async()=>{
   const b=await this.source(c,v.bookingId as string);if(b.version!==v.expectedHoldVersion)throw new FlowError('STALE_VERSION',409);const conditions=amendmentConditions(b.conditions,v.conditions,now),{assignment,loans}=await this.plan(c,b,conditions,now);
   const book=(await c.query<{table_jpy:PriceTable;rental_from:string;rental_until:string}>('SELECT table_jpy,rental_from::text,rental_until::text FROM price_books WHERE id=$1',[b.price_snapshot.priceBookId])).rows[0];
   if(!book||conditions.period.startDate<book.rental_from||conditions.period.endDate>book.rental_until)throw new FlowError('ORIGINAL_PRICE_BOOK_UNAVAILABLE',409);
   const payment=(await c.query<{completed_at:Date}>('SELECT completed_at FROM rental_payment_attempts WHERE booking_id=$1 AND state=\'COMPLETED\'',[b.id])).rows[0];if(!payment)throw new FlowError('COMPLETED_PAYMENT_REQUIRED',409);
   const last=(await c.query<{quote:{target:{totalJpy:number}}}>('SELECT q.quote FROM ops_amendments a JOIN ops_amendment_quotes q ON q.id=a.id WHERE a.booking_id=$1 ORDER BY a.applied_at DESC,a.id DESC LIMIT 1',[b.id])).rows[0];
   const committed=Number((await c.query("SELECT coalesce(sum(amount_jpy),0) AS n FROM ops_charge_requests WHERE booking_id=$1 AND state<>'FAILED'",[b.id])).rows[0].n);
   const quote=amendmentPrice({original:b.price_snapshot,conditions,table:book.table_jpy,originalPaidAt:payment.completed_at,previousTotalJpy:last?.quote.target.totalJpy??Number(b.price_snapshot.totalJpy),committedAdditionalJpy:committed});
   const id=randomUUID(),expiresAt=new Date(Math.min(now.getTime()+300000,Date.parse(normalizePeriod(conditions.period).dueAt)));
   await c.query('INSERT INTO ops_amendment_quotes(id,booking_id,actor,request_key,fingerprint,expected_hold_version,before_conditions,conditions,quote,quote_sha256,loan_versions,assignment,reason,created_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)',[id,b.id,this.ctx.identity.subject,key,flowHash(v),b.version,JSON.stringify(b.conditions),JSON.stringify(conditions),JSON.stringify(quote),flowHash(quote),JSON.stringify(loans),JSON.stringify(assignment),reason,now,expiresAt]);
   return {id,bookingId:b.id,expectedHoldVersion:b.version,conditions,quote,assignment,expiresAt:expiresAt.toISOString(),advisory:true};
  }));
 }
 async accept(key:string,value:unknown){
  flowId(key);const v=flowObject(value,['quoteId','fitEvidence','reason']);flowId(v.quoteId);const reason=operationalReason(v.reason);if(typeof v.fitEvidence!=='string'||v.fitEvidence.length>160)throw new FlowError('INVALID_FIT_EVIDENCE',422);
  await this.ctx.authorize('RENTAL_AMEND');const old=(await this.ctx.pool.query<SavedQuote>('SELECT * FROM ops_amendment_quotes WHERE id=$1',[v.quoteId])).rows[0];if(!old||old.actor!==this.ctx.identity.subject)throw new FlowError('FORBIDDEN',403);
  const source=await this.source(this.ctx.pool,old.booking_id);
  return this.ctx.transaction('RENTAL_AMEND',[source.conditions.pickupStore,source.conditions.returnStore],reason,(c,now)=>this.ctx.idempotent(c,key,{op:'acceptAmendment',v},async()=>{
   const q=(await c.query<SavedQuote>('SELECT * FROM ops_amendment_quotes WHERE id=$1',[v.quoteId])).rows[0]!,b=await this.source(c,q.booking_id);
   if(q.expires_at<=now||q.expected_hold_version!==b.version||flowHash(q.quote)!==q.quote_sha256||canonical(q.before_conditions)!==canonical(b.conditions))throw new FlowError('AMENDMENT_QUOTE_STALE',409);
   amendmentConditions(b.conditions,q.conditions,now);const {plan,assignment,loans}=await this.plan(c,b,q.conditions,now);
   if(canonical(loans)!==canonical(q.loan_versions)||canonical(assignment)!==canonical(q.assignment))throw new FlowError('AMENDMENT_ASSIGNMENT_CHANGED',409);
   const changedEquipment=loans.equipment.filter(l=>l.state==='OUT'&&!assignment.equipment.some(i=>i.key===l.requirement_key&&i.asset===l.asset_id&&i.pole===l.pole_id));
   const changedWear=loans.wear.filter(l=>l.returned<l.quantity&&!assignment.wear.some(i=>i.key===l.requirement_key&&i.pool===l.pool_id));
   const physical=changedEquipment.length+changedWear.length>0;
   if(physical&&!physicalPickupWindow(q.conditions.period,now))throw new FlowError('EXCHANGE_PICKUP_WINDOW_CLOSED',409);
   const preparedChange=b.allocation_stage==='PREPARATION_FIXED'&&canonical(b.conditions.members)!==canonical(q.conditions.members);
   if(physical||preparedChange){if(!(v.fitEvidence as string).trim())throw new FlowError('EXCHANGE_FIT_EVIDENCE_REQUIRED',422);for(const perm of ['RENTAL_RETURN','RENTAL_CHECKOUT'] as const)await c.query('SELECT ops_assert_actor($1,$2::text[],$3)',[perm,[b.conditions.pickupStore],this.ctx.identity.subject]);}
   await c.query('INSERT INTO ops_amendments(id,booking_id,actor,request_key,fingerprint,fit_evidence,applied_at) VALUES($1,$2,$3,$4,$5,$6,$7)',[q.id,b.id,this.ctx.identity.subject,key,flowHash(v),v.fitEvidence,now]);
   // Factual receipt precedes replacement. Any later failure rolls the entire transaction back.
   for(const l of changedEquipment)await receiveExchangeLoan(c,this.ctx.identity.subject,b.conditions.pickupStore,l,now);
   for(const l of changedWear)await receiveWearInTransaction(c,this.ctx.identity.subject,now,{loanId:l.id,expectedRevision:l.revision,unresolvedId:null},b.conditions.pickupStore,l.quantity-l.returned);
   const period=normalizePeriod(q.conditions.period);
   await c.query('UPDATE inventory_holds SET conditions=$2,starts_at=$3,due_at=$4,occupancy_start=$5,occupancy_end=$6,version=version+1 WHERE id=$1',[b.hold_id,JSON.stringify(q.conditions),period.startsAt,period.dueAt,q.conditions.period.startDate,q.conditions.period.endDate]);
   const ids=[b.hold_id,...plan.replanned],prior=(await c.query('SELECT hold_id,requirement_key,asset_id,pole_id,pole_slot,day FROM inventory_claims WHERE hold_id=ANY($1::uuid[]) AND active ORDER BY id',[ids])).rows;
   await c.query('UPDATE inventory_claims SET active=false WHERE hold_id=ANY($1::uuid[]) AND active',[ids]);
   for(const id of plan.replanned){const h=(await c.query<{conditions:HoldConditions}>('SELECT conditions FROM inventory_holds WHERE id=$1',[id])).rows[0]!;await writeAllocationClaims(c,id,h.conditions,plan.witness.filter(w=>w.holdId===id));}
   await writeAllocationClaims(c,b.hold_id,q.conditions,plan.witness.filter(w=>w.holdId==='candidate'));await writeWearClaims(c,b.hold_id,q.conditions,now);
   if(loans.equipment.some(l=>l.state==='OUT'))await c.query('SELECT ops_checkout_amendment($1)',[q.id]);
   if(loans.wear.some(l=>l.returned<l.quantity))for(const i of assignment.wear){if(loans.wear.some(l=>l.returned<l.quantity&&l.requirement_key===i.key&&l.pool_id===i.pool))continue;
    const p=(await c.query<{ready:number}>('SELECT ready FROM wear_pools WHERE id=$1',[i.pool])).rows[0]!;if(p.ready<1)throw new FlowError('WEAR_NOT_READY',409);
    await c.query('INSERT INTO wear_loans(id,cycle_id,booking_id,member_key,requirement_key,pool_id,variant_id,quantity,planned_pickup_store,actual_pickup_store,planned_return_store,checked_out_at,actor,amendment_id) VALUES($1,$2,$2,$3,$4,$5,$6,1,$7,$7,$8,$9,$10,$11)',[randomUUID(),b.id,i.key.split(':')[0],i.key,i.pool,i.variantId,q.conditions.pickupStore,q.conditions.returnStore,now,this.ctx.identity.subject,q.id]);
    await c.query('UPDATE wear_pools SET ready=ready-1,on_loan=on_loan+1 WHERE id=$1',[i.pool]);
   }
   const after=(await c.query('SELECT hold_id,requirement_key,asset_id,pole_id,pole_slot,day FROM inventory_claims WHERE hold_id=ANY($1::uuid[]) AND active ORDER BY id',[ids])).rows;
   await c.query('SELECT inventory_record_replan($1::jsonb,$2::jsonb)',[JSON.stringify(prior),JSON.stringify(after)]);
   let chargeId:string|null=null;if(q.quote.additionalChargeJpy>0){chargeId=randomUUID();const p=(await c.query('SELECT merchant_id,location_id FROM rental_payment_attempts WHERE booking_id=$1 AND state=\'COMPLETED\'',[b.id])).rows[0]!;
    await c.query("INSERT INTO ops_charge_requests(id,booking_id,amendment_id,actor,idempotency_key,merchant_id,location_id,amount_jpy,currency) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'JPY')",[chargeId,b.id,q.id,this.ctx.identity.subject,randomUUID(),p.merchant_id,p.location_id,q.quote.additionalChargeJpy]);}
   return {id:q.id,bookingId:b.id,holdVersion:b.version+1,chargeId,additionalChargeJpy:q.quote.additionalChargeJpy,automaticRefundJpy:0,providerConnected:false};
  }));
 }
}
