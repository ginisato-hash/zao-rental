import test from 'node:test';
import {TLSSocket,connect as tlsConnect,createServer as tlsServer} from 'node:tls';
import {spawnSync} from 'node:child_process';
import {mkdtempSync as mkTmp,readFileSync as readTmp,rmSync as rmTmp} from 'node:fs';
import {tmpdir as osTmp} from 'node:os';
import {join as joinTmp} from 'node:path';
import assert from 'node:assert/strict';
import {chmodSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fingerprintHost} from '../../scripts/production-backup';
import * as m from '../../scripts/production-backup-credential';
import type {BackupCredentialPorts,ConnectionConfig,SqlSession} from '../../scripts/production-backup-credential';

const T=m.BACKUP_CREDENTIAL_TARGET;
const HOST='ep-synthetic-0000.us-east-2.aws.neon.tech';
const AGE='age1'+'qpzry9x8gf2tvdw0s3jn54khce6mua7lqpzry9x8gf2tvdw0s3jn54khce'.slice(0,58);
const OP='3f2b8c1e-9d4a-4e1b-8c7d-0a1b2c3d4e5f';
const NEW_PASSWORD='NeonResetPasswordSynthetic0123456789';
const dbUri=(user:string,host:string,database:string,password='x')=>{const u=new URL('postgresql://placeholder/');u.hostname=host;u.username=user;u.password=password;u.pathname='/'+database;return u.toString();};
const POSTURE={attributes:'super=f,createdb=f,createrole=f,repl=f,bypassrls=f,inherit=t,connlimit=-1',memberships:['pg_read_all_data'],grantees:[T.manager],owned:0,canConnect:true};

