import {test} from 'node:test';
import assert from 'node:assert/strict';
import {INITIAL_TABLE,calculate,parseCoupon,type CouponTerms} from '../../packages/contracts/src/pricing';
import {skiSet} from '../inventory/fixture';
// Exhaustive coupon x advance x wear price matrix. The expected values are derived by an INDEPENDENT hand formula from the
// explicit approved cells below (never by calling calculate / halfUpBps) so a regression in either direction is caught.
// Fixed explicit cells (JPY, one day, adult): SKI_SET_ADULT_REGULAR/DAY_1 = 7,500; WEAR_SET_ADULT/DAY_1 = 5,000 with the 20% set
// bundle = 1,000 off the wear line when the gear is a qualifying set. No tax is added anywhere (taxAddedJpy stays 0; the displayed
// "tax included" wording is the owner-pending basis, so this test asserts NO new tax assumption).
const SKI=7500,WEAR=5000,BUNDLE=1000;
const now=new Date('2033-01-01T00:00:00Z'); // advance cutoff for a 2033-01-03 start is 2033-01-02T06:00Z: still open
const halfUp=(n:number,d:number)=>Math.floor((n*2+d)/(2*d)); // integer round-half-up of n/d for non-negative integers
type Case={kind:'PERCENT_BPS'|'FIXED_JPY';value:number;cap:number;min:number;basis:'CART_SUBTOTAL'|'ELIGIBLE_SUBTOTAL';adv:'ALLOW'|'DENY'|'UNSET';wear:boolean;wearInScope:boolean;wantAdvance:boolean};
function coupon(c:Case):CouponTerms{return parseCoupon({code:'MATRIX',validFrom:'2033-01-01T00:00:00Z',validUntil:'2033-01-02T00:00:00Z',storeBasis:'PICKUP_STORE',stores:['MOUNTAIN_BASE'],products:['SKI_SET_ADULT_REGULAR',...(c.wearInScope?['WEAR_SET_ADULT']:[])],kind:c.kind,value:c.value,minimumJpy:c.min,minimumBasis:c.basis,maximumDiscountJpy:c.cap,advanceCombination:c.adv,maxActiveReservations:null});}
function expected(c:Case){
 const subtotal=SKI+(c.wear?WEAR:0),bundle=c.wear?BUNDLE:0,eligible=SKI+(c.wear&&c.wearInScope?WEAR-BUNDLE:0);
 if((c.basis==='CART_SUBTOTAL'?subtotal:eligible)<c.min)return null;
 const raw=c.kind==='FIXED_JPY'?c.value:halfUp(eligible*c.value,10000);
 const disc=Math.min(eligible,c.cap,raw),after=subtotal-bundle-disc;
 const advanceApplies=c.wantAdvance&&c.adv==='ALLOW',advance=advanceApplies?halfUp(after*500,10000):0;
 return {subtotal,bundle,coupon:disc,advance,total:after-advance,advanceApplies};
}
function run(c:Case){const x={conditions:skiSet('2033-01-03'),holdId:null,couponCode:'MATRIX' as string|null,wantAdvance:c.wantAdvance};if(c.wear)x.conditions.members[0]!.wear=true;return calculate(INITIAL_TABLE,x,now,coupon(c));}
const cases:Case[]=[];
for(const [kind,value,cap] of [['FIXED_JPY',700,700],['FIXED_JPY',700,300],['FIXED_JPY',20000,20000],['PERCENT_BPS',1000,100000],['PERCENT_BPS',1000,500],['PERCENT_BPS',3333,100000],['PERCENT_BPS',3334,100000],['PERCENT_BPS',5000,100000]] as const)
 for(const [min,basis] of [[0,'ELIGIBLE_SUBTOTAL'],[7500,'ELIGIBLE_SUBTOTAL'],[7501,'ELIGIBLE_SUBTOTAL'],[12500,'CART_SUBTOTAL'],[12501,'CART_SUBTOTAL'],[11500,'ELIGIBLE_SUBTOTAL']] as const)
  for(const adv of ['ALLOW','DENY','UNSET'] as const)for(const wear of [false,true])for(const wearInScope of [false,true])for(const wantAdvance of [false,true])
   cases.push({kind,value,cap,min,basis,adv,wear,wearInScope,wantAdvance});
test('coupon price matrix: '+cases.length+' combinations (kind x cap x minimum x advance policy x wear x scope x 5% check) equal the hand-derived totals',()=>{
 let applied=0,refused=0;
 for(const c of cases){
  const want=expected(c),label=JSON.stringify(c);
  if(!want){assert.throws(()=>run(c),{code:'COUPON_NOT_APPLICABLE'},label);refused++;continue;}
  const f=run(c);applied++;
  assert.equal(f.subtotalJpy,want.subtotal,label);assert.equal(f.couponDiscountJpy,want.coupon,label);assert.equal(f.advanceDiscountJpy,want.advance,label);assert.equal(f.totalJpy,want.total,label);
  assert.equal((f as {bundleDiscountJpy?:number}).bundleDiscountJpy??0,want.bundle,label);
  assert.equal(f.taxAddedJpy,0,'no tax is added: '+label);assert.equal(f.advance.status,want.advanceApplies?'ESTIMATED_PAYMENT_NOT_VERIFIED':'NOT_ESTIMATED',label);
  // The sum shown on screen must be the sum of the shown lines: subtotal - wear set discount - coupon - advance.
  assert.equal(f.subtotalJpy-want.bundle-f.couponDiscountJpy-f.advanceDiscountJpy,f.totalJpy,label);
  assert.ok(f.totalJpy>=0&&Number.isInteger(f.totalJpy),label);
 }
 assert.ok(applied>400&&refused>50,'both applied and refused combinations are exercised: '+applied+'/'+refused);
});
test('the 5% advance check never rejects a coupon: with and without it the coupon discount is identical, only a combinable (ALLOW) coupon stacks',()=>{
 for(const adv of ['ALLOW','DENY','UNSET'] as const)for(const wear of [false,true]){
  const base:Case={kind:'PERCENT_BPS',value:1000,cap:100000,min:0,basis:'CART_SUBTOTAL',adv,wear,wearInScope:true,wantAdvance:false};
  const off=run(base),on=run({...base,wantAdvance:true});
  assert.equal(on.couponDiscountJpy,off.couponDiscountJpy,adv+' wear='+wear);
  if(adv==='ALLOW'){assert.ok(on.advanceDiscountJpy>0);assert.ok(on.totalJpy<off.totalJpy);}else{assert.equal(on.advanceDiscountJpy,0);assert.equal(on.totalJpy,off.totalJpy,'DENY/UNSET: the coupon stands alone, the 5% is folded into it, never added on top');}
 }
});
test('wear set discount and coupon combine unconditionally, in the documented order: wear discount first, then coupon on the post-discount eligible amount',()=>{
 const c:Case={kind:'PERCENT_BPS',value:1000,cap:100000,min:0,basis:'ELIGIBLE_SUBTOTAL',adv:'DENY',wear:true,wearInScope:true,wantAdvance:false};
 const f=run(c);assert.equal(f.subtotalJpy,12500);assert.equal((f as {bundleDiscountJpy:number}).bundleDiscountJpy,1000);assert.equal(f.couponDiscountJpy,1150,'10% of (7500 + 5000-1000)');assert.equal(f.totalJpy,10350);
 const narrow=run({...c,wearInScope:false});assert.equal(narrow.couponDiscountJpy,750);assert.equal(narrow.totalJpy,12500-1000-750);
});
