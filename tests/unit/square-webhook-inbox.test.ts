import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PgSquareWebhookInbox,type InboxConnection} from '../../packages/db/src/square-webhook-inbox';
import type {InboxSignal,InboxClaim} from '../../packages/core/src/payment/square-webhook-inbox';
import {migrationPlan} from '../../packages/db/src/index';
const signal:InboxSignal={environment:'SANDBOX',eventId:'event_fixture',merchantId:'merchant_fixture',paymentId:'payment_fixture',type:'payment.updated',bodySha256:'a'.repeat(64)};
function connection(run:(sql:string,values:unknown[])=>Promise<unknown[]>){
 const queries:{sql:string;values:unknown[]}[]=[];const releases:(boolean|Error|undefined)[]=[];
 const client={async query(sql:string,values:unknown[]=[]){queries.push({sql,values});return {rows:await run(sql,values)};},release(error?:boolean|Error){releases.push(error);}};
 const repository=new PgSquareWebhookInbox({async connect(){return client as unknown as InboxConnection;}});return {repository,queries,releases};
}
for(const receipt of ['INSERTED','DUPLICATE','HASH_CONFLICT'])test('SQL repository commits '+receipt+' before resolving and binds exact metadata only',async()=>{
 let commit:()=>void=()=>{};const barrier=new Promise<void>(r=>{commit=r;});let committing:()=>void=()=>{};const entered=new Promise<void>(r=>{committing=r;});let completed=false;
 const f=connection(async sql=>{if(sql==='COMMIT'){committing();await barrier;}return sql.includes('square_webhook.receive')?[{result:receipt}]:[];});
 const pending=f.repository.receive(signal).then(r=>{completed=true;return r;});await entered;assert.equal(completed,false);assert.deepEqual(f.releases,[]);commit();assert.equal(await pending,receipt);
 assert.deepEqual(f.queries[2]?.values,['SANDBOX','event_fixture','payment.updated','merchant_fixture','payment_fixture','a'.repeat(64)]);
 assert.equal(f.queries[0]?.sql,'BEGIN');assert.match(f.queries[1]!.sql,/synchronous_commit=on/);assert.equal(f.queries.at(-1)?.sql,'COMMIT');assert.deepEqual(f.releases,[false]);
});
for(const stage of ['BEGIN','SET LOCAL','square_webhook.receive','COMMIT'])test('failure/uncertain '+stage+' rolls back/destroys connection, never retries or leaks errors',async()=>{
 const f=connection(async sql=>{if(sql.includes(stage))throw new Error('sensitive database diagnostic');return sql.includes('square_webhook.receive')?[{result:'INSERTED'}]:[];});
 await assert.rejects(f.repository.receive(signal),{message:'WEBHOOK_INBOX_UNAVAILABLE'});assert.deepEqual(f.releases,[true]);assert.equal(f.queries.at(-1)?.sql,'ROLLBACK');assert.ok(f.queries.filter(q=>q.sql.includes('square_webhook.receive')).length<=1);
});
test('unknown database receipt fails before COMMIT',async()=>{const f=connection(async()=>[{result:'UNKNOWN'}]);await assert.rejects(f.repository.receive(signal));assert.equal(f.queries.at(-1)?.sql,'ROLLBACK');assert.ok(!f.queries.some(q=>q.sql==='COMMIT'));});
test('SQL claim returns only safe signal/lease metadata; settle binds fencing token and bounded failure code',async()=>{
 const row={event_id:signal.eventId,event_type:signal.type,merchant_id:signal.merchantId,payment_id:signal.paymentId,body_sha256:signal.bodySha256,claim_token:'00000000-0000-4000-8000-000000000001',attempt:2,lease_until:new Date('2035-01-01T00:01:00Z')};
 const f=connection(async sql=>sql.includes('square_webhook.claim')?[row]:sql.includes('square_webhook.settle')?[{settled:false}]:[]);
 const claim=await f.repository.claim('SANDBOX',60);assert.deepEqual(claim,{...signal,claimToken:row.claim_token,attempt:2,leaseUntil:row.lease_until});
 assert.equal(await f.repository.settle(claim!,{state:'FAILED_RETRYABLE',reason:'PROVIDER_UNAVAILABLE',retrySeconds:30}),false);
 assert.deepEqual(f.queries.find(q=>q.sql.includes('square_webhook.settle'))?.values,['SANDBOX',signal.eventId,row.claim_token,'FAILED_RETRYABLE','PROVIDER_UNAVAILABLE',30]);
});
test('empty queue and successful terminal mark; all transaction paths release',async()=>{
 const f=connection(async sql=>sql.includes('square_webhook.settle')?[{settled:true}]:[]);assert.equal(await f.repository.claim('PRODUCTION',60),null);
 assert.equal(await f.repository.settle({...signal,claimToken:'fixture',attempt:1,leaseUntil:new Date()} as InboxClaim,{state:'RECONCILED'}),true);assert.equal(f.releases.length,2);
});
const sql=readFileSync('packages/db/migrations/0025_square_webhook_inbox.sql','utf8');
test('static additive migration: environment-scoped durable dedupe, bounded audit/retries, no business/raw payload storage',()=>{
 assert.deepEqual(migrationPlan.find(m=>m.id==='0025'),{id:'0025',file:'0025_square_webhook_inbox.sql'});assert.equal(new Set(migrationPlan.map(m=>m.id)).size,migrationPlan.length);
 assert.match(sql,/PRIMARY KEY\(environment,event_id\)/);assert.match(sql,/ON CONFLICT\(environment,event_id\) DO NOTHING/);
 assert.match(sql,/attempt BETWEEN 0 AND 5/);assert.match(sql,/conflict_count BETWEEN 0 AND 65535/);
 assert.doesNotMatch(sql,/ALTER TABLE|DROP TABLE|CREATE ROLE|GRANT |raw_body|access_token|signature_key|REFERENCES|UPDATE (?:public\.)?(?:inventory|rental|custody)/);
 assert.match(sql,/REVOKE ALL ON ALL FUNCTIONS IN SCHEMA square_webhook FROM PUBLIC/);
 assert.match(sql,/REVOKE ALL ON square_webhook.inbox FROM PUBLIC/);
 assert.equal((sql.match(/SECURITY DEFINER SET search_path=pg_catalog,pg_temp/g)||[]).length,3);
});
test('static queue fencing/crash recovery: SKIP LOCKED, expired lease reclaim, bounded attempts, DB clock after lock',()=>{
 assert.match(sql,/LIMIT 1 FOR UPDATE SKIP LOCKED/);assert.match(sql,/i\.lease_until<=clock_timestamp\(\)/);
 assert.match(sql,/IF picked\.attempt>=5 THEN/);assert.match(sql,/claim_token=gen_random_uuid\(\)/);
 assert.match(sql,/FOR UPDATE;\n IF NOT FOUND THEN RETURN false;END IF;t:=clock_timestamp\(\);/);
 assert.match(sql,/old\.claim_token<>p_token OR old\.lease_until<=t THEN RETURN false/);
 assert.match(sql,/p_retry_seconds BETWEEN 1 AND 3600/);assert.match(sql,/\) IS NOT TRUE THEN RAISE EXCEPTION 'INVALID_INBOX_RESULT'/);
});

test('pool acquisition failure also suppresses credential-bearing diagnostics without retry',async()=>{
 let calls=0;const repository=new PgSquareWebhookInbox({async connect(){calls++;throw new Error('synthetic-sensitive-diagnostic');}});
 await assert.rejects(repository.receive(signal),{message:'WEBHOOK_INBOX_UNAVAILABLE'});assert.equal(calls,1);
});
