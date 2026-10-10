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
import {PRE_0054_PROFILE,PRE_0056_PROFILE,RESTORE_PASS_MAX_AGE_HOURS,finalizeRestoreEvidence,main,verifyRestorePassRecord} from '../../scripts/production-restore-evidence';
import {requireRestorePass} from '../../scripts/lib/production-owner-session';
import {main as installRefundAutomation} from '../../scripts/production-install-refund-automation';

// R-01 (Issue 47): the 0056 installer needs a fresh restore proof of the 0001-0055 database, never the frozen pre-0054 (53) record.
const NOW=new Date();
const SCHEDULED=new Date(NOW.getTime()-2*3600_000);
const KEY=objectKey('hourly',SCHEDULED);
const FINISHED=NOW.getTime()-10*60_000;
const CIPHER=Buffer.from('CIPHERTEXT-OF-THE-PRE-0056-PRODUCTION-BACKUP');
const sha=(b:Buffer|string)=>createHash('sha256').update(b).digest('hex');
// Independent of the module under test: sha256 over `id:checksum` of the first n migration files of this checkout.
const rows=migrationPlan.map(e=>({id:e.id,checksum:sha(readFileSync(join(migrationsDirectory,e.file),'utf8'))}));
const digest=(r:{id:string;checksum:string}[])=>sha(r.map(x=>x.id+':'+x.checksum).join('\n'));
const REGISTRY55=digest(rows.slice(0,55));
const RECEIPTS='public.provisional_capacity_receipts';
const critical={'public.rental_bookings':{rows:2,sha256:'c'.repeat(64)},[RECEIPTS]:{rows:4,sha256:'e'.repeat(64)}};
const verification=(over:Record<string,unknown>={})=>({migrations:55,registrySha256:REGISTRY55,foreignKeys:120,sequences:3,critical,...over});
const drillOk=(over:Record<string,unknown>={},finished=FINISHED,scheduled=SCHEDULED)=>({status:'DRILL_PASS',dataClass:'PRODUCTION',key:objectKey('hourly',scheduled),
 backupScheduledAt:scheduled.toISOString(),startedAt:new Date(finished-42_000).toISOString(),finishedAt:new Date(finished).toISOString(),restoreSeconds:42,
 observedBackupAgeSeconds:(finished-scheduled.getTime())/1000,plaintextSha256:'b'.repeat(64),plaintextBytes:1000,ciphertextBytes:CIPHER.length,ciphertextSha256:sha(CIPHER),
 toolVersion:'pg_restore (PostgreSQL) 18.6',verification:verification(),productionRpoRtoApproved:false,...over});
function setup(root:string,drill:unknown=drillOk(),drillFile=PRE_0056_PROFILE.drillFile,key=KEY){
 const dir=evidenceDirectory(root);mkdirSync(dir,{recursive:true});
 writeFileSync(join(dir,'object-key.txt'),key+'\n');
 writeFileSync(plannedOutput(root,key),CIPHER,{mode:0o600});
 writeFileSync(join(dir,drillFile),JSON.stringify(drill));
 return dir;
}
const withRoot=async(fn:(root:string)=>Promise<void>)=>{const root=mkdtempSync(join(tmpdir(),'zao-restore-pre0056-'));try{await fn(root);}finally{rmSync(root,{recursive:true,force:true});}};
const code=(re:RegExp)=>(e:Error)=>{assert.match(e.message,re);return true;};
const fin=(root:string)=>finalizeRestoreEvidence(root,()=>NOW,PRE_0056_PROFILE);

test('pre-0056: a fresh 55-migration drill with the receipt ledger produces its own record that the 0056 gate accepts',()=>withRoot(async root=>{
 const dir=setup(root);
 const record=await fin(root);
 assert.deepEqual([record.version,record.migrations,record.objectKey,record.objectSha256],[PRE_0056_PROFILE.version,55,KEY,sha(CIPHER)]);
 assert.equal(record.drillResultSha256,sha(readFileSync(join(dir,PRE_0056_PROFILE.drillFile))));
 assert.equal(statSync(join(dir,'restore-pass-pre-0056.json')).mode&0o777,0o600);
 assert.deepEqual(await verifyRestorePassRecord(root,()=>NOW,PRE_0056_PROFILE),record);
 assert.equal((await requireRestorePass(root,PRE_0056_PROFILE)).migrations,55);
 // the record does not satisfy the frozen pre-0054 gate, and the pre-0054 record file is not written
 await assert.rejects(requireRestorePass(root),code(/PRODUCTION_INSTALL_RESTORE_PASS_REQUIRED/));
 assert.throws(()=>statSync(join(dir,'restore-pass.json')));
 await assert.rejects(fin(root),code(/RESTORE_EVIDENCE_ALREADY_FINALIZED/));
}));

