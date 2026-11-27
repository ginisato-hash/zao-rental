import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import * as b from '../../scripts/production-cutover-bindings';
import {selectProductionCredentialDatabase,BACKUP_CREDENTIAL_TARGET} from '../../scripts/production-backup-credential';
import {isExpectedProductionDatabaseName,assertProductionIdentityFacts,EXPECTED_PRODUCTION_HOST_FINGERPRINT_SHA256,EXPECTED_PRODUCTION_VERCEL_PROJECT_FINGERPRINT_SHA256} from '../../packages/auth/src/production-identity';
import {parseProductionIngress} from '../../apps/webhook-ingress/src/config';

const EPOCH=1_000;
function factsFor(t:b.BindingTable,stage:'PRE_SWITCH'|'POST_SWITCH'='PRE_SWITCH'):b.BindingFacts{
 const main:b.EnvMeta[]=[],webhook:b.EnvMeta[]=[],secrets:{name:string;updatedAt:number}[]=[],variables:string[]=[];
 for(const r of t.rows){const s=r.sink;if(!s)continue;
  if(s.kind==='VERCEL_ENV')(s.project===b.MAIN_PROJECT?main:webhook).push({key:s.key,type:s.type,target:'production',updatedAt:EPOCH+1});
  else if(s.kind==='GITHUB_ENV_SECRET')secrets.push({name:s.key,updatedAt:EPOCH+1});else variables.push(s.key);}
 const roles:Record<string,b.RoleFact>={};
 for(const r of t.roles)roles[r.role]={exists:true,login:stage==='POST_SWITCH'&&r.loginAfterSwitch,superuser:false,createdb:false,createrole:false,memberships:[...r.allowedMemberships]};
 return {vercel:{main,webhook},github:{secrets,variables},roles,stage,credentialEpoch:EPOCH};
}
test('table: names derive from the target; untouched list and retained old database are explicit',()=>{
 const t=b.buildBindingTable('neondb','neondb_v65');
 assert.equal(t.rows.find(r=>r.id==='main.db.name')!.database!.new,'neondb_v65');
 assert.equal(t.rows.find(r=>r.id==='main.role.auth')!.newRole,'neondb_v65_auth');
 assert.equal(t.rows.find(r=>r.id==='main.worker.dispatcher')!.newRole,'neondb_v65_pay_dispatch');
 assert.equal(t.rows.find(r=>r.id==='webhook.receiver.url')!.newRole,'neondb_v65_pay_receipt');
 assert.equal(t.retainedOld.delete,'NEVER_IN_THIS_CUTOVER');
 assert.ok(t.untouched.some(u=>/webhook URL/.test(u)));
 // 12 service credentials + 3 worker + receiver + 3 backup secrets = every NEW_SECRET
 assert.equal(t.rows.filter(r=>r.change==='NEW_SECRET').length,12+3+1+3);
 assert.throws(()=>b.buildBindingTable('neondb','neondb'),{message:'CUTOVER_BINDINGS_TARGET_REFUSED'});
 assert.throws(()=>b.buildBindingTable('neondb','zr_aaaaaaaaaaaa'),{message:'CUTOVER_BINDINGS_TARGET_REFUSED'});
 assert.equal(t.sha256,b.buildBindingTable('neondb','neondb_v65').sha256);
});
test('verify: consistent facts produce no findings in both stages',()=>{
 const t=b.buildBindingTable();
 assert.deepEqual(b.verifyBindings(t,factsFor(t,'PRE_SWITCH')),[]);
 const post=factsFor(t,'POST_SWITCH');
 assert.deepEqual(b.verifyBindings(t,post),[]);
});
test('verify: missing, wrong type/target, wrong project, stale credential, override, foreign keys',()=>{
 const t=b.buildBindingTable();const f=factsFor(t);
 f.vercel.main=f.vercel.main.filter(e=>e.key!=='PRODUCTION_DB_PASSWORD_AUTH');
 f.vercel.main.find(e=>e.key==='PRODUCTION_DB_NAME')!.type='sensitive';
 f.vercel.main.find(e=>e.key==='PRODUCTION_DB_PASSWORD_GUEST')!.updatedAt=EPOCH-5;
 f.vercel.main.find(e=>e.key==='PRODUCTION_DB_ROLE_HOLD')!.target='production,preview';
 f.vercel.main.push({key:'PRODUCTION_DB_ROLE_GROUP',type:'encrypted',target:'production'},{key:'PRODUCTION_RECEIVER_DATABASE_URL',type:'sensitive',target:'production'},{key:'PRODUCTION_DB_PASSWORD_LEGACY',type:'sensitive',target:'production'});
 f.vercel.webhook.push({key:'PRODUCTION_DB_PASSWORD_AUTH',type:'sensitive',target:'production'});
 f.github.secrets=f.github.secrets.filter(s=>s.name!=='PRODUCTION_BACKUP_PGUSER');
 const codes=new Set(b.verifyBindings(t,f).map(x=>x.code+':'+x.id));
 for(const c of ['MISSING:main.secret.auth','WRONG_TYPE:main.db.name','STALE_CREDENTIAL:main.secret.guest','WRONG_TARGET:main.role.hold','OVERRIDE_PRESENT:main.role.group','FOREIGN_KEY_IN_MAIN:main','UNKNOWN_DB_KEY:main','FOREIGN_KEY_IN_WEBHOOK:webhook','MISSING:backup.pguser','WRONG_PROJECT:main.secret.auth'])assert.ok(codes.has(c),c);
});
test('verify: role posture — excess privilege, membership drift, wrong login state, old role still login',()=>{
 const t=b.buildBindingTable();const f=factsFor(t,'POST_SWITCH');
 f.roles['neondb_v65_auth']!.createrole=true;
 f.roles['neondb_v65_backup']!.memberships=['pg_read_all_data','pg_write_all_data'];
 f.roles['neondb_v65_guest']!.login=false;
 delete f.roles['neondb_v65_pay_truth'];
 f.oldRoles={neondb_auth:{exists:true,login:true,superuser:false,createdb:false,createrole:false,memberships:[]}};
 const c=new Set(b.verifyBindings(t,f).map(x=>x.code+':'+x.id));
 for(const x of ['ROLE_EXCESS_PRIVILEGE:neondb_v65_auth','ROLE_MEMBERSHIP_DRIFT:neondb_v65_backup','ROLE_LOGIN_STATE:neondb_v65_guest','ROLE_MISSING:neondb_v65_pay_truth','OLD_ROLE_STILL_LOGIN:neondb_auth'])assert.ok(c.has(x),x);
 const pre=factsFor(t,'PRE_SWITCH');pre.roles['neondb_v65_ledger']!.login=true;
 assert.ok(b.verifyBindings(t,pre).some(x=>x.code==='ROLE_LOGIN_STATE'&&x.id==='neondb_v65_ledger'));
});
test('collect keeps only key/type/target/updatedAt and refuses other projects',async()=>{
 const doc={envs:[{key:'A',type:'sensitive',target:['production'],value:'SECRET-VALUE',updatedAt:5,id:'x'}]};
 const rows=await b.collectVercelMetadata(b.MAIN_PROJECT,async()=>'noise '+JSON.stringify(doc));
 assert.deepEqual(rows,[{key:'A',type:'sensitive',target:'production',updatedAt:5}]);
 assert.ok(!JSON.stringify(rows).includes('SECRET-VALUE'));
 await assert.rejects(()=>b.collectVercelMetadata('prj_other',async()=>'{}'),{message:'CUTOVER_BINDINGS_PROJECT_REFUSED'});
});
// ---- connection pre-check with synthetic ports. The pinned host fingerprint cannot be matched by a synthetic host, so the accept path uses a fingerprint-injecting wrapper.
test('connection pre-check refuses a synthetic host (pinned fingerprint) with a fixed reason and never echoes the URI',async()=>{
 const T=BACKUP_CREDENTIAL_TARGET;
 const ports:b.ConnectionPorts={neon:{get:async(path:string)=>path.endsWith('/endpoints')?{endpoints:[{type:'read_write',branch_id:T.branch,host:'ep-synthetic-0001.us-east-2.aws.neon.tech'}]}:{uri:['postgresql:/','/neondb_owner:','p@ssw0rd-very-long-secret','@'].join('')+'ep-synthetic-0001.us-east-2.aws.neon.tech/neondb_v65'}} as never,
  connect:async()=>{throw new Error('must not connect');}};
 const r=await b.verifyNewDatabaseConnection('neondb_v65',ports);
 assert.equal(r.ok,false);assert.deepEqual(r.reasons,['HOST_FINGERPRINT_MISMATCH']);
 assert.ok(!JSON.stringify(r).includes('ssw0rd'));
 await assert.rejects(()=>b.verifyNewDatabaseConnection('neondb',ports),{message:'CUTOVER_BINDINGS_TARGET_REFUSED'});
});
test('connection pre-check reason codes for lookup failures',async()=>{
 const T=BACKUP_CREDENTIAL_TARGET;
 const mk=(get:(p:string)=>Promise<unknown>):b.ConnectionPorts=>({neon:{get:get as never},connect:async()=>{throw new Error('x');}});
 assert.deepEqual((await b.verifyNewDatabaseConnection('neondb_v65',mk(async()=>{throw new Error('x');}))).reasons,['ENDPOINT_LOOKUP_FAILED']);
 assert.deepEqual((await b.verifyNewDatabaseConnection('neondb_v65',mk(async()=>({endpoints:[]})))).reasons,['ENDPOINT_AMBIGUOUS']);
 void T;
});
// ---- database-name allowlist at the two identity gates
test('identity gates accept exactly the three allowlisted database names',()=>{
 for(const n of ['neondb','neondb_v65','neondb_v65b'])assert.equal(isExpectedProductionDatabaseName(n),true);
 for(const n of ['neondb_v66','neondb_v65c','NEONDB','zr_aaaaaaaaaaaa',''])assert.equal(isExpectedProductionDatabaseName(n),false);
 const facts=(databaseName:string)=>({hostFingerprintSha256:EXPECTED_PRODUCTION_HOST_FINGERPRINT_SHA256,databaseName,vercelProjectFingerprintSha256:EXPECTED_PRODUCTION_VERCEL_PROJECT_FINGERPRINT_SHA256});
 assert.doesNotThrow(()=>assertProductionIdentityFacts(facts('neondb_v65')));
 assert.throws(()=>assertProductionIdentityFacts(facts('neondb_v66')),{message:'PRODUCTION_IDENTITY_WRONG_DATABASE_NAME'});
});
test('webhook receiver URL parses for the new database only with the matching receiver role',()=>{
 const sha=(v:string)=>createHash('sha256').update(v).digest('hex');
 void sha;
 const env=(url:string)=>({PRODUCTION_WEBHOOK_INGRESS_CLASSIFICATION:'PRODUCTION_WEBHOOK_INGRESS_ONLY',VERCEL_ENV:'production',VERCEL_PROJECT_PRODUCTION_URL:'hook.example.com',
  PRODUCTION_SQUARE_WEBHOOK_SIGNATURE_KEY:'k'.repeat(32),PRODUCTION_SQUARE_MERCHANT_ID:'MERCHANT1',PRODUCTION_SQUARE_WEBHOOK_NOTIFICATION_URL:'https://hook.example.com/api/webhooks/square',PRODUCTION_RECEIVER_DATABASE_URL:url}) as never;
 const u=(db:string,user:string)=>['postgresql:/','/',user,':','p'.repeat(24),'@'].join('')+`ep-synthetic-0001.us-east-2.aws.neon.tech/${db}?sslmode=verify-full`;
 assert.ok(parseProductionIngress(env(u('neondb_v65','neondb_v65_pay_receipt'))));
 assert.ok(parseProductionIngress(env(u('neondb','neondb_pay_receipt'))));
 assert.equal(parseProductionIngress(env(u('neondb_v65','neondb_pay_receipt'))),null);
 assert.equal(parseProductionIngress(env(u('neondb_v66','neondb_v66_pay_receipt'))),null);
});
// ---- credential lifecycle follows the selected database
test('credential target selection moves database, role and manager together; allowlist only; restored after',()=>{
 const previous=selectProductionCredentialDatabase('neondb_v65');
 try{
  assert.equal(BACKUP_CREDENTIAL_TARGET.database,'neondb_v65');assert.equal(BACKUP_CREDENTIAL_TARGET.role,'neondb_v65_backup');assert.equal(BACKUP_CREDENTIAL_TARGET.manager,'neondb_v65_role_admin');
  assert.throws(()=>selectProductionCredentialDatabase('neondb_other'),{message:'BACKUP_CREDENTIAL_DATABASE_REFUSED'});
 }finally{selectProductionCredentialDatabase(previous);}
 assert.equal(BACKUP_CREDENTIAL_TARGET.database,'neondb');assert.equal(BACKUP_CREDENTIAL_TARGET.role,'neondb_backup');
});

