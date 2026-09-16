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
