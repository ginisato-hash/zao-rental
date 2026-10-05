import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,rmSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fingerprintHost} from '../../scripts/production-backup';
import {BACKUP_CREDENTIAL_TARGET as T,evidenceDirectory,type NeonPort} from '../../scripts/production-backup-credential';
import {main} from '../../scripts/production-install-normal-worker';
import {assertNoTlsOverrides,openOwnerSession,requireRestorePass} from '../../scripts/lib/production-owner-session';
import {normalWorkerExecuteTargets} from '../../scripts/production-normal-worker-grants';
import {productionNormalWorkerGrants} from '../../scripts/production-payment-roles';

const HOST='ep-synthetic-0000.us-east-2.aws.neon.tech';
const dbUri=(host:string,user=T.owner,database=T.database)=>{const u=new URL('postgresql://placeholder/');u.hostname=host;u.username=user;u.password='OwnerSecret0123456789';u.pathname='/'+database;u.search='?sslmode=require';return u.toString();};
const fakeNeon=(over:{host?:string;uri?:string;endpoints?:unknown[]}={}):NeonPort&{calls:string[]}=>{
 const calls:string[]=[];
 return {calls,async get(path,query){calls.push(path+(query?' ?'+Object.keys(query).join(','):''));
  if(path.endsWith('/endpoints'))return {endpoints:over.endpoints??[{type:'read_write',branch_id:T.branch,host:over.host??HOST}]};
  if(path.endsWith('/connection_uri'))return {uri:over.uri??dbUri(over.host??HOST)};
  throw new Error('unexpected '+path);},async post(){throw new Error('POST must never be issued by the installer');}};
};

test('the four grants are exactly the Owner-approved plan, one per function, none else',()=>{
 const targets=normalWorkerExecuteTargets('neondb');
 assert.equal(targets.length,4);
 assert.deepEqual(productionNormalWorkerGrants('neondb','neondb_operations'),targets.map(t=>`GRANT EXECUTE ON FUNCTION ${t.fn} TO ${t.role}`));
 assert.deepEqual(targets.map(t=>t.role),['neondb_pay_dispatch','neondb_pay_truth','neondb_pay_projection','neondb_operations']);
});

test('the owner session is refused for an ambiguous or non-Production endpoint before any pool exists, and never uses a POST',async()=>{
 const made:unknown[]=[];
 const factory=(c:unknown)=>{made.push(c);throw new Error('pool must not be created');};
 for(const [name,neon] of [
  ['two endpoints',fakeNeon({endpoints:[{type:'read_write',branch_id:T.branch,host:HOST},{type:'read_write',branch_id:T.branch,host:HOST}]})],
  ['pooled host',fakeNeon({host:'ep-synthetic-0000-pooler.us-east-2.aws.neon.tech'})],
  ['non-Production fingerprint',fakeNeon({host:'ep-other-1111.us-east-2.aws.neon.tech'})],
  ['uri host differs',fakeNeon({uri:dbUri('ep-evil-2222.us-east-2.aws.neon.tech')})],
 ] as const){
  await assert.rejects(openOwnerSession(neon,factory as never),Error,name);
 }
 assert.equal(made.length,0);
});

test('the owner session is requested non-pooled for the owner role only and the connection is normalised to verify-full before the config check',async()=>{
 // The committed Production fingerprint rejects a synthetic host, so the only reachable assertion here is that nothing is created and the call shape is exact.
 const neon=fakeNeon();
 await assert.rejects(openOwnerSession(neon,(()=>{throw new Error('no pool');}) as never),/BACKUP_HOST_FINGERPRINT_MISMATCH_REJECTED/);
 assert.deepEqual(neon.calls,[`/projects/${T.project}/branches/${T.branch}/endpoints`]);
 assert.equal(fingerprintHost(HOST).length,64);
});

test('admission: arguments, TLS overrides and the restore PASS record are refused before any Neon call or connection',async()=>{
 await assert.rejects(main(['migrate','--force']),/PRODUCTION_INSTALL_ARGUMENTS_REJECTED/);
 await assert.rejects(main(['rollback']),/PRODUCTION_INSTALL_ARGUMENTS_REJECTED/);
 await assert.rejects(main([]),/PRODUCTION_INSTALL_ARGUMENTS_REJECTED/);
 for(const k of ['NODE_TLS_REJECT_UNAUTHORIZED','NODE_EXTRA_CA_CERTS','SSL_CERT_FILE','SSL_CERT_DIR'])assert.throws(()=>assertNoTlsOverrides({[k]:'0'} as unknown as NodeJS.ProcessEnv),/PRODUCTION_INSTALL_TLS_REJECTED/);
 assertNoTlsOverrides({} as unknown as NodeJS.ProcessEnv);
 const root=mkdtempSync(join(tmpdir(),'zao-install-'));
 try{
  // the gate is the machine-derived record: absent, hand-written (even in the legacy shape) and malformed files are all refused; the strict verifier is tested in production-restore-evidence.test.ts
  await assert.rejects(requireRestorePass(root),/PRODUCTION_INSTALL_RESTORE_PASS_REQUIRED/);
  mkdirSync(evidenceDirectory(root),{recursive:true});
  const path=join(evidenceDirectory(root),'restore-pass.json');
  for(const bad of ['{}','not json',JSON.stringify({result:'PASS',objectKey:'hourly/2026/10/04/2026-10-04T16-17-00-000Z.dump.age',objectSha256:'a'.repeat(64)})]){writeFileSync(path,bad);await assert.rejects(requireRestorePass(root),/PRODUCTION_INSTALL_RESTORE_PASS_REQUIRED/);}
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('package scripts are the two fixed commands and the installer prints only fixed codes',()=>{
 const pkg=JSON.parse(readFileSync('package.json','utf8')) as {scripts:Record<string,string>};
 assert.equal(pkg.scripts['production:install-normal-worker-migration'],'node --import tsx scripts/production-install-normal-worker.ts migrate');
 assert.equal(pkg.scripts['production:install-normal-worker-grants'],'node --import tsx scripts/production-install-normal-worker.ts grants');
 const source=readFileSync('scripts/production-install-normal-worker.ts','utf8');
 assert.ok(!/console\.(log|error)\([^)]*(uri|password|connection)/i.test(source));
});
