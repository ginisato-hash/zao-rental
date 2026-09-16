import type {InboxPool} from './square-webhook-inbox';
import {PgSquareWebhookInbox} from './square-webhook-inbox';
import {PgPaymentReconciliation} from './payment-reconciliation';
import {PgPaymentProjection} from './payment-projection';
import {TransactionalPaymentProjection,type ProjectionSource,type ProjectionReference} from '../../core/src/payment/payment-projection';
import {PaymentReconciliationWorker,type PaymentTruthProvider} from '../../core/src/payment/payment-reconciliation';
import {squareWebhookReceiver,type SquareWebhookConfiguration} from '../../core/src/payment/square-webhook-receiver';
import {flowId} from '../../contracts/src/rental-flow';
/** Injected role-separated development composition. Not imported by production/Next.js. No default HTTP. */
export function developmentPaymentComposition(pools:{receiver:InboxPool;dispatcher:InboxPool;worker:InboxPool;projector:InboxPool;diagnostic:InboxPool},config:SquareWebhookConfiguration,target:{bookingId:string;attemptId:string;paymentId:string},provider:PaymentTruthProvider,now:()=>Date=()=>new Date()){
 if(process.env.NODE_ENV==='production'||config.environment!=='SANDBOX'||!/^[-A-Za-z0-9_]{1,100}$/.test(target.paymentId))throw new Error('R14_DEVELOPMENT_ONLY');flowId(target.bookingId);flowId(target.attemptId);
 const receipt=new PgSquareWebhookInbox(pools.receiver),dispatch=new PgPaymentReconciliation(pools.dispatcher,{merchantId:config.merchantId,paymentId:target.paymentId}),worker=new PgPaymentReconciliation(pools.worker,{merchantId:config.merchantId,paymentId:target.paymentId}),diagnostic=new PgPaymentReconciliation(pools.diagnostic);
 const scoped={async load(c:Parameters<typeof worker.load>[0]){if(c.merchantId!==config.merchantId||c.paymentId!==target.paymentId)return null;const value=await worker.load(c);return value?.expected.bookingId===target.bookingId&&value.expected.attemptId===target.attemptId?value:null;}};
 const reconcile=new PaymentReconciliationWorker({dispatch:(e,n)=>dispatch.dispatch(e,n),claimBatch:(e,id,n)=>worker.claimBatch(e,id,n),finalize:(c,o)=>worker.finalize(c,o),diagnostics:(e,n)=>diagnostic.diagnostics(e,n)},scoped,provider,now,()=>0.5);
 const project=new TransactionalPaymentProjection(new PgPaymentProjection(pools.projector,async(c,ref)=>(await c.query<{source:ProjectionSource|null}>('SELECT payment_projection.lock_source($1) AS source',[ref.jobId])).rows[0]?.source??null));
 return {receive:squareWebhookReceiver(config,()=>({receive(e){if(e.paymentId!==target.paymentId)throw new Error('R14_TARGET_MISMATCH');return receipt.receive(e);}})),async runOnce(){return reconcile.runOnce('SANDBOX','r14-finite',1);},async project(ref:ProjectionReference){if(ref.bookingId!==target.bookingId||ref.attemptId!==target.attemptId)throw new Error('R14_TARGET_MISMATCH');return project.project(ref);},async diagnostics(){return diagnostic.diagnostics('SANDBOX',10);}};
}
