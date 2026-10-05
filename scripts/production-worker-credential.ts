// ZAO R49 normal worker (contract production-credential-activation/6, NORMAL_WORKER_ROLES_PLAN.md): secret-safe lifecycle for the three worker DB roles
// neondb_pay_dispatch / neondb_pay_truth / neondb_pay_projection and the first Vercel binding (CRON_SECRET). Same discipline as production-backup-credential:
// no arguments, every Neon response and the owner connection URI stay in this process, each password goes only to `vercel env add --sensitive` over stdin,
// reset_password is POSTed at most once per role behind a durable local guard and never resent, any failure contains the role and removes its sink.
// Per role, strictly serial: clean NOLOGIN baseline -> temporary password (memory only, while NOLOGIN, through the manager) -> ONE reset_password -> operations
// finished -> 20-minute LOGIN lease from the DATABASE clock -> direct verify-full + channel-binding login with the worker's own role checks -> Production sensitive
// sink + metadata readback -> VALID UNTIL 'infinity' with one readback. In `provision` nothing (no Neon call, no Vercel call, no guard claim) happens before `darkProofVerified()`: the roles are
// activated only after the dark cron reach proof recorded by production-worker-dormant-proof has been re-derived from live Vercel readbacks for the accepted main commit.
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {closeSync,existsSync,mkdirSync,openSync,writeSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {Client,Pool} from 'pg';
import {productionCredentialCompleteReset,productionCredentialPasswordFromResetResponse,productionCredentialTemporaryPassword,productionCredentialBaseline,
 productionCredentialContainmentComplete,productionCredentialContainmentSchedule} from './production-credential-activation';
import {BACKUP_CREDENTIAL_TARGET as T,backupLeaseDeadline,neonCliPort,type NeonPort,type SqlSession} from './production-backup-credential';
import {assertProductionHost,assertProductionHostFingerprint,assertProductionPort,fingerprintHost} from './production-backup';
import {productionPaymentRoleNames} from './production-payment-roles';
import {acceptanceDatabaseConfig,verifyAcceptanceRole} from './lib/production-payment-acceptance';
import type {ProductionConfiguration} from '../packages/auth/src/production-config';

export const WORKER_CREDENTIAL_VERSION='production-worker-credential/1';
export const WORKER_LEASE_MINUTES=20;
const names=productionPaymentRoleNames(T.database);
export const WORKER_ROLES=Object.freeze([
 {key:'dispatcher' as const,role:names.dispatcher,sink:'PRODUCTION_WORKER_DB_PASSWORD_DISPATCHER',signature:'payment_reconciliation.dispatch_normal(text,integer,timestamptz)'},
 {key:'worker' as const,role:names.worker,sink:'PRODUCTION_WORKER_DB_PASSWORD_WORKER',signature:'payment_reconciliation.claim_normal(text,integer,text,timestamptz)'},
 {key:'projector' as const,role:names.projector,sink:'PRODUCTION_WORKER_DB_PASSWORD_PROJECTOR',signature:'payment_projection.normal_candidates(text,timestamptz,integer)'},
]);
type WorkerRole=typeof WORKER_ROLES[number];
export const CRON_SECRET_NAME='CRON_SECRET';
export const VERCEL_TARGET=Object.freeze({project:'prj_ehUMOzM77em9DVnHJBJffncD5hg7',scope:'zao-food-map',environment:'production'});
const fail=(code:string)=>new Error(code);
const qi=(v:string)=>{if(!/^[a-z][a-z0-9_]{2,62}$/.test(v))throw fail('WORKER_CREDENTIAL_NAME_INVALID');return '"'+v+'"';};
const manager=()=>`SET LOCAL ROLE ${qi(T.manager)}`;
export const workerTemporaryPasswordSql=(role:string,temporary:string)=>{if(!/^[A-Za-z0-9_-]{43}$/.test(temporary))throw fail('WORKER_CREDENTIAL_TEMPORARY_PASSWORD_INVALID');return [manager(),`ALTER ROLE ${qi(role)} NOLOGIN PASSWORD '${temporary}' VALID UNTIL 'infinity'`];};
export const workerLoginSql=(role:string,deadline:string)=>{if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(deadline))throw fail('WORKER_CREDENTIAL_LEASE_INVALID');return [manager(),`ALTER ROLE ${qi(role)} LOGIN VALID UNTIL '${deadline}'`];};
export const workerFinalizeSql=(role:string)=>[manager(),`ALTER ROLE ${qi(role)} VALID UNTIL 'infinity'`];
export const workerContainSql=(role:string)=>[manager(),`ALTER ROLE ${qi(role)} NOLOGIN PASSWORD NULL VALID UNTIL 'infinity'`];
export const workerResetPath=(role:string)=>`/projects/${T.project}/branches/${T.branch}/roles/${role}/reset_password`;

