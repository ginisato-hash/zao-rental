import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {createSquareS3Acceptance,s3Preflight} from '../../apps/web/src/lib/square-s3-acceptance';
import {s3Operation,exactS3Manifest,s3RefundBody,S3_MANIFEST_HASH,type S3Call,SquareS3Service,SquareS3Transport} from '../../packages/core/src/payment/square-s3';
import {s2Operation} from '../../packages/core/src/payment/square-s2';
import {flowHash} from '../../packages/contracts/src/rental-flow';
import {SQUARE_VERSION,SQUARE_SANDBOX_ORIGIN,type SquareCall} from '../../packages/core/src/payment/square-sandbox';
import {SandboxRefundTrial} from '../../packages/core/src/payment/sandbox-refund';
import type {SandboxActivationJournal} from '../../packages/core/src/payment/sandbox-activation';

const env=(x:Record<string,string|undefined>={})=>({VERCEL_ENV:'preview',SQUARE_ENVIRONMENT:'SANDBOX',SQUARE_API_VERSION:SQUARE_VERSION,
 SQUARE_SANDBOX_MERCHANT_ID:s3Operation.merchantId,SQUARE_SANDBOX_APPLICATION_ID:'fixture-app',SQUARE_SANDBOX_LOCATION_ID:'fixture-location',SQUARE_SANDBOX_ACCESS_TOKEN:randomBytes(32).toString('base64url'),...x});
const origin='https://fixture.invalid',intent={'X-ZAO-Acceptance':'SQUARE_S3_R10','sec-fetch-site':'same-origin',origin};
const req=(init:RequestInit={})=>new Request(origin+'/api/internal/acceptance/square-s3',{method:'POST',headers:intent,...init});
const payment=(x:Record<string,unknown>={})=>({id:s3Operation.paymentId,reference_id:s2Operation.bookingId,location_id:'fixture-location',
 amount_money:{amount:100,currency:'JPY'},total_money:{amount:100,currency:'JPY'},refunded_money:{amount:0,currency:'JPY'},refund_ids:[],status:'COMPLETED',
 updated_at:'2026-09-15T01:00:00Z',card_details:{card_payment_timeline:{captured_at:'2026-09-15T00:59:59Z'}},...x});
