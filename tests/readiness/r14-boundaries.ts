import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import type {PoolClient} from 'pg';
import {scoped,type DB} from './r14-postgres';
import {PgSquareWebhookInbox,type InboxConnection} from '../../packages/db/src/square-webhook-inbox';
import {PgPaymentReconciliation} from '../../packages/db/src/payment-reconciliation';
import {PgPaymentProjection} from '../../packages/db/src/payment-projection';
import {TransactionalPaymentProjection,type ProjectionReference,type ProjectionSource} from '../../packages/core/src/payment/payment-projection';
import {decidePaymentTruth} from '../../packages/core/src/payment/payment-truth';
import {flowHash} from '../../packages/contracts/src/rental-flow';
import {id,stateFixture,observation} from '../fixtures/payment-projection';
export async function boundaries(db:DB,out:string){
 if(db.r14!.completed.has('boundaries'))return;
 const n=db.r14!.roles.names,results:{name:string;result:string}[]=[];
 const source=async(c:InboxConnection,ref:ProjectionReference)=>(await c.query<{source:ProjectionSource}>('SELECT payment_projection.lock_source($1) AS source',[ref.jobId])).rows[0]!.source;
 const original=(await db.pool.query("SELECT pg_get_functiondef('inventory_clock()'::regprocedure) AS definition")).rows[0].definition;
 await db.pool.query(`CREATE OR REPLACE FUNCTION inventory_clock() RETURNS timestamptz LANGUAGE sql VOLATILE AS $$SELECT coalesce(nullif(current_setting('zao.r14_clock',true),''),'2035-01-01T00:00:00Z')::timestamptz$$`);
 async function clone(c:PoolClient,expires='2035-01-01T00:10:00Z'){
  const conditions={...stateFixture().booking.conditions,reservationId:id(201)},snapshot={...stateFixture().booking.priceSnapshot,conditions},hash=flowHash(snapshot);
  await c.query("INSERT INTO inventory_reservations VALUES($1,'synthetic-actor')",[id(201)]);
  const clones=[['inventory_holds',id(2),{id:id(202),reservation_id:id(201),conditions,payment_state:'PENDING',confirmed_at:null,expires_at:expires}],['price_quotes',id(3),{id:id(203),request_key:id(262),hold_id:id(202),conditions,snapshot,snapshot_sha256:hash}],['rental_bookings',id(1),{id:id(201),request_key:id(263),hold_id:id(202),quote_id:id(203),conditions,price_snapshot:snapshot,price_sha256:hash,state:'PAYMENT_PENDING',confirmed_at:null,version:2}],['rental_payment_attempts',id(4),{id:id(204),booking_id:id(201),idempotency_key:id(205),provider_id:'fixture-payment-200',state:'PENDING',provider_state:null,provider_updated_at:null,completed_at:null}]] as const;
  for(const [table,from,overrides] of clones)await c.query(`INSERT INTO ${table} SELECT (jsonb_populate_record(NULL::${table},to_jsonb(t)||$2::jsonb)).* FROM ${table} t WHERE id=$1`,[from,JSON.stringify(overrides)]);
 }
 async function truth(c:PoolClient){
  const target={merchantId:'fixture-merchant',paymentId:'fixture-payment-200'},inbox=new PgSquareWebhookInbox(scoped(c,n.receiver)),d=new PgPaymentReconciliation(scoped(c,n.dispatcher),target),w=new PgPaymentReconciliation(scoped(c,n.worker),target);
  await inbox.receive({environment:'SANDBOX',eventId:'r14_negative_'+randomUUID(),type:'payment.updated',...target,bodySha256:flowHash(randomUUID())});await d.dispatch('SANDBOX',1);const claim=(await w.claimBatch('SANDBOX','r14-negative',1))[0]!,context=(await w.load(claim))!,t=new Date(),o={...observation(),providerId:target.paymentId,referenceId:id(201),idempotencyKey:id(205),updatedAt:t.toISOString(),completedAt:t.toISOString()},accepted=decidePaymentTruth(context,target.paymentId,o,t);assert.equal(accepted.decision,'ACCEPT_COMPLETED');await w.finalize(claim,{state:'RECONCILED',code:null,retrySeconds:null,truth:accepted});return {bookingId:id(201),attemptId:id(204),jobId:claim.id,truthRevision:1,truthFingerprint:accepted.fingerprint,observationFingerprint:flowHash(o),expectedRevision:0};
 }
 try{
 for(const kind of ['DUE_ONLY','CANCELLED_TRANSFER','IDENTITY_MISMATCH'] as const){const c=await db.pool.connect();try{
  await c.query('BEGIN');await c.query("SELECT set_config('zao.actor','synthetic-actor',true),set_config('zao.reason','R14 separate negative synthetic fixture',true)");await clone(c,kind==='DUE_ONLY'?'2035-01-01T08:05:00Z':undefined);
  let ref:ProjectionReference;
  if(kind==='IDENTITY_MISMATCH'){
   const j=(await c.query("SELECT j.id,j.decision_fingerprint,s.truth_revision,s.latest FROM payment_reconciliation.jobs j JOIN payment_reconciliation.streams s USING(environment,merchant_id,payment_id) WHERE j.payment_id='fixture-payment' AND j.decision='ACCEPT_COMPLETED' ORDER BY j.generation LIMIT 1")).rows[0];ref={bookingId:id(201),attemptId:id(204),jobId:j.id,truthRevision:Number(j.truth_revision),truthFingerprint:j.decision_fingerprint,observationFingerprint:flowHash(j.latest),expectedRevision:0};
  }else ref=await truth(c);
  if(kind==='DUE_ONLY')await c.query("SELECT set_config('zao.r14_clock','2035-01-01T08:00:00Z',true)");
  if(kind==='CANCELLED_TRANSFER'){
   await c.query(`INSERT INTO ledger_assets(id,variant_id,family,initial_store_id,store_id,status,bsl_status,bsl_evidence,notes,source_kind,source_document,source_locator) VALUES($1,$2,'SKI','ONSEN_BASE','ONSEN_BASE','AVAILABLE','NOT_APPLICABLE','','','SYNTHETIC','R14 negative transaction','cancelled transfer')`,[id(250),id(6)]);
   await c.query(`INSERT INTO transfer_batches(id,source_store,destination_store,scheduled_date,planned_ready_at,needed_by,basis) VALUES($1,'ONSEN_BASE','MOUNTAIN_BASE','2034-12-31','2034-12-31T08:00:00Z','2034-12-31T23:30:00Z','SYNTHETIC negative transfer')`,[id(270)]);
   await c.query('INSERT INTO transfer_pieces(id,batch_id,line_key,ordinal,asset_id) VALUES($1,$2,$3,1,$4)',[id(271),id(270),id(272),id(250)]);
   await c.query("INSERT INTO inventory_claims(hold_id,requirement_key,asset_id,day,transfer_piece_id) VALUES($1,'one:SKI',$2,'2035-01-01',$3)",[id(202),id(250),id(271)]);
   await c.query("UPDATE transfer_pieces SET state='CANCELLED' WHERE id=$1",[id(271)]);
  }
  const result=await new TransactionalPaymentProjection(new PgPaymentProjection(scoped(c,n.projector),source)).project(ref);
  assert.equal(result.decision,kind==='DUE_ONLY'?'BLOCK_EXPIRED_HOLD':kind==='CANCELLED_TRANSFER'?'BLOCK_TRANSFER_ATTENTION':'BLOCK_IDENTITY_MISMATCH');assert.notEqual(result.bookingState,'CONFIRMED_DEV');
  if(kind==='DUE_ONLY')assert.equal((await c.query('SELECT expires_at>inventory_clock() AS ttl_still_valid FROM inventory_holds WHERE id=$1',[id(202)])).rows[0].ttl_still_valid,true);
  results.push({name:kind,result:'PASS'});console.log('PASS real DB distinct '+kind);
 }catch(e){results.push({name:kind,result:'FAIL'});throw e;}finally{await c.query('ROLLBACK');c.release();writeFileSync(out+'/real-db-boundaries.json',JSON.stringify({kind:'REAL_POSTGRESQL_ROLLED_BACK_SYNTHETIC_TRANSACTIONS',results,providerRequests:0},null,2));}}
 db.r14!.completed.add('boundaries');
 }finally{await db.pool.query(original);}
}
