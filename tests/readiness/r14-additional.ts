import assert from 'node:assert/strict';
import {createHmac,randomBytes,randomUUID} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import type {DB} from './r14-postgres';
import {boundaries} from './r14-boundaries';
import {PgSquareWebhookInbox,type InboxPool,type InboxConnection} from '../../packages/db/src/square-webhook-inbox';
import {PgPaymentReconciliation} from '../../packages/db/src/payment-reconciliation';
import {developmentPaymentComposition} from '../../packages/db/src/development-payment-composition';
import {squareWebhookReceiver} from '../../packages/core/src/payment/square-webhook-receiver';
import {flowHash} from '../../packages/contracts/src/rental-flow';
import {id} from '../fixtures/payment-projection';
function barrier(){let resolve!:()=>void;const promise=new Promise<void>(r=>{resolve=r;});return {promise,resolve};}
export async function additional(db:DB,out:string){
 if(db.r14!.completed.has('additional'))return boundaries(db,out);
 const {pools:p}=db.r14!.roles,results:{name:string;result:string}[]=[];
 const save=()=>writeFileSync(out+'/real-db-additional.json',JSON.stringify({kind:'REAL_POSTGRESQL_SYNTHETIC_PROVIDER',results,actualProviderRequests:0},null,2));
 async function check(name:string,fn:()=>Promise<void>){try{await fn();results.push({name,result:'PASS'});console.log('PASS '+name);}catch(e){results.push({name,result:'FAIL'});save();throw e;}save();}
 const config={environment:'SANDBOX' as const,merchantId:'fixture-merchant',notificationUrl:'https://r14.invalid/api/webhooks/square',signatureKey:randomBytes(32).toString('hex')};
 function request(eventId:string,paymentId='fixture-payment'){
  const body=JSON.stringify({event_id:eventId,type:'payment.updated',merchant_id:config.merchantId,data:{object:{payment:{id:paymentId}}}});
  return new Request(config.notificationUrl,{method:'POST',headers:{'x-square-hmacsha256-signature':createHmac('sha256',config.signatureKey).update(config.notificationUrl).update(body).digest('base64')},body});
 }
 const count=async(eventId:string)=>(await db.pool.query('SELECT count(*)::int n FROM square_webhook.inbox WHERE event_id=$1',[eventId])).rows[0].n;
 await check('owned receiver connection terminated before COMMIT: 503 and no durable receipt',async()=>{
  const eventId='r14_cut_'+randomUUID();let terminated=false;
  const cut:InboxPool={async connect(){const c=await p.receiver.connect();c.on('error',()=>{});const pid=(await c.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;return {release:(bad?:boolean)=>c.release(bad),query:async(sql:string,args?:unknown[])=>{const value=await c.query(sql,args);if(sql.startsWith('SELECT square_webhook.receive')){assert.ok(Number.isInteger(pid));terminated=(await db.pool.query('SELECT pg_terminate_backend($1) AS stopped',[pid])).rows[0].stopped;}return value;}} as InboxConnection;}};
  assert.equal((await squareWebhookReceiver(config,()=>new PgSquareWebhookInbox(cut))(request(eventId))).status,503);assert.equal(terminated,true);assert.equal(await count(eventId),0);
 });
 const accepted='r14_ack_'+randomUUID();
 await check('ACK is blocked before COMMIT; independent connection sees receipt only after COMMIT',async()=>{
  const entered=barrier(),release=barrier();let replied=false;
  const delayed:InboxPool={async connect(){const c=await p.receiver.connect();return {release:(bad?:boolean)=>c.release(bad),query:async(sql:string,args?:unknown[])=>{if(sql==='COMMIT'){entered.resolve();await release.promise;}return c.query(sql,args);}} as InboxConnection;}};
  const response=squareWebhookReceiver(config,()=>new PgSquareWebhookInbox(delayed))(request(accepted)).then(x=>{replied=true;return x;});
  let timer:ReturnType<typeof setTimeout>|undefined;try{await Promise.race([entered.promise,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('COMMIT_BARRIER_NOT_REACHED')),5000);})]);assert.equal(replied,false);assert.equal(await count(accepted),0);}finally{clearTimeout(timer);release.resolve();}
  assert.equal((await response).status,200);assert.equal(await count(accepted),1);
 });
 await check('fixed target composition: foreign event/job untouched, fixture lookup, truth and projection replay',async()=>{
  const foreign='r14_other_'+randomUUID(),receipt=new PgSquareWebhookInbox(p.receiver),foreignPayment='fixture-unrelated-'+randomUUID();
  await receipt.receive({environment:'SANDBOX',eventId:foreign,type:'payment.updated',merchantId:config.merchantId,paymentId:foreignPayment,bodySha256:flowHash(foreign)});
  const unrelated=new PgPaymentReconciliation(p.dispatcher,{merchantId:config.merchantId,paymentId:foreignPayment});await unrelated.dispatch('SANDBOX',1);
  const before=(await db.pool.query('SELECT count(*)::int n FROM rental_history')).rows[0].n;
  const observation=(await db.pool.query("SELECT latest FROM payment_reconciliation.streams WHERE payment_id='fixture-payment'")).rows[0].latest;
  let calls=0;
  const app=developmentPaymentComposition(p,config,{bookingId:id(1),attemptId:id(4),paymentId:'fixture-payment'},{async lookupPayment(input){calls++;assert.equal(input.paymentId,'fixture-payment');assert.equal(input.expected.bookingId,id(1));return {kind:'OBSERVED',observation};}});
  const rejected='r14_scope_'+randomUUID();assert.equal((await app.receive(request(rejected,foreignPayment))).status,503);assert.equal(await count(rejected),0);
  // Re-delivery uses the exact same bytes and does not add another signal.
  assert.equal((await app.receive(request(accepted))).status,200);
  const worker=await app.runOnce();assert.equal(worker.dispatched,1);assert.equal(worker.claimed,1);assert.equal(calls,1);assert.equal(worker.results[0]!.result,'SAVED');
  const job=(await db.pool.query('SELECT j.id,j.decision,j.decision_fingerprint,s.truth_revision,s.latest FROM payment_reconciliation.jobs j JOIN payment_reconciliation.streams s USING(environment,merchant_id,payment_id) WHERE j.id=$1',[worker.results[0]!.id])).rows[0];
  assert.equal(job.decision,'NOOP_DUPLICATE');const result=await app.project({bookingId:id(1),attemptId:id(4),jobId:job.id,truthRevision:Number(job.truth_revision),truthFingerprint:job.decision_fingerprint,observationFingerprint:flowHash(job.latest),expectedRevision:1});assert.equal(result.duplicate,true);
  assert.equal((await db.pool.query('SELECT count(*)::int n FROM rental_history')).rows[0].n,before);
  const untouched=(await db.pool.query('SELECT state,attempt FROM payment_reconciliation.jobs WHERE payment_id=$1',[foreignPayment])).rows[0];assert.deepEqual(untouched,{state:'READY',attempt:0});
  await assert.rejects(app.project({bookingId:id(100),attemptId:id(4),jobId:job.id,truthRevision:1,truthFingerprint:job.decision_fingerprint,observationFingerprint:flowHash(job.latest),expectedRevision:1}),/R14_TARGET_MISMATCH/);
  writeFileSync(out+'/composition-chain.json',JSON.stringify({kind:'REAL_DB_COMPOSITION_FIXTURE_LOOKUP_NOT_LIVE',eventId:accepted,jobId:job.id,bookingId:id(1),worker,result,fixtureLookups:calls,actualProviderRequests:0,foreignJobUntouched:true},null,2));
 });
 await check('development scope SQL rejects Production and non-one batch; production composition refuses startup',async()=>{
  await assert.rejects(p.dispatcher.query("SELECT payment_reconciliation.dispatch_target('PRODUCTION',1,'fixture-merchant','fixture-payment')"),{code:'22023'});
  await assert.rejects(p.worker.query("SELECT payment_reconciliation.claim_target('SANDBOX','test',2,'fixture-merchant','fixture-payment')"),{code:'22023'});
  const previous=process.env.NODE_ENV;try{(process.env as Record<string,string|undefined>).NODE_ENV='production';assert.throws(()=>developmentPaymentComposition(p,config,{bookingId:id(1),attemptId:id(4),paymentId:'fixture-payment'},{async lookupPayment(){throw new Error('MUST_NOT_CALL');}}),/R14_DEVELOPMENT_ONLY/);}finally{if(previous===undefined)delete (process.env as Record<string,string|undefined>).NODE_ENV;else (process.env as Record<string,string|undefined>).NODE_ENV=previous;}
 });
 const functions=(await db.pool.query("SELECT n.nspname AS schema,p.proname AS name,p.prosecdef AS security_definer,p.proconfig AS settings FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('square_webhook','payment_reconciliation','payment_projection') ORDER BY 1,2")).rows;
 writeFileSync(out+'/db-function-metadata-final.json',JSON.stringify({functions},null,2));
 db.r14!.completed.add('additional');save();await boundaries(db,out);
}
