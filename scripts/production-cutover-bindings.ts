// Issue 47 / TD #7219973419 §2-B: one machine-checkable table of EVERY database binding that must move when Production switches from
// `neondb` to a new database (neondb_v65 / neondb_v65b): main Vercel project, dedicated Square-webhook Vercel project, GitHub backup
// environment, and the database roles behind them. Pure construction + pure verification over METADATA only: this module never
// receives, reads, returns or logs a secret value. Collection (`collectVercelMetadata`) reads key/type/target/updatedAt only.
import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {productionServices} from '../packages/auth/src/production-config';
import {PRODUCTION_DATABASE_NAMES,EXPECTED_PRODUCTION_HOST_FINGERPRINT_SHA256} from '../packages/auth/src/production-identity';
import {productionPaymentRoleNames} from './production-payment-roles';
import {BACKUP_CREDENTIAL_TARGET as T,type NeonPort} from './production-backup-credential';

export const CUTOVER_BINDINGS_VERSION='production-cutover-bindings/1';
export const MAIN_PROJECT='prj_ehUMOzM77em9DVnHJBJffncD5hg7';
export const WEBHOOK_PROJECT='prj_lQD8NCfFfxbgBLBbwtAgFIQV49ka';
export const BACKUP_ENVIRONMENT='production-backup';
export const SOURCE_DATABASE='neondb';
export const CUTOVER_TARGETS=Object.freeze(['neondb_v65','neondb_v65b'] as const);

export type Sink={kind:'VERCEL_ENV';project:typeof MAIN_PROJECT|typeof WEBHOOK_PROJECT;key:string;type:'sensitive'|'encrypted'}
 |{kind:'GITHUB_ENV_SECRET';environment:typeof BACKUP_ENVIRONMENT;key:string}
 |{kind:'GITHUB_ENV_VARIABLE';environment:typeof BACKUP_ENVIRONMENT;key:string};
/** NO_CHANGE: same value on the same endpoint. SET_VALUE: non-secret value changes (database or role name). NEW_SECRET: a freshly issued credential.
 * DERIVED: no variable exists; the runtime derives the value from PRODUCTION_DB_NAME (it must NOT be pinned by an override). */
export type Change='NO_CHANGE'|'SET_VALUE'|'NEW_SECRET'|'DERIVED';
export type Row={id:string;lane:string;sink:Sink|null;change:Change;oldRole:string|null;newRole:string|null;database:{old:string;new:string}|null;
 enable:string;verify:string;order:number};
export type BindingTable={version:typeof CUTOVER_BINDINGS_VERSION;source:string;target:string;rows:Row[];
 /** Roles the new database must contain, with their required posture at each stage. */
 roles:{role:string;lane:string;runtime:boolean;loginAfterSwitch:boolean;allowedMemberships:string[]}[];
 retainedOld:{database:string;purpose:string;roles:'FENCED_NOLOGIN';delete:'NEVER_IN_THIS_CUTOVER'};
 /** Resources whose configuration must NOT change in the cutover. */
 untouched:string[];
 sha256:string};

const serviceRole=(db:string,s:string)=>db+'_'+s;
const sha=(v:string)=>createHash('sha256').update(v).digest('hex');
function assertDatabases(source:string,target:string){
 if(source!==SOURCE_DATABASE)throw new Error('CUTOVER_BINDINGS_SOURCE_REFUSED');
 if(!(CUTOVER_TARGETS as readonly string[]).includes(target))throw new Error('CUTOVER_BINDINGS_TARGET_REFUSED');
 if(!(PRODUCTION_DATABASE_NAMES as readonly string[]).includes(target))throw new Error('CUTOVER_BINDINGS_IDENTITY_NOT_ALLOWLISTED');
}

