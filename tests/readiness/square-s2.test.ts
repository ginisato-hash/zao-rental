import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {createSquareS2Acceptance,s2Preflight} from '../../apps/web/src/lib/square-s2-acceptance';
import {s2Operation,exactS2Manifest,s2Request,S2_MANIFEST_HASH,SquareS2Service,SquareS2Transport} from '../../packages/core/src/payment/square-s2';
import {flowHash} from '../../packages/contracts/src/rental-flow';
import {squareCreateBody} from '../../packages/core/src/payment/square-boundary';
import {SQUARE_VERSION,SQUARE_SANDBOX_ORIGIN,type SquareCall} from '../../packages/core/src/payment/square-sandbox';

const env=(overrides:Record<string,string|undefined>={})=>({VERCEL_ENV:'preview',SQUARE_ENVIRONMENT:'SANDBOX',SQUARE_API_VERSION:SQUARE_VERSION,
 SQUARE_SANDBOX_MERCHANT_ID:s2Operation.merchantId,SQUARE_SANDBOX_APPLICATION_ID:'fixture-app',SQUARE_SANDBOX_LOCATION_ID:'fixture-location',SQUARE_SANDBOX_ACCESS_TOKEN:randomBytes(32).toString('base64url'),...overrides});
const origin='https://fixture.invalid';
const intent={'X-ZAO-Acceptance':'SQUARE_S2_R9','sec-fetch-site':'same-origin',origin};
const req=(init:RequestInit={})=>new Request(origin+'/api/internal/acceptance/square-s2',{method:'POST',headers:intent,...init});
const payment=(override:Record<string,unknown>={})=>({id:'fixturePayment_1',reference_id:s2Operation.bookingId,location_id:'fixture-location',
 amount_money:{amount:100,currency:'JPY'},status:'COMPLETED',updated_at:'2026-09-15T01:00:00Z',card_details:{card_payment_timeline:{captured_at:'2026-09-15T00:59:59Z'}},...override});
