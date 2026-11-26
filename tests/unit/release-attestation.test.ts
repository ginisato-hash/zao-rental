import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {evaluateRelease,collect,main,PINNED_PROJECT_ID,PINNED_TEAM_ID,PINNED_APPROVER,PRODUCTION_ORIGIN,type ReleaseFacts,type Exec,type Mode} from '../../scripts/production-release-attest';
import {buildDigestFromTree} from '../../scripts/lib/build-manifest.cjs';
const PREV='dpl_'+'p'.repeat(24),S='a'.repeat(40),OLD='b'.repeat(40),D='c'.repeat(64),D2='d'.repeat(64);
const good=(mode:Mode='stage'):ReleaseFacts=>({mode,expectedSha:S,head:S,originMain:S,dirtyEntries:0,localProjectId:PINNED_PROJECT_ID,localTeamId:PINNED_TEAM_ID,pinnedProjectId:PINNED_PROJECT_ID,pinnedTeamId:PINNED_TEAM_ID,
 releaseIdValue:S,releaseIdUpdatedAt:1000,approvalValue:JSON.stringify({state:'PUBLICATION_APPROVED',origin:PRODUCTION_ORIGIN,releaseId:S,approvedBy:PINNED_APPROVER,approvedAt:'2026-11-21T16:47:01Z'}),approvalUpdatedAt:1001,
 approvalOrigin:PRODUCTION_ORIGIN,pinnedApprover:PINNED_APPROVER,deployment:{id:'dpl_'+'1'.repeat(24),projectId:PINNED_PROJECT_ID,target:'production',readyState:'READY',createdAt:2000},
 runtimeReleaseSha:S,runtimeBuildDigest:D,localBuildDigest:D,aliasDeploymentId:mode==='stage'?PREV:'dpl_'+'1'.repeat(24),previousAliasId:PREV});
const fail=(f:ReleaseFacts,code:string)=>{const r=evaluateRelease(f);assert.equal(r.status,'FAIL');assert.ok(r.reasons.includes(code),code+' in '+r.reasons.join(','));};
test('a correct --skip-domain stage passes in stage mode and a promoted release passes in post mode',()=>{assert.deepEqual(evaluateRelease(good('stage')).reasons,[]);assert.deepEqual(evaluateRelease(good('post')).reasons,[]);});
test('stage and post are not interchangeable: stage with the alias already moved, post before promote, or an unknown alias fail',()=>{
 fail({...good('stage'),aliasDeploymentId:'dpl_'+'1'.repeat(24)},'STAGE_ALIAS_NOT_RECORDED_PREVIOUS');fail({...good('stage'),aliasDeploymentId:null},'STAGE_ALIAS_NOT_RECORDED_PREVIOUS');fail({...good('stage'),aliasDeploymentId:'dpl_'+'z'.repeat(24)},'STAGE_ALIAS_NOT_RECORDED_PREVIOUS');
 fail({...good('post'),aliasDeploymentId:PREV},'ALIAS_NOT_THIS_DEPLOYMENT');
 fail({...good('stage'),previousAliasId:'nope'},'PREVIOUS_ALIAS_INVALID');fail({...good('post'),previousAliasId:'dpl_'+'1'.repeat(24)},'PREVIOUS_ALIAS_INVALID');});
test('an old release value (update silently failed) fails',()=>fail({...good(),releaseIdValue:OLD},'RELEASE_ID_MISMATCH'));
test('an approval for another release, another approver, wrong state or origin fails',()=>{
 for(const a of [{releaseId:OLD},{state:'PENDING'},{origin:'https://example.invalid'},{approvedBy:'someone-else'},{approvedAt:'nope'}]){const f=good();f.approvalValue=JSON.stringify({...JSON.parse(f.approvalValue!),...a});fail(f,'APPROVAL_MISMATCH');}
 fail({...good(),approvalValue:'not json'},'APPROVAL_MISMATCH');fail({...good(),approvalValue:null},'APPROVAL_MISMATCH');});
