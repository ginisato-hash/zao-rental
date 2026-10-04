import {flowHash,flowObject,type PaymentObservation} from '../../../contracts/src/rental-flow';
import type {PaymentReconciliationWorker} from './payment-reconciliation';
import type {ProjectionReference,ProjectionResult} from './payment-projection';
import type {BookingNotificationWorker} from '../notification/worker';
import type {CancellationRefundWorker} from './cancellation-refund-worker';

export type NormalWorkerPlan={workerId:string;acceptedBookingsAfter:string;deadline:string;batchSize:number;notificationLimit:number;refundCreateLimit:number;refundBudgetJpy:number};
export type NormalProjectionCandidate=ProjectionReference&{paymentId:string;observation:PaymentObservation};
export function normalWorkerPlan(raw:unknown,now=Date.now()):NormalWorkerPlan{
 const p=flowObject(raw,['workerId','acceptedBookingsAfter','deadline','batchSize','notificationLimit','refundCreateLimit','refundBudgetJpy']) as unknown as NormalWorkerPlan;
 if(!/^[-A-Za-z0-9_]{1,100}$/.test(p.workerId)||!Number.isFinite(Date.parse(p.acceptedBookingsAfter))||Date.parse(p.acceptedBookingsAfter)<Date.parse('2026-10-03T09:14:39Z')||Date.parse(p.acceptedBookingsAfter)>now||!Number.isFinite(Date.parse(p.deadline))||Date.parse(p.deadline)<=now||Date.parse(p.deadline)>now+60000)throw Error('NORMAL_WORKER_WINDOW_REJECTED');
 for(const [k,min,max] of [['batchSize',1,20],['notificationLimit',0,20],['refundCreateLimit',0,20],['refundBudgetJpy',0,100000000]] as const)if(!Number.isSafeInteger(p[k])||p[k]<min||p[k]>max)throw Error('NORMAL_WORKER_BATCH_REJECTED');
 return Object.freeze({...p});
}
export function normalProjectionReference(candidate:NormalProjectionCandidate):ProjectionReference{
 return {bookingId:candidate.bookingId,attemptId:candidate.attemptId,jobId:candidate.jobId,truthRevision:candidate.truthRevision,truthFingerprint:candidate.truthFingerprint,observationFingerprint:flowHash(candidate.observation),expectedRevision:candidate.expectedRevision};
}
export type NormalWorkerPorts={
 reconciliation:Pick<PaymentReconciliationWorker,'runOnce'>;
 candidates:(limit:number)=>Promise<NormalProjectionCandidate[]>;
 project:(candidate:NormalProjectionCandidate)=>Promise<ProjectionResult>;
 notifications:Pick<BookingNotificationWorker,'runBatch'>|null;
 refunds:Pick<CancellationRefundWorker,'dispatch'|'reconcile'>|null;
 refundCandidates:(limit:number)=>Promise<{id:string;amount_jpy:number;provider_id:string|null;dispatched_at:unknown;state:string}[]>;
 close:()=>Promise<void>;
};
/** One finite tick. Durable claims/truth/receipts remain authority; no queue rewrite or retry loop. */
export async function runNormalProductionTick(plan:NormalWorkerPlan,ports:NormalWorkerPorts){
 const active=()=>Date.now()<Date.parse(plan.deadline);let projected=0,deferred=0,refundCreates=0,refundLookups=0,refundJpy=0;
 try{
  normalWorkerPlan(plan);
  const reconciliation=await ports.reconciliation.runOnce('PRODUCTION',plan.workerId,plan.batchSize,active);
  if(reconciliation.results.some(r=>'code' in r&&['AUTH_BLOCKED','RATE_LIMITED'].includes(r.code??'')))return {state:'PROVIDER_STOP',reconciliation,projected,refundCreates,refundLookups};
  for(const candidate of active()?await ports.candidates(plan.batchSize):[]){if(!active())break;
   try{await ports.project(candidate);projected++;}catch(e){if((e as {code?:string}).code==='STALE_PROJECTION_REVISION'){deferred++;continue;}throw e;}
  }
  if(ports.refunds)for(const r of active()?await ports.refundCandidates(plan.batchSize):[]){if(!active())break;
   // UNKNOWN without a provider ID remains durable history; it cannot be re-POSTed or looked up.
   if(r.dispatched_at!==null&&r.dispatched_at!==undefined){if(r.provider_id){await ports.refunds.reconcile(r.id);refundLookups++;}continue;}
   if(r.state==='PENDING'&&refundCreates<plan.refundCreateLimit&&refundJpy+Number(r.amount_jpy)<=plan.refundBudgetJpy){await ports.refunds.dispatch(r.id);refundCreates++;refundJpy+=Number(r.amount_jpy);}
  }
  const notifications=ports.notifications&&active()?await ports.notifications.runBatch({since:plan.acceptedBookingsAfter,limit:plan.notificationLimit,deadline:new Date(plan.deadline)}):{state:'NOT_RUN',processed:0};
  return {state:'COMPLETED',reconciliation,projected,deferred,refundCreates,refundLookups,refundJpy,notifications};
 }finally{await ports.close();}
}