type World=ReturnType<typeof world>;
/** An in-memory Neon/GitHub/PostgreSQL. Everything it records is secret-free by construction; the tests assert that. */
function world(over:{resetBody?:unknown;resetThrows?:boolean;opStatuses?:string[];probeDenied?:string;endpoints?:unknown[];preSecrets?:string[];vars?:Record<string,string>;
  secretSetFails?:string;state?:Partial<ReturnType<typeof initialState>>;uri?:string;passwordUnreadable?:boolean;containSqlFails?:number;noClientTls?:boolean;probeFlags?:{read_all:boolean;write_all:boolean;flags:boolean};probeUser?:string;noTable?:boolean}={}){
 const log:string[]=[],sunk:Record<string,string>={},statements:string[]=[];
 const secrets=new Set<string>(over.preSecrets??[...m.BACKUP_OWNER_SECRETS]);
 const vars:Record<string,string>={PRODUCTION_BACKUP_BUCKET:m.BACKUP_BUCKET,AGE_BACKUP_RECIPIENT:AGE,...(over.vars??{})};
 const st={...initialState(),...(over.state??{})};
 let posts=0,opPolls=0,containSqlFails=over.containSqlFails??0;
 // GitHub failure injection for the containment tests: failed deletes (counted), readbacks that throw.
 const flags={deleteSecretFails:0,deleteVariableFails:0,secretReadbackThrows:false,variableReadbackThrows:false};
 const ops=[...(over.opStatuses??['running','finished'])];
 const neon={
  async get(path:string,query?:Record<string,string>):Promise<unknown>{
   log.push('neon.get '+path+(query?' ?'+Object.keys(query).join(','):''));
   if(path===`/projects/${T.project}`)return {project:{id:T.project,history_retention_seconds:21600}};
   if(path===`/projects/${T.project}/branches/${T.branch}`)return {branch:{id:T.branch}};
   if(path.endsWith(`/databases/${T.database}`))return {database:{name:T.database,owner_name:T.owner}};
   if(path.endsWith('/roles'))return {roles:[{name:T.role},{name:T.manager},{name:T.owner}]};
   if(path.endsWith('/endpoints'))return {endpoints:over.endpoints??[{id:'ep-synthetic-0000',type:'read_write',branch_id:T.branch,host:HOST}]};
   if(path.endsWith('/connection_uri'))return {uri:over.uri??dbUri(T.owner,HOST,T.database,'OwnerSecret0123')};
   if(path.includes('/operations/')){opPolls++;return {operation:{id:OP,status:ops.length>1?ops.shift():ops[0]}};}
   throw new Error('unexpected GET '+path);
  },
  async post(path:string):Promise<unknown>{
   posts++;log.push('neon.post '+path);
   if(over.resetThrows)throw new Error('socket hang up');
   return over.resetBody??{role:{name:T.role,password:NEW_PASSWORD},operations:[{id:OP,status:'running'}]};
  },
 };
 const github={
  async secretNames(){if(flags.secretReadbackThrows)throw new Error('gh failed');return [...secrets];},
  async variables(){if(flags.variableReadbackThrows)throw new Error('gh failed');return {...vars};},
  async setSecret(n:string,v:string){if(over.secretSetFails===n)throw new Error('gh failed');log.push('gh.setSecret '+n);secrets.add(n);sunk[n]=v;},
  async setVariable(n:string,v:string){log.push('gh.setVariable '+n+'='+(n==='PRODUCTION_BACKUP_ACTIVATION'?v:'<value>'));vars[n]=v;},
  async deleteSecret(n:string){log.push('gh.deleteSecret '+n);if(flags.deleteSecretFails>0){flags.deleteSecretFails--;throw new Error('gh failed');}secrets.delete(n);delete sunk[n];},
  async deleteVariable(n:string){log.push('gh.deleteVariable '+n);if(flags.deleteVariableFails>0){flags.deleteVariableFails--;throw new Error('gh failed');}delete vars[n];},
 };
 const alter=(sql:string)=>{
  if(/NOLOGIN PASSWORD NULL VALID UNTIL 'infinity'/.test(sql)){if(containSqlFails>0){containSqlFails--;throw new Error('boom');}st.rolcanlogin=false;st.passwordIsNull=true;st.rolvaliduntil='infinity';}
  else if(/NOLOGIN PASSWORD '[A-Za-z0-9_-]{43}' VALID UNTIL 'infinity'/.test(sql)){st.rolcanlogin=false;st.passwordIsNull=false;st.rolvaliduntil='infinity';}
  else if(/LOGIN VALID UNTIL '(.+)'$/.test(sql)){st.rolcanlogin=true;st.rolvaliduntil=/LOGIN VALID UNTIL '(.+)'$/.exec(sql)![1]!;}
  else if(/VALID UNTIL 'infinity'$/.test(sql))st.rolvaliduntil='infinity';
  else throw new Error('unexpected ALTER '+sql);
 };
 const ownerSession=():SqlSession=>({
  async query(sql:string,params?:unknown[]){
   statements.push(sql);
   if(sql==='BEGIN'||sql==='COMMIT'||sql==='ROLLBACK'||sql.startsWith('SET LOCAL ROLE'))return {rows:[]} as never;
   if(sql.startsWith('ALTER ROLE')){alter(sql);return {rows:[]} as never;}
   if(sql.includes('current_database() AS database'))return {rows:[{database:T.database,user:T.owner}]} as never;
   if(sql.includes('clock_timestamp()'))return {rows:[{now:'2026-10-04 16:00:00.123456+00'}]} as never;
   if(sql.includes('FROM pg_authid')){if(over.passwordUnreadable)throw Object.assign(new Error('permission denied'),{code:'42501'});return {rows:[{passwordIsNull:st.passwordIsNull}]} as never;}
   if(sql.includes('FROM pg_roles r WHERE r.rolname=$1')){assert.deepEqual(params,[T.role]);return {rows:[{rolcanlogin:st.rolcanlogin,rolvaliduntil:st.rolvaliduntil,...st.posture}]} as never;}
   throw new Error('unexpected owner SQL '+sql);
  },
  async end(){log.push('owner.end');},
 });
 const backupConfigs:ConnectionConfig[]=[];
 const backupSession=():SqlSession=>({
  async query(sql:string){
   if(sql==='BEGIN'||sql==='ROLLBACK')return {rows:[]} as never;
   // The backend's pg_stat_ssl is NOT consulted: behind Neon's proxy it is false on a verified connection (the Neon-shaped case this fake models by never returning it).
   if(sql.includes('current_user,session_user'))return {rows:[{current_user:over.probeUser??T.role,session_user:over.probeUser??T.role}]} as never;
   if(sql.includes('pg_read_all_data'))return {rows:[over.probeFlags??{read_all:true,write_all:false,flags:false}]} as never;
   if(sql.includes('FROM pg_class'))return {rows:over.noTable?[]:[{relname:'bookings'}]} as never;
   if(sql.startsWith('SELECT 1 FROM public.'))return {rows:[]} as never;
   if(sql.startsWith('DELETE FROM public.'))throw Object.assign(new Error('permission denied for table bookings'),{code:over.probeDenied??'42501'});
   throw new Error('unexpected backup SQL '+sql);
  },
  async end(){log.push('backup.end');},
  transportVerified:()=>over.noClientTls!==true,
 });
 let claimed=false;const sleeps:number[]=[];
 const ports:BackupCredentialPorts={neon,github,
  async connectOwner(c){log.push('connectOwner '+c.user+'@'+c.database);return ownerSession();},
  async connectBackup(c){backupConfigs.push(c);log.push('connectBackup '+c.user);return backupSession();},
  guard:{exists:()=>claimed,claim:()=>{if(claimed)throw new Error('BACKUP_CREDENTIAL_RESET_ALREADY_ATTEMPTED');claimed=true;log.push('guard.claim');}},
  async sleep(ms){sleeps.push(ms);},now:()=>new Date(1_000_000+sleeps.length*1000),expectTls:true,containmentSchedule:[0,0,0],expectedHostFingerprint:fingerprintHost(HOST)};
 return {ports,log,sunk,secrets,vars,statements,st,backupConfigs,flags,get posts(){return posts;},get opPolls(){return opPolls;}};
}
function initialState(){return {rolcanlogin:false,rolvaliduntil:null as string|null,passwordIsNull:true as boolean,posture:{...POSTURE}};}
const everything=(w:World)=>JSON.stringify({log:w.log});
const temporaryOf=(w:World)=>{const hit=w.statements.find(s=>/PASSWORD '[A-Za-z0-9_-]{43}'/.test(s));return hit?/PASSWORD '([A-Za-z0-9_-]{43})'/.exec(hit)![1]!:'';};

