import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {squareWebhookReceiver,SQUARE_WEBHOOK_LIMIT} from '../../packages/core/src/payment/square-webhook-receiver';
import type {InboxSignal,SquareWebhookInbox,Receipt} from '../../packages/core/src/payment/square-webhook-inbox';
import {squareWebhookConfiguration,SQUARE_WEBHOOK_MERCHANT} from '../../apps/web/src/lib/square-webhook-config';
const url='https://synthetic.example.invalid/api/webhooks/square',key='synthetic-fixture-key-not-a-credential';
const config={environment:'SANDBOX' as const,merchantId:SQUARE_WEBHOOK_MERCHANT,notificationUrl:url,signatureKey:key};
const event=(overrides:Record<string,unknown>={})=>({event_id:'fixture-event',type:'payment.updated',merchant_id:config.merchantId,data:{object:{payment:{id:'fixture-payment',status:'COMPLETED',card_details:{ignored:'synthetic-sensitive-data'}}}},...overrides});
const bytes=(v:unknown)=>Buffer.from(JSON.stringify(v));
const sign=(raw:Uint8Array,notificationUrl=url)=>createHmac('sha256',key).update(notificationUrl).update(raw).digest('base64');
function request(raw=bytes(event()),headers:Record<string,string>={},signature=sign(raw)){
 return new Request(url,{method:'POST',headers:{'x-square-hmacsha256-signature':signature,...headers},body:raw});
}
class FixtureInbox implements SquareWebhookInbox{
 readonly rows=new Map<string,InboxSignal>();readonly conflicts:InboxSignal[]=[];calls=0;
 async receive(s:InboxSignal):Promise<Receipt>{this.calls++;const id=s.environment+':'+s.eventId,old=this.rows.get(id);
  if(!old){this.rows.set(id,{...s});return 'INSERTED';}if(old.bodySha256===s.bodySha256)return 'DUPLICATE';this.conflicts.push(s);return 'HASH_CONFLICT';}
}
function setup(){const inbox=new FixtureInbox();return {inbox,handler:squareWebhookReceiver(config,()=>inbox)};}
for(const type of ['payment.created','payment.updated'])test(type+' signed receipt persists only whitelisted signal metadata',async()=>{
 const {inbox,handler}=setup();const raw=bytes(event({type}));const response=await handler(request(raw));
 assert.equal(response.status,200);assert.deepEqual(await response.json(),{classification:'RECEIVED'});
 assert.deepEqual([...inbox.rows.values()],[{eventId:'fixture-event',type,merchantId:config.merchantId,paymentId:'fixture-payment',environment:'SANDBOX',bodySha256:createHash('sha256').update(raw).digest('hex')}]);
 assert.equal(response.headers.get('cache-control'),'no-store');
});
for(const signature of ['', 'bad', Buffer.alloc(32).toString('base64')])test('missing/invalid signature '+signature.length+' never opens inbox or parses malformed JSON',async()=>{
 const {inbox,handler}=setup();const response=await handler(request(Buffer.from('{'),{},signature));assert.equal(response.status,403);assert.equal(inbox.calls,0);
});
for(const raw of [Buffer.from('{'),Buffer.from([0xff]),Buffer.from('null'),Buffer.from('[]'),Buffer.from('42')])test('signed malformed UTF8/JSON/envelope '+raw.toString('hex')+' rejects before persistence',async()=>{
 const {inbox,handler}=setup();assert.equal((await handler(request(raw))).status,422);assert.equal(inbox.calls,0);
});
for(const e of [event({event_id:undefined}),event({event_id:''}),event({event_id:'x'.repeat(129)}),event({event_id:'bad\nline'}),event({merchant_id:''}),event({type:undefined}),event({data:{object:{payment:{}}}}),event({data:{object:{payment:{id:''}}}}),event({data:{object:{payment:{id:'x'.repeat(101)}}}})])test('missing/invalid identity '+JSON.stringify(e).slice(0,70),async()=>{
 const {inbox,handler}=setup();assert.equal((await handler(request(bytes(e)))).status,422);assert.equal(inbox.calls,0);
});
test('signed wrong merchant rejected for supported and unsupported event',async()=>{
 const {inbox,handler}=setup();for(const type of ['payment.updated','refund.updated'])assert.equal((await handler(request(bytes(event({type,merchant_id:'OTHER_MERCHANT'}))))).status,403);assert.equal(inbox.calls,0);
});
test('unsupported signed correct-merchant envelope is explicitly ignored without a payment ACK/retry loop',async()=>{
 const {inbox,handler}=setup();const r=await handler(request(bytes(event({type:'refund.updated',data:{}}))));assert.equal(r.status,200);assert.deepEqual(await r.json(),{classification:'IGNORED_UNSUPPORTED_EVENT'});assert.equal(inbox.calls,0);
});
test('raw whitespace/order remain signed exactly; request host/forwarded headers cannot replace configured URL',async()=>{
 const {inbox,handler}=setup();const raw=Buffer.from(JSON.stringify(event(),null,2)+'\n');
 assert.equal((await handler(request(raw,{'x-forwarded-host':'attacker.invalid',host:'attacker.invalid'}))).status,200);
 assert.equal([...inbox.rows.values()][0]?.bodySha256,createHash('sha256').update(raw).digest('hex'));
 assert.equal((await handler(request(raw,{},sign(bytes(event()))))).status,403);
 assert.equal((await handler(request(raw,{},sign(raw,'https://attacker.invalid/api/webhooks/square')))).status,403);
});
for(const announced of [undefined,String(SQUARE_WEBHOOK_LIMIT+1),'1'])test('oversized body actual limit with content-length '+announced,async()=>{
 const {inbox,handler}=setup();const headers=announced?{'content-length':announced}:{};
 assert.equal((await handler(request(Buffer.alloc(SQUARE_WEBHOOK_LIMIT+1),headers))).status,413);assert.equal(inbox.calls,0);
});
test('stream read once, exact 64KiB allowed; missing content length does not permit excess chunks',async()=>{
 const {handler}=setup();const payload=JSON.stringify(event()),raw=Buffer.from(payload+' '.repeat(SQUARE_WEBHOOK_LIMIT-Buffer.byteLength(payload)));
 assert.equal((await handler(request(raw))).status,200);
 let i=0,cancelled=0;const stream=new ReadableStream<Uint8Array>({pull(c){c.enqueue(new Uint8Array(32769));i++;},cancel(){cancelled++;}});
 const r=new Request(url,{method:'POST',body:stream,duplex:'half'} as RequestInit);
 assert.equal((await handler(r)).status,413);assert.equal(cancelled,1);assert.ok(i<=3);
});
test('stream read failure is redacted and never inserts',async()=>{
 const {inbox,handler}=setup();const stream=new ReadableStream<Uint8Array>({start(c){c.error(new Error('synthetic-secret-body'));}});
 const r=await handler(new Request(url,{method:'POST',body:stream,duplex:'half'} as RequestInit));assert.equal(r.status,400);assert.ok(!(await r.text()).includes('synthetic-secret'));assert.equal(inbox.calls,0);
});
test('20 concurrent deliveries and same stored key after a lost ACK are deduped by fixture repository',async()=>{
 const {inbox,handler}=setup();const replies=await Promise.all(Array.from({length:20},()=>handler(request())));
 assert.ok(replies.every(r=>r.status===200));assert.equal(inbox.rows.size,1);
 const newHandler=squareWebhookReceiver(config,()=>inbox);assert.deepEqual(await (await newHandler(request())).json(),{classification:'DUPLICATE'});
});
test('event ID reuse with different raw hash records conflict and preserves original signal',async()=>{
 const {inbox,handler}=setup();await handler(request());const original=[...inbox.rows.values()][0];
 const changed=bytes(event({data:{object:{payment:{id:'other-payment'}}}}));const response=await handler(request(changed));
 assert.equal(response.status,409);assert.deepEqual(await response.json(),{classification:'EVENT_HASH_CONFLICT'});assert.deepEqual([...inbox.rows.values()][0],original);assert.equal(inbox.conflicts.length,1);
});
test('out-of-order updated/created events are separate signals; no provider or business state is available to handler',async()=>{
 const {inbox,handler}=setup();const originalFetch=globalThis.fetch;let providerCalls=0;
 globalThis.fetch=async()=>{providerCalls++;throw new Error('external call prohibited');};
 try{for(const e of [event({event_id:'updated',type:'payment.updated'}),event({event_id:'created',type:'payment.created'})])assert.equal((await handler(request(bytes(e)))).status,200);}
 finally{globalThis.fetch=originalFetch;}
 assert.equal(providerCalls,0);assert.equal(inbox.rows.size,2);assert.ok([...inbox.rows.values()].every(s=>!('status' in s)));
 const source=readFileSync('packages/core/src/payment/square-webhook-receiver.ts','utf8');
 assert.doesNotMatch(source,/booking-service|hold-service|custody|sandbox-gateway|console\.|fetch\(/);
});
for(const headers of [{},{'square-retry-number':'1','square-retry-reason':'http_timeout'},{'square-retry-number':'-999'}])test('retry headers grant no authority '+JSON.stringify(headers),async()=>{
 const {inbox,handler}=setup();await handler(request());const response=await handler(request(bytes(event()),headers));assert.equal(response.status,200);assert.equal(inbox.rows.size,1);
});
test('ACK waits for successful persistence; DB failure/body details never appear in response or logs',async()=>{
 let commit:()=>void=()=>{};const barrier=new Promise<void>(resolve=>{commit=resolve;});let entered:()=>void=()=>{};const enteredBarrier=new Promise<void>(r=>{entered=r;});let resolved=false;
 const handler=squareWebhookReceiver(config,()=>({async receive(){entered();await barrier;return 'INSERTED';}}));
 const pending=handler(request()).then(r=>{resolved=true;return r;});await enteredBarrier;assert.equal(resolved,false);commit();assert.equal((await pending).status,200);
 const originalLog=console.log,originalError=console.error;const logs:unknown[]=[];console.log=(...v)=>{logs.push(v);};console.error=(...v)=>{logs.push(v);};
 try{for(const receive of [async()=>{throw Object.assign(new Error('synthetic-secret-body'),{code:'INVALID_WEBHOOK'});},async()=> 'UNKNOWN' as Receipt]){
  const r=await squareWebhookReceiver(config,()=>({receive}))(request());assert.equal(r.status,503);assert.deepEqual(await r.json(),{classification:'WEBHOOK_INBOX_UNAVAILABLE'});
 }}finally{console.log=originalLog;console.error=originalError;}
 assert.deepEqual(logs,[]);
});
test('method guard and missing config fail closed without pool factory',async()=>{
 let calls=0;const handler=squareWebhookReceiver(null,()=>{calls++;throw new Error('no pool');});
 const get=await handler(new Request(url));assert.equal(get.status,405);assert.equal(get.headers.get('allow'),'POST');
 assert.equal((await handler(request())).status,503);assert.equal(calls,0);
});
const database=new URL('postgresql://fixture.invalid/fixture');database.username='zao_square_webhook_receiver';database.password='SYNTHETIC_ONLY';
const env={ZAO_SQUARE_WEBHOOK_ACTIVATION:'SANDBOX',VERCEL_ENV:'preview',SQUARE_ENVIRONMENT:'SANDBOX',SQUARE_API_VERSION:'2026-08-19',SQUARE_SANDBOX_MERCHANT_ID:config.merchantId,SQUARE_SANDBOX_WEBHOOK_SIGNATURE_KEY:key,SQUARE_SANDBOX_NOTIFICATION_URL:url,SQUARE_WEBHOOK_DATABASE_URL:database.href};
test('explicit Sandbox Preview config only, fixed merchant/version/dedicated TLS receiver identity, no access-token dependency',()=>{
 assert.equal(squareWebhookConfiguration(env)?.receiver.notificationUrl,url);
 for(const key of Object.keys(env))assert.equal(squareWebhookConfiguration({...env,[key]:undefined}),null,key);
 for(const delta of [{VERCEL_ENV:'production'},{NEXT_PUBLIC_SQUARE:'fixture-only'},{SQUARE_SANDBOX_NOTIFICATION_URL:' '+url},{SQUARE_SANDBOX_NOTIFICATION_URL:url.replace('synthetic','SYNTHETIC')},{SQUARE_ENVIRONMENT:'PRODUCTION'},{ZAO_SQUARE_WEBHOOK_ACTIVATION:'PRODUCTION'},{SQUARE_SANDBOX_MERCHANT_ID:'OTHER'},{SQUARE_API_VERSION:'2020-01-01'},{SQUARE_SANDBOX_NOTIFICATION_URL:'http://example.invalid/api/webhooks/square'},{SQUARE_SANDBOX_NOTIFICATION_URL:url+'?secret=x'},{SQUARE_WEBHOOK_DATABASE_URL:env.SQUARE_WEBHOOK_DATABASE_URL.replace('zao_square_webhook_receiver','postgres')},{SQUARE_WEBHOOK_DATABASE_URL:env.SQUARE_WEBHOOK_DATABASE_URL+'?sslmode=disable'}])assert.equal(squareWebhookConfiguration({...env,...delta}),null);
 assert.equal(squareWebhookConfiguration({SQUARE_PRODUCTION_WEBHOOK_SIGNATURE_KEY:key}),null);
 const guarded=new Proxy({},{get(_target,name){if(name==='ZAO_SQUARE_WEBHOOK_ACTIVATION')return undefined;throw new Error('must not read secret before activation guard');}});
 assert.equal(squareWebhookConfiguration(guarded),null);
});
test('Next route with official Next server-only alias exports GET405 and unconfigured POST503 in isolated Node (no server/browser/DB)',()=>{
 const script=`const {registerHooks}=await import('node:module');registerHooks({resolve(s,c,next){return next(s==='server-only'?'next/dist/compiled/server-only/empty.js':s,c);}});const {GET,POST,HEAD,OPTIONS,PUT,PATCH,DELETE}=await import('./apps/web/src/app/api/webhooks/square/route.ts'); for(const method of [GET,HEAD,OPTIONS,PUT,PATCH,DELETE]){if(method().status!==405)process.exit(3);}const a=GET(); const b=await POST(new Request('https://fixture.invalid/api/webhooks/square',{method:'POST',body:'{}'})); if(a.status!==405||b.status!==503)process.exit(2);`;
 const r=spawnSync(process.execPath,['--conditions=react-server','--import','tsx','--input-type=module','-e',script],{encoding:'utf8',env:{PATH:process.env.PATH,NODE_ENV:'production',VERCEL_ENV:'production'},timeout:15000});
 assert.equal(r.status,0,r.stderr);assert.equal(r.stdout,'');
});

test('actually absent signature header, not just empty value, is 403 before inbox creation',async()=>{
 const {handler,inbox}=setup();assert.equal((await handler(new Request(url,{method:'POST',body:JSON.stringify(event())}))).status,403);assert.equal(inbox.calls,0);
});
