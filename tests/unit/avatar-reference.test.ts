import test from 'node:test';
import assert from 'node:assert/strict';
import {referenceStudy,type ReferenceProfile,type ReferenceOffer} from '../../packages/core/src/avatar/reference';
const profile:ReferenceProfile={key:'one',sport:'SNOWBOARD',heightCm:170,items:null};
const offer:ReferenceOffer={key:'one',candidates:{SHORTER:{lengthCm:145},RECOMMENDED:{lengthCm:150},LONGER:{lengthCm:180}}};
test('ski and snowboard use the saved candidate, common scale and ground baseline',()=>{
 for(const sport of ['SKI','SNOWBOARD'])for(const direction of ['SHORTER','RECOMMENDED','LONGER'] as const){
  const v=referenceStudy({...profile,sport},offer,direction)!;assert.equal(v.sport,sport);assert.equal(v.lengthCm,offer.candidates[direction]!.lengthCm);assert.equal(v.ratio,v.lengthCm!/170);assert.equal(v.ceiling,180/170);
 }
});
test('no board is invented for boots or poles, including combinations',()=>{
 for(const [sport,items] of [['SKI',['SKI_BOOT']],['SKI',['POLE']],['SKI',['SKI_BOOT','POLE']],['SNOWBOARD',['SNOWBOARD_BOOT']]] as const)assert.equal(referenceStudy({...profile,sport,items:[...items]},offer,'RECOMMENDED'),null);
 for(const sport of ['SKI','SNOWBOARD'])assert.ok(referenceStudy({...profile,sport,items:[sport]},offer,'RECOMMENDED'));
});
test('member mismatch, absent candidate and invalid dimensions fail closed without a fallback',()=>{
 assert.equal(referenceStudy({...profile,key:'other'},offer,'RECOMMENDED'),null);
 assert.equal(referenceStudy(undefined,offer,'RECOMMENDED'),null);
 for(const n of [0,-1,NaN,Infinity]){assert.equal(referenceStudy({...profile,heightCm:n},offer,'RECOMMENDED'),null);assert.equal(referenceStudy(profile,{...offer,candidates:{...offer.candidates,RECOMMENDED:{lengthCm:n}}},'RECOMMENDED'),null);}
 assert.equal(referenceStudy(profile,{...offer,candidates:{...offer.candidates,SHORTER:null}},'SHORTER'),null);
});
test('wear has no invented height, length or fit',()=>{
 const value=referenceStudy({...profile,sport:'WEAR',heightCm:null},{...offer,candidates:{RECOMMENDED:{lengthCm:0}}},'RECOMMENDED');
 assert.deepEqual(value,{sport:'WEAR',heightCm:null,lengthCm:null,ratio:null,ceiling:1});
});
test('appearance presentation leaves the saved input and offer unchanged',()=>{
 const before=JSON.stringify({profile,offer});for(const d of ['SHORTER','RECOMMENDED','LONGER'] as const)referenceStudy(profile,offer,d);assert.equal(JSON.stringify({profile,offer}),before);
});
