import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign, randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, readFile, mkdir, rm, realpath, symlink, chmod, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { exportController } from '../../scripts/export-controller';
import { acquireRepositoryLease, Journal, digest, repositoryState } from '../../tools/automation/controller/store';
import { runPreflight, once, validateReviewReceipt, type Adapter, type Operation, type Receipt } from '../../tools/automation/controller/engine';
import { runBounded } from '../../tools/automation/controller/process';
import { restrictedCommand, DisabledLiveAdapter } from '../../tools/automation/controller/adapters';
import { REVIEW_MAX_TURNS, staticReviewArgs } from '../../tools/automation/review-contract';
import { approvalBytes, commandPlan, type Approval, type Policy } from '../../tools/automation/runner';
const repo = process.cwd();
const head = 'b'.repeat(40), base = 'a'.repeat(40), spec = 'c'.repeat(64);
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c','user.name=Fixture','-c','user.email=fixture@invalid','-C',cwd,...args], { encoding: 'utf8', stdio: ['ignore','pipe','pipe'] }).trim();
async function fixture() {
  const root = await realpath(await mkdtemp(resolve(tmpdir(), 'zao-e02-test-'))); const candidate = resolve(root, 'candidate'); await mkdir(candidate);
  git(candidate, 'init','-b','main'); git(candidate, 'commit','--allow-empty','-m','test-only');
  const approver = generateKeyPairSync('ed25519'); const reviewer = generateKeyPairSync('ed25519');
  const policy: Policy = { enabled: false, autoMerge: false, production: false, paidApi: false, maxFixRounds: 2, maxMinutes: 60, approverPublicKey: approver.publicKey.export({ type:'spki',format:'pem' }).toString(), protectedPaths: ['tools/','.github/','docs/'], requiredChecks: ['foundation'] };
  const approval: Approval = { taskId: 'E02', status:'READY',baseSha:base,specHash:spec,allowedPaths:['apps/web/src/app/staff/page.tsx'],dependenciesMerged:true,expiresAt:new Date(Date.now()+3_600_000).toISOString() };
  const signed = { payload:approval,signature:sign(null,approvalBytes(approval),approver.privateKey).toString('base64') };
  const config = resolve(root,'policy-source.json'); await writeFile(config,JSON.stringify({ policy,reviewPublicKey:reviewer.publicKey.export({type:'spki',format:'pem'}).toString() }));
  const release = await exportController(repo, resolve(root,'release'),config);
  const runId = randomUUID();
  const lease = await acquireRepositoryLease(candidate,'E02',runId); const journal = await Journal.load(lease,'E02',digest(JSON.stringify(signed)),release.manifestHash);
  const review = {task_id:'E02',base_sha:base,head_sha:head,spec_hash:spec,verdict:'PASS',findings:[],checks_read:['foundation'],unverified:[]};
  const envelope = (value: unknown = review) => { const payload: Receipt['payload'] = {taskId:'E02',runId,baseSha:base,headSha:head,specHash:spec,snapshotHash:'d'.repeat(64),reviewHash:digest(JSON.stringify(value))}; return {review:value,snapshotHash:payload.snapshotHash,receipt:{payload,signature:sign(null,Buffer.from(JSON.stringify(payload)),reviewer.privateKey).toString('base64')}}; };
  const calls: Operation[] = []; const remote = new Map<string,unknown>();
  const adapter: Adapter = { mode:'FAKE', async invoke(op) { calls.push(op); let result: unknown;
    switch(op.kind) {
      case 'branch':result={branch:journal.data.branch};break;
      case 'push':result={head,branch:journal.data.branch};break;
      case 'implement':result={task_id:'E02',status:'READY_FOR_REVIEW',head_sha:head,base_sha:base,spec_hash:spec,changed_files:approval.allowedPaths,commands:[{command:'fake verify',exit_code:0,log_path:'fake.log'}],known_gaps:[],next_action:'review'};break;
      case 'verify':result={head,changed:approval.allowedPaths,exitCodes:[0],snapshotHash:'d'.repeat(64)};break;
      case 'draft':result={number:2,draft:true,head,base,branch:journal.data.branch};break;
      case 'observe':result={head,base,changed:approval.allowedPaths,pr:{number:2,draft:true,head,base,branch:journal.data.branch}};break;
      case 'ci':result={headSha:head,checks:{foundation:'success'},runId:'fake-ci-1'};break;
      case 'review':result=envelope();break;
    } remote.set(op.key,result); return result;
  },async reconcile(op){return remote.has(op.key)?{found:true,result:remote.get(op.key)}:{found:false};} };
  return {root,candidate,release,signed,policy,lease,journal,adapter,calls,remote,review,envelope,reviewer,runId,
    args:{journal,adapter,release,signed,worktree:candidate,specHash:spec},
    async cleanup(){try{await lease.release();}finally{await rm(root,{recursive:true,force:true});}}
  };
}
test('controller uses pinned policy, signed approval and reviewer receipt; stops without merging', async()=>{
  const f=await fixture();try{assert.equal((await runPreflight(f.args)).status,'AWAITING_APPROVAL');assert.equal(f.calls.length,9);
    assert.equal((await runPreflight(f.args)).status,'AWAITING_APPROVAL');assert.equal(f.calls.filter(x=>!['observe','ci'].includes(x.kind)).length,6,'resume creates no duplicate branch/PR/model');
    await assert.rejects(runPreflight({...f.args,adapter:new DisabledLiveAdapter()}),/LIVE_DISABLED/);
  }finally{await f.cleanup();}
});
test('candidate policy edits and forged reviewer receipts cannot self-approve',async()=>{
  const f=await fixture();try{
    await writeFile(resolve(f.candidate,'policy.json'),JSON.stringify({...f.policy,approverPublicKey:f.reviewer.publicKey.export({type:'spki',format:'pem'}).toString()}));
    const forged={...f.signed,signature:sign(null,approvalBytes(f.signed.payload),f.reviewer.privateKey).toString('base64')};
    await assert.rejects(runPreflight({...f.args,signed:forged}),/UNTRUSTED_APPROVAL/);assert.equal(f.calls.length,0);
    const e=f.envelope();e.review={...f.review,verdict:'PASS',findings:[]};e.receipt.signature='x'.repeat(88);
    assert.throws(()=>validateReviewReceipt(e,f.policy.approverPublicKey,e.receipt.payload),/UNTRUSTED_REVIEW/);
    await writeFile(resolve(f.release.directory,'policy.json'),'{}');
    await assert.rejects(runPreflight(f.args),/RELEASE_FILE_CHANGED/);assert.equal(f.calls.length,0);
  }finally{await f.cleanup();}
});
test('stale receipt, unknown review verdict and SHA mismatch all fail closed',async()=>{
  for(const mode of ['stale','unknown','sha']){const f=await fixture();try{
    const invoke=f.adapter.invoke.bind(f.adapter);f.adapter.invoke=async op=>{
      if(op.kind==='review'){const e=f.envelope({...f.review,verdict:mode==='unknown'?'APPROVED':'PASS'});if(mode==='stale')e.receipt.payload.headSha='e'.repeat(40);return e;}
      if(op.kind==='verify'&&mode==='sha')return {head:'e'.repeat(40),changed:f.signed.payload.allowedPaths,exitCodes:[0],snapshotHash:'d'.repeat(64)};return invoke(op);
    };assert.equal((await runPreflight(f.args)).status,'BLOCKED');
  }finally{await f.cleanup();}}
});
test('auth/quota errors are durable stops without repeated model invocations',async()=>{
  for(const text of ['401 authentication required','429 quota credits exhausted']){const f=await fixture();try{
    const invoke=f.adapter.invoke.bind(f.adapter);f.adapter.invoke=async op=>{if(op.kind==='implement'){f.calls.push(op);throw new Error(text);}return invoke(op);};
    assert.match((await runPreflight(f.args)).reason,/AUTH_BLOCKED|QUOTA_BLOCKED/);
    assert.match((await runPreflight(f.args)).reason,/UNKNOWN_EFFECT/);assert.equal(f.calls.filter(x=>x.kind==='implement').length,1);
  }finally{await f.cleanup();}}
});
test('INTENT recovery reconciles existing effects, never repeats an unknown branch/PR/model',async()=>{
  const f=await fixture();try{
    for(const kind of ['branch','draft','implement'] as const){const op={kind,key:'crash-'+kind,input:{branch:'codex/e02'}};
      f.journal.data.operations[op.key]={kind,state:'INTENT',inputHash:digest(JSON.stringify(op))};await f.journal.save();
      await assert.rejects(once(f.journal,f.adapter,op),/UNKNOWN_EFFECT/);assert.equal(f.calls.length,0);
      f.remote.set(op.key,{id:'existing-'+kind});assert.deepEqual(await once(f.journal,f.adapter,op),{id:'existing-'+kind});assert.equal(f.calls.length,0);
    }
  }finally{await f.cleanup();}
});
test('CI failure repairs at most twice; never invokes reviewer for failing CI',async()=>{
  const f=await fixture();try{const invoke=f.adapter.invoke.bind(f.adapter);f.adapter.invoke=async op=>op.kind==='ci'?{headSha:head,checks:{foundation:'failure'},runId:'failed'}:invoke(op);
    const result=await runPreflight(f.args);assert.equal(result.reason,'FIX_ROUND_LIMIT');assert.equal(f.journal.data.modelAttempts,3);assert.equal(f.journal.data.reviewAttempts,0);
  }finally{await f.cleanup();}
});
test('repository-wide lease is shared by separate worktree processes; stale time never steals it',async()=>{
  const f=await fixture();try{const second=resolve(f.root,'second');git(f.candidate,'worktree','add','-b','second',second);
    assert.equal((await repositoryState(second)).root,f.lease.state.root);
    const ownerFile=resolve(f.lease.state.root,'repository.lock/owner.json');const owner=JSON.parse(await readFile(ownerFile,'utf8'));owner.leaseUntil='2000-01-01';await writeFile(ownerFile,JSON.stringify(owner));
    const modulePath=resolve(repo,'tools/automation/controller/store.ts');
    const attempt=(cwd:string)=>new Promise<number|null>((done)=>{const child=spawn(process.execPath,['--import',resolve(repo,'node_modules/tsx/dist/loader.mjs'),'--input-type=module','-e',`import {acquireRepositoryLease} from ${JSON.stringify(modulePath)};try{await acquireRepositoryLease(process.cwd(),'E03','other');process.exit(0)}catch{process.exit(23)}`],{cwd,stdio:'ignore'});child.on('exit',done);});
    assert.deepEqual(await Promise.all([attempt(f.candidate),attempt(second)]),[23,23]);
  }finally{await f.cleanup();}
});
test('restricted command builder rejects shell/ref/environment injection',async()=>{
  const f=await fixture();try{const tools={git:'/usr/bin/git',gh:'/usr/bin/gh',codex:'/usr/bin/codex',claude:'/usr/bin/claude',npm:'/usr/bin/npm'};
    const reportPath=resolve(f.lease.state.root,'runs',f.runId,'report.md');await mkdir(resolve(reportPath,'..'),{recursive:true});await writeFile(reportPath,'controller report');
    const c={release:f.release,lease:f.lease,reportHash:digest('controller report'),root:f.candidate,branch:'codex/e02',base,head,taskSchema:resolve(f.release.directory,'task-result.schema.json'),report:reportPath,prompt:'inert',cleanEnv:{PATH:'/usr/bin:/bin'}};
    const p=await restrictedCommand('implement',tools,c);assert.equal(p.executable,tools.codex);assert.ok(p.args.includes('--ignore-user-config'));
    await assert.rejects(restrictedCommand('implement',tools,{...c,taskSchema:resolve(f.candidate,'attacker.schema.json')}),/UNTRUSTED_CONTROLLER_INPUT_PATH/);
    await assert.rejects(restrictedCommand('draft',tools,{...c,report:resolve(f.candidate,'attacker-report.md')}),/UNTRUSTED_CONTROLLER_REPORT_PATH/);
    await restrictedCommand('draft',tools,c);
    await assert.rejects(restrictedCommand('draft',tools,{...c,reportHash:'f'.repeat(64)}),/UNTRUSTED_CONTROLLER_REPORT_CONTENT/);
    await rm(reportPath);await symlink(resolve(f.candidate,'attacker-report.md'),reportPath);
    await assert.rejects(restrictedCommand('draft',tools,c),/UNTRUSTED_CONTROLLER_REPORT_CONTENT/);
    await assert.rejects(restrictedCommand('branch',tools,{...c,branch:'x; touch /tmp/no'}),/INVALID_COMMAND/);
    await assert.rejects(restrictedCommand('implement',tools,{...c,cleanEnv:{GH_TOKEN:'synthetic-never-sent'}}),/UNAPPROVED_CHILD_ENV/);
  }finally{await f.cleanup();}
});
async function waitFile(path:string){for(let i=0;i<100;i++){try{return JSON.parse(await readFile(path,'utf8')) as {parent:number;child:number};}catch{await new Promise(r=>setTimeout(r,20));}}throw new Error('Fixture did not start');}
function running(pid:number){try{const stat=execFileSync('/bin/ps',['-p',String(pid),'-o','stat='],{encoding:'utf8'}).trim();return !!stat&&!stat.startsWith('Z');}catch{return false;}}
test('timeout, cancel and worker crash kill the owned child/grandchild group and preserve unrelated process',async()=>{
  const f=await fixture();const unrelated=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
  try{for(const mode of ['timeout','cancel','crash']){
    const pidFile=resolve(f.candidate,'pids-'+mode);const abort=new AbortController();
    const promise=runBounded(f.release,process.execPath,{executable:process.execPath,args:[resolve(f.release.directory,'worker-probe.mjs'),'tree',pidFile,mode==='crash'?'crash':'wait'],cwd:f.candidate,env:{PATH:'/usr/bin:/bin'},stdin:''},mode==='timeout'?500:5000,abort.signal);
    const pids=await waitFile(pidFile);if(mode==='cancel')abort.abort();const result=await promise;assert.ok(!result.guardianEnvironmentKeys.includes('NODE_ENV'));assert.equal(result.reason,mode==='timeout'?'TIMEOUT':mode==='cancel'?'CANCEL':'EXIT');
    assert.equal(running(pids.parent),false);assert.equal(running(pids.child),false);assert.equal(running(unrelated.pid!),true);
  }}finally{unrelated.kill('SIGKILL');await f.cleanup();}
});
test('two worktree processes racing an empty repository lock produce exactly one owner',async()=>{
  const root=await realpath(await mkdtemp(resolve(tmpdir(),'zao-e02-race-')));const a=resolve(root,'a'),b=resolve(root,'b');await mkdir(a);git(a,'init','-b','main');git(a,'commit','--allow-empty','-m','fixture');git(a,'worktree','add','-b','b',b);
  const modulePath=resolve(repo,'tools/automation/controller/store.ts');
  const code=`import {acquireRepositoryLease} from ${JSON.stringify(modulePath)};process.send({ready:true});process.on('message',async m=>{if(m==='go'){try{const lease=await acquireRepositoryLease(process.cwd(),'E02',String(process.pid));process.send({won:true});process.once('message',async()=>{await lease.release();process.exit(0)});}catch{process.send({won:false});process.exit(23)}}});`;
  const children=[a,b].map(cwd=>spawn(process.execPath,['--import',resolve(repo,'node_modules/tsx/dist/loader.mjs'),'--input-type=module','-e',code],{cwd,stdio:['ignore','ignore','ignore','ipc']}));
  try{
    await Promise.all(children.map(c=>new Promise<void>(r=>c.once('message',()=>r()))));
    const outcomes=children.map(c=>new Promise<boolean>(r=>c.once('message',m=>r((m as {won:boolean}).won))));
    children.forEach(c=>c.send('go'));const won=await Promise.all(outcomes);assert.equal(won.filter(Boolean).length,1);
    const winner=children[won.findIndex(Boolean)]!;const exited=new Promise(r=>winner.once('exit',r));winner.send('release');await exited;
  }finally{for(const c of children)if(c.exitCode===null)c.kill('SIGKILL');await rm(root,{recursive:true,force:true});}
});
test('controller SIGKILL disconnects guardian and removes its worker descendants',async()=>{
  const f=await fixture();try{
    const pidFile=resolve(f.candidate,'parent-crash-pids');const config=JSON.stringify({release:f.release,node:process.execPath,plan:{executable:process.execPath,args:[resolve(f.release.directory,'worker-probe.mjs'),'tree',pidFile,'wait'],cwd:f.candidate,env:{PATH:'/usr/bin:/bin'},stdin:''}});
    const code=`import {runBounded} from ${JSON.stringify(resolve(f.release.directory,'controller.mjs'))};const c=${config};await runBounded(c.release,c.node,c.plan,5000);`;
    const parent=spawn(process.execPath,['--input-type=module','-e',code],{stdio:'ignore'});
    const pids=await waitFile(pidFile);parent.kill('SIGKILL');await new Promise(r=>parent.once('exit',r));
    for(let n=0;n<100&&(running(pids.parent)||running(pids.child));n++)await new Promise(r=>setTimeout(r,20));
    assert.equal(running(pids.parent),false);assert.equal(running(pids.child),false);
  }finally{await f.cleanup();}
});

