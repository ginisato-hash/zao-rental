import assert from 'node:assert/strict';
import {Pool} from 'pg';
import {createHash,createHmac} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {startIsolatedPostgres} from '../../scripts/postgres';
import {migrate} from '../../packages/db/src/index';
import {seed} from './r14-postgres';
import {seedR15SyntheticFixture,r15FixtureId as id} from '../../scripts/r15-synthetic-fixture';
import {provisionPaymentActivationRoles} from '../../scripts/payment-activation-roles';
import {r15Preview} from '../../tools/acceptance/r15-preview';
import {squareWebhookReceiver} from '../../packages/core/src/payment/square-webhook-receiver';
import {PgSquareWebhookInbox} from '../../packages/db/src/square-webhook-inbox';
const cluster=await startIsolatedPostgres();
await cluster.pool.query('CREATE DATABASE zr_852b20c4d4b0');
const localPool=new Pool({host:'127.0.0.1',port:cluster.identity.dbPort,user:cluster.pool.options.user,password:cluster.pool.options.password,database:'zr_852b20c4d4b0',max:6});
const db={pool:localPool,identity:{...cluster.identity,namespace:'zr_852b20c4d4b0',database:'zr_852b20c4d4b0'},async stop(){await localPool.end();await cluster.stop();}};let roles:Awaited<ReturnType<typeof provisionPaymentActivationRoles>>|undefined;
const result:{status:string;checks:string[];actualSquareRequests:number;localProviderCallbacks:number;error?:unknown}={status:'FAIL',checks:[],actualSquareRequests:0,localProviderCallbacks:0};
try{
 assert.equal(db.identity.database,'zr_852b20c4d4b0');await migrate(db.pool);await seed(db.pool,'MLKDVEDH1ME21',null);await seedR15SyntheticFixture(db.pool,'fixture-location');
 roles=await provisionPaymentActivationRoles(db.pool,db.identity);
 const manifest={authority:'P6_R15_COMPLETION',operationId:id(9),resourceId:'store_i5vh0ZEKo2ikcVo9',database:db.identity.database,environment:'SANDBOX',merchantId:'MLKDVEDH1ME21',locationId:'fixture-location',amountJpy:100,currency:'JPY',bookingId:id(1),attemptId:id(4),idempotencyKey:id(5),branch:'codex/external-acceptance-p6',sourceHead:'a'.repeat(40),budgets:{createPayment:1,getPayment:1,retry:0}};
 const manifestSource=JSON.stringify(manifest),manifestSha256=createHash('sha256').update(manifestSource).digest('hex'),input={manifestSource,manifestSha256};
 await db.pool.query("INSERT INTO r15_activation.manifest VALUES(true,$1,'store_i5vh0ZEKo2ikcVo9',$2,$3,$4,$5,'MLKDVEDH1ME21','fixture-location','SANDBOX',100,'JPY')",[manifestSha256,db.identity.database,id(1),id(4),id(5)]);
 const env={VERCEL_ENV:'preview',VERCEL_PROJECT_ID:'prj_ehUMOzM77em9DVnHJBJffncD5hg7',R15_ACTIVATION_AUTHORITY:'P6_R15',SQUARE_ENVIRONMENT:'SANDBOX',SQUARE_API_VERSION:'2026-08-19',SQUARE_SANDBOX_APPLICATION_ID:'sandbox-fixture',SQUARE_SANDBOX_LOCATION_ID:'fixture-location',SQUARE_SANDBOX_MERCHANT_ID:'MLKDVEDH1ME21',SQUARE_SANDBOX_ACCESS_TOKEN:'fixture-only'};
 const now=new Date().toISOString(),payment={id:'r15-local-fixture',reference_id:id(1),location_id:'fixture-location',status:'COMPLETED',amount_money:{amount:100,currency:'JPY'},updated_at:now,card_details:{card_payment_timeline:{captured_at:now}}};
 const handle=r15Preview(env,async(url,init)=>{result.localProviderCallbacks++;assert.ok(String(url).startsWith('https://connect.squareupsandbox.com/v2/payments'));const action=init?.method==='POST'?'CREATE_PAYMENT':'GET_PAYMENT';assert.equal((await db.pool.query('SELECT count(*)::int n FROM r15_activation.operations WHERE action=$1',[action])).rows[0].n,1);return Response.json({payment});},()=>roles!.pools);
 const request=(action:string,b:unknown)=>new Request('https://preview.invalid/api/r15/'+action,{method:'POST',headers:{'X-ZAO-Acceptance':'P6_R15_COMPLETION','sec-fetch-site':'same-origin',origin:'https://preview.invalid'},body:JSON.stringify(b)});
 const create=await handle(request('payment',input));assert.equal(create.status,200);assert.equal((await create.json()).classification,'CREATE_COMPLETED');result.checks.push('CREATE commits durable reservation before synthetic provider callback');
 const c=await db.pool.connect();try{await c.query('BEGIN');await c.query("SELECT set_config('zao.actor','synthetic-r15-actor',true),set_config('zao.reason','R15 LOCAL SYNTHETIC provider ID binding',true)");await c.query("UPDATE rental_payment_attempts SET provider_id=$1,state='PENDING' WHERE id=$2 AND provider_id IS NULL AND state='SUBMITTING'",[payment.id,id(4)]);await c.query('COMMIT');}finally{c.release();}
 const url='https://ingress.invalid/api/webhooks/square',key='fixture-signature-key-only';
 const raw=JSON.stringify({event_id:'r15-local-event',type:'payment.updated',merchant_id:'MLKDVEDH1ME21',data:{object:{payment:{id:payment.id}}}}),signature=createHmac('sha256',key).update(url).update(raw).digest('base64');
 const receiver=squareWebhookReceiver({environment:'SANDBOX',notificationUrl:url,signatureKey:key,merchantId:'MLKDVEDH1ME21'},()=>new PgSquareWebhookInbox(roles!.pools.receiver));
 assert.equal((await receiver(new Request(url,{method:'POST',headers:{'x-square-hmacsha256-signature':signature},body:raw}))).status,200);result.checks.push('signed synthetic webhook commits inbox with receiver role');
 const r=await handle(request('reconcile',{...input,paymentId:payment.id})),summary=await r.json();
 assert.equal(summary.classification,'R15_E2E_PASS',JSON.stringify(summary));assert.equal(summary.getPaymentCount,1);assert.equal(summary.projection.decision,'APPLY_COMPLETED');assert.equal(summary.duplicate.duplicate,true);result.checks.push('R12 targeted GetPayment and R13 exactly-once projection with runtime roles');
 const states=(await db.pool.query('SELECT b.state booking,a.state attempt,h.payment_state hold_payment FROM rental_bookings b JOIN rental_payment_attempts a ON a.booking_id=b.id JOIN inventory_holds h ON h.id=b.hold_id WHERE b.id=$1',[id(1)])).rows[0];assert.deepEqual(states,{booking:'CONFIRMED_DEV',attempt:'COMPLETED',hold_payment:'SUCCESS'});
 assert.equal((await db.pool.query('SELECT count(*)::int n FROM payment_projection.events WHERE booking_id=$1',[id(1)])).rows[0].n,1);assert.equal(result.localProviderCallbacks,2);result.checks.push('confirmed synthetic booking/hold and one projection event');result.status='PASS';
}catch(e){result.error={sqlstate:(e as {code?:string}).code??null,localAssertion:(e as Error).message};}
finally{await roles?.close();await db.stop();await writeFile('docs/execution/p6/r15-completion/local-e2e-proof.json',JSON.stringify({...result,kind:'LOCAL_REAL_POSTGRES_WITH_SYNTHETIC_PROVIDER',closed:true},null,2)+'\n');console.log(JSON.stringify(result));}
if(result.status!=='PASS')process.exit(1);