const refund=(x:Record<string,unknown>={})=>({id:'fixture_refund_1',payment_id:s3Operation.paymentId,location_id:'fixture-location',amount_money:{amount:100,currency:'JPY'},status:'COMPLETED',...x});
function fixture(responses:(Response|Error)[]=[Response.json({payment:payment()}),Response.json({refund:refund()})]){
 const calls:{url:string;init:RequestInit}[]=[];
 return {calls,fetch:async(url:string,init:RequestInit)=>{calls.push({url,init});const r=responses.shift();if(r instanceof Error)throw r;if(!r)throw new Error('UNEXPECTED_CALL');return r;}};
}
test('R10 immutable manifest pins existing payment/100JPY/key/reason and rejects altered identity',()=>{
 assert.ok(exactS3Manifest());assert.equal(flowHash(s3Operation),S3_MANIFEST_HASH);assert.ok(Object.isFrozen(s3Operation));
 for(const x of [{paymentId:'other'},{refundAmountJpy:99},{refundIdempotencyKey:randomUUID()},{retry:1},{merchantId:'other'},{reason:'P4'},{production:true}])assert.equal(exactS3Manifest({...s3Operation,...x}),false);
 assert.deepEqual(s3RefundBody(),{idempotency_key:s3Operation.refundIdempotencyKey,payment_id:s3Operation.paymentId,amount_money:{amount:100,currency:'JPY'},reason:'SYNTHETIC_R10_S3_SANDBOX_ACCEPTANCE_FULL_REFUND'});
});
test('R10 preflight has no provider call and exposes only safe flags/enums',async()=>{
 const e=env(),f=fixture(),h=createSquareS3Acceptance(e,f.fetch);
 const r=await h.preflight(req({method:'GET'})),b=await r.json();assert.equal(r.status,200);
 assert.equal(b.readyForS3,true);assert.equal(b.paymentExact,true);assert.equal(b.refundAmountExact,true);assert.equal(b.operationManifestExact,true);
 assert.ok(!JSON.stringify(b).includes(e.SQUARE_SANDBOX_ACCESS_TOKEN));assert.equal(f.calls.length,0);
});
for(const x of [{VERCEL_ENV:'production'},{VERCEL_ENV:undefined},{SQUARE_ENVIRONMENT:'PRODUCTION'},{SQUARE_API_VERSION:'2025-01-01'},
 {SQUARE_SANDBOX_MERCHANT_ID:'other'},{SQUARE_SANDBOX_APPLICATION_ID:undefined},{SQUARE_SANDBOX_LOCATION_ID:undefined},{SQUARE_SANDBOX_ACCESS_TOKEN:undefined},
 {SQUARE_SANDBOX_ACCESS_TOKEN:'invalid token'},{NEXT_PUBLIC_SQUARE_ACCESS_TOKEN:'fixture-public'}]){
 test('R10 preflight blocks '+Object.keys(x)[0]+' '+Object.values(x)[0],async()=>{
  const e=env(x),f=fixture(),h=createSquareS3Acceptance(e,f.fetch);assert.equal(s3Preflight(e).readyForS3,false);
  assert.equal((await (await h.post(req())).json()).classification,'BLOCKED_NOT_DISPATCHED');assert.equal(f.calls.length,0);
 });
}
test('R10 operator cannot inject payment/amount/key/location/query/body/method/origin',async()=>{
 const f=fixture(),h=createSquareS3Acceptance(env(),f.fetch);
 for(const r of [req({body:JSON.stringify({paymentId:'other',amount:1,key:randomUUID(),location:'other'})}),req({method:'GET'}),req({headers:{}}),
  req({headers:{...intent,origin:'https://evil.invalid'}}),req({headers:{...intent,'sec-fetch-site':'same-site'}}),new Request(origin+'/api/internal/acceptance/square-s3?x=1',{method:'POST',headers:intent})])assert.equal((await (await h.post(r)).json()).classification,'BLOCKED_NOT_DISPATCHED');
 assert.equal(f.calls.length,0);
});
test('R10 successful lookup then exact full refund: 1GET/1POST/0conditional, no CreatePayment',async()=>{
 const e=env(),f=fixture(),h=createSquareS3Acceptance(e,f.fetch),response=await h.post(req()),b=await response.json();
 assert.equal(response.status,200);assert.equal(b.classification,'S3_PASS');assert.equal(b.paymentStatus,'COMPLETED');assert.equal(b.refundStatus,'COMPLETED');
 assert.equal(b.amountJpy,100);assert.equal(b.referenceMatch,true);assert.equal(b.paymentLocationMatch,true);assert.equal(b.refundLocationMatch,true);
 assert.deepEqual([b.paymentLookupCount,b.refundPostCount,b.conditionalGetRefundCount],[1,1,0]);assert.equal(b.refundId,'fixture_refund_1');
 assert.deepEqual(f.calls.map(c=>[c.init.method,c.url]),[['GET',SQUARE_SANDBOX_ORIGIN+'/v2/payments/'+s3Operation.paymentId],['POST',SQUARE_SANDBOX_ORIGIN+'/v2/refunds']]);
 assert.equal(f.calls[0]!.init.body,undefined);assert.deepEqual(JSON.parse(String(f.calls[1]!.init.body)),s3RefundBody());
 for(const c of f.calls){assert.equal(c.init.redirect,'error');assert.equal(c.init.cache,'no-store');assert.equal(c.init.credentials,'omit');assert.equal(new Headers(c.init.headers).get('Square-Version'),SQUARE_VERSION);}
 assert.ok(!JSON.stringify(b).includes(e.SQUARE_SANDBOX_ACCESS_TOKEN));assert.equal((await h.post(req())).status,409);assert.equal(f.calls.length,2);
});
test('R10 same-instance concurrent operator requests allow one whole workflow',async()=>{
 const f=fixture(),h=createSquareS3Acceptance(env(),f.fetch);const rs=await Promise.all([h.post(req()),h.post(req())]);
 assert.deepEqual(rs.map(r=>r.status).sort(),[200,409]);assert.equal(f.calls.length,2);
});
test('R10 mismatched or previously refunded Payment blocks refund and keeps GET budget1',async()=>{
 for(const x of [{id:'other'},{status:'PENDING'},{amount_money:{amount:101,currency:'JPY'}},{amount_money:{amount:100,currency:'USD'}},{reference_id:randomUUID()},
  {location_id:'other'},{updated_at:'invalid'},{card_details:{}},{total_money:{amount:101,currency:'JPY'}},{refunded_money:{amount:1,currency:'JPY'}},{refund_ids:['prior']}]){
  const f=fixture([Response.json({payment:payment(x)})]),b=await (await createSquareS3Acceptance(env(),f.fetch).post(req())).json();
  assert.equal(b.classification,'S3_PAYMENT_EVIDENCE_MISMATCH');assert.equal(b.refundPostCount,0);assert.equal(f.calls.length,1);
 }
});
test('R10 malformed Payment or contradictory errors cannot authorize refund',async()=>{
 for(const body of [{},{payment:null},{payment:payment(),errors:[{code:'FAIL'}]}]){
  const f=fixture([Response.json(body)]),b=await (await createSquareS3Acceptance(env(),f.fetch).post(req())).json();
  assert.equal(b.classification,'S3_PAYMENT_EVIDENCE_MISMATCH');assert.equal(f.calls.length,1);
 }
});
test('R10 only valid PENDING refund permits exactly one bound GetRefund',async()=>{
 for(const last of ['COMPLETED','PENDING','FAILED','REJECTED']){
  const f=fixture([Response.json({payment:payment()}),Response.json({refund:refund({status:'PENDING'})}),Response.json({refund:refund({status:last})})]);
  const b=await (await createSquareS3Acceptance(env(),f.fetch).post(req())).json();
  assert.equal(b.classification,last==='COMPLETED'?'S3_PASS':last==='PENDING'?'S3_NONTERMINAL_DO_NOT_RETRY':'S3_REFUND_FAILED');
  assert.deepEqual([b.paymentLookupCount,b.refundPostCount,b.conditionalGetRefundCount],[1,1,1]);assert.equal(f.calls[2]!.url,SQUARE_SANDBOX_ORIGIN+'/v2/refunds/fixture_refund_1');
 }
});
test('R10 malformed/mismatching/failed refund never triggers green-check lookup',async()=>{
 for(const x of [{id:'bad/id'},{payment_id:'other'},{location_id:'other'},{amount_money:{amount:99,currency:'JPY'}},{amount_money:{amount:100,currency:'USD'}},{status:'APPROVED'},{status:'FAILED'},{status:'REJECTED'}]){
  const f=fixture([Response.json({payment:payment()}),Response.json({refund:refund(x)})]),b=await (await createSquareS3Acceptance(env(),f.fetch).post(req())).json();
  assert.equal(b.classification,['FAILED','REJECTED'].includes(String(x.status))?'S3_REFUND_FAILED':'S3_REFUND_EVIDENCE_MISMATCH');assert.equal(f.calls.length,2);assert.equal(b.conditionalGetRefundCount,0);
 }
});
test('R10 conditional refund lookup must preserve exact refund ID and all evidence',async()=>{
 for(const x of [{id:'anotherRefund'},{payment_id:'other'},{amount_money:{amount:1,currency:'JPY' as const}},{location_id:'other'}]){
  const f=fixture([Response.json({payment:payment()}),Response.json({refund:refund({status:'PENDING'})}),Response.json({refund:refund(x)})]);
  const b=await (await createSquareS3Acceptance(env(),f.fetch).post(req())).json();assert.equal(b.classification,'S3_REFUND_EVIDENCE_MISMATCH');assert.equal(f.calls.length,3);
 }
});
for(const phase of ['payment','refund','refundLookup'])for(const status of [401,403,429,404,400,500]){
 test('R10 '+phase+' HTTP'+status+' stops without automatic/manual retry',async()=>{
  const e=env(),responses=[];
  if(phase!=='payment')responses.push(Response.json({payment:payment()}));
  if(phase==='refundLookup')responses.push(Response.json({refund:refund({status:'PENDING'})}));
  responses.push(Response.json({errors:[{detail:e.SQUARE_SANDBOX_ACCESS_TOKEN}]},{status}));
  const f=fixture(responses),h=createSquareS3Acceptance(e,f.fetch),b=await (await h.post(req())).json();
  const expected=status===401||status===403?'S3_FAIL_AUTH':status===429?'S3_FAIL_RATE_LIMIT':status===500?'UNKNOWN_DO_NOT_RETRY':phase==='payment'?(status===404?'S3_PAYMENT_NOT_FOUND':'S3_PAYMENT_PROVIDER_FAIL'):'S3_REFUND_PROVIDER_FAIL';
  assert.equal(b.classification,expected);assert.equal(f.calls.length,phase==='payment'?1:phase==='refund'?2:3);assert.ok(!JSON.stringify(b).includes(e.SQUARE_SANDBOX_ACCESS_TOKEN));assert.equal((await h.post(req())).status,409);
 });
}
test('R10 socket/parse/response loss stops at current call and never emits raw secrets',async()=>{
 for(const stage of [0,1,2])for(const kind of ['socket','parse']){
  const e=env(),responses:(Response|Error)[]=[];if(stage>=1)responses.push(Response.json({payment:payment()}));if(stage===2)responses.push(Response.json({refund:refund({status:'PENDING'})}));
  responses.push(kind==='socket'?new Error(e.SQUARE_SANDBOX_ACCESS_TOKEN):new Response(e.SQUARE_SANDBOX_ACCESS_TOKEN,{headers:{'Content-Type':'application/json'}}));
  const f=fixture(responses),h=createSquareS3Acceptance(e,f.fetch),b=await (await h.post(req())).json();assert.equal(b.classification,'UNKNOWN_DO_NOT_RETRY');assert.equal(f.calls.length,stage+1);assert.ok(!JSON.stringify(b).includes(e.SQUARE_SANDBOX_ACCESS_TOKEN));assert.equal((await h.post(req())).status,409);
 }
});
test('R10 reflected refund ID cannot leak server token or trigger lookup',async()=>{
 const e=env(),f=fixture([Response.json({payment:payment()}),Response.json({refund:refund({id:e.SQUARE_SANDBOX_ACCESS_TOKEN,status:'PENDING'}),card_data:'FORBIDDEN_DATA'})]);
 const b=await (await createSquareS3Acceptance(e,f.fetch).post(req())).json();assert.equal(b.classification,'S3_REFUND_EVIDENCE_MISMATCH');assert.equal(f.calls.length,2);
 assert.ok(!JSON.stringify(b).includes(e.SQUARE_SANDBOX_ACCESS_TOKEN));assert.ok(!JSON.stringify(b).includes('FORBIDDEN_DATA'));
});
test('R10 per-call timeout aborts even ignored fetch and never retries a refund',async()=>{
 for(const stall of [0,1,2]){
  const e=env();let calls=0,aborted=false;
  const t=new SquareS3Transport('fixture-location',()=>e.SQUARE_SANDBOX_ACCESS_TOKEN,async(_u,init)=>{
   const n=calls++;if(n===stall){init.signal?.addEventListener('abort',()=>{aborted=true;});return new Promise<Response>(()=>{});}
   return n===0?Response.json({payment:payment()}):Response.json({refund:refund({status:'PENDING'})});
  });
  const s=new SquareS3Service('fixture-location',t,()=>e.SQUARE_SANDBOX_ACCESS_TOKEN,10),r=await s.run();assert.equal(r.classification,'UNKNOWN_DO_NOT_RETRY');assert.equal(calls,stall+1);assert.equal(aborted,true);await assert.rejects(()=>s.run());
 }
});
test('R10 strict transport rejects wrong origin/ID/method/amount/key/reason before dispatch',async()=>{
 let calls=0,secrets=0;const t=new SquareS3Transport('fixture-location',()=>{secrets++;return 'fixture-token';},async()=>{calls++;return Response.json({payment:payment()});});
 const base:S3Call={method:'GET',url:SQUARE_SANDBOX_ORIGIN+'/v2/payments/'+s3Operation.paymentId,version:SQUARE_VERSION,signal:new AbortController().signal};
 for(const c of [{...base,url:base.url.replace('squareupsandbox','squareup')},{...base,url:base.url+'?x=1'},{...base,url:SQUARE_SANDBOX_ORIGIN+'/v2/payments/other'},
  {...base,method:'POST' as const},{...base,url:SQUARE_SANDBOX_ORIGIN+'/v2/merchants/me'},{...base,url:SQUARE_SANDBOX_ORIGIN+'/v2/refunds',method:'POST' as const,body:s3RefundBody()}])await assert.rejects(()=>t.send(c));
 assert.equal(calls,0);assert.equal(secrets,0);
 const result=await t.send(base);t.authorizeRefund(result.body);
 for(const body of [{...s3RefundBody(),payment_id:'other'},{...s3RefundBody(),amount_money:{amount:1,currency:'JPY' as const}},{...s3RefundBody(),idempotency_key:randomUUID()},{...s3RefundBody(),reason:'SYNTHETIC_P4_SANDBOX_TEST'}])await assert.rejects(()=>t.send({...base,method:'POST',url:SQUARE_SANDBOX_ORIGIN+'/v2/refunds',body}));
 assert.equal(calls,1);await assert.rejects(()=>t.send(base));
});
test('existing SandboxRefundTrial field checks remain isolated from R10 fixed reason/journal',async()=>{
 let calls=0,observed=0,unknown=0;
 const journal={reserveRefund:async()=>({call:true,locationId:'fixture-location'}),refundObserved:async()=>{observed++;},refundUnknown:async()=>{unknown++;}} as unknown as SandboxActivationJournal;
 const transport={environment:'SANDBOX' as const,merchantId:'fixture-merchant',send:async(c:SquareCall)=>{calls++;assert.ok(c.body&&'reason' in c.body);assert.equal(c.body.reason,'SYNTHETIC_P4_SANDBOX_TEST');return {status:200,body:{refund:refund()}};}};
 const trial=new SandboxRefundTrial(transport,journal);assert.equal((await trial.create(randomUUID(),s3Operation.paymentId,100)).status,'COMPLETED');
 await assert.rejects(()=>trial.create(randomUUID(),s3Operation.paymentId,99));assert.deepEqual([calls,observed,unknown],[2,1,1]);
});
