import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {flowFixture} from '../flow/fixture';
import {syntheticPreparation} from '../custody/preparation-fixture';
import {CustodyService} from '../../packages/core/src/rental/custody-service';
import {provisionCustodyRole} from '../../scripts/custody-roles';
import {provisionOperationsRole} from '../../scripts/operations-roles';
import {writeAccount} from '../../packages/auth/src/accounts';
import {OperationsContext} from '../../packages/core/src/operations/context';
import {OrdersService} from '../../packages/core/src/operations/orders-service';
import {AmendmentService} from '../../packages/core/src/operations/amendment-service';

// Issue #47 §2B/§2C: Booqable-style Orders and Dashboard reads over real rental facts. Synthetic local PostgreSQL only.
const x=await flowFixture();let custody:Awaited<ReturnType<typeof provisionCustodyRole>>|undefined,ops:Awaited<ReturnType<typeof provisionOperationsRole>>|undefined,stage='setup',count=0,failed=false;
async function check(name:string,fn:()=>Promise<void>){stage=name;await fn();count++;console.log('PASS '+name);}
const bufferOverride={reason:'SYNTHETIC orders read test'};
try{
 custody=await provisionCustodyRole(x.db.pool,x.db.identity);ops=await provisionOperationsRole(x.db.pool,x.db.identity);
 const svc=new CustodyService(custody.custodyPool,x.roles.authPool,x.signed.identity),orders=new OrdersService(new OperationsContext(ops.operationsPool,x.roles.authPool,x.signed.identity));
 await writeAccount(x.roles.authPool,x.bp,undefined,{email:'orders-onsen@example.invalid',password:x.password,displayName:'SYNTHETIC Orders Onsen',active:true,role:'MANAGER',scope:'ASSIGNED',storeIds:['ONSEN_BASE'],permissions:{}});
 const onsen=new OrdersService(new OperationsContext(ops.operationsPool,x.roles.authPool,(await x.login('orders-onsen@example.invalid')).identity));
 // Fixture: one picked-up booking on 01-03, one reserved on 01-05, one draft on 01-06.
 const out=await x.draft('2035-01-03',undefined,bufferOverride);await x.service.startPayment(out.booking.id,randomUUID());
 const reserved=await x.draft('2035-01-05',undefined,bufferOverride);await x.service.startPayment(reserved.booking.id,randomUUID());
 const draft=await x.draft('2035-01-08',undefined,bufferOverride);
 await x.clock('2035-01-03T10:00:00+09:00');
 const view=await svc.checkoutView(out.booking.id);
 await svc.prepare(randomUUID(),{bookingId:out.booking.id,expectedBookingVersion:view.bookingVersion,expectedHoldVersion:view.holdVersion,selections:view.items.map(i=>({requirementKey:i.requirement_key,assetId:i.asset_id,poleId:i.pole_id})),fitEvidence:syntheticPreparation(view)});
 await svc.checkout(randomUUID(),{bookingId:out.booking.id,expectedPreparationVersion:1});
 const store=out.conditions.pickupStore;
 const byId=(rows:{id:string;status:string}[])=>Object.fromEntries(rows.map(r=>[r.id,r.status]));

 await check('an accepted extension moves Coming back to the new date; the original booking terms stay visible and unchanged',async()=>{
  await x.db.pool.query("INSERT INTO staff_permission_overrides(staff_id,permission,allowed) VALUES($1,'RENTAL_AMEND',true),($1,'REFUND_OVERRIDE',true) ON CONFLICT DO NOTHING",[x.actor]);
  const amend=new AmendmentService(new OperationsContext(ops!.operationsPool,x.roles.authPool,x.signed.identity));
  const before=(await x.db.pool.query('SELECT to_jsonb(b) v FROM rental_bookings b WHERE id=$1',[reserved.booking.id])).rows[0].v;
  const current=await amend.view(reserved.booking.id),conditions=structuredClone(current.conditions);conditions.period={startDate:'2035-01-05',endDate:'2035-01-06',slot:'MULTIDAY'};
  const q=await amend.quote(randomUUID(),{bookingId:reserved.booking.id,expectedHoldVersion:current.holdVersion,conditions,reason:'SYNTHETIC orders extension'});
  await amend.accept(randomUUID(),{quoteId:q.id,fitEvidence:'',reason:'SYNTHETIC orders extension accepted'});
  const row=(await orders.list({stores:[store],search:reserved.booking.id.slice(0,8)})).rows[0]!;
  assert.equal(row.endDate,'2035-01-06');assert.equal(row.originalEndDate,'2035-01-05');assert.equal(row.amended,true);
  assert.ok((await orders.dashboard({store,range:'date',date:'2035-01-06'})).comingBack.some(r=>r.id===reserved.booking.id));
  assert.ok(!(await orders.dashboard({store,range:'date',date:'2035-01-05'})).comingBack.some(r=>r.id===reserved.booking.id));
  assert.deepEqual((await x.db.pool.query('SELECT to_jsonb(b) v FROM rental_bookings b WHERE id=$1',[reserved.booking.id])).rows[0].v,before,'original booking row unchanged');
 });
 await check('statuses come from real facts: picked up, reserved, draft (never confirmed by default)',async()=>{
  const r=await orders.list({stores:[store]});const m=byId(r.rows);
  assert.equal(m[out.booking.id],'PICKED_UP');assert.equal(m[reserved.booking.id],'RESERVED');assert.equal(m[draft.booking.id],'DRAFT');
  assert.equal(r.total,3);assert.equal(r.counts.all,3);
 });
 await check('tabs: upcoming lists future reserved/payment states; late appears only after the return date passes (JST)',async()=>{
  const up=await orders.list({stores:[store],tab:'upcoming'});assert.deepEqual(up.rows.map(r=>r.id),[reserved.booking.id]);
  assert.equal((await orders.list({stores:[store],tab:'late'})).total,0);
  await x.clock('2035-01-07T09:00:00+09:00');
  const late=await orders.list({stores:[store],tab:'late'});const ids=late.rows.map(r=>r.id).sort();
  assert.deepEqual(ids,[out.booking.id,reserved.booking.id].sort(),'picked-up past return date and reserved past pickup date');
  assert.ok(late.rows.find(r=>r.id===out.booking.id)!.lateBack);assert.ok(late.rows.find(r=>r.id===reserved.booking.id)!.lateOut);
 });
 await check('filters, search and paging are server-side and the total is exact',async()=>{
  assert.deepEqual((await orders.list({stores:[store],status:'RESERVED'})).rows.map(r=>r.id),[reserved.booking.id]);
  assert.equal((await orders.list({stores:[store],from:'2035-01-04',to:'2035-01-05'})).total,1);
  assert.equal((await orders.list({stores:[store],search:reserved.booking.id.slice(0,6)})).rows[0]!.id,reserved.booking.id);
  assert.equal((await orders.list({stores:[store],search:'SYNTHETIC Guest'})).total,3);
  assert.equal((await orders.list({stores:[store],search:'%'})).total,0,'LIKE wildcards are literal');
  const p1=await orders.list({stores:[store],pageSize:2,page:1}),p2=await orders.list({stores:[store],pageSize:2,page:2});
  assert.equal(p1.total,3);assert.equal(p1.rows.length,2);assert.equal(p2.rows.length,1);assert.equal(new Set([...p1.rows,...p2.rows].map(r=>r.id)).size,3);
  await assert.rejects(orders.list({stores:[store],status:'BOGUS'}),{code:'INVALID_INPUT'});await assert.rejects(orders.list({stores:[store],pageSize:500}),{code:'INVALID_INPUT'});
 });
 await check('store scope: another station manager cannot read this station and sees none of its rows',async()=>{
  await assert.rejects(onsen.list({stores:[store]}),{code:'FORBIDDEN'});await assert.rejects(onsen.dashboard({store}),{code:'FORBIDDEN'});
  if(store!=='ONSEN_BASE')assert.equal((await onsen.list({stores:['ONSEN_BASE']})).rows.filter(r=>r.pickupStore===store&&r.returnStore===store).length,0);
 });
 await check('dashboard: going out and coming back per date range with late counts; drafts excluded',async()=>{
  await x.clock('2035-01-03T08:00:00+09:00');
  const today=await orders.dashboard({store});assert.equal(today.from,'2035-01-03');
  assert.deepEqual(today.goingOut.map(r=>r.id),[out.booking.id]);assert.deepEqual(today.comingBack.map(r=>r.id),[out.booking.id]);
  const week=await orders.dashboard({store,range:'next7'});assert.deepEqual(week.goingOut.map(r=>r.id),[out.booking.id,reserved.booking.id]);
  assert.ok(!week.goingOut.some(r=>r.id===draft.booking.id));
  const day=await orders.dashboard({store,range:'date',date:'2035-01-05'});assert.deepEqual(day.goingOut.map(r=>r.id),[reserved.booking.id]);
  await assert.rejects(orders.dashboard({store,range:'date',date:'tomorrow'}),{code:'INVALID_INPUT'});
  await x.clock('2035-01-07T09:00:00+09:00');const later=await orders.dashboard({store});assert.equal(later.lateBack,1);assert.equal(later.lateOut,1);
 });
 await check('late pickup and late return are separate kinds, with their own counts and filters',async()=>{
  await x.clock('2035-01-07T09:00:00+09:00');
  const lo=await orders.list({stores:[store],tab:'late',late:'out'}),lb=await orders.list({stores:[store],tab:'late',late:'back'});
  assert.deepEqual(lo.rows.map(r=>r.id),[reserved.booking.id]);assert.deepEqual(lb.rows.map(r=>r.id),[out.booking.id]);
  assert.equal(lo.counts.lateOut,1);assert.equal(lo.counts.lateBack,1);assert.equal((await orders.list({stores:[store],tab:'late'})).counts.late,2,'unfiltered Late lists both kinds');
 });
 await check('direction filters apply dates and station to pickup or to return; invalid or reversed dates are refused',async()=>{
  assert.deepEqual((await orders.list({stores:[store],direction:'back',from:'2035-01-03',to:'2035-01-03'})).rows.map(r=>r.id),[out.booking.id]);
  assert.equal((await orders.list({stores:[store],direction:'out',from:'2035-01-04',to:'2035-01-04'})).total,0);
  for(const bad of [{from:'2035-02-30'},{to:'2035-13-01'},{from:'2035-01-06',to:'2035-01-05'},{direction:'sideways'},{late:'both'}])await assert.rejects(orders.list({stores:[store],tab:'late',...bad}),{code:'INVALID_INPUT'},JSON.stringify(bad));
  await assert.rejects(orders.dashboard({store,range:'date',date:'2035-02-29'}),{code:'INVALID_INPUT'});
 });
 await check('partial return reads as partially returned; everything back but uninspected reads as awaiting inspection',async()=>{
  const loans=(await x.db.pool.query('SELECT id,asset_id,pole_id,family FROM rental_loan_items WHERE booking_id=$1 ORDER BY family',[out.booking.id])).rows as {id:string;asset_id:string|null;pole_id:string|null;family:string}[];
  const giveBack=async(items:typeof loans)=>{let batch=await svc.createBatch(randomUUID(),store);for(const l of items)batch=await svc.scan(randomUUID(),{batchId:batch.id,expectedVersion:batch.version,assetId:l.asset_id,poleLoanId:l.pole_id?l.id:null});await svc.confirm(randomUUID(),{batchId:batch.id,expectedVersion:batch.version});};
  await giveBack(loans.filter(l=>l.family==='SKI'));
  let row=(await orders.list({stores:[store],search:out.booking.id.slice(0,8)})).rows[0]!;assert.equal(row.status,'PARTIALLY_RETURNED');assert.ok(row.lateBack,'items still out after the return date');
  await giveBack(loans.filter(l=>l.family!=='SKI'));
  row=(await orders.list({stores:[store],search:out.booking.id.slice(0,8)})).rows[0]!;assert.equal(row.status,'INSPECTION_PENDING');assert.equal(row.lateBack,false);assert.equal(row.outItems,0);
 });
 await check('dashboard panels report true totals separately from the displayed rows',async()=>{
  await x.clock('2035-01-03T08:00:00+09:00');
  const week=await orders.dashboard({store,range:'next7'});assert.equal(week.goingOutTotal,week.goingOut.length);assert.equal(week.cap,300);assert.ok(week.comingBackTotal>=1);
 });
 console.log(JSON.stringify({status:'PASS',cases:count,externalCalls:0}));
}catch(e){failed=true;console.error(JSON.stringify({status:'FAIL',stage,code:(e as {code?:string}).code??'ASSERTION',message:(e as Error).message?.slice(0,500),at:(e as Error).stack?.split('\n').filter(l=>/orders-postgres|amendment-service|context\.ts/.test(l)).slice(0,4).join(' | ')}));}
finally{await ops?.close();await custody?.close();await x.close();}
if(failed)process.exitCode=1;
