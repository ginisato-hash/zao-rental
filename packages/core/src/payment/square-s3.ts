import manifest from '../../../../docs/execution/p6/s3-evidence/operation-manifest.json';
import {flowHash,flowId,matchPayment,type PaymentObservation} from '../../../contracts/src/rental-flow';
import {squareObservation} from './square-boundary';
import {s2Request,exactS2Manifest} from './square-s2';
import {SQUARE_VERSION,SQUARE_SANDBOX_ORIGIN,type SquareCall} from './square-sandbox';
import type {SquareFetch} from './square-transport';
import type {SandboxRefundObservation} from './sandbox-refund';

export const s3Operation=Object.freeze({...manifest});
export const S3_MANIFEST_HASH='a010521d418619c2a9b29910eb8b9ac98c001104ddeb6bd6ffa664a06b94d83b';
export function exactS3Manifest(value:unknown=s3Operation):boolean {
 try{return exactS2Manifest()&&flowHash(value)===S3_MANIFEST_HASH;}catch{return false;}
}
export function s3RefundBody(){
 if(!exactS3Manifest())throw new Error('S3_MANIFEST_MISMATCH');
 flowId(manifest.operationId);flowId(manifest.refundIdempotencyKey);
 return {idempotency_key:manifest.refundIdempotencyKey,payment_id:manifest.paymentId,
  amount_money:{amount:100,currency:'JPY' as const},reason:manifest.reason};
}
const validId=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(v);
const record=(v:unknown):Record<string,unknown>|null=>!!v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:null;
function noErrors(body:unknown){const b=record(body);return !!b&&(b.errors===undefined||Array.isArray(b.errors)&&b.errors.length===0);}
function moneyMatches(raw:unknown,amount:number){const m=record(raw);return m?.amount===amount&&m.currency==='JPY';}
/** Reuse S2's immutable commercial request and existing observation/match contract.
 * A prior refund or conflicting total blocks a second financial operation. No S1 call. */
export function s3PaymentEvidence(body:unknown,location:string,secret:string):PaymentObservation {
 const p=record(record(body)?.payment),r=s2Request(location);
 if(!exactS3Manifest()||!noErrors(body)||!p||p.id!==manifest.paymentId||p.status!=='COMPLETED'||
  !moneyMatches(p.amount_money,100)||p.total_money!==undefined&&!moneyMatches(p.total_money,100)||
  p.refunded_money!==undefined&&!moneyMatches(p.refunded_money,0)||
  p.refund_ids!==undefined&&(!Array.isArray(p.refund_ids)||p.refund_ids.length!==0))throw new Error('S3_PAYMENT_EVIDENCE_MISMATCH');
 const o=squareObservation(p,r,manifest.merchantId);matchPayment(r,o);
 if(!secret||JSON.stringify(o).includes(secret))throw new Error('S3_PAYMENT_EVIDENCE_MISMATCH');
 return {...o,updatedAt:new Date(o.updatedAt).toISOString(),completedAt:new Date(o.completedAt!).toISOString()};
}
/** Same field contract as SandboxRefundTrial, without its unrelated P4 DB journal. */
export function s3RefundEvidence(body:unknown,location:string,secret:string,expectedId?:string):SandboxRefundObservation {
 const p=record(record(body)?.refund);
 if(!noErrors(body)||!p||!validId(p.id)||!secret||p.id.includes(secret)||expectedId!==undefined&&p.id!==expectedId||
  p.payment_id!==manifest.paymentId||p.location_id!==location||!moneyMatches(p.amount_money,100)||
  !['PENDING','COMPLETED','REJECTED','FAILED'].includes(String(p.status)))throw new Error('S3_REFUND_EVIDENCE_MISMATCH');
 return {id:p.id,paymentId:manifest.paymentId,locationId:location,amountJpy:100,currency:'JPY',status:p.status as SandboxRefundObservation['status']};
}
export type S3Call=Omit<SquareCall,'body'>&{body?:ReturnType<typeof s3RefundBody>};
type Step='payment'|'refund'|'refundLookup';
type Http=Record<Step,number|null>;
class TransportFailure extends Error{}

