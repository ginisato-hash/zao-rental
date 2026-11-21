import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {flowFixture} from '../flow/fixture';
import {skiSet} from '../inventory/fixture';
import {provisionGuestRole} from '../../scripts/guest-roles';
import {provisionOperationsRole} from '../../scripts/operations-roles';
import {writeAccount} from '../../packages/auth/src/accounts';
import {GuestContexts} from '../../packages/core/src/guest/context';
import {HoldService} from '../../packages/core/src/inventory/hold-service';
import {OperationsContext} from '../../packages/core/src/operations/context';
import {SalesStopService} from '../../packages/core/src/operations/sales-stop-service';
import {OrdersService} from '../../packages/core/src/operations/orders-service';
import {listCsv} from '../../packages/core/src/operations/list-exports';

// Day-level sales stop (0062, Owner request 2026-11-22). Synthetic local PostgreSQL only; no provider, payment or network.
// Proves: staff stop/release a period at one or both stations at once (idempotent, audited, permission- and station-scoped);
// the public cannot hold any period touching a stopped day at its pickup or return station (preview and final command);
// staff can still create one; existing bookings are listed, never changed; the order list/CSV carry the booking time.
const x=await flowFixture('2035-01-01T10:00:00+09:00');
let ops:Awaited<ReturnType<typeof provisionOperationsRole>>|undefined,guestRole:Awaited<ReturnType<typeof provisionGuestRole>>|undefined,stage='setup',count=0,failed=false;
async function check(name:string,fn:()=>Promise<void>){stage=name;await fn();count++;console.log('PASS '+name);}
const code=(c:string)=>(e:{code?:string})=>{assert.equal(e.code,c);return true;};
try{
 ops=await provisionOperationsRole(x.db.pool,x.db.identity);guestRole=await provisionGuestRole(x.db.pool,x.db.identity);
 const admin=new SalesStopService(new OperationsContext(ops.operationsPool,x.roles.authPool,x.signed.identity));
 // An existing booking (staff path) on 2035-01-20 that a later stop will touch, and one on 2035-01-25 that it will not.
 // The synthetic pool is small, so (as in calendar-postgres) staff drafts draw on the reserve explicitly.
 const reserve={reason:'SYNTHETIC sales stop test'};
 const touched=await x.draft('2035-01-20',undefined,reserve),untouched=await x.draft('2035-01-25',undefined,reserve);
 for(const b of [touched,untouched])await x.service.startPayment(b.booking.id,randomUUID());
 const contexts=new GuestContexts(guestRole.guestPool),guest=await contexts.resolve((await contexts.create()).token);
 const guestHolds=new HoldService(x.roles.holdPool,guest,()=>x.now());
 const fingerprint=async()=>(await x.db.pool.query("SELECT string_agg(id::text||state||version,',' ORDER BY id) f FROM rental_bookings")).rows[0].f as string;

 await check('before any stop the public preview is not refused by a sales stop',async()=>{
  // The synthetic pool is below the public 95% ceiling, so capacity may say INSUFFICIENT; what matters is that no sales stop refuses it.
  await assert.doesNotReject(guestHolds.availability(skiSet('2035-01-19')));
  assert.deepEqual(await guestHolds.salesStops(),[]);
 });

 await check('staff stop a period at both stations at once; repeating it changes nothing; every change is in the history',async()=>{
  const before=await fingerprint();
  const r=await admin.set(randomUUID(),{stores:['MOUNTAIN_BASE','ONSEN_BASE'],from:'2035-01-20',to:'2035-01-21',stop:true,reason:'SYNTHETIC temporary closure'});
  assert.deepEqual(r,{changed:4,stores:['MOUNTAIN_BASE','ONSEN_BASE'],from:'2035-01-20',to:'2035-01-21',stop:true});
  assert.equal((await admin.set(randomUUID(),{stores:['ONSEN_BASE','MOUNTAIN_BASE'],from:'2035-01-20',to:'2035-01-21',stop:true,reason:'again'})).changed,0,'idempotent per day');
  assert.equal((await x.db.pool.query("SELECT count(*)::int n FROM store_sales_stop_history WHERE action='STOP'")).rows[0].n,4);
  assert.equal(await fingerprint(),before,'no existing booking is changed or cancelled');
  // the same request key replays its first result and refuses a different body
  const key=randomUUID(),body={stores:['ONSEN_BASE'],from:'2035-01-22',to:'2035-01-22',stop:true,reason:'replay'};
  assert.equal((await admin.set(key,body)).changed,1);assert.equal((await admin.set(key,body)).changed,1);
  await assert.rejects(admin.set(key,{...body,to:'2035-01-23'}),code('IDEMPOTENCY_MISMATCH'));
 });

 await check('the public cannot preview or hold a period touching a stopped day at its pickup or return station',async()=>{
  await assert.rejects(guestHolds.availability(skiSet('2035-01-20')),code('SALES_STOPPED'));
  const across=skiSet('2035-01-19');across.period={startDate:'2035-01-19',endDate:'2035-01-21',slot:'MULTIDAY'};
  await assert.rejects(guestHolds.availability(across),code('SALES_STOPPED'),'a multi-day period that includes a stopped day');
  await assert.rejects(guestHolds.command('create',randomUUID(),skiSet('2035-01-21')),code('SALES_STOPPED'),'final command, not only the preview');
  // ONSEN_BASE alone is stopped on 01-22: a Mountain booking that day is fine, an Onsen return that day is not
  await assert.doesNotReject(guestHolds.availability(skiSet('2035-01-22')));
  const onsenReturn=skiSet('2035-01-22');onsenReturn.returnStore='ONSEN_BASE';
  await assert.rejects(guestHolds.availability(onsenReturn),code('SALES_STOPPED'));
  assert.equal((await x.db.pool.query('SELECT count(*)::int n FROM inventory_holds WHERE owner_id=$1',[guest.subject])).rows[0].n,0,'no guest hold was written');
  const days=await guestHolds.salesStops();assert.ok(days.some(d=>d.store==='MOUNTAIN_BASE'&&d.day==='2035-01-20'));assert.deepEqual(Object.keys(days[0]!).sort(),['day','store'],'station and day only');
 });

 await check('staff may still create a booking on a stopped day (the screen warns first)',async()=>{
  const staffBooking=await x.draft('2035-01-21',undefined,reserve);assert.ok(staffBooking.booking.id);
 });

 await check('the stop screen lists existing open bookings on stopped days, with the days, and never the untouched one',async()=>{
  const v=await admin.view({from:'2035-01-15',to:'2035-01-31'});
  assert.equal(v.canEdit,true);assert.deepEqual(v.stores,['MOUNTAIN_BASE','ONSEN_BASE']);
  assert.ok(v.stops.some(s=>s.day==='2035-01-20'&&s.reason==='SYNTHETIC temporary closure'));
  const ids=v.affected.map(a=>a.id);assert.ok(ids.includes(touched.booking.id));assert.ok(!ids.includes(untouched.booking.id));
  assert.deepEqual(v.affected.find(a=>a.id===touched.booking.id)!.stoppedDays,['2035-01-20']);
  assert.ok(v.history.length>=5);
 });

 await check('release reopens the days for the public; release of an open day changes nothing',async()=>{
  assert.equal((await admin.set(randomUUID(),{stores:['MOUNTAIN_BASE','ONSEN_BASE'],from:'2035-01-20',to:'2035-01-22',stop:false,reason:'SYNTHETIC reopened'})).changed,5);
  assert.equal((await admin.set(randomUUID(),{stores:['MOUNTAIN_BASE'],from:'2035-01-20',to:'2035-01-20',stop:false,reason:'again'})).changed,0);
  await assert.doesNotReject(guestHolds.availability(skiSet('2035-01-20')));
  assert.equal((await x.db.pool.query("SELECT count(*)::int n FROM store_sales_stop_history WHERE action='RELEASE'")).rows[0].n,5);
 });

 await check('input is validated: period length, order, stations, reason and exact keys',async()=>{
  const base={stores:['MOUNTAIN_BASE'],from:'2035-02-01',to:'2035-02-01',stop:true,reason:'x'};
  for(const bad of [{...base,to:'2035-01-31'},{...base,to:'2036-02-02'},{...base,stores:[]},{...base,stores:['ELSEWHERE']},{...base,stores:['MOUNTAIN_BASE','MOUNTAIN_BASE']},{...base,from:'2035-02-30'},{...base,stop:'yes'}])
   await assert.rejects(admin.set(randomUUID(),bad),(e:{code?:string})=>['INVALID_INPUT','OPERATION_CONFLICT'].includes(e.code??''),JSON.stringify(bad));
  await assert.rejects(admin.set(randomUUID(),{...base,reason:'  '}),code('REASON_REQUIRED'));
  await assert.rejects(admin.set(randomUUID(),{...base,extra:1}),code('INVALID_INPUT'));
 });

 await check('a staff member without INVENTORY_EDIT can see stops but not change them; a station outside scope is refused',async()=>{
  const email='sales-stop-viewer@example.invalid';
  await writeAccount(x.roles.authPool,x.bp,undefined,{email,password:x.password,displayName:'SYNTHETIC Viewer',active:true,role:'VIEWER',scope:'ASSIGNED',storeIds:['MOUNTAIN_BASE'],permissions:{}});
  const viewer=new SalesStopService(new OperationsContext(ops!.operationsPool,x.roles.authPool,(await x.login(email)).identity));
  const v=await viewer.view();assert.equal(v.canEdit,false);assert.deepEqual(v.stores,['MOUNTAIN_BASE']);
  await assert.rejects(viewer.set(randomUUID(),{stores:['MOUNTAIN_BASE'],from:'2035-02-01',to:'2035-02-01',stop:true,reason:'x'}),code('FORBIDDEN'));
  const email2='sales-stop-manager@example.invalid';
  await writeAccount(x.roles.authPool,x.bp,undefined,{email:email2,password:x.password,displayName:'SYNTHETIC Manager',active:true,role:'MANAGER',scope:'ASSIGNED',storeIds:['MOUNTAIN_BASE'],permissions:{}});
  const manager=new SalesStopService(new OperationsContext(ops!.operationsPool,x.roles.authPool,(await x.login(email2)).identity));
  assert.equal((await manager.set(randomUUID(),{stores:['MOUNTAIN_BASE'],from:'2035-02-01',to:'2035-02-01',stop:true,reason:'SYNTHETIC manager'})).changed,1,'MANAGER has INVENTORY_EDIT by default');
  await assert.rejects(manager.set(randomUUID(),{stores:['ONSEN_BASE'],from:'2035-02-01',to:'2035-02-01',stop:true,reason:'x'}),code('FORBIDDEN'));
 });

 await check('the tables are append-only / not updatable and the set function is not callable by the runtime roles directly',async()=>{
  await assert.rejects(x.db.pool.query("UPDATE store_sales_stops SET reason='edited'"),/STORE_SALES_STOP_IMMUTABLE/);
  await assert.rejects(x.db.pool.query('DELETE FROM store_sales_stop_history'),/STORE_SALES_STOP_IMMUTABLE/);
  await assert.rejects(x.roles.holdPool.query("SELECT store_sales_stop_set(ARRAY['MOUNTAIN_BASE'],'2035-03-01','2035-03-01',true,'x')"),/permission denied/);
  await assert.rejects(ops!.operationsPool.query("INSERT INTO store_sales_stops(store_id,day,reason,created_by) VALUES('MOUNTAIN_BASE','2035-03-01','x','y')"),/permission denied/);
  await assert.rejects(ops!.operationsPool.query("SELECT store_sales_stop_set(ARRAY['MOUNTAIN_BASE'],'2035-03-01','2035-03-01',true,'x')"),/STORE_SALES_STOP_ACTOR_REQUIRED/,'no actor, no write');
 });

 await check('orders list and CSV carry the booking time (JST)',async()=>{
  const ctx=new OperationsContext(ops!.operationsPool,x.roles.authPool,x.signed.identity);
  const list=await new OrdersService(ctx).list({stores:['MOUNTAIN_BASE','ONSEN_BASE'],tab:'all'});
  const row=(list as {rows:{id:string;createdAt:string}[]}).rows.find(r=>r.id===touched.booking.id)!;assert.ok(row&&!Number.isNaN(Date.parse(row.createdAt)));
  const csv=await listCsv(ctx,'/orders',new URLSearchParams([['stores','MOUNTAIN_BASE'],['stores','ONSEN_BASE'],['tab','all'],['format','csv']]),'ja');
  const [head,...lines]=csv.body.replace(/^﻿/,'').trim().split(/\r?\n/);assert.ok(head!.split(',').includes('受付日時（JST）'),head);
  assert.ok(lines.some(l=>/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(l)));
 });
 console.log(`Sales stop real PostgreSQL ${count} passed; synthetic data only, no provider or payment.`);
}catch(e){failed=true;console.error('SALES_STOP_PG_FAILED '+stage+' '+String((e as {code?:string}).code??(e as Error).message));if(e instanceof assert.AssertionError)console.error(JSON.stringify({actual:e.actual,expected:e.expected}));console.error((e as Error).stack?.split('\n').slice(0,6).join('\n'));}
finally{await guestRole?.close();await ops?.close();await x.close();}
if(failed)process.exitCode=1;