// ---------------------------------------------------------------- role state and posture
export type WorkerRoleState={rolcanlogin:boolean;rolvaliduntil:string|null;passwordIsNull:boolean|'UNREADABLE';attributes:string;memberships:string[];grantees:string[];owned:number;canConnect:boolean};
const STATE_SQL=`SELECT r.rolcanlogin AS "rolcanlogin",
 CASE WHEN r.rolvaliduntil IS NULL THEN NULL WHEN isfinite(r.rolvaliduntil) THEN (r.rolvaliduntil AT TIME ZONE 'UTC')::text||'+00' ELSE r.rolvaliduntil::text END AS "rolvaliduntil",
 format('super=%s,createdb=%s,createrole=%s,repl=%s,bypassrls=%s,inherit=%s,connlimit=%s',left(r.rolsuper::text,1),left(r.rolcreatedb::text,1),left(r.rolcreaterole::text,1),
  left(r.rolreplication::text,1),left(r.rolbypassrls::text,1),left(r.rolinherit::text,1),r.rolconnlimit) AS "attributes",
 coalesce((SELECT array_agg(g.rolname::text ORDER BY g.rolname::text) FROM pg_auth_members m JOIN pg_roles g ON g.oid=m.roleid WHERE m.member=r.oid),'{}') AS "memberships",
 coalesce((SELECT array_agg(g.rolname::text ORDER BY g.rolname::text) FROM pg_auth_members m JOIN pg_roles g ON g.oid=m.member WHERE m.roleid=r.oid),'{}') AS "grantees",
 (SELECT count(*)::int FROM pg_shdepend d WHERE d.refclassid='pg_authid'::regclass AND d.refobjid=r.oid AND d.deptype='o') AS "owned",
 has_database_privilege(r.oid,current_database(),'CONNECT') AS "canConnect"
 FROM pg_roles r WHERE r.rolname=$1`;
export async function readWorkerRoleState(s:SqlSession,role:string):Promise<WorkerRoleState>{
 const r=await s.query<Omit<WorkerRoleState,'passwordIsNull'>>(STATE_SQL,[role]);
 if(r.rows.length!==1)throw fail('WORKER_CREDENTIAL_ROLE_MISSING');
 let passwordIsNull:boolean|'UNREADABLE'='UNREADABLE';
 try{const p=await s.query<{passwordIsNull:boolean}>('SELECT a.rolpassword IS NULL AS "passwordIsNull" FROM pg_authid a WHERE a.rolname=$1',[role]);if(p.rows.length===1&&typeof p.rows[0]!.passwordIsNull==='boolean')passwordIsNull=p.rows[0]!.passwordIsNull;}catch{/* not exposed */}
 return {...r.rows[0]!,passwordIsNull};
}
/** Payment roles are NOINHERIT, hold no membership, are administered only by the manager, own nothing and may CONNECT. */
export function workerPostureDrift(s:WorkerRoleState):string[]{
 const out:string[]=[];
 if(s.attributes!=='super=f,createdb=f,createrole=f,repl=f,bypassrls=f,inherit=f,connlimit=-1')out.push('ATTRIBUTES');
 if(s.memberships.length)out.push('MEMBERSHIPS');
 if(JSON.stringify(s.grantees)!==JSON.stringify([T.manager]))out.push('GRANTEES');
 if(s.owned!==0)out.push('OWNED_OBJECTS');
 if(!s.canConnect)out.push('CONNECT');
 return out;
}
const pw=(s:WorkerRoleState)=>s.passwordIsNull==='UNREADABLE'?true:s.passwordIsNull;
const baselineOf=(s:WorkerRoleState)=>productionCredentialBaseline({rolcanlogin:s.rolcanlogin,passwordIsNull:pw(s),rolvaliduntil:s.rolvaliduntil});
const containedOf=(s:WorkerRoleState)=>productionCredentialContainmentComplete({rolcanlogin:s.rolcanlogin,passwordIsNull:pw(s),rolvaliduntil:s.rolvaliduntil});
async function tx(s:SqlSession,sql:string[]){
 await s.query('BEGIN');
 try{for(const q of sql)await s.query(q);await s.query('COMMIT');}catch{try{await s.query('ROLLBACK');}catch{/* gone */}throw fail('WORKER_CREDENTIAL_SQL_FAILED');}
}