test('provision follows the accepted order and routes the password only into the stdin sink',async()=>{
 const w=world();
 const ev=await m.provisionBackupCredential(w.ports);
 assert.equal(ev.state,'PROVISIONED');assert.equal(w.posts,1);assert.equal(ev.resetPostCount,1);assert.equal(ev.leaseMinutes,90);
 assert.deepEqual(ev.steps,['PRECONDITIONS_READ_ONLY','NEON_TARGET_IDENTITY','OWNER_SESSION_MEMORY_ONLY','BASELINE_READY_PRISTINE','TEMPORARY_PASSWORD_NOLOGIN','RESET_PASSWORD_POST_ONCE',
  'RESET_OPERATIONS_FINISHED','LOGIN_LEASE_90M_DB_CLOCK','DIRECT_LOGIN_AND_PROBES','SINKS_METADATA_READBACK','ACTIVATION_SET_LAST']);
 // exact order of the observable effects
 const order=['connectOwner','guard.claim','neon.post','connectBackup','gh.setSecret PRODUCTION_BACKUP_PGHOST','gh.setSecret PRODUCTION_BACKUP_PGPASSWORD','gh.setVariable PRODUCTION_BACKUP_ACTIVATION'];
 let at=-1;for(const needle of order){const i=w.log.findIndex((l,idx)=>idx>at&&l.startsWith(needle));assert.ok(i>at,needle);at=i;}
 const lastMutation=w.log.filter(l=>l.startsWith('gh.')).at(-1);assert.equal(lastMutation,'gh.setVariable PRODUCTION_BACKUP_ACTIVATION=R4_APPROVED');
 assert.equal(w.sunk[m.BACKUP_SINKS.password],NEW_PASSWORD);
 assert.deepEqual(Object.keys(w.sunk).sort(),Object.values(m.BACKUP_SINKS).sort());
 assert.equal(w.sunk[m.BACKUP_SINKS.host],HOST);assert.equal(w.sunk[m.BACKUP_SINKS.user],T.role);
 assert.equal(w.vars.PRODUCTION_BACKUP_ACTIVATION,'R4_APPROVED');
 // login lease: database clock + exactly 90 minutes, fractional seconds kept, and longer than the 30-minute workflow
 assert.ok(w.statements.includes(`ALTER ROLE "neondb_backup" LOGIN VALID UNTIL '2026-10-04T17:30:00.123456Z'`));
 assert.ok(m.BACKUP_LOGIN_LEASE_MINUTES>=2*m.BACKUP_WORKFLOW_TIMEOUT_MINUTES);
 // the manager statement precedes every ALTER, inside a transaction
 for(const [i,s] of w.statements.entries())if(s.startsWith('ALTER ROLE')){assert.equal(w.statements[i-1],'SET LOCAL ROLE "neondb_role_admin"');assert.equal(w.statements[i-2],'BEGIN');}
 assert.equal(w.st.rolcanlogin,true);
 assert.equal(w.backupConfigs[0]!.password,NEW_PASSWORD);
 // secrets never appear in any recorded event, the evidence, or the temporary password anywhere outside its one SQL statement
 const temp=temporaryOf(w);assert.match(temp,/^[A-Za-z0-9_-]{43}$/);
 for(const secret of [NEW_PASSWORD,temp,'OwnerSecret0123']){assert.ok(!everything(w).includes(secret));assert.ok(!JSON.stringify(ev).includes(secret));}
 assert.equal(w.statements.filter(s=>s.includes(temp)).length,1);
 assert.ok(!w.statements.some(s=>s.includes(NEW_PASSWORD)),'the Neon password is never sent through the owner SQL');
});

test('preconditions refuse before any mutation, session or POST',async()=>{
 const cases:Array<[string,Parameters<typeof world>[0],string]>=[
  ['R2 credential sink missing',{preSecrets:['PRODUCTION_BACKUP_R2_ACCOUNT_ID']},'BACKUP_CREDENTIAL_PRECONDITION_R2_SINK_MISSING'],
  ['password sink already present',{preSecrets:[...m.BACKUP_OWNER_SECRETS,m.BACKUP_SINKS.password]},'BACKUP_CREDENTIAL_PRECONDITION_SINK_NOT_CLEAN'],
  ['bucket variable wrong',{vars:{PRODUCTION_BACKUP_BUCKET:'other'}},'BACKUP_CREDENTIAL_PRECONDITION_BUCKET_VARIABLE'],
  ['age recipient invalid',{vars:{AGE_BACKUP_RECIPIENT:'AGE-SECRET-KEY-1'+'Q'.repeat(58)}},'BACKUP_CREDENTIAL_AGE_RECIPIENT_INVALID'],
  ['activation already set',{vars:{PRODUCTION_BACKUP_ACTIVATION:'R4_APPROVED'}},'BACKUP_CREDENTIAL_PRECONDITION_ACTIVATION_NOT_CLEAN'],
 ];
 for(const [name,over,code] of cases){
  const w=world(over);
  await assert.rejects(m.provisionBackupCredential(w.ports),(e:Error)=>{assert.equal(e.message,code,name);assert.equal((e as {contained?:unknown}).contained,undefined,name);return true;});
  assert.equal(w.posts,0,name);assert.ok(!w.log.some(l=>l.startsWith('connect')||l.startsWith('gh.')),name);assert.equal(w.statements.length,0,name);
 }
});

