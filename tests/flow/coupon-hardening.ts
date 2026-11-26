import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {flowFixture} from './fixture';
import {skiSet,requestFor} from '../inventory/fixture';
import {inputFor} from '../recommendation/fixture';
import {recordSyntheticBookingProfile} from '../custody/preparation-fixture';
import {provisionGuestRole} from '../../scripts/guest-roles';
import {provisionOperationsRole} from '../../scripts/operations-roles';
import {GuestContexts,type GuestDraft} from '../../packages/core/src/guest/context';
import {GuestSecurity,guestPeerKey,COUPON_FAILURES_PER_WINDOW,COUPON_FAILURE_WINDOW_SECONDS} from '../../packages/core/src/guest/security';
import {GuestBookingService,type BookingDraftStore} from '../../packages/core/src/guest/service';
import {RecommendationService} from '../../packages/core/src/recommendation/recommendation-service';
import {OperationsContext} from '../../packages/core/src/operations/context';
import {AmendmentService} from '../../packages/core/src/operations/amendment-service';
import {FinancialOperations} from '../../packages/core/src/operations/financial';
import {guestHandler} from '../../apps/web/src/lib/guest-http';
import type {GuestActor} from '../../packages/auth/src/booking-actor';
import type {CouponTerms} from '../../packages/contracts/src/pricing';
// Coupon hardening on a real PostgreSQL (synthetic data, test-owned payment adapter, no provider request):
//  1. guests get one identical answer for every coupon-code outcome and a failure budget (429); staff keep detailed codes;
//  2. a coupon booking stays correct through cancellation (refund basis is the discounted payment), staff refund caps and
//     amendment (refused for review, never double-discounted).
let stage='startup',passed=0,failed=false;const x=await flowFixture();let guestRole:Awaited<ReturnType<typeof provisionGuestRole>>|undefined,opsRole:Awaited<ReturnType<typeof provisionOperationsRole>>|undefined;
async function check(name:string,fn:()=>Promise<void>){stage=name;await fn();passed++;console.log('PASS '+name);}
const bufferOverride={reason:'SYNTHETIC coupon hardening test'};
const base:CouponTerms={code:'HARD-BASE',validFrom:'2034-12-01T00:00:00.000Z',validUntil:'2035-06-01T00:00:00.000Z',storeBasis:'PICKUP_STORE',stores:['MOUNTAIN_BASE','ONSEN_BASE'],products:['SKI_SET_ADULT_REGULAR'],kind:'FIXED_JPY',value:700,minimumJpy:0,minimumBasis:'ELIGIBLE_SUBTOTAL',maximumDiscountJpy:700,advanceCombination:'ALLOW',maxActiveReservations:null};
const make=async(over:Partial<CouponTerms>)=>{const id=randomUUID();await x.quotes.createCoupon(id,{...base,...over});return id;};
const contact={displayName:'SYNTHETIC Guest',email:'synthetic-guest@example.invalid',termsAccepted:true};
async function quoteWith(code:string|null,date:string,wantAdvance=false){const conditions=skiSet(date);const h=await x.holds.command('create',randomUUID(),conditions,undefined,undefined,bufferOverride);assert.equal(h.result,'CREATED');const quote=(await x.quotes.create(randomUUID(),{conditions,holdId:h.holdId,couponCode:code,wantAdvance})).quote;return {conditions,holdId:h.holdId!,quote};}
const paidBooking=async(code:string,date:string,wantAdvance=false)=>{const d=await quoteWith(code,date,wantAdvance);const b=await x.service.create(randomUUID(),d.quote.id,contact);await recordSyntheticBookingProfile(x.db.pool,b.id);await x.service.startPayment(b.id,randomUUID());return {d,b};};
try{
 guestRole=await provisionGuestRole(x.db.pool,x.db.identity);opsRole=await provisionOperationsRole(x.db.pool,x.db.identity);
 // ---- 1. guest coupon guessing -------------------------------------------------------------------------------------------
 const origin='https://fixture.invalid',contexts=new GuestContexts(guestRole.guestPool),serverKey=randomBytes(32).toString('hex');
 const policy={version:'SYNTHETIC-COUPON-HARD',contextSeconds:3600,absoluteSeconds:7200,recoverySeconds:1800,replaySeconds:30,retentionSeconds:60,windowSeconds:10,peerRequests:500,globalRequests:5000};
 const security=new GuestSecurity(guestRole.guestPool,contexts,policy,serverKey);
 let peerName='A';const peer=()=>guestPeerKey('SYNTHETIC-INGRESS-'+peerName,serverKey);
 const rec=new RecommendationService(x.roles.recommendationPool,x.principal,x.holds,x.quotes);
 const v=await rec.preview(randomUUID(),inputFor('2035-03-20'),null,true);
 let draft:GuestDraft={id:randomUUID(),context_id:randomUUID(),revision:1,input:{},preview_key:randomUUID(),preview_id:v.preview.id,selection:null,selection_key:null,booking_key:randomUUID(),booking_id:null};
 const store:BookingDraftStore<GuestActor>={draftTable:'guest_drafts',async read(){return draft;},async change(_a,fn){return fn({query:async(_sql:string,p:unknown[])=>{draft={...draft,selection:JSON.parse(p[1] as string),selection_key:p[2] as string};return {rows:[],rowCount:1};}} as never,draft);}};
 const svc=new GuestBookingService(store,{kind:'GUEST' as const,subject:x.actor,contextId:draft.context_id,tokenHash:'0'.repeat(64)},rec,null,async()=>({revision:'t',models:[],sizes:[]}));
 const api=guestHandler(contexts,()=>svc,origin,false,{service:security,peer:()=>peer()});
 const post=(path:string,body:unknown,cookie?:string)=>api(new Request(origin+'/api/guest'+path,{method:'POST',headers:{origin,'content-type':'application/json',...(cookie?{cookie}:{})},body:JSON.stringify(body)}));
 peerName='SETUP';const ctx=await post('/context',{});assert.equal(ctx.status,201);const cookie=ctx.headers.get('set-cookie')!.split(';')[0]!;
 const choose=async(couponCode:unknown,over:Record<string,unknown>={})=>{draft={...draft,selection:null,selection_key:null};return post('/selection',{draftId:draft.id,expectedRevision:draft.revision,directions:{'ski-a':'RECOMMENDED','board-b':'RECOMMENDED'},wantAdvance:false,couponCode,acceptedModelPolicy:true,...over},cookie);};
 const answer=async(r:Response)=>({status:r.status,body:await r.json() as Record<string,unknown>,retryAfter:r.headers.get('retry-after')});
 const goodId=await make({code:'HARD-GOOD'});const offId=await make({code:'HARD-OFF'});await x.quotes.setCouponActive(offId,{active:false});
 await make({code:'HARD-PAST',validFrom:'2034-11-01T00:00:00.000Z',validUntil:'2034-12-01T00:00:00.000Z'});await make({code:'HARD-ONSEN',stores:['ONSEN_BASE']});await make({code:'HARD-NOADV',advanceCombination:'DENY'});
 await make({code:'HARD-FULL',maxActiveReservations:1});await paidBooking('HARD-FULL','2035-02-02');
 await check('guests get ONE identical answer (same code, same status, same body) for unknown, disabled, expired, wrong-store and full coupons',async()=>{
  peerName='UNIFORM';const results=[];
  for(const [code,over] of [['NO-SUCH-CODE',{}],['HARD-OFF',{}],['hard-past',{}],['HARD-ONSEN',{}],['HARD-FULL',{}]] as const){const r=await answer(await choose(code,over));results.push({code,...r});}
  for(const r of results){assert.equal(r.status,422,r.code);assert.deepEqual(r.body,{error:'COUPON_NOT_APPLICABLE'},r.code);assert.equal(r.retryAfter,null);}
  assert.equal(new Set(results.map(r=>JSON.stringify([r.status,r.body]))).size,1,'indistinguishable');
  assert.equal(draft.selection_key,null,'nothing saved for a refused code');
 });
 await check('a valid code and a null code are untouched by the uniform answer; malformed input and unrelated errors keep their own codes',async()=>{
  peerName='VALID';const ok=await answer(await choose('hard-good'));assert.equal(ok.status,200,JSON.stringify(ok.body));assert.equal((ok.body.selection as {couponCode:string}).couponCode,'HARD-GOOD');assert.equal(((ok.body.selection as {estimate:{couponDiscountJpy:number}}).estimate.couponDiscountJpy),700);
  assert.deepEqual((await answer(await choose('bad code!'))).body,{error:'INVALID_COUPON'});assert.equal((await answer(await choose(null))).status,200);
  assert.deepEqual((await answer(await choose('HARD-GOOD',{expectedRevision:99}))).body,{error:'STALE_DRAFT'});
  assert.deepEqual((await answer(await choose('HARD-GOOD',{draftId:randomUUID()}))).body,{error:'FORBIDDEN'});
 });
 await check('failure budget: only failures spend it, valid applications and unrelated errors never do; the next failure past the limit is 429 with Retry-After',async()=>{
  peerName='BUDGET';
  for(let n=0;n<COUPON_FAILURES_PER_WINDOW-1;n++)assert.equal((await choose('NO-SUCH-'+n)).status,422);
  for(let n=0;n<15;n++)assert.equal((await choose('HARD-GOOD')).status,200,'valid code is never counted');
  assert.equal((await choose('HARD-GOOD',{expectedRevision:99})).status,409,'unrelated error is not a coupon failure');
  const spent=async()=>Number((await x.db.pool.query("SELECT coalesce(sum(count),0) AS n FROM guest_rate_buckets WHERE bucket LIKE $1",['SYNTHETIC-COUPON-HARD:coupon:'+peer()+':%'])).rows[0].n);
  assert.equal(await spent(),COUPON_FAILURES_PER_WINDOW-1);
  assert.equal((await choose('HARD-OFF')).status,422);assert.equal(await spent(),COUPON_FAILURES_PER_WINDOW);
  const blocked=await answer(await choose('NO-SUCH-LAST'));assert.equal(blocked.status,429);assert.deepEqual(blocked.body,{error:'COUPON_ATTEMPTS_EXCEEDED'});assert.equal(blocked.retryAfter,String(COUPON_FAILURE_WINDOW_SECONDS));
  assert.equal((await choose('HARD-GOOD')).status,429,'locked out until the window rolls over, even for a valid code');
  assert.equal((await choose(null)).status,200,'selection without a coupon is never blocked');assert.equal(await spent(),COUPON_FAILURES_PER_WINDOW,'blocked attempts do not grow the counter');
  assert.equal(await spent(),COUPON_FAILURES_PER_WINDOW);
  // Another peer is independent.
  peerName='BUDGET-OTHER';assert.equal((await choose('HARD-GOOD')).status,200);
  // The window rolls over by itself.
  peerName='BUDGET';await x.clock('2035-01-01T10:11:00+09:00');assert.equal((await choose('HARD-GOOD')).status,200);assert.equal((await choose('NO-SUCH-AGAIN')).status,422);await x.clock('2035-01-01T10:00:00+09:00');
 });
 await check('parallel guesses cannot outrun the budget: exactly the limit is answered 422, the rest 429',async()=>{
  peerName='RACE';const out=await Promise.all(Array.from({length:COUPON_FAILURES_PER_WINDOW+12},(_,n)=>choose('NO-RACE-'+n).then(r=>r.status)));
  assert.equal(out.filter(s=>s===422).length,COUPON_FAILURES_PER_WINDOW);assert.equal(out.filter(s=>s===429).length,12);
 });
 await check('staff and operations keep the detailed coupon codes (the guest mapping lives only in the guest HTTP layer)',async()=>{
  const staff=new GuestBookingService(store,{kind:'GUEST' as const,subject:x.actor,contextId:draft.context_id,tokenHash:'0'.repeat(64)},rec,null,async()=>({revision:'t',models:[],sizes:[]}));
  const pick=(couponCode:string,wantAdvance=false)=>{draft={...draft,selection:null,selection_key:null};return staff.choose({draftId:draft.id,expectedRevision:draft.revision,directions:{'ski-a':'RECOMMENDED','board-b':'RECOMMENDED'},wantAdvance,couponCode,acceptedModelPolicy:true});};
  await assert.rejects(pick('NO-SUCH'),{code:'COUPON_NOT_FOUND'});await assert.rejects(pick('HARD-OFF'),{code:'COUPON_INACTIVE',status:409});await assert.rejects(pick('HARD-ONSEN'),{code:'COUPON_NOT_APPLICABLE'});assert.ok(await pick('HARD-NOADV',true));await assert.rejects(pick('HARD-FULL'),{code:'COUPON_LIMIT_REACHED',status:409});
  await assert.rejects(x.quotes.preview({conditions:skiSet('2035-03-01'),holdId:null,couponCode:'NO-SUCH',wantAdvance:false}),{code:'COUPON_NOT_FOUND'});
 });
 // ---- 2. cancellation / refund / amendment --------------------------------------------------------------------------------
 const payAmount=async(bookingId:string)=>Number((await x.db.pool.query("SELECT coalesce(sum(amount_jpy),0) n FROM rental_payment_attempts WHERE booking_id=$1 AND state='COMPLETED'",[bookingId])).rows[0].n);
 const snapshotTotal=async(bookingId:string)=>Number((await x.db.pool.query("SELECT (price_snapshot->>'totalJpy')::int n FROM rental_bookings WHERE id=$1",[bookingId])).rows[0].n);
 await check('cancelling a paid coupon booking refunds the discounted amount (never the list price) and frees the coupon slot',async()=>{
  const id=await make({code:'HARD-CANCEL',maxActiveReservations:1});const {b}=await paidBooking('HARD-CANCEL','2035-02-10');
  assert.equal(await snapshotTotal(b.id),6800);assert.equal(await payAmount(b.id),6800);
  const p=await x.service.cancellationPreview(b.id);assert.equal(p.refundAmountJpy,6800,'refund basis is the amount actually paid');assert.ok(p.refundAmountJpy<7500);
  await x.service.cancel(b.id,randomUUID(),p.previewHash);assert.equal((await x.service.get(b.id)).state,'CANCELLED');
  assert.equal(Number((await x.db.pool.query('SELECT maximum_refund_jpy FROM booking_cancellations WHERE booking_id=$1',[b.id])).rows[0].maximum_refund_jpy),6800);
  const usage=((await x.quotes.listCoupons()) as {coupons:{id:string;usage:{bookings:number}}[]}).coupons.find(c=>c.id===id)!.usage.bookings;assert.equal(usage,0);
 });
 await check('TD H1: a cancelled coupon booking (usage count back to 0) still blocks deletion; disabling stays possible and the code stays reserved',async()=>{
  const id=await make({code:'HARD-H1-CANCEL',maxActiveReservations:1});const {b}=await paidBooking('HARD-H1-CANCEL','2035-04-02');
  const p=await x.service.cancellationPreview(b.id);await x.service.cancel(b.id,randomUUID(),p.previewHash);assert.equal((await x.service.get(b.id)).state,'CANCELLED');
  const view=((await x.quotes.listCoupons()) as {coupons:{id:string;usage:{bookings:number;activeReservations:number}}[]}).coupons.find(c=>c.id===id)!;
  assert.deepEqual(view.usage,{bookings:0,activeReservations:0},'capacity count excludes the cancelled booking: the old delete check would have passed');
  await assert.rejects(x.quotes.deleteCoupon(id),{code:'COUPON_IN_USE',status:409});
  await x.quotes.setCouponActive(id,{active:false});await assert.rejects(x.quotes.deleteCoupon(id),{code:'COUPON_IN_USE'});
  const listed=((await x.quotes.listCoupons()) as {coupons:{id:string;active:boolean}[]}).coupons.find(c=>c.id===id);assert.ok(listed&&listed.active===false,'still listed, disabled, never deleted');
  await assert.rejects(x.quotes.createCoupon(randomUUID(),{...base,code:'HARD-H1-CANCEL'}),{code:'COUPON_CODE_EXISTS'});
 });
 await check('TD H1: concurrent quote creation and deletion never both succeed (a deleted coupon is never used, a used coupon is never deleted)',async()=>{
  for(let i=0;i<4;i++){
   const code='HARD-H1-RACE'+i,id=await make({code});const conditions=skiSet('2035-04-1'+(2+i));const h=await x.holds.command('create',randomUUID(),conditions,undefined,undefined,bufferOverride);assert.equal(h.result,'CREATED');
   const [q,d]=await Promise.allSettled([x.quotes.create(randomUUID(),{conditions,holdId:h.holdId,couponCode:code,wantAdvance:false}),x.quotes.deleteCoupon(id)]);
   const quoted=q.status==='fulfilled',deleted=d.status==='fulfilled';
   assert.ok(quoted!==deleted,`exactly one of quote/delete wins (iteration ${i}): quoted=${quoted} deleted=${deleted}`);
   if(!quoted)assert.ok(['COUPON_INACTIVE','COUPON_NOT_FOUND'].includes((q as PromiseRejectedResult).reason?.code),'the losing quote is refused with a coupon code');
   else assert.equal((d as PromiseRejectedResult).reason?.code,'COUPON_IN_USE');
   const n=Number((await x.db.pool.query('SELECT count(*) n FROM price_quotes WHERE coupon_id=$1',[id])).rows[0].n),deletedNow=((await x.quotes.listCoupons()) as {coupons:{id:string}[]}).coupons.every(c=>c.id!==id);
   assert.ok(!(n>0&&deletedNow),'no quote exists for a deleted coupon');
  }
 });
 await check('advance discount + coupon: the refund basis is the combined paid amount',async()=>{
  await make({code:'HARD-ADV'});const {b}=await paidBooking('HARD-ADV','2035-02-11',true);assert.equal(await payAmount(b.id),6460);
  const p=await x.service.cancellationPreview(b.id);assert.equal(p.refundAmountJpy,6460);
 });
 // Everything that needs the fixture principal is created BEFORE the staff permission overrides below (they change its permission snapshot).
 await make({code:'HARD-REFUND'});const refundBooking=(await paidBooking('HARD-REFUND','2035-02-12')).b;
 await make({code:'HARD-AMEND'});const amendBooking=(await paidBooking('HARD-AMEND','2035-02-13')).b;
 const plain=await x.draft(undefined,requestFor('2035-02-20'),bufferOverride);await x.service.startPayment(plain.booking.id,randomUUID());
 await x.db.pool.query("INSERT INTO staff_permission_overrides(staff_id,permission,allowed) VALUES($1,'REFUND_OVERRIDE',true),($1,'RENTAL_AMEND',true) ON CONFLICT DO NOTHING",[x.actor]);
 await check('staff refund cap is the discounted payment; one yen more is refused, the full paid amount is accepted once',async()=>{
  const ctxOps=new OperationsContext(opsRole!.operationsPool,x.roles.authPool,x.signed.identity),financial=new FinancialOperations(ctxOps);
  const b=refundBooking;const pay=(await x.db.pool.query('SELECT id,amount_jpy FROM rental_payment_attempts WHERE booking_id=$1',[b.id])).rows[0];assert.equal(Number(pay.amount_jpy),6800);
  const input={bookingId:b.id,paymentId:pay.id,actingStore:'MOUNTAIN_BASE',category:'CUSTOMER_EXCEPTION',reason:'SYNTHETIC exception'};
  await assert.rejects(financial.requestRefund(randomUUID(),{...input,amountJpy:6801}),{code:'REFUND_CAP_EXCEEDED'});await assert.rejects(financial.requestRefund(randomUUID(),{...input,amountJpy:7500}),{code:'REFUND_CAP_EXCEEDED'});
  const ok=await financial.requestRefund(randomUUID(),{...input,amountJpy:6800});assert.equal(ok.amountJpy,6800);
  // A booking that already has a staff refund reserved up to the paid amount can refund nothing more automatically.
  const p=await x.service.cancellationPreview(b.id);assert.equal(p.refundAmountJpy,0);
 });
 await check('amendment of a coupon booking is refused for review (no double discount, no row, booking and payment unchanged)',async()=>{
  const ctxOps=new OperationsContext(opsRole!.operationsPool,x.roles.authPool,x.signed.identity),amend=new AmendmentService(ctxOps);
  const b=amendBooking;
  const before=(await x.db.pool.query('SELECT to_jsonb(b) AS value FROM rental_bookings b WHERE id=$1',[b.id])).rows[0].value,quotesBefore=(await x.db.pool.query('SELECT count(*)::int n FROM ops_amendment_quotes')).rows[0].n;
  const view=await amend.view(b.id),conditions=structuredClone(view.conditions);conditions.period={startDate:'2035-02-13',endDate:'2035-02-14',slot:'MULTIDAY'};
  await assert.rejects(amend.quote(randomUUID(),{bookingId:b.id,expectedHoldVersion:view.holdVersion,conditions,reason:'SYNTHETIC extension of a coupon booking'}),{code:'AMENDMENT_PROMOTION_REVIEW_REQUIRED',status:409});
  assert.equal((await x.db.pool.query('SELECT count(*)::int n FROM ops_amendment_quotes')).rows[0].n,quotesBefore);assert.deepEqual((await x.db.pool.query('SELECT to_jsonb(b) AS value FROM rental_bookings b WHERE id=$1',[b.id])).rows[0].value,before);
  assert.equal(await payAmount(b.id),6800);assert.equal((await x.db.pool.query('SELECT count(*)::int n FROM ops_charge_requests WHERE booking_id=$1',[b.id])).rows[0].n,0);
  // A plain booking is still amendable by the same service (the refusal is specific to coupons).
  const pv=await amend.view(plain.booking.id),pc=structuredClone(pv.conditions);pc.period={startDate:'2035-02-20',endDate:'2035-02-21',slot:'MULTIDAY'};
  const q=await amend.quote(randomUUID(),{bookingId:plain.booking.id,expectedHoldVersion:pv.holdVersion,conditions:pc,reason:'SYNTHETIC extension without coupon'});assert.ok(q.quote.additionalChargeJpy>0);
 });
 void goodId;
 console.log(`COUPON hardening real PostgreSQL: ${passed} passed; no skipped; test-owned payment adapter, no provider request.`);
}catch(e){console.error('COUPON_HARDENING_FAILED '+stage+' '+((e as {code?:string}).code??(e as Error).name));if(e instanceof assert.AssertionError)console.error(JSON.stringify({actual:e.actual,expected:e.expected}));console.error((e as Error).stack?.split('\n').slice(0,8).join('\n'));failed=true;}finally{await guestRole?.close();await opsRole?.close();await x.close();console.log('Owned coupon hardening PostgreSQL stopped.');if(failed)process.exitCode=1;}
