import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {Pool} from 'pg';
import {SquareProductionPaymentTruth} from '../../packages/core/src/payment/square-payment-truth';
import {FetchSquareProductionTransport} from '../../packages/core/src/payment/square-transport';
import {SQUARE_PRODUCTION_ORIGIN,SQUARE_VERSION,type SquareCall} from '../../packages/core/src/payment/square-engine';
import {acceptancePlan,acceptanceRelease,acceptanceDatabaseConfig,verifyAcceptanceRole,verifyAcceptanceAttempt,reconcileProductionOne,refundNextAction,runProductionPaymentAcceptance,type AcceptanceInput} from '../../scripts/lib/production-payment-acceptance';
import {productionServices,productionConfiguration} from '../../packages/auth/src/production-config';
import {commercialGuestConfiguration,COMMERCIAL_FLAGS} from '../../packages/core/src/guest/production-commercial-composition';
import {guestConfigurationHash} from '../../packages/contracts/src/production-guest';
import type {PaymentContext} from '../../packages/core/src/payment/payment-truth';
import type {PaymentTruthProvider} from '../../packages/core/src/payment/payment-reconciliation';
import {boundedLookup} from '../../packages/core/src/payment/payment-reconciliation';
import {ReconciliationFixture} from '../fixtures/payment-reconciliation';
import {id,sourceFixture,reference,clock} from '../fixtures/payment-projection';
import {verifyProjectionSource} from '../../packages/core/src/payment/payment-projection';

const expected={attemptId:id(4),bookingId:id(1),idempotencyKey:id(5),merchantId:'SYNTHETIC-MERCHANT',locationId:'SYNTHETIC-MOUNTAIN',amountJpy:4000,currency:'JPY' as const};
const target={...expected,paymentId:'synthetic-payment'};
const rawPayment=()=>({id:target.paymentId,reference_id:expected.bookingId,location_id:expected.locationId,amount_money:{amount:4000,currency:'JPY'},status:'COMPLETED',updated_at:'2026-09-01T00:00:00.000Z',card_details:{card:{last_4:'1111'},card_payment_timeline:{captured_at:'2026-09-01T00:00:00.000Z'}}});
const input=()=>({environment:'PRODUCTION' as const,paymentId:target.paymentId,expected,signal:new AbortController().signal});
function adapter(status=200,body:unknown={payment:rawPayment()},send?:(call:SquareCall)=>Promise<{status:number;body:unknown}>){const calls:SquareCall[]=[];return {calls,truth:new SquareProductionPaymentTruth({environment:'PRODUCTION',merchantId:expected.merchantId,locationId:expected.locationId,async send(call){calls.push(call);return send?send(call):{status,body};}})};}
const configuration=()=>{const guest=commercialGuestConfiguration();return productionConfiguration({schemaVersion:1,capability:'ZAO_PRODUCTION_RUNTIME_V1',deployment:{provider:'VERCEL',environment:'production',projectId:'synthetic-project',releaseId:'a'.repeat(40),origin:'https://zao-rental.vercel.app'},database:{provider:'NEON',environment:'production',host:'ep-synthetic-fixture.ap-southeast-1.aws.neon.tech',name:'neondb',roles:Object.fromEntries(productionServices.map(s=>[s,'neondb_'+s]))},flags:COMMERCIAL_FLAGS,guest,approvedGuestSha256:guestConfigurationHash(guest),payment:{provider:'SQUARE',environment:'PRODUCTION',merchantId:expected.merchantId,locations:{MOUNTAIN_BASE:expected.locationId,ONSEN_BASE:'SYNTHETIC-ONSEN'}},media:null});};
const manifest=():AcceptanceInput=>({releaseId:'a'.repeat(40),tree:'b'.repeat(40),configuration:configuration(),databaseUrls:{},square:{accessToken:'synthetic-only-token-000000',expiresAt:'never'},target,reference:null,jobId:null,refund:null});

