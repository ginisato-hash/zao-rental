import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {flowFixture} from '../flow/fixture';
import {skiSet} from '../inventory/fixture';
import {writeAccount,type AccountSettings} from '../../packages/auth/src/accounts';
import {loadStaff,type StaffPrincipal} from '../../packages/auth/src/staff-auth';
import {QuoteService} from '../../packages/core/src/pricing/quote-service';
import type {BookingActor} from '../../packages/auth/src/booking-actor';
import type {CouponTerms} from '../../packages/contracts/src/pricing';
// Coupon administration on a real PostgreSQL (all migrations) with the isolated pricing role. Synthetic data only.
let stage='startup',passed=0,failed=false;const x=await flowFixture();
async function check(name:string,fn:()=>Promise<void>){stage=name;await fn();passed++;console.log('PASS '+name);}
const base:CouponTerms={code:'SYNTH-BASE',validFrom:'2035-01-01T00:00:00.000Z',validUntil:'2035-03-01T00:00:00.000Z',storeBasis:'PICKUP_STORE',stores:['MOUNTAIN_BASE'],products:['SKI_SET_ADULT_REGULAR'],kind:'FIXED_JPY',value:700,minimumJpy:0,minimumBasis:'ELIGIBLE_SUBTOTAL',maximumDiscountJpy:700,advanceCombination:'ALLOW',maxActiveReservations:null};
const input=(code:string|null,wantAdvance=false,date='2035-02-10')=>({conditions:skiSet(date),holdId:null as string|null,couponCode:code,wantAdvance});
const make=async(over:Partial<CouponTerms>)=>{const id=randomUUID();await x.quotes.createCoupon(id,{...base,...over});return id;};
const events=async(id:string)=>(await x.db.pool.query('SELECT count(*)::int n FROM coupon_status_events WHERE coupon_id=$1',[id])).rows[0].n as number;
const counts=async()=>(await x.db.pool.query('SELECT (SELECT count(*) FROM price_quotes)::int q,(SELECT count(*) FROM coupon_reservations)::int r')).rows[0] as {q:number;r:number};
async function staff(role:'STAFF'|'VIEWER'|'MANAGER',email:string):Promise<StaffPrincipal>{const s:AccountSettings={displayName:'SYNTHETIC '+role,active:true,role,scope:'ASSIGNED',storeIds:['MOUNTAIN_BASE'],permissions:{QUOTE_VIEW:true,QUOTE_CREATE:role!=='VIEWER'}};const a=await writeAccount(x.roles.authPool,x.bp,undefined,{...s,email,password:x.password});return (await loadStaff(x.db.pool,a.id!))!;}
const as=(p:BookingActor)=>new QuoteService(x.roles.pricingPool,p,()=>x.now());
try{
 await check('create returns an active view with usage 0, rejects duplicate code and is idempotent for the same id',async()=>{
  const id=randomUUID();const v=await x.quotes.createCoupon(id,base) as {id:string;code:string;active:boolean;statusReason:string;usage:{bookings:number;activeReservations:number}};
  assert.equal(v.id,id);assert.equal(v.code,'SYNTH-BASE');assert.equal(v.active,true);assert.equal(v.statusReason,'CREATED');assert.deepEqual(v.usage,{bookings:0,activeReservations:0});assert.equal(await events(id),1);
  assert.equal((await x.quotes.createCoupon(id,base) as {id:string}).id,id);assert.equal(await events(id),1);
  await assert.rejects(x.quotes.createCoupon(randomUUID(),base),{code:'COUPON_CODE_EXISTS',status:409});
  await assert.rejects(x.quotes.createCoupon(randomUUID(),{...base,code:'synth-base'}),{code:'COUPON_CODE_EXISTS'});
  await assert.rejects(x.quotes.createCoupon(id,{...base,value:800,maximumDiscountJpy:800}),{code:'IDEMPOTENCY_MISMATCH'});
  const lower=await x.quotes.createCoupon(randomUUID(),{...base,code:'synth-lower'}) as {code:string};assert.equal(lower.code,'SYNTH-LOWER');
 });
 await check('create validates strictly: no defaulted business values, unknown or invalid fields are rejected',async()=>{
  const {maxActiveReservations:_,...missing}=base;void _;await assert.rejects(x.quotes.createCoupon(randomUUID(),missing),{code:'INVALID_INPUT'});
  await assert.rejects(x.quotes.createCoupon(randomUUID(),{...base,code:'C-EXTRA',extra:1}),{code:'INVALID_INPUT'});
  await assert.rejects(x.quotes.createCoupon(randomUUID(),{...base,code:'C-KIND',kind:'AMOUNT'}),{code:'INVALID_COUPON'});
  await assert.rejects(x.quotes.createCoupon(randomUUID(),{...base,code:'C-PCT',kind:'PERCENT_BPS',value:10001}),{code:'INVALID_MONEY'});
  await assert.rejects(x.quotes.createCoupon(randomUUID(),{...base,code:'C-PERIOD',validFrom:base.validUntil}),{code:'INVALID_COUPON'});
  await assert.rejects(x.quotes.createCoupon(randomUUID(),{...base,code:'C-STORE',stores:['NOWHERE']}),{code:'INVALID_COUPON'});
  await assert.rejects(x.quotes.createCoupon('not-a-uuid',{...base,code:'C-ID'}),{code:'INVALID_ID'});
 });
 await check('only PRICE_EDIT admins create or switch; STAFF and VIEWER cannot; staff may list but guests never see codes',async()=>{
  const id=await make({code:'SYNTH-PERM'});const st=await staff('STAFF','coupon-staff@example.invalid'),vw=await staff('VIEWER','coupon-viewer@example.invalid'),mg=await staff('MANAGER','coupon-manager@example.invalid');
  for(const p of [st,vw,mg]){const s=as(p);await assert.rejects(s.createCoupon(randomUUID(),{...base,code:'SYNTH-DENY'}),{code:'FORBIDDEN',status:403});await assert.rejects(s.setCouponActive(id,{active:false}),{code:'FORBIDDEN',status:403});assert.ok(((await s.listCoupons()) as {coupons:{code:string}[]}).coupons.some(c=>c.code==='SYNTH-PERM'));}
  assert.equal((await x.db.pool.query("SELECT count(*)::int n FROM coupon_versions WHERE code='SYNTH-DENY'")).rows[0].n,0);assert.equal(await events(id),1);
  await assert.rejects(as({kind:'GUEST',subject:randomUUID(),contextId:randomUUID(),tokenHash:'0'.repeat(64)}).listCoupons(),{code:'FORBIDDEN',status:403});
  await assert.rejects(as({subject:randomUUID(),role:'ADMIN',storeIds:[],scope:'ALL',permissions:['QUOTE_VIEW','PRICE_EDIT'],revision:1} as StaffPrincipal).listCoupons(),{code:'FORBIDDEN'});
 });
 await check('list shows terms, state and usage newest first; enable/disable is append-only and idempotent',async()=>{
  const id=await make({code:'SYNTH-TOGGLE'});const v1=await x.quotes.setCouponActive(id,{active:true}) as {active:boolean};assert.equal(v1.active,true);assert.equal(await events(id),1);
  const off=await x.quotes.setCouponActive(id,{active:false,reason:'  campaign ended  '}) as {active:boolean;statusReason:string;statusChangedAt:string};assert.equal(off.active,false);assert.equal(off.statusReason,'campaign ended');assert.ok(off.statusChangedAt);assert.equal(await events(id),2);
  await x.quotes.setCouponActive(id,{active:false});assert.equal(await events(id),2);
  const list=(await x.quotes.listCoupons()) as {coupons:{id:string;code:string;active:boolean;terms:CouponTerms;usage:{bookings:number;activeReservations:number}}[]};const mine=list.coupons.find(c=>c.id===id)!;assert.equal(mine.active,false);assert.deepEqual(mine.terms,{...base,code:'SYNTH-TOGGLE'});assert.deepEqual(mine.usage,{bookings:0,activeReservations:0});
  const times=(await x.db.pool.query('SELECT created_at FROM coupon_versions ORDER BY created_at DESC,id')).rows.map(r=>r.created_at.getTime());assert.deepEqual(list.coupons.map(c=>c.id).slice(0,1),[(await x.db.pool.query('SELECT id FROM coupon_versions ORDER BY created_at DESC,id LIMIT 1')).rows[0].id]);assert.ok(times.length>=list.coupons.length);
  const on=await x.quotes.setCouponActive(id,{active:true}) as {active:boolean};assert.equal(on.active,true);assert.equal(await events(id),3);
  await assert.rejects(x.roles.pricingPool.query('UPDATE coupon_status_events SET active=false'),{code:'42501'});await assert.rejects(x.roles.pricingPool.query('DELETE FROM coupon_status_events'),{code:'42501'});
  await assert.rejects(x.quotes.setCouponActive(randomUUID(),{active:false}),{code:'COUPON_NOT_FOUND',status:404});
  await assert.rejects(x.quotes.setCouponActive(id,{active:'no'} as never),{code:'INVALID_INPUT'});await assert.rejects(x.quotes.setCouponActive(id,{active:false,extra:1} as never),{code:'INVALID_INPUT'});await assert.rejects(x.quotes.setCouponActive(id,{active:false,reason:'x'.repeat(161)}),{code:'INVALID_INPUT'});
  const key=randomUUID();await x.quotes.setCouponActive(id,{active:false,reason:'k'},key);assert.equal((await x.quotes.setCouponActive(id,{active:false,reason:'k'},key) as {active:boolean}).active,false);await assert.rejects(x.quotes.setCouponActive(id,{active:true},key),{code:'IDEMPOTENCY_MISMATCH'});await x.quotes.setCouponActive(id,{active:true});
 });
 await check('a disabled coupon is refused by quote create and preview with COUPON_INACTIVE and works again once enabled',async()=>{
  const id=await make({code:'SYNTH-OFF'});await x.quotes.setCouponActive(id,{active:false});const before=await counts();
  await assert.rejects(x.quotes.create(randomUUID(),input('SYNTH-OFF')),{code:'COUPON_INACTIVE',status:409});await assert.rejects(x.quotes.preview(input('SYNTH-OFF')),{code:'COUPON_INACTIVE',status:409});assert.deepEqual(await counts(),before);
  await x.quotes.setCouponActive(id,{active:true});assert.equal((await x.quotes.create(randomUUID(),input('SYNTH-OFF'))).quote.snapshot.couponDiscountJpy,700);
 });
 await check('rules: unknown code, not yet valid, expired, other store, other product, minimum amount',async()=>{
  await assert.rejects(x.quotes.create(randomUUID(),input('NO-SUCH')),{code:'COUPON_NOT_FOUND',status:422});
  await make({code:'SYNTH-FUTURE',validFrom:'2035-01-20T00:00:00.000Z'});await assert.rejects(x.quotes.create(randomUUID(),input('SYNTH-FUTURE')),{code:'COUPON_NOT_APPLICABLE',status:422});
  await make({code:'SYNTH-SHORT',validUntil:'2035-01-15T00:00:00.000Z'});assert.equal((await x.quotes.create(randomUUID(),input('SYNTH-SHORT'))).quote.snapshot.couponDiscountJpy,700);await x.clock('2035-01-16T10:00:00+09:00');await assert.rejects(x.quotes.create(randomUUID(),input('SYNTH-SHORT')),{code:'COUPON_NOT_APPLICABLE'});await assert.rejects(x.quotes.preview(input('SYNTH-SHORT')),{code:'COUPON_NOT_APPLICABLE'});await x.clock('2035-01-01T10:00:00+09:00');
  await make({code:'SYNTH-ONSEN',stores:['ONSEN_BASE']});await assert.rejects(x.quotes.create(randomUUID(),input('SYNTH-ONSEN')),{code:'COUPON_NOT_APPLICABLE'});
  await make({code:'SYNTH-OTHER',products:['SNOWBOARD_SET_ADULT_REGULAR']});await assert.rejects(x.quotes.create(randomUUID(),input('SYNTH-OTHER')),{code:'COUPON_NOT_APPLICABLE'});
  await make({code:'SYNTH-MIN',minimumJpy:7501});await assert.rejects(x.quotes.create(randomUUID(),input('SYNTH-MIN')),{code:'COUPON_NOT_APPLICABLE'});await make({code:'SYNTH-MINOK',minimumJpy:7500});assert.equal((await x.quotes.create(randomUUID(),input('SYNTH-MINOK'))).quote.snapshot.couponDiscountJpy,700);
 });
 await check('amounts: percent, fixed, cap, half-up rounding and a zero-yen total',async()=>{
  const q=async(code:string,adv=false)=>(await x.quotes.create(randomUUID(),input(code,adv))).quote.snapshot as {subtotalJpy:number;couponDiscountJpy:number;advanceDiscountJpy:number;totalJpy:number;zeroTotalPath:string};
  await make({code:'SYNTH-PCT',kind:'PERCENT_BPS',value:1000,maximumDiscountJpy:100000});let s=await q('SYNTH-PCT');assert.deepEqual([s.subtotalJpy,s.couponDiscountJpy,s.totalJpy],[7500,750,6750]);
  await make({code:'SYNTH-CAP',kind:'PERCENT_BPS',value:5000,maximumDiscountJpy:1000});s=await q('SYNTH-CAP');assert.deepEqual([s.couponDiscountJpy,s.totalJpy],[1000,6500]);
  await make({code:'SYNTH-ROUND-A',kind:'PERCENT_BPS',value:3333,maximumDiscountJpy:100000});assert.equal((await q('SYNTH-ROUND-A')).couponDiscountJpy,2500);await make({code:'SYNTH-ROUND-B',kind:'PERCENT_BPS',value:3334,maximumDiscountJpy:100000});assert.equal((await q('SYNTH-ROUND-B')).couponDiscountJpy,2501);
  await make({code:'SYNTH-OVER',value:100000,maximumDiscountJpy:100000});await assert.rejects(q('SYNTH-OVER',true),{code:'COUPON_TOTAL_ZERO',status:422});/* COUPON-ZERO-01: an over-discount that would zero the total is refused, not quoted */
  await make({code:'SYNTH-FIXED',value:300,maximumDiscountJpy:300});s=await q('SYNTH-FIXED');assert.equal(s.totalJpy,7200);
 });
 await check('advance discount combination ALLOW / DENY / UNSET',async()=>{
  await make({code:'SYNTH-ADV-A',advanceCombination:'ALLOW'});const a=(await x.quotes.create(randomUUID(),input('SYNTH-ADV-A',true))).quote.snapshot as {couponDiscountJpy:number;advanceDiscountJpy:number;totalJpy:number};assert.deepEqual([a.couponDiscountJpy,a.advanceDiscountJpy,a.totalJpy],[700,340,6460]);
  await make({code:'SYNTH-ADV-D',advanceCombination:'DENY'});assert.equal((await x.quotes.create(randomUUID(),input('SYNTH-ADV-D',true))).quote.snapshot.advanceDiscountJpy,0);assert.equal((await x.quotes.create(randomUUID(),input('SYNTH-ADV-D',false))).quote.snapshot.totalJpy,6800);
  await make({code:'SYNTH-ADV-U',advanceCombination:'UNSET'});assert.equal((await x.quotes.create(randomUUID(),input('SYNTH-ADV-U',true))).quote.snapshot.advanceDiscountJpy,0);assert.equal((await x.quotes.preview(input('SYNTH-ADV-D',true))).advanceDiscountJpy,0);
 });
 await check('preview with a coupon equals create, is read-only, accepts only holdId null and never trusts client amounts',async()=>{
  await make({code:'SYNTH-PREV',kind:'PERCENT_BPS',value:1000,maximumDiscountJpy:100000});const before=await counts();
  const p=await x.quotes.preview(input('synth-prev',true)) as Record<string,unknown>;assert.deepEqual([p.subtotalJpy,p.couponDiscountJpy,p.advanceDiscountJpy,p.totalJpy],[7500,750,338,6412]);assert.equal(p.advisory,true);assert.deepEqual(p.coupon,{status:'ESTIMATED_NOT_RESERVED',code:'SYNTH-PREV'});
  assert.deepEqual(await counts(),before);const c=(await x.quotes.create(randomUUID(),input('SYNTH-PREV',true))).quote.snapshot;assert.deepEqual([c.subtotalJpy,c.couponDiscountJpy,c.advanceDiscountJpy,c.totalJpy],[p.subtotalJpy,p.couponDiscountJpy,p.advanceDiscountJpy,p.totalJpy]);
  await assert.rejects(x.quotes.preview({...input('SYNTH-PREV'),holdId:randomUUID()}),{code:'INVALID_PREVIEW'});await assert.rejects(x.quotes.preview({...input('SYNTH-PREV'),totalJpy:1}),{code:'INVALID_INPUT'});await assert.rejects(x.quotes.preview(input('bad code!')),{code:'INVALID_COUPON'});
  assert.equal((await x.quotes.preview(input(null)) as {couponDiscountJpy:number}).couponDiscountJpy,0);
 });
 await check('usage cap counts active reservations; a full coupon refuses create and preview, expiry of the reservation frees the slot',async()=>{
  const id=await make({code:'SYNTH-CAP1',maxActiveReservations:1});const first=(await x.quotes.create(randomUUID(),input('SYNTH-CAP1'))).quote,second=(await x.quotes.create(randomUUID(),input('SYNTH-CAP1'))).quote;await x.quotes.reserveCoupon(first.id,randomUUID());
  await assert.rejects(x.quotes.create(randomUUID(),input('SYNTH-CAP1')),{code:'COUPON_LIMIT_REACHED',status:409});await assert.rejects(x.quotes.preview(input('SYNTH-CAP1')),{code:'COUPON_LIMIT_REACHED'});
  const row=((await x.quotes.listCoupons()) as {coupons:{id:string;usage:{activeReservations:number}}[]}).coupons.find(c=>c.id===id)!;assert.equal(row.usage.activeReservations,1);
  await x.quotes.setCouponActive(id,{active:false});await assert.rejects(x.quotes.reserveCoupon(second.id,randomUUID()),{code:'COUPON_INACTIVE'});await x.quotes.setCouponActive(id,{active:true});
  await x.clock('2035-01-01T10:11:30+09:00');assert.equal((await x.quotes.create(randomUUID(),input('SYNTH-CAP1'))).quote.snapshot.couponDiscountJpy,700);await x.clock('2035-01-01T10:00:00+09:00');
 });
 await check('COUPON-ZERO-01: a coupon that leaves nothing to pay is refused at preview and at quote creation with a clear code, creates nothing, and can be removed',async()=>{
  await make({code:'ZERO-FIXED',kind:'FIXED_JPY',value:7500,maximumDiscountJpy:7500,advanceCombination:'ALLOW'});
  await make({code:'ZERO-PCT',kind:'PERCENT_BPS',value:10000,maximumDiscountJpy:7500,advanceCombination:'ALLOW'});
  await make({code:'ONE-YEN',kind:'FIXED_JPY',value:7499,maximumDiscountJpy:7499,advanceCombination:'ALLOW'});
  const before=await counts();
  for(const code of ['ZERO-FIXED','ZERO-PCT'])for(const advance of [false,true]){
   await assert.rejects(x.quotes.preview(input(code,advance)),{code:'COUPON_TOTAL_ZERO',status:422});
   await assert.rejects(x.quotes.create(randomUUID(),input(code,advance)),{code:'COUPON_TOTAL_ZERO',status:422});
  }
  assert.deepEqual(await counts(),before,'no quote and no reservation was created');
  // Removing the coupon re-quotes normally; a coupon that leaves 1 yen is accepted (with and without the advance discount).
  assert.equal((await x.quotes.preview(input(null))).totalJpy,7500);
  for(const advance of [false,true]){const p=await x.quotes.preview(input('ONE-YEN',advance)) as {totalJpy:number;couponDiscountJpy:number};assert.equal(p.totalJpy,1);assert.equal(p.couponDiscountJpy,7499);}
  assert.equal((await x.quotes.create(randomUUID(),input('ONE-YEN',true))).quote.snapshot.totalJpy,1);
 });
 await check('delete hides an unused coupon for good: it stays reserved, cannot be re-enabled or applied, and a repeat is a no-op',async()=>{
  const id=await make({code:'SYNTH-DEL'});const before=await events(id);
  const v=await x.quotes.deleteCoupon(id) as {active:boolean};assert.equal(v.active,false);assert.equal(await events(id),before+1);
  const listed=(await x.quotes.listCoupons() as {coupons:{id:string}[]}).coupons;assert.ok(!listed.some(c=>c.id===id));
  await x.quotes.deleteCoupon(id);assert.equal(await events(id),before+1);
  await assert.rejects(x.quotes.setCouponActive(id,{active:true}),{code:'COUPON_NOT_FOUND'});await assert.rejects(x.quotes.setCouponActive(id,{active:false,reason:'COUPON_DELETED_BY_STAFF'}),{code:'INVALID_INPUT'});
  await assert.rejects(x.quotes.preview(input('SYNTH-DEL')),{code:'COUPON_INACTIVE'});await assert.rejects(x.quotes.createCoupon(randomUUID(),{...base,code:'SYNTH-DEL'}),{code:'COUPON_CODE_EXISTS'});
  const nonAdmin=as(await staff('STAFF','del-staff@example.test'));await assert.rejects(nonAdmin.deleteCoupon(await make({code:'SYNTH-DEL2'})),{status:403});
 });
 console.log(`COUPON admin real PostgreSQL: ${passed} passed; no skipped; synthetic data only.`);
}catch(e){console.error('COUPON_ADMIN_FAILED '+stage+' '+((e as {code?:string}).code??(e as Error).name));if(e instanceof assert.AssertionError)console.error(JSON.stringify({actual:e.actual,expected:e.expected}));console.error((e as Error).stack?.split('\n').slice(0,6).join('\n'));failed=true;}finally{await x.close();console.log('Owned coupon admin PostgreSQL stopped.');}
if(failed)process.exit(1);
