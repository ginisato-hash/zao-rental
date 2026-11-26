import test from 'node:test';
import assert from 'node:assert/strict';
import {buildMembers,bootOptions,rankCandidates,parseRecommendation,RECOMMENDATION_RULE,type Profile,type Variant} from '../../packages/contracts/src/recommendation';
import {partFit,poleFit,combineFit,normalFit,SUPPORTED_RECOMMENDATION_RULES,RECOMMENDATION_RULE_V1,RECOMMENDATION_RULE_V2,MANUAL_FIT_LIMIT_CM} from '../../packages/contracts/src/size-edge';
import {dinAdvisory} from '../../packages/contracts/src/din';
const v=(id:string,family:string,size:string,age='ADULT',tier='REGULAR'):Variant=>({id,family,size,age,tier});
const board:Profile={key:'a',sport:'SNOWBOARD',heightCm:170,footCm:25.5,adultAtStart:true,tier:'REGULAR',ski:null,poleVariantId:null};
const catalog=[v('boot','SNOWBOARD_BOOT','26.5 cm'),v('b145','SNOWBOARD','145 cm'),v('b150','SNOWBOARD','150 cm'),v('b155','SNOWBOARD','155 cm')];
test('SIZE-EDGE rule versions: V2 is current, V1 stays supported and distinct', () => {
 assert.equal(RECOMMENDATION_RULE,RECOMMENDATION_RULE_V2);
 assert.deepEqual([...SUPPORTED_RECOMMENDATION_RULES],[RECOMMENDATION_RULE_V1,RECOMMENDATION_RULE_V2]);
 assert.match(RECOMMENDATION_RULE_V2,/EDGE_V2$/);
});
test('normal route is byte-identical with or without the edge flag when the window has candidates', () => {
 const a=buildMembers(board,catalog),b=buildMembers(board,catalog,undefined,0,true);
 assert.deepEqual(b,a);
 assert.ok(a.candidates.every(c=>!('fit' in c)));
});
test('edge route only runs for an empty window: out-of-window boards become candidates nearest first, tie shorter', () => {
 const tall={...board,heightCm:195};// target 175, window 160..190, catalog max 155
 assert.equal(buildMembers(tall,catalog).reason,'NO_CATALOG_LENGTH');
 const e=buildMembers(tall,catalog,undefined,0,true);
 assert.deepEqual(e.candidates.map(c=>c.lengthCm),[155,150,145]);
 assert.equal(e.candidates[0]!.fit!.kind,'EDGE_ABOVE');
 assert.equal(e.candidates[1]!.fit!.kind,'NEAREST_AVAILABLE');
 assert.equal(e.candidates[0]!.fit!.requiresStoreConfirmation,true);
 const part=e.candidates[0]!.fit!.parts.find(p=>p.family==='SNOWBOARD')!;
 assert.deepEqual({t:part.targetCm,d:part.diffCm,lo:part.handledLoCm,hi:part.handledHiCm},{t:175,d:-20,lo:145,hi:155});
 const short={...board,heightCm:120};// target 100, window 85..115, catalog min 145
 const s=buildMembers(short,catalog,undefined,0,true);
 assert.equal(s.candidates[0]!.lengthCm,145);assert.equal(s.candidates[0]!.fit!.parts[0]!.diffCm,45);
 assert.equal(s.candidates[0]!.fit!.kind,'MANUAL_FIT_REQUIRED');// 45 cm is beyond the 30 cm auto-fit limit
 const mid=buildMembers({...board,heightCm:140},catalog,undefined,0,true);// target 120 -> 25 cm below the smallest
 assert.equal(mid.candidates[0]!.lengthCm,145);assert.equal(mid.candidates[0]!.fit!.kind,'EDGE_BELOW');
});
test('far beyond the auto-fit limit the candidate is MANUAL_FIT_REQUIRED, never silently normal', () => {
 const huge=buildMembers({...board,heightCm:230},catalog,undefined,0,true);// target 210, diff 55
 assert.ok(huge.candidates.every(c=>c.fit!.kind==='MANUAL_FIT_REQUIRED'));
 assert.equal(huge.candidates[0]!.fit!.parts[0]!.reason,'EXCEEDS_AUTO_FIT_LIMIT');
});
test('boot edge: shared-shell distance order, equal distance prefers the larger, no cap only on the edge route', () => {
 const boots=[v('s1','SKI_BOOT','25/25.5 cm'),v('s2','SKI_BOOT','26/26.5 cm'),v('s3','SKI_BOOT','27/27.5 cm')];
 assert.equal(bootOptions(boots,'SKI_BOOT',30.0).length,0);// normal cap 1.0 cm unchanged
 const all=bootOptions(boots,'SKI_BOOT',30.0,Infinity);
 assert.deepEqual(all.map(o=>o.label),['27/27.5 cm','26/26.5 cm','25/25.5 cm']);
 const tie=bootOptions([v('lo','SKI_BOOT','24 cm'),v('hi','SKI_BOOT','26 cm')],'SKI_BOOT',25,Infinity);
 assert.equal(tie[0]!.label,'26 cm');
});
test('partFit classification: below/above range, nearest when the edge is unavailable, manual limit, exact edge of the window', () => {
 const cat={lo:134,hi:166};
 assert.equal(partFit('SKI',150,{lo:150,hi:150},cat,15,30).kind,'NORMAL');
 assert.equal(partFit('SKI',181,{lo:166,hi:166},cat,15,30).kind,'NORMAL');// exactly 15 cm is still normal
 assert.equal(partFit('SKI',181.5,{lo:166,hi:166},cat,15,30).kind,'EDGE_ABOVE');
 assert.equal(partFit('SKI',195,{lo:165,hi:165},cat,15,30).kind,'NEAREST_AVAILABLE');
 assert.equal(partFit('SKI',110,{lo:134,hi:134},cat,15,30).kind,'EDGE_BELOW');
 assert.equal(partFit('SKI',196,{lo:166,hi:166},cat,15,30).kind,'EDGE_ABOVE');// diff 30 = limit
 assert.equal(partFit('SKI',196.5,{lo:166,hi:166},cat,15,30).kind,'MANUAL_FIT_REQUIRED');
 assert.equal(partFit('SKI_BOOT',29,{lo:26.5,hi:26.5},{lo:26.5,hi:26.5},1,MANUAL_FIT_LIMIT_CM.boot).diffCm,-2.5);
 assert.equal(poleFit(160,140,{lo:110,hi:140}).kind,'EDGE_ABOVE');
 assert.equal(poleFit(160,110,{lo:110,hi:140}).kind,'NEAREST_AVAILABLE');// never MANUAL: staff set the pole at hand-out
 assert.equal(poleFit(120,110,{lo:110,hi:140}).kind,'NORMAL');
 assert.equal(combineFit([partFit('SKI',150,{lo:150,hi:150},cat,15,30)],'x'),null);
 assert.equal(normalFit('x').kind,'NORMAL');
});
test('rankCandidates window defaults to 15 and is only widened explicitly', () => {
 const all=[{lengthCm:100},{lengthCm:140}];
 assert.equal(rankCandidates(all,200).RECOMMENDED,null);
 assert.equal(rankCandidates(all,200,false,Infinity).RECOMMENDED!.lengthCm,140);
});
test('extreme real measurements are held raw; schema accepts the real extremes and still rejects unit/finiteness errors', () => {
 const input=(m:Record<string,unknown>)=>parseRecommendation({pickupStore:'MOUNTAIN_BASE',returnStore:'MOUNTAIN_BASE',period:{startDate:'2035-01-01',endDate:'2035-01-01',slot:'DAY'},members:[{...board,...m}]});
 for(const heightCm of [50,250])assert.equal(input({heightCm}).members[0]!.heightCm,heightCm);
 for(const footCm of [5,50])assert.equal(input({footCm}).members[0]!.footCm,footCm);
 for(const bad of [{heightCm:2.5},{heightCm:2500},{heightCm:Number.NaN},{footCm:255},{footCm:25.55},{footCm:Number.POSITIVE_INFINITY}])assert.throws(()=>input(bad),{code:'INVALID_RECOMMENDATION_INPUT'});
});
test('DIN reference is independent of the edge route: out-of-table stays null, never extrapolated', () => {
 assert.equal(dinAdvisory({heightCm:250,weightKg:301,ageAtStart:30,skierType:'TYPE_III',bslMm:400}).value,null);
 assert.equal(dinAdvisory({heightCm:250,weightKg:301,ageAtStart:30,skierType:'TYPE_III',bslMm:400}).reason,'OUTSIDE_TABLE');
 assert.equal(dinAdvisory({heightCm:300,weightKg:60,ageAtStart:30,skierType:'TYPE_I',bslMm:300}).reason,'OUTSIDE_TABLE');
});
