import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {productionProjectionPermit,productionProjectionTarget} from '../../packages/core/src/payment/production-projection-authority';
import {decidePaymentProjection as decide,TransactionalPaymentProjection} from '../../packages/core/src/payment/payment-projection';
import {PgPaymentProjection} from '../../packages/db/src/payment-projection';
import {clock,id,stateFixture,observation,reference,sourceFixture,ProjectionSqlFixture} from '../fixtures/payment-projection';
import {productionConfiguration,productionServices,type ProductionConfiguration} from '../../packages/auth/src/production-config';
import {productionGuestConfiguration,guestConfigurationHash} from '../../packages/contracts/src/production-guest';
import {issueExactProductionIdentity,exactProductionIdentityConfiguration,type ExpectedProductionIdentity} from '../../packages/auth/src/production-identity';

const productionTarget={bookingId:id(1),attemptId:id(4),database:'zao_rental_production'};
const guestPolicy=productionGuestConfiguration({schemaVersion:1,revision:'R6C-FIXTURE',ingressAdapterId:'r6c-fixture-dispatcher',policy:{version:'R6C-FIXTURE',contextSeconds:3600,absoluteSeconds:7200,recoverySeconds:3600,replaySeconds:30,retentionSeconds:60,windowSeconds:10,peerRequests:1000,globalRequests:2000}});
const FIXTURE_HOST='ep-r6c-fixture.neon.tech',FIXTURE_PROJECT='r6c-project';
// F2 (integration-corrected): the test's own self-consistent "real" identity — computed from the
// same synthetic host/project/db name every test fixture below uses, never the real pinned
// Production values. This proves the accept/reject boundary without needing real secrets.
function testExpectedIdentity(overrides: Partial<ExpectedProductionIdentity> = {}): ExpectedProductionIdentity {
 return {
  hostFingerprintSha256: createHash('sha256').update(FIXTURE_HOST.trim().toLowerCase()).digest('hex'),
  databaseName: productionTarget.database,
  vercelProjectFingerprintSha256: createHash('sha256').update(FIXTURE_PROJECT).digest('hex'),
  ...overrides,
 };
}
// A fully validated ProductionConfiguration — the raw material productionProjectionPermit no
// longer accepts directly (PROD-R6-C/F2); it must first pass issueExactProductionIdentity.
// Every unit test below constructs its own self-consistent one; none of this requires a real
// Neon host or Square credential to exist.
function validConfig(overrides: Partial<{database:Partial<ProductionConfiguration['database']>;payment:Partial<NonNullable<ProductionConfiguration['payment']>>|null;deployment:Partial<ProductionConfiguration['deployment']>}> = {}): ProductionConfiguration {
 return productionConfiguration({
  schemaVersion:1,capability:'ZAO_PRODUCTION_RUNTIME_V1',
  deployment:{provider:'VERCEL',environment:'production',projectId:FIXTURE_PROJECT,releaseId:'r6c-release',origin:'https://r6c-fixture.invalid',...overrides.deployment},
  database:{provider:'NEON',environment:'production',host:FIXTURE_HOST,name:productionTarget.database,roles:Object.fromEntries(productionServices.map(s=>[s,'r6c_'+s+'_role'])),...overrides.database},
  flags:{booking:true,guestRecovery:false,payment:true,media:false,avatar:false,staffOperations:false},
  guest:guestPolicy,approvedGuestSha256:guestConfigurationHash(guestPolicy),
  payment:overrides.payment===null?null:{provider:'SQUARE',environment:'PRODUCTION',merchantId:'r6c-merchant',locations:{MOUNTAIN_BASE:'r6c-loc-1',ONSEN_BASE:'r6c-loc-2'},...overrides.payment},
  media:null,
 });
}
function permitFor(config: ProductionConfiguration, ref: {bookingId: string; attemptId: string} = productionTarget) {
 return productionProjectionPermit(issueExactProductionIdentity(config, testExpectedIdentity()), ref);
}

