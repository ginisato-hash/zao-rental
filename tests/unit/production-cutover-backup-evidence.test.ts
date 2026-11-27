import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {Pool} from 'pg';
import {expectedObjectKey,selectBackupRun,collectBackupEvidence,writeBackupEvidence,independentBackupOnline,githubBackupPort,readPipelineBinding,OPERATIONAL_BACKUP_FILE,type BackupRun,type BackupPort} from '../../scripts/production-cutover-backup-evidence';

const NOW=new Date('2026-11-27T17:00:00.000Z');
const COMMITTED=new Date('2026-11-27T10:00:00.000Z');
const BINDING={objectKey:'hourly/2026/11/27/2026-11-27T05-17-11-000Z.dump.age',migrations:63,result:'PASS'};
const run=(over:Partial<BackupRun>={}):BackupRun=>({id:1001,createdAt:'2026-11-27T16:17:11Z',headSha:'a'.repeat(40),event:'schedule',stepConclusion:'success',stepStartedAt:'2026-11-27T16:18:11Z',stepCompletedAt:'2026-11-27T16:19:35Z',...over});
const pool={} as Pool;
const root=()=>{const r=mkdtempSync(join(tmpdir(),'zao-be-'));mkdirSync(join(r,'.local/evidence/production-backup'),{recursive:true});
 writeFileSync(join(r,'.local/evidence/production-backup/restore-pass-pre-0064.json'),JSON.stringify({result:'PASS',objectKey:BINDING.objectKey,migrations:63}));return r;};
const port=(runs:BackupRun[],committed:Date|null=COMMITTED):BackupPort=>({runs:async()=>runs,migrationCommittedAt:async()=>committed});

