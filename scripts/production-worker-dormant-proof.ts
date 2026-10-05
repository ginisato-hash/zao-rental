// Dark reach proof collector (Issue 47, TD review of PR #51, M2). The worker role credentials may be activated only after the REAL Vercel scheduler has called the dark
// deployment's /api/internal/worker-tick and the route answered `normal_worker_tick_dormant`. This module builds that proof from read-only Vercel readbacks - never from a
// hand-written file - and `provisionWorkerRoles` re-derives every claim of the record from live readbacks again (a record only names what to re-check). What it binds:
//   - the accepted merged source: the deployment's git commit (derived by the Vercel CLI from the clean checkout it deployed, never typed by a person) equals the clean,
//     current origin/main HEAD of this checkout, and the deployment is not marked dirty
//   - the exact dark deployment: READY, production target, the CURRENT production deployment of the project, with the worker-tick cron defined
//   - CRON_SECRET bound first and alone: sensitive, production only; no worker password sink, no cutoff, no activation token
//   - real scheduler traffic: the route authorises the Bearer secret BEFORE it logs anything, and CRON_SECRET is generated in memory and never shown to a person, so a
//     dormant line can only come from the platform scheduler. Beyond that, every request to the route in the window must be a GET answered 200 by this deployment with the
//     dormant event, at least three distinct minutes, one-minute cadence (a burst of manual calls is refused), the latest observation fresh, and no activated tick event
//   - protection unchanged: the project's deployment protection still reads `all`
// Anything that cannot be read back or does not match is NOT a pass; protection is never touched to obtain a proof.
import {spawn} from 'node:child_process';
import {closeSync,existsSync,fchmodSync,mkdirSync,openSync,readFileSync,renameSync,rmSync,writeSync} from 'node:fs';
import {join} from 'node:path';
import {evidenceDirectory,vercelCliPort,VERCEL_BIN,VERCEL_TARGET,WORKER_ROLES,type VercelEnvRow} from './production-worker-credential';
import {assertAcceptedMainRelease} from './lib/production-owner-session';

export const DORMANT_PROOF_VERSION='production-worker-dormant-proof/1';
export const DORMANT_EVENT='normal_worker_tick_dormant';
export const CRON_PATH='/api/internal/worker-tick';
export const CRON_SCHEDULE='* * * * *';
export const OBSERVATION_WINDOW_MINUTES=15;
export const MIN_DISTINCT_MINUTES=3;
export const OBSERVATION_FRESH_SECONDS=300;
export const PROOF_MAX_AGE_MINUTES=30;
const LOG_LIMIT=1000;
const ABSENT=Object.freeze([...WORKER_ROLES.map(r=>r.sink),'PRODUCTION_WORKER_ACCEPTED_AFTER','PRODUCTION_WORKER_TICK_ACTIVATION']);
const fail=(code:string)=>new Error('WORKER_DORMANT_PROOF_'+code);
const DEPLOYMENT_ID=/^dpl_[A-Za-z0-9]{8,64}$/;

export type DeploymentFacts={id:string;projectId:string;target:string;readyState:string;createdAt:number;gitCommitSha:string|null;gitDirty:boolean;crons:Array<{path:string;schedule:string}>};
export type ProjectFacts={id:string;productionDeploymentId:string|null;protectionType:string|null};
export type RequestLog={timestamp:number;deploymentId:string;requestMethod:string;requestPath:string;responseStatusCode:number;messages:string[]};
export interface DormantProofPort{
 deployment(id:string):Promise<DeploymentFacts>;
 project():Promise<ProjectFacts>;
 envRows():Promise<VercelEnvRow[]>;
 requestLogs(deploymentId:string,sinceMinutes:number):Promise<RequestLog[]>;
}
export type ProofFacts={releaseSha:string;deploymentId:string};
export type DormantProof={version:typeof DORMANT_PROOF_VERSION;result:'DORMANT_LOG_OBSERVED';event:typeof DORMANT_EVENT;releaseSha:string;deploymentId:string;projectId:string;deploymentCreatedAt:string;
 protection:'all';cronSecret:'sensitive:production';absentAtProof:string[];observations:{count:number;distinctMinutes:number;firstAt:string;lastAt:string};observedAt:string};
const KEYS=['absentAtProof','cronSecret','deploymentCreatedAt','deploymentId','event','observations','observedAt','projectId','protection','releaseSha','result','version'];