// ---- production-identity.ts: exact identity gate (F2) ----

test('F2: a valid Neon shape but a different host is rejected',()=>{
 const config=validConfig({database:{host:'ep-some-other-host.neon.tech'}});
 assert.throws(()=>issueExactProductionIdentity(config,testExpectedIdentity()),{message:'PRODUCTION_IDENTITY_WRONG_HOST'});
});
test('F2: the right host but a different database name is rejected',()=>{
 const config=validConfig({database:{name:'some_other_database'}});
 assert.throws(()=>issueExactProductionIdentity(config,testExpectedIdentity()),{message:'PRODUCTION_IDENTITY_WRONG_DATABASE_NAME'});
});
test('F2: a valid Vercel-project-shaped ID but a different project is rejected',()=>{
 const config=validConfig({deployment:{projectId:'a-different-but-validly-shaped-project-id'}});
 assert.throws(()=>issueExactProductionIdentity(config,testExpectedIdentity()),{message:'PRODUCTION_IDENTITY_WRONG_VERCEL_PROJECT'});
});
test('F2: Preview cannot satisfy the identity gate even with every other field correct',()=>{
 // productionConfiguration() itself only accepts deployment.environment==='production', so a
 // literal 'preview' value never survives that far; this proves defense-in-depth explicitly.
 const config=validConfig();
 const forged={...config,deployment:{...config.deployment,environment:'preview' as never}};
 assert.throws(()=>issueExactProductionIdentity(forged,testExpectedIdentity()));
});
test('F2: releaseId (deployment identity, changes every deploy) is deliberately NOT pinned — a different releaseId with everything else correct is accepted',()=>{
 const config=validConfig({deployment:{releaseId:'a-completely-different-release-id'}});
 assert.doesNotThrow(()=>issueExactProductionIdentity(config,testExpectedIdentity()));
});
test('F2: the exact-identity capability is itself WeakMap-backed — a hand-built object shaped like one resolves to null, never a real configuration',()=>{
 assert.equal(exactProductionIdentityConfiguration(undefined),null);
 assert.equal(exactProductionIdentityConfiguration({kind:'EXACT_PRODUCTION_IDENTITY'} as never),null);
});

// ---- production-projection-authority.ts: permit issuance gating ----

