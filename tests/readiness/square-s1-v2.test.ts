import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import test from 'node:test';
import {squareS1Preflight} from '../../apps/web/src/lib/square-s1-preflight';
import {createSquareS1AcceptanceV2,createSquareS1Preflight} from '../../apps/web/src/lib/square-s1-acceptance';
import {SQUARE_SANDBOX_ORIGIN,SQUARE_VERSION} from '../../packages/core/src/payment/square-sandbox';

const environment=(overrides:Record<string,string|undefined>={})=>({VERCEL_ENV:'preview',
 SQUARE_ENVIRONMENT:'SANDBOX',SQUARE_API_VERSION:SQUARE_VERSION,SQUARE_SANDBOX_APPLICATION_ID:'fixture-app',
 SQUARE_SANDBOX_LOCATION_ID:'fixture-location',SQUARE_SANDBOX_ACCESS_TOKEN:randomBytes(32).toString('base64url'),...overrides});
const merchant=(overrides:Record<string,unknown>={})=>({id:'fixture-merchant',status:'ACTIVE',country:'JP',currency:'JPY',main_location_id:'fixture-location',...overrides});
const location=(overrides:Record<string,unknown>={})=>({id:'fixture-location',merchant_id:'fixture-merchant',status:'ACTIVE',country:'JP',currency:'JPY',capabilities:['CREDIT_CARD_PROCESSING'],...overrides});
const endpoint='https://fixture.invalid/api/internal/acceptance/square-s1-v2';
const intent={'X-ZAO-Acceptance':'SQUARE_S1_V2','sec-fetch-site':'same-origin',origin:'https://fixture.invalid'};
const request=(init:RequestInit={})=>new Request(endpoint,{method:'POST',headers:intent,...init});
function fixture(responses:(Response|Error)[]=[Response.json({merchant:merchant()}),Response.json({locations:[location()]})]){
 const calls:{url:string;init:RequestInit}[]=[];
 return {calls,fetch:async(url:string,init:RequestInit)=>{calls.push({url,init});const response=responses.shift();
  if(response instanceof Error)throw response;if(!response)throw new Error('UNEXPECTED_CALL');return response;}};
}

test('R6 pure preflight exposes only flags/enums and requires no merchant metadata',()=>{
 const env=environment({NEXT_PUBLIC_SITE_LABEL:'Rental'}),result=squareS1Preflight(env);
 assert.deepEqual(result,{environment:'SANDBOX',deployment:'preview',apiVersionMatch:true,applicationIdConfigured:true,
  locationIdConfigured:true,accessTokenConfigured:true,accessTokenFormatValid:true,publicCredentialExposure:false,
  readyForS1:true,result:'PASS',reason:null});
 const encoded=JSON.stringify(result);
 for(const value of [env.SQUARE_SANDBOX_APPLICATION_ID,env.SQUARE_SANDBOX_LOCATION_ID,env.SQUARE_SANDBOX_ACCESS_TOKEN])assert.ok(!encoded.includes(value));
});

const invalidConfigurations:[Record<string,string|undefined>,string][]=[
 [{VERCEL_ENV:'production'},'DEPLOYMENT_NOT_PREVIEW'],[{SQUARE_ENVIRONMENT:'PRODUCTION'},'NOT_SANDBOX'],
 [{SQUARE_API_VERSION:'2025-01-01'},'API_VERSION_MISMATCH'],
 [{SQUARE_SANDBOX_APPLICATION_ID:undefined},'APPLICATION_ID_INVALID'],[{SQUARE_SANDBOX_APPLICATION_ID:'bad id'},'APPLICATION_ID_INVALID'],
 [{SQUARE_SANDBOX_LOCATION_ID:undefined},'LOCATION_ID_INVALID'],[{SQUARE_SANDBOX_LOCATION_ID:'bad id'},'LOCATION_ID_INVALID'],
 [{SQUARE_SANDBOX_ACCESS_TOKEN:undefined},'CREDENTIAL_MISSING'],[{SQUARE_SANDBOX_ACCESS_TOKEN:'bad token'},'CREDENTIAL_FORMAT_INVALID'],
 [{NEXT_PUBLIC_SQUARE_ACCESS_TOKEN:'fixture-public'},'PUBLIC_CREDENTIAL_EXPOSURE'],
 [{SQUARE_SANDBOX_MERCHANT_ID:''},'CONFIGURATION_INVALID'],[{SQUARE_SANDBOX_NOTIFICATION_URL:'http://fixture.invalid'},'CONFIGURATION_INVALID'],
];
for(const [overrides,reason] of invalidConfigurations)test('R6 blocks '+reason+' before fetch '+Object.keys(overrides)[0],async()=>{
 const env=environment(overrides),preflight=squareS1Preflight(env),f=fixture();
 assert.equal(preflight.readyForS1,false);assert.equal(preflight.reason,reason);
 const response=await createSquareS1AcceptanceV2(env,f.fetch)(request()),body=await response.json();
 assert.equal(body.result,'S1_BLOCKED');assert.equal(body.requestCount,0);assert.equal(body.providerDispatched,false);
 assert.equal(response.status,overrides.VERCEL_ENV==='production'?404:503);assert.equal(f.calls.length,0);
});

