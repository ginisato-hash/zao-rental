import type {Pool} from 'pg';
import {exactProductionIdentityConfiguration,type ExactProductionIdentity} from '../../../auth/src/production-identity';
import {verifyProductionDatabase} from '../../../db/src/production-connection';
import {flowId,FlowError} from '../../../contracts/src/rental-flow';
import type {RefundRequest} from '../operations/financial';
import type {CancellationRefundGateway} from './square-refund';
type Row={id:string;booking_id:string;idempotency_key:string;payment_provider_id:string;merchant_id:string;location_id:string;amount_jpy:number;currency:'JPY';mode:string;state:string;provider_id:string|null;dispatched_at:string|null};
/** A durable UNKNOWN reservation commits before the single provider call; UNKNOWN is never re-POSTed.
 * Lanes: CANCELLATION (booking_cancellation_refunds, 0045) and STAFF (ops_refund_requests, 0056) — same claim/observe contract.
 * No retrying POST, default transport, or raw-configuration Production authority. */
export type RefundLane='CANCELLATION'|'STAFF';
const LANE_FUNCTIONS:Record<RefundLane,{row:string;claim:string;observe:string}>={
 CANCELLATION:{row:'cancellation_refund_row',claim:'cancellation_refund_claim',observe:'cancellation_refund_observe'},
 STAFF:{row:'ops_refund_row',claim:'ops_refund_claim',observe:'ops_refund_observe'},
};
export class CancellationRefundWorker{
 constructor(private pool:Pool,private gateway:CancellationRefundGateway,private identity?:ExactProductionIdentity){
  if(gateway.kind==='SQUARE_PRODUCTION'){const c=exactProductionIdentityConfiguration(identity);if(!c?.flags.payment||!c.flags.booking||!c.payment)throw new FlowError('PRODUCTION_REFUND_AUTHORITY_REQUIRED',503);}
  else if(process.env.NODE_ENV==='production'||gateway.kind!=='SIMULATED_DEV'||identity)throw new FlowError('REFUND_ADAPTER_NOT_ACTIVATED',503);
 }
 private async row(id:string,lane:RefundLane='CANCELLATION'){flowId(id);const f=LANE_FUNCTIONS[lane];const c=this.identity&&exactProductionIdentityConfiguration(this.identity);if(c)await verifyProductionDatabase(this.pool,c,'operations');const r=(await this.pool.query(`SELECT ${f.row}($1) v`,[id])).rows[0]?.v as Row|null;
  if(!r||r.mode!==this.gateway.kind||c&&(r.merchant_id!==c.payment?.merchantId||!Object.values(c.payment.locations).includes(r.location_id)))throw new FlowError('REFUND_TARGET_MISMATCH',503);return r;
 }
 private request(r:Row):RefundRequest{return {id:r.id,bookingId:r.booking_id,idempotencyKey:r.idempotency_key,paymentProviderId:r.payment_provider_id,merchantId:r.merchant_id,locationId:r.location_id,amountJpy:Number(r.amount_jpy),currency:r.currency};}
 async dispatch(id:string,lane:RefundLane='CANCELLATION'){const f=LANE_FUNCTIONS[lane];await this.row(id,lane);const row=(await this.pool.query(`SELECT ${f.claim}($1) v`,[id])).rows[0]?.v as Row|null;if(!row)return {state:'NOT_CLAIMED'};
  try{const o=await this.gateway.create(this.request(row));await this.pool.query(`SELECT ${f.observe}($1,$2::jsonb)`,[id,JSON.stringify(o)]);}catch{return {state:'UNKNOWN'};}return {state:(await this.row(id,lane)).state};
 }
 async reconcile(id:string,lane:RefundLane='CANCELLATION'){const f=LANE_FUNCTIONS[lane];const row=await this.row(id,lane);if(!row.dispatched_at)throw new FlowError('REFUND_NOT_DISPATCHED',409);if(!row.provider_id)return {state:'UNKNOWN'};
  try{const o=await this.gateway.lookup(this.request(row),row.provider_id);if(o)await this.pool.query(`SELECT ${f.observe}($1,$2::jsonb)`,[id,JSON.stringify(o)]);}catch{return {state:'UNKNOWN'};}return {state:(await this.row(id,lane)).state};
 }
}
