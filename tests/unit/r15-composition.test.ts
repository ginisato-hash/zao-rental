import test from 'node:test';
import assert from 'node:assert/strict';
import {r15HostedComposition} from '../../packages/db/src/r15-hosted-composition';
import type {InboxPool,InboxConnection} from '../../packages/db/src/square-webhook-inbox';
import type {PaymentContext} from '../../packages/core/src/payment/payment-truth';
import type {LookupResult} from '../../packages/core/src/payment/payment-reconciliation';
import {id} from '../fixtures/payment-projection';
const env={VERCEL_ENV:'preview',VERCEL_PROJECT_ID:'prj_ehUMOzM77em9DVnHJBJffncD5hg7',R15_ACTIVATION_AUTHORITY:'P6_R15',SQUARE_ENVIRONMENT:'SANDBOX'};
const target={bookingId:id(1),attemptId:id(4),database:'zr_0123456789ab',paymentId:'r15-fixture-payment',locationId:'fixture-location'},merchantId='MLKDVEDH1ME21';
function fixture(amount=100){
 const sqls:string[]=[],values:unknown[][]=[],now=new Date();let reserved=false;
 const context:PaymentContext={expected:{attemptId:target.attemptId,bookingId:target.bookingId,idempotencyKey:id(5),merchantId,locationId:target.locationId,amountJpy:amount,currency:'JPY'},current:{state:'PENDING',providerId:target.paymentId,providerState:null,providerUpdatedAt:null},latest:null};
 const pool:InboxPool={async connect(){return {release(){},async query(sql:string,args:unknown[]=[]){sqls.push(sql);values.push(args);
  if(sql.includes('r15_activation.reserve')){const acquired=!reserved;reserved=true;return {rows:[{acquired}],rowCount:1};}
  const rows=sql.includes('dispatch_target')?[{n:1}]:sql.includes('claim_target')?[{claim:{id:id(9),environment:'SANDBOX',merchantId,paymentId:target.paymentId,generation:1,sourceEventId:'r15-fixture',sourceFingerprint:'a'.repeat(64),signalRevision:1,truthRevision:0,attempt:1,leaseOwner:'r15-finite',leaseToken:id(10),leaseExpiresAt:new Date(now.getTime()+60000),deadlineAt:new Date(now.getTime()+600000),latest:null}}]:sql.includes('load_context(')?[{context}]:sql.includes('finalize(')?[{ok:true}]:[];return {rows,rowCount:rows.length};
 }} as InboxConnection;}};
 return {pool,sqls,values,context};
}
for(const code of ['AUTH_BLOCKED','RATE_LIMITED','NETWORK_RETRYABLE'] as const)test('R15 finite worker never repeats provider '+code,async()=>{
 const f=fixture();let calls=0;const app=r15HostedComposition({dispatcher:f.pool,worker:f.pool,projector:f.pool,diagnostic:f.pool},env,target,{async lookupPayment(input):Promise<LookupResult>{calls++;assert.equal(input.paymentId,target.paymentId);assert.equal(input.expected.amountJpy,100);return {kind:'FAILED',code};}},'a'.repeat(64));
 const result=await app.runOnce();assert.equal(result.claimed,1);assert.equal(calls,1);await assert.rejects(app.runOnce(),/R15_WORKER_ALREADY_INVOKED_DO_NOT_RETRY/);assert.equal(calls,1);
 assert.ok(f.sqls.every(s=>!s.includes('payment_reconciliation.dispatch(')&&!s.includes('payment_reconciliation.claim(')));
 const values=f.values[f.sqls.findIndex(s=>s.includes('dispatch_target'))]!;assert.deepEqual(values,['SANDBOX',1,merchantId,target.paymentId]);
});
test('R15 amount mismatch stops before provider and does not project',async()=>{
 const f=fixture(101);let calls=0;const app=r15HostedComposition({dispatcher:f.pool,worker:f.pool,projector:f.pool,diagnostic:f.pool},env,target,{async lookupPayment(){calls++;throw Error('NO_LOOKUP');}},'a'.repeat(64));const result=await app.runOnce();assert.equal(calls,0);assert.equal(result.results[0]!.code,'PAYMENT_CONTEXT_MISSING');assert.equal(f.sqls.some(s=>s.includes('UPDATE rental_bookings')),false);
});

test('R15 a reconstructed composition cannot repeat the same GetPayment after response loss',async()=>{
 const f=fixture();let lookups=0;
 const reconstruct=()=>r15HostedComposition({dispatcher:f.pool,worker:f.pool,projector:f.pool,diagnostic:f.pool},env,target,{async lookupPayment(){lookups++;return {kind:'FAILED' as const,code:'NETWORK_RETRYABLE' as const};}},'a'.repeat(64));
 await reconstruct().runOnce();await reconstruct().runOnce();assert.equal(lookups,1);
});
