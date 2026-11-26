import test from 'node:test';
import assert from 'node:assert/strict';
import {GroupCustomerService,deriveOwnerSecret,groupPeriod,shortMemberId} from '../../packages/core/src/group/group-customer';
import {GROUP_COPY} from '../../apps/web/src/components/group-copy';
import {groupHandler,groupCookie,privateHeaders,type GroupBoundary} from '../../apps/web/src/lib/group-http';
import type {GroupCsvCatalog,GroupCsvMemberValues} from '../../packages/contracts/src/group-csv';
import {GroupError} from '../../packages/contracts/src/group-order';

const cat:GroupCsvCatalog={season:'2035',premiumModels:[],jacketSizes:['M','L'],pantsSizes:['M','L']};
// The pure parts of the service (row normalisation, profile building) never touch the database.
const svc=new GroupCustomerService(null as never,null as never,null as never);
const row=(over:Partial<GroupCsvMemberValues&{memberId:string|null}>={}):Record<string,unknown>=>({memberId:null,label:'A',sport:'SKI',equipment:{kind:'SET'},tier:'REGULAR',ageAtStart:30,heightCm:170,weightKg:60,footCm:25.5,skierType:'TYPE_II',premiumModelCode:null,jacketSize:null,pantsSize:null,wearSport:null,wearAddon:false,...over});

