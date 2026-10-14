import test from 'node:test';
import assert from 'node:assert/strict';
import {buildMembers,parseRecommendation,type Profile,type Variant} from '../../packages/contracts/src/recommendation';
import {parseConditions,type HoldConditions} from '../../packages/contracts/src/hold';
import {productKey} from '../../packages/contracts/src/pricing';
const id=(n:number)=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const p:Profile={key:'person-1',sport:'SKI',heightCm:170,footCm:25.5,adultAtStart:true,tier:'REGULAR',ski:{weightKg:60,ageAtStart:30,level:'BEGINNER'}};
const variants:Variant[]=[{id:id(1),family:'SKI',age:'ADULT',tier:'REGULAR',size:'150 cm'},{id:id(2),family:'SKI_BOOT',age:'ADULT',tier:'REGULAR',size:'26.5 cm'},{id:id(3),family:'SNOWBOARD',age:'ADULT',tier:'REGULAR',size:'150 cm'},{id:id(4),family:'SNOWBOARD_BOOT',age:'ADULT',tier:'REGULAR',size:'26.5 cm'}];
const envelope={pickupStore:'MOUNTAIN_BASE',returnStore:'MOUNTAIN_BASE',period:{startDate:'2035-02-01',endDate:'2035-02-01',slot:'DAY'}};
test('V1.3 needs no customer pole variant; old V1.2 still needs its saved explicit pole',()=>{
 assert.equal(parseRecommendation({...envelope,contractVersion:'INTEGRATED_V1_3',members:[p]}).members[0]?.poleVariantId,undefined);
 assert.throws(()=>parseRecommendation({...envelope,contractVersion:'INTEGRATED_V1_2',members:[p]}));
 assert.equal(parseRecommendation({...envelope,contractVersion:'INTEGRATED_V1_2',members:[{...p,poleVariantId:id(5)}]}).members[0]?.poleVariantId,id(5));
 for(const extra of [{poleVariantId:id(5)},{poleSelectedCm:120},{din:4.5},{bslMm:304}])assert.throws(()=>parseRecommendation({...envelope,contractVersion:'INTEGRATED_V1_3',members:[{...p,...extra}]}));
});
test('no pole catalogue preserves structural ski set; non-pole and legacy empty variants reject',()=>{
 const built=buildMembers(p,variants,'INTEGRATED_V1_3'),member=built.candidates[0]!.member;
 assert.deepEqual(member.items.find(i=>i.family==='POLE')?.variantIds,[]);
 const c={...envelope,reservationId:id(99),contractVersion:'INTEGRATED_V1_3',members:[member]};assert.equal(parseConditions(c).members.length,1);
 assert.throws(()=>parseConditions({...c,contractVersion:'INTEGRATED_V1_2'}));
 const bad=structuredClone(c);bad.members[0]!.items[0]!.variantIds=[];assert.throws(()=>parseConditions(bad));
});
test('server suggests known nearest pole deterministically and ignores input from no other source',()=>{
 const poles=[{id:id(5),family:'POLE',age:'ADULT',tier:'REGULAR',size:'110 cm'},{id:id(6),family:'POLE',age:'ADULT',tier:'REGULAR',size:'120 cm'}];
 assert.deepEqual(buildMembers(p,[...variants,...poles],'INTEGRATED_V1_3').candidates[0]?.member.items.find(i=>i.family==='POLE')?.variantIds,[id(6)]);
});
test('five nested individual choices reuse existing price product keys without demanding set companions',()=>{
 const expected={SKI:'SKI_EQUIPMENT_ONLY_ADULT_REGULAR',SKI_BOOT:'SKI_BOOTS_ONLY_ADULT_STANDARD',SNOWBOARD:'SNOWBOARD_EQUIPMENT_ONLY_ADULT_REGULAR',SNOWBOARD_BOOT:'SNOWBOARD_BOOTS_ONLY_ADULT_STANDARD',POLE:'SKI_POLES_ONLY_ADULT_STANDARD'};
 for(const itemFamily of Object.keys(expected) as (keyof typeof expected)[]){const snowboard=itemFamily.startsWith('SNOWBOARD'),member={...p,itemFamily,sport:snowboard?'SNOWBOARD' as const:'SKI' as const,heightCm:itemFamily.endsWith('_BOOT')?null:170,footCm:itemFamily.endsWith('_BOOT')?25.5:null,ski:itemFamily==='SKI'?p.ski:null};
  parseRecommendation({...envelope,contractVersion:'INTEGRATED_V1_3',members:[member]});
  const built=buildMembers(member,[...variants,{id:id(5),family:'POLE',age:'ADULT',tier:'REGULAR',size:'120 cm'}].filter(v=>v.family===itemFamily),'INTEGRATED_V1_3');assert.equal(built.candidates.length,1,itemFamily);const hold=built.candidates[0]!.member;
  assert.equal(hold.product,'SINGLE');assert.equal(hold.items.length,1);assert.equal(productKey(hold),expected[itemFamily]);
  parseConditions({...envelope,contractVersion:'INTEGRATED_V1_3',reservationId:id(99),members:[hold]});
 }
});
test('Premium snowboard carries real model-season-exact variant promise and no invented model substitution',()=>{
 const premium:Profile={...p,sport:'SNOWBOARD',ski:null,tier:'PREMIUM',modelSelection:{modelId:id(10),season:'2026/27'}};
 const catalog:Variant[]=[{...variants[2]!,tier:'PREMIUM',model_id:id(10),catalog_season:'2026/27'},{...variants[3]!,tier:'PREMIUM'}];
 const member=buildMembers(premium,catalog,'INTEGRATED_V1_3').candidates[0]!.member;
 assert.equal(productKey(member),'SNOWBOARD_SET_ADULT_PREMIUM');assert.deepEqual(member.items[0]?.modelPromise,{modelId:id(10),season:'2026/27',variantId:id(3)});
 const single=buildMembers({...premium,itemFamily:'SNOWBOARD'},catalog,'INTEGRATED_V1_3').candidates[0]!.member;assert.equal(productKey(single),'SNOWBOARD_EQUIPMENT_ONLY_ADULT_PREMIUM');
 assert.equal(buildMembers({...premium,modelSelection:{modelId:id(11),season:'2026/27'}},catalog,'INTEGRATED_V1_3').candidates.length,0);
 for(const tier of ['PREMIUM','STANDARD'])assert.throws(()=>parseRecommendation({...envelope,contractVersion:'INTEGRATED_V1_3',members:[{...p,itemFamily:'SKI_BOOT',tier}]}));
 const c={...envelope,reservationId:id(99),contractVersion:'INTEGRATED_V1_3',members:[member]} as HoldConditions;parseConditions(c);
});

