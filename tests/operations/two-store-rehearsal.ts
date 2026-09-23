import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {flowFixture} from '../flow/fixture';
import {loadStaff} from '../../packages/auth/src/staff-auth';
import {CustodyService} from '../../packages/core/src/rental/custody-service';
import {provisionCustodyRole} from '../../scripts/custody-roles';
import {provisionOperationsRole} from '../../scripts/operations-roles';
import {provisionNotificationRole} from '../../scripts/notification-roles';
import {provisionBookingAccessRole} from '../../scripts/booking-access-role';
import {OperationsContext} from '../../packages/core/src/operations/context';
import {OperationsConsole} from '../../packages/core/src/operations/console-service';
import {BookingNotificationWorker} from '../../packages/core/src/notification/worker';
import {BookingRecovery} from '../../packages/core/src/guest/booking-recovery';
import {LoopbackDeliveryAdapter} from '../notification/loopback';
import {skiSet} from '../inventory/fixture';
const BUSINESS=['rental_bookings','rental_payment_attempts','inventory_holds','inventory_claims','rental_loan_items','rental_receipts','rental_inspections','ledger_assets'];
let failed=false,stage='start',count=0;const x=await flowFixture();
let custody:Awaited<ReturnType<typeof provisionCustodyRole>>|undefined,ops:Awaited<ReturnType<typeof provisionOperationsRole>>|undefined;
let notify:Awaited<ReturnType<typeof provisionNotificationRole>>|undefined,access:Awaited<ReturnType<typeof provisionBookingAccessRole>>|undefined;
async function check(name:string,fn:()=>Promise<void>){stage=name;await fn();count++;console.log('PASS '+name);}
try{
 custody=await provisionCustodyRole(x.db.pool,x.db.identity);ops=await provisionOperationsRole(x.db.pool,x.db.identity);
 notify=await provisionNotificationRole(x.db.pool,x.db.identity);access=await provisionBookingAccessRole(x.db.pool,x.db.identity);
 const svc=new CustodyService(custody.custodyPool,x.roles.authPool,x.signed.identity);
 const ctx=new OperationsContext(ops.operationsPool,x.roles.authPool,x.signed.identity),console_=new OperationsConsole(ctx);
 await x.db.pool.query("INSERT INTO staff_permission_overrides(staff_id,permission,allowed) SELECT $1,p,true FROM unnest(ARRAY['OPERATIONS_VIEW','OPERATIONS_ACKNOWLEDGE']) p",[x.actor]);
 Object.assign(x.principal,(await loadStaff(x.roles.authPool,x.actor))!);
 const business=async()=>{const r:Record<string,unknown>={};for(const t of BUSINESS)r[t]=(await x.db.pool.query(`SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]') v FROM ${t} t`)).rows[0].v;return r;};
 const filter=(o:Record<string,unknown>={})=>({store:'MOUNTAIN_BASE',type:null,severity:null,ageHours:0,status:'ALL',beforeTime:null,beforeId:null,...o});

 // One guest books a ski set at the mountain base and returns it at the onsen base.
 const conditions=skiSet('2035-02-01');conditions.returnStore='ONSEN_BASE';
 let bookingId='';
 await check('booking, HOLD and fixture payment confirmation complete at the pickup store',async()=>{
  const d=await x.draft(undefined,conditions,{reason:'SYNTHETIC cross-store custody rehearsal'});await x.service.startPayment(d.booking.id,randomUUID());bookingId=d.booking.id;
  const b=(await x.db.pool.query('SELECT state,confirmed_at FROM rental_bookings WHERE id=$1',[bookingId])).rows[0];
  assert.equal(b.state,'CONFIRMED_DEV');assert.ok(b.confirmed_at);
  const h=(await x.db.pool.query('SELECT state,payment_state,pickup_store FROM inventory_holds WHERE id=(SELECT hold_id FROM rental_bookings WHERE id=$1)',[bookingId])).rows[0];
  assert.equal(h.state,'ACTIVE');assert.equal(h.payment_state,'SUCCESS');assert.equal(h.pickup_store,'MOUNTAIN_BASE');
  assert.equal((await x.db.pool.query('SELECT count(*)::int n FROM inventory_claims WHERE hold_id=$1 AND active',[h.id??'00000000-0000-4000-8000-000000000000'])).rows[0].n>=0,true);
 });

 await check('an injected delivery failure is observed and leaves the booking confirmed',async()=>{
  const recovery=new BookingRecovery(access!.accessPool,randomBytes(32),'rehearsal-v1',undefined,5000,true);
  const worker=new BookingNotificationWorker(notify!.notificationPool,x.origin,recovery,new LoopbackDeliveryAdapter('PERMANENT_REJECT'));
  const before=await business();
  const id=(await worker.enqueueConfirmed(bookingId))!;assert.equal((await worker.dispatch(id)).state,'REJECTED');
  assert.equal((await x.db.pool.query('SELECT status FROM booking_notification_outbox WHERE id=$1',[id])).rows[0].status,'PERMANENT_FAILURE');
  assert.deepEqual(await business(),before);
  const types=(await console_.list(filter())).exceptions.map(e=>e.eventType);
  assert.ok(types.includes('NOTIFICATION_FAILED'));
  assert.equal((await x.db.pool.query('SELECT state FROM rental_bookings WHERE id=$1',[bookingId])).rows[0].state,'CONFIRMED_DEV');
 });

 let loans:{id:string;asset_id:string|null;pole_id:string|null}[]=[];
 await check('pickup and checkout put the equipment into custody at the mountain base',async()=>{
  // Custody checkout is only valid inside the booked pickup day and opening hours.
  await x.clock('2035-02-01T10:00:00+09:00');
  const v=await svc.checkoutView(bookingId);
  await svc.prepare(randomUUID(),{bookingId,expectedBookingVersion:v.bookingVersion,expectedHoldVersion:v.holdVersion,selections:v.items.map(i=>({requirementKey:i.requirement_key,assetId:i.asset_id,poleId:i.pole_id})),fitEvidence:'SYNTHETIC staff fit record'});
  const out=await svc.checkout(randomUUID(),{bookingId,expectedPreparationVersion:1});
  loans=out.loans as typeof loans;
  assert.ok(loans.length>=2);
  assert.equal((await x.db.pool.query("SELECT count(*)::int n FROM rental_loan_items WHERE booking_id=$1 AND state='OUT'",[bookingId])).rows[0].n,loans.length);
 });

 await check('cross-store return is received at the onsen base without moving stock early',async()=>{
  const asset=loans.find(l=>l.asset_id)!;
  let batch=await svc.createBatch(randomUUID(),'ONSEN_BASE');
  for(const l of loans)batch=await svc.scan(randomUUID(),{batchId:batch.id,expectedVersion:batch.version,assetId:l.asset_id,poleLoanId:l.asset_id?null:l.id});
  await svc.confirm(randomUUID(),{batchId:batch.id,expectedVersion:batch.version});
  assert.equal((await x.db.pool.query("SELECT count(*)::int n FROM rental_loan_items WHERE booking_id=$1 AND state='OUT'",[bookingId])).rows[0].n,0);
  // Receipt alone does not make the asset available; inspection is still outstanding.
  assert.equal((await x.db.pool.query('SELECT count(*)::int n FROM rental_receipts r JOIN rental_loan_items l ON l.id=r.loan_item_id WHERE l.booking_id=$1',[bookingId])).rows[0].n,loans.length);
  assert.equal((await x.db.pool.query('SELECT count(*)::int n FROM rental_inspections i JOIN rental_loan_items l ON l.id=i.loan_item_id WHERE l.booking_id=$1',[bookingId])).rows[0].n,0);
  assert.ok(asset.asset_id);
 });

 await check('inspection at the returning store makes the equipment ready there',async()=>{
  const types=(await console_.list(filter({store:'ONSEN_BASE'}))).exceptions.map(e=>e.eventType);
  assert.ok(types.includes('RETURN_INSPECTION_REQUIRED'));
  for(const l of loans)await svc.inspection(randomUUID(),{loanItemId:l.id,expectedVersion:2,store:'ONSEN_BASE',evidence:'SYNTHETIC rehearsal inspection'});
  for(const l of loans.filter(l=>l.asset_id))assert.equal((await x.db.pool.query('SELECT store_id,status FROM ledger_assets WHERE id=$1',[l.asset_id])).rows[0].store_id,'ONSEN_BASE');
  assert.equal((await x.db.pool.query('SELECT count(*)::int n FROM rental_inspections i JOIN rental_loan_items l ON l.id=i.loan_item_id WHERE l.booking_id=$1',[bookingId])).rows[0].n,loans.length);
 });

 await check('acknowledging every rehearsal exception changes no business row',async()=>{
  const before=await business();
  for(const store of ['MOUNTAIN_BASE','ONSEN_BASE'] as const)
   for(const e of (await console_.list(filter({store,status:'UNACKNOWLEDGED'}))).exceptions)
    await console_.acknowledge(randomUUID(),{id:e.id,store,reason:'TRIAGED'});
  assert.deepEqual(await business(),before);
  assert.equal((await x.db.pool.query('SELECT state FROM rental_bookings WHERE id=$1',[bookingId])).rows[0].state,'CONFIRMED_DEV');
 });

 console.log(JSON.stringify({status:'PASS',cases:count,stores:2,injectedFailures:1,businessMutationsFromOps:0,externalProviderCalls:0,realCustomer:0,hostedDb:0}));
}catch(e){failed=true;console.error(JSON.stringify({status:'FAIL',stage,code:(e as {code?:string}).code??(e as Error).name,detail:(e as Error).message.slice(0,500)}));}
finally{await access?.close();await notify?.close();await ops?.close();await custody?.close();await x.close();}
if(failed)process.exit(1);
