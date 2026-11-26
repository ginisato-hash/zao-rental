import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createHmac} from 'node:crypto';
import {PgSquareProductionWebhookInbox,type InboxConnection} from '../../packages/db/src/square-webhook-inbox';
import {ingressHandler} from '../../apps/webhook-ingress/src/handler';
import type {IngressConfiguration} from '../../apps/webhook-ingress/src/config';

// Fixture-only (no database). The real-PostgreSQL counterpart is tests/readiness/webhook-inbox-failure-modes.ts.
const key='synthetic-fixture-key-not-a-credential',merchant='SYNTHETIC-PRODUCTION-MERCHANT',url='https://synthetic.example.invalid/api/webhooks/square';
const config:IngressConfiguration={webhook:{environment:'PRODUCTION',signatureKey:key,notificationUrl:url,merchantId:merchant},database:{}};
const request=(event='evt_fixture')=>{const raw=JSON.stringify({event_id:event,type:'payment.updated',merchant_id:merchant,data:{object:{payment:{id:'pay_fixture'}}}});
 return new Request(url,{method:'POST',body:raw,headers:{'x-square-hmacsha256-signature':createHmac('sha256',key).update(url).update(raw).digest('base64')}});};
class FakeClient extends EventEmitter{
 released:(boolean|Error|undefined)[]=[];
 constructor(private readonly run:(sql:string,client:FakeClient)=>Promise<unknown[]>){super();}
 async query(sql:string){return {rows:await this.run(sql,this)};}
 release(e?:boolean|Error){this.released.push(e);}
}
const poolOf=(client:FakeClient)=>({async connect(){return client as unknown as InboxConnection;}});
const body=async(r:Response)=>await r.text();

test('an error event on the checked-out connection (server-side disconnect mid-transaction) is contained: 503, connection destroyed, listener removed afterwards',async()=>{
 const client=new FakeClient(async(sql,c)=>{
  if(sql.includes('receive_production')){c.emit('error',new Error('terminating connection due to administrator command'));throw new Error('terminating connection');}
  return [];
 });
 const response=await ingressHandler(config,()=>new PgSquareProductionWebhookInbox(poolOf(client)))(request());
 assert.equal(response.status,503);
 const text=await body(response);assert.equal(text,JSON.stringify({classification:'WEBHOOK_INBOX_UNAVAILABLE'}));assert.ok(!/terminating|administrator/.test(text));
 assert.deepEqual(client.released,[true]);assert.equal(client.listenerCount('error'),0,'no leaked listener on a reused client');
});

test('error listener is attached for the whole transaction and removed after a successful commit (no accumulation across requests)',async()=>{
 let during=-1;
 const client=new FakeClient(async sql=>{if(sql.includes('receive_production')){during=client.listenerCount('error');return [{result:'INSERTED'}];}return [];});
 const h=ingressHandler(config,()=>new PgSquareProductionWebhookInbox(poolOf(client)));
 for(let i=0;i<15;i++)assert.equal((await h(request('evt_'+i))).status,200);
 assert.equal(during,1);assert.equal(client.listenerCount('error'),0);
});

test('every database-side failure shape answers the same sanitized 503 and never leaks a driver message',async()=>{
 const shapes:[string,(sql:string)=>void][]=[
  ['permission denied for function receive_production',s=>{if(s.includes('receive_production'))throw Object.assign(new Error('permission denied for function receive_production'),{code:'42501'});}],
  ['too many connections for role',s=>{if(s==='BEGIN')throw Object.assign(new Error('too many connections for role "x_pay_receipt"'),{code:'53300'});}],
  ['canceling statement due to lock timeout',s=>{if(s.includes('receive_production'))throw Object.assign(new Error('canceling statement due to lock timeout'),{code:'55P03'});}],
  ['canceling statement due to statement timeout',s=>{if(s.includes('receive_production'))throw Object.assign(new Error('canceling statement due to statement timeout'),{code:'57014'});}],
  ['connection terminated unexpectedly',s=>{if(s==='COMMIT')throw new Error('Connection terminated unexpectedly');}],
 ];
 for(const [label,fail] of shapes){
  const client=new FakeClient(async sql=>{fail(sql);return sql.includes('receive_production')?[{result:'INSERTED'}]:[];});
  const r=await ingressHandler(config,()=>new PgSquareProductionWebhookInbox(poolOf(client)))(request());
  assert.equal(r.status,503,label);assert.equal(await body(r),JSON.stringify({classification:'WEBHOOK_INBOX_UNAVAILABLE'}),label);assert.deepEqual(client.released,[true],label);
 }
});

test('pool acquisition failure, connection timeout and a throwing pool factory all answer 503; a later call that works succeeds',async()=>{
 let calls=0;
 const h=ingressHandler(config,()=>{calls++;
  if(calls===1)throw new Error('SYNTHETIC_POOL_CREATE_FAILED');
  if(calls===2)return new PgSquareProductionWebhookInbox({async connect(){throw new Error('timeout exceeded when trying to connect');}});
  return new PgSquareProductionWebhookInbox(poolOf(new FakeClient(async sql=>sql.includes('receive_production')?[{result:'INSERTED'}]:[])));});
 assert.equal((await h(request())).status,503);assert.equal((await h(request())).status,503);assert.equal((await h(request())).status,200);
});

test('static: no runtime source calls the legacy inbox claim/settle, so square_webhook.inbox.state staying RECEIVED is the designed steady state (progress is in payment_reconciliation.jobs)',async()=>{
 const {readdirSync,readFileSync,statSync}=await import('node:fs');
 const files:string[]=[];
 const walk=(dir:string)=>{for(const name of readdirSync(dir)){if(name==='node_modules'||name==='.next')continue;const p=dir+'/'+name,s=statSync(p);if(s.isDirectory())walk(p);else if(/\.(ts|tsx|mjs)$/.test(name))files.push(p);}};
 for(const dir of ['packages','apps','scripts'])walk(dir);
 const callers=files.filter(f=>!/square-webhook-inbox\.ts$/.test(f)&&/square_webhook\.(?:claim|settle)\(|\.settle\(/.test(readFileSync(f,'utf8')));
 assert.deepEqual(callers,[]);
});

test('a missing/invalid configuration answers WEBHOOK_NOT_CONFIGURED 503 for every signed request and never opens the inbox',async()=>{
 let opened=0;const h=ingressHandler(null,()=>{opened++;throw new Error('UNREACHABLE');});
 const r=await h(request());assert.equal(r.status,503);assert.equal(await body(r),JSON.stringify({classification:'WEBHOOK_NOT_CONFIGURED'}));assert.equal(opened,0);
});
