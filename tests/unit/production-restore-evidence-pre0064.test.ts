import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,readFileSync,rmSync,statSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {migrationPlan,migrationsDirectory} from '../../packages/db/src/index';
import {objectKey} from '../../scripts/production-backup';
import {evidenceDirectory} from '../../scripts/production-backup-credential';
import {plannedOutput} from '../../scripts/production-backup-object-get';
import {RESTORE_PASS_MAX_AGE_HOURS,RESTORE_PASS_VERSION,finalizeRestoreEvidence} from '../../scripts/production-restore-evidence';
import {PRE_0064_DRILL_FILE,PRE_0064_RESTORE_PASS_VERSION,finalizePre0064RestoreEvidence,main,requirePre0064RestorePass,verifyPre0064RestorePassRecord} from '../../scripts/production-restore-evidence-pre0064';
import {finalizePre0063RestoreEvidence,PRE_0063_DRILL_FILE,requirePre0063RestorePass} from '../../scripts/production-restore-evidence-pre0063';
import {main as installCoupon} from '../../scripts/production-install-coupon-admin';
import {requireRestorePass} from '../../scripts/lib/production-owner-session';
import {main as installGroup} from '../../scripts/production-install-group';
import {finalizePre0059RestoreEvidence,PRE_0059_DRILL_FILE} from '../../scripts/production-restore-evidence-pre0059';
import {finalizePre0056RestoreEvidence,PRE_0056_DRILL_FILE} from '../../scripts/production-restore-evidence-pre0056';

// The 0064 group installer (migrate and grants) needs a fresh restore proof of the 0001-0063 database, never the frozen pre-0054 (53), the pre-0056 (55)
// or the pre-0059 (58) record. Synthetic evidence and seams only; no Production connection.
const NOW=new Date();
const SCHEDULED=new Date(NOW.getTime()-2*3600_000);
const KEY=objectKey('hourly',SCHEDULED);
const FINISHED=NOW.getTime()-10*60_000;
const CIPHER=Buffer.from('CIPHERTEXT-OF-THE-PRE-0064-PRODUCTION-BACKUP');
const sha=(b:Buffer|string)=>createHash('sha256').update(b).digest('hex');
// Independent of the module under test: sha256 over `id:checksum` of the first n migration files of this checkout.
const rows=migrationPlan.map(e=>({id:e.id,checksum:sha(readFileSync(join(migrationsDirectory,e.file),'utf8'))}));
const digest=(r:{id:string;checksum:string}[])=>sha(r.map(x=>x.id+':'+x.checksum).join('\n'));
const REGISTRY63=digest(rows.slice(0,63));
const RECEIPTS='public.provisional_capacity_receipts';
const critical={'public.rental_bookings':{rows:2,sha256:'c'.repeat(64)},[RECEIPTS]:{rows:4,sha256:'e'.repeat(64)}};
const verification=(over:Record<string,unknown>={})=>({migrations:63,registrySha256:REGISTRY63,foreignKeys:120,sequences:3,critical,...over});
const drillOk=(over:Record<string,unknown>={},finished=FINISHED,scheduled=SCHEDULED)=>({status:'DRILL_PASS',dataClass:'PRODUCTION',key:objectKey('hourly',scheduled),
 backupScheduledAt:scheduled.toISOString(),startedAt:new Date(finished-42_000).toISOString(),finishedAt:new Date(finished).toISOString(),restoreSeconds:42,
 observedBackupAgeSeconds:(finished-scheduled.getTime())/1000,plaintextSha256:'b'.repeat(64),plaintextBytes:1000,ciphertextBytes:CIPHER.length,ciphertextSha256:sha(CIPHER),
 toolVersion:'pg_restore (PostgreSQL) 18.6',verification:verification(),productionRpoRtoApproved:false,...over});
