import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,randomBytes} from 'node:crypto';
import {ingressConfiguration,parseProductionIngress,productionIngressConfiguration,PRODUCTION_INGRESS_CLASSIFICATION,WEBHOOK_PATH,INGRESS_CLASSIFICATION,INGRESS_DOMAIN,NOTIFICATION_URL,MERCHANT_ID} from '../../apps/webhook-ingress/src/config';
import {ingressHandler,ingressInbox} from '../../apps/webhook-ingress/src/handler';
import {PgSquareProductionWebhookInbox,PgSquareWebhookInbox,type InboxPool} from '../../packages/db/src/square-webhook-inbox';
import {squareWebhookConfiguration} from '../../apps/web/src/lib/square-webhook-config';
import type {InboxSignal,Receipt} from '../../packages/core/src/payment/square-webhook-inbox';
import type {Pool} from 'pg';

// Synthetic values only. The pinned Production Neon host is never known to this repository, so a
// fixture can prove the structural parse and every reject path; the pinned accept path is provable
// only in the real Production environment (the same disclosed trade-off as production-identity.ts).
const key=randomBytes(32).toString('hex'),domain='zao-rental-webhook-production.vercel.app',notificationUrl=`https://${domain}${WEBHOOK_PATH}`,merchant='SYNTHETIC-PRODUCTION-MERCHANT';
const receiverUrl=(patch:{host?:string;user?:string;database?:string;query?:string}={})=>{const database=patch.database??'neondb',url=new URL(`postgresql://${patch.host??'ep-synthetic-fixture.ap-southeast-1.aws.neon.tech'}/${database}?${patch.query??'sslmode=verify-full'}`);url.username=patch.user??database+'_pay_receipt';url.password=randomBytes(24).toString('hex');return url.toString();};
const env=(patch:Record<string,string|undefined>={}):Record<string,string|undefined>=>({PRODUCTION_WEBHOOK_INGRESS_CLASSIFICATION:PRODUCTION_INGRESS_CLASSIFICATION,VERCEL_ENV:'production',VERCEL_PROJECT_PRODUCTION_URL:domain,PRODUCTION_SQUARE_WEBHOOK_NOTIFICATION_URL:notificationUrl,PRODUCTION_SQUARE_MERCHANT_ID:merchant,PRODUCTION_SQUARE_WEBHOOK_SIGNATURE_KEY:key,PRODUCTION_RECEIVER_DATABASE_URL:receiverUrl(),...patch});
function signed(event='evt_production_fixture',merchantId=merchant,signUrl=notificationUrl,body?:string){
 const raw=body??JSON.stringify({event_id:event,type:'payment.updated',merchant_id:merchantId,data:{object:{payment:{id:'pay_production_fixture'}}}});
 return new Request(notificationUrl,{method:'POST',body:raw,headers:{'x-square-hmacsha256-signature':createHmac('sha256',key).update(signUrl).update(raw).digest('base64')}});
}

