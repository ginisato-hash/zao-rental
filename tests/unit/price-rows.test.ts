import test from 'node:test';
import assert from 'node:assert/strict';
import {INITIAL_TABLE,WEAR_TABLE} from '../../packages/contracts/src/pricing';
import {PRICE_ROWS,PRICE_DAY_INDEX,priceGrid,dayPrice} from '../../apps/web/src/components/price-rows';

const TABLE={...INITIAL_TABLE,...WEAR_TABLE} as Record<string,Record<string,number>>;

test('public price explorer shows every priced product, cell for cell, from the quote tables',()=>{
 const grid=priceGrid();
 assert.deepEqual(Object.keys(grid).sort(),Object.keys(TABLE).sort(),'every product in the price tables is reachable in the explorer');
 for(const [key,row] of Object.entries(grid))assert.deepEqual(row,PRICE_DAY_INDEX.map(d=>TABLE[key]![d]),key);
});

test('the explorer HALF column stands for both half-day slots (morning and afternoon are priced the same)',()=>{
 for(const [key,row] of Object.entries(TABLE))assert.equal(row.HALF_DAY_AM,row.HALF_DAY_PM,key);
});

test('premium rows exist only for adults and every row names a real product',()=>{
 for(const sport of Object.values(PRICE_ROWS))for(const r of sport.rows){
  if(r.plan==='premium')assert.equal(r.kids,undefined);
  for(const k of [r.adult,r.kids].filter(Boolean))assert.ok(TABLE[k!],k);
 }
 assert.equal(dayPrice('SKI_SET_ADULT_REGULAR'),TABLE.SKI_SET_ADULT_REGULAR!.DAY_1);
});
