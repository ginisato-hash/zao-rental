import {FlowError} from '../../../contracts/src/rental-flow';
import {SQUARE_SANDBOX_ORIGIN,SQUARE_PRODUCTION_ORIGIN,SQUARE_VERSION,type SquareCall,type SquareTransport} from './square-engine';
import type {SquareSandboxTransport} from './square-sandbox';
import type {SquareProductionTransport} from './square-production';
export type SquareCredential={environment:'SANDBOX'|'PRODUCTION';merchantId:string;locationId:string;accessToken:string;expiresAt:Date;revoked:boolean};
/** Inject from an approved secret provider only. No environment reader/default fetch,
 * credential, real connection or retry loop is installed by this module. */
export type SquareFetch=(url:string,init:RequestInit)=>Promise<Response>;
export type SandboxCredential=SquareCredential&{environment:'SANDBOX'};
export type ProductionSquareCredential=SquareCredential&{environment:'PRODUCTION'};
class FetchSquareTransport implements SquareTransport{
 private readonly origin:string;
 constructor(readonly environment:'SANDBOX'|'PRODUCTION',readonly merchantId:string,readonly locationId:string,private credential:(signal:AbortSignal)=>Promise<SquareCredential>,private fetch:SquareFetch,private now:()=>Date=()=>new Date()){
  this.origin=environment==='PRODUCTION'?SQUARE_PRODUCTION_ORIGIN:SQUARE_SANDBOX_ORIGIN;
  if(!/^[A-Za-z0-9_-]{1,100}$/.test(merchantId)||!/^[A-Za-z0-9_-]{1,100}$/.test(locationId))throw new FlowError('SQUARE_CONFIGURATION_INVALID',503);
 }
 async send(call:SquareCall):Promise<{status:number;body:unknown}>{
  const unknown=call.method==='POST'?'PAYMENT_RESULT_UNKNOWN':'PAYMENT_LOOKUP_UNAVAILABLE';
  // Exact allowlist before fetching a secret. No redirects/query/userinfo/alternate origin.
  const path=call.url.slice(this.origin.length);
  const body=call.body;
  const money=body&&body.amount_money.currency==='JPY'&&Number.isSafeInteger(body.amount_money.amount)&&body.amount_money.amount>0;
  const payment=call.method==='POST'&&path==='/v2/payments'&&body&&'source_id' in body&&body.location_id===this.locationId&&money&&body.idempotency_key&&body.reference_id&&body.autocomplete===true;
  const refund=call.method==='POST'&&path==='/v2/refunds'&&body&&'payment_id' in body&&money&&/^[a-f0-9-]{36}$/.test(body.idempotency_key)&&/^[A-Za-z0-9_-]{1,100}$/.test(body.payment_id)&&body.reason==='SYNTHETIC_P4_SANDBOX_TEST';
  const lookup=call.method==='GET'&&/^\/v2\/(payments|refunds)\/[A-Za-z0-9_-]{1,100}$/.test(path)&&body===undefined;
  if(call.version!==SQUARE_VERSION||!call.url.startsWith(this.origin+'/')||!(payment||refund||lookup))throw new FlowError('SQUARE_REQUEST_REJECTED',503);
  let response:Response|undefined;
  try{
   call.signal.throwIfAborted();
   const secret=await abortable(this.credential(call.signal),call.signal);
   if(secret.environment!==this.environment||secret.merchantId!==this.merchantId||secret.locationId!==this.locationId||secret.revoked||!Number.isFinite(secret.expiresAt.getTime())||secret.expiresAt<=this.now()||!/^[-A-Za-z0-9._~+/=]{1,4096}$/.test(secret.accessToken))throw new FlowError('SQUARE_AUTH_STOP',503);
   call.signal.throwIfAborted();
   response=await abortable(this.fetch(call.url,{method:call.method,headers:{Authorization:'Bearer '+secret.accessToken,'Square-Version':SQUARE_VERSION,Accept:'application/json','Content-Type':'application/json'},...(call.body?{body:JSON.stringify(call.body)}:{}),signal:call.signal,redirect:'error',cache:'no-store',credentials:'omit'}),call.signal);
   if(response.status<200||response.status>=300){await response.body?.cancel();return {status:response.status,body:null};}
   return {status:response.status,body:await readSquareJson(response,call.signal)};
  }catch(e){await response?.body?.cancel().catch(()=>{});if(e instanceof FlowError&&e.code==='SQUARE_AUTH_STOP')throw e;throw new FlowError(unknown,503);}
 }
}
export class FetchSquareSandboxTransport extends FetchSquareTransport implements SquareSandboxTransport {
 readonly environment='SANDBOX' as const;
 constructor(merchantId:string,locationId:string,credential:(signal:AbortSignal)=>Promise<SandboxCredential>,fetch:SquareFetch,now:()=>Date=()=>new Date()){
  super('SANDBOX',merchantId,locationId,credential,fetch,now);
 }
}
export class FetchSquareProductionTransport extends FetchSquareTransport implements SquareProductionTransport {
 readonly environment='PRODUCTION' as const;
 constructor(merchantId:string,locationId:string,credential:(signal:AbortSignal)=>Promise<ProductionSquareCredential>,fetch:SquareFetch,now:()=>Date=()=>new Date()){
  super('PRODUCTION',merchantId,locationId,credential,fetch,now);
 }
}
async function abortable<T>(operation:Promise<T>,signal:AbortSignal):Promise<T>{
 let rejectAbort:()=>void=()=>{};const aborted=new Promise<never>((_,reject)=>{rejectAbort=()=>reject(new Error('ABORTED'));signal.addEventListener('abort',rejectAbort,{once:true});if(signal.aborted)rejectAbort();});
 try{return await Promise.race([operation,aborted]);}finally{signal.removeEventListener('abort',rejectAbort);}
}