test('the target is exact: wrong project, branch, database owner, endpoint host, pooled host or owner URI host all refuse before a session or POST',async()=>{
 const bad:Array<[string,Parameters<typeof world>[0]]>=[
  ['two read_write endpoints',{endpoints:[{type:'read_write',branch_id:T.branch,host:HOST},{type:'read_write',branch_id:T.branch,host:HOST}]}],
  ['no read_write endpoint',{endpoints:[{type:'read_only',branch_id:T.branch,host:HOST}]}],
  ['pooled host',{endpoints:[{type:'read_write',branch_id:T.branch,host:'ep-synthetic-0000-pooler.us-east-2.aws.neon.tech'}]}],
  ['non-neon host',{endpoints:[{type:'read_write',branch_id:T.branch,host:'db.example.com'}]}],
  ['fingerprint mismatch',{endpoints:[{type:'read_write',branch_id:T.branch,host:'ep-other-1111.us-east-2.aws.neon.tech'}]}],
  ['owner URI points elsewhere',{uri:dbUri(T.owner,'ep-evil-2222.us-east-2.aws.neon.tech',T.database)}],
  ['owner URI wrong database',{uri:dbUri(T.owner,HOST,'other')}],
  ['owner URI wrong user',{uri:dbUri('someone',HOST,T.database)}],
 ];
 for(const [name,over] of bad){
  const w=world(over);
  await assert.rejects(m.provisionBackupCredential(w.ports),Error,name);
  assert.equal(w.posts,0,name);assert.ok(!w.log.some(l=>l.startsWith('gh.')),name);assert.equal(w.statements.filter(s=>s.startsWith('ALTER')).length,0,name);
 }
});

test('role baseline and posture drift refuse before any ALTER',async()=>{
 for(const [name,state] of [
  ['already LOGIN',{rolcanlogin:true}],['stale finite lease',{rolvaliduntil:'2026-10-03 00:00:00+00'}],['password present',{passwordIsNull:false}],
  ['extra membership',{posture:{...POSTURE,memberships:['pg_read_all_data','pg_write_all_data']}}],
  ['superuser attribute',{posture:{...POSTURE,attributes:POSTURE.attributes.replace('super=f','super=t')}}],
  ['unexpected grantee',{posture:{...POSTURE,grantees:[T.manager,'someone']}}],['owns objects',{posture:{...POSTURE,owned:1}}],
 ] as Array<[string,Partial<ReturnType<typeof initialState>>]>){
  const w=world({state});
  await assert.rejects(m.provisionBackupCredential(w.ports),Error,name);
  assert.equal(w.posts,0,name);assert.equal(w.statements.filter(s=>s.startsWith('ALTER')).length,0,name);
 }
});

test('an unknown reset outcome is contained and never resent; the guard blocks any second attempt',async()=>{
 const w=world({resetThrows:true});
 await assert.rejects(m.provisionBackupCredential(w.ports),(e:Error&{contained?:{state:string}})=>{assert.equal(e.message,'BACKUP_CREDENTIAL_RESET_OUTCOME_UNKNOWN');assert.equal(e.contained?.state,'CONTAINED');return true;});
 assert.equal(w.posts,1);assert.equal(w.st.rolcanlogin,false);assert.equal(w.st.passwordIsNull,true);assert.equal(w.st.rolvaliduntil,'infinity');
 assert.ok(!w.sunk[m.BACKUP_SINKS.password]);assert.ok(!('PRODUCTION_BACKUP_ACTIVATION' in w.vars));
 await assert.rejects(m.provisionBackupCredential(w.ports),/BACKUP_CREDENTIAL_RESET_ALREADY_ATTEMPTED/);
 assert.equal(w.posts,1,'no blind retry');
});

test('invalid or password-echoing reset responses and unfinished operations are contained',async()=>{
 const temporaryEcho=async()=>{const w=world();const post=w.ports.neon.post.bind(w.ports.neon);
  w.ports.neon.post=async path=>{await post(path);return {role:{name:T.role,password:temporaryOf(w)},operations:[{id:OP}]};};return w;};
 const cases:Array<[string,World|Promise<World>,string]>=[
  ['no operations',world({resetBody:{role:{name:T.role,password:NEW_PASSWORD},operations:[]}}),'PRODUCTION_CREDENTIAL_RESET_RESPONSE_INVALID'],
  ['wrong role',world({resetBody:{role:{name:'neondb_owner',password:NEW_PASSWORD},operations:[{id:OP}]}}),'PRODUCTION_CREDENTIAL_RESET_RESPONSE_INVALID'],
  ['echoed temporary password',temporaryEcho(),'PRODUCTION_CREDENTIAL_RESET_RESPONSE_INVALID'],
  ['operation failed',world({opStatuses:['failed']}),'BACKUP_CREDENTIAL_RESET_NOT_COMPLETED'],
  ['operation never finishes',world({opStatuses:['running']}),'BACKUP_CREDENTIAL_RESET_NOT_COMPLETED'],
 ];
 for(const [name,pending,code] of cases){
  const w=await pending;
  await assert.rejects(m.provisionBackupCredential(w.ports),(e:Error&{contained?:{state:string}})=>{assert.equal(e.message,code,name);assert.equal(e.contained?.state,'CONTAINED',name);return true;});
  assert.equal(w.posts,1,name);assert.equal(w.st.rolcanlogin,false,name);assert.ok(!w.sunk[m.BACKUP_SINKS.password],name);assert.ok(!('PRODUCTION_BACKUP_ACTIVATION' in w.vars),name);
 }
});

