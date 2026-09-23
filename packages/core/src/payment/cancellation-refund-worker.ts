import type {Pool} from 'pg';
import {exactProductionIdentityConfiguration,type ExactProductionIdentity} from '../../../auth/src/production-identity';
import {verifyProductionDatabase} from '../../../db/src/production-connection';
import {flowId,FlowError} from '../../../contracts/src/rental-flow';
import type {RefundRequest} from '../operations/financial';
import type {CancellationRefundGateway} from './square-refund';
type Row={id:string;booking_id:string;idempotency_key:string;payment_provider_id:string;merchant_id:string;location_id:string;amount_jpy:number;currency:'JPY';mode:string;state:string;provider_id:string|null;dispatched_at:string|null};
/** Explicit operator entrypoint. A durable UNKNOWN reservation commits before a provider call.
 * No scheduler, retrying POST, default transport, or raw-configuration Production authority. */
export class CancellationRefundWorker{
 constructor(private pool:Pool,private gateway:CancellationRefundGateway,private identity?:ExactProductionIdentity){
  if(gateway.kind==='SQUARE_PRODUCTION'){const c=exactProductionIdentityConfiguration(identity);if(!c?.flags.payment||!c.flags.booking||!c.payment)throw new FlowError('PRODUCTION_REFUND_AUTHORITY_REQUIRED',503);}
  else if(process.env.NODE_ENV==='production'||gateway.kind!=='SIMULATED_DEV'||identity)throw new FlowError('REFUND_ADAPTER_NOT_ACTIVATED',503);
 }
 private async row(id:string){flowId(id);const c=this.identity&&exactProductionIdentityConfiguration(this.identity);if(c)await verifyProductionDatabase(this.pool,c,'operations');const r=(await this.pool.query('SELECT cancellation_refund_row($1) v',[id])).rows[0]?.v as Row|null;
  if(!r||r.mode!==this.gateway.kind||c&&(r.merchant_id!==c.payment?.merchantId||!Object.values(c.payment.locations).includes(r.location_id)))throw new FlowError('REFUND_TARGET_MISMATCH',503);return r;
 }
 private request(r:Row):RefundRequest{return {id:r.id,bookingId:r.booking_id,idempotencyKey:r.idempotency_key,paymentProviderId:r.payment_provider_id,merchantId:r.merchant_id,locationId:r.location_id,amountJpy:Number(r.amount_jpy),currency:r.currency};}
 async dispatch(id:string){await this.row(id);const row=(await this.pool.query('SELECT cancellation_refund_claim($1) v',[id])).rows[0]?.v as Row|null;if(!row)return {state:'NOT_CLAIMED'};
  try{const o=await this.gateway.create(this.request(row));await this.pool.query('SELECT cancellation_refund_observe($1,$2::jsonb)',[id,JSON.stringify(o)]);}catch{return {state:'UNKNOWN'};}return {state:(await this.row(id)).state};
 }
 async reconcile(id:string){const row=await this.row(id);if(!row.dispatched_at)throw new FlowError('REFUND_NOT_DISPATCHED',409);if(!row.provider_id)return {state:'UNKNOWN'};
  try{const o=await this.gateway.lookup(this.request(row),row.provider_id);if(o)await this.pool.query('SELECT cancellation_refund_observe($1,$2::jsonb)',[id,JSON.stringify(o)]);}catch{return {state:'UNKNOWN'};}return {state:(await this.row(id)).state};
 }
}
