import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {flowFixture} from '../flow/fixture';
import {commercialBookingFixture,syntheticMerchant} from '../fixtures/commercial-booking';
import {PgProjectionTransaction} from '../../packages/db/src/internal/payment-projection';
import {decidePaymentProjection,verifyProjectionSource} from '../../packages/core/src/payment/payment-projection';
import {normalWorkerPlan,runNormalProductionTick} from '../../packages/core/src/payment/normal-production-worker';
import {normalRefundCandidates} from '../../packages/db/src/normal-production-worker';
import {CancellationRefundWorker} from '../../packages/core/src/payment/cancellation-refund-worker';
import {workerTickPlan} from '../../packages/core/src/payment/worker-tick';
import {provisionOperationsRole} from '../../scripts/operations-roles';
import {OperationsContext} from '../../packages/core/src/operations/context';
import {FinancialOperations} from '../../packages/core/src/operations/financial';
import {writeAccount} from '../../packages/auth/src/accounts';
import {requestFor,variants} from '../inventory/fixture';

type X=Awaited<ReturnType<typeof flowFixture>>;
const account=(password:string)=>(email:string,role:string,storeIds:string[],active=true)=>({email,password,displayName:'SYNTHETIC '+role,active,role,scope:'ASSIGNED',storeIds,permissions:{}});

/** Owner decision 2026-10-09 (migration 0056): online eligible refunds are automatic, every active STAFF can refund in store, both are
 * dispatched by the scheduled worker through claim (durable UNKNOWN) → single POST → observe, capped per original payment together.
 * Real PostgreSQL, synthetic provider; no Production identity, no real payment/refund/mail. */
