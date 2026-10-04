// ZAO R49: secret-safe one-shot credential lifecycle for the single Production role neondb_backup.
// Issue 47 (Technical Director accepted). This is the ONLY command surface through which a Neon reset_password POST for this
// role may be issued; the raw POST is never an allowed command on its own. Exact target, no arguments:
//   project curly-union-23141081, branch br-long-king-azkou4fy, database neondb, role neondb_backup,
//   GitHub Environment production-backup of ginisato-hash/zao-rental.
// Secret handling: the Neon response and the owner-session connection URI are captured in this process and parsed in memory
// (the child's stdout is never inherited). The new password reaches exactly one place, `gh secret set` over stdin. It is
// never written to stdout, logs, a temporary file, argv or an environment file, and every failure is reduced to a fixed code.
// reset_password is non-idempotent: it is issued at most once per authorization. A durable local guard is claimed before the
// POST, so even a crash or an unknown outcome is never resent; an unknown outcome contains the role and stops.
// Order (provision): preconditions (read-only) -> role is NOLOGIN/clean -> temporary password in memory -> manager SET and
// ALTER ROLE NOLOGIN PASSWORD temp -> ONE reset_password -> operations finished -> bounded LOGIN lease from the DATABASE clock
// -> fresh direct TLS verify-full + channel-binding login and read-only posture probes -> sinks -> activation variable LAST.
// finalize (VALID UNTIL infinity) runs only after a restore PASS record. contain (NOLOGIN PASSWORD NULL, sink and activation
// removed) is idempotent and bounded.
import {execFile,spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {closeSync,existsSync,mkdirSync,openSync,readFileSync,writeSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {Client} from 'pg';
import {productionCredentialBaseline,productionCredentialCompleteReset,productionCredentialContainmentComplete,productionCredentialContainmentSchedule,
 productionCredentialPasswordFromResetResponse,productionCredentialTemporaryPassword} from './production-credential-activation';
import {assertProductionHost,assertProductionHostFingerprint,assertProductionPort,fingerprintHost} from './production-backup';

export const BACKUP_CREDENTIAL_VERSION='production-backup-credential/1';
export const BACKUP_CREDENTIAL_TARGET=Object.freeze({project:'curly-union-23141081',branch:'br-long-king-azkou4fy',database:'neondb',role:'neondb_backup',
 owner:'neondb_owner',manager:'neondb_role_admin',repo:'ginisato-hash/zao-rental',environment:'production-backup',port:'5432'});
const T=BACKUP_CREDENTIAL_TARGET;
/** The first Production Backup workflow has a 30-minute timeout; the lease covers queueing plus that run with a wide margin and
 * is still bounded. It is a database-clock deadline, not the 20-minute commercial lease. */
export const BACKUP_LOGIN_LEASE_MINUTES=90;
export const BACKUP_WORKFLOW_TIMEOUT_MINUTES=30;
export const BACKUP_SINKS=Object.freeze({host:'PRODUCTION_BACKUP_PGHOST',port:'PRODUCTION_BACKUP_PGPORT',database:'PRODUCTION_BACKUP_PGDATABASE',
 user:'PRODUCTION_BACKUP_PGUSER',password:'PRODUCTION_BACKUP_PGPASSWORD'});
/** Owner-supplied before provisioning; this module never creates or reads their values. */
export const BACKUP_OWNER_SECRETS=Object.freeze(['PRODUCTION_BACKUP_R2_ACCOUNT_ID','PRODUCTION_BACKUP_R2_ACCESS_KEY_ID','PRODUCTION_BACKUP_R2_SECRET_ACCESS_KEY']);
export const BACKUP_BUCKET='zao-rental-prod-backup';
export const BACKUP_ACTIVATION_VALUE='R4_APPROVED';
const AGE_RECIPIENT=/^age1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{58}$/;
const OBJECT_KEY=/^(hourly|daily)\/\d{4}\/\d{2}\/\d{2}\/[0-9TZ.:-]+\.dump\.age$/;
const OPERATION_ID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const qi=(v:string)=>{if(!/^[a-z][a-z0-9_]{2,62}$/.test(v))throw new Error('BACKUP_CREDENTIAL_NAME_INVALID');return '"'+v+'"';};
const sha=(v:string)=>createHash('sha256').update(v).digest('hex');
const fail=(code:string)=>new Error(code);

// ---------------------------------------------------------------- pure contract
export function assertAgeRecipient(value:unknown):asserts value is string{
 if(typeof value!=='string'||!AGE_RECIPIENT.test(value))throw fail('BACKUP_CREDENTIAL_AGE_RECIPIENT_INVALID');
}
export const backupManagerSet=()=>`SET LOCAL ROLE ${qi(T.manager)}`;
export function backupTemporaryPasswordSql(temporary:string):string[]{
 if(!/^[A-Za-z0-9_-]{43}$/.test(temporary))throw fail('BACKUP_CREDENTIAL_TEMPORARY_PASSWORD_INVALID');
 return [backupManagerSet(),`ALTER ROLE ${qi(T.role)} NOLOGIN PASSWORD '${temporary}' VALID UNTIL 'infinity'`];
}
export function backupLoginSql(deadline:string):string[]{
 if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(deadline))throw fail('BACKUP_CREDENTIAL_LEASE_INVALID');
 return [backupManagerSet(),`ALTER ROLE ${qi(T.role)} LOGIN VALID UNTIL '${deadline}'`];
}
export const backupFinalizeSql=()=>[backupManagerSet(),`ALTER ROLE ${qi(T.role)} VALID UNTIL 'infinity'`];
export const backupContainSql=()=>[backupManagerSet(),`ALTER ROLE ${qi(T.role)} NOLOGIN PASSWORD NULL VALID UNTIL 'infinity'`];
export const backupResetPath=()=>`/projects/${T.project}/branches/${T.branch}/roles/${T.role}/reset_password`;
/** Database clock text + the lease, keeping PostgreSQL's fractional seconds exactly, normalised to UTC. */
export function backupLeaseDeadline(databaseNow:string,minutes:number=BACKUP_LOGIN_LEASE_MINUTES):string{
 const parts=/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(\.\d{1,6})?(Z|[+-]\d{2}(?::?\d{2})?)$/.exec(databaseNow);
 if(!parts)throw fail('BACKUP_CREDENTIAL_DATABASE_TIME_INVALID');
 const t=Date.parse(`${parts[1]}T${parts[2]}${parts[4]!.replace(/^([+-]\d{2})$/,'$1:00')}`);
 if(!Number.isFinite(t))throw fail('BACKUP_CREDENTIAL_DATABASE_TIME_INVALID');
 return new Date(t+minutes*60000).toISOString().slice(0,19)+(parts[3]??'')+'Z';
}
export type RoleState={rolcanlogin:boolean;rolvaliduntil:string|null;passwordIsNull:boolean|'UNREADABLE';attributes:string;memberships:string[];grantees:string[];owned:number;canConnect:boolean};
/** Reviewed posture (foundation): NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOREPLICATION NOBYPASSRLS unlimited connections, member of
 * pg_read_all_data only, ADMIN held only by the manager, owns nothing, may CONNECT. Any drift is refused. */
export function backupPostureDrift(s:RoleState):string[]{
 const out:string[]=[];
 if(s.attributes!=='super=f,createdb=f,createrole=f,repl=f,bypassrls=f,inherit=t,connlimit=-1')out.push('ATTRIBUTES');
 if(JSON.stringify(s.memberships)!==JSON.stringify(['pg_read_all_data']))out.push('MEMBERSHIPS');
 if(JSON.stringify(s.grantees)!==JSON.stringify([T.manager]))out.push('GRANTEES');
 if(s.owned!==0)out.push('OWNED_OBJECTS');
 if(!s.canConnect)out.push('CONNECT');
 return out;
}
/** pg_authid may not be readable on the provider; then password absence is not asserted and the evidence says so. */
const baselineOf=(s:RoleState)=>productionCredentialBaseline({rolcanlogin:s.rolcanlogin,passwordIsNull:s.passwordIsNull==='UNREADABLE'?true:s.passwordIsNull,rolvaliduntil:s.rolvaliduntil});
const containedOf=(s:RoleState)=>productionCredentialContainmentComplete({rolcanlogin:s.rolcanlogin,passwordIsNull:s.passwordIsNull==='UNREADABLE'?true:s.passwordIsNull,rolvaliduntil:s.rolvaliduntil});
export type RestorePass={result:'PASS';objectKey:string;objectSha256:string};
export function assertRestorePass(v:unknown):asserts v is RestorePass{
 const r=v as Partial<RestorePass>|null;
 if(!r||r.result!=='PASS'||typeof r.objectKey!=='string'||!OBJECT_KEY.test(r.objectKey)||typeof r.objectSha256!=='string'||!/^[a-f0-9]{64}$/.test(r.objectSha256))throw fail('BACKUP_CREDENTIAL_RESTORE_PASS_REQUIRED');
}

// ---------------------------------------------------------------- ports
export interface NeonPort{get(path:string,query?:Record<string,string>):Promise<unknown>;post(path:string):Promise<unknown>}
export interface GitHubPort{secretNames():Promise<string[]>;variables():Promise<Record<string,string>>;setSecret(name:string,value:string):Promise<void>;
 setVariable(name:string,value:string):Promise<void>;deleteSecret(name:string):Promise<void>;deleteVariable(name:string):Promise<void>}
export interface SqlSession{query<R=Record<string,unknown>>(sql:string,params?:unknown[]):Promise<{rows:R[]}>;end():Promise<void>}
export type ConnectionConfig={host:string;port:number;database:string;user:string;password:string};
export interface GuardStore{claim():void;exists():boolean}
export interface BackupCredentialPorts{neon:NeonPort;github:GitHubPort;connectOwner(c:ConnectionConfig):Promise<SqlSession>;connectBackup(c:ConnectionConfig):Promise<SqlSession>;
 guard:GuardStore;sleep(ms:number):Promise<void>;now():Date;expectTls:boolean;containmentSchedule?:number[];
 /** Tests only: the CLI never sets it, so the committed Production endpoint fingerprint always applies. */
 expectedHostFingerprint?:string}

const ROLE_STATE_SQL=`SELECT r.rolcanlogin AS "rolcanlogin",
 CASE WHEN r.rolvaliduntil IS NULL THEN NULL WHEN isfinite(r.rolvaliduntil) THEN (r.rolvaliduntil AT TIME ZONE 'UTC')::text||'+00' ELSE r.rolvaliduntil::text END AS "rolvaliduntil",
 format('super=%s,createdb=%s,createrole=%s,repl=%s,bypassrls=%s,inherit=%s,connlimit=%s',left(r.rolsuper::text,1),left(r.rolcreatedb::text,1),left(r.rolcreaterole::text,1),
  left(r.rolreplication::text,1),left(r.rolbypassrls::text,1),left(r.rolinherit::text,1),r.rolconnlimit) AS "attributes",
 coalesce((SELECT array_agg(g.rolname::text ORDER BY g.rolname::text) FROM pg_auth_members m JOIN pg_roles g ON g.oid=m.roleid WHERE m.member=r.oid),'{}') AS "memberships",
 coalesce((SELECT array_agg(g.rolname::text ORDER BY g.rolname::text) FROM pg_auth_members m JOIN pg_roles g ON g.oid=m.member WHERE m.roleid=r.oid),'{}') AS "grantees",
 (SELECT count(*)::int FROM pg_shdepend d WHERE d.refclassid='pg_authid'::regclass AND d.refobjid=r.oid AND d.deptype='o') AS "owned",
 has_database_privilege(r.oid,current_database(),'CONNECT') AS "canConnect"
 FROM pg_roles r WHERE r.rolname=$1`;
export async function readRoleState(s:SqlSession):Promise<RoleState>{
 const r=await s.query<Omit<RoleState,'passwordIsNull'>>(ROLE_STATE_SQL,[T.role]);
 if(r.rows.length!==1)throw fail('BACKUP_CREDENTIAL_ROLE_MISSING');
 let passwordIsNull:boolean|'UNREADABLE'='UNREADABLE';
 try{
  const p=await s.query<{passwordIsNull:boolean}>('SELECT a.rolpassword IS NULL AS "passwordIsNull" FROM pg_authid a WHERE a.rolname=$1',[T.role]);
  if(p.rows.length===1&&typeof p.rows[0]!.passwordIsNull==='boolean')passwordIsNull=p.rows[0]!.passwordIsNull;
 }catch{/* provider does not expose pg_authid to this session */}
 return {...r.rows[0]!,passwordIsNull};
}
async function tx(s:SqlSession,sql:string[]){
 await s.query('BEGIN');
 try{for(const q of sql)await s.query(q);await s.query('COMMIT');}
 catch{try{await s.query('ROLLBACK');}catch{/* connection already gone */}throw fail('BACKUP_CREDENTIAL_SQL_FAILED');}
}

// ---------------------------------------------------------------- target identity (read-only Neon GETs)
type Json=Record<string,unknown>;
const obj=(v:unknown,code:string):Json=>{if(!v||typeof v!=='object'||Array.isArray(v))throw fail(code);return v as Json;};
async function verifyTarget(p:BackupCredentialPorts){
 const base=`/projects/${T.project}`,branch=`${base}/branches/${T.branch}`;
 const project=obj(obj(await p.neon.get(base),'BACKUP_CREDENTIAL_TARGET_MISMATCH').project,'BACKUP_CREDENTIAL_TARGET_MISMATCH');
 if(project.id!==T.project)throw fail('BACKUP_CREDENTIAL_TARGET_MISMATCH');
 const b=obj(obj(await p.neon.get(branch),'BACKUP_CREDENTIAL_TARGET_MISMATCH').branch,'BACKUP_CREDENTIAL_TARGET_MISMATCH');
 if(b.id!==T.branch)throw fail('BACKUP_CREDENTIAL_TARGET_MISMATCH');
 const d=obj(obj(await p.neon.get(`${branch}/databases/${T.database}`),'BACKUP_CREDENTIAL_TARGET_MISMATCH').database,'BACKUP_CREDENTIAL_TARGET_MISMATCH');
 if(d.name!==T.database||d.owner_name!==T.owner)throw fail('BACKUP_CREDENTIAL_TARGET_MISMATCH');
 const roles=obj(await p.neon.get(`${branch}/roles`),'BACKUP_CREDENTIAL_TARGET_MISMATCH').roles;
 const names=Array.isArray(roles)?roles.map(r=>(r as Json)?.name):[];
 for(const need of [T.role,T.manager,T.owner])if(!names.includes(need))throw fail('BACKUP_CREDENTIAL_TARGET_MISMATCH');
 const eps=obj(await p.neon.get(`${branch}/endpoints`),'BACKUP_CREDENTIAL_TARGET_MISMATCH').endpoints;
 const rw=(Array.isArray(eps)?eps:[]).map(e=>e as Json).filter(e=>e.type==='read_write'&&e.branch_id===T.branch);
 if(rw.length!==1||typeof rw[0]!.host!=='string')throw fail('BACKUP_CREDENTIAL_ENDPOINT_AMBIGUOUS');
 const host=(rw[0]!.host as string).trim().toLowerCase();
 assertProductionHost(host);assertProductionPort(T.port);assertProductionHostFingerprint(host,p.expectedHostFingerprint);
 const retention=project.history_retention_seconds;
 return {host,hostSha256Prefix:fingerprintHost(host).slice(0,12),historyRetentionSeconds:typeof retention==='number'?retention:null};
}
async function ownerSession(p:BackupCredentialPorts,host:string):Promise<SqlSession>{
 const uri=obj(await p.neon.get(`/projects/${T.project}/connection_uri`,{branch_id:T.branch,database_name:T.database,role_name:T.owner,pooled:'false'}),'BACKUP_CREDENTIAL_OWNER_SESSION_INVALID').uri;
 if(typeof uri!=='string')throw fail('BACKUP_CREDENTIAL_OWNER_SESSION_INVALID');
 let u:URL;try{u=new URL(uri);}catch{throw fail('BACKUP_CREDENTIAL_OWNER_SESSION_INVALID');}
 if(u.hostname.toLowerCase()!==host||decodeURIComponent(u.username)!==T.owner||u.pathname!=='/'+T.database||!u.password)throw fail('BACKUP_CREDENTIAL_OWNER_SESSION_INVALID');
 const s=await p.connectOwner({host,port:Number(T.port),database:T.database,user:T.owner,password:decodeURIComponent(u.password)});
 const id=await s.query<{database:string;user:string}>('SELECT current_database() AS database,current_user AS user');
 if(id.rows[0]?.database!==T.database||id.rows[0].user!==T.owner){await s.end();throw fail('BACKUP_CREDENTIAL_OWNER_SESSION_INVALID');}
 return s;
}

// ---------------------------------------------------------------- containment
export type ContainResult={state:'CONTAINED'|'CONTAINMENT_FAILED';sinkDeleted:boolean;activationDeleted:boolean;attempts:number};
export async function containBackupCredential(p:BackupCredentialPorts):Promise<ContainResult>{
 let sinkDeleted=false,activationDeleted=false,attempts=0;
 // Stop consumers first: activation variable, then the password sink. Absent is success; the readback decides.
 try{await p.github.deleteVariable('PRODUCTION_BACKUP_ACTIVATION');}catch{/* verified below */}
 try{await p.github.deleteSecret(BACKUP_SINKS.password);}catch{/* verified below */}
 try{activationDeleted=!('PRODUCTION_BACKUP_ACTIVATION' in await p.github.variables());}catch{/* unknown stays false */}
 try{sinkDeleted=!(await p.github.secretNames()).includes(BACKUP_SINKS.password);}catch{/* unknown stays false */}
 const schedule=p.containmentSchedule??productionCredentialContainmentSchedule();
 let session:SqlSession|undefined;
 try{
  for(let i=0;i<=schedule.length;i++){
   attempts++;
   try{
    if(!session){const target=await verifyTarget(p);session=await ownerSession(p,target.host);}
    await tx(session,backupContainSql());
    if(containedOf(await readRoleState(session)))return {state:'CONTAINED',sinkDeleted,activationDeleted,attempts};
   }catch{try{await session?.end();}catch{/* ignore */}session=undefined;}
   if(i<schedule.length)await p.sleep(schedule[i]!*1000);
  }
  return {state:'CONTAINMENT_FAILED',sinkDeleted,activationDeleted,attempts};
 }finally{try{await session?.end();}catch{/* ignore */}}
}

// ---------------------------------------------------------------- provision
export type ProvisionEvidence=Readonly<{version:string;state:'PROVISIONED';target:{project:string;branch:string;database:string;role:string};endpointHostSha256Prefix:string;
 historyRetentionSeconds:number|null;baseline:string;passwordReadback:'READABLE'|'UNREADABLE';resetPostCount:1;resetOperations:number;leaseMinutes:number;leaseDeadline:string;
 tlsVerified:boolean;probes:string[];secretsSet:string[];activation:'SET_LAST';steps:string[]}>;
export async function provisionBackupCredential(p:BackupCredentialPorts):Promise<ProvisionEvidence>{
 const steps:string[]=[];let mutated=false,owner:SqlSession|undefined,backup:SqlSession|undefined;
 try{
  // 1. Preconditions: everything read-only, nothing written, no database session yet.
  if(p.guard.exists())throw fail('BACKUP_CREDENTIAL_RESET_ALREADY_ATTEMPTED');
  const secrets=await p.github.secretNames(),vars=await p.github.variables();
  for(const need of BACKUP_OWNER_SECRETS)if(!secrets.includes(need))throw fail('BACKUP_CREDENTIAL_PRECONDITION_R2_SINK_MISSING');
  // The non-secret sinks may survive a contained attempt and are simply overwritten; a present password sink is never silently replaced.
  if(secrets.includes(BACKUP_SINKS.password))throw fail('BACKUP_CREDENTIAL_PRECONDITION_SINK_NOT_CLEAN');
  if(vars.PRODUCTION_BACKUP_BUCKET!==BACKUP_BUCKET)throw fail('BACKUP_CREDENTIAL_PRECONDITION_BUCKET_VARIABLE');
  assertAgeRecipient(vars.AGE_BACKUP_RECIPIENT);
  if('PRODUCTION_BACKUP_ACTIVATION' in vars)throw fail('BACKUP_CREDENTIAL_PRECONDITION_ACTIVATION_NOT_CLEAN');
  steps.push('PRECONDITIONS_READ_ONLY');
  const target=await verifyTarget(p);steps.push('NEON_TARGET_IDENTITY');
  owner=await ownerSession(p,target.host);steps.push('OWNER_SESSION_MEMORY_ONLY');
  // 2. Clean, undrifted baseline.
  const before=await readRoleState(owner),baseline=baselineOf(before);
  if(baseline!=='READY_PRISTINE'&&baseline!=='READY_NORMALIZED')throw fail('BACKUP_CREDENTIAL_BASELINE_NOT_CLEAN');
  if(backupPostureDrift(before).length)throw fail('BACKUP_CREDENTIAL_PRIVILEGE_DRIFT');
  steps.push('BASELINE_'+baseline);
  // 3-5. Temporary password (memory only) set while NOLOGIN, through the manager.
  const temporary=productionCredentialTemporaryPassword();
  mutated=true;
  await tx(owner,backupTemporaryPasswordSql(temporary));
  const afterTemp=await readRoleState(owner);
  if(afterTemp.rolcanlogin||afterTemp.rolvaliduntil!=='infinity'||backupPostureDrift(afterTemp).length)throw fail('BACKUP_CREDENTIAL_POSTURE_CHANGED');
  steps.push('TEMPORARY_PASSWORD_NOLOGIN');
  // 6. Exactly one reset_password. The guard is claimed first; any failure after this point is an unknown outcome and is never resent.
  p.guard.claim();
  let body:unknown;
  try{body=await p.neon.post(backupResetPath());}catch{throw fail('BACKUP_CREDENTIAL_RESET_OUTCOME_UNKNOWN');}
  const pending=productionCredentialPasswordFromResetResponse(body,T.role,temporary);
  body=undefined;
  steps.push('RESET_PASSWORD_POST_ONCE');
  // 7. Every returned operation finished.
  const status:Record<string,string>={};const deadline=p.now().getTime()+120_000;
  for(const id of pending.operationIds){
   if(!OPERATION_ID.test(id))throw fail('BACKUP_CREDENTIAL_RESET_RESPONSE_INVALID');
   for(;;){
    const op=obj(obj(await p.neon.get(`/projects/${T.project}/operations/${id}`),'BACKUP_CREDENTIAL_OPERATION_INVALID').operation,'BACKUP_CREDENTIAL_OPERATION_INVALID');
    const st=typeof op.status==='string'?op.status:'';status[id]=st;
    if(st==='finished')break;
    if(st==='failed'||st==='error'||st==='cancelled'||st==='cancelling'||st==='skipped')throw fail('BACKUP_CREDENTIAL_RESET_NOT_COMPLETED');
    if(p.now().getTime()>=deadline)throw fail('BACKUP_CREDENTIAL_RESET_NOT_COMPLETED');
    await p.sleep(2000);
   }
  }
  const credential=productionCredentialCompleteReset(pending,status);
  steps.push('RESET_OPERATIONS_FINISHED');
  // 8. Bounded LOGIN lease from the database clock, covering the first workflow run.
  const clock=await owner.query<{now:string}>('SELECT clock_timestamp()::text AS now');
  const leaseDeadline=backupLeaseDeadline(String(clock.rows[0]?.now));
  await tx(owner,backupLoginSql(leaseDeadline));
  steps.push('LOGIN_LEASE_'+BACKUP_LOGIN_LEASE_MINUTES+'M_DB_CLOCK');
  // 9-10. Fresh direct login with the real client path, then read-only posture probes (no business row is read).
  backup=await p.connectBackup({host:target.host,port:Number(T.port),database:T.database,user:T.role,password:credential.password});
  const who=await backup.query<{current_user:string;session_user:string;ssl:boolean|null}>('SELECT current_user,session_user,(SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) AS ssl');
  if(who.rows[0]?.current_user!==T.role||who.rows[0].session_user!==T.role||(p.expectTls&&who.rows[0].ssl!==true))throw fail('BACKUP_CREDENTIAL_PROBE_FAILED');
  const probes:string[]=['IDENTITY'];if(p.expectTls)probes.push('TLS_VERIFY_FULL_CHANNEL_BINDING');
  const flags=await backup.query<{read_all:boolean;write_all:boolean;flags:boolean}>(`SELECT pg_has_role(current_user,'pg_read_all_data','USAGE') AS read_all,pg_has_role(current_user,'pg_write_all_data','USAGE') AS write_all,
   (r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls) AS flags FROM pg_roles r WHERE r.rolname=current_user`);
  if(flags.rows[0]?.read_all!==true||flags.rows[0].write_all!==false||flags.rows[0].flags!==false)throw fail('BACKUP_CREDENTIAL_PROBE_FAILED');
  probes.push('PG_READ_ALL_DATA_ONLY');
  const table=await backup.query<{relname:string}>(`SELECT c.relname FROM pg_class c WHERE c.relkind='r' AND c.relnamespace='public'::regnamespace ORDER BY c.relname LIMIT 1`);
  const name=table.rows[0]?.relname;
  if(typeof name!=='string'||!/^[a-z_][a-z0-9_]*$/.test(name))throw fail('BACKUP_CREDENTIAL_PROBE_FAILED');
  await backup.query(`SELECT 1 FROM public.${qi(name)} LIMIT 0`);probes.push('READ_PRIVILEGE_NO_ROWS');
  let denied:string|undefined;
  await backup.query('BEGIN');
  try{await backup.query(`DELETE FROM public.${qi(name)} WHERE false`);}catch(e){denied=(e as {code?:string})?.code;}
  try{await backup.query('ROLLBACK');}catch{/* session already aborted */}
  if(denied!=='42501')throw fail('BACKUP_CREDENTIAL_PROBE_FAILED');
  probes.push('WRITE_DENIED_42501');
  await backup.end();backup=undefined;
  const afterLogin=await readRoleState(owner);
  if(!afterLogin.rolcanlogin||backupPostureDrift(afterLogin).length)throw fail('BACKUP_CREDENTIAL_POSTURE_CHANGED');
  steps.push('DIRECT_LOGIN_AND_PROBES');
  // 11. Sinks: non-password values first, the password last, straight from memory into gh over stdin.
  const set:string[]=[];
  for(const [sink,value] of [[BACKUP_SINKS.host,target.host],[BACKUP_SINKS.port,T.port],[BACKUP_SINKS.database,T.database],[BACKUP_SINKS.user,T.role]] as const){await p.github.setSecret(sink,value);set.push(sink);}
  await p.github.setSecret(BACKUP_SINKS.password,credential.password);set.push(BACKUP_SINKS.password);
  const present=await p.github.secretNames();
  for(const need of [...BACKUP_OWNER_SECRETS,...set])if(!present.includes(need))throw fail('BACKUP_CREDENTIAL_SINK_READBACK_FAILED');
  steps.push('SINKS_METADATA_READBACK');
  // 12. Activation variable strictly last, after every precondition and sink is read back.
  await p.github.setVariable('PRODUCTION_BACKUP_ACTIVATION',BACKUP_ACTIVATION_VALUE);
  if((await p.github.variables()).PRODUCTION_BACKUP_ACTIVATION!==BACKUP_ACTIVATION_VALUE)throw fail('BACKUP_CREDENTIAL_ACTIVATION_READBACK_FAILED');
  steps.push('ACTIVATION_SET_LAST');
  return Object.freeze({version:BACKUP_CREDENTIAL_VERSION,state:'PROVISIONED' as const,target:{project:T.project,branch:T.branch,database:T.database,role:T.role},
   endpointHostSha256Prefix:target.hostSha256Prefix,historyRetentionSeconds:target.historyRetentionSeconds,baseline,passwordReadback:afterTemp.passwordIsNull==='UNREADABLE'?'UNREADABLE' as const:'READABLE' as const,
   resetPostCount:1 as const,resetOperations:pending.operationIds.length,leaseMinutes:BACKUP_LOGIN_LEASE_MINUTES,leaseDeadline,tlsVerified:p.expectTls,probes,secretsSet:set,activation:'SET_LAST' as const,steps});
 }catch(e){
  const code=safeCode(e);
  try{await backup?.end();}catch{/* ignore */}
  try{await owner?.end();}catch{/* ignore */}
  owner=undefined;
  const contained=mutated?await containBackupCredential(p):undefined;
  throw Object.assign(fail(code),{contained,steps});
 }finally{try{await owner?.end();}catch{/* ignore */}}
}

// ---------------------------------------------------------------- finalize (after the restore PASS record only)
export type FinalizeEvidence=Readonly<{version:string;state:'FINALIZED';role:string;validUntil:'infinity';objectKey:string}>;
export async function finalizeBackupCredential(p:BackupCredentialPorts,proof:unknown):Promise<FinalizeEvidence>{
 let owner:SqlSession|undefined,issued=false;
 try{
  assertRestorePass(proof);
  const secrets=await p.github.secretNames(),vars=await p.github.variables();
  if(!secrets.includes(BACKUP_SINKS.password)||vars.PRODUCTION_BACKUP_ACTIVATION!==BACKUP_ACTIVATION_VALUE)throw fail('BACKUP_CREDENTIAL_FINALIZE_PRECONDITION');
  const target=await verifyTarget(p);owner=await ownerSession(p,target.host);
  const before=await readRoleState(owner);
  if(!before.rolcanlogin||backupPostureDrift(before).length)throw fail('BACKUP_CREDENTIAL_FINALIZE_PRECONDITION');
  issued=true;
  await tx(owner,backupFinalizeSql());
  const after=await readRoleState(owner);
  if(!after.rolcanlogin||after.rolvaliduntil!=='infinity'||backupPostureDrift(after).length)throw fail('BACKUP_CREDENTIAL_FINALIZATION_FAILED');
  return Object.freeze({version:BACKUP_CREDENTIAL_VERSION,state:'FINALIZED' as const,role:T.role,validUntil:'infinity' as const,objectKey:proof.objectKey});
 }catch(e){
  const code=safeCode(e);
  try{await owner?.end();}catch{/* ignore */}owner=undefined;
  // A finalization that was issued and not proven is terminal: contain and stop. Earlier refusals change nothing.
  throw Object.assign(fail(code),{contained:issued?await containBackupCredential(p):undefined});
 }finally{try{await owner?.end();}catch{/* ignore */}}
}

// ---------------------------------------------------------------- age recipient variable (public value, validated)
export async function setAgeRecipient(p:Pick<BackupCredentialPorts,'github'>,recipient:string){
 assertAgeRecipient(recipient);
 const existing=(await p.github.variables()).AGE_BACKUP_RECIPIENT;
 if(existing!==undefined&&existing!==recipient)throw fail('BACKUP_CREDENTIAL_AGE_RECIPIENT_CONFLICT');
 if(existing===undefined)await p.github.setVariable('AGE_BACKUP_RECIPIENT',recipient);
 if((await p.github.variables()).AGE_BACKUP_RECIPIENT!==recipient)throw fail('BACKUP_CREDENTIAL_AGE_RECIPIENT_READBACK_FAILED');
 return Object.freeze({version:BACKUP_CREDENTIAL_VERSION,state:'AGE_RECIPIENT_SET' as const,recipientSha256Prefix:sha(recipient).slice(0,12)});
}

const SAFE_CODE=/^BACKUP_(CREDENTIAL|HOST|PORT)_[A-Z0-9_]{1,80}$/;
function safeCode(e:unknown):string{const m=(e as Error)?.message;return typeof m==='string'&&SAFE_CODE.test(m)?m:/^PRODUCTION_CREDENTIAL_[A-Z0-9_]{1,80}$/.test(String(m))?String(m):'BACKUP_CREDENTIAL_FAILED';}

// ---------------------------------------------------------------- production adapters (child stdout is always captured, never inherited)
const NEON_BIN=join(homedir(),'.npm/_npx/978debf9b3a75271/node_modules/.bin/neon');
const NEON_GET=[new RegExp(`^/projects/${T.project}$`),new RegExp(`^/projects/${T.project}/branches/${T.branch}$`),new RegExp(`^/projects/${T.project}/branches/${T.branch}/(databases/${T.database}|roles|endpoints)$`),
 new RegExp(`^/projects/${T.project}/connection_uri$`),new RegExp(`^/projects/${T.project}/operations/[a-f0-9-]{36}$`)];
export function neonCliPort(bin:string=NEON_BIN,env:NodeJS.ProcessEnv=process.env):NeonPort{
 const run=(args:string[])=>new Promise<unknown>((resolve,reject)=>execFile(bin,args,{env,maxBuffer:1<<20,timeout:90_000,encoding:'utf8',windowsHide:true},(error,stdout)=>{
  if(error)return reject(fail('BACKUP_CREDENTIAL_NEON_CALL_FAILED'));
  try{resolve(JSON.parse(stdout));}catch{reject(fail('BACKUP_CREDENTIAL_NEON_RESPONSE_UNPARSEABLE'));}
 }));
 return {
  get:(path,query)=>{if(!NEON_GET.some(r=>r.test(path)))return Promise.reject(fail('BACKUP_CREDENTIAL_NEON_PATH_REFUSED'));
   return run(['api',path,...Object.entries(query??{}).flatMap(([k,v])=>['-Q',`${k}=${v}`])]);},
  post:path=>{if(path!==backupResetPath())return Promise.reject(fail('BACKUP_CREDENTIAL_NEON_PATH_REFUSED'));return run(['api',path,'-X','POST']);},
 };
}
const GH_SCOPE=['--env',T.environment,'--repo',T.repo];
const GH_NAMES=new Set<string>([...Object.values(BACKUP_SINKS),'PRODUCTION_BACKUP_ACTIVATION','AGE_BACKUP_RECIPIENT','PRODUCTION_BACKUP_BUCKET']);
export function gitHubCliPort(bin:string='gh',env:NodeJS.ProcessEnv=process.env):GitHubPort{
 const run=(args:string[],stdin?:string)=>new Promise<string>((resolve,reject)=>{
  const child=spawn(bin,args,{env,stdio:['pipe','pipe','pipe'],windowsHide:true});let out='';
  child.stdout.on('data',d=>{if(out.length<1<<20)out+=String(d);});child.stderr.on('data',()=>{});
  child.on('error',()=>reject(fail('BACKUP_CREDENTIAL_GITHUB_CALL_FAILED')));
  child.on('close',code=>code===0?resolve(out):reject(fail('BACKUP_CREDENTIAL_GITHUB_CALL_FAILED')));
  child.stdin.on('error',()=>{});child.stdin.end(stdin??'');
 });
 const allowed=(n:string)=>{if(!GH_NAMES.has(n))throw fail('BACKUP_CREDENTIAL_GITHUB_NAME_REFUSED');return n;};
 return {
  secretNames:async()=>(JSON.parse(await run(['secret','list',...GH_SCOPE,'--json','name'])) as Array<{name:string}>).map(s=>s.name),
  variables:async()=>Object.fromEntries((JSON.parse(await run(['variable','list',...GH_SCOPE,'--json','name,value'])) as Array<{name:string;value:string}>).map(v=>[v.name,v.value])),
  setSecret:async(n,v)=>{await run(['secret','set',allowed(n),...GH_SCOPE],v);},
  setVariable:async(n,v)=>{await run(['variable','set',allowed(n),...GH_SCOPE,'--body',v]);},
  deleteSecret:async n=>{await run(['secret','delete',allowed(n),...GH_SCOPE]);},
  deleteVariable:async n=>{await run(['variable','delete',allowed(n),...GH_SCOPE]);},
 };
}
const pgSession=async(c:ConnectionConfig,statementTimeout:number):Promise<SqlSession>=>{
 const client=new Client({host:c.host,port:c.port,database:c.database,user:c.user,password:c.password,ssl:{rejectUnauthorized:true},enableChannelBinding:true,
  connectionTimeoutMillis:15_000,statement_timeout:statementTimeout,application_name:'zao_backup_credential'});
 client.on('error',()=>{});
 await client.connect();
 return {query:(sql,params)=>client.query(sql,params as unknown[]) as never,end:()=>client.end()};
};
export function evidenceDirectory(root:string=process.cwd()){return join(root,'.local','evidence','production-backup');}
export function fileGuard(dir:string):GuardStore{
 const path=join(dir,'reset-attempt.json');
 return {exists:()=>existsSync(path),claim:()=>{
  mkdirSync(dir,{recursive:true,mode:0o700});
  let fd:number;try{fd=openSync(path,'wx',0o600);}catch{throw fail('BACKUP_CREDENTIAL_RESET_ALREADY_ATTEMPTED');}
  try{writeSync(fd,JSON.stringify({version:BACKUP_CREDENTIAL_VERSION,claimedAt:new Date().toISOString(),note:'reset_password was authorized once; delete only on a new explicit authorization'})+'\n');}finally{closeSync(fd);}
 }};
}
export function productionPorts(root:string=process.cwd()):BackupCredentialPorts{
 if(!existsSync(NEON_BIN))throw fail('BACKUP_CREDENTIAL_NEON_CLI_MISSING');
 return {neon:neonCliPort(),github:gitHubCliPort(),connectOwner:c=>pgSession(c,30_000),connectBackup:c=>pgSession(c,30_000),guard:fileGuard(evidenceDirectory(root)),
  sleep:ms=>new Promise(r=>setTimeout(r,ms)),now:()=>new Date(),expectTls:true};
}

export async function main(argv:string[],root:string=process.cwd()):Promise<void>{
 const [command,...rest]=argv;
 if(rest.length)throw fail('BACKUP_CREDENTIAL_ARGUMENTS_REFUSED');
 const dir=evidenceDirectory(root);
 let result:unknown;
 switch(command){
  case 'provision':result=await provisionBackupCredential(productionPorts(root));break;
  case 'contain':result=await containBackupCredential(productionPorts(root));break;
  case 'finalize':result=await finalizeBackupCredential(productionPorts(root),JSON.parse(readFileSync(join(dir,'restore-pass.json'),'utf8')));break;
  case 'set-age-recipient':result=await setAgeRecipient(productionPorts(root),readFileSync(join(dir,'age-recipient.txt'),'utf8').trim());break;
  default:throw fail('BACKUP_CREDENTIAL_COMMAND_REFUSED');
 }
 console.log(JSON.stringify(result));
}
if(process.argv[1]&&new URL(import.meta.url).pathname===process.argv[1]){
 main(process.argv.slice(2)).then(()=>{process.exitCode=0;},error=>{
  // Only a fixed code and the sanitised containment/step report; never a provider error, URI, host or value.
  const e=error as {contained?:unknown;steps?:unknown};
  console.error(JSON.stringify({state:'FAILED',code:safeCode(error),contained:e.contained??null,steps:Array.isArray(e.steps)?e.steps:[]}));
  process.exitCode=1;
 });
}
