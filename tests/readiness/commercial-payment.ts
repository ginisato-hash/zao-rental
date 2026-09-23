import assert from 'node:assert/strict';
import {flowFixture} from '../flow/fixture';
import {commercialBookingFixture} from '../fixtures/commercial-booking';
import {PgProjectionTransaction} from '../../packages/db/src/internal/payment-projection';
import {decidePaymentProjection,verifyProjectionSource} from '../../packages/core/src/payment/payment-projection';
import {BookingService} from '../../packages/core/src/payment/booking-service';
const x=await flowFixture();
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
 console.log('PASS Production-shaped persisted truth + approved immutable price + inventory -> CONFIRMED through internal SQL worker; forged public identity rejected; provider calls 0.');
}finally{await x.close();}