export function buildBindingTable(source:string=SOURCE_DATABASE,target:string='neondb_v65'):BindingTable{
 assertDatabases(source,target);
 const rows:Row[]=[];let order=0;
 const add=(r:Omit<Row,'order'>)=>rows.push({...r,order:++order});
 const dbs={old:source,new:target};
 const pay=productionPaymentRoleNames(target),payOld=productionPaymentRoleNames(source);
 // ---- main project: database identity
 add({id:'main.db.host',lane:'main',sink:{kind:'VERCEL_ENV',project:MAIN_PROJECT,key:'PRODUCTION_DB_HOST',type:'sensitive'},change:'NO_CHANGE',oldRole:null,newRole:null,database:null,
  enable:'unchanged: the new database is on the same Neon endpoint',verify:'host fingerprint equals the pinned fingerprint (verifyNewDatabaseConnection)'});
 add({id:'main.db.name',lane:'main',sink:{kind:'VERCEL_ENV',project:MAIN_PROJECT,key:'PRODUCTION_DB_NAME',type:'encrypted'},change:'SET_VALUE',oldRole:null,newRole:null,database:dbs,
  enable:'vercel env set (non-secret) before the candidate build; takes effect only on the next deployment',verify:'candidate stage: /api/readiness 200 with the database identity of '+target});
 // ---- main project: per-service roles + credentials
 for(const s of productionServices){
  const key=s.toUpperCase();
  if(s==='group'){
   add({id:'main.role.group',lane:'group',sink:null,change:'DERIVED',oldRole:serviceRole(source,s),newRole:serviceRole(target,s),database:null,
    enable:'derived as PRODUCTION_DB_NAME+"_group"; PRODUCTION_DB_ROLE_GROUP must stay ABSENT (an override would pin a stale role)',verify:'verifyBindings: no PRODUCTION_DB_ROLE_GROUP key, or exactly the new role'});
  }else{
   add({id:`main.role.${s}`,lane:s,sink:{kind:'VERCEL_ENV',project:MAIN_PROJECT,key:`PRODUCTION_DB_ROLE_${key}`,type:'encrypted'},change:'SET_VALUE',oldRole:serviceRole(source,s),newRole:serviceRole(target,s),database:null,
    enable:'vercel env set (non-secret) with the new role name',verify:'role exists, NOLOGIN until the window, LOGIN after the switch'});
  }
  add({id:`main.secret.${s}`,lane:s,sink:{kind:'VERCEL_ENV',project:MAIN_PROJECT,key:`PRODUCTION_DB_PASSWORD_${key}`,type:'sensitive'},change:'NEW_SECRET',oldRole:serviceRole(source,s),newRole:serviceRole(target,s),database:null,
   enable:'NEON_RESET_PASSWORD_IN_MEMORY -> vercel env add --sensitive over stdin (see CUTOVER_BINDINGS.md §4); never the old role\'s password',verify:'direct verify-full + channel-binding login as the new role; sink updatedAt after the credential epoch'});
 }
 // ---- main project: worker lanes (cron worker-tick). Roles derive from PRODUCTION_DB_NAME through productionPaymentRoleNames.
 for(const [lane,k] of [['dispatcher','DISPATCHER'],['worker','WORKER'],['projector','PROJECTOR']] as const){
  add({id:`main.worker.${lane}`,lane:'worker.'+lane,sink:{kind:'VERCEL_ENV',project:MAIN_PROJECT,key:`PRODUCTION_WORKER_DB_PASSWORD_${k}`,type:'sensitive'},change:'NEW_SECRET',oldRole:payOld[lane],newRole:pay[lane],database:null,
   enable:'same lifecycle as the service credentials; the role name is derived (productionPaymentRoleNames(PRODUCTION_DB_NAME)), so no ROLE variable exists',verify:'worker-tick readiness with the new role; reconciliation lease re-check'});
 }
 add({id:'main.role.pay_diagnostic',lane:'diagnostics',sink:null,change:'DERIVED',oldRole:payOld.diagnostic,newRole:pay.diagnostic,database:null,
  enable:'no credential, no variable: stays NOLOGIN in the new database',verify:'role exists and is NOLOGIN'});
 // ---- dedicated webhook project: receiver only
 add({id:'webhook.receiver.url',lane:'receiver',sink:{kind:'VERCEL_ENV',project:WEBHOOK_PROJECT,key:'PRODUCTION_RECEIVER_DATABASE_URL',type:'sensitive'},change:'NEW_SECRET',oldRole:payOld.receiver,newRole:pay.receiver,database:dbs,
  enable:'NEON_RESET_PASSWORD_IN_MEMORY -> assemble postgresql://<new receiver>:<pw>@<same direct host>/<new db>?sslmode=verify-full in memory -> vercel env add --sensitive over stdin on the WEBHOOK project only',
  verify:'parseProductionIngress accepts it (db allowlisted, user=<db>_pay_receipt, no pooler, verify-full); a signed test event is NOT sent'});
 // ---- GitHub backup environment
 add({id:'backup.pgdatabase',lane:'backup',sink:{kind:'GITHUB_ENV_SECRET',environment:BACKUP_ENVIRONMENT,key:'PRODUCTION_BACKUP_PGDATABASE'},change:'NEW_SECRET',oldRole:null,newRole:null,database:dbs,
  enable:'gh secret set over stdin by the backup credential lifecycle (provision --database='+target+')',verify:'secret updated after the credential epoch'});
 add({id:'backup.pguser',lane:'backup',sink:{kind:'GITHUB_ENV_SECRET',environment:BACKUP_ENVIRONMENT,key:'PRODUCTION_BACKUP_PGUSER'},change:'NEW_SECRET',oldRole:serviceRole(source,'backup'),newRole:serviceRole(target,'backup'),database:null,
  enable:'same lifecycle',verify:'role is member of pg_read_all_data ONLY'});
 add({id:'backup.pgpassword',lane:'backup',sink:{kind:'GITHUB_ENV_SECRET',environment:BACKUP_ENVIRONMENT,key:'PRODUCTION_BACKUP_PGPASSWORD'},change:'NEW_SECRET',oldRole:serviceRole(source,'backup'),newRole:serviceRole(target,'backup'),database:null,
  enable:'same lifecycle (temporary password through the manager, ONE reset_password, bounded LOGIN lease, then VALID UNTIL infinity after a restore proof)',verify:'pg_dump login probe as the new role, read-only posture'});
 for(const k of ['PRODUCTION_BACKUP_PGHOST','PRODUCTION_BACKUP_PGPORT'])
  add({id:'backup.'+k.slice('PRODUCTION_BACKUP_'.length).toLowerCase(),lane:'backup',sink:{kind:'GITHUB_ENV_SECRET',environment:BACKUP_ENVIRONMENT,key:k},change:'NO_CHANGE',oldRole:null,newRole:null,database:null,
   enable:'unchanged (same endpoint, port 5432)',verify:'host fingerprint equals the pinned fingerprint'});
 add({id:'backup.activation',lane:'backup',sink:{kind:'GITHUB_ENV_VARIABLE',environment:BACKUP_ENVIRONMENT,key:'PRODUCTION_BACKUP_ACTIVATION'},change:'NO_CHANGE',oldRole:null,newRole:null,database:null,
  enable:'set LAST by the lifecycle (already R4_APPROVED); never cleared during the switch',verify:'unchanged'});
 const roles=[
  ...productionServices.map(s=>({role:serviceRole(target,s),lane:s,runtime:true,loginAfterSwitch:true,allowedMemberships:[] as string[]})),
  {role:pay.dispatcher,lane:'worker.dispatcher',runtime:true,loginAfterSwitch:true,allowedMemberships:[]},
  {role:pay.worker,lane:'worker.worker',runtime:true,loginAfterSwitch:true,allowedMemberships:[]},
  {role:pay.projector,lane:'worker.projector',runtime:true,loginAfterSwitch:true,allowedMemberships:[]},
  {role:pay.receiver,lane:'receiver',runtime:true,loginAfterSwitch:true,allowedMemberships:[]},
  {role:pay.diagnostic,lane:'diagnostics',runtime:false,loginAfterSwitch:false,allowedMemberships:[]},
  {role:serviceRole(target,'backup'),lane:'backup',runtime:false,loginAfterSwitch:true,allowedMemberships:['pg_read_all_data']},
 ];
 const body={version:CUTOVER_BINDINGS_VERSION,source,target,rows,roles,
  retainedOld:{database:source,purpose:'recovery source and read-only evidence; never a runtime target after the switch',roles:'FENCED_NOLOGIN' as const,delete:'NEVER_IN_THIS_CUTOVER' as const},
  untouched:[
   'Square webhook URL, subscription, signature key, merchant and location (PRODUCTION_SQUARE_* in both projects)',
   'customer auth/access/recovery keys (PRODUCTION_ACCESS_KEY*, PRODUCTION_GUEST_KEY, PRODUCTION_RECOVERY_KEY*, PRODUCTION_STAFF_KEY)',
   'Resend credential, R2 credentials and bucket, AGE_BACKUP_RECIPIENT, CRON_SECRET, publication approval keys',
   'Neon project/branch/endpoint host (the pinned host fingerprint)',
  ]};
 return {...body,sha256:sha(JSON.stringify(body))} as BindingTable;
}

