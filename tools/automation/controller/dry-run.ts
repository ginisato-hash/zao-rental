import { generateKeyPairSync, sign, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { exportController } from '../../../scripts/export-controller';
import { simulationFixture } from '../fixtures';
import { acquireRepositoryLease, Journal, digest } from './store';
import { runPreflight, type Adapter, type Operation } from './engine';
if (JSON.stringify(process.argv.slice(2)) !== JSON.stringify(['--dry-run'])) {
  console.error('LIVE_DISABLED: only --dry-run is accepted.'); process.exit(2);
}
const root = await realpath(await mkdtemp(resolve(tmpdir(),'zao-e02-simulation-')));
const worktree = resolve(root,'worktree');await mkdir(worktree);
execFileSync('git',['init','-q',worktree]);
const f=simulationFixture();const reviewer=generateKeyPairSync('ed25519');const runId=randomUUID();
const policy=resolve(root,'policy.json');await writeFile(policy,JSON.stringify({policy:f.policy,reviewPublicKey:reviewer.publicKey.export({type:'spki',format:'pem'}).toString()}));
const release=await exportController(process.cwd(),resolve(root,'release'),policy);
const lease=await acquireRepositoryLease(worktree,f.approval.taskId,runId);
try {
  const journal=await Journal.load(lease,f.approval.taskId,digest(JSON.stringify(f.signed)),release.manifestHash);
  const operations:Operation[]=[];const remote=new Map<string,unknown>();const head=f.evidence.headSha,base=f.approval.baseSha,branch=journal.data.branch,snapshotHash='d'.repeat(64);
  const adapter:Adapter={mode:'FAKE',async invoke(op){operations.push(op);let result:unknown;
    switch(op.kind){
      case 'branch':result={branch};break;
      case 'push':result={head,branch};break;
      case 'implement':result={task_id:f.approval.taskId,status:'READY_FOR_REVIEW',head_sha:head,base_sha:base,spec_hash:f.approval.specHash,changed_files:f.evidence.changedFiles,commands:[{command:'FAKE',exit_code:0,log_path:'FAKE'}],known_gaps:[],next_action:'FAKE'};break;
      case 'verify':result={head,changed:f.evidence.changedFiles,exitCodes:[0],snapshotHash};break;
      case 'draft':result={number:1,draft:true,base,branch};break;
      case 'ci':result=f.evidence.ci;break;
      case 'observe':result={head,base,changed:f.evidence.changedFiles,pr:{number:1,draft:true,head,base,branch}};break;
      case 'review': {const payload={taskId:f.approval.taskId,runId,baseSha:base,headSha:head,specHash:f.approval.specHash,snapshotHash,reviewHash:digest(JSON.stringify(f.evidence.review))};result={review:f.evidence.review,snapshotHash,receipt:{payload,signature:sign(null,Buffer.from(JSON.stringify(payload)),reviewer.privateKey).toString('base64')}};break;}
    }remote.set(op.key,result);return result;
  },async reconcile(op){return remote.has(op.key)?{found:true,result:remote.get(op.key)}:{found:false};}};
  const result=await runPreflight({journal,adapter,release,signed:f.signed,worktree,specHash:f.approval.specHash});
  const report={mode:'FAKE_ONLY',liveEnabled:false,externalCalls:0,runId,releaseManifest:release.manifest,releaseHash:release.manifestHash,owner:lease.owner,operations,journal:journal.data,result};
  await mkdir('.local/runner-simulation/runs',{recursive:true});await writeFile(`.local/runner-simulation/runs/${runId}.json`,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));if(result.status!=='AWAITING_APPROVAL')process.exitCode=1;
}finally{await lease.release();await rm(root,{recursive:true,force:true});}
