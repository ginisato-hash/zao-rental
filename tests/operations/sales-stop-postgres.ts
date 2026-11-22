import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {flowFixture,simulation} from '../flow/fixture';
import {skiSet,variants} from '../inventory/fixture';
import {QuoteService} from '../../packages/core/src/pricing/quote-service';
import {BookingService} from '../../packages/core/src/payment/booking-service';
import {provisionGuestRole} from '../../scripts/guest-roles';
import {provisionOperationsRole} from '../../scripts/operations-roles';
import {writeAccount} from '../../packages/auth/src/accounts';
import {GuestContexts} from '../../packages/core/src/guest/context';
import {HoldService} from '../../packages/core/src/inventory/hold-service';
import {OperationsContext} from '../../packages/core/src/operations/context';
import {SalesStopService} from '../../packages/core/src/operations/sales-stop-service';
import {OrdersService} from '../../packages/core/src/operations/orders-service';
import {listCsv} from '../../packages/core/src/operations/list-exports';
import {AFFECTED_PAGE_SIZE} from '../../packages/core/src/operations/sales-stop-service';
import {operationsHandler} from '../../apps/web/src/lib/operations-http';
import {resolveStaff} from '../../packages/auth/src/staff-auth';

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
  const ids=v.affected!.map(a=>a.id);assert.ok(ids.includes(touched.booking.id));assert.ok(!ids.includes(untouched.booking.id));
  assert.deepEqual(v.affected!.find(a=>a.id===touched.booking.id)!.stoppedDays,['2035-01-20']);
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

 await check('orders list and both order CSVs keep every existing column position and append the booking time (JST) last (PR74-CSV-01)',async()=>{
  const ctx=new OperationsContext(ops!.operationsPool,x.roles.authPool,x.signed.identity);
  const list=await new OrdersService(ctx).list({stores:['MOUNTAIN_BASE','ONSEN_BASE'],tab:'all'});
  const row=(list as {rows:{id:string;createdAt:string}[]}).rows.find(r=>r.id===touched.booking.id)!;assert.ok(row&&!Number.isNaN(Date.parse(row.createdAt)));
  // The headers on main before this change, in order; the new column may only follow them.
  const base=['予約番号','お客様','状態','遅れ','受取日','受取店舗','返却日','返却店舗','金額（税込・円）','支払状況'];
  for(const [tab,before] of [['all',base],['shortage',[...base,'不足判定']]] as const){
   const csv=await listCsv(ctx,'/orders',new URLSearchParams([['stores','MOUNTAIN_BASE'],['stores','ONSEN_BASE'],['tab',tab],['format','csv']]),'ja');
   const [head,...lines]=csv.body.replace(/^\uFEFF/,'').trim().split(/\r?\n/);
   assert.deepEqual(head!.split(','),[...before,'受付日時（JST）'],tab);
   for(const l of lines)assert.match(l,/,\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/,tab+' row ends with the JST booking time');
   if(tab==='all'){const exact=lines.find(l=>l.startsWith(touched.booking.id.slice(0,8).toUpperCase()+','))!;
    const jst=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(row.createdAt));
    assert.ok(exact.endsWith(','+jst),exact+' vs '+jst);}
  }
 });

 await check('bookings on the stop screen need BOOKING_VIEW: explicit false gets none (and is told so), allowed gets them, a permission removed during the read refuses the response (PR74-AUTH-01)',async()=>{
  await admin.set(randomUUID(),{stores:['MOUNTAIN_BASE'],from:'2035-01-20',to:'2035-01-20',stop:true,reason:'SYNTHETIC closure again'});
  const make=async(email:string,booking:boolean)=>{await writeAccount(x.roles.authPool,x.bp,undefined,{email,password:x.password,displayName:'SYNTHETIC '+email.split('@')[0],active:true,role:'STAFF',scope:'ASSIGNED',storeIds:['MOUNTAIN_BASE'],permissions:{INVENTORY_VIEW:true,BOOKING_VIEW:booking}});return x.login(email);};
  const denied=await make('sales-stop-nobooking@example.invalid',false),allowed=await make('sales-stop-booking@example.invalid',true);
  const v=await new SalesStopService(new OperationsContext(ops!.operationsPool,x.roles.authPool,denied.identity)).view({from:'2035-01-15',to:'2035-01-31'});
  assert.equal(v.bookingView,false);assert.equal(v.affected,null);assert.equal(v.affectedTotal,null);assert.ok(v.stops.some(st=>st.day==='2035-01-20'),'stops are still shown');
  const w=await new SalesStopService(new OperationsContext(ops!.operationsPool,x.roles.authPool,allowed.identity)).view({from:'2035-01-15',to:'2035-01-31'});
  assert.equal(w.bookingView,true);assert.ok(w.affected!.some(a=>a.id===touched.booking.id));
  // Real HTTP route: the denied account's JSON carries no booking or customer field at all.
  const handler=operationsHandler(h=>resolveStaff(x.auth,x.roles.authPool,h),id=>new OperationsContext(ops!.operationsPool,x.roles.authPool,id),x.origin);
  const get=(cookie:string)=>handler(new Request(x.origin+'/api/operations/sales-stops?from=2035-01-15&to=2035-01-31',{headers:{cookie}}));
  const r1=await get(denied.cookie);assert.equal(r1.status,200);const t1=await r1.text();
  assert.equal(JSON.parse(t1).affected,null);for(const leak of [touched.booking.id,'@example.invalid','customer','email'])assert.ok(!t1.includes(leak),'no '+leak+' in '+t1.slice(0,300));
  const r2=await get(allowed.cookie);assert.equal(r2.status,200);assert.ok((await r2.text()).includes(touched.booking.id));
  // BOOKING_VIEW removed after the snapshot read but before the response is released: refused, not returned.
  const id=(await x.db.pool.query('SELECT id FROM auth_user WHERE email=$1',['sales-stop-booking@example.invalid'])).rows[0].id as string;
  const ctx=new OperationsContext(ops!.operationsPool,x.roles.authPool,allowed.identity),read=ctx.snapshot.bind(ctx);
  ctx.snapshot=(async(...args:Parameters<typeof read>)=>{const out=await read(...args);
   const revision=(await x.db.pool.query('SELECT revision FROM staff_members WHERE id=$1',[id])).rows[0].revision as number;
   await writeAccount(x.roles.authPool,x.bp,id,{expectedRevision:revision,active:true,role:'STAFF',scope:'ASSIGNED',displayName:'SYNTHETIC narrowed',storeIds:['MOUNTAIN_BASE'],permissions:{INVENTORY_VIEW:true,BOOKING_VIEW:false}});
   return out;}) as typeof ctx.snapshot;
  await assert.rejects(new SalesStopService(ctx).view({from:'2035-01-15',to:'2035-01-31'}),(e:{code?:string})=>['FORBIDDEN','AUTHORIZATION_CHANGED'].includes(e.code??''));
 });

 await check('the database refuses a guest hold on a stopped day whatever the application build does; staff holds and same-period updates are not refused (PR74-ROLLBACK-01)',async()=>{
  // A build that predates 0062 never asks for stopped days and writes the hold row directly, exactly as below. Each attempt runs
  // in its own rolled-back transaction on the owner connection, so nothing is kept.
  const c=await x.db.pool.connect();
  const attempt=async(owner:string,day:string,pickup='MOUNTAIN_BASE',ret='MOUNTAIN_BASE',after?:(id:string)=>Promise<void>)=>{
   await c.query('BEGIN');try{const reservation=randomUUID(),id=randomUUID();await c.query("SELECT set_config('zao.actor',$1,true)",[owner]);
    await c.query('INSERT INTO inventory_reservations VALUES($1,$2)',[reservation,owner]);
    await c.query(`INSERT INTO inventory_holds(id,reservation_id,owner_id,pickup_store,return_store,conditions,starts_at,due_at,occupancy_start,occupancy_end,expires_at,state)
     VALUES($1,$2,$3,$4,$5,$6,$7::date+time '08:30',$7::date+time '17:00',$7::date,$7::date,$7::date+interval '1 day','ACTIVE')`,
     [id,reservation,owner,pickup,ret,{period:{startDate:day,endDate:day}},day]);
    await after?.(id);
   }finally{await c.query('ROLLBACK');}
  };
  try{
   await assert.rejects(attempt(guest.subject,'2035-01-20'),(e:{code?:string})=>e.code==='P0062','guest hold on the stopped day');
   await assert.rejects(attempt(guest.subject,'2035-01-19','ONSEN_BASE','MOUNTAIN_BASE',async id=>{
    await c.query("UPDATE inventory_holds SET conditions=jsonb_set(conditions,'{period,endDate}','\"2035-01-20\"') WHERE id=$1",[id]);}),(e:{code?:string})=>e.code==='P0062','a guest hold moved onto the stopped day');
   await attempt(guest.subject,'2035-01-19','MOUNTAIN_BASE','MOUNTAIN_BASE',async id=>{await c.query("UPDATE inventory_holds SET payment_state='PENDING' WHERE id=$1",[id]);});
   await attempt(x.actor,'2035-01-20');// staff-owned: allowed (the staff screen warns instead)
   // After the stop is released, the same guest hold is accepted.
   await admin.set(randomUUID(),{stores:['MOUNTAIN_BASE'],from:'2035-01-20',to:'2035-01-20',stop:false,reason:'SYNTHETIC reopen'});
   await attempt(guest.subject,'2035-01-20');
   await admin.set(randomUUID(),{stores:['MOUNTAIN_BASE'],from:'2035-01-20',to:'2035-01-20',stop:true,reason:'SYNTHETIC closure again'});
  }finally{c.release();}
  assert.equal((await x.db.pool.query('SELECT count(*)::int n FROM inventory_holds WHERE owner_id=$1',[guest.subject])).rows[0].n,0);
 });

 await check('an unpaid guest DRAFT made before a stop cannot start paying after it: refused in the database, no provider call, nothing committed; a payment started before the stop still completes; staff and other days are unaffected (PR74-ROLLBACK-01)',async()=>{
  // Ample synthetic stock for 2035-02-10 so the public capacity ceiling does not refuse the guest holds (as in booking-access.ts).
  const t=await x.db.pool.connect();try{await t.query('BEGIN');
   await t.query("SELECT set_config('zao.actor',$1,true),set_config('zao.reason','SYNTHETIC sales stop payment fixture top-up',true)",[x.actor]);
   for(const [family,variant] of [['SKI',variants.ski],['SKI_BOOT',variants.boot]] as const)for(let n=0;n<20;n++)await t.query(`INSERT INTO ledger_assets(id,variant_id,family,initial_store_id,store_id,status,bsl_status,bsl_mm,bsl_evidence,notes,source_kind,source_document,source_locator) VALUES($1,$2,$3,'MOUNTAIN_BASE','MOUNTAIN_BASE','AVAILABLE',$4,NULL,'','','SYNTHETIC','tests/operations/sales-stop-postgres.ts',$5)`,[randomUUID(),variant,family,family==='SKI_BOOT'?'UNVERIFIED':'NOT_APPLICABLE','stop-'+family+'-'+n]);
   await t.query('UPDATE ledger_poles SET quantity=greatest(quantity,20) WHERE variant_id=$1',[variants.pole]);await t.query('COMMIT');}catch(e){await t.query('ROLLBACK');throw e;}finally{t.release();}
  const day='2035-02-10',holds=new HoldService(x.roles.holdPool,guest,()=>x.now()),quotes=new QuoteService(x.roles.pricingPool,guest,()=>x.now()),bookings=new BookingService(x.flow.flowPool,guestRole!.guestPool,guest,x.fake,simulation);
  const draft=async(n:number)=>{const conditions=skiSet(day),h=await holds.command('create',randomUUID(),conditions),quote=(await quotes.create(randomUUID(),{conditions,holdId:h.holdId,couponCode:null,wantAdvance:false})).quote;
   return {hold:h.holdId as string,booking:(await bookings.create(randomUUID(),quote.id,{displayName:'SYNTHETIC Stop Guest '+n,email:'synthetic-stop-guest-'+n+'@example.invalid',termsAccepted:true})).id as string};};
  const unpaid=await draft(1),started=await draft(2);
  // A payment started BEFORE the stop whose response was lost (UNKNOWN): its follow-up must keep working after the stop.
  x.fake.failAfterSave=true;await bookings.startPayment(started.booking,randomUUID()).catch(()=>{/* response lost on purpose */});x.fake.failAfterSave=false;
  assert.equal((await x.db.pool.query('SELECT payment_state s FROM inventory_holds WHERE id=$1',[started.hold])).rows[0].s,'UNKNOWN');
  await admin.set(randomUUID(),{stores:['MOUNTAIN_BASE'],from:day,to:day,stop:true,reason:'SYNTHETIC closure after drafts'});
  const calls=x.fake.calls.length,state=async(id:string)=>(await x.db.pool.query("SELECT b.state,h.payment_state,(SELECT count(*)::int FROM rental_payment_attempts a WHERE a.booking_id=b.id) attempts FROM rental_bookings b JOIN inventory_holds h ON h.id=b.hold_id WHERE b.id=$1",[id])).rows[0];
  await assert.rejects(bookings.startPayment(unpaid.booking,randomUUID()),code('SALES_STOPPED'),'first payment start after the stop');
  assert.equal(x.fake.calls.length,calls,'gateway.create was never reached');
  assert.deepEqual(await state(unpaid.booking),{state:'DRAFT',payment_state:'NONE',attempts:0},'no attempt, booking or hold change was committed');
  // An application build that predates 0062 writes the same rows: the database refuses the hold transition itself.
  const c=await x.db.pool.connect();try{await c.query('BEGIN');await c.query("SELECT set_config('zao.actor',$1,true)",[guest.subject]);
   await assert.rejects(c.query("UPDATE inventory_holds SET payment_state='PENDING',version=version+1 WHERE id=$1",[unpaid.hold]),(e:{code?:string})=>e.code==='P0062');}finally{await c.query('ROLLBACK');c.release();}
  // The payment started before the stop is reconciled to completion (UNKNOWN -> SUCCESS is not a new start).
  await bookings.reconcile(started.booking);assert.equal((await state(started.booking)).payment_state,'SUCCESS');
  // Staff-owned bookings on the stopped day still start paying (the staff screen warns instead).
  const staffDraft=await x.draft(day,undefined,reserve);await x.service.startPayment(staffDraft.booking.id,randomUUID());
  // Released: the same unpaid guest DRAFT may now start paying, exactly once at the gateway.
  await admin.set(randomUUID(),{stores:['MOUNTAIN_BASE'],from:day,to:day,stop:false,reason:'SYNTHETIC reopen'});
  const before=x.fake.calls.length;await bookings.startPayment(unpaid.booking,randomUUID());assert.equal(x.fake.calls.length,before+1);
  assert.equal((await state(unpaid.booking)).attempts,1);
 });

 await check('501 open bookings on one stopped day: the screen reports the total and every one is reachable page by page (PR74-UI-02)',async()=>{
  // Synthetic only: clone the touched booking 501 times on the owner connection with constraint triggers off for this
  // transaction (the clones point at no hold, so the current period comes from the booking itself).
  const c=await x.db.pool.connect();try{await c.query('BEGIN');await c.query("SET LOCAL session_replication_role=replica");
   await c.query(`INSERT INTO rental_bookings SELECT (jsonb_populate_record(NULL::rental_bookings,to_jsonb(r)||jsonb_build_object('id',gen_random_uuid(),'request_key',gen_random_uuid(),
    'hold_id',gen_random_uuid(),'quote_id',gen_random_uuid(),'created_at',r.created_at+make_interval(secs=>g)))).* FROM rental_bookings r,generate_series(1,501) g WHERE r.id=$1`,[touched.booking.id]);
   await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  const first=await admin.view({from:'2035-01-20',to:'2035-01-20'});
  assert.ok(first.affectedTotal!>=502,String(first.affectedTotal));assert.equal(first.affected!.length,AFFECTED_PAGE_SIZE);
  const seen=new Set<string>();const pages=Math.ceil(first.affectedTotal!/AFFECTED_PAGE_SIZE);
  for(let n=1;n<=pages;n++){const v=n===1?first:await admin.view({from:'2035-01-20',to:'2035-01-20',page:String(n)});assert.equal(v.affectedPage,n);assert.deepEqual(v.stores,['MOUNTAIN_BASE','ONSEN_BASE']);
   for(const a of v.affected!){assert.ok(!seen.has(a.id),'no row twice');seen.add(a.id);assert.deepEqual(a.stoppedDays,['2035-01-20']);}}
  assert.equal(seen.size,first.affectedTotal,'every affected booking reached, the last one included');
  assert.equal((await admin.view({from:'2035-01-20',to:'2035-01-20',page:String(pages+1)})).affected!.length,0);
  for(const bad of ['0','-1','1.5','x','10001'])await assert.rejects(admin.view({from:'2035-01-20',to:'2035-01-20',page:bad}),code('INVALID_INPUT'),bad);
  // An Onsen-only staff member pages the same range and never sees a Mountain booking.
  const email='sales-stop-onsen@example.invalid';
  await writeAccount(x.roles.authPool,x.bp,undefined,{email,password:x.password,displayName:'SYNTHETIC Onsen',active:true,role:'STAFF',scope:'ASSIGNED',storeIds:['ONSEN_BASE'],permissions:{INVENTORY_VIEW:true,BOOKING_VIEW:true}});
  const onsen=await new SalesStopService(new OperationsContext(ops!.operationsPool,x.roles.authPool,(await x.login(email)).identity)).view({from:'2035-01-20',to:'2035-01-20',page:'3'});
  assert.deepEqual(onsen.stores,['ONSEN_BASE']);assert.equal(onsen.affectedTotal,0);assert.deepEqual(onsen.affected,[]);
 });
 console.log(`Sales stop real PostgreSQL ${count} passed; synthetic data only, no provider or payment.`);
}catch(e){failed=true;console.error('SALES_STOP_PG_FAILED '+stage+' '+String((e as {code?:string}).code??(e as Error).message));if(e instanceof assert.AssertionError)console.error(JSON.stringify({actual:e.actual,expected:e.expected}));console.error((e as Error).stack?.split('\n').slice(0,6).join('\n'));}
finally{await guestRole?.close();await ops?.close();await x.close();}
if(failed)process.exitCode=1;