test('values written after the deployment, or never read, fail',()=>{fail({...good(),releaseIdUpdatedAt:3000},'RELEASE_ID_NOT_BEFORE_DEPLOYMENT');fail({...good(),approvalUpdatedAt:null},'APPROVAL_NOT_BEFORE_DEPLOYMENT');});
test('another project, a preview or unready deployment, or a missing deployment fails',()=>{
 fail({...good(),deployment:{...good().deployment!,projectId:'prj_other'}},'DEPLOYMENT_WRONG_PROJECT');fail({...good(),deployment:{...good().deployment!,target:null}},'DEPLOYMENT_NOT_PRODUCTION');
 fail({...good(),deployment:{...good().deployment!,readyState:'ERROR'}},'DEPLOYMENT_NOT_READY');fail({...good(),deployment:null},'DEPLOYMENT_EVIDENCE_MISSING');
 fail({...good(),localProjectId:'prj_other'},'PROJECT_LINK_MISMATCH');fail({...good(),localTeamId:'team_other'},'PROJECT_LINK_MISMATCH');});
test('a dirty tree or a head that is not the accepted main fails',()=>{fail({...good(),dirtyEntries:2},'WORKTREE_DIRTY');fail({...good(),head:OLD},'SOURCE_NOT_ACCEPTED_MAIN');fail({...good(),originMain:OLD},'SOURCE_NOT_ACCEPTED_MAIN');});
test('a runtime reporting another commit, an unbound/unbuilt runtime, or a different artifact digest fails even with the right commit id',()=>{
 fail({...good(),runtimeReleaseSha:OLD},'RUNTIME_SHA_MISMATCH');fail({...good(),runtimeReleaseSha:null},'RUNTIME_SHA_MISMATCH');
 fail({...good(),runtimeBuildDigest:D2},'BUILD_DIGEST_MISMATCH');fail({...good(),runtimeBuildDigest:'UNBUILT'},'BUILD_DIGEST_MISMATCH');fail({...good(),runtimeBuildDigest:null},'BUILD_DIGEST_MISMATCH');});
test('the report never carries any env value',()=>{const r=JSON.stringify(evaluateRelease({...good(),releaseIdValue:'secret-ish-value'}));assert.ok(!r.includes('secret-ish-value'));});
// collect() integration with a fake runner: the comparison must not be self-referential.
function fake(over:{localLink?:{projectId:string;orgId:string};apiProject?:string;digest?:string;runtimeDigest?:string;remote?:string;head?:string}={}):Exec&{paths:string[]}{
 const paths:string[]=[];const link=over.localLink??{projectId:PINNED_PROJECT_ID,orgId:PINNED_TEAM_ID};
 return {paths,readText:()=>JSON.stringify(link),digest:()=>over.digest??D,run:(cmd,args)=>{
  if(cmd==='git'){if(args[0]==='rev-parse')return (over.head??S)+'\n';if(args[0]==='ls-remote')return (over.remote??S)+'\trefs/heads/main\n';return '';}
  const a=args.join(' ');
  if(args[2]?.startsWith('/v9/projects/')&&args[2].includes('/env?')){paths.push(args[2]);return JSON.stringify({envs:[{id:'e1',key:'PRODUCTION_RELEASE_ID',target:['production'],updatedAt:1000},{id:'e2',key:'PRODUCTION_PUBLICATION_APPROVAL',target:['production'],updatedAt:1001}]});}
  if(args[2]?.startsWith('/v1/projects/')){paths.push(args[2]);return JSON.stringify({value:args[2].endsWith('/e1')?S:good().approvalValue});}
  if(args[2]?.startsWith('/v13/deployments/'))return JSON.stringify({id:'dpl_'+'1'.repeat(24),projectId:over.apiProject??PINNED_PROJECT_ID,target:'production',readyState:'READY',createdAt:2000});
  if(args[2]?.startsWith('/v4/aliases/'))return JSON.stringify({deploymentId:PREV});
  if(args[1]==='curl')return JSON.stringify({releaseSha:S,buildDigest:over.runtimeDigest??D});
  throw new Error('unexpected '+a);}};
}
test('collect: a normal stage passes and every API path uses the pinned project id',()=>{
 const x=fake();const f=collect('/x','dpl_'+'1'.repeat(24),'stage',PREV,x);assert.deepEqual(evaluateRelease(f).reasons,[]);assert.ok(x.paths.length>=3&&x.paths.every(p=>p.includes(PINNED_PROJECT_ID)));});
