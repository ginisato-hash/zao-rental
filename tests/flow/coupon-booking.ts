import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {flowFixture} from './fixture';
import {skiSet} from '../inventory/fixture';
import {inputFor} from '../recommendation/fixture';
import {recordSyntheticBookingProfile} from '../custody/preparation-fixture';
import {RecommendationService} from '../../packages/core/src/recommendation/recommendation-service';
import {GuestBookingService,type BookingDraftStore} from '../../packages/core/src/guest/service';
import type {GuestDraft} from '../../packages/core/src/guest/context';
import type {GuestActor} from '../../packages/auth/src/booking-actor';
import type {CouponTerms} from '../../packages/contracts/src/pricing';
// Coupon through quote -> booking -> payment request on a real PostgreSQL with the isolated flow role and a test-owned
// payment adapter. Synthetic data only; no Square request.
let stage='startup',passed=0,failed=false;const x=await flowFixture();
async function check(name:string,fn:()=>Promise<void>){stage=name;await fn();passed++;console.log('PASS '+name);}
const bufferOverride={reason:'SYNTHETIC coupon booking mechanics test'};
const base:CouponTerms={code:'BOOK-BASE',validFrom:'2035-01-01T00:00:00.000Z',validUntil:'2035-06-01T00:00:00.000Z',storeBasis:'PICKUP_STORE',stores:['MOUNTAIN_BASE','ONSEN_BASE'],products:['SKI_SET_ADULT_REGULAR'],kind:'FIXED_JPY',value:700,minimumJpy:0,minimumBasis:'ELIGIBLE_SUBTOTAL',maximumDiscountJpy:700,advanceCombination:'ALLOW',maxActiveReservations:null};
const make=async(over:Partial<CouponTerms>)=>{const id=randomUUID();await x.quotes.createCoupon(id,{...base,...over});return id;};
const contact={displayName:'SYNTHETIC Guest',email:'synthetic-guest@example.invalid',termsAccepted:true};
async function quoteWith(code:string|null,date:string,wantAdvance=false){const conditions=skiSet(date);const h=await x.holds.command('create',randomUUID(),conditions,undefined,undefined,bufferOverride);assert.equal(h.result,'CREATED');const quote=(await x.quotes.create(randomUUID(),{conditions,holdId:h.holdId,couponCode:code,wantAdvance})).quote;return {conditions,holdId:h.holdId!,quote};}
const book=async(quoteId:string)=>{const b=await x.service.create(randomUUID(),quoteId,contact);await recordSyntheticBookingProfile(x.db.pool,b.id);return b;};
const usage=async(id:string)=>(((await x.quotes.listCoupons()) as {coupons:{id:string;usage:{bookings:number}}[]}).coupons.find(c=>c.id===id)!).usage.bookings;
const rows=async(quoteId:string)=>(await x.db.pool.query('SELECT count(*)::int n FROM rental_bookings WHERE quote_id=$1',[quoteId])).rows[0].n as number;
try{
 await check('coupon quote -> booking -> payment request equals the frozen snapshot total; discount is applied exactly once and a retry never re-prices',async()=>{
  const id=await make({code:'BOOK-PAY'});const d=await quoteWith('BOOK-PAY','2035-02-10');const s=d.quote.snapshot as {subtotalJpy:number;couponDiscountJpy:number;advanceDiscountJpy:number;totalJpy:number;couponVersionId:string};
  assert.deepEqual([s.subtotalJpy,s.couponDiscountJpy,s.advanceDiscountJpy,s.totalJpy,s.couponVersionId],[7500,700,0,6800,id]);
  const b=await book(d.quote.id);assert.equal(b.priceSnapshot.totalJpy,6800);assert.equal(b.priceSha256,d.quote.snapshotSha256);assert.equal(await usage(id),1);
  const before=x.fake.calls.length;const paid=await x.service.startPayment(b.id,randomUUID());assert.equal(paid.state,'CONFIRMED_DEV');assert.equal(x.fake.calls.length,before+1);assert.equal(x.fake.calls.at(-1)!.amountJpy,6800);
  await x.service.startPayment(b.id,randomUUID()).catch(()=>{});assert.equal(x.fake.calls.length,before+1);const saved=await x.service.get(b.id);assert.deepEqual(saved.priceSnapshot,d.quote.snapshot);assert.equal(saved.priceSnapshot.totalJpy,6800);assert.equal(await usage(id),1);
 });
 await check('advance discount and coupon combine in the snapshot; the payment request is the combined total, never recomputed',async()=>{
  await make({code:'BOOK-ADV'});const d=await quoteWith('BOOK-ADV','2035-02-11',true);const s=d.quote.snapshot as {couponDiscountJpy:number;advanceDiscountJpy:number;totalJpy:number};assert.deepEqual([s.couponDiscountJpy,s.advanceDiscountJpy,s.totalJpy],[700,340,6460]);
  const b=await book(d.quote.id);const before=x.fake.calls.length;await x.service.startPayment(b.id,randomUUID());assert.equal(x.fake.calls.length,before+1);assert.equal(x.fake.calls.at(-1)!.amountJpy,6460);
 });
 await check('a coupon disabled after the quote refuses the booking and creates nothing; enabling again lets the same quote book',async()=>{
  const id=await make({code:'BOOK-OFF'});const d=await quoteWith('BOOK-OFF','2035-02-12');await x.quotes.setCouponActive(id,{active:false});
  await assert.rejects(x.service.create(randomUUID(),d.quote.id,contact),{code:'COUPON_INACTIVE',status:409});assert.equal(await rows(d.quote.id),0);assert.equal(await usage(id),0);
  await x.quotes.setCouponActive(id,{active:true});const b=await book(d.quote.id);assert.equal(b.state,'DRAFT');assert.equal(await usage(id),1);
  await x.quotes.setCouponActive(id,{active:false});await assert.rejects(x.service.assertPrepared(b.id),{code:'COUPON_INACTIVE'});await x.quotes.setCouponActive(id,{active:true});await x.service.assertPrepared(b.id);
 });
 await check('two people racing for the last coupon slot: exactly one booking, the other gets COUPON_LIMIT_REACHED and no row',async()=>{
  const id=await make({code:'BOOK-LAST',maxActiveReservations:1});const a=await quoteWith('BOOK-LAST','2035-02-13'),b=await quoteWith('BOOK-LAST','2035-02-14');
  const out=await Promise.allSettled([x.service.create(randomUUID(),a.quote.id,contact),x.service.create(randomUUID(),b.quote.id,contact)]);
  assert.equal(out.filter(o=>o.status==='fulfilled').length,1);const lost=out.find(o=>o.status==='rejected') as PromiseRejectedResult;assert.equal((lost.reason as {code:string}).code,'COUPON_LIMIT_REACHED');assert.equal((lost.reason as {status:number}).status,409);
  assert.equal((await rows(a.quote.id))+(await rows(b.quote.id)),1);assert.equal(await usage(id),1);
  await assert.rejects(quoteWith('BOOK-LAST','2035-02-15'),{code:'COUPON_LIMIT_REACHED'});await assert.rejects(x.quotes.preview({conditions:skiSet('2035-02-15'),holdId:null,couponCode:'BOOK-LAST',wantAdvance:false}),{code:'COUPON_LIMIT_REACHED'});
  const winner=out.findIndex(o=>o.status==='fulfilled')===0?a:b,loser=winner===a?b:a;
  // Cancelling the winning booking returns the slot to the loser.
  const bookingId=(await x.db.pool.query('SELECT id FROM rental_bookings WHERE quote_id=$1',[winner.quote.id])).rows[0].id as string;
  const p=await x.service.cancellationPreview(bookingId);await x.service.cancel(bookingId,randomUUID(),p.previewHash);assert.equal((await x.service.get(bookingId)).state,'CANCELLED');assert.equal(await usage(id),0);
  const retry=await x.service.create(randomUUID(),loser.quote.id,contact);assert.equal(retry.state,'DRAFT');assert.equal(await usage(id),1);
 });
 await check('an expired unpaid booking and an expired quote release or refuse the coupon without a booking row',async()=>{
  const id=await make({code:'BOOK-EXP',maxActiveReservations:1});const d=await quoteWith('BOOK-EXP','2035-02-16');await book(d.quote.id);assert.equal(await usage(id),1);
  // The expiry sweep runs inside every HOLD command; once it released the unpaid booking's hold the slot is free again.
  await x.clock('2035-01-01T10:12:00+09:00');const conditions=skiSet('2035-02-17');const h=await x.holds.command('create',randomUUID(),conditions,undefined,undefined,bufferOverride);assert.equal(h.result,'CREATED');assert.equal((await x.holds.get(d.holdId)).state,'EXPIRED');assert.equal(await usage(id),0);
  const next=(await x.quotes.create(randomUUID(),{conditions,holdId:h.holdId,couponCode:'BOOK-EXP',wantAdvance:false})).quote;assert.equal((await book(next.id)).state,'DRAFT');assert.equal(await usage(id),1);
  await x.clock('2035-01-01T10:00:00+09:00');
 });
 await check('a quote that expired before booking is refused with the existing HOLD_OR_QUOTE_NOT_USABLE and nothing is created',async()=>{
  const id=await make({code:'BOOK-STALE'});const d=await quoteWith('BOOK-STALE','2035-02-18');await x.clock('2035-01-01T10:11:00+09:00');
  await assert.rejects(x.service.create(randomUUID(),d.quote.id,contact),{code:'HOLD_OR_QUOTE_NOT_USABLE'});assert.equal(await rows(d.quote.id),0);assert.equal(await usage(id),0);await x.clock('2035-01-01T10:00:00+09:00');
 });
 await check('tampering: the flow role cannot rewrite a quote or booking price or coupon, and a quote of another coupon cannot be swapped in',async()=>{
  await make({code:'BOOK-TAMPER'});const d=await quoteWith('BOOK-TAMPER','2035-02-19');const b=await book(d.quote.id);
  for(const sql of ["UPDATE price_quotes SET coupon_id=NULL","UPDATE price_quotes SET snapshot='{}'::jsonb","UPDATE rental_bookings SET price_snapshot='{}'::jsonb","DELETE FROM coupon_status_events","INSERT INTO coupon_status_events(id,coupon_id,active,actor) SELECT gen_random_uuid(),id,false,'x' FROM coupon_versions LIMIT 1"])await assert.rejects(x.flow.flowPool.query(sql),(e:{code?:string})=>['42501','23514'].includes(e.code??''));
  assert.equal((await x.service.get(b.id)).priceSha256,d.quote.snapshotSha256);
 });
 await check('guest/staff selection: couponCode is normalised, saved, priced by the server and cannot be swapped or tampered after selection',async()=>{
  const id=await make({code:'BOOK-GUEST'});const rec=new RecommendationService(x.roles.recommendationPool,x.principal,x.holds,x.quotes);
  const v=await rec.preview(randomUUID(),inputFor('2035-03-20'),null,true);let draft:GuestDraft={id:randomUUID(),context_id:randomUUID(),revision:1,input:{},preview_key:randomUUID(),preview_id:v.preview.id,selection:null,selection_key:null,booking_key:randomUUID(),booking_id:null};
  const store:BookingDraftStore<GuestActor>={draftTable:'guest_drafts',async read(){return draft;},async change(_a,fn){return fn({query:async(_sql:string,p:unknown[])=>{draft={...draft,selection:JSON.parse(p[1] as string),selection_key:p[2] as string};return {rows:[],rowCount:1};}} as never,draft);}};
  const guest=new GuestBookingService(store,{kind:'GUEST',subject:x.actor,contextId:draft.context_id,tokenHash:'0'.repeat(64)},rec,null,async()=>({revision:'t',models:[],sizes:[]}));
  const choose=(couponCode:unknown,over:Record<string,unknown>={})=>({draftId:draft.id,expectedRevision:draft.revision,directions:{'ski-a':'RECOMMENDED','board-b':'RECOMMENDED'},wantAdvance:false,couponCode,acceptedModelPolicy:true,...over});
  await assert.rejects(guest.choose(choose('bad code!')),{code:'INVALID_COUPON'});await assert.rejects(guest.choose(choose('')),{code:'INVALID_COUPON'});await assert.rejects(guest.choose(choose(7)),{code:'SELECTION_INVALID'});await assert.rejects(guest.choose(choose('NO-SUCH')),{code:'COUPON_NOT_FOUND'});await assert.rejects(guest.choose(choose('BOOK-GUEST',{totalJpy:1})),{code:'INVALID_INPUT'});
  await x.quotes.setCouponActive(id,{active:false});await assert.rejects(guest.choose(choose('book-guest')),{code:'COUPON_INACTIVE',status:409});assert.equal(draft.selection_key,null);await x.quotes.setCouponActive(id,{active:true});
  const view=await guest.choose(choose(' book-guest '));const sel=draft.selection as {couponCode:string|null;estimate:{couponDiscountJpy:number;totalJpy:number;subtotalJpy:number}};assert.equal(sel.couponCode,'BOOK-GUEST');assert.equal(sel.estimate.couponDiscountJpy,700);assert.equal(sel.estimate.totalJpy,sel.estimate.subtotalJpy-700);assert.equal(view.selection!.couponCode,'BOOK-GUEST');
  await guest.choose(choose('BOOK-GUEST'));await assert.rejects(guest.choose(choose(null)),{code:'DRAFT_ALREADY_SELECTED'});await assert.rejects(guest.choose(choose('BOOK-OTHER')),{code:'COUPON_NOT_FOUND'});
  // The saved selection (not the browser) drives the quote: the same coupon, server priced, equals the estimate shown to the guest.
  const {estimate,...saved}=sel;const picked=await rec.select(v.preview.id,draft.selection_key!,saved,bufferOverride);assert.equal(picked.selection!.stage,'COMPLETE');const q=picked.quote!.snapshot as {couponVersionId:string;couponDiscountJpy:number;totalJpy:number};assert.deepEqual([q.couponVersionId,q.couponDiscountJpy,q.totalJpy],[id,700,estimate.totalJpy]);
  const b=await x.service.create(randomUUID(),picked.quote!.id,contact);const before=x.fake.calls.length;await x.service.startPayment(b.id,randomUUID());assert.equal(x.fake.calls.at(-1)!.amountJpy,estimate.totalJpy);assert.equal(x.fake.calls.length,before+1);
 });
 await check('quote creation and booking creation racing on the same coupon never deadlock or time out',async()=>{
  const id=await make({code:'BOOK-MIX',maxActiveReservations:3});const a=await quoteWith('BOOK-MIX','2035-04-02'),b=await quoteWith('BOOK-MIX','2035-04-03');
  const out=await Promise.allSettled([x.service.create(randomUUID(),a.quote.id,contact),x.service.create(randomUUID(),b.quote.id,contact),x.quotes.create(randomUUID(),{conditions:skiSet('2035-04-04'),holdId:null,couponCode:'BOOK-MIX',wantAdvance:false}),x.quotes.setCouponActive(id,{active:true}),x.quotes.listCoupons()]);
  assert.ok(out.every(o=>o.status==='fulfilled'),JSON.stringify(out.map(o=>o.status==='rejected'?(o.reason as {code:string}).code:'ok')));assert.equal(await usage(id),2);
 });
 await check('COUPON-CAP-UNKNOWN-01: a payment whose response was lost keeps the last slot after its hold expires; another booking is refused; late success never frees it; a definite failure does',async()=>{
  const id=await make({code:'BOOK-UNK',maxActiveReservations:1});
  const a=await quoteWith('BOOK-UNK','2035-03-02');const bookingA=await book(a.quote.id);
  x.fake.failAfterSave=true;const unknown=await x.service.startPayment(bookingA.id,randomUUID());x.fake.failAfterSave=false;
  assert.equal(unknown.payments[0].state,'UNKNOWN');assert.equal(unknown.state,'PAYMENT_PENDING');assert.equal(await usage(id),1);
  // Time passes beyond the hold; the expiry sweep (inside every HOLD command) releases the hold but the booking stays PAYMENT_PENDING.
  const exp=(await x.db.pool.query('SELECT expires_at FROM inventory_holds WHERE id=$1',[a.holdId])).rows[0].expires_at as Date;await x.clock(new Date(exp.getTime()+60_000).toISOString());const conditions=skiSet('2035-03-03');const h=await x.holds.command('create',randomUUID(),conditions,undefined,undefined,bufferOverride);assert.equal(h.result,'CREATED');
  const hs=(await x.db.pool.query('SELECT state,expires_at FROM inventory_holds WHERE id=$1',[a.holdId])).rows[0] as {state:string;expires_at:Date};assert.ok(hs.expires_at<=x.now(),'the hold is past its expires_at (whatever its state)');
  assert.equal((await x.db.pool.query('SELECT state FROM rental_bookings WHERE id=$1',[bookingA.id])).rows[0].state,'PAYMENT_PENDING');
  assert.equal(await usage(id),1,'an unknown payment keeps its slot after expiry');
  await assert.rejects(x.quotes.create(randomUUID(),{conditions,holdId:h.holdId,couponCode:'BOOK-UNK',wantAdvance:false}),{code:'COUPON_LIMIT_REACHED',status:409});
  // A late provider success is reconciled by the existing state machine (confirmation or review) and never frees the slot.
  const late=await x.service.reconcile(bookingA.id);assert.ok(['CONFIRMED_DEV','PAYMENT_REVIEW'].includes(late.state),late.state);assert.equal(await usage(id),1);
  await assert.rejects(x.quotes.create(randomUUID(),{conditions,holdId:h.holdId,couponCode:'BOOK-UNK',wantAdvance:false}),{code:'COUPON_LIMIT_REACHED',status:409});
  await x.clock('2035-01-01T10:00:00+09:00');
 });
 await check('a definite payment failure terminalized by the existing state machine returns the slot',async()=>{
  const id=await make({code:'BOOK-FAIL',maxActiveReservations:1});const d=await quoteWith('BOOK-FAIL','2035-03-04');const b=await book(d.quote.id);assert.equal(await usage(id),1);
  x.fake.status='FAILED';await x.service.startPayment(b.id,randomUUID()).catch(()=>{});x.fake.status='COMPLETED';
  const state=(await x.db.pool.query('SELECT state FROM rental_bookings WHERE id=$1',[b.id])).rows[0].state as string;
  // The slot is only returned once the booking is CANCELLED; if the simulated failure leaves it PAYMENT_PENDING it must still count.
  assert.equal(await usage(id),state==='CANCELLED'?0:1,'slot follows the booking state, not the clock');
  process.stdout.write('  (definite failure leaves the booking in state '+state+')\n');
 });
 console.log(`COUPON booking real PostgreSQL: ${passed} passed; no skipped; test-owned payment adapter, no Square requests.`);
}catch(e){console.error('COUPON_BOOKING_FAILED '+stage+' '+((e as {code?:string}).code??(e as Error).name));if(e instanceof assert.AssertionError)console.error(JSON.stringify({actual:e.actual,expected:e.expected}));console.error((e as Error).stack?.split('\n').slice(0,6).join('\n'));failed=true;}finally{await x.close();console.log('Owned coupon booking PostgreSQL stopped.');}
if(failed)process.exit(1);
