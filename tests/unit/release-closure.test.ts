import assert from 'node:assert/strict';
import test from 'node:test';
import {issuePublicationAuthority,installPublicationAuthority,publicationApproved,publicIndexablePath,PUBLICATION_ORIGIN} from '../../packages/auth/src/publication-authority';
import {ResendDelivery,RESEND_SENDER} from '../../packages/core/src/notification/resend';
import {SquareRefundGateway} from '../../packages/core/src/payment/square-refund';
import {SquareProductionGateway} from '../../packages/core/src/payment/square-production';
import {capacityFigures} from '../../packages/core/src/inventory/capacity-summary';
import {indexingEnabled} from '../../packages/core/src/content/public-pages';
import {CancellationRefundWorker} from '../../packages/core/src/payment/cancellation-refund-worker';
import type {Pool} from 'pg';
const message={idempotencyKey:'a'.repeat(64),eventType:'BOOKING_CANCELLED' as const,recipient:'synthetic@example.invalid',locale:'en' as const,subject:'Cancellation',text:'Synthetic cancellation receipt'};
test('publication rejects forged identity/capability; all flags remain inert',()=>{
 assert.throws(()=>issuePublicationAuthority({kind:'EXACT_PRODUCTION_IDENTITY'},{state:'PUBLICATION_APPROVED',origin:PUBLICATION_ORIGIN,releaseId:'fixture',approvedBy:'SYNTHETIC',approvedAt:'2026-01-01T00:00:00Z'}));
 assert.throws(()=>installPublicationAuthority({kind:'PUBLICATION_AUTHORITY'}));assert.equal(publicationApproved(),false);
 const old=process.env.ZAO_TEST_PUBLIC_INDEXING;try{process.env.ZAO_TEST_PUBLIC_INDEXING='1';assert.equal(indexingEnabled(),false);}finally{if(old===undefined)delete process.env.ZAO_TEST_PUBLIC_INDEXING;else process.env.ZAO_TEST_PUBLIC_INDEXING=old;}
});
test('public JA/EN URL policy excludes private paths and every query',()=>{
 for(const path of ['/ja','/en/','/ja/rental','/en/rental/ski','/ja/rental/premium/verified-model','/en/prices','/ja/stores/onsen-base','/en/faq']){assert.equal(publicIndexablePath(path),true,path);assert.equal(publicIndexablePath(path,'?date=2035-01-01'),false);}
 for(const path of ['/api','/staff','/admin','/preview','/ja/book','/en/booking/id','/ja/reservation','/en/recovery','/ja/rental/private/foo','/ja/prices/private','//ja','/ja/rental/premium/%2e%2e'])assert.equal(publicIndexablePath(path),false,path);
});
test('derived management figures round combined supply once and clamp by real remaining stock',()=>{
 assert.deepEqual(capacityFigures(20,18,1),{operationalCapacity:20,publicCapacity:19,publicClaimed:18,staffOverrideClaimed:1,publicRemaining:1,operationalRemaining:1});assert.equal(capacityFigures(10,0,0).publicCapacity,9);assert.equal(capacityFigures(20,0,20).publicRemaining,0);assert.equal(capacityFigures(20,19,1).operationalRemaining,0);
});
test('Resend exact sender, stable key, transient body and truthful absence of lookup',async()=>{
 let calls=0;const delivery=new ResendDelivery(async()=>({secret:'re_'+'x'.repeat(32),revoked:false}),async(url,init)=>{calls++;assert.equal(url,'https://api.resend.com/emails');assert.equal(init.redirect,'error');assert.equal(init.credentials,'omit');assert.equal(new Headers(init.headers).get('Idempotency-Key'),message.idempotencyKey);assert.deepEqual(JSON.parse(String(init.body)),{from:RESEND_SENDER,to:[message.recipient],subject:message.subject,text:message.text});return Response.json({id:'synthetic-receipt'});});
 assert.equal('lookup' in delivery,false);assert.deepEqual(await delivery.send(message,new AbortController().signal),{state:'ACCEPTED',providerMessageId:'synthetic-receipt'});assert.equal(calls,1);
});
test('Resend uncertainty, invalid or oversized receipt, revocation and abort never invent acceptance',async()=>{
 for(const status of [409,500,503]){let calls=0;const d=new ResendDelivery(async()=>({secret:'re_'+'x'.repeat(32),revoked:false}),async()=>{calls++;return new Response('',{status});});assert.deepEqual(await d.send(message,new AbortController().signal),{state:'UNKNOWN'});assert.equal(calls,1);}
 for(const body of ['not json',JSON.stringify({id:'@private'}),' '.repeat(65537)]){const d=new ResendDelivery(async()=>({secret:'re_'+'x'.repeat(32),revoked:false}),async()=>new Response(body));assert.deepEqual(await d.send(message,new AbortController().signal),{state:'UNKNOWN'});}
 let calls=0;const d=new ResendDelivery(async()=>({secret:'re_'+'x'.repeat(32),revoked:true}),async()=>{calls++;throw Error();});assert.equal((await d.send(message,new AbortController().signal)).state,'REJECTED');const controller=new AbortController();controller.abort();assert.equal((await d.send(message,controller.signal)).state,'UNKNOWN');assert.equal(calls,0);
});
test('Resend only explicit rate-limit nonacceptance grants the outbox a retry',async()=>{
 for(const [code,state] of [[429,'NOT_ACCEPTED'],[401,'REJECTED'],[403,'REJECTED'],[422,'REJECTED']] as const){const d=new ResendDelivery(async()=>({secret:'re_'+'x'.repeat(32),revoked:false}),async()=>new Response('',{status:code}));assert.equal((await d.send(message,new AbortController().signal)).state,state);}
});
const refund={id:'00000000-0000-4000-8000-000000000001',bookingId:'00000000-0000-4000-8000-000000000002',idempotencyKey:'00000000-0000-4000-8000-000000000003',paymentProviderId:'payment_synthetic',merchantId:'merchant_synthetic',locationId:'location_synthetic',amountJpy:5000,currency:'JPY' as const};
test('Square refunds use shared Production transport; UNKNOWN without known ID never posts again',async()=>{
 let calls=0;const gateway=new SquareRefundGateway({environment:'PRODUCTION',merchantId:refund.merchantId,async send(call){calls++;assert.equal(call.url,'https://connect.squareup.com/v2/refunds');assert.equal(call.method,'POST');assert.equal((call.body as {reason:string}).reason,'ZAO_CANCELLATION_V1');return {status:200,body:{refund:{id:'refund_synthetic',payment_id:refund.paymentProviderId,location_id:refund.locationId,amount_money:{amount:5000,currency:'JPY'},status:'COMPLETED',updated_at:'2035-01-01T00:00:00Z'}}};}});
 assert.equal((await gateway.create(refund)).status,'COMPLETED');assert.throws(()=>gateway.lookup(refund,null),{code:'REFUND_PROVIDER_ID_UNRESOLVED'});assert.equal(calls,1);
 assert.throws(()=>new CancellationRefundWorker({} as Pool,gateway,{kind:'EXACT_PRODUCTION_IDENTITY'}),{code:'PRODUCTION_REFUND_AUTHORITY_REQUIRED'});
});
test('Production Square engine takes a transient card token without consulting or saving a source resolver',async()=>{
 let sources=0,calls=0;const gateway=new SquareProductionGateway({environment:'PRODUCTION',merchantId:refund.merchantId,async send(call){calls++;assert.equal((call.body as {source_id:string}).source_id,'synthetic-card-token');return {status:200,body:{payment:{id:'payment_synthetic',reference_id:refund.bookingId,location_id:refund.locationId,amount_money:{amount:5000,currency:'JPY'},status:'COMPLETED',updated_at:'2035-01-01T00:00:00Z',created_at:'2035-01-01T00:00:00Z',card_details:{card_payment_timeline:{captured_at:'2035-01-01T00:00:00Z'}}}}};}},async()=>{sources++;throw Error();});
 await gateway.create({attemptId:refund.id,bookingId:refund.bookingId,idempotencyKey:refund.idempotencyKey,merchantId:refund.merchantId,locationId:refund.locationId,amountJpy:5000,currency:'JPY'},'synthetic-card-token');assert.equal(calls,1);assert.equal(sources,0);
});
