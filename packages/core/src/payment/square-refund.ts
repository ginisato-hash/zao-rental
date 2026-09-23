import {FlowError} from '../../../contracts/src/rental-flow';
import type {RefundRequest,RefundObservation} from '../operations/financial';
import {SQUARE_PRODUCTION_ORIGIN,SQUARE_SANDBOX_ORIGIN,SQUARE_VERSION,type SquareTransport} from './square-engine';
export function squareRefundObservation(raw:unknown,paymentId:string,locationId:string,amountJpy:number){
 const o=raw as Record<string,unknown>|null,m=o?.amount_money as {amount?:unknown;currency?:unknown}|undefined;
 if(!o||typeof o.id!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(o.id)||o.payment_id!==paymentId||o.location_id!==locationId||m?.amount!==amountJpy||m?.currency!=='JPY'||!['PENDING','COMPLETED','REJECTED','FAILED'].includes(String(o.status)))throw new FlowError('REFUND_EVIDENCE_MISMATCH',503);
 return {id:o.id,paymentId,locationId,amountJpy,currency:'JPY' as const,status:o.status as RefundObservation['status']};
}
export interface CancellationRefundGateway{readonly kind:'SIMULATED_DEV'|'SQUARE_PRODUCTION'|'SQUARE_SANDBOX';create(r:RefundRequest):Promise<RefundObservation>;lookup(r:RefundRequest,providerId:string|null):Promise<RefundObservation|null>;}
/** Same bounded transport and response validation as the Sandbox trial. No default credentials. */
export class SquareRefundGateway implements CancellationRefundGateway{
 readonly kind:'SQUARE_PRODUCTION'|'SQUARE_SANDBOX';
 constructor(private transport:SquareTransport,private timeoutMs=5000){this.kind=transport.environment==='PRODUCTION'?'SQUARE_PRODUCTION':'SQUARE_SANDBOX';if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000)throw new FlowError('SQUARE_CONFIGURATION_INVALID',503);}
 private async call(r:RefundRequest,providerId?:string):Promise<RefundObservation>{
  if(r.merchantId!==this.transport.merchantId||!Number.isSafeInteger(r.amountJpy)||r.amountJpy<1||r.amountJpy>100000000||r.currency!=='JPY'||!/^[A-Za-z0-9_-]{1,100}$/.test(r.paymentProviderId))throw new FlowError('REFUND_EVIDENCE_MISMATCH');
  const abort=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
  try{
   const origin=this.transport.environment==='PRODUCTION'?SQUARE_PRODUCTION_ORIGIN:SQUARE_SANDBOX_ORIGIN;
   const response=await Promise.race([this.transport.send({method:providerId?'GET':'POST',url:origin+'/v2/refunds'+(providerId?'/'+providerId:''),version:SQUARE_VERSION,signal:abort.signal,...(providerId?{}:{body:{idempotency_key:r.idempotencyKey,payment_id:r.paymentProviderId,amount_money:{amount:r.amountJpy,currency:'JPY' as const},reason:'ZAO_CANCELLATION_V1' as const}})}),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{abort.abort();reject(new FlowError('REFUND_RESULT_UNKNOWN',503));},this.timeoutMs);})]);
   if(response.status<200||response.status>=300)throw new FlowError('REFUND_RESULT_UNKNOWN',503);
   const raw=(response.body as {refund?:Record<string,unknown>}|null)?.refund,o=squareRefundObservation(raw,r.paymentProviderId,r.locationId,r.amountJpy);
   if(providerId&&o.id!==providerId||typeof raw?.updated_at!=='string'||!Number.isFinite(Date.parse(raw.updated_at)))throw new FlowError('REFUND_EVIDENCE_MISMATCH',503);
   return {id:o.id,paymentProviderId:r.paymentProviderId,merchantId:r.merchantId,locationId:o.locationId,amountJpy:o.amountJpy,currency:o.currency,status:o.status,updatedAt:raw.updated_at};
  }finally{clearTimeout(timer);}
 }
 create(r:RefundRequest){return this.call(r);}
 lookup(r:RefundRequest,providerId:string|null){if(!providerId)throw new FlowError('REFUND_PROVIDER_ID_UNRESOLVED',503);if(!/^[A-Za-z0-9_-]{1,100}$/.test(providerId))throw new FlowError('INVALID_PROVIDER_ID',422);return this.call(r,providerId);}
}
