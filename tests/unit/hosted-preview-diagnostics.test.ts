import test from 'node:test';
import assert from 'node:assert/strict';
import {HostedPreviewStartupError,hostedPreviewStartupStages,hostedPreviewUnavailable,type HostedPreviewStartupStage} from '../../apps/web/src/lib/hosted-preview-diagnostics';
for(const stage of hostedPreviewStartupStages)test('startup failure exposes only fixed category '+stage,async()=>{
 const error=new HostedPreviewStartupError(stage);Object.assign(error,{cause:new Error('synthetic-private-cause'),password:'synthetic-private-password'});error.stack='synthetic-private-stack';
 const response=hostedPreviewUnavailable(error);assert.equal(response.status,503);assert.equal(response.headers.get('cache-control'),'private, no-store');
 assert.deepEqual(await response.json(),{error:'GUEST_PREVIEW_UNAVAILABLE',stage});
});
test('arbitrary exceptions and invalid stages never enter diagnostic response',async()=>{
 for(const error of [new Error('synthetic-private-exception'),{stage:'TLS',message:'synthetic-private-value'},new HostedPreviewStartupError('synthetic-private-stage' as HostedPreviewStartupStage),null]){
  assert.deepEqual(await hostedPreviewUnavailable(error).json(),{error:'GUEST_PREVIEW_UNAVAILABLE',stage:'UNCLASSIFIED'});
 }
});

test('boundary errors expose only allowlisted fixed stages, never rejected input/cause/stack',async()=>{
 const {HostedPreviewBoundaryError,hostedPreviewBoundaryStages,assertNoHostedPlatformContradiction,parseHostedPreview,hostedPreviewRequestOrigin}=await import('../../packages/auth/src/hosted-preview-config');
 for(const stage of hostedPreviewBoundaryStages){const e=new HostedPreviewBoundaryError(stage);Object.assign(e,{cause:new Error('synthetic-private-cause')});e.stack='synthetic-private-stack';assert.deepEqual(await hostedPreviewUnavailable(e).json(),{error:'GUEST_PREVIEW_UNAVAILABLE',stage});}
 for(const invoke of [()=>assertNoHostedPlatformContradiction({VERCEL:'synthetic-private-value'}),()=>parseHostedPreview('synthetic-private-json'),()=>hostedPreviewRequestOrigin(new Request('https://synthetic-private.invalid'))]){
  let failure:unknown;try{invoke();}catch(e){failure=e;}assert.ok(failure instanceof HostedPreviewBoundaryError);
  const response=await hostedPreviewUnavailable(failure).text();assert.equal(response.includes('synthetic-private'),false);assert.equal(response.includes('stack'),false);assert.equal(response.includes('cause'),false);
 }
 assert.deepEqual(await hostedPreviewUnavailable(new HostedPreviewBoundaryError('synthetic-private-invalid-stage' as never)).json(),{error:'GUEST_PREVIEW_UNAVAILABLE',stage:'UNCLASSIFIED'});
});