/** Dedicated R10-only allowlist; shared transport/production journal stay unchanged. */
export class SquareS3Transport {
 counts:Record<Step,number>={payment:0,refund:0,refundLookup:0};
 httpResults:Http={payment:null,refund:null,refundLookup:null};
 private refundAllowed=false;private refundId:string|null=null;
 constructor(private location:string,private token:()=>string,private fetch:SquareFetch){
  if(!exactS3Manifest()||!validId(location))throw new Error('S3_CONFIGURATION_INVALID');
 }
 authorizeRefund(body:unknown){
  if(this.counts.payment!==1||this.refundAllowed)throw new Error('S3_REFUND_FORBIDDEN');
  const result=s3PaymentEvidence(body,this.location,this.token());this.refundAllowed=true;return result;
 }
 authorizeRefundLookup(body:unknown){
  if(this.counts.refund!==1||this.httpResults.refund===null||this.httpResults.refund<200||this.httpResults.refund>=300||this.refundId!==null)throw new Error('S3_LOOKUP_FORBIDDEN');
  const r=s3RefundEvidence(body,this.location,this.token());if(r.status!=='PENDING')throw new Error('S3_LOOKUP_FORBIDDEN');this.refundId=r.id;
 }
 async send(call:S3Call):Promise<{status:number;body:unknown}>{
  let step:Step;
  if(call.method==='GET'&&call.url===SQUARE_SANDBOX_ORIGIN+'/v2/payments/'+manifest.paymentId&&call.body===undefined&&this.counts.payment===0)step='payment';
  else if(call.method==='POST'&&call.url===SQUARE_SANDBOX_ORIGIN+'/v2/refunds'&&call.body&&flowHash(call.body)===flowHash(s3RefundBody())&&this.refundAllowed&&this.counts.refund===0)step='refund';
  else if(call.method==='GET'&&this.refundId!==null&&call.url===SQUARE_SANDBOX_ORIGIN+'/v2/refunds/'+this.refundId&&call.body===undefined&&this.counts.refundLookup===0)step='refundLookup';
  else throw new Error('S3_CALL_FORBIDDEN');
  if(call.version!==SQUARE_VERSION)throw new Error('S3_VERSION_FORBIDDEN');
  call.signal.throwIfAborted();const token=this.token();if(!/^[-A-Za-z0-9._~+/=]{1,4096}$/.test(token))throw new TransportFailure();
  this.counts[step]++;let response:Response|undefined;
  try{
   response=await this.fetch(call.url,{method:call.method,headers:{Authorization:'Bearer '+token,'Square-Version':SQUARE_VERSION,Accept:'application/json','Content-Type':'application/json'},
    ...(step==='refund'?{body:JSON.stringify(call.body)}:{}),signal:call.signal,redirect:'error',cache:'no-store',credentials:'omit'});
   this.httpResults[step]=response.status;
   if(response.status<200||response.status>=300){await response.body?.cancel();return {status:response.status,body:null};}
   if(!response.headers.get('content-type')?.toLowerCase().startsWith('application/json'))throw new TransportFailure();
   const reader=response.body?.getReader();if(!reader)throw new TransportFailure();let n=0;const chunks:Uint8Array[]=[];
   try{for(;;){call.signal.throwIfAborted();const p=await reader.read();if(p.done)break;n+=p.value.byteLength;if(n>1024*1024)throw new TransportFailure();chunks.push(p.value);}}
   finally{void reader.cancel().catch(()=>{});reader.releaseLock();}
   return {status:response.status,body:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)))};
  }catch{void response?.body?.cancel().catch(()=>{});throw new TransportFailure();}
 }
}
export type S3Class='S3_PASS'|'S3_NONTERMINAL_DO_NOT_RETRY'|'S3_REFUND_FAILED'|'S3_FAIL_AUTH'|'S3_FAIL_RATE_LIMIT'|'S3_PAYMENT_NOT_FOUND'|
 'S3_PAYMENT_PROVIDER_FAIL'|'S3_PAYMENT_EVIDENCE_MISMATCH'|'S3_REFUND_PROVIDER_FAIL'|'S3_REFUND_EVIDENCE_MISMATCH'|'UNKNOWN_DO_NOT_RETRY';
export type S3Result={classification:S3Class;operationId:string;manifestFingerprint:string;requestFingerprint:string;paymentId:string;refundId:string|null;
 paymentLookupCount:number;refundPostCount:number;conditionalGetRefundCount:number;httpResults:Http;paymentStatus:'COMPLETED'|null;refundStatus:SandboxRefundObservation['status']|null;
 amountJpy:100;currency:'JPY';referenceMatch:boolean;paymentLocationMatch:boolean;refundLocationMatch:boolean;paymentUpdatedAt:string|null;paymentCompletedAt:string|null;automaticRetry:0;manualRetry:0};
