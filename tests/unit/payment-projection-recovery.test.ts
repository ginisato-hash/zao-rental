import {test} from 'node:test';
import assert from 'node:assert/strict';
import {flowHash} from '../../packages/contracts/src/rental-flow';
import {PaymentReconciliationWorker,type JobOutcome,type ReconciliationClaim} from '../../packages/core/src/payment/payment-reconciliation';
import type {PaymentContext} from '../../packages/core/src/payment/payment-truth';
import {TransactionalPaymentProjection} from '../../packages/core/src/payment/payment-projection';
import {PgPaymentProjection} from '../../packages/db/src/payment-projection';
import {ReconciliationFixture} from '../fixtures/payment-reconciliation';
import {stateFixture,observation,reference,ProjectionSqlFixture} from '../fixtures/payment-projection';

// Explicit test-only composition. The worker/provider/store are fixtures; no HTTP or PostgreSQL.
class CapturedTruthFixture extends ReconciliationFixture{
 saved=new Map<string,NonNullable<JobOutcome['truth']>>();
 override async finalize(c:ReconciliationClaim,o:JobOutcome){
  const committed=await super.finalize(c,o);
  if(committed&&o.truth)this.saved.set(c.id,o.truth);
  return committed;
 }
}
function composition(){
 const store=new CapturedTruthFixture(),db=new ProjectionSqlFixture(),s=stateFixture(),o=observation();let reads=0;
 const context:PaymentContext={expected:s.attempt.expected,current:{state:'PENDING',providerId:o.providerId,providerState:null,providerUpdatedAt:null},latest:null};
 const worker=new PaymentReconciliationWorker(store,{load:async()=>context},{lookupPayment:async()=>{reads++;return {kind:'OBSERVED',observation:o};}},store.now,()=>0.5,async run=>run(new AbortController().signal));
 const projector=new TransactionalPaymentProjection(new PgPaymentProjection(db));
 const signal=(eventId:string)=>({environment:'SANDBOX' as const,eventId,type:'payment.updated' as const,merchantId:o.merchantId,paymentId:o.providerId,bodySha256:flowHash({eventId})});
 function handoff(jobId:string){
  const job=store.jobs.get(jobId)!,truth=store.saved.get(jobId)!,stream=store.truth.get('SANDBOX/'+o.merchantId+'/'+o.providerId)!;
  db.now=store.now();db.world.src={jobId,environment:'SANDBOX',merchantId:job.merchantId,paymentId:job.paymentId,state:job.state,securityBlocked:job.security,truthRevision:stream.revision,decision:truth.decision,decisionFingerprint:truth.fingerprint,contextFingerprint:truth.contextFingerprint,observation:stream.latest};
  return reference(db.world.src);
 }
 return {store,db,worker,projector,signal,handoff,reads:()=>reads};
}
test('R12 lease recovery plus R13 response loss: one confirmation and one journal/history set',async()=>{
 const c=composition();await c.store.receive(c.signal('lease-crash'));
 c.store.failFinalize=true;await assert.rejects(c.worker.runOnce('SANDBOX','first'),/RECONCILIATION_STORAGE_UNAVAILABLE/);
 assert.equal(c.store.saved.size,0);assert.equal(c.db.world.b.state,'PAYMENT_PENDING');
 c.db.world.src.state='CLAIMED';await assert.rejects(c.projector.project(reference(c.db.world.src)),{code:'PROJECTION_SOURCE_NOT_ACCEPTED'});
 assert.equal(c.db.world.events.length,0);
 c.store.failFinalize=false;c.store.advance(60);const saved=await c.worker.runOnce('SANDBOX','recovery');
 assert.equal(c.reads(),2);assert.equal(saved.results[0]?.decision,'ACCEPT_COMPLETED');
 const ref=c.handoff(saved.results[0]!.id);c.db.loseCommitResponse=true;
 await assert.rejects(c.projector.project(ref),{code:'PROJECTION_STORAGE_UNAVAILABLE'});
 assert.equal(c.db.world.b.state,'CONFIRMED_DEV');assert.equal((await c.projector.project(ref)).duplicate,true);
 assert.equal(c.db.world.events.length,1);assert.equal(c.db.world.receipts.length,1);assert.equal(c.db.world.history.length,3);
 assert.equal(c.db.world.notifications.length,0);
 // A subsequent R12 generation sees the identical truth; it gets a receipt, not another projection.
 await c.store.receive(c.signal('later-duplicate'));const again=await c.worker.runOnce('SANDBOX','later');
 assert.equal(again.results[0]?.decision,'NOOP_DUPLICATE');
 assert.equal((await c.projector.project(c.handoff(again.results[0]!.id))).duplicate,true);
 assert.equal(c.db.world.events.length,1);assert.equal(c.db.world.receipts.length,2);assert.equal(c.db.world.history.length,3);
});
test('R12 truth is already durable when R13 stops before its transaction; explicit handoff recovers',async()=>{
 const c=composition();await c.store.receive(c.signal('pre-transaction'));const done=await c.worker.runOnce('SANDBOX','truth-only');
 const ref=c.handoff(done.results[0]!.id);assert.equal(c.db.world.b.state,'PAYMENT_PENDING');assert.equal(c.db.world.events.length,0);
 assert.equal(c.store.jobs.get(ref.jobId)?.state,'RECONCILED'); // evidence terminal, not booking terminal
 c.db.failAt='BEGIN';await assert.rejects(c.projector.project(ref),{code:'PROJECTION_STORAGE_UNAVAILABLE'});
 assert.equal(c.db.world.history.length,0);assert.equal(c.store.saved.size,1);c.db.failAt=null;
 assert.equal((await c.projector.project(ref)).decision,'APPLY_COMPLETED');assert.equal(c.reads(),1);
});