test('one static review builder preserves restrictions and legacy review has no executable argv',async()=>{
  const f=await fixture();try{
    const tools={git:'/usr/bin/git',gh:'/usr/bin/gh',codex:'/usr/bin/codex',claude:'/usr/bin/claude',npm:'/usr/bin/npm'};
    const c={release:f.release,lease:f.lease,reportHash:'a'.repeat(64),root:f.candidate,branch:'codex/e02',base,head,taskSchema:resolve(f.release.directory,'task-result.schema.json'),report:'unused',prompt:'inert',cleanEnv:{PATH:'/usr/bin:/bin'}};
    const newer=(await restrictedCommand('review',tools,c)).args;const original=commandPlan(f.signed.payload,f.candidate,'ginisato-hash/zao-rental').find(x=>x.stage==='claude')!;
    assert.equal(original.argv,undefined);assert.equal(original.referenceOnly,true);
    const expected=['--safe-mode','-p','--tools','','--strict-mcp-config','--mcp-config','{"mcpServers":{}}','--setting-sources','','--disable-slash-commands','--no-session-persistence','--no-chrome','--permission-mode','dontAsk','--max-turns','3','--output-format','json'];
    assert.deepEqual(newer,expected);assert.deepEqual(staticReviewArgs(),expected);assert.equal(REVIEW_MAX_TURNS,3);
    const audit=staticReviewArgs('stream-json');assert.deepEqual(audit,[...expected.slice(0,-1),'stream-json','--verbose','--include-hook-events']);
    newer.splice(0,newer.length);assert.deepEqual(staticReviewArgs(),expected,'A caller cannot mutate shared restrictions');
    assert.throws(()=>staticReviewArgs('text' as 'json'),/UNSUPPORTED_REVIEW_OUTPUT/);
  }finally{await f.cleanup();}
});