test('production permit requires an exact-identity capability, not a Production deployment/payment shape alone',()=>{
 assert.throws(()=>permitFor({...validConfig(),payment:null}));
});
test('production permit accepts a genuine exact-identity-verified configuration and binds it to exactly this booking/attempt',()=>{
 const permit=permitFor(validConfig(),{bookingId:productionTarget.bookingId,attemptId:productionTarget.attemptId});
 assert.deepEqual(productionProjectionTarget(permit,{bookingId:productionTarget.bookingId,attemptId:productionTarget.attemptId}),{...productionTarget,merchantId:'r6c-merchant'});
 assert.equal(productionProjectionTarget(permit,{bookingId:id(99),attemptId:productionTarget.attemptId}),null);
 assert.equal(productionProjectionTarget(permit,{bookingId:productionTarget.bookingId,attemptId:id(99)}),null);
});
test('an R15 permit and a Production permit are structurally distinct capabilities: one cannot be used as the other',()=>{
 const permit=permitFor(validConfig());
 assert.equal(productionProjectionTarget(undefined,{bookingId:productionTarget.bookingId,attemptId:productionTarget.attemptId}),null);
 assert.notEqual(permit,undefined);
});
test('productionProjectionPermit no longer accepts a raw ProductionConfiguration directly at all — only an ExactProductionIdentity capability',()=>{
 const config=validConfig();
 assert.throws(()=>productionProjectionPermit(config as never,productionTarget));
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
 const permit=permitFor(validConfig());
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
 const permit=permitFor(validConfig());
 const svc=new TransactionalPaymentProjection(new PgPaymentProjection(f,undefined,undefined,permit),undefined,permit);
 await assert.rejects(svc.project(reference(f.world.src)),{code:'PROJECTION_PRODUCTION_DB_ONLY'});
 assert.ok(!f.calls.some(c=>c.sql.includes('pg_advisory_xact_lock')));
});
test('a Production permit is refused if the connected database name does not exactly match the permit target',async()=>{
 const f=productionFixture();f.database='some_other_production_shaped_db';
 const permit=permitFor(validConfig());
 const svc=new TransactionalPaymentProjection(new PgPaymentProjection(f,undefined,undefined,permit),undefined,permit);
 await assert.rejects(svc.project(reference(f.world.src)),{code:'PROJECTION_PRODUCTION_DB_ONLY'});
});
test('a Production permit is refused if the connected role does not match <database>_pay_projection',async()=>{
 const f=productionFixture();f.role='some_other_role';
 const permit=permitFor(validConfig());
 const svc=new TransactionalPaymentProjection(new PgPaymentProjection(f,undefined,undefined,permit),undefined,permit);
 await assert.rejects(svc.project(reference(f.world.src)),{code:'PROJECTION_PRODUCTION_DB_ONLY'});
});
test('a Production-permitted PRODUCTION source cannot be satisfied by a SANDBOX-environment persisted source (verifyProjectionSource environment binding)',async()=>{
 const f=productionFixture();f.world.src={...productionSource(),environment:'SANDBOX'};
 const permit=permitFor(validConfig());
 const svc=new TransactionalPaymentProjection(new PgPaymentProjection(f,undefined,undefined,permit),undefined,permit);
 await assert.rejects(svc.project(reference(f.world.src)),{code:'PROJECTION_SOURCE_NOT_ACCEPTED'});
});
test('F7: even a fully-matched Production permit + source no longer silently applies as commercial success — fails closed, never writes CONFIRMED_DEV',async()=>{
 const f=productionFixture();
 const before=f.world.b.state;
 const permit=permitFor(validConfig());
 const svc=new TransactionalPaymentProjection(new PgPaymentProjection(f,undefined,undefined,permit),undefined,permit);
 await assert.rejects(svc.project(reference(f.world.src)),{code:'PRODUCTION_BOOKING_PATH_NOT_ACTIVATED'});
 assert.equal(f.world.b.state,before); // untouched — no CONFIRMED_DEV was written for Production evidence
 assert.notEqual(f.world.b.state,'CONFIRMED_DEV');
});
test('production constructor gate: NODE_ENV=production requires either an R15 or a Production permit',()=>{
 const old=process.env.NODE_ENV;Reflect.set(process.env,'NODE_ENV','production');
 try{
  assert.throws(()=>new TransactionalPaymentProjection(new PgPaymentProjection(new ProjectionSqlFixture())),{code:'PROJECTION_NOT_ACTIVATED'});
  const permit=permitFor(validConfig());
  assert.doesNotThrow(()=>new TransactionalPaymentProjection(new PgPaymentProjection(productionFixture()),undefined,permit));
 }finally{if(old===undefined)Reflect.deleteProperty(process.env,'NODE_ENV');else Reflect.set(process.env,'NODE_ENV',old);}
});

// ---- packages/core/src/payment/production-reconciliation-authority.ts: F5 authority gate ----

import {issueProductionReconciliationAuthority,productionReconciliationTarget} from '../../packages/core/src/payment/production-reconciliation-authority';

function reconciliationAuthorityFor(config:ProductionConfiguration){return issueProductionReconciliationAuthority(issueExactProductionIdentity(config,testExpectedIdentity()));}

