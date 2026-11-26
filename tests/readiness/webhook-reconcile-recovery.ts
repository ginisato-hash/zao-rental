import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {flowFixture} from '../flow/fixture';
import {pendingCommercialBookingFixture,syntheticMerchant} from '../fixtures/commercial-booking';
import {PaymentReconciliationWorker,type PaymentContextReader,type PaymentReconciliationRepository,type LookupResult} from '../../packages/core/src/payment/payment-reconciliation';
import {flowHash} from '../../packages/contracts/src/rental-flow';
if(process.env.NODE_ENV==='production')throw Error('LOCAL_TEST_ONLY');

/** What the Production webhook inbox/reconcile path does with a backlog of RECEIVED events, against real PostgreSQL and a FAKE provider.
 * It uses exactly the SQL entry points of the scheduled normal worker (dispatch_normal / claim_normal / finalize_production /
 * load_context_production). It proves recovery of unprocessed events, duplicate prevention and fail-closed behaviour; it does NOT show that
 * the Production worker is enabled (that is established separately, from Production's read-only job/audit counts). No real provider is contacted. */
const x=await flowFixture(new Date().toISOString());
try{
 await x.clock(new Date().toISOString());
 const pool=x.db.pool;
 // A booking created BEFORE the worker cutoff: bound to a payment, but outside the normal worker's window.
 const early=await pendingCommercialBookingFixture(x,'2035-12-01');
 await new Promise(r=>setTimeout(r,1200));
 const since=new Date(Date.now()-600).toISOString();
 const a=await pendingCommercialBookingFixture(x,'2035-12-02'),b=await pendingCommercialBookingFixture(x,'2035-12-03');
 const observations=new Map([early,a,b].map(v=>[v.observation.providerId,v.observation]));
 const calls=new Map<string,number>();let mode:'OBSERVE'|LookupResult&{kind:'FAILED'}='OBSERVE';
 const receive=(type:string,payment:string,seed:string)=>pool.query("SELECT square_webhook.receive_production($1,$2,$3,$4,$5) r",['rec-'+randomUUID(),type,syntheticMerchant,payment,flowHash(seed+randomUUID())]);
 const repository:PaymentReconciliationRepository={
  async dispatch(_e,n){return (await pool.query('SELECT payment_reconciliation.dispatch_normal($1,$2,$3) n',[syntheticMerchant,n,since])).rows[0].n;},
  async claimBatch(_e,id,n){return (await pool.query('SELECT payment_reconciliation.claim_normal($1,$2,$3,$4) v',[id,n,syntheticMerchant,since])).rows.map(({v})=>({...v,leaseExpiresAt:new Date(v.leaseExpiresAt),deadlineAt:new Date(v.deadlineAt)}));},
  async finalize(c,o){return (await pool.query('SELECT payment_reconciliation.finalize_production($1,$2,$3,$4,$5,$6,$7) ok',[c.id,c.leaseToken,c.truthRevision,o.state,o.code,o.retrySeconds,o.truth])).rows[0].ok;},diagnostics:async()=>[],
 };
 const contexts:PaymentContextReader={async load(c){return (await pool.query('SELECT payment_reconciliation.load_context_production($1,$2,$3) v',[c.environment,c.merchantId,c.paymentId])).rows[0].v;}};
 const worker=new PaymentReconciliationWorker(repository,contexts,{async lookupPayment(r):Promise<LookupResult>{
  calls.set(r.paymentId,(calls.get(r.paymentId)??0)+1);if(mode!=='OBSERVE')return mode;
  const observation=observations.get(r.paymentId);assert.ok(observation,'lookup only for a known bound payment');return {kind:'OBSERVED',observation};
 }});
 const total=()=>[...calls.values()].reduce((s,n)=>s+n,0);
 const jobs=async(payment:string)=>(await pool.query('SELECT state,generation,attempt,coalesce(last_error,$2) err FROM payment_reconciliation.jobs WHERE payment_id=$1 ORDER BY generation',[payment,'-'])).rows;
 const inbox=async(payment:string)=>(await pool.query("SELECT state,attempt,job_dispatched_at IS NOT NULL AS dispatched FROM square_webhook.inbox WHERE payment_id=$1 ORDER BY received_at,event_id",[payment])).rows;
 const A=a.observation.providerId,B=b.observation.providerId,E=early.observation.providerId;

 // Backlog that accumulated while the worker was not running: out-of-order (updated before created) + duplicates of one payment,
 // another bound payment, an unbound payment id, and a payment bound only to a pre-cutoff booking.
 await receive('payment.updated',A,'A-upd');await receive('payment.created',A,'A-crt');await receive('payment.updated',B,'B-upd');
 await receive('payment.updated','unbound-never-ours','U');await receive('payment.created',E,'E');
 assert.equal((await pool.query("SELECT count(*)::int n FROM payment_reconciliation.jobs")).rows[0].n,0,'receiving never creates a job');

 const concurrent=await Promise.all([worker.runOnce('PRODUCTION','consumer-1',20),worker.runOnce('PRODUCTION','consumer-2',20)]);
 assert.equal(concurrent.reduce((s,r)=>s+r.claimed,0),2,'two payments claimed once in total across two concurrent consumers');
 assert.equal(calls.get(A),1,'two events of one payment coalesce into one lookup');assert.equal(calls.get(B),1);assert.equal(total(),2,'unbound and pre-cutoff payments are never looked up');
 assert.deepEqual((await jobs(A)).map(j=>[j.state,j.generation]),[['RECONCILED',1]]);assert.deepEqual((await jobs(B)).map(j=>[j.state,j.generation]),[['RECONCILED',1]]);
 assert.equal((await pool.query("SELECT count(*)::int n FROM payment_reconciliation.audit a JOIN payment_reconciliation.jobs j ON j.id=a.job_id WHERE j.payment_id=$1 AND a.action='COALESCED'",[A])).rows[0].n,1);
 assert.deepEqual(await inbox(A),[{state:'RECEIVED',attempt:0,dispatched:true},{state:'RECEIVED',attempt:0,dispatched:true}],
  'by design the inbox row stays RECEIVED/attempt 0 after a job is RECONCILED: progress lives in payment_reconciliation.jobs, not square_webhook.inbox.state');
 for(const p of ['unbound-never-ours',E]){assert.deepEqual(await inbox(p),[{state:'RECEIVED',attempt:0,dispatched:false}],'unbound / out-of-window event stays undispatched');assert.deepEqual(await jobs(p),[]);}
 console.log('PASS backlog recovery: out-of-order/duplicate events coalesce, 2 concurrent consumers = 1 fake lookup per payment, unbound and pre-cutoff events never dispatched, inbox.state stays RECEIVED by design');

 const before=total();
 for(let i=0;i<3;i++)await worker.runOnce('PRODUCTION','consumer-1',20);
 assert.equal(total(),before,'a settled backlog is never blindly re-processed by later ticks');

 await receive('payment.updated',A,'A-late');
 await worker.runOnce('PRODUCTION','consumer-1',20);
 assert.equal(calls.get(A),2,'only the payment with a new event is looked up again');assert.equal(calls.get(B),1);
 assert.deepEqual((await jobs(A)).map(j=>[j.state,j.generation]),[['RECONCILED',1],['RECONCILED',2]]);
 console.log('PASS a later event reopens exactly its own payment (new generation, 1 fake lookup); other payments untouched');

 // Provider-side failures use the durable retry/stop machinery and never loop inside one tick.
 const c=await pendingCommercialBookingFixture(x,'2035-12-04'),d=await pendingCommercialBookingFixture(x,'2035-12-05'),f=await pendingCommercialBookingFixture(x,'2035-12-06');
 for(const v of [c,d,f])observations.set(v.observation.providerId,v.observation);
 const C=c.observation.providerId,D=d.observation.providerId,F=f.observation.providerId;
 mode={kind:'FAILED',code:'NETWORK_RETRYABLE'};await receive('payment.updated',C,'C');
 await worker.runOnce('PRODUCTION','consumer-1',20);await worker.runOnce('PRODUCTION','consumer-1',20);
 assert.equal(calls.get(C),1,'RETRY_WAIT is honoured: no immediate second provider call');
 assert.deepEqual((await jobs(C)).map(j=>[j.state,j.attempt,j.err]),[['RETRY_WAIT',1,'NETWORK_RETRYABLE']]);assert.deepEqual(await inbox(C),[{state:'RECEIVED',attempt:0,dispatched:true}]);
 mode={kind:'FAILED',code:'AUTH_BLOCKED'};await receive('payment.updated',D,'D');
 await worker.runOnce('PRODUCTION','consumer-1',20);
 assert.equal((await pool.query("SELECT count(*)::int n FROM payment_reconciliation.provider_stops WHERE merchant_id=$1 AND code='AUTH_BLOCKED'",[syntheticMerchant])).rows[0].n,1);
 mode='OBSERVE';await receive('payment.updated',F,'F');
 const afterStop=total();await worker.runOnce('PRODUCTION','consumer-1',20);
 assert.equal(total(),afterStop,'after AUTH_BLOCKED the merchant is stopped durably: a fresh event creates a BLOCKED job and no provider call');
 assert.deepEqual((await jobs(F)).map(j=>[j.state,j.err]),[['BLOCKED','AUTH_BLOCKED']]);
 console.log('PASS provider failures: RETRY_WAIT honoured, AUTH_BLOCKED stops the merchant durably and fails closed for new events; fake provider only');
}finally{await x.close();}