test('R6 catches credentials reflected in unrelated NEXT_PUBLIC keys without returning values',()=>{
 const env=environment(),result=squareS1Preflight({...env,NEXT_PUBLIC_UNRELATED:'prefix-'+env.SQUARE_SANDBOX_ACCESS_TOKEN});
 assert.equal(result.reason,'PUBLIC_CREDENTIAL_EXPOSURE');assert.equal(result.publicCredentialExposure,true);
 assert.ok(!JSON.stringify(result).includes(env.SQUARE_SANDBOX_ACCESS_TOKEN));
});

test('R6 GET preflight repeats safely; production and wrong intent are rejected',async()=>{
 const handler=createSquareS1Preflight(environment());
 for(let i=0;i<2;i++)assert.equal((await (await handler(request({method:'GET'}))).json()).result,'PASS');
 assert.equal((await handler(request({method:'GET',headers:{}}))).status,400);
 assert.equal((await createSquareS1Preflight(environment({VERCEL_ENV:'production'}))(request({method:'GET'}))).status,404);
});

test('R6 validates body, exact same-origin browser intent and method before dispatch',async()=>{
 const f=fixture(),handler=createSquareS1AcceptanceV2(environment(),f.fetch);
 for(const r of [request({method:'GET'}),request({headers:{}}),request({headers:{...intent,origin:'https://other.invalid'}}),
  request({headers:{...intent,'sec-fetch-site':'same-site'}}),request({body:'{}'}),new Request(endpoint+'?q=1',{method:'POST',headers:intent})]){
  const body=await (await handler(r)).json();assert.equal(body.result,'S1_BLOCKED');assert.equal(body.providerDispatched,false);assert.equal(body.requestCount,0);
 }
 assert.equal(f.calls.length,0);
});

test('R6 PASS and concurrent streamed one-shot issue only two exact Sandbox fetches',async()=>{
 const f=fixture(),handler=createSquareS1AcceptanceV2(environment(),f.fetch);
 const streamed=()=>request({body:new ReadableStream({start(c){c.close();}}),duplex:'half'} as RequestInit);
 const responses=await Promise.all([handler(streamed()),handler(streamed())]);
 assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
 const body=await responses.find(r=>r.status===200)!.json();
 assert.equal(body.result,'S1_PASS');assert.equal(body.stage,'LOCATION');assert.equal(body.providerDispatched,true);assert.equal(body.requestCount,2);
 assert.equal(body.summary.cardProcessingCapability,true);assert.equal(body.summary.merchantCountry,'JP');assert.equal(body.summary.locationCurrency,'JPY');
 assert.deepEqual(f.calls.map(c=>c.url),[SQUARE_SANDBOX_ORIGIN+'/v2/merchants/me',SQUARE_SANDBOX_ORIGIN+'/v2/locations']);
 for(const c of f.calls){assert.equal(c.init.method,'GET');assert.equal(c.init.redirect,'error');assert.equal(c.init.credentials,'omit');assert.equal(new Headers(c.init.headers).get('Square-Version'),SQUARE_VERSION);}
});

