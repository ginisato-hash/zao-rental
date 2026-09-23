import {randomUUID} from 'node:crypto';
import {provisionOperationsRole} from '../../scripts/operations-roles';
import {CustodyService} from '../../packages/core/src/rental/custody-service';
import {ManifestService} from '../../packages/core/src/operations/manifest-service';
import assert from 'node:assert/strict';
import {flowFixture} from '../flow/fixture';
import {commercialBookingFixture} from '../fixtures/commercial-booking';
import {PgProjectionTransaction} from '../../packages/db/src/internal/payment-projection';
import {decidePaymentProjection,verifyProjectionSource} from '../../packages/core/src/payment/payment-projection';
import {BookingService} from '../../packages/core/src/payment/booking-service';
const x=await flowFixture();let operations:Awaited<ReturnType<typeof provisionOperationsRole>>|undefined;
try{
 const f=await commercialBookingFixture(x);
 // Public authority remains closed even with valid-looking configuration/capability shapes.
 assert.throws(()=>new BookingService(x.flow.flowPool,x.roles.authPool,x.signed.identity,{kind:'SQUARE_PRODUCTION',async create(){throw Error('UNREACHABLE');},async lookup(){throw Error('UNREACHABLE');}},null,{kind:'EXACT_PRODUCTION_IDENTITY'}),{code:'PRODUCTION_PAYMENT_AUTHORITY_REQUIRED'});
 const c=await x.db.pool.connect();
 try{
  await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(71820600)');
  const tx=new PgProjectionTransaction(c,f.ref),state=await tx.load(),source=await tx.source(),now=await tx.time();
  assert.equal(state.quote?.commercialPriceValid,true);const observation=verifyProjectionSource(f.ref,source,now,'PRODUCTION'),plan=decidePaymentProjection(state,observation,now);
  assert.equal(plan.decision,'APPLY_COMPLETED');assert.equal((await tx.persist(state,plan,f.ref,now)).bookingState,'CONFIRMED');await c.query('COMMIT');
  assert.equal((await tx.prior(f.ref.observationFingerprint))?.result.bookingState,'CONFIRMED');
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
 const row=(await x.db.pool.query('SELECT state,price_snapshot FROM rental_bookings WHERE id=$1',[f.bookingId])).rows[0];assert.equal(row.state,'CONFIRMED');assert.equal(row.price_snapshot.chargeReady,true);
 assert.equal((await x.db.pool.query('SELECT count(*)::int n FROM payment_projection.events')).rows[0].n,1);
 const cancelled=await commercialBookingFixture(x,'2035-02-11'),db=await x.db.pool.connect();try{await db.query('BEGIN');await db.query("SELECT set_config('zao.actor',$1,true)",[x.actor]);const preview=(await db.query('SELECT booking_cancellation_preview($1) v',[cancelled.bookingId])).rows[0].v;await db.query('SELECT booking_cancel($1,$2,$3::jsonb)',[cancelled.bookingId,crypto.randomUUID(),JSON.stringify(preview)]);await db.query('COMMIT');
  await db.query('BEGIN');const tx=new PgProjectionTransaction(db,cancelled.ref),state=await tx.load(),now=await tx.time(),observed=verifyProjectionSource(cancelled.ref,await tx.source(),now,'PRODUCTION'),plan=decidePaymentProjection(state,observed,now);assert.equal(plan.mutation,'CANCELLED_PAYMENT');assert.equal((await tx.persist(state,plan,cancelled.ref,now)).bookingState,'CANCELLED');await db.query('COMMIT');
  assert.equal((await db.query('SELECT state FROM inventory_holds WHERE id=$1',[cancelled.holdId])).rows[0].state,'RELEASED');assert.equal((await db.query('SELECT count(*)::int n FROM booking_cancellation_refunds WHERE booking_id=$1',[cancelled.bookingId])).rows[0].n,1);
 }catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
 await assert.rejects(x.db.pool.query("UPDATE rental_bookings SET state='CONFIRMED_DEV',version=version+1 WHERE id=$1",[f.bookingId]),{code:'23514',constraint:'rental_bookings_mode_state_check'});
 const noPickup=await commercialBookingFixture(x,'2035-02-12');const nc=await x.db.pool.connect();try{await nc.query('BEGIN');const tx=new PgProjectionTransaction(nc,noPickup.ref),state=await tx.load(),now=await tx.time(),o=verifyProjectionSource(noPickup.ref,await tx.source(),now,'PRODUCTION');await tx.persist(state,decidePaymentProjection(state,o,now),noPickup.ref,now);await nc.query('COMMIT');}finally{nc.release();}
 operations=await provisionOperationsRole(x.db.pool,x.db.identity);
 const custody=new CustodyService(operations.operationsPool,x.roles.authPool,x.signed.identity),manifest=new ManifestService(operations.operationsPool,x.roles.authPool,x.signed.identity);
 await x.clock('2035-02-10T10:00:00+09:00');
 const before=await manifest.manifest({store:'MOUNTAIN_BASE',date:'2035-02-10',section:'pickup',cursor:null,pageSize:100});assert.equal((before.rows as Record<string,unknown>[]).find(r=>r.bookingId===f.bookingId)?.nextAction,'PREPARE_EQUIPMENT');
 const view=await custody.checkoutView(f.bookingId),prepared=await custody.prepare(randomUUID(),{bookingId:f.bookingId,expectedBookingVersion:view.bookingVersion,expectedHoldVersion:view.holdVersion,selections:view.items.map(i=>({requirementKey:i.requirement_key,assetId:i.asset_id,poleId:i.pole_id})),fitEvidence:'SYNTHETIC commercial operational proof'});
 const after=await manifest.manifest({store:'MOUNTAIN_BASE',date:'2035-02-10',section:'pickup',cursor:null,pageSize:100});assert.equal((after.rows as Record<string,unknown>[]).find(r=>r.bookingId===f.bookingId)?.nextAction,'CHECKOUT');
 const checked=await custody.checkout(randomUUID(),{bookingId:f.bookingId,expectedPreparationVersion:prepared.preparation.version});assert.equal(checked.loans.length,3);assert.ok(checked.loans.every(l=>l.state==='OUT'));
 await x.clock('2035-02-12T17:01:00+09:00');await custody.completeNoPickup(randomUUID(),{bookingId:noPickup.bookingId});assert.equal((await x.db.pool.query('SELECT state FROM rental_bookings WHERE id=$1',[noPickup.bookingId])).rows[0].state,'COMPLETED');
 assert.equal((await x.db.pool.query('SELECT state FROM inventory_holds WHERE id=$1',[noPickup.holdId])).rows[0].state,'RELEASED');
 console.log('PASS Production CONFIRMED → manifest preparation → prepare → manifest checkout → real custody OUT; no-pickup → COMPLETED; illegal Production/CONFIRMED_DEV CHECK rejected.');
 console.log('PASS Production-shaped persisted truth + approved immutable price + inventory -> CONFIRMED through internal SQL worker; forged public identity rejected; provider calls 0.');
}finally{await operations?.close();await x.close();}