/** S1 capability: exactly two read-only identity endpoints. Separate from payment
 * transport so an unbound merchant identity cannot invoke payment/refund lookup. */
export class SquareS1TransportError extends FlowError {
 constructor(code:string,readonly httpStatus:number|null){super(code,503);}
}
export class FetchSquareS1Transport {
 constructor(private credential:()=>string|undefined,private fetch:SquareFetch){}
 async send(call:SquareCall):Promise<{status:number;body:unknown}>{
  if(call.method!=='GET'||call.body!==undefined||call.version!==SQUARE_VERSION||
    ![SQUARE_SANDBOX_ORIGIN+'/v2/merchants/me',SQUARE_SANDBOX_ORIGIN+'/v2/locations'].includes(call.url))
   throw new FlowError('SQUARE_REQUEST_REJECTED',503);
  let response:Response|undefined;
  try{
   call.signal.throwIfAborted();
   const token=this.credential();
   if(!token||!/^[-A-Za-z0-9._~+/=]{1,4096}$/.test(token))throw new FlowError('SQUARE_AUTH_STOP',503);
   response=await abortable(this.fetch(call.url,{method:'GET',headers:{Authorization:'Bearer '+token,'Square-Version':SQUARE_VERSION,Accept:'application/json','Content-Type':'application/json'},signal:call.signal,redirect:'error',cache:'no-store',credentials:'omit'}),call.signal);
   if(response.status<200||response.status>=300){await response.body?.cancel();return {status:response.status,body:null};}
   return {status:response.status,body:await readSquareJson(response,call.signal)};
  }catch(e){
   await response?.body?.cancel().catch(()=>{});
   if(e instanceof FlowError&&e.code==='SQUARE_AUTH_STOP')throw e;
   throw new SquareS1TransportError(call.signal.aborted?'S1_NETWORK_FAILURE':response?'S1_SCHEMA_MISMATCH':'S1_NETWORK_FAILURE',response?.status??null);
  }
 }
}

async function readSquareJson(response:Response,signal:AbortSignal):Promise<unknown>{
 if(!response.headers.get('content-type')?.toLowerCase().startsWith('application/json'))throw new Error();
 const reader=response.body?.getReader();if(!reader)throw new Error();let total=0;const chunks:Uint8Array[]=[];
 try{while(true){const r=await abortable(reader.read(),signal);if(r.done)break;total+=r.value.byteLength;if(total>1024*1024)throw new Error();chunks.push(r.value);}}
 finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 signal.throwIfAborted();return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
}