test('a failed probe or sink contains the role, deletes the password sink and never sets the activation variable',async()=>{
 const probe=world({probeDenied:'00000'});
 await assert.rejects(m.provisionBackupCredential(probe.ports),/BACKUP_CREDENTIAL_PROBE_FAILED/);
 assert.equal(probe.st.rolcanlogin,false);assert.ok(!probe.sunk[m.BACKUP_SINKS.password]);assert.ok(!('PRODUCTION_BACKUP_ACTIVATION' in probe.vars));
 assert.ok(!probe.log.some(l=>l.startsWith('gh.setSecret')),'nothing is sunk before the probes pass');
 const sink=world({secretSetFails:m.BACKUP_SINKS.password});
 await assert.rejects(m.provisionBackupCredential(sink.ports),Error);
 assert.equal(sink.st.rolcanlogin,false);assert.ok(!sink.sunk[m.BACKUP_SINKS.password]);assert.ok(!('PRODUCTION_BACKUP_ACTIVATION' in sink.vars));
 assert.equal(sink.posts,1);
});

test('the TLS proof is the established client transport, never the backend pg_stat_ssl row; every probe refusal names its check by a fixed reason and contains the role',async()=>{
 // a verified client transport passes even though the (Neon proxy-to-compute) backend row is never consulted
 const ok=world();const ev=await m.provisionBackupCredential(ok.ports);
 assert.equal(ev.tlsVerified,true);assert.ok(ev.probes.includes('TLS_VERIFY_FULL_CHANNEL_BINDING'));
 const cases:Array<[string,Parameters<typeof world>[0],string]>=[
  ['no client TLS proof',{noClientTls:true},'BACKUP_PROBE_TLS'],['another user',{probeUser:'neondb_owner'},'BACKUP_PROBE_IDENTITY'],
  ['no pg_read_all_data',{probeFlags:{read_all:false,write_all:false,flags:false}},'BACKUP_PROBE_ROLE_FLAGS'],['write-all',{probeFlags:{read_all:true,write_all:true,flags:false}},'BACKUP_PROBE_ROLE_FLAGS'],
  ['elevated flag',{probeFlags:{read_all:true,write_all:false,flags:true}},'BACKUP_PROBE_ROLE_FLAGS'],['no public table',{noTable:true},'BACKUP_PROBE_TABLE'],['write not denied',{probeDenied:'00000'},'BACKUP_PROBE_WRITE_NOT_DENIED'],
 ];
 for(const [name,over,reason] of cases){
  const w=world(over);
  await assert.rejects(m.provisionBackupCredential(w.ports),(e:Error&{reason?:unknown;contained?:{state:string}})=>{assert.equal(e.message,'BACKUP_CREDENTIAL_PROBE_FAILED',name);assert.equal(e.reason,reason,name);assert.equal(e.contained?.state,'CONTAINED',name);return true;});
  assert.equal(w.st.rolcanlogin,false,name);assert.ok(!w.sunk[m.BACKUP_SINKS.password],name);assert.ok(!('PRODUCTION_BACKUP_ACTIVATION' in w.vars),name);assert.equal(w.posts,1,name+': one POST, never resent');
 }
 // the client transport reader: only an encrypted, authorized TLSSocket of the exact host with no process-level override
 const sock=(own:Record<string,unknown>)=>Object.assign(Object.create(TLSSocket.prototype) as object,{encrypted:true},own);
 const client=(stream:unknown)=>({connection:{stream}});
 const good=sock({authorized:true,servername:HOST});
 assert.equal(m.clientTransportVerified(client(good),HOST,{} as unknown as NodeJS.ProcessEnv),true);
 for(const [name,c,host,env] of [
  ['unauthorized',client(sock({authorized:false,servername:HOST})),HOST,{}],['other SNI',client(sock({authorized:true,servername:'other.example'})),HOST,{}],['no SNI',client(sock({authorized:true})),HOST,{}],
  ['plain socket',client({authorized:true,encrypted:true,servername:HOST}),HOST,{}],['not encrypted',client(sock({encrypted:false,authorized:true,servername:HOST})),HOST,{}],['no stream',{connection:{}},HOST,{}],['no connection',{},HOST,{}],['null',null,HOST,{}],
  ['TLS verification disabled',client(good),HOST,{NODE_TLS_REJECT_UNAUTHORIZED:'0'}],['custom CA',client(good),HOST,{NODE_EXTRA_CA_CERTS:'/x.pem'}],['other host',client(good),'ep-other.example',{}],
 ] as Array<[string,unknown,string,Record<string,string>]>)assert.equal(m.clientTransportVerified(c,host,env as unknown as NodeJS.ProcessEnv),false,name);
 // the production session exposes it; a session without it never satisfies expectTls
 const bare=world({});(bare.ports as {connectBackup:unknown}).connectBackup=async()=>({async query(){return {rows:[{current_user:T.role,session_user:T.role}]} as never;},async end(){}});
 await assert.rejects(m.provisionBackupCredential(bare.ports),/BACKUP_CREDENTIAL_PROBE_FAILED/);
});

test('containment is bounded, idempotent and reports failure instead of claiming success',async()=>{
 const ok=world({containSqlFails:2});
 const r=await m.containBackupCredential(ok.ports);
 assert.equal(r.state,'CONTAINED');assert.equal(r.attempts,3);
 const never=world({containSqlFails:99});
 const f=await m.containBackupCredential(never.ports);
 assert.equal(f.state,'CONTAINMENT_FAILED');assert.equal(f.attempts,4);
 const again=await m.containBackupCredential(ok.ports);assert.equal(again.state,'CONTAINED');
 // password presence unreadable: containment is judged on NOLOGIN, VALID UNTIL infinity and the issued statement
 const blind=world({passwordUnreadable:true});assert.equal((await m.containBackupCredential(blind.ports)).state,'CONTAINED');
});

