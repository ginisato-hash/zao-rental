import assert from 'node:assert/strict';
import {createHmac,randomBytes,randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import type {Socket} from 'node:net';
import {mkdirSync,writeFileSync} from 'node:fs';
import {FetchSquareSandboxTransport,type SandboxCredential} from '../../packages/core/src/payment/square-transport';
import {SquareSandboxGateway,SQUARE_SANDBOX_ORIGIN,SQUARE_VERSION} from '../../packages/core/src/payment/square-sandbox';
import {squareCreateBody} from '../../packages/core/src/payment/square-boundary';
import type {PaymentRequest} from '../../packages/contracts/src/rental-flow';

// Explicit synthetic transport. No ambient/default network or credential resolver.
const request:PaymentRequest={attemptId:randomUUID(),bookingId:randomUUID(),idempotencyKey:randomUUID(),merchantId:'SYNTHETIC-MERCHANT',locationId:'SYNTHETIC-LOCATION',amountJpy:7500,currency:'JPY'};
const payment={id:'synthetic_provider_id',reference_id:request.bookingId,location_id:request.locationId,amount_money:{amount:7500,currency:'JPY'},status:'COMPLETED',updated_at:'2035-01-01T00:00:00Z',card_details:{card_payment_timeline:{captured_at:'2035-01-01T00:00:00Z'}}};
const credential:SandboxCredential={environment:'SANDBOX',merchantId:request.merchantId,locationId:request.locationId,accessToken:randomBytes(32).toString('base64url'),expiresAt:new Date('2035-02-01'),revoked:false};
function fixture(){
 const calls:{method:string;key:string|null}[]=[],saved=new Map<string,{body:string;payment:typeof payment}>();let loseResponse=false;let patch:Record<string,unknown>={};
 const transport=new FetchSquareSandboxTransport(request.merchantId,request.locationId,async()=>credential,async(url,init)=>{
  assert.ok(url.startsWith(SQUARE_SANDBOX_ORIGIN+'/v2/payments'));assert.equal(new Headers(init.headers).get('square-version'),SQUARE_VERSION);assert.equal(init.redirect,'error');assert.equal(init.credentials,'omit');
  const body=init.body?JSON.parse(String(init.body)):null;calls.push({method:init.method!,key:body?.idempotency_key??null});
  if(init.method==='POST'){
   const old=saved.get(body.idempotency_key);if(old&&old.body!==String(init.body))return Response.json({error:'SYNTHETIC_CONFLICT'},{status:409});
   saved.set(body.idempotency_key,old??{body:String(init.body),payment});if(loseResponse){loseResponse=false;throw new Error('SYNTHETIC_RESPONSE_LOST');}
  }else if(!saved.size)return Response.json({error:'SYNTHETIC_NOT_FOUND'},{status:404});
  return Response.json({payment:{...payment,...patch}});
 },()=>new Date('2035-01-01'));
 return {transport,gateway:new SquareSandboxGateway(transport,async()=> 'SYNTHETIC_SOURCE'),calls,saved,lose:()=>{loseResponse=true;},patch:(p:Record<string,unknown>)=>{patch=p;}};
}
function deferred<T>(){let resolve!:(value:T|PromiseLike<T>)=>void,reject!:(reason:unknown)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
const cases:{id:string;evidence:string;passed:boolean}[]=[];
async function check(id:string,evidence:string,run:()=>Promise<void>){await run();cases.push({id,evidence,passed:true});console.log('PASS '+id+' ['+evidence+']');}

await check('same-idempotency-replay','stateful fixture transport',async()=>{const f=fixture();const a=await f.gateway.create(request),b=await f.gateway.create(request);assert.deepEqual(b,a);assert.equal(f.saved.size,1);assert.deepEqual(f.calls.map(c=>c.key),[request.idempotencyKey,request.idempotencyKey]);await assert.rejects(f.gateway.create({...request,amountJpy:7501}),{code:'PAYMENT_RESULT_UNKNOWN'});assert.equal(f.saved.size,1);});
await check('response-loss-provider-lookup','stateful fixture transport',async()=>{const f=fixture();f.lose();await assert.rejects(f.gateway.create(request),{code:'PAYMENT_RESULT_UNKNOWN'});assert.equal(f.saved.size,1);await assert.rejects(f.gateway.lookup(request,null),{code:'PAYMENT_PROVIDER_ID_UNRESOLVED'});assert.equal(f.calls.length,1);assert.equal((await f.gateway.lookup(request,payment.id)).status,'COMPLETED');assert.deepEqual(f.calls.map(c=>c.method),['POST','GET']);});
await check('timeout-no-retry','fixture fetch and AbortSignal',async()=>{let count=0,signal:AbortSignal|null|undefined;const t=new FetchSquareSandboxTransport(request.merchantId,request.locationId,async()=>credential,async(_url,init)=>{count++;signal=init.signal;return new Promise<Response>(()=>{});},()=>new Date('2035-01-01'));await assert.rejects(new SquareSandboxGateway(t,async()=> 'SYNTHETIC_SOURCE',20).create(request),{code:'PAYMENT_RESULT_UNKNOWN'});assert.equal(count,1);assert.equal((signal as AbortSignal|null|undefined)?.aborted,true);});

await check('socket-abort','owned loopback HTTP socket, no TLS/Square',async()=>{
 const entered=deferred<void>(),closed=deferred<void>();const sockets=new Set<Socket>();let accepted:Socket|undefined;
 const server=createServer(req=>{accepted=req.socket;req.socket.once('close',()=>closed.resolve());entered.resolve(); /* intentionally no response */});
 server.on('connection',s=>{sockets.add(s);s.once('close',()=>sockets.delete(s));});
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const address=server.address();assert.ok(address&&typeof address==='object');const controller=new AbortController();let pending:Promise<unknown>|undefined;
 const bounded=deferred<never>();const timer=setTimeout(()=>bounded.reject(new Error('LOOPBACK_ABORT_DID_NOT_SETTLE')),3000);
 try{
  const t=new FetchSquareSandboxTransport(request.merchantId,request.locationId,async()=>credential,async(url,init)=>{
   assert.equal(url,SQUARE_SANDBOX_ORIGIN+'/v2/payments');
   // Adapter may call native fetch ONLY at this test-owned loopback endpoint.
   return fetch(`http://127.0.0.1:${address.port}/abort`,{...init,headers:{'content-type':'application/json'},redirect:'error'});
  },()=>new Date('2035-01-01'));
  pending=assert.rejects(t.send({method:'POST',url:SQUARE_SANDBOX_ORIGIN+'/v2/payments',version:SQUARE_VERSION,body:squareCreateBody(request,'SYNTHETIC_SOURCE'),signal:controller.signal}),{code:'PAYMENT_RESULT_UNKNOWN'});
  await Promise.race([entered.promise,bounded.promise]);controller.abort();await Promise.race([Promise.all([pending,closed.promise]),bounded.promise]);assert.equal(accepted?.destroyed,true);
 }finally{clearTimeout(timer);controller.abort();for(const socket of sockets)socket.destroy();await new Promise<void>(resolve=>server.close(()=>resolve()));if(pending)await pending;}
});

for(const [id,patch,code] of [
 ['wrong-amount',{amount_money:{amount:7499,currency:'JPY'}},'PAYMENT_EVIDENCE_MISMATCH'],
 ['wrong-currency',{amount_money:{amount:7500,currency:'USD'}},'INVALID_PROVIDER_RESPONSE'],
 ['wrong-location',{location_id:'SYNTHETIC-WRONG'},'PAYMENT_EVIDENCE_MISMATCH']
] as const)await check(id,'fixture provider response',async()=>{const f=fixture();await f.gateway.create(request);f.patch(patch);await assert.rejects(f.gateway.lookup(request,payment.id),{code});assert.equal(f.calls.length,2);});
await check('wrong-merchant','trusted account and signed webhook binding',async()=>{const f=fixture();await assert.rejects(f.gateway.create({...request,merchantId:'SYNTHETIC-WRONG'}),{code:'PAYMENT_EVIDENCE_MISMATCH'});const raw=Buffer.from(JSON.stringify({event_id:'synthetic-wrong',merchant_id:'SYNTHETIC-WRONG',type:'payment.updated',data:{object:{payment:{id:payment.id}}}})),url='https://fixture.invalid/webhook',key=randomBytes(32).toString('hex'),signature=createHmac('sha256',key).update(url).update(raw).digest('base64');await assert.rejects(f.gateway.verifiedWebhook(request,raw,signature,url,key),{code:'WEBHOOK_TARGET_MISMATCH'});assert.equal(f.calls.length,0);});
await check('duplicate-out-of-order-webhook','signed fixture input and current provider lookup; DB transitions in payment regression',async()=>{const f=fixture();await f.gateway.create(request);const url='https://fixture.invalid/webhook',key=randomBytes(32).toString('hex');for(const [id,type] of [['new','payment.updated'],['old','payment.created'],['new','payment.updated']]){const raw=Buffer.from(JSON.stringify({event_id:id,merchant_id:request.merchantId,type,data:{object:{payment:{id:payment.id,status:'FAILED'}}}})),signature=createHmac('sha256',key).update(url).update(raw).digest('base64');assert.equal((await f.gateway.verifiedWebhook(request,raw,signature,url,key)).observation.status,'COMPLETED');await assert.rejects(f.gateway.verifiedWebhook(request,Buffer.concat([raw,Buffer.from(' ')]),signature,url,key),{code:'WEBHOOK_SIGNATURE_REJECTED'});}assert.deepEqual(f.calls.map(c=>c.method),['POST','GET','GET','GET']);});
await check('auth-quota-stop','fixture status, one call per explicit test',async()=>{for(const status of [401,403,429]){let calls=0;const t=new FetchSquareSandboxTransport(request.merchantId,request.locationId,async()=>credential,async()=>{calls++;return Response.json({error:'SYNTHETIC'},{status});},()=>new Date('2035-01-01'));await assert.rejects(new SquareSandboxGateway(t,async()=> 'SYNTHETIC_SOURCE').create(request),{code:status===429?'SQUARE_QUOTA_STOP':'SQUARE_AUTH_STOP'});assert.equal(calls,1);}});
mkdirSync('.local/benchmarks',{recursive:true});writeFileSync('.local/benchmarks/p3-square-activation.json',JSON.stringify({cases,externalSquareRequests:0,realCredentials:false,loopbackSocketClosed:true,dbStateMachineEvidence:'separate following tests/flow/payment.ts; this file alone is not DB proof'},null,2)+'\n');
console.log(`Square activation transport: ${cases.length} passed; no skipped; no external requests.`);