function setup(root:string,drill:unknown=drillOk(),drillFile=PRE_0064_DRILL_FILE,key=KEY){
 const dir=evidenceDirectory(root);mkdirSync(dir,{recursive:true});
 writeFileSync(join(dir,'object-key.txt'),key+'\n');
 writeFileSync(plannedOutput(root,key),CIPHER,{mode:0o600});
 writeFileSync(join(dir,drillFile),JSON.stringify(drill));
 return dir;
}
const withRoot=async(fn:(root:string)=>Promise<void>)=>{const root=mkdtempSync(join(tmpdir(),'zao-restore-pre0064-'));try{await fn(root);}finally{rmSync(root,{recursive:true,force:true});}};
const code=(re:RegExp)=>(e:Error)=>{assert.match(e.message,re);return true;};
const fin=(root:string)=>finalizePre0064RestoreEvidence(root,()=>NOW);

test('pre-0064: a fresh 63-migration drill with the receipt ledger produces its own record that the group gate accepts',()=>withRoot(async root=>{
 const dir=setup(root);
 const record=await fin(root);
 assert.deepEqual([record.version,record.migrations,record.objectKey,record.objectSha256],[PRE_0064_RESTORE_PASS_VERSION,63,KEY,sha(CIPHER)]);
 assert.equal(record.drillResultSha256,sha(readFileSync(join(dir,PRE_0064_DRILL_FILE))));
 assert.equal(statSync(join(dir,'restore-pass-pre-0064.json')).mode&0o777,0o600);
 assert.deepEqual(await verifyPre0064RestorePassRecord(root,()=>NOW),record);
 assert.equal((await requirePre0064RestorePass(root)).migrations,63);
 // the record does not satisfy the frozen pre-0054 gate, and the pre-0054 record file is not written
 await assert.rejects(requireRestorePass(root),code(/PRODUCTION_INSTALL_RESTORE_PASS_REQUIRED/));
 assert.throws(()=>statSync(join(dir,'restore-pass.json')));
 await assert.rejects(fin(root),code(/RESTORE_EVIDENCE_ALREADY_FINALIZED/));
}));

test('pre-0064: a valid frozen pre-0054 (53) record cannot open the group gate',()=>withRoot(async root=>{
 const REGISTRY53=digest(rows.slice(0,53));
 setup(root,drillOk({verification:{migrations:53,registrySha256:REGISTRY53,foreignKeys:120,sequences:3,critical:{'public.rental_bookings':{rows:2,sha256:'c'.repeat(64)}}}}),'restore-drill-result.json');
 const old=await finalizeRestoreEvidence(root,()=>NOW);
 assert.equal(old.migrations,53);
 assert.equal((await requireRestorePass(root)).migrations,53,'the frozen contract still works for the 0054/0055 installer');
 await assert.rejects(verifyPre0064RestorePassRecord(root,()=>NOW),code(/RESTORE_EVIDENCE_FILE_MISSING/));
 await assert.rejects(requirePre0064RestorePass(root),code(/PRODUCTION_INSTALL_RESTORE_PASS_REQUIRED/));
 // renaming the old record into the pre-0064 slot is refused by version/count, not accepted by shape
 const dir=evidenceDirectory(root);
 writeFileSync(join(dir,'restore-pass-pre-0064.json'),readFileSync(join(dir,'restore-pass.json')),{mode:0o600});
 await assert.rejects(verifyPre0064RestorePassRecord(root,()=>NOW),code(/RESTORE_EVIDENCE_SHAPE_INVALID/));
}));

