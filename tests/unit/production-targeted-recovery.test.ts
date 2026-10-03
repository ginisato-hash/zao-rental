import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {Pool} from 'pg';
import {flowHash} from '../../packages/contracts/src/rental-flow';
import {decidePaymentProjection as decide} from '../../packages/core/src/payment/payment-projection';
import {PaymentReconciliationWorker,type PaymentContextReader,type PaymentTruthProvider} from '../../packages/core/src/payment/payment-reconciliation';
import type {PaymentContext} from '../../packages/core/src/payment/payment-truth';
import {recoveryStatements,PgPaymentReconciliation} from '../../packages/db/src/payment-reconciliation';
import {acceptanceOverlay,acceptancePlan,reconcileProductionOne,verifyAcceptanceAttempt,type AcceptanceTarget} from '../../scripts/lib/production-payment-acceptance';
import {productionPaymentActivationGrants} from '../../scripts/production-payment-roles';
import {productionServices,productionConfiguration} from '../../packages/auth/src/production-config';
import {commercialGuestConfiguration,COMMERCIAL_FLAGS} from '../../packages/core/src/guest/production-commercial-composition';
import {guestConfigurationHash} from '../../packages/contracts/src/production-guest';
import {ReconciliationFixture} from '../fixtures/payment-reconciliation';
import {clock,id,stateFixture,observation} from '../fixtures/payment-projection';

const expected={attemptId:id(4),bookingId:id(1),idempotencyKey:id(5),merchantId:'SYNTHETIC-MERCHANT',locationId:'SYNTHETIC-MOUNTAIN',amountJpy:4000,currency:'JPY' as const};
const target:AcceptanceTarget={...expected,paymentId:'synthetic-payment'};
const unboundContext=():PaymentContext=>({expected,current:{state:'UNKNOWN',providerId:null,providerState:null,providerUpdatedAt:null},latest:null});
const completed=()=>({providerId:target.paymentId,referenceId:expected.bookingId,idempotencyKey:expected.idempotencyKey,merchantId:expected.merchantId,locationId:expected.locationId,amountJpy:expected.amountJpy,currency:'JPY' as const,status:'COMPLETED' as const,updatedAt:'2026-09-01T00:00:00.000Z',completedAt:'2026-09-01T00:00:00.000Z'});
function provider(){const calls:string[]=[];const truth:PaymentTruthProvider={async lookupPayment(input){calls.push(input.paymentId);return {kind:'OBSERVED',observation:completed()};}};return {calls,truth};}
async function fixture(){const f=new ReconciliationFixture();f.time=Date.now();await f.receive({environment:'PRODUCTION',eventId:'synthetic-event',type:'payment.updated',merchantId:target.merchantId,paymentId:target.paymentId,bodySha256:'a'.repeat(64)});return f;}
const reader=(context:PaymentContext|null):PaymentContextReader=>({load:async()=>context});

// ---- projection: the lost-response (null providerId) attempt may only bind through CANCELLED_PAYMENT ----
function cancelledState(){
 const s=stateFixture();s.booking.mode='SQUARE_PRODUCTION';s.booking.priceSnapshot={...s.booking.priceSnapshot,chargeReady:true};s.booking.priceHash=flowHash(s.booking.priceSnapshot);
 s.quote!.snapshot=s.booking.priceSnapshot;s.quote!.snapshotHash=s.booking.priceHash;s.quote!.commercialPriceValid=true;
 s.attempt.state='UNKNOWN';s.attempt.providerId=null;return s;
}
test('null attempt providerId on a CANCELLED booking binds only through CANCELLED_PAYMENT after the full matchPayment',()=>{
 const s=cancelledState();s.booking.state='CANCELLED';s.hold!.state='RELEASED';
 const plan=decide(s,observation(),clock);assert.equal(plan.decision,'APPLY_COMPLETED');assert.equal(plan.mutation,'CANCELLED_PAYMENT');
 for(const [field,value] of Object.entries({referenceId:id(90),idempotencyKey:id(91),merchantId:'other',locationId:'other',amountJpy:101,currency:'USD'}))assert.equal(decide(s,{...observation(),[field]:value} as never,clock).decision,'BLOCK_IDENTITY_MISMATCH','mismatch '+field);
 s.attempt.providerId='different-payment';assert.equal(decide(s,observation(),clock).decision,'BLOCK_IDENTITY_MISMATCH');
});
test('null attempt providerId with active HOLD never confirms, reviews or mutates',()=>{
 for(const state of ['PAYMENT_PENDING','PAYMENT_REVIEW'])for(const status of ['COMPLETED','PENDING','FAILED','CANCELED'] as const){
  const s=cancelledState();s.booking.state=state;const before=structuredClone(s);
  const plan=decide(s,observation(status),clock);assert.equal(plan.decision,'BLOCK_IDENTITY_MISMATCH');assert.equal(plan.mutation,'NONE');assert.deepEqual(s,before);
 }
 const bound=cancelledState();bound.attempt.providerId=observation().providerId;assert.equal(decide(bound,observation(),clock).decision,'APPLY_COMPLETED');
});

