import {sandboxAcceptanceEnvironment} from '../../../../packages/core/src/payment/sandbox-environment';
import {FetchSquareS1Transport,type SquareFetch} from '../../../../packages/core/src/payment/square-transport';
import {SquareS1Service} from '../../../../packages/core/src/payment/square-s1';
import {squareS1Preflight} from './square-s1-preflight';
import type {S1Summary} from '../../../../packages/core/src/payment/square-s1';

/** Temporary protected acceptance composition. The intent header is NOT identity.
 * Vercel Team protection is verified externally before dispatch. This in-isolate
 * latch is defense in depth, NOT a distributed once-only guarantee. The operator
 * records one POST before dispatch and never retries unknown results, then removes
 * this deployment. No DB/secret-store/bypass credential is added for acceptance. */
export function createSquareS1Acceptance(env:Readonly<Record<string,string|undefined>>,fetch:SquareFetch){
 let attempted=false;
 return async(request:Request):Promise<Response>=>{
  const headers={'Cache-Control':'private, no-store','X-Robots-Tag':'noindex, nofollow','Referrer-Policy':'no-referrer'};
  const deny=(error:string,status:number)=>Response.json({error},{status,headers});
  if(env.VERCEL_ENV!=='preview'||env.SQUARE_ENVIRONMENT!=='SANDBOX')return deny('NOT_FOUND',404);
  if(request.method!=='POST')return deny('METHOD_NOT_ALLOWED',405);
  if(request.headers.get('X-ZAO-Acceptance')!=='SQUARE_S1_V1'||request.headers.get('sec-fetch-site')==='cross-site'||new URL(request.url).search)return deny('S1_INTENT_REQUIRED',400);
  if(!await emptyBody(request))return deny('S1_BODY_FORBIDDEN',400);
  if(attempted)return deny('S1_ALREADY_ATTEMPTED',409);
  try{
   const config=sandboxAcceptanceEnvironment(env);
   // Read only within the server runtime, after deployment/env/intent validation.
   // This reference never reaches response, diagnostics, a file or client props.
   const token=env.SQUARE_SANDBOX_ACCESS_TOKEN;
   if(!token||!/^[-A-Za-z0-9._~+/=]{1,4096}$/.test(token))return deny('S1_CREDENTIAL_UNCONFIGURED',503);
   attempted=true;
   const service=new SquareS1Service(config.acceptanceLocationId,new FetchSquareS1Transport(()=>token,fetch));
   const result=await service.run();
   if(JSON.stringify(result).includes(token))return Response.json({environment:'SANDBOX',apiVersion:config.apiVersion,requestCount:result.requestCount,httpResults:result.httpResults,result:'S1_FAIL',reason:'SCHEMA_MISMATCH'},{status:422,headers});
   return Response.json(result,{status:result.result==='S1_PASS'?200:422,headers});
  }catch{return deny('S1_CONFIGURATION_OR_OUTCOME_UNKNOWN',503);}
 };
}

// Next's Node adapter can represent an empty POST with a non-null stream.
// Inspect only emptiness, without parsing or retaining caller input.
async function emptyBody(request:Request):Promise<boolean>{
 if(!request.body)return true;
 const reader=request.body.getReader();let timer:ReturnType<typeof setTimeout>|undefined;
 try{return await Promise.race([Promise.resolve().then(async()=>{
  for(let chunks=0;chunks<4;chunks++){const part=await reader.read();if(part.done)return true;if(part.value.byteLength)return false;}
  return false;
 }),new Promise<boolean>(resolve=>{timer=setTimeout(()=>resolve(false),1000);})]);}
 catch{return false;}
 finally{clearTimeout(timer);void reader.cancel().catch(()=>{});}
}

const v2Headers={'Cache-Control':'private, no-store','X-Robots-Tag':'noindex, nofollow','Referrer-Policy':'no-referrer'};
type S1V2Stage='RUNTIME_PREFLIGHT'|'CONFIGURATION'|'CREDENTIAL_PRESENCE'|'MERCHANT'|'LOCATION';
type S1V2Result={stage:S1V2Stage;providerDispatched:boolean;requestCount:number;
 result:S1Summary['result']|'S1_BLOCKED'|'UNKNOWN_DO_NOT_RETRY';reason:string|null;summary:S1Summary|null};