test('pre-0056: a valid frozen pre-0054 (53) record cannot open the 0056 gate',()=>withRoot(async root=>{
 const REGISTRY53=digest(rows.slice(0,53));
 setup(root,drillOk({verification:{migrations:53,registrySha256:REGISTRY53,foreignKeys:120,sequences:3,critical:{'public.rental_bookings':{rows:2,sha256:'c'.repeat(64)}}}}),PRE_0054_PROFILE.drillFile);
 const old=await finalizeRestoreEvidence(root,()=>NOW);
 assert.equal(old.migrations,53);
 assert.equal((await requireRestorePass(root)).migrations,53,'the frozen contract still works for the 0054/0055 installer');
 await assert.rejects(verifyRestorePassRecord(root,()=>NOW,PRE_0056_PROFILE),code(/RESTORE_EVIDENCE_FILE_MISSING/));
 await assert.rejects(requireRestorePass(root,PRE_0056_PROFILE),code(/PRODUCTION_INSTALL_RESTORE_PASS_REQUIRED/));
 // renaming the old record into the pre-0056 slot is refused by version/count, not accepted by shape
 const dir=evidenceDirectory(root);
 writeFileSync(join(dir,'restore-pass-pre-0056.json'),readFileSync(join(dir,'restore-pass.json')),{mode:0o600});
 await assert.rejects(verifyRestorePassRecord(root,()=>NOW,PRE_0056_PROFILE),code(/RESTORE_EVIDENCE_SHAPE_INVALID/));
}));

test('pre-0056: wrong registry count, missing/extra/altered rows and a 53-row drill are refused',()=>withRoot(async root=>{
 const altered=rows.slice(0,55).map((r,i)=>i===20?{...r,checksum:sha('x')}:r);
 const renamed=rows.slice(0,55).map((r,i)=>i===54?{...r,id:'9999'}:r);
 const cases:[string,Record<string,unknown>][]=[
  ['53 rows',{migrations:53,registrySha256:digest(rows.slice(0,53))}],
  ['54 rows (missing 0055)',{migrations:54,registrySha256:digest(rows.slice(0,54))}],
  ['56 rows (0056 already applied)',{migrations:56,registrySha256:digest(rows.slice(0,56))}],
  ['count 55 with a 54-row digest',{registrySha256:digest(rows.slice(0,54))}],
  ['count 55 with a 56-row digest',{registrySha256:digest(rows.slice(0,56))}],
  ['altered checksum',{registrySha256:digest(altered)}],
  ['altered id',{registrySha256:digest(renamed)}],
 ];
 for(const [name,over] of cases){
  rmSync(evidenceDirectory(root),{recursive:true,force:true});setup(root,drillOk({verification:verification(over)}));
  await assert.rejects(fin(root),code(/RESTORE_EVIDENCE_MIGRATIONS_MISMATCH/),name);
 }
}));

test('pre-0056: the current business integrity must include provisional_capacity_receipts',()=>withRoot(async root=>{
 setup(root,drillOk({verification:verification({critical:{'public.rental_bookings':{rows:2,sha256:'c'.repeat(64)}}})}));
 await assert.rejects(fin(root),code(/RESTORE_EVIDENCE_SHAPE_INVALID/));
 rmSync(evidenceDirectory(root),{recursive:true,force:true});
 setup(root,drillOk({verification:verification({critical:{...critical,[RECEIPTS]:{rows:-1,sha256:'e'.repeat(64)}}})}));
 await assert.rejects(fin(root),code(/RESTORE_EVIDENCE_SHAPE_INVALID/));
 // and the frozen pre-0054 profile still refuses a drill that contains it
 rmSync(evidenceDirectory(root),{recursive:true,force:true});
 setup(root,drillOk({verification:verification({migrations:53,registrySha256:digest(rows.slice(0,53))})}),PRE_0054_PROFILE.drillFile);
 await assert.rejects(finalizeRestoreEvidence(root,()=>NOW),code(/RESTORE_EVIDENCE_SHAPE_INVALID/));
}));