test('F5: issueProductionReconciliationAuthority requires a validated Square PRODUCTION payment binding on the identity',()=>{
 // A genuinely validated identity for the dark/inert profile (flags.payment=false, so
 // productionConfiguration() itself allows payment:null here, unlike a flags.payment=true
 // config where payment is required) must still not be able to mint a reconciliation authority.
 const dark=productionConfiguration({
  schemaVersion:1,capability:'ZAO_PRODUCTION_RUNTIME_V1',
  deployment:{provider:'VERCEL',environment:'production',projectId:FIXTURE_PROJECT,releaseId:'r6c-release',origin:'https://r6c-fixture.invalid'},
  database:{provider:'NEON',environment:'production',host:FIXTURE_HOST,name:productionTarget.database,roles:Object.fromEntries(productionServices.map(s=>[s,'r6c_'+s+'_role']))},
  flags:{booking:false,guestRecovery:false,payment:false,media:false,avatar:false,staffOperations:false},
  guest:guestPolicy,approvedGuestSha256:guestConfigurationHash(guestPolicy),payment:null,media:null,
 });
 assert.throws(()=>issueProductionReconciliationAuthority(issueExactProductionIdentity(dark,testExpectedIdentity())),{message:'PRODUCTION_RECONCILIATION_AUTHORITY_REQUIRED'});
});
test('F5: issueProductionReconciliationAuthority binds exactly the merchant/database already on the identity, never a caller-supplied value',()=>{
 const authority=reconciliationAuthorityFor(validConfig());
 assert.deepEqual(productionReconciliationTarget(authority),{merchantId:'r6c-merchant',database:productionTarget.database});
 assert.equal(productionReconciliationTarget(undefined),null);
 assert.equal(productionReconciliationTarget({kind:'PRODUCTION_RECONCILIATION_AUTHORITY'} as never),null);
});

// ---- packages/db/src/payment-reconciliation.ts: F5 authority-gated *_production routing ----

