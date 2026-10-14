import test from 'node:test';
import assert from 'node:assert/strict';
import {INITIAL_TABLE,WEAR_TABLE,calculate,parseQuote} from '../../packages/contracts/src/pricing';
import {skiSet,variants} from '../inventory/fixture';
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

test('all 20 display products × 11 columns agree with independently constructed quote inputs',()=>{
 const grid=priceGrid();let cells=0;
 for(const key of Object.keys(TABLE))for(let column=0;column<11;column++){
  const conditions=skiSet('2035-02-01'),member=conditions.members[0]!,sport=key.startsWith('SNOWBOARD')?'SNOWBOARD':'SKI';
  member.age=key.includes('KIDS')?'KIDS':'ADULT';
  member.tier=key.startsWith('WEAR')?'STANDARD':key.endsWith('PREMIUM')?'PREMIUM':'REGULAR';
  member.product=key.startsWith('WEAR')?'WEAR_SET':key.includes('_SET_')?(sport==='SKI'?'SKI_SET':'SNOWBOARD_SET'):'SINGLE';
  const families=member.product==='WEAR_SET'?['WEAR_JACKET','WEAR_PANTS']:member.product==='SKI_SET'?['SKI','SKI_BOOT','POLE']:member.product==='SNOWBOARD_SET'?['SNOWBOARD','SNOWBOARD_BOOT']:[key.includes('EQUIPMENT_ONLY')?sport:key.includes('BOOTS_ONLY')?sport+'_BOOT':'POLE'];
  member.items=families.map(family=>({family:family as typeof member.items[number]['family'],variantIds:[variants.ski]}));
  if(member.product==='WEAR_SET'){conditions.contractVersion='INTEGRATED_V1_2';member.wearSport='SKI';}
  conditions.period={startDate:'2035-02-01',endDate:'2035-02-'+String(Math.max(1,column)).padStart(2,'0'),slot:column===0?'AM':column===1?'DAY':'MULTIDAY'};
  const quote=calculate(INITIAL_TABLE,parseQuote({conditions,holdId:null,couponCode:null,wantAdvance:false}),new Date('2035-01-01T00:00:00Z'),null);
  assert.equal(quote.items[0]!.productKey,key);
  assert.equal(grid[key]![column],quote.totalJpy,key+' column '+column);cells++;
 }
 assert.equal(cells,220);
});