test('CONTAINED needs the role read back AND the PGPASSWORD secret AND the activation variable read back absent; failed or unknown GitHub steps are CONTAINMENT_FAILED',async()=>{
 const provisioned=async(setup:(x:World)=>void)=>{const x=world();await m.provisionBackupCredential(x.ports);setup(x);return x;};
 // everything present and removable: all three conditions hold
 const ok=await provisioned(()=>undefined);
 const done=await m.containBackupCredential(ok.ports);
 assert.deepEqual([done.state,done.roleContained,done.sinkDeleted,done.activationDeleted],['CONTAINED',true,true,true]);
 assert.ok(!(m.BACKUP_SINKS.password in ok.sunk)&&!('PRODUCTION_BACKUP_ACTIVATION' in ok.vars));
 // the secret never existed / the variable never existed: absent is success
 const absent=world();const fresh=await m.containBackupCredential(absent.ports);
 assert.deepEqual([fresh.state,fresh.sinkDeleted,fresh.activationDeleted],['CONTAINED',true,true]);
 // a persistent secret deletion failure: the role is contained but the result is not
 const secretStuck=await provisioned(x=>{x.flags.deleteSecretFails=99;});
 const a=await m.containBackupCredential(secretStuck.ports);
 assert.deepEqual([a.state,a.roleContained,a.sinkDeleted,a.activationDeleted],['CONTAINMENT_FAILED',true,false,true]);
 assert.ok(m.BACKUP_SINKS.password in secretStuck.sunk);
 // a persistent variable deletion failure
 const variableStuck=await provisioned(x=>{x.flags.deleteVariableFails=99;});
 const b=await m.containBackupCredential(variableStuck.ports);
 assert.deepEqual([b.state,b.roleContained,b.sinkDeleted,b.activationDeleted],['CONTAINMENT_FAILED',true,true,false]);
 // an unknown readback is not success, even when the delete call itself worked
 const secretUnknown=await provisioned(x=>{x.flags.secretReadbackThrows=true;});
 const c=await m.containBackupCredential(secretUnknown.ports);
 assert.deepEqual([c.state,c.sinkDeleted,c.activationDeleted],['CONTAINMENT_FAILED',false,true]);
 const variableUnknown=await provisioned(x=>{x.flags.variableReadbackThrows=true;});
 const d=await m.containBackupCredential(variableUnknown.ports);
 assert.deepEqual([d.state,d.sinkDeleted,d.activationDeleted],['CONTAINMENT_FAILED',true,false]);
 // a transient GitHub failure is retried on the bounded schedule and then succeeds
 const flaky=await provisioned(x=>{x.flags.deleteSecretFails=1;x.flags.deleteVariableFails=2;});
 const e=await m.containBackupCredential(flaky.ports);
 assert.equal(e.state,'CONTAINED');assert.ok(e.attempts>=3);
 // a provision failure whose sink deletion also fails reports CONTAINMENT_FAILED instead of a clean containment
 const failing=world({probeDenied:'00000'});failing.flags.deleteSecretFails=99;
 await assert.rejects(m.provisionBackupCredential(failing.ports),(err:Error&{contained?:{state:string;roleContained:boolean}})=>{assert.equal(err.message,'BACKUP_CREDENTIAL_PROBE_FAILED');assert.equal(err.contained?.roleContained,true);return true;});
});

test('finalize needs a restore PASS record and a live sink; a failed finalization contains',async()=>{
 const w=world();await m.provisionBackupCredential(w.ports);
 const proof={result:'PASS',objectKey:'hourly/2026/10/04/2026-10-04T16:10:00.000Z.dump.age',objectSha256:'a'.repeat(64)};
 for(const bad of [undefined,{},{...proof,result:'FAIL'},{...proof,objectKey:'../x'},{...proof,objectSha256:'zz'}])
  await assert.rejects(m.finalizeBackupCredential(w.ports,bad),/BACKUP_CREDENTIAL_RESTORE_PASS_REQUIRED/);
 assert.equal(w.st.rolvaliduntil,'2026-10-04T17:30:00.123456Z','a refused finalize changes nothing');
 const ev=await m.finalizeBackupCredential(w.ports,proof);
 assert.equal(ev.state,'FINALIZED');assert.equal(w.st.rolvaliduntil,'infinity');assert.equal(w.st.rolcanlogin,true);
 const noSink=world();await m.provisionBackupCredential(noSink.ports);noSink.secrets.delete(m.BACKUP_SINKS.password);
 await assert.rejects(m.finalizeBackupCredential(noSink.ports,proof),/BACKUP_CREDENTIAL_FINALIZE_PRECONDITION/);
 assert.equal(noSink.st.rolcanlogin,true,'a precondition refusal contains nothing');
 const broken=world();await m.provisionBackupCredential(broken.ports);
 const query=broken.ports.connectOwner.bind(broken.ports);
 broken.ports.connectOwner=async c=>{const s=await query(c);return {...s,query:(async(sql:string,p?:unknown[])=>{if(sql.includes("VALID UNTIL 'infinity'")&&!sql.includes('PASSWORD'))throw new Error('x');return s.query(sql,p);}) as never,end:()=>s.end()};};
 await assert.rejects(m.finalizeBackupCredential(broken.ports,proof),(e:Error&{contained?:{state:string}})=>{assert.equal(e.message,'BACKUP_CREDENTIAL_SQL_FAILED');assert.equal(e.contained?.state,'CONTAINED');return true;});
});