test('PRE_SWITCH does not require the backup sinks to be fresh (they move inside the window); POST_SWITCH still does; Vercel sinks are required in both',()=>{
 const t=b.buildBindingTable('neondb','neondb_v65');
 const pre=factsFor(t,'PRE_SWITCH');
 pre.github.secrets=pre.github.secrets.map(s=>({...s,updatedAt:EPOCH-500}));
 assert.deepEqual(b.verifyBindings(t,pre),[]);
 const post=factsFor(t,'POST_SWITCH');
 post.github.secrets=post.github.secrets.map(s=>({...s,updatedAt:EPOCH-500}));
 const stale=b.verifyBindings(t,post).filter(x=>x.code==='STALE_CREDENTIAL').map(x=>x.id).sort();
 assert.deepEqual(stale,['backup.pgdatabase','backup.pgpassword','backup.pguser']);
 const preVercel=factsFor(t,'PRE_SWITCH');
 preVercel.vercel.main=preVercel.vercel.main.map(e=>e.key==='PRODUCTION_DB_PASSWORD_AUTH'?{...e,updatedAt:EPOCH-500}:e);
 assert.ok(b.verifyBindings(t,preVercel).some(x=>x.code==='STALE_CREDENTIAL'&&x.id==='main.secret.auth'));
});
test('role facts: the membership aggregate is cast to text[] (pg returns name[] as an unparsed string, which broke memberships.filter)',async()=>{
 const {readFileSync}=await import('node:fs');
 const src=readFileSync(new URL('../../scripts/production-cutover-bindings-check.ts',import.meta.url),'utf8');
 assert.match(src,/array_agg\(g\.rolname::text order by g\.rolname\)/);
 assert.match(src,/'\{\}'::text\[\]\) as memberships/);
 // The consumer assumes a real array: an unparsed "{a,b}" string must not be accepted as one.
 const t=b.buildBindingTable('neondb','neondb_v65');
 const f=factsFor(t,'PRE_SWITCH');
 (f.roles[t.roles[0]!.role] as unknown as {memberships:unknown}).memberships='{a,b}';
 assert.throws(()=>b.verifyBindings(t,f),TypeError);
});