// ---------------------------------------------------------------- metadata (never values)
export type EnvMeta={key:string;type:string;target:string;updatedAt?:number|null};
export type RoleFact={exists:boolean;login:boolean;superuser:boolean;createdb:boolean;createrole:boolean;memberships:string[]};
export type BindingFacts={
 vercel:{main:EnvMeta[];webhook:EnvMeta[]};
 github:{secrets:{name:string;updatedAt?:number|null}[];variables:string[]};
 roles:Record<string,RoleFact|undefined>;
 /** Roles of the OLD database (fence proof after the switch). */
 oldRoles?:Record<string,RoleFact|undefined>;
 stage:'PRE_SWITCH'|'POST_SWITCH';
 /** Epoch ms: every NEW_SECRET sink must have been written after this instant. */
 credentialEpoch:number;
};
export type Finding={code:string;id:string;detail:string};
const DBISH=/DB|DATABASE|PASSWORD|ROLE|^PG|BACKUP|RECEIVER/;
const WEBHOOK_ALLOWED_DB_KEYS=new Set(['PRODUCTION_RECEIVER_DATABASE_URL']);

/** Machine reconciliation. Returns findings (empty = consistent). Reads names/types/targets/timestamps and role posture only. */
export function verifyBindings(table:BindingTable,facts:BindingFacts):Finding[]{
 const out:Finding[]=[];const push=(code:string,id:string,detail:string)=>out.push({code,id,detail});
 const mainMap=new Map(facts.vercel.main.map(e=>[e.key,e])),hookMap=new Map(facts.vercel.webhook.map(e=>[e.key,e]));
 const secretMap=new Map(facts.github.secrets.map(e=>[e.name,e])),vars=new Set(facts.github.variables);
 const expectedKeys={main:new Set<string>(),webhook:new Set<string>(),gh:new Set<string>()};
 for(const r of table.rows){
  const s=r.sink;if(!s)continue;
  if(s.kind==='VERCEL_ENV'){
   const own=s.project===MAIN_PROJECT?mainMap:hookMap,other=s.project===MAIN_PROJECT?hookMap:mainMap;
   (s.project===MAIN_PROJECT?expectedKeys.main:expectedKeys.webhook).add(s.key);
   const e=own.get(s.key);
   if(!e)push('MISSING',r.id,`${s.key} absent in ${s.project===MAIN_PROJECT?'main':'webhook'} project`);
   else{
    if(e.type!==s.type)push('WRONG_TYPE',r.id,`${s.key} is ${e.type}, expected ${s.type}`);
    if(e.target!=='production')push('WRONG_TARGET',r.id,`${s.key} target ${e.target}`);
    if(r.change==='NEW_SECRET'&&(e.updatedAt==null||e.updatedAt<facts.credentialEpoch))push('STALE_CREDENTIAL',r.id,`${s.key} not rewritten since the credential epoch`);
   }
   if(other.has(s.key))push('WRONG_PROJECT',r.id,`${s.key} also present in the ${s.project===MAIN_PROJECT?'webhook':'main'} project`);
  }else if(s.kind==='GITHUB_ENV_SECRET'){
   expectedKeys.gh.add(s.key);const e=secretMap.get(s.key);
   if(!e)push('MISSING',r.id,`${s.key} secret absent in ${s.environment}`);
   else if(r.change==='NEW_SECRET'&&(e.updatedAt==null||e.updatedAt<facts.credentialEpoch))push('STALE_CREDENTIAL',r.id,`${s.key} not rewritten since the credential epoch`);
  }else{expectedKeys.gh.add(s.key);if(!vars.has(s.key))push('MISSING',r.id,`${s.key} variable absent in ${s.environment}`);}
 }
 // The group role must not be pinned by an override (a stale override survives a database change silently).
 if(mainMap.has('PRODUCTION_DB_ROLE_GROUP'))push('OVERRIDE_PRESENT','main.role.group','PRODUCTION_DB_ROLE_GROUP exists; the value cannot be read, remove it so the role derives from PRODUCTION_DB_NAME');
 // Webhook project: nothing database/credential-shaped except the receiver URL (parseProductionIngress rejects anything else).
 for(const k of hookMap.keys())if(DBISH.test(k)&&!WEBHOOK_ALLOWED_DB_KEYS.has(k))push('FOREIGN_KEY_IN_WEBHOOK','webhook',`${k} must not exist in the webhook project`);
 // Main project: no receiver URL, no stray DB keys for services we do not know.
 for(const k of mainMap.keys()){
  if(k==='PRODUCTION_RECEIVER_DATABASE_URL')push('FOREIGN_KEY_IN_MAIN','main',`${k} belongs to the webhook project`);
  else if(/^PRODUCTION_(DB_PASSWORD|DB_ROLE|WORKER_DB_PASSWORD)_/.test(k)&&!expectedKeys.main.has(k))push('UNKNOWN_DB_KEY','main',`${k} is not in the binding table`);
 }
 // Roles.
 for(const r of table.roles){
  const f=facts.roles[r.role];
  if(!f?.exists){push('ROLE_MISSING',r.role,'role absent in the new database cluster view');continue;}
  if(f.superuser||f.createdb||f.createrole)push('ROLE_EXCESS_PRIVILEGE',r.role,'superuser/createdb/createrole is set');
  const extra=f.memberships.filter(m=>!r.allowedMemberships.includes(m)),lack=r.allowedMemberships.filter(m=>!f.memberships.includes(m));
  if(extra.length||lack.length)push('ROLE_MEMBERSHIP_DRIFT',r.role,`extra=${extra.join('|')} missing=${lack.join('|')}`);
  const wantLogin=facts.stage==='POST_SWITCH'&&r.loginAfterSwitch;
  if(f.login!==wantLogin)push('ROLE_LOGIN_STATE',r.role,`login=${f.login}, expected ${wantLogin} at ${facts.stage}`);
 }
 if(facts.stage==='POST_SWITCH'&&facts.oldRoles)for(const [role,f] of Object.entries(facts.oldRoles))if(f?.exists&&f.login)push('OLD_ROLE_STILL_LOGIN',role,'old database role can still log in after the switch');
 return out;
}

