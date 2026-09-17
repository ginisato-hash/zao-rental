import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {flowFixture} from '../flow/fixture';
import {provisionOperationsRole} from '../../scripts/operations-roles';
import {OperationsContext} from '../../packages/core/src/operations/context';
import {OperationsConsole} from '../../packages/core/src/operations/console-service';
import {observeOperationalFailure} from '../../packages/core/src/operations/ops-signal';
import {writeAccount} from '../../packages/auth/src/accounts';
import {requestFor} from '../inventory/fixture';
const SAFE=['id','eventType','correlationId','bookingId','assetId','store','severity','status','occurredAt','resolvedAt','resolutionActor','resolutionReason','sourceConditionActive'].sort().join();
const BUSINESS=['rental_bookings','rental_payment_attempts','rental_history','inventory_holds','inventory_claims','price_quotes','ops_charge_requests','ops_refund_requests','booking_notification_outbox'];
let failed=false,stage='fixture',count=0;const x=await flowFixture();let role:Awaited<ReturnType<typeof provisionOperationsRole>>|undefined;
async function check(name:string,fn:()=>Promise<void>){stage=name;await fn();count++;console.log('PASS '+name);}
const filter=(o:Record<string,unknown>={})=>({store:'MOUNTAIN_BASE',type:null,severity:null,ageHours:0,status:'UNACKNOWLEDGED',beforeTime:null,beforeId:null,...o});
try{
 role=await provisionOperationsRole(x.db.pool,x.db.identity);
 const ctx=new OperationsContext(role.operationsPool,x.roles.authPool,x.signed.identity),ops=new OperationsConsole(ctx);
 const fingerprint=async()=>{const r:Record<string,unknown>={};for(const t of BUSINESS)r[t]=(await x.db.pool.query(`SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]') v FROM ${t} t`)).rows[0].v;return r;};

 await check('console permissions are default deny for existing staff',async()=>{
  await assert.rejects(ops.list(filter()),{status:403});
  await assert.rejects(ops.acknowledge(randomUUID(),{id:randomUUID(),store:'MOUNTAIN_BASE',reason:'TRIAGED'}),{status:403});
  assert.equal((await x.db.pool.query("SELECT count(*)::int n FROM staff_role_permissions WHERE permission IN ('OPERATIONS_VIEW','OPERATIONS_ACKNOWLEDGE')")).rows[0].n,0);
 });

 // Two authoritative payment states the console must observe without altering them.
 const pending=await x.draft(undefined,requestFor('2035-02-11'));x.fake.status='PENDING';await x.service.startPayment(pending.booking.id,randomUUID());
 const unknown=await x.draft(undefined,requestFor('2035-02-12'));x.fake.failAfterSave=true;await x.service.startPayment(unknown.booking.id,randomUUID());x.fake.failAfterSave=false;x.fake.status='COMPLETED';
 await x.db.pool.query("INSERT INTO staff_permission_overrides(staff_id,permission,allowed) VALUES($1,'OPERATIONS_VIEW',true)",[x.actor]);

 await check('view permission alone lists safe projections and never acknowledges',async()=>{
  const page=await ops.list(filter());
  assert.ok(page.exceptions.length>=2);
  for(const e of page.exceptions)assert.equal(Object.keys(e).sort().join(),SAFE);
  const types=page.exceptions.map(e=>e.eventType);
  assert.ok(types.includes('PAYMENT_PENDING')&&types.includes('PAYMENT_UNKNOWN'));
  assert.equal(page.exceptions.find(e=>e.eventType==='PAYMENT_UNKNOWN')!.severity,'ERROR');
  await assert.rejects(ops.acknowledge(randomUUID(),{id:page.exceptions[0]!.id,store:'MOUNTAIN_BASE',reason:'TRIAGED'}),{status:403});
 });

 await check('projection carries no recipient, provider, token or error material',async()=>{
  const serialized=JSON.stringify((await ops.list(filter())).exceptions);
  for(const secret of ['synthetic-guest@example.invalid','SYNTHETIC Guest','sim_','SYNTHETIC-MERCHANT','SYNTHETIC-MOUNTAIN','SIMULATED_RESPONSE_LOST','password','token'])assert.ok(!serialized.includes(secret),secret);
 });

 await check('store scope and system scope are enforced server-side',async()=>{
  const settings={displayName:'SYNTHETIC Onsen Operator',active:true,role:'ADMIN' as const,scope:'ASSIGNED' as const,storeIds:['ONSEN_BASE'],permissions:{BOOKING_VIEW:true,OPERATIONS_VIEW:true,OPERATIONS_ACKNOWLEDGE:true}};
  await writeAccount(x.roles.authPool,x.bp,undefined,{...settings,email:'ops-onsen@example.invalid',password:x.password});
  const signed=await x.login('ops-onsen@example.invalid'),scoped=new OperationsConsole(new OperationsContext(role!.operationsPool,x.roles.authPool,signed.identity));
  await assert.rejects(scoped.list(filter()),{status:403});
  await assert.rejects(scoped.list(filter({store:'SYSTEM'})),{status:403});
  assert.deepEqual((await scoped.list(filter({store:'ONSEN_BASE'}))).exceptions,[]);
  await assert.rejects(ops.list(filter({store:'NOWHERE'})),{status:422});
 });

 let acknowledged='';
 await check('acknowledge records observation only and never mutates business state',async()=>{
  await x.db.pool.query("INSERT INTO staff_permission_overrides(staff_id,permission,allowed) VALUES($1,'OPERATIONS_ACKNOWLEDGE',true)",[x.actor]);
  const target=(await ops.list(filter())).exceptions.find(e=>e.eventType==='PAYMENT_UNKNOWN')!;acknowledged=target.id;
  const before=await fingerprint(),key=randomUUID(),input={id:target.id,store:'MOUNTAIN_BASE',reason:'VERIFIED_WITH_CANONICAL_RECORD'};
  const first=await ops.acknowledge(key,input),again=await ops.acknowledge(key,input);
  assert.deepEqual(first,again);
  assert.equal((first as {status:string}).status,'ACKNOWLEDGED');
  assert.equal((first as {businessStateChanged:boolean}).businessStateChanged,false);
  assert.deepEqual(await fingerprint(),before);
  assert.equal((await x.db.pool.query("SELECT count(*)::int n FROM ops_history WHERE resource='ops_exceptions' AND event='EXCEPTION_ACKNOWLEDGED' AND entity_id=$1",[target.id])).rows[0].n,1);
  await assert.rejects(ops.acknowledge(randomUUID(),{id:target.id,store:'MOUNTAIN_BASE',reason:'BUSINESS_RESOLVED'}),{status:422});
 });

 await check('acknowledged exception still reports its source condition as active',async()=>{
  const row=(await ops.list(filter({status:'ACKNOWLEDGED'}))).exceptions.find(e=>e.id===acknowledged)!;
  assert.equal(row.status,'ACKNOWLEDGED');assert.equal(row.sourceConditionActive,true);
  assert.equal(row.resolutionReason,'VERIFIED_WITH_CANONICAL_RECORD');assert.equal(row.resolutionActor,x.actor);
  assert.ok(!(await ops.list(filter())).exceptions.some(e=>e.id===acknowledged));
 });

 await check('a resolved source stops being active without rewriting the acknowledgement',async()=>{
  // Resolve through the real reconciliation path, never by rewriting the payment row.
  await x.service.reconcile(unknown.booking.id);
  assert.notEqual((await x.db.pool.query('SELECT state FROM rental_payment_attempts WHERE booking_id=$1',[unknown.booking.id])).rows[0].state,'UNKNOWN');
  const row=(await ops.list(filter({status:'ACKNOWLEDGED'}))).exceptions.find(e=>e.id===acknowledged)!;
  assert.equal(row.sourceConditionActive,false);assert.equal(row.status,'ACKNOWLEDGED');
  assert.equal(row.resolutionReason,'VERIFIED_WITH_CANONICAL_RECORD');
  // The changed source is a new observation; it never reopens the acknowledged one.
  assert.ok((await ops.list(filter())).exceptions.some(e=>e.bookingId===unknown.booking.id&&e.id!==acknowledged));
 });

 await check('runtime signals are fixed codes and reach only explicit ALL scope',async()=>{
  assert.equal(await observeOperationalFailure(role!.operationsPool,'STORAGE_FAILED','SYSTEM'),true);
  const correlation=randomUUID();
  assert.equal(await observeOperationalFailure(role!.operationsPool,'PROVIDER_TIMEOUT','SYSTEM',correlation),true);
  assert.equal(await observeOperationalFailure(role!.operationsPool,'PROVIDER_TIMEOUT','SYSTEM',correlation),true);
  assert.equal(await observeOperationalFailure(role!.operationsPool,'PAYMENT_UNKNOWN' as never,'SYSTEM'),false);
  const page=await ops.list(filter({store:'SYSTEM'}));
  assert.equal(page.exceptions.filter(e=>e.correlationId===correlation).length,1);
  for(const e of page.exceptions){assert.equal(e.sourceConditionActive,null);assert.equal(e.severity,'ERROR');}
 });

 await check('listing is bounded and pages with a stable cursor',async()=>{
  for(let i=0;i<60;i++)await observeOperationalFailure(role!.operationsPool,'DB_UNAVAILABLE','ONSEN_BASE');
  const first=await ops.list(filter({store:'ONSEN_BASE'}));
  assert.equal(first.exceptions.length,50);assert.ok(first.next);
  const second=await ops.list(filter({store:'ONSEN_BASE',beforeTime:first.next!.beforeTime,beforeId:first.next!.beforeId}));
  assert.ok(second.exceptions.length>=10&&second.exceptions.length<=50);
  assert.equal(new Set([...first.exceptions,...second.exceptions].map(e=>e.id)).size,first.exceptions.length+second.exceptions.length);
  await assert.rejects(ops.list(filter({store:'ONSEN_BASE',beforeTime:first.next!.beforeTime,beforeId:null})),{status:422});
  await assert.rejects(ops.list(filter({ageHours:-1})),{status:422});
  await assert.rejects(ops.list(filter({type:'NOT_A_CODE'})),{status:422});
 });

 console.log(JSON.stringify({status:'PASS',cases:count,businessMutations:0,providerCalls:0,hostedDb:0}));
}catch(e){failed=true;console.error(JSON.stringify({status:'FAIL',stage,code:(e as {code?:string}).code??(e as Error).name,detail:e instanceof assert.AssertionError?e.message:'SAFE_DETAILS_ONLY'}));}finally{await role?.close();await x.close();}
if(failed)process.exit(1);