test('Production ingress parse binds classification, own domain, merchant, signature key and the dedicated _pay_receipt role over verify-full TLS',()=>{
 const p=parseProductionIngress(env());assert.ok(p);
 assert.equal(p.configuration.webhook.environment,'PRODUCTION');assert.equal(p.configuration.webhook.notificationUrl,notificationUrl);assert.equal(p.configuration.webhook.merchantId,merchant);
 assert.equal(p.configuration.database.database,'neondb');assert.equal(p.configuration.database.user,'neondb_pay_receipt');assert.deepEqual(p.configuration.database.ssl,{rejectUnauthorized:true});
 assert.match(p.hostFingerprintSha256,/^[a-f0-9]{64}$/);
 // Synthetic host != pinned Production host: the exact identity gate refuses it.
 assert.equal(productionIngressConfiguration(env()),null);
});
test('Production ingress rejects wrong environment, domain, merchant, key, role, database or TLS shape',()=>{
 for(const patch of [
  {PRODUCTION_WEBHOOK_INGRESS_CLASSIFICATION:INGRESS_CLASSIFICATION},{PRODUCTION_WEBHOOK_INGRESS_CLASSIFICATION:undefined},{VERCEL_ENV:'preview'},
  {VERCEL_PROJECT_PRODUCTION_URL:'other.vercel.app'},{PRODUCTION_SQUARE_WEBHOOK_NOTIFICATION_URL:notificationUrl+'/'},{PRODUCTION_SQUARE_WEBHOOK_NOTIFICATION_URL:`https://salomonzao.rent${WEBHOOK_PATH}`},
  {PRODUCTION_SQUARE_MERCHANT_ID:undefined},{PRODUCTION_SQUARE_MERCHANT_ID:'bad merchant'},{PRODUCTION_SQUARE_WEBHOOK_SIGNATURE_KEY:'short'},
  {PRODUCTION_RECEIVER_DATABASE_URL:receiverUrl({user:'neondb_pay_projection'})},{PRODUCTION_RECEIVER_DATABASE_URL:receiverUrl({user:'neondb_owner'})},
  {PRODUCTION_RECEIVER_DATABASE_URL:receiverUrl({database:'zr_0123456789ab'})},{PRODUCTION_RECEIVER_DATABASE_URL:receiverUrl({database:'otherdb'})},
  {PRODUCTION_RECEIVER_DATABASE_URL:receiverUrl({query:'sslmode=require'})},{PRODUCTION_RECEIVER_DATABASE_URL:receiverUrl({query:'sslmode=verify-full&options=-csearch_path%3Dpublic'})},
  {PRODUCTION_RECEIVER_DATABASE_URL:receiverUrl({host:'ep-synthetic-fixture-pooler.ap-southeast-1.aws.neon.tech'})},{PRODUCTION_RECEIVER_DATABASE_URL:receiverUrl({host:'db.example.invalid'})},
  // Any other credential in the deployment (including a Square access token or a Sandbox credential) is refused.
  {PRODUCTION_SQUARE_ACCESS_TOKEN:'synthetic-token'},{DATABASE_URL:receiverUrl()},{SQUARE_SANDBOX_WEBHOOK_SIGNATURE_KEY:key},{R15_RECEIVER_DATABASE_URL:receiverUrl({database:'zr_0123456789ab'})},{R15_INGRESS_CLASSIFICATION:INGRESS_CLASSIFICATION},
 ])assert.equal(parseProductionIngress(env(patch)),null,JSON.stringify(Object.keys(patch)));
});
test('a Sandbox credential cannot become a Production receiver and vice versa; the main web app stays Sandbox-only',()=>{
 const namespace='zr_0123456789ab',sandbox={R15_INGRESS_CLASSIFICATION:INGRESS_CLASSIFICATION,VERCEL_ENV:'production',VERCEL_PROJECT_PRODUCTION_URL:INGRESS_DOMAIN,SQUARE_SANDBOX_WEBHOOK_SIGNATURE_KEY:key,SQUARE_SANDBOX_NOTIFICATION_URL:NOTIFICATION_URL,SQUARE_SANDBOX_MERCHANT_ID:MERCHANT_ID,R15_RECEIVER_DATABASE_URL:receiverUrl({database:namespace})};
 assert.equal(ingressConfiguration(sandbox)?.webhook.environment,'SANDBOX');
 assert.equal(parseProductionIngress({...sandbox,PRODUCTION_WEBHOOK_INGRESS_CLASSIFICATION:PRODUCTION_INGRESS_CLASSIFICATION,PRODUCTION_SQUARE_WEBHOOK_NOTIFICATION_URL:NOTIFICATION_URL,PRODUCTION_SQUARE_MERCHANT_ID:MERCHANT_ID}),null);
 assert.equal(ingressConfiguration({...sandbox,PRODUCTION_SQUARE_WEBHOOK_SIGNATURE_KEY:key}),null);assert.equal(ingressConfiguration(env()),null);
 assert.equal(squareWebhookConfiguration({...env(),ZAO_SQUARE_WEBHOOK_ACTIVATION:'PRODUCTION',SQUARE_ENVIRONMENT:'PRODUCTION',SQUARE_API_VERSION:'2026-08-19'}),null);
 assert.equal(squareWebhookConfiguration({ZAO_SQUARE_WEBHOOK_ACTIVATION:'SANDBOX',VERCEL_ENV:'production',SQUARE_ENVIRONMENT:'SANDBOX',SQUARE_API_VERSION:'2026-08-19'}),null);
});
test('Production handler: verified signature, exact merchant and URL before durable ACK; duplicate/conflict/uncertainty preserved',async()=>{
 const config=parseProductionIngress(env())!.configuration,signals:InboxSignal[]=[];let next:Receipt|Error='INSERTED';
 const h=ingressHandler(config,()=>({async receive(s){signals.push(s);if(next instanceof Error)throw next;return next;}}));
 const body=async(r:Response)=>((await r.json()) as {classification:string}).classification;
 const ok=await h(signed());assert.equal(ok.status,200);assert.equal(await body(ok),'RECEIVED');assert.equal(signals[0]!.environment,'PRODUCTION');assert.equal(signals[0]!.merchantId,merchant);
 for(const [request,status] of [[signed('evt_x','SYNTHETIC-OTHER-MERCHANT'),403],[signed('evt_x',merchant,'https://spoof.invalid'+WEBHOOK_PATH),403],[new Request(notificationUrl,{method:'POST',body:'{}',headers:{'x-square-hmacsha256-signature':'A'.repeat(43)+'='}}),403]] as const){
  assert.equal((await h(request)).status,status);
 }
 assert.equal(signals.length,1);
 next='DUPLICATE';const dup=await h(signed());assert.equal(dup.status,200);assert.equal(await body(dup),'DUPLICATE');
 next='HASH_CONFLICT';assert.equal((await h(signed())).status,409);
 next=new Error('SYNTHETIC_UNCERTAIN_COMMIT');const unsure=await h(signed());assert.equal(unsure.status,503);assert.equal(await body(unsure),'WEBHOOK_INBOX_UNAVAILABLE');
 const health=await h(new Request(`https://${domain}/health`));assert.equal(await body(health),PRODUCTION_INGRESS_CLASSIFICATION);
 // With the pinned identity unmet, the deployed receiver answers 503 and never opens its pool.
 let opened=0;const closed=ingressHandler(productionIngressConfiguration(env()),()=>{opened++;throw Error('NO_DB');});assert.equal((await closed(signed())).status,503);assert.equal(opened,0);
});
test('Production inbox adapter uses only receive_production() and refuses any other environment before connecting',async()=>{
 const queries:string[]=[];let connects=0;
 const pool:InboxPool={async connect(){connects++;return {async query(sql:string){queries.push(sql);return {rows:[{result:'INSERTED'}]};},release(){}} as never;}};
 const production=new PgSquareProductionWebhookInbox(pool),signal:InboxSignal={environment:'PRODUCTION',eventId:'evt',type:'payment.updated',merchantId:merchant,paymentId:'pay',bodySha256:'a'.repeat(64)};
 assert.equal(await production.receive(signal),'INSERTED');assert.ok(queries.some(q=>q.includes('square_webhook.receive_production($1,$2,$3,$4,$5)')));assert.ok(!queries.some(q=>/square_webhook\.receive\(/.test(q)));
 await assert.rejects(production.receive({...signal,environment:'SANDBOX'}),{message:'WEBHOOK_INBOX_ENVIRONMENT_MISMATCH'});assert.equal(connects,1);
 assert.ok(!('claim' in production)&&!('settle' in production));
 const config=parseProductionIngress(env())!.configuration;
 assert.ok(ingressInbox(config,{} as Pool) instanceof PgSquareProductionWebhookInbox);
 assert.ok(ingressInbox({...config,webhook:{...config.webhook,environment:'SANDBOX'}},{} as Pool) instanceof PgSquareWebhookInbox);
});
