import test from 'node:test';
import assert from 'node:assert/strict';
import {chmodSync,mkdirSync,mkdtempSync,readFileSync,rmSync,statSync,unlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {objectKey} from '../../scripts/production-backup';
import {assertRestorePass,evidenceDirectory} from '../../scripts/production-backup-credential';
import {plannedOutput} from '../../scripts/production-backup-object-get';
import {PRE_0054_MIGRATIONS,RESTORE_PASS_MAX_AGE_HOURS,RESTORE_PASS_VERSION,finalizeRestoreEvidence,main,validateDrillResult,verifyRestorePassRecord} from '../../scripts/production-restore-evidence';
import {requireRestorePass} from '../../scripts/lib/production-owner-session';

const KEY=objectKey('hourly',new Date('2026-10-04T16:17:00.000Z'));
const CIPHER=Buffer.from('CIPHERTEXT-OF-THE-PRODUCTION-BACKUP');
const sha=(b:Buffer|string)=>createHash('sha256').update(b).digest('hex');
const NOW=new Date('2026-10-04T17:00:00.000Z');
const drillOk=(over:Record<string,unknown>={})=>({status:'DRILL_PASS',dataClass:'PRODUCTION',key:KEY,backupScheduledAt:'2026-10-04T16:17:00.000Z',plaintextSha256:'b'.repeat(64),plaintextBytes:1000,ciphertextBytes:CIPHER.length,
 toolVersion:'pg_restore (PostgreSQL) 18.6',startedAt:'2026-10-04T16:50:00.000Z',finishedAt:'2026-10-04T16:50:42.000Z',restoreSeconds:42,observedBackupAgeSeconds:2000,
 verification:{migrations:53,foreignKeys:120,sequences:3,critical:{'public.rental_bookings':{rows:2,sha256:'c'.repeat(64)},'public.price_quotes':{rows:5,sha256:'d'.repeat(64)}}},productionRpoRtoApproved:false,...over});
function setup(root:string,drill:unknown=drillOk(),withCipher=true,key=KEY){
 const dir=evidenceDirectory(root);mkdirSync(dir,{recursive:true});
 writeFileSync(join(dir,'object-key.txt'),key+'\n');
 if(withCipher)writeFileSync(plannedOutput(root,key),CIPHER,{mode:0o600});
 writeFileSync(join(dir,'restore-drill-result.json'),JSON.stringify(drill));
 return dir;
}
const withRoot=async(fn:(root:string)=>Promise<void>)=>{const root=mkdtempSync(join(tmpdir(),'zao-restore-evidence-'));try{await fn(root);}finally{rmSync(root,{recursive:true,force:true});}};
const code=(re:RegExp)=>(e:Error)=>{assert.match(e.message,re);return true;};

test('a real Production drill result for the downloaded object produces the versioned record: exclusive, 0600, bound to the drill result and the ciphertext',()=>withRoot(async root=>{
 const dir=setup(root);
 const record=await finalizeRestoreEvidence(root,()=>NOW);
 assert.deepEqual([record.version,record.result,record.objectKey,record.migrations],[RESTORE_PASS_VERSION,'PASS',KEY,PRE_0054_MIGRATIONS]);
 assert.equal(record.objectSha256,sha(CIPHER));assert.equal(record.ciphertextBytes,CIPHER.length);assert.equal(record.plaintextSha256,'b'.repeat(64));
 assert.equal(record.drillResultSha256,sha(readFileSync(join(dir,'restore-drill-result.json'))));
 assert.equal(statSync(join(dir,'restore-pass.json')).mode&0o777,0o600);
 assert.deepEqual(await verifyRestorePassRecord(root,()=>NOW),record);
 assert.equal((await requireRestorePass(root)).result,'PASS');
 // the backup helper's finalize gate shape check accepts the same record (its pinned code is unchanged)
 assert.doesNotThrow(()=>assertRestorePass(JSON.parse(readFileSync(join(dir,'restore-pass.json'),'utf8'))));
 await assert.rejects(finalizeRestoreEvidence(root,()=>NOW),code(/RESTORE_EVIDENCE_ALREADY_FINALIZED/));
}));

test('SYNTHETIC, a wrong registry (52/54/55), a wrong key, wrong ciphertext size, a mismatched schedule, a 0054 table, an approved RPO/RTO and a wrong tool are all refused',()=>withRoot(async root=>{
 const otherKey=objectKey('hourly',new Date('2026-10-04T15:17:00.000Z'));
 const bad:Array<[string,Record<string,unknown>,RegExp]>=[
  ['synthetic',{dataClass:'SYNTHETIC'},/NOT_PRODUCTION_DRILL_PASS/],['not pass',{status:'STOP'},/NOT_PRODUCTION_DRILL_PASS/],
  ['52 migrations',{verification:{...drillOk().verification,migrations:52}},/MIGRATIONS_MISMATCH/],['54 migrations',{verification:{...drillOk().verification,migrations:54}},/MIGRATIONS_MISMATCH/],
  ['55 migrations',{verification:{...drillOk().verification,migrations:55}},/MIGRATIONS_MISMATCH/],
  ['wrong key',{key:otherKey,backupScheduledAt:'2026-10-04T15:17:00.000Z'},/KEY_MISMATCH/],['schedule not the key time',{backupScheduledAt:'2026-10-04T16:18:00.000Z'},/KEY_MISMATCH/],
  ['wrong ciphertext size',{ciphertextBytes:CIPHER.length+1},/CIPHERTEXT_MISMATCH/],
  ['0054 table present',{verification:{...drillOk().verification,critical:{'public.provisional_capacity_receipts':{rows:0,sha256:'e'.repeat(64)}}}},/SHAPE_INVALID/],
  ['no critical rows',{verification:{...drillOk().verification,critical:{}}},/SHAPE_INVALID/],['no foreign keys',{verification:{...drillOk().verification,foreignKeys:0}},/SHAPE_INVALID/],
  ['rpo approved',{productionRpoRtoApproved:true},/SHAPE_INVALID/],['old pg_restore',{toolVersion:'pg_restore (PostgreSQL) 16.2'},/SHAPE_INVALID/],['bad plaintext hash',{plaintextSha256:'xyz'},/SHAPE_INVALID/],
 ];
 for(const [name,over,re] of bad){
  setup(root,drillOk(over));
  await assert.rejects(finalizeRestoreEvidence(root,()=>NOW),code(re),name);
  assert.throws(()=>statSync(join(evidenceDirectory(root),'restore-pass.json')),Error,name+': nothing is written');
 }
 for(const raw of [null,[],'x',{}])assert.throws(()=>validateDrillResult(raw,{key:KEY,ciphertextBytes:CIPHER.length}),/RESTORE_EVIDENCE_/);
}));

test('finalizing needs every input: key file, downloaded ciphertext and the drill result; none can be absent, empty, a symlink or malformed',()=>withRoot(async root=>{
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
}));

test('the gate refuses hand-written or tampered records: old shape, wrong version, extra keys, edited drill result, replaced ciphertext, another key, stale or future time',()=>withRoot(async root=>{
 const dir=setup(root);
 const record=await finalizeRestoreEvidence(root,()=>NOW);
 const write=(r:unknown)=>{try{unlinkSync(join(dir,'restore-pass.json'));}catch{/* absent */}writeFileSync(join(dir,'restore-pass.json'),typeof r==='string'?r:JSON.stringify(r),{mode:0o600});};
 // the legacy shape-only file (what a hand-written PASS would look like)
 write({result:'PASS',objectKey:KEY,objectSha256:sha(CIPHER)});
 await assert.rejects(verifyRestorePassRecord(root,()=>NOW),code(/RESTORE_EVIDENCE_SHAPE_INVALID/));
 await assert.rejects(requireRestorePass(root),code(/PRODUCTION_INSTALL_RESTORE_PASS_REQUIRED/));
 for(const [name,mut] of [['version',{version:'production-restore-pass/0'}],['migrations',{migrations:55}],['extra key',{extra:1}],['result',{result:'FAIL'}],['hash shape',{objectSha256:'nope'}],['finalizedAt shape',{finalizedAt:'yesterday'}]] as Array<[string,Record<string,unknown>]>){
  write({...record,...mut});await assert.rejects(verifyRestorePassRecord(root,()=>NOW),Error,name);
 }
 // a self-consistent forgery still fails because the drill result hash and the drill content are re-verified
 write({...record,drillResultSha256:'f'.repeat(64)});await assert.rejects(verifyRestorePassRecord(root,()=>NOW),code(/RESTORE_EVIDENCE_BINDING_MISMATCH/));
 write(record);
 assert.deepEqual(await verifyRestorePassRecord(root,()=>NOW),record);
 // the drill result edited after finalization (even to another valid result) breaks the binding
 writeFileSync(join(dir,'restore-drill-result.json'),JSON.stringify(drillOk({restoreSeconds:1})));
 await assert.rejects(verifyRestorePassRecord(root,()=>NOW),code(/RESTORE_EVIDENCE_BINDING_MISMATCH/));
 writeFileSync(join(dir,'restore-drill-result.json'),JSON.stringify(drillOk()));
 // the ciphertext replaced after finalization breaks it; once the ciphertext is removed the drill binding still holds
 writeFileSync(plannedOutput(root,KEY),Buffer.from('CIPHERTEXT-OF-THE-PRODUCTION-BACKUP'.replace('PRODUCTION','PRODUCTIOn')));
 await assert.rejects(verifyRestorePassRecord(root,()=>NOW),code(/RESTORE_EVIDENCE_BINDING_MISMATCH/));
 unlinkSync(plannedOutput(root,KEY));
 assert.deepEqual(await verifyRestorePassRecord(root,()=>NOW),record);
 // another object key in the key file
 const other=objectKey('daily',new Date('2026-10-05T00:17:00.000Z'));writeFileSync(join(dir,'object-key.txt'),other+'\n');
 await assert.rejects(verifyRestorePassRecord(root,()=>NOW),code(/RESTORE_EVIDENCE_BINDING_MISMATCH|RESTORE_EVIDENCE_KEY_MISMATCH/));
 writeFileSync(join(dir,'object-key.txt'),KEY+'\n');
 // freshness: older than 24 hours or from the future
 const old=new Date(NOW.getTime()+(RESTORE_PASS_MAX_AGE_HOURS*3600+1)*1000);
 await assert.rejects(verifyRestorePassRecord(root,()=>old),code(/RESTORE_EVIDENCE_STALE/));
 await assert.rejects(verifyRestorePassRecord(root,()=>new Date(NOW.getTime()-3600_000)),code(/RESTORE_EVIDENCE_STALE/));
 chmodSync(join(dir,'restore-pass.json'),0o600);
}));

test('the evidence finalizer takes no arguments',async()=>{
 await assert.rejects(main(['--force']),code(/RESTORE_EVIDENCE_ARGUMENTS_REFUSED/));
 const pkg=JSON.parse(readFileSync('package.json','utf8')) as {scripts:Record<string,string>};
 assert.equal(pkg.scripts['production:restore-evidence-finalize'],'node --import tsx scripts/production-restore-evidence.ts');
});
