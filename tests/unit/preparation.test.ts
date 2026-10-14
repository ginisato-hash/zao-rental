import test from 'node:test';
import assert from 'node:assert/strict';
import {dinAdvisory,DIN_REFERENCE,type DinInput} from '../../packages/contracts/src/din';
import {suggestPole} from '../../packages/contracts/src/pole';
import {preparationMembers,recordPreparation,preparationStillValid,type PreparationItem,type PreparationInput} from '../../packages/contracts/src/preparation';
import type {Profile} from '../../packages/contracts/src/recommendation';
import type {HoldConditions} from '../../packages/contracts/src/hold';
const base:DinInput={heightCm:170,weightKg:60,ageAtStart:30,level:'BEGINNER',bslMm:304};
test('published version provenance and independent Salomon-linked ISOSKI observations',()=>{
 assert.equal(DIN_REFERENCE.version,'USC_2022_INITIAL_V1');assert.match(DIN_REFERENCE.sha256,/^[0-9a-f]{64}$/);
 for(const [patch,value] of [[{},4.5],[{bslMm:314},4],[{bslMm:314,level:'INTERMEDIATE'},5],[{bslMm:314,level:'ADVANCED'},6],[{bslMm:314,level:'ADVANCED',ageAtStart:50},5]] as const)assert.equal(dinAdvisory({...base,...patch}).value,value);
});
test('each actual BSL column boundary, no interpolation across cells',()=>{
 const expected=[[230,null],[231,null],[250,null],[251,5.5],[270,5.5],[271,5],[290,5],[291,4.5],[310,4.5],[311,4],[330,4],[331,3.5],[350,3.5],[351,3],[450,3]];
 for(const [bslMm,value] of expected)assert.equal(dinAdvisory({...base,bslMm:bslMm!}).value,value,String(bslMm));
});
test('weight, height, skill and age boundaries follow the source, not foot size',()=>{
 assert.equal(dinAdvisory({...base,weightKg:57}).value,3.5);assert.equal(dinAdvisory({...base,weightKg:58}).value,4.5);
 assert.equal(dinAdvisory({...base,weightKg:75,heightCm:148}).value,3);assert.equal(dinAdvisory({...base,weightKg:75,heightCm:149}).value,3.5);
 assert.equal(dinAdvisory({...base,weightKg:35,heightCm:130,ageAtStart:10,bslMm:320}).value,1.5);
 assert.equal(dinAdvisory({...base,weightKg:35,heightCm:130,ageAtStart:11,bslMm:320}).value,1.75);
 assert.equal(dinAdvisory({...base,ageAtStart:49}).value,4.5);assert.equal(dinAdvisory({...base,ageAtStart:50}).value,3.5);
});
test('missing, nonfinite, blank and out-of-table inputs fail closed',()=>{
 assert.equal(dinAdvisory(null).value,null);
 for(const patch of [{bslMm:0},{bslMm:304.5},{bslMm:NaN},{bslMm:Infinity},{bslMm:149},{bslMm:451},{weightKg:9},{weightKg:57.5},{weightKg:13,ageAtStart:10,bslMm:200},{heightCm:49},{ageAtStart:30.5}])assert.equal(dinAdvisory({...base,...patch}).value,null,JSON.stringify(patch));
 assert.equal(dinAdvisory({...base,weightKg:60.25}).value,4.5);
});
test('pole advisory uses real size nearest to height x 0.7, shorter tie and no-inventory 5cm rounding',()=>{
 assert.equal(suggestPole(170),120);assert.equal(suggestPole(170,[110,125]),125);assert.equal(suggestPole(150,[110,100]),100);assert.equal(suggestPole(150,[100,110,100]),100);assert.equal(suggestPole(NaN),null);
});
const profile:Profile={key:'a',sport:'SKI',heightCm:170,footCm:25.5,adultAtStart:true,tier:'REGULAR',ski:{weightKg:60,ageAtStart:30,level:'BEGINNER'},poleVariantId:null};
const conditions:HoldConditions={contractVersion:'INTEGRATED_V1_3',reservationId:'booking',pickupStore:'MOUNTAIN_BASE',returnStore:'MOUNTAIN_BASE',period:{startDate:'2035-01-01',endDate:'2035-01-01',slot:'DAY'},members:[{key:'a',product:'SKI_SET',age:'ADULT',tier:'REGULAR',items:[{family:'SKI',variantIds:['ski']},{family:'SKI_BOOT',variantIds:['boot']},{family:'POLE',variantIds:[]}]}]};
const item:PreparationItem={requirement_key:'a:SKI_BOOT',asset_id:'actual-boot-A',pole_id:null,variant_id:'boot',family:'SKI_BOOT',size:'26.5 cm',name:'actual boot',catalog_season:null,bsl_status:'RECORDED',bsl_mm:304};
const plan=(items=[item],p=profile)=>preparationMembers(conditions,[p],items,[],[]);
const input=(bslMm:number|null=304):PreparationInput=>({version:'ZAO_PREP_V2',members:[{memberKey:'a',bootAssetId:'actual-boot-A',bslMm,ownBootConfirmed:false,equipmentConfirmed:true,bindingCompatibilityConfirmed:true,bindingSetupConfirmed:true,poleSelectedCm:120,wearPrepared:false}]});
test('assigned asset BSL is authoritative and foot size/model never determines it',()=>{
 assert.equal(plan()[0]!.din?.value,4.5);assert.equal(plan([item],{...profile,footCm:29})[0]!.bslMm,304);
 assert.equal(plan([{...item,asset_id:'actual-boot-B',bsl_mm:314}])[0]!.din?.value,4);
 assert.equal(plan([{...item,bsl_status:'UNVERIFIED',bsl_mm:null}])[0]!.bslMm,null);
 assert.throws(()=>recordPreparation(input(314),plan(),'staff','2035-01-01T00:00:00Z',[]),{code:'ASSET_BSL_CHANGED'});
});
test('structured evidence records server staff/time and source; no client DIN or audit authority',()=>{
 const selections=[{requirementKey:item.requirement_key,assetId:item.asset_id,poleId:null}];
 const saved=recordPreparation(input(),plan(),'staff-verified','2035-01-01T00:00:00Z',selections);
 assert.equal(saved.members[0]!.confirmedBy,'staff-verified');assert.equal(saved.members[0]!.confirmedAt,'2035-01-01T00:00:00Z');assert.equal(saved.members[0]!.bslSource,'ASSET');assert.equal(saved.members[0]!.dinReferenceValue,4.5);assert.equal(saved.members[0]!.dinReferenceVersion,DIN_REFERENCE.version);
 assert.equal(preparationStillValid(saved,[item]),true);
 assert.equal(preparationStillValid(saved,[{...item,asset_id:'actual-boot-B'}]),false);assert.equal(preparationStillValid(saved,[{...item,bsl_mm:314}]),false);
 const forged=input();Object.assign(forged.members[0]!,{dinReferenceValue:9,confirmedBy:'forged'});assert.throws(()=>recordPreparation(forged,plan(),'server','time',selections));
});
test('physical observation is tied to this boot only; missing BSL and separate safety checks block ready',()=>{
 const unknown={...item,bsl_status:'UNVERIFIED',bsl_mm:null},members=plan([unknown]);
 assert.throws(()=>recordPreparation(input(null),members,'staff','time',[]),{code:'ACTUAL_BSL_REQUIRED'});
 const recorded=recordPreparation(input(314),members,'staff','time',[]);assert.equal(recorded.members[0]!.bslSource,'PHYSICAL_OBSERVATION');assert.equal(recorded.members[0]!.dinReferenceValue,4);
 for(const field of ['equipmentConfirmed','bindingCompatibilityConfirmed','bindingSetupConfirmed'] as const){const v=input();v.members[0]![field]=false;assert.throws(()=>recordPreparation(v,plan(),'staff','time',[]));}
 const override=input();override.members[0]!.poleSelectedCm=115;assert.equal(recordPreparation(override,plan(),'staff','time',[]).members[0]!.poleSelectedCm,115);
 assert.throws(()=>recordPreparation('old free-text record',plan(),'staff','time',[]),{code:'STRUCTURED_PREPARATION_REQUIRED'});
});
test('snowboard has no BSL/DIN requirements and does not accept spurious BSL',()=>{
 const c=structuredClone(conditions);c.members[0]!.product='SNOWBOARD_SET';c.members[0]!.items=[{family:'SNOWBOARD',variantIds:['b']},{family:'SNOWBOARD_BOOT',variantIds:['bb']}];
 const members=preparationMembers(c,[{...profile,sport:'SNOWBOARD',ski:null}],[],[],[]),v=input(null);Object.assign(v.members[0]!,{bootAssetId:null,bindingCompatibilityConfirmed:false,bindingSetupConfirmed:false,poleSelectedCm:null});
 const saved=recordPreparation(v,members,'staff','time',[]);assert.equal(saved.members[0]!.dinReferenceValue,null);assert.equal(saved.members[0]!.dinReferenceVersion,null);
 v.members[0]!.bslMm=304;assert.throws(()=>recordPreparation(v,members,'staff','time',[]),{code:'UNEXPECTED_BSL'});
});

