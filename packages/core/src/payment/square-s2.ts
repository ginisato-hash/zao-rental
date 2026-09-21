import manifest from '../../../../docs/execution/p6/s2-evidence/operation-manifest.json';
import {flowHash,flowId,matchPayment,type PaymentRequest,type PaymentObservation} from '../../../contracts/src/rental-flow';
import {squareCreateBody,squareObservation} from './square-boundary';
import {SQUARE_VERSION,SQUARE_SANDBOX_ORIGIN,type SquareCall} from './square-sandbox';
import type {SquareFetch} from './square-transport';

export const s2Operation=Object.freeze({...manifest});
export const S2_MANIFEST_HASH='8d0e345cc3f51a0293b146f5afe16673ff38c49db4dcb6ad71c50d775b2306f8';
export function exactS2Manifest(value:unknown=s2Operation):boolean {
 try {return flowHash(value)===S2_MANIFEST_HASH;}catch{return false;}
}
export function s2Request(locationId:string):PaymentRequest {
 if(!exactS2Manifest()||!/^[A-Za-z0-9_-]{1,100}$/.test(locationId))throw new Error('S2_BINDING_INVALID');
 for(const id of [manifest.operationId,manifest.bookingId,manifest.attemptId,manifest.idempotencyKey])flowId(id);
 return Object.freeze({bookingId:manifest.bookingId,attemptId:manifest.attemptId,idempotencyKey:manifest.idempotencyKey,
  merchantId:manifest.merchantId,locationId,amountJpy:manifest.amountJpy,currency:'JPY'});
}
export type S2Class='S2_PASS'|'S2_FAIL_AUTH'|'S2_FAIL_RATE_LIMIT'|'S2_FAIL_PROVIDER'|'S2_FAIL_EVIDENCE'|'UNKNOWN_DO_NOT_RETRY';
export type S2Result={classification:S2Class;operationId:string;requestFingerprint:string;manifestFingerprint:string;
 createPaymentCount:number;conditionalGetPaymentCount:number;httpResults:{create:number|null;lookup:number|null};
 providerPaymentId:string|null;paymentStatus:PaymentObservation['status']|null;amountJpy:100;currency:'JPY';
 referenceMatch:boolean;locationMatch:boolean;updatedAt:string|null;completedAt:string|null;automaticRetry:0;manualRetry:0};
class TransportFailure extends Error{}
const validId=(x:unknown):x is string=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(x);

/** R9-only narrow transport. No invented expiry/rotation metadata, DB, retries or
 * generic provider URL. The existing production credential contract is unchanged. */
export class SquareS2Transport {
 createCount=0;lookupCount=0;httpResults:{create:number|null;lookup:number|null}={create:null,lookup:null};
 private lookupId:string|null=null;
 constructor(private expected:PaymentRequest,private token:()=>string,private fetch:SquareFetch) {
  if(flowHash(expected)!==flowHash(s2Request(expected.locationId)))throw new Error('S2_REQUEST_MISMATCH');
 }
 allowLookup(id:string){if(this.createCount!==1||!validId(id)||this.lookupId!==null)throw new Error('S2_LOOKUP_FORBIDDEN');this.lookupId=id;}
 async send(call:SquareCall):Promise<{status:number;body:unknown}> {
  const create=call.method==='POST'&&call.url===SQUARE_SANDBOX_ORIGIN+'/v2/payments'&&
   call.body&&flowHash(call.body)===flowHash(squareCreateBody(this.expected,manifest.sourceId))&&this.createCount===0;
  const lookup=call.method==='GET'&&this.lookupId!==null&&call.url===SQUARE_SANDBOX_ORIGIN+'/v2/payments/'+this.lookupId&&call.body===undefined&&this.lookupCount===0;
  if(call.version!==SQUARE_VERSION||!(create||lookup))throw new Error('S2_CALL_FORBIDDEN');
  call.signal.throwIfAborted();const token=this.token();
  if(!/^[-A-Za-z0-9._~+/=]{1,4096}$/.test(token))throw new TransportFailure();
  if(create)this.createCount++;else this.lookupCount++;
  let response:Response|undefined;
  try {
   response=await this.fetch(call.url,{method:call.method,headers:{Authorization:'Bearer '+token,'Square-Version':SQUARE_VERSION,Accept:'application/json','Content-Type':'application/json'},
    ...(create?{body:JSON.stringify(call.body)}:{}),signal:call.signal,redirect:'error',cache:'no-store',credentials:'omit'});
   if(create)this.httpResults.create=response.status;else this.httpResults.lookup=response.status;
   if(response.status<200||response.status>=300){await response.body?.cancel();return {status:response.status,body:null};}
   if(!response.headers.get('content-type')?.toLowerCase().startsWith('application/json'))throw new TransportFailure();
   const reader=response.body?.getReader();if(!reader)throw new TransportFailure();let n=0;const chunks:Uint8Array[]=[];
   try {for(;;){call.signal.throwIfAborted();const part=await reader.read();if(part.done)break;n+=part.value.byteLength;if(n>1024*1024)throw new TransportFailure();chunks.push(part.value);}}
   finally {void reader.cancel().catch(()=>{});reader.releaseLock();}
   return {status:response.status,body:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)))};
  }catch{void response?.body?.cancel().catch(()=>{});throw new TransportFailure();}
 }
}

