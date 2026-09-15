import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,randomBytes} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import {ingressConfiguration,INGRESS_CLASSIFICATION,INGRESS_DOMAIN,MERCHANT_ID,NOTIFICATION_URL} from '../../apps/webhook-ingress/src/config';
import {ingressHandler} from '../../apps/webhook-ingress/src/handler';
import type {InboxSignal} from '../../packages/core/src/payment/square-webhook-inbox';
const key=randomBytes(32).toString('hex');
const namespace='zr_0123456789ab';
const dbUrl=()=>{const url=new URL(`postgresql://ep-fixture.us-east-1.aws.neon.tech/${namespace}?sslmode=verify-full`);url.username=namespace+'_pay_receipt';url.password=randomBytes(24).toString('hex');return url.toString();};
const environment=()=>({R15_INGRESS_CLASSIFICATION:INGRESS_CLASSIFICATION,VERCEL_ENV:'production',VERCEL_PROJECT_PRODUCTION_URL:INGRESS_DOMAIN,SQUARE_SANDBOX_WEBHOOK_SIGNATURE_KEY:key,SQUARE_SANDBOX_NOTIFICATION_URL:NOTIFICATION_URL,SQUARE_SANDBOX_MERCHANT_ID:MERCHANT_ID,R15_RECEIVER_DATABASE_URL:dbUrl()});
function request(event='evt_fixture',merchant=MERCHANT_ID,url=NOTIFICATION_URL,signUrl=NOTIFICATION_URL){
 const body=JSON.stringify({event_id:event,type:'payment.updated',merchant_id:merchant,data:{object:{payment:{id:'pay_fixture'}}}});
 return new Request(url,{method:'POST',body,headers:{'x-square-hmacsha256-signature':createHmac('sha256',key).update(signUrl).update(body).digest('base64')}});
}
test('R15 receiver configuration is Sandbox-only, exact-domain, exact-role and verified TLS',()=>{
 const env=environment(),c=ingressConfiguration(env);assert.ok(c);assert.equal(c.webhook.environment,'SANDBOX');assert.equal(c.database.user,namespace+'_pay_receipt');assert.deepEqual(c.database.ssl,{rejectUnauthorized:true});
 for(const patch of [{R15_INGRESS_CLASSIFICATION:''},{VERCEL_ENV:'preview'},{VERCEL_PROJECT_PRODUCTION_URL:'zao-rental.vercel.app'},{SQUARE_SANDBOX_WEBHOOK_SIGNATURE_KEY:''},{SQUARE_SANDBOX_NOTIFICATION_URL:NOTIFICATION_URL+'/'},{SQUARE_SANDBOX_MERCHANT_ID:'other'},{SQUARE_SANDBOX_ACCESS_TOKEN:'fixture'},{BETTER_AUTH_SECRET:'fixture'},{DATABASE_URL:dbUrl()},{R15_WORKER_DATABASE_URL:dbUrl()},{PGPASSWORD:'fixture'},{DATABASE_URL_UNPOOLED:dbUrl()},{SQUARE_PRODUCTION_WEBHOOK_SIGNATURE_KEY:'fixture'}])assert.equal(ingressConfiguration({...env,...patch}),null);
 for(const url of [dbUrl().replace('_pay_receipt','_pay_projection'),dbUrl().replace('verify-full','require'),dbUrl().replace('neon.tech','neon.tech.invalid'),dbUrl()+'&options=-csearch_path=public',dbUrl()+'&sslmode=verify-full',dbUrl().replace('/'+namespace,'/neondb')])assert.equal(ingressConfiguration({...env,R15_RECEIVER_DATABASE_URL:url}),null);
});
test('R15 missing signature/config fails closed without DB access; health is liveness only',async()=>{
 let db=0;const h=ingressHandler(null,()=>{db++;throw Error('NO_DB');});assert.equal((await h(request())).status,503);
 assert.equal((await h(new Request('https://fixture.invalid/health'))).status,200);assert.equal(db,0);
 assert.equal((await h(new Request(NOTIFICATION_URL))).status,405);
 for(const path of ['/','/staff','/booking','/api/health','/api/payments','/api/webhooks/square/'])assert.equal((await h(new Request('https://fixture.invalid'+path))).status,404);
 assert.equal((await h(new Request('https://fixture.invalid/health',{method:'POST'}))).status,405);
});
test('R15 signature/merchant/query/size failures never open receiver pool',async()=>{
 let calls=0;const h=ingressHandler(ingressConfiguration(environment()),()=>{calls++;throw Error('NO_DB');});
 assert.equal((await h(request('evt_fixture',MERCHANT_ID,NOTIFICATION_URL,'https://spoof.invalid/api/webhooks/square'))).status,403);
 assert.equal((await h(request('evt_fixture','foreign'))).status,403);
 assert.equal((await h(request('evt_fixture',MERCHANT_ID,NOTIFICATION_URL+'?key=fixture'))).status,400);
 assert.equal((await h(new Request(NOTIFICATION_URL,{method:'POST',body:'x'.repeat(65537)}))).status,413);assert.equal(calls,0);
});
test('R15 ACK awaits durable receipt; safe signal only; duplicate/hash conflict/DB errors are bounded',async()=>{
 let finish!:(v:'INSERTED')=>void;let entered!:()=>void;const barrier=new Promise<void>(r=>{entered=r;});let signal:InboxSignal|undefined,replied=false;
 const h=ingressHandler(ingressConfiguration(environment()),()=>({async receive(s){signal=s;entered();return new Promise<'INSERTED'>(r=>{finish=r;});}}));
 const pending=h(request()).then(r=>{replied=true;return r;});await barrier;assert.equal(replied,false);assert.deepEqual(Object.keys(signal!).sort(),['bodySha256','environment','eventId','merchantId','paymentId','type']);finish('INSERTED');assert.equal((await pending).status,200);
 for(const [receipt,status] of [['DUPLICATE',200],['HASH_CONFLICT',409]] as const){const same=ingressHandler(ingressConfiguration(environment()),()=>({async receive(){return receipt;}}));assert.equal((await same(request())).status,status);}
 const broken=ingressHandler(ingressConfiguration(environment()),()=>{throw Error('UNSAFE_DRIVER_DETAIL');});const r=await broken(request());assert.equal(r.status,503);assert.equal((await r.text()).includes('UNSAFE_DRIVER_DETAIL'),false);
});
test('R15 deploy surface exposes only two receiver routes, no main app/provider/worker imports',()=>{
 const configuration=JSON.parse(readFileSync('apps/webhook-ingress/vercel.json','utf8'));
 const rootPackage=JSON.parse(readFileSync('package.json','utf8'));assert.ok(configuration.installCommand.includes('--package='+rootPackage.packageManager));assert.ok(configuration.installCommand.includes('--ignore-scripts'));
 assert.deepEqual(configuration.routes,[{src:'^/health$',dest:'/api/health'},{src:'^/api/webhooks/square$',dest:'/api/webhooks/square'},{src:'/.*',status:404}]);
 assert.deepEqual(readdirSync('apps/webhook-ingress/api').sort(),['health.ts','webhooks']);assert.deepEqual(readdirSync('apps/webhook-ingress/api/webhooks'),['square.ts']);
 const code=readFileSync('apps/webhook-ingress/src/handler.ts','utf8');assert.doesNotMatch(code,/payment-reconciliation|payment-projection|apps\/web\/|fetch\(|console\./);
 assert.equal(JSON.parse(readFileSync('apps/webhook-ingress/package.json','utf8')).dependencies.pg,'8.23.0');
});