function fixture(responses:(Response|Error)[]=[Response.json({payment:payment()})]){
 const calls:{url:string;init:RequestInit}[]=[];
 return {calls,fetch:async(url:string,init:RequestInit)=>{calls.push({url,init});const r=responses.shift();if(r instanceof Error)throw r;if(!r)throw new Error('UNEXPECTED_CALL');return r;}};
}
test('R9 immutable manifest and fingerprint match; any identity/amount/source/key change fails',()=>{
 assert.ok(exactS2Manifest());assert.equal(flowHash(s2Operation),S2_MANIFEST_HASH);
 assert.equal(Object.isFrozen(s2Operation),true);
 for(const override of [{amountJpy:101},{sourceId:'CASH'},{idempotencyKey:randomUUID()},{merchantId:'other'},{retry:1}])assert.equal(exactS2Manifest({...s2Operation,...override}),false);
 assert.equal(flowHash(s2Request('fixture-location')),flowHash(s2Request('fixture-location')));
});
test('R9 preflight is provider-free, booleans/enums only; local guard verification is explicitly separate',async()=>{
 const e=env(),f=fixture(),h=createSquareS2Acceptance(e,f.fetch);
 for(let i=0;i<2;i++){const r=await h.preflight(req({method:'GET'})),b=await r.json();assert.equal(r.status,200);assert.equal(b.readyForS2,true);assert.equal(b.operationManifestExact,true);assert.equal(b.operatorGuard,'LOCAL_EXCLUSIVE_FSYNC_CHECK_REQUIRED');assert.ok(!JSON.stringify(b).includes(e.SQUARE_SANDBOX_ACCESS_TOKEN));}
 assert.equal(f.calls.length,0);
});
for(const override of [{VERCEL_ENV:'production'},{VERCEL_ENV:undefined},{SQUARE_ENVIRONMENT:'PRODUCTION'},{SQUARE_API_VERSION:'2025-01-01'},
 {SQUARE_SANDBOX_MERCHANT_ID:'other'},{SQUARE_SANDBOX_APPLICATION_ID:undefined},{SQUARE_SANDBOX_LOCATION_ID:undefined},{SQUARE_SANDBOX_ACCESS_TOKEN:undefined},
 {SQUARE_SANDBOX_ACCESS_TOKEN:'invalid token'},{NEXT_PUBLIC_SQUARE_ACCESS_TOKEN:'fixture-public'}]){
 test('R9 runtime preflight blocks '+Object.keys(override)[0]+' '+Object.values(override)[0],async()=>{
  const e=env(override),f=fixture(),h=createSquareS2Acceptance(e,f.fetch);assert.equal(s2Preflight(e).readyForS2,false);
  assert.equal((await (await h.post(req())).json()).classification,'BLOCKED_NOT_DISPATCHED');assert.equal(f.calls.length,0);
 });
}
test('R9 client body/query/method/origin/intent cannot supply payment parameters',async()=>{
 const f=fixture(),h=createSquareS2Acceptance(env(),f.fetch);
 const inject={amount:1,source:'CASH',merchant:'other',location:'other',bookingId:randomUUID(),idempotencyKey:randomUUID()};
 for(const r of [req({body:JSON.stringify(inject)}),req({method:'GET'}),req({headers:{}}),req({headers:{...intent,origin:'https://evil.invalid'}}),
 req({headers:{...intent,'sec-fetch-site':'same-site'}}),new Request(origin+'/api/internal/acceptance/square-s2?amount=1',{method:'POST',headers:intent})]){
  assert.equal((await (await h.post(r)).json()).classification,'BLOCKED_NOT_DISPATCHED');
 }
 assert.equal(f.calls.length,0);
});
test('R9 exact completed payment PASS uses one create and zero unnecessary lookup',async()=>{
 const e=env(),f=fixture(),h=createSquareS2Acceptance(e,f.fetch),response=await h.post(req()),b=await response.json();
 assert.equal(response.status,200);assert.equal(b.classification,'S2_PASS');assert.equal(b.amountJpy,100);assert.equal(b.currency,'JPY');
 assert.equal(b.referenceMatch,true);assert.equal(b.locationMatch,true);assert.equal(b.createPaymentCount,1);assert.equal(b.conditionalGetPaymentCount,0);
 assert.equal(b.providerPaymentId,'fixturePayment_1');assert.equal(b.completedAt,'2026-09-15T00:59:59.000Z');assert.equal(f.calls.length,1);
 const call=f.calls[0]!;assert.equal(call.url,SQUARE_SANDBOX_ORIGIN+'/v2/payments');assert.equal(call.init.method,'POST');
 assert.deepEqual(JSON.parse(String(call.init.body)),squareCreateBody(s2Request('fixture-location'),'cnon:card-nonce-ok'));
 assert.equal(call.init.redirect,'error');assert.equal(call.init.credentials,'omit');assert.equal(call.init.cache,'no-store');
 assert.equal(new Headers(call.init.headers).get('Square-Version'),SQUARE_VERSION);assert.ok(!JSON.stringify(b).includes(e.SQUARE_SANDBOX_ACCESS_TOKEN));
 assert.equal((await h.post(req())).status,409);assert.equal((await h.preflight(req({method:'GET'}))).status,503);assert.equal(f.calls.length,1);
});
test('R9 same-instance concurrent empty streams allow one controlled create',async()=>{
 const f=fixture(),h=createSquareS2Acceptance(env(),f.fetch);
 const stream=()=>req({body:new ReadableStream({start(c){c.close();}}),duplex:'half'} as RequestInit);
 const rs=await Promise.all([h.post(stream()),h.post(stream())]);assert.deepEqual(rs.map(r=>r.status).sort(),[200,409]);assert.equal(f.calls.length,1);
});
test('R9 pending safe ID allows exactly one conditional GET; same key is never POSTed twice',async()=>{
 const f=fixture([Response.json({payment:payment({status:'PENDING'})}),Response.json({payment:payment()})]);
 const b=await (await createSquareS2Acceptance(env(),f.fetch).post(req())).json();assert.equal(b.classification,'S2_PASS');assert.equal(b.conditionalGetPaymentCount,1);
 assert.deepEqual(f.calls.map(c=>[c.init.method,c.url]),[['POST',SQUARE_SANDBOX_ORIGIN+'/v2/payments'],['GET',SQUARE_SANDBOX_ORIGIN+'/v2/payments/fixturePayment_1']]);
});
test('R9 still-pending lookup stops; malformed or absent provider ID never looks up',async()=>{
 const f=fixture([Response.json({payment:payment({status:'PENDING'})}),Response.json({payment:payment({status:'PENDING'})})]);
 assert.equal((await (await createSquareS2Acceptance(env(),f.fetch).post(req())).json()).classification,'UNKNOWN_DO_NOT_RETRY');assert.equal(f.calls.length,2);
 for(const body of [{}, {payment:{id:'bad/id'}}, {payment:{id:undefined}}]){
  const g=fixture([Response.json(body)]),h=createSquareS2Acceptance(env(),g.fetch),b=await (await h.post(req())).json();
  assert.equal(b.classification,'UNKNOWN_DO_NOT_RETRY');assert.equal(b.conditionalGetPaymentCount,0);assert.equal(g.calls.length,1);assert.equal((await h.post(req())).status,409);
 }
});
test('R9 money/reference/location mismatches fail without lookup',async()=>{
 for(const x of [{amount_money:{amount:101,currency:'JPY'}},{amount_money:{amount:100,currency:'USD'}},{reference_id:randomUUID()},{location_id:'other'}]){
  const f=fixture([Response.json({payment:payment(x)})]),b=await (await createSquareS2Acceptance(env(),f.fetch).post(req())).json();
  assert.equal(b.classification,'S2_FAIL_EVIDENCE');assert.equal(f.calls.length,1);
 }
});
test('R9 missing/invalid completion date is not PASS; one safe-ID lookup still must satisfy timestamps',async()=>{
 for(const x of [{updated_at:'invalid'},{card_details:{}},{status:'INVALID'}]){
  const f=fixture([Response.json({payment:payment(x)}),Response.json({payment:payment(x)})]);
  const b=await (await createSquareS2Acceptance(env(),f.fetch).post(req())).json();assert.equal(b.classification,'UNKNOWN_DO_NOT_RETRY');assert.equal(f.calls.length,2);
 }
});
test('R9 lookup ID mismatch cannot establish PASS',async()=>{
 const f=fixture([Response.json({payment:payment({status:'PENDING'})}),Response.json({payment:payment({id:'otherPayment'})})]);
 const b=await (await createSquareS2Acceptance(env(),f.fetch).post(req())).json();assert.equal(b.classification,'S2_FAIL_EVIDENCE');assert.equal(f.calls.length,2);
});
for(const [status,classification] of [[401,'S2_FAIL_AUTH'],[403,'S2_FAIL_AUTH'],[429,'S2_FAIL_RATE_LIMIT'],[400,'S2_FAIL_PROVIDER'],[500,'UNKNOWN_DO_NOT_RETRY']] as const){
 test('R9 HTTP '+status+' stops without retry',async()=>{
  const e=env(),f=fixture([Response.json({errors:[{detail:e.SQUARE_SANDBOX_ACCESS_TOKEN}]},{status})]),h=createSquareS2Acceptance(e,f.fetch),b=await (await h.post(req())).json();
  assert.equal(b.classification,classification);assert.equal(b.httpResults.create,status);assert.equal(f.calls.length,1);assert.ok(!JSON.stringify(b).includes(e.SQUARE_SANDBOX_ACCESS_TOKEN));assert.equal((await h.post(req())).status,409);
 });
}
test('R9 network/parse/secret-reflection failures never leak raw response or exception',async()=>{
 const e=env();
 for(const response of [new Error(e.SQUARE_SANDBOX_ACCESS_TOKEN),new Response(e.SQUARE_SANDBOX_ACCESS_TOKEN,{headers:{'Content-Type':'application/json'}}),Response.json({payment:payment({id:e.SQUARE_SANDBOX_ACCESS_TOKEN}),card_data:'DO_NOT_SAVE'})]){
  const f=fixture([response]),b=await (await createSquareS2Acceptance(e,f.fetch).post(req())).json();
  assert.notEqual(b.classification,'S2_PASS');assert.ok(!JSON.stringify(b).includes(e.SQUARE_SANDBOX_ACCESS_TOKEN));assert.ok(!JSON.stringify(b).includes('DO_NOT_SAVE'));assert.equal(f.calls.length,1);
 }
 assert.equal(s2Preflight({...e,NEXT_PUBLIC_LABEL:e.SQUARE_SANDBOX_ACCESS_TOKEN}).readyForS2,false);
});
test('R9 timeout aborts and preserves UNKNOWN; ignored transport does not create a retry',async()=>{
 const e=env(),r=s2Request('fixture-location');let calls=0,aborted=false;
 const t=new SquareS2Transport(r,()=>e.SQUARE_SANDBOX_ACCESS_TOKEN,async(_url,init)=>{calls++;init.signal?.addEventListener('abort',()=>{aborted=true;});return new Promise<Response>(()=>{});});
 const service=new SquareS2Service(r,t,()=>e.SQUARE_SANDBOX_ACCESS_TOKEN,10),result=await service.run();assert.equal(result.classification,'UNKNOWN_DO_NOT_RETRY');assert.equal(calls,1);assert.equal(aborted,true);await assert.rejects(()=>service.run());
});
test('R9 narrow transport rejects Production, refund, S1, query, wrong source/key/amount before credential access',async()=>{
 const r=s2Request('fixture-location');let secrets=0,calls=0;
 const t=new SquareS2Transport(r,()=>{secrets++;return 'fixture-token';},async()=>{calls++;return Response.json({});});
 const base:SquareCall={method:'POST',url:SQUARE_SANDBOX_ORIGIN+'/v2/payments',version:SQUARE_VERSION,body:squareCreateBody(r,'cnon:card-nonce-ok'),signal:new AbortController().signal};
 for(const c of [{...base,url:'https://connect.squareup.com/v2/payments'},{...base,url:SQUARE_SANDBOX_ORIGIN+'/v2/refunds'},
 {...base,url:SQUARE_SANDBOX_ORIGIN+'/v2/merchants/me'},{...base,url:base.url+'?x=1'},
 {...base,body:squareCreateBody({...r,amountJpy:101},'cnon:card-nonce-ok')},{...base,body:squareCreateBody({...r,idempotencyKey:randomUUID()},'cnon:card-nonce-ok')},{...base,body:squareCreateBody(r,'CASH')}])await assert.rejects(()=>t.send(c));
 assert.equal(secrets,0);assert.equal(calls,0);
 assert.throws(()=>new SquareS2Transport({...r,amountJpy:101},()=>'',async()=>Response.json({})));
});