export class SquareS2Service {
 private attempted=false;
 constructor(private request:PaymentRequest,private transport:SquareS2Transport,private forbiddenSecret:()=>string,private timeoutMs=5000) {
  if(flowHash(request)!==flowHash(s2Request(request.locationId))||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>5000)throw new Error('S2_CONFIGURATION_INVALID');
 }
 async run():Promise<S2Result> {
  if(this.attempted)throw new Error('S2_ALREADY_ATTEMPTED');this.attempted=true;
  const out:S2Result={classification:'UNKNOWN_DO_NOT_RETRY',operationId:manifest.operationId,requestFingerprint:flowHash(this.request),manifestFingerprint:S2_MANIFEST_HASH,
   createPaymentCount:0,conditionalGetPaymentCount:0,httpResults:{create:null,lookup:null},providerPaymentId:null,paymentStatus:null,
   amountJpy:100,currency:'JPY',referenceMatch:false,locationMatch:false,updatedAt:null,completedAt:null,automaticRetry:0,manualRetry:0};
  const secret=this.forbiddenSecret();
  const safeId=(v:unknown)=>validId(v)&&!v.includes(secret)?v:null;
  const classify=(status:number):S2Class|null=>status===401||status===403?'S2_FAIL_AUTH':status===429?'S2_FAIL_RATE_LIMIT':status>=400&&status<500?'S2_FAIL_PROVIDER':status<200||status>=300?'UNKNOWN_DO_NOT_RETRY':null;
  const evaluate=(body:unknown,lookupId:string|null):'PASS'|'LOOKUP'|'STOP'=>{
   const raw=body&&typeof body==='object'?(body as {payment?:unknown}).payment:null;
   if(!raw||typeof raw!=='object'){out.classification='UNKNOWN_DO_NOT_RETRY';return 'STOP';}
   const p=raw as Record<string,unknown>,id=safeId(p.id);
   if(id)out.providerPaymentId=id;
   if(lookupId&&id!==lookupId){out.classification='S2_FAIL_EVIDENCE';return 'STOP';}
   const money=p.amount_money as {amount?:unknown;currency?:unknown}|null;
   // A known mismatch is terminal, not justification for a lookup to turn green.
   if((p.reference_id!==undefined&&p.reference_id!==this.request.bookingId)||
    (p.location_id!==undefined&&p.location_id!==this.request.locationId)||
    (money?.amount!==undefined&&money.amount!==100)||(money?.currency!==undefined&&money.currency!=='JPY')){
    out.classification='S2_FAIL_EVIDENCE';return 'STOP';
   }
   let observation:PaymentObservation;
   try{observation=squareObservation(raw,this.request,this.request.merchantId);matchPayment(this.request,observation);}
   catch{out.classification='UNKNOWN_DO_NOT_RETRY';return id&&!lookupId?'LOOKUP':'STOP';}
   if(!id||JSON.stringify(observation).includes(secret)){out.classification='S2_FAIL_EVIDENCE';return 'STOP';}
   out.referenceMatch=true;out.locationMatch=true;out.paymentStatus=observation.status;
   // Dates are normalized; never copy arbitrary provider strings into evidence.
   out.updatedAt=new Date(observation.updatedAt).toISOString();
   out.completedAt=observation.completedAt?new Date(observation.completedAt).toISOString():null;
   if(observation.status==='COMPLETED'){out.classification='S2_PASS';return 'PASS';}
   if(observation.status==='FAILED'||observation.status==='CANCELED'){out.classification='S2_FAIL_PROVIDER';return 'STOP';}
   out.classification='UNKNOWN_DO_NOT_RETRY';return lookupId?'STOP':'LOOKUP';
  };
  const call=async(method:'POST'|'GET',id:string|null)=>{
   const abort=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
   try{return await Promise.race([this.transport.send({method,url:SQUARE_SANDBOX_ORIGIN+'/v2/payments'+(id?'/'+id:''),version:SQUARE_VERSION,
    ...(method==='POST'?{body:squareCreateBody(this.request,manifest.sourceId)}:{}),signal:abort.signal}),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{abort.abort();reject(new TransportFailure());},this.timeoutMs);})]);}
   finally{clearTimeout(timer);abort.abort();}
  };
  try {
   const first=await call('POST',null),failure=classify(first.status);
   if(failure)out.classification=failure;
   else if(evaluate(first.body,null)==='LOOKUP'&&out.providerPaymentId){
    const id=out.providerPaymentId;this.transport.allowLookup(id);
    const second=await call('GET',id),lookupFailure=classify(second.status);
    if(lookupFailure)out.classification=lookupFailure;else evaluate(second.body,id);
   }
  }catch{out.classification='UNKNOWN_DO_NOT_RETRY';}
  out.createPaymentCount=this.transport.createCount;out.conditionalGetPaymentCount=this.transport.lookupCount;
  out.httpResults={...this.transport.httpResults};
  return out;
 }
}
