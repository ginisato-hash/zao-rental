import assert from 'node:assert/strict';
import test from 'node:test';
import {calculate,durationComponents,INITIAL_TABLE,type QuoteInput} from '../../packages/contracts/src/pricing';
import {boundarySlot,normalizePeriod,newIntakeWindow,parseConditions,type HoldConditions} from '../../packages/contracts/src/hold';
import {bootRange,canonicalSize,compareBootFit,lengthCm} from '../../packages/contracts/src/size';
import {physicalPickupWindow} from '../../packages/contracts/src/pickup';

const now=new Date('2035-01-10T10:00:00+09:00');
function period(startDate:string,endDate:string,startAt:'08:30'|'13:00',returnBy:'12:00'|'17:00'){return {startDate,endDate,slot:boundarySlot(startDate,endDate,startAt,returnBy),startAt,returnBy};}
function input(p:HoldConditions['period'],wear=false,advance=false):QuoteInput{return {conditions:{contractVersion:'INTEGRATED_V1_4',reservationId:'00000000-0000-4000-8000-000000000001',pickupStore:'MOUNTAIN_BASE',returnStore:'MOUNTAIN_BASE',period:p,members:[{key:'a',product:'SKI_SET',age:'ADULT',tier:'REGULAR',...(wear?{wear:true}:{}),items:[{family:'SKI',variantIds:['s']},{family:'SKI_BOOT',variantIds:['b']},{family:'POLE',variantIds:[]},...(wear?[{family:'WEAR_JACKET' as const,variantIds:['j']},{family:'WEAR_PANTS' as const,variantIds:['p']}]:[])]}]},holdId:null,couponCode:null,wantAdvance:advance};}

