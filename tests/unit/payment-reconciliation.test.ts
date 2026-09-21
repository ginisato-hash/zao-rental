import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {decidePaymentTruth,retryDelaySeconds,type PaymentContext} from '../../packages/core/src/payment/payment-truth';
import {PaymentReconciliationWorker,LookupTimeout,type PaymentTruthProvider,type LookupDeadline} from '../../packages/core/src/payment/payment-reconciliation';
import {SquareSandboxPaymentTruth} from '../../packages/core/src/payment/square-payment-truth';
import {squareWebhookReceiver} from '../../packages/core/src/payment/square-webhook-receiver';
import type {PaymentObservation} from '../../packages/contracts/src/rental-flow';
import {ReconciliationFixture} from '../fixtures/payment-reconciliation';
const expected={attemptId:'attempt-fixture',bookingId:'booking-fixture',idempotencyKey:'key-fixture',merchantId:'merchant-fixture',locationId:'location-fixture',amountJpy:100,currency:'JPY' as const};
const observation:PaymentObservation={providerId:'payment-fixture',referenceId:expected.bookingId,idempotencyKey:expected.idempotencyKey,merchantId:expected.merchantId,locationId:expected.locationId,amountJpy:100,currency:'JPY',status:'PENDING',updatedAt:'2035-01-01T00:00:00.000Z',completedAt:null};
const context=():PaymentContext=>({expected,current:{state:'UNKNOWN',providerId:observation.providerId,providerState:null,providerUpdatedAt:null},latest:null});
const completed={...observation,status:'COMPLETED' as const,completedAt:observation.updatedAt};
const signal=(id='event-fixture',type:'payment.created'|'payment.updated'='payment.updated')=>({environment:'SANDBOX' as const,eventId:id,type,merchantId:expected.merchantId,paymentId:observation.providerId,bodySha256:'a'.repeat(64)});
const decide=(o:unknown,c=context())=>decidePaymentTruth(c,observation.providerId,o,new Date('2035-01-01T01:00:00Z'));
for(const status of ['PENDING','COMPLETED','FAILED','CANCELED'] as const)test('provider truth accepts '+status+' as a proposal, UNKNOWN is local knowledge only',()=>{
 const o={...observation,status,completedAt:status==='COMPLETED'?observation.updatedAt:null};const result=decide(o);assert.equal(result.decision,'ACCEPT_'+status);assert.equal(result.businessApply,'NOT_ACTIVATED');assert.equal(result.fingerprint,decide({...o,card_details:'must-not-store'}).fingerprint);assert.equal(Object.keys(result.observation!).length,10);
});
for(const [key,value] of Object.entries({providerId:'other',referenceId:'other',idempotencyKey:'other',merchantId:'other',locationId:'other',amountJpy:101,currency:'USD',status:'UNKNOWN',updatedAt:'bad',completedAt:'bad'}))test('evidence mismatch blocks '+key,()=>assert.equal(decide({...observation,[key]:value}).decision,'BLOCKED_EVIDENCE_MISMATCH'));
for(const o of [null,{}, {...completed,completedAt:null},{...completed,completedAt:'2035-01-01T02:00:00Z'},{...observation,updatedAt:'2035-01-02T00:00:00Z'},{...observation,amountJpy:100.1}])test('invalid provider response/time '+JSON.stringify(o).slice(0,40),()=>assert.equal(decide(o).decision,'BLOCKED_EVIDENCE_MISMATCH'));
test('duplicate fingerprint is canonical across key order and time zone; no receipt time in decision identity',()=>{const c={...context(),latest:observation};assert.equal(decide(observation,c).decision,'NOOP_DUPLICATE');const a=decide(observation),b=decide({...observation,updatedAt:'2035-01-01T09:00:00+09:00'});assert.equal(a.fingerprint,b.fingerprint);});
test('COMPLETED plus stale PENDING cannot downgrade; equal-time PENDING to COMPLETED is existing accepted behavior',()=>{
 const latest={...completed,updatedAt:'2035-01-01T00:10:00Z'};const c={...context(),latest,current:{...context().current,state:'COMPLETED' as const,providerState:'COMPLETED' as const,providerUpdatedAt:latest.updatedAt}};
 assert.equal(decide(observation,c).decision,'NOOP_STALE');assert.equal(decide({...observation,updatedAt:'2035-01-01T00:11:00Z'},c).decision,'NOOP_TERMINAL');assert.equal(decide(completed,{...context(),latest:observation}).decision,'ACCEPT_COMPLETED');
});
for(const status of ['FAILED','CANCELED'] as const)test(status+' terminal does not restart, contradictory COMPLETED requires review',()=>{
 const prior={...observation,status};const c={...context(),latest:prior,current:{...context().current,state:'FAILED' as const,providerState:status,providerUpdatedAt:prior.updatedAt}};
 assert.equal(decide(observation,c).decision,'NOOP_TERMINAL');assert.equal(decide(completed,c).decision,'BLOCKED_INVALID_TRANSITION');assert.equal(decide(prior,c).decision,'NOOP_DUPLICATE');
});
test('retry budget is deterministic/bounded; input errors are not silently clamped',()=>{
 assert.deepEqual([1,2,3,4,5].map(n=>retryDelaySeconds(n,0.5)),[10,20,40,80,160]);assert.equal(retryDelaySeconds(5,1),240);assert.equal(retryDelaySeconds(1,0),5);
 for(const [n,j] of [[0,0],[6,0],[1,-1],[1,2],[1,NaN]])assert.throws(()=>retryDelaySeconds(n!,j!));
});
const instant:LookupDeadline=async(run)=>run(new AbortController().signal);
function worker(store:ReconciliationFixture,run:PaymentTruthProvider['lookupPayment'],load=async()=>context(),deadline=instant){return new PaymentReconciliationWorker(store,{load},{lookupPayment:run},store.now,()=>0.5,deadline);}
test('receiver -> durable signal -> dispatcher -> one payment job: dedupe and out-of-order coalesce; no lookup before ACK',async()=>{
 const store=new ReconciliationFixture(),url='https://fixture.invalid/api/webhooks/square',key='synthetic-fixture';let lookups=0;
 const receiver=squareWebhookReceiver({environment:'SANDBOX',merchantId:expected.merchantId,notificationUrl:url,signatureKey:key},()=>store);
 for(const [id,type] of [['event-updated','payment.updated'],['event-created','payment.created'],['event-created','payment.created']]){
  const raw=Buffer.from(JSON.stringify({event_id:id,type,merchant_id:expected.merchantId,data:{object:{payment:{id:observation.providerId,status:'FAILED',amount_money:{amount:999,currency:'USD'}}}}}));
  const signature=createHmac('sha256',key).update(url).update(raw).digest('base64');assert.equal((await receiver(new Request(url,{method:'POST',headers:{'x-square-hmacsha256-signature':signature},body:raw}))).status,200);
 }
 assert.equal(store.inbox.size,2);assert.equal(lookups,0);assert.equal(store.jobs.size,0);
 const w=worker(store,async()=>{lookups++;return {kind:'OBSERVED',observation:completed};});await w.runOnce('SANDBOX','worker',20);
 assert.equal(lookups,1);assert.equal(store.jobs.size,1);assert.equal(store.links.size,2);assert.equal([...store.jobs.values()][0]?.state,'RECONCILED');
 assert.equal(JSON.stringify([...store.truth.values()]).includes('amount_money'),false);
});
test('two workers, crash after claim, lease expiry and stale finalize fencing (shared-store fixture)',async()=>{
 const s=new ReconciliationFixture();await s.receive(signal());await s.dispatch('SANDBOX',1);
 const [a,b]=await Promise.all([s.claimBatch('SANDBOX','A',1),s.claimBatch('SANDBOX','B',1)]);assert.equal(a.length,1);assert.equal(b.length,0);
 s.advance(60);const recovered=(await s.claimBatch('SANDBOX','B',1))[0]!;assert.notEqual(recovered.leaseToken,a[0]!.leaseToken);
 const outcome={state:'RECONCILED' as const,code:null,retrySeconds:null,truth:decide(completed)};
 assert.equal(await s.finalize(a[0]!,outcome),false);assert.equal(await s.finalize(recovered,outcome),true);assert.equal(await s.finalize(recovered,outcome),false);
});
test('dispatcher crash is atomic; future signal remains eligible after restart',async()=>{
 const s=new ReconciliationFixture();await s.receive(signal());s.failDispatch=true;await assert.rejects(s.dispatch('SANDBOX',20));assert.equal(s.inbox.size,1);assert.equal(s.links.size,0);assert.equal(s.jobs.size,0);s.failDispatch=false;assert.equal(await s.dispatch('SANDBOX',20),1);assert.equal(await s.dispatch('SANDBOX',20),0);
});
test('crash after provider response before finalize performs another read under new lease, never another payment',async()=>{
 const s=new ReconciliationFixture();await s.receive(signal());let calls=0;const read:PaymentTruthProvider['lookupPayment']=async()=>{calls++;return {kind:'OBSERVED',observation:completed};};s.failFinalize=true;
 await assert.rejects(worker(s,read).runOnce('SANDBOX','A'));assert.equal(calls,1);assert.equal([...s.jobs.values()][0]!.state,'CLAIMED');s.failFinalize=false;s.advance(60);
 await worker(s,read).runOnce('SANDBOX','B');assert.equal(calls,2);assert.equal(s.truth.values().next().value?.latest?.status,'COMPLETED');
});
test('lost finalize response after commit is recoverable by durable state without another lookup',async()=>{
 const s=new ReconciliationFixture();await s.receive(signal());let calls=0;const w=worker(s,async()=>{calls++;return {kind:'OBSERVED',observation:completed};});s.loseFinalizeResponse=true;
 await assert.rejects(w.runOnce('SANDBOX','A'));s.loseFinalizeResponse=false;s.advance(61);await w.runOnce('SANDBOX','B');assert.equal(calls,1);assert.equal([...s.jobs.values()][0]!.state,'RECONCILED');
});
test('new signal during lookup remains READY work; terminal receives new generation without reversing old job',async()=>{
 const s=new ReconciliationFixture();await s.receive(signal('one'));let calls=0;
 const w=worker(s,async()=>{calls++;if(calls===1){await s.receive(signal('two'));await s.dispatch('SANDBOX',10);}return {kind:'OBSERVED',observation:completed};});
 const first=await w.runOnce('SANDBOX','A');assert.equal(first.results[0]?.result,'SAVED');assert.equal([...s.jobs.values()][0]?.state,'READY');await w.runOnce('SANDBOX','B');assert.equal(calls,2);assert.equal([...s.jobs.values()][0]?.state,'RECONCILED');
 await s.receive(signal('three'));await w.runOnce('SANDBOX','C');assert.deepEqual([...s.jobs.values()].map(j=>[j.generation,j.state]),[[1,'RECONCILED'],[2,'RECONCILED']]);assert.equal(s.truth.values().next().value?.revision,1);
});
for(const code of ['AUTH_BLOCKED','RATE_LIMITED','NOT_FOUND_BLOCKED','INVALID_RESPONSE_BLOCKED','EVIDENCE_MISMATCH_BLOCKED'] as const)test(code+' stays BLOCKED across new events; no automatic restart',async()=>{
 const s=new ReconciliationFixture();await s.receive(signal());let calls=0;const w=worker(s,async()=>{calls++;return {kind:'FAILED',code};});await w.runOnce('SANDBOX','A');s.advance(1000);await s.receive(signal('second'));await w.runOnce('SANDBOX','A');assert.equal(calls,1);assert.equal(s.jobs.size,1);assert.equal((await s.diagnostics('SANDBOX',5))[0]?.code,code);
});
for(const code of ['NETWORK_RETRYABLE','PROVIDER_5XX_RETRYABLE'] as const)test(code+' retries only when due; cap5 never resets on event',async()=>{
 const s=new ReconciliationFixture();await s.receive(signal());let calls=0;const w=worker(s,async()=>{calls++;return {kind:'FAILED',code};});
 for(let n=1;n<=5;n++){await w.runOnce('SANDBOX','worker');assert.equal(calls,n);await s.receive(signal('extra'+n));await w.runOnce('SANDBOX','worker');assert.equal(calls,n);s.advance(300);}
 assert.equal([...s.jobs.values()][0]?.state,'DEAD');await w.runOnce('SANDBOX','worker');assert.equal(calls,5);
});
test('PENDING is not a terminal job; pending duplicate polls within budget and can reach COMPLETED',async()=>{
 const s=new ReconciliationFixture();await s.receive(signal());let result=observation;const w=worker(s,async()=>({kind:'OBSERVED',observation:result}));await w.runOnce('SANDBOX','A');assert.equal([...s.jobs.values()][0]?.state,'RETRY_WAIT');s.advance(10);await w.runOnce('SANDBOX','A');assert.equal([...s.jobs.values()][0]?.state,'RETRY_WAIT');result=completed;s.advance(20);await w.runOnce('SANDBOX','A');assert.equal([...s.jobs.values()][0]?.state,'RECONCILED');
});
test('deadline, final-attempt crash and fixture timeout are bounded with no real wait',async()=>{
 const s=new ReconciliationFixture();await s.receive(signal());await s.dispatch('SANDBOX',1);for(let n=0;n<5;n++){assert.equal((await s.claimBatch('SANDBOX','crash',1)).length,1);s.advance(60);}assert.equal((await s.claimBatch('SANDBOX','crash',1)).length,0);assert.equal([...s.jobs.values()][0]?.state,'DEAD');
 const d=new ReconciliationFixture();await d.receive(signal());await d.dispatch('SANDBOX',1);d.advance(86400);assert.equal((await d.claimBatch('SANDBOX','expired',1)).length,0);
 const t=new ReconciliationFixture();await t.receive(signal());const timeout:LookupDeadline=async()=>{throw new LookupTimeout();};await worker(t,async()=>{throw new Error('not called');},async()=>context(),timeout).runOnce('SANDBOX','T');assert.equal([...t.jobs.values()][0]?.code,'NETWORK_RETRYABLE');
});
test('missing/wrong context stops before lookup; stale after context read also stops',async()=>{
 for(const load of [async()=>null,async()=>({...context(),current:{...context().current,providerId:'wrong'}})]){
  const s=new ReconciliationFixture();await s.receive(signal());let calls=0;await worker(s,async()=>{calls++;return {kind:'OBSERVED',observation:completed};},load as ()=>Promise<PaymentContext>).runOnce('SANDBOX','A');assert.equal(calls,0);assert.equal([...s.jobs.values()][0]?.state,'BLOCKED');
 }
 const s=new ReconciliationFixture();await s.receive(signal());let calls=0;await worker(s,async()=>{calls++;return {kind:'OBSERVED',observation:completed};},async()=>{s.advance(60);return context();}).runOnce('SANDBOX','A');assert.equal(calls,0);
});
test('conflicting redelivery invalidates live lease and prevents automatic generation',async()=>{
 const s=new ReconciliationFixture();await s.receive(signal());await s.dispatch('SANDBOX',1);const c=(await s.claimBatch('SANDBOX','A',1))[0]!;await s.receive({...signal(),bodySha256:'b'.repeat(64)});assert.equal(await s.finalize(c,{state:'RECONCILED',code:null,retrySeconds:null,truth:decide(completed)}),false);await s.receive(signal('next'));await s.dispatch('SANDBOX',1);assert.equal((await s.claimBatch('SANDBOX','B',1)).length,0);
});
for(const [status,code] of [[401,'AUTH_BLOCKED'],[403,'AUTH_BLOCKED'],[429,'RATE_LIMITED'],[404,'NOT_FOUND_BLOCKED'],[500,'PROVIDER_5XX_RETRYABLE'],[503,'PROVIDER_5XX_RETRYABLE'],[400,'INVALID_RESPONSE_BLOCKED'],[302,'INVALID_RESPONSE_BLOCKED']] as const)test('Square fixture HTTP'+status+' -> '+code,async()=>{
 const adapter=new SquareSandboxPaymentTruth({environment:'SANDBOX',merchantId:expected.merchantId,async send(c){assert.equal(c.method,'GET');assert.equal(c.version,'2026-08-19');assert.equal(c.url,'https://connect.squareupsandbox.com/v2/payments/payment-fixture');assert.equal('body' in c,false);return {status,body:{ignored:'synthetic-private-details'}};}});
 assert.deepEqual(await adapter.lookupPayment({environment:'SANDBOX',expected,paymentId:observation.providerId,signal:new AbortController().signal}),{kind:'FAILED',code});
});
test('Square fixture normalized observations, malformed response and network failures never leak raw payload/error',async()=>{
 const input={environment:'SANDBOX' as const,expected,paymentId:observation.providerId,signal:new AbortController().signal};
 for(const state of ['PENDING','COMPLETED','FAILED','CANCELED']){
  const a=new SquareSandboxPaymentTruth({environment:'SANDBOX',merchantId:expected.merchantId,async send(){return {status:200,body:{payment:{id:observation.providerId,reference_id:expected.bookingId,location_id:expected.locationId,status:state,amount_money:{amount:100,currency:'JPY'},updated_at:observation.updatedAt,card_details:{card_payment_timeline:{captured_at:observation.updatedAt},private:'SYNTHETIC_SECRET'}}}};}});
  const r=await a.lookupPayment(input);assert.equal(r.kind,'OBSERVED');assert.ok(!JSON.stringify(r).includes('SYNTHETIC_SECRET'));
 }
 for(const body of [null,{}, {payment:{id:'x'}}]){const a=new SquareSandboxPaymentTruth({environment:'SANDBOX',merchantId:expected.merchantId,async send(){return {status:200,body};}});assert.deepEqual(await a.lookupPayment(input),{kind:'FAILED',code:'INVALID_RESPONSE_BLOCKED'});}
 const a=new SquareSandboxPaymentTruth({environment:'SANDBOX',merchantId:expected.merchantId,async send(){throw Object.assign(new Error('SYNTHETIC_SECRET'),{code:'ETIMEDOUT'});}});assert.deepEqual(await a.lookupPayment(input),{kind:'FAILED',code:'NETWORK_RETRYABLE'});
});
test('worker fake-only path never invokes ambient fetch; diagnostics have no raw body/session/credential',async()=>{
 const old=globalThis.fetch;globalThis.fetch=async()=>{throw new Error('ambient network forbidden');};
 try{const s=new ReconciliationFixture();await s.receive(signal());await worker(s,async()=>{throw new Error('synthetic-auth-cookie-secret');}).runOnce('SANDBOX','A');const summary=JSON.stringify(await s.diagnostics('SANDBOX',1));assert.ok(!summary.includes('synthetic-auth-cookie-secret'));assert.ok(!summary.includes('leaseToken'));}finally{globalThis.fetch=old;}
});