test('pre-0064: wrong registry count, missing/extra/altered rows and a 53-row drill are refused',()=>withRoot(async root=>{
 const altered=rows.slice(0,63).map((r,i)=>i===20?{...r,checksum:sha('x')}:r);
 const renamed=rows.slice(0,63).map((r,i)=>i===62?{...r,id:'9999'}:r);
 const cases:[string,Record<string,unknown>][]=[
  ['53 rows',{migrations:53,registrySha256:digest(rows.slice(0,53))}],
  ['55 rows (the pre-0056 database)',{migrations:55,registrySha256:digest(rows.slice(0,55))}],
  ['58 rows (the pre-0059 database)',{migrations:58,registrySha256:digest(rows.slice(0,58))}],
  ['62 rows (the pre-0063 database)',{migrations:62,registrySha256:digest(rows.slice(0,62))}],
  ['64 rows (after the delta)',{migrations:64,registrySha256:digest(rows.slice(0,64))}],
  ['count 63 with a 62-row digest',{registrySha256:digest(rows.slice(0,62))}],
  ['count 63 with a 64-row digest',{registrySha256:digest(rows.slice(0,64))}],
  ['altered checksum',{registrySha256:digest(altered)}],
  ['altered id',{registrySha256:digest(renamed)}],
 ];
 for(const [name,over] of cases){
  rmSync(evidenceDirectory(root),{recursive:true,force:true});setup(root,drillOk({verification:verification(over)}));
  await assert.rejects(fin(root),code(/RESTORE_EVIDENCE_MIGRATIONS_MISMATCH/),name);
 }
}));

test('pre-0064: the current business integrity must include provisional_capacity_receipts',()=>withRoot(async root=>{
 setup(root,drillOk({verification:verification({critical:{'public.rental_bookings':{rows:2,sha256:'c'.repeat(64)}}})}));
 await assert.rejects(fin(root),code(/RESTORE_EVIDENCE_SHAPE_INVALID/));
 rmSync(evidenceDirectory(root),{recursive:true,force:true});
 setup(root,drillOk({verification:verification({critical:{...critical,[RECEIPTS]:{rows:-1,sha256:'e'.repeat(64)}}})}));
 await assert.rejects(fin(root),code(/RESTORE_EVIDENCE_SHAPE_INVALID/));
 // and the frozen pre-0054 profile still refuses a drill that contains it
 rmSync(evidenceDirectory(root),{recursive:true,force:true});
 setup(root,drillOk({verification:verification({migrations:53,registrySha256:digest(rows.slice(0,53))})}),'restore-drill-result.json');
 await assert.rejects(finalizeRestoreEvidence(root,()=>NOW),code(/RESTORE_EVIDENCE_SHAPE_INVALID/));
}));

test('pre-0064: the 24-hour freshness is not extended and edits after finalization fail',()=>withRoot(async root=>{
 setup(root);const record=await fin(root);
 const at=(h:number,ms=0)=>new Date(FINISHED+h*3600_000+ms);
 assert.deepEqual(await verifyPre0064RestorePassRecord(root,()=>at(RESTORE_PASS_MAX_AGE_HOURS)),record);
 await assert.rejects(verifyPre0064RestorePassRecord(root,()=>at(RESTORE_PASS_MAX_AGE_HOURS,1)),code(/RESTORE_EVIDENCE_STALE/));
 const dir=evidenceDirectory(root),pass=join(dir,'restore-pass-pre-0064.json');
 const original=readFileSync(pass,'utf8');
 for(const [name,mut,re] of [['finishedAt rewritten',{finishedAt:new Date(FINISHED-60_000).toISOString()},/RESTORE_EVIDENCE_BINDING_MISMATCH/],
  ['finishedAt moved past finalization',{finishedAt:new Date(FINISHED+3600_000).toISOString()},/RESTORE_EVIDENCE_STALE/],
  ['count only',{migrations:53},/RESTORE_EVIDENCE_SHAPE_INVALID/],['old version',{version:RESTORE_PASS_VERSION},/RESTORE_EVIDENCE_SHAPE_INVALID/],
  ['other ciphertext hash',{objectSha256:'f'.repeat(64)},/RESTORE_EVIDENCE_(BINDING|CIPHERTEXT)_MISMATCH/]] as const){
  writeFileSync(pass,JSON.stringify({...record,...mut}));
  await assert.rejects(verifyPre0064RestorePassRecord(root,()=>NOW),code(re),name);
 }
 writeFileSync(pass,original);
 writeFileSync(join(dir,PRE_0064_DRILL_FILE),JSON.stringify(drillOk({plaintextSha256:'a'.repeat(64)})));
 await assert.rejects(verifyPre0064RestorePassRecord(root,()=>NOW),code(/RESTORE_EVIDENCE_BINDING_MISMATCH/));
 // a drill that ended more than 24 hours ago cannot be finalized
 rmSync(dir,{recursive:true,force:true});
 const oldScheduled=new Date(NOW.getTime()-30*3600_000);
 setup(root,drillOk({},NOW.getTime()-(RESTORE_PASS_MAX_AGE_HOURS+1)*3600_000,oldScheduled),PRE_0064_DRILL_FILE,objectKey('hourly',oldScheduled));
 await assert.rejects(fin(root),code(/RESTORE_EVIDENCE_STALE/));
}));