// SKI_SET_ADULT_REGULAR explicit cells: HALF_DAY_AM/PM 5600, DAY_1 7500, DAY_2 13800, DAY_3 19600.
test('R67 period matrix composes only existing explicit cells (equipment)',()=>{
 for(const [p,parts,total] of [
  [period('2035-02-05','2035-02-05','08:30','12:00'),['HALF_DAY_AM'],5600],
  [period('2035-02-05','2035-02-05','13:00','17:00'),['HALF_DAY_PM'],5600],
  [period('2035-02-05','2035-02-05','08:30','17:00'),['DAY_1'],7500],
  [period('2035-02-05','2035-02-06','08:30','17:00'),['DAY_2'],13800],
  [period('2035-02-05','2035-02-06','13:00','17:00'),['HALF_DAY_PM','DAY_1'],13100],
  [period('2035-02-05','2035-02-06','08:30','12:00'),['DAY_1','HALF_DAY_AM'],13100],
  [period('2035-02-05','2035-02-06','13:00','12:00'),['HALF_DAY_PM','HALF_DAY_AM'],11200],
  [period('2035-02-05','2035-02-07','13:00','12:00'),['HALF_DAY_PM','DAY_1','HALF_DAY_AM'],18700],
  [period('2035-02-05','2035-02-08','13:00','12:00'),['HALF_DAY_PM','DAY_2','HALF_DAY_AM'],25000],
 ] as const){const x=input(p);assert.deepEqual(durationComponents(x.conditions),parts);const q=calculate(INITIAL_TABLE,x,now,null);assert.equal(q.totalJpy,total,parts.join('+'));if(parts.length>1)assert.deepEqual(q.items[0]!.components,parts);else assert.equal(q.items[0]!.components,undefined);}
});
test('R67 wear composes the same cells; the 20% set bundle applies to the composed wear line; advance 5% after the composed subtotal',()=>{
 // WEAR_SET_ADULT: HALF_DAY 3000, DAY_1 5000. 2-day PM/full = 3000+5000=8000 wear, 1600 bundle.
 const q=calculate(INITIAL_TABLE,input(period('2035-02-05','2035-02-06','13:00','17:00'),true),now,null);
 assert.deepEqual(q.items.map(i=>[i.productKey,i.unitJpy,i.bundleDiscountJpy??0]),[['SKI_SET_ADULT_REGULAR',13100,0],['WEAR_SET_ADULT',8000,1600]]);assert.equal(q.totalJpy,13100+8000-1600);
 const a=calculate(INITIAL_TABLE,input(period('2035-02-05','2035-02-06','13:00','12:00'),false,true),now,null);assert.equal(a.subtotalJpy,11200);assert.equal(a.advanceDiscountJpy,560);assert.equal(a.totalJpy,10640);
});
test('R67 V1.4 boundaries: same-day 13:00 start with 12:00 return is rejected; slot is derived, never chosen; times and intake follow the boundaries',()=>{
 assert.throws(()=>boundarySlot('2035-02-05','2035-02-05','13:00','12:00'),{code:'INVALID_PERIOD'});
 assert.throws(()=>normalizePeriod({startDate:'2035-02-05',endDate:'2035-02-05',slot:'DAY',startAt:'13:00',returnBy:'17:00'}),{code:'INVALID_PERIOD'});
 assert.throws(()=>normalizePeriod({startDate:'2035-02-05',endDate:'2035-02-05',slot:'AM',startAt:'08:30'} as never),{code:'INVALID_PERIOD'});
 const n=normalizePeriod(period('2035-02-05','2035-02-07','13:00','12:00'));assert.equal(n.startsAt,'2035-02-05T04:00:00.000Z');assert.equal(n.dueAt,'2035-02-07T03:00:00.000Z');assert.deepEqual(n.dates,['2035-02-05','2035-02-06','2035-02-07'],'every calendar date touched stays protected');
 assert.equal(newIntakeWindow(period('2035-02-05','2035-02-05','08:30','12:00'),now).intakeClosesAt,'2035-02-05T03:00:00.000Z');
 assert.equal(newIntakeWindow(period('2035-02-05','2035-02-06','08:30','12:00'),now).intakeClosesAt,'2035-02-05T08:00:00.000Z');
 assert.equal(physicalPickupWindow(period('2035-02-05','2035-02-07','13:00','12:00'),new Date('2035-02-06T10:00:00+09:00')),true,'multi-day late pickup on day 2');
});
test('R67 V1.4 individual items: unique compatible families of one sport only',()=>{
 const c=(families:string[]):unknown=>({contractVersion:'INTEGRATED_V1_4',reservationId:'00000000-0000-4000-8000-000000000001',pickupStore:'MOUNTAIN_BASE',returnStore:'MOUNTAIN_BASE',period:period('2035-02-05','2035-02-05','08:30','17:00'),members:[{key:'a',product:'SINGLE',age:'ADULT',tier:'REGULAR',items:families.map((family,i)=>({family,variantIds:['00000000-0000-4000-8000-00000000001'+i]}))}]});
 for(const ok of [['SKI','POLE'],['SKI','SKI_BOOT','POLE'],['SKI_BOOT','POLE'],['SNOWBOARD','SNOWBOARD_BOOT'],['POLE']])assert.doesNotThrow(()=>parseConditions(c(ok)));
 for(const bad of [['SKI','SNOWBOARD'],['SKI','SNOWBOARD_BOOT'],['SNOWBOARD','POLE']])assert.throws(()=>parseConditions(c(bad)),{code:'INCOMPLETE_SET'});
 const v13=c(['SKI','POLE']) as {contractVersion:string};v13.contractVersion='INTEGRATED_V1_3';assert.throws(()=>parseConditions(v13),{code:'INCOMPLETE_SET'},'V1.3 SINGLE stays exactly one item');
});
test('R67 canonical sizes and the +1.0 cm boot tie-break',()=>{
 assert.deepEqual([canonicalSize('SNOWBOARD','145'),canonicalSize('SNOWBOARD','145 cm'),canonicalSize('POLE','110'),canonicalSize('SKI_BOOT','25/25.5'),canonicalSize('SKI_BOOT','25.0'),canonicalSize('SNOWBOARD_BOOT','26.5cm'),canonicalSize('WEAR_JACKET','M ')],['145 cm','145 cm','110 cm','25/25.5 cm','25 cm','26.5 cm','M']);
 assert.equal(lengthCm('150.5 cm'),null);assert.equal(bootRange('25/27'),null);assert.equal(bootRange('22X'),null);
 const t=25.0,small=bootRange('24.5')!,large=bootRange('25.5')!,shell=bootRange('25/25.5')!;
 assert.ok(compareBootFit(large,small,t)<0,'equal distance: never the smaller boot');assert.ok(compareBootFit(shell,large,t)<0,'a shell containing the target wins');
});
