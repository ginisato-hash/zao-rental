import test from 'node:test';
import assert from 'node:assert/strict';
import {parseConditions} from '../../packages/contracts/src/hold';
import {productKey,calculate,INITIAL_TABLE} from '../../packages/contracts/src/pricing';
const id=(n:number)=>`10000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const piece=(family:string,n:number)=>({family,variantIds:[id(n)]});
test('WEAR-PRICE-01: SINGLE pole plus wear uses the pole price regardless of item order',()=>{
 const orders=[[piece('WEAR_JACKET',4),piece('WEAR_PANTS',5),piece('POLE',3)],[piece('POLE',3),piece('WEAR_JACKET',4),piece('WEAR_PANTS',5)]];
 const outputs=orders.map(items=>{const c=parseConditions({contractVersion:'INTEGRATED_V1_2',reservationId:id(90),pickupStore:'MOUNTAIN_BASE',returnStore:'MOUNTAIN_BASE',period:{startDate:'2035-02-01',endDate:'2035-02-01',slot:'DAY'},members:[{key:'one',product:'SINGLE',age:'ADULT',tier:'REGULAR',wear:true,items}]});
 assert.equal(productKey(c.members[0]!),'SKI_POLES_ONLY_ADULT_STANDARD');return calculate(INITIAL_TABLE,{conditions:c,holdId:null,couponCode:null,wantAdvance:false},new Date('2035-01-01'),null);});
 assert.deepEqual(outputs[0],outputs[1]);assert.equal(outputs[0]!.items[0]!.unitJpy,1500);assert.equal(outputs[0]!.bundleDiscountJpy,0);assert.equal(outputs[0]!.totalJpy,6500);
});
