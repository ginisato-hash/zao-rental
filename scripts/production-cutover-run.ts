// Production runner for the cutover to a freshly bootstrapped 0001–0065 database (Issue #47 / TD #7214138953 §A; design: docs/execution/group/CUTOVER_RUNBOOK.md).
// Five commands, no secrets in argv/env/files: `preflight` (READ ONLY measurement), `bootstrap-target` (creates the NEW database and builds it with the proven bootstrap),
// `copy-and-switch` (fence → copy → reconcile → enable writes; stops BEFORE the Owner changes credentials), `verify-target` (READ ONLY) and `rollback` (only while the target
// has never been usable by the application). The source database is never altered, dropped or truncated: it is fenced (runtime roles NOLOGIN + read-only default) and stays
// as the recovery base. The only things the Owner decides alone (target role LOGIN/passwords, Vercel env, redeploy approval) are outside this program.
// Owner sessions are opened through the Neon API in memory, pinned to the exact host fingerprint, verify-full TLS and channel binding (same admission as the 0064 installers).
import {createHash} from 'node:crypto';
import {closeSync,existsSync,lstatSync,mkdirSync,openSync,readFileSync,renameSync,unlinkSync,writeFileSync,writeSync,chmodSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {Pool} from 'pg';
import {readFile} from 'node:fs/promises';
import {migrationPlan,migrationsDirectory} from '../packages/db/src/index';
import {assertFirstAdminTls} from './lib/first-admin-bootstrap';
import {assertAcceptedMainRelease,assertNoTlsOverrides} from './lib/production-owner-session';
import {assertProductionHost,assertProductionHostFingerprint,assertProductionPort} from './production-backup';
import {BACKUP_CREDENTIAL_TARGET as T,neonCliPort,type NeonPort} from './production-backup-credential';
import {assertProductionTarget,bootstrapPlan,bootstrapProductionFoundation,dormantMigrationAdminPosture} from './production-bootstrap';
import {productionRoleProvisioningPlan} from './production-role-provisioning';
import {installGroupRoleOnFoundation65,groupRoleNames} from './production-group-delta';
import {independentBackupOnline,githubBackupPort,type BackupPort} from './production-cutover-backup-evidence';
import {requireRetainedSourceCopy,RETAINED_SOURCE_COPY_FILE,RETAINED_SOURCE_COPY_VERSION} from './production-recovery-evidence-pre0065';
import {PLATFORM_EXPLAINED,PLATFORM_EXPLAINED_COUNT,MIGRATION_0065_LINE_OK,TARGET_GRANT_PLAN,installTargetGrants,MIGRATION_0065_OBJECTS,NOT_COPIED,TARGET_ONLY_COLUMNS,compareAcl,inFlightWork,installDeltaGrantsOnFoundation65,listTables,proveTargetUntouched,readFenceState,readWrite,registry,runCutover,
 schemaState,tableDigests,triggerStates,foreignKeyOrphans,unfenceSource,readActivationMarker,writeActivationMarker,grantRuntimeLogin,type CutoverFailure,type CutoverFault,type Fence} from './production-cutover';

export const CUTOVER_RUN_VERSION='production-cutover-run/1';
/** The only database names this program will ever touch in Production. A second target exists so that a discarded first attempt can be replaced. */
export const PRODUCTION_SOURCE='neondb';
export const PRODUCTION_TARGETS=Object.freeze(['neondb_v65','neondb_v65b'] as const);
export const PRODUCTION_OWNER='neondb_owner';
export const COMMANDS=['preflight','bootstrap-target','install-target-grants','prewindow-check','copy-and-switch','verify-target','rollback','recover'] as const;
export type Command=typeof COMMANDS[number];

export type RunConfig={source:string;target:string;owner:string;allowedTargets:readonly string[];root:string;fenceWaitMs?:number;
 /** Production sets all of these true. `activate` (default true): the window itself grants the target runtime roles LOGIN right after the activation boundary is recorded (no human step inside the window);
  * false stops after writes are enabled with the roles still NOLOGIN (rehearsal tests). `requirePrewindow` (default true): copy-and-switch refuses without a fresh READY prewindow-check.
  * `requireBindings` (default true): prewindow-check also needs the fresh bindings-metadata AND live-binding evidence. `requireIndependentBackup` (default TRUE): the prewindow-check is NOT ready unless an independent recovery point is confirmed ONLINE (a successful scheduled production backup run that postdates migration 0064; scripts/production-cutover-backup-evidence.ts). A stored file, a hand-written record or the retained source copy never satisfies it. Only rehearsal tests pass false. */
 activate?:boolean;requirePrewindow?:boolean;requireBindings?:boolean;requireIndependentBackup?:boolean;prewindowMaxAgeMs?:number};
export type OwnerHandle={pool:Pool;close():Promise<void>};
export type RunPorts={config:RunConfig;release():string;openOwner(database:string):Promise<OwnerHandle>;now():Date;
 /** Read-only view of the scheduled production backup runs (GitHub). Absent => the independent recovery point is ABSENT. */
 backup?:BackupPort;
 /** Which privilege differences between source and target are explained (default: only the objects migration 0065 introduces or re-grants). */
 aclAllowed?:(line:string)=>boolean;
 /** Failure injection for the rehearsal tests only; never set by the Production adapter. */
 fault?:CutoverFault};

/** The one definition of an explained ACL difference: a 0065 object (ordinary privilege of an application role only: no PUBLIC, no grant option), one of the 14 exact Neon platform lines, or a rehearsal fixture line. */
const aclExplained=(ports:RunPorts)=>(l:string)=>(MIGRATION_0065_OBJECTS.test(l)&&MIGRATION_0065_LINE_OK(l,ports.config.owner))||PLATFORM_EXPLAINED(l)||(ports.aclAllowed?.(l)??false);
const sha=(v:string)=>createHash('sha256').update(v).digest('hex');
const qi=(v:string)=>'"'+v.replace(/"/g,'""')+'"';
export const fail:(code:string)=>never=code=>{throw new Error('PRODUCTION_CUTOVER_'+code);};
const evidenceDir=(c:RunConfig)=>join(c.root,'.local/evidence/production-cutover');
const statePath=(c:RunConfig)=>join(evidenceDir(c),'state.json');

// ---------------------------------------------------------------- state (counts, digests and names only; mode 0600; no secret ever)
export type Phase='PREFLIGHT_OK'|'TARGET_BOOTSTRAPPED'|'WINDOW_OPEN'|'COPIED_AWAITING_OWNER'|'ACTIVATED'|'ROLLED_BACK'|'FORWARD_FIX_ONLY'|'RECOVERY_REQUIRED';
/** Whether the target has been allowed to accept writes: NEVER → INTENT (recorded BEFORE the read-only default is lifted) → ENABLED. A local file is evidence of INTENT only;
 * what actually happened is always decided by reading the databases back. */
export type Writes='NEVER'|'INTENT'|'ENABLED';
export type State={version:typeof CUTOVER_RUN_VERSION;source:string;target:string;phase:Phase;at:string;sourceLoginRoles:string[];sourceDigestSha256:string;sourceRows:number;
 targetSchemaStateSha256?:string;audit?:unknown;
 /** The irreversible boundary. NONE is written when a window opens; STARTED is persisted (and mirrored into the target database) BEFORE the first activation step. A missing value is UNKNOWN and counts as crossed. */
 activation?:'NONE'|'STARTED';activationAt?:string;prewindow?:{at:string;ready:boolean;blockers:string[]};switchManifest?:SwitchManifest;writes?:Writes;sourceFence?:Fence;sourceDbSetting?:string|null;dormantAdminRole?:string;recoveryReason?:string};
export type SwitchManifest={database:string;rolePrefixFrom:string;rolePrefixTo:string;targetRuntimeRoles:string[];loginRequired:string[];passwordEnvPrefix:'PRODUCTION_DB_PASSWORD_';roleEnvPrefix:'PRODUCTION_DB_ROLE_';nameEnv:'PRODUCTION_DB_NAME'};
function readState(c:RunConfig):State|undefined{
 const p=statePath(c);if(!existsSync(p))return undefined;
 if(!lstatSync(p).isFile()||lstatSync(p).size>1<<20)fail('STATE_INVALID');
 try{const s=JSON.parse(readFileSync(p,'utf8')) as State;if(s.version!==CUTOVER_RUN_VERSION||s.source!==c.source||s.target!==c.target)return fail('STATE_MISMATCH');return s;}
 catch(e){if(String((e as Error).message).startsWith('PRODUCTION_CUTOVER_'))throw e;return fail('STATE_INVALID');}
}
function writeState(c:RunConfig,s:State){
 mkdirSync(evidenceDir(c),{recursive:true,mode:0o700});
 const tmp=statePath(c)+'.tmp';writeFileSync(tmp,JSON.stringify(s),{mode:0o600});chmodSync(tmp,0o600);renameSync(tmp,statePath(c));
}
function assertConfig(c:RunConfig){
 assertProductionTarget(c.target);assertProductionTarget(c.source);
 if(c.target===c.source||!c.allowedTargets.includes(c.target))fail('TARGET_REFUSED');
 if(!/^[a-z][a-z0-9_]{2,62}$/.test(c.owner))fail('OWNER_REFUSED');
}
const runtimeRoleNames=(db:string)=>[...productionRoleProvisioningPlan(db).operationalRoleNames.filter(r=>r!==db+'_backup'),groupRoleNames(db).group];
const managerOf=(db:string)=>productionRoleProvisioningPlan(db).managerRole;
const canonicalChecksum=async(file:string)=>sha(await readFile(migrationsDirectory+'/'+file,'utf8'));
async function expectedRegistry(count:number){return Promise.all(migrationPlan.slice(0,count).map(async m=>({id:m.id,checksum:await canonicalChecksum(m.file)})));}
async function assertRegistryIs(pool:Pool,count:number){
 if(JSON.stringify(await registry(pool))!==JSON.stringify(await expectedRegistry(count)))fail('REGISTRY_UNEXPECTED_'+count);
}
async function identity(pool:Pool,database:string,owner:string){
 const r=(await pool.query('SELECT current_database() db,current_user u,session_user s,pg_get_userbyid(datdba) o FROM pg_database WHERE datname=current_database()')).rows[0];
 if(!r||r.db!==database||r.u!==owner||r.s!==owner||r.o!==owner)fail('IDENTITY_REFUSED');
}
const copiedTables=async(pool:Pool)=>(await listTables(pool)).filter(t=>!(NOT_COPIED as readonly string[]).includes(t));
const digestOf=(d:Record<string,{rows:number;sha256:string}>)=>({sha256:sha(JSON.stringify(d)),rows:Object.values(d).reduce((a,x)=>a+x.rows,0),tables:Object.keys(d).length});

async function withOwner<T2>(ports:RunPorts,database:string,fn:(pool:Pool)=>Promise<T2>){
 const h=await ports.openOwner(database);
 try{await identity(h.pool,database,ports.config.owner);return await fn(h.pool);}finally{await h.close();}
}
/** READ ONLY transaction on one connection. */
async function readOnly<T2>(pool:Pool,fn:(c:import('pg').PoolClient)=>Promise<T2>){
 const c=await pool.connect();
 try{await c.query('BEGIN READ ONLY');const r=await fn(c);await c.query('ROLLBACK');return r;}catch(e){await c.query('ROLLBACK').catch(()=>undefined);throw e;}finally{c.release();}
}

// ---------------------------------------------------------------- preflight (READ ONLY on the source; also records the retained-source recovery base)
export async function preflight(ports:RunPorts){
 const c=ports.config;assertConfig(c);const head=ports.release();
 const existing=readState(c);
 if(existing&&['WINDOW_OPEN','COPIED_AWAITING_OWNER','ACTIVATED','FORWARD_FIX_ONLY','RECOVERY_REQUIRED'].includes(existing.phase))fail('PHASE_REFUSED_'+existing.phase);
 return withOwner(ports,c.source,async source=>{
  await assertRegistryIs(source,64);
  const manager=managerOf(c.source),roles=runtimeRoleNames(c.source);
  const facts=await readOnly(source,async cl=>{
   const q=async(sql:string,p:unknown[]=[])=>(await cl.query(sql,p)).rows;
   const me=(await q('SELECT rolcreatedb,rolcreaterole,rolsuper FROM pg_roles WHERE rolname=current_user'))[0];
   const signal=(await q("SELECT pg_has_role(current_user,'pg_signal_backend','MEMBER') m"))[0].m as boolean;
   const setManager=(await q('SELECT count(*)::int n FROM pg_auth_members WHERE roleid=$1::regrole AND member=(SELECT oid FROM pg_roles WHERE rolname=current_user) AND set_option',[qi(manager)]))[0].n===1;
   const present=await q('SELECT rolname,rolcanlogin FROM pg_roles WHERE rolname=ANY($1) ORDER BY 1',[roles]);
   const sessions=await q('SELECT usename,count(*)::int n FROM pg_stat_activity WHERE usename=ANY($1) GROUP BY 1 ORDER BY 1',[roles]);
   const targetExists=(await q('SELECT count(*)::int n FROM pg_database WHERE datname=$1',[c.target]))[0].n===1;
   const other=(await q('SELECT count(*)::int n FROM pg_database WHERE datname=$1',[c.source]))[0].n===1;
   const work=await inFlightWork(cl);
   const tables=await copiedTables(source);
   const digests=await tableDigests(cl,tables);
   return{me,signal,setManager,present,sessions,targetExists,other,work,digests};
  });
  if(!facts.other||facts.me.rolsuper)fail('SOURCE_REFUSED');
  const d=digestOf(facts.digests);
  const sourceLoginRoles=facts.present.filter(r=>r.rolcanlogin).map(r=>r.rolname as string);
  const ready={ownerCreatedb:Boolean(facts.me.rolcreatedb),ownerCreaterole:Boolean(facts.me.rolcreaterole),canSetManager:facts.setManager};
  const runtimeSessions=facts.sessions.reduce((a,r)=>a+Number(r.n),0);
  // A target that is already built (or whose first window was rolled back) keeps its phase; a fresh preflight only refreshes the measurements.
  const keep=existing&&['TARGET_BOOTSTRAPPED','ROLLED_BACK'].includes(existing.phase);
  const state:State={...(keep?existing:{}),version:CUTOVER_RUN_VERSION,source:c.source,target:c.target,phase:keep?existing.phase:'PREFLIGHT_OK',at:ports.now().toISOString(),sourceLoginRoles,sourceDigestSha256:d.sha256,sourceRows:d.rows};
  if(ready.ownerCreatedb&&ready.ownerCreaterole&&ready.canSetManager){
   writeState(c,state);
   // Recovery base: the source stays untouched in the cluster (fence only toggles role LOGIN and the database default); no age key, no Owner action.
   // NOT an independent backup: a record of the same-cluster retained source copy, kept in its own file so it can never overwrite or pass as an independent restore point/drill.
   mkdirSync(evidenceDir(c),{recursive:true,mode:0o700});
   writeFileSync(join(evidenceDir(c),RETAINED_SOURCE_COPY_FILE),JSON.stringify({version:RETAINED_SOURCE_COPY_VERSION,kind:'RETAINED_SOURCE_COPY',independent:false,registry:64,recordedAt:ports.now().toISOString(),reference:`${c.source}-retained:${d.sha256.slice(0,16)}`}),{mode:0o600});
  }
  return{status:ready.ownerCreatedb&&ready.ownerCreaterole&&ready.canSetManager?'CUTOVER_PREFLIGHT_OK':'CUTOVER_PREFLIGHT_BLOCKED',sourceSha:head,source:c.source,target:c.target,registry:64,...ready,
   ownerCanTerminateRuntimeSessions:facts.signal,targetExists:facts.targetExists,runtimeLoginRoles:sourceLoginRoles.length,runtimeSessions,inFlight:facts.work,
   tables:d.tables,rows:d.rows,digestSha256Prefix:d.sha256.slice(0,16),recovery:'RETAINED_SOURCE_COPY',independentBackupEvidence:(await independentBackupOnline(ports.backup,source,c.root,ports.now())).state,
   note:facts.signal?'termination of runtime sessions is permitted':'termination NOT permitted: the Owner must stop the application first; copy-and-switch refuses while runtime sessions remain'};
 });
}

// ---------------------------------------------------------------- exclusive lock (one mutating command at a time, on this machine AND in the database)
const LOCK_KEY=71820402;
function takeFileLock(c:RunConfig,now:Date){
 mkdirSync(evidenceDir(c),{recursive:true,mode:0o700});
 const path=join(evidenceDir(c),'lock');
 for(let attempt=0;attempt<2;attempt++){
  try{const fd=openSync(path,'wx',0o600);writeSync(fd,JSON.stringify({pid:process.pid,at:now.toISOString()}));closeSync(fd);return path;}
  catch(e){
   if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;
   let pid=0;try{pid=Number(JSON.parse(readFileSync(path,'utf8')).pid);}catch{pid=0;}
   let alive=false;if(pid>0)try{process.kill(pid,0);alive=true;}catch(k){alive=(k as NodeJS.ErrnoException).code==='EPERM';}
   if(alive&&pid!==process.pid)return fail('LOCKED');
   unlinkSync(path);   // a dead holder: take over once
  }
 }
 return fail('LOCKED');
}
/** Holds the file lock and one advisory lock per database for the duration of `fn`. */
async function exclusive<T2>(ports:RunPorts,pools:Pool[],fn:()=>Promise<T2>){
 const path=takeFileLock(ports.config,ports.now());
 const held:import('pg').PoolClient[]=[];
 try{
  for(const pool of pools){
   const cl=await pool.connect();held.push(cl);
   if((await cl.query('SELECT pg_try_advisory_lock($1) ok',[LOCK_KEY])).rows[0].ok!==true)return fail('LOCKED_DB');
  }
  return await fn();
 }finally{
  for(const cl of held){await cl.query('SELECT pg_advisory_unlock($1)',[LOCK_KEY]).catch(()=>undefined);cl.release();}
  try{unlinkSync(path);}catch{/* already gone */}
 }
}
const dormantRoleOf=async(target:string)=>(await bootstrapPlan(target,{retainMigrationAdmin:true})).ownerCompatibility.bootstrapRole;
const targetReadOnlyNow=async(pool:Pool,db:string)=>(await readFenceState(pool,db,[])).dbSetting==='on';

// ---------------------------------------------------------------- independent-backup report, evidence files and the prewindow check
export const BINDINGS_EVIDENCE_FILE='bindings-check.json';
export const LIVE_BINDING_EVIDENCE_FILE='live-bindings.json';
export const BINDINGS_EVIDENCE_VERSION='cutover-bindings-evidence/1';
export const LIVE_BINDING_EVIDENCE_VERSION='cutover-live-binding-evidence/1';
/** Evidence written by the bindings CLIs: fixed shape, bound to the target, fresh. Returns the recorded status, or null when absent/stale/other target/invalid. */
function readEvidenceStatus(c:RunConfig,file:string,version:string,now:Date):string|null{
 const p=join(evidenceDir(c),file);
 try{
  if(!existsSync(p)||!lstatSync(p).isFile()||lstatSync(p).size>8192)return null;
  const r=JSON.parse(readFileSync(p,'utf8')) as {version?:unknown;target?:unknown;at?:unknown;status?:unknown};
  const at=typeof r.at==='string'?Date.parse(r.at):NaN,age=now.getTime()-at;
  if(r.version!==version||r.target!==c.target||!Number.isFinite(at)||age<0||age>(c.prewindowMaxAgeMs??PREWINDOW_MAX_AGE_MS))return null;
  return typeof r.status==='string'?r.status:null;
 }catch{return null;}
}
export const PREWINDOW_MAX_AGE_MS=2*60*60*1000;

/** READ ONLY. Everything that must hold BEFORE the source is fenced, gathered in one place. Nothing is stopped while any item is open ("never fence unprepared"). The items
 * are reported separately on purpose: a metadata match is NOT a live connection/delivery pass, and a retained source copy is NOT an independent restore point. */
export async function prewindowCheck(ports:RunPorts){
 const c=ports.config;assertConfig(c);const head=ports.release();const now=ports.now();
 const st=readState(c);if(!st||st.phase!=='TARGET_BOOTSTRAPPED')fail('PHASE_REFUSED_'+(st?.phase??'NONE'));
 let retained=true;try{requireRetainedSourceCopy(c.root,now);}catch{retained=false;}
 const bindingsMetadata=readEvidenceStatus(c,BINDINGS_EVIDENCE_FILE,BINDINGS_EVIDENCE_VERSION,now);
 const liveBindings=readEvidenceStatus(c,LIVE_BINDING_EVIDENCE_FILE,LIVE_BINDING_EVIDENCE_VERSION,now);
 const sourceH=await ports.openOwner(c.source),targetH=await ports.openOwner(c.target);
 try{
  await identity(sourceH.pool,c.source,c.owner);await identity(targetH.pool,c.target,c.owner);
  await assertRegistryIs(sourceH.pool,64);
  const sourceNow=await readFenceState(sourceH.pool,c.source,runtimeRoleNames(c.source));
  const work=await readOnly(sourceH.pool,cl=>inFlightWork(cl));const {executorTransientRows:_t,...live}=work;void _t;
  const target=await targetStructure(targetH.pool,c);
  const marker=await readActivationMarker(targetH.pool,c.target);
  const independentOnline=await independentBackupOnline(ports.backup,sourceH.pool,c.root,now);const independent=independentOnline.state;
  const aclNow=await compareAcl(sourceH.pool,targetH.pool,c.source,c.target,aclExplained(ports),[c.owner]);
  const canTerminate=(await sourceH.pool.query("SELECT pg_has_role(current_user,'pg_signal_backend','MEMBER') m")).rows[0].m as boolean;
  const items={
   sourceLive:sourceNow.dbSetting!=='on'&&sourceNow.loginRoles.length>0,
   inFlightWorkZero:Object.values(live).every(v=>v===0),
   targetReady:target.ok&&target.runtimeLoginRoles.length===0&&target.runtimeSessions===0&&await targetReadOnlyNow(targetH.pool,c.target)&&marker===null,
   retainedSourceCopy:retained,
   independentBackupEvidence:independent,
   bindingsMetadata:bindingsMetadata===null?'NOT_CHECKED':bindingsMetadata==='CONSISTENT'?'CONSISTENT':'FINDINGS',
   liveBindings:liveBindings===null?'NOT_CHECKED':liveBindings==='PASS'?'PASS':'FAIL',
   aclIdenticalExceptExplained:aclNow.unexpected.length===0,
   canTerminateRuntimeSessions:canTerminate};
  const blockers:string[]=[];
  if(!items.sourceLive)blockers.push('SOURCE_NOT_LIVE');
  if(!items.inFlightWorkZero)blockers.push('IN_FLIGHT_WORK');
  if(!items.targetReady)blockers.push('TARGET_NOT_READY');
  if(!items.retainedSourceCopy)blockers.push('RETAINED_SOURCE_COPY_MISSING');
  if(!items.aclIdenticalExceptExplained)blockers.push('ACL_NOT_IDENTICAL');
  if(c.requireBindings!==false){
   if(items.bindingsMetadata!=='CONSISTENT')blockers.push('BINDINGS_METADATA_'+items.bindingsMetadata);
   if(items.liveBindings!=='PASS')blockers.push('LIVE_BINDINGS_'+items.liveBindings);
  }
  if(c.requireIndependentBackup!==false&&independent!=='PRESENT')blockers.push('INDEPENDENT_BACKUP_ABSENT');
  const ready=blockers.length===0;
  writeState(c,{...st,at:now.toISOString(),prewindow:{at:now.toISOString(),ready,blockers}});
  return{status:ready?'CUTOVER_PREWINDOW_READY':'CUTOVER_PREWINDOW_NOT_READY',sourceSha:head,target:c.target,ready,blockers,...items,
   aclPlatformExplained:aclNow.onlySource.concat(aclNow.onlyTarget).filter(PLATFORM_EXPLAINED).length,aclUnexpectedSample:aclNow.unexpected.slice(0,8),
   independentBackupReasons:independentOnline.reasons,independentBackupRunId:independentOnline.runId??null,independentBackupRestoreTested:false,
   /** Scope of each proof, stated so READY is never read as more than it is. */
   liveBindingsScope:'TARGET_OWNER_CONNECTION_ONLY',
   runtimeCredentialsLiveBinding:'NOT_VERIFIABLE_BEFORE_WINDOW(NOLOGIN)',
   deliveryBinding:'PROVEN_IN_WINDOW_ONLY(stage attestation, two check windows on the candidate, promote, post attestation)',
   recoveryBasis:'RETAINED_SOURCE_COPY (same cluster; not an independent backup)'};
 }finally{await sourceH.close();await targetH.close();}
}

// ---------------------------------------------------------------- install-target-grants (fixed, target-limited)
/** After bootstrap-target and BEFORE the window, on the TARGET ONLY (the source is read for the final comparison, never written): grants the fixed plan of 11 privileges production gained
 * outside migrations 0059-0063, revokes the four rental_preparations column UPDATE privileges the current role plan hands to operations although production never had them, and proves the
 * structure digest is unchanged and the ACL delta is exactly the plan. Then the FULL source/target ACL comparison must leave nothing unexpected. Idempotent. Never re-bootstraps. */
export async function installTargetGrantsCommand(ports:RunPorts){
 const c=ports.config;assertConfig(c);const head=ports.release();
 const st=readState(c);if(!st||st.phase!=='TARGET_BOOTSTRAPPED')fail('PHASE_REFUSED_'+(st?.phase??'NONE'));
 if(st.activation==='STARTED')fail('ACTIVATION_BOUNDARY_PASSED');
 const sourceH=await ports.openOwner(c.source),targetH=await ports.openOwner(c.target);
 try{
  return await exclusive(ports,[sourceH.pool,targetH.pool],async()=>{
   await identity(sourceH.pool,c.source,c.owner);await identity(targetH.pool,c.target,c.owner);
   await assertRegistryIs(sourceH.pool,64);await assertRegistryIs(targetH.pool,65);
   const r=await installTargetGrants(targetH.pool,c.target,c.owner);
   const acl=await compareAcl(sourceH.pool,targetH.pool,c.source,c.target,aclExplained(ports),[c.owner]);
   if(acl.unexpected.length>0)fail('ACL_UNEXPECTED_REMAIN');
   writeState(c,{...st,at:ports.now().toISOString(),targetSchemaStateSha256:r.newSchemaStateSha256});
   return{status:'CUTOVER_TARGET_GRANTS_INSTALLED',sourceSha:head,target:c.target,planGrants:TARGET_GRANT_PLAN.length,...r,
    aclUnexpectedAfter:0,aclPlatformExplained:acl.onlySource.concat(acl.onlyTarget).filter(PLATFORM_EXPLAINED).length,platformListSize:PLATFORM_EXPLAINED_COUNT,
    rolesMembershipsCredentialsChanged:0,sourceWritten:false};
  });
 }finally{await sourceH.close();await targetH.close();}
}

// ---------------------------------------------------------------- bootstrap-target
export async function bootstrapTarget(ports:RunPorts){
 const c=ports.config;assertConfig(c);const head=ports.release();
 requireRetainedSourceCopy(c.root,ports.now());
 const st=readState(c);if(!st||(st.phase!=='PREFLIGHT_OK'&&st.phase!=='ROLLED_BACK'))fail('PREFLIGHT_REQUIRED');
 if(st.phase==='ROLLED_BACK')fail('TARGET_ALREADY_BOOTSTRAPPED');
 const sourceH=await ports.openOwner(c.source);
 try{
  return await exclusive(ports,[sourceH.pool],async()=>{
   await identity(sourceH.pool,c.source,c.owner);
   await assertRegistryIs(sourceH.pool,64);
   const exists=(await sourceH.pool.query('SELECT count(*)::int n FROM pg_database WHERE datname=$1',[c.target])).rows[0].n===1;
   if(!exists)await sourceH.pool.query(`CREATE DATABASE ${qi(c.target)} OWNER ${qi(c.owner)}`);
   const result=await withOwner(ports,c.target,async target=>{
    // The creator role of the executor is RETAINED as a dormant migration administrator (production-owner-compat/3): the next migration that touches
    // executor-owned functions can then be applied through a revocable window (production-migration-window.ts), with nobody outside the database involved.
    const foundation=await bootstrapProductionFoundation(target,c.target,{retainMigrationAdmin:true});
    const cl=await target.connect();
    try{
     const g=await installGroupRoleOnFoundation65(cl,c.target,c.owner);
     const dgr=await installDeltaGrantsOnFoundation65(cl,c.target,c.owner);
     await cl.query(`ALTER DATABASE ${qi(c.target)} SET default_transaction_read_only=on`);
     await assertRegistryIs(target,65);
     const ss=await schemaState(target);
     const rows=Number((await target.query('SELECT (SELECT count(*) FROM public.group_orders)+(SELECT count(*) FROM public.rental_bookings) n')).rows[0].n);
     if(rows!==0)fail('TARGET_NOT_EMPTY');
     return{foundation:Boolean(foundation),group:g,delta:dgr,schemaState:ss.sha256};
    }finally{cl.release();}
   });
   const dormant=await dormantRoleOf(c.target);
   writeState(c,{...st,phase:'TARGET_BOOTSTRAPPED',at:ports.now().toISOString(),targetSchemaStateSha256:result.schemaState,writes:'NEVER',dormantAdminRole:dormant});
   return{status:'CUTOVER_TARGET_BOOTSTRAPPED',sourceSha:head,target:c.target,registry:65,schemaStateSha256Prefix:result.schemaState.slice(0,16),readOnlyUntilVerified:true,migrationAdmin:'DORMANT_NOLOGIN_RETAINED'};
  });
 }finally{await sourceH.close();}
}

// ---------------------------------------------------------------- shared READ ONLY structural proof of the target
async function targetStructure(target:Pool,c:RunConfig){
 await assertRegistryIs(target,65);
 const roles=runtimeRoleNames(c.target),exec=c.target+'_custody_executor',custody=c.target+'_custody';
 const dormant=await dormantRoleOf(c.target);
 return readOnly(target,async cl=>{
  const q=async(sql:string,p:unknown[]=[])=>(await cl.query(sql,p)).rows;
  const bad=(await triggerStates(cl)).filter(t=>t.state!=='O');
  const orphans=(await foreignKeyOrphans(cl)).orphans;
  const owners=await q("SELECT p.proname,pg_get_userbyid(p.proowner) o,p.prosecdef d FROM pg_proc p WHERE p.proname IN ('rental_apply_receipt','rental_stage_guard','rental_validate_loan') ORDER BY 1");
  const nativeLink=(await q("SELECT count(*)::int n FROM information_schema.columns WHERE table_name='rental_loan_items' AND column_name IN ('group_part_id','hold_id')"))[0].n===2&&
   (await q("SELECT count(*)::int n FROM pg_class WHERE relname='group_part_preparations' AND relkind='r'"))[0].n===1;
  // Contract: no ordinary member holds the executor. The ONLY member is the dormant migration administrator, with ADMIN and neither SET nor INHERIT.
  const members=(await q('SELECT count(*)::int n FROM pg_auth_members WHERE roleid=$1::regrole AND member<>$2::regrole',[qi(exec),qi(dormant)]))[0].n;
  const admin=await dormantMigrationAdminPosture(cl as never,dormant,exec,custody);
  const strayCreators=(await q("SELECT count(*)::int n FROM pg_roles WHERE rolname LIKE 'zao\\_boot\\_%' AND rolname<>$1",[dormant]))[0].n;
  const login=(await q('SELECT rolname FROM pg_roles WHERE rolname=ANY($1) AND rolcanlogin ORDER BY 1',[roles])).map(r=>r.rolname as string);
  const sessions=(await q('SELECT count(*)::int n FROM pg_stat_activity WHERE usename=ANY($1)',[roles]))[0].n as number;
  const ok=bad.length===0&&orphans.length===0&&owners.length===3&&owners.every(o=>o.o===exec&&o.d===true)&&nativeLink&&members===0&&strayCreators===0&&admin.ok===true;
  return{ok,triggersNotEnabled:bad.length,fkOrphans:orphans.length,executorOwnedDefiners:owners.length,custodyLinkNative:nativeLink,executorMembers:members,migrationAdminDormant:admin.ok===true,strayCreatorRoles:strayCreators,runtimeLoginRoles:login,runtimeSessions:sessions};
 });
}

// ---------------------------------------------------------------- the irreversible activation boundary
/** Read from the target DATABASE, never from the file alone. Fail closed: a missing/corrupt state, a state that says NONE while the marker exists, a marker that cannot be read or
 * any value other than an explicit NONE all count as crossed. Once crossed, no automatic rollback/recover ever unfences the source. */
async function activationEvidence(c:RunConfig,st:State,target:Pool){
 let marker:string|null=null,unreadable=false;
 try{marker=await readActivationMarker(target,c.target);}catch{unreadable=true;}
 const state=st.activation??'MISSING';
 const crossed=unreadable||marker!==null||state!=='NONE';
 return{crossed,state,marker:unreadable?'UNREADABLE':marker===null?'ABSENT':'PRESENT',reason:unreadable?'ACTIVATION_EVIDENCE_UNREADABLE':marker!==null&&state==='NONE'?'ACTIVATION_MARKER_STATE_MISMATCH':state==='MISSING'?'ACTIVATION_EVIDENCE_UNKNOWN':'ACTIVATION_BOUNDARY_CROSSED'};
}

// ---------------------------------------------------------------- copy-and-switch
/** A snapshot belongs to ONE window: once the source is proven restored it is dropped, so a stale one can never be applied to a later window. */
const withoutWindow=(st:State):State=>{const {sourceFence:_f,recoveryReason:_r,prewindow:_p,...rest}=st;void _f;void _r;void _p;return {...rest,activation:'NONE'} as State;};
const snapshotOf=(c:RunConfig,st:State):Fence=>st.sourceFence??{roles:runtimeRoleNames(c.source),wasLogin:st.sourceLoginRoles,terminated:0,terminateDenied:false,dbSetting:st.sourceDbSetting??null,verified:false};
const failureCode=(message:string)=>'PRODUCTION_CUTOVER_'+(message.match(/^CUTOVER_([A-Z0-9_]+)/)?.[1]??'WINDOW_FAILED');

export async function copyAndSwitch(ports:RunPorts){
 const c=ports.config;assertConfig(c);const head=ports.release();
 requireRetainedSourceCopy(c.root,ports.now());
 const st0=readState(c);if(!st0||(st0.phase!=='TARGET_BOOTSTRAPPED'&&st0.phase!=='ROLLED_BACK'))fail('PHASE_REFUSED_'+(st0?.phase??'NONE'));
 // Never fence unprepared: a fresh READY prewindow-check (every item verified outside the window) is a precondition.
 if(c.requirePrewindow!==false){
  const pw=st0.prewindow,age=pw?ports.now().getTime()-Date.parse(pw.at):NaN;
  if(!pw||!pw.ready||!Number.isFinite(age)||age<0||age>(c.prewindowMaxAgeMs??PREWINDOW_MAX_AGE_MS))fail('PREWINDOW_REQUIRED');
 }
 const sourceH=await ports.openOwner(c.source),targetH=await ports.openOwner(c.target);
 try{
  return await exclusive(ports,[sourceH.pool,targetH.pool],async()=>{
   await identity(sourceH.pool,c.source,c.owner);await identity(targetH.pool,c.target,c.owner);
   await assertRegistryIs(sourceH.pool,64);
   const before=await targetStructure(targetH.pool,c);
   if(!before.ok||before.runtimeLoginRoles.length||before.runtimeSessions)fail('TARGET_NOT_READY');
   if(!await targetReadOnlyNow(targetH.pool,c.target))fail('TARGET_NOT_READ_ONLY');
   if(await readActivationMarker(targetH.pool,c.target)!==null)fail('TARGET_ACTIVATION_MARKER_PRESENT');
   // The latest source and target privileges are compared again immediately before anything is stopped (never fence with an unexplained privilege difference).
   if(c.requirePrewindow!==false&&(await compareAcl(sourceH.pool,targetH.pool,c.source,c.target,aclExplained(ports),[c.owner])).unexpected.length>0)fail('ACL_NOT_IDENTICAL_AT_FENCE');
   const sourceNow=await readFenceState(sourceH.pool,c.source,runtimeRoleNames(c.source));
   // Everything that will be changed is recorded BEFORE the first change; `recordFence` refines it with the exact role list.
   let st:State={...st0,phase:'WINDOW_OPEN',at:ports.now().toISOString(),sourceLoginRoles:sourceNow.loginRoles,sourceDbSetting:sourceNow.dbSetting,writes:'NEVER',activation:'NONE'};
   delete (st as {sourceFence?:Fence}).sourceFence;
   writeState(c,st);
   const manifest:SwitchManifest={database:c.target,rolePrefixFrom:c.source+'_',rolePrefixTo:c.target+'_',targetRuntimeRoles:runtimeRoleNames(c.target),loginRequired:runtimeRoleNames(c.target),
    passwordEnvPrefix:'PRODUCTION_DB_PASSWORD_',roleEnvPrefix:'PRODUCTION_DB_ROLE_',nameEnv:'PRODUCTION_DB_NAME'};
   const persist=(patch:Partial<State>)=>{st={...st,...patch,at:ports.now().toISOString()};writeState(c,st);};
   let result:Awaited<ReturnType<typeof runCutover>>;
   try{
    result=await runCutover({source:sourceH.pool,target:targetH.pool,sourceOwner:sourceH.pool,targetOwner:targetH.pool,sourceDatabase:c.source,targetDatabase:c.target,
     runtimeRoles:runtimeRoleNames(c.source),managerRole:managerOf(c.source),fenceWaitMs:c.fenceWaitMs??60000,
     ...(ports.fault?{fault:ports.fault}:{}),recordFence:f=>persist({sourceFence:f}),
     // THE boundary: persisted locally first, then written into the target database, BEFORE the read-only default is lifted and before any LOGIN. From here on: forward-fix only.
     beforeEnableWrites:async()=>{const at=ports.now().toISOString();persist({activation:'STARTED',activationAt:at,writes:'INTENT'});await writeActivationMarker(targetH.pool,c.target,'STARTED:'+at);},
     afterEnableWrites:()=>persist({writes:'ENABLED'}),
     // No human step inside the window: the runner itself grants the target runtime roles LOGIN (through the target's role-administration role) right after the boundary.
     // The application still cannot reach the target until the prepared candidate (carrying the new bindings) is promoted by the release flow.
     switchRuntime:async()=>{if(c.activate!==false)await grantRuntimeLogin(targetH.pool,runtimeRoleNames(c.target),managerOf(c.target));},
     postSwitchProbe:async t=>{
      const s=await targetStructure(t,c),roles=runtimeRoleNames(c.target);
      const loginOk=c.activate===false?s.runtimeLoginRoles.length===0:roles.every(r=>s.runtimeLoginRoles.includes(r));
      if(!s.ok||!loginOk)throw new Error('CUTOVER_POST_SWITCH_STRUCTURE');}});
   }catch(e){
    const f=e as Partial<CutoverFailure>&{message:string};
    const fence=f.fence??st.sourceFence;
    if(f.writesEnabled||f.activationStarted)persist({phase:'FORWARD_FIX_ONLY',activation:'STARTED',writes:f.writesEnabled&&!f.writesUnknown?'ENABLED':'INTENT',audit:f.audit,...(fence?{sourceFence:fence}:{}),recoveryReason:'ACTIVATION_BOUNDARY_CROSSED'});
    else if(f.recoveryRequired)persist({phase:'RECOVERY_REQUIRED',writes:'NEVER',audit:f.audit,...(fence?{sourceFence:fence}:{}),recoveryReason:'SOURCE_UNFENCE_UNVERIFIED'});
    else{st=withoutWindow(st);persist({phase:'TARGET_BOOTSTRAPPED',writes:'NEVER',audit:f.audit});}
    throw Object.assign(new Error(failureCode(f.message)),{stage:f.stage,rolledBack:Boolean(f.rolledBack),recoveryRequired:Boolean(f.recoveryRequired)});
   }
   const activated=c.activate!==false;
   persist({phase:activated?'ACTIVATED':'COPIED_AWAITING_OWNER',writes:'ENABLED',activation:'STARTED',audit:result.audit,switchManifest:manifest});
   return{status:activated?'CUTOVER_ACTIVATED':'CUTOVER_COPIED_AWAITING_OWNER',sourceSha:head,chainValid:result.chainValid,tables:result.report.tables,rows:result.report.rows,sequences:result.report.sequences,
    sourceFenced:true,targetRuntimeLogin:activated,activationBoundary:'RECORDED_FORWARD_FIX_ONLY',steps:result.audit.map(a=>a.step),switchManifest:manifest};
  });
 }finally{await sourceH.close();await targetH.close();}
}

// ---------------------------------------------------------------- verify-target (READ ONLY)
export async function verifyTarget(ports:RunPorts){
 const c=ports.config;assertConfig(c);const head=ports.release();
 const st=readState(c);if(!st)fail('PHASE_REFUSED_NONE');
 const sourceH=await ports.openOwner(c.source),targetH=await ports.openOwner(c.target);
 try{
  await identity(sourceH.pool,c.source,c.owner);await identity(targetH.pool,c.target,c.owner);
  const s=await targetStructure(targetH.pool,c);
  const now=await schemaState(targetH.pool);
  const schemaUnchanged=st.targetSchemaStateSha256===undefined||now.sha256===st.targetSchemaStateSha256;
  // The privilege sets of source and target are compared in full; only objects migration 0065 itself introduces may differ.
  const acl=await compareAcl(sourceH.pool,targetH.pool,c.source,c.target,aclExplained(ports),[c.owner]);
  const platformExplained=acl.onlySource.concat(acl.onlyTarget).filter(PLATFORM_EXPLAINED).length;
  let identical:boolean|null=null;
  // Source and target hold the same rows only while nobody can write to either: the application cannot log in to the target and the source is fenced.
  const sourceLogin=Number((await sourceH.pool.query('SELECT count(*)::int n FROM pg_roles WHERE rolname=ANY($1) AND rolcanlogin',[runtimeRoleNames(c.source)])).rows[0].n);
  if(s.runtimeLoginRoles.length===0&&sourceLogin===0){
   const tables=await copiedTables(sourceH.pool);
   const a=await readOnly(sourceH.pool,cl=>tableDigests(cl,tables)),b=await readOnly(targetH.pool,cl=>tableDigests(cl,tables,TARGET_ONLY_COLUMNS));
   identical=tables.every(t=>a[t]!.rows===b[t]!.rows&&a[t]!.sha256===b[t]!.sha256);
  }
  const structureOk=s.ok&&schemaUnchanged&&acl.unexpected.length===0;
  // Two different passes, never confused: FULLY_VERIFIED needs full row identity; STRUCTURE_ONLY says nothing about the rows.
  const status=!structureOk||identical===false?'CUTOVER_TARGET_VERIFY_FAILED':identical===true?'CUTOVER_TARGET_FULLY_VERIFIED':'CUTOVER_TARGET_STRUCTURE_ONLY_PASS';
  return{status,fullMatch:identical===true,sourceSha:head,phase:st.phase,registry:65,...s,schemaUnchanged,
   acl:{sourceLines:acl.sourceLines,targetLines:acl.targetLines,explainedDifferences:acl.onlySource.length+acl.onlyTarget.length-acl.unexpected.length,platformExplained,migration0065Explained:acl.onlySource.concat(acl.onlyTarget).filter(l=>MIGRATION_0065_OBJECTS.test(l)).length,unexpectedDifferences:acl.unexpected.length,
    unexpectedSample:acl.unexpected.slice(0,8)},
   rowsIdenticalToSource:identical,sourceRuntimeLoginRoles:sourceLogin,mode:identical===null?'STRUCTURAL_ONLY_TARGET_IN_USE':'FULL_PRE_SWITCH'};
 }finally{await sourceH.close();await targetH.close();}
}

// ---------------------------------------------------------------- rollback / recover
/** The target's facts that decide whether going back is still allowed (read from the databases, never from a file). */
async function targetFacts(sourceH:OwnerHandle,targetH:OwnerHandle,c:RunConfig){
 const roles=runtimeRoleNames(c.target);
 const used=(await targetH.pool.query('SELECT (SELECT count(*)::int FROM pg_roles WHERE rolname=ANY($1) AND rolcanlogin) l,(SELECT count(*)::int FROM pg_stat_activity WHERE usename=ANY($1)) s',[roles])).rows[0] as {l:number;s:number};
 const readOnly=await targetReadOnlyNow(targetH.pool,c.target);
 const tables=await copiedTables(sourceH.pool);
 const untouched=await proveTargetUntouched(sourceH.pool,targetH.pool,tables);
 return{loginRoles:used.l,sessions:used.s,readOnly,untouched};
}
async function restoreSource(c:RunConfig,sourceH:OwnerHandle,targetH:OwnerHandle,st:State){
 if(!await targetReadOnlyNow(targetH.pool,c.target))await readWrite(targetH.pool,[`ALTER DATABASE ${qi(c.target)} SET default_transaction_read_only=on`]);
 const fence=snapshotOf(c,st);
 await unfenceSource(sourceH.pool,c.source,fence,managerOf(c.source));
 return fence;
}
export async function rollback(ports:RunPorts){
 const c=ports.config;assertConfig(c);const head=ports.release();
 const st=readState(c);if(!st||!['COPIED_AWAITING_OWNER','WINDOW_OPEN','RECOVERY_REQUIRED'].includes(st.phase))fail('ROLLBACK_PHASE_REFUSED_'+(st?.phase??'NONE'));
 const sourceH=await ports.openOwner(c.source),targetH=await ports.openOwner(c.target);
 try{
  return await exclusive(ports,[sourceH.pool,targetH.pool],async()=>{
   await identity(sourceH.pool,c.source,c.owner);await identity(targetH.pool,c.target,c.owner);
   // The boundary decides first, and alone: after it was recorded (or when its evidence is unknown/unreadable/inconsistent) NOTHING makes going back automatic —
   // not LOGIN=0, not identical data, not zero sessions. Data equal to the source proves nothing about work done through the target while it was open.
   const act=await activationEvidence(c,st,targetH.pool);
   if(act.crossed)fail('ROLLBACK_REFUSED_ACTIVATION_STARTED');
   const f=await targetFacts(sourceH,targetH,c);
   // Pre-boundary only. Additional conditions (never sufficient on their own): nobody can log in or is connected, the target is read-only, and — unless the window never
   // allowed writes at all — the full data and every sequence still equal the frozen source.
   if(f.loginRoles>0||f.sessions>0)fail('ROLLBACK_REFUSED_TARGET_IN_USE');
   if(!f.readOnly)fail('ROLLBACK_REFUSED_TARGET_WRITABLE');
   if((st.writes??'NEVER')!=='NEVER'&&!f.untouched.untouched)fail('ROLLBACK_REFUSED_TARGET_WRITTEN');
   const fence=await restoreSource(c,sourceH,targetH,st);
   writeState(c,{...withoutWindow(st),phase:'ROLLED_BACK',writes:'NEVER',at:ports.now().toISOString()});
   return{status:'CUTOVER_ROLLED_BACK',sourceSha:head,sourceRuntimeRolesRestored:fence.wasLogin.length,targetReadOnly:true,targetProvenUntouched:true};
  });
 }finally{await sourceH.close();await targetH.close();}
}
/** Crash/failed-window recovery from the REAL database state. It rolls back only when that is provably safe; otherwise it never unfences and says so.
 * It never claims success it did not read back: a source that cannot be proven restored stays RECOVERY_REQUIRED. */
export async function recover(ports:RunPorts){
 const c=ports.config;assertConfig(c);const head=ports.release();
 const st=readState(c);if(!st)fail('PHASE_REFUSED_NONE');
 if(!['WINDOW_OPEN','RECOVERY_REQUIRED','FORWARD_FIX_ONLY'].includes(st.phase))return{status:'CUTOVER_NOTHING_TO_RECOVER',sourceSha:head,phase:st.phase};
 const sourceH=await ports.openOwner(c.source),targetH=await ports.openOwner(c.target);
 try{
  return await exclusive(ports,[sourceH.pool,targetH.pool],async()=>{
   await identity(sourceH.pool,c.source,c.owner);await identity(targetH.pool,c.target,c.owner);
   const sourceState=await readFenceState(sourceH.pool,c.source,runtimeRoleNames(c.source));
   const f=await targetFacts(sourceH,targetH,c);
   const sourceFenced=sourceState.dbSetting==='on'||st.sourceLoginRoles.some(r=>!sourceState.loginRoles.includes(r));
   const act=await activationEvidence(c,st,targetH.pool);
   const facts={phase:st.phase,sourceFenced,sourceSessions:sourceState.sessions,targetReadOnly:f.readOnly,targetRuntimeLoginRoles:f.loginRoles,targetSessions:f.sessions,targetUntouched:f.untouched.untouched,writesRecorded:st.writes??'NEVER',
    activation:act.state,activationMarker:act.marker};
   // Crossed (or unknown): forward-fix only. The source stays fenced; nothing is unfenced, whatever the data looks like.
   if(act.crossed){
    writeState(c,{...st,phase:'FORWARD_FIX_ONLY',activation:'STARTED',at:ports.now().toISOString(),recoveryReason:act.reason});
    return{status:'CUTOVER_FORWARD_FIX_ONLY',sourceSha:head,...facts,reason:act.reason,phase:'FORWARD_FIX_ONLY'};
   }
   if(!sourceFenced){
    writeState(c,{...withoutWindow(st),phase:'TARGET_BOOTSTRAPPED',writes:'NEVER',at:ports.now().toISOString()});
    return{status:'CUTOVER_RECOVERED_NOTHING_FENCED',sourceSha:head,...facts,phase:'TARGET_BOOTSTRAPPED'};
   }
   // Provably safe to go back: nobody uses the target AND (it was never made writable, or its data still equals the frozen source).
   const safe=f.loginRoles===0&&f.sessions===0&&(st.writes??'NEVER')==='NEVER'&&f.readOnly;   // pre-boundary only: the target was never made writable (data equality alone is never enough)
   if(safe){
    try{
     const fence=await restoreSource(c,sourceH,targetH,st);
     writeState(c,{...withoutWindow(st),phase:'TARGET_BOOTSTRAPPED',writes:'NEVER',at:ports.now().toISOString()});
     return{status:'CUTOVER_RECOVERED_ROLLED_BACK',sourceSha:head,...facts,sourceRuntimeRolesRestored:fence.wasLogin.length,phase:'TARGET_BOOTSTRAPPED'};
    }catch{
     writeState(c,{...st,phase:'RECOVERY_REQUIRED',at:ports.now().toISOString(),recoveryReason:'SOURCE_UNFENCE_UNVERIFIED'});
     return{status:'CUTOVER_RECOVERY_REQUIRED',sourceSha:head,...facts,reason:'SOURCE_UNFENCE_UNVERIFIED',phase:'RECOVERY_REQUIRED'};
    }
   }
   writeState(c,{...st,phase:'FORWARD_FIX_ONLY',at:ports.now().toISOString(),recoveryReason:'TARGET_MAY_HOLD_WRITES'});
   return{status:'CUTOVER_FORWARD_FIX_ONLY',sourceSha:head,...facts,reason:'TARGET_MAY_HOLD_WRITES',phase:'FORWARD_FIX_ONLY'};
  });
 }finally{await sourceH.close();await targetH.close();}
}

export async function runCommand(command:Command,ports:RunPorts){
 return command==='preflight'?preflight(ports):command==='bootstrap-target'?bootstrapTarget(ports):command==='install-target-grants'?installTargetGrantsCommand(ports):command==='prewindow-check'?prewindowCheck(ports):command==='copy-and-switch'?copyAndSwitch(ports):command==='verify-target'?verifyTarget(ports):command==='recover'?recover(ports):rollback(ports);
}

// ---------------------------------------------------------------- production adapters
const NEON_BIN=join(homedir(),'.npm/_npx/978debf9b3a75271/node_modules/.bin/neon');
/** Opens an owner session on one database of the pinned Production branch through the Neon API: memory-only URI, exact host + fingerprint, verify-full TLS with channel binding. */
export async function openProductionOwner(neon:NeonPort,database:string,createPool:(config:ConstructorParameters<typeof Pool>[0])=>Pool=c=>new Pool(c)):Promise<OwnerHandle>{
 const branch=`/projects/${T.project}/branches/${T.branch}`;
 const endpoints=(await neon.get(`${branch}/endpoints`) as {endpoints?:Array<{type?:unknown;branch_id?:unknown;host?:unknown}>}).endpoints;
 const rw=(Array.isArray(endpoints)?endpoints:[]).filter(e=>e?.type==='read_write'&&e.branch_id===T.branch);
 if(rw.length!==1||typeof rw[0]!.host!=='string')return fail('ENDPOINT_AMBIGUOUS');
 const host=(rw[0]!.host as string).trim().toLowerCase();
 assertProductionHost(host);assertProductionPort(T.port);assertProductionHostFingerprint(host);
 const raw=(await neon.get(`/projects/${T.project}/connection_uri`,{branch_id:T.branch,database_name:database,role_name:T.owner,pooled:'false'}) as {uri?:unknown}).uri;
 if(typeof raw!=='string')return fail('OWNER_SESSION_INVALID');
 let uri:URL;try{uri=new URL(raw);}catch{return fail('OWNER_SESSION_INVALID');}
 if(uri.protocol!=='postgresql:'||uri.hostname.toLowerCase()!==host||uri.pathname!=='/'+database||decodeURIComponent(uri.username)!==T.owner||decodeURIComponent(uri.password).length<16)return fail('OWNER_SESSION_INVALID');
 const pool=createPool({host,port:5432,database,user:T.owner,password:decodeURIComponent(uri.password),ssl:{rejectUnauthorized:true},enableChannelBinding:true,max:4,
  connectionTimeoutMillis:15000,idleTimeoutMillis:30000,statement_timeout:900000,application_name:'zao_production_cutover'} as never);
 pool.on('error',()=>undefined);
 const probe=await pool.connect().catch(()=>fail('OWNER_SESSION_INVALID'));
 try{assertFirstAdminTls(probe,host);}catch(e){probe.release(true);await pool.end().catch(()=>undefined);throw e;}
 probe.release();
 return{pool,close:async()=>{await pool.end().catch(()=>undefined);}};
}
export function productionPorts(root:string=process.cwd()):RunPorts{
 return{config:{source:PRODUCTION_SOURCE,target:PRODUCTION_TARGETS[0],owner:PRODUCTION_OWNER,allowedTargets:PRODUCTION_TARGETS,root,activate:true,requirePrewindow:true,requireBindings:true,requireIndependentBackup:true},
  backup:githubBackupPort(),
  release:()=>assertAcceptedMainRelease(),now:()=>new Date(),
  openOwner:async database=>{
   if(!existsSync(NEON_BIN))return fail('NEON_CLI_MISSING');
   if(database!==PRODUCTION_SOURCE&&!(PRODUCTION_TARGETS as readonly string[]).includes(database))return fail('DATABASE_REFUSED');
   return openProductionOwner(neonCliPort(NEON_BIN),database);
  }};
}
const SAFE=/^PRODUCTION_CUTOVER_[A-Z0-9_]{1,80}$|^PRODUCTION_(INSTALL|PRE0065|GROUP|FOUNDATION|DATABASE|TARGET)_[A-Z0-9_]{1,80}$/;
export async function main(argv:string[],ports:RunPorts=productionPorts()){
 const [command,...rest]=argv;
 if(rest.length||!COMMANDS.includes(command as Command))fail('ARGUMENTS_REJECTED');
 assertNoTlsOverrides();
 console.log(JSON.stringify({command,...(await runCommand(command as Command,ports))}));
}
if(process.argv[1]&&new URL(import.meta.url).pathname===process.argv[1]){
 main(process.argv.slice(2)).catch(error=>{
  const message=String((error as Error)?.message??'');
  console.error(JSON.stringify({status:'STOP',code:SAFE.test(message)?message:'PRODUCTION_CUTOVER_OPERATION_FAILED',stage:(error as {stage?:string}).stage??null,rolledBack:(error as {rolledBack?:boolean}).rolledBack??null}));
  process.exitCode=1;
 });
}