test('Production truth: exact GET, version, payment/reference/amount/location and sanitized observation',async()=>{
 const {truth,calls}=adapter();const result=await truth.lookupPayment(input());assert.equal(result.kind,'OBSERVED');
 assert.deepEqual(calls.map(c=>({method:c.method,url:c.url,version:c.version,body:c.body})),[{method:'GET',url:SQUARE_PRODUCTION_ORIGIN+'/v2/payments/'+target.paymentId,version:'2026-08-19',body:undefined}]);
 assert.equal(SQUARE_VERSION,'2026-08-19');assert.ok(!JSON.stringify(result).includes('card_details'));assert.ok(!JSON.stringify(result).includes('1111'));
 if(result.kind==='OBSERVED')assert.equal(result.observation.idempotencyKey,expected.idempotencyKey);
});
test('Sandbox environment/transport, wrong merchant/location/currency/idempotency and hostile payment ID reject before I/O',async()=>{
 for(const patch of [{environment:'SANDBOX'},{expected:{...expected,merchantId:'OTHER'}},{expected:{...expected,locationId:'OTHER'}},{expected:{...expected,currency:'USD'}},{expected:{...expected,idempotencyKey:'bad'}},{paymentId:'../refunds'}]){const a=adapter();assert.deepEqual(await a.truth.lookupPayment({...input(),...patch} as never),{kind:'FAILED',code:'EVIDENCE_MISMATCH_BLOCKED'});assert.equal(a.calls.length,0);}
 const truth=new SquareProductionPaymentTruth({environment:'SANDBOX',merchantId:expected.merchantId,locationId:expected.locationId,send:async()=>{throw Error('UNREACHABLE');}} as never);assert.equal((await truth.lookupPayment(input())).kind,'FAILED');
});
for(const [field,value] of Object.entries({id:'wrong-id',merchant_id:'OTHER',idempotency_key:id(99),reference_id:id(99),location_id:'OTHER',amount_money:{amount:1,currency:'JPY'},updated_at:'invalid',card_details:{},status:'UNKNOWN'}))test('Production provider mismatch: '+field,async()=>{const a=adapter(200,{payment:{...rawPayment(),[field]:value}});assert.equal((await a.truth.lookupPayment(input())).kind,'FAILED');assert.equal(a.calls.length,1);});
for(const [status,code] of [[401,'AUTH_BLOCKED'],[403,'AUTH_BLOCKED'],[429,'RATE_LIMITED'],[404,'NOT_FOUND_BLOCKED'],[500,'PROVIDER_5XX_RETRYABLE'],[503,'PROVIDER_5XX_RETRYABLE'],[302,'INVALID_RESPONSE_BLOCKED']] as const)test('Production lookup HTTP '+status,async()=>{const a=adapter(status);assert.deepEqual(await a.truth.lookupPayment(input()),{kind:'FAILED',code});});
test('malformed JSON through actual Production transport is blocked; network remains retryable',async()=>{
 const make=(fetch:ConstructorParameters<typeof FetchSquareProductionTransport>[3])=>new SquareProductionPaymentTruth(new FetchSquareProductionTransport(expected.merchantId,expected.locationId,async()=>({environment:'PRODUCTION',merchantId:expected.merchantId,locationId:expected.locationId,accessToken:'synthetic-only-token-000000',expiresAt:null,revoked:false}),fetch));
 for(const body of ['not-json','{}'])assert.deepEqual(await make(async()=>new Response(body,{headers:{'Content-Type':'application/json'}})).lookupPayment(input()),{kind:'FAILED',code:'INVALID_RESPONSE_BLOCKED'});
 assert.deepEqual(await make(async()=>{throw TypeError('SYNTHETIC_PRIVATE_TOKEN_MUST_NOT_ESCAPE');}).lookupPayment(input()),{kind:'FAILED',code:'NETWORK_RETRYABLE'});
 const slow=make(async(_url,init)=>new Promise((_resolve,reject)=>init.signal!.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true})));
 await assert.rejects(boundedLookup(signal=>slow.lookupPayment({...input(),signal}),5));
});
test('exact clean HEAD/main/tree/release required; wrong identity fails before any provider/DB connection',async()=>{
 const m=manifest(),facts={head:m.releaseId,tree:m.tree,main:m.releaseId,clean:true};acceptanceRelease(m,facts);
 for(const patch of [{head:'c'.repeat(40)},{main:'c'.repeat(40)},{tree:'c'.repeat(40)},{clean:false}])assert.throws(()=>acceptanceRelease(m,{...facts,...patch}),/M3_RELEASE_IDENTITY_REJECTED/);
 await assert.rejects(runProductionPaymentAcceptance('preflight',m,async()=>{throw Error('NO_IO');}),/PRODUCTION_IDENTITY_WRONG_VERCEL_PROJECT/);
 assert.throws(()=>acceptancePlan({...m,configuration:{...configuration(),deployment:{...configuration().deployment,releaseId:'c'.repeat(40)}}}),/M3_RELEASE_IDENTITY_REJECTED/);
});
test('role binding requires dedicated exact DB/role/host/TLS and rejects owner or ordinary role substitution',async()=>{
 const c=configuration();const uri=(user='neondb_pay_truth',database='neondb',host=c.database.host)=>'postgresql:'+'//'+user+':synthetic-password-0001@'+host+'/'+database+'?sslmode=verify-full';
 assert.equal(acceptanceDatabaseConfig(c,'worker',uri()).user,'neondb_pay_truth');
 for(const u of [uri('neondb_owner'),uri('neondb_auth'),uri('neondb_pay_dispatch'),uri('neondb_pay_truth','anotherdb'),uri('neondb_pay_truth','neondb','ep-wrong.neon.tech'),uri().replace('verify-full','require')])assert.throws(()=>acceptanceDatabaseConfig(c,'worker',u),/M3_DATABASE_ROLE_REJECTED/);
 const fake={query:async()=>({rows:[{db:'neondb',role:'neondb_owner'}]})} as unknown as Pool;
 await assert.rejects(verifyAcceptanceRole(fake,c,'worker'),/M3_DATABASE_ROLE_REJECTED/);
});
test('role preflight detects missing Production EXECUTE and leaked generic function privilege',async()=>{
 for(const [allowed,forbidden,pass] of [[true,false,true],[false,false,false],[true,true,false]]){
  const pool={query:async(sql:string)=>({rows:[sql.includes('bool_and')?{allowed}:sql.includes(' forbidden')?{forbidden}:{db:'neondb',role:'neondb_pay_truth',membership:false}]})} as unknown as Pool;
  if(pass)await verifyAcceptanceRole(pool,configuration(),'worker');else await assert.rejects(verifyAcceptanceRole(pool,configuration(),'worker'),/M3_DATABASE_GRANTS_REJECTED/);
 }
});
test('persisted attempt binding rejects Sandbox and wrong tuple even before duplicate projection replay',async()=>{
 for(const patch of [{},{mode:'SQUARE_SANDBOX'},{paymentId:'OTHER'},{amountJpy:1},{idempotencyKey:id(90)}]){
  const pool={query:async()=>({rows:[{...target,mode:'SQUARE_PRODUCTION',...patch}]})} as unknown as Pool;
  if(Object.keys(patch).length)await assert.rejects(verifyAcceptanceAttempt(pool,target),/M3_TARGET_REJECTED/);else await verifyAcceptanceAttempt(pool,target);
 }
});
async function fixture(){const f=new ReconciliationFixture();f.time=Date.now();await f.receive({environment:'PRODUCTION',eventId:'synthetic-event',type:'payment.updated',merchantId:target.merchantId,paymentId:target.paymentId,bodySha256:'a'.repeat(64)});return f;}
function context():PaymentContext{return {expected,current:{state:'PENDING',providerId:target.paymentId,providerState:null,providerUpdatedAt:null},latest:null};}
test('finite operator processes one logical claim with one GET and preserves duplicate replay',async()=>{
 const f=await fixture(),a=adapter();const result=await reconcileProductionOne(f,{load:async()=>context()},a.truth,target);
 assert.equal(result.dispatched,1);assert.equal(result.claimed,1);assert.equal(result.results[0]?.proposedState,'RECONCILED');assert.equal(a.calls.length,1);assert.equal(a.calls[0]?.method,'GET');
 const replay=await reconcileProductionOne(f,{load:async()=>context()},a.truth,target);assert.equal(replay.claimed,0);assert.equal(a.calls.length,1);
});
test('Sandbox/wrong merchant/wrong payment claims rejected and mismatched persisted context never invokes provider',async()=>{
 for(const patch of [{environment:'SANDBOX' as const},{merchantId:'OTHER'},{paymentId:'OTHER'}]){const f=await fixture();const original=f.claimBatch.bind(f);f.claimBatch=async(...args)=>(await original(...args)).map(c=>({...c,...patch}));const a=adapter();await assert.rejects(reconcileProductionOne(f,{load:async()=>context()},a.truth,target),/M3_CLAIM_TARGET_REJECTED/);assert.equal(a.calls.length,0);}
 const f=await fixture(),a=adapter();await reconcileProductionOne(f,{load:async()=>({...context(),expected:{...expected,amountJpy:1}})},a.truth,target);assert.equal(a.calls.length,0);
});
test('provider errors cannot leak secrets into operator evidence',async()=>{
 const f=await fixture();const provider:PaymentTruthProvider={lookupPayment:async()=>{throw Error('SYNTHETIC_PRIVATE_TOKEN_MUST_NOT_ESCAPE');}};
 const result=await reconcileProductionOne(f,{load:async()=>context()},provider,target);assert.equal(result.results[0]?.code,'INVALID_RESPONSE_BLOCKED');assert.ok(!JSON.stringify(result).includes('SYNTHETIC_PRIVATE_TOKEN'));
});
test('projection input requires all seven exact references and no caller provider observation',()=>{
 const m=manifest(),source={...sourceFixture(),environment:'PRODUCTION'};verifyProjectionSource(reference(source),source,clock,'PRODUCTION');
 assert.throws(()=>verifyProjectionSource({...reference(source),truthRevision:2},source,clock,'PRODUCTION'),/PROJECTION_SOURCE_NOT_ACCEPTED/);
 assert.throws(()=>verifyProjectionSource(reference(source),{...source,environment:'SANDBOX'},clock,'PRODUCTION'),/PROJECTION_SOURCE_NOT_ACCEPTED/);
 assert.throws(()=>acceptancePlan({...m,reference:{...reference(),observation:rawPayment()}}),/INVALID_INPUT/);
 assert.throws(()=>acceptancePlan({...m,reference:{...reference(),jobId:undefined}}),/INVALID_ID/);
});
test('refund UNKNOWN never POSTs again; provider ID permits only lookup; initial create requires authorization',()=>{
 assert.equal(refundNextAction({state:'UNKNOWN',dispatched_at:'2026-09-01',provider_id:null},true),'MANUAL_RECONCILIATION_REQUIRED');
 assert.equal(refundNextAction({state:'UNKNOWN',dispatched_at:null,provider_id:null},true),'MANUAL_RECONCILIATION_REQUIRED');
 assert.equal(refundNextAction({state:'UNKNOWN',dispatched_at:'2026-09-01',provider_id:'synthetic-refund'},true),'LOOKUP');
 assert.equal(refundNextAction({state:'PENDING',dispatched_at:'2026-09-01',provider_id:'synthetic-refund'},true),'LOOKUP');
 assert.equal(refundNextAction({state:'PENDING',dispatched_at:null,provider_id:'synthetic-refund'},true),'LOOKUP');
 assert.throws(()=>refundNextAction({state:'PENDING',dispatched_at:null,provider_id:null},false),/M3_LIVE_REFUND_AUTHORIZATION_REQUIRED/);
 assert.equal(refundNextAction({state:'PENDING',dispatched_at:null,provider_id:null},true),'CREATE');
 assert.equal(refundNextAction({state:'COMPLETED',dispatched_at:'2026-09-01',provider_id:'synthetic-refund'},true),'TERMINAL');
});