test('pre-0064: the finalizer CLI takes no arguments',()=>withRoot(async root=>{
 for(const bad of [['pre-0054'],['pre-0064'],['--force']])await assert.rejects(main(bad,root),code(/RESTORE_EVIDENCE_ARGUMENTS_REFUSED/),bad.join(' '));
 setup(root);
 const logged:string[]=[];const log=console.log;console.log=(m:string)=>{logged.push(m);};
 try{await main([],root);}finally{console.log=log;}
 assert.equal(JSON.parse(logged[0]!).migrations,63);
}));

test('pre-0064: a valid pre-0059 (58) record cannot open the group gate',()=>withRoot(async root=>{
 setup(root,drillOk({verification:verification({migrations:58,registrySha256:digest(rows.slice(0,58))})}),PRE_0059_DRILL_FILE);
 assert.equal((await finalizePre0059RestoreEvidence(root,()=>NOW)).migrations,58,'the pre-0059 contract still works for the staff delta installer');
 await assert.rejects(requirePre0064RestorePass(root),code(/PRODUCTION_INSTALL_RESTORE_PASS_REQUIRED/));
 const dir=evidenceDirectory(root);
 writeFileSync(join(dir,'restore-pass-pre-0064.json'),readFileSync(join(dir,'restore-pass-pre-0059.json')),{mode:0o600});
 await assert.rejects(verifyPre0064RestorePassRecord(root,()=>NOW),code(/RESTORE_EVIDENCE_SHAPE_INVALID/));
}));

test('pre-0064: a valid pre-0056 (55) record cannot open the group gate either',()=>withRoot(async root=>{
 const REGISTRY55=digest(rows.slice(0,55));
 setup(root,drillOk({verification:verification({migrations:55,registrySha256:REGISTRY55})}),PRE_0056_DRILL_FILE);
 assert.equal((await finalizePre0056RestoreEvidence(root,()=>NOW)).migrations,55,'the pre-0056 contract still works for its own installer');
 await assert.rejects(requirePre0064RestorePass(root),code(/PRODUCTION_INSTALL_RESTORE_PASS_REQUIRED/));
 const dir=evidenceDirectory(root);
 writeFileSync(join(dir,'restore-pass-pre-0064.json'),readFileSync(join(dir,'restore-pass-pre-0056.json')),{mode:0o600});
 await assert.rejects(verifyPre0064RestorePassRecord(root,()=>NOW),code(/RESTORE_EVIDENCE_SHAPE_INVALID/));
}));

