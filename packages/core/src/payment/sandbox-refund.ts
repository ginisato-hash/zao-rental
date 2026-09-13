import {FlowError} from '../../../contracts/src/rental-flow';
import {SQUARE_SANDBOX_ORIGIN,SQUARE_VERSION,type SquareSandboxTransport} from './square-sandbox';
import type {SandboxActivationJournal} from './sandbox-activation';
export type SandboxRefundObservation={id:string;paymentId:string;locationId:string;amountJpy:number;currency:'JPY';status:'PENDING'|'COMPLETED'|'REJECTED'|'FAILED'};
/** Supervised activation workbench only; never imported by customer/staff HTTP routes.
 * No commercial exception/refund policy or automatic refund is installed. */
export class SandboxRefundTrial {
 constructor(private transport:SquareSandboxTransport,private journal:SandboxActivationJournal,private timeoutMs=5000){if(transport.environment!=='SANDBOX'||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000)throw new FlowError('SQUARE_CONFIGURATION_INVALID',503);}
 async create(key:string,paymentId:string,amountJpy:number){
  const reserved=await this.journal.reserveRefund(key,paymentId,amountJpy,this.transport.merchantId);
  if(!reserved.call){if(reserved.observation)return reserved.observation;throw new FlowError('SANDBOX_REFUND_RESULT_UNKNOWN',503);}
  const abort=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
  try{
   const r=await Promise.race([this.transport.send({method:'POST',url:SQUARE_SANDBOX_ORIGIN+'/v2/refunds',version:SQUARE_VERSION,signal:abort.signal,body:{idempotency_key:key,payment_id:paymentId,amount_money:{amount:amountJpy,currency:'JPY'},reason:'SYNTHETIC_P4_SANDBOX_TEST'}}),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{abort.abort();reject(new FlowError('SANDBOX_REFUND_RESULT_UNKNOWN',503));},this.timeoutMs);})]);
   if(r.status===401||r.status===403)throw new FlowError('SQUARE_AUTH_STOP',503);if(r.status===429)throw new FlowError('SQUARE_QUOTA_STOP',503);if(r.status<200||r.status>=300)throw new FlowError('SANDBOX_REFUND_RESULT_UNKNOWN',503);
   const body=r.body as {refund?:Record<string,unknown>}|null,o=body?.refund,m=o?.amount_money as {amount?:unknown;currency?:unknown}|undefined;
   if(!o||typeof o.id!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(o.id)||o.payment_id!==paymentId||o.location_id!==reserved.locationId||m?.amount!==amountJpy||m?.currency!=='JPY'||!['PENDING','COMPLETED','REJECTED','FAILED'].includes(String(o.status)))throw new FlowError('SANDBOX_REFUND_EVIDENCE_MISMATCH',503);
   const result:SandboxRefundObservation={id:o.id,paymentId,locationId:reserved.locationId,amountJpy,currency:'JPY',status:o.status as SandboxRefundObservation['status']};
   await this.journal.refundObserved(key,result);return result;
  }catch(e){await this.journal.refundUnknown(key,e);if(e instanceof FlowError&&['SQUARE_AUTH_STOP','SQUARE_QUOTA_STOP','SANDBOX_REFUND_EVIDENCE_MISMATCH'].includes(e.code))throw e;throw new FlowError('SANDBOX_REFUND_RESULT_UNKNOWN',503);}finally{clearTimeout(timer);}
 }
}