export async function refundAutomationAcceptance(x:X){
 const pool=x.db.pool,operations=await provisionOperationsRole(pool,x.db.identity),STAFF_PASSWORD_ACCOUNT=account(x.password);
 const project=async(f:Awaited<ReturnType<typeof commercialBookingFixture>>)=>{const c=await pool.connect();try{await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(71820600)');
  const tx=new PgProjectionTransaction(c,f.ref),state=await tx.load(),now=await tx.time(),o=verifyProjectionSource(f.ref,await tx.source(),now,'PRODUCTION');await tx.persist(state,decidePaymentProjection(state,o,now),f.ref,now);await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}};
 const inventorySnapshot=async()=>(await pool.query("SELECT (SELECT count(*) FROM inventory_claims WHERE active) claims,(SELECT count(*) FROM rental_loan_items) loans,(SELECT string_agg(id::text||status,',' ORDER BY id) FROM ledger_assets) assets")).rows[0];
 try{
  const since=new Date(Date.now()-1000).toISOString().replace(/\.\d{3}Z$/,'Z');
  // Two stores: MOUNTAIN_BASE and ONSEN_BASE commercial bookings, paid (COMPLETED) through the real projection.
  await pool.query("SELECT set_config('zao.actor',$1,false),set_config('zao.reason','SYNTHETIC refund automation stock',false)",[x.actor]);
  for(const [store,n] of [['ONSEN_BASE',2],['MOUNTAIN_BASE',4]] as const)for(let i=0;i<n;i++)await pool.query(`INSERT INTO ledger_assets(id,variant_id,family,initial_store_id,store_id,status,bsl_status,bsl_evidence,notes,source_kind,source_document,source_locator) VALUES($1,$2,'SKI',$3,$3,'AVAILABLE','NOT_APPLICABLE','','','SYNTHETIC','refund automation fixture',$4)`,[randomUUID(),variants.ski,store,'refund-'+store+'-'+i]);
  const mountain=await commercialBookingFixture(x,'2035-11-02'),onsen=await commercialBookingFixture(x,'2035-11-03',{...requestFor('2035-11-03'),pickupStore:'ONSEN_BASE',returnStore:'ONSEN_BASE'}),race=await commercialBookingFixture(x,'2035-11-04');
  for(const f of [mountain,onsen,race])await project(f);
  assert.notEqual(mountain.observation.locationId,onsen.observation.locationId);
  const inventoryBefore=await inventorySnapshot();

  // ── All active STAFF can refund in their store scope (no individual override); VIEWER / out-of-scope / inactive are refused.
  const make=async(email:string,role:string,stores:string[])=>{const id=(await writeAccount(x.roles.authPool,x.principal,undefined,STAFF_PASSWORD_ACCOUNT(email,role,stores))).id as string;const s=await x.login(email);return {ctx:new OperationsContext(operations.operationsPool,x.roles.authPool,s.identity),id};};
  const mountainStaff=await make('refund-staff-m@example.invalid','STAFF',['MOUNTAIN_BASE']),onsenStaff=await make('refund-staff-o@example.invalid','STAFF',['ONSEN_BASE']);
  const viewer=await make('refund-viewer@example.invalid','VIEWER',['MOUNTAIN_BASE']),leaver=await make('refund-leaver@example.invalid','STAFF',['MOUNTAIN_BASE']);
  assert.equal((await pool.query("SELECT count(*)::int n FROM staff_permission_overrides WHERE staff_id=ANY($1::text[])",[[mountainStaff.id,onsenStaff.id]])).rows[0].n,0,'no individual override is needed');
  await assert.rejects(writeAccount(x.roles.authPool,x.principal,undefined,{...STAFF_PASSWORD_ACCOUNT('refund-deny@example.invalid','STAFF',['MOUNTAIN_BASE']),permissions:{REFUND_OVERRIDE:false}}),{code:'INVALID_INPUT'},'refund cannot be revoked per person');
  const payment=async(bookingId:string)=>(await pool.query('SELECT id,amount_jpy::int amount FROM ops_collected_payments WHERE booking_id=$1',[bookingId])).rows[0] as {id:string;amount:number};
  const m=await payment(mountain.bookingId),o=await payment(onsen.bookingId);
  const body=(bookingId:string,paymentId:string,store:string,amountJpy:number)=>({bookingId,paymentId,actingStore:store,category:'CUSTOMER_EXCEPTION',reason:'SYNTHETIC store exception refund',amountJpy});
  await assert.rejects(new FinancialOperations(viewer.ctx).requestRefund(randomUUID(),body(mountain.bookingId,m.id,'MOUNTAIN_BASE',100)),{code:'FORBIDDEN'});
  await assert.rejects(new FinancialOperations(onsenStaff.ctx).requestRefund(randomUUID(),body(mountain.bookingId,m.id,'MOUNTAIN_BASE',100)),{code:'FORBIDDEN'},'other store scope is refused');
  await pool.query('UPDATE staff_members SET active=false WHERE id=$1',[leaver.id]);
  await assert.rejects(new FinancialOperations(leaver.ctx).requestRefund(randomUUID(),body(mountain.bookingId,m.id,'MOUNTAIN_BASE',100)));
  // Store exception + partial refunds by ordinary STAFF in each store.
  const partialM=await new FinancialOperations(mountainStaff.ctx).requestRefund(randomUUID(),body(mountain.bookingId,m.id,'MOUNTAIN_BASE',300));
  const partialO=await new FinancialOperations(onsenStaff.ctx).requestRefund(randomUUID(),body(onsen.bookingId,o.id,'ONSEN_BASE',200));
  assert.equal(partialM.state,'PENDING');assert.equal(partialO.state,'PENDING');
  console.log('PASS refund automation: every active STAFF refunds in own store without an override; VIEWER, other store and inactive refused; per-person revocation rejected');

  // ── Worker: staff lane only with the 0056 grants; limit unset => no CREATE; positive limit => CREATE reached; routed by location.
  assert.equal((await operations.operationsPool.query("SELECT has_function_privilege(current_user,'ops_refund_claim(uuid)','EXECUTE') a")).rows[0].a,true);
  const locations=[mountain.observation.locationId,onsen.observation.locationId];
  assert.deepEqual((await normalRefundCandidates(operations.operationsPool,syntheticMerchant,locations,since,20,false)).filter(r=>r.lane==='STAFF'),[],'without the staff lane no staff row is offered');
  const posts:{id:string;location:string}[]=[];const lookedUp:string[]=[];
  const refunds={async dispatch(id:string,lane:'CANCELLATION'|'STAFF'='CANCELLATION'){
    const fn=lane==='STAFF'?'ops_refund':'cancellation_refund',claimed=(await operations.operationsPool.query(`SELECT ${fn}_claim($1) v`,[id])).rows[0].v;if(!claimed)return {state:'NOT_CLAIMED'};
    posts.push({id,location:claimed.location_id});
    await operations.operationsPool.query(`SELECT ${fn}_observe($1,$2::jsonb)`,[id,JSON.stringify({id:'synthetic-refund-'+id.slice(0,8),paymentProviderId:claimed.payment_provider_id,merchantId:claimed.merchant_id,locationId:claimed.location_id,amountJpy:Number(claimed.amount_jpy),currency:'JPY',status:'COMPLETED',updatedAt:x.now().toISOString()})]);
    return {state:'COMPLETED'};
   },async reconcile(id:string){lookedUp.push(id);return {state:'UNKNOWN'};}};
  const tickEnv=(limit?:string)=>({PRODUCTION_WORKER_ACCEPTED_AFTER:since,...(limit===undefined?{}:{PRODUCTION_WORKER_REFUND_CREATE_LIMIT:limit})});
  const ports=(limit:number)=>({reconciliation:{async runOnce(){return {results:[]};}},candidates:async()=>[],project:async()=>{throw Error('UNUSED');},notifications:null,refunds,refundCandidates:()=>normalRefundCandidates(operations.operationsPool,syntheticMerchant,locations,since,limit,true),close:async()=>{}});
  const unset=workerTickPlan(tickEnv(),new Date());assert.deepEqual([unset.refundCreateLimit,unset.refundBudgetJpy],[0,0]);
  await runNormalProductionTick(normalWorkerPlan(unset),ports(20) as never);assert.equal(posts.length,0,'limit unset: no CREATE');
  assert.throws(()=>workerTickPlan(tickEnv('two'),new Date()),/WORKER_TICK_LIMIT_INVALID/);
  const live=workerTickPlan(tickEnv('5'),new Date());assert.equal(live.refundCreateLimit,5);assert.ok(live.refundBudgetJpy>=Math.max(m.amount,o.amount),'budget never blocks an eligible row');
  await Promise.all([runNormalProductionTick(normalWorkerPlan(live),ports(20) as never),runNormalProductionTick(normalWorkerPlan(live),ports(20) as never)]);
  assert.deepEqual(posts.map(p=>p.id).sort(),[partialM.id,partialO.id].sort(),'each staff refund POSTed exactly once across two concurrent ticks');
  assert.deepEqual(Object.fromEntries(posts.map(p=>[p.id,p.location])),{[partialM.id]:mountain.observation.locationId,[partialO.id]:onsen.observation.locationId},'routed to the original location');
  await runNormalProductionTick(normalWorkerPlan(live),ports(20) as never);assert.equal(posts.length,2,'a later tick never re-POSTs');
  const sm=await new FinancialOperations(mountainStaff.ctx).summary(mountain.bookingId,'MOUNTAIN_BASE');
  assert.deepEqual(sm.payments.map((p:{refunded_jpy:number;remainingJpy:number})=>[p.refunded_jpy,p.remainingJpy]),[[300,m.amount-300]],'partial refund leaves the remainder');
  console.log('PASS refund automation: staff lane gated by 0056 grants; unset/invalid limit => no CREATE; positive limit => CREATE reached once per refund across concurrent ticks, routed per store; remainder preserved');

  // ── UNKNOWN is never re-POSTed: a crash after the claim leaves UNKNOWN without provider id; later ticks neither create nor look it up.
  const second=await new FinancialOperations(mountainStaff.ctx).requestRefund(randomUUID(),body(mountain.bookingId,m.id,'MOUNTAIN_BASE',100));
  await operations.operationsPool.query('SELECT ops_refund_claim($1)',[second.id]);
  await runNormalProductionTick(normalWorkerPlan(live),ports(20) as never);await runNormalProductionTick(normalWorkerPlan(live),ports(20) as never);
  assert.equal(posts.filter(p=>p.id===second.id).length,0);assert.ok(!lookedUp.includes(second.id),'no lookup without a provider id');
  assert.deepEqual((await pool.query('SELECT state,provider_id FROM ops_refund_requests WHERE id=$1',[second.id])).rows[0],{state:'UNKNOWN',provider_id:null});
  await assert.rejects(new FinancialOperations(mountainStaff.ctx).requestRefund(randomUUID(),body(mountain.bookingId,m.id,'MOUNTAIN_BASE',100)),{code:'REFUND_RECONCILIATION_REQUIRED'},'an UNKNOWN refund blocks a new one on the booking');
  console.log('PASS refund automation: UNKNOWN after claim is durable; no re-POST and no lookup without provider id; new refund blocked until reconciled');

  // ── Online x store race on one payment: the cap holds (COMPLETED+PENDING+UNKNOWN+REVIEW never exceed the collected amount).
  const r=await payment(race.bookingId),staffRace=new FinancialOperations(mountainStaff.ctx);
  const cancelOnline=async()=>{const c=await pool.connect();try{await c.query('BEGIN');await c.query("SELECT set_config('zao.actor',$1,true)",[x.actor]);const preview=(await c.query('SELECT booking_cancellation_preview($1) v',[race.bookingId])).rows[0].v;await c.query('SELECT booking_cancel($1,$2,$3::jsonb)',[race.bookingId,randomUUID(),JSON.stringify(preview)]);await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}};
  await Promise.allSettled([staffRace.requestRefund(randomUUID(),body(race.bookingId,r.id,'MOUNTAIN_BASE',r.amount-1)),cancelOnline()]);
  const total=Number((await pool.query("SELECT coalesce(sum(amount_jpy),0) n FROM (SELECT amount_jpy,state FROM ops_refund_requests WHERE payment_id=$1 UNION ALL SELECT amount_jpy,state FROM booking_cancellation_refunds WHERE payment_id=$1) t WHERE state<>'FAILED'",[r.id])).rows[0].n);
  assert.ok(total<=r.amount,`refunds ${total} must not exceed collected ${r.amount}`);
  await Promise.all([runNormalProductionTick(normalWorkerPlan(live),ports(20) as never),runNormalProductionTick(normalWorkerPlan(live),ports(20) as never)]);
  const completed=Number((await pool.query("SELECT coalesce(sum(amount_jpy),0) n FROM (SELECT amount_jpy,state FROM ops_refund_requests WHERE payment_id=$1 UNION ALL SELECT amount_jpy,state FROM booking_cancellation_refunds WHERE payment_id=$1) t WHERE state='COMPLETED'",[r.id])).rows[0].n);
  assert.ok(completed<=r.amount&&completed===total,'everything reserved was dispatched once and nothing beyond the collected amount');
  console.log('PASS refund automation: concurrent online cancellation and store refund on one payment stay within the collected amount; each dispatched once');

  // ── Refunds never touch inventory (claims, loans, asset status unchanged apart from the cancellation release itself).
  const after=await inventorySnapshot();assert.equal(after.loans,inventoryBefore.loans);assert.equal(after.assets,inventoryBefore.assets);
  console.log('PASS refund automation: refunds change no loan or asset state');

  // ── The worker class itself: STAFF lane through claim → one create → observe, with a synthetic gateway (simulated-mode booking).
  const sim=await x.draft(undefined,requestFor('2035-11-06'),{reason:'SYNTHETIC staff-lane worker proof'});await x.service.startPayment(sim.booking.id,randomUUID());
  const sp=await payment(sim.booking.id);let creates=0;
  const simRefund=await new FinancialOperations(mountainStaff.ctx).requestRefund(randomUUID(),body(sim.booking.id,sp.id,'MOUNTAIN_BASE',50));
  const workerClass=new CancellationRefundWorker(operations.operationsPool,{kind:'SIMULATED_DEV',async create(q){creates++;assert.equal(q.idempotencyKey,simRefund.id,'idempotency key is the server row id');return {id:'synthetic-sim-refund',paymentProviderId:q.paymentProviderId,merchantId:q.merchantId,locationId:q.locationId,amountJpy:q.amountJpy,currency:'JPY',status:'COMPLETED',updatedAt:x.now().toISOString()};},async lookup(){throw Error('UNUSED');}});
  const results=await Promise.all([workerClass.dispatch(simRefund.id,'STAFF'),workerClass.dispatch(simRefund.id,'STAFF')]);
  assert.equal(creates,1);assert.deepEqual(results.map(v=>v.state).sort(),['COMPLETED','NOT_CLAIMED']);
  assert.deepEqual((await pool.query('SELECT state,provider_id FROM ops_refund_requests WHERE id=$1',[simRefund.id])).rows[0],{state:'COMPLETED',provider_id:'synthetic-sim-refund'});
  console.log('PASS refund automation: STAFF-lane worker claims once, creates once with the row id as idempotency key, records COMPLETED');

  // ── The trusted bypass is only for the owner-executed functions: a caller that sets the setting itself is still checked.
  const c=await operations.operationsPool.connect();try{
   await c.query('BEGIN');await c.query("SELECT set_config('zao.ops_refund_system','on',true),set_config('zao.actor','system:refund-worker',true)");
   await assert.rejects(c.query("UPDATE ops_refund_requests SET state='FAILED' WHERE id=$1",[second.id]),'a direct UPDATE without a staff session is refused');await c.query('ROLLBACK');
   await c.query('BEGIN');await assert.rejects(c.query('INSERT INTO rental_internal.ops_refund_effects VALUES(txid_current(),pg_backend_pid(),$1)',[second.id]),{code:'42501'},'the marker cannot be forged');await c.query('ROLLBACK');
  }finally{c.release();}
  assert.deepEqual((await pool.query('SELECT state FROM ops_refund_requests WHERE id=$1',[second.id])).rows[0],{state:'UNKNOWN'});
  assert.equal((await pool.query('SELECT count(*)::int n FROM rental_internal.ops_refund_effects')).rows[0].n,0,'no marker survives a transaction');
  console.log('PASS refund automation: the worker bypass cannot be forged (session variable or marker insert), and no marker lingers');
 }finally{
  await operations.close();
  // Leave the owned database as the next suite expects: the local operations role is re-provisioned by later checks.
  const role=x.db.identity.namespace+'_operations';await pool.query(`DROP OWNED BY ${role}`);await pool.query(`DROP ROLE ${role}`);
 }
}
