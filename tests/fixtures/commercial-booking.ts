import {randomUUID} from 'node:crypto';
import {flowHash,type PaymentObservation} from '../../packages/contracts/src/rental-flow';
import {deriveApprovedCommercialPriceFacts,type CommercialPriceBook} from '../../packages/core/src/pricing/commercial-price-authority';
import {skiSet} from '../inventory/fixture';
import type {flowFixture} from '../flow/fixture';
/** Direct local schema fixture, not an identity/permit issuer or a Production service accept proof. */
export async function commercialBookingFixture(x:Awaited<ReturnType<typeof flowFixture>>,day='2035-02-10'){
 const conditions=skiSet(day),hold=await x.holds.command('create',randomUUID(),conditions,undefined,undefined,{reason:'SYNTHETIC commercial transport proof'});
 if(hold.result!=='CREATED')throw Error('FIXTURE_STOCK_REQUIRED');
 const ordinary=(await x.quotes.create(randomUUID(),{conditions,holdId:hold.holdId,couponCode:null,wantAdvance:false})).quote;
 const book=(await x.db.pool.query<CommercialPriceBook>('SELECT * FROM price_books WHERE id=$1',[ordinary.snapshot.priceBookId])).rows[0]!;
 const snapshot={...ordinary.snapshot,totalJpy:Number(ordinary.snapshot.totalJpy),chargeReady:true,commercialApproval:deriveApprovedCommercialPriceFacts(book)},quoteId=randomUUID(),bookingId=conditions.reservationId,attemptId=randomUUID(),key=randomUUID(),merchantId='SYNTHETIC-PRODUCTION-MERCHANT',locationId='SYNTHETIC-PRODUCTION-LOCATION';
 await x.db.pool.query("SELECT set_config('zao.actor',$1,false)",[x.actor]);
 await x.db.pool.query(`INSERT INTO price_quotes(id,actor,request_key,request_fingerprint,book_id,activation_id,coupon_id,hold_id,hold_version,conditions,snapshot,snapshot_sha256,expires_at)
 SELECT $2,actor,$3,request_fingerprint,book_id,activation_id,coupon_id,hold_id,hold_version,conditions,$4,$5,expires_at FROM price_quotes WHERE id=$1`,[ordinary.id,quoteId,randomUUID(),JSON.stringify(snapshot),flowHash(snapshot)]);
 await x.db.pool.query(`INSERT INTO rental_bookings(id,owner_id,request_key,fingerprint,hold_id,quote_id,conditions,price_snapshot,price_sha256,contact,mode,state)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'SQUARE_PRODUCTION','PAYMENT_PENDING')`,[bookingId,x.actor,randomUUID(),flowHash(bookingId),hold.holdId,quoteId,JSON.stringify(conditions),JSON.stringify(snapshot),flowHash(snapshot),JSON.stringify({displayName:'SYNTHETIC Commercial',email:'synthetic-commercial@example.invalid',termsAccepted:true,termsVersion:'ZAO_CANCELLATION_V1'})]);
 await x.db.pool.query(`INSERT INTO rental_payment_attempts(id,booking_id,actor,idempotency_key,merchant_id,location_id,amount_jpy,currency,state,provider_id) VALUES($1,$2,$3,$4,$5,$6,$7,'JPY','PENDING',$8)`,[attemptId,bookingId,x.actor,key,merchantId,locationId,snapshot.totalJpy,'synthetic-'+attemptId]);
 await x.db.pool.query("UPDATE inventory_holds SET payment_state='PENDING',version=version+1 WHERE id=$1",[hold.holdId]);
 const observation:PaymentObservation={providerId:'synthetic-'+attemptId,referenceId:bookingId,idempotencyKey:key,merchantId,locationId,amountJpy:Number(snapshot.totalJpy),currency:'JPY',status:'COMPLETED',updatedAt:x.now().toISOString(),completedAt:x.now().toISOString()};
 const eventId='synthetic-'+randomUUID();await x.db.pool.query("SELECT square_webhook.receive_production($1,'payment.updated',$2,$3,$4)",[eventId,merchantId,observation.providerId,flowHash(observation)]);
 await x.db.pool.query('SELECT payment_reconciliation.dispatch_production($1,10)',[merchantId]);
 const job=(await x.db.pool.query('SELECT id FROM payment_reconciliation.jobs WHERE payment_id=$1',[observation.providerId])).rows[0]!,contextFingerprint=flowHash({bookingId,attemptId}),decisionFingerprint=flowHash({engine:'payment-truth-v1',contextFingerprint,paymentId:observation.providerId,decision:'ACCEPT_COMPLETED',observation});
 await x.db.pool.query("UPDATE payment_reconciliation.streams SET truth_revision=1,latest=$3 WHERE environment='PRODUCTION' AND merchant_id=$1 AND payment_id=$2",[merchantId,observation.providerId,JSON.stringify(observation)]);
 await x.db.pool.query("UPDATE payment_reconciliation.jobs SET state='RECONCILED',terminal_at=clock_timestamp(),decision='ACCEPT_COMPLETED',context_fingerprint=$2,decision_fingerprint=$3 WHERE id=$1",[job.id,contextFingerprint,decisionFingerprint]);
 const ref={bookingId,attemptId,jobId:job.id as string,truthRevision:1,truthFingerprint:decisionFingerprint,observationFingerprint:flowHash(observation),expectedRevision:0};
 return {conditions,holdId:hold.holdId!,quoteId,bookingId,attemptId,ref,observation,snapshot};
}
