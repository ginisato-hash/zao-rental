// Production runner for the cutover to a freshly bootstrapped 0001–0065 database (Issue #47 / TD #7214138953 §A; design: docs/execution/group/CUTOVER_RUNBOOK.md).
// Five commands, no secrets in argv/env/files: `preflight` (READ ONLY measurement), `bootstrap-target` (creates the NEW database and builds it with the proven bootstrap),
// `copy-and-switch` (fence → copy → reconcile → enable writes; stops BEFORE the Owner changes credentials), `verify-target` (READ ONLY) and `rollback` (only while the target
// has never been usable by the application). The source database is never altered, dropped or truncated: it is fenced (runtime roles NOLOGIN + read-only default) and stays
// as the recovery base. The only things the Owner decides alone (target role LOGIN/passwords, Vercel env, redeploy approval) are outside this program.
// Owner sessions are opened through the Neon API in memory, pinned to the exact host fingerprint, verify-full TLS and channel binding (same admission as the 0064 installers).
import {createHash} from 'node:crypto';
import {existsSync,lstatSync,mkdirSync,readFileSync,renameSync,writeFileSync,chmodSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {Pool} from 'pg';
import {readFile} from 'node:fs/promises';
import {migrationPlan,migrationsDirectory} from '../packages/db/src/index';
import {assertFirstAdminTls} from './lib/first-admin-bootstrap';
import {assertAcceptedMainRelease,assertNoTlsOverrides} from './lib/production-owner-session';
import {assertProductionHost,assertProductionHostFingerprint,assertProductionPort} from './production-backup';
import {BACKUP_CREDENTIAL_TARGET as T,neonCliPort,type NeonPort} from './production-backup-credential';
import {assertProductionTarget,bootstrapProductionFoundation} from './production-bootstrap';
import {productionRoleProvisioningPlan} from './production-role-provisioning';
import {installGroupRoleOnFoundation65,groupRoleNames} from './production-group-delta';
import {requirePre0065Recovery,PRE_0065_RECOVERY_FILE,PRE_0065_RECOVERY_VERSION} from './production-recovery-evidence-pre0065';
import {NOT_COPIED,TARGET_ONLY_COLUMNS,inFlightWork,installDeltaGrantsOnFoundation65,listTables,readWrite,registry,runCutover,schemaState,tableDigests,triggerStates,
 foreignKeyOrphans,unfenceSource,type Fence} from './production-cutover';

export const CUTOVER_RUN_VERSION='production-cutover-run/1';
/** The only database names this program will ever touch in Production. A second target exists so that a discarded first attempt can be replaced. */
export const PRODUCTION_SOURCE='neondb';
export const PRODUCTION_TARGETS=Object.freeze(['neondb_v65','neondb_v65b'] as const);
export const PRODUCTION_OWNER='neondb_owner';
export const COMMANDS=['preflight','bootstrap-target','copy-and-switch','verify-target','rollback'] as const;
export type Command=typeof COMMANDS[number];

export type RunConfig={source:string;target:string;owner:string;allowedTargets:readonly string[];root:string;fenceWaitMs?:number};
export type OwnerHandle={pool:Pool;close():Promise<void>};
export type RunPorts={config:RunConfig;release():string;openOwner(database:string):Promise<OwnerHandle>;now():Date};

const sha=(v:string)=>createHash('sha256').update(v).digest('hex');
const qi=(v:string)=>'"'+v.replace(/"/g,'""')+'"';
export const fail:(code:string)=>never=code=>{throw new Error('PRODUCTION_CUTOVER_'+code);};
const evidenceDir=(c:RunConfig)=>join(c.root,'.local/evidence/production-cutover');
const statePath=(c:RunConfig)=>join(evidenceDir(c),'state.json');

// ---------------------------------------------------------------- state (counts, digests and names only; mode 0600; no secret ever)
export type Phase='PREFLIGHT_OK'|'TARGET_BOOTSTRAPPED'|'WINDOW_OPEN'|'COPIED_AWAITING_OWNER'|'ROLLED_BACK'|'FORWARD_FIX_ONLY';
export type State={version:typeof CUTOVER_RUN_VERSION;source:string;target:string;phase:Phase;at:string;sourceLoginRoles:string[];sourceDigestSha256:string;sourceRows:number;
 targetSchemaStateSha256?:string;audit?:unknown;switchManifest?:SwitchManifest};
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
 if(existing&&['WINDOW_OPEN','COPIED_AWAITING_OWNER','FORWARD_FIX_ONLY'].includes(existing.phase))fail('PHASE_REFUSED_'+existing.phase);
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
   const dir=join(c.root,'.local/evidence/production-backup');mkdirSync(dir,{recursive:true,mode:0o700});
   writeFileSync(join(dir,PRE_0065_RECOVERY_FILE),JSON.stringify({version:PRE_0065_RECOVERY_VERSION,kind:'RETAINED_SOURCE_DATABASE',registry:64,recordedAt:ports.now().toISOString(),reference:`${c.source}-retained:${d.sha256.slice(0,16)}`}),{mode:0o600});
  }
  return{status:ready.ownerCreatedb&&ready.ownerCreaterole&&ready.canSetManager?'CUTOVER_PREFLIGHT_OK':'CUTOVER_PREFLIGHT_BLOCKED',sourceSha:head,source:c.source,target:c.target,registry:64,...ready,
   ownerCanTerminateRuntimeSessions:facts.signal,targetExists:facts.targetExists,runtimeLoginRoles:sourceLoginRoles.length,runtimeSessions,inFlight:facts.work,
   tables:d.tables,rows:d.rows,digestSha256Prefix:d.sha256.slice(0,16),recovery:'RETAINED_SOURCE_DATABASE',
   note:facts.signal?'termination of runtime sessions is permitted':'termination NOT permitted: the Owner must stop the application first; copy-and-switch refuses while runtime sessions remain'};
 });
}

