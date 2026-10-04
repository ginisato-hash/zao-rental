import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import type {flowFixture} from '../flow/fixture';
import {pendingCommercialBookingFixture,syntheticMerchant} from '../fixtures/commercial-booking';
import {PaymentReconciliationWorker,type ReconciliationClaim,type PaymentReconciliationRepository,type PaymentContextReader} from '../../packages/core/src/payment/payment-reconciliation';
import {normalWorkerPlan,normalProjectionReference,runNormalProductionTick,type NormalProjectionCandidate} from '../../packages/core/src/payment/normal-production-worker';
import {PgProjectionTransaction} from '../../packages/db/src/internal/payment-projection';
import {decidePaymentProjection,verifyProjectionSource} from '../../packages/core/src/payment/payment-projection';
import {flowHash} from '../../packages/contracts/src/rental-flow';
import {BookingNotificationWorker} from '../../packages/core/src/notification/worker';
import {BookingRecovery} from '../../packages/core/src/guest/booking-recovery';
import {provisionNotificationRole} from '../../scripts/notification-roles';
import {provisionBookingAccessRole} from '../../scripts/booking-access-role';
import {CancellationRefundWorker} from '../../packages/core/src/payment/cancellation-refund-worker';
import {requestFor,variants} from '../inventory/fixture';
import {normalRefundCandidates} from '../../packages/db/src/normal-production-worker';

