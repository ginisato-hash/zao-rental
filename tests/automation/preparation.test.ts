import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,existsSync} from 'node:fs';
import manifest from '../../docs/execution/E02_NEXT_DEMO.manifest.json';
import {readArguments,ReadOnlyGitHub,controllerReadEnvironment,validateCi,REPOSITORY,REPOSITORY_ID,WORKFLOW_ID,WORKFLOW_PATH,type CiPin,type Observations} from '../../tools/automation/preparation/github';
import {DEMO_PATHS,validateDemoLimits,nextStartDecision,implementationEnvironment,outerBoundaryReadiness,dispatchLive} from '../../tools/automation/preparation/gates';
const h=(c:string)=>c.repeat(40);
const pin:CiPin={repository:REPOSITORY,repositoryId:REPOSITORY_ID,workflowId:WORKFLOW_ID,workflowPath:WORKFLOW_PATH,workflowBlobSha:h('f'),pr:2,runId:123,attempt:2,base:h('a'),head:h('b'),merge:h('c'),tree:h('d')};
function fixture():Observations{
  const repo={id:REPOSITORY_ID,full_name:REPOSITORY};const run={repository:repo,head_repository:repo,id:123,run_attempt:2,workflow_id:WORKFLOW_ID,path:WORKFLOW_PATH,event:'pull_request',head_sha:pin.head,status:'completed',conclusion:'success'};
  return {repository:repo,pull:{number:2,head:{sha:pin.head,repo},base:{sha:pin.base,repo}},run,attempt:structuredClone(run),workflow:{id:WORKFLOW_ID,path:WORKFLOW_PATH,state:'active'},workflowBlob:{sha:pin.workflowBlobSha,path:WORKFLOW_PATH},merge:{sha:pin.merge,tree:{sha:pin.tree},parents:[{sha:pin.base},{sha:pin.head}]},head:{sha:pin.head,tree:{sha:pin.tree}}};
}
test('CI read attestation binds repo/workflow/event/head/merge/run/attempt, not a check name',()=>{
  const proof=validateCi(pin,fixture());assert.equal(proof.status,'VERIFIED_READ_ONLY');assert.equal(proof.writeAuthorizationProven,false);assert.equal(proof.liveDispatchProven,false);
  const cases:[keyof Observations,string,unknown][]=[['repository','id',42],['repository','full_name','other/project'],['workflow','id',42],['workflow','path','.github/workflows/attacker.yml'],['workflowBlob','sha',h('e')],['run','id',124],['run','run_attempt',3],['attempt','run_attempt',1],['run','workflow_id',42],['run','event','workflow_dispatch'],['attempt','head_sha',h('e')],['run','status','in_progress'],['run','conclusion','skipped'],['attempt','conclusion','neutral'],['merge','parents',[{sha:pin.head},{sha:pin.base}]],['merge','tree',{sha:h('e')}],['head','tree',{sha:h('e')}],['pull','head',{sha:h('e'),repo:{id:REPOSITORY_ID}}]];
  for(const [field,key,value] of cases){const data=fixture();(data[field] as Record<string,unknown>)[key]=value;assert.throws(()=>validateCi(pin,data),Error,`${field}.${key} was accepted`);}
  assert.throws(()=>validateCi({...pin,repositoryId:42},fixture()),/INVALID_TRUSTED_CI_PIN/);
});
test('read-only endpoint registry rejects arbitrary URL, method, SHA and action injection',()=>{
  assert.deepEqual(readArguments({kind:'attempt',id:123,attempt:2}),['api','--hostname','github.com','--method','GET',`repos/${REPOSITORY}/actions/runs/123/attempts/2`]);
  assert.throws(()=>readArguments({kind:'delete'} as never),/UNAPPROVED_READ_OPERATION/);
  assert.throws(()=>readArguments({kind:'commit',sha:'main?recursive=1'}),/INVALID_SHA/);
  assert.throws(()=>readArguments({kind:'pull',number:-1}),/INVALID_PR/);
  assert.throws(()=>readArguments({kind:'attempt',id:123,attempt:0}),/INVALID_ATTEMPT/);
});
test('auth/quota/malformed response halts the read session without a second request or raw error leakage',async()=>{
  for(const failure of ['HTTP 401 synthetic-sensitive-token','HTTP 403 rate limit','malformed']){
    let calls=0;const client=new ReadOnlyGitHub(async()=>{calls++;if(failure==='malformed')return '!json';throw new Error(failure);},{HOME:'/synthetic/home',PATH:'/usr/bin',NODE_ENV:'test'});
    await assert.rejects(client.get({kind:'repository'}),e=>e instanceof Error && e.message==='GITHUB_READ_FAILED_AUTH_QUOTA_NETWORK_OR_RESPONSE_REQUIRES_HUMAN_CHECK');
    await assert.rejects(client.get({kind:'repository'}),/READ_SESSION_STOPPED_NO_RETRY/);assert.equal(calls,1);
  }
});
test('host auth environment and implementation worker environment stay separate',()=>{
  const env=controllerReadEnvironment({HOME:'/synthetic/home',PATH:'/usr/bin',GH_TOKEN:'synthetic',GITHUB_TOKEN:'synthetic',ANTHROPIC_API_KEY:'synthetic',CLAUDE_CODE_OAUTH_TOKEN:'synthetic',NODE_OPTIONS:'untrusted',NODE_ENV:'test'});
  assert.deepEqual(Object.keys(env).sort(),['HOME','PATH']);
  assert.deepEqual(implementationEnvironment('/synthetic/scratch'),{PATH:'/usr/bin:/bin',LANG:'C.UTF-8',TMPDIR:'/synthetic/scratch'});
  assert.throws(()=>controllerReadEnvironment({NODE_ENV:'test'}),/CONTROLLER_HOME_REQUIRED/);
});
test('demo is limited to exact staff display/E2E paths and two CLI starts per model, with unknown outcomes stopping',()=>{
  assert.deepEqual(DEMO_PATHS,['apps/web/src/app/staff/page.tsx','tests/e2e/foundation.spec.ts']);
  const limits={codexCliStarts:2,claudeCliStarts:2,minutes:60,automaticMerge:false,extraCredits:false};
  validateDemoLimits(limits);assert.throws(()=>validateDemoLimits({...limits,codexCliStarts:3}),/LIMITS_CHANGED/);
  for(const kind of ['codex','claude'] as const){assert.equal(nextStartDecision(limits,kind,[]),'PLAN_ONLY_WITHIN_LIMIT');assert.equal(nextStartDecision(limits,kind,[{kind,status:'DONE'},{kind,status:'DONE'}]),'BLOCKED_CLI_START_LIMIT');
    for(const status of ['UNKNOWN','AUTH_ERROR','QUOTA_ERROR','CREDITS_ERROR'] as const)assert.equal(nextStartDecision(limits,kind,[{kind,status}]),'BLOCKED_RECONCILIATION_OR_AUTH_QUOTA');}
});
test('a tool installation or fake proof cannot enable the missing outer isolation or live adapter',()=>{
  for(const tools of [{docker:null},{docker:'/unverified/docker'}]){const status=outerBoundaryReadiness(tools);assert.equal(status.unattendedReady,false);assert.equal(status.state,'UNATTENDED_HOLD');}
  assert.throws(()=>dispatchLive(),/LIVE_NOT_IMPLEMENTED_OR_AUTHORIZED/);
});


