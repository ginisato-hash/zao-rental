import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {G,gt,groupError} from '../../apps/web/src/components/staff-groups-text';
import {staffGroupHandler} from '../../apps/web/src/lib/staff-group-http';
import {groupEntranceUrl} from '../../apps/web/src/lib/group-entrance-url';
import type {StaffState} from '../../packages/auth/src/staff-auth';

// Administrator group-order screens: wording contract (no deadline/extension/expiry/online payment flow) and the input contract of the HTTP layer
// (no database here; every refusal below happens before any service call).
test('the admin dictionary has JA and EN for every key and never mentions a deadline, extension, expiry or a payment-link flow',()=>{
 for(const [k,v] of Object.entries(G)){assert.equal(v.length,2,k);assert.ok(v[0].length>0&&v[1].length>0,k);
  for(const t of v)assert.doesNotMatch(t,/期限|延長|有効期限|expir|extend|extension|deadline|決済リンク|Square|カード入力/i,k+': '+t);}
 assert.match(gt('ja','releaseEffect'),/一部だけの解除はありません/);assert.match(gt('en','releaseEffect'),/no partial release/i);
});
test('component sources have no deadline/extension wording and never call a payment or guest endpoint',()=>{
 for(const f of ['StaffGroups.tsx','StaffGroupDetail.tsx']){const s=readFileSync('apps/web/src/components/'+f,'utf8');
  assert.doesNotMatch(s,/期限|延長|expir|extension|deadline/i,f);assert.doesNotMatch(s,/square|\/api\/(guest|bookings)|prepare-payment|checkout/i,f);}
});
test('errors have an explanation in both languages; unknown codes keep the code only as a reference',()=>{
 for(const code of ['STALE_REVISION','INSUFFICIENT_STOCK','CONSENT_REQUIRED','RECONSENT_REQUIRED','NO_CHARGE_CONFIRMATION_REQUIRED','FIT_CONFIRMATION_REQUIRED','ADJUSTMENT_EXCEEDS_REMAINDER','GROUP_REVERSAL_INVALID','FORBIDDEN','GROUP_NOT_CONNECTED']){
  assert.ok(groupError(code,'ja').length>5&&groupError(code,'en').length>5,code);assert.doesNotMatch(groupError(code,'ja'),/^[A-Z_]+$/);}
 assert.match(groupError('SOMETHING_NEW','ja'),/参照コード：SOMETHING_NEW/);
 assert.match(groupError('RECONSENT_REQUIRED','en',{consentedMaxJpy:1000,totalJpy:1200}),/1,000.*1,200/);
});
test('the entrance URL keeps the token in the path only (never a query string) and is locale-prefixed',()=>{
 const t='A'.repeat(43);assert.equal(groupEntranceUrl('http://x','ja',t),`http://x/ja/group/${t}`);assert.equal(groupEntranceUrl('http://x','en',t),`http://x/en/group/${t}`);assert.doesNotMatch(groupEntranceUrl('http://x','ja',t),/\?/);
});

const ORIGIN='http://127.0.0.1:34000',STAMP='s',hash=createHash('sha256').update(STAMP).digest('hex');
const admin:StaffState={status:'authorized',stamp:STAMP,principal:{subject:'a',role:'ADMIN',storeIds:['MOUNTAIN_BASE'],scope:'ALL',permissions:['GROUP_VIEW'],revision:1} as never};
const manager:StaffState={status:'authorized',stamp:STAMP,principal:{subject:'m',role:'MANAGER',storeIds:[],scope:'ALL',permissions:['BOOKING_VIEW'],revision:1} as never};
const anon:StaffState={status:'anonymous',principal:null,stamp:null};
let serviceCalls=0;const never=new Proxy({},{get:()=>()=>{serviceCalls++;throw new Error('service must not be reached');}}) as never;
const call=async(state:StaffState,method:string,path:string,opts:{origin?:string|null;stamp?:string|null;body?:unknown;noService?:boolean}={})=>{
 const h=staffGroupHandler(async()=>state,()=>opts.noService?null:never,ORIGIN);const headers:Record<string,string>={'content-type':'application/json'};
 if(opts.origin!==null)headers.origin=opts.origin??ORIGIN;if(opts.stamp!==null)headers['x-zao-session']=opts.stamp??hash;
 const r=await h(new Request('http://127.0.0.1:34000/api/staff/groups'+path,{method,headers,...(method==='POST'?{body:JSON.stringify(opts.body??{})}:{})}));return {status:r.status,body:await r.json() as {error?:string},headers:r.headers};};
const ID='11111111-1111-4111-8111-111111111111';
test('HTTP layer refuses before reaching the service: anonymous, non-ADMIN, wrong origin, wrong stamp, malformed body, unknown path',async()=>{
 assert.equal((await call(anon,'GET','')).status,401);
 for(const [m,p] of [['GET',''],['GET','/'+ID],['POST','/'+ID+'/release'],['POST','/entrance/rotate']] as const)assert.equal((await call(manager,m,p)).status,403,m+p);
 assert.equal((await call(admin,'POST','/'+ID+'/release',{origin:'https://evil.example'})).status,403);
 assert.equal((await call(admin,'POST','/'+ID+'/release',{origin:null})).status,403);
 assert.equal((await call(admin,'POST','/'+ID+'/release',{stamp:null})).status,409);assert.equal((await call(admin,'POST','/'+ID+'/release',{stamp:'z'})).status,409);
 assert.equal((await call(admin,'POST','/'+ID+'/release',{body:{requestKey:'nope',expectedRevision:1,reason:'x'}})).status,422);
 assert.equal((await call(admin,'POST','/'+ID+'/release',{body:{requestKey:ID,expectedRevision:0,reason:'x'}})).status,422);
 assert.equal((await call(admin,'POST','/'+ID+'/release',{body:{requestKey:ID,expectedRevision:1,reason:'x',admin:true}})).status,422);
 assert.equal((await call(admin,'POST','/'+ID+'/release',{body:{requestKey:ID,expectedRevision:1,reason:'x'.repeat(301)}})).status,422);
 assert.equal((await call(admin,'POST','/'+ID+'/confirm',{body:{requestKey:ID,expectedRevision:1,message:'x'.repeat(2001)}})).status,422);
 assert.equal((await call(admin,'POST','/'+ID+'/adjustments',{body:{expectedRevision:1,adjustments:[{target:'GROUP',method:'FIXED_JPY',value:1,reason:'r',extra:1}]}})).status,422);
 assert.equal((await call(admin,'POST','/'+ID+'/nope',{body:{}})).status,404);assert.equal((await call(admin,'GET','/'+ID+'/nope')).status,404);assert.equal((await call(admin,'GET','?status=BOGUS')).status,422);assert.equal((await call(admin,'GET','?number=1')).status,422);assert.equal((await call(admin,'PUT','')).status,405);
 assert.equal(serviceCalls,0,'no refusal above reached the service');
 const r=await call(admin,'GET','',{noService:true});assert.equal(r.status,503);assert.equal(r.body.error,'GROUP_NOT_CONNECTED');assert.match(r.headers.get('cache-control')??'',/no-store/);
});