test('V1.3 individual field matrix: only the inputs the item needs; unused fields must be null',()=>{
 for(const itemFamily of ['SKI','SKI_BOOT','POLE','SNOWBOARD','SNOWBOARD_BOOT'] as const){
  const member:Profile={...p,itemFamily,sport:itemFamily.startsWith('SNOWBOARD')?'SNOWBOARD':'SKI',heightCm:itemFamily.endsWith('_BOOT')?null:170,footCm:itemFamily.endsWith('_BOOT')?25.5:null,ski:itemFamily==='SKI'?p.ski:null};
  const parse=(m:Profile)=>parseRecommendation({...envelope,contractVersion:'INTEGRATED_V1_3',members:[m]});assert.deepEqual(parse(member).members[0],member);
  for(const key of ['heightCm','footCm','ski'] as const){const bad={...member,[key]:member[key]===null?p[key]:null};assert.throws(()=>parse(bad),itemFamily+' '+key);}
 }
});
test('whole kg V1.3 policy accepts 60, rejects 60.5, preserves historical V1.2 decimals',()=>{
 const parse=(version:string,weightKg:number)=>parseRecommendation({...envelope,contractVersion:version,members:[{...p,ski:{...p.ski!,weightKg},poleVariantId:version==='INTEGRATED_V1_2'?id(5):null}]});
 assert.equal(parse('INTEGRATED_V1_3',60).members[0]?.ski?.weightKg,60);
 assert.throws(()=>parse('INTEGRATED_V1_3',60.5),{code:'INVALID_RECOMMENDATION_INPUT'});
 assert.equal(parse('INTEGRATED_V1_2',60.5).members[0]?.ski?.weightKg,60.5);
});
test('standalone pole cannot use an empty variant or a nonexistent catalogue candidate',()=>{
 const member:Profile={...p,itemFamily:'POLE',footCm:null,ski:null};
 assert.equal(buildMembers(member,variants,'INTEGRATED_V1_3').candidates.length,0);
 const single={key:'person-1',product:'SINGLE',age:'ADULT',tier:'REGULAR',items:[{family:'POLE',variantIds:[]}]};
 for(const contractVersion of ['INTEGRATED_V1_2','INTEGRATED_V1_3'])assert.throws(()=>parseConditions({...envelope,reservationId:id(99),contractVersion,members:[single]}),{code:'INVALID_CONDITIONS'});
});