test('duplicate internal truth cannot bypass a contradictory FAILED business context',()=>{const c={...context(),latest:completed,current:{...context().current,state:'FAILED' as const,providerState:'FAILED' as const}};assert.equal(decide(completed,c).decision,'BLOCKED_INVALID_TRANSITION');});
for(const code of ['AUTH_BLOCKED','RATE_LIMITED'] as const)test(code+' stops remaining batch and persists merchant circuit for new payments',async()=>{
 const s=new ReconciliationFixture();for(let i=0;i<3;i++)await s.receive({...signal('batch'+i),paymentId:'payment-'+i});let calls=0,batches=0;
 const contexts={async load(){throw new Error('N+1 load prohibited');},async loadBatch(claims:import('../../packages/core/src/payment/payment-reconciliation').ReconciliationClaim[]){batches++;return new Map(claims.map(c=>[c.id,{...context(),current:{...context().current,providerId:c.paymentId}}]));}};
 const w=new PaymentReconciliationWorker(s,contexts,{async lookupPayment(){calls++;return {kind:'FAILED',code};}},s.now,()=>0.5,instant);
 await w.runOnce('SANDBOX','A',20);assert.equal(calls,1);assert.equal(batches,1);s.advance(60);await s.receive({...signal('next-payment'),paymentId:'new-payment'});await w.runOnce('SANDBOX','B',20);assert.equal(calls,1);assert.ok([...s.jobs.values()].every(j=>j.state==='BLOCKED'));
});
test('internal stop codes and malformed provider port output are invalid response, not provider authority',async()=>{
 for(const output of [null,{kind:'FAILED',code:'ATTEMPTS_EXHAUSTED'},{kind:'FAILED',code:'unexpected'}]){const s=new ReconciliationFixture();await s.receive(signal());await worker(s,async()=>output as never).runOnce('SANDBOX','A');assert.equal([...s.jobs.values()][0]?.code,'INVALID_RESPONSE_BLOCKED');}
});
test('unlinked hash-conflicted inbox signal does not become a job in dispatcher fixture',async()=>{const s=new ReconciliationFixture();await s.receive(signal());await s.receive({...signal(),bodySha256:'b'.repeat(64)});assert.equal(await s.dispatch('SANDBOX',20),0);assert.equal(s.jobs.size,0);});
test('stale PENDING while newer PENDING exists remains retry work, not terminal',async()=>{const s=new ReconciliationFixture();await s.receive(signal());let o={...observation,updatedAt:'2035-01-01T00:00:01Z'};s.advance(1);const w=worker(s,async()=>({kind:'OBSERVED',observation:o}));await w.runOnce('SANDBOX','A');s.advance(10);o=observation;await w.runOnce('SANDBOX','A');assert.equal([...s.jobs.values()][0]?.state,'RETRY_WAIT');assert.equal([...s.jobs.values()][0]?.decision,'NOOP_STALE');});
test('cutoff crossed inside lookup cannot store an accepted observation',async()=>{const s=new ReconciliationFixture();await s.receive(signal());await worker(s,async()=>{s.advance(86400);return {kind:'OBSERVED',observation:completed};}).runOnce('SANDBOX','A');assert.equal([...s.truth.values()][0]?.latest,null);assert.equal([...s.jobs.values()][0]?.state,'CLAIMED');s.advance(60);await s.claimBatch('SANDBOX','B',1);assert.equal([...s.jobs.values()][0]?.state,'DEAD');});