test('object key naming equals the key of the backup that passed the restore drill',()=>{
 assert.equal(expectedObjectKey('2026-11-27T05:17:11Z'),BINDING.objectKey);
 assert.equal(expectedObjectKey('garbage'),null);
});
test('a successful run after 0064 inside the window qualifies and is honest about restore',()=>{
 const v=selectBackupRun([run()],NOW,COMMITTED,BINDING);
 assert.equal(v.ok,true);assert.equal(v.evidence!.restoreTested,false);assert.equal(v.evidence!.restoreEvidence,'PRE_0064_DRILL_SAME_PIPELINE');
 assert.equal(v.evidence!.objectKey,'hourly/2026/11/27/2026-11-27T16-17-11-000Z.dump.age');
});
test('every missing condition is its own reason',()=>{
 const r=(runs:BackupRun[],c:Date|null=COMMITTED,b=BINDING as typeof BINDING|null)=>selectBackupRun(runs,NOW,c,b).reasons;
 assert.deepEqual(r([]),['NO_SUCCESSFUL_BACKUP_RUN']);
 assert.deepEqual(r([run({stepConclusion:'skipped'})]),['NO_SUCCESSFUL_BACKUP_RUN']);
 assert.deepEqual(r([run({stepConclusion:null,stepStartedAt:null,stepCompletedAt:null})]),['NO_SUCCESSFUL_BACKUP_RUN']);
 assert.deepEqual(r([run({stepCompletedAt:'2026-11-27T14:00:00Z'})]),['BACKUP_RUN_NOT_FRESH']);
 assert.deepEqual(r([run({stepStartedAt:'2026-11-27T09:59:59Z'})]),['BACKUP_PREDATES_MIGRATION_0064']);
 assert.deepEqual(r([run()],null),['MIGRATION_COMMIT_TIME_UNAVAILABLE']);
 assert.deepEqual(r([run()],COMMITTED,null),['PIPELINE_BINDING_MISSING']);
 assert.deepEqual(r([run({headSha:'xyz'})]),['RUN_SHA_INVALID']);
});
test('pipeline binding reads only a PASS restore record with the same key naming',()=>{
 const r=root();assert.equal(readPipelineBinding(r)!.objectKey,BINDING.objectKey);
 writeFileSync(join(r,'.local/evidence/production-backup/restore-pass-pre-0064.json'),JSON.stringify({result:'FAIL',objectKey:BINDING.objectKey,migrations:63}));
 assert.equal(readPipelineBinding(r),null);rmSync(r,{recursive:true});
});
test('stored evidence is re-verified ONLINE: a file alone, a hand-written record or another run is ABSENT',async()=>{
 const r=root();const p=port([run()]);
 assert.equal((await independentBackupOnline(p,pool,r,NOW)).state,'ABSENT','no file');
 const v=await collectBackupEvidence(p,pool,r,NOW);assert.equal(v.ok,true);
 writeBackupEvidence(r,v.evidence!);
 assert.deepEqual(await independentBackupOnline(p,pool,r,NOW),{state:'PRESENT',reasons:[],runId:1001});
 assert.equal((await independentBackupOnline(undefined,pool,r,NOW)).state,'ABSENT','no GitHub port');
 // the run disappears / fails online -> the stored file no longer counts
 assert.equal((await independentBackupOnline(port([]),pool,r,NOW)).state,'ABSENT');
 assert.equal((await independentBackupOnline(port([run({stepConclusion:'failure'})]),pool,r,NOW)).state,'ABSENT');
 // a different run id online (stored one unknown to GitHub) -> ABSENT
 assert.deepEqual((await independentBackupOnline(port([run({id:2002})]),pool,r,NOW)).reasons,['STORED_RUN_NOT_CONFIRMED_ONLINE']);
 // sha edited by hand
 const file=join(r,'.local/evidence/production-cutover',OPERATIONAL_BACKUP_FILE);const doc=JSON.parse(readFileSync(file,'utf8'));
 writeFileSync(file,JSON.stringify({...doc,headSha:'b'.repeat(40)}));assert.equal((await independentBackupOnline(p,pool,r,NOW)).state,'ABSENT');
 // extra field / restoreTested:true claim -> rejected shape
 writeFileSync(file,JSON.stringify({...doc,restoreTested:true}));assert.equal((await independentBackupOnline(p,pool,r,NOW)).state,'ABSENT');
 writeFileSync(file,JSON.stringify({...doc,extra:1}));assert.equal((await independentBackupOnline(p,pool,r,NOW)).state,'ABSENT');
 // the 0064 commit time cannot be read -> ABSENT even with a valid file
 writeFileSync(file,JSON.stringify(doc));assert.equal((await independentBackupOnline(port([run()],null),pool,r,NOW)).state,'ABSENT');
 // a retained-source-copy record is never an independent backup
 rmSync(file);writeFileSync(join(r,'.local/evidence/production-cutover/retained-source-copy.json'),JSON.stringify({kind:'RETAINED_SOURCE_COPY'}));
 assert.equal((await independentBackupOnline(p,pool,r,NOW)).state,'ABSENT');
 rmSync(r,{recursive:true});
});
test('GitHub port keeps only completed successful runs and reads the backup step times (read-only API calls)',async()=>{
 const calls:string[][]=[];
 const exec=async(args:string[])=>{calls.push(args);
  if(args[1]!.includes('/workflows/'))return JSON.stringify({workflow_runs:[{id:7,created_at:'2026-11-27T16:17:11Z',head_sha:'c'.repeat(40),event:'schedule',conclusion:'success'},{id:8,created_at:'2026-11-27T15:17:11Z',head_sha:'c'.repeat(40),event:'schedule',conclusion:'failure'}]});
  return JSON.stringify({jobs:[{steps:[{name:'Activation gate',conclusion:'success'},{name:'Run production backup',conclusion:'success',started_at:'2026-11-27T16:18:11Z',completed_at:'2026-11-27T16:19:35Z'}]}]});};
 const runs=await githubBackupPort('o/r',exec).runs();
 assert.deepEqual(runs.map(x=>[x.id,x.stepConclusion,x.stepCompletedAt]),[[7,'success','2026-11-27T16:19:35Z']]);
 assert.ok(calls.every(c=>c[0]==='api'&&!c.includes('-X')&&!c.includes('--method')),'GET only');
});
