import assert from 'node:assert/strict';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {insertAccount} from '../../packages/auth/src/accounts';
import {loadStaff} from '../../packages/auth/src/staff-auth';
import {HoldService} from '../../packages/core/src/inventory/hold-service';
import {QuoteService} from '../../packages/core/src/pricing/quote-service';
import type {HoldConditions} from '../../packages/contracts/src/hold';
import {PgProjectionTransaction} from '../../packages/db/src/internal/payment-projection';
import {decidePaymentProjection,verifyProjectionSource,type ProjectionSource} from '../../packages/core/src/payment/payment-projection';
import {verifyAcceptanceProjectionSource,verifyAcceptanceAttempt} from '../../scripts/lib/production-payment-acceptance';
import {commercialBookingFixture,responseLossBookingFixture,syntheticMerchant} from '../fixtures/commercial-booking';
import {flowHash} from '../../packages/contracts/src/rental-flow';
import {recoveryStatements} from '../../packages/db/src/payment-reconciliation';
import {PaymentReconciliationWorker,type PaymentContextReader,type PaymentReconciliationRepository} from '../../packages/core/src/payment/payment-reconciliation';
import {SquareProductionPaymentTruth} from '../../packages/core/src/payment/square-payment-truth';

/** Real non-zr database and canonical restricted roles; owner only seeds synthetic fixtures. */
export async function productionProjectionChecks(owner:Pool,projector:Pool,hold:Pool,pricing:Pool,otherPaymentRoles:Pool[],check:(name:string,fn:()=>Promise<void>)=>Promise<void>){
 const denied=async(fn:()=>Promise<unknown>,code='42501')=>assert.rejects(fn,{code});
 const sourceSql='SELECT payment_projection.lock_source_production($1,$2,$3) AS source';
 await check('Production projection source: old development guard reproduced; PUBLIC and other roles denied; no direct reconciliation-table grant',async()=>{
  await assert.rejects(owner.query('SELECT payment_projection.lock_source(NULL)'),{code:'42501',message:'DEVELOPMENT_DATABASE_REQUIRED'});
  await denied(()=>projector.query('SELECT payment_projection.lock_source(NULL)'));
  for(const role of otherPaymentRoles)await denied(()=>role.query(sourceSql,[null,'synthetic','none']));
  for(const table of ['payment_reconciliation.jobs','payment_reconciliation.streams','auth_user'])await denied(()=>projector.query('SELECT 1 FROM '+table+' WHERE false'));
  const acl=(await owner.query("SELECT NOT EXISTS(SELECT 1 FROM pg_proc p,LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid='payment_projection.lock_source_production(uuid,text,text)'::regprocedure AND a.grantee=0 AND a.privilege_type='EXECUTE') denied")).rows[0];assert.equal(acl.denied,true);
 });
 await check('Production projection preflight invokes the source function in a read-only zero-row transaction',async()=>{
  const before=(await owner.query('SELECT count(*)::int n FROM payment_reconciliation.jobs')).rows;
  await verifyAcceptanceProjectionSource(projector,'SYNTHETIC-PRODUCTION-MERCHANT');
  assert.deepEqual((await owner.query('SELECT count(*)::int n FROM payment_reconciliation.jobs')).rows,before);
 });
 const originalClock=(await owner.query("SELECT pg_get_functiondef('inventory_clock()'::regprocedure) sql")).rows[0].sql as string;
 let now=new Date('2035-01-01T01:00:00Z');
 const clock=async(value:Date)=>{now=value;await owner.query(`CREATE OR REPLACE FUNCTION inventory_clock() RETURNS timestamptz LANGUAGE sql VOLATILE AS $$SELECT '${now.toISOString()}'::timestamptz$$`);};
 try{
  await clock(now);const setup=await owner.connect();let actor:string;const variants:string[]=[];
  try{
   await setup.query('BEGIN');actor=await insertAccount(setup,{email:'projection-role@example.invalid',password:randomBytes(32).toString('base64url'),displayName:'SYNTHETIC projection fixture',active:true,role:'ADMIN',scope:'ALL',storeIds:[],permissions:{HOLD_VIEW:true,HOLD_EDIT:true,QUOTE_VIEW:true,QUOTE_CREATE:true,PRICE_EDIT:true}},null);
   await setup.query("SELECT set_config('zao.actor',$1,true),set_config('zao.reason','SYNTHETIC restricted projector fixture',true)",[actor]);
   const source=(await setup.query("INSERT INTO provisional_capacity_sources(source_sha256,original_filename,actor) VALUES($1,'synthetic-projection.xlsx',$2) RETURNING id",[createHash('sha256').update('synthetic-production-projection').digest('hex'),actor])).rows[0].id;
   for(const family of ['WEAR_JACKET','WEAR_PANTS']){
    const model=(await setup.query("INSERT INTO ledger_models(code,name,brand,family,notes,source_kind,source_document,source_locator,catalog_season) VALUES($1,$1,'SYNTHETIC',$2,'','SYNTHETIC','restricted projector fixture',$1,'2034/35') RETURNING id",['PROJECTION-'+family,family])).rows[0].id;
    variants.push((await setup.query("INSERT INTO ledger_variants(model_id,family,age,tier,size,notes,source_kind,source_document,source_locator,compatible_sports) VALUES($1,$2,'ADULT','STANDARD','M','','SYNTHETIC','restricted projector fixture',$2,ARRAY['SKI','SNOWBOARD']) RETURNING id",[model,family])).rows[0].id);
    await setup.query("INSERT INTO provisional_capacity_buckets(source_id,family,age,source_size,booking_size,size_mapping_status,quantity,provenance) VALUES($1,$2,'ADULT','M','M','MAPPED',20,'SYNTHETIC restricted projector fixture')",[source,family]);
   }
   await setup.query('COMMIT');
  }catch(e){await setup.query('ROLLBACK');throw e;}finally{setup.release();}
  const principal=(await loadStaff(owner,actor!))!,holds=new HoldService(hold,principal,()=>now),quotes=new QuoteService(pricing,principal,()=>now);
  await quotes.initializePrivate(randomUUID(),'2035-01-01','2035-12-31');
  const fixture=async(day:string)=>{
   const conditions:HoldConditions={contractVersion:'INTEGRATED_V1_2',reservationId:randomUUID(),pickupStore:'MOUNTAIN_BASE',returnStore:'MOUNTAIN_BASE',period:{startDate:day,endDate:day,slot:'DAY'},members:[{key:'w',product:'WEAR_SET',age:'ADULT',tier:'STANDARD',wearSport:'SKI',items:[{family:'WEAR_JACKET',variantIds:[variants[0]!]},{family:'WEAR_PANTS',variantIds:[variants[1]!]}]}]};
   return commercialBookingFixture({db:{pool:owner},actor:actor!,holds,quotes,now:()=>now},day,conditions);
  };
  type Fixture=Awaited<ReturnType<typeof fixture>>;
  const readSource=async(f:Fixture)=>((await projector.query(sourceSql,[f.ref.jobId,f.observation.merchantId,f.observation.providerId])).rows[0].source) as ProjectionSource;
  const project=async(f:Fixture,beforeQuery?:(sql:string)=>void)=>{
   const c=await projector.connect();try{
    await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(71820600)');
    const connection=Object.create(c) as PoolClient;
    connection.query=((...args:unknown[])=>{beforeQuery?.(String(args[0]));return Reflect.apply(c.query,c,args);}) as typeof c.query;
    const tx=new PgProjectionTransaction(connection,f.ref,async(conn,ref)=>(await conn.query<{source:ProjectionSource|null}>(sourceSql,[ref.jobId,f.observation.merchantId,f.observation.providerId])).rows[0]?.source??null);
    const state=await tx.load(),source=await tx.source(),time=await tx.time(),observation=verifyProjectionSource(f.ref,source,time,'PRODUCTION');
    assert.equal(state.quote?.commercialPriceValid,true);
    const prior=await tx.prior(f.ref.observationFingerprint);
    if(prior){await tx.linkReplay(f.ref);await c.query('COMMIT');return {...prior.result,duplicate:true};}
    const result=await tx.persist(state,decidePaymentProjection(state,observation,time),f.ref,time);await c.query('COMMIT');return result;
   }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  };
  const first=await fixture('2035-02-10');
  await check('Production source binds exact job/merchant/payment and excludes Sandbox and missing jobs',async()=>{
   const source=await readSource(first);assert.equal(source.jobId,first.ref.jobId);assert.equal(source.environment,'PRODUCTION');assert.deepEqual(source.observation,first.observation);
   for(const tuple of [[first.ref.jobId,'other',first.observation.providerId],[first.ref.jobId,first.observation.merchantId,'other'],[randomUUID(),first.observation.merchantId,first.observation.providerId]])assert.equal((await projector.query(sourceSql,tuple)).rows[0].source,null);
   await owner.query("SELECT square_webhook.receive('SANDBOX','synthetic-projection-sandbox','payment.created','sandbox-merchant','sandbox-payment',repeat('a',64))");await owner.query("SELECT payment_reconciliation.dispatch('SANDBOX',10)");
   const sandbox=(await owner.query("SELECT id FROM payment_reconciliation.jobs WHERE environment='SANDBOX' AND payment_id='sandbox-payment'")).rows[0];assert.ok(sandbox);
   assert.equal((await projector.query(sourceSql,[sandbox.id,'sandbox-merchant','sandbox-payment'])).rows[0].source,null);
  });
  await check('Production source holds both stream and job locks against concurrent truth updates',async()=>{
   const reader=await projector.connect(),writer=await owner.connect();try{
    await reader.query('BEGIN');const before=(await reader.query(sourceSql,[first.ref.jobId,first.observation.merchantId,first.observation.providerId])).rows[0].source;
    for(const sql of ['UPDATE payment_reconciliation.streams SET truth_revision=truth_revision+1 WHERE payment_id=$1','UPDATE payment_reconciliation.jobs SET context_fingerprint=repeat(\'b\',64) WHERE payment_id=$1']){
     await writer.query('BEGIN');await writer.query("SET LOCAL lock_timeout='50ms'");await denied(()=>writer.query(sql,[first.observation.providerId]),'55P03');await writer.query('ROLLBACK');
    }
    assert.deepEqual((await reader.query(sourceSql,[first.ref.jobId,first.observation.merchantId,first.observation.providerId])).rows[0].source,before);await reader.query('COMMIT');
   }finally{await reader.query('ROLLBACK');await writer.query('ROLLBACK');reader.release();writer.release();}
  });
  await check('Restricted Production projector confirms provisional Adult WEAR_SET and duplicate replay makes no second transition',async()=>{
   const before=(await owner.query("SELECT (SELECT count(*)::int FROM provisional_capacity_claims WHERE hold_id=$1 AND state='ACTIVE') provisional,(SELECT count(*)::int FROM wear_claims WHERE hold_id=$1) physical,(SELECT count(*)::int FROM wear_pools WHERE variant_id=ANY($2::uuid[])) pools",[first.holdId,variants])).rows[0];assert.deepEqual(before,{provisional:2,physical:0,pools:0});
   const result=await project(first);assert.equal(result.bookingState,'CONFIRMED');assert.equal(result.decision,'APPLY_COMPLETED');assert.equal(result.duplicate,false);
   const state=(await owner.query('SELECT state,version FROM rental_bookings WHERE id=$1',[first.bookingId])).rows;
   const detail=async()=>({hold:(await owner.query('SELECT state,payment_state,version,expires_at,confirmed_at FROM inventory_holds WHERE id=$1',[first.holdId])).rows[0],attempt:(await owner.query('SELECT state,provider_state,completed_at FROM rental_payment_attempts WHERE id=$1',[first.attemptId])).rows[0]});
   const confirmed=await detail();assert.equal(confirmed.hold.state,'ACTIVE');assert.equal(confirmed.hold.payment_state,'SUCCESS');assert.ok(confirmed.hold.confirmed_at);assert.equal(confirmed.attempt.state,'COMPLETED');
   assert.equal((await project(first)).duplicate,true);assert.deepEqual((await owner.query('SELECT state,version FROM rental_bookings WHERE id=$1',[first.bookingId])).rows,state);
   assert.deepEqual(await detail(),confirmed);
   for(const table of ['heads','events','job_receipts'])assert.equal((await owner.query('SELECT count(*)::int n FROM payment_projection.'+table+' WHERE attempt_id=$1',[first.attemptId])).rows[0].n,1);
  });
  await check('Restricted Production projector keeps expired HOLD in payment review',async()=>{
   const f=await fixture('2035-02-11');await clock(new Date(now.getTime()+700000));const result=await project(f);assert.equal(result.decision,'BLOCK_EXPIRED_HOLD');assert.equal(result.bookingState,'PAYMENT_REVIEW');assert.equal(result.operatorActionRequired,true);
  });
  await check('Restricted Production projector preserves cancellation and records one late-completion refund obligation without a provider call',async()=>{
   const f=await fixture('2035-02-12'),c=await owner.connect();try{await c.query('BEGIN');await c.query("SELECT set_config('zao.actor',$1,true)",[actor!]);const preview=(await c.query('SELECT booking_cancellation_preview($1) v',[f.bookingId])).rows[0].v;await c.query('SELECT booking_cancel($1,$2,$3::jsonb)',[f.bookingId,randomUUID(),JSON.stringify(preview)]);await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
   assert.equal((await project(f)).bookingState,'CANCELLED');assert.equal((await owner.query('SELECT state FROM inventory_holds WHERE id=$1',[f.holdId])).rows[0].state,'RELEASED');assert.equal((await owner.query('SELECT count(*)::int n FROM booking_cancellation_refunds WHERE booking_id=$1',[f.bookingId])).rows[0].n,1);
  });
  // ---- 0052: attended targeted reconciliation and lost-checkout-response recovery ----
  const [receiverPool,dispatcherPool,workerPool,diagnosticPool]=otherPaymentRoles as [Pool,Pool,Pool,Pool];
  const merchant=syntheticMerchant,sha=(v:string)=>createHash('sha256').update(v).digest('hex');
  const receiveEvent=(eventId:string,payment:string,environment:'PRODUCTION'|'SANDBOX'='PRODUCTION')=>owner.query("SELECT square_webhook.receive($1,$2,'payment.created',$3,$4,$5)",[environment,eventId,merchant,payment,sha(eventId)]);
  const lostFixture=async(day:string)=>{
   const conditions:HoldConditions={contractVersion:'INTEGRATED_V1_2',reservationId:randomUUID(),pickupStore:'MOUNTAIN_BASE',returnStore:'MOUNTAIN_BASE',period:{startDate:day,endDate:day,slot:'DAY'},members:[{key:'w',product:'WEAR_SET',age:'ADULT',tier:'STANDARD',wearSport:'SKI',items:[{family:'WEAR_JACKET',variantIds:[variants[0]!]},{family:'WEAR_PANTS',variantIds:[variants[1]!]}]}]};
   return responseLossBookingFixture({db:{pool:owner},actor:actor!,holds,quotes,now:()=>now},day,conditions);
  };
  type Lost=Awaited<ReturnType<typeof lostFixture>>;
  const recoveryOf=(l:Lost)=>({attemptId:l.attemptId,bookingId:l.bookingId,paymentId:l.observation.providerId});
  const aclTargets=['payment_reconciliation.dispatch_target_production(text,text)','payment_reconciliation.claim_target_production(text,text,text)','payment_reconciliation.load_context_target_production(uuid,uuid,text,text)'];
  const jobRow=async(payment:string)=>(await owner.query("SELECT id,state,attempt,lease_owner,decision FROM payment_reconciliation.jobs WHERE environment='PRODUCTION' AND payment_id=$1",[payment])).rows[0];
  const inboxDispatched=async(event:string)=>(await owner.query('SELECT job_dispatched_at IS NOT NULL dispatched FROM square_webhook.inbox WHERE event_id=$1',[event])).rows[0].dispatched as boolean;
  await check('Targeted functions: only the exact role can execute each, PUBLIC cannot, and Sandbox surfaces stay untouched',async()=>{
   const l=await lostFixture('2035-03-01'),r=recoveryOf(l);
   const dispatch=recoveryStatements.dispatch(merchant,r),claim=recoveryStatements.claim('m3-attended',merchant,r),load=recoveryStatements.load(merchant,r.paymentId,r);
   for(const pool of [workerPool,receiverPool,diagnosticPool,projector])await denied(()=>pool.query(dispatch.text,dispatch.values));
   for(const pool of [dispatcherPool,receiverPool,diagnosticPool,projector]){await denied(()=>pool.query(claim.text,claim.values));await denied(()=>pool.query(load.text,load.values));}
   const acl=(await owner.query("SELECT count(*)::int leaked FROM pg_proc p,LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid=ANY($1::regprocedure[]) AND a.privilege_type='EXECUTE' AND a.grantee=0",[aclTargets])).rows[0];assert.equal(acl.leaked,0);
   const grantees=(await owner.query("SELECT p.proname,array_agg(DISTINCT pg_get_userbyid(a.grantee)::text ORDER BY pg_get_userbyid(a.grantee)::text)::text[] roles FROM pg_proc p,LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid=ANY($1::regprocedure[]) AND a.grantee<>p.proowner GROUP BY p.proname ORDER BY p.proname",[aclTargets])).rows;
   assert.deepEqual(grantees.map(g=>[g.proname,(g.roles as string[]).map(role=>role.slice(role.lastIndexOf('_pay_')))]),[['claim_target_production',['_pay_truth']],['dispatch_target_production',['_pay_dispatch']],['load_context_target_production',['_pay_truth']]]);
  });
  await check('Older unrelated events are never dispatched or claimed ahead of the exact target (counterexample reproduced first)',async()=>{
   const l=await lostFixture('2035-03-02'),r=recoveryOf(l),live=r.paymentId;
   const oldA='synthetic-old-test-a-'+randomUUID(),oldB='synthetic-old-test-b-'+randomUUID();
   await receiveEvent('evt-old-a-'+oldA,oldA);await receiveEvent('evt-old-b-'+oldB,oldB);await receiveEvent('evt-live-'+live,live);
   await receiveEvent('evt-sandbox-'+live,live,'SANDBOX');
   // Defect A: the merchant-wide Production dispatcher, limited to one, takes the OLDEST event, not the attended payment.
   assert.equal((await dispatcherPool.query('SELECT payment_reconciliation.dispatch_production($1,1) AS n',[merchant])).rows[0].n,1);
   assert.ok(await jobRow(oldA));assert.equal(await jobRow(live),undefined);assert.equal(await inboxDispatched('evt-old-b-'+oldB),false);
   // Targeted dispatch/claim: the live payment only, older READY job and older undispatched event untouched.
   const d=recoveryStatements.dispatch(merchant,r);assert.equal((await dispatcherPool.query(d.text,d.values)).rows[0].n,1);
   assert.ok(await jobRow(live));assert.equal(await inboxDispatched('evt-live-'+live),true);
   assert.equal(await inboxDispatched('evt-old-b-'+oldB),false);assert.equal(await jobRow(oldB),undefined);
   assert.equal(await inboxDispatched('evt-sandbox-'+live),false);
   assert.equal((await dispatcherPool.query(d.text,d.values)).rows[0].n,0);
   const c=recoveryStatements.claim('m3-attended',merchant,r);const claimed=await workerPool.query(c.text,c.values);
   assert.equal(claimed.rowCount,1);assert.equal(claimed.rows[0].claim.paymentId,live);assert.equal(claimed.rows[0].claim.environment,'PRODUCTION');assert.equal(claimed.rows[0].claim.attempt,1);
   const older=await jobRow(oldA);assert.deepEqual([older.state,older.attempt,older.lease_owner],['READY',0,null]);
   assert.equal((await workerPool.query(c.text,c.values)).rowCount,0);
   // Wrong merchant, wrong payment, malformed input.
   assert.equal((await dispatcherPool.query('SELECT payment_reconciliation.dispatch_target_production($1,$2) AS n',['OTHER-MERCHANT',oldB])).rows[0].n,0);
   assert.equal((await dispatcherPool.query('SELECT payment_reconciliation.dispatch_target_production($1,$2) AS n',[merchant,'no-such-payment'])).rows[0].n,0);
   assert.equal((await workerPool.query('SELECT payment_reconciliation.claim_target_production($1,$2,$3)',['m3-attended','OTHER-MERCHANT',live])).rowCount,0);
   for(const args of [[null,live],[merchant,null],['bad merchant!',live],[merchant,'bad payment!']])await denied(()=>dispatcherPool.query('SELECT payment_reconciliation.dispatch_target_production($1,$2)',args),'22023');
   for(const args of [['m3-attended',merchant,null],['bad owner!',merchant,live],[null,merchant,live]])await denied(()=>workerPool.query('SELECT payment_reconciliation.claim_target_production($1,$2,$3)',args),'22023');
   assert.equal(await inboxDispatched('evt-old-b-'+oldB),false);
  });
  await check('Response-loss context: located by persisted identity, provider_id null accepted, no write, webhook never becomes truth',async()=>{
   const l=await lostFixture('2035-03-03'),r=recoveryOf(l);
   const before=(await owner.query('SELECT provider_id,state,provider_state,updated_at FROM rental_payment_attempts WHERE id=$1',[l.attemptId])).rows[0];assert.equal(before.provider_id,null);assert.equal(before.state,'UNKNOWN');
   const load=recoveryStatements.load(merchant,r.paymentId,r),context=(await workerPool.query(load.text,load.values)).rows[0].context;
   assert.equal(context.current.providerId,null);assert.equal(context.current.state,'UNKNOWN');assert.equal(context.latest,null);
   assert.deepEqual(context.expected,{attemptId:l.attemptId,bookingId:l.bookingId,idempotencyKey:l.key,merchantId:merchant,locationId:l.locationId,amountJpy:Number(l.snapshot.totalJpy),currency:'JPY'});
   assert.deepEqual((await owner.query('SELECT provider_id,state,provider_state,updated_at FROM rental_payment_attempts WHERE id=$1',[l.attemptId])).rows[0],before);
   const ask=async(args:unknown[])=>(await workerPool.query('SELECT payment_reconciliation.load_context_target_production($1,$2,$3,$4) AS context',args)).rows[0].context;
   for(const args of [[randomUUID(),l.bookingId,merchant,r.paymentId],[l.attemptId,randomUUID(),merchant,r.paymentId],[l.attemptId,l.bookingId,'OTHER-MERCHANT',r.paymentId],[null,l.bookingId,merchant,r.paymentId],[l.attemptId,l.bookingId,merchant,'bad payment!']])assert.equal(await ask(args),null);
   // A payment ID already bound to another attempt can never be adopted by this one.
   assert.equal(await ask([l.attemptId,l.bookingId,merchant,first.observation.providerId]),null);
   // An already-bound attempt is only loadable for exactly its own payment.
   assert.equal((await ask([first.attemptId,first.bookingId,merchant,first.observation.providerId])).current.providerId,first.observation.providerId);
   assert.equal(await ask([first.attemptId,first.bookingId,merchant,'other-payment']),null);
  });
  const reconcileLost=async(l:Lost,calls:{method:string;url:string}[],status:'COMPLETED'|'FAILED'|'CANCELED'|'PENDING'='COMPLETED')=>{
   const r=recoveryOf(l);
   await receiveEvent('evt-reconcile-'+r.paymentId,r.paymentId);
   const raw={id:r.paymentId,reference_id:l.bookingId,location_id:l.locationId,amount_money:{amount:Number(l.snapshot.totalJpy),currency:'JPY'},status,updated_at:'2026-10-01T00:00:00.000Z',...(status==='COMPLETED'?{card_details:{card:{last_4:'1111'},card_payment_timeline:{captured_at:'2026-10-01T00:00:00.000Z'}}}:{})};
   const provider=new SquareProductionPaymentTruth({environment:'PRODUCTION',merchantId:merchant,locationId:l.locationId,async send(call){calls.push({method:call.method,url:call.url});return {status:200,body:{payment:raw}};}});
   const repository:PaymentReconciliationRepository={
    dispatch:async()=>(await dispatcherPool.query(recoveryStatements.dispatch(merchant,r))).rows[0].n,
    claimBatch:async(_environment,workerId)=>(await workerPool.query(recoveryStatements.claim(workerId,merchant,r))).rows.map(({claim})=>({...claim,leaseExpiresAt:new Date(claim.leaseExpiresAt),deadlineAt:new Date(claim.deadlineAt)})),
    finalize:async(claim,outcome)=>(await workerPool.query('SELECT payment_reconciliation.finalize_production($1,$2,$3,$4,$5,$6,$7::jsonb) AS ok',[claim.id,claim.leaseToken,claim.truthRevision,outcome.state,outcome.code,outcome.retrySeconds,outcome.truth?JSON.stringify(outcome.truth):null])).rows[0].ok===true,
    diagnostics:async()=>[],
   };
   const contexts:PaymentContextReader={load:async claim=>(await workerPool.query(recoveryStatements.load(claim.merchantId,claim.paymentId,r))).rows[0].context};
   const result=await new PaymentReconciliationWorker(repository,contexts,provider,undefined,undefined,undefined,{paymentId:r.paymentId}).runOnce('PRODUCTION','m3-attended',1);
   const source=(await projector.query(sourceSql,[(result.results[0] as {id:string}).id,merchant,r.paymentId])).rows[0].source as ProjectionSource;
   const observation=source.observation!;
   const ref={bookingId:l.bookingId,attemptId:l.attemptId,jobId:source.jobId,truthRevision:source.truthRevision,truthFingerprint:source.decisionFingerprint,observationFingerprint:flowHash(observation),expectedRevision:0};
   return {result,source,observation,ref};
  };
  await check('Lost-response payment: one GET, exact full match, truth persisted without binding provider_id, no business write',async()=>{
   const l=await lostFixture('2035-03-04'),calls:{method:string;url:string}[]=[];
   const {result,source,observation}=await reconcileLost(l,calls);
   assert.equal(result.dispatched,1);assert.equal(result.claimed,1);assert.equal(result.results[0]?.result,'SAVED');assert.equal((result.results[0] as {decision:string}).decision,'ACCEPT_COMPLETED');
   assert.deepEqual(calls.map(c=>c.method),['GET']);assert.ok(calls[0]!.url.endsWith('/v2/payments/'+l.observation.providerId));
   assert.equal(source.state,'RECONCILED');assert.equal(observation.providerId,l.observation.providerId);assert.equal(observation.referenceId,l.bookingId);assert.equal(observation.idempotencyKey,l.key);
   const after=(await owner.query('SELECT a.provider_id,a.state,b.state booking_state FROM rental_payment_attempts a JOIN rental_bookings b ON b.id=a.booking_id WHERE a.id=$1',[l.attemptId])).rows[0];
   assert.deepEqual(after,{provider_id:null,state:'UNKNOWN',booking_state:'PAYMENT_PENDING'});
  });
  await check('Lost-response payment: projecting before cancellation fails closed with no business change',async()=>{
   const l=await lostFixture('2035-03-05'),{ref,observation}=await reconcileLost(l,[]);
   const result=await project({...l,ref,observation} as unknown as Fixture);
   assert.equal(result.decision,'BLOCK_IDENTITY_MISMATCH');assert.equal(result.bookingState,'PAYMENT_PENDING');assert.equal(result.operatorActionRequired,true);
   assert.deepEqual((await owner.query('SELECT a.provider_id,a.state FROM rental_payment_attempts a WHERE a.id=$1',[l.attemptId])).rows[0],{provider_id:null,state:'UNKNOWN'});
   assert.equal((await owner.query('SELECT state FROM inventory_holds WHERE id=$1',[l.holdId])).rows[0].state,'ACTIVE');
  });
  await check('Lost-response payment completed after the HOLD expired: cancel first, then CANCELLED_PAYMENT binds provider_id and creates exactly one refund obligation',async()=>{
   const l=await lostFixture('2035-03-06'),calls:{method:string;url:string}[]=[];
   const {ref,observation}=await reconcileLost(l,calls);
   await clock(new Date(now.getTime()+700000)); // the original HOLD is now expired, as in the live run
   const c=await owner.connect();let preview:{refundAmountJpy:number;paymentUncertain:boolean};
   try{await c.query('BEGIN');await c.query("SELECT set_config('zao.actor',$1,true)",[actor!]);preview=(await c.query('SELECT booking_cancellation_preview($1) v',[l.bookingId])).rows[0].v;
    assert.equal(preview.refundAmountJpy,Number(l.snapshot.totalJpy));assert.equal(preview.paymentUncertain,true);
    await c.query('SELECT booking_cancel($1,$2,$3::jsonb)',[l.bookingId,randomUUID(),JSON.stringify(preview)]);await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
   const cancelled=(await owner.query("SELECT b.state booking_state,h.state hold_state,h.payment_state,(SELECT count(*)::int FROM booking_cancellation_refunds WHERE booking_id=b.id) refunds,(SELECT count(*)::int FROM booking_notification_outbox WHERE booking_id=b.id AND event_type='BOOKING_CANCELLED') outbox FROM rental_bookings b JOIN inventory_holds h ON h.id=b.hold_id WHERE b.id=$1",[l.bookingId])).rows[0];
   assert.deepEqual([cancelled.booking_state,cancelled.hold_state,cancelled.refunds,cancelled.outbox],['CANCELLED','RELEASED',0,1]);
   const result=await project({...l,ref,observation} as unknown as Fixture);
   assert.equal(result.decision,'APPLY_COMPLETED');assert.equal(result.bookingState,'CANCELLED');assert.equal(result.attemptState,'COMPLETED');assert.equal(result.duplicate,false);
   const done=(await owner.query('SELECT a.provider_id,a.state,a.provider_state,b.state booking_state,h.state hold_state,h.payment_state FROM rental_payment_attempts a JOIN rental_bookings b ON b.id=a.booking_id JOIN inventory_holds h ON h.id=b.hold_id WHERE a.id=$1',[l.attemptId])).rows[0];
   assert.deepEqual([done.provider_id,done.state,done.provider_state,done.booking_state,done.hold_state],[l.observation.providerId,'COMPLETED','COMPLETED','CANCELLED','RELEASED']);assert.notEqual(done.payment_state,'SUCCESS');
   const refunds=(await owner.query('SELECT payment_provider_id,merchant_id,location_id,amount_jpy::int amount,state FROM booking_cancellation_refunds WHERE booking_id=$1',[l.bookingId])).rows;
   assert.deepEqual(refunds,[{payment_provider_id:l.observation.providerId,merchant_id:merchant,location_id:l.locationId,amount:Number(l.snapshot.totalJpy),state:'PENDING'}]);
   assert.equal((await project({...l,ref,observation} as unknown as Fixture)).duplicate,true);
   assert.equal((await owner.query('SELECT count(*)::int n FROM booking_cancellation_refunds WHERE booking_id=$1',[l.bookingId])).rows[0].n,1);
   assert.equal(calls.length,1);
  });
  // ---- 0053: restricted failed/canceled response-loss terminalization ----
  const terminalSql='SELECT payment_projection.terminalize_expired_unbound_failed_production($1,$2,$3,$4,$5,$6,$7)';
  const terminalFn='payment_projection.terminalize_expired_unbound_failed_production(uuid,uuid,uuid,text,text,bigint,text)';
  const terminalArgs=(f:Fixture):unknown[]=>[f.bookingId,f.attemptId,f.ref.jobId,merchant,f.observation.providerId,f.ref.truthRevision,f.ref.truthFingerprint];
  const targetOf=(l:Lost)=>({attemptId:l.attemptId,bookingId:l.bookingId,idempotencyKey:l.key,merchantId:merchant,locationId:l.locationId,amountJpy:Number(l.snapshot.totalJpy),currency:'JPY' as const,paymentId:l.observation.providerId});
  const business=async(f:Fixture)=>(await owner.query(`SELECT to_jsonb(b) booking,to_jsonb(a) attempt,to_jsonb(h) hold,
   (SELECT jsonb_agg(c ORDER BY c.id) FROM provisional_capacity_claims c WHERE hold_id=h.id) claims,
   (SELECT jsonb_agg(c) FROM booking_cancellations c WHERE booking_id=b.id) cancellations,
   (SELECT jsonb_agg(r) FROM booking_cancellation_refunds r WHERE booking_id=b.id) refunds,
   (SELECT jsonb_agg(n ORDER BY n.id) FROM booking_notification_outbox n WHERE booking_id=b.id) outbox,
   (SELECT jsonb_agg(e ORDER BY e.id) FROM payment_projection.events e WHERE attempt_id=a.id) events,
   (SELECT jsonb_agg(p) FROM payment_projection.heads p WHERE attempt_id=a.id) heads,
   (SELECT jsonb_agg(r) FROM payment_projection.job_receipts r WHERE attempt_id=a.id) receipts,
   (SELECT jsonb_agg(r ORDER BY r.id) FROM rental_history r WHERE entity_id IN (b.id,a.id)) history
   FROM rental_bookings b JOIN rental_payment_attempts a ON a.booking_id=b.id JOIN inventory_holds h ON h.id=b.hold_id WHERE b.id=$1`,[f.bookingId])).rows[0];
  await check('0053 function ACL: only Production projector, no PUBLIC or other payment role and no direct cancellation privilege',async()=>{
   for(const pool of otherPaymentRoles)await denied(()=>pool.query(terminalSql,[randomUUID(),randomUUID(),randomUUID(),merchant,'synthetic-payment',1,'a'.repeat(64)]));
   const acl=(await owner.query("SELECT NOT EXISTS(SELECT 1 FROM pg_proc p,LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid=$1::regprocedure AND a.grantee=0 AND a.privilege_type='EXECUTE') denied",[terminalFn])).rows[0];assert.equal(acl.denied,true);
   for(const fn of ['booking_cancel(uuid,uuid,jsonb)','booking_cancellation_preview(uuid)'])assert.equal((await projector.query("SELECT has_function_privilege(current_user,$1,'EXECUTE') allowed",[fn])).rows[0].allowed,false);
  });
  for(const status of ['FAILED','CANCELED'] as const)await check('Expired unbound '+status+': exactly one guarded call/cancellation/outbox, zero refund; duplicate has no provider call',async()=>{
   const l=await lostFixture(status==='FAILED'?'2035-04-01':'2035-04-02'),calls:{method:string;url:string}[]=[],truth=await reconcileLost(l,calls,status),f={...l,...truth};
   assert.equal(truth.source.decision,'ACCEPT_'+status);
   await assert.rejects(verifyAcceptanceAttempt(projector,targetOf(l)),/M3_UNBOUND_PAYMENT_REQUIRES_CANCELLED_BOOKING/);
   await clock(new Date(now.getTime()+700000));await verifyAcceptanceAttempt(projector,targetOf(l));
   const before=await business(f),sql:string[]=[];
   for(const stage of ['SELECT payment_projection.terminalize_expired','INSERT INTO payment_projection.heads','INSERT INTO payment_projection.events','INSERT INTO payment_projection.job_receipts']){
    await assert.rejects(project(f,q=>{if(q.startsWith(stage))throw Error('SYNTHETIC_PROJECTION_FAILURE');}),/SYNTHETIC_PROJECTION_FAILURE/);
    assert.deepEqual(await business(f),before,'rollback at '+stage);
   }
   const result=await project(f,q=>sql.push(q));
   assert.equal(sql.filter(q=>q.startsWith('SELECT payment_projection.terminalize_expired')).length,1);
   assert.equal(sql.filter(q=>q.startsWith('UPDATE rental_payment_attempts')).length,0);
   assert.equal(result.decision,status==='FAILED'?'APPLY_FAILED':'APPLY_CANCELED');assert.equal(result.bookingState,'CANCELLED');assert.equal(result.attemptState,'FAILED');
   const after=await business(f);assert.equal(after.attempt.provider_id,l.observation.providerId);assert.equal(after.attempt.provider_state,status);assert.equal(after.hold.state,'RELEASED');
   assert.equal(after.cancellations.length,1);assert.equal(after.cancellations[0].maximum_refund_jpy,0);assert.equal(after.cancellations[0].payment_uncertain,false);assert.equal(after.refunds,null);
   assert.equal(after.outbox.filter((r:{event_type:string})=>r.event_type==='BOOKING_CANCELLED').length,1);
   assert.ok(after.claims.every((r:{state:string})=>r.state==='RELEASED'));
   for(const table of ['events','heads','receipts'])assert.equal(after[table].length,1);
   assert.deepEqual(after.events[0].new_state,{booking:'CANCELLED',attempt:'FAILED',hold:'RELEASED',holdPayment:after.hold.payment_state});
   assert.equal((await project(f)).duplicate,true);assert.deepEqual(await business(f),after);assert.deepEqual(calls.map(c=>c.method),['GET']);
  });
  await check('0053 SQL independently rejects wrong identity/source, active HOLD, collected money, bound provider and non-Production',async()=>{
   const l=await lostFixture('2035-04-03'),truth=await reconcileLost(l,[],'FAILED'),f={...l,...truth};await clock(new Date(now.getTime()+700000));
   const unchanged=await business(f);
   const reject=async(patch:{index?:number;value?:unknown;actor?:string;reason?:string;setup?:(c:PoolClient)=>Promise<void>})=>{
    const c=await owner.connect();try{
     await c.query('BEGIN');await c.query("SELECT set_config('zao.actor',$1,true),set_config('zao.reason',$2,true)",[actor!,patch.reason??'PAYMENT_PROJECTION_LOCAL']);
     await patch.setup?.(c);
     if(patch.actor!==undefined)await c.query("SELECT set_config('zao.actor',$1,true)",[patch.actor]);
     await c.query('SET LOCAL ROLE '+projector.options.user);
     const args=terminalArgs(f);if(patch.index!==undefined)args[patch.index]=patch.value;
     await assert.rejects(c.query(terminalSql,args),error=>['23514','42501','22023'].includes(String((error as {code:string}).code)));
    }finally{await c.query('ROLLBACK');c.release();}
    assert.deepEqual(await business(f),unchanged);
   };
   await reject({actor:'wrong-actor'});await reject({reason:'wrong-reason'});
   for(const [index,value] of [[0,randomUUID()],[1,randomUUID()],[2,randomUUID()],[3,'OTHER-MERCHANT'],[4,'other-payment'],[5,2],[6,'f'.repeat(64)]] as const)await reject({index,value});
   await reject({setup:async c=>{await c.query("UPDATE inventory_holds SET expires_at=inventory_clock()+interval '1 minute',version=version+1 WHERE id=$1",[l.holdId]);}});
   await reject({setup:async c=>{await c.query('UPDATE rental_payment_attempts SET provider_id=$2 WHERE id=$1',[l.attemptId,l.observation.providerId]);}});
   await reject({setup:async c=>{await c.query("UPDATE rental_payment_attempts SET state='COMPLETED',provider_id=$2,provider_state='COMPLETED',completed_at=inventory_clock() WHERE id=$1",[l.attemptId,l.observation.providerId]);assert.equal((await c.query('SELECT count(*)::int n FROM ops_collected_payments WHERE booking_id=$1',[l.bookingId])).rows[0].n,1);}});
   await reject({setup:async c=>{
    // Inconsistent historical collection: seed an actual additional payment in this disposable transaction.
    // Keep the original attempt UNKNOWN/unbound so the zero-collected guard itself is exercised.
    const amendment=randomUUID();
    await c.query(`INSERT INTO ops_amendment_quotes(id,booking_id,actor,request_key,fingerprint,expected_hold_version,before_conditions,conditions,quote,quote_sha256,loan_versions,assignment,reason,expires_at)
     VALUES($1,$2,$3,$4,repeat('a',64),1,'{}','{}','{"additionalChargeJpy":1}',repeat('a',64),'{}','{}','SYNTHETIC collected-payment counterexample',inventory_clock()+interval '1 minute')`,[amendment,l.bookingId,actor!,randomUUID()]);
    await c.query('ALTER TABLE ops_amendments DISABLE TRIGGER ops_accept_amendment');
    await c.query("INSERT INTO ops_amendments(id,booking_id,actor,request_key,fingerprint,fit_evidence) VALUES($1,$2,$3,$4,repeat('a',64),'SYNTHETIC')",[amendment,l.bookingId,actor!,randomUUID()]);
    await c.query('ALTER TABLE ops_amendments ENABLE TRIGGER ops_accept_amendment');
    await c.query('ALTER TABLE ops_charge_requests DISABLE TRIGGER ops_charge_guard');
    await c.query("INSERT INTO ops_charge_requests(id,booking_id,amendment_id,actor,idempotency_key,merchant_id,location_id,amount_jpy,currency,state,provider_id,completed_at) VALUES($1,$2,$3,$4,$5,$6,$7,1,'JPY','COMPLETED','synthetic-additional',inventory_clock())",[randomUUID(),l.bookingId,amendment,actor!,randomUUID(),merchant,l.locationId]);
    await c.query('ALTER TABLE ops_charge_requests ENABLE TRIGGER ops_charge_guard');
    assert.equal((await c.query('SELECT count(*)::int n FROM ops_collected_payments WHERE booking_id=$1',[l.bookingId])).rows[0].n,1);
   }});
   // Deliberately corrupt immutable identity only within a rolled-back owner fixture, then invoke as the restricted role.
   await reject({setup:async c=>{await c.query('ALTER TABLE rental_bookings DISABLE TRIGGER rental_booking_guard');await c.query("UPDATE rental_bookings SET mode='SQUARE_SANDBOX',price_snapshot=jsonb_set(price_snapshot,'{chargeReady}','false'),version=version+1 WHERE id=$1",[l.bookingId]);await c.query('ALTER TABLE rental_bookings ENABLE TRIGGER rental_booking_guard');}});
   await reject({setup:async c=>{await c.query('UPDATE payment_reconciliation.jobs SET decision=NULL WHERE id=$1',[truth.ref.jobId]);}});
   for(const status of ['COMPLETED','PENDING'] as const){
    const other=await lostFixture(status==='COMPLETED'?'2035-04-04':'2035-04-05'),t=await reconcileLost(other,[],status),candidate={...other,...t};await clock(new Date(now.getTime()+700000));
    const c=await projector.connect();try{await c.query('BEGIN');await c.query("SELECT set_config('zao.actor',$1,true),set_config('zao.reason','PAYMENT_PROJECTION_LOCAL',true)",[actor!]);await denied(()=>c.query(terminalSql,terminalArgs(candidate)),'23514');}finally{await c.query('ROLLBACK');c.release();}
   }
  });
 }finally{await owner.query(originalClock);}
}
