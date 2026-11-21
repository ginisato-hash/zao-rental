import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {loadStaff} from '../../packages/auth/src/staff-auth';
import {writeAccount} from '../../packages/auth/src/accounts';
import {flowFixture} from '../flow/fixture';
import {provisionNotificationRole} from '../../scripts/notification-roles';
import {provisionOperationsRole} from '../../scripts/operations-roles';
import {OperationsContext} from '../../packages/core/src/operations/context';
import {StaffInbox} from '../../packages/core/src/notification/staff-inbox';
import {StaffNotificationWorker} from '../../packages/core/src/notification/staff-worker';
import {LoopbackDeliveryAdapter} from './loopback';
import {skiSet} from '../inventory/fixture';

// Issue #47 §6: durable staff inbox + opt-in staff email. Synthetic local PostgreSQL only; loopback transport only.
const x=await flowFixture();let roles:Awaited<ReturnType<typeof provisionNotificationRole>>|undefined,ops:Awaited<ReturnType<typeof provisionOperationsRole>>|undefined,stage='setup',count=0,failed=false;
async function check(name:string,fn:()=>Promise<void>){stage=name;await fn();count++;console.log('PASS '+name);}
try{
 roles=await provisionNotificationRole(x.db.pool,x.db.identity);ops=await provisionOperationsRole(x.db.pool,x.db.identity);
 const admin=new StaffInbox(new OperationsContext(ops.operationsPool,x.roles.authPool,x.signed.identity));
 // A store-scoped manager for the other station only.
 await writeAccount(x.roles.authPool,x.bp,undefined,{email:'onsen-manager@example.invalid',password:x.password,displayName:'SYNTHETIC Onsen Manager',active:true,role:'MANAGER',scope:'ASSIGNED',storeIds:['ONSEN_BASE'],permissions:{}});
 const onsenLogin=await x.login('onsen-manager@example.invalid'),onsen=new StaffInbox(new OperationsContext(ops.operationsPool,x.roles.authPool,onsenLogin.identity));
 const adapter=new LoopbackDeliveryAdapter(),worker=new StaffNotificationWorker(roles.notificationPool,x.origin,adapter),deadline=()=>new Date(Date.now()+20000);
 const confirmed=async()=>{Object.assign(x.principal,(await loadStaff(x.roles.authPool,x.actor))!);const d=await x.draft(undefined,undefined,{reason:'SYNTHETIC staff inbox test'});await x.service.startPayment(d.booking.id,randomUUID());return d;};
 const events=async(booking:string)=>(await x.db.pool.query('SELECT * FROM staff_booking_events WHERE booking_id=$1',[booking])).rows;
 const outbox=async(booking:string)=>(await x.db.pool.query('SELECT o.* FROM staff_notification_outbox o JOIN staff_booking_events e ON e.id=o.event_id WHERE e.booking_id=$1',[booking])).rows;

 await check('email is opt-in per signed-in staff member and uses only their own login address',async()=>{
  assert.deepEqual(await admin.preference(null,null),{emailEnabled:false,locale:'ja',email:'flow-actor@example.invalid'});
  assert.deepEqual(await admin.preference(true,'ja'),{emailEnabled:true,locale:'ja',email:'flow-actor@example.invalid'});
  await assert.rejects(admin.preference('yes',null),{code:'INVALID_INPUT'});
 });
 let first='';
 await check('a confirmation records exactly one LIVE event and one email per eligible recipient in the same transaction',async()=>{
  const d=await confirmed();first=d.booking.id;const e=await events(first);
  assert.equal(e.length,1);assert.equal(e[0].kind,'BOOKING_CONFIRMED');assert.equal(e[0].source,'LIVE');assert.equal(e[0].store_id,d.conditions.pickupStore);assert.equal(e[0].acknowledged_at,null);
  await Promise.all(Array.from({length:8},()=>x.db.pool.query("SELECT staff_event_record($1,'BOOKING_CONFIRMED','LIVE')",[first])));
  assert.equal((await events(first)).length,1,'replay is idempotent');
  const o=await outbox(first);assert.equal(o.length,1,'only the opted-in admin; the onsen manager neither opted in nor sees this store');assert.equal(o[0].staff_id,x.actor);assert.equal(o[0].status,'PENDING');
 });
 await check('reading never acknowledges; counts are exact and cross-store reads are refused',async()=>{
  const store=(await events(first))[0].store_id as string;
  const a=await admin.list({stores:[store]}),b=await admin.list({stores:[store]});
  assert.equal(a.unacknowledged,1);assert.equal(b.unacknowledged,1);assert.equal(a.items[0]!.bookingId,first);assert.equal(a.items[0]!.customer,'SYNTHETIC Guest');assert.equal(a.items[0]!.acknowledgedAt,null);
  await assert.rejects(onsen.list({stores:[store]}),{code:'FORBIDDEN'});
  await assert.rejects(onsen.acknowledge(a.items[0]!.id),{code:'FORBIDDEN'},'neither pickup nor return station is visible');
  const own=await onsen.list({stores:['ONSEN_BASE']});assert.ok(own.items.every(i=>i.store==='ONSEN_BASE'||i.returnStore==='ONSEN_BASE'));
  await assert.rejects(admin.list({stores:['NOWHERE']}),{code:'INVALID_STORE'});
 });
 await check('concurrent acknowledgements store one (who, when); other devices see it',async()=>{
  const store=(await events(first))[0].store_id as string,id=(await admin.list({stores:[store]})).items[0]!.id;
  const acks=await Promise.all(Array.from({length:6},()=>admin.acknowledge(id)));
  assert.equal(new Set(acks.map(a=>a.acknowledgedAt)).size,1);assert.equal(acks[0]!.acknowledgedBy,'SYNTHETIC Creator');
  const after=await admin.list({stores:[store]});assert.equal(after.unacknowledged,0);assert.ok(after.items[0]!.acknowledgedAt);
  await assert.rejects(x.db.pool.query('UPDATE staff_booking_events SET acknowledged_at=NULL,acknowledged_by=NULL WHERE id=$1',[id]));
  await assert.rejects(x.db.pool.query('DELETE FROM staff_booking_events WHERE id=$1',[id]));
 });
 await check('only a real transition is new: a same-state update of an already confirmed booking creates no event or email',async()=>{
  await x.db.pool.query('ALTER TABLE rental_bookings DISABLE TRIGGER staff_event_capture');
  let d;try{d=await confirmed();}finally{await x.db.pool.query('ALTER TABLE rental_bookings ENABLE TRIGGER staff_event_capture');}
  assert.equal((await events(d.booking.id)).length,0,'confirmed while capture was off: stands in for a booking confirmed before 0060');
  // A legitimate same-state write with the booking guard ENABLED: proper actor and reason, version bumped, state unchanged.
  const c=await x.db.pool.connect();try{await c.query('BEGIN');await c.query("SELECT set_config('zao.actor',$1,true),set_config('zao.reason','SYNTHETIC same-state version write',true)",[x.actor]);
   await c.query('UPDATE rental_bookings SET state=state,version=version+1 WHERE id=$1',[d.booking.id]);await c.query('COMMIT');}
  catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  assert.equal((await x.db.pool.query('SELECT count(*)::int n FROM staff_notification_outbox o JOIN staff_booking_events e ON e.id=o.event_id WHERE e.booking_id=$1',[d.booking.id])).rows[0].n,0,'no email for an old confirmation');
  assert.equal((await events(d.booking.id)).length,0);assert.equal((await x.db.pool.query('SELECT count(*)::int n FROM staff_event_deferred WHERE booking_id=$1',[d.booking.id])).rows[0].n,0);
  const fresh=await confirmed(),fe=await events(fresh.booking.id);assert.equal(fe.length,1,'a new confirmation still records exactly one event');await admin.acknowledge(fe[0].id);
 });
 await check('pickup Mountain / return Central: Central-only staff can see and acknowledge it; the station is never client-chosen',async()=>{
  Object.assign(x.principal,(await loadStaff(x.roles.authPool,x.actor))!);
  const c=skiSet('2035-03-03');c.pickupStore='MOUNTAIN_BASE';c.returnStore='ONSEN_BASE';
  const d=await x.draft(undefined,c,{reason:'SYNTHETIC cross-station inbox test'});await x.service.startPayment(d.booking.id,randomUUID());
  const page=await onsen.list({stores:['ONSEN_BASE']});const item=page.items.find(i=>i.bookingId===d.booking.id);assert.ok(item,'visible via the return station');
  const ack=await onsen.acknowledge(item!.id);assert.equal(ack.acknowledgedBy,'SYNTHETIC Onsen Manager');
  assert.equal((await admin.acknowledge(item!.id)).acknowledgedAt,ack.acknowledgedAt,'first acknowledgement is kept');
 });
 await check('keyset paging returns every open event beyond the page size; totals are not page-limited',async()=>{
  const more=[await confirmed(),await confirmed(),await confirmed()],store=more[0]!.conditions.pickupStore;
  const seen:string[]=[];let page=await admin.list({stores:[store],openOnly:true,limit:1});const total=page.total;assert.equal(page.unacknowledged,3);
  while(true){seen.push(...page.items.map(i=>i.bookingId));if(!page.next)break;page=await admin.list({stores:[store],openOnly:true,limit:1,...page.next});}
  assert.equal(total,3);assert.deepEqual(new Set(seen),new Set(more.map(m=>m.booking.id)));
 });
 await check('worker sends one staff email per recipient with no customer name or amount, and replays are inert',async()=>{
  const before=adapter.calls;const r=await worker.runBatch(20,deadline());assert.ok(r.processed>=6);
  const sent=(await x.db.pool.query("SELECT count(*)::int n FROM staff_notification_outbox WHERE status='SENT'")).rows[0].n;assert.equal(sent,6);assert.equal(adapter.calls-before,6);
  for(const m of adapter.accepted.values()){assert.equal(m.recipient,'flow-actor@example.invalid');assert.equal(m.eventType,'STAFF_BOOKING_CONFIRMED');assert.ok(!m.text.includes('SYNTHETIC Guest')&&!m.text.includes('synthetic-guest@')&&!/¥/.test(m.text));assert.match(m.text,/\/staff\/orders\/[0-9a-f-]{36}/);}
  await worker.runBatch(20,deadline());assert.equal(adapter.calls-before,6,'no duplicate send');
 });
 await check('lost response becomes UNKNOWN and lookup closes it without a second send',async()=>{
  adapter.scenario='TIMEOUT_AFTER_ACCEPT';const d=await confirmed();await worker.runBatch(20,deadline());const row=(await outbox(d.booking.id))[0];assert.equal(row.status,'UNKNOWN');
  adapter.scenario='SUCCESS';const calls=adapter.calls;await x.clock(new Date(Date.parse(row.next_attempt_at)+1000).toISOString());await worker.runBatch(20,deadline());
  assert.equal((await outbox(d.booking.id))[0].status,'SENT');assert.equal(adapter.calls,calls,'reconciled by lookup');
 });
 await check('rate limiting retries within the three-attempt budget; a confirmation is never rolled back by delivery failure',async()=>{
  adapter.scenario='RATE_LIMIT';const d=await confirmed();await worker.runBatch(20,deadline());
  assert.equal((await outbox(d.booking.id))[0].status,'RETRYABLE_FAILURE');assert.equal((await x.db.pool.query('SELECT state FROM rental_bookings WHERE id=$1',[d.booking.id])).rows[0].state,'CONFIRMED_DEV');
  adapter.scenario='SUCCESS';
 });
 await check('disabled or opted-out staff receive nothing; opted-out bookings queue no email',async()=>{
  await admin.preference(false,'ja');const d=await confirmed();assert.equal((await outbox(d.booking.id)).length,0);assert.equal((await events(d.booking.id)).length,1,'inbox still records it');
  await admin.preference(true,'en');const e=await confirmed();assert.equal((await outbox(e.booking.id))[0].locale,'en');
  await x.db.pool.query('UPDATE staff_notification_recipients SET email_enabled=false WHERE staff_id=$1',[x.actor]);
  const calls=adapter.calls;await worker.runBatch(20,deadline());assert.equal((await outbox(e.booking.id))[0].status,'SUPPRESSED');assert.equal(adapter.calls,calls);
 });
 await check('a failed capture never blocks the booking; it is deferred in the same transaction and replayed once as LIVE',async()=>{
  await x.db.pool.query('UPDATE staff_notification_recipients SET email_enabled=true WHERE staff_id=$1',[x.actor]);
  await x.db.pool.query('ALTER TABLE staff_booking_events RENAME TO staff_booking_events_unavailable');
  let d;try{d=await confirmed();}finally{await x.db.pool.query('ALTER TABLE staff_booking_events_unavailable RENAME TO staff_booking_events');}
  assert.equal((await x.db.pool.query('SELECT state FROM rental_bookings WHERE id=$1',[d.booking.id])).rows[0].state,'CONFIRMED_DEV','booking confirmed despite capture failure');
  assert.equal((await events(d.booking.id)).length,0);assert.deepEqual((await x.db.pool.query('SELECT kind FROM staff_event_deferred WHERE booking_id=$1',[d.booking.id])).rows,[{kind:'BOOKING_CONFIRMED'}]);
  await worker.runBatch(20,deadline());
  assert.equal((await events(d.booking.id))[0].source,'LIVE');assert.equal((await outbox(d.booking.id))[0].status,'SENT');
  assert.equal((await x.db.pool.query('SELECT count(*)::int n FROM staff_event_deferred')).rows[0].n,0);
  const before=adapter.calls;await worker.runBatch(20,deadline());assert.equal(adapter.calls,before,'replay is once');
 });
 console.log(JSON.stringify({status:'PASS',cases:count,actualMailRequests:0,realCustomer:0}));
}catch(e){failed=true;console.error(JSON.stringify({status:'FAIL',stage,code:(e as {code?:string}).code??'ASSERTION',message:(e as Error).message?.slice(0,400),location:(e as Error).stack?.split('\n').filter(s=>s.includes('/tests/notification/')).join('\n')}));}
finally{await ops?.close();await roles?.close();await x.close();}
if(failed)process.exitCode=1;