// ---- worker: unbound candidate is an explicit attended-only admission ----
test('ordinary worker still rejects a null providerId context; the attended candidate admits exactly its own payment',async()=>{
 const none=await fixture(),a=provider();
 const rejected=await new PaymentReconciliationWorker(none,reader(unboundContext()),a.truth).runOnce('PRODUCTION','m3-attended',1);
 assert.equal(rejected.results[0]?.code,'PAYMENT_CONTEXT_MISSING');assert.equal(a.calls.length,0);
 const other=await fixture(),b=provider();
 const wrong=await new PaymentReconciliationWorker(other,reader(unboundContext()),b.truth,undefined,undefined,undefined,{paymentId:'someone-elses-payment'}).runOnce('PRODUCTION','m3-attended',1);
 assert.equal(wrong.results[0]?.code,'PAYMENT_CONTEXT_MISSING');assert.equal(b.calls.length,0);
 const ok=await fixture(),c=provider();
 const result=await new PaymentReconciliationWorker(ok,reader(unboundContext()),c.truth,undefined,undefined,undefined,{paymentId:target.paymentId}).runOnce('PRODUCTION','m3-attended',1);
 assert.equal(result.results[0]?.proposedState,'RECONCILED');assert.equal(result.results[0]?.decision,'ACCEPT_COMPLETED');assert.deepEqual(c.calls,[target.paymentId]);
});
test('operator reconcile: unbound candidate needs the explicit option; a context bound to another payment never reaches the provider',async()=>{
 const without=await fixture(),a=provider();
 assert.equal((await reconcileProductionOne(without,reader(unboundContext()),a.truth,target)).results[0]?.code,'PAYMENT_CONTEXT_MISSING');assert.equal(a.calls.length,0);
 const withOption=await fixture(),b=provider();
 const result=await reconcileProductionOne(withOption,reader(unboundContext()),b.truth,target,{unboundCandidate:true});
 assert.equal(result.results[0]?.proposedState,'RECONCILED');assert.equal(b.calls.length,1);
 const foreign=await fixture(),c=provider(),context=unboundContext();context.current.providerId='another-payment';
 await reconcileProductionOne(foreign,reader(context),c.truth,target,{unboundCandidate:true});assert.equal(c.calls.length,0);
 const mismatched=await fixture(),d=provider();
 await reconcileProductionOne(mismatched,reader({...unboundContext(),expected:{...expected,amountJpy:1}}),d.truth,target,{unboundCandidate:true});assert.equal(d.calls.length,0);
});

// ---- operator attempt binding ----
const attemptPool=(patch:Record<string,unknown>)=>({query:async()=>({rows:[{...target,mode:'SQUARE_PRODUCTION',bookingState:'PAYMENT_PENDING',...patch}]})}) as unknown as Pool;
test('persisted attempt needs CANCELLED or an exact expired HOLD, and never binds another payment',async()=>{
 await verifyAcceptanceAttempt(attemptPool({}),target);
 await verifyAcceptanceAttempt(attemptPool({paymentId:null,bookingState:'CANCELLED'}),target);
 for(const bookingState of ['PAYMENT_PENDING','PAYMENT_REVIEW'])await verifyAcceptanceAttempt(attemptPool({paymentId:null,bookingState,expiredUnboundCandidate:true}),target);
 await assert.rejects(verifyAcceptanceAttempt(attemptPool({paymentId:null}),target),/M3_UNBOUND_PAYMENT_REQUIRES_CANCELLED_BOOKING/);
 await assert.rejects(verifyAcceptanceAttempt(attemptPool({paymentId:null,bookingState:'PAYMENT_REVIEW'}),target),/M3_UNBOUND_PAYMENT_REQUIRES_CANCELLED_BOOKING/);
 for(const patch of [{paymentId:'OTHER'},{mode:'SQUARE_SANDBOX'},{amountJpy:1},{idempotencyKey:id(90)},{merchantId:'OTHER'},{locationId:'OTHER'}])await assert.rejects(verifyAcceptanceAttempt(attemptPool({paymentId:null,bookingState:'CANCELLED',...patch}),target),/M3_TARGET_REJECTED/);
});

