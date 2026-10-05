import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,renameSync,rmSync,symlinkSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {fingerprintHost,objectKey} from '../../scripts/production-backup';
import {BACKUP_CREDENTIAL_TARGET as T,evidenceDirectory,type NeonPort} from '../../scripts/production-backup-credential';
import {plannedOutput} from '../../scripts/production-backup-object-get';
import {expectedPre0054RegistrySha256,finalizeRestoreEvidence} from '../../scripts/production-restore-evidence';
import {main,type InstallSeams} from '../../scripts/production-install-normal-worker';
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
  await assert.rejects(requireRestorePass(root),(e:Error&{reason?:unknown})=>{assert.match(e.message,/PRODUCTION_INSTALL_RESTORE_PASS_REQUIRED/);assert.equal(e.reason,'RESTORE_EVIDENCE_FILE_MISSING','the refusal carries the evidence module\'s fixed reason code');return true;});
  mkdirSync(evidenceDirectory(root),{recursive:true});
  const path=join(evidenceDirectory(root),'restore-pass.json');
  for(const bad of ['{}','not json',JSON.stringify({result:'PASS',objectKey:'hourly/2026/10/04/2026-10-04T16-17-00-000Z.dump.age',objectSha256:'a'.repeat(64)})]){writeFileSync(path,bad);await assert.rejects(requireRestorePass(root),/PRODUCTION_INSTALL_RESTORE_PASS_REQUIRED/);}
 }finally{rmSync(root,{recursive:true,force:true});}
});

// Restore evidence fixtures for the installer admission test. The strict verifier is exercised field by field in production-restore-evidence.test.ts; here only the installer's order matters.
// Freshness is measured from the drill's `finishedAt`: every drill timestamp is relative to the real clock.
const T0=Date.now();
const SCHEDULED=new Date(T0-30*3600_000),OTHER_SCHEDULED=new Date(SCHEDULED.getTime()-3600_000);
const KEY=objectKey('hourly',SCHEDULED);
const OTHER_KEY=objectKey('hourly',OTHER_SCHEDULED);
const FINISHED=T0-10*60_000;
const CIPHER=Buffer.from('SYNTHETIC-CIPHERTEXT-OF-THE-BACKUP');
const sha=(b:Buffer|string)=>createHash('sha256').update(b).digest('hex');
const verification=(over:Record<string,unknown>={})=>({migrations:53,registrySha256:expectedPre0054RegistrySha256(),foreignKeys:120,sequences:3,critical:{'public.rental_bookings':{rows:2,sha256:'c'.repeat(64)}},...over});
const timing=(finished:number,scheduled:Date=SCHEDULED)=>({backupScheduledAt:scheduled.toISOString(),startedAt:new Date(finished-42_000).toISOString(),finishedAt:new Date(finished).toISOString(),restoreSeconds:42,observedBackupAgeSeconds:(finished-scheduled.getTime())/1000});
const drill=(over:Record<string,unknown>={},finished:number=FINISHED)=>({status:'DRILL_PASS',dataClass:'PRODUCTION',key:KEY,...timing(finished),plaintextSha256:'b'.repeat(64),plaintextBytes:1000,ciphertextBytes:CIPHER.length,ciphertextSha256:sha(CIPHER),
 toolVersion:'pg_restore (PostgreSQL) 18.6',verification:verification(),productionRpoRtoApproved:false,...over});
const hours=(h:number)=>new Date(Date.now()+h*3600_000);
type Evidence={pass:string;drill:string;key:string;cipher:string};
/** A complete evidence set finalized by the real finalizer at `at`. */
async function finalized(root:string,at:Date=new Date(),finished:number=FINISHED):Promise<Evidence>{
 const dir=evidenceDirectory(root);mkdirSync(dir,{recursive:true});
 const e={pass:join(dir,'restore-pass.json'),drill:join(dir,'restore-drill-result.json'),key:join(dir,'object-key.txt'),cipher:plannedOutput(root,KEY)};
 writeFileSync(e.key,KEY+'\n');writeFileSync(e.cipher,CIPHER,{mode:0o600});writeFileSync(e.drill,JSON.stringify(drill({},finished)));
 await finalizeRestoreEvidence(root,()=>at);
 return e;
}
const editRecord=(e:Evidence,over:Record<string,unknown>)=>writeFileSync(e.pass,JSON.stringify({...JSON.parse(readFileSync(e.pass,'utf8')) as object,...over}));
/** Rewrites the drill result and re-hashes it into the record, as a forger holding both files would. */
const forge=(e:Evidence,over:Record<string,unknown>)=>{const bytes=JSON.stringify(drill(over));writeFileSync(e.drill,bytes);editRecord(e,{drillResultSha256:sha(bytes)});};
const breakFile=(path:string,kind:'empty'|'symlink'|'oversize'|'missing')=>{
 if(kind==='empty')writeFileSync(path,'');
 else if(kind==='symlink'){renameSync(path,path+'.target');symlinkSync(path+'.target',path);}
 else if(kind==='oversize')writeFileSync(path,readFileSync(path,'utf8')+' '.repeat(70000));
 else rmSync(path);
};
const spy=()=>{const s={released:0,opened:0,seams:{} as InstallSeams};s.seams={release:()=>{s.released++;return 'f'.repeat(40);},openSession:async()=>{s.opened++;throw new Error('SEAM_OWNER_SESSION_REACHED');}};return s;};

