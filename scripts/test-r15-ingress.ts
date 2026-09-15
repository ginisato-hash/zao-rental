import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {createHmac,randomBytes,randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {startIsolatedPostgres} from './postgres';
import {migrate} from '../packages/db/src/index';
import {run,type DB} from '../tests/readiness/r14-postgres';
import {ingressHandler} from '../apps/webhook-ingress/src/handler';
import {NOTIFICATION_URL,MERCHANT_ID} from '../apps/webhook-ingress/src/config';
import {r15ProjectionPermit} from '../packages/core/src/payment/r15-projection-authority';
import {PgPaymentProjection} from '../packages/db/src/payment-projection';
import {TransactionalPaymentProjection,type ProjectionSource} from '../packages/core/src/payment/payment-projection';
import {flowHash} from '../packages/contracts/src/rental-flow';
import {id} from '../tests/fixtures/payment-projection';
import {PgSquareWebhookInbox} from '../packages/db/src/square-webhook-inbox';
if(process.env.NODE_ENV==='production')throw new Error('R15_LOCAL_TEST_ONLY');
const output=resolve('.local/r15-acceptance');await mkdir(output,{recursive:true,mode:0o700});
const db:Awaited<ReturnType<typeof startIsolatedPostgres>>&DB=await startIsolatedPostgres();
const results:{name:string;result:string}[]=[];
async function check(name:string,fn:()=>Promise<void>){try{await fn();results.push({name,result:'PASS'});console.log('PASS '+name);}catch(e){results.push({name,result:'FAIL'});throw e;}finally{await writeFile(resolve(output,'r15-real-db.json'),JSON.stringify({kind:'LOCAL_REAL_POSTGRESQL_SYNTHETIC_WEBHOOK',results,hostedDb:false,actualSquareRequests:0},null,2));}}
let validationFailed=false;
try{
 await migrate(db.pool);await run(db,output);
 const {names,pools:p}=db.r14!.roles;
 await check('R15 production-build Preview permit uses exact DB role/target; committed replay unchanged',async()=>{
  const job=(await db.pool.query("SELECT j.id,j.decision_fingerprint,s.truth_revision,s.latest FROM payment_reconciliation.jobs j JOIN payment_reconciliation.streams s USING(environment,merchant_id,payment_id) WHERE j.payment_id='fixture-payment' AND j.state='RECONCILED' ORDER BY j.generation DESC LIMIT 1")).rows[0];
  const reference={bookingId:id(1),attemptId:id(4),jobId:job.id,truthRevision:Number(job.truth_revision),truthFingerprint:job.decision_fingerprint,observationFingerprint:flowHash(job.latest),expectedRevision:1};
  const env={VERCEL_ENV:'preview',VERCEL_PROJECT_ID:'prj_ehUMOzM77em9DVnHJBJffncD5hg7',R15_ACTIVATION_AUTHORITY:'P6_R15',SQUARE_ENVIRONMENT:'SANDBOX'};
  const permit=r15ProjectionPermit(env,{bookingId:id(1),attemptId:id(4),database:db.identity.database});
  const reader=async(c:import('../packages/db/src/square-webhook-inbox').InboxConnection,ref:typeof reference)=>(await c.query<{source:ProjectionSource|null}>('SELECT payment_projection.lock_source($1) AS source',[ref.jobId])).rows[0]?.source??null;
  const before=(await db.pool.query('SELECT count(*)::int n FROM rental_history')).rows[0].n,old=process.env.NODE_ENV;
  try{(process.env as Record<string,string|undefined>).NODE_ENV='production';
   const app=new TransactionalPaymentProjection(new PgPaymentProjection(p.projector,reader,permit),permit);assert.equal((await app.project(reference)).duplicate,true);
   await assert.rejects(new PgPaymentProjection(p.worker,reader,permit).transaction(reference,async()=>{}),{code:'PROJECTION_DEVELOPMENT_DB_ONLY'});
   await assert.rejects(app.project({...reference,bookingId:id(99)}),{code:'PROJECTION_NOT_ACTIVATED'});
  }finally{if(old===undefined)delete (process.env as Record<string,string|undefined>).NODE_ENV;else (process.env as Record<string,string|undefined>).NODE_ENV=old;}
  assert.equal((await db.pool.query('SELECT count(*)::int n FROM rental_history')).rows[0].n,before);
 });
 await check('R15 dedicated ingress to real receiver role: durable insert, duplicate replay and no raw body',async()=>{
  const signatureKey=randomBytes(32).toString('hex'),eventId='r15_'+randomUUID();
  const body=JSON.stringify({event_id:eventId,type:'payment.updated',merchant_id:MERCHANT_ID,data:{object:{payment:{id:'r15_fixture_payment'}}}});
  const headers={'x-square-hmacsha256-signature':createHmac('sha256',signatureKey).update(NOTIFICATION_URL).update(body).digest('base64')};
  const handle=ingressHandler({webhook:{environment:'SANDBOX',merchantId:MERCHANT_ID,notificationUrl:NOTIFICATION_URL,signatureKey},database:{}},()=>new PgSquareWebhookInbox(p.receiver));
  assert.equal((await handle(new Request(NOTIFICATION_URL,{method:'POST',headers,body}))).status,200);
  assert.equal((await handle(new Request(NOTIFICATION_URL,{method:'POST',headers,body}))).status,200);
  assert.equal((await db.pool.query('SELECT count(*)::int n FROM square_webhook.inbox WHERE event_id=$1',[eventId])).rows[0].n,1);
  const columns=(await db.pool.query("SELECT column_name FROM information_schema.columns WHERE table_schema='square_webhook' AND table_name='inbox'")).rows.map(r=>r.column_name);assert.ok(columns.includes('body_sha256'));assert.ok(columns.every(c=>!['body','raw_body','signature','headers'].includes(c)));
 });
 await check('R15 targeted grants deny unscoped dispatch and claim without weakening target access',async()=>{
  await db.pool.query(`REVOKE EXECUTE ON FUNCTION payment_reconciliation.dispatch(text,integer) FROM ${names.dispatcher}`);
  await db.pool.query(`REVOKE EXECUTE ON FUNCTION payment_reconciliation.claim(text,text,integer) FROM ${names.worker}`);
  await assert.rejects(p.dispatcher.query("SELECT payment_reconciliation.dispatch('SANDBOX',1)"),{code:'42501'});
  await assert.rejects(p.worker.query("SELECT payment_reconciliation.claim('SANDBOX','r15-fixture',1)"),{code:'42501'});
  assert.equal((await p.dispatcher.query("SELECT payment_reconciliation.dispatch_target('SANDBOX',1,'no-fixture-merchant','no-fixture-payment') n")).rows[0].n,0);
  assert.equal((await p.worker.query("SELECT * FROM payment_reconciliation.claim_target('SANDBOX','r15-fixture',1,'no-fixture-merchant','no-fixture-payment')")).rowCount,0);
 });
}catch(error){console.error('R15_LOCAL_ACCEPTANCE_FAILED',{code:(error as {code?:string}).code??'TEST_FAILURE',at:(error as Error).stack?.split('\n').find(s=>s.includes('/tests/readiness/')||s.includes('/scripts/test-r15-ingress'))});validationFailed=true;}
finally{try{await db.r14?.roles.close();}finally{await db.stop();}await writeFile(resolve(output,'closure.json'),JSON.stringify({stoppedAt:new Date().toISOString(),ownedDatabaseStopped:true,actualProviderRequests:0,hostedDbCreated:0}));}

// All owned resources are already closed. async-exit-hook beforeExit forces 0,
// so a failed finite test must exit explicitly after cleanup.
if(validationFailed)process.exit(1);