// ---------------------------------------------------------------- ports
export type VercelEnvRow={key:string;type:string;target:string[]};
export interface VercelPort{envRows():Promise<VercelEnvRow[]>;setSensitive(name:string,value:string):Promise<void>;remove(name:string):Promise<void>}
export interface WorkerGuardStore{claim(key:string):void;exists(key:string):boolean}
export type ProbeEvidence={tlsVerified:boolean;roleChecks:'PASS';signature:'EXECUTE';leaseValid:true};
export interface WorkerCredentialPorts{neon:NeonPort;vercel:VercelPort;connectOwner(host:string):Promise<SqlSession>;
 /** Opens the worker's own role over verify-full TLS with channel binding and runs the worker's own checks (verifyAcceptanceRole, signature EXECUTE, lease). */
 probe(role:WorkerRole,password:string,host:string):Promise<ProbeEvidence>;
 guard:WorkerGuardStore;sleep(ms:number):Promise<void>;now():Date;containmentSchedule?:number[];expectedHostFingerprint?:string;
 /** Resolves only when a machine-collected dark reach proof (real Vercel Cron `normal_worker_tick_dormant`, see production-worker-dormant-proof) is fresh and still true against
  *  live Vercel state for the accepted source; roles are never activated otherwise. A shape-only file never satisfies it. */
 darkProofVerified():Promise<void>}

type Json=Record<string,unknown>;
const obj=(v:unknown,code:string):Json=>{if(!v||typeof v!=='object'||Array.isArray(v))throw fail(code);return v as Json;};
async function verifyTarget(p:WorkerCredentialPorts){
 const base=`/projects/${T.project}`,branch=`${base}/branches/${T.branch}`;
 if(obj(obj(await p.neon.get(base),'WORKER_CREDENTIAL_TARGET_MISMATCH').project,'WORKER_CREDENTIAL_TARGET_MISMATCH').id!==T.project)throw fail('WORKER_CREDENTIAL_TARGET_MISMATCH');
 if(obj(obj(await p.neon.get(branch),'WORKER_CREDENTIAL_TARGET_MISMATCH').branch,'WORKER_CREDENTIAL_TARGET_MISMATCH').id!==T.branch)throw fail('WORKER_CREDENTIAL_TARGET_MISMATCH');
 const d=obj(obj(await p.neon.get(`${branch}/databases/${T.database}`),'WORKER_CREDENTIAL_TARGET_MISMATCH').database,'WORKER_CREDENTIAL_TARGET_MISMATCH');
 if(d.name!==T.database||d.owner_name!==T.owner)throw fail('WORKER_CREDENTIAL_TARGET_MISMATCH');
 const roles=obj(await p.neon.get(`${branch}/roles`),'WORKER_CREDENTIAL_TARGET_MISMATCH').roles;
 const have=Array.isArray(roles)?roles.map(r=>(r as Json)?.name):[];
 for(const need of [T.manager,T.owner,...WORKER_ROLES.map(r=>r.role)])if(!have.includes(need))throw fail('WORKER_CREDENTIAL_TARGET_MISMATCH');
 const eps=obj(await p.neon.get(`${branch}/endpoints`),'WORKER_CREDENTIAL_TARGET_MISMATCH').endpoints;
 const rw=(Array.isArray(eps)?eps:[]).map(e=>e as Json).filter(e=>e.type==='read_write'&&e.branch_id===T.branch);
 if(rw.length!==1||typeof rw[0]!.host!=='string')throw fail('WORKER_CREDENTIAL_ENDPOINT_AMBIGUOUS');
 const host=(rw[0]!.host as string).trim().toLowerCase();
 assertProductionHost(host);assertProductionPort(T.port);assertProductionHostFingerprint(host,p.expectedHostFingerprint);
 return host;
}
const sinkMetadataOk=(rows:VercelEnvRow[],name:string)=>{const m=rows.filter(r=>r.key===name);return m.length===1&&m[0]!.type==='sensitive'&&JSON.stringify(m[0]!.target)===JSON.stringify([VERCEL_TARGET.environment]);};

