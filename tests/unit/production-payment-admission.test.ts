import {test} from 'node:test';
import assert from 'node:assert/strict';
import {productionProjectionPermit,productionProjectionTarget,deriveProductionProjectionTarget} from '../../packages/core/src/payment/production-projection-authority';
import {decidePaymentProjection as decide,TransactionalPaymentProjection} from '../../packages/core/src/payment/payment-projection';
import {PgPaymentProjection} from '../../packages/db/src/payment-projection';
import {clock,id,stateFixture,observation,reference,ProjectionSqlFixture} from '../fixtures/payment-projection';
import {productionConfiguration,productionServices,type ProductionConfiguration} from '../../packages/auth/src/production-config';
import {productionGuestConfiguration,guestConfigurationHash} from '../../packages/contracts/src/production-guest';

const productionTarget={bookingId:id(1),attemptId:id(4),database:'zao_rental_production'};
const guestPolicy=productionGuestConfiguration({schemaVersion:1,revision:'R6C-FIXTURE',ingressAdapterId:'r6c-fixture-dispatcher',policy:{version:'R6C-FIXTURE',contextSeconds:3600,absoluteSeconds:7200,recoverySeconds:3600,replaySeconds:30,retentionSeconds:60,windowSeconds:10,peerRequests:1000,globalRequests:2000}});
const FIXTURE_HOST='ep-r6c-fixture.neon.tech',FIXTURE_PROJECT='r6c-project';
// A fully validated ProductionConfiguration — the raw material the pure derivation helpers and the
// real product functions' reject paths both exercise. No identity/permit is ever minted from it in
// this file (V4/TD correction: there is no test-only issuer of ExactProductionIdentity, or of a
// ProductionProjectionPermit/ProductionReconciliationAuthority, anywhere in this repository — see
// docs/execution/production-integration/RESULT.md for the resulting R3_ATTENDED_ACCEPTANCE_REQUIRED
// disposition of the tests this removed).
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

// ---- production-projection-authority.ts: pure target derivation (fully offline, no identity/permit needed) ----

test('deriveProductionProjectionTarget: a valid Square PRODUCTION config yields the exact database/merchant facts',()=>{
 assert.deepEqual(deriveProductionProjectionTarget(validConfig()),{database:productionTarget.database,merchantId:'r6c-merchant'});
});
test('deriveProductionProjectionTarget: no payment binding at all is rejected',()=>{
 assert.equal(deriveProductionProjectionTarget({...validConfig(),payment:null}),null);
});
test('deriveProductionProjectionTarget: a Sandbox-environment payment binding is rejected',()=>{
 const c=validConfig();
 assert.equal(deriveProductionProjectionTarget({...c,payment:{...c.payment!,environment:'SANDBOX' as never}}),null);
});
test('deriveProductionProjectionTarget: a non-Square provider is rejected',()=>{
 const c=validConfig();
 assert.equal(deriveProductionProjectionTarget({...c,payment:{...c.payment!,provider:'OTHER' as never}}),null);
});
test('deriveProductionProjectionTarget: a missing database name is rejected',()=>{
 const c=validConfig();
 assert.equal(deriveProductionProjectionTarget({...c,database:{...c.database,name:''}}),null);
});

// ---- production-projection-authority.ts: permit issuance gating (reject paths only — the real
// accept path requires a genuine ExactProductionIdentity, which no test can mint; see RESULT.md) ----

