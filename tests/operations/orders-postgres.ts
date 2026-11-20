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
 await check('read-only detail: view-only staff can open it; another station cannot; contract snapshot is shown',async()=>{
  await writeAccount(x.roles.authPool,x.bp,undefined,{email:'orders-viewer@example.invalid',password:x.password,displayName:'SYNTHETIC Orders Viewer',active:true,role:'VIEWER',scope:'ASSIGNED',storeIds:[store],permissions:{BOOKING_VIEW:true}});
  const viewer=new OrdersService(new OperationsContext(ops!.operationsPool,x.roles.authPool,(await x.login('orders-viewer@example.invalid')).identity));
  const d=await viewer.detail(out.booking.id);assert.equal(d.order.id,out.booking.id);assert.equal(d.order.status,'INSPECTION_PENDING');
  assert.ok(d.loans.length>0&&d.loans.every(l=>l.state==='RECEIVED'));assert.equal(d.cancellationPolicy?.policyVersion,'ZAO_CANCELLATION_V1');
  assert.equal(d.terms,null,'fixture bookings predate a V2 acceptance');
  if(store!=='ONSEN_BASE')await assert.rejects(onsen.detail(out.booking.id),{code:'NOT_FOUND'},'another station gets not-found, not a hint that it exists');
  await assert.rejects(viewer.detail('not-a-uuid'),{code:'INVALID_INPUT'});await assert.rejects(viewer.detail(randomUUID()),{code:'NOT_FOUND'});
 });
 await check('CAL-01 class: a station revoked while the detail is read never returns that station’s order',async()=>{
  const other=store==='MOUNTAIN_BASE'?'ONSEN_BASE':'MOUNTAIN_BASE';
  await writeAccount(x.roles.authPool,x.bp,undefined,{email:'orders-both@example.invalid',password:x.password,displayName:'SYNTHETIC Orders Both',active:true,role:'MANAGER',scope:'ASSIGNED',storeIds:[store as 'ONSEN_BASE',other as 'ONSEN_BASE'],permissions:{}});
  const both=(await x.login('orders-both@example.invalid')).identity;
  let calls=0;const revoke=(subject:string,station:string)=>x.db.pool.query('DELETE FROM staff_store_access WHERE staff_id=$1 AND store_id=$2',[subject,station]);
  const racing=(identity:{subject:string;sessionId:string},station:string)=>{calls=0;return new (class extends OperationsContext{override async authorize(...a:Parameters<OperationsContext['authorize']>){const r=await super.authorize(...a);if(++calls===1)await revoke(identity.subject,station);return r;}})(ops!.operationsPool,x.roles.authPool,identity);};
  assert.equal((await new OrdersService(new OperationsContext(ops!.operationsPool,x.roles.authPool,both)).detail(reserved.booking.id)).order.id,reserved.booking.id,'baseline: visible with both stations');
  let code:string|null=null,leaked:unknown=null;try{leaked=await new OrdersService(racing(both,store)).detail(reserved.booking.id);}catch(e){code=(e as {code?:string}).code??'ERROR';}
  assert.ok(!leaked&&['AUTHORIZATION_CHANGED','NOT_FOUND','FORBIDDEN'].includes(code??''),'no detail from the revoked station: '+JSON.stringify({code,leaked:Boolean(leaked)}));
  await assert.rejects(new OrdersService(new OperationsContext(ops!.operationsPool,x.roles.authPool,both)).detail(reserved.booking.id),{code:'NOT_FOUND'});
 });
 await check('SNAP-01: Orders list and Dashboard read under a scope narrowed or ended mid-read return nothing (fail closed)',async()=>{
  const other=store==='MOUNTAIN_BASE'?'ONSEN_BASE':'MOUNTAIN_BASE';
  const mk=async(email:string)=>{await writeAccount(x.roles.authPool,x.bp,undefined,{email,password:x.password,displayName:'SYNTHETIC Snap',active:true,role:'MANAGER',scope:'ASSIGNED',storeIds:[store as 'ONSEN_BASE',other as 'ONSEN_BASE'],permissions:{}});return (await x.login(email)).identity;};
  // The mutation runs right after the first authorization of the read (before any row is read) and is undone afterwards.
  const race=(identity:{subject:string;sessionId:string},mutate:()=>Promise<unknown>)=>{let calls=0;return new (class extends OperationsContext{override async authorize(...a:Parameters<OperationsContext['authorize']>){const r=await super.authorize(...a);if(++calls===1)await mutate();return r;}})(ops!.operationsPool,x.roles.authPool,identity);};
  const refusedCode=async(read:()=>Promise<unknown>)=>{try{await read();return 'RETURNED';}catch(e){return (e as {code?:string}).code??'ERROR';}};
  const dropStation=(id:{subject:string},station:string)=>()=>x.db.pool.query('DELETE FROM staff_store_access WHERE staff_id=$1 AND store_id=$2',[id.subject,station]);
  const denyView=(id:{subject:string})=>()=>x.db.pool.query("INSERT INTO staff_permission_overrides(staff_id,permission,allowed) VALUES($1,'BOOKING_VIEW',false) ON CONFLICT(staff_id,permission) DO UPDATE SET allowed=false",[id.subject]);
  const endSession=(id:{sessionId:string})=>()=>x.db.pool.query('DELETE FROM auth_session WHERE id=$1',[id.sessionId]);
  const cases:[string,(s:InstanceType<typeof OrdersService>)=>Promise<unknown>][]=[['list',s=>s.list({stores:[store,other]})],['dashboard',s=>s.dashboard({store,range:'date',date:'2035-01-05'})],['workList',s=>s.workList({store,from:'2035-01-01',to:'2035-01-31'})]];
  let n=0;for(const [name,read] of cases)for(const [kind,mutate] of [['station',dropStation],['permission',denyView],['session',endSession]] as const){
   const id=await mk(`snap-orders-${n++}@example.invalid`);const code=await refusedCode(()=>read(new OrdersService(race(id,(mutate as (i:typeof id,st:string)=>()=>Promise<unknown>)(id,other)))));
   assert.ok(['AUTHORIZATION_CHANGED','FORBIDDEN','UNAUTHENTICATED'].includes(code),`${name}/${kind}: refused, got ${code}`);
  }
  // After the station is gone, a plain read of the remaining station works and the removed one is refused.
  const id=await mk('snap-orders-after@example.invalid');await dropStation(id,other)();const plain=new OrdersService(new OperationsContext(ops!.operationsPool,x.roles.authPool,id));
  assert.ok((await plain.list({stores:[store]})).rows.length>0);await assert.rejects(plain.list({stores:[store,other]}),{code:'FORBIDDEN'});
  await plain.dashboard({store,range:'date',date:'2035-01-05'});await plain.workList({store,from:'2035-01-05',to:'2035-01-05'});
 });
 await check('DASH-PRINT-01: the work list is the Dashboard panels for the exact same station and period, never cut; over the bound it withholds rows and gives per-day counts',async()=>{
  const ids=(rows:{id:string}[])=>rows.map(r=>r.id);
  // Every Dashboard range: the work list for the Dashboard's own from/to has the same totals and the same rows in the same order.
  for(const q of [{range:'today'},{range:'tomorrow'},{range:'next7'},{range:'nextWeek'},{range:'nextMonth'},{range:'date',date:'2035-01-03'},{range:'date',date:'2035-01-05'},{range:'date',date:'2035-01-06'},{range:'date',date:'2035-01-08'}]){
   const dash=await orders.dashboard({store,...q}),w=await orders.workList({store,from:dash.from,to:dash.to}),tag=JSON.stringify(q);
   assert.equal(w.from,dash.from,tag);assert.equal(w.to,dash.to,tag);assert.equal(w.goingOutTotal,dash.goingOutTotal,tag+' out');assert.equal(w.comingBackTotal,dash.comingBackTotal,tag+' back');
   assert.equal(w.complete,true,tag);assert.deepEqual(ids(w.goingOut),ids(dash.goingOut),tag);assert.deepEqual(ids(w.comingBack),ids(dash.comingBack),tag);
   assert.equal(w.days.reduce((n,d)=>n+d.goingOut,0),w.goingOutTotal,tag+' days add up (out)');assert.equal(w.days.reduce((n,d)=>n+d.comingBack,0),w.comingBackTotal,tag+' days add up (back)');
  }
  // The amended booking (01-05 → 01-06) comes back on its current date only; the draft (01-08) never appears.
  const jan=await orders.workList({store,from:'2035-01-01',to:'2035-01-31'});
  assert.ok(ids(jan.comingBack).includes(reserved.booking.id));assert.equal(jan.days.find(d=>d.date==='2035-01-06')!.comingBack>=1,true);
  assert.ok(!ids(jan.goingOut).includes(draft.booking.id)&&!ids(jan.comingBack).includes(draft.booking.id),'draft excluded');
  assert.equal(jan.days.length,31);assert.equal(jan.goingOut.length,jan.goingOutTotal);assert.equal(jan.max,1000);
  // Bound: exactly at the bound is complete with every row; one over withholds all rows (never a partial list) and the
  // per-day counts from the same snapshot still add up; a one-sided overflow is still incomplete; an empty day is complete.
  const n=Math.max(jan.goingOutTotal,jan.comingBackTotal);assert.ok(n>=2,'fixture has at least two rows on one side');
  const at=await orders.workList({store,from:'2035-01-01',to:'2035-01-31'},n);assert.equal(at.complete,true);assert.equal(at.goingOut.length,at.goingOutTotal);assert.equal(at.comingBack.length,at.comingBackTotal);
  const over=await orders.workList({store,from:'2035-01-01',to:'2035-01-31'},n-1);assert.equal(over.complete,false);assert.deepEqual([over.goingOut.length,over.comingBack.length],[0,0],'no partial rows');
  assert.equal(over.goingOutTotal,jan.goingOutTotal);assert.equal(over.days.reduce((k,d)=>k+d.goingOut,0),jan.goingOutTotal);assert.ok(over.days.every(d=>d.complete===(d.goingOut<=n-1&&d.comingBack<=n-1)));
  const oneSide=Math.min(jan.goingOutTotal,jan.comingBackTotal)<n?await orders.workList({store,from:'2035-01-01',to:'2035-01-31'},n-1):null;if(oneSide)assert.equal(oneSide.complete,false,'one side over is enough to withhold');
  for(const d of over.days.filter(x=>x.goingOut+x.comingBack>0)){const day=await orders.workList({store,from:d.date,to:d.date});assert.equal(day.complete,true);assert.equal(day.goingOut.length,d.goingOut,d.date);assert.equal(day.comingBack.length,d.comingBack,d.date);}
  const empty=await orders.workList({store,from:'2035-03-01',to:'2035-03-01'},1);assert.deepEqual([empty.complete,empty.goingOutTotal,empty.comingBackTotal,empty.goingOut.length],[true,0,0,0]);
  // Strict period: at most 31 days, from ≤ to, real calendar dates.
  for(const bad of [{from:'2035-01-01',to:'2035-02-01'},{from:'2035-01-10',to:'2035-01-01'},{from:'x',to:'2035-01-01'},{from:'2035-02-29',to:'2035-03-01'},{from:'2035-01-01',to:undefined}])await assert.rejects(orders.workList({store,...bad}),{code:'INVALID_INPUT'},JSON.stringify(bad));
  // Another station's staff is refused; no rows for a station outside the actor's scope.
  if(store!=='ONSEN_BASE')await assert.rejects(onsen.workList({store,from:'2035-01-01',to:'2035-01-05'}),{code:'FORBIDDEN'});
 });
 console.log(JSON.stringify({status:'PASS',cases:count,externalCalls:0}));
}catch(e){failed=true;console.error(JSON.stringify({status:'FAIL',stage,code:(e as {code?:string}).code??'ASSERTION',message:(e as Error).message?.slice(0,500),at:(e as Error).stack?.split('\n').filter(l=>/orders-postgres|amendment-service|context\.ts/.test(l)).slice(0,4).join(' | ')}));}
finally{await ops?.close();await custody?.close();await x.close();}
if(failed)process.exitCode=1;