// ---------------------------------------------------------------- CRON_SECRET (first binding, nothing else of the worker plan)
export async function bindCronSecret(p:Pick<WorkerCredentialPorts,'vercel'>){
 const before=await p.vercel.envRows();
 if(before.some(r=>r.key===CRON_SECRET_NAME))throw fail('WORKER_CREDENTIAL_CRON_SECRET_ALREADY_BOUND');
 for(const forbidden of [...WORKER_ROLES.map(r=>r.sink),'PRODUCTION_WORKER_ACCEPTED_AFTER','PRODUCTION_WORKER_TICK_ACTIVATION'])if(before.some(r=>r.key===forbidden))throw fail('WORKER_CREDENTIAL_ACTIVATION_NAMES_PRESENT');
 let value=randomBytes(48).toString('base64url');
 try{await p.vercel.setSensitive(CRON_SECRET_NAME,value);}finally{value='';}
 if(!sinkMetadataOk(await p.vercel.envRows(),CRON_SECRET_NAME))throw fail('WORKER_CREDENTIAL_SINK_READBACK_FAILED');
 return Object.freeze({version:WORKER_CREDENTIAL_VERSION,state:'CRON_SECRET_BOUND' as const,name:CRON_SECRET_NAME,type:'sensitive' as const,target:[VERCEL_TARGET.environment],otherWorkerNamesBound:0});
}

// ---------------------------------------------------------------- containment
export type ContainResult={state:'CONTAINED'|'CONTAINMENT_FAILED';rolesContained:string[];sinksRemoved:string[];attempts:number};
async function containRoles(p:WorkerCredentialPorts,roles:readonly WorkerRole[]):Promise<ContainResult>{
 const sinksRemoved:string[]=[],rolesContained:string[]=[];let attempts=0;
 for(const r of roles){try{await p.vercel.remove(r.sink);}catch{/* verified below */}}
 try{const rows=await p.vercel.envRows();for(const r of roles)if(!rows.some(x=>x.key===r.sink))sinksRemoved.push(r.sink);}catch{/* unknown stays unremoved */}
 const schedule=p.containmentSchedule??productionCredentialContainmentSchedule();
 let session:SqlSession|undefined;const pending=new Set(roles.map(r=>r.role));
 try{
  for(let i=0;i<=schedule.length&&pending.size;i++){
   attempts++;
   try{
    if(!session)session=await p.connectOwner(await verifyTarget(p));
    for(const r of roles)if(pending.has(r.role)){await tx(session,workerContainSql(r.role));if(containedOf(await readWorkerRoleState(session,r.role))){pending.delete(r.role);rolesContained.push(r.role);}}
   }catch{try{await session?.end();}catch{/* ignore */}session=undefined;}
   if(pending.size&&i<schedule.length)await p.sleep(schedule[i]!*1000);
  }
 }finally{try{await session?.end();}catch{/* ignore */}}
 return {state:pending.size===0&&sinksRemoved.length===roles.length?'CONTAINED':'CONTAINMENT_FAILED',rolesContained,sinksRemoved,attempts};
}
export const containWorkerRoles=(p:WorkerCredentialPorts)=>containRoles(p,WORKER_ROLES);

