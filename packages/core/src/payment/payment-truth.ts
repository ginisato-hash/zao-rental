import {flowHash,matchPayment,type PaymentObservation,type PaymentRequest} from '../../../contracts/src/rental-flow';
export type KnowledgeState='SUBMITTING'|'UNKNOWN'|'PENDING'|'COMPLETED'|'FAILED'|'REVIEW';
export type PaymentContext={expected:PaymentRequest;current:{state:KnowledgeState;providerId:string|null;providerState:PaymentObservation['status']|null;providerUpdatedAt:string|null};latest:PaymentObservation|null};
export const decisions=['ACCEPT_PENDING','ACCEPT_COMPLETED','ACCEPT_FAILED','ACCEPT_CANCELED','NOOP_DUPLICATE','NOOP_STALE','NOOP_TERMINAL','BLOCKED_EVIDENCE_MISMATCH','BLOCKED_INVALID_TRANSITION'] as const;
export type TruthDecision=typeof decisions[number];
export type TruthResult={decision:TruthDecision;fingerprint:string;contextFingerprint:string;observation:PaymentObservation|null;businessApply:'NOT_ACTIVATED'};
/** Copy only the existing PaymentObservation contract, never retain arbitrary provider fields. */
export function cleanObservation(value:PaymentObservation):PaymentObservation{
 return {providerId:value.providerId,referenceId:value.referenceId,idempotencyKey:value.idempotencyKey,merchantId:value.merchantId,locationId:value.locationId,amountJpy:value.amountJpy,currency:value.currency,status:value.status,updatedAt:new Date(value.updatedAt).toISOString(),completedAt:value.completedAt===null?null:new Date(value.completedAt).toISOString()};
}
export function contextFingerprint(context:PaymentContext){return flowHash({expected:context.expected,current:context.current,latest:context.latest});}
/** No booking/stock/price writes. ACCEPT_COMPLETED is a proposal, never confirmation authority. */
export function decidePaymentTruth(context:PaymentContext,paymentId:string,candidate:unknown,now:Date):TruthResult{
 const ctx=contextFingerprint(context);
 const result=(decision:TruthDecision,observation:PaymentObservation|null):TruthResult=>({decision,observation,contextFingerprint:ctx,fingerprint:flowHash({engine:'payment-truth-v1',contextFingerprint:ctx,paymentId,decision,observation}),businessApply:'NOT_ACTIVATED'});
 let o:PaymentObservation;let latest:PaymentObservation|null=null;
 try{
  const input=candidate as PaymentObservation;matchPayment(context.expected,input);
  if(context.expected.currency!=='JPY'||context.expected.amountJpy<1||!Number.isFinite(now.getTime())||input.providerId!==paymentId||context.current.providerId&&context.current.providerId!==paymentId)throw new Error();
  if(input.status!=='COMPLETED'&&input.completedAt!==null||Date.parse(input.updatedAt)>now.getTime()||input.completedAt!==null&&Date.parse(input.completedAt)>Date.parse(input.updatedAt))throw new Error();
  o=cleanObservation(input);
  if(context.latest){matchPayment(context.expected,context.latest);if(context.latest.providerId!==paymentId||Date.parse(context.latest.updatedAt)>now.getTime()||context.latest.status!=='COMPLETED'&&context.latest.completedAt!==null)throw new Error();latest=cleanObservation(context.latest);}
 }catch{return result('BLOCKED_EVIDENCE_MISMATCH',null);}
 const previousTime=Math.max(latest?Date.parse(latest.updatedAt):-Infinity,context.current.providerUpdatedAt?Date.parse(context.current.providerUpdatedAt):-Infinity);
 if(Number.isNaN(previousTime))return result('BLOCKED_EVIDENCE_MISMATCH',null);
 if(Date.parse(o.updatedAt)<previousTime)return result('NOOP_STALE',o);
 if((context.current.state==='FAILED'||['FAILED','CANCELED'].includes(context.current.providerState??''))&&o.status==='COMPLETED')return result('BLOCKED_INVALID_TRANSITION',o);
 if(latest&&flowHash(o)===flowHash(latest))return result('NOOP_DUPLICATE',o);
 // Same timestamp can legitimately PENDING->COMPLETED (existing BookingService fixtures).
 // Terminal protection still applies; never infer order from event receipt time.
 const terminal=context.current.state==='COMPLETED'?'COMPLETED':context.current.providerState==='FAILED'||context.current.providerState==='CANCELED'?context.current.providerState:context.current.state==='FAILED'?'FAILED':latest&&latest.status!=='PENDING'?latest.status:null;
 if(terminal){
  if(terminal==='COMPLETED'||o.status!=='COMPLETED')return result('NOOP_TERMINAL',o);
  return result('BLOCKED_INVALID_TRANSITION',o);
 }
 return result(('ACCEPT_'+o.status) as TruthDecision,o);
}
export const lookupFailures=['AUTH_BLOCKED','RATE_LIMITED','NETWORK_RETRYABLE','PROVIDER_5XX_RETRYABLE','NOT_FOUND_BLOCKED','INVALID_RESPONSE_BLOCKED','EVIDENCE_MISMATCH_BLOCKED','PAYMENT_CONTEXT_MISSING','ATTEMPTS_EXHAUSTED','DEADLINE_EXCEEDED'] as const;
export type LookupFailure=typeof lookupFailures[number];
export const reconciliationPolicy=Object.freeze({maxAttempts:5,maxAgeSeconds:86400,leaseSeconds:60,lookupTimeoutMs:5000,maxBatch:20,maxBackoffSeconds:300});
/** Technical retry budget only; does not change HOLD/booking TTL or payment idempotency. */
export function retryDelaySeconds(attempt:number,jitter:number){
 if(!Number.isInteger(attempt)||attempt<1||attempt>reconciliationPolicy.maxAttempts||!Number.isFinite(jitter)||jitter<0||jitter>1)throw new Error('INVALID_RECONCILIATION_RETRY');
 return Math.min(reconciliationPolicy.maxBackoffSeconds,Math.ceil(10*2**(attempt-1)*(0.5+jitter)));
}
export const retryable=(code:LookupFailure)=>code==='NETWORK_RETRYABLE'||code==='PROVIDER_5XX_RETRYABLE';
