import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {flowFixture} from './fixture';
import {skiSet,requestFor} from '../inventory/fixture';
import {recordSyntheticBookingProfile} from '../custody/preparation-fixture';
import {provisionOperationsRole} from '../../scripts/operations-roles';
import {loadStaff} from '../../packages/auth/src/staff-auth';
import {HoldService} from '../../packages/core/src/inventory/hold-service';
import {QuoteService} from '../../packages/core/src/pricing/quote-service';
import {OperationsContext} from '../../packages/core/src/operations/context';
import {FinancialOperations} from '../../packages/core/src/operations/financial';
import type {CouponTerms} from '../../packages/contracts/src/pricing';
// Coupon deletion vs every kind of recorded use, on a real isolated PostgreSQL (synthetic data, test-owned fake payment adapter,
// no provider request, no production access). TD "not yet done" items:
//  A. an EXPIRED DRAFT booking (hold lapsed: not counted for capacity) still blocks deletion; disabling works; the code is not reusable
//  B. coupon_reservations (explicit reserveCoupon, live and expired) and bare quotes block deletion
//  C. refund history (booking_cancellation_refunds from a guest cancellation, ops_refund_requests from a staff refund) blocks deletion
//  D. concurrent quote / reserve / booking-create / delete, repeated: a used coupon is never deleted, a deleted coupon is never used,
//     and the capacity cap (maxActiveReservations) is never overrun.
let stage='startup',passed=0,failed=false;const x=await flowFixture();let opsRole:Awaited<ReturnType<typeof provisionOperationsRole>>|undefined;
async function check(name:string,fn:()=>Promise<void>){stage=name;await fn();passed++;console.log('PASS '+name);}
const bufferOverride={reason:'SYNTHETIC coupon history test'};
const base:CouponTerms={code:'HIST-BASE',validFrom:'2034-12-01T00:00:00.000Z',validUntil:'2035-12-01T00:00:00.000Z',storeBasis:'PICKUP_STORE',stores:['MOUNTAIN_BASE','ONSEN_BASE'],products:['SKI_SET_ADULT_REGULAR'],kind:'FIXED_JPY',value:700,minimumJpy:0,minimumBasis:'ELIGIBLE_SUBTOTAL',maximumDiscountJpy:700,advanceCombination:'ALLOW',maxActiveReservations:null};
const make=async(over:Partial<CouponTerms>)=>{const id=randomUUID();await quotes.createCoupon(id,{...base,...over});return id;};
const contact={displayName:'SYNTHETIC Guest',email:'synthetic-guest@example.invalid',termsAccepted:true};
let quotes=x.quotes,holds=x.holds; // re-created after the staff overrides below (their permission snapshot changes)
let dayNo=0;const nextDate=()=>{const d=new Date(Date.UTC(2035,2,1+dayNo++));return d.toISOString().slice(0,10);};
async function hold(date=nextDate()){const conditions=skiSet(date);const h=await holds.command('create',randomUUID(),conditions,undefined,undefined,bufferOverride);assert.equal(h.result,'CREATED');return {conditions,holdId:h.holdId!};}
async function quoteWith(code:string,wantAdvance=false){const h=await hold();return {...h,quote:(await quotes.create(randomUUID(),{conditions:h.conditions,holdId:h.holdId,couponCode:code,wantAdvance})).quote};}
const draftBooking=async(code:string)=>{const d=await quoteWith(code);return {d,b:await x.service.create(randomUUID(),d.quote.id,contact)};};
const paidBooking=async(code:string)=>{const {d,b}=await draftBooking(code);await recordSyntheticBookingProfile(x.db.pool,b.id);await x.service.startPayment(b.id,randomUUID());return {d,b};};
type View={id:string;active:boolean;usage:{bookings:number;activeReservations:number}};
const view=async(id:string)=>((await quotes.listCoupons()) as {coupons:View[]}).coupons.find(c=>c.id===id);
const count=async(sql:string,p:unknown[])=>Number((await x.db.pool.query(sql,p)).rows[0].n);
/** Deletion is refused, the coupon is still listed, disabling works, and the code can neither be re-created nor used while disabled. */
async function assertCannotDelete(id:string,code:string){
 await assert.rejects(quotes.deleteCoupon(id),{code:'COUPON_IN_USE',status:409});assert.ok(await view(id),'still listed');
 const off=await quotes.setCouponActive(id,{active:false,reason:'SYNTHETIC campaign ended'}) as {active:boolean};assert.equal(off.active,false);
 await assert.rejects(quotes.deleteCoupon(id),{code:'COUPON_IN_USE'},'disabled history is still protected');
 assert.equal((await view(id))!.active,false,'listed and disabled, never deleted');
 await assert.rejects(quotes.createCoupon(randomUUID(),{...base,code}),{code:'COUPON_CODE_EXISTS',status:409});
 await assert.rejects(quotes.create(randomUUID(),{conditions:skiSet('2035-06-30'),holdId:null,couponCode:code,wantAdvance:false}),{code:'COUPON_INACTIVE'},'a disabled coupon cannot be used');
}
try{
 opsRole=await provisionOperationsRole(x.db.pool,x.db.identity);
 // Bookings that need the fixture principal are created BEFORE the staff permission override below (it changes the permission snapshot).
 await make({code:'HIST-CANCEL'});const cancelled=(await paidBooking('HIST-CANCEL')).b;
 await make({code:'HIST-STAFFREFUND'});const refunded=(await paidBooking('HIST-STAFFREFUND')).b;
 await make({code:'HIST-BOTH'});const both=(await paidBooking('HIST-BOTH')).b;

 await check('A. an expired DRAFT booking leaves capacity and the usage count but still blocks deletion; disabling works and the code stays reserved',async()=>{
  const id=await make({code:'HIST-DRAFT',maxActiveReservations:1});const {b}=await draftBooking('HIST-DRAFT');
  assert.equal((await x.service.get(b.id)).state,'DRAFT');assert.deepEqual((await view(id))!.usage,{bookings:1,activeReservations:0},'live DRAFT counts');
  await assert.rejects(quoteWith('HIST-DRAFT'),{code:'COUPON_LIMIT_REACHED',status:409});
  await assert.rejects(quotes.deleteCoupon(id),{code:'COUPON_IN_USE'},'live DRAFT blocks deletion');
  await x.clock('2035-01-01T12:00:00+09:00'); // far beyond the 10 minute hold
  try{
   assert.deepEqual((await view(id))!.usage,{bookings:0,activeReservations:0},'expired DRAFT is NOT counted: the old usage-only delete check would pass here');
   assert.equal(await count('SELECT count(*) n FROM rental_bookings b JOIN price_quotes q ON q.id=b.quote_id WHERE q.coupon_id=$1 AND b.state=\'DRAFT\'',[id]),1,'the DRAFT row is still on record');
   await assertCannotDelete(id,'HIST-DRAFT');
  }finally{await x.clock('2035-01-01T10:00:00+09:00');}
 });
 await check('A2. the capacity freed by an expired DRAFT is usable again (new quote and booking succeed) and the deletion block stays',async()=>{
  const id=await make({code:'HIST-DRAFT2',maxActiveReservations:1});await draftBooking('HIST-DRAFT2');
  await x.clock('2035-01-01T12:00:00+09:00');
  try{const again=await quoteWith('HIST-DRAFT2');assert.equal(again.quote.snapshot.couponDiscountJpy,700);const b=await x.service.create(randomUUID(),again.quote.id,contact);assert.equal(b.state,'DRAFT');assert.equal(await count('SELECT count(*) n FROM price_quotes WHERE coupon_id=$1',[id]),2);await assertCannotDelete(id,'HIST-DRAFT2');}
  finally{await x.clock('2035-01-01T10:00:00+09:00');}
 });

 await check('B. a bare quote (no booking, no reservation), even after it expired, blocks deletion',async()=>{
  const id=await make({code:'HIST-QUOTE'});await quoteWith('HIST-QUOTE');assert.deepEqual((await view(id))!.usage,{bookings:0,activeReservations:0});
  await x.clock('2035-01-01T14:00:00+09:00');try{await assertCannotDelete(id,'HIST-QUOTE');}finally{await x.clock('2035-01-01T10:00:00+09:00');}
 });
 await check('B. coupon_reservations: a live reservation holds a slot and blocks deletion; once expired it frees the slot but the history row still blocks deletion',async()=>{
  const id=await make({code:'HIST-RESERVE',maxActiveReservations:1});const first=await quoteWith('HIST-RESERVE');
  const rKey=randomUUID();const r=await quotes.reserveCoupon(first.quote.id,rKey) as {status:string;replayed:boolean};assert.equal(r.status,'RESERVED_NOT_REDEEMED');assert.equal(r.replayed,false);
  assert.equal((await quotes.reserveCoupon(first.quote.id,rKey) as {replayed:boolean}).replayed,true,'idempotent');
  assert.deepEqual((await view(id))!.usage,{bookings:0,activeReservations:1});
  await assert.rejects(quoteWith('HIST-RESERVE'),{code:'COUPON_LIMIT_REACHED'},'the reservation took the only slot');
  await assert.rejects(quotes.deleteCoupon(id),{code:'COUPON_IN_USE'});
  await x.clock('2035-01-01T10:30:00+09:00'); // quote/reservation TTL is 10 minutes
  try{
   assert.deepEqual((await view(id))!.usage,{bookings:0,activeReservations:0},'expired reservation no longer counts');
   assert.equal(await count('SELECT count(*) n FROM coupon_reservations WHERE coupon_id=$1',[id]),1,'but the row is history');
   await assertCannotDelete(id,'HIST-RESERVE');
   await assert.rejects(quotes.reserveCoupon(first.quote.id,randomUUID()),{code:'QUOTE_NOT_RESERVABLE'},'an expired quote cannot be reserved again');
  }finally{await x.clock('2035-01-01T10:00:00+09:00');}
 });

 // Everything needing the fixture principal is above; the staff overrides below change its permission snapshot.
 await x.db.pool.query("INSERT INTO staff_permission_overrides(staff_id,permission,allowed) VALUES($1,'REFUND_OVERRIDE',true),($1,'RENTAL_AMEND',true) ON CONFLICT DO NOTHING",[x.actor]);
 {const principal=(await loadStaff(x.db.pool,x.actor))!;quotes=new QuoteService(x.roles.pricingPool,principal,()=>x.now());holds=new HoldService(x.roles.holdPool,principal,()=>x.now());}
 const financial=new FinancialOperations(new OperationsContext(opsRole.operationsPool,x.roles.authPool,x.signed.identity));
 const payment=async(bookingId:string)=>(await x.db.pool.query('SELECT id,amount_jpy FROM rental_payment_attempts WHERE booking_id=$1',[bookingId])).rows[0] as {id:string;amount_jpy:number};
 const staffRefund=async(bookingId:string,amountJpy:number)=>{const p=await payment(bookingId);return financial.requestRefund(randomUUID(),{bookingId,paymentId:p.id,actingStore:'MOUNTAIN_BASE',category:'CUSTOMER_EXCEPTION',reason:'SYNTHETIC exception',amountJpy});};

 await check('C. guest cancellation refund history (booking_cancellation_refunds, CANCELLED booking, usage back to 0) blocks deletion',async()=>{
  const id=(await x.db.pool.query("SELECT id FROM coupon_versions WHERE code='HIST-CANCEL'")).rows[0].id as string;
  const p=await x.service.cancellationPreview(cancelled.id);assert.equal(p.refundAmountJpy,6800);await x.service.cancel(cancelled.id,randomUUID(),p.previewHash);assert.equal((await x.service.get(cancelled.id)).state,'CANCELLED');
  assert.ok(await count('SELECT count(*) n FROM booking_cancellation_refunds WHERE booking_id=$1',[cancelled.id])>=1,'a refund row really exists');
  assert.deepEqual((await view(id))!.usage,{bookings:0,activeReservations:0});await assertCannotDelete(id,'HIST-CANCEL');
 });
 await check('C. staff refund request history (ops_refund_requests on a still-paid booking) blocks deletion',async()=>{
  const id=(await x.db.pool.query("SELECT id FROM coupon_versions WHERE code='HIST-STAFFREFUND'")).rows[0].id as string;
  const r=await staffRefund(refunded.id,6800);assert.equal(r.amountJpy,6800);assert.ok(await count('SELECT count(*) n FROM ops_refund_requests WHERE booking_id=$1',[refunded.id])>=1,'a staff refund row really exists');
  assert.equal((await x.service.get(refunded.id)).state==='CANCELLED',false,'booking is not cancelled: this is the staff-refund-only path');
  await assertCannotDelete(id,'HIST-STAFFREFUND');
 });
 await check('C. staff refund then guest cancellation (both refund tables populated, remaining refund 0): deletion still blocked',async()=>{
  const id=(await x.db.pool.query("SELECT id FROM coupon_versions WHERE code='HIST-BOTH'")).rows[0].id as string;
  await staffRefund(both.id,1000);const p=await x.service.cancellationPreview(both.id);assert.equal(p.refundAmountJpy,5800,'cancellation refunds only what staff have not already reserved');
  await x.service.cancel(both.id,randomUUID(),p.previewHash);assert.equal((await x.service.get(both.id)).state,'CANCELLED');
  assert.ok(await count('SELECT count(*) n FROM ops_refund_requests WHERE booking_id=$1',[both.id])>=1);assert.ok(await count('SELECT count(*) n FROM booking_cancellation_refunds WHERE booking_id=$1',[both.id])>=1);
  assert.equal(((await view(id))!.usage.bookings),0);await assertCannotDelete(id,'HIST-BOTH');
 });
 await check('C. control: a coupon with no recorded use at all is still deletable and its code stays reserved (the guard is not over-broad)',async()=>{
  const id=await make({code:'HIST-NEVER'});const v=await quotes.deleteCoupon(id) as {statusReason:string};assert.equal(v.statusReason,'COUPON_DELETED_BY_STAFF');assert.equal(await view(id),undefined,'hidden from the list');
  await assert.rejects(quotes.createCoupon(randomUUID(),{...base,code:'HIST-NEVER'}),{code:'COUPON_CODE_EXISTS'},'a deleted code stays reserved');
  await assert.rejects(quotes.create(randomUUID(),{conditions:skiSet('2035-06-29'),holdId:null,couponCode:'HIST-NEVER',wantAdvance:false}),{code:'COUPON_INACTIVE'});
  assert.equal((await quotes.deleteCoupon(id) as {statusReason:string}).statusReason,'COUPON_DELETED_BY_STAFF','delete is idempotent');
 });

 const settle=(rs:PromiseSettledResult<unknown>[])=>rs.map(r=>r.status==='fulfilled'?'ok':String((r.reason as {code?:string})?.code??r.reason));
 await check('D. 3-way race x6: two quote creations and a deletion of a fresh coupon: either the delete wins and BOTH quotes fail, or it fails and the coupon stays used',async()=>{
  let deletes=0,keeps=0;
  for(let i=0;i<6;i++){
   const code='HIST-R3-'+i,id=await make({code});const a=await hold(),b=await hold();
   const out=await Promise.allSettled([quotes.create(randomUUID(),{conditions:a.conditions,holdId:a.holdId,couponCode:code,wantAdvance:false}),quotes.deleteCoupon(id),quotes.create(randomUUID(),{conditions:b.conditions,holdId:b.holdId,couponCode:code,wantAdvance:false})]);
   const s=settle(out),n=await count('SELECT count(*) n FROM price_quotes WHERE coupon_id=$1',[id]),listed=Boolean(await view(id));
   if(s[1]==='ok'){deletes++;assert.equal(n,0,'delete won => no quote exists: '+s.join());assert.equal(listed,false);for(const q of [s[0],s[2]])assert.ok(['COUPON_INACTIVE','COUPON_NOT_FOUND'].includes(q as string),q);}
   else{keeps++;assert.equal(s[1],'COUPON_IN_USE');assert.ok(n>=1&&listed,'delete lost => used and still listed: '+s.join());assert.equal(n,s.filter(v=>v==='ok').length,'every successful quote is on record');}
  }
  assert.equal(deletes+keeps,6);
 });
 await check('D. reserve race x4: two quotes of a cap-1 coupon reserved concurrently while a deletion runs: exactly one reservation, deletion always refused, no overrun',async()=>{
  for(let i=0;i<4;i++){
   const code='HIST-RR-'+i,id=await make({code});const q1=await quoteWith(code),q2=await quoteWith(code);
   // The cap is part of the coupon terms: use a second coupon with the cap so both quotes could be created uncapped above.
   const capCode='HIST-RRC-'+i,capId=await make({code:capCode,maxActiveReservations:1});const c1=await quoteWith(capCode);
   // c2 is created while the slot is still free (no reservation yet), so both quotes exist before the race.
   const c2=await quoteWith(capCode);
   const out=await Promise.allSettled([quotes.reserveCoupon(c1.quote.id,randomUUID()),quotes.reserveCoupon(c2.quote.id,randomUUID()),quotes.deleteCoupon(capId),quotes.deleteCoupon(id)]);
   const s=settle(out);assert.equal(s.slice(0,2).filter(v=>v==='ok').length,1,'exactly one of the two reservations wins: '+s.join());assert.ok(s.slice(0,2).includes('COUPON_LIMIT_REACHED'),s.join());
   assert.equal(s[2],'COUPON_IN_USE');assert.equal(s[3],'COUPON_IN_USE');assert.equal(await count('SELECT count(*) n FROM coupon_reservations WHERE coupon_id=$1',[capId]),1);void q1;void q2;
   assert.ok(await view(capId));assert.ok(await view(id));
  }
 });
 await check('D. booking race x4: two DRAFT bookings of a cap-1 coupon created concurrently with a deletion and a reservation: exactly one booking, never an overrun, deletion refused',async()=>{
  for(let i=0;i<4;i++){
   const code='HIST-BR-'+i,id=await make({code,maxActiveReservations:1});const q1=await quoteWith(code),q2=await quoteWith(code);
   const out=await Promise.allSettled([x.service.create(randomUUID(),q1.quote.id,contact),x.service.create(randomUUID(),q2.quote.id,contact),quotes.deleteCoupon(id),quotes.reserveCoupon(q1.quote.id,randomUUID())]);
   const s=settle(out);assert.equal(s.slice(0,2).filter(v=>v==='ok').length,1,'exactly one booking takes the last slot: '+s.join());assert.ok(s.slice(0,2).includes('COUPON_LIMIT_REACHED'),s.join());
   assert.equal(s[2],'COUPON_IN_USE');
   assert.equal(await count("SELECT count(*) n FROM rental_bookings b JOIN price_quotes q ON q.id=b.quote_id WHERE q.coupon_id=$1 AND b.state<>'CANCELLED'",[id]),1,'booking count never exceeds the cap');
   assert.ok(await view(id));
  }
 });
 await check('D. quote vs disable vs delete x4: disabling mid-race never lets a deleted coupon be quoted and never deletes a quoted coupon',async()=>{
  for(let i=0;i<4;i++){
   const code='HIST-QD-'+i,id=await make({code});const a=await hold();
   const out=await Promise.allSettled([quotes.create(randomUUID(),{conditions:a.conditions,holdId:a.holdId,couponCode:code,wantAdvance:false}),quotes.setCouponActive(id,{active:false,reason:'SYNTHETIC race'}),quotes.deleteCoupon(id)]);
   const s=settle(out),n=await count('SELECT count(*) n FROM price_quotes WHERE coupon_id=$1',[id]),deleted=(await x.db.pool.query("SELECT 1 FROM coupon_status_events WHERE coupon_id=$1 AND reason='COUPON_DELETED_BY_STAFF'",[id])).rowCount===1;
   assert.ok(!(n>0&&deleted),'a quoted coupon is never deleted: '+s.join());
   if(deleted)assert.equal(s[0]==='ok',false,'a deleted coupon is never quoted: '+s.join());
  }
 });
 console.log(`COUPON history real PostgreSQL: ${passed} passed; no skipped; test-owned payment adapter, no provider request.`);
}catch(e){console.error('COUPON_HISTORY_FAILED '+stage+' '+((e as {code?:string}).code??(e as Error).name));if(e instanceof assert.AssertionError)console.error(JSON.stringify({message:e.message,actual:e.actual,expected:e.expected}));console.error((e as Error).stack?.split('\n').slice(0,8).join('\n'));failed=true;}finally{await opsRole?.close();await x.close();console.log('Owned coupon history PostgreSQL stopped.');if(failed)process.exitCode=1;}
void requestFor;
