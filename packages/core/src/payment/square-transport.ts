import {FlowError} from '../../../contracts/src/rental-flow';
import {SQUARE_SANDBOX_ORIGIN,SQUARE_VERSION,type SquareCall,type SquareSandboxTransport} from './square-sandbox';
export type SandboxCredential={environment:'SANDBOX';merchantId:string;locationId:string;accessToken:string;expiresAt:Date;revoked:boolean};
/** Inject from an approved secret provider only. No environment reader/default fetch,
 * credential, real connection or retry loop is installed by this module. */
export type SquareFetch=(url:string,init:RequestInit)=>Promise<Response>;
export class FetchSquareSandboxTransport implements SquareSandboxTransport{
 readonly environment='SANDBOX' as const;
 constructor(readonly merchantId:string,readonly locationId:string,private credential:(signal:AbortSignal)=>Promise<SandboxCredential>,private fetch:SquareFetch,private now:()=>Date=()=>new Date()){
  if(!/^[A-Za-z0-9_-]{1,100}$/.test(merchantId)||!/^[A-Za-z0-9_-]{1,100}$/.test(locationId))throw new FlowError('SQUARE_CONFIGURATION_INVALID',503);
 }
 async send(call:SquareCall):Promise<{status:number;body:unknown}>{
  const unknown=call.method==='POST'?'PAYMENT_RESULT_UNKNOWN':'PAYMENT_LOOKUP_UNAVAILABLE';
  // Exact allowlist before fetching a secret. No redirects/query/userinfo/alternate origin.
  const path=call.url.slice(SQUARE_SANDBOX_ORIGIN.length);
  if(call.version!==SQUARE_VERSION||!call.url.startsWith(SQUARE_SANDBOX_ORIGIN+'/')||
    !(call.method==='POST'&&path==='/v2/payments'&&call.body&&call.body.location_id===this.locationId&&call.body.amount_money.currency==='JPY'&&Number.isSafeInteger(call.body.amount_money.amount)&&call.body.amount_money.amount>0&&call.body.idempotency_key&&call.body.reference_id&&call.body.autocomplete===true||call.method==='GET'&&/^\/v2\/payments\/[A-Za-z0-9_-]{1,100}$/.test(path)&&call.body===undefined))throw new FlowError('SQUARE_REQUEST_REJECTED',503);
  let response:Response|undefined;
  try{
   call.signal.throwIfAborted();
   const secret=await abortable(this.credential(call.signal),call.signal);
   if(secret.environment!=='SANDBOX'||secret.merchantId!==this.merchantId||secret.locationId!==this.locationId||secret.revoked||!Number.isFinite(secret.expiresAt.getTime())||secret.expiresAt<=this.now()||!/^[-A-Za-z0-9._~+/=]{1,4096}$/.test(secret.accessToken))throw new FlowError('SQUARE_AUTH_STOP',503);
   call.signal.throwIfAborted();
   response=await abortable(this.fetch(call.url,{method:call.method,headers:{Authorization:'Bearer '+secret.accessToken,'Square-Version':SQUARE_VERSION,Accept:'application/json','Content-Type':'application/json'},...(call.body?{body:JSON.stringify(call.body)}:{}),signal:call.signal,redirect:'error',cache:'no-store',credentials:'omit'}),call.signal);
   if(response.status<200||response.status>=300){await response.body?.cancel();return {status:response.status,body:null};}
   if(!response.headers.get('content-type')?.toLowerCase().startsWith('application/json'))throw new Error();
   const reader=response.body?.getReader();if(!reader)throw new Error();let total=0;const chunks:Uint8Array[]=[];
   try{while(true){const r=await abortable(reader.read(),call.signal);if(r.done)break;total+=r.value.byteLength;if(total>1024*1024)throw new Error();chunks.push(r.value);}}
   finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
   call.signal.throwIfAborted();return {status:response.status,body:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)))};
  }catch(e){await response?.body?.cancel().catch(()=>{});if(e instanceof FlowError&&e.code==='SQUARE_AUTH_STOP')throw e;throw new FlowError(unknown,503);}
 }
}
async function abortable<T>(operation:Promise<T>,signal:AbortSignal):Promise<T>{
 let rejectAbort:()=>void=()=>{};const aborted=new Promise<never>((_,reject)=>{rejectAbort=()=>reject(new Error('ABORTED'));signal.addEventListener('abort',rejectAbort,{once:true});if(signal.aborted)rejectAbort();});
 try{return await Promise.race([operation,aborted]);}finally{signal.removeEventListener('abort',rejectAbort);}
}
