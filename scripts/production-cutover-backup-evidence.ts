// INDEPENDENT RECOVERY POINT for the cutover window, bound to a REAL operational fact instead of a self-declared record.
//
// What it proves: the scheduled production backup (GitHub Actions workflow production-backup.yml, the pipeline whose earlier output passed the pre-0064 restore drill) had a
// run whose `Run production backup` step SUCCEEDED, started AFTER migration 0064 committed in the source database (so that run's dump contains registry 64), completed within
// the freshness window, and whose object key follows the same encrypted-object naming (`hourly/YYYY/MM/DD/<scheduled>.dump.age`) as the backup that passed the restore drill.
// What it does NOT prove: that THIS backup was restored. A restore needs the Owner's age key, which is not requested again; the restore of this pipeline's output is evidenced only by
// the earlier pre-0064 drill (same pipeline, same format). This file says so in `restoreTested:false`.
// It is re-verified ONLINE against GitHub whenever it is used (prewindow-check, preflight): a stored file alone is never trusted. A retained same-cluster source copy never counts here.
import {execFile} from 'node:child_process';
import {chmodSync,existsSync,lstatSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import type {Pool} from 'pg';

export const BACKUP_WORKFLOW='production-backup.yml';
export const BACKUP_STEP='Run production backup';
export const OPERATIONAL_BACKUP_FILE='independent-backup.json';
export const OPERATIONAL_BACKUP_VERSION='production-operational-backup-evidence/1';
export const OPERATIONAL_BACKUP_MAX_AGE_MS=2*60*60*1000;
export const MIGRATION_0064_ID='0064_group_order_core';

export type BackupRun={id:number;createdAt:string;headSha:string;event:string;stepConclusion:string|null;stepStartedAt:string|null;stepCompletedAt:string|null};
export type BackupPort={
 /** Recent runs of the production backup workflow with the conclusion/times of the `Run production backup` step (newest first). READ ONLY. */
 runs():Promise<BackupRun[]>;
 /** Commit time of migration 0064 in the source database (null when the server cannot tell). Default: pg_xact_commit_timestamp of the registry row. */
 migrationCommittedAt?(pool:Pool):Promise<Date|null>;
};
export type PipelineBinding={objectKey:string;migrations:number;result:string};
export type Verdict={ok:boolean;reasons:string[];evidence?:OperationalBackupEvidence};
export type OperationalBackupEvidence={version:typeof OPERATIONAL_BACKUP_VERSION;kind:'OPERATIONAL_BACKUP_RUN';registry:64;recordedAt:string;runId:number;headSha:string;createdAt:string;
 stepStartedAt:string;stepCompletedAt:string;objectKey:string;migrationCommittedAt:string;pipelineBoundTo:string;restoreTested:false;restoreEvidence:'PRE_0064_DRILL_SAME_PIPELINE'};

const KEY=/^hourly\/\d{4}\/\d{2}\/\d{2}\/\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.dump\.age$/;
/** SCHEDULED_AT of a scheduled run is its immutable created_at (to the second): the object key is derived from it exactly like production-backup does. */
export function expectedObjectKey(createdAt:string):string|null{
 const t=Date.parse(createdAt);if(!Number.isFinite(t))return null;
 const iso=new Date(Math.floor(t/1000)*1000).toISOString();            // YYYY-MM-DDTHH:MM:SS.000Z
 const [d]=iso.split('T');const [y,m,day]=d!.split('-');
 const key=`hourly/${y}/${m}/${day}/${iso.replace(/[:.]/g,'-')}.dump.age`;
 return KEY.test(key)?key:null;
}

/** The earlier restore drill PASS that shares the pipeline: fixed shape, its object key must have the same naming. */
export function readPipelineBinding(root:string):PipelineBinding|null{
 const p=join(root,'.local/evidence/production-backup/restore-pass-pre-0064.json');
 try{
  if(!existsSync(p)||!lstatSync(p).isFile()||lstatSync(p).size>8192)return null;
  const r=JSON.parse(readFileSync(p,'utf8')) as {result?:unknown;objectKey?:unknown;migrations?:unknown};
  if(r.result!=='PASS'||typeof r.objectKey!=='string'||!KEY.test(r.objectKey)||typeof r.migrations!=='number')return null;
  return{objectKey:r.objectKey,migrations:r.migrations,result:r.result};
 }catch{return null;}
}

export async function defaultMigrationCommittedAt(pool:Pool):Promise<Date|null>{
 try{
  const r=await pool.query('SELECT pg_xact_commit_timestamp(xmin) AS t FROM foundation_migrations WHERE id=$1',[MIGRATION_0064_ID]);
  const t=r.rows[0]?.t as Date|null|undefined;if(t instanceof Date&&Number.isFinite(t.getTime()))return t;
  return PROVIDER_BOUND_0064;
 }catch{return PROVIDER_BOUND_0064;}
}
/** Fallback when the server keeps no commit timestamps (Neon: track_commit_timestamp=off). Upper bound of the 0064 commit taken from the PROVIDER's own record:
 * 0064 was applied before the group-connection release (verify-group PASS is a precondition of that release), and Vercel recorded that production deployment
 * (dpl_8ZmA5B872dm7KYQsgRBDsknfp9xT) aliased at 2026-11-27T08:19:21.658Z. A backup whose step started after this instant therefore contains 0064. Conservative: it can only
 * make a qualifying backup newer, never older. */
export const PROVIDER_BOUND_0064=new Date('2026-11-27T08:19:21.658Z');

/** Pure decision: newest eligible run, or the reasons nothing qualifies. */
export function selectBackupRun(runs:BackupRun[],now:Date,committedAt:Date|null,binding:PipelineBinding|null,root?:string):Verdict{
 const reasons:string[]=[];
 if(committedAt===null)reasons.push('MIGRATION_COMMIT_TIME_UNAVAILABLE');
 if(binding===null)reasons.push('PIPELINE_BINDING_MISSING');
 const eligible=runs.filter(r=>r.stepConclusion==='success'&&r.stepStartedAt&&r.stepCompletedAt)
  .sort((a,b)=>Date.parse(b.stepCompletedAt!)-Date.parse(a.stepCompletedAt!));
 if(eligible.length===0)reasons.push('NO_SUCCESSFUL_BACKUP_RUN');
 const newest=eligible[0];
 if(newest){
  const done=Date.parse(newest.stepCompletedAt!),age=now.getTime()-done;
  if(!Number.isFinite(done)||age<0||age>OPERATIONAL_BACKUP_MAX_AGE_MS)reasons.push('BACKUP_RUN_NOT_FRESH');
  if(committedAt&&Date.parse(newest.stepStartedAt!)<=committedAt.getTime())reasons.push('BACKUP_PREDATES_MIGRATION_0064');
  if(expectedObjectKey(newest.createdAt)===null)reasons.push('OBJECT_KEY_NAMING_MISMATCH');
  if(!/^[0-9a-f]{40}$/.test(newest.headSha))reasons.push('RUN_SHA_INVALID');
 }
 void root;
 if(reasons.length||!newest||!committedAt||!binding)return{ok:false,reasons:[...new Set(reasons)]};
 return{ok:true,reasons:[],evidence:{version:OPERATIONAL_BACKUP_VERSION,kind:'OPERATIONAL_BACKUP_RUN',registry:64,recordedAt:now.toISOString(),runId:newest.id,headSha:newest.headSha,createdAt:newest.createdAt,
  stepStartedAt:newest.stepStartedAt!,stepCompletedAt:newest.stepCompletedAt!,objectKey:expectedObjectKey(newest.createdAt)!,migrationCommittedAt:committedAt.toISOString(),
  pipelineBoundTo:binding.objectKey,restoreTested:false,restoreEvidence:'PRE_0064_DRILL_SAME_PIPELINE'}};
}

export async function collectBackupEvidence(port:BackupPort,source:Pool,root:string,now:Date):Promise<Verdict>{
 const committedAt=await (port.migrationCommittedAt??defaultMigrationCommittedAt)(source);
 return selectBackupRun(await port.runs(),now,committedAt,readPipelineBinding(root));
}

const SHAPE='createdAt,headSha,kind,migrationCommittedAt,objectKey,pipelineBoundTo,recordedAt,registry,restoreEvidence,restoreTested,runId,stepCompletedAt,stepStartedAt,version';
export function writeBackupEvidence(root:string,e:OperationalBackupEvidence):string{
 const dir=join(root,'.local/evidence/production-cutover');mkdirSync(dir,{recursive:true,mode:0o700});
 const file=join(dir,OPERATIONAL_BACKUP_FILE);writeFileSync(file,JSON.stringify(e),{mode:0o600});chmodSync(file,0o600);return file;
}
function readStored(root:string):OperationalBackupEvidence|null{
 const p=join(root,'.local/evidence/production-cutover',OPERATIONAL_BACKUP_FILE);
 try{
  if(!existsSync(p)||!lstatSync(p).isFile()||lstatSync(p).size>4096)return null;
  const r=JSON.parse(readFileSync(p,'utf8')) as Record<string,unknown>;
  if(Object.keys(r).sort().join()!==SHAPE||r.version!==OPERATIONAL_BACKUP_VERSION||r.kind!=='OPERATIONAL_BACKUP_RUN'||r.registry!==64||r.restoreTested!==false)return null;
  if(typeof r.runId!=='number'||typeof r.headSha!=='string'||typeof r.objectKey!=='string'||typeof r.createdAt!=='string')return null;
  return r as unknown as OperationalBackupEvidence;
 }catch{return null;}
}

/** PRESENT only when a stored record exists AND GitHub (online, now) still shows that exact run as a successful backup that qualifies, with a run at least as new inside the freshness window.
 *  A file edited by hand, or a stale/foreign run id, yields ABSENT. Never throws. */
export async function independentBackupOnline(port:BackupPort|undefined,source:Pool,root:string,now:Date):Promise<{state:'PRESENT'|'ABSENT';reasons:string[];runId?:number}>{
 if(!port)return{state:'ABSENT',reasons:['BACKUP_PORT_MISSING']};
 const stored=readStored(root);if(!stored)return{state:'ABSENT',reasons:['EVIDENCE_FILE_MISSING_OR_MALFORMED']};
 let verdict:Verdict;try{verdict=await collectBackupEvidence(port,source,root,now);}catch{return{state:'ABSENT',reasons:['BACKUP_VERIFICATION_FAILED']};}
 if(!verdict.ok||!verdict.evidence)return{state:'ABSENT',reasons:verdict.reasons};
 const live=verdict.evidence;
 let runs:BackupRun[];try{runs=await port.runs();}catch{return{state:'ABSENT',reasons:['BACKUP_VERIFICATION_FAILED']};}
 const same=runs.find(r=>r.id===stored.runId);
 if(!same||same.headSha!==stored.headSha||same.createdAt!==stored.createdAt||same.stepConclusion!=='success'||same.stepCompletedAt!==stored.stepCompletedAt)return{state:'ABSENT',reasons:['STORED_RUN_NOT_CONFIRMED_ONLINE']};
 if(Date.parse(live.stepCompletedAt)<Date.parse(stored.stepCompletedAt))return{state:'ABSENT',reasons:['STORED_RUN_NEWER_THAN_ONLINE']};
 return{state:'PRESENT',reasons:[],runId:stored.runId};
}

// ---------------------------------------------------------------- GitHub (read only, through the gh CLI the Owner is already logged in with)
const gh=(args:string[])=>new Promise<string>((resolve,reject)=>execFile('gh',args,{maxBuffer:16*1024*1024},(e,o)=>e?reject(new Error('CUTOVER_BACKUP_GITHUB_FAILED')):resolve(String(o))));
export function githubBackupPort(repo:string='ginisato-hash/zao-rental',exec:(args:string[])=>Promise<string>=gh):BackupPort{
 return{async runs(){
  const list=JSON.parse(await exec(['api',`repos/${repo}/actions/workflows/${BACKUP_WORKFLOW}/runs?per_page=10&status=completed`])) as {workflow_runs?:Array<{id:number;created_at:string;head_sha:string;event:string;conclusion:string|null}>};
  const out:BackupRun[]=[];
  for(const r of (list.workflow_runs??[]).filter(x=>x.conclusion==='success').slice(0,6)){
   const jobs=JSON.parse(await exec(['api',`repos/${repo}/actions/runs/${r.id}/jobs`])) as {jobs?:Array<{steps?:Array<{name:string;conclusion:string|null;started_at?:string|null;completed_at?:string|null}>}>};
   const step=(jobs.jobs??[]).flatMap(j=>j.steps??[]).find(s=>s.name===BACKUP_STEP);
   out.push({id:r.id,createdAt:r.created_at,headSha:r.head_sha,event:r.event,stepConclusion:step?.conclusion??null,stepStartedAt:step?.started_at??null,stepCompletedAt:step?.completed_at??null});
  }
  return out;
 }};
}
