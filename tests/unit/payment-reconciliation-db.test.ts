import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PgPaymentReconciliation} from '../../packages/db/src/payment-reconciliation';
import type {InboxConnection} from '../../packages/db/src/square-webhook-inbox';
import type {ReconciliationClaim} from '../../packages/core/src/payment/payment-reconciliation';
import {migrationPlan} from '../../packages/db/src/index';
function fixture(run:(sql:string,values:unknown[])=>Promise<unknown[]>){const calls:{sql:string;values:unknown[]}[]=[],released:unknown[]=[];const client={async query(sql:string,values:unknown[]=[]){calls.push({sql,values});return {rows:await run(sql,values)};},release(error?:unknown){released.push(error);}};return {calls,released,repo:new PgPaymentReconciliation({async connect(){return client as unknown as InboxConnection;}})};}
test('dispatcher commit barrier; linkage result cannot escape before committed marker/job/link',async()=>{
 let committing:()=>void=()=>{},commit:()=>void=()=>{};const entered=new Promise<void>(r=>{committing=r;}),barrier=new Promise<void>(r=>{commit=r;});let resolved=false;
 const f=fixture(async sql=>{if(sql==='COMMIT'){committing();await barrier;}return sql.includes('.dispatch(')?[{n:2}]:[];});const pending=f.repo.dispatch('SANDBOX',10).then(n=>{resolved=true;return n;});await entered;assert.equal(resolved,false);commit();assert.equal(await pending,2);assert.equal(f.calls[0]?.sql,'BEGIN');assert.match(f.calls[1]!.sql,/synchronous_commit=on/);assert.deepEqual(f.calls[2]?.values,['SANDBOX',10]);assert.deepEqual(f.released,[false]);
});
for(const stage of ['BEGIN','SET LOCAL','.dispatch(','COMMIT'])test('SQL '+stage+' failure rolls back, destroys connection and never retries',async()=>{
 const f=fixture(async sql=>{if(sql.includes(stage))throw new Error('synthetic-private-diagnostic');return [{n:1}];});await assert.rejects(f.repo.dispatch('SANDBOX',1),{message:'RECONCILIATION_STORAGE_UNAVAILABLE'});assert.equal(f.calls.at(-1)?.sql,'ROLLBACK');assert.deepEqual(f.released,[true]);assert.ok(f.calls.filter(c=>c.sql.includes('.dispatch(')).length<=1);
});
test('pool acquisition failure sanitized',async()=>{const p=new PgPaymentReconciliation({async connect(){throw new Error('synthetic-secret');}});await assert.rejects(p.dispatch('SANDBOX',1),{message:'RECONCILIATION_STORAGE_UNAVAILABLE'});});
test('claim JSON dates/metadata and finalize fencing revision bind safely; diagnostic is bounded/read only',async()=>{
 const raw={id:'00000000-0000-4000-8000-000000000001',environment:'SANDBOX',merchantId:'fixture',paymentId:'payment-fixture',generation:1,sourceEventId:'event',sourceFingerprint:'a'.repeat(64),signalRevision:2,truthRevision:3,attempt:2,leaseOwner:'A',leaseToken:'00000000-0000-4000-8000-000000000002',leaseExpiresAt:'2035-01-01T00:01:00Z',deadlineAt:'2035-01-02T00:00:00Z',latest:null};
 const f=fixture(async sql=>sql.includes('.claim(')?[{claim:raw}]:sql.includes('.finalize(')?[{ok:false}]:sql.includes('.diagnostics(')?[{summary:{id:raw.id,state:'BLOCKED',updatedAt:'2035-01-01T00:00:00Z'}}]:[]);
 const c=(await f.repo.claimBatch('SANDBOX','A',2))[0]!;assert.ok(c.leaseExpiresAt instanceof Date);assert.equal(c.truthRevision,3);
 assert.equal(await f.repo.finalize(c,{state:'BLOCKED',code:'AUTH_BLOCKED',retrySeconds:null,truth:null}),false);
 assert.deepEqual(f.calls.find(c=>c.sql.includes('.finalize('))?.values,[raw.id,raw.leaseToken,3,'BLOCKED','AUTH_BLOCKED',null,null]);assert.ok((await f.repo.diagnostics('SANDBOX',10))[0]!.updatedAt instanceof Date);
});
const sql=readFileSync('packages/db/migrations/0026_payment_reconciliation.sql','utf8');
test('static migration26 is additive, grants no runtime, no existing payment/booking/inventory changes',()=>{
 assert.deepEqual(migrationPlan.at(-1),{id:'0026',file:'0026_payment_reconciliation.sql'});assert.match(sql,/ALTER TABLE square_webhook.inbox ADD COLUMN job_dispatched_at/);
 assert.doesNotMatch(sql,/DROP TABLE|DROP COLUMN|GRANT |CREATE ROLE|UPDATE (?:public\.)?(?:rental_|inventory_|wear_|custody_)/);
 assert.match(sql,/REVOKE ALL ON ALL TABLES IN SCHEMA payment_reconciliation FROM PUBLIC/);assert.match(sql,/REVOKE ALL ON ALL FUNCTIONS IN SCHEMA payment_reconciliation FROM PUBLIC/);
 assert.match(sql,/v-ARRAY\[/);assert.doesNotMatch(sql,/raw_body|raw_response|access_token|signature_key|auth_header/);
});
test('static indexed bounded dispatch/claim, one active payment generation, lease/crash/cutoff fences',()=>{
 assert.match(sql,/CREATE UNIQUE INDEX one_active_reconciliation/);assert.match(sql,/CREATE INDEX reconciliation_due/);assert.match(sql,/CREATE INDEX webhook_undispatched/);assert.match(sql,/CREATE INDEX reconciliation_event_job/);
 assert.equal((sql.match(/LIMIT p_limit FOR UPDATE SKIP LOCKED/g)||[]).length,2);
 assert.match(sql,/j.attempt>=5 OR j.deadline_at<=t/);assert.match(sql,/lease_token=gen_random_uuid\(\)/);assert.match(sql,/j.lease_token<>p_token OR j.lease_expires_at<=t/);assert.match(sql,/s.truth_revision<>p_revision/);
 assert.match(sql,/j.signal_revision>j.claimed_revision THEN p_state:='READY'/);assert.match(sql,/j.state='RECONCILED' AND NOT j.security_blocked/);assert.match(sql,/UPDATE square_webhook.inbox SET job_dispatched_at/);
 assert.match(sql,/WITH blocked AS \(UPDATE payment_reconciliation.jobs/);assert.match(sql,/last_error='EVIDENCE_MISMATCH_BLOCKED'/);
});
test('static receiver remains provider/job-dispatch free; worker has no production composition or business write port',()=>{
 const receiver=readFileSync('packages/core/src/payment/square-webhook-receiver.ts','utf8'),worker=readFileSync('packages/core/src/payment/payment-reconciliation.ts','utf8');assert.doesNotMatch(receiver,/payment-reconciliation|lookupPayment|fetch\(/);assert.doesNotMatch(worker,/process\.env|BookingService|recordObservation|setInterval|launchd|node:child_process/);
});
// Type boundary only: no real DB, pg Pool or startup is instantiated anywhere in this suite.
void (null as ReconciliationClaim|null);

test('read-only expected context uses merchant/provider binding; batch is one query not one per job',async()=>{
 const f=fixture(async sql=>sql.includes('.load_contexts(')?[{entry:{jobId:'fixture',context:{expected:{}}}}]:sql.includes('.load_context(')?[{context:null}]:[]);
 const claim={id:'fixture',environment:'SANDBOX',merchantId:'merchant',paymentId:'payment'} as ReconciliationClaim;
 assert.equal(await f.repo.load(claim),null);const map=await f.repo.loadBatch([claim]);assert.equal(map.size,1);assert.equal(f.calls.filter(c=>c.sql.includes('.load_contexts(')).length,1);assert.deepEqual(f.calls.find(c=>c.sql.includes('.load_contexts('))?.values,['SANDBOX',['fixture']]);
 assert.match(sql,/a.provider_id=j.payment_id AND a.merchant_id=j.merchant_id/);assert.match(sql,/b.mode='SQUARE_SANDBOX'/);assert.match(sql,/b.price_snapshot->>'chargeReady'='false'/);assert.match(sql,/j.id=ANY\(p_jobs\)/);assert.match(sql,/cardinality\(p_jobs\),0\)>20/);
});
test('merchant auth/quota stop is durable with no reset function or fresh-event bypass',()=>{assert.match(sql,/CREATE TABLE payment_reconciliation.provider_stops/);assert.match(sql,/INSERT INTO payment_reconciliation.provider_stops/);assert.match(sql,/p_code IN \('AUTH_BLOCKED','RATE_LIMITED'\)/);assert.doesNotMatch(sql,/DELETE FROM payment_reconciliation.provider_stops|TRUNCATE/);});

test('context timestamp formatting is stable and normalized money stays within safe integer bounds',()=>{assert.match(sql,/format_context\(a public.rental_payment_attempts\) RETURNS jsonb\n LANGUAGE sql STABLE/);assert.match(sql,/numeric<=9007199254740991/);});