test('the age recipient is validated, never a private key, and is set only when absent or identical',async()=>{
 const w=world({vars:{}});delete w.vars.AGE_BACKUP_RECIPIENT;
 for(const bad of ['','age1short','AGE-SECRET-KEY-1'+'Q'.repeat(58),AGE.toUpperCase(),AGE+'x',' '+AGE])
  await assert.rejects(m.setAgeRecipient(w.ports,bad),/BACKUP_CREDENTIAL_AGE_RECIPIENT_INVALID/);
 const ok=await m.setAgeRecipient(w.ports,AGE);assert.equal(ok.state,'AGE_RECIPIENT_SET');assert.match(ok.recipientSha256Prefix,/^[a-f0-9]{12}$/);
 assert.equal(w.vars.AGE_BACKUP_RECIPIENT,AGE);
 await m.setAgeRecipient(w.ports,AGE);
 await assert.rejects(m.setAgeRecipient(w.ports,'age1'+'q'.repeat(58)),/BACKUP_CREDENTIAL_AGE_RECIPIENT_CONFLICT/);
});

test('SQL builders and the one reset path are exact',()=>{
 assert.equal(m.backupResetPath(),'/projects/curly-union-23141081/branches/br-long-king-azkou4fy/roles/neondb_backup/reset_password');
 assert.deepEqual(m.backupContainSql(),['SET LOCAL ROLE "neondb_role_admin"','ALTER ROLE "neondb_backup" NOLOGIN PASSWORD NULL VALID UNTIL \'infinity\'']);
 assert.deepEqual(m.backupFinalizeSql(),['SET LOCAL ROLE "neondb_role_admin"','ALTER ROLE "neondb_backup" VALID UNTIL \'infinity\'']);
 assert.throws(()=>m.backupTemporaryPasswordSql("x'; DROP ROLE neondb_owner; --"),/BACKUP_CREDENTIAL_TEMPORARY_PASSWORD_INVALID/);
 assert.throws(()=>m.backupLoginSql("2026-10-04T17:30:00Z'; --"),/BACKUP_CREDENTIAL_LEASE_INVALID/);
 assert.equal(m.backupLeaseDeadline('2026-10-04 16:00:00+00'),'2026-10-04T17:30:00Z');
 assert.equal(m.backupLeaseDeadline('2026-10-04 23:59:59.5+09'),'2026-10-04T16:29:59.5Z');
 assert.equal(m.backupLeaseDeadline('2026-10-04 23:50:00.000005+00'),'2026-10-05T01:20:00.000005Z');
 assert.throws(()=>m.backupLeaseDeadline('tomorrow'),/BACKUP_CREDENTIAL_DATABASE_TIME_INVALID/);
 assert.deepEqual(m.backupPostureDrift({rolcanlogin:false,rolvaliduntil:null,passwordIsNull:true,...POSTURE}),[]);
});