/** Everything that can be proven without logs; also re-run live by the provision gate so a deployment that is no longer current cannot activate the roles. */
async function liveState(port:DormantProofPort,facts:ProofFacts){
 if(!/^[a-f0-9]{40}$/.test(facts.releaseSha)||!DEPLOYMENT_ID.test(facts.deploymentId))throw fail('FACTS_INVALID');
 const dep=await port.deployment(facts.deploymentId);
 if(dep.id!==facts.deploymentId||dep.projectId!==VERCEL_TARGET.project)throw fail('DEPLOYMENT_MISMATCH');
 if(dep.target!=='production'||dep.readyState!=='READY')throw fail('DEPLOYMENT_NOT_READY_PRODUCTION');
 if(dep.gitCommitSha!==facts.releaseSha||dep.gitDirty)throw fail('WRONG_SOURCE');
 if(!dep.crons.some(c=>c.path===CRON_PATH&&c.schedule===CRON_SCHEDULE))throw fail('CRON_NOT_DEFINED');
 const project=await port.project();
 if(project.id!==VERCEL_TARGET.project||project.productionDeploymentId!==facts.deploymentId)throw fail('NOT_CURRENT_DEPLOYMENT');
 if(project.protectionType!=='all')throw fail('PROTECTION_NOT_ALL');
 const rows=await port.envRows();
 const cron=rows.filter(r=>r.key==='CRON_SECRET');
 if(cron.length!==1||cron[0]!.type!=='sensitive'||JSON.stringify(cron[0]!.target)!==JSON.stringify([VERCEL_TARGET.environment]))throw fail('CRON_SECRET_NOT_FIRST_AND_SENSITIVE');
 if(ABSENT.some(n=>rows.some(r=>r.key===n)))throw fail('ACTIVATION_NAME_ALREADY_BOUND');
 return dep;
}
const eventOf=(message:string)=>{try{const v=JSON.parse(message) as {event?:unknown};return typeof v?.event==='string'?v.event:null;}catch{return null;}};

/** Reads the dark deployment's request log for the route and applies every rule to ALL of it; returns only what the rules proved. */
async function observe(port:DormantProofPort,facts:ProofFacts,windowMinutes:number,now:Date){
 const dep=await liveState(port,facts);
 const logs=(await port.requestLogs(facts.deploymentId,windowMinutes)).filter(l=>l.requestPath===CRON_PATH);
 if(!logs.length)throw fail('NO_REQUESTS_OBSERVED');
 // Every request to the route must be a GET answered 200 by this deployment with the dormant event. A 401 (a call without the secret), another status, another method or a
 // 200 without the event means something other than the dormant scheduler path was reached; that is not proof.
 for(const l of logs)if(l.requestMethod!=='GET'||l.responseStatusCode!==200||l.deploymentId!==facts.deploymentId||!Number.isFinite(l.timestamp))throw fail('UNEXPECTED_REQUEST');
 const names=logs.map(l=>l.messages.map(eventOf));
 if(names.some(n=>n.includes('normal_worker_tick')))throw fail('ACTIVATED_TICK_OBSERVED');
 if(names.some(n=>!n.includes(DORMANT_EVENT)))throw fail('REQUEST_WITHOUT_DORMANT_EVENT');
 const times=logs.map(l=>l.timestamp).sort((a,b)=>a-b);
 // The scheduler fires once a minute (it may deliver a minute twice or skip one): distinct minutes, no gap wider than one missed tick.
 const minutes=[...new Set(times.map(t=>Math.floor(t/60_000)))];
 if(minutes.length<MIN_DISTINCT_MINUTES)throw fail('TOO_FEW_OBSERVATIONS');
 for(let i=1;i<minutes.length;i++)if(minutes[i]!-minutes[i-1]!>2)throw fail('CADENCE_NOT_SCHEDULER');
 const last=times[times.length-1]!,at=now.getTime();
 if(at-last>OBSERVATION_FRESH_SECONDS*1000||last-at>60_000)throw fail('OBSERVATION_STALE');
 return {dep,times,minutes:minutes.length};
}

export async function collectDormantProof(port:DormantProofPort,facts:ProofFacts,now:()=>Date=()=>new Date()):Promise<DormantProof>{
 const at=now(),{dep,times,minutes}=await observe(port,facts,OBSERVATION_WINDOW_MINUTES,at);
 return {version:DORMANT_PROOF_VERSION,result:'DORMANT_LOG_OBSERVED',event:DORMANT_EVENT,releaseSha:facts.releaseSha,deploymentId:facts.deploymentId,projectId:VERCEL_TARGET.project,
  deploymentCreatedAt:new Date(dep.createdAt).toISOString(),protection:'all',cronSecret:'sensitive:production',absentAtProof:[...ABSENT],
  observations:{count:times.length,distinctMinutes:minutes,firstAt:new Date(times[0]!).toISOString(),lastAt:new Date(times[times.length-1]!).toISOString()},observedAt:at.toISOString()};
}

