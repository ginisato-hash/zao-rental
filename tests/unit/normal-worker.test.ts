import test from 'node:test';
import assert from 'node:assert/strict';
import {normalWorkerPlan} from '../../packages/core/src/payment/normal-production-worker';
const now=Date.parse('2035-01-01T00:00:00Z');
const input={workerId:'normal-window',acceptedBookingsAfter:'2034-12-31T00:00:00Z',deadline:'2035-01-01T00:01:00Z',batchSize:20,notificationLimit:0,refundCreateLimit:0,refundBudgetJpy:0};
test('finite worker freezes an explicit plan without silently authorizing notifications or refunds',()=>{
 const plan=normalWorkerPlan(input,now);assert.deepEqual(plan,input);assert.ok(Object.isFrozen(plan));assert.notEqual(plan,input);
});
test('finite worker rejects old F2 scope, future cutoff, expired or unbounded time and excessive work',()=>{
 for(const patch of [
  {acceptedBookingsAfter:'2026-10-03T09:14:38Z'}, {acceptedBookingsAfter:'2035-01-02T00:00:00Z'},
  {deadline:'2035-01-01T00:00:00Z'}, {deadline:'2035-01-01T00:01:01Z'},
  {batchSize:0}, {batchSize:21}, {notificationLimit:21}, {refundCreateLimit:21}, {refundBudgetJpy:-1},
  {refundBudgetJpy:1.5}, {workerId:'unsafe id'}, {unknown:'unreviewed'},
 ])assert.throws(()=>normalWorkerPlan({...input,...patch},now));
});