test('owner secret: deterministic per (server key, entrance, request key), 256-bit base64url, never derivable without the server key',()=>{
 const k='k'.repeat(64),a=deriveOwnerSecret(k,'ENTRANCE'.repeat(6),'req-1');
 assert.match(a,/^[A-Za-z0-9_-]{43}$/);assert.equal(a,deriveOwnerSecret(k,'ENTRANCE'.repeat(6),'req-1'));
 for(const other of [deriveOwnerSecret(k,'ENTRANCE'.repeat(6),'req-2'),deriveOwnerSecret(k,'OTHER'.repeat(10),'req-1'),deriveOwnerSecret('j'.repeat(64),'ENTRANCE'.repeat(6),'req-1')])assert.notEqual(other,a);
 assert.throws(()=>deriveOwnerSecret('short','e','r'),{code:'GROUP_KEY_REQUIRED'});
});
test('period: V1.4 boundaries only; the slot is derived; impossible ranges and combinations are refused',()=>{
 assert.deepEqual(groupPeriod({startDate:'2035-02-10',endDate:'2035-02-10',startAt:'08:30',returnBy:'17:00'}),{startDate:'2035-02-10',endDate:'2035-02-10',slot:'DAY',startAt:'08:30',returnBy:'17:00'});
 assert.equal(groupPeriod({startDate:'2035-02-10',endDate:'2035-02-12',startAt:'13:00',returnBy:'12:00'}).slot,'MULTIDAY');
 for(const bad of [null,{},{startDate:'2035-02-10',endDate:'2035-02-09',startAt:'08:30',returnBy:'17:00'},{startDate:'2035-02-10',endDate:'2035-02-10',startAt:'13:00',returnBy:'12:00'},{startDate:'2035-02-10',endDate:'2035-02-10',startAt:'09:00',returnBy:'17:00'},{startDate:'x',endDate:'y',startAt:'08:30',returnBy:'17:00'},{startDate:'2035-02-10',endDate:'2035-02-10',slot:'DAY'}])assert.throws(()=>groupPeriod(bad),{code:'INVALID_PERIOD'});
});
test('short member ids fit the CSV member_id contract and are stable',()=>{
 const id=shortMemberId('0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d');assert.match(id,/^[a-z0-9_-]{1,24}$/);assert.equal(id,'m0b1c2d3e4f504a6b');
});
test('rows are re-derived through the CSV contract: valid rows pass, errors map to row index, labels stay verbatim, unknown ids are dropped',()=>{
 const ok=svc.normalizeRows([row({label:'=1+1'}),row({memberId:'mknown'}),row({memberId:'mforged'})],cat,new Set(['mknown']));
 assert.deepEqual(ok.issues,[]);assert.equal(ok.rows[0]!.label,'=1+1','label is not rewritten');assert.deepEqual(ok.rows.map(r=>r.memberId),[null,'mknown',null]);
 const bad=svc.normalizeRows([row(),row({heightCm:5000}),row({weightKg:null})],cat,new Set());
 assert.ok(bad.issues.some(i=>i.index===1&&i.code==='OUT_OF_RANGE'));assert.ok(bad.issues.some(i=>i.index===2&&i.code==='REQUIRED_VALUE_MISSING'));
 const noAge=svc.normalizeRows([row({ageAtStart:null,equipment:{kind:'ITEMS',items:['SKI_BOOT']} as never,weightKg:null,skierType:null,heightCm:null})],cat,new Set());
 assert.deepEqual(noAge.issues,[{index:0,code:'AGE_REQUIRED',column:'age_at_start'}]);
 assert.throws(()=>svc.normalizeRows(Array.from({length:101},()=>row()),cat,new Set()),{code:'GROUP_TOO_LARGE'});
 assert.throws(()=>svc.normalizeRows([],cat,new Set()),{code:'GROUP_EMPTY'});
 for(const junk of [[null],[{sport:1}],[{...row(),equipment:{kind:'EVIL'}}],[{...row(),heightCm:'170'}],[{...row(),label:{}}],[{...row(),label:'x\u0000y'}],[{...row(),label:'x'.repeat(41)}]])assert.throws(()=>svc.normalizeRows(junk,cat,new Set()),{code:'INVALID_INPUT'});
 // a 40-character formula-looking label is accepted (the export apostrophe is not part of the stored value)
 assert.equal(svc.normalizeRows([row({label:'='+'a'.repeat(39)})],cat,new Set()).issues.length,0);
});
test('wear sizes resolve by size and age against the live catalogue; an unknown size is refused, never guessed',()=>{
 const v=(family:string,size:string,age:string,id:string)=>({id,family,age,tier:'STANDARD',size});
 const c={csv:cat,models:[],variants:[v('WEAR_JACKET','M','ADULT','00000000-0000-4000-8000-000000000001'),v('WEAR_PANTS','M','ADULT','00000000-0000-4000-8000-000000000002'),v('WEAR_JACKET','m','KIDS','00000000-0000-4000-8000-000000000003')]};
 const base={label:null,sport:'WEAR' as const,equipment:{kind:'NONE' as const},tier:'STANDARD' as const,ageAtStart:30,adultAtStart:true,heightCm:null,weightKg:null,footCm:null,skierType:null,premiumModelCode:null,jacketSize:'M',pantsSize:'M',wearSport:'SKI' as const,wearAddon:false,memberId:null};
 const profile=(svc as unknown as {profileOf:(r:unknown,k:string,c:unknown)=>{wearSelection?:{jacketVariantId:string;pantsVariantId:string};adultAtStart:boolean}}).profileOf(base,'p001',c);
 assert.equal(profile.wearSelection?.jacketVariantId,'00000000-0000-4000-8000-000000000001');assert.equal(profile.wearSelection?.pantsVariantId,'00000000-0000-4000-8000-000000000002');
 assert.throws(()=>(svc as unknown as {profileOf:(r:unknown,k:string,c:unknown)=>unknown}).profileOf({...base,jacketSize:'XL'},'p001',c),{code:'WEAR_SIZE_UNAVAILABLE'});
 assert.throws(()=>(svc as unknown as {profileOf:(r:unknown,k:string,c:unknown)=>unknown}).profileOf({...base,adultAtStart:false,ageAtStart:9},'p001',c),{code:'WEAR_SIZE_UNAVAILABLE'},'a child needs a KIDS pants variant, which this catalogue lacks');
});

test('copy: JA and EN have identical shape; no deadline/expiry/extension wording and no payment-entry wording anywhere',()=>{
 const shape=(v:unknown):unknown=>typeof v==='function'?'fn':v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,shape(x)])):typeof v;
 assert.deepEqual(shape(GROUP_COPY.ja),shape(GROUP_COPY.en));
 const text=(v:unknown):string[]=>typeof v==='string'?[v]:typeof v==='function'?[]:v&&typeof v==='object'?Object.values(v).flatMap(text):[];
 for(const [lang,copy] of Object.entries(GROUP_COPY)){const all=text(copy).join('\n');
  assert.equal(/期限|延長|有効期間|expir|deadline|extend|time limit/i.test(all),false,lang+' mentions a deadline/extension');
  assert.equal(/カード番号|決済リンク|前払|クーポン|prepay|card number|payment link|coupon/i.test(all),false,lang+' mentions card/prepay/coupon');
  assert.ok(/現地|on site/i.test(all));assert.ok(/まだ予約確定ではありません|not (?:yet )?a confirmed booking/i.test(all));}
});