test('push registry suppresses a candidate pre-push hook against a real local remote',async()=>{
  const f=await fixture();try{
    const bare=resolve(f.root,'local-remote.git');git(f.root,'init','--bare',bare);git(f.candidate,'remote','add','origin',bare);
    const actualHead=git(f.candidate,'rev-parse','HEAD');const sentinel=resolve(f.candidate,'hook-sentinel');
    const tools={git:await realpath(execFileSync('which',['git'],{encoding:'utf8'}).trim()),gh:'/usr/bin/gh',codex:'/usr/bin/codex',claude:'/usr/bin/claude',npm:'/usr/bin/npm'};
    const c={release:f.release,lease:f.lease,reportHash:'a'.repeat(64),root:f.candidate,branch:'codex/e02',base:actualHead,head:actualHead,taskSchema:resolve(f.release.directory,'task-result.schema.json'),report:'unused',prompt:'inert',cleanEnv:{PATH:'/usr/bin:/bin'}};
    const invoke=f.adapter.invoke.bind(f.adapter);let localPushes=0;
    f.adapter.invoke=async op=>{
      if(op.kind==='implement'){
        const hook=resolve(f.candidate,'.git/hooks/pre-push');await writeFile(hook,'#!/bin/sh\nprintf fixture > hook-sentinel\n');await chmod(hook,0o755);
      }
      if(op.kind==='push'){
        const command=await restrictedCommand('push',tools,c);
        const result=await runBounded(f.release,process.execPath,command,5000);
        assert.equal(result.exitCode,0,result.output);localPushes++;
        assert.equal(git(bare,'rev-parse','refs/heads/codex/e02'),actualHead);
        await assert.rejects(access(sentinel),{code:'ENOENT'});
      }
      return invoke(op);
    };
    assert.equal((await runPreflight(f.args)).status,'AWAITING_APPROVAL');assert.equal(localPushes,1);
    for(const kind of ['branch','push','observe'] as const){const args=(await restrictedCommand(kind,tools,c)).args;assert.deepEqual(args.slice(0,2),['-c','core.hooksPath=/dev/null']);}
    // Positive control: the same planted hook really executes without the registry protection.
    git(f.candidate,'-c','core.hooksPath=.git/hooks','push','origin','HEAD:refs/heads/hook-positive-control');
    assert.equal(await readFile(sentinel,'utf8'),'fixture');
  }finally{await f.cleanup();}
});