test('R6 merchant failures terminate before locations and cannot be retried',async()=>{
 for(const [response,reason] of [[Response.json({}, {status:401}),'AUTH_FAILED'],[Response.json({}, {status:503}),'PROVIDER_FAILURE'],
  [Response.json({merchant:merchant({country:'US'})}),'SANDBOX_COUNTRY_MISMATCH'],
  [Response.json({merchant:merchant({currency:'USD'})}),'CURRENCY_MISMATCH']] as const){
  const f=fixture([response]),handler=createSquareS1AcceptanceV2(environment(),f.fetch),r=await handler(request()),body=await r.json();
  assert.equal(r.status,422);assert.equal(body.result,'S1_FAIL');assert.equal(body.stage,'MERCHANT');assert.equal(body.reason,reason);assert.equal(body.requestCount,1);
  assert.equal((await handler(request())).status,409);assert.equal(f.calls.length,1);
 }
});

test('R6 location mismatch/state/capability results preserve their bounded evidence',async()=>{
 for(const [locations,reason,result] of [
  [[],'LOCATION_NOT_FOUND','S1_FAIL'],[[location({id:'other-location'})],'LOCATION_ID_MISMATCH','S1_FAIL'],
  [[location({merchant_id:'other-merchant'})],'MERCHANT_MISMATCH','S1_FAIL'],
  [[location({status:'INACTIVE'})],'LOCATION_INACTIVE','S1_FAIL'],[[location({capabilities:[]})],'CAPABILITY_MISSING','S1_WARNING'],
 ] as const){
  const f=fixture([Response.json({merchant:merchant()}),Response.json({locations})]);
  const body=await (await createSquareS1AcceptanceV2(environment(),f.fetch)(request())).json();
  assert.equal(body.result,result);assert.equal(body.stage,'LOCATION');assert.equal(body.reason,reason);assert.equal(body.requestCount,2);assert.equal(f.calls.length,2);
 }
});

test('R6 network/unknown outcome stays structured and never retries',async()=>{
 const env=environment(),f=fixture([new Error(env.SQUARE_SANDBOX_ACCESS_TOKEN)]),handler=createSquareS1AcceptanceV2(env,f.fetch);
 const response=await handler(request()),body=await response.json();
 assert.equal(response.status,503);assert.equal(body.result,'UNKNOWN_DO_NOT_RETRY');assert.equal(body.reason,'NETWORK_FAILURE');
 assert.equal(body.stage,'MERCHANT');assert.equal(body.providerDispatched,true);assert.equal(body.requestCount,1);
 assert.ok(!JSON.stringify(body).includes(env.SQUARE_SANDBOX_ACCESS_TOKEN));assert.equal((await handler(request())).status,409);assert.equal(f.calls.length,1);
});

test('R6 reflected token and raw provider diagnostics never appear in safe output',async()=>{
 const env=environment(),token=env.SQUARE_SANDBOX_ACCESS_TOKEN;
 for(const responses of [[Response.json({merchant:merchant({id:token})}),Response.json({locations:[location({merchant_id:token})]})],
  [Response.json({errors:[{detail:token}],raw:token})]]){
  const f=fixture(responses),body=await (await createSquareS1AcceptanceV2(env,f.fetch)(request())).json();
  assert.equal(body.result,'S1_FAIL');assert.equal(body.reason,'SCHEMA_MISMATCH');assert.ok(!JSON.stringify(body).includes(token));
 }
});

test('R6 unexpected pre-dispatch internal exception has structured zero-dispatch output',async()=>{
 const env=environment(),f=fixture(),handler=createSquareS1AcceptanceV2(env,f.fetch),r=request();
 Object.defineProperty(r,'body',{get(){throw new Error(env.SQUARE_SANDBOX_ACCESS_TOKEN);}});
 const body=await (await handler(r)).json();assert.equal(body.reason,'INTERNAL_EXCEPTION');assert.equal(body.stage,'RUNTIME_PREFLIGHT');
 assert.equal(body.result,'S1_BLOCKED');assert.equal(body.providerDispatched,false);assert.equal(body.requestCount,0);assert.equal(f.calls.length,0);
 assert.ok(!JSON.stringify(body).includes(env.SQUARE_SANDBOX_ACCESS_TOKEN));
});