test('a tracked pole override must match the actual assigned pool; untracked physical override remains allowed',()=>{
 const pole={...item,requirement_key:'a:POLE',asset_id:null,pole_id:'pool',family:'POLE',size:'110 cm',bsl_status:null,bsl_mm:null};
 assert.throws(()=>recordPreparation(input(),plan([item,pole]),'staff','time',[]),{code:'POLE_ASSIGNMENT_CHANGED'});
 const v=input();v.members[0]!.poleSelectedCm=110;assert.equal(recordPreparation(v,plan([item,pole]),'staff','time',[]).members[0]!.poleSelectedCm,110);
});

test('wear, product and period amendments invalidate the earlier preparation even if boot assignment is unchanged',()=>{
 const saved=recordPreparation(input(),plan(),'staff','time',[{requirementKey:item.requirement_key,assetId:item.asset_id,poleId:null}],conditions);
 assert.equal(preparationStillValid(saved,[item],conditions),true);
 const changed=structuredClone(conditions);changed.members[0]!.wear=true;changed.members[0]!.items.push({family:'WEAR_JACKET',variantIds:['new-jacket']},{family:'WEAR_PANTS',variantIds:['new-pants']});
 assert.equal(preparationStillValid(saved,[item],changed),false);
});

test('ski boots only may be ready with unknown BSL, without DIN or ski body data',()=>{
 const c=structuredClone(conditions);c.members[0]!.product='SINGLE';c.members[0]!.items=[{family:'SKI_BOOT',variantIds:['boot']}];
 const boot={...item,bsl_status:'UNVERIFIED',bsl_mm:null},members=preparationMembers(c,[{...profile,itemFamily:'SKI_BOOT',heightCm:null,ski:null}],[boot],[],[]),v=input(null);
 Object.assign(v.members[0]!,{bindingCompatibilityConfirmed:false,bindingSetupConfirmed:false,poleSelectedCm:null});
 const saved=recordPreparation(v,members,'staff','time',[]);assert.equal(saved.members[0]!.bslMm,null);assert.equal(saved.members[0]!.bslSource,null);assert.equal(saved.members[0]!.dinReferenceValue,null);assert.equal(members[0]!.needsBinding,false);
 v.members[0]!.equipmentConfirmed=false;assert.throws(()=>recordPreparation(v,members,'staff','time',[]),{code:'PHYSICAL_CONFIRMATION_REQUIRED'});
});