// ---------------------------------------------------------------- one role
async function provisionRole(p:WorkerCredentialPorts,owner:SqlSession,host:string,r:WorkerRole,steps:string[]){
 const before=await readWorkerRoleState(owner,r.role),base=baselineOf(before);
 if(base!=='READY_PRISTINE'&&base!=='READY_NORMALIZED')throw fail('WORKER_CREDENTIAL_BASELINE_NOT_CLEAN');
 if(workerPostureDrift(before).length)throw fail('WORKER_CREDENTIAL_PRIVILEGE_DRIFT');
 const temporary=productionCredentialTemporaryPassword();
 await tx(owner,workerTemporaryPasswordSql(r.role,temporary));
 const afterTemp=await readWorkerRoleState(owner,r.role);
 if(afterTemp.rolcanlogin||afterTemp.rolvaliduntil!=='infinity'||workerPostureDrift(afterTemp).length)throw fail('WORKER_CREDENTIAL_POSTURE_CHANGED');
 p.guard.claim(r.key);
 let body:unknown;
 try{body=await p.neon.post(workerResetPath(r.role));}catch{throw fail('WORKER_CREDENTIAL_RESET_OUTCOME_UNKNOWN');}
 const pending=productionCredentialPasswordFromResetResponse(body,r.role,temporary);body=undefined;
 const status:Record<string,string>={},deadline=p.now().getTime()+120_000;
 for(const id of pending.operationIds){
  for(;;){
   const op=obj(obj(await p.neon.get(`/projects/${T.project}/operations/${id}`),'WORKER_CREDENTIAL_OPERATION_INVALID').operation,'WORKER_CREDENTIAL_OPERATION_INVALID');
   const st=typeof op.status==='string'?op.status:'';status[id]=st;
   if(st==='finished')break;
   if(['failed','error','cancelled','cancelling','skipped'].includes(st)||p.now().getTime()>=deadline)throw fail('WORKER_CREDENTIAL_RESET_NOT_COMPLETED');
   await p.sleep(2000);
  }
 }
 const credential=productionCredentialCompleteReset(pending,status);
 const clock=await owner.query<{now:string}>('SELECT clock_timestamp()::text AS now');
 await tx(owner,workerLoginSql(r.role,backupLeaseDeadline(String(clock.rows[0]?.now),WORKER_LEASE_MINUTES)));
 const probe=await p.probe(r,credential.password,host);
 if(!probe.leaseValid||probe.roleChecks!=='PASS'||probe.signature!=='EXECUTE')throw fail('WORKER_CREDENTIAL_PROBE_FAILED');
 const loginState=await readWorkerRoleState(owner,r.role);
 if(!loginState.rolcanlogin||workerPostureDrift(loginState).length)throw fail('WORKER_CREDENTIAL_POSTURE_CHANGED');
 await p.vercel.setSensitive(r.sink,credential.password);
 if(!sinkMetadataOk(await p.vercel.envRows(),r.sink))throw fail('WORKER_CREDENTIAL_SINK_READBACK_FAILED');
 await tx(owner,workerFinalizeSql(r.role));
 const done=await readWorkerRoleState(owner,r.role);
 if(!done.rolcanlogin||done.rolvaliduntil!=='infinity'||workerPostureDrift(done).length)throw fail('WORKER_CREDENTIAL_FINALIZATION_FAILED');
 steps.push(r.key+':ACTIVE');
 return probe.tlsVerified;
}