/** The gate used before any worker credential is minted. A record is only a claim: it must have exactly this structure, be fresh, name this accepted source and deployment, AND
 *  every number in it is re-derived from live Vercel readbacks (current deployment, protection, env state and the request log itself). A hand-written file cannot satisfy that. */
export async function verifyDormantProof(raw:unknown,port:DormantProofPort,facts:ProofFacts,now:()=>Date=()=>new Date()):Promise<DormantProof>{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw fail('SHAPE_INVALID');
 const r=raw as Record<string,unknown>;
 if(JSON.stringify(Object.keys(r).sort())!==JSON.stringify(KEYS))throw fail('SHAPE_INVALID');
 if(r.version!==DORMANT_PROOF_VERSION||r.result!=='DORMANT_LOG_OBSERVED'||r.event!==DORMANT_EVENT||r.protection!=='all'||r.cronSecret!=='sensitive:production')throw fail('SHAPE_INVALID');
 if(r.releaseSha!==facts.releaseSha)throw fail('WRONG_SOURCE');
 if(r.deploymentId!==facts.deploymentId||r.projectId!==VERCEL_TARGET.project)throw fail('DEPLOYMENT_MISMATCH');
 if(JSON.stringify(r.absentAtProof)!==JSON.stringify([...ABSENT]))throw fail('SHAPE_INVALID');
 const o=r.observations as {count?:unknown;distinctMinutes?:unknown;firstAt?:unknown;lastAt?:unknown}|null;
 if(!o||!Number.isInteger(o.count)||(o.count as number)<MIN_DISTINCT_MINUTES||!Number.isInteger(o.distinctMinutes)||(o.distinctMinutes as number)<MIN_DISTINCT_MINUTES)throw fail('SHAPE_INVALID');
 const t=(v:unknown)=>{const x=typeof v==='string'?Date.parse(v):NaN;if(!Number.isFinite(x)||new Date(x).toISOString()!==v)throw fail('SHAPE_INVALID');return x;};
 const first=t(o.firstAt),last=t(o.lastAt),observed=t(r.observedAt),created=t(r.deploymentCreatedAt),at=now();
 if(first>last||last>observed||created>first)throw fail('SHAPE_INVALID');
 if(at.getTime()-observed>PROOF_MAX_AGE_MINUTES*60_000||observed-at.getTime()>60_000)throw fail('STALE');
 // Re-derive from the log, over a window that reaches back to the record's first observation.
 const window=Math.min(60,Math.ceil((at.getTime()-first)/60_000)+2);
 const live=await observe(port,facts,window,at);
 const covered=live.times.filter(x=>x<=last);
 if(live.times[0]!==first||covered.length!==o.count||new Date(live.dep.createdAt).toISOString()!==r.deploymentCreatedAt)throw fail('RECORD_NOT_IN_LOG');
 return r as unknown as DormantProof;
}

// ---------------------------------------------------------------- production port (Vercel CLI, read-only; stdout captured in memory)
export function vercelProofCliPort(bin:string=VERCEL_BIN,env:NodeJS.ProcessEnv=process.env):DormantProofPort{
 const run=(args:string[])=>new Promise<string>((resolve,reject)=>{
  const child=spawn(bin,args,{env,stdio:['ignore','pipe','pipe'],windowsHide:true});let out='';
  child.stdout.on('data',d=>{if(out.length<16<<20)out+=String(d);});child.stderr.on('data',()=>{});
  child.on('error',()=>reject(fail('VERCEL_CALL_FAILED')));child.on('close',code=>code===0?resolve(out):reject(fail('VERCEL_CALL_FAILED')));
 });
 const json=async(args:string[])=>{try{return JSON.parse(await run(args)) as Record<string,unknown>;}catch(e){throw (e as Error).message.startsWith('WORKER_DORMANT_PROOF_')?e:fail('VERCEL_RESPONSE_UNPARSEABLE');}};
 const scope=['--scope',VERCEL_TARGET.scope];
 return {
  async deployment(id){
   const d=await json(['api',`/v13/deployments/${id}`,'--raw',...scope]);
   const meta=(d.meta&&typeof d.meta==='object'?d.meta:{}) as Record<string,unknown>;
   const crons=Array.isArray(d.crons)?(d.crons as Array<Record<string,unknown>>).map(c=>({path:String(c.path),schedule:String(c.schedule)})):[];
   return {id:String(d.id),projectId:String(d.projectId),target:String(d.target),readyState:String(d.readyState??d.status),createdAt:Number(d.createdAt),
    gitCommitSha:typeof meta.gitCommitSha==='string'?meta.gitCommitSha:null,gitDirty:meta.gitDirty!==undefined&&meta.gitDirty!=='0'&&meta.gitDirty!==false,crons};
  },
  async project(){
   const p=await json(['api',`/v9/projects/${VERCEL_TARGET.project}`,'--raw',...scope]);
   const targets=(p.targets&&typeof p.targets==='object'?p.targets:{}) as Record<string,{id?:unknown}|null>;
   const sso=p.ssoProtection&&typeof p.ssoProtection==='object'?(p.ssoProtection as {deploymentType?:unknown}).deploymentType:null;
   return {id:String(p.id),productionDeploymentId:typeof targets.production?.id==='string'?targets.production.id:null,protectionType:typeof sso==='string'?sso:null};
  },
  envRows:()=>vercelCliPort(bin,env).envRows(),
  async requestLogs(deploymentId,sinceMinutes){
   const text=await run(['logs','--json','--project',VERCEL_TARGET.project,...scope,'--deployment',deploymentId,'--since',`${sinceMinutes}m`,'--limit',String(LOG_LIMIT)]);
   const out:RequestLog[]=[];
   for(const line of text.split('\n')){
    if(!line.startsWith('{'))continue;
    let e:Record<string,unknown>;try{e=JSON.parse(line);}catch{continue;}
    const messages:string[]=[];
    if(typeof e.message==='string'&&e.message)messages.push(e.message);
    if(Array.isArray(e.logs))for(const l of e.logs)if(typeof l==='string')messages.push(l);else if(l&&typeof (l as {message?:unknown}).message==='string')messages.push((l as {message:string}).message);
    out.push({timestamp:Number(e.timestamp),deploymentId:String(e.deploymentId),requestMethod:String(e.requestMethod),requestPath:String(e.requestPath),responseStatusCode:Number(e.responseStatusCode),messages});
   }
   if(out.length>=LOG_LIMIT)throw fail('LOG_TRUNCATED');
   return out;
  },
 };
}