// ---- targeted statements and role grants ----
test('targeted statements are exact, parameterised and Production-only',()=>{
 const r={attemptId:id(4),bookingId:id(1),paymentId:'synthetic-payment'};
 assert.deepEqual(recoveryStatements.dispatch('M',r),{text:'SELECT payment_reconciliation.dispatch_target_production($1,$2) AS n',values:['M','synthetic-payment']});
 assert.deepEqual(recoveryStatements.claim('m3-attended','M',r),{text:'SELECT payment_reconciliation.claim_target_production($1,$2,$3) AS claim',values:['m3-attended','M','synthetic-payment']});
 assert.deepEqual(recoveryStatements.load('M','synthetic-payment',r),{text:'SELECT payment_reconciliation.load_context_target_production($1,$2,$3,$4) AS context',values:[id(4),id(1),'M','synthetic-payment']});
 for(const statement of [recoveryStatements.dispatch('M',r),recoveryStatements.claim('o','M',r),recoveryStatements.load('M','p',r)]){assert.ok(!/SANDBOX|generic/i.test(statement.text));assert.ok(/_target_production\(/.test(statement.text));}
});
test('recovery mode requires the Production authority capability',()=>{
 const pool={connect:async()=>{throw Error('NO_IO');}} as never;
 assert.throws(()=>new PgPaymentReconciliation(pool,undefined,undefined,{attemptId:id(4),bookingId:id(1),paymentId:'p'}),/PRODUCTION_RECONCILIATION_AUTHORITY_REQUIRED/);
});
test('role grant plan gives dispatch only to the dispatcher and claim/context only to the truth worker',()=>{
 const grants=productionPaymentActivationGrants('neondb').filter(g=>g.includes('_target_production'));
 assert.deepEqual(grants,[
  'GRANT EXECUTE ON FUNCTION payment_reconciliation.dispatch_target_production(text,text) TO neondb_pay_dispatch',
  'GRANT EXECUTE ON FUNCTION payment_reconciliation.claim_target_production(text,text,text),payment_reconciliation.load_context_target_production(uuid,uuid,text,text) TO neondb_pay_truth',
 ]);
 assert.ok(!productionPaymentActivationGrants('neondb').some(g=>/ TO .*PUBLIC/.test(g)));
});

// ---- non-secret execution plan overlay ----
const configuration=()=>{const guest=commercialGuestConfiguration();return productionConfiguration({schemaVersion:1,capability:'ZAO_PRODUCTION_RUNTIME_V1',deployment:{provider:'VERCEL',environment:'production',projectId:'synthetic-project',releaseId:'a'.repeat(40),origin:'https://zao-rental.vercel.app'},database:{provider:'NEON',environment:'production',host:'ep-synthetic-fixture.ap-southeast-1.aws.neon.tech',name:'neondb',roles:Object.fromEntries(productionServices.map(s=>[s,'neondb_'+s]))},flags:COMMERCIAL_FLAGS,guest,approvedGuestSha256:guestConfigurationHash(guest),payment:{provider:'SQUARE',environment:'PRODUCTION',merchantId:expected.merchantId,locations:{MOUNTAIN_BASE:expected.locationId,ONSEN_BASE:'SYNTHETIC-ONSEN'},webhookNotificationUrl:'https://zao-rental-webhook-production.vercel.app/api/webhooks/square'},media:null});};
const base=()=>({releaseId:'a'.repeat(40),tree:'b'.repeat(40),configuration:configuration(),databaseUrls:{},square:{accessToken:'synthetic-only-token-000000',expiresAt:'never'},target:null,reference:null,jobId:null,refund:null});
const plan=(patch:Record<string,unknown>={})=>({releaseId:'c'.repeat(40),tree:'d'.repeat(40),target,reference:null,jobId:null,refund:null,...patch});
test('overlay replaces only the six execution facts and the deployment release; everything else is the immutable secure input',()=>{
 const secure=base(),snapshot=JSON.stringify(secure),merged=acceptanceOverlay(secure,plan()) as ReturnType<typeof base>;
 assert.equal(JSON.stringify(secure),snapshot);
 assert.equal(merged.releaseId,'c'.repeat(40));assert.equal(merged.tree,'d'.repeat(40));assert.deepEqual(merged.target,target);
 assert.equal(merged.configuration.deployment.releaseId,'c'.repeat(40));
 const unchanged=(x:ReturnType<typeof base>)=>JSON.stringify({...x,releaseId:0,tree:0,target:0,reference:0,jobId:0,refund:0,configuration:{...x.configuration,deployment:{...x.configuration.deployment,releaseId:0}}});
 assert.equal(unchanged(merged),unchanged(secure));
 assert.equal(acceptancePlan(merged).input.target?.paymentId,target.paymentId);
});
test('overlay rejects secrets, identity overrides, unknown fields, malformed release and a pre-populated secure target',()=>{
 for(const extra of [{databaseUrls:{}},{square:{accessToken:'x',expiresAt:'never'}},{configuration:{}},{deployment:{}},{password:'x'},{origin:'https://example.invalid'}])assert.throws(()=>acceptanceOverlay(base(),{...plan(),...extra}),/INVALID_INPUT/);
 const missing:Record<string,unknown>={...plan()};delete missing.refund;assert.throws(()=>acceptanceOverlay(base(),missing),/INVALID_INPUT/);
 for(const patch of [{releaseId:'short'},{tree:'Z'.repeat(40)},{releaseId:null}])assert.throws(()=>acceptanceOverlay(base(),plan(patch)),/M3_PLAN_REJECTED/);
 for(const field of ['target','reference','jobId','refund'])assert.throws(()=>acceptanceOverlay({...base(),[field]:field==='jobId'?id(9):{}},plan()),/M3_PLAN_REJECTED/);
 assert.throws(()=>acceptancePlan(acceptanceOverlay(base(),plan({target:{...target,locationId:'OTHER'}}))),/M3_TARGET_REJECTED/);
 assert.throws(()=>acceptancePlan(acceptanceOverlay(base(),plan({target:{...target,merchantId:'OTHER'}}))),/M3_TARGET_REJECTED/);
});
