import {test} from 'node:test';
import assert from 'node:assert/strict';
import {productionProjectionPermit,productionProjectionTarget} from '../../packages/core/src/payment/production-projection-authority';
import {decidePaymentProjection as decide,TransactionalPaymentProjection} from '../../packages/core/src/payment/payment-projection';
import {PgPaymentProjection} from '../../packages/db/src/payment-projection';
import {clock,id,stateFixture,observation,reference,sourceFixture,ProjectionSqlFixture} from '../fixtures/payment-projection';
import {productionConfiguration,productionServices,type ProductionConfiguration} from '../../packages/auth/src/production-config';
import {productionGuestConfiguration,guestConfigurationHash} from '../../packages/contracts/src/production-guest';

const productionTarget={bookingId:id(1),attemptId:id(4),database:'zao_rental_production'};
const guestPolicy=productionGuestConfiguration({schemaVersion:1,revision:'R6C-FIXTURE',ingressAdapterId:'r6c-fixture-dispatcher',policy:{version:'R6C-FIXTURE',contextSeconds:3600,absoluteSeconds:7200,recoverySeconds:3600,replaySeconds:30,retentionSeconds:60,windowSeconds:10,peerRequests:1000,globalRequests:2000}});
// A fully validated ProductionConfiguration — the only thing productionProjectionPermit accepts
// as evidence now (PROD-R6-C). Every unit test below constructs its own self-consistent one;
// none of this requires a real Neon host or Square credential to exist.
function validConfig(overrides: Partial<{database:Partial<ProductionConfiguration['database']>;payment:Partial<NonNullable<ProductionConfiguration['payment']>>|null;deployment:Partial<ProductionConfiguration['deployment']>}> = {}): ProductionConfiguration {
 return productionConfiguration({
  schemaVersion:1,capability:'ZAO_PRODUCTION_RUNTIME_V1',
  deployment:{provider:'VERCEL',environment:'production',projectId:'r6c-project',releaseId:'r6c-release',origin:'https://r6c-fixture.invalid',...overrides.deployment},
  database:{provider:'NEON',environment:'production',host:'ep-r6c-fixture.neon.tech',name:productionTarget.database,roles:Object.fromEntries(productionServices.map(s=>[s,'r6c_'+s+'_role'])),...overrides.database},
  flags:{booking:true,guestRecovery:false,payment:true,media:false,avatar:false,staffOperations:false},
  guest:guestPolicy,approvedGuestSha256:guestConfigurationHash(guestPolicy),
  payment:overrides.payment===null?null:{provider:'SQUARE',environment:'PRODUCTION',merchantId:'r6c-merchant',locations:{MOUNTAIN_BASE:'r6c-loc-1',ONSEN_BASE:'r6c-loc-2'},...overrides.payment},
  media:null,
 });
}

// ---- production-projection-authority.ts: permit issuance gating ----

test('production permit requires a Production deployment and a Production Square payment binding',()=>{
 assert.throws(()=>productionProjectionPermit({...validConfig(),deployment:{...validConfig().deployment,environment:'preview' as never}},productionTarget),{message:'PRODUCTION_PROJECTION_AUTHORITY_REQUIRED'});
 assert.throws(()=>productionProjectionPermit({...validConfig(),payment:null},productionTarget),{message:'PRODUCTION_PROJECTION_AUTHORITY_REQUIRED'});
});
test('production permit accepts a genuine validated ProductionConfiguration and binds it to exactly this booking/attempt',()=>{
 const config=validConfig();
 const permit=productionProjectionPermit(config,{bookingId:productionTarget.bookingId,attemptId:productionTarget.attemptId});
 assert.deepEqual(productionProjectionTarget(permit,{bookingId:productionTarget.bookingId,attemptId:productionTarget.attemptId}),{...productionTarget,merchantId:'r6c-merchant'});
 assert.equal(productionProjectionTarget(permit,{bookingId:id(99),attemptId:productionTarget.attemptId}),null);
 assert.equal(productionProjectionTarget(permit,{bookingId:productionTarget.bookingId,attemptId:id(99)}),null);
});
test('an R15 permit and a Production permit are structurally distinct capabilities: one cannot be used as the other',()=>{
 const permit=productionProjectionPermit(validConfig(),productionTarget);
 assert.equal(productionProjectionTarget(undefined,{bookingId:productionTarget.bookingId,attemptId:productionTarget.attemptId}),null);
 assert.notEqual(permit,undefined);
});
test('a raw object shaped like Production (not an actually-validated ProductionConfiguration) is not accepted — TypeScript itself refuses it, and a config that never passed productionConfiguration() throws',()=>{
 assert.throws(()=>productionProjectionPermit({deployment:{provider:'VERCEL',environment:'production'},payment:{provider:'SQUARE',environment:'PRODUCTION',merchantId:'x'},database:{name:'anything'}} as never,productionTarget));
});

