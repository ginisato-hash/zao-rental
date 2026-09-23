import {randomUUID} from 'node:crypto';
import {flowId,flowObject,flowHash,FlowError,matchPayment,type PaymentGateway,type PaymentRequest,type PaymentObservation} from '../../../contracts/src/rental-flow';
import {money} from '../../../contracts/src/pricing';
import {OperationsContext,operationalReason,type OpsConnection} from './context';
export type RefundRequest={id:string;bookingId:string;idempotencyKey:string;paymentProviderId:string;merchantId:string;locationId:string;amountJpy:number;currency:'JPY'};
export type RefundObservation={id:string;paymentProviderId:string;merchantId:string;locationId:string;amountJpy:number;currency:'JPY';status:'PENDING'|'COMPLETED'|'REJECTED'|'FAILED';updatedAt:string};
export type RefundGateway={kind:'SIMULATED_DEV';create:(request:RefundRequest)=>Promise<RefundObservation>;lookup:(request:RefundRequest,providerId:string|null)=>Promise<RefundObservation|null>};
type FinancialRow={id:string;booking_id:string;idempotency_key?:string;request_key?:string;merchant_id:string;location_id:string;payment_provider_id?:string;amount_jpy:string;currency:'JPY';state:string;dispatched_at:Date|null;provider_id:string|null;provider_state:string|null;provider_updated_at:Date|null;acting_store?:string};
type Kind='charge'|'refund';
const table=(kind:Kind)=>kind==='charge'?'ops_charge_requests':'ops_refund_requests';
const view=(r:FinancialRow)=>({id:r.id,bookingId:r.booking_id,amountJpy:Number(r.amount_jpy),currency:r.currency,state:r.state,transmitted:r.dispatched_at!==null,providerState:r.provider_state,chargeReady:false});
const category=(v:unknown)=>{if(typeof v!=='string'||!['CUSTOMER_EXCEPTION','SERVICE_ISSUE','DUPLICATE_COLLECTION','OTHER_APPROVED'].includes(v))throw new FlowError('INVALID_REASON_CATEGORY',422);return v;};
// Normal runtime constructs this without gateways. HTTP exposes quote/request/read,
// never these trusted adapter methods or browser-supplied provider observations.
export class FinancialOperations{
 constructor(private ctx:OperationsContext,private payments:PaymentGateway|null=null,private refunds:RefundGateway|null=null){if((payments||refunds)&&(process.env.NODE_ENV==='production'||payments&&payments.kind!=='SIMULATED_DEV'))throw new FlowError('PROVIDER_NOT_CONNECTED',503);}
 private async booking(c:OpsConnection,id:string,store?:string){
  flowId(id);const b=(await c.query<{id:string;conditions:{pickupStore:string;returnStore:string};state:string}>('SELECT id,conditions,state FROM rental_bookings WHERE id=$1',[id])).rows[0];if(!b)throw new FlowError('BOOKING_NOT_FOUND',404);
  if(store){await this.ctx.authorize('BOOKING_VIEW',[store]);if(![b.conditions.pickupStore,b.conditions.returnStore].includes(store)&&!(await c.query('SELECT 1 FROM rental_receipts r JOIN rental_loan_items l ON l.id=r.loan_item_id WHERE l.booking_id=$1 AND r.received_store=$2 LIMIT 1',[id,store])).rowCount)throw new FlowError('FORBIDDEN',403);}
  else await this.ctx.authorize('BOOKING_VIEW',[b.conditions.pickupStore,b.conditions.returnStore]);return b;
 }
 async summary(bookingId:string,actingStore:string){
  await this.ctx.authorize('BOOKING_VIEW',[actingStore]);await this.booking(this.ctx.pool,bookingId,actingStore);
  const payments=(await this.ctx.pool.query(`SELECT p.id,p.kind,p.amount_jpy::int AS collected_jpy,coalesce(sum(r.amount_jpy) FILTER(WHERE r.state='COMPLETED'),0)::int AS refunded_jpy,coalesce(sum(r.amount_jpy) FILTER(WHERE r.state IN ('PENDING','UNKNOWN','REVIEW')),0)::int AS reserved_jpy FROM ops_collected_payments p LEFT JOIN (SELECT payment_id,payment_kind,amount_jpy,state FROM ops_refund_requests UNION ALL SELECT payment_id,payment_kind,amount_jpy,state FROM booking_cancellation_refunds) r ON r.payment_id=p.id AND r.payment_kind=p.kind WHERE p.booking_id=$1 GROUP BY p.id,p.kind,p.amount_jpy ORDER BY p.id`,[bookingId])).rows;
  return {payments:payments.map(p=>({...p,remainingJpy:p.collected_jpy-p.refunded_jpy-p.reserved_jpy})),charges:(await this.ctx.pool.query<FinancialRow>('SELECT * FROM ops_charge_requests WHERE booking_id=$1 ORDER BY created_at,id',[bookingId])).rows.map(view),refunds:(await this.ctx.pool.query<FinancialRow>('SELECT * FROM ops_refund_requests WHERE booking_id=$1 ORDER BY created_at,id',[bookingId])).rows.map(view),alerts:(await this.ctx.pool.query('SELECT code,created_at FROM ops_financial_alerts WHERE booking_id=$1 ORDER BY created_at,id',[bookingId])).rows,automaticRefund:false,providerConnected:false};
 }
 async requestRefund(key:string,value:unknown){
  flowId(key);const v=flowObject(value,['bookingId','paymentId','actingStore','category','reason','amountJpy']);flowId(v.bookingId);flowId(v.paymentId);money(v.amountJpy);if(v.amountJpy===0)throw new FlowError('REFUND_AMOUNT_REQUIRED',422);
  if(v.actingStore!=='MOUNTAIN_BASE'&&v.actingStore!=='ONSEN_BASE')throw new FlowError('INVALID_STORE',422);const store=v.actingStore,note=operationalReason(v.reason),reasonCategory=category(v.category),fingerprint=flowHash(v);
  await this.ctx.authorize('REFUND_OVERRIDE',[store]);await this.booking(this.ctx.pool,v.bookingId,store);
  return this.ctx.transaction('REFUND_OVERRIDE',[store],note,async(c)=>{
   await this.booking(c,v.bookingId as string,store);await c.query('SELECT ops_assert_actor($1,$2::text[],$3)',['BOOKING_VIEW',[store],this.ctx.identity.subject]);
   const old=(await c.query<FinancialRow&{fingerprint:string}>('SELECT * FROM ops_refund_requests WHERE booking_id=$1 AND request_key=$2',[v.bookingId,key])).rows[0];
   if(old){if(old.fingerprint!==fingerprint)throw new FlowError('IDEMPOTENCY_MISMATCH',409);return {...view(old),replayed:true};}
   if((await c.query("SELECT 1 FROM ops_refund_requests WHERE booking_id=$1 AND state IN ('PENDING','UNKNOWN','REVIEW') UNION ALL SELECT 1 FROM ops_financial_alerts WHERE booking_id=$1 UNION ALL SELECT 1 FROM booking_cancellation_refunds WHERE booking_id=$1 AND state IN ('PENDING','UNKNOWN','REVIEW') LIMIT 1",[v.bookingId])).rowCount)throw new FlowError('REFUND_RECONCILIATION_REQUIRED',409);
   const p=(await c.query<{id:string;kind:'ORIGINAL'|'ADDITIONAL';provider_id:string|null;merchant_id:string;location_id:string;amount_jpy:string;currency:'JPY'}>('SELECT * FROM ops_collected_payments WHERE id=$1 AND booking_id=$2',[v.paymentId,v.bookingId])).rows[0];if(!p?.provider_id)throw new FlowError('COMPLETED_PAYMENT_REQUIRED',409);
   const reserved=Number((await c.query("SELECT coalesce(sum(amount_jpy),0) AS n FROM ops_refund_requests WHERE payment_id=$1 AND payment_kind=$2 AND state<>'FAILED'",[p.id,p.kind])).rows[0].n);
   const automatic=Number((await c.query("SELECT coalesce(sum(amount_jpy),0) n FROM booking_cancellation_refunds WHERE payment_id=$1 AND payment_kind=$2 AND state<>'FAILED'",[p.id,p.kind])).rows[0].n);
   if(reserved+automatic+Number(v.amountJpy)>Number(p.amount_jpy))throw new FlowError('REFUND_CAP_EXCEEDED',409);
   const id=randomUUID();await c.query(`INSERT INTO ops_refund_requests(id,booking_id,payment_id,payment_kind,actor,acting_store,request_key,fingerprint,reason_category,reason,payment_provider_id,merchant_id,location_id,amount_jpy,currency,collected_jpy,previous_reserved_jpy,policy_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'JPY',$15,$16,'STAFF_EXCEPTION_V04')`,[id,v.bookingId,p.id,p.kind,this.ctx.identity.subject,store,key,fingerprint,reasonCategory,note,p.provider_id,p.merchant_id,p.location_id,v.amountJpy,p.amount_jpy,reserved]);
   return {...view((await c.query<FinancialRow>('SELECT * FROM ops_refund_requests WHERE id=$1',[id])).rows[0]!),replayed:false};
  });
 }
 private paymentRequest(r:FinancialRow):PaymentRequest{return {attemptId:r.id,bookingId:r.booking_id,idempotencyKey:r.idempotency_key!,merchantId:r.merchant_id,locationId:r.location_id,amountJpy:Number(r.amount_jpy),currency:r.currency};}
 private refundRequest(r:FinancialRow):RefundRequest{return {id:r.id,bookingId:r.booking_id,idempotencyKey:r.request_key!,paymentProviderId:r.payment_provider_id!,merchantId:r.merchant_id,locationId:r.location_id,amountJpy:Number(r.amount_jpy),currency:r.currency};}
 private async row(c:OpsConnection,kind:Kind,id:string){flowId(id);const r=(await c.query<FinancialRow>(`SELECT * FROM ${table(kind)} WHERE id=$1`,[id])).rows[0];if(!r)throw new FlowError('FINANCIAL_REQUEST_NOT_FOUND',404);const b=await this.booking(c,r.booking_id,r.acting_store);await this.ctx.authorize(kind==='refund'?'REFUND_OVERRIDE':'RENTAL_AMEND',r.acting_store?[r.acting_store]:[b.conditions.pickupStore,b.conditions.returnStore]);return r;}
 private async tx<T>(kind:Kind,id:string,work:(c:import('pg').PoolClient,r:FinancialRow,now:Date)=>Promise<T>){
  const old=await this.row(this.ctx.pool,kind,id),b=await this.booking(this.ctx.pool,old.booking_id,old.acting_store);
  return this.ctx.transaction(kind==='refund'?'REFUND_OVERRIDE':'RENTAL_AMEND',old.acting_store?[old.acting_store]:[b.conditions.pickupStore,b.conditions.returnStore],'FINANCIAL_ADAPTER_RECONCILIATION',async(c,now)=>work(c,await this.row(c,kind,id),now));
 }
 private requirePort(kind:Kind){if(process.env.NODE_ENV==='production'||!(kind==='charge'?this.payments:this.refunds))throw new FlowError('PROVIDER_NOT_CONNECTED',503);}
 async dispatch(kind:Kind,id:string){
  this.requirePort(kind);const reserved=await this.tx(kind,id,async(c,r,now)=>{
   if(kind==='charge'&&(await this.booking(c,r.booking_id)).state==='CANCELLED')throw new FlowError('BOOKING_CANCELLED',409);
   if(r.state!=='PENDING'||r.dispatched_at!==null)return {row:r,dispatch:false};
   const row=(await c.query<FinancialRow>(`UPDATE ${table(kind)} SET state='UNKNOWN',dispatched_at=$2,updated_at=$2 WHERE id=$1 RETURNING *`,[id,now])).rows[0]!;return {row,dispatch:true};
  });
  // Durable UNKNOWN is committed before the one create call. A crash or timeout
  // cannot dispatch this logical request again, even with a fresh service instance.
  if(!reserved.dispatch)return view(reserved.row);
  let observation:PaymentObservation|RefundObservation;
  try{observation=kind==='charge'?await this.payments!.create(this.paymentRequest(reserved.row)):await this.refunds!.create(this.refundRequest(reserved.row));}catch{return view(reserved.row);}
  return this.observe(kind,id,observation);
 }
 async reconcile(kind:Kind,id:string){
  this.requirePort(kind);const r=await this.row(this.ctx.pool,kind,id);if(r.dispatched_at===null)throw new FlowError('REQUEST_NOT_DISPATCHED',409);
  let observation:PaymentObservation|RefundObservation|null;try{observation=kind==='charge'?await this.payments!.lookup(this.paymentRequest(r),r.provider_id):await this.refunds!.lookup(this.refundRequest(r),r.provider_id);}catch{throw new FlowError('PROVIDER_LOOKUP_UNAVAILABLE',503);}
  return observation?this.observe(kind,id,observation):view(r);
 }
 private async observe(kind:Kind,id:string,observation:PaymentObservation|RefundObservation){return this.tx(kind,id,async(c,r,now)=>{
  if(r.dispatched_at===null)throw new FlowError('REQUEST_NOT_DISPATCHED',409);let valid=true,providerId:string,providerState:string,at:string,completedAt:string|null;
  if(kind==='charge'){
   const o=observation as PaymentObservation;providerId=o.providerId;providerState=o.status;at=o.updatedAt;completedAt=o.completedAt;
   try{matchPayment(this.paymentRequest(r),o);}catch{valid=false;}
  }else{
   const o=observation as RefundObservation;providerId=o.id;providerState=o.status;at=o.updatedAt;completedAt=o.status==='COMPLETED'?o.updatedAt:null;
   valid=typeof o.id==='string'&&o.id.length>0&&o.id.length<=192&&o.paymentProviderId===r.payment_provider_id&&o.merchantId===r.merchant_id&&o.locationId===r.location_id&&o.amountJpy===Number(r.amount_jpy)&&o.currency===r.currency&&['PENDING','COMPLETED','REJECTED','FAILED'].includes(o.status);
  }
  valid=valid&&Number.isFinite(Date.parse(at))&&Date.parse(at)<=now.getTime()&&(!completedAt||Number.isFinite(Date.parse(completedAt))&&Date.parse(completedAt)<=now.getTime())&&(!r.provider_id||r.provider_id===providerId);
  if(r.state==='COMPLETED'||r.state==='FAILED'||r.state==='REVIEW'){if(r.state!=='REVIEW'&&(!valid||r.state==='COMPLETED'&&providerState!=='COMPLETED'||r.state==='FAILED'&&!['FAILED','REJECTED','CANCELED'].includes(providerState))){await c.query("INSERT INTO ops_financial_alerts(id,booking_id,kind,request_id,observation_sha256,code,actor) VALUES($1,$2,$3,$4,$5,'CONTRADICTORY_PROVIDER_EVIDENCE',$6) ON CONFLICT DO NOTHING",[randomUUID(),r.booking_id,kind,r.id,flowHash({valid,providerState,at}),this.ctx.identity.subject]);}return view(r);}
  if(valid&&r.provider_updated_at&&Date.parse(at)<r.provider_updated_at.getTime())return view(r);
  if(!valid){await c.query(`UPDATE ${table(kind)} SET state='REVIEW',updated_at=$2 WHERE id=$1`,[id,now]);}
  else{const state=providerState==='COMPLETED'?'COMPLETED':providerState==='PENDING'?'PENDING':'FAILED';await c.query(`UPDATE ${table(kind)} SET state=$2,provider_id=$3,provider_state=$4,provider_updated_at=$5,completed_at=$6,updated_at=$7 WHERE id=$1`,[id,state,providerId,providerState,at,completedAt,now]);}
  if(kind==='charge')await c.query('SELECT booking_cancellation_payment_observed($1)',[r.booking_id]);
  return view((await c.query<FinancialRow>(`SELECT * FROM ${table(kind)} WHERE id=$1`,[id])).rows[0]!);
 });}
}
