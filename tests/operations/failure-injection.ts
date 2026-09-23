import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {flowFixture} from '../flow/fixture';
import {loadStaff} from '../../packages/auth/src/staff-auth';
import {provisionOperationsRole} from '../../scripts/operations-roles';
import {provisionNotificationRole} from '../../scripts/notification-roles';
import {provisionBookingAccessRole} from '../../scripts/booking-access-role';
import {OperationsContext} from '../../packages/core/src/operations/context';
import {OperationsConsole} from '../../packages/core/src/operations/console-service';
import {observeOperationalFailure} from '../../packages/core/src/operations/ops-signal';
import {FinancialOperations,type RefundRequest} from '../../packages/core/src/operations/financial';
import {BookingNotificationWorker} from '../../packages/core/src/notification/worker';
import {BookingRecovery} from '../../packages/core/src/guest/booking-recovery';
import {LoopbackDeliveryAdapter} from '../notification/loopback';
import {requestFor,fid} from '../inventory/fixture';
const BUSINESS=['rental_bookings','rental_payment_attempts','inventory_holds','inventory_claims','price_quotes','ops_refund_requests','ops_charge_requests','rental_loan_items','transfer_batches','transfer_pieces','booking_notification_outbox'];
let failed=false,stage='fixture',count=0;const x=await flowFixture();
let ops:Awaited<ReturnType<typeof provisionOperationsRole>>|undefined,notify:Awaited<ReturnType<typeof provisionNotificationRole>>|undefined,access:Awaited<ReturnType<typeof provisionBookingAccessRole>>|undefined;
async function check(name:string,fn:()=>Promise<void>){stage=name;await fn();count++;console.log('PASS '+name);}
const filter=(o:Record<string,unknown>={})=>({store:'MOUNTAIN_BASE',type:null,severity:null,ageHours:0,status:'ALL',beforeTime:null,beforeId:null,...o});
try{
 ops=await provisionOperationsRole(x.db.pool,x.db.identity);notify=await provisionNotificationRole(x.db.pool,x.db.identity);access=await provisionBookingAccessRole(x.db.pool,x.db.identity);
 const ctx=new OperationsContext(ops.operationsPool,x.roles.authPool,x.signed.identity),console_=new OperationsConsole(ctx);
 await x.db.pool.query("INSERT INTO staff_permission_overrides(staff_id,permission,allowed) SELECT $1,p,true FROM unnest(ARRAY['OPERATIONS_VIEW','OPERATIONS_ACKNOWLEDGE','REFUND_OVERRIDE']) p",[x.actor]);
 Object.assign(x.principal,(await loadStaff(x.roles.authPool,x.actor))!);
 const business=async()=>{const r:Record<string,unknown>={};for(const t of BUSINESS)r[t]=(await x.db.pool.query(`SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]') v FROM ${t} t`)).rows[0].v;return r;};
 const types=async(o:Record<string,unknown>={})=>(await console_.list(filter(o))).exceptions.map(e=>e.eventType);
 const recovery=new BookingRecovery(access.accessPool,randomBytes(32),'ops-fixture-v1',undefined,5000,true);

 // Payment acceptance is lost after the provider saved it: local knowledge is UNKNOWN only.
 const unknownPaid=await x.draft(undefined,requestFor('2035-02-21'),{reason:'SYNTHETIC operational failure observation'});x.fake.failAfterSave=true;await x.service.startPayment(unknownPaid.booking.id,randomUUID());x.fake.failAfterSave=false;
 await check('payment UNKNOWN is observed without ever confirming the booking',async()=>{
  const b=(await x.db.pool.query('SELECT state,confirmed_at FROM rental_bookings WHERE id=$1',[unknownPaid.booking.id])).rows[0];
  assert.equal(b.state,'PAYMENT_PENDING');assert.equal(b.confirmed_at,null);
  assert.equal((await x.db.pool.query('SELECT state FROM rental_payment_attempts WHERE booking_id=$1',[unknownPaid.booking.id])).rows[0].state,'UNKNOWN');
  assert.ok((await types()).includes('PAYMENT_UNKNOWN'));
 });

 const confirmed=await x.draft(undefined,requestFor('2035-02-22'),{reason:'SYNTHETIC operational failure observation'});await x.service.startPayment(confirmed.booking.id,randomUUID());
 await check('notification permanent failure never invalidates the confirmed booking',async()=>{
  const before=await business();
  const rejecting=new LoopbackDeliveryAdapter('PERMANENT_REJECT'),worker=new BookingNotificationWorker(notify!.notificationPool,x.origin,recovery,rejecting);
  const id=(await worker.enqueueConfirmed(confirmed.booking.id))!;
  assert.equal((await worker.dispatch(id)).state,'REJECTED');
  assert.equal((await x.db.pool.query('SELECT status FROM booking_notification_outbox WHERE id=$1',[id])).rows[0].status,'PERMANENT_FAILURE');
  const b=(await x.db.pool.query('SELECT state,confirmed_at FROM rental_bookings WHERE id=$1',[confirmed.booking.id])).rows[0];
  assert.equal(b.state,'CONFIRMED_DEV');assert.ok(b.confirmed_at);
  assert.deepEqual({...await business(),booking_notification_outbox:null},{...before,booking_notification_outbox:null});
  assert.ok((await types()).includes('NOTIFICATION_FAILED'));
 });

 await check('lost delivery acceptance stays UNKNOWN and sends no second message',async()=>{
  const timeout=new LoopbackDeliveryAdapter('TIMEOUT_BEFORE_ACCEPT'),worker=new BookingNotificationWorker(notify!.notificationPool,x.origin,recovery,timeout);
  const second=await x.draft(undefined,requestFor('2035-02-23'),{reason:'SYNTHETIC operational failure observation'});await x.service.startPayment(second.booking.id,randomUUID());
  const id=(await worker.enqueueConfirmed(second.booking.id))!;await worker.dispatch(id);
  const sent=timeout.calls;await worker.reconcile(id);
  assert.equal(timeout.calls,sent);
  assert.equal((await x.db.pool.query('SELECT count(*)::int n FROM booking_notification_outbox WHERE booking_id=$1',[second.booking.id])).rows[0].n,1);
  assert.equal((await x.db.pool.query('SELECT state FROM rental_bookings WHERE id=$1',[second.booking.id])).rows[0].state,'CONFIRMED_DEV');
 });

 await check('refund acceptance uncertainty blocks another refund and is observed once',async()=>{
  const financial=new FinancialOperations(ctx),p=(await x.db.pool.query('SELECT id FROM rental_payment_attempts WHERE booking_id=$1',[confirmed.booking.id])).rows[0];
  const input={bookingId:confirmed.booking.id,paymentId:p.id,actingStore:'MOUNTAIN_BASE',category:'CUSTOMER_EXCEPTION',reason:'SYNTHETIC exception',amountJpy:100};
  const refund=await financial.requestRefund(randomUUID(),input);
  let calls=0,request:RefundRequest|undefined;
  const lossy=new FinancialOperations(ctx,null,{kind:'SIMULATED_DEV',async create(r){request=r;calls++;throw Error('SYNTHETIC timeout');},async lookup(){return null;}});
  assert.equal((await lossy.dispatch('refund',refund.id)).state,'UNKNOWN');
  await lossy.dispatch('refund',refund.id);assert.equal(calls,1);assert.ok(request);
  await assert.rejects(financial.requestRefund(randomUUID(),input),{code:'REFUND_RECONCILIATION_REQUIRED'});
  assert.equal((await x.db.pool.query('SELECT count(*)::int n FROM ops_refund_requests WHERE booking_id=$1',[confirmed.booking.id])).rows[0].n,1);
  assert.ok((await types()).includes('REFUND_UNKNOWN'));
 });

 await check('media, provider and database failures are observed with no business effect',async()=>{
  const before=await business();
  for(const code of ['STORAGE_FAILED','PROVIDER_TIMEOUT','DB_UNAVAILABLE'] as const)assert.equal(await observeOperationalFailure(ops!.operationsPool,code,'MOUNTAIN_BASE'),true);
  assert.deepEqual(await business(),before);
  const observed:string[]=await types();for(const code of ['STORAGE_FAILED','PROVIDER_TIMEOUT','DB_UNAVAILABLE'])assert.ok(observed.includes(code),code);
  assert.equal((await x.db.pool.query('SELECT count(*)::int n FROM rental_payment_attempts WHERE booking_id=$1',[confirmed.booking.id])).rows[0].n,1);
 });

 await check('a delayed transfer is observed while its own rows stay unchanged',async()=>{
  const batch=randomUUID(),c=await x.db.pool.connect();
  try{await c.query('BEGIN');await c.query("SELECT set_config('zao.actor',$1,true),set_config('zao.reason','SYNTHETIC delayed transfer fixture',true)",[x.actor]);
   await c.query("INSERT INTO transfer_batches(id,source_store,destination_store,scheduled_date,planned_ready_at,needed_by,basis) VALUES($1,'MOUNTAIN_BASE','ONSEN_BASE','2034-12-30','2034-12-30T17:00:00+09:00','2034-12-31T08:30:00+09:00','SYNTHETIC delayed transfer')",[batch]);
   await c.query('INSERT INTO transfer_pieces(id,batch_id,line_key,ordinal,asset_id) VALUES($1,$2,$3,1,$4)',[randomUUID(),batch,randomUUID(),fid(1201)]);
   await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  const before=(await x.db.pool.query('SELECT to_jsonb(t) v FROM transfer_batches t WHERE id=$1',[batch])).rows[0].v;
  assert.ok((await types()).includes('TRANSFER_DELAYED'));
  assert.deepEqual((await x.db.pool.query('SELECT to_jsonb(t) v FROM transfer_batches t WHERE id=$1',[batch])).rows[0].v,before);
 });

 await check('acknowledging every injected exception changes no business row',async()=>{
  const before=await business(),page=await console_.list(filter({status:'UNACKNOWLEDGED'}));
  assert.ok(page.exceptions.length>0);
  for(const e of page.exceptions)await console_.acknowledge(randomUUID(),{id:e.id,store:'MOUNTAIN_BASE',reason:'TRIAGED'});
  assert.deepEqual(await business(),before);
  assert.deepEqual((await console_.list(filter({status:'UNACKNOWLEDGED'}))).exceptions,[]);
 });

 console.log(JSON.stringify({status:'PASS',cases:count,businessMutations:0,externalProviderCalls:0,hostedDb:0}));
}catch(e){failed=true;console.error(JSON.stringify({status:'FAIL',stage,code:(e as {code?:string}).code??(e as Error).name,detail:e instanceof assert.AssertionError?e.message.slice(0,600):'SAFE_DETAILS_ONLY'}));}finally{await access?.close();await notify?.close();await ops?.close();await x.close();}
if(failed)process.exit(1);
