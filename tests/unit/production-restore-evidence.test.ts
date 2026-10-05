import test from 'node:test';
import assert from 'node:assert/strict';
import {chmodSync,mkdirSync,mkdtempSync,readFileSync,renameSync,rmSync,statSync,symlinkSync,unlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {migrationPlan,migrationsDirectory} from '../../packages/db/src/index';
import {objectKey} from '../../scripts/production-backup';
import {assertRestorePass,evidenceDirectory} from '../../scripts/production-backup-credential';
import {plannedOutput} from '../../scripts/production-backup-object-get';
import {PRE_0054_MIGRATIONS,RESTORE_PASS_MAX_AGE_HOURS,RESTORE_PASS_VERSION,expectedPre0054RegistrySha256,finalizeRestoreEvidence,main,registryDigest,validateDrillResult,verifyRestorePassRecord} from '../../scripts/production-restore-evidence';
import {requireRestorePass} from '../../scripts/lib/production-owner-session';

const KEY=objectKey('hourly',new Date('2026-10-04T16:17:00.000Z'));
const OTHER_KEY=objectKey('hourly',new Date('2026-10-04T15:17:00.000Z'));
const CIPHER=Buffer.from('CIPHERTEXT-OF-THE-PRODUCTION-BACKUP');
const sha=(b:Buffer|string)=>createHash('sha256').update(b).digest('hex');
// Real current time: the installer gate (`requireRestorePass`) reads the real clock, so a record finalized at NOW must be fresh for it and a stale one must be refused for staleness alone.
const NOW=new Date();
// Independent of the module under test: sha256 over `id:checksum` of the first 53 migration files of this checkout.
const REGISTRY=sha(migrationPlan.slice(0,PRE_0054_MIGRATIONS).map(e=>e.id+':'+sha(readFileSync(join(migrationsDirectory,e.file),'utf8'))).join('\n'));
const verification=(over:Record<string,unknown>={})=>({migrations:53,registrySha256:REGISTRY,foreignKeys:120,sequences:3,critical:{'public.rental_bookings':{rows:2,sha256:'c'.repeat(64)},'public.price_quotes':{rows:5,sha256:'d'.repeat(64)}},...over});
const drillOk=(over:Record<string,unknown>={})=>({status:'DRILL_PASS',dataClass:'PRODUCTION',key:KEY,backupScheduledAt:'2026-10-04T16:17:00.000Z',plaintextSha256:'b'.repeat(64),plaintextBytes:1000,ciphertextBytes:CIPHER.length,ciphertextSha256:sha(CIPHER),
 toolVersion:'pg_restore (PostgreSQL) 18.6',startedAt:'2026-10-04T16:50:00.000Z',finishedAt:'2026-10-04T16:50:42.000Z',restoreSeconds:42,observedBackupAgeSeconds:2000,
 verification:verification(),productionRpoRtoApproved:false,...over});
function setup(root:string,drill:unknown=drillOk(),withCipher=true,key=KEY){
 const dir=evidenceDirectory(root);mkdirSync(dir,{recursive:true});
 writeFileSync(join(dir,'object-key.txt'),key+'\n');
 if(withCipher)writeFileSync(plannedOutput(root,key),CIPHER,{mode:0o600});
 writeFileSync(join(dir,'restore-drill-result.json'),JSON.stringify(drill));
 return dir;
}
const paths=(root:string)=>{const dir=evidenceDirectory(root);return {dir,key:join(dir,'object-key.txt'),drill:join(dir,'restore-drill-result.json'),cipher:plannedOutput(root,KEY),pass:join(dir,'restore-pass.json')};};
const fresh=(root:string,drill:unknown=drillOk())=>{rmSync(evidenceDirectory(root),{recursive:true,force:true});return setup(root,drill);};
const withRoot=async(fn:(root:string)=>Promise<void>)=>{const root=mkdtempSync(join(tmpdir(),'zao-restore-evidence-'));try{await fn(root);}finally{rmSync(root,{recursive:true,force:true});}};
const code=(re:RegExp)=>(e:Error)=>{assert.match(e.message,re);return true;};
/** The ways an evidence file can be unusable: absent, empty, a symlink to a file with the right content, or larger than the reader accepts. */
const breakFile=(kind:'missing'|'empty'|'symlink'|'oversize',path:string,limit?:number)=>{
 if(kind==='missing')unlinkSync(path);
 else if(kind==='empty')writeFileSync(path,'');
 else if(kind==='symlink'){renameSync(path,path+'.target');symlinkSync(path+'.target',path);}
 else writeFileSync(path,readFileSync(path,'utf8')+' '.repeat((limit as number)+1));
};

test('a real Production drill result for the downloaded object produces the versioned record: exclusive, 0600, bound to the drill result and the ciphertext',()=>withRoot(async root=>{
 const dir=setup(root);
 const record=await finalizeRestoreEvidence(root,()=>NOW);
 assert.deepEqual([record.version,record.result,record.objectKey,record.migrations],[RESTORE_PASS_VERSION,'PASS',KEY,PRE_0054_MIGRATIONS]);
 assert.equal(record.objectSha256,sha(CIPHER));assert.equal(record.ciphertextBytes,CIPHER.length);assert.equal(record.plaintextSha256,'b'.repeat(64));
 assert.equal(record.objectSha256,drillOk().ciphertextSha256,'the record hash is the hash the drill recorded for the bytes it decrypted');
 assert.equal(record.drillResultSha256,sha(readFileSync(join(dir,'restore-drill-result.json'))));
 assert.equal(statSync(join(dir,'restore-pass.json')).mode&0o777,0o600);
 assert.deepEqual(await verifyRestorePassRecord(root,()=>NOW),record);
 assert.equal((await requireRestorePass(root)).result,'PASS');
 // the backup helper's finalize gate shape check accepts the same record (its pinned code is unchanged)
 assert.doesNotThrow(()=>assertRestorePass(JSON.parse(readFileSync(join(dir,'restore-pass.json'),'utf8'))));
 // a second finalize is refused (exclusive create) and leaves the first record untouched
 const first=readFileSync(join(dir,'restore-pass.json'),'utf8');
 await assert.rejects(finalizeRestoreEvidence(root,()=>new Date(NOW.getTime()+1000)),code(/RESTORE_EVIDENCE_ALREADY_FINALIZED/));
 assert.equal(readFileSync(join(dir,'restore-pass.json'),'utf8'),first);
 // positive: the ciphertext may be deleted after finalization; the drill-result binding (size, sha256, key, registry) still verifies
 unlinkSync(plannedOutput(root,KEY));
 assert.deepEqual(await verifyRestorePassRecord(root,()=>NOW),record);
 assert.equal((await requireRestorePass(root)).objectSha256,sha(CIPHER));
}));

test('the registry digest is the one over id:checksum of this checkout\'s first 53 migration files',()=>{
 assert.equal(expectedPre0054RegistrySha256(),REGISTRY);
 const rows=migrationPlan.map(e=>({id:e.id,checksum:sha(readFileSync(join(migrationsDirectory,e.file),'utf8'))}));
 assert.equal(registryDigest(rows.slice(0,PRE_0054_MIGRATIONS)),REGISTRY);
 for(const other of [rows.slice(0,52),rows.slice(0,54),rows,rows.slice(0,53).map((r,i)=>i===10?{...r,checksum:sha('x')}:r),rows.slice(0,53).map((r,i)=>i===10?{...r,id:'9999'}:r)])assert.notEqual(registryDigest(other),REGISTRY);
});

test('SYNTHETIC, a wrong registry (52/54/55 or other migration files), a wrong key, a wrong ciphertext size or sha256, a missing hash, a mismatched schedule, a 0054 table, an approved RPO/RTO and a wrong tool are all refused',()=>withRoot(async root=>{
 const bad:Array<[string,Record<string,unknown>,RegExp]>=[
  ['synthetic',{dataClass:'SYNTHETIC'},/NOT_PRODUCTION_DRILL_PASS/],['no data class',{dataClass:undefined},/NOT_PRODUCTION_DRILL_PASS/],['not pass',{status:'STOP'},/NOT_PRODUCTION_DRILL_PASS/],
  ['52 migrations',{verification:verification({migrations:52})},/MIGRATIONS_MISMATCH/],['54 migrations',{verification:verification({migrations:54})},/MIGRATIONS_MISMATCH/],
  ['55 migrations',{verification:verification({migrations:55})},/MIGRATIONS_MISMATCH/],
  ['no registry digest',{verification:verification({registrySha256:undefined})},/SHAPE_INVALID/],['malformed registry digest',{verification:verification({registrySha256:'nope'})},/SHAPE_INVALID/],
  ['registry digest of other migration files',{verification:verification({registrySha256:sha('another registry')})},/MIGRATIONS_MISMATCH/],
  ['wrong key',{key:OTHER_KEY,backupScheduledAt:'2026-10-04T15:17:00.000Z'},/KEY_MISMATCH/],['schedule not the key time',{backupScheduledAt:'2026-10-04T16:18:00.000Z'},/KEY_MISMATCH/],
  ['wrong ciphertext size',{ciphertextBytes:CIPHER.length+1},/CIPHERTEXT_MISMATCH/],['wrong ciphertext sha256',{ciphertextSha256:sha('other ciphertext')},/CIPHERTEXT_MISMATCH/],
  ['no ciphertext sha256 (a result from before the hash was recorded)',{ciphertextSha256:undefined},/SHAPE_INVALID/],['malformed ciphertext sha256',{ciphertextSha256:'xyz'},/SHAPE_INVALID/],['uppercase ciphertext sha256',{ciphertextSha256:sha(CIPHER).toUpperCase()},/SHAPE_INVALID/],
  ['0054 table present',{verification:verification({critical:{'public.provisional_capacity_receipts':{rows:0,sha256:'e'.repeat(64)}}})},/SHAPE_INVALID/],
  ['no critical rows',{verification:verification({critical:{}})},/SHAPE_INVALID/],['no foreign keys',{verification:verification({foreignKeys:0})},/SHAPE_INVALID/],
  ['rpo approved',{productionRpoRtoApproved:true},/SHAPE_INVALID/],['old pg_restore',{toolVersion:'pg_restore (PostgreSQL) 16.2'},/SHAPE_INVALID/],['bad plaintext hash',{plaintextSha256:'xyz'},/SHAPE_INVALID/],
 ];
 for(const [name,over,re] of bad){
  rmSync(evidenceDirectory(root),{recursive:true,force:true});setup(root,drillOk(over));
  await assert.rejects(finalizeRestoreEvidence(root,()=>NOW),code(re),name);
  assert.throws(()=>statSync(join(evidenceDirectory(root),'restore-pass.json')),Error,name+': nothing is written');
 }
 const expect={key:KEY,ciphertextBytes:CIPHER.length,ciphertextSha256:sha(CIPHER)};
 for(const raw of [null,[],'x',{}])assert.throws(()=>validateDrillResult(raw,expect),/RESTORE_EVIDENCE_/);
 assert.equal(validateDrillResult(drillOk(),expect).plaintextSha256,'b'.repeat(64));
}));

test('the downloaded file must be the very bytes the drill decrypted: other content of the same size, another size or another object are refused and nothing is written',()=>withRoot(async root=>{
 const p=paths(root);setup(root);
 writeFileSync(p.cipher,Buffer.from('CIPHERTEXT-OF-THE-PRODUCTION-BACKUp'),{mode:0o600});
 assert.equal(readFileSync(p.cipher).length,CIPHER.length);
 await assert.rejects(finalizeRestoreEvidence(root,()=>NOW),code(/RESTORE_EVIDENCE_CIPHERTEXT_MISMATCH/));
 writeFileSync(p.cipher,Buffer.concat([CIPHER,Buffer.from('!')]),{mode:0o600});
 await assert.rejects(finalizeRestoreEvidence(root,()=>NOW),code(/RESTORE_EVIDENCE_CIPHERTEXT_MISMATCH/));
 // another object: the key file names an object whose download is absent
 writeFileSync(p.key,OTHER_KEY+'\n');
 await assert.rejects(finalizeRestoreEvidence(root,()=>NOW),code(/RESTORE_EVIDENCE_FILE_MISSING/));
 writeFileSync(plannedOutput(root,OTHER_KEY),CIPHER,{mode:0o600});
 await assert.rejects(finalizeRestoreEvidence(root,()=>NOW),code(/RESTORE_EVIDENCE_KEY_MISMATCH/));
 assert.throws(()=>statSync(p.pass),Error);
}));

test('finalizing needs every input: key file, downloaded ciphertext and the drill result; none can be absent, empty, a symlink, oversize or malformed',()=>withRoot(async root=>{
 setup(root,drillOk(),false);
 await assert.rejects(finalizeRestoreEvidence(root,()=>NOW),code(/RESTORE_EVIDENCE_FILE_MISSING/));
 const dir=setup(root);unlinkSync(join(dir,'restore-drill-result.json'));
 await assert.rejects(finalizeRestoreEvidence(root,()=>NOW),code(/RESTORE_EVIDENCE_FILE_MISSING/));
 writeFileSync(join(dir,'restore-drill-result.json'),'not json');
 await assert.rejects(finalizeRestoreEvidence(root,()=>NOW),code(/RESTORE_EVIDENCE_SHAPE_INVALID/));
 writeFileSync(join(dir,'restore-drill-result.json'),JSON.stringify(drillOk()));writeFileSync(join(dir,'object-key.txt'),'../x\n');
 await assert.rejects(finalizeRestoreEvidence(root,()=>NOW),code(/BACKUP_OBJECT_GET_KEY_INVALID/));
 writeFileSync(join(dir,'object-key.txt'),KEY+'\n');writeFileSync(plannedOutput(root,KEY),'');
 await assert.rejects(finalizeRestoreEvidence(root,()=>NOW),code(/RESTORE_EVIDENCE_FILE_INVALID/));
 const cases:Array<['key'|'drill'|'cipher','missing'|'empty'|'symlink'|'oversize',number|undefined,RegExp]>=[
  ['key','missing',undefined,/FILE_MISSING/],['key','empty',undefined,/FILE_INVALID/],['key','symlink',undefined,/FILE_INVALID/],['key','oversize',512,/FILE_INVALID/],
  ['drill','missing',undefined,/FILE_MISSING/],['drill','empty',undefined,/FILE_INVALID/],['drill','symlink',undefined,/FILE_INVALID/],['drill','oversize',65536,/FILE_INVALID/],
  ['cipher','missing',undefined,/FILE_MISSING/],['cipher','empty',undefined,/FILE_INVALID/],['cipher','symlink',undefined,/FILE_INVALID/],
 ];
 for(const [file,kind,limit,re] of cases){
  fresh(root);breakFile(kind,paths(root)[file],limit);
  await assert.rejects(finalizeRestoreEvidence(root,()=>NOW),code(re),`${file} ${kind}`);
  assert.throws(()=>statSync(paths(root).pass),Error,`${file} ${kind}: nothing is written`);
 }
}));

test('the gate refuses hand-written or tampered records: old shape, wrong version, extra keys, every edited field, edited drill result, replaced ciphertext, another key, stale or future time',()=>withRoot(async root=>{
 const dir=setup(root);
 const record=await finalizeRestoreEvidence(root,()=>NOW);
 const write=(r:unknown)=>{try{unlinkSync(join(dir,'restore-pass.json'));}catch{/* absent */}writeFileSync(join(dir,'restore-pass.json'),typeof r==='string'?r:JSON.stringify(r),{mode:0o600});};
 // hand-written files: the legacy shape-only PASS, a minimal PASS with every claimed field but no binding, and empty objects
 for(const handWritten of [{result:'PASS',objectKey:KEY,objectSha256:sha(CIPHER)},{result:'PASS'},{},[],'null','PASS']){
  write(handWritten);
  await assert.rejects(verifyRestorePassRecord(root,()=>NOW),code(/RESTORE_EVIDENCE_SHAPE_INVALID/),JSON.stringify(handWritten));
  await assert.rejects(requireRestorePass(root),code(/PRODUCTION_INSTALL_RESTORE_PASS_REQUIRED/));
 }
 for(const [name,mut] of [['version',{version:'production-restore-pass/0'}],['migrations 55',{migrations:55}],['migrations 52',{migrations:52}],['extra key',{extra:1}],['result',{result:'FAIL'}],['hash shape',{objectSha256:'nope'}],['finalizedAt shape',{finalizedAt:'yesterday'}]] as Array<[string,Record<string,unknown>]>){
  write({...record,...mut});await assert.rejects(verifyRestorePassRecord(root,()=>NOW),code(/RESTORE_EVIDENCE_/),name);
 }
 // every bound field of the record edited to another well-formed value is refused, also through the installer gate
 const edited:Record<string,unknown>={objectKey:OTHER_KEY,objectSha256:sha('another object'),ciphertextBytes:record.ciphertextBytes+1,plaintextSha256:sha('another plaintext'),drillResultSha256:sha('another drill result'),
  backupScheduledAt:'2026-10-04T16:18:00.000Z',restoreSeconds:record.restoreSeconds+1,observedBackupAgeSeconds:record.observedBackupAgeSeconds+1};
 for(const [field,value] of Object.entries(edited)){
  write({...record,[field]:value});
  await assert.rejects(verifyRestorePassRecord(root,()=>NOW),code(/RESTORE_EVIDENCE_(BINDING|CIPHERTEXT|KEY)_MISMATCH/),field);
  await assert.rejects(requireRestorePass(root),code(/PRODUCTION_INSTALL_RESTORE_PASS_REQUIRED/),field);
 }
 // a self-consistent forgery still fails because the drill result hash and the drill content are re-verified
 write({...record,drillResultSha256:'f'.repeat(64)});await assert.rejects(verifyRestorePassRecord(root,()=>NOW),code(/RESTORE_EVIDENCE_BINDING_MISMATCH/));
 write(record);
 assert.deepEqual(await verifyRestorePassRecord(root,()=>NOW),record);
 // the drill result edited after finalization (even to another valid result, or by whitespace only) breaks the binding
 writeFileSync(join(dir,'restore-drill-result.json'),JSON.stringify(drillOk({restoreSeconds:1})));
 await assert.rejects(verifyRestorePassRecord(root,()=>NOW),code(/RESTORE_EVIDENCE_BINDING_MISMATCH/));
 writeFileSync(join(dir,'restore-drill-result.json'),JSON.stringify(drillOk(),null,1));
 await assert.rejects(verifyRestorePassRecord(root,()=>NOW),code(/RESTORE_EVIDENCE_BINDING_MISMATCH/));
 // re-hashing the edited drill result into the record does not launder a different ciphertext hash or another registry
 for(const [name,over,re] of [['ciphertext hash',{ciphertextSha256:sha('other ciphertext')},/CIPHERTEXT_MISMATCH/],['registry digest',{verification:verification({registrySha256:sha('other registry')})},/MIGRATIONS_MISMATCH/],['synthetic class',{dataClass:'SYNTHETIC'},/NOT_PRODUCTION_DRILL_PASS/],['status',{status:'STOP'},/NOT_PRODUCTION_DRILL_PASS/]] as Array<[string,Record<string,unknown>,RegExp]>){
  const bytes=JSON.stringify(drillOk(over));writeFileSync(join(dir,'restore-drill-result.json'),bytes);
  write({...record,drillResultSha256:sha(bytes)});
  await assert.rejects(verifyRestorePassRecord(root,()=>NOW),code(re),name);
 }
 write(record);writeFileSync(join(dir,'restore-drill-result.json'),JSON.stringify(drillOk()));
 assert.deepEqual(await verifyRestorePassRecord(root,()=>NOW),record);
 // the ciphertext replaced after finalization (same size or not) breaks it; once the ciphertext is removed the drill binding still holds
 writeFileSync(plannedOutput(root,KEY),Buffer.from('CIPHERTEXT-OF-THE-PRODUCTION-BACKUP'.replace('PRODUCTION','PRODUCTIOn')));
 await assert.rejects(verifyRestorePassRecord(root,()=>NOW),code(/RESTORE_EVIDENCE_BINDING_MISMATCH/));
 writeFileSync(plannedOutput(root,KEY),Buffer.concat([CIPHER,Buffer.from('!')]));
 await assert.rejects(verifyRestorePassRecord(root,()=>NOW),code(/RESTORE_EVIDENCE_BINDING_MISMATCH/));
 unlinkSync(plannedOutput(root,KEY));
 assert.deepEqual(await verifyRestorePassRecord(root,()=>NOW),record);
 // another object key in the key file
 const other=objectKey('daily',new Date('2026-10-05T00:17:00.000Z'));writeFileSync(join(dir,'object-key.txt'),other+'\n');
 await assert.rejects(verifyRestorePassRecord(root,()=>NOW),code(/RESTORE_EVIDENCE_BINDING_MISMATCH|RESTORE_EVIDENCE_KEY_MISMATCH/));
 writeFileSync(join(dir,'object-key.txt'),KEY+'\n');
 // freshness: valid up to 24 hours (and 60 seconds of clock skew), older than that or from the future is stale
 const hours=(h:number,extraMs=0)=>new Date(NOW.getTime()+h*3600_000+extraMs);
 assert.deepEqual(await verifyRestorePassRecord(root,()=>hours(RESTORE_PASS_MAX_AGE_HOURS)),record);
 assert.deepEqual(await verifyRestorePassRecord(root,()=>new Date(NOW.getTime()-60_000)),record);
 await assert.rejects(verifyRestorePassRecord(root,()=>hours(RESTORE_PASS_MAX_AGE_HOURS,1)),code(/RESTORE_EVIDENCE_STALE/));
 await assert.rejects(verifyRestorePassRecord(root,()=>hours(RESTORE_PASS_MAX_AGE_HOURS*3)),code(/RESTORE_EVIDENCE_STALE/));
 await assert.rejects(verifyRestorePassRecord(root,()=>new Date(NOW.getTime()-60_001)),code(/RESTORE_EVIDENCE_STALE/));
 await assert.rejects(verifyRestorePassRecord(root,()=>new Date(NOW.getTime()-3600_000)),code(/RESTORE_EVIDENCE_STALE/));
 // a record that claims to be finalized in the future or long ago is stale from the reader's clock, whatever else it holds
 for(const finalizedAt of [hours(2),hours(-25),hours(-24*365)]){
  write({...record,finalizedAt:finalizedAt.toISOString()});
  await assert.rejects(verifyRestorePassRecord(root,()=>NOW),code(/RESTORE_EVIDENCE_STALE/),finalizedAt.toISOString());
 }
 write(record);chmodSync(join(dir,'restore-pass.json'),0o600);
}));

test('the gate refuses an evidence file that is missing, empty, oversize or a symlink: the record, the drill result, the key file and a present ciphertext',()=>withRoot(async root=>{
 const cases:Array<['pass'|'drill'|'key'|'cipher','missing'|'empty'|'symlink'|'oversize',number|undefined,RegExp]>=[
  ['pass','missing',undefined,/FILE_MISSING/],['pass','empty',undefined,/FILE_INVALID/],['pass','symlink',undefined,/FILE_INVALID/],['pass','oversize',4096,/FILE_INVALID/],
  ['drill','missing',undefined,/FILE_MISSING/],['drill','empty',undefined,/FILE_INVALID/],['drill','symlink',undefined,/FILE_INVALID/],['drill','oversize',65536,/FILE_INVALID/],
  ['key','missing',undefined,/FILE_MISSING/],['key','empty',undefined,/FILE_INVALID/],['key','symlink',undefined,/FILE_INVALID/],['key','oversize',512,/FILE_INVALID/],
  ['cipher','empty',undefined,/FILE_INVALID/],['cipher','symlink',undefined,/FILE_INVALID/],
 ];
 for(const [file,kind,limit,re] of cases){
  fresh(root);await finalizeRestoreEvidence(root,()=>NOW);
  breakFile(kind,paths(root)[file],limit);
  await assert.rejects(verifyRestorePassRecord(root,()=>NOW),code(re),`${file} ${kind}`);
  await assert.rejects(requireRestorePass(root),code(/PRODUCTION_INSTALL_RESTORE_PASS_REQUIRED/),`${file} ${kind}`);
 }
}));

test('the evidence finalizer takes no arguments',async()=>{
 await assert.rejects(main(['--force']),code(/RESTORE_EVIDENCE_ARGUMENTS_REFUSED/));
 const pkg=JSON.parse(readFileSync('package.json','utf8')) as {scripts:Record<string,string>};
 assert.equal(pkg.scripts['production:restore-evidence-finalize'],'node --import tsx scripts/production-restore-evidence.ts');
});