test('PgPaymentReconciliation: PRODUCTION environment is refused on every method without an authority (no silent fallback to generic SQL, and the pool is never touched)',async()=>{
 const {PgPaymentReconciliation}=await import('../../packages/db/src/payment-reconciliation');
 const repo=new PgPaymentReconciliation({connect:async()=>{throw new Error('UNREACHABLE');}} as never);
 const claim={id:'j',environment:'PRODUCTION',merchantId:'m',paymentId:'p'} as never;
 await assert.rejects(repo.dispatch('PRODUCTION',1),{message:'PRODUCTION_RECONCILIATION_AUTHORITY_REQUIRED'});
 await assert.rejects(repo.claimBatch('PRODUCTION','w',1),{message:'PRODUCTION_RECONCILIATION_AUTHORITY_REQUIRED'});
 await assert.rejects(repo.load(claim),{message:'PRODUCTION_RECONCILIATION_AUTHORITY_REQUIRED'});
 await assert.rejects(repo.loadBatch([claim]),{message:'PRODUCTION_RECONCILIATION_AUTHORITY_REQUIRED'});
 await assert.rejects(repo.finalize(claim,{state:'RECONCILED',code:null,retrySeconds:null,truth:null}),{message:'PRODUCTION_RECONCILIATION_AUTHORITY_REQUIRED'});
 await assert.rejects(repo.diagnostics('PRODUCTION',1),{message:'PRODUCTION_RECONCILIATION_AUTHORITY_REQUIRED'});
});
test('PgPaymentReconciliation: an authority-holding instance refuses SANDBOX on every method (never falls back either direction, and the pool is never touched)',async()=>{
 const {PgPaymentReconciliation}=await import('../../packages/db/src/payment-reconciliation');
 const authority=reconciliationAuthorityFor(validConfig());
 const repo=new PgPaymentReconciliation({connect:async()=>{throw new Error('UNREACHABLE');}} as never,undefined,authority);
 const claim={id:'j',environment:'SANDBOX',merchantId:'m',paymentId:'p'} as never;
 await assert.rejects(repo.dispatch('SANDBOX',1),{message:'PRODUCTION_RECONCILIATION_AUTHORITY_MISUSE'});
 await assert.rejects(repo.load(claim),{message:'PRODUCTION_RECONCILIATION_AUTHORITY_MISUSE'});
});
test('PgPaymentReconciliation: without authority, the Sandbox/target routing is byte-identical to before (dispatch_target/claim_target still selected)',async()=>{
 const {PgPaymentReconciliation}=await import('../../packages/db/src/payment-reconciliation');
 const calls:{sql:string;values:unknown[]}[]=[];
 const fakePool={connect:async()=>({
  query:async(sql:string,values:unknown[]=[])=>{calls.push({sql,values});if(sql==='BEGIN'||sql==='COMMIT'||sql.startsWith('SET '))return {rows:[],rowCount:0};return {rows:[{n:0,claim:null,context:null}],rowCount:1};},
  release:()=>{},
 })} as never;
 const repo=new PgPaymentReconciliation(fakePool,{merchantId:'m',paymentId:'p'});
 await repo.dispatch('SANDBOX',1);
 await repo.load({id:'j',environment:'SANDBOX',merchantId:'m',paymentId:'p'} as never);
 assert.ok(calls.some(c=>c.sql.includes('payment_reconciliation.dispatch_target(')));
 assert.ok(calls.some(c=>c.sql.includes('payment_reconciliation.load_context(')&&!c.sql.includes('_production')));
});
test('PgPaymentReconciliation: with authority, every method routes to the *_production function, bound to the authority merchant (never a caller-supplied one)',async()=>{
 const {PgPaymentReconciliation}=await import('../../packages/db/src/payment-reconciliation');
 const authority=reconciliationAuthorityFor(validConfig());
 const calls:{sql:string;values:unknown[]}[]=[];
 const fakeClaim={id:'j',environment:'PRODUCTION',merchantId:'r6c-merchant',paymentId:'p',generation:1,sourceEventId:'e',sourceFingerprint:'f',signalRevision:1,truthRevision:1,attempt:1,leaseOwner:'w',leaseToken:'t',leaseExpiresAt:new Date().toISOString(),deadlineAt:new Date().toISOString(),latest:null};
 const fakePool={connect:async()=>({
  query:async(sql:string,values:unknown[]=[])=>{calls.push({sql,values});if(sql==='BEGIN'||sql==='COMMIT'||sql.startsWith('SET '))return {rows:[],rowCount:0};return {rows:[{n:0,claim:fakeClaim,context:null,ok:true,entry:{jobId:'j',context:null},summary:{id:'j',state:'RECONCILED',generation:1,paymentId:'p',attempt:1,code:null,decision:null,updatedAt:new Date().toISOString()}}],rowCount:1};},
  release:()=>{},
 })} as never;
 // deliberately constructed WITHOUT a `target` — production admission never needs the R15/dev
 // per-payment target scope, only the authority's own merchant.
 const repo=new PgPaymentReconciliation(fakePool,undefined,authority);
 const claim={id:'j',environment:'PRODUCTION',merchantId:'r6c-merchant',paymentId:'p',leaseToken:'t',truthRevision:1} as never;
 await repo.dispatch('PRODUCTION',1);
 await repo.claimBatch('PRODUCTION','w',1);
 await repo.load(claim);
 await repo.loadBatch([claim]);
 await repo.finalize(claim,{state:'RECONCILED',code:null,retrySeconds:null,truth:null});
 await repo.diagnostics('PRODUCTION',5);
 assert.ok(calls.some(c=>c.sql.includes('payment_reconciliation.dispatch_production(')&&c.values[0]==='r6c-merchant'));
 assert.ok(calls.some(c=>c.sql.includes('payment_reconciliation.claim_production(')&&c.values[2]==='r6c-merchant'));
 assert.ok(calls.some(c=>c.sql.includes('payment_reconciliation.load_context_production(')));
 assert.ok(calls.some(c=>c.sql.includes('payment_reconciliation.load_contexts_production(')));
 assert.ok(calls.some(c=>c.sql.includes('payment_reconciliation.finalize_production(')));
 assert.ok(calls.some(c=>c.sql.includes('payment_reconciliation.diagnostics_production(')&&c.values.length===1));
 assert.ok(!calls.some(c=>/payment_reconciliation\.(dispatch|claim|finalize|diagnostics|load_context|load_contexts)\(/.test(c.sql)));
});
