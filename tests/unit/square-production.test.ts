import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,randomUUID} from 'node:crypto';
import {SquareProductionGateway,SQUARE_PRODUCTION_ORIGIN,type SquareProductionTransport} from '../../packages/core/src/payment/square-production';
import {FetchSquareProductionTransport,type ProductionSquareCredential} from '../../packages/core/src/payment/square-transport';
import {SQUARE_VERSION,type SquareCall} from '../../packages/core/src/payment/square-engine';
import type {PaymentRequest} from '../../packages/contracts/src/rental-flow';
const request:PaymentRequest={attemptId:randomUUID(),bookingId:randomUUID(),idempotencyKey:randomUUID(),merchantId:'SYNTHETIC-MERCHANT',locationId:'SYNTHETIC-LOCATION',amountJpy:7500,currency:'JPY'};
const payment={id:'synthetic-payment',reference_id:request.bookingId,location_id:request.locationId,amount_money:{amount:7500,currency:'JPY'},status:'COMPLETED',updated_at:'2035-01-01T01:00:00Z',card_details:{card_payment_timeline:{captured_at:'2035-01-01T01:00:00Z'}}};
const credential:ProductionSquareCredential={environment:'PRODUCTION',merchantId:request.merchantId,locationId:request.locationId,accessToken:'synthetic-token-not-real',expiresAt:new Date('2099-01-01'),revoked:false};
function fixture(reply:SquareProductionTransport['send']=async()=>({status:200,body:{payment}})){
 const calls:SquareCall[]=[],gateway=new SquareProductionGateway({environment:'PRODUCTION',merchantId:request.merchantId,async send(call){calls.push(call);return reply(call);}},async()=> 'synthetic-source');return {gateway,calls};
}
test('Production reuses Square request/observation engine with exact Production origin and stable key',async()=>{
 const x=fixture();assert.equal(x.gateway.kind,'SQUARE_PRODUCTION');assert.equal((await x.gateway.create(request)).status,'COMPLETED');
 assert.equal(x.calls[0]!.url,SQUARE_PRODUCTION_ORIGIN+'/v2/payments');assert.equal(x.calls[0]!.body?.idempotency_key,request.idempotencyKey);
 await x.gateway.lookup(request,payment.id);assert.equal(x.calls[1]!.url,SQUARE_PRODUCTION_ORIGIN+'/v2/payments/'+payment.id);
});
test('Production UNKNOWN cannot trigger blind retry or invented lookup-by-key',async()=>{
 const x=fixture(async()=>{throw Error('SYNTHETIC_LOST_RESPONSE');});await assert.rejects(x.gateway.create(request),{code:'PAYMENT_RESULT_UNKNOWN'});await assert.rejects(x.gateway.lookup(request,null),{code:'PAYMENT_PROVIDER_ID_UNRESOLVED'});assert.equal(x.calls.length,1);
});
test('Production validates merchant, location, JPY, amount and completed evidence',async()=>{
 for(const patch of [{location_id:'wrong'},{amount_money:{amount:1,currency:'JPY'}},{amount_money:{amount:7500,currency:'USD'}},{reference_id:randomUUID()}])await assert.rejects(fixture(async()=>({status:200,body:{payment:{...payment,...patch}}})).gateway.create(request));
 const x=fixture();await assert.rejects(x.gateway.create({...request,merchantId:'wrong'}));assert.equal(x.calls.length,0);
});
test('Production HMAC webhook triggers GetPayment and rejects tamper; callback status is not truth',async()=>{
 const x=fixture(),url='https://synthetic.invalid/webhook',key='synthetic-signing-key',raw=Buffer.from(JSON.stringify({event_id:'synthetic-event',merchant_id:request.merchantId,type:'payment.updated',data:{object:{payment:{id:payment.id,status:'FAILED'}}}})),sig=createHmac('sha256',key).update(url).update(raw).digest('base64');
 assert.equal((await x.gateway.verifiedWebhook(request,raw,sig,url,key)).observation.status,'COMPLETED');assert.equal(x.calls[0]!.method,'GET');
 await assert.rejects(x.gateway.verifiedWebhook(request,Buffer.concat([raw,Buffer.from(' ')]),sig,url,key),{code:'WEBHOOK_SIGNATURE_REJECTED'});assert.equal(x.calls.length,1);
});
test('Production timeout and auth/quota are bounded, masked and never retried',async()=>{
 for(const [status,code] of [[401,'SQUARE_AUTH_STOP'],[429,'SQUARE_QUOTA_STOP'],[500,'PAYMENT_RESULT_UNKNOWN']] as const){const x=fixture(async()=>({status,body:{secret:'untrusted'}}));await assert.rejects(x.gateway.create(request),{code});assert.equal(x.calls.length,1);}
 let calls=0;const gateway=new SquareProductionGateway({environment:'PRODUCTION',merchantId:request.merchantId,send:()=>{calls++;return new Promise(()=>{});}},async()=> 'synthetic-source',1);await assert.rejects(gateway.create(request),{code:'PAYMENT_RESULT_UNKNOWN'});assert.equal(calls,1);
});
test('Production credential resolver pins environment/merchant/location before injected fetch',async()=>{
 let fetches=0,reads=0;
 const build=(patch:Partial<ProductionSquareCredential>={})=>new FetchSquareProductionTransport(request.merchantId,request.locationId,async()=>{reads++;return {...credential,...patch};},async(url,init)=>{fetches++;assert.equal(url,SQUARE_PRODUCTION_ORIGIN+'/v2/payments');assert.equal(init.redirect,'error');assert.equal(new Headers(init.headers).get('Authorization'),'Bearer '+credential.accessToken);return Response.json({payment});});
 const x=fixture();await x.gateway.create(request);const call=x.calls[0]!;
 await build().send(call);assert.equal(fetches,1);
 for(const patch of [{environment:'SANDBOX' as never},{merchantId:'wrong'},{locationId:'wrong'},{revoked:true},{expiresAt:new Date('2000-01-01')}])await assert.rejects(build(patch).send(call),{code:'SQUARE_AUTH_STOP'});
 assert.equal(fetches,1);const before=reads;await assert.rejects(build().send({...call,url:'https://connect.squareupsandbox.com/v2/payments'}),{code:'SQUARE_REQUEST_REJECTED'});assert.equal(reads,before);
 assert.equal(call.version,SQUARE_VERSION);
});