export const deploymentIdFile=(dir:string)=>join(dir,'dark-deployment-id.txt');
export const proofFile=(dir:string)=>join(dir,'dormant-proof.json');
export function readDeploymentId(dir:string):string{
 const text=readFileSync(deploymentIdFile(dir),'utf8').replace(/\r?\n$/,'');
 if(!DEPLOYMENT_ID.test(text))throw fail('FACTS_INVALID');
 return text;
}
/** Atomic create-or-replace (0600): a fresh collection supersedes an older record; a record is never edited in place. */
export function writeProof(dir:string,proof:DormantProof){
 mkdirSync(dir,{recursive:true,mode:0o700});
 const tmp=proofFile(dir)+`.tmp-${process.pid}`;
 const fd=openSync(tmp,'wx',0o600);
 try{fchmodSync(fd,0o600);writeSync(fd,JSON.stringify(proof)+'\n');}finally{closeSync(fd);}
 renameSync(tmp,proofFile(dir));
}

/** Used by `provisionWorkerRoles` right before any worker credential is minted: the recorded proof must be machine-collected, fresh and still true against live Vercel state. */
export async function verifyRecordedDormantProof(root:string=process.cwd(),port:DormantProofPort=vercelProofCliPort(),releaseSha:string=assertAcceptedMainRelease(),now:()=>Date=()=>new Date()):Promise<DormantProof>{
 const dir=evidenceDirectory(root);
 let raw:unknown;try{raw=JSON.parse(readFileSync(proofFile(dir),'utf8'));}catch{throw fail('PROOF_MISSING');}
 return verifyDormantProof(raw,port,{releaseSha,deploymentId:readDeploymentId(dir)},now);
}

export async function main(argv:string[],root:string=process.cwd(),port?:DormantProofPort){
 if(argv.length)throw fail('ARGUMENTS_REFUSED');
 const dir=evidenceDirectory(root);
 if(!existsSync(deploymentIdFile(dir)))throw fail('DEPLOYMENT_ID_MISSING');
 const releaseSha=assertAcceptedMainRelease();
 const chosen=port??vercelProofCliPort();
 try{
  const proof=await collectDormantProof(chosen,{releaseSha,deploymentId:readDeploymentId(dir)});
  writeProof(dir,proof);
  console.log(JSON.stringify({version:proof.version,state:'DORMANT_PROOF_COLLECTED',deploymentId:proof.deploymentId,observations:proof.observations}));
 }catch(error){rmSync(proofFile(dir)+`.tmp-${process.pid}`,{force:true});throw error;}
}
if(process.argv[1]&&new URL(import.meta.url).pathname===process.argv[1]){
 main(process.argv.slice(2)).catch(error=>{
  const m=String((error as Error)?.message??'');
  console.error(JSON.stringify({state:'FAILED',code:/^(WORKER_DORMANT_PROOF|PRODUCTION_INSTALL)_[A-Z_]{1,60}$/.test(m)?m:'WORKER_DORMANT_PROOF_FAILED'}));
  process.exitCode=1;
 });
}
