import test from 'node:test';
import assert from 'node:assert/strict';
import {parseConditions} from '../../packages/contracts/src/hold';
import {parseInput} from '../../packages/contracts/src/ledger';
import {calculate,INITIAL_TABLE,halfUpBps,WEAR_TABLE} from '../../packages/contracts/src/pricing';
const id=(n:number)=>`10000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const item=(family:string,n:number)=>({family,variantIds:[id(n)]});
const period={startDate:'2035-02-01',endDate:'2035-02-01',slot:'DAY'};
const base={contractVersion:'INTEGRATED_V1_2',reservationId:id(90),pickupStore:'MOUNTAIN_BASE',returnStore:'MOUNTAIN_BASE',period};
const wear=(key:string,age='ADULT')=>({key,product:'WEAR_SET',age,tier:'STANDARD',wearSport:'SKI',items:[item('WEAR_JACKET',4),item('WEAR_PANTS',5)]});
const gear=(key:string)=>({key,product:'SKI_SET',age:'ADULT',tier:'REGULAR',wear:true,items:[item('SKI',1),item('SKI_BOOT',2),item('POLE',3),item('WEAR_JACKET',4),item('WEAR_PANTS',5)]});
test('v1.2wear-only contract uses two independent quantity requirements; never one generic WEAR or one part',()=>{const c=parseConditions({...base,members:[wear('a')]});assert.equal(c.members[0]!.items.length,2);for(const items of [[item('WEAR_JACKET',4)],[item('WEAR',4)],[item('WEAR_PANTS',5),item('WEAR_PANTS',5)]])assert.throws(()=>parseConditions({...base,members:[{...wear('a'),items}]}));});
test('wear ledger regular input accepts STANDARD parts with explicit sport compatibility',()=>{const v={modelId:id(1),family:'WEAR_JACKET',age:'ADULT',tier:'STANDARD',size:'M',compatibleSports:['SKI','SNOWBOARD'],notes:'',sourceKind:'SYNTHETIC',sourceDocument:'wear-fixture',sourceLocator:'row1'};assert.equal(parseInput('variants','create',v).family,'WEAR_JACKET');assert.throws(()=>parseInput('variants','create',{...v,tier:'PREMIUM'}));});
test('independent golden same-member wear20percent then advance5percent',()=>{const c=parseConditions({...base,members:[gear('a')]});const q=calculate(INITIAL_TABLE,{conditions:c,holdId:null,couponCode:null,wantAdvance:true},new Date('2035-01-01'),null);assert.equal(q.subtotalJpy,12500);assert.equal(q.totalJpy,10925);assert.equal(q.items.length,2);assert.equal(halfUpBps(110,500),6);});
test('another member never receives equipment wear adjustment',()=>{const g=gear('a');const c=parseConditions({...base,members:[{...g,wear:false,items:g.items.slice(0,3)},wear('b')]});assert.equal(calculate(INITIAL_TABLE,{conditions:c,holdId:null,couponCode:null,wantAdvance:false},new Date('2035-01-01'),null).totalJpy,12500);});
test('integrated Premium board promise required and exact variant selected',()=>{const g=gear('a');const premium={...g,tier:'PREMIUM'};assert.throws(()=>parseConditions({...base,members:[premium]}));const modelPromise={modelId:id(20),season:'2026/27',variantId:id(1)};const c=parseConditions({...base,members:[{...premium,items:[{...item('SKI',1),modelPromise},...premium.items.slice(1)]}]});assert.ok(c);assert.throws(()=>parseConditions({...base,members:[{...premium,items:[{...item('SKI',2),modelPromise},...premium.items.slice(1)]}]}));});

test('quantity override forbids wear Assets and ambiguous multi-variant quantity promises',()=>{assert.throws(()=>parseInput('assets','create',{variantId:id(4),family:'WEAR_JACKET',storeId:'MOUNTAIN_BASE',status:'AVAILABLE',bslStatus:'NOT_APPLICABLE',bslMm:null,bslEvidence:'',notes:'',sourceKind:'SYNTHETIC',sourceDocument:'f',sourceLocator:'1'}));const m=wear('a');m.items[0]!.variantIds=[id(4),id(6)];assert.throws(()=>parseConditions({...base,members:[m]}));});

test('all24 explicit approved wear prices and independent bundle golden cases remain stable',()=>{
 const adult=[3000,3000,5000,9000,12500,15500,18000,20000,22000,23500,25000,26500],kids=[2000,2000,3500,6000,8000,10000,11500,13000,14500,16000,17000,18000];
 assert.deepEqual(Object.values(WEAR_TABLE.WEAR_SET_ADULT!),adult);assert.deepEqual(Object.values(WEAR_TABLE.WEAR_SET_KIDS!),kids);
 for(const [age,slot,days,total] of [['ADULT','DAY',1,10925],['ADULT','PM',1,7600],['ADULT','MULTIDAY',10,65740],['KIDS','DAY',1,6460]] as const){const g=gear('a');const c=parseConditions({...base,period:{startDate:'2035-02-01',endDate:'2035-02-'+String(days).padStart(2,'0'),slot},members:[{...g,age}]});assert.equal(calculate(INITIAL_TABLE,{conditions:c,holdId:null,couponCode:null,wantAdvance:true},new Date('2035-01-01'),null).totalJpy,total);}
});

test('explicit Premium day12350 and wear-only4750 golden preserve discount order',()=>{
 const g=gear('a');const modelPromise={modelId:id(20),season:'2026/27',variantId:id(1)};const c=parseConditions({...base,members:[{...g,tier:'PREMIUM',items:[{...item('SKI',1),modelPromise},...g.items.slice(1)]}]});assert.equal(calculate(INITIAL_TABLE,{conditions:c,holdId:null,couponCode:null,wantAdvance:true},new Date('2035-01-01'),null).totalJpy,12350);
 const w=parseConditions({...base,members:[wear('a')]});assert.equal(calculate(INITIAL_TABLE,{conditions:w,holdId:null,couponCode:null,wantAdvance:true},new Date('2035-01-01'),null).totalJpy,4750);
});
