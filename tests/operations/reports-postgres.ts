import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {flowFixture} from '../flow/fixture';
import {syntheticPreparation} from '../custody/preparation-fixture';
import {CustodyService} from '../../packages/core/src/rental/custody-service';
import {provisionCustodyRole} from '../../scripts/custody-roles';
import {provisionOperationsRole} from '../../scripts/operations-roles';
import {writeAccount} from '../../packages/auth/src/accounts';
import {OperationsContext} from '../../packages/core/src/operations/context';
import {ReportsService,reportCsv} from '../../packages/core/src/operations/reports-service';

// Booqable Reports (Issue #47): real counts per station and period, booked amounts kept apart from money that moved,
// CSV equal to the screen rows. Synthetic local PostgreSQL only; no provider, network or financial operation.
const x=await flowFixture();let ops:Awaited<ReturnType<typeof provisionOperationsRole>>|undefined,custody:Awaited<ReturnType<typeof provisionCustodyRole>>|undefined,stage='setup',count=0,failed=false;
async function check(name:string,fn:()=>Promise<void>){stage=name;await fn();count++;console.log('PASS '+name);}
const bufferOverride={reason:'SYNTHETIC reports read test'};
const fingerprint=async()=>createHash('sha256').update(JSON.stringify(await Promise.all(['SELECT id,state,version FROM rental_bookings ORDER BY id','SELECT id,state FROM rental_payment_attempts ORDER BY id','SELECT id,state FROM rental_loan_items ORDER BY id','SELECT count(*) FROM rental_receipts','SELECT count(*) FROM booking_cancellation_refunds','SELECT count(*) FROM ops_refund_requests'].map(async q=>(await x.db.pool.query(q)).rows)))).digest('hex');
try{
 ops=await provisionOperationsRole(x.db.pool,x.db.identity);custody=await provisionCustodyRole(x.db.pool,x.db.identity);
 const reports=new ReportsService(new OperationsContext(ops.operationsPool,x.roles.authPool,x.signed.identity)),svc=new CustodyService(custody.custodyPool,x.roles.authPool,x.signed.identity);
 await x.clock('2035-01-05T09:00:00+09:00');
 const a=await x.draft('2035-01-10',undefined,bufferOverride);await x.service.startPayment(a.booking.id,randomUUID());
 const b=await x.draft('2035-01-11',undefined,bufferOverride);await x.service.startPayment(b.booking.id,randomUUID());
 const draft=await x.draft('2035-01-12',undefined,bufferOverride);void draft;
 const store=a.conditions.pickupStore,other=store==='MOUNTAIN_BASE'?'ONSEN_BASE':'MOUNTAIN_BASE';
 const total=async(id:string)=>Number((await x.db.pool.query("SELECT (price_snapshot->>'totalJpy')::bigint t FROM rental_bookings WHERE id=$1",[id])).rows[0].t);
 const createdOn=async(id:string)=>(await x.db.pool.query("SELECT (created_at AT TIME ZONE 'Asia/Tokyo')::date::text d FROM rental_bookings WHERE id=$1",[id])).rows[0].d as string;

 await check('bookings: created, confirmed and booked amount per creation date at the pickup station; drafts excluded; the read writes nothing',async()=>{
  const before=await fingerprint(),day=await createdOn(a.booking.id);
  const r=await reports.run({type:'bookings',stores:[store],from:day,to:day});
  assert.equal(r.rows.length,1);assert.equal(r.rows[0]!.station,store);assert.equal(r.rows[0]!.created,2,'two paid bookings, the draft is not a booking yet');
  assert.equal(r.rows[0]!.confirmed,2);assert.equal(r.totals.bookedJpy,await total(a.booking.id)+await total(b.booking.id));
  assert.equal(await fingerprint(),before);
 });
 await check('money: collected payments are reported apart from booked amounts; no refunds were made',async()=>{
  const day=(await x.db.pool.query("SELECT (completed_at AT TIME ZONE 'Asia/Tokyo')::date::text d FROM rental_payment_attempts WHERE booking_id=$1",[a.booking.id])).rows[0].d as string;
  const r=await reports.run({type:'money',stores:[store],from:day,to:day});
  assert.equal(r.totals.collectedJpy,await total(a.booking.id)+await total(b.booking.id));assert.equal(r.totals.refundedJpy,0);assert.equal(r.totals.refundInProgressJpy,0);
 });
 await x.clock('2035-01-10T10:00:00+09:00');
 const view=await svc.checkoutView(a.booking.id);
 await svc.prepare(randomUUID(),{bookingId:a.booking.id,expectedBookingVersion:view.bookingVersion,expectedHoldVersion:view.holdVersion,selections:view.items.map(i=>({requirementKey:i.requirement_key,assetId:i.asset_id,poleId:i.pole_id})),fitEvidence:syntheticPreparation(view)});
 await svc.checkout(randomUUID(),{bookingId:a.booking.id,expectedPreparationVersion:1});
 const loans=(await x.db.pool.query('SELECT id,asset_id,pole_id FROM rental_loan_items WHERE booking_id=$1',[a.booking.id])).rows as {id:string;asset_id:string|null;pole_id:string|null}[];
 await check('pickups: one order and its gear items on the checkout date at the pickup station',async()=>{
  const r=await reports.run({type:'pickups',stores:[store],from:'2035-01-10',to:'2035-01-10'});
  assert.deepEqual(r.rows.map(x=>[x.date,x.station,x.orders,x.items]),[['2035-01-10',store,1,loans.length]]);
 });
 await x.clock('2035-01-10T15:00:00+09:00');
 let batch=await svc.createBatch(randomUUID(),store);for(const l of loans)batch=await svc.scan(randomUUID(),{batchId:batch.id,expectedVersion:batch.version,assetId:l.asset_id,poleLoanId:l.pole_id?l.id:null});
 await svc.confirm(randomUUID(),{batchId:batch.id,expectedVersion:batch.version});
 await check('returns and care: receipts on the receipt date; received-but-uninspected items are in care now',async()=>{
  const r=await reports.run({type:'returns',stores:[store],from:'2035-01-10',to:'2035-01-10'});assert.equal(r.totals.items,loans.length);
  const care=await reports.run({type:'care',stores:[store]});assert.equal(care.from,null);assert.equal(care.rows[0]!.awaitingInspection,loans.length);
 });
 await check('stations never double count: for every report type and every numeric column, both stations together = each alone (REP-01)',async()=>{
  // The principal here is scoped to both stations, so the both-station read must succeed: a failure is a FAIL, never skipped.
  const p=await new OperationsContext(ops!.operationsPool,x.roles.authPool,x.signed.identity).authorize('BOOKING_VIEW',[store,other]);assert.ok(p.storeIds.includes(store as never)&&p.storeIds.includes(other as never));
  let compared=0;
  for(const type of ['bookings','pickups','returns','money','care'] as const){
   const range=type==='care'?{}:{from:'2035-01-01',to:'2035-01-31'};
   const both=await reports.run({type,stores:[store,other],...range}),one=await reports.run({type,stores:[store],...range}),two=await reports.run({type,stores:[other],...range});
   const numeric=both.columns.filter(c=>c.kind==='count'||c.kind==='jpy').map(c=>c.key);assert.ok(numeric.length>0,type+' has numeric columns');
   assert.deepEqual(Object.keys(both.totals).sort(),[...numeric].sort(),type+' totals cover every numeric column');
   for(const k of numeric){assert.equal(both.totals[k],one.totals[k]!+two.totals[k]!,type+' '+k);compared++;}
   // Row level too: the rows of both stations are exactly the rows of each station (no row counted twice or dropped).
   assert.equal(both.rows.length,one.rows.length+two.rows.length,type+' rows');
  }
  assert.ok(compared>=10,'compared '+compared+' totals');console.log('REP-01 compared totals: '+compared);
  // An other-station-only principal is still refused a both-station request.
  await writeAccount(x.roles.authPool,x.bp,undefined,{email:'reports-other-only@example.invalid',password:x.password,displayName:'SYNTHETIC Reports Other',active:true,role:'MANAGER',scope:'ASSIGNED',storeIds:[other as 'ONSEN_BASE'],permissions:{}});
  const otherOnly=new ReportsService(new OperationsContext(ops!.operationsPool,x.roles.authPool,(await x.login('reports-other-only@example.invalid')).identity));
  await assert.rejects(otherOnly.run({type:'bookings',stores:[store,other],from:'2035-01-01',to:'2035-01-31'}),{code:'FORBIDDEN'});
 });
 await check('CSV has exactly the screen rows and columns; spreadsheet formulas are neutralised',async()=>{
  const r=await reports.run({type:'pickups',stores:[store],from:'2035-01-01',to:'2035-01-31'});const csv=reportCsv(r);
  const lines=csv.replace(/^﻿/,'').trim().split('\r\n');assert.equal(lines.length,r.rows.length+1);assert.equal(lines[0],r.columns.map(c=>c.key).join(','));
  assert.equal(reportCsv({...r,rows:[{date:'2035-01-10',station:'=HYPERLINK("x")',orders:1,items:1,wearPieces:0}]}).includes(`"'=HYPERLINK(""x"")"`),true);
 });
 await check('invalid input and other-station scope are refused',async()=>{
  for(const bad of [{type:'nope',stores:[store]},{type:'bookings',stores:[]},{type:'bookings',stores:[store],from:'2035-02-30'},{type:'bookings',stores:[store],from:'2035-01-10',to:'2035-01-01'},{type:'bookings',stores:[store],from:'2035-01-01',to:'2035-06-01'}])await assert.rejects(reports.run(bad),(e:{code?:string})=>['INVALID_INPUT','INVALID_STORE'].includes(e.code??''),JSON.stringify(bad));
  await writeAccount(x.roles.authPool,x.bp,undefined,{email:'reports-other@example.invalid',password:x.password,displayName:'SYNTHETIC Reports Other',active:true,role:'MANAGER',scope:'ASSIGNED',storeIds:[other as 'ONSEN_BASE'],permissions:{}});
  const o=new ReportsService(new OperationsContext(ops!.operationsPool,x.roles.authPool,(await x.login('reports-other@example.invalid')).identity));
  await assert.rejects(o.run({type:'bookings',stores:[store]}),{code:'FORBIDDEN'});
 });
 console.log(JSON.stringify({status:'PASS',cases:count,externalCalls:0}));
}catch(e){failed=true;console.error(JSON.stringify({status:'FAIL',stage,code:(e as {code?:string}).code??'ASSERTION',message:(e as Error).message?.slice(0,700),at:(e as Error).stack?.split('\n').filter(l=>/reports|context\.ts/.test(l)).slice(0,5).join(' | ')}));}
finally{await ops?.close();await custody?.close();await x.close();}
if(failed)process.exitCode=1;
