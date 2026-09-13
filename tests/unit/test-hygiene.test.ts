import {test} from 'node:test';
import assert from 'node:assert/strict';
import {realpathSync,mkdtempSync,mkdirSync,writeFileSync,existsSync,readFileSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {assessDisk,diskPreflight,cleanupSuccessfulClusters} from '../../scripts/test-hygiene';
test('P5 real disk observation and exact safety floor; unavailable/invalid capacity is not success',()=>{assert.ok(diskPreflight(process.cwd()).availableBytes>0);assert.equal(assessDisk(1023,1024).ready,false);assert.equal(assessDisk(1024,1024).ready,true);assert.throws(()=>assessDisk(NaN,1024),/DISK_MEASUREMENT_INVALID/);});
test('P5 cleanup requires matching successful log/run, stopped owner and no live PID; all others preserved',()=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'zao-hygiene-unit-'))),runId=randomUUID(),commandId=randomUUID(),parent=join(root,'.local/postgres'),logs=join(root,'.local/evidence');mkdirSync(parent,{recursive:true});mkdirSync(logs,{recursive:true});const logPath=join(logs,'test.log');writeFileSync(logPath,'SYNTHETIC_SUCCESS');
 const evidence={runId,commandId,exitCode:0,logPath,logSha256:createHash('sha256').update(readFileSync(logPath)).digest('hex')};
 function add(name:string,patch:Record<string,unknown>={},marker=true){const dir=join(parent,'run-'+name);mkdirSync(dir);writeFileSync(join(dir,'PG_VERSION'),'18');if(marker)writeFileSync(dir+'.owner.json',JSON.stringify({schemaVersion:1,root,namespace:'zr_0123456789ab',runId,commandId,clusterId:randomUUID(),launcherPid:2147483647,postgresPid:null,state:'STOPPED',kind:'CLUSTER',...patch}));return dir;}
 try{const good=add('good'),failed=add('failed',{state:'FAILED'}),live=add('live',{launcherPid:process.pid}),unknown=add('unknown',{},false),other=add('other',{runId:randomUUID()}),pid=add('pid');writeFileSync(join(pid,'postmaster.pid'),'2147483647');const symlink=join(parent,'run-link');symlinkSync(good,symlink);
 assert.throws(()=>cleanupSuccessfulClusters(root,{...evidence,logSha256:'0'.repeat(64)}),/CLEANUP_EVIDENCE_INVALID/);assert.ok(existsSync(good));
 const first=cleanupSuccessfulClusters(root,{...evidence,exitCode:1});assert.ok(first.some(x=>x.result==='PRESERVED_FAILED'));assert.ok(existsSync(good));
 const result=cleanupSuccessfulClusters(root,evidence);assert.equal(result.filter(x=>x.result==='DISPOSED_SUCCESSFUL_OWNED').length,1);assert.equal(existsSync(good),false);for(const dir of [failed,live,unknown,other,pid])assert.ok(existsSync(dir));
 }finally{rmSync(root,{recursive:true});} // Synthetic unit files only, never a PostgreSQL cluster.
});
