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
 const draft=await x.draft('2035-01-06',undefined,bufferOverride);
 await x.clock('2035-01-03T10:00:00+09:00');
 const view=await svc.checkoutView(out.booking.id);
 await svc.prepare(randomUUID(),{bookingId:out.booking.id,expectedBookingVersion:view.bookingVersion,expectedHoldVersion:view.holdVersion,selections:view.items.map(i=>({requirementKey:i.requirement_key,assetId:i.asset_id,poleId:i.pole_id})),fitEvidence:syntheticPreparation(view)});
 await svc.checkout(randomUUID(),{bookingId:out.booking.id,expectedPreparationVersion:1});
 const store=out.conditions.pickupStore;
 const byId=(rows:{id:string;status:string}[])=>Object.fromEntries(rows.map(r=>[r.id,r.status]));

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
 console.log(JSON.stringify({status:'PASS',cases:count,externalCalls:0}));
}catch(e){failed=true;console.error(JSON.stringify({status:'FAIL',stage,code:(e as {code?:string}).code??'ASSERTION',message:(e as Error).message?.slice(0,500)}));}
finally{await ops?.close();await custody?.close();await x.close();}
if(failed)process.exitCode=1;