function v2Intent(request:Request):boolean{
 const url=new URL(request.url);
 return request.headers.get('X-ZAO-Acceptance')==='SQUARE_S1_V2'&&!url.search&&
  request.headers.get('sec-fetch-site')==='same-origin'&&
  (request.headers.get('origin')===url.origin||request.method==='GET'&&!request.headers.has('origin'));
}

/** GET preflight cannot dispatch: it has no fetch/transport parameter or composition. */
export function createSquareS1Preflight(env:Readonly<Record<string,string|undefined>>){
 return async(request:Request):Promise<Response>=>{
  if(env.VERCEL_ENV!=='preview')return Response.json({result:'S1_BLOCKED',reason:'NOT_FOUND'},{status:404,headers:v2Headers});
  if(request.method!=='GET'||!v2Intent(request))return Response.json({result:'S1_BLOCKED',reason:'INTENT_REQUIRED'},{status:400,headers:v2Headers});
  const preflight=squareS1Preflight(env);
  return Response.json(preflight,{status:preflight.readyForS1?200:503,headers:v2Headers});
 };
}

/** R6 only. The local durable guard remains the cross-isolate one-shot authority.
 * Counts record calls to the injected fetch, not proof of provider receipt. */
export function createSquareS1AcceptanceV2(env:Readonly<Record<string,string|undefined>>,fetch:SquareFetch){
 let attempted=false;
 return async(request:Request):Promise<Response>=>{
  let stage:S1V2Stage='RUNTIME_PREFLIGHT',requestCount=0;
  const reply=(result:S1V2Result['result'],reason:string|null,status:number,summary:S1Summary|null=null)=>
   Response.json({stage,providerDispatched:requestCount>0,requestCount,result,reason,summary} satisfies S1V2Result,{status,headers:v2Headers});
  try{
   if(env.VERCEL_ENV!=='preview')return reply('S1_BLOCKED','NOT_FOUND',404);
   if(request.method!=='POST')return reply('S1_BLOCKED','METHOD_NOT_ALLOWED',405);
   if(!v2Intent(request))return reply('S1_BLOCKED','INTENT_REQUIRED',400);
   if(!await emptyBody(request))return reply('S1_BLOCKED','BODY_FORBIDDEN',400);
   if(attempted)return reply('S1_BLOCKED','ALREADY_ATTEMPTED',409);
   const preflight=squareS1Preflight(env);
   if(!preflight.readyForS1)return reply('S1_BLOCKED',preflight.reason,503);
   stage='CREDENTIAL_PRESENCE';
   const token=env.SQUARE_SANDBOX_ACCESS_TOKEN;
   if(!token||!/^[-A-Za-z0-9._~+/=]{1,4096}$/.test(token))return reply('S1_BLOCKED','CREDENTIAL_FORMAT_INVALID',503);
   stage='CONFIGURATION';
   const transport=new FetchSquareS1Transport(()=>token,(url,init)=>{
    // The existing transport checks exact host, version, method and path first.
    stage=requestCount===0?'MERCHANT':'LOCATION';requestCount++;
    return fetch(url,init);
   });
   const service=new SquareS1Service(env.SQUARE_SANDBOX_LOCATION_ID!,transport);
   attempted=true;
   const summary=await service.run();
   if(JSON.stringify(summary).includes(token))return reply('S1_FAIL','SCHEMA_MISMATCH',422);
   if(summary.requestCount!==requestCount)return reply('UNKNOWN_DO_NOT_RETRY','DISPATCH_COUNT_MISMATCH',503);
   if(summary.reason==='NETWORK_FAILURE'||summary.reason==='UNKNOWN')return reply('UNKNOWN_DO_NOT_RETRY',summary.reason,503,summary);
   return reply(summary.result,summary.reason,summary.result==='S1_PASS'?200:422,summary);
  }catch{return reply(requestCount?'UNKNOWN_DO_NOT_RETRY':'S1_BLOCKED','INTERNAL_EXCEPTION',503);}
 };
}
