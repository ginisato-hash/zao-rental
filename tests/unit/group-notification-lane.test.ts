import test from 'node:test';
import assert from 'node:assert/strict';
import {runGroupNotificationLane} from '../../packages/core/src/group/notification-lane';

// The group-notice lane of the production tick: closed unless the Owner opened it AND a worker exists AND time remains. Synthetic fakes only.
const future=new Date(Date.now()+30_000);
function fake(result:{state:'PROCESSED'|'UNCONNECTED';processed:number}={state:'PROCESSED',processed:2}){const calls:Array<{limit:number;deadline:Date}>=[];return {calls,worker:{runBatch:async(limit?:number,deadline?:Date)=>{calls.push({limit:limit!,deadline:deadline!});return result;}} as never};}

test('limit 0 (the unset default) closes the lane: the worker is never asked, nothing is sent, nothing is reported',async()=>{
 const f=fake();assert.equal(await runGroupNotificationLane(f.worker,0,future),null);assert.equal(f.calls.length,0);
 assert.equal(await runGroupNotificationLane(null,0,future),null);
});
test('an open lane with no worker (no ready group pool or no approved mail binding) reports UNCONNECTED and sends nothing',async()=>{
 assert.deepEqual(await runGroupNotificationLane(null,5,future),{state:'UNCONNECTED',processed:0});
});
test('a passed tick deadline sends nothing',async()=>{
 const f=fake();assert.deepEqual(await runGroupNotificationLane(f.worker,5,new Date(1000),()=>2000),{state:'NOT_RUN',processed:0});assert.equal(f.calls.length,0);
});
test('an open lane runs exactly one bounded batch with the Owner limit and the tick deadline',async()=>{
 const f=fake();assert.deepEqual(await runGroupNotificationLane(f.worker,7,future),{state:'PROCESSED',processed:2});
 assert.deepEqual(f.calls,[{limit:7,deadline:future}]);
 assert.deepEqual(await runGroupNotificationLane(fake({state:'UNCONNECTED',processed:0}).worker,1,future),{state:'UNCONNECTED',processed:0},'an unconnected delivery adapter is reported, never treated as sent');
});
test('a limit outside 0-20 or not an integer stops the tick before anything runs',async()=>{
 const f=fake();for(const bad of [-1,21,1.5,Number.NaN,Number.MAX_SAFE_INTEGER+1])await assert.rejects(runGroupNotificationLane(f.worker,bad,future),/NORMAL_WORKER_BATCH_REJECTED/,String(bad));
 assert.equal(f.calls.length,0);
});
