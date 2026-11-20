import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {flowFixture} from '../flow/fixture';
import {syntheticPreparation} from '../custody/preparation-fixture';
import {CustodyService} from '../../packages/core/src/rental/custody-service';
import {provisionCustodyRole} from '../../scripts/custody-roles';
import {provisionOperationsRole} from '../../scripts/operations-roles';
import {writeAccount} from '../../packages/auth/src/accounts';
import {OperationsContext} from '../../packages/core/src/operations/context';
import {CalendarService} from '../../packages/core/src/operations/calendar-service';

// Booqable Calendar (Issue #47): item rows with planned (HOLD claim) and physical (loan) bars from existing facts only.
// Synthetic local PostgreSQL; no provider or network.
const x=await flowFixture();let ops:Awaited<ReturnType<typeof provisionOperationsRole>>|undefined,custody:Awaited<ReturnType<typeof provisionCustodyRole>>|undefined,stage='setup',count=0,failed=false;
async function check(name:string,fn:()=>Promise<void>){stage=name;await fn();count++;console.log('PASS '+name);}
const bufferOverride={reason:'SYNTHETIC calendar read test'};
const fingerprint=async()=>{const parts=[];for(const sql of ['SELECT id,state,version FROM inventory_holds ORDER BY id','SELECT hold_id,requirement_key,day,asset_id,active FROM inventory_claims ORDER BY 1,2,3,4','SELECT id,state,version FROM rental_bookings ORDER BY id','SELECT id,state FROM rental_loan_items ORDER BY id','SELECT count(*) FROM ledger_history'])parts.push((await x.db.pool.query(sql)).rows);return createHash('sha256').update(JSON.stringify(parts)).digest('hex');};
try{
 ops=await provisionOperationsRole(x.db.pool,x.db.identity);custody=await provisionCustodyRole(x.db.pool,x.db.identity);
 const cal=new CalendarService(new OperationsContext(ops.operationsPool,x.roles.authPool,x.signed.identity)),svc=new CustodyService(custody.custodyPool,x.roles.authPool,x.signed.identity);
 const a=await x.draft('2035-01-10',undefined,bufferOverride);await x.service.startPayment(a.booking.id,randomUUID());
 const b=await x.draft('2035-01-12',undefined,bufferOverride);await x.service.startPayment(b.booking.id,randomUUID());
 const store=a.conditions.pickupStore,other=store==='MOUNTAIN_BASE'?'ONSEN_BASE':'MOUNTAIN_BASE';
 await x.clock('2035-01-09T09:00:00+09:00');
 const claimed=async(bookingId:string)=>(await x.db.pool.query("SELECT DISTINCT c.asset_id FROM inventory_claims c JOIN rental_bookings b ON b.hold_id=c.hold_id WHERE b.id=$1 AND c.active AND c.requirement_key LIKE '%:SKI'",[bookingId])).rows[0].asset_id as string;
 const skiA=await claimed(a.booking.id),skiB=await claimed(b.booking.id);
 const item=(r:Awaited<ReturnType<typeof cal.view>>,id:string)=>{const i=r.items.find(i=>i.id===id);assert.ok(i,'claimed item is a row');return i!;};
 const bookingBars=(r:Awaited<ReturnType<typeof cal.view>>)=>r.items.flatMap(i=>i.bars.filter(x=>x.kind==='BOOKING').map(x=>({...x,item:i.id})));

 await check('planned bars: each booked order appears on its claimed item on its current dates, with order ref; the read writes nothing',async()=>{
  const before=await fingerprint();
  const r=await cal.view({store,from:'2035-01-09',days:'7'});assert.equal(r.from,'2035-01-09');assert.equal(r.to,'2035-01-15');assert.equal(r.total,r.items.length);
  const onA=item(r,skiA).bars.filter(x=>x.kind==='BOOKING'),onB=item(r,skiB).bars.filter(x=>x.kind==='BOOKING');
  assert.deepEqual(onA.filter(x=>x.bookingId===a.booking.id).map(x=>[x.start,x.end]),[['2035-01-10','2035-01-10']]);
  assert.deepEqual(onB.filter(x=>x.bookingId===b.booking.id).map(x=>[x.start,x.end]),[['2035-01-12','2035-01-12']]);
  assert.equal(onA[0]!.ref,a.booking.id.slice(0,8).toUpperCase());assert.equal(onA[0]!.customer,'SYNTHETIC Guest');
  // Every claimed gear item of each order is shown (ski and boots), each order once per item.
  const all=bookingBars(r);for(const id of [a.booking.id,b.booking.id]){const its=all.filter(x=>x.bookingId===id).map(x=>x.item);assert.ok(its.length>=2);assert.equal(new Set(its).size,its.length);}
  assert.equal(await fingerprint(),before,'calendar read never writes');
 });
 await x.clock('2035-01-10T10:00:00+09:00');
 const view=await svc.checkoutView(a.booking.id);
 await svc.prepare(randomUUID(),{bookingId:a.booking.id,expectedBookingVersion:view.bookingVersion,expectedHoldVersion:view.holdVersion,selections:view.items.map(i=>({requirementKey:i.requirement_key,assetId:i.asset_id,poleId:i.pole_id})),fitEvidence:syntheticPreparation(view)});
 await svc.checkout(randomUUID(),{bookingId:a.booking.id,expectedPreparationVersion:1});
 await check('physical bar: once handed out, the loan replaces the planned bar for that order (no double bar)',async()=>{
  const r=await cal.view({store,from:'2035-01-09',days:'7'});const loaned=(await x.db.pool.query("SELECT asset_id FROM rental_loan_items WHERE booking_id=$1 AND family='SKI'",[a.booking.id])).rows[0].asset_id as string;
  assert.deepEqual(item(r,loaned).bars.filter(x=>x.bookingId===a.booking.id).map(x=>x.kind),['OUT']);
  assert.ok(!r.items.some(i=>i.bars.some(x=>x.kind==='BOOKING'&&x.bookingId===a.booking.id&&i.id===loaned)),'no planned bar left on the handed-out item');
  assert.ok(bookingBars(r).some(x=>x.bookingId===b.booking.id));
 });
 await check('overdue: still out after its due time, the bar runs to the end of the shown period and says so',async()=>{
  await x.clock('2035-01-11T08:00:00+09:00');
  const loaned=(await x.db.pool.query("SELECT asset_id FROM rental_loan_items WHERE booking_id=$1 AND family='SKI'",[a.booking.id])).rows[0].asset_id as string;
  const out=item(await cal.view({store,from:'2035-01-09',days:'14'}),loaned).bars.find(x=>x.bookingId===a.booking.id)!;
  assert.equal(out.kind,'OVERDUE');assert.equal(out.start,'2035-01-10');assert.equal(out.end,'2035-01-22');assert.equal(out.detail,'2035-01-10');
 });
 await check('period, family and paging: invalid inputs are refused; totals are exact',async()=>{
  const all=await cal.view({store,from:'2035-01-09',days:'28'});assert.equal(all.to,'2035-02-05');
  const skis=await cal.view({store,from:'2035-01-09',family:'SKI'});assert.ok(skis.items.every(i=>i.family==='SKI'));assert.ok(skis.total>=1);
  const p1=await cal.view({store,from:'2035-01-09',pageSize:'1',page:'1'});assert.equal(p1.items.length,1);assert.equal(p1.total,all.total);
  for(const bad of [{days:'5'},{from:'2035-02-30'},{family:'WEAR'},{pageSize:'500'}])await assert.rejects(cal.view({store,...bad}),{code:'INVALID_INPUT'},JSON.stringify(bad));
  await assert.rejects(cal.view({store:'ELSEWHERE'}),{code:'INVALID_STORE'});
 });
 await check('CAL-01: a station revoked between authorization and read never discloses that station’s customer; scope stays exact',async()=>{
  // An order whose stations are both the other station but which holds an item registered at this station (as a transfer
  // allocation does). Built in this owned DB by moving order b's HOLD stations; its claims stay on this station's item.
  const c=b;
  const o=await x.db.pool.connect();try{await o.query('BEGIN');await o.query('ALTER TABLE inventory_holds DISABLE TRIGGER USER');
   await o.query('UPDATE inventory_holds SET pickup_store=$2,return_store=$2 WHERE id=(SELECT hold_id FROM rental_bookings WHERE id=$1)',[c.booking.id,other]);
   await o.query('ALTER TABLE inventory_holds ENABLE TRIGGER USER');await o.query('COMMIT');}catch(e){await o.query('ROLLBACK');throw e;}finally{o.release();}
  const skiC=await claimed(c.booking.id);
  await writeAccount(x.roles.authPool,x.bp,undefined,{email:'calendar-both@example.invalid',password:x.password,displayName:'SYNTHETIC Calendar Both',active:true,role:'MANAGER',scope:'ASSIGNED',storeIds:[store as 'ONSEN_BASE',other as 'ONSEN_BASE'],permissions:{}});
  const both=(await x.login('calendar-both@example.invalid')).identity;
  const customerOf=(r:Awaited<ReturnType<typeof cal.view>>,bookingId:string)=>r.items.flatMap(i=>i.bars).find(b=>b.bookingId===bookingId)?.customer;
  // Baseline: with both stations in scope the other-station order's customer is shown, and so is this station's.
  const full=await new CalendarService(new OperationsContext(ops!.operationsPool,x.roles.authPool,both)).view({store,from:'2035-01-09',days:'7'});
  assert.ok(full.items.some(i=>i.id===skiC),'the other-station order is on this station’s item');assert.equal(customerOf(full,c.booking.id),'SYNTHETIC Guest');
  // Race: the other station is revoked right after the first authorization this read performs.
  const revoke=()=>x.db.pool.query('DELETE FROM staff_store_access WHERE staff_id=$1 AND store_id=$2',[both.subject,other]);
  let calls=0;class Racing extends OperationsContext{override async authorize(...a:Parameters<OperationsContext['authorize']>){const r=await super.authorize(...a);if(++calls===1)await revoke();return r;}}
  let raced:Awaited<ReturnType<typeof cal.view>>|null=null,refused:string|null=null;
  try{raced=await new CalendarService(new Racing(ops!.operationsPool,x.roles.authPool,both)).view({store,from:'2035-01-09',days:'7'});}catch(e){refused=(e as {code?:string}).code??'ERROR';}
  assert.ok(refused==='AUTHORIZATION_CHANGED'||(raced&&customerOf(raced,c.booking.id)==null),'never the revoked station’s customer: '+JSON.stringify({refused,customer:raced&&customerOf(raced,c.booking.id)}));
  // After the revocation: this station's own order keeps its name, the other-station order's name is null, the other
  // station's calendar is refused, and a revoked session is refused outright.
  const after=await new CalendarService(new OperationsContext(ops!.operationsPool,x.roles.authPool,both)).view({store,from:'2035-01-09',days:'7'});
  assert.equal(customerOf(after,c.booking.id),null);assert.equal(customerOf(after,a.booking.id),'SYNTHETIC Guest','this station’s own order keeps its name');
  await assert.rejects(new CalendarService(new OperationsContext(ops!.operationsPool,x.roles.authPool,both)).view({store:other}),{code:'FORBIDDEN'});
  await x.db.pool.query('DELETE FROM auth_session WHERE id=$1',[both.sessionId]);
  await assert.rejects(new CalendarService(new OperationsContext(ops!.operationsPool,x.roles.authPool,both)).view({store}),{code:'UNAUTHENTICATED'});
 });
 await check('scope: a manager of the other station cannot open this station’s calendar',async()=>{
  await writeAccount(x.roles.authPool,x.bp,undefined,{email:'calendar-other@example.invalid',password:x.password,displayName:'SYNTHETIC Calendar Other',active:true,role:'MANAGER',scope:'ASSIGNED',storeIds:[other as 'ONSEN_BASE'],permissions:{}});
  const o=new CalendarService(new OperationsContext(ops!.operationsPool,x.roles.authPool,(await x.login('calendar-other@example.invalid')).identity));
  await assert.rejects(o.view({store}),{code:'FORBIDDEN'});
 });
 console.log(JSON.stringify({status:'PASS',cases:count,externalCalls:0}));
}catch(e){failed=true;console.error(JSON.stringify({status:'FAIL',stage,code:(e as {code?:string}).code??'ASSERTION',message:(e as Error).message?.slice(0,700),at:(e as Error).stack?.split('\n').filter(l=>/calendar|context\.ts/.test(l)).slice(0,5).join(' | ')}));}
finally{await ops?.close();await custody?.close();await x.close();}
if(failed)process.exitCode=1;