test('pre-0056: the 24-hour freshness is not extended and edits after finalization fail',()=>withRoot(async root=>{
 setup(root);const record=await fin(root);
 const at=(h:number,ms=0)=>new Date(FINISHED+h*3600_000+ms);
 assert.deepEqual(await verifyRestorePassRecord(root,()=>at(RESTORE_PASS_MAX_AGE_HOURS),PRE_0056_PROFILE),record);
 await assert.rejects(verifyRestorePassRecord(root,()=>at(RESTORE_PASS_MAX_AGE_HOURS,1),PRE_0056_PROFILE),code(/RESTORE_EVIDENCE_STALE/));
 const dir=evidenceDirectory(root),pass=join(dir,'restore-pass-pre-0056.json');
 const original=readFileSync(pass,'utf8');
 for(const [name,mut,re] of [['finishedAt rewritten',{finishedAt:new Date(FINISHED-60_000).toISOString()},/RESTORE_EVIDENCE_BINDING_MISMATCH/],
  ['finishedAt moved past finalization',{finishedAt:new Date(FINISHED+3600_000).toISOString()},/RESTORE_EVIDENCE_STALE/],
  ['count only',{migrations:53},/RESTORE_EVIDENCE_SHAPE_INVALID/],['old version',{version:PRE_0054_PROFILE.version},/RESTORE_EVIDENCE_SHAPE_INVALID/],
  ['other ciphertext hash',{objectSha256:'f'.repeat(64)},/RESTORE_EVIDENCE_(BINDING|CIPHERTEXT)_MISMATCH/]] as const){
  writeFileSync(pass,JSON.stringify({...record,...mut}));
  await assert.rejects(verifyRestorePassRecord(root,()=>NOW,PRE_0056_PROFILE),code(re),name);
 }
 writeFileSync(pass,original);
 writeFileSync(join(dir,PRE_0056_PROFILE.drillFile),JSON.stringify(drillOk({plaintextSha256:'a'.repeat(64)})));
 await assert.rejects(verifyRestorePassRecord(root,()=>NOW,PRE_0056_PROFILE),code(/RESTORE_EVIDENCE_BINDING_MISMATCH/));
 // a drill that ended more than 24 hours ago cannot be finalized
 rmSync(dir,{recursive:true,force:true});
 const oldScheduled=new Date(NOW.getTime()-30*3600_000);
 setup(root,drillOk({},NOW.getTime()-(RESTORE_PASS_MAX_AGE_HOURS+1)*3600_000,oldScheduled),PRE_0056_PROFILE.drillFile,objectKey('hourly',oldScheduled));
 await assert.rejects(fin(root),code(/RESTORE_EVIDENCE_STALE/));
}));

test('pre-0056: the finalizer CLI takes exactly the profile argument',()=>withRoot(async root=>{
 for(const bad of [['pre-0054'],['pre-0056','x'],['--force']])await assert.rejects(main(bad,root),code(/RESTORE_EVIDENCE_ARGUMENTS_REFUSED/),bad.join(' '));
 setup(root);
 const logged:string[]=[];const log=console.log;console.log=(m:string)=>{logged.push(m);};
 try{await main(['pre-0056'],root);}finally{console.log=log;}
 assert.equal(JSON.parse(logged[0]!).migrations,55);
}));

test('the 0056 installer gates on the pre-0056 record before opening any owner session',()=>withRoot(async root=>{
 const opened:string[]=[];
 const seams={release:()=>'f'.repeat(40),openSession:async()=>{opened.push('open');throw new Error('SESSION_STUB');}};
 const REGISTRY53=digest(rows.slice(0,53));
 setup(root,drillOk({verification:{migrations:53,registrySha256:REGISTRY53,foreignKeys:120,sequences:3,critical:{'public.rental_bookings':{rows:2,sha256:'c'.repeat(64)}}}}),PRE_0054_PROFILE.drillFile);
 await finalizeRestoreEvidence(root,()=>NOW);
 for(const command of ['migrate','grants'])await assert.rejects(installRefundAutomation([command],root,seams),code(/PRODUCTION_INSTALL_RESTORE_PASS_REQUIRED/),command);
 assert.deepEqual(opened,[],'a pre-0054 record never reaches the owner session');
 writeFileSync(join(evidenceDirectory(root),PRE_0056_PROFILE.drillFile),JSON.stringify(drillOk()));
 await fin(root);
 await assert.rejects(installRefundAutomation(['migrate'],root,seams),code(/SESSION_STUB/));
 assert.deepEqual(opened,['open']);
}));
