import {dispatchR15Once} from './r15-operation-guard';
import type {InboxPool} from './square-webhook-inbox';
import {PgPaymentReconciliation} from './payment-reconciliation';
import {PgPaymentProjection} from './payment-projection';
import {TransactionalPaymentProjection,type ProjectionSource,type ProjectionReference} from '../../core/src/payment/payment-projection';
import {PaymentReconciliationWorker,type PaymentTruthProvider} from '../../core/src/payment/payment-reconciliation';
import {r15ProjectionPermit,type R15ProjectionTarget} from '../../core/src/payment/r15-projection-authority';
export type R15WorkerTarget=R15ProjectionTarget&{paymentId:string;locationId:string};
/** No receiver/owner credential and no default transport. Wire only after hosted acceptance gates. */
export function r15HostedComposition(pools:{dispatcher:InboxPool;worker:InboxPool;projector:InboxPool;diagnostic:InboxPool},env:Readonly<Record<string,string|undefined>>,inputTarget:R15WorkerTarget,provider:PaymentTruthProvider,manifestSha256:string){
 if(!/^[a-f0-9]{64}$/.test(manifestSha256))throw new Error('R15_MANIFEST_REQUIRED');
 const target=Object.freeze({...inputTarget});
 const permit=r15ProjectionPermit(env,target),merchantId='MLKDVEDH1ME21';
 if(!/^[A-Za-z0-9_-]{1,100}$/.test(target.paymentId)||!/^[-A-Za-z0-9_]{1,100}$/.test(target.locationId))throw new Error('R15_TARGET_INVALID');
 const scope={merchantId,paymentId:target.paymentId},dispatcher=new PgPaymentReconciliation(pools.dispatcher,scope),worker=new PgPaymentReconciliation(pools.worker,scope),diagnostic=new PgPaymentReconciliation(pools.diagnostic);
 const contexts={async load(claim:Parameters<typeof worker.load>[0]){
  if(claim.environment!=='SANDBOX'||claim.merchantId!==merchantId||claim.paymentId!==target.paymentId)return null;
  const c=await worker.load(claim),e=c?.expected;
  return e?.bookingId===target.bookingId&&e.attemptId===target.attemptId&&e.merchantId===merchantId&&e.locationId===target.locationId&&e.amountJpy===100&&e.currency==='JPY'?c:null;
 }};
 let providerInvoked=false,workerInvoked=false;
 const once:PaymentTruthProvider={async lookupPayment(input){if(providerInvoked)throw new Error('R15_LOOKUP_ALREADY_INVOKED_DO_NOT_RETRY');providerInvoked=true;return dispatchR15Once(pools.worker,{manifestSha256,action:'GET_PAYMENT',bookingId:target.bookingId,attemptId:target.attemptId,idempotencyKey:input.expected.idempotencyKey,locationId:target.locationId,paymentId:target.paymentId},()=>{if(input.signal.aborted)throw new Error('R15_LOOKUP_CANCELLED_NO_RETRY');return provider.lookupPayment(input);});}};
 const engine=new PaymentReconciliationWorker({dispatch:(e,n)=>dispatcher.dispatch(e,n),claimBatch:(e,id,n)=>worker.claimBatch(e,id,n),finalize:(c,o)=>worker.finalize(c,o),diagnostics:(e,n)=>diagnostic.diagnostics(e,n)},contexts,once);
 const project=new TransactionalPaymentProjection(new PgPaymentProjection(pools.projector,async(c,ref)=>(await c.query<{source:ProjectionSource|null}>('SELECT payment_projection.lock_source($1) AS source',[ref.jobId])).rows[0]?.source??null,permit),permit);
 return {async runOnce(){if(workerInvoked)throw new Error('R15_WORKER_ALREADY_INVOKED_DO_NOT_RETRY');workerInvoked=true;return engine.runOnce('SANDBOX','r15-finite',1);},async project(ref:ProjectionReference){return project.project(ref);}};
}
