import {test} from 'node:test';
import assert from 'node:assert/strict';
import {INITIAL_TABLE,calculate,parseCoupon,advanceCutoff} from '../../packages/contracts/src/pricing';
import {couponAdvanceFolded} from '../../apps/web/src/components/guest-format';
import {skiSet} from '../inventory/fixture';
// The on-screen note "this coupon cannot be combined with the 5% advance discount" (GuestBooking, data-testid coupon-advance-folded)
// must appear exactly when the server folded the 5% into a non-combinable coupon, and the totals beside it must be the server's.
const terms=(over:Record<string,unknown>)=>parseCoupon({code:'HINT',validFrom:'2033-01-01T00:00:00Z',validUntil:'2033-01-05T00:00:00Z',storeBasis:'PICKUP_STORE',stores:['MOUNTAIN_BASE'],products:['SKI_SET_ADULT_REGULAR'],kind:'PERCENT_BPS',value:1000,minimumJpy:0,minimumBasis:'CART_SUBTOTAL',maximumDiscountJpy:100000,advanceCombination:'UNSET',maxActiveReservations:null,...over});
const quote=(over:Record<string,unknown>,now:Date,wantAdvance=true)=>calculate(INITIAL_TABLE,{conditions:skiSet('2033-01-03'),holdId:null,couponCode:'HINT',wantAdvance},now,terms(over));
const open=new Date('2033-01-01T00:00:00Z'),late=new Date('2033-01-02T07:00:00Z'); // cutoff is 2033-01-02T06:00Z
test('the note follows the policy the server applied: DENY and UNSET fold, ALLOW never does',()=>{
 for(const [adv,folded] of [['DENY',true],['UNSET',true],['ALLOW',false]] as const){const f=quote({advanceCombination:adv},open);assert.equal(couponAdvanceFolded(true,true,f,open.getTime()),folded,adv);assert.equal(f.totalJpy,adv==='ALLOW'?6412:6750,'server total beside the note: '+adv);}
});
test('no note without the 5% check or without an applied coupon',()=>{const f=quote({advanceCombination:'DENY'},open);assert.equal(couponAdvanceFolded(false,true,f,open.getTime()),false);assert.equal(couponAdvanceFolded(true,false,f,open.getTime()),false);assert.equal(couponAdvanceFolded(true,true,null,open.getTime()),false);});
test('REGRESSION: after the previous-day 15:00 cutoff the 5% is dropped for every coupon; a combinable coupon must not be blamed',()=>{
 assert.ok(late>advanceCutoff('2033-01-03'));
 const f=quote({advanceCombination:'ALLOW'},late);assert.equal(f.advanceDiscountJpy,0);assert.equal(f.totalJpy,6750);
 // The previous screen condition (advance checked && coupon applied && advanceDiscountJpy===0) showed the "cannot be combined" note here.
 assert.equal(!f.advanceDiscountJpy,true,'legacy condition is true: wrong note for an ALLOW coupon');
 assert.equal(couponAdvanceFolded(true,true,f,late.getTime()),false);
 // A non-combinable coupon after the cutoff: the reason is the cutoff too, so no coupon-specific note either (browser clock after cutoff).
 assert.equal(couponAdvanceFolded(true,true,quote({advanceCombination:'DENY'},late),late.getTime()),false);
});
test('REGRESSION: a combinable coupon that leaves a few yen cannot be blamed when 5% rounds to 0 yen',()=>{
 const f=quote({advanceCombination:'ALLOW',kind:'FIXED_JPY',value:7491,maximumDiscountJpy:7491},open);assert.equal(f.totalJpy,9);assert.equal(f.advanceDiscountJpy,0,'5% of 9 yen rounds to 0');assert.equal(f.advance.status,'ESTIMATED_PAYMENT_NOT_VERIFIED');
 assert.equal(couponAdvanceFolded(true,true,f,open.getTime()),false);
});