// ---------------------------------------------------------------- bootstrap-target
export async function bootstrapTarget(ports:RunPorts){
 const c=ports.config;assertConfig(c);const head=ports.release();
 requirePre0065Recovery(c.root,ports.now());
 const st=readState(c);if(!st||(st.phase!=='PREFLIGHT_OK'&&st.phase!=='ROLLED_BACK'))fail('PREFLIGHT_REQUIRED');
 if(st.phase==='ROLLED_BACK')fail('TARGET_ALREADY_BOOTSTRAPPED');
 await withOwner(ports,c.source,async source=>{
  await assertRegistryIs(source,64);
  const exists=(await source.query('SELECT count(*)::int n FROM pg_database WHERE datname=$1',[c.target])).rows[0].n===1;
  if(!exists)await source.query(`CREATE DATABASE ${qi(c.target)} OWNER ${qi(c.owner)}`);
 });
 const result=await withOwner(ports,c.target,async target=>{
  const foundation=await bootstrapProductionFoundation(target,c.target);
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
 writeState(c,{...st,phase:'TARGET_BOOTSTRAPPED',at:ports.now().toISOString(),targetSchemaStateSha256:result.schemaState});
 return{status:'CUTOVER_TARGET_BOOTSTRAPPED',sourceSha:head,target:c.target,registry:65,schemaStateSha256Prefix:result.schemaState.slice(0,16),readOnlyUntilVerified:true};
}

// ---------------------------------------------------------------- shared READ ONLY structural proof of the target
async function targetStructure(target:Pool,c:RunConfig){
 await assertRegistryIs(target,65);
 const roles=runtimeRoleNames(c.target),exec=c.target+'_custody_executor';
 return readOnly(target,async cl=>{
  const q=async(sql:string,p:unknown[]=[])=>(await cl.query(sql,p)).rows;
  const bad=(await triggerStates(cl)).filter(t=>t.state!=='O');
  const orphans=(await foreignKeyOrphans(cl)).orphans;
  const owners=await q("SELECT p.proname,pg_get_userbyid(p.proowner) o,p.prosecdef d FROM pg_proc p WHERE p.proname IN ('rental_apply_receipt','rental_stage_guard','rental_validate_loan') ORDER BY 1");
  const nativeLink=(await q("SELECT count(*)::int n FROM information_schema.columns WHERE table_name='rental_loan_items' AND column_name IN ('group_part_id','hold_id')"))[0].n===2&&
   (await q("SELECT count(*)::int n FROM pg_class WHERE relname='group_part_preparations' AND relkind='r'"))[0].n===1;
  const members=(await q('SELECT count(*)::int n FROM pg_auth_members WHERE roleid=$1::regrole',[qi(exec)]))[0].n;
  const ephemeral=(await q("SELECT count(*)::int n FROM pg_roles WHERE rolname LIKE 'zao\\_boot\\_%'"))[0].n;
  const login=(await q('SELECT rolname FROM pg_roles WHERE rolname=ANY($1) AND rolcanlogin ORDER BY 1',[roles])).map(r=>r.rolname as string);
  const sessions=(await q('SELECT count(*)::int n FROM pg_stat_activity WHERE usename=ANY($1)',[roles]))[0].n as number;
  const ok=bad.length===0&&orphans.length===0&&owners.length===3&&owners.every(o=>o.o===exec&&o.d===true)&&nativeLink&&members===0&&ephemeral===0;
  return{ok,triggersNotEnabled:bad.length,fkOrphans:orphans.length,executorOwnedDefiners:owners.length,custodyLinkNative:nativeLink,executorMembers:members,ephemeralRoles:ephemeral,runtimeLoginRoles:login,runtimeSessions:sessions};
 });
}

// ---------------------------------------------------------------- copy-and-switch
export async function copyAndSwitch(ports:RunPorts){
 const c=ports.config;assertConfig(c);const head=ports.release();
 requirePre0065Recovery(c.root,ports.now());
 const st=readState(c);if(!st||(st.phase!=='TARGET_BOOTSTRAPPED'&&st.phase!=='ROLLED_BACK'))fail('PHASE_REFUSED_'+(st?.phase??'NONE'));
 const sourceH=await ports.openOwner(c.source),targetH=await ports.openOwner(c.target);
 try{
  await identity(sourceH.pool,c.source,c.owner);await identity(targetH.pool,c.target,c.owner);
  await assertRegistryIs(sourceH.pool,64);
  const before=await targetStructure(targetH.pool,c);
  if(!before.ok||before.runtimeLoginRoles.length||before.runtimeSessions)fail('TARGET_NOT_READY');
  const loginNow=(await sourceH.pool.query('SELECT rolname FROM pg_roles WHERE rolname=ANY($1) AND rolcanlogin ORDER BY 1',[runtimeRoleNames(c.source)])).rows.map(r=>r.rolname as string);
  // The window is recorded BEFORE the fence so that a crash leaves a state that rollback can read.
  writeState(c,{...st,phase:'WINDOW_OPEN',at:ports.now().toISOString(),sourceLoginRoles:loginNow});
  const prefixTo=c.target+'_',prefixFrom=c.source+'_';
  const manifest:SwitchManifest={database:c.target,rolePrefixFrom:prefixFrom,rolePrefixTo:prefixTo,targetRuntimeRoles:runtimeRoleNames(c.target),loginRequired:runtimeRoleNames(c.target),
   passwordEnvPrefix:'PRODUCTION_DB_PASSWORD_',roleEnvPrefix:'PRODUCTION_DB_ROLE_',nameEnv:'PRODUCTION_DB_NAME'};
  let result:Awaited<ReturnType<typeof runCutover>>;
  try{
   result=await runCutover({source:sourceH.pool,target:targetH.pool,sourceOwner:sourceH.pool,targetOwner:targetH.pool,sourceDatabase:c.source,targetDatabase:c.target,
    runtimeRoles:runtimeRoleNames(c.source),managerRole:managerOf(c.source),fenceWaitMs:c.fenceWaitMs??60000,
    switchRuntime:async()=>undefined,   // the credential switch is the Owner's: this program stops with the application unable to reach the target
    postSwitchProbe:async t=>{const s=await targetStructure(t,c);if(!s.ok||s.runtimeLoginRoles.length)throw new Error('CUTOVER_POST_SWITCH_STRUCTURE');}});
  }catch(e){
   const f=e as {stage?:string;rolledBack?:boolean;audit?:unknown;message:string};
   writeState(c,{...st,phase:f.rolledBack?'TARGET_BOOTSTRAPPED':'FORWARD_FIX_ONLY',at:ports.now().toISOString(),sourceLoginRoles:loginNow,audit:f.audit});
   throw Object.assign(new Error('PRODUCTION_CUTOVER_'+(f.message.match(/^CUTOVER_([A-Z0-9_]+)/)?.[1]??'WINDOW_FAILED')),{stage:f.stage,rolledBack:f.rolledBack});
  }
  writeState(c,{...st,phase:'COPIED_AWAITING_OWNER',at:ports.now().toISOString(),sourceLoginRoles:loginNow,audit:result.audit,switchManifest:manifest});
  return{status:'CUTOVER_COPIED_AWAITING_OWNER',sourceSha:head,chainValid:result.chainValid,tables:result.report.tables,rows:result.report.rows,sequences:result.report.sequences,
   sourceFenced:true,targetWritableByApplication:false,steps:result.audit.map(a=>a.step),switchManifest:manifest};
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
  let identical:boolean|null=null;
  // Source and target hold the same rows only while nobody can write to either: the application cannot log in to the target and the source is fenced.
  const sourceLogin=Number((await sourceH.pool.query('SELECT count(*)::int n FROM pg_roles WHERE rolname=ANY($1) AND rolcanlogin',[runtimeRoleNames(c.source)])).rows[0].n);
  if(s.runtimeLoginRoles.length===0&&sourceLogin===0){
   const tables=await copiedTables(sourceH.pool);
   const a=await readOnly(sourceH.pool,cl=>tableDigests(cl,tables)),b=await readOnly(targetH.pool,cl=>tableDigests(cl,tables,TARGET_ONLY_COLUMNS));
   identical=tables.every(t=>a[t]!.rows===b[t]!.rows&&a[t]!.sha256===b[t]!.sha256);
  }
  return{status:s.ok&&schemaUnchanged&&identical!==false?'CUTOVER_TARGET_VERIFIED':'CUTOVER_TARGET_VERIFY_FAILED',sourceSha:head,phase:st.phase,registry:65,...s,schemaUnchanged,
   rowsIdenticalToSource:identical,sourceRuntimeLoginRoles:sourceLogin,mode:identical===null?'STRUCTURAL_ONLY_TARGET_IN_USE':'FULL_PRE_SWITCH'};
 }finally{await sourceH.close();await targetH.close();}
}

// ---------------------------------------------------------------- rollback (only while the application has never been able to use the target)
export async function rollback(ports:RunPorts){
 const c=ports.config;assertConfig(c);const head=ports.release();
 const st=readState(c);if(!st||st.phase!=='COPIED_AWAITING_OWNER')fail('ROLLBACK_PHASE_REFUSED_'+(st?.phase??'NONE'));
 const sourceH=await ports.openOwner(c.source),targetH=await ports.openOwner(c.target);
 try{
  await identity(sourceH.pool,c.source,c.owner);await identity(targetH.pool,c.target,c.owner);
  const roles=runtimeRoleNames(c.target);
  const used=(await targetH.pool.query('SELECT (SELECT count(*)::int FROM pg_roles WHERE rolname=ANY($1) AND rolcanlogin) l,(SELECT count(*)::int FROM pg_stat_activity WHERE usename=ANY($1)) s',[roles])).rows[0];
  // Proof the target never accepted an application write: no runtime role of it can log in and none has a session. Otherwise only a forward fix is allowed (never two writers).
  if(used.l>0||used.s>0)fail('ROLLBACK_REFUSED_TARGET_IN_USE');
  await readWrite(targetH.pool,[`ALTER DATABASE ${qi(c.target)} SET default_transaction_read_only=on`]);
  const fence:Fence={roles:runtimeRoleNames(c.source),wasLogin:st.sourceLoginRoles,terminated:0,terminateDenied:false};
  await unfenceSource(sourceH.pool,c.source,fence,managerOf(c.source));
  writeState(c,{...st,phase:'ROLLED_BACK',at:ports.now().toISOString()});
  return{status:'CUTOVER_ROLLED_BACK',sourceSha:head,sourceRuntimeRolesRestored:st.sourceLoginRoles.length,targetReadOnly:true};
 }finally{await sourceH.close();await targetH.close();}
}

export async function runCommand(command:Command,ports:RunPorts){
 return command==='preflight'?preflight(ports):command==='bootstrap-target'?bootstrapTarget(ports):command==='copy-and-switch'?copyAndSwitch(ports):command==='verify-target'?verifyTarget(ports):rollback(ports);
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
 return{config:{source:PRODUCTION_SOURCE,target:PRODUCTION_TARGETS[0],owner:PRODUCTION_OWNER,allowedTargets:PRODUCTION_TARGETS,root},
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
