import assert from 'node:assert/strict';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import type {Pool} from 'pg';
import {insertAccount} from '../../packages/auth/src/accounts';
import {loadStaff} from '../../packages/auth/src/staff-auth';
import {HoldService} from '../../packages/core/src/inventory/hold-service';
import {QuoteService} from '../../packages/core/src/pricing/quote-service';
import type {HoldConditions} from '../../packages/contracts/src/hold';
import {PgProjectionTransaction} from '../../packages/db/src/internal/payment-projection';
import {decidePaymentProjection,verifyProjectionSource,type ProjectionSource} from '../../packages/core/src/payment/payment-projection';
import {verifyAcceptanceProjectionSource} from '../../scripts/lib/production-payment-acceptance';
import {commercialBookingFixture} from '../fixtures/commercial-booking';

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
  const project=async(f:Fixture)=>{
   const c=await projector.connect();try{
    await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(71820600)');
    const tx=new PgProjectionTransaction(c,f.ref,async(conn,ref)=>(await conn.query<{source:ProjectionSource|null}>(sourceSql,[ref.jobId,f.observation.merchantId,f.observation.providerId])).rows[0]?.source??null);
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
 }finally{await owner.query(originalClock);}
}
