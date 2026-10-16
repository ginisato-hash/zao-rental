// R67 protected-smoke regression (Issue #47 TD 6204860465 item 3): the exact malformed guest payloads that returned
// 500 GUEST_OPERATION_FAILED on protected Production must be refused as contract input errors (4xx), while a genuine
// unexpected internal fault still surfaces as 500. Root cause: Production composes GuestBookingService in the
// instrumentation bundle, so its HoldError is a different class from the route bundle's and `instanceof` failed.
// The service is wrapped here so every error it throws is re-created from a second module instance of hold.ts
// (`?bundle=instrumentation`) - exactly the cross-bundle shape. Real PostgreSQL, real guest HTTP handler, synthetic data.
import assert from 'node:assert/strict';
import {guestHandler} from '../../apps/web/src/lib/guest-http';
import {flowFixture,simulation} from '../flow/fixture';
import {provisionGuestRole} from '../../scripts/guest-roles';
import {GuestContexts} from '../../packages/core/src/guest/context';
import {GuestBookingService,type GuestCatalog} from '../../packages/core/src/guest/service';
import {HoldService} from '../../packages/core/src/inventory/hold-service';
import {QuoteService} from '../../packages/core/src/pricing/quote-service';
import {RecommendationService} from '../../packages/core/src/recommendation/recommendation-service';
import {BookingService} from '../../packages/core/src/payment/booking-service';
import {seedInventory} from '../inventory/fixture';
import {HoldError} from '../../packages/contracts/src/hold';
// A query-suffixed specifier loads a second, independent module instance (what the instrumentation bundle holds).
const instrumentationBundle='../../packages/contracts/src/hold.ts?bundle=instrumentation';
const foreign=await import(instrumentationBundle) as typeof import('../../packages/contracts/src/hold');
assert.notEqual(foreign.HoldError,HoldError,'the simulated instrumentation bundle has its own HoldError class');
const x=await flowFixture();let role:Awaited<ReturnType<typeof provisionGuestRole>>|undefined,failed=false,stage='setup',count=0;
const check=async(name:string,fn:()=>Promise<void>)=>{stage=name;await fn();count++;console.log('PASS '+name);};
try{
 await seedInventory(x.db.pool,true);
 role=await provisionGuestRole(x.db.pool,x.db.identity);const contexts=new GuestContexts(role.guestPool),created=await contexts.create();
 const all=await x.holds.recommendationCatalog(),key=(v:{id:string;family:string})=>v.family.toLowerCase()+'-'+v.id;
 const catalog:GuestCatalog={revision:'synthetic-v1',models:[],sizes:all.filter(v=>['WEAR_JACKET','WEAR_PANTS','POLE'].includes(v.family)).map(v=>({key:key(v),label:v.size,variant:v}))};
 const jacket=catalog.sizes.find(s=>s.variant.family==='WEAR_JACKET')?.key??'wear_jacket-absent',pants=catalog.sizes.find(s=>s.variant.family==='WEAR_PANTS')?.key??'wear_pants-absent';
 let fault:Error|null=null;
 const build=(a:Awaited<ReturnType<typeof contexts.resolve>>)=>{const h=new HoldService(x.roles.holdPool,a),q=new QuoteService(x.roles.pricingPool,a),recs=new RecommendationService(x.roles.recommendationPool,a,h,q),booking=new BookingService(x.flow.flowPool,role!.guestPool,a,x.fake,simulation);
  const svc=new GuestBookingService(contexts,a,recs,booking,async()=>{if(fault)throw fault;return catalog;});
  // Re-throw contract errors as the other bundle's class; anything else passes through unchanged.
  return new Proxy(svc,{get(t,k,r){const v=Reflect.get(t,k,r);return typeof v!=='function'?v:async(...args:unknown[])=>{try{return await v.apply(t,args);}catch(e){if(e instanceof HoldError){const x=new foreign.HoldError(e.code,e.status);assert.ok(!(x instanceof HoldError));throw x;}throw e;}};}});};
 const api=guestHandler(contexts,a=>build(a),x.origin,false),headers={origin:x.origin,'content-type':'application/json',cookie:'zao_guest='+created.token};
 const post=async(path:string,body:unknown)=>{const r=await api(new Request(x.origin+'/api/guest'+path,{method:'POST',headers,body:JSON.stringify(body)}));return {status:r.status,body:await r.json() as Record<string,unknown>};};
 const draft=async()=>{const r=await api(new Request(x.origin+'/api/guest/draft',{method:'GET',headers}));return await r.json() as {id:string;revision:number};};
 const period={startDate:'2035-01-12',endDate:'2035-01-12',startAt:'08:30',returnBy:'17:00'},stores={pickupStore:'MOUNTAIN_BASE',returnStore:'MOUNTAIN_BASE'};
 const member=(o:Record<string,unknown>)=>({key:'person-1',ski:null,tier:'REGULAR',items:null,sport:'SKI',footCm:26,heightCm:170,poleSize:null,pantsSize:null,wearSport:null,jacketSize:null,adultAtStart:true,premiumModel:null,...o});
 const ski={weightKg:65,skierType:'TYPE_I',ageAtStart:35};
 // Exact member shapes from the protected smoke (Production log 2026-10-15T23:5x, 10 x POST /api/guest/draft 500).
 const malformed:[string,Record<string,unknown>][]=[
  ['ski boot only with height + ski profile',{...stores,period,members:[member({sport:'SKI',items:['SKI_BOOT'],ski})],contractVersion:'INTEGRATED_V1_4'}],
  ['snowboard boot only with height',{...stores,period,members:[member({sport:'SNOWBOARD',items:['SNOWBOARD_BOOT']})],contractVersion:'INTEGRATED_V1_4'}],
  ['snowboard boot only with height, foot 24.3',{...stores,period,members:[member({sport:'SNOWBOARD',items:['SNOWBOARD_BOOT'],footCm:24.3})],contractVersion:'INTEGRATED_V1_4'}],
  ['wear only without stores',{period,members:[member({sport:'WEAR',tier:'STANDARD',wearSport:'SKI',heightCm:null,footCm:null,jacketSize:jacket,pantsSize:pants})],contractVersion:'INTEGRATED_V1_4'}],
  ['Premium ski without a released model',{...stores,period,members:[member({sport:'SKI',tier:'PREMIUM',ski})],contractVersion:'INTEGRATED_V1_4'}],
  ['Premium snowboard without a released model',{...stores,period,members:[member({sport:'SNOWBOARD',tier:'PREMIUM'})],contractVersion:'INTEGRATED_V1_4'}],
  ['Premium snowboard with an unknown model key',{...stores,period,members:[member({sport:'SNOWBOARD',tier:'PREMIUM',premiumModel:'fake-model-key'})],contractVersion:'INTEGRATED_V1_4'}]
 ];
 await check('every exact smoke-500 malformed guest draft is refused as 422 without changing the draft',async()=>{
  for(const [name,input] of malformed){const before=await draft(),r=await post('/draft',{draftId:before.id,expectedRevision:before.revision,input});
   assert.equal(r.status,422,name+' '+JSON.stringify(r.body));assert.notEqual(r.body.error,'GUEST_OPERATION_FAILED',name);assert.equal((await draft()).revision,before.revision,name);}
 });
 await check('the corrected shapes the booking UI actually sends still save (boot only without height, a regular set)',async()=>{
  for(const input of [{...stores,period,members:[member({sport:'SNOWBOARD',items:['SNOWBOARD_BOOT'],heightCm:null})],contractVersion:'INTEGRATED_V1_4'},
   {...stores,period,members:[member({sport:'SNOWBOARD'})],contractVersion:'INTEGRATED_V1_4'}]){
   const before=await draft(),r=await post('/draft',{draftId:before.id,expectedRevision:before.revision,input});assert.equal(r.status,200,JSON.stringify(r.body));}
 });
 await check('cross-bundle 403/409 keep their meaning (Production returned 500 for both)',async()=>{const d=await draft(),input={...stores,period,members:[member({sport:'SNOWBOARD'})],contractVersion:'INTEGRATED_V1_4'};
  assert.equal((await post('/draft',{draftId:'00000000-0000-4000-8000-000000000000',expectedRevision:d.revision,input})).status,403);
  assert.equal((await post('/draft',{draftId:d.id,expectedRevision:d.revision+7,input})).status,409);
 });
 await check('a synthetic unknown internal fault during the same save remains 500 GUEST_OPERATION_FAILED',async()=>{
  fault=new Error('synthetic internal fault');try{const d=await draft(),r=await post('/draft',{draftId:d.id,expectedRevision:d.revision,input:{...stores,period,members:[member({sport:'SNOWBOARD'})],contractVersion:'INTEGRATED_V1_4'}});
   assert.equal(r.status,500);assert.equal(r.body.error,'GUEST_OPERATION_FAILED');}finally{fault=null;}
  // A non-contract error that merely looks like one (code + status, no brand) is not trusted.
  fault=Object.assign(new Error('STALE_DRAFT'),{code:'STALE_DRAFT',status:409});try{const d=await draft(),r=await post('/draft',{draftId:d.id,expectedRevision:d.revision,input:{...stores,period,members:[member({sport:'SNOWBOARD'})],contractVersion:'INTEGRATED_V1_4'}});
   assert.equal(r.status,500);assert.equal(r.body.error,'GUEST_OPERATION_FAILED');}finally{fault=null;}
  const t=new TypeError('synthetic runtime type fault');fault=t;try{const d=await draft(),r=await post('/draft',{draftId:d.id,expectedRevision:d.revision,input:{...stores,period,members:[member({sport:'SNOWBOARD'})],contractVersion:'INTEGRATED_V1_4'}});
   assert.equal(r.status,500);}finally{fault=null;}
 });
 console.log(`Guest malformed-input boundary real PostgreSQL ${count} passed; synthetic data only.`);
}catch(e){failed=true;console.error('GUEST_MALFORMED_FAILED '+stage+' '+String((e as {code?:string}).code??(e as Error).name));if(e instanceof assert.AssertionError)console.error(JSON.stringify({actual:e.actual,expected:e.expected,message:e.message}));console.error((e as Error).stack?.split('\n').filter(s=>s.includes('/tests/')).join('\n'));}
finally{await role?.close();await x.close();}
if(failed)process.exit(1);