test('the group installer: migrate and grants both reach the owner session only with a valid pre-0064 record; 53/55/58 records and refused evidence never do',()=>withRoot(async root=>{
 const opened:string[]=[];
 const seams={release:()=>'f'.repeat(40),openSession:async()=>{opened.push('open');throw new Error('SESSION_STUB');}};
 // no evidence, then a frozen 53 record, then a pre-0056 55 record: refused before any session
 for(const command of ['migrate','grants'])await assert.rejects(installGroup([command],root,seams),code(/PRODUCTION_INSTALL_RESTORE_PASS_REQUIRED/),command+' without evidence');
 setup(root,drillOk({verification:{migrations:53,registrySha256:digest(rows.slice(0,53)),foreignKeys:120,sequences:3,critical:{'public.rental_bookings':{rows:2,sha256:'c'.repeat(64)}}}}),'restore-drill-result.json');
 await finalizeRestoreEvidence(root,()=>NOW);
 writeFileSync(join(evidenceDirectory(root),PRE_0056_DRILL_FILE),JSON.stringify(drillOk({verification:verification({migrations:55,registrySha256:digest(rows.slice(0,55))})})));
 await finalizePre0056RestoreEvidence(root,()=>NOW);
 writeFileSync(join(evidenceDirectory(root),PRE_0059_DRILL_FILE),JSON.stringify(drillOk({verification:verification({migrations:58,registrySha256:digest(rows.slice(0,58))})})));
 await finalizePre0059RestoreEvidence(root,()=>NOW);
 for(const command of ['migrate','grants'])await assert.rejects(installGroup([command],root,seams),code(/PRODUCTION_INSTALL_RESTORE_PASS_REQUIRED/),command+' with 53/55/58 records');
 assert.deepEqual(opened,[],'older records never reach the owner session');
 // the correct 63-migration drill: both commands pass the gate and reach the owner session boundary
 writeFileSync(join(evidenceDirectory(root),PRE_0064_DRILL_FILE),JSON.stringify(drillOk()));
 await fin(root);
 for(const command of ['migrate','grants'])await assert.rejects(installGroup([command],root,seams),code(/SESSION_STUB/),command+' with the pre-0064 record');
 assert.deepEqual(opened,['open','open']);
 // a tampered drill after finalization: refused again before the session
 writeFileSync(join(evidenceDirectory(root),PRE_0064_DRILL_FILE),JSON.stringify(drillOk({plaintextSha256:'a'.repeat(64)})));
 for(const command of ['migrate','grants'])await assert.rejects(installGroup([command],root,seams),code(/PRODUCTION_INSTALL_RESTORE_PASS_REQUIRED/),command+' after tampering');
 assert.deepEqual(opened,['open','open'],'no session after the evidence changed');
}));

test('pre-0064: a valid pre-0063 (62) record cannot open the group gate, and the pre-0063 verifier refuses a 63-entry drill',()=>withRoot(async root=>{
 setup(root,drillOk({verification:verification({migrations:62,registrySha256:digest(rows.slice(0,62))})}),PRE_0063_DRILL_FILE);
 assert.equal((await finalizePre0063RestoreEvidence(root,()=>NOW)).migrations,62,'the pre-0063 contract still works for the coupon admin installer');
 await assert.rejects(requirePre0064RestorePass(root),code(/PRODUCTION_INSTALL_RESTORE_PASS_REQUIRED/));
 const dir=evidenceDirectory(root);
 writeFileSync(join(dir,'restore-pass-pre-0064.json'),readFileSync(join(dir,'restore-pass-pre-0063.json')),{mode:0o600});
 await assert.rejects(verifyPre0064RestorePassRecord(root,()=>NOW),code(/RESTORE_EVIDENCE_SHAPE_INVALID/));
 // and the other way: a 63-entry (pre-0064) drill is refused by the pre-0063 verifier and by the coupon admin installer gate
 rmSync(dir,{recursive:true,force:true});setup(root);await fin(root);
 await assert.rejects(requirePre0063RestorePass(root),code(/PRODUCTION_INSTALL_RESTORE_PASS_REQUIRED/));
 await assert.rejects(installCoupon(['migrate'],root,{release:()=>'f'.repeat(40),openSession:async()=>{throw new Error('SESSION_STUB');}}),code(/PRODUCTION_INSTALL_RESTORE_PASS_REQUIRED/));
}));