// ---- real child-process adapters with stand-in executables: stdout is captured, secrets travel only over stdin
const pathEnv=()=>({PATH:process.env.PATH??''} as unknown as NodeJS.ProcessEnv);
function standIn(dir:string,name:string,body:string){const p=join(dir,name);writeFileSync(p,'#!/bin/sh\n'+body);chmodSync(p,0o755);return p;}
test('the gh adapter sends a secret over stdin only (never argv) and refuses names outside the scope',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'zao-gh-'));
 try{
  const argv=join(dir,'argv.txt'),stdin=join(dir,'stdin.txt');
  const gh=standIn(dir,'gh',`printf '%s\\n' "$@" > '${argv}'\ncat > '${stdin}'\n`);
  const port=m.gitHubCliPort(gh,pathEnv());
  await port.setSecret(m.BACKUP_SINKS.password,NEW_PASSWORD);
  assert.equal(readFileSync(stdin,'utf8'),NEW_PASSWORD);
  const args=readFileSync(argv,'utf8').trim().split('\n');
  assert.deepEqual(args,['secret','set','PRODUCTION_BACKUP_PGPASSWORD','--env','production-backup','--repo','ginisato-hash/zao-rental']);
  assert.ok(!args.includes('--body')&&!args.includes('-b'));
  await assert.rejects(port.setSecret('PRODUCTION_BACKUP_R2_SECRET_ACCESS_KEY','x'),/BACKUP_CREDENTIAL_GITHUB_NAME_REFUSED/);
  await assert.rejects(port.setSecret('OTHER_SECRET','x'),/BACKUP_CREDENTIAL_GITHUB_NAME_REFUSED/);
  await assert.rejects(port.deleteSecret('PRODUCTION_BACKUP_R2_ACCESS_KEY_ID'),/BACKUP_CREDENTIAL_GITHUB_NAME_REFUSED/);
  const failing=m.gitHubCliPort(standIn(dir,'gh-fail',`echo "${NEW_PASSWORD}" >&2\nexit 1\n`),pathEnv());
  await assert.rejects(failing.setSecret(m.BACKUP_SINKS.password,NEW_PASSWORD),(e:Error)=>{assert.equal(e.message,'BACKUP_CREDENTIAL_GITHUB_CALL_FAILED');assert.ok(!e.message.includes(NEW_PASSWORD));return true;});
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('the neon adapter captures the response in memory, allows only the exact routes, and the one POST path',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'zao-neon-'));
 try{
  const argv=join(dir,'argv.txt');
  const neon=standIn(dir,'neon',`printf '%s\\n' "$@" > '${argv}'\necho '{"role":{"name":"neondb_backup","password":"${NEW_PASSWORD}"},"operations":[]}'\n`);
  const port=m.neonCliPort(neon,pathEnv());
  const body=await port.post(m.backupResetPath()) as {role:{password:string}};
  assert.equal(body.role.password,NEW_PASSWORD);
  assert.deepEqual(readFileSync(argv,'utf8').trim().split('\n'),['api',m.backupResetPath(),'-X','POST']);
  await assert.rejects(port.post('/projects/other/branches/x/roles/neondb_backup/reset_password'),/BACKUP_CREDENTIAL_NEON_PATH_REFUSED/);
  await assert.rejects(port.post(`/projects/${T.project}/branches/${T.branch}/roles/neondb_owner/reset_password`),/BACKUP_CREDENTIAL_NEON_PATH_REFUSED/);
  await assert.rejects(port.get(`/projects/${T.project}/branches/${T.branch}/roles/neondb_owner/reveal_password`),/BACKUP_CREDENTIAL_NEON_PATH_REFUSED/);
  await assert.rejects(port.get('/projects'),/BACKUP_CREDENTIAL_NEON_PATH_REFUSED/);
  await port.get(`/projects/${T.project}/connection_uri`,{role_name:T.owner});
  assert.deepEqual(readFileSync(argv,'utf8').trim().split('\n'),['api',`/projects/${T.project}/connection_uri`,'-Q','role_name=neondb_owner']);
  const failing=m.neonCliPort(standIn(dir,'neon-fail',`echo "${NEW_PASSWORD}" >&2\nexit 3\n`),pathEnv());
  await assert.rejects(failing.post(m.backupResetPath()),(e:Error)=>{assert.equal(e.message,'BACKUP_CREDENTIAL_NEON_CALL_FAILED');return true;});
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('the durable guard is exclusive, survives restarts and holds no secret',()=>{
 const dir=mkdtempSync(join(tmpdir(),'zao-guard-'));
 try{
  const first=m.fileGuard(join(dir,'ev'));assert.equal(first.exists(),false);first.claim();
  const second=m.fileGuard(join(dir,'ev'));assert.equal(second.exists(),true);
  assert.throws(()=>second.claim(),/BACKUP_CREDENTIAL_RESET_ALREADY_ATTEMPTED/);
  const text=readFileSync(join(dir,'ev','reset-attempt.json'),'utf8');assert.match(text,/claimedAt/);assert.ok(!/password|secret|postgres/i.test(text.replace(/reset_password/g,'')));
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('the CLI accepts only the four fixed commands and no arguments, and every failure is a fixed code',async()=>{
 await assert.rejects(m.main(['provision','--force']),/BACKUP_CREDENTIAL_ARGUMENTS_REFUSED/);
 await assert.rejects(m.main(['reset-password']),/BACKUP_CREDENTIAL_COMMAND_REFUSED|BACKUP_CREDENTIAL_NEON_CLI_MISSING/);
 const pkg=JSON.parse(readFileSync('package.json','utf8')) as {scripts:Record<string,string>};
 for(const c of ['provision','finalize','contain','set-age-recipient'])
  assert.equal(pkg.scripts[c==='set-age-recipient'?'backup:set-age-recipient':'backup:role-'+c],`node --import tsx scripts/production-backup-credential.ts ${c}`);
});

test('clientTransportVerified against a REAL Node TLS socket: only a verified connection to the exact host counts',{skip:spawnSync('openssl',['version']).status!==0},async()=>{
 const dir=mkTmp(joinTmp(osTmp(),'zao-tls-'));
 try{
  assert.equal(spawnSync('openssl',['req','-x509','-newkey','ec','-pkeyopt','ec_paramgen_curve:prime256v1','-nodes','-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost','-keyout',joinTmp(dir,'k.pem'),'-out',joinTmp(dir,'c.pem')],{stdio:'ignore'}).status,0);
  const key=readTmp(joinTmp(dir,'k.pem')),cert=readTmp(joinTmp(dir,'c.pem'));
  const server=tlsServer({key,cert},sock=>{sock.on('error',()=>undefined);sock.on('data',()=>undefined);});
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
  const port=(server.address() as {port:number}).port;
  const open=(over:Record<string,unknown>)=>new Promise<TLSSocket>((resolve,reject)=>{const s=tlsConnect({port,host:'127.0.0.1',...over},()=>resolve(s));s.on('error',reject);});
  try{
   const good=await open({servername:'localhost',ca:cert});
   assert.equal(m.clientTransportVerified({connection:{stream:good}},'localhost',{} as unknown as NodeJS.ProcessEnv),true,'verified TLS to the expected host');
   assert.equal(m.clientTransportVerified({connection:{stream:good}},'other.example',{} as unknown as NodeJS.ProcessEnv),false,'another expected host');
   assert.equal(m.clientTransportVerified({connection:{stream:good}},'localhost',{NODE_TLS_REJECT_UNAUTHORIZED:'0'} as unknown as NodeJS.ProcessEnv),false,'verification override');
   const unverified=await open({servername:'localhost',rejectUnauthorized:false});
   assert.equal(unverified.authorized,false);assert.equal(m.clientTransportVerified({connection:{stream:unverified}},'localhost',{} as unknown as NodeJS.ProcessEnv),false,'unauthorized (no CA) connection');
   good.destroy();unverified.destroy();
  }finally{await new Promise<void>(r=>server.close(()=>r()));}
 }finally{rmTmp(dir,{recursive:true,force:true});}
});
