import {sandboxAcceptanceEnvironment} from '../../../../packages/core/src/payment/sandbox-environment';
import {FetchSquareS1Transport,type SquareFetch} from '../../../../packages/core/src/payment/square-transport';
import {SquareS1Service} from '../../../../packages/core/src/payment/square-s1';

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
