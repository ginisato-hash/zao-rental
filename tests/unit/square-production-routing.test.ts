import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {RoutedSquareProductionGateway,RoutedSquareProductionRefundGateway,type ProductionStoreRoutes} from '../../packages/core/src/payment/square-production-routing';
import {FetchSquareProductionTransport,type ProductionSquareCredential} from '../../packages/core/src/payment/square-transport';
import {SQUARE_PRODUCTION_ORIGIN} from '../../packages/core/src/payment/square-engine';
import type {PaymentRequest} from '../../packages/contracts/src/rental-flow';
import type {RefundRequest} from '../../packages/core/src/operations/financial';

// Synthetic identifiers only; every fetch below is an injected recorder, never the network.
const merchantId='SYNTHETIC-MERCHANT',MOUNTAIN='SYNTHETIC-LOC-MOUNTAIN',ONSEN='SYNTHETIC-LOC-ONSEN';
type Call={location:string;url:string;method:string;body:Record<string,unknown>|null;token:string};
function harness(opts:{reply?:(c:Call)=>Promise<Response>;credentialLocation?:Partial<Record<string,string>>}={}){
 const calls:Call[]=[],reads:string[]=[];
 const transport=(locationId:string)=>new FetchSquareProductionTransport(merchantId,locationId,async()=>{reads.push(locationId);return {environment:'PRODUCTION',merchantId,locationId:opts.credentialLocation?.[locationId]??locationId,accessToken:'synthetic-token-'+locationId,expiresAt:new Date('2099-01-01'),revoked:false} satisfies ProductionSquareCredential;},async(url,init)=>{
  const body=init.body?JSON.parse(String(init.body)) as Record<string,unknown>:null,call={location:locationId,url,method:String(init.method),body,token:String((init.headers as Record<string,string>).Authorization)};calls.push(call);
  if(opts.reply)return opts.reply(call);
  if(url.includes('/v2/refunds'))return Response.json({refund:{id:'synthetic-refund-'+locationId,payment_id:body?.payment_id??'synthetic-payment',location_id:locationId,amount_money:{amount:3000,currency:'JPY'},status:'PENDING',updated_at:'2035-01-01T01:00:00Z'}});
  return Response.json({payment:{id:'synthetic-payment-'+locationId,reference_id:body?.reference_id??paymentFor(locationId).bookingId,location_id:locationId,amount_money:{amount:7500,currency:'JPY'},status:'COMPLETED',updated_at:'2035-01-01T01:00:00Z',card_details:{card_payment_timeline:{captured_at:'2035-01-01T01:00:00Z'}}}});
 });
 const routes:ProductionStoreRoutes={MOUNTAIN_BASE:{locationId:MOUNTAIN,transport:transport(MOUNTAIN)},ONSEN_BASE:{locationId:ONSEN,transport:transport(ONSEN)}};
 return {calls,reads,routes,payment:new RoutedSquareProductionGateway(merchantId,routes),refunds:new RoutedSquareProductionRefundGateway(merchantId,routes)};
}
const bookingIds=new Map<string,string>();
function paymentFor(locationId:string):PaymentRequest{const bookingId=bookingIds.get(locationId)??randomUUID();bookingIds.set(locationId,bookingId);return {attemptId:randomUUID(),bookingId,idempotencyKey:randomUUID(),merchantId,locationId,amountJpy:7500,currency:'JPY'};}
function refundFor(locationId:string):RefundRequest{return {id:randomUUID(),bookingId:randomUUID(),idempotencyKey:randomUUID(),paymentProviderId:'synthetic-payment',merchantId,locationId,amountJpy:3000,currency:'JPY'};}