export class SquareS3Service {
 private attempted=false;
 constructor(private location:string,private transport:SquareS3Transport,private secret:()=>string,private timeoutMs=5000){
  if(!exactS3Manifest()||!validId(location)||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>5000)throw new Error('S3_CONFIGURATION_INVALID');
 }
 async run():Promise<S3Result>{
  if(this.attempted)throw new Error('S3_ALREADY_ATTEMPTED');this.attempted=true;
  const out:S3Result={classification:'UNKNOWN_DO_NOT_RETRY',operationId:manifest.operationId,manifestFingerprint:S3_MANIFEST_HASH,
   requestFingerprint:flowHash(s3RefundBody()),paymentId:manifest.paymentId,refundId:null,paymentLookupCount:0,refundPostCount:0,conditionalGetRefundCount:0,
   httpResults:{payment:null,refund:null,refundLookup:null},paymentStatus:null,refundStatus:null,amountJpy:100,currency:'JPY',referenceMatch:false,
   paymentLocationMatch:false,refundLocationMatch:false,paymentUpdatedAt:null,paymentCompletedAt:null,automaticRetry:0,manualRetry:0};
  const failure=(status:number,step:Step):S3Class|null=>status===401||status===403?'S3_FAIL_AUTH':status===429?'S3_FAIL_RATE_LIMIT':status===404&&step==='payment'?'S3_PAYMENT_NOT_FOUND':
   status>=400&&status<500?step==='payment'?'S3_PAYMENT_PROVIDER_FAIL':'S3_REFUND_PROVIDER_FAIL':status<200||status>=300?'UNKNOWN_DO_NOT_RETRY':null;
  const call=async(step:Step,id?:string)=>{
   const abort=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
   try{return await Promise.race([this.transport.send({method:step==='refund'?'POST':'GET',url:SQUARE_SANDBOX_ORIGIN+(step==='payment'?'/v2/payments/'+manifest.paymentId:step==='refund'?'/v2/refunds':'/v2/refunds/'+id),
    version:SQUARE_VERSION,...(step==='refund'?{body:s3RefundBody()}:{}),signal:abort.signal}),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{abort.abort();reject(new TransportFailure());},this.timeoutMs);})]);}
   finally{clearTimeout(timer);abort.abort();}
  };
  const refundResult=(body:unknown,expected?:string):SandboxRefundObservation|null=>{
   try{const r=s3RefundEvidence(body,this.location,this.secret(),expected);out.refundId=r.id;out.refundStatus=r.status;out.refundLocationMatch=true;
    out.classification=r.status==='COMPLETED'?'S3_PASS':r.status==='PENDING'?'S3_NONTERMINAL_DO_NOT_RETRY':'S3_REFUND_FAILED';return r;}
   catch{out.classification='S3_REFUND_EVIDENCE_MISMATCH';return null;}
  };
  try{
   const p=await call('payment'),pf=failure(p.status,'payment');
   if(pf)out.classification=pf;
   else{
    let payment:PaymentObservation|null=null;
    try{payment=this.transport.authorizeRefund(p.body);}catch{out.classification='S3_PAYMENT_EVIDENCE_MISMATCH';}
    if(payment){
     out.paymentStatus='COMPLETED';out.referenceMatch=true;out.paymentLocationMatch=true;out.paymentUpdatedAt=payment.updatedAt;out.paymentCompletedAt=payment.completedAt;
     const r=await call('refund'),rf=failure(r.status,'refund');
     if(rf)out.classification=rf;
     else{const refund=refundResult(r.body);if(refund?.status==='PENDING'){
      this.transport.authorizeRefundLookup(r.body);const last=await call('refundLookup',refund.id),lf=failure(last.status,'refundLookup');
      if(lf)out.classification=lf;else refundResult(last.body,refund.id);
     }}
    }
   }
  }catch{out.classification='UNKNOWN_DO_NOT_RETRY';}
  out.paymentLookupCount=this.transport.counts.payment;out.refundPostCount=this.transport.counts.refund;out.conditionalGetRefundCount=this.transport.counts.refundLookup;
  out.httpResults={...this.transport.httpResults};return out;
 }
}