/** Real normal SQL/worker flow with fake lookup/delivery. Does not mint Production identity. */
export async function normalWorkerAcceptance(x:Awaited<ReturnType<typeof flowFixture>>){
 const previous=x.now().toISOString();await x.clock(new Date().toISOString());
 const since=new Date(Date.now()-1000).toISOString(),pool=x.db.pool;
 const notificationRole=await provisionNotificationRole(pool,x.db.identity),access=await provisionBookingAccessRole(pool,x.db.identity);
 try{
  await pool.query("SELECT set_config('zao.actor',$1,false),set_config('zao.reason','SYNTHETIC two-store worker stock',false)",[x.actor]);
  for(let i=0;i<2;i++)await pool.query(`INSERT INTO ledger_assets(id,variant_id,family,initial_store_id,store_id,status,bsl_status,bsl_evidence,notes,source_kind,source_document,source_locator) VALUES($1,$2,'SKI','ONSEN_BASE','ONSEN_BASE','AVAILABLE','NOT_APPLICABLE','','','SYNTHETIC','normal worker two-store fixture',$3)`,[randomUUID(),variants.ski,'normal-onsen-'+i]);
  const onsen={...requestFor('2035-10-11'),pickupStore:'ONSEN_BASE' as const,returnStore:'ONSEN_BASE' as const};
  const a=await pendingCommercialBookingFixture(x,'2035-10-10'),b=await pendingCommercialBookingFixture(x,'2035-10-11',onsen);
  const observations=new Map([a,b].map(v=>[v.observation.providerId,v.observation]));let lookups=0,sends=0,closed=0,refundCreates=0,refundLookups=0;
  for(const v of [a,b])await pool.query("SELECT square_webhook.receive_production($1,'payment.updated',$2,$3,$4)",['normal-'+randomUUID(),syntheticMerchant,v.observation.providerId,flowHash(v.observation)]);
  // Unbound/unknown identities never enter normal claim selection.
  await pool.query("SELECT square_webhook.receive_production($1,'payment.updated',$2,'unbound-normal-proof',$3)",['normal-'+randomUUID(),syntheticMerchant,'1'.repeat(64)]);
  const repository:PaymentReconciliationRepository={
   async dispatch(_e,n){return (await pool.query('SELECT payment_reconciliation.dispatch_normal($1,$2,$3) n',[syntheticMerchant,n,since])).rows[0].n;},
   async claimBatch(_e,id,n){return (await pool.query('SELECT payment_reconciliation.claim_normal($1,$2,$3,$4) v',[id,n,syntheticMerchant,since])).rows.map(({v})=>({...v,leaseExpiresAt:new Date(v.leaseExpiresAt),deadlineAt:new Date(v.deadlineAt)}));},
   async finalize(c,o){return (await pool.query('SELECT payment_reconciliation.finalize_production($1,$2,$3,$4,$5,$6,$7) ok',[c.id,c.leaseToken,c.truthRevision,o.state,o.code,o.retrySeconds,o.truth])).rows[0].ok;},diagnostics:async()=>[],
  };
  const contexts:PaymentContextReader={async load(c){return (await pool.query('SELECT payment_reconciliation.load_context_production($1,$2,$3) v',[c.environment,c.merchantId,c.paymentId])).rows[0].v;}};
  const worker=new PaymentReconciliationWorker(repository,contexts,{async lookupPayment(r){lookups++;const observation=observations.get(r.paymentId);assert.ok(observation);assert.equal(r.expected.locationId,observation.locationId);return {kind:'OBSERVED',observation};}});
  const notifications=new BookingNotificationWorker(notificationRole.notificationPool,x.origin,new BookingRecovery(access.accessPool,randomBytes(32),'normal-worker-fixture'),{async send(){sends++;return {state:'ACCEPTED',providerMessageId:'synthetic-normal-'+sends};}});
  const candidates=async(limit:number)=>(await pool.query<{v:NormalProjectionCandidate}>('SELECT payment_projection.normal_candidates($1,$2,$3) v',[syntheticMerchant,since,limit])).rows.map(r=>r.v);
  const project=async(candidate:NormalProjectionCandidate)=>{
   const ref=normalProjectionReference(candidate),c=await pool.connect();try{
    await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(71820600)');const tx=new PgProjectionTransaction(c,ref),state=await tx.load(),prior=await tx.prior(ref.observationFingerprint);
    if(prior){await tx.linkReplay(ref);await c.query('COMMIT');return {...prior.result,duplicate:true};}
    const now=await tx.time(),observed=verifyProjectionSource(ref,await tx.source(),now,'PRODUCTION'),result=await tx.persist(state,decidePaymentProjection(state,observed,now),ref,now);await c.query('COMMIT');return result;
   }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  };
  const plan=()=>normalWorkerPlan({workerId:'normal-proof',acceptedBookingsAfter:since,deadline:new Date(Date.now()+60000).toISOString(),batchSize:20,notificationLimit:20,refundCreateLimit:0,refundBudgetJpy:0});
  const ports={reconciliation:worker,candidates,project,notifications,refunds:{async dispatch(){refundCreates++;return {state:'UNKNOWN'};},async reconcile(){refundLookups++;return {state:'UNKNOWN'};}},refundCandidates:async()=>[{id:randomUUID(),amount_jpy:100,provider_id:null,dispatched_at:new Date(),state:'UNKNOWN'}],close:async()=>{closed++;}};
  const first=await Promise.all([runNormalProductionTick(plan(),ports),runNormalProductionTick(plan(),ports)]);
  assert.ok(first.every(r=>r.state==='COMPLETED'));assert.notEqual(a.locationId,b.locationId);assert.equal(lookups,2);assert.equal(sends,2);assert.equal(closed,2);
  await runNormalProductionTick(plan(),ports);assert.equal(lookups,2);assert.equal(sends,2);assert.equal(refundCreates,0);assert.equal(refundLookups,0);
  assert.equal((await pool.query('SELECT count(*)::int n FROM payment_projection.events WHERE booking_id=ANY($1::uuid[])',[[a.bookingId,b.bookingId]])).rows[0].n,2);
  assert.equal((await pool.query("SELECT count(*)::int n FROM payment_reconciliation.jobs WHERE payment_id='unbound-normal-proof'")).rows[0].n,0);
  console.log('PASS normal worker: two stores, two consumers and same-tick replay, durable truth → projection → notification once; unbound excluded; UNKNOWN refund never creates');

  const crash=await pendingCommercialBookingFixture(x,'2035-10-12');observations.set(crash.observation.providerId,crash.observation);
  await pool.query("SELECT square_webhook.receive_production($1,'payment.updated',$2,$3,$4)",['normal-'+randomUUID(),syntheticMerchant,crash.observation.providerId,flowHash(crash.observation)]);
  await repository.dispatch('PRODUCTION',20);const claims=await repository.claimBatch('PRODUCTION','crashed-consumer',20);assert.equal(claims.length,1);
  assert.equal((await repository.claimBatch('PRODUCTION','second-consumer',20)).length,0);
  await pool.query("UPDATE payment_reconciliation.jobs SET lease_expires_at=statement_timestamp()-interval '1 second',claim_after=statement_timestamp()-interval '1 second' WHERE id=$1",[claims[0]!.id]);
  await runNormalProductionTick(plan(),ports);assert.equal(lookups,3);assert.equal(sends,3);
  assert.equal(await repository.finalize(claims[0]!,{state:'BLOCKED',code:'AUTH_BLOCKED',retrySeconds:null,truth:null}),false);
  console.log('PASS normal worker: claim crash recovers with a new lease; stale finalize rejected; no duplicate projection/notification');

  const claim={...claims[0]!,id:randomUUID(),leaseExpiresAt:new Date(Date.now()+60000),deadlineAt:new Date(Date.now()+120000)} as ReconciliationClaim;
  let mismatchedCalls=0;
  const mismatched=new PaymentReconciliationWorker({...repository,dispatch:async()=>0,claimBatch:async()=>[claim],finalize:async()=>true},{async load(){const context=await contexts.load(claim);return context?{...context,expected:{...context.expected,merchantId:'wrong-merchant'}}:null;}},{async lookupPayment(){mismatchedCalls++;throw Error('MUST_NOT_CALL');}});
  await mismatched.runOnce('PRODUCTION','mismatch-proof',1);assert.equal(mismatchedCalls,0);
  assert.equal((await notificationRole.notificationPool.query('SELECT * FROM notification_due_normal($1,20)',[new Date(Date.now()+86400000).toISOString()])).rowCount,0);
  let continues=0,deadlineLookups=0;
  const deadlineWorker=new PaymentReconciliationWorker({...repository,dispatch:async()=>0,claimBatch:async()=>[claim,claim],finalize:async()=>true},contexts,{async lookupPayment(){deadlineLookups++;throw Error('SYNTHETIC_STOP');}});
  const stopped=await deadlineWorker.runOnce('PRODUCTION','deadline-proof',2,()=>++continues<=3);
  assert.equal(stopped.results.length,1);assert.equal(deadlineLookups,1);
  const failedPorts={...ports,reconciliation:{async runOnce(){throw Error('SYNTHETIC_STOP');}}};const beforeClose=closed;await assert.rejects(runNormalProductionTick(plan(),failedPorts));assert.equal(closed,beforeClose+1);
  console.log('PASS normal worker: identity mismatch before provider, cutoff isolation, exception cleanup; real Provider calls 0');
  const refundable=await x.draft(undefined,requestFor('2035-10-13'),{reason:'SYNTHETIC refund state-machine fixture'});
  await x.service.startPayment(refundable.booking.id,randomUUID());const preview=await x.service.cancellationPreview(refundable.booking.id);
  await x.service.cancel(refundable.booking.id,randomUUID(),preview.previewHash);
  let posts=0;
  const refundWorker=new CancellationRefundWorker(x.flow.flowPool,{kind:'SIMULATED_DEV',async create(){posts++;throw Error('SYNTHETIC_ACCEPTANCE_UNKNOWN');},async lookup(){throw Error('UNBOUND_LOOKUP_FORBIDDEN');}});
  const refundPorts={...ports,refunds:refundWorker,refundCandidates:async()=>(await pool.query('SELECT id,amount_jpy,provider_id,dispatched_at,state FROM booking_cancellation_refunds WHERE booking_id=$1',[refundable.booking.id])).rows};
  const refundablePlan=()=>({...plan(),refundCreateLimit:1,refundBudgetJpy:100000});
  await Promise.all([runNormalProductionTick(refundablePlan(),refundPorts),runNormalProductionTick(refundablePlan(),refundPorts)]);
  await runNormalProductionTick(refundablePlan(),refundPorts);assert.equal(posts,1);
  assert.equal((await refundPorts.refundCandidates())[0].state,'UNKNOWN');
  console.log('PASS normal worker: real refund durable claim with two consumers and response loss; one fake POST, UNKNOWN never resent');
  for(const booking of [a,b]){const c=await pool.connect();try{await c.query('BEGIN');await c.query("SELECT set_config('zao.actor',$1,true)",[x.actor]);const preview=(await c.query('SELECT booking_cancellation_preview($1) v',[booking.bookingId])).rows[0].v;await c.query('SELECT booking_cancel($1,$2,$3)',[booking.bookingId,randomUUID(),preview]);await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
  const refunds=(await pool.query('SELECT id,booking_id FROM booking_cancellation_refunds WHERE booking_id=ANY($1::uuid[]) ORDER BY created_at,id',[[a.bookingId,b.bookingId]])).rows;
  assert.equal(refunds.length,2);await pool.query('SELECT cancellation_refund_claim($1)',[refunds[0].id]);
  let actionablePosts=0;
  const actionablePorts={...ports,notifications:null,refundCandidates:(limit:number)=>normalRefundCandidates(pool,syntheticMerchant,[a.locationId,b.locationId],since,limit),refunds:{async dispatch(id:string){const claimed=(await pool.query('SELECT cancellation_refund_claim($1) v',[id])).rows[0].v;if(claimed){actionablePosts++;return {state:'UNKNOWN'};}return {state:'NOT_CLAIMED'};},async reconcile(){throw Error('UNKNOWN_WITHOUT_ID_MUST_NOT_LOOKUP');}}};
  const actionablePlan=()=>({...plan(),batchSize:1,notificationLimit:0,refundCreateLimit:1,refundBudgetJpy:100000});
  await Promise.all([runNormalProductionTick(actionablePlan(),actionablePorts),runNormalProductionTick(actionablePlan(),actionablePorts)]);
  await runNormalProductionTick(actionablePlan(),actionablePorts);
  assert.equal(actionablePosts,1,'older unbound UNKNOWN must not starve the later PENDING refund');
  assert.deepEqual((await pool.query('SELECT state,provider_id FROM booking_cancellation_refunds WHERE id=ANY($1::uuid[])',[refunds.map(r=>r.id)])).rows,[{state:'UNKNOWN',provider_id:null},{state:'UNKNOWN',provider_id:null}]);
  console.log('PASS normal worker: batch1 skips older unbound UNKNOWN, later PENDING is claimed once across two consumers/two ticks; no UNKNOWN resend');
 }finally{await notificationRole.close();await access.close();await x.clock(previous);}
}
