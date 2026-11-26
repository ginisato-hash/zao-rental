import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateRelease,type ReleaseFacts} from '../../scripts/production-release-attest';
const S='a'.repeat(40),OLD='b'.repeat(40),ORIGIN='https://salomon-rental.yuge-zao.com';
const good=():ReleaseFacts=>({expectedSha:S,head:S,originMain:S,dirtyEntries:0,localProjectId:'prj_x',expectedProjectId:'prj_x',releaseIdValue:S,releaseIdUpdatedAt:1000,
 approvalValue:JSON.stringify({state:'PUBLICATION_APPROVED',origin:ORIGIN,releaseId:S,approvedBy:'owner',approvedAt:'2026-11-21T16:47:01Z'}),approvalUpdatedAt:1001,approvalOrigin:ORIGIN,
 deployment:{id:'dpl_1',projectId:'prj_x',target:'production',readyState:'READY',createdAt:2000},runtimeReleaseSha:S,aliasDeploymentId:'dpl_1'});
const fail=(f:ReleaseFacts,code:string)=>{const r=evaluateRelease(f);assert.equal(r.status,'FAIL');assert.ok(r.reasons.includes(code),code+' in '+r.reasons.join(','));};
test('a fully bound release passes',()=>{const r=evaluateRelease(good());assert.deepEqual(r.reasons,[]);assert.equal(r.status,'PASS');});
test('an old release value (update silently failed) fails',()=>fail({...good(),releaseIdValue:OLD},'RELEASE_ID_MISMATCH'));
test('an approval for another release, wrong state or wrong origin fails',()=>{
 for(const a of [{releaseId:OLD},{state:'PENDING'},{origin:'https://example.invalid'},{approvedBy:' '},{approvedAt:'nope'}]){const f=good();f.approvalValue=JSON.stringify({...JSON.parse(f.approvalValue!),...a});fail(f,'APPROVAL_MISMATCH');}
 fail({...good(),approvalValue:'not json'},'APPROVAL_MISMATCH');fail({...good(),approvalValue:null},'APPROVAL_MISMATCH');});
test('values written after the deployment, or never read, fail',()=>{fail({...good(),releaseIdUpdatedAt:3000},'RELEASE_ID_NOT_BEFORE_DEPLOYMENT');fail({...good(),approvalUpdatedAt:null},'APPROVAL_NOT_BEFORE_DEPLOYMENT');});
test('another project, a preview or unready deployment, or a missing deployment fails',()=>{
 fail({...good(),deployment:{...good().deployment!,projectId:'prj_other'}},'DEPLOYMENT_WRONG_PROJECT');fail({...good(),deployment:{...good().deployment!,target:null}},'DEPLOYMENT_NOT_PRODUCTION');
 fail({...good(),deployment:{...good().deployment!,readyState:'ERROR'}},'DEPLOYMENT_NOT_READY');fail({...good(),deployment:null},'DEPLOYMENT_EVIDENCE_MISSING');fail({...good(),localProjectId:'prj_other'},'PROJECT_LINK_MISMATCH');});
test('a dirty tree or a head that is not the accepted main fails',()=>{fail({...good(),dirtyEntries:2},'WORKTREE_DIRTY');fail({...good(),head:OLD},'SOURCE_NOT_ACCEPTED_MAIN');fail({...good(),originMain:OLD},'SOURCE_NOT_ACCEPTED_MAIN');});
test('a runtime that reports another build, is unbound, or an alias on another deployment fails',()=>{fail({...good(),runtimeReleaseSha:OLD},'RUNTIME_SHA_MISMATCH');fail({...good(),runtimeReleaseSha:null},'RUNTIME_SHA_MISMATCH');fail({...good(),aliasDeploymentId:'dpl_0'},'ALIAS_NOT_THIS_DEPLOYMENT');});
test('the report never carries any env value',()=>{const r=JSON.stringify(evaluateRelease({...good(),releaseIdValue:'secret-ish-value'}));assert.ok(!r.includes('secret-ish-value'));});
test('the release probe returns only a well-formed build commit id, otherwise UNBOUND, with no-store',async()=>{
 const {GET}=await import('../../apps/web/src/app/api/release/route');const keep=process.env.RELEASE_BUILD_SHA;
 try{
  process.env.RELEASE_BUILD_SHA=S;const ok=GET();assert.deepEqual(await ok.json(),{releaseSha:S});assert.match(ok.headers.get('cache-control')!,/no-store/);
  for(const bad of ['','xyz',S.toUpperCase(),S+'0','secret-value']){process.env.RELEASE_BUILD_SHA=bad;assert.deepEqual(await GET().json(),{releaseSha:'UNBOUND'});}
  delete process.env.RELEASE_BUILD_SHA;assert.deepEqual(await GET().json(),{releaseSha:'UNBOUND'});
 }finally{if(keep===undefined)delete process.env.RELEASE_BUILD_SHA;else process.env.RELEASE_BUILD_SHA=keep;}
});
