import {FlowError,matchPayment,type PaymentGateway,type PaymentRequest,type PaymentObservation} from '../../../contracts/src/rental-flow';
import {squareCreateBody,squareObservation,parseVerifiedSquareWebhook} from './square-boundary';
export const SQUARE_VERSION='2026-08-19';
export const SQUARE_SANDBOX_ORIGIN='https://connect.squareupsandbox.com';
export type SquareCall={method:'GET'|'POST';url:string;version:typeof SQUARE_VERSION;body?:ReturnType<typeof squareCreateBody>;signal:AbortSignal};
/** No default fetch or credential reader. The owner-approved future transport must bind
 * a Sandbox account/merchant and honor cancellation; fixtures use the exact same port. */
export interface SquareSandboxTransport{readonly environment:'SANDBOX';readonly merchantId:string;send(call:SquareCall):Promise<{status:number;body:unknown}>;}
export class SquareSandboxGateway implements PaymentGateway{
 readonly kind='SQUARE_UNCONNECTED' as const;
 constructor(private transport:SquareSandboxTransport,private source:(attemptId:string,signal:AbortSignal)=>Promise<string>,private timeoutMs=5000){if(transport.environment!=='SANDBOX'||!transport.merchantId||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000)throw new FlowError('SQUARE_CONFIGURATION_INVALID',503);}
 private async deadline<T>(run:(signal:AbortSignal)=>Promise<T>,code:string):Promise<T>{
  const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
  try{return await Promise.race([Promise.resolve().then(()=>run(controller.signal)),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new FlowError(code,503));},this.timeoutMs);})]);}finally{clearTimeout(timer);}
 }
 private async call(request:PaymentRequest,method:'GET'|'POST',path:string,body?:ReturnType<typeof squareCreateBody>):Promise<PaymentObservation>{
  if(request.merchantId!==this.transport.merchantId||!Number.isSafeInteger(request.amountJpy)||request.amountJpy<1||request.currency!=='JPY')throw new FlowError('PAYMENT_EVIDENCE_MISMATCH');
  try{const r=await this.deadline(signal=>this.transport.send({method,url:SQUARE_SANDBOX_ORIGIN+path,version:SQUARE_VERSION,...(body?{body}:{}),signal}),method==='POST'?'PAYMENT_RESULT_UNKNOWN':'PAYMENT_LOOKUP_UNAVAILABLE');
   if(r.status===401||r.status===403)throw new FlowError('SQUARE_AUTH_STOP',503);
   if(r.status===429)throw new FlowError('SQUARE_QUOTA_STOP',503);
   if(r.status<200||r.status>=300)throw new FlowError(method==='POST'?'PAYMENT_RESULT_UNKNOWN':'PAYMENT_LOOKUP_UNAVAILABLE',503);
   const raw=r.body as {payment?:unknown}|null,o=squareObservation(raw?.payment,request,this.transport.merchantId);matchPayment(request,o);return o;
  }catch(e){if(e instanceof FlowError)throw e;throw new FlowError(method==='POST'?'PAYMENT_RESULT_UNKNOWN':'PAYMENT_LOOKUP_UNAVAILABLE',503);}
 }
 async create(request:PaymentRequest){let source:string;try{source=await this.deadline(signal=>this.source(request.attemptId,signal),'PAYMENT_SOURCE_NOT_CONNECTED');}catch{throw new FlowError('PAYMENT_SOURCE_NOT_CONNECTED',503);}if(!source||source.length>1024||['CASH','EXTERNAL'].includes(source))throw new FlowError('PAYMENT_SOURCE_NOT_CONNECTED',503);return this.call(request,'POST','/v2/payments',squareCreateBody(request,source));}
 async lookup(request:PaymentRequest,providerId:string|null){
  // Square has no GetPayment-by-idempotency endpoint. UNKNOWN without a verified ID is
  // a reconciliation gate, never permission to issue another POST or choose a new key.
  if(!providerId)throw new FlowError('PAYMENT_PROVIDER_ID_UNRESOLVED',503);if(!/^[A-Za-z0-9_-]{1,100}$/.test(providerId))throw new FlowError('INVALID_PROVIDER_ID',422);
  const o=await this.call(request,'GET','/v2/payments/'+providerId);if(o.providerId!==providerId)throw new FlowError('PAYMENT_EVIDENCE_MISMATCH');return o;
 }
 async verifiedWebhook(request:PaymentRequest,raw:Uint8Array,signature:string|undefined,notificationUrl:string,verificationKey:string){
  const event=parseVerifiedSquareWebhook(raw,signature,notificationUrl,verificationKey);if(event.merchantId!==request.merchantId)throw new FlowError('WEBHOOK_TARGET_MISMATCH');
  const observation=await this.lookup(request,event.paymentId);return {event,observation};
 }
}