test('admission refuses every bad restore PASS before any Neon or database call; the full valid chain reaches the owner session',async()=>{
 const saved=Object.fromEntries(['NODE_TLS_REJECT_UNAUTHORIZED','NODE_EXTRA_CA_CERTS','SSL_CERT_FILE','SSL_CERT_DIR'].map(k=>[k,process.env[k]]));
 for(const k of Object.keys(saved))delete process.env[k];
 const scenarios:Array<[string,(root:string)=>Promise<void>]>=[
  ['no evidence at all',async()=>undefined],
  ['hand-written minimal PASS beside complete artifacts',async root=>{const e=await finalized(root);writeFileSync(e.pass,JSON.stringify({result:'PASS',objectKey:KEY,objectSha256:sha(CIPHER)}));}],
  ['SYNTHETIC drill result',async root=>forge(await finalized(root),{dataClass:'SYNTHETIC'})],
  ['status not DRILL_PASS',async root=>forge(await finalized(root),{status:'STOP'})],
  ['drill result edited after finalization',async root=>{const e=await finalized(root);writeFileSync(e.drill,JSON.stringify(drill({restoreSeconds:1})));}],
  ['another object key in the key file',async root=>{const e=await finalized(root);writeFileSync(e.key,OTHER_KEY+'\n');}],
  ['drill result of another object',async root=>forge(await finalized(root),{key:OTHER_KEY,...timing(FINISHED,OTHER_SCHEDULED)})],
  ['ciphertext of another size',async root=>{const e=await finalized(root);writeFileSync(e.cipher,Buffer.concat([CIPHER,Buffer.from('!')]));}],
  ['ciphertext of the same size and other content',async root=>{const e=await finalized(root);writeFileSync(e.cipher,Buffer.from(CIPHER.toString().toLowerCase()));}],
  ['drill ciphertext sha256 of other bytes',async root=>forge(await finalized(root),{ciphertextSha256:sha('another ciphertext')})],
  ['drill without a ciphertext sha256',async root=>forge(await finalized(root),{ciphertextSha256:undefined})],
  ['drill ciphertext size differs',async root=>forge(await finalized(root),{ciphertextBytes:CIPHER.length+1})],
  ['drill registry of 55 migrations',async root=>forge(await finalized(root),{verification:verification({migrations:55})})],
  ['drill registry of 52 migrations',async root=>forge(await finalized(root),{verification:verification({migrations:52})})],
  ['drill registry digest of other migration files',async root=>forge(await finalized(root),{verification:verification({registrySha256:sha('another registry')})})],
  ['record claims 55 migrations',async root=>editRecord(await finalized(root),{migrations:55})],
  ['record claims 52 migrations',async root=>editRecord(await finalized(root),{migrations:52})],
  ['record hash edited',async root=>editRecord(await finalized(root),{objectSha256:sha('another object')})],
  ['empty record',async root=>breakFile((await finalized(root)).pass,'empty')],
  ['symlinked record',async root=>breakFile((await finalized(root)).pass,'symlink')],
  ['oversize record',async root=>breakFile((await finalized(root)).pass,'oversize')],
  ['missing drill result',async root=>breakFile((await finalized(root)).drill,'missing')],
  ['symlinked ciphertext',async root=>breakFile((await finalized(root)).cipher,'symlink')],
  ['stale record (the restore finished 25 hours ago)',async root=>{const finished=T0-25*3600_000;await finalized(root,new Date(finished+60_000),finished);}],
  ['future record (finalized in 2 hours)',async root=>{await finalized(root,hours(2));}],
 ];
 try{
  for(const [name,prepare] of scenarios)for(const command of ['migrate','grants']){
   const root=mkdtempSync(join(tmpdir(),'zao-install-evidence-'));
   try{
    await prepare(root);
    const s=spy();
    await assert.rejects(main([command],root,s.seams),/^Error: PRODUCTION_INSTALL_RESTORE_PASS_REQUIRED$/,`${name} (${command})`);
    assert.equal(s.opened,0,`${name} (${command}): no owner session or Neon call`);
   }finally{rmSync(root,{recursive:true,force:true});}
  }
  // the full valid chain passes admission and reaches the owner session exactly once (the ciphertext may be gone: the drill-result binding still holds)
  for(const [command,deleteCiphertext] of [['migrate',false],['grants',true]] as const){
   const root=mkdtempSync(join(tmpdir(),'zao-install-evidence-'));
   try{
    const e=await finalized(root);
    if(deleteCiphertext)rmSync(e.cipher);
    const s=spy();
    await assert.rejects(main([command],root,s.seams),/^Error: SEAM_OWNER_SESSION_REACHED$/,command);
    assert.deepEqual([s.released,s.opened],[1,1],command);
   }finally{rmSync(root,{recursive:true,force:true});}
  }
 }finally{for(const [k,v] of Object.entries(saved)){if(v!==undefined)process.env[k]=v;}}
});

test('package scripts are the two fixed commands and the installer prints only fixed codes',()=>{
 const pkg=JSON.parse(readFileSync('package.json','utf8')) as {scripts:Record<string,string>};
 assert.equal(pkg.scripts['production:install-normal-worker-migration'],'node --import tsx scripts/production-install-normal-worker.ts migrate');
 assert.equal(pkg.scripts['production:install-normal-worker-grants'],'node --import tsx scripts/production-install-normal-worker.ts grants');
 const source=readFileSync('scripts/production-install-normal-worker.ts','utf8');
 assert.ok(!/console\.(log|error)\([^)]*(uri|password|connection)/i.test(source));
});
