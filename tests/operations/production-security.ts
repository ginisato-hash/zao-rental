import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {flowFixture} from '../flow/fixture';
import {provisionNotificationRole} from '../../scripts/notification-roles';
import {provisionBookingAccessRole} from '../../scripts/booking-access-role';
import {BookingService} from '../../packages/core/src/payment/booking-service';
import {BookingNotificationWorker} from '../../packages/core/src/notification/worker';
import {BookingRecovery} from '../../packages/core/src/guest/booking-recovery';
import {productionNotificationDelivery} from '../../packages/core/src/notification/production-delivery';
import {exportOwnedDatabase,restoreIntoFreshDatabase} from '../../scripts/local-restore';
import {simulation} from '../flow/fixture';
import {requestFor} from '../inventory/fixture';
let failed=false,stage='fixture',count=0;const x=await flowFixture();
let notify:Awaited<ReturnType<typeof provisionNotificationRole>>|undefined,access:Awaited<ReturnType<typeof provisionBookingAccessRole>>|undefined;
async function check(name:string,fn:()=>Promise<void>){stage=name;await fn();count++;console.log('PASS '+name);}
try{
 notify=await provisionNotificationRole(x.db.pool,x.db.identity);access=await provisionBookingAccessRole(x.db.pool,x.db.identity);

 await check('with payment off no charge can be created and no attempt is recorded',async()=>{
  // A runtime composed without a payment gateway is the payment-off shape.
  const disabled=new BookingService(x.flow.flowPool,x.roles.authPool,x.signed.identity,null,simulation);
  const conditions=requestFor('2035-05-01');
  await assert.rejects(disabled.create(randomUUID(),randomUUID(),{displayName:'SYNTHETIC Guest',email:'synthetic-guest@example.invalid',termsAccepted:true}),{code:'PAYMENT_NOT_CONNECTED_CHARGE_DISABLED',status:503});
  const d=await x.draft(undefined,conditions,{reason:'SYNTHETIC disabled-provider security fixture'});
  const before=(await x.db.pool.query('SELECT count(*)::int n FROM rental_payment_attempts')).rows[0].n;
  await assert.rejects(disabled.startPayment(d.booking.id,randomUUID()),{code:'PAYMENT_NOT_CONNECTED_CHARGE_DISABLED',status:503});
  await assert.rejects(disabled.reconcile(d.booking.id),{code:'PAYMENT_NOT_CONNECTED_CHARGE_DISABLED',status:503});
  assert.equal((await x.db.pool.query('SELECT count(*)::int n FROM rental_payment_attempts')).rows[0].n,before);
  assert.equal((await x.db.pool.query('SELECT state FROM rental_bookings WHERE id=$1',[d.booking.id])).rows[0].state,'DRAFT');
  assert.equal((await x.db.pool.query('SELECT count(*)::int n FROM rental_provider_events')).rows[0].n,0);
 });

 await check('with notification off nothing is delivered and no attempt is consumed',async()=>{
  const recovery=new BookingRecovery(access!.accessPool,randomBytes(32),'security-v1',undefined,5000,true);
  const off=new BookingNotificationWorker(notify!.notificationPool,x.origin,recovery);
  assert.equal(off.status(),'BOOKING_RECOVERY_DELIVERY_UNCONNECTED');
  const d=await x.draft(undefined,requestFor('2035-05-02'),{reason:'SYNTHETIC disabled-provider security fixture'});await x.service.startPayment(d.booking.id,randomUUID());
  const id=(await off.enqueueConfirmed(d.booking.id))!;
  assert.equal((await off.dispatch(id)).state,'UNCONNECTED');
  assert.equal((await off.reconcile(id)).state,'UNCONNECTED');
  assert.deepEqual(await off.runBatch(),{state:'UNCONNECTED',processed:0});
  const row=(await x.db.pool.query('SELECT status,attempt_count,provider_message_id FROM booking_notification_outbox WHERE id=$1',[id])).rows[0];
  assert.equal(row.status,'PENDING');assert.equal(row.attempt_count,0);assert.equal(row.provider_message_id,null);
  // An unconfigured provider fails closed rather than falling back to some default sender.
  await assert.rejects(productionNotificationDelivery(undefined),{code:'BOOKING_RECOVERY_DELIVERY_UNCONNECTED'});
  assert.equal((await x.db.pool.query('SELECT state FROM rental_bookings WHERE id=$1',[d.booking.id])).rows[0].state,'CONFIRMED_DEV');
 });

 await check('a restore can never target a Production or otherwise unowned identity',async()=>{
  const envelope=await exportOwnedDatabase(x.db.pool,x.db.identity);
  for(const identity of [
   {namespace:'zao_rental_production',database:'zao_rental_production'},
   {namespace:'neondb',database:'neondb'},
   {namespace:x.db.identity.namespace,database:'postgres'},
  ])await assert.rejects(exportOwnedDatabase(x.db.pool,identity),/UNOWNED_SOURCE_REFUSED/);
  await assert.rejects(restoreIntoFreshDatabase(x.db.pool,{namespace:'zao_rental_production',database:'zao_rental_production',dbPort:x.db.identity.dbPort,user:x.db.identity.user},envelope),/UNOWNED_SOURCE_REFUSED/);
  // The source database is never a restore target: the function always creates its own.
  const restored=await restoreIntoFreshDatabase(x.db.pool,x.db.identity,envelope);
  try{assert.notEqual(restored.database,x.db.identity.database);assert.match(restored.database,/^zr_[a-f0-9]{12}$/);}
  finally{await restored.stop();await x.db.pool.query(`DROP DATABASE IF EXISTS ${restored.database}`);}
 });

 console.log(JSON.stringify({status:'PASS',cases:count,chargesCreated:0,notificationsSent:0,productionRestores:0}));
}catch(e){failed=true;console.error(JSON.stringify({status:'FAIL',stage,code:(e as {code?:string}).code??(e as Error).name,detail:(e as Error).message.slice(0,500)}));}
finally{await access?.close();await notify?.close();await x.close();}
if(failed)process.exit(1);
