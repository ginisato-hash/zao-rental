import type {PaymentObservation,PaymentRequest} from '../../../contracts/src/rental-flow';
import type {WebhookEnvironment} from './square-webhook-inbox';
import {decidePaymentTruth,reconciliationPolicy,retryDelaySeconds,retryable,type LookupFailure,type PaymentContext,type TruthResult} from './payment-truth';
export type LookupResult={kind:'OBSERVED';observation:PaymentObservation}|{kind:'FAILED';code:LookupFailure};
export interface PaymentTruthProvider{lookupPayment(input:{environment:WebhookEnvironment;paymentId:string;expected:PaymentRequest;signal:AbortSignal}):Promise<LookupResult>}
export type ReconciliationClaim={id:string;environment:WebhookEnvironment;merchantId:string;paymentId:string;generation:number;sourceEventId:string;sourceFingerprint:string;signalRevision:number;truthRevision:number;attempt:number;leaseOwner:string;leaseToken:string;leaseExpiresAt:Date;deadlineAt:Date;latest:PaymentObservation|null};
export type JobOutcome={state:'RECONCILED'|'RETRY_WAIT'|'BLOCKED'|'DEAD';code:LookupFailure|'PENDING_OBSERVATION'|null;retrySeconds:number|null;truth:TruthResult|null};
export type JobSummary={id:string;state:string;generation:number;paymentId:string;attempt:number;code:string|null;decision:string|null;updatedAt:Date};
export interface PaymentReconciliationRepository{
 dispatch(environment:WebhookEnvironment,limit:number):Promise<number>;
 claimBatch(environment:WebhookEnvironment,workerId:string,limit:number):Promise<ReconciliationClaim[]>;
 finalize(claim:ReconciliationClaim,outcome:JobOutcome):Promise<boolean>;
 diagnostics(environment:WebhookEnvironment,limit:number):Promise<JobSummary[]>;
}
/** Must read a trusted persisted payment attempt by merchant/provider ID, never browser/webhook amount. */
export interface PaymentContextReader{load(claim:ReconciliationClaim):Promise<PaymentContext|null>;loadBatch?(claims:ReconciliationClaim[]):Promise<ReadonlyMap<string,PaymentContext>>}
export type LookupDeadline=<T>(run:(signal:AbortSignal)=>Promise<T>,milliseconds:number)=>Promise<T>;
export class LookupTimeout extends Error{}
export const boundedLookup:LookupDeadline=async(run,milliseconds)=>{
 const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
 try{return await Promise.race([Promise.resolve().then(()=>run(controller.signal)),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new LookupTimeout());},milliseconds);})]);}
 finally{clearTimeout(timer);}
};
/** Finite library call only. No runtime composition, HTTP endpoint, timer loop, cron, env or business port. */
export class PaymentReconciliationWorker{
 constructor(private repository:PaymentReconciliationRepository,private contexts:PaymentContextReader,private provider:PaymentTruthProvider,
  private now:()=>Date=()=>new Date(),private jitter:()=>number=Math.random,private deadline:LookupDeadline=boundedLookup){}
 async runOnce(environment:WebhookEnvironment,workerId:string,limit=1){
  if(!Number.isInteger(limit)||limit<1||limit>reconciliationPolicy.maxBatch||!/^[-A-Za-z0-9_]{1,100}$/.test(workerId))throw new Error('INVALID_WORKER_BATCH');
  const dispatched=await this.repository.dispatch(environment,limit);
  const claims=await this.repository.claimBatch(environment,workerId,limit);
  let contexts:ReadonlyMap<string,PaymentContext>|undefined;
  if(this.contexts.loadBatch){try{contexts=await this.contexts.loadBatch(claims);}catch{contexts=new Map();}}
  const results=[];
  for(const claim of claims){const result=await this.process(claim,contexts);results.push(result);if('code' in result&&(result.code==='AUTH_BLOCKED'||result.code==='RATE_LIMITED'))break;}
  return {dispatched,claimed:claims.length,results};
 }
 private failure(claim:ReconciliationClaim,code:LookupFailure):JobOutcome{
  if(claim.deadlineAt<=this.now())return {state:'DEAD',code:'DEADLINE_EXCEEDED',retrySeconds:null,truth:null};
  if(!retryable(code))return {state:'BLOCKED',code,retrySeconds:null,truth:null};
  if(claim.attempt>=reconciliationPolicy.maxAttempts)return {state:'DEAD',code:'ATTEMPTS_EXHAUSTED',retrySeconds:null,truth:null};
  return {state:'RETRY_WAIT',code,retrySeconds:retryDelaySeconds(claim.attempt,this.jitter()),truth:null};
 }
 private async process(claim:ReconciliationClaim,batch?:ReadonlyMap<string,PaymentContext>){
  let outcome:JobOutcome;
  if(claim.deadlineAt<=this.now())outcome=this.failure(claim,'DEADLINE_EXCEEDED');
  else if(claim.leaseExpiresAt<=this.now())return {id:claim.id,result:'STALE_LEASE' as const};
  else{
   let context:PaymentContext|null;try{context=batch?batch.get(claim.id)??null:await this.contexts.load(claim);}catch{context=null;}
   if(!context||context.expected.merchantId!==claim.merchantId||context.current.providerId!==claim.paymentId)outcome=this.failure(claim,'PAYMENT_CONTEXT_MISSING');
   else if(claim.leaseExpiresAt<=this.now())return {id:claim.id,result:'STALE_LEASE' as const};
   else{
    let lookup:LookupResult;
    try{lookup=await this.deadline(signal=>this.provider.lookupPayment({environment:claim.environment,paymentId:claim.paymentId,expected:context.expected,signal}),Math.min(reconciliationPolicy.lookupTimeoutMs,Math.max(1,claim.leaseExpiresAt.getTime()-this.now().getTime())));}
    catch(error){lookup={kind:'FAILED',code:error instanceof LookupTimeout?'NETWORK_RETRYABLE':'INVALID_RESPONSE_BLOCKED'};}
    if(!lookup||!['OBSERVED','FAILED'].includes(lookup.kind)||lookup.kind==='FAILED'&&!['AUTH_BLOCKED','RATE_LIMITED','NETWORK_RETRYABLE','PROVIDER_5XX_RETRYABLE','NOT_FOUND_BLOCKED','INVALID_RESPONSE_BLOCKED','EVIDENCE_MISMATCH_BLOCKED'].includes(lookup.code))lookup={kind:'FAILED',code:'INVALID_RESPONSE_BLOCKED'};
    if(lookup.kind==='FAILED')outcome=this.failure(claim,lookup.code);
    else{
     const prior=claim.latest&&(!context.latest||Date.parse(claim.latest.updatedAt)>=Date.parse(context.latest.updatedAt))?claim.latest:context.latest;
     const truth=decidePaymentTruth({...context,latest:prior},claim.paymentId,lookup.observation,this.now());
     if(truth.decision.startsWith('BLOCKED_'))outcome={state:'BLOCKED',code:'EVIDENCE_MISMATCH_BLOCKED',retrySeconds:null,truth};
     else if(truth.decision==='ACCEPT_PENDING'||['NOOP_DUPLICATE','NOOP_STALE'].includes(truth.decision)&&(prior?.status??context.current.providerState)==='PENDING'){
      const wait=this.failure(claim,'NETWORK_RETRYABLE');outcome={...wait,code:wait.state==='RETRY_WAIT'?'PENDING_OBSERVATION':wait.code,truth};
     }
     else outcome={state:'RECONCILED',code:null,retrySeconds:null,truth};
    }
   }
  }
  // A lost result or failed commit is not replayed here. A later lease recovery is explicit.
  const saved=await this.repository.finalize(claim,outcome);
  return {id:claim.id,result:saved?'SAVED':'STALE_LEASE',proposedState:outcome.state,decision:outcome.truth?.decision??null,code:outcome.code};
 }
}