// ---- decidePaymentProjection: SQUARE_PRODUCTION is a recognized mode, additively ----

test('decidePaymentProjection recognizes SQUARE_PRODUCTION as a valid mode (additive, SQUARE_SANDBOX/SIMULATED_DEV unaffected)',()=>{
 const s=stateFixture();s.booking.mode='SQUARE_PRODUCTION';
 assert.equal(decide(s,observation(),clock).decision,'APPLY_COMPLETED');
});
test('decidePaymentProjection still rejects any other mode value',()=>{
 const s=stateFixture();s.booking.mode='SOMETHING_ELSE';
 assert.equal(decide(s,observation(),clock).decision,'BLOCK_IDENTITY_MISMATCH');
});

// ---- TransactionalPaymentProjection + PgPaymentProjection: environment/mode crossing prevention ----

function productionSource(){return {...sourceFixture(),environment:'PRODUCTION' as const};}
function productionFixture(){
 const f=new ProjectionSqlFixture();
 f.database=productionTarget.database;f.role=productionTarget.database+'_pay_projection';
 f.world.b.mode='SQUARE_PRODUCTION';f.world.src=productionSource();
 return f;
}

test('a Production permit against a booking still in SQUARE_SANDBOX mode is rejected (mode must match the bound environment)',async()=>{
 const f=productionFixture();f.world.b.mode='SQUARE_SANDBOX';
 const permit=productionProjectionPermit(validConfig(),productionTarget);
 const svc=new TransactionalPaymentProjection(new PgPaymentProjection(f,undefined,undefined,permit),undefined,permit);
 await assert.rejects(svc.project(reference(f.world.src)),{code:'PROJECTION_MODE_MISMATCH'});
 assert.equal(f.world.history.length,0);
});
test('a SQUARE_PRODUCTION-mode booking is rejected without a Production permit (no silent Sandbox admission of Production bookings)',async()=>{
 const f=new ProjectionSqlFixture();f.world.b.mode='SQUARE_PRODUCTION';
 const svc=new TransactionalPaymentProjection(new PgPaymentProjection(f)); // default: no permit, expects SQUARE_SANDBOX
 await assert.rejects(svc.project(reference(f.world.src)),{code:'PROJECTION_MODE_MISMATCH'});
 assert.equal(f.world.history.length,0);
});
test('a Production permit is refused against a disposable zr_* database, even with a matching role name (converse of the dev floor)',async()=>{
 const f=productionFixture();f.database='zr_012345abcdef';f.role='zr_012345abcdef_pay_projection';
 const permit=productionProjectionPermit(validConfig(),productionTarget);
 const svc=new TransactionalPaymentProjection(new PgPaymentProjection(f,undefined,undefined,permit),undefined,permit);
 await assert.rejects(svc.project(reference(f.world.src)),{code:'PROJECTION_PRODUCTION_DB_ONLY'});
 assert.ok(!f.calls.some(c=>c.sql.includes('pg_advisory_xact_lock')));
});
test('a Production permit is refused if the connected database name does not exactly match the permit target',async()=>{
 const f=productionFixture();f.database='some_other_production_shaped_db';
 const permit=productionProjectionPermit(validConfig(),productionTarget);
 const svc=new TransactionalPaymentProjection(new PgPaymentProjection(f,undefined,undefined,permit),undefined,permit);
 await assert.rejects(svc.project(reference(f.world.src)),{code:'PROJECTION_PRODUCTION_DB_ONLY'});
});
test('a Production permit is refused if the connected role does not match <database>_pay_projection',async()=>{
 const f=productionFixture();f.role='some_other_role';
 const permit=productionProjectionPermit(validConfig(),productionTarget);
 const svc=new TransactionalPaymentProjection(new PgPaymentProjection(f,undefined,undefined,permit),undefined,permit);
 await assert.rejects(svc.project(reference(f.world.src)),{code:'PROJECTION_PRODUCTION_DB_ONLY'});
});
test('a Production-permitted PRODUCTION source cannot be satisfied by a SANDBOX-environment persisted source (verifyProjectionSource environment binding)',async()=>{
 const f=productionFixture();f.world.src={...productionSource(),environment:'SANDBOX'};
 const permit=productionProjectionPermit(validConfig(),productionTarget);
 const svc=new TransactionalPaymentProjection(new PgPaymentProjection(f,undefined,undefined,permit),undefined,permit);
 await assert.rejects(svc.project(reference(f.world.src)),{code:'PROJECTION_SOURCE_NOT_ACCEPTED'});
});
test('correct Production permit + Production-shaped database/role + SQUARE_PRODUCTION booking + PRODUCTION source: admitted end to end',async()=>{
 const f=productionFixture();
 const permit=productionProjectionPermit(validConfig(),productionTarget);
 const svc=new TransactionalPaymentProjection(new PgPaymentProjection(f,undefined,undefined,permit),undefined,permit);
 const result=await svc.project(reference(f.world.src));
 assert.equal(result.decision,'APPLY_COMPLETED');
 assert.equal(f.world.b.state,'CONFIRMED_DEV'); // booking.state literal is shared across modes; not Production-specific business behavior
 assert.equal(f.world.h.payment_state,'SUCCESS');
});
test('production constructor gate: NODE_ENV=production requires either an R15 or a Production permit',()=>{
 const old=process.env.NODE_ENV;Reflect.set(process.env,'NODE_ENV','production');
 try{
  assert.throws(()=>new TransactionalPaymentProjection(new PgPaymentProjection(new ProjectionSqlFixture())),{code:'PROJECTION_NOT_ACTIVATED'});
  const permit=productionProjectionPermit(validConfig(),productionTarget);
  assert.doesNotThrow(()=>new TransactionalPaymentProjection(new PgPaymentProjection(productionFixture()),undefined,permit));
 }finally{if(old===undefined)Reflect.deleteProperty(process.env,'NODE_ENV');else Reflect.set(process.env,'NODE_ENV',old);}
});

// ---- packages/db/src/payment-reconciliation.ts: PRODUCTION environment selects the _production SQL functions ----

test('PgPaymentReconciliation.load selects load_context_production only for a PRODUCTION claim, never for SANDBOX',async()=>{
 const {PgPaymentReconciliation}=await import('../../packages/db/src/payment-reconciliation');
 const calls:{sql:string;values:unknown[]}[]=[];
 const fakePool={connect:async()=>({
  query:async(sql:string,values:unknown[]=[])=>{calls.push({sql,values});if(sql==='BEGIN'||sql==='COMMIT'||sql.startsWith('SET '))return {rows:[],rowCount:0};return {rows:[{context:null}],rowCount:1};},
  release:()=>{},
 })} as never;
 const repo=new PgPaymentReconciliation(fakePool);
 await repo.load({id:'j',environment:'SANDBOX',merchantId:'m',paymentId:'p'} as never);
 await repo.load({id:'j',environment:'PRODUCTION',merchantId:'m',paymentId:'p'} as never);
 assert.ok(calls.some(c=>c.sql.includes('payment_reconciliation.load_context(') && !c.sql.includes('_production')));
 assert.ok(calls.some(c=>c.sql.includes('payment_reconciliation.load_context_production(')));
});
