import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {flowFixture,simulation} from '../flow/fixture';
import {seedInventory,skiSet} from '../inventory/fixture';
import {provisionGuestRole} from '../../scripts/guest-roles';
import {provisionBookingAccessRole} from '../../scripts/booking-access-role';
import {provisionNotificationRole} from '../../scripts/notification-roles';
import {GuestContexts} from '../../packages/core/src/guest/context';
import {BookingAccess} from '../../packages/core/src/guest/booking-access';
import {BookingRecovery} from '../../packages/core/src/guest/booking-recovery';
import {BookingNotificationWorker} from '../../packages/core/src/notification/worker';
import {HoldService} from '../../packages/core/src/inventory/hold-service';
import {QuoteService} from '../../packages/core/src/pricing/quote-service';
import {BookingService} from '../../packages/core/src/payment/booking-service';
import {bookingAccessHandler} from '../../apps/web/src/lib/booking-access-http';
const x=await flowFixture();let guest:Awaited<ReturnType<typeof provisionGuestRole>>|undefined,role:Awaited<ReturnType<typeof provisionBookingAccessRole>>|undefined,notify:Awaited<ReturnType<typeof provisionNotificationRole>>|undefined;
try{
 await seedInventory(x.db.pool,true);guest=await provisionGuestRole(x.db.pool,x.db.identity);role=await provisionBookingAccessRole(x.db.pool,x.db.identity);notify=await provisionNotificationRole(x.db.pool,x.db.identity);
 const contexts=new GuestContexts(guest.guestPool),session=await contexts.create(),actor=await contexts.resolve(session.token),access=new BookingAccess(role.accessPool,randomBytes(32),'test-v1'),recovery=new BookingRecovery(role.accessPool,randomBytes(32),'test-v1',undefined,5000,true);
 const holds=new HoldService(x.roles.holdPool,actor),quotes=new QuoteService(x.roles.pricingPool,actor),bookings=new BookingService(x.flow.flowPool,guest.guestPool,actor,x.fake,simulation);
 async function booking(day:string){const conditions=skiSet(day),h=await holds.command('create',randomUUID(),conditions);assert.equal(h.result,'CREATED');const q=(await quotes.create(randomUUID(),{conditions,holdId:h.holdId,couponCode:null,wantAdvance:false})).quote,b=await bookings.create(randomUUID(),q.id,{displayName:'SYNTHETIC Cancel Recovery',email:'synthetic-cancel-recovery@example.invalid',termsAccepted:true});await bookings.startPayment(b.id,randomUUID());return b;}
 const original=await booking('2035-02-05'),b=await booking('2035-02-06'),other=await booking('2035-02-07');
 const first=await bookings.cancellationPreview(original.id);await bookings.cancel(original.id,randomUUID(),first.previewHash);assert.equal((await bookings.get(original.id)).state,'CANCELLED');
 console.log('PASS original maintained guest context still cancels through the existing path');
 await x.clock('2035-01-02T10:00:00+09:00');await assert.rejects(contexts.resolve(session.token));
 let message='';const worker=new BookingNotificationWorker(notify.notificationPool,x.origin,recovery,{async send(m){message=m.text;return {state:'ACCEPTED',providerMessageId:'synthetic-message'};}});
 async function recover(){const requestId=randomUUID();await recovery.request(b.id,'synthetic-cancel-recovery@example.invalid',requestId,'en');const outbox=(await x.db.pool.query("SELECT id FROM booking_notification_outbox WHERE booking_id=$1 AND recovery_request_id=$2",[b.id,requestId])).rows[0];assert.ok(outbox);await worker.dispatch(outbox.id);const code=message.match(/Recovery code: ([-_A-Za-z0-9]{43})(?:\n|$)/)?.[1];assert.ok(code,'rendered recovery message contains the proof');const exchangeId=randomUUID(),r=await recovery.exchange(code,exchangeId);assert.ok(r.cancelToken);const replay=await recovery.exchange(code,exchangeId);assert.equal(replay.cancelToken,r.cancelToken);assert.equal(replay.cancelMaxAgeSeconds,r.cancelMaxAgeSeconds);return {r,code,exchangeId};}
 let verified=await recover();const token=verified.r.cancelToken!;
 const api=bookingAccessHandler(access,contexts,x.origin,async()=>{},recovery);
 async function post(path:string,body:unknown,cookie:string,origin=x.origin){return api(new Request(x.origin+'/api/booking-access'+path,{method:'POST',headers:{origin,cookie,'content-type':'application/json'},body:JSON.stringify(body)}));}
 const readCookie='zao_booking_access='+verified.r.token,actionCookie='zao_booking_cancel='+token;
 assert.equal((await access.read(verified.r.token)).readOnly,true);assert.equal((await access.read(verified.r.token)).cancellationAllowed,false);
 assert.equal((await post('/cancel',{bookingId:b.id,requestKey:randomUUID(),previewHash:'a'.repeat(64)},readCookie)).status,401);
 await assert.rejects(access.cancellationPreview(verified.r.token,b.id),{code:'CANCELLATION_AUTHORITY_DENIED'});
 await assert.rejects(access.cancellationPreview(token,other.id),{code:'CANCELLATION_AUTHORITY_DENIED'});
 assert.equal((await post('/cancellation-preview',{bookingId:b.id},actionCookie,'https://foreign.invalid')).status,403);
 for(const path of ['/amend','/payment','/inventory','/staff'])assert.equal((await post(path,{},actionCookie)).status,404);
 for(const sql of ['SELECT * FROM booking_access.cancellation_actions','SELECT booking_access.assert_cancellation($1,$2)','SELECT booking_cancel(NULL,NULL,NULL)','UPDATE rental_bookings SET state=state','INSERT INTO inventory_claims DEFAULT VALUES'])await assert.rejects(role.accessPool.query(sql,sql.includes('$')?['a'.repeat(64),b.id]:[]),{code:'42501'});
 console.log('PASS recovery/outbox after guest expiry issues separate CANCEL-only authority; read token, wrong booking, CSRF and unrelated writes rejected');
 await x.clock('2035-01-02T10:11:00+09:00');await assert.rejects(access.cancellationPreview(token,b.id),{code:'CANCELLATION_AUTHORITY_DENIED'});assert.equal((await recovery.exchange(verified.code,verified.exchangeId)).cancelToken,null);
 verified=await recover();const preview=await access.cancellationPreview(verified.r.cancelToken,b.id),key=randomUUID();
 const results=await Promise.all([access.cancel(verified.r.cancelToken,b.id,key,preview.previewHash),access.cancel(verified.r.cancelToken,b.id,key,preview.previewHash)]);assert.deepEqual(results[0],results[1]);
 const replay=await access.cancel(verified.r.cancelToken,b.id,key,preview.previewHash);assert.deepEqual(replay,results[0]);assert.equal((await access.read(verified.r.token)).state,'CANCELLED');
 for(const table of ['booking_cancellations','booking_cancellation_refunds'])assert.equal((await x.db.pool.query(`SELECT count(*)::int n FROM ${table} WHERE booking_id=$1`,[b.id])).rows[0].n,1);
 assert.equal((await x.db.pool.query('SELECT state FROM rental_bookings WHERE id=$1',[other.id])).rows[0].state,'CONFIRMED_DEV');
 await access.revoke(verified.r.token);await assert.rejects(access.cancellationPreview(verified.r.cancelToken,b.id),{code:'CANCELLATION_AUTHORITY_DENIED'});
 console.log('PASS expiry cannot be extended by exchange replay; fresh email proof works; concurrent cancellation/lost-response replay creates one cancellation/refund; read revocation invalidates action');
}finally{await notify?.close();await role?.close();await guest?.close();await x.close();}