export type ProvisionEvidence=Readonly<{version:string;state:'WORKER_ROLES_ACTIVE';roles:string[];sinks:string[];leaseMinutes:number;resetPostCount:number;tlsVerified:boolean;steps:string[]}>;
export async function provisionWorkerRoles(p:WorkerCredentialPorts):Promise<ProvisionEvidence>{
 const steps:string[]=[];let owner:SqlSession|undefined,mutated:WorkerRole[]=[],tls=true;
 try{
  try{await p.darkProofVerified();}catch(e){throw Object.assign(fail('WORKER_CREDENTIAL_DARK_PROOF_REQUIRED'),{reason:safeReason(e)});}
  for(const r of WORKER_ROLES)if(p.guard.exists(r.key))throw fail('WORKER_CREDENTIAL_RESET_ALREADY_ATTEMPTED');
  const rows=await p.vercel.envRows();
  if(!sinkMetadataOk(rows,CRON_SECRET_NAME))throw fail('WORKER_CREDENTIAL_CRON_SECRET_REQUIRED');
  for(const forbidden of [...WORKER_ROLES.map(r=>r.sink),'PRODUCTION_WORKER_ACCEPTED_AFTER','PRODUCTION_WORKER_TICK_ACTIVATION'])if(rows.some(x=>x.key===forbidden))throw fail('WORKER_CREDENTIAL_PRECONDITION_NOT_CLEAN');
  steps.push('PRECONDITIONS_READ_ONLY');
  const host=await verifyTarget(p);steps.push('NEON_TARGET_IDENTITY');
  owner=await p.connectOwner(host);steps.push('OWNER_SESSION_MEMORY_ONLY');
  for(const r of WORKER_ROLES){mutated=[...mutated,r];tls=(await provisionRole(p,owner,host,r,steps))&&tls;}
  return Object.freeze({version:WORKER_CREDENTIAL_VERSION,state:'WORKER_ROLES_ACTIVE' as const,roles:WORKER_ROLES.map(r=>r.role),sinks:WORKER_ROLES.map(r=>r.sink),leaseMinutes:WORKER_LEASE_MINUTES,resetPostCount:WORKER_ROLES.length,tlsVerified:tls,steps});
 }catch(e){
  const code=safeCode(e);
  try{await owner?.end();}catch{/* ignore */}owner=undefined;
  // Contain the failing role and every role not yet finished; roles already ACTIVE stay (their sinks are bound), the failure is reported.
  const failing=mutated.filter(r=>!steps.includes(r.key+':ACTIVE'));
  const contained=failing.length?await containRoles(p,failing):undefined;
  throw Object.assign(fail(code),{contained,steps,reason:(e as {reason?:unknown}).reason??null});
 }finally{try{await owner?.end();}catch{/* ignore */}}
}

const SAFE_CODE=/^(WORKER|BACKUP)_(CREDENTIAL|HOST|PORT)_[A-Z0-9_]{1,80}$/;
/** A fixed reason code of the dark-proof verifier (never its text), so a refusal says why. */
function safeReason(e:unknown):string|null{const m=String((e as Error)?.message??'');return /^WORKER_DORMANT_PROOF_[A-Z_]{1,60}$/.test(m)?m:null;}
function safeCode(e:unknown):string{const m=String((e as Error)?.message??'');return SAFE_CODE.test(m)||/^PRODUCTION_CREDENTIAL_[A-Z0-9_]{1,80}$/.test(m)?m:'WORKER_CREDENTIAL_FAILED';}