test('payment router: each store request reaches only its own location-bound transport',async()=>{
 for(const location of [MOUNTAIN,ONSEN]){const x=harness(),r=paymentFor(location);
  const o=await x.payment.create(r,'synthetic-card-token');assert.equal(o.locationId,location);
  assert.deepEqual(x.calls.map(c=>[c.location,c.body?.location_id]),[[location,location]]);assert.deepEqual(x.reads,[location]);
  assert.equal(x.calls[0]!.url,SQUARE_PRODUCTION_ORIGIN+'/v2/payments');assert.equal(x.calls[0]!.token,'Bearer synthetic-token-'+location);
  await x.payment.lookup(r,'synthetic-payment-'+location);assert.deepEqual(x.calls.map(c=>c.location),[location,location]);
 }
});
test('payment router: unknown location and merchant mismatch fail before any credential read or fetch',async()=>{
 const x=harness();
 await assert.rejects(x.payment.create({...paymentFor(MOUNTAIN),locationId:'SYNTHETIC-LOC-OTHER'},'synthetic-card-token'),{code:'PAYMENT_LOCATION_UNROUTED'});
 await assert.rejects(x.payment.lookup({...paymentFor(ONSEN),locationId:'SYNTHETIC-LOC-OTHER'},'synthetic-payment'),{code:'PAYMENT_LOCATION_UNROUTED'});
 await assert.rejects(x.payment.create({...paymentFor(MOUNTAIN),merchantId:'SYNTHETIC-OTHER-MERCHANT'},'synthetic-card-token'),{code:'PAYMENT_EVIDENCE_MISMATCH'});
 assert.equal(x.calls.length,0);assert.equal(x.reads.length,0);
});
test('payment router: crossed credential or crossed wiring is rejected, never silently routed',async()=>{
 const crossed=harness({credentialLocation:{[MOUNTAIN]:ONSEN}});
 await assert.rejects(crossed.payment.create(paymentFor(MOUNTAIN),'synthetic-card-token'),{code:'SQUARE_AUTH_STOP'});assert.equal(crossed.calls.length,0);
 const x=harness();
 for(const routes of [
  {...x.routes,MOUNTAIN_BASE:{locationId:MOUNTAIN,transport:x.routes.ONSEN_BASE.transport}},
  {...x.routes,ONSEN_BASE:{locationId:MOUNTAIN,transport:x.routes.MOUNTAIN_BASE.transport}},
  {MOUNTAIN_BASE:x.routes.MOUNTAIN_BASE} as unknown as ProductionStoreRoutes,
  {...x.routes,MOUNTAIN_BASE:{locationId:MOUNTAIN,transport:new FetchSquareProductionTransport('SYNTHETIC-OTHER-MERCHANT',MOUNTAIN,async()=>{throw Error('UNREACHABLE');},async()=>{throw Error('UNREACHABLE');})}},
  {...x.routes,MOUNTAIN_BASE:{locationId:MOUNTAIN,transport:{...x.routes.MOUNTAIN_BASE.transport,environment:'SANDBOX'} as never}},
 ]){
  assert.throws(()=>new RoutedSquareProductionGateway(merchantId,routes),{code:'SQUARE_CONFIGURATION_INVALID'});
  assert.throws(()=>new RoutedSquareProductionRefundGateway(merchantId,routes),{code:'SQUARE_CONFIGURATION_INVALID'});
 }
});
test('payment router: card token stays transient and UNKNOWN semantics are unchanged (one POST, no retry)',async()=>{
 const x=harness(),r=paymentFor(ONSEN);
 await assert.rejects(x.payment.create(r),{code:'PAYMENT_SOURCE_NOT_CONNECTED'});assert.equal(x.calls.length,0);
 await x.payment.create(r,'synthetic-card-token');assert.equal(x.calls[0]!.body?.source_id,'synthetic-card-token');assert.equal(x.calls[0]!.body?.idempotency_key,r.idempotencyKey);
 await assert.rejects(x.payment.create(r),{code:'PAYMENT_SOURCE_NOT_CONNECTED'});assert.equal(x.calls.length,1);
 const lost=harness({reply:async()=>{throw Error('SYNTHETIC_LOST_RESPONSE');}}),u=paymentFor(MOUNTAIN);
 await assert.rejects(lost.payment.create(u,'synthetic-card-token'),{code:'PAYMENT_RESULT_UNKNOWN'});assert.equal(lost.calls.length,1);
 await assert.rejects(lost.payment.lookup(u,null),{code:'PAYMENT_PROVIDER_ID_UNRESOLVED'});assert.equal(lost.calls.length,1);
});
test('refund router: each store refund reaches only its own transport with the stable idempotency key',async()=>{
 for(const location of [MOUNTAIN,ONSEN]){const x=harness(),r=refundFor(location);
  const o=await x.refunds.create(r);assert.equal(o.locationId,location);
  assert.deepEqual(x.calls.map(c=>[c.location,c.method,c.body?.idempotency_key]),[[location,'POST',r.idempotencyKey]]);
  await x.refunds.lookup(r,'synthetic-refund-'+location);assert.deepEqual(x.calls.map(c=>[c.location,c.method]),[[location,'POST'],[location,'GET']]);
 }
});
test('refund router: wrong location, missing location and merchant mismatch fail closed before the provider',async()=>{
 const x=harness();
 for(const locationId of ['SYNTHETIC-LOC-OTHER',''])await assert.rejects(x.refunds.create({...refundFor(MOUNTAIN),locationId}),{code:'REFUND_LOCATION_UNROUTED'});
 await assert.rejects(x.refunds.create({...refundFor(ONSEN),merchantId:'SYNTHETIC-OTHER-MERCHANT'}),{code:'REFUND_EVIDENCE_MISMATCH'});
 assert.equal(x.calls.length,0);assert.equal(x.reads.length,0);
});
test('refund router: UNKNOWN stays UNKNOWN with exactly one POST and no invented lookup',async()=>{
 const lost=harness({reply:async()=>{throw Error('SYNTHETIC_LOST_RESPONSE');}}),r=refundFor(ONSEN);
 // The shared transport labels a lost response with its existing uncertain code; the refund
 // worker persists any thrown dispatch error as durable UNKNOWN (cancellation-refund-worker.ts).
 await assert.rejects(lost.refunds.create(r),{code:'PAYMENT_RESULT_UNKNOWN'});assert.equal(lost.calls.length,1);
 const slow=harness({reply:()=>new Promise(()=>{})});
 await assert.rejects(new RoutedSquareProductionRefundGateway(merchantId,slow.routes,1).create(r),{code:'REFUND_RESULT_UNKNOWN'});assert.equal(slow.calls.length,1);
 await assert.rejects(lost.refunds.lookup(r,null),{code:'REFUND_PROVIDER_ID_UNRESOLVED'});assert.equal(lost.calls.length,1);
});
