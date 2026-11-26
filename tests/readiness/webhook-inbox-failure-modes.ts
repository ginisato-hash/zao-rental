import assert from 'node:assert/strict';
import {createHmac,randomBytes} from 'node:crypto';
import {createServer} from 'node:net';
import {Pool} from 'pg';
import {startIsolatedPostgres} from '../../scripts/postgres';
import {migrate} from '../../packages/db/src/index';
import {ingressHandler} from '../../apps/webhook-ingress/src/handler';
import {PgSquareProductionWebhookInbox,type InboxConnection,type InboxPool} from '../../packages/db/src/square-webhook-inbox';
import type {IngressConfiguration} from '../../apps/webhook-ingress/src/config';
if(process.env.NODE_ENV==='production')throw Error('LOCAL_TEST_ONLY');

/** Real PostgreSQL, synthetic Production-shaped receiver. Reproduces the failure shapes that make the Production receiver answer
 * 503 WEBHOOK_INBOX_UNAVAILABLE and proves that, after recovery, a Square re-delivery is stored exactly once (never lost, never doubled).
 * No Square, Vercel or Neon endpoint is contacted. Which of these shapes actually happened in Production is NOT established here. */
const key=randomBytes(32).toString('hex'),merchant='SYNTHETIC-PRODUCTION-MERCHANT',url='https://synthetic-webhook.example.invalid/api/webhooks/square';
const web={environment:'PRODUCTION' as const,signatureKey:key,notificationUrl:url,merchantId:merchant};
const config:IngressConfiguration={webhook:web,database:{}};
function signed(event:string,type='payment.updated',payment='pay_failure_mode',extra:Record<string,unknown>={}){
 const raw=JSON.stringify({event_id:event,type,merchant_id:merchant,data:{object:{payment:{id:payment,status:'COMPLETED'}}},...extra});
 return new Request(url,{method:'POST',body:raw,headers:{'x-square-hmacsha256-signature':createHmac('sha256',key).update(url).update(raw).digest('base64')}});
}
const body=async(r:Response)=>((await r.json()) as {classification:string}).classification;
const db=await startIsolatedPostgres();const owner=db.pool;
const results:string[]=[];
async function check(name:string,run:()=>Promise<void>){await run();results.push(name);console.log('PASS '+name);}
const rows=async(event?:string)=>Number((await owner.query(event?'SELECT count(*)::int n FROM square_webhook.inbox WHERE event_id=$1':'SELECT count(*)::int n FROM square_webhook.inbox',event?[event]:[])).rows[0].n);
const roleName='wh_receiver_probe',rolePassword=randomBytes(16).toString('hex');
const receiverPool=(overrides:Record<string,unknown>={})=>new Pool({host:'127.0.0.1',port:db.identity.dbPort,database:db.identity.database,user:roleName,password:rolePassword,max:2,connectionTimeoutMillis:1500,idleTimeoutMillis:5000,...overrides});
const handlerFor=(pool:InboxPool|Pool)=>ingressHandler(config,()=>new PgSquareProductionWebhookInbox(pool));
async function freePort(){return new Promise<number>((resolve,reject)=>{const s=createServer();s.listen(0,'127.0.0.1',()=>{const p=(s.address() as {port:number}).port;s.close(()=>resolve(p));});s.on('error',reject);});}
const pools:Pool[]=[];const track=(p:Pool)=>{p.on('error',()=>{});pools.push(p);return p;};
try{
 await migrate(owner);
 await owner.query(`CREATE ROLE ${roleName} LOGIN PASSWORD '${rolePassword}'`);
 await owner.query(`GRANT CONNECT ON DATABASE "${db.identity.database}" TO ${roleName}`);
 await owner.query(`GRANT USAGE ON SCHEMA square_webhook TO ${roleName}`);
 // Deliberately NOT yet granted: EXECUTE on receive_production (the permission-missing case).

 await check('missing EXECUTE on receive_production: 503, nothing stored; after the grant the Square retry is stored exactly once',async()=>{
  const pool=track(receiverPool()),h=handlerFor(pool);
  const denied=await h(signed('evt_perm'));assert.equal(denied.status,503);assert.equal(await body(denied),'WEBHOOK_INBOX_UNAVAILABLE');assert.equal(await rows(),0);
  await owner.query(`GRANT EXECUTE ON FUNCTION square_webhook.receive_production(text,text,text,text,text) TO ${roleName}`);
  const retried=await h(signed('evt_perm'));assert.equal(retried.status,200);assert.equal(await body(retried),'RECEIVED');assert.equal(await rows('evt_perm'),1);
  const again=await h(signed('evt_perm'));assert.equal(await body(again),'DUPLICATE');assert.equal(await rows('evt_perm'),1);
 });

 await check('the receiver role cannot reach the generic receive(), claim(), settle() or the table (least privilege holds)',async()=>{
  const pool=track(receiverPool());
  for(const sql of ["SELECT square_webhook.receive('PRODUCTION','x','payment.updated','m','p',repeat('a',64))",'SELECT * FROM square_webhook.inbox',"SELECT * FROM square_webhook.claim('PRODUCTION',60)"])await assert.rejects(pool.query(sql),{code:'42501'});
 });

 await check('database unreachable (connection refused): 503 quickly, nothing stored; same event stored once after recovery',async()=>{
  const dead=track(receiverPool({port:await freePort()})),started=Date.now();
  const down=await handlerFor(dead)(signed('evt_down'));assert.equal(down.status,503);assert.equal(await body(down),'WEBHOOK_INBOX_UNAVAILABLE');assert.ok(Date.now()-started<4000);assert.equal(await rows('evt_down'),0);
  const up=await handlerFor(track(receiverPool()))(signed('evt_down'));assert.equal(up.status,200);assert.equal(await rows('evt_down'),1);
 });

 await check('connection limit reached (role CONNECTION LIMIT): 503 while saturated, never a partial row; stored once after release',async()=>{
  // Idle connections of earlier cases would themselves count against the role limit.
  for(const p of pools.splice(0))await p.end();
  await owner.query(`ALTER ROLE ${roleName} CONNECTION LIMIT 1`);
  const filler=track(receiverPool({max:1}));const held=await filler.connect();
  try{
   const starved=track(receiverPool({max:1})),r=await handlerFor(starved)(signed('evt_limit'));assert.equal(r.status,503);assert.equal(await rows('evt_limit'),0);
  }finally{held.release();}
  for(const p of pools.splice(0))await p.end();
  await owner.query(`ALTER ROLE ${roleName} CONNECTION LIMIT -1`);
  const ok=await handlerFor(track(receiverPool()))(signed('evt_limit'));assert.equal(ok.status,200);assert.equal(await rows('evt_limit'),1);
 });

 await check('local pool exhausted (all receiver connections busy past connectionTimeoutMillis): 503, then recovers',async()=>{
  const pool=track(receiverPool({max:1,connectionTimeoutMillis:300})),busy=await pool.connect();
  const r=await handlerFor(pool)(signed('evt_pool'));assert.equal(r.status,503);assert.equal(await rows('evt_pool'),0);
  busy.release();assert.equal((await handlerFor(pool)(signed('evt_pool'))).status,200);assert.equal(await rows('evt_pool'),1);
 });

 await check('row lock held by another transaction (slow database): bounded by lock_timeout, answers 503 and later retry is DUPLICATE, no second row',async()=>{
  const pool=track(receiverPool()),h=handlerFor(pool);assert.equal((await h(signed('evt_lock'))).status,200);
  const locker=await owner.connect();try{
   await locker.query('BEGIN');await locker.query("SELECT 1 FROM square_webhook.inbox WHERE event_id='evt_lock' FOR UPDATE");
   const started=Date.now(),slow=await h(signed('evt_lock'));
   assert.equal(slow.status,503);assert.equal(await body(slow),'WEBHOOK_INBOX_UNAVAILABLE');assert.ok(Date.now()-started<4500,'bounded by the 2 s lock_timeout, not unbounded');
  }finally{await locker.query('ROLLBACK');locker.release();}
  assert.equal(await body(await h(signed('evt_lock'))),'DUPLICATE');assert.equal(await rows('evt_lock'),1);
 });

 await check('connection killed server-side while the transaction is open (compute restart / idle kill): 503 without crashing the process, nothing stored, next delivery succeeds',async()=>{
  // Without an error listener on the checked-out client, pg emits an unhandled 'error' here and the whole receiver process dies.
  const pool=track(receiverPool({max:1}));let killOnce=true;
  const killing:InboxPool={async connect(){
   const client=await pool.connect();
   return {release:(e?:boolean|Error)=>client.release(e as boolean),on:(...a:unknown[])=>(client as unknown as {on:(...a:unknown[])=>unknown}).on(...a),off:(...a:unknown[])=>(client as unknown as {off:(...a:unknown[])=>unknown}).off(...a),
    query:(async(sql:string,values?:unknown[])=>{
     const r=await client.query(sql,values);
     if(sql==='BEGIN'&&killOnce){killOnce=false;const pid=(await client.query('SELECT pg_backend_pid() pid')).rows[0].pid;await owner.query('SELECT pg_terminate_backend($1)',[pid]);await new Promise(x=>setTimeout(x,150));}
     return r;}) as unknown as InboxConnection['query']} as unknown as InboxConnection;
  }};
  const h=handlerFor(killing);
  const first=await h(signed('evt_killed'));assert.equal(first.status,503);assert.equal(await body(first),'WEBHOOK_INBOX_UNAVAILABLE');assert.equal(await rows('evt_killed'),0);
  const second=await h(signed('evt_killed'));assert.equal(second.status,200);assert.equal(await rows('evt_killed'),1);
 });

 await check('commit succeeded but the response path failed (uncertain COMMIT): 503 to Square, row IS stored, retry is DUPLICATE (ACK loss never duplicates)',async()=>{
  const pool=track(receiverPool({max:1}));
  const lossy:InboxPool={async connect(){
   const client=await pool.connect();
   return {release:(e?:boolean|Error)=>client.release(e as boolean),query:(async(sql:string,values?:unknown[])=>{const r=await client.query(sql,values);if(sql==='COMMIT')throw new Error('SYNTHETIC_CONNECTION_LOST_AFTER_COMMIT');return r;}) as unknown as InboxConnection['query']} as InboxConnection;
  }};
  const lost=await handlerFor(lossy)(signed('evt_uncertain'));assert.equal(lost.status,503);assert.equal(await rows('evt_uncertain'),1);
  assert.equal(await body(await handlerFor(pool)(signed('evt_uncertain'))),'DUPLICATE');assert.equal(await rows('evt_uncertain'),1);
 });

 await check('cold start: pool creation throws on first call (factory failure) -> 503, then the next invocation succeeds',async()=>{
  let calls=0;const h=ingressHandler(config,()=>{calls++;if(calls===1)throw new Error('SYNTHETIC_POOL_CREATE_FAILED');return new PgSquareProductionWebhookInbox(track(receiverPool()));});
  const first=await h(signed('evt_cold'));assert.equal(first.status,503);assert.equal(await body(first),'WEBHOOK_INBOX_UNAVAILABLE');assert.equal(await rows('evt_cold'),0);
  assert.equal((await h(signed('evt_cold'))).status,200);assert.equal(await rows('evt_cold'),1);
 });

 await check('database failure never loosens verification: bad signature is 403 and wrong merchant 403 even while the database is down; neither touches the pool',async()=>{
  let touched=0;const h=ingressHandler(config,()=>{touched++;throw new Error('DB_DOWN');});
  const bad=new Request(url,{method:'POST',body:'{}',headers:{'x-square-hmacsha256-signature':'A'.repeat(43)+'='}});
  assert.equal((await h(bad)).status,403);
  const other=JSON.stringify({event_id:'evt_m',type:'payment.updated',merchant_id:'OTHER',data:{object:{payment:{id:'p'}}}});
  assert.equal((await h(new Request(url,{method:'POST',body:other,headers:{'x-square-hmacsha256-signature':createHmac('sha256',key).update(url).update(other).digest('base64')}}))).status,403);
  assert.equal(touched,0);
 });

 await check('out-of-order delivery (payment.updated before payment.created) and same-event duplicates: each distinct event stored once, state RECEIVED, no job created by the receiver',async()=>{
  const pool=track(receiverPool()),h=handlerFor(pool);
  assert.equal(await body(await h(signed('evt_upd','payment.updated','pay_order'))),'RECEIVED');
  assert.equal(await body(await h(signed('evt_crt','payment.created','pay_order'))),'RECEIVED');
  assert.equal(await body(await h(signed('evt_upd','payment.updated','pay_order'))),'DUPLICATE');
  const concurrent=await Promise.all([1,2,3,4].map(()=>h(signed('evt_race','payment.updated','pay_order'))));
  assert.deepEqual(concurrent.map(r=>r.status).sort(),[200,200,200,200]);assert.equal(await rows('evt_race'),1);
  const stored=(await owner.query("SELECT event_id,event_type,state,attempt,job_dispatched_at IS NULL AS undispatched FROM square_webhook.inbox WHERE payment_id='pay_order' ORDER BY received_at")).rows;
  assert.deepEqual(stored.map(r=>[r.event_id,r.event_type,r.state,r.attempt,r.undispatched]),[['evt_upd','payment.updated','RECEIVED',0,true],['evt_crt','payment.created','RECEIVED',0,true],['evt_race','payment.updated','RECEIVED',0,true]]);
  assert.equal((await owner.query("SELECT count(*)::int n FROM payment_reconciliation.jobs WHERE payment_id='pay_order'")).rows[0].n,0);
 });

 await check('same event_id with a different body is preserved as HASH_CONFLICT (409): original identity kept, conflict counted',async()=>{
  const h=handlerFor(track(receiverPool()));
  assert.equal((await h(signed('evt_hash','payment.updated','pay_hash'))).status,200);
  const changed=await h(signed('evt_hash','payment.updated','pay_hash',{created_at:'2026-11-01T00:00:00Z'}));assert.equal(changed.status,409);assert.equal(await body(changed),'EVENT_HASH_CONFLICT');
  const row=(await owner.query("SELECT conflict_count,state FROM square_webhook.inbox WHERE event_id='evt_hash'")).rows[0];assert.equal(row.conflict_count,1);assert.equal(row.state,'BLOCKED');
 });
}finally{
 for(const p of pools)await p.end().catch(()=>undefined);
 await db.stop();
}
console.log(`webhook inbox failure modes: ${results.length} checks passed (real PostgreSQL, synthetic only)`);
