import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {FakeGateway,flowFixture} from '../flow/fixture';
import {provisionOperationsRole} from '../../scripts/operations-roles';
import {OperationsContext} from '../../packages/core/src/operations/context';
import {AmendmentService} from '../../packages/core/src/operations/amendment-service';
import {FinancialOperations,type RefundRequest,type RefundObservation} from '../../packages/core/src/operations/financial';
import {CustodyService} from '../../packages/core/src/rental/custody-service';
import {loadStaff} from '../../packages/auth/src/staff-auth';
import {requestFor,variants} from '../inventory/fixture';
let failed=false,stage='fixture',count=0;const x=await flowFixture();let role:Awaited<ReturnType<typeof provisionOperationsRole>>|undefined;
// LOWER-LEVEL MECHANICS (post-payment amendment/exchange/refund plumbing): x.draft()'s HOLD is
// incidental setup, not what's under test — bufferOverride keeps the 95% ceiling from being the
// reason setup itself fails.
const bufferOverride={reason:'SYNTHETIC operations-amendment mechanics test'};
async function check(name:string,fn:()=>Promise<void>){stage=name;await fn();count++;console.log('PASS '+name);}
try{
 role=await provisionOperationsRole(x.db.pool,x.db.identity);
 const ctx=new OperationsContext(role.operationsPool,x.roles.authPool,x.signed.identity),svc=new AmendmentService(ctx),financial=new FinancialOperations(ctx),custody=new CustodyService(role.operationsPool,x.roles.authPool,x.signed.identity);
 const d=await x.draft(undefined,requestFor('2035-02-05'),bufferOverride);await x.service.startPayment(d.booking.id,randomUUID());const before=(await x.db.pool.query('SELECT to_jsonb(b) AS value FROM rental_bookings b WHERE id=$1',[d.booking.id])).rows[0].value;
  await x.db.pool.query("INSERT INTO staff_permission_overrides(staff_id,permission,allowed) VALUES($1,'RENTAL_AMEND',true),($1,'REFUND_OVERRIDE',true)",[x.actor]);
 let extension:string='',amount=0;
 await check('extension freezes delta without changing original booking/payment; replay applies once',async()=>{
  const current=await svc.view(d.booking.id),conditions=structuredClone(current.conditions);conditions.period={startDate:'2035-02-05',endDate:'2035-02-06',slot:'MULTIDAY'};
  const q=await svc.quote(randomUUID(),{bookingId:d.booking.id,expectedHoldVersion:current.holdVersion,conditions,reason:'SYNTHETIC extension'});extension=q.id;amount=q.quote.additionalChargeJpy;assert.ok(amount>0);
  const key=randomUUID(),v={quoteId:q.id,fitEvidence:'',reason:'SYNTHETIC agreed quote'},a=await svc.accept(key,v),again=await svc.accept(key,v);assert.deepEqual(a,again);assert.equal((await svc.view(d.booking.id)).bufferOverride,true);assert.ok((await x.db.pool.query('SELECT count(*)::int n FROM inventory_buffer_override_log WHERE hold_id=$1',[d.holdId])).rows[0].n>=2);
  assert.equal((await x.db.pool.query('SELECT count(*)::int n FROM ops_charge_requests WHERE booking_id=$1',[d.booking.id])).rows[0].n,1);
  assert.deepEqual((await x.db.pool.query('SELECT to_jsonb(b) AS value FROM rental_bookings b WHERE id=$1',[d.booking.id])).rows[0].value,before);
 });
 await check('reserve amendment requires current permission and an explicit safe removal',async()=>{
  const current=await svc.view(d.booking.id);await x.db.pool.query("UPDATE staff_permission_overrides SET allowed=false WHERE staff_id=$1 AND permission='INVENTORY_BUFFER_OVERRIDE'",[x.actor]);
  await assert.rejects(svc.quote(randomUUID(),{bookingId:d.booking.id,expectedHoldVersion:current.holdVersion,conditions:current.conditions,reason:'SYNTHETIC revoked override'}));
  await x.db.pool.query("UPDATE staff_permission_overrides SET allowed=true WHERE staff_id=$1 AND permission='INVENTORY_BUFFER_OVERRIDE'",[x.actor]);
  // This fixture has one compatible physical unit: its public floor is zero.
  await assert.rejects(svc.quote(randomUUID(),{bookingId:d.booking.id,expectedHoldVersion:current.holdVersion,conditions:current.conditions,reason:'SYNTHETIC remove reserve',bufferOverride:{useReserve:false,reason:'SYNTHETIC explicit removal'}}));assert.equal((await svc.view(d.booking.id)).bufferOverride,true);
 });
 await check('competing accepted extension uses expected version, only one applies',async()=>{
  const b=await svc.view(d.booking.id),conditions=structuredClone(b.conditions);conditions.period.endDate='2035-02-07';
  const q1=await svc.quote(randomUUID(),{bookingId:d.booking.id,expectedHoldVersion:b.holdVersion,conditions,reason:'SYNTHETIC concurrent'}),q2=await svc.quote(randomUUID(),{bookingId:d.booking.id,expectedHoldVersion:b.holdVersion,conditions,reason:'SYNTHETIC concurrent'});
  const results=await Promise.allSettled([q1,q2].map(q=>svc.accept(randomUUID(),{quoteId:q.id,fitEvidence:'',reason:'SYNTHETIC accepted'})));assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
 });
 await check('checkout consumes effective extended period; early return creates no automatic refund',async()=>{
  await x.clock('2035-02-05T10:00:00+09:00');const v=await custody.checkoutView(d.booking.id);assert.equal(v.conditions.period.endDate,'2035-02-07');
  const prepared=await custody.prepare(randomUUID(),{bookingId:d.booking.id,expectedBookingVersion:v.bookingVersion,expectedHoldVersion:v.holdVersion,selections:v.items.map(i=>({requirementKey:i.requirement_key,assetId:i.asset_id,poleId:i.pole_id})),fitEvidence:'SYNTHETIC fit'});
  const loan=await custody.checkout(randomUUID(),{bookingId:d.booking.id,expectedPreparationVersion:prepared.preparation.version});assert.ok(loan.loans.length);
  assert.equal(new Date(loan.loans[0].due_at).toISOString(),'2035-02-07T08:00:00.000Z');
  let batch=await custody.createBatch(randomUUID(),'MOUNTAIN_BASE');batch=await custody.scan(randomUUID(),{batchId:batch.id,expectedVersion:batch.version,assetId:loan.loans[0].asset_id,poleLoanId:null});await custody.confirm(randomUUID(),{batchId:batch.id,expectedVersion:batch.version});
  assert.equal((await x.db.pool.query('SELECT count(*)::int n FROM ops_refund_requests')).rows[0].n,0);assert.deepEqual((await x.db.pool.query('SELECT to_jsonb(b) AS value FROM rental_bookings b WHERE id=$1',[d.booking.id])).rows[0].value,before);
 });
 await check('OUT ski exchange uses atomic factual receipt and new loan; shortage preserves custody',async()=>{
  const received=(await x.db.pool.query("SELECT id,version FROM rental_loan_items WHERE booking_id=$1 AND state<>'OUT'",[d.booking.id])).rows[0]!;await custody.inspection(randomUUID(),{loanItemId:received.id,expectedVersion:received.version,store:'MOUNTAIN_BASE',evidence:'SYNTHETIC inspection before next booking'});
  Object.assign(x.principal,(await loadStaff(x.db.pool,x.actor))!);
  const d2=await x.draft(undefined,requestFor('2035-02-12'),bufferOverride);await x.service.startPayment(d2.booking.id,randomUUID());
  await x.clock('2035-02-12T10:00:00+09:00');const v=await custody.checkoutView(d2.booking.id),prepared=await custody.prepare(randomUUID(),{bookingId:d2.booking.id,expectedBookingVersion:v.bookingVersion,expectedHoldVersion:v.holdVersion,selections:v.items.map(i=>({requirementKey:i.requirement_key,assetId:i.asset_id,poleId:i.pole_id})),fitEvidence:'SYNTHETIC original fit'});
  const checked=await custody.checkout(randomUUID(),{bookingId:d2.booking.id,expectedPreparationVersion:prepared.preparation.version}),current=await svc.view(d2.booking.id),conditions=structuredClone(current.conditions);conditions.members[0]!.items[0]!.variantIds=[variants.skiAlt];
  const q=await svc.quote(randomUUID(),{bookingId:d2.booking.id,expectedHoldVersion:current.holdVersion,conditions,reason:'SYNTHETIC length change'});
  await svc.accept(randomUUID(),{quoteId:q.id,fitEvidence:'SYNTHETIC replacement fit',reason:'SYNTHETIC length exchange'});
  const loans=(await x.db.pool.query('SELECT asset_id,state FROM rental_loan_items WHERE booking_id=$1 ORDER BY checked_out_at,id',[d2.booking.id])).rows;assert.equal(loans.length,2);assert.equal(loans.filter(l=>l.state==='OUT').length,1);assert.notEqual(loans.find(l=>l.state==='OUT')!.asset_id,checked.loans[0].asset_id);
  const after=await svc.view(d2.booking.id),back=structuredClone(after.conditions);back.members[0]!.items[0]!.variantIds=[variants.ski];
  await assert.rejects(svc.quote(randomUUID(),{bookingId:d2.booking.id,expectedHoldVersion:after.holdVersion,conditions:back,reason:'SYNTHETIC unavailable returned asset'}));
  assert.deepEqual((await x.db.pool.query('SELECT asset_id,state FROM rental_loan_items WHERE booking_id=$1 ORDER BY checked_out_at,id',[d2.booking.id])).rows,loans);
 });
 await check('charge dispatch and lookup deny staff outside the immutable booking store scope',async()=>{
  const id=(await x.db.pool.query('SELECT id FROM ops_charge_requests WHERE amendment_id=$1',[extension])).rows[0].id,gateway=new FakeGateway(x.now),port=new FinancialOperations(ctx,gateway);
  const before=(await x.db.pool.query('SELECT to_jsonb(r) value FROM ops_charge_requests r WHERE id=$1',[id])).rows[0].value;
  await x.db.pool.query("UPDATE staff_members SET scope='ASSIGNED' WHERE id=$1",[x.actor]);await x.db.pool.query('DELETE FROM staff_store_access WHERE staff_id=$1',[x.actor]);await x.db.pool.query("INSERT INTO staff_store_access(staff_id,store_id) VALUES($1,'ONSEN_BASE')",[x.actor]);
  try{await assert.rejects(port.dispatch('charge',id),{code:'FORBIDDEN'});await assert.rejects(port.reconcile('charge',id),{code:'FORBIDDEN'});assert.equal(gateway.calls.length,0);assert.deepEqual((await x.db.pool.query('SELECT to_jsonb(r) value FROM ops_charge_requests r WHERE id=$1',[id])).rows[0].value,before);}
  finally{await x.db.pool.query("UPDATE staff_members SET scope='ALL' WHERE id=$1",[x.actor]);}
 });
 await check('additional charge timeout after acceptance is reconciled without another create or original rewrite',async()=>{
  const id=(await x.db.pool.query('SELECT id FROM ops_charge_requests WHERE amendment_id=$1',[extension])).rows[0].id,gateway=new FakeGateway(x.now);gateway.failAfterSave=true;
  const port=new FinancialOperations(ctx,gateway);assert.equal((await port.dispatch('charge',id)).state,'UNKNOWN');await port.dispatch('charge',id);assert.equal(gateway.calls.length,1);assert.equal((await port.reconcile('charge',id)).state,'COMPLETED');assert.equal(gateway.calls.length,1);assert.deepEqual((await x.db.pool.query('SELECT to_jsonb(b) value FROM rental_bookings b WHERE id=$1',[d.booking.id])).rows[0].value,before);
 });
 await check('refund cap, same-key concurrency, durable UNKNOWN blocks new key and duplicate dispatch',async()=>{
  const p=(await x.db.pool.query('SELECT id,amount_jpy FROM rental_payment_attempts WHERE booking_id=$1',[d.booking.id])).rows[0],key=randomUUID(),input={bookingId:d.booking.id,paymentId:p.id,actingStore:'MOUNTAIN_BASE',category:'CUSTOMER_EXCEPTION',reason:'SYNTHETIC exception',amountJpy:100};
  await assert.rejects(financial.requestRefund(randomUUID(),{...input,amountJpy:Number(p.amount_jpy)+1}),{code:'REFUND_CAP_EXCEEDED'});
  const [a,b]=await Promise.all([financial.requestRefund(key,input),financial.requestRefund(key,input)]);assert.equal(a.id,b.id);assert.equal((await x.db.pool.query('SELECT count(*)::int n FROM ops_refund_requests')).rows[0].n,1);
  let calls=0,request:RefundRequest|undefined;const fake=new FinancialOperations(ctx,null,{kind:'SIMULATED_DEV',async create(r){request=r;calls++;throw Error('SYNTHETIC timeout');},async lookup(){return null;}});
  assert.equal((await fake.dispatch('refund',a.id)).state,'UNKNOWN');await fake.dispatch('refund',a.id);assert.equal(calls,1);
  await assert.rejects(financial.requestRefund(randomUUID(),input),{code:'REFUND_RECONCILIATION_REQUIRED'});
  let status:RefundObservation['status']='FAILED';const reconciler=new FinancialOperations(ctx,null,{kind:'SIMULATED_DEV',async create(){throw Error('MUST_NOT_CREATE');},async lookup(){const r=request!;return {id:'SYNTHETIC_REFUND',paymentProviderId:r.paymentProviderId,merchantId:r.merchantId,locationId:r.locationId,amountJpy:r.amountJpy,currency:r.currency,status,updatedAt:x.now().toISOString()};}});
  assert.equal((await reconciler.reconcile('refund',a.id)).state,'FAILED');status='COMPLETED';assert.equal((await reconciler.reconcile('refund',a.id)).state,'FAILED');assert.equal((await financial.summary(d.booking.id,'MOUNTAIN_BASE')).alerts.length,1);await assert.rejects(financial.requestRefund(randomUUID(),input),{code:'REFUND_RECONCILIATION_REQUIRED'});
  await x.db.pool.query("UPDATE staff_permission_overrides SET allowed=false WHERE staff_id=$1 AND permission='REFUND_OVERRIDE'",[x.actor]);await assert.rejects(financial.requestRefund(randomUUID(),input),{code:'FORBIDDEN'});
 });
 console.log(JSON.stringify({status:'PASS',cases:count,extensionQuote:!!extension,additionalAmountPositive:amount>0,externalProviderCalls:0}));
}catch(e){failed=true;console.error(JSON.stringify({status:'FAIL',stage,code:(e as {code?:string}).code??'ASSERTION',message:e instanceof assert.AssertionError?e.message:'SAFE_DETAILS_ONLY'}));}
finally{await role?.close();await x.close();}if(failed)process.exit(1);
