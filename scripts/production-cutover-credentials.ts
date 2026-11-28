// Credential issuance for the NEW database's runtime roles (Issue #47 / TD #7219973419 §2-B; design: docs/execution/group/CUTOVER_BINDINGS.md, CUTOVER_RUNBOOK.md).
// Issues one fresh secret per NEW_SECRET Vercel sink of cutover-bindings (12 DB passwords + 3 worker passwords on the main project, the receiver URL on the webhook project),
// BEFORE the stop window, without ever making a role usable:
//  - the secret is generated in memory (32 random bytes) and set on the role through the new database's manager (`ALTER ROLE ... NOLOGIN PASSWORD ...`); this is the same
//    manager path the existing credential lifecycles use for the temporary password, and it avoids Neon's reset_password on a NOLOGIN role (a known first-attempt failure);
//  - the role stays NOLOGIN: no LOGIN, no lease, no connection is made with the new secret (the window grants LOGIN after its activation boundary);
//  - the secret goes to Vercel only as a request body on stdin (type sensitive, target production, upsert); it never appears in argv, a file, a log or an output;
//  - Vercel applies environment values only to NEW deployments: the running Production deployment, the Webhook ingress and the cron keep their current values until the
//    candidate is built in the window. Do not deploy either project between this command and the switch;
//  - backup sinks are NOT touched here (the scheduled GitHub backup reads them at every run: they move inside the window, see production-cutover-window-hooks.ts).
// Per sink: read-back of the sink METADATA (exactly one row, sensitive, production only, updatedAt moved forward; the value is never read), a durable per-sink state
// (PASSWORD_SET -> SINK_WRITTEN) written atomically, re-runs skip finished sinks and re-issue (at most 2 attempts) only a sink whose write was not confirmed.
import {execFile,spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {chmodSync,existsSync,lstatSync,mkdirSync,readFileSync,renameSync,writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {buildBindingTable,collectVercelMetadata,CUTOVER_TARGETS,MAIN_PROJECT,SOURCE_DATABASE,WEBHOOK_PROJECT,type EnvMeta,type Row} from './production-cutover-bindings';
import {BACKUP_CREDENTIAL_TARGET as T} from './production-backup-credential';
import {assertProductionHost,assertProductionHostFingerprint,assertProductionPort} from './production-backup';

export const CREDENTIALS_VERSION='production-cutover-credentials/1';
export const CREDENTIALS_STATE_FILE='credentials-state.json';
export const MAX_ATTEMPTS=2;
const fail=(code:string)=>new Error(code);
const SAFE=/^PRODUCTION_CUTOVER_CREDENTIALS_[A-Z0-9_]{1,80}$/;
const qi=(v:string)=>{if(!/^[a-z][a-z0-9_]{2,62}$/.test(v))throw fail('PRODUCTION_CUTOVER_CREDENTIALS_NAME_INVALID');return '"'+v+'"';};

export type Sink={id:string;project:typeof MAIN_PROJECT|typeof WEBHOOK_PROJECT;key:string;role:string;lane:string};
/** The exact sinks this command may write: every Vercel NEW_SECRET row of the binding table, nothing else (checked, not assumed). */
export function credentialSinks(target:string):Sink[]{
 const table=buildBindingTable(SOURCE_DATABASE,target);
 const rows=table.rows.filter((r:Row)=>r.change==='NEW_SECRET'&&r.sink?.kind==='VERCEL_ENV');
 const sinks=rows.map(r=>{
  const s=r.sink as {kind:'VERCEL_ENV';project:typeof MAIN_PROJECT|typeof WEBHOOK_PROJECT;key:string};
  if(!r.newRole)throw fail('PRODUCTION_CUTOVER_CREDENTIALS_BINDING_INVALID');
  return {id:r.id,project:s.project,key:s.key,role:r.newRole,lane:r.lane};
 });
 const main=sinks.filter(s=>s.project===MAIN_PROJECT),hook=sinks.filter(s=>s.project===WEBHOOK_PROJECT);
 const okMain=main.filter(s=>/^PRODUCTION_DB_PASSWORD_[A-Z_]+$/.test(s.key)).length===12&&main.filter(s=>/^PRODUCTION_WORKER_DB_PASSWORD_[A-Z]+$/.test(s.key)).length===3&&main.length===15;
 const okHook=hook.length===1&&hook[0]!.key==='PRODUCTION_RECEIVER_DATABASE_URL';
 if(!okMain||!okHook||new Set(sinks.map(s=>s.key)).size!==sinks.length||sinks.some(s=>!s.role.startsWith(target+'_')||/backup|owner|role_admin/.test(s.role)))throw fail('PRODUCTION_CUTOVER_CREDENTIALS_BINDING_INVALID');
 return sinks;
}

// ---------------------------------------------------------------- ports
export interface SqlSession{query<R=Record<string,unknown>>(sql:string,params?:unknown[]):Promise<{rows:R[]}>;end():Promise<void>}
export interface VercelWritePort{
 /** Upserts a sensitive Production variable; the value travels only as the request body on stdin. */
 upsertSensitive(project:string,key:string,value:string):Promise<void>;
 /** Metadata only (key/type/target/updatedAt). */
 metadata(project:string):Promise<EnvMeta[]>;
}
export interface NeonReadPort{get(path:string):Promise<unknown>}
export interface CredentialPorts{
 neon:NeonReadPort;vercel:VercelWritePort;
 /** Owner session on the NEW database (verify-full TLS, host pinned) — production adapter reuses the cutover runner's admission. */
 openOwner(database:string):Promise<SqlSession>;
 release():string;now():Date;
 root:string;
 /** Test seam only: replaces the pinned host admission (production never sets it; the CLI does not). */
 admitHost?:(host:string)=>void;
}
export type ItemState={status:'PASSWORD_SET'|'SINK_WRITTEN';attempts:number;passwordSetAt?:string;sinkWrittenAt?:string};
export type CredentialState={version:typeof CREDENTIALS_VERSION;target:string;startedAt:string;items:Record<string,ItemState>};

// ---------------------------------------------------------------- durable state
const stateDir=(root:string)=>join(root,'.local/evidence/production-cutover');
function readState(root:string,target:string,now:Date):CredentialState{
 const p=join(stateDir(root),CREDENTIALS_STATE_FILE);
 if(!existsSync(p))return {version:CREDENTIALS_VERSION,target,startedAt:now.toISOString(),items:{}};
 try{
  if(!lstatSync(p).isFile()||lstatSync(p).size>65536)throw 0;
  const s=JSON.parse(readFileSync(p,'utf8')) as CredentialState;
  if(s.version!==CREDENTIALS_VERSION||s.target!==target||typeof s.items!=='object'||s.items===null)throw 0;
  return s;
 }catch{throw fail('PRODUCTION_CUTOVER_CREDENTIALS_STATE_INVALID');}
}
function writeState(root:string,s:CredentialState){
 const dir=stateDir(root);mkdirSync(dir,{recursive:true,mode:0o700});
 const p=join(dir,CREDENTIALS_STATE_FILE),tmp=p+'.tmp';
 writeFileSync(tmp,JSON.stringify(s),{mode:0o600});chmodSync(tmp,0o600);renameSync(tmp,p);
}

// ---------------------------------------------------------------- target admission (names/ids only)
type Json=Record<string,unknown>;
const obj=(v:unknown):Json=>{if(!v||typeof v!=='object'||Array.isArray(v))throw fail('PRODUCTION_CUTOVER_CREDENTIALS_TARGET_MISMATCH');return v as Json;};
export async function verifyTarget(p:Pick<CredentialPorts,'neon'|'admitHost'>,target:string,roles:string[]){
 const base=`/projects/${T.project}`,branch=`${base}/branches/${T.branch}`;
 if(obj(obj(await p.neon.get(base)).project).id!==T.project)throw fail('PRODUCTION_CUTOVER_CREDENTIALS_TARGET_MISMATCH');
 if(obj(obj(await p.neon.get(branch)).branch).id!==T.branch)throw fail('PRODUCTION_CUTOVER_CREDENTIALS_TARGET_MISMATCH');
 const d=obj(obj(await p.neon.get(`${branch}/databases/${target}`)).database);
 if(d.name!==target||d.owner_name!==T.owner)throw fail('PRODUCTION_CUTOVER_CREDENTIALS_TARGET_MISMATCH');
 const have=obj(await p.neon.get(`${branch}/roles`)).roles;
 const names=Array.isArray(have)?have.map(r=>obj(r).name):[];
 for(const need of [T.owner,target+'_role_admin',...roles])if(!names.includes(need))throw fail('PRODUCTION_CUTOVER_CREDENTIALS_TARGET_MISMATCH');
 const eps=obj(await p.neon.get(`${branch}/endpoints`)).endpoints;
 const rw=(Array.isArray(eps)?eps:[]).map(obj).filter(e=>e.type==='read_write'&&e.branch_id===T.branch);
 if(rw.length!==1||typeof rw[0]!.host!=='string')throw fail('PRODUCTION_CUTOVER_CREDENTIALS_ENDPOINT_AMBIGUOUS');
 const host=(rw[0]!.host as string).trim().toLowerCase();
 if(p.admitHost)p.admitHost(host);
 else{assertProductionHost(host);assertProductionPort(T.port);assertProductionHostFingerprint(host);}
 return host;
}

/** Connection URI of the receiver role on the NEW database: direct host, verify-full. Built only in memory. */
export function receiverUri(role:string,password:string,host:string,database:string){
 const u=new URL('postgresql://placeholder/');u.hostname=host;u.username=role;u.password=password;u.pathname='/'+database;u.search='?sslmode=verify-full';
 return u.toString();
}

const lookup=(rows:EnvMeta[],key:string)=>rows.filter(r=>r.key===key);
/** Sink metadata acceptable after a write: exactly one row, sensitive, production only, updated at/after the write started. */
export function sinkWritten(rows:EnvMeta[],key:string,since:number){
 const m=lookup(rows,key);
 return m.length===1&&m[0]!.type==='sensitive'&&m[0]!.target==='production'&&typeof m[0]!.updatedAt==='number'&&(m[0]!.updatedAt as number)>=since;
}

export type IssueResult={target:string;issued:string[];skipped:string[];total:number;rolesStillNologin:true;backupSinksTouched:0;valuesOutput:0};

export async function issueCredentials(p:CredentialPorts,target:string):Promise<IssueResult>{
 if(!(CUTOVER_TARGETS as readonly string[]).includes(target))throw fail('PRODUCTION_CUTOVER_CREDENTIALS_TARGET_REFUSED');
 p.release();
 const sinks=credentialSinks(target);
 const host=await verifyTarget(p,target,sinks.map(s=>s.role));
 const state=readState(p.root,target,p.now());
 // Every sink must already exist (sensitive, production only): this tool replaces values, it does not create variables or widen scopes.
 const before:Record<string,EnvMeta[]>={[MAIN_PROJECT]:await p.vercel.metadata(MAIN_PROJECT),[WEBHOOK_PROJECT]:await p.vercel.metadata(WEBHOOK_PROJECT)};
 for(const s of sinks){const m=lookup(before[s.project]!,s.key);if(m.length!==1||m[0]!.type!=='sensitive'||m[0]!.target!=='production')throw fail('PRODUCTION_CUTOVER_CREDENTIALS_SINK_SHAPE');}
 const owner=await p.openOwner(target);
 const issued:string[]=[],skipped:string[]=[];
 try{
  const manager=target+'_role_admin';
  for(const s of sinks){
   const item=state.items[s.id];
   if(item?.status==='SINK_WRITTEN'){
    const since=Date.parse(item.sinkWrittenAt??'');
    if(Number.isFinite(since)&&sinkWritten(await p.vercel.metadata(s.project),s.key,since-5000)){skipped.push(s.key);continue;}
    // The recorded write is no longer visible in the metadata: treat as unconfirmed and re-issue.
   }
   if((item?.attempts??0)>=MAX_ATTEMPTS)throw fail('PRODUCTION_CUTOVER_CREDENTIALS_ATTEMPTS_EXHAUSTED');
   const posture=(await owner.query<{rolcanlogin:boolean}>('SELECT rolcanlogin FROM pg_roles WHERE rolname=$1',[s.role])).rows;
   if(posture.length!==1)throw fail('PRODUCTION_CUTOVER_CREDENTIALS_ROLE_MISSING');
   if(posture[0]!.rolcanlogin)throw fail('PRODUCTION_CUTOVER_CREDENTIALS_ROLE_ALREADY_LOGIN');
   const attempts=(item?.attempts??0)+1;
   let password=randomBytes(32).toString('base64url');
   let value='';
   try{
    await owner.query('BEGIN READ WRITE');
    try{
     await owner.query(`SET LOCAL ROLE ${qi(manager)}`);
     await owner.query(`ALTER ROLE ${qi(s.role)} NOLOGIN PASSWORD '${password}' VALID UNTIL 'infinity'`);
     await owner.query('COMMIT');
    }catch{try{await owner.query('ROLLBACK');}catch{/* gone */}throw fail('PRODUCTION_CUTOVER_CREDENTIALS_SQL_FAILED');}
    state.items[s.id]={status:'PASSWORD_SET',attempts,passwordSetAt:p.now().toISOString()};writeState(p.root,state);
    value=s.lane==='receiver'?receiverUri(s.role,password,host,target):password;
    const since=p.now().getTime();
    await p.vercel.upsertSensitive(s.project,s.key,value);
    if(!sinkWritten(await p.vercel.metadata(s.project),s.key,since-5000))throw fail('PRODUCTION_CUTOVER_CREDENTIALS_SINK_READBACK_FAILED');
    state.items[s.id]={status:'SINK_WRITTEN',attempts,...(state.items[s.id]!.passwordSetAt?{passwordSetAt:state.items[s.id]!.passwordSetAt as string}:{}),sinkWrittenAt:p.now().toISOString()};writeState(p.root,state);
    issued.push(s.key);
   }finally{password='';value='';}
  }
  // Posture after: every issued role is still NOLOGIN.
  const after=(await owner.query<{rolname:string;rolcanlogin:boolean}>('SELECT rolname,rolcanlogin FROM pg_roles WHERE rolname=ANY($1)',[sinks.map(s=>s.role)])).rows;
  if(after.length!==sinks.length||after.some(r=>r.rolcanlogin))throw fail('PRODUCTION_CUTOVER_CREDENTIALS_LOGIN_STATE');
 }finally{await owner.end().catch(()=>undefined);}
 return {target,issued,skipped,total:sinks.length,rolesStillNologin:true,backupSinksTouched:0,valuesOutput:0};
}

// ---------------------------------------------------------------- production adapters (child stdout is captured, never inherited; only fixed codes leave)
const NEON_BIN=join(homedir(),'.npm/_npx/978debf9b3a75271/node_modules/.bin/neon');
const NEON_GET=(target:string)=>[new RegExp(`^/projects/${T.project}$`),new RegExp(`^/projects/${T.project}/branches/${T.branch}$`),
 new RegExp(`^/projects/${T.project}/branches/${T.branch}/(databases/${target}|roles|endpoints)$`)];
export function neonReadPort(target:string,bin:string=NEON_BIN,env:NodeJS.ProcessEnv=process.env):NeonReadPort{
 const allowed=NEON_GET(target);
 return {get:path=>{
  if(typeof path!=='string'||!allowed.some(r=>r.test(path)))return Promise.reject(fail('PRODUCTION_CUTOVER_CREDENTIALS_NEON_PATH_REFUSED'));
  return new Promise((resolve,reject)=>execFile(bin,['api',path],{env,maxBuffer:1<<20,timeout:90_000,encoding:'utf8',windowsHide:true},(error,stdout)=>{
   if(error)return reject(fail('PRODUCTION_CUTOVER_CREDENTIALS_NEON_CALL_FAILED'));
   try{resolve(JSON.parse(stdout));}catch{reject(fail('PRODUCTION_CUTOVER_CREDENTIALS_NEON_RESPONSE_UNPARSEABLE'));}
  }));
 }};
}
const VERCEL_BIN=join(homedir(),'.npm/_npx/69f9afb961c37556/node_modules/.bin/vercel');
export function vercelWritePort(sinks:Sink[],bin:string=VERCEL_BIN,env:NodeJS.ProcessEnv=process.env):VercelWritePort{
 const keys=new Map(sinks.map(s=>[s.project+'|'+s.key,s]));
 return {
  upsertSensitive:(project,key,value)=>new Promise<void>((resolve,reject)=>{
   if(!keys.has(project+'|'+key))return reject(fail('PRODUCTION_CUTOVER_CREDENTIALS_SINK_REFUSED'));
   const child=spawn(bin,['api',`/v10/projects/${project}/env?upsert=true`,'-X','POST','--input','-','--silent','--scope','zao-food-map'],{env,stdio:['pipe','pipe','pipe'],windowsHide:true});
   child.stdout.on('data',()=>{});child.stderr.on('data',()=>{});
   child.on('error',()=>reject(fail('PRODUCTION_CUTOVER_CREDENTIALS_VERCEL_CALL_FAILED')));
   child.on('close',code=>code===0?resolve():reject(fail('PRODUCTION_CUTOVER_CREDENTIALS_VERCEL_CALL_FAILED')));
   child.stdin.on('error',()=>{});
   child.stdin.end(JSON.stringify({key,value,type:'sensitive',target:['production']}));
  }),
  metadata:project=>collectVercelMetadata(project),
 };
}

export function safeCode(e:unknown){const m=String((e as Error)?.message??'');return SAFE.test(m)?m:'PRODUCTION_CUTOVER_CREDENTIALS_FAILED';}