const boundary=(over:Partial<GroupBoundary>={}):GroupBoundary=>({customer:{svc:{entranceOpen:async(t:string)=>t==='T'.repeat(43),startApplication:async()=>{throw new Error('SQL secret detail')}} ,catalog:async()=>({csv:cat,models:[]})} as never,origin:'https://zao.example',serverKey:'k'.repeat(64),guard:async()=>{},...over});
const call=(b:GroupBoundary|null,path:string,init:RequestInit={})=>groupHandler(()=>b)(new Request('https://zao.example'+path,init));
test('http: unconnected boundary is 503; query strings, non-GET/POST and cross-origin POSTs are refused before anything runs',async()=>{
 assert.equal((await call(null,'/api/group/catalog')).status,503);
 assert.equal((await call(boundary(),'/api/group/catalog?x=1')).status,422);
 assert.equal((await call(boundary(),'/api/group/catalog',{method:'PUT'})).status,405);
 for(const origin of [undefined,'https://evil.example','http://zao.example'])assert.equal((await call(boundary(),'/api/group/start',{method:'POST',headers:{...(origin?{origin}:{}),'content-type':'application/json','x-group-entrance':'T'.repeat(43)},body:'{}'})).status,403);
 assert.equal((await call(boundary(),'/api/group/start',{method:'POST',headers:{origin:'https://zao.example','sec-fetch-site':'cross-site','content-type':'application/json'},body:'{}'})).status,403);
});
test('http: the entrance header gates the catalog; responses are private, noindex and no-referrer; unexpected errors are opaque',async()=>{
 const ok=await call(boundary(),'/api/group/catalog',{headers:{'x-group-entrance':'T'.repeat(43)}});assert.equal(ok.status,200);
 for(const [k,v] of Object.entries(privateHeaders))assert.equal(ok.headers.get(k),v);
 assert.equal((await call(boundary(),'/api/group/catalog',{headers:{'x-group-entrance':'x'}})).status,404);assert.equal((await call(boundary(),'/api/group/catalog')).status,404);
 const guarded=await call(boundary({guard:async()=>{throw new GroupError('GUEST_RATE_LIMITED',429);}}),'/api/group/catalog',{headers:{'x-group-entrance':'T'.repeat(43)}});assert.equal(guarded.status,429);assert.equal(guarded.headers.get('retry-after'),'60');
 const boom=await call(boundary(),'/api/group/start',{method:'POST',headers:{origin:'https://zao.example','content-type':'application/json','x-group-entrance':'T'.repeat(43)},body:JSON.stringify({requestKey:'00000000-0000-4000-8000-000000000001',groupLabel:'g',contactName:'n',contactEmail:'a@example.invalid',locale:'ja',pickupStore:'MOUNTAIN_BASE',returnStore:'MOUNTAIN_BASE',period:{startDate:'2035-02-10',endDate:'2035-02-10',startAt:'08:30',returnBy:'17:00'}})});
 assert.equal(boom.status,500);const body=await boom.text();assert.equal(body,'{"error":"GROUP_OPERATION_FAILED"}');assert.equal(body.includes('SQL'),false);
});
test('http: group routes without the owner cookie are 404 (never 401/403, so no existence oracle); unknown keys and malformed ids are refused',async()=>{
 const id='11111111-1111-4111-8111-111111111111';
 assert.equal((await call(boundary(),`/api/group/g/${id}`)).status,404);assert.equal((await call(boundary(),`/api/group/g/${id}/advise`,{method:'POST',headers:{origin:'https://zao.example','content-type':'application/json'},body:'{"rows":[]}'})).status,404);
 assert.equal((await call(boundary(),'/api/group/g/not-a-uuid')).status,404);assert.equal((await call(boundary(),'/api/group/nothing')).status,404);
});
test('cookie: HttpOnly, SameSite=Strict, scoped to one group path; Secure on https; removal expires it',()=>{
 const id='11111111-1111-4111-8111-111111111111',c=groupCookie(id,'s'.repeat(43),true);
 assert.match(c,/^zao_grp_11111111111141118111111111111111=s{43}; Path=\/api\/group\/g\/11111111-1111-4111-8111-111111111111; HttpOnly; SameSite=Strict; Max-Age=\d+; Secure$/);
 assert.equal(groupCookie(id,'s',false).includes('Secure'),false);assert.match(groupCookie(id,'',true,true),/=; .*Max-Age=0/);
});