test('next-task manifest binds exact paths/policy while remaining an unsigned, blocked two-start plan',()=>{
  assert.equal(manifest.executionAuthorized,false);assert.equal(manifest.status,'UNATTENDED_HOLD');
  assert.deepEqual(manifest.task.allowedFiles.map(f=>f.path),DEMO_PATHS);validateDemoLimits(manifest.limits);
  assert.match(manifest.startingBaseSha,/^[a-f0-9]{40}$/);assert.match(manifest.controller.sourceCommit,/^[a-f0-9]{40}$/);
  assert.equal(manifest.controller.sourceCommit,manifest.policy.sourceCommit);
  assert.equal(manifest.policy.signersProvisioned,false);assert.equal(manifest.policy.signedApprovalPresent,false);
  const policy=readFileSync(manifest.policy.sourcePath);assert.equal(createHash('sha256').update(policy).digest('hex'),manifest.policy.sha256);
  assert.equal(JSON.parse(policy.toString()).policy.enabled,false);
  for(const file of manifest.task.allowedFiles){assert.ok(existsSync(file.path));assert.match(file.baseSha256,/^[a-f0-9]{64}$/);}
  assert.equal(manifest.environment.outerBoundary.unattendedReady,false);assert.equal(manifest.usageRecording.liveLimiterWired,false);
  assert.equal(manifest.communication.modelCallsAuthorizedNow,0);assert.equal(manifest.communication.futureGithubOperationsAuthorized,false);assert.equal(manifest.evidence.githubWriteProof,false);
});