test('collect: a different project linked locally cannot make the comparison pass (not self-referential)',()=>{
 const x=fake({localLink:{projectId:'prj_other',orgId:PINNED_TEAM_ID},apiProject:'prj_other'});const r=evaluateRelease(collect('/x','dpl_'+'1'.repeat(24),'stage',PREV,x));
 assert.ok(r.reasons.includes('PROJECT_LINK_MISMATCH')&&r.reasons.includes('DEPLOYMENT_WRONG_PROJECT'),r.reasons.join());assert.ok(x.paths.every(p=>p.includes(PINNED_PROJECT_ID)));});
test('collect: same commit id but a different artifact (digest differs) and a stale remote main both fail',()=>{
 assert.ok(evaluateRelease(collect('/x','dpl_'+'1'.repeat(24),'stage',PREV,fake({runtimeDigest:D2}))).reasons.includes('BUILD_DIGEST_MISMATCH'));
 assert.ok(evaluateRelease(collect('/x','dpl_'+'1'.repeat(24),'stage',PREV,fake({remote:OLD}))).reasons.includes('SOURCE_NOT_ACCEPTED_MAIN'));});
test('main refuses an unknown mode or a malformed deployment id before any command runs',()=>{
 for(const argv of [[],['dpl_'+'1'.repeat(24)],['stage','dpl_'+'1'.repeat(24)],['promote','dpl_'+'1'.repeat(24),PREV],['stage','nope',PREV],['stage','dpl_'+'1'.repeat(24),'x'],['stage','dpl_'+'1'.repeat(24),PREV,'extra']])assert.throws(()=>main(argv,'/x',fake()),/RELEASE_ATTEST_ARGUMENTS_REJECTED/);});
test('the build manifest digest follows file content and path, and ignores node_modules and .next',()=>{
 const root=mkdtempSync(join(tmpdir(),'zao-manifest-'));try{
  mkdirSync(join(root,'apps/web/src'),{recursive:true});mkdirSync(join(root,'packages/a/node_modules/x'),{recursive:true});writeFileSync(join(root,'package.json'),'{}');writeFileSync(join(root,'apps/web/src/a.ts'),'1');
  const d1=buildDigestFromTree(root);writeFileSync(join(root,'packages/a/node_modules/x/i.js'),'ignored');assert.equal(buildDigestFromTree(root),d1);
  writeFileSync(join(root,'apps/web/src/a.ts'),'2');assert.notEqual(buildDigestFromTree(root),d1);
  const d2=buildDigestFromTree(root);writeFileSync(join(root,'apps/web/src/b.ts'),'');assert.notEqual(buildDigestFromTree(root),d2);
 }finally{rmSync(root,{recursive:true,force:true});}});
test('the release probe returns only well-formed ids, otherwise UNBOUND/UNBUILT, with no-store',async()=>{
 const {GET}=await import('../../apps/web/src/app/api/release/route');const keep={s:process.env.RELEASE_BUILD_SHA,d:process.env.RELEASE_BUILD_DIGEST};
 try{
  process.env.RELEASE_BUILD_SHA=S;process.env.RELEASE_BUILD_DIGEST=D;const ok=GET();assert.deepEqual(await ok.json(),{releaseSha:S,buildDigest:D});assert.match(ok.headers.get('cache-control')!,/no-store/);
  for(const bad of ['','xyz',S.toUpperCase(),S+'0','secret-value']){process.env.RELEASE_BUILD_SHA=bad;process.env.RELEASE_BUILD_DIGEST=bad;assert.deepEqual(await GET().json(),{releaseSha:'UNBOUND',buildDigest:'UNBUILT'});}
  delete process.env.RELEASE_BUILD_SHA;delete process.env.RELEASE_BUILD_DIGEST;assert.deepEqual(await GET().json(),{releaseSha:'UNBOUND',buildDigest:'UNBUILT'});
 }finally{for(const [k,v] of [['RELEASE_BUILD_SHA',keep.s],['RELEASE_BUILD_DIGEST',keep.d]] as const){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
});