// ---------------------------------------------------------------- read-only collection (names only)
export type Exec=(file:string,args:string[])=>Promise<string>;
const nodeExec:Exec=(file,args)=>new Promise((resolve,reject)=>execFile(file,args,{maxBuffer:16*1024*1024},(e,out)=>e?reject(new Error('CUTOVER_BINDINGS_COLLECT_FAILED')):resolve(String(out))));
/** Reads `GET /v10/projects/{id}/env` and KEEPS ONLY key/type/target/updatedAt. Never decrypt, never pull. */
export async function collectVercelMetadata(project:string,exec:Exec=nodeExec):Promise<EnvMeta[]>{
 if(project!==MAIN_PROJECT&&project!==WEBHOOK_PROJECT)throw new Error('CUTOVER_BINDINGS_PROJECT_REFUSED');
 const out=await exec('npx',['vercel','api',`/v10/projects/${project}/env`,'--raw']);
 let doc:{envs?:unknown};try{doc=JSON.parse(out.slice(out.indexOf('{')));}catch{throw new Error('CUTOVER_BINDINGS_COLLECT_FAILED');}
 if(!Array.isArray(doc.envs))throw new Error('CUTOVER_BINDINGS_COLLECT_FAILED');
 return (doc.envs as Array<Record<string,unknown>>).map(e=>({key:String(e.key),type:String(e.type),target:(Array.isArray(e.target)?(e.target as string[]).slice().sort().join(','):String(e.target)),
  updatedAt:typeof e.updatedAt==='number'?e.updatedAt:null}));
}