test('productionProjectionPermit no longer accepts a raw ProductionConfiguration directly at all — only an ExactProductionIdentity capability',()=>{
 const config=validConfig();
 assert.throws(()=>productionProjectionPermit(config as never,productionTarget));
});
test('productionProjectionPermit rejects an undefined identity',()=>{
 assert.throws(()=>productionProjectionPermit(undefined as never,productionTarget));
});
test('productionProjectionPermit rejects a hand-built object shaped like an ExactProductionIdentity but never actually issued (WeakMap miss)',()=>{
 assert.throws(()=>productionProjectionPermit({kind:'EXACT_PRODUCTION_IDENTITY'} as never,productionTarget));
});
test('productionProjectionTarget resolves an absent/undefined permit to null, never a default target',()=>{
 assert.equal(productionProjectionTarget(undefined,{bookingId:productionTarget.bookingId,attemptId:productionTarget.attemptId}),null);
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
//
// V4 (TD correction): the tests previously here proving PgPaymentProjection's defense-in-depth
// *while holding a valid Production permit* (wrong connected DB, wrong role, mode mismatch despite
// a permit, SANDBOX-environment source crossing, and the F7 fail-closed-write proof) required
// minting a real ProductionProjectionPermit, which requires a genuine ExactProductionIdentity —
// impossible to construct offline by design (no test-only issuer anywhere). Those specific
// permit-holding proofs are R3_ATTENDED_ACCEPTANCE_REQUIRED; see RESULT.md. The no-permit-at-all
// path below remains fully provable offline and is unchanged.

test('a SQUARE_PRODUCTION-mode booking is rejected without a Production permit (no silent Sandbox admission of Production bookings)',async()=>{
 const f=new ProjectionSqlFixture();f.world.b.mode='SQUARE_PRODUCTION';
 const svc=new TransactionalPaymentProjection(new PgPaymentProjection(f)); // default: no permit, expects SQUARE_SANDBOX
 await assert.rejects(svc.project(reference(f.world.src)),{code:'PROJECTION_MODE_MISMATCH'});
 assert.equal(f.world.history.length,0);
});
test('production constructor gate: NODE_ENV=production requires either an R15 or a Production permit — the reject half is fully provable offline; the accept half (holding a genuine permit) is R3_ATTENDED_ACCEPTANCE_REQUIRED',()=>{
 const old=process.env.NODE_ENV;Reflect.set(process.env,'NODE_ENV','production');
 try{
  assert.throws(()=>new TransactionalPaymentProjection(new PgPaymentProjection(new ProjectionSqlFixture())),{code:'PROJECTION_NOT_ACTIVATED'});
 }finally{if(old===undefined)Reflect.deleteProperty(process.env,'NODE_ENV');else Reflect.set(process.env,'NODE_ENV',old);}
});

// ---- packages/core/src/payment/production-reconciliation-authority.ts: pure target derivation ----

import {issueProductionReconciliationAuthority,productionReconciliationTarget,deriveProductionReconciliationTarget} from '../../packages/core/src/payment/production-reconciliation-authority';

test('deriveProductionReconciliationTarget: a valid Square PRODUCTION config yields the exact merchant/database facts',()=>{
 assert.deepEqual(deriveProductionReconciliationTarget(validConfig()),{merchantId:'r6c-merchant',database:productionTarget.database});
});
test('deriveProductionReconciliationTarget: the dark/inert profile (flags.payment=false, payment=null) is rejected',()=>{
 // A genuinely validated config for the dark profile (productionConfiguration() itself allows
 // payment:null here, unlike a flags.payment=true config where payment is required) must still
 // not derive a reconciliation target.
 const dark=productionConfiguration({
  schemaVersion:1,capability:'ZAO_PRODUCTION_RUNTIME_V1',
  deployment:{provider:'VERCEL',environment:'production',projectId:FIXTURE_PROJECT,releaseId:'r6c-release',origin:'https://r6c-fixture.invalid'},
  database:{provider:'NEON',environment:'production',host:FIXTURE_HOST,name:productionTarget.database,roles:Object.fromEntries(productionServices.map(s=>[s,'r6c_'+s+'_role']))},
  flags:{booking:false,guestRecovery:false,payment:false,media:false,avatar:false,staffOperations:false},
  guest:guestPolicy,approvedGuestSha256:guestConfigurationHash(guestPolicy),payment:null,media:null,
 });
 assert.equal(deriveProductionReconciliationTarget(dark),null);
});
test('deriveProductionReconciliationTarget: a Sandbox-environment payment binding is rejected',()=>{
 const c=validConfig();
 assert.equal(deriveProductionReconciliationTarget({...c,payment:{...c.payment!,environment:'SANDBOX' as never}}),null);
});
test('deriveProductionReconciliationTarget: a missing merchantId is rejected',()=>{
 const c=validConfig();
 assert.equal(deriveProductionReconciliationTarget({...c,payment:{...c.payment!,merchantId:''}}),null);
});

// ---- production-reconciliation-authority.ts: authority issuance gating (reject paths only) ----

test('issueProductionReconciliationAuthority rejects an undefined identity',()=>{
 assert.throws(()=>issueProductionReconciliationAuthority(undefined as never),{message:'PRODUCTION_RECONCILIATION_AUTHORITY_REQUIRED'});
});
test('issueProductionReconciliationAuthority rejects a hand-built object shaped like an ExactProductionIdentity but never actually issued (WeakMap miss)',()=>{
 assert.throws(()=>issueProductionReconciliationAuthority({kind:'EXACT_PRODUCTION_IDENTITY'} as never),{message:'PRODUCTION_RECONCILIATION_AUTHORITY_REQUIRED'});
});
test('productionReconciliationTarget resolves an absent/forged authority to null, never a default target',()=>{
 assert.equal(productionReconciliationTarget(undefined),null);
 assert.equal(productionReconciliationTarget({kind:'PRODUCTION_RECONCILIATION_AUTHORITY'} as never),null);
});

// ---- packages/db/src/payment-reconciliation.ts: F5 authority-gated *_production routing ----
//
// V4 (TD correction): the previous "with authority, every method routes to the *_production
// function, bound to the authority merchant" and "an authority-holding instance refuses SANDBOX"
// tests required a genuine ProductionReconciliationAuthority, impossible to mint offline. That
// specific TS-repository-class wiring proof is R3_ATTENDED_ACCEPTANCE_REQUIRED; the underlying SQL
// role grants and merchant boundary it would have exercised remain independently proven at the raw
// SQL level in tests/readiness/production-role-plans.ts's R7/R6-A block. The no-authority paths
// below remain fully provable offline and are unchanged.

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