// ---------------------------------------------------------------- production adapters (stdout is captured, never inherited)
export const VERCEL_BIN=join(homedir(),'.npm/_npx/69f9afb961c37556/node_modules/.bin/vercel');
const NEON_BIN=join(homedir(),'.npm/_npx/978debf9b3a75271/node_modules/.bin/neon');
const SINK_NAMES=new Set<string>([CRON_SECRET_NAME,...WORKER_ROLES.map(r=>r.sink)]);
export function vercelCliPort(bin:string=VERCEL_BIN,env:NodeJS.ProcessEnv=process.env):VercelPort{
 const scope=['--project',VERCEL_TARGET.project,'--scope',VERCEL_TARGET.scope];
 const allowed=(n:string)=>{if(!SINK_NAMES.has(n))throw fail('WORKER_CREDENTIAL_VERCEL_NAME_REFUSED');return n;};
 const run=(args:string[],stdin?:string,capture=false)=>new Promise<string>((resolve,reject)=>{
  const child=spawn(bin,args,{env,stdio:['pipe','pipe','pipe'],windowsHide:true});let out='',truncated=false;
  child.stdout.on('data',d=>{if(capture){if(out.length<4<<20)out+=String(d);else truncated=true;}});child.stderr.on('data',()=>{});
  child.on('error',()=>reject(fail('WORKER_CREDENTIAL_VERCEL_CALL_FAILED')));
  child.on('close',code=>code===0&&!truncated?resolve(out):reject(fail('WORKER_CREDENTIAL_VERCEL_CALL_FAILED')));
  child.stdin.on('error',()=>{});child.stdin.end(stdin??'');
 });
 return {
  envRows:async()=>{
   const raw=await run(['api',`/v10/projects/${VERCEL_TARGET.project}/env`,'--raw','--scope',VERCEL_TARGET.scope],undefined,true);
   let parsed:{envs?:unknown;pagination?:{next?:unknown}|null;hiddenProductionEnvCount?:unknown}|null;try{parsed=JSON.parse(raw);}catch{throw fail('WORKER_CREDENTIAL_VERCEL_RESPONSE_UNPARSEABLE');}
   // The documented answer is `{envs}` with either `pagination` or `hiddenProductionEnvCount` (or one bare variable). Absence claims ("no worker sink, cutoff or activation name") need the
   // whole list: anything but a complete `envs` array - a further page, hidden production variables, no array - is refused instead of read as "nothing bound".
   if(!parsed||typeof parsed!=='object'||!Array.isArray(parsed.envs))throw fail('WORKER_CREDENTIAL_VERCEL_RESPONSE_UNPARSEABLE');
   if(parsed.pagination?.next!=null||(parsed.hiddenProductionEnvCount!==undefined&&parsed.hiddenProductionEnvCount!==0))throw fail('WORKER_CREDENTIAL_VERCEL_RESPONSE_INCOMPLETE');
   // Only name, type and target are kept; any value field the API might return is dropped here and never leaves this function.
   return (parsed.envs as Array<{key?:unknown;type?:unknown;target?:unknown}|null>).map(e=>{
    if(typeof e?.key!=='string'||!e.key)throw fail('WORKER_CREDENTIAL_VERCEL_RESPONSE_UNPARSEABLE');
    return {key:e.key,type:String(e.type),target:Array.isArray(e.target)?e.target.map(String):[String(e.target)]};
   });
  },
  setSensitive:async(n,v)=>{await run(['env','add',allowed(n),VERCEL_TARGET.environment,'--sensitive','--yes',...scope],v);},
  remove:async n=>{await run(['env','rm',allowed(n),VERCEL_TARGET.environment,'--yes',...scope]);},
 };
}
const TLS_OVERRIDES=['NODE_TLS_REJECT_UNAUTHORIZED','NODE_EXTRA_CA_CERTS','SSL_CERT_FILE','SSL_CERT_DIR'] as const;
export function evidenceDirectory(root:string=process.cwd()){return join(root,'.local','evidence','production-worker');}
export function workerFileGuard(dir:string):WorkerGuardStore{
 const path=(key:string)=>join(dir,`reset-${key}.json`);
 return {exists:key=>existsSync(path(key)),claim:key=>{
  mkdirSync(dir,{recursive:true,mode:0o700});
  let fd:number;try{fd=openSync(path(key),'wx',0o600);}catch{throw fail('WORKER_CREDENTIAL_RESET_ALREADY_ATTEMPTED');}
  try{writeSync(fd,JSON.stringify({version:WORKER_CREDENTIAL_VERSION,role:key,claimedAt:new Date().toISOString()})+'\n');}finally{closeSync(fd);}
 }};
}
async function realProbe(role:WorkerRole,password:string,host:string):Promise<ProbeEvidence>{
 if(TLS_OVERRIDES.some(k=>process.env[k]!==undefined))throw fail('WORKER_CREDENTIAL_TLS_REJECTED');
 const url=new URL('postgresql://placeholder/');url.hostname=host;url.username=role.role;url.password=password;url.pathname='/'+T.database;url.search='?sslmode=verify-full';
 // The worker's own admission helpers: they only read these three configuration fields.
 const c={database:{name:T.database,host,roles:{operations:T.database+'_operations'}}} as unknown as ProductionConfiguration;
 const config=acceptanceDatabaseConfig(c,role.key,url.toString());
 const pool=new Pool({...config,application_name:'zao_worker_credential_probe'});pool.on('error',()=>{});
 try{
  const client=await pool.connect();
  try{
   const {TLSSocket}=await import('node:tls');
   const stream=(Reflect.get(client,'connection') as {stream?:unknown})?.stream;
   if(!(stream instanceof TLSSocket)||!stream.authorized||!stream.encrypted||Reflect.get(stream,'servername')!==host)throw fail('WORKER_CREDENTIAL_PROBE_FAILED');
  }finally{client.release();}
  await verifyAcceptanceRole(pool,c,role.key);
  const check=(await pool.query("SELECT has_function_privilege(current_user,$1,'EXECUTE') allowed,rolvaliduntil IS NULL OR rolvaliduntil>clock_timestamp() lease FROM pg_roles WHERE rolname=current_user",[role.signature])).rows[0];
  if(check?.allowed!==true||check?.lease!==true)throw fail('WORKER_CREDENTIAL_PROBE_FAILED');
  return {tlsVerified:true,roleChecks:'PASS',signature:'EXECUTE',leaseValid:true};
 }catch(e){throw fail(String((e as Error)?.message??'').startsWith('WORKER_CREDENTIAL_')?String((e as Error).message):'WORKER_CREDENTIAL_PROBE_FAILED');}
 finally{await pool.end().catch(()=>undefined);}
}
export function productionWorkerPorts(root:string=process.cwd()):WorkerCredentialPorts{
 if(!existsSync(NEON_BIN)||!existsSync(VERCEL_BIN))throw fail('WORKER_CREDENTIAL_CLI_MISSING');
 const neon=neonCliPort(NEON_BIN),dir=evidenceDirectory(root);
 return {neon,vercel:vercelCliPort(),guard:workerFileGuard(dir),sleep:ms=>new Promise(r=>setTimeout(r,ms)),now:()=>new Date(),darkProofVerified:async()=>{await (await import('./production-worker-dormant-proof')).verifyRecordedDormantProof(root);},probe:realProbe,
  connectOwner:async host=>{
   const uri=obj(await neon.get(`/projects/${T.project}/connection_uri`,{branch_id:T.branch,database_name:T.database,role_name:T.owner,pooled:'false'}),'WORKER_CREDENTIAL_OWNER_SESSION_INVALID').uri;
   if(typeof uri!=='string')throw fail('WORKER_CREDENTIAL_OWNER_SESSION_INVALID');
   let u:URL;try{u=new URL(uri);}catch{throw fail('WORKER_CREDENTIAL_OWNER_SESSION_INVALID');}
   if(u.hostname.toLowerCase()!==host||decodeURIComponent(u.username)!==T.owner||u.pathname!=='/'+T.database||!u.password||fingerprintHost(host).length!==64)throw fail('WORKER_CREDENTIAL_OWNER_SESSION_INVALID');
   const client=new Client({host,port:Number(T.port),database:T.database,user:T.owner,password:decodeURIComponent(u.password),ssl:{rejectUnauthorized:true},enableChannelBinding:true,connectionTimeoutMillis:15_000,statement_timeout:30_000,application_name:'zao_worker_credential'});
   client.on('error',()=>{});await client.connect();
   const id=await client.query<{database:string;user:string}>('SELECT current_database() AS database,current_user AS user');
   if(id.rows[0]?.database!==T.database||id.rows[0].user!==T.owner){await client.end();throw fail('WORKER_CREDENTIAL_OWNER_SESSION_INVALID');}
   return {query:((sql:string,params?:unknown[])=>client.query(sql,params as unknown[])) as never,end:()=>client.end()};
  }};
}

export async function main(argv:string[],root:string=process.cwd()):Promise<void>{
 const [command,...rest]=argv;
 if(rest.length)throw fail('WORKER_CREDENTIAL_ARGUMENTS_REFUSED');
 const ports=productionWorkerPorts(root);let result:unknown;
 switch(command){
  case 'bind-cron-secret':result=await bindCronSecret(ports);break;
  case 'provision':result=await provisionWorkerRoles(ports);break;
  case 'contain':result=await containWorkerRoles(ports);break;
  default:throw fail('WORKER_CREDENTIAL_COMMAND_REFUSED');
 }
 console.log(JSON.stringify(result));
}
if(process.argv[1]&&new URL(import.meta.url).pathname===process.argv[1]){
 main(process.argv.slice(2)).then(()=>{process.exitCode=0;},error=>{
  const e=error as {contained?:unknown;steps?:unknown;reason?:unknown};
  console.error(JSON.stringify({state:'FAILED',code:safeCode(error),reason:/^WORKER_DORMANT_PROOF_[A-Z_]{1,60}$/.test(String(e.reason))?e.reason:null,contained:e.contained??null,steps:Array.isArray(e.steps)?e.steps:[]}));
  process.exitCode=1;
 });
}