// ---------------------------------------------------------------- new database connection pre-check (after CREATE DATABASE)
export type ConnectionPorts={neon:Pick<NeonPort,'get'>;
 connect(config:{host:string;port:number;database:string;user:string;password:string}):Promise<{query(sql:string):Promise<{rows:Array<Record<string,unknown>>}>;tlsVerified():boolean;end():Promise<void>}>};
export type ConnectionCheck={ok:boolean;reasons:string[];checks:Record<string,boolean>};
const fingerprint=(host:string)=>sha(host.trim().toLowerCase());
/** Read-only. Proves the canonical Neon API hands out a connection for the NEW database whose host/role/database/TLS match the pinned identity.
 * The URI and password stay in this function; the result carries fixed reason codes only. */
export async function verifyNewDatabaseConnection(target:string,ports:ConnectionPorts):Promise<ConnectionCheck>{
 if(!(CUTOVER_TARGETS as readonly string[]).includes(target))throw new Error('CUTOVER_BINDINGS_TARGET_REFUSED');
 const checks:Record<string,boolean>={};const reasons:string[]=[];
 const stop=(code:string)=>{reasons.push(code);return{ok:false,reasons,checks};};
 let host='';
 try{
  const eps=(await ports.neon.get(`/projects/${T.project}/branches/${T.branch}/endpoints`) as {endpoints?:Array<{type?:unknown;branch_id?:unknown;host?:unknown}>}).endpoints;
  const rw=(Array.isArray(eps)?eps:[]).filter(e=>e?.type==='read_write'&&e.branch_id===T.branch);
  checks.endpointUnique=rw.length===1&&typeof rw[0]!.host==='string';
  if(!checks.endpointUnique)return stop('ENDPOINT_AMBIGUOUS');
  host=(rw[0]!.host as string).trim().toLowerCase();
 }catch{return stop('ENDPOINT_LOOKUP_FAILED');}
 checks.hostFingerprint=fingerprint(host)===EXPECTED_PRODUCTION_HOST_FINGERPRINT_SHA256&&!/-pooler\./.test(host);
 if(!checks.hostFingerprint)return stop('HOST_FINGERPRINT_MISMATCH');
 let raw:unknown;
 try{raw=(await ports.neon.get(`/projects/${T.project}/connection_uri`,{branch_id:T.branch,database_name:target,role_name:T.owner,pooled:'false'}) as {uri?:unknown}).uri;}
 catch{return stop('CONNECTION_URI_LOOKUP_FAILED');}
 if(typeof raw!=='string')return stop('CONNECTION_URI_MISSING');
 let uri:URL;try{uri=new URL(raw);}catch{return stop('CONNECTION_URI_UNPARSEABLE');}
 checks.uriHost=uri.hostname.toLowerCase()===host;if(!checks.uriHost)return stop('URI_HOST_MISMATCH');
 checks.uriDatabase=uri.pathname==='/'+target;if(!checks.uriDatabase)return stop('URI_DATABASE_MISMATCH');
 checks.uriRole=decodeURIComponent(uri.username)===T.owner;if(!checks.uriRole)return stop('URI_ROLE_MISMATCH');
 const password=decodeURIComponent(uri.password);checks.uriPassword=password.length>=16;if(!checks.uriPassword)return stop('URI_PASSWORD_SHORT');
 let session;
 try{session=await ports.connect({host,port:5432,database:target,user:T.owner,password});}catch{return stop('CONNECT_FAILED');}
 try{
  checks.tlsVerified=session.tlsVerified();if(!checks.tlsVerified)return stop('TLS_NOT_VERIFIED');
  const r=(await session.query("SELECT current_database() AS db,current_user AS usr,session_user AS ses,(SELECT rolsuper FROM pg_roles WHERE rolname=current_user) AS su,current_setting('default_transaction_read_only') AS ro")).rows[0]??{};
  checks.database=r.db===target;if(!checks.database)return stop('DATABASE_IDENTITY_MISMATCH');
  checks.owner=r.usr===T.owner&&r.ses===T.owner&&r.su===false;if(!checks.owner)return stop('OWNER_ROLE_MISMATCH');
  return{ok:true,reasons,checks};
 }catch{return stop('IDENTITY_QUERY_FAILED');}
 finally{await session.end().catch(()=>undefined);}
}
