import {execFile} from 'node:child_process';
import {isAbsolute} from 'node:path';
const PROJECT='prj_whzxwR1vj0CBBnm1UD6dz5ALPMbA',TEAM='team_PVka5z4T6OMKBmUcqrK09yJz';
const ENDPOINT='/v10/projects/'+PROJECT+'/env?teamId='+TEAM;
const KEY='SQUARE_SANDBOX_WEBHOOK_SIGNATURE_KEY';
const URL='https://zao-rental-webhook-sandbox.vercel.app/api/webhooks/square';
export type SignatureKeySink={persist(key:string):Promise<void>};
export type CliPipe=(args:readonly string[],stdin:string)=>Promise<string>;
/** Fixed project, key, Sensitive type and Sandbox-only ingress target. No upsert,
 * arbitrary endpoint, argv secret or provider response is returned to the caller. */
export function signatureKeySink(pipe:CliPipe):SignatureKeySink{
 return {async persist(key){
  try{
   const raw=await pipe(['api',ENDPOINT,'--method','POST','--input','-','--raw','--scope','zao-food-map','--non-interactive'],JSON.stringify({key:KEY,value:key,type:'sensitive',target:['production']}));
   const body=JSON.parse(raw),v=body.created;
   if(body.error||body.errors?.length||!v||v.key!==KEY||v.type!=='sensitive'||v.target?.length!==1||v.target[0]!=='production'||typeof v.id!=='string')throw new Error();
  }catch{throw new Error('R15_SECRET_PERSIST_UNKNOWN_RECONCILE_METADATA_ONLY');}
 }};
}
/** Parent operator only. Existing CLI auth, no token extraction, shell or debug.
 * stdout/stderr are bounded RAM only; every CLI failure becomes a fixed class.
 * Caller supplies the verified installed CLI path and an empty operator directory.
 * This factory does not run a process or contact a provider until persist is called. */
export function vercelSignatureKeySink(cliFile:string,emptyDirectory:string):SignatureKeySink{
 if(!isAbsolute(cliFile)||!isAbsolute(emptyDirectory))throw new Error('R15_OPERATOR_PATH_REQUIRED');
 return signatureKeySink((args,stdin)=>new Promise<string>((resolve,reject)=>{
  const env={NODE_ENV:'production' as const,...Object.fromEntries(['HOME','PATH','TMPDIR','LANG'].flatMap(k=>process.env[k]===undefined?[]:[[k,process.env[k]!]]))};
  const child=execFile(process.execPath,[cliFile,...args],{cwd:emptyDirectory,env,timeout:30000,maxBuffer:262144,encoding:'utf8'},(error,stdout)=>{
   if(error)reject(new Error('R15_SECRET_CLI_UNKNOWN'));else resolve(stdout);
  });
  child.stdin?.on('error',()=>reject(new Error('R15_SECRET_PIPE_UNKNOWN')));
  child.stdin?.end(stdin);
 }));
}
/** Directly consumes the parsed create-subscription response in memory. Do not
 * log, stringify or save it. No key/response/exception is exposed by this boundary.
 * Rejected/unknown persistence MUST NOT trigger subscription/key regeneration. */
export async function handoffR15Signature(response:unknown,sink:SignatureKeySink){
 try{
  if(!response||typeof response!=='object')throw new Error();
  const body=response as {errors?:unknown[];subscription?:{id?:unknown;enabled?:unknown;api_version?:unknown;notification_url?:unknown;event_types?:unknown;signature_key?:unknown}};
  const s=body.subscription;
  if(body.errors?.length||!s||typeof s.id!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(s.id)||s.enabled!==true||s.api_version!=='2026-08-19'||s.notification_url!==URL
   ||!Array.isArray(s.event_types)||s.event_types.length!==2||!s.event_types.includes('payment.created')||!s.event_types.includes('payment.updated')
   ||typeof s.signature_key!=='string'||s.signature_key.length<16||s.signature_key.length>512||!/^[\x21-\x7e]+$/.test(s.signature_key))throw new Error();
  await sink.persist(s.signature_key);
  return {state:'PERSISTED_AWAITING_METADATA_READBACK' as const,projectId:PROJECT,keyName:KEY};
 }catch{throw new Error('R15_SIGNATURE_HANDOFF_STOP_RECONCILE_NO_RETRY');}
}
