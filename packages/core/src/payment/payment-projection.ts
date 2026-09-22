import {r15ProjectionTarget,type R15ProjectionPermit} from './r15-projection-authority';
import {productionProjectionTarget,type ProductionProjectionPermit} from './production-projection-authority';
import {flowHash,flowId,matchPayment,type PaymentObservation,type PaymentRequest} from '../../../contracts/src/rental-flow';
import {parseConditions,normalizePeriod,variantMatches,isWear,type HoldConditions,type PromiseVariant} from '../../../contracts/src/hold';
import {advanceQualification,timestamp} from '../../../contracts/src/pricing';
import {cleanObservation} from './payment-truth';

export const projectionDecisions=['NOOP_DUPLICATE','NOOP_STALE','NOOP_TERMINAL','KEEP_PENDING','APPLY_COMPLETED','APPLY_FAILED','APPLY_CANCELED','BLOCK_EXPIRED_HOLD','BLOCK_INVENTORY_DRIFT','BLOCK_TRANSFER_ATTENTION','BLOCK_PRICE_INTEGRITY','BLOCK_IDENTITY_MISMATCH','BLOCK_INVALID_TRANSITION','BLOCK_CONFLICT','BLOCK_SOURCE','REQUIRES_OPERATOR_RECONCILIATION'] as const;
export type ProjectionDecision=typeof projectionDecisions[number];
export type ProjectionReference={bookingId:string;attemptId:string;jobId:string;truthRevision:number;truthFingerprint:string;observationFingerprint:string;expectedRevision:number};
export type ProjectionSource={jobId:string;environment:string;merchantId:string;paymentId:string;state:string;securityBlocked:boolean;truthRevision:number;decision:string;decisionFingerprint:string;contextFingerprint:string;observation:PaymentObservation|null};
export type ProjectionBooking={id:string;ownerId:string;holdId:string;quoteId:string;mode:string;state:string;confirmedAt:string|null;version:number;conditions:HoldConditions;priceSnapshot:Record<string,unknown>;priceHash:string};
export type ProjectionAttempt={expected:PaymentRequest;actor:string;state:string;providerId:string|null;providerState:string|null;providerUpdatedAt:string|null;completedAt:string|null};
export type ProjectionHold={id:string;ownerId:string;reservationId:string;state:string;paymentState:string;allocationStage:string;transferAttention:string|null;expiresAt:string;dueAt:string;confirmedAt:string|null;version:number;conditions:HoldConditions};
export type ProjectionQuote={id:string;actor:string;holdId:string|null;conditions:HoldConditions;snapshot:Record<string,unknown>;snapshotHash:string;couponId:string|null};
export type ProjectionState={booking:ProjectionBooking;attempt:ProjectionAttempt;hold:ProjectionHold|null;quote:ProjectionQuote|null;gearClaimsIntact:boolean;wearClaimsIntact:boolean;forbiddenTransfer:boolean;unreadyTransferAt:string|null;revision:number;previous:PaymentObservation|null};
export type ProjectionPlan={decision:ProjectionDecision;fingerprint:string;observationFingerprint:string;observation:PaymentObservation|null;operatorActionRequired:boolean;mutation:'NONE'|'PENDING'|'COMPLETED'|'FAILED'|'REVIEW_COMPLETED'};
export type ProjectionResult={bookingId:string;attemptId:string;revision:number;decision:ProjectionDecision;decisionFingerprint:string;observationFingerprint:string;providerStatus:string|null;bookingState:string;attemptState:string;operatorActionRequired:boolean;duplicate:boolean};
export class ProjectionError extends Error{constructor(public code:string){super(code);}}
const hash=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const ident=(v:unknown)=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(v);
export function validateProjectionReference(r:ProjectionReference){
 flowId(r.bookingId);flowId(r.attemptId);flowId(r.jobId);
 if(!Number.isSafeInteger(r.expectedRevision)||r.expectedRevision<0||!Number.isSafeInteger(r.truthRevision)||r.truthRevision<1||!hash(r.truthFingerprint)||!hash(r.observationFingerprint))throw new ProjectionError('INVALID_PROJECTION_REFERENCE');
}
function normalized(o:PaymentObservation,now:Date){
 for(const v of [o.providerId,o.referenceId,o.idempotencyKey,o.merchantId,o.locationId])if(!ident(v))throw new Error();
 if(o.currency!=='JPY'||!Number.isSafeInteger(o.amountJpy)||o.amountJpy<1||o.amountJpy>100000000||!['PENDING','COMPLETED','FAILED','CANCELED'].includes(o.status))throw new Error();
 timestamp(o.updatedAt);if(o.completedAt!==null)timestamp(o.completedAt);
 if(Date.parse(o.updatedAt)>now.getTime()||(o.status==='COMPLETED')!==(o.completedAt!==null)||o.completedAt!==null&&Date.parse(o.completedAt)>Date.parse(o.updatedAt))throw new Error();
 return cleanObservation(o);
}
/** R12 persisted evidence only; fingerprints are integrity checks, not browser authentication.
 * `expectedEnvironment` defaults to 'SANDBOX' so every existing caller is unaffected; only a
 * Production-permitted projection call ever passes 'PRODUCTION'. */
export function verifyProjectionSource(ref:ProjectionReference,source:ProjectionSource|null,now:Date,expectedEnvironment:'SANDBOX'|'PRODUCTION'='SANDBOX'):PaymentObservation{
 try{
  if(!source||source.jobId!==ref.jobId||source.environment!==expectedEnvironment||source.securityBlocked||!['RECONCILED','RETRY_WAIT'].includes(source.state)||source.truthRevision!==ref.truthRevision||source.decisionFingerprint!==ref.truthFingerprint||!hash(source.contextFingerprint)||!source.observation)throw new Error();
  const o=normalized(source.observation,now);
  if(source.merchantId!==o.merchantId||source.paymentId!==o.providerId||!['ACCEPT_'+o.status,'NOOP_DUPLICATE'].includes(source.decision)||flowHash(o)!==ref.observationFingerprint)throw new Error();
  if(flowHash({engine:'payment-truth-v1',contextFingerprint:source.contextFingerprint,paymentId:source.paymentId,decision:source.decision,observation:o})!==source.decisionFingerprint)throw new Error();
  return o;
 }catch{throw new ProjectionError('PROJECTION_SOURCE_NOT_ACCEPTED');}
}
/** Pure business decision. All facts are re-read under the transaction's locks by the repository. */
export function decidePaymentProjection(s:ProjectionState,o:PaymentObservation,now:Date):ProjectionPlan{
 const finish=(decision:ProjectionDecision,mutation:ProjectionPlan['mutation']='NONE',observation:PaymentObservation|null=o):ProjectionPlan=>{
  const observationFingerprint=observation?flowHash(observation):flowHash(null);
  return {decision,mutation,observation,observationFingerprint,operatorActionRequired:decision.startsWith('BLOCK_')||decision==='REQUIRES_OPERATOR_RECONCILIATION',fingerprint:flowHash({engine:'payment-projection-v1',decision,mutation,observationFingerprint,revision:s.revision,bookingVersion:s.booking.version,holdVersion:s.hold?.version??null,attemptState:s.attempt.state})};
 };
 let accepted:PaymentObservation;
 try{
  if(!Number.isFinite(now.getTime()))throw new Error();accepted=normalized(o,now);
  const {booking:b,attempt:a}=s;flowId(b.id);flowId(a.expected.attemptId);flowId(a.expected.idempotencyKey);
  if(!Number.isSafeInteger(s.revision)||s.revision<0||!Number.isSafeInteger(b.version)||b.version<1||b.id!==a.expected.bookingId||a.actor!==b.ownerId||a.providerId!==accepted.providerId||!['SQUARE_SANDBOX','SQUARE_PRODUCTION','SIMULATED_DEV'].includes(b.mode))throw new Error();
  matchPayment(a.expected,accepted);
 }catch{return finish('BLOCK_IDENTITY_MISMATCH','NONE',null);}
 o=accepted;
 const {booking:b,attempt:a,hold:h,quote:q}=s;
 let previous:PaymentObservation|null=s.previous;
 try{
  if(previous){previous=normalized(previous,now);matchPayment(a.expected,previous);if(previous.providerId!==o.providerId)throw new Error();}
  if(a.providerUpdatedAt){timestamp(a.providerUpdatedAt);const saved={...o,status:a.providerState as PaymentObservation['status'],updatedAt:a.providerUpdatedAt,completedAt:a.completedAt};normalized(saved,now);
   if(!previous||Date.parse(saved.updatedAt)>Date.parse(previous.updatedAt))previous=cleanObservation(saved);
   else if(Date.parse(saved.updatedAt)===Date.parse(previous.updatedAt)&&flowHash(cleanObservation(saved))!==flowHash(previous))return finish('BLOCK_CONFLICT');
  }
 }catch{return finish('BLOCK_IDENTITY_MISMATCH','NONE',null);}
 if(previous){
  if(Date.parse(o.updatedAt)<Date.parse(previous.updatedAt))return finish('NOOP_STALE');
  if(Date.parse(o.updatedAt)===Date.parse(previous.updatedAt)){
   if(flowHash(o)!==flowHash(previous))return finish('BLOCK_CONFLICT');
   if(a.state==='REVIEW'&&o.status==='COMPLETED')return finish('REQUIRES_OPERATOR_RECONCILIATION');
   return finish('NOOP_DUPLICATE');
  }
 }
 if(a.state==='COMPLETED'||b.confirmedAt||['CONFIRMED_DEV','COMPLETED_DEV'].includes(b.state))return finish('NOOP_TERMINAL');
 if(['FAILED','CANCELED'].includes(a.providerState??'')||a.state==='FAILED')return finish(o.status==='COMPLETED'?'BLOCK_INVALID_TRANSITION':'NOOP_TERMINAL');
 if(!['SUBMITTING','UNKNOWN','PENDING','REVIEW'].includes(a.state)||!['PAYMENT_PENDING','PAYMENT_REVIEW'].includes(b.state)||!h||h.ownerId!==b.ownerId||h.id!==b.holdId||h.reservationId!==b.id)return finish('BLOCK_INVALID_TRANSITION');
 const block=(decision:ProjectionDecision)=>finish(decision,o.status==='COMPLETED'?'REVIEW_COMPLETED':'NONE');
 try{
  parseConditions(b.conditions);parseConditions(h.conditions);
  if(b.conditions.reservationId!==b.id||flowHash(b.conditions)!==flowHash(h.conditions)||h.dueAt!==normalizePeriod(h.conditions.period).dueAt)throw new Error();
  if(!q||q.id!==b.quoteId||q.holdId!==h.id||q.actor!==b.ownerId||flowHash(q.conditions)!==flowHash(b.conditions)||q.couponId!==null)throw new Error();
  if(!hash(b.priceHash)||flowHash(b.priceSnapshot)!==b.priceHash||q.snapshotHash!==b.priceHash||flowHash(q.snapshot)!==q.snapshotHash||flowHash(q.snapshot.conditions)!==flowHash(b.conditions))throw new Error();
  if(b.priceSnapshot.chargeReady!==false||b.priceSnapshot.currency!=='JPY'||b.priceSnapshot.totalJpy!==a.expected.amountJpy)throw new Error();
  const discount=b.priceSnapshot.advanceDiscountJpy;if(!Number.isSafeInteger(discount)||Number(discount)<0||Number(discount)>a.expected.amountJpy)throw new Error();
  if(o.status==='COMPLETED'&&Number(discount)>0&&advanceQualification(b.conditions.period.startDate,o.completedAt?new Date(o.completedAt):null)!=='QUALIFIED')throw new Error();
 }catch{return block('BLOCK_PRICE_INTEGRITY');}
 if(h.state!=='ACTIVE'||h.confirmedAt||h.allocationStage!=='PROVISIONAL'||!['PENDING','UNKNOWN'].includes(h.paymentState))return block('BLOCK_INVALID_TRANSITION');
 if(o.status==='COMPLETED'){
  if(!Number.isFinite(Date.parse(h.expiresAt))||!Number.isFinite(Date.parse(h.dueAt))||Date.parse(h.expiresAt)<=now.getTime()||Date.parse(h.dueAt)<=now.getTime())return block('BLOCK_EXPIRED_HOLD');
  if(h.transferAttention||s.forbiddenTransfer||s.unreadyTransferAt!==null&&Date.parse(s.unreadyTransferAt)<now.getTime())return block('BLOCK_TRANSFER_ATTENTION');
  if(!s.gearClaimsIntact||!s.wearClaimsIntact)return block('BLOCK_INVENTORY_DRIFT');
  return finish('APPLY_COMPLETED','COMPLETED');
 }
 return o.status==='PENDING'?finish('KEEP_PENDING','PENDING'):finish(o.status==='FAILED'?'APPLY_FAILED':'APPLY_CANCELED','FAILED');
}
export interface PaymentProjectionTransaction{
 load():Promise<ProjectionState>;
 source():Promise<ProjectionSource|null>;
 prior(observationFingerprint:string):Promise<{result:ProjectionResult;jobId:string;truthFingerprint:string}|null>;
 linkReplay(ref:ProjectionReference):Promise<void>;
 time():Promise<Date>;
 persist(state:ProjectionState,plan:ProjectionPlan,ref:ProjectionReference,now:Date):Promise<ProjectionResult>;
}
export interface PaymentProjectionRepository{transaction<T>(reference:ProjectionReference,run:(tx:PaymentProjectionTransaction)=>Promise<T>):Promise<T>}
export interface PaymentProjectionPort{project(reference:ProjectionReference):Promise<ProjectionResult>}
/**
 * Unconnected internal port: no request body, credential, gateway, schedule or business runtime import.
 * At most one of `permit` (R15 hosted-Sandbox capability) or `productionPermit` (Production capability)
 * may ever be meaningfully active for a given instance — they gate mutually exclusive database
 * identities (`zr_*` vs explicitly non-`zr_*`), so a single instance can never straddle both.
 */
export class TransactionalPaymentProjection implements PaymentProjectionPort{
 constructor(private repository:PaymentProjectionRepository,private permit?:R15ProjectionPermit,private productionPermit?:ProductionProjectionPermit){
  if(process.env.NODE_ENV==='production'&&!r15ProjectionTarget(permit)&&!productionProjectionTarget(productionPermit))throw new ProjectionError('PROJECTION_NOT_ACTIVATED');
 }
 async project(ref:ProjectionReference){
  const productionTarget=productionProjectionTarget(this.productionPermit,ref);
  if((process.env.NODE_ENV==='production'||this.permit||this.productionPermit)&&!r15ProjectionTarget(this.permit,ref)&&!productionTarget)throw new ProjectionError('PROJECTION_NOT_ACTIVATED');
  validateProjectionReference(ref);
  // The only two recognized modes for live payment admission; SIMULATED_DEV never reaches this port.
  const expectedMode=productionTarget?'SQUARE_PRODUCTION':'SQUARE_SANDBOX';
  const expectedEnvironment=productionTarget?'PRODUCTION':'SANDBOX';
  return this.repository.transaction(ref,async tx=>{
   const state=await tx.load();
   if(state.booking.id!==ref.bookingId||state.attempt.expected.attemptId!==ref.attemptId||state.attempt.expected.bookingId!==ref.bookingId)throw new ProjectionError('PROJECTION_TARGET_MISMATCH');
   const prior=await tx.prior(ref.observationFingerprint);
   if(prior)validateSavedProjection(prior.result,ref);
   if(prior){
    if(prior.jobId!==ref.jobId||prior.truthFingerprint!==ref.truthFingerprint){
     if(state.booking.mode!==expectedMode)throw new ProjectionError('PROJECTION_MODE_MISMATCH');
     verifyProjectionSource(ref,await tx.source(),await tx.time(),expectedEnvironment);await tx.linkReplay(ref);
    }
    return {...prior.result,duplicate:true}; // saved replay never reapplies business state or extends a HOLD
   }
   if(state.revision!==ref.expectedRevision)throw new ProjectionError('STALE_PROJECTION_REVISION');
   if(state.booking.mode!==expectedMode)throw new ProjectionError('PROJECTION_MODE_MISMATCH');
   const source=await tx.source();const now=await tx.time();const observation=verifyProjectionSource(ref,source,now,expectedEnvironment);
   const plan=decidePaymentProjection(state,observation,now);
   // F7 (TD correction): R6-D's commercial booking path does not exist yet (see
   // production-projection-authority.ts and BookingService — nothing produces a real,
   // reviewed SQUARE_PRODUCTION booking today). A Production permit reaching this point with
   // genuine Production evidence must never silently write CONFIRMED_DEV (or any other
   // mutation) as if that path were live — fail closed instead, before persist() ever runs.
   // A no-mutation outcome (already-terminal/blocked/duplicate) is unaffected; there is no
   // commercial state to protect in that case.
   if(productionTarget&&plan.mutation!=='NONE')throw new ProjectionError('PRODUCTION_BOOKING_PATH_NOT_ACTIVATED');
   return tx.persist(state,plan,ref,now);
  });
 }
}

export type ProjectionClaim=PromiseVariant&{requirement_key:string;day:string;kind:'GEAR'|'WEAR';quantity:number};
export function projectionClaims(conditions:HoldConditions,claims:ProjectionClaim[]){
 try{
  parseConditions(conditions);const dates=normalizePeriod(conditions.period).dates;
  const expected=conditions.members.flatMap(member=>member.items.flatMap(item=>dates.map(day=>({key:member.key+':'+item.family+'/'+day,member,item}))));
  const match=(wear:boolean)=>{
   const requirements=expected.filter(e=>isWear(e.item.family)===wear),rows=claims.filter(c=>(c.kind==='WEAR')===wear);
   if(rows.length!==requirements.length)return false;const seen=new Set<string>(),byKey=new Map(requirements.map(e=>[e.key,e]));
   return rows.every(c=>{const key=c.requirement_key+'/'+c.day,e=byKey.get(key);if(!e||seen.has(key)||c.quantity!==1||!e.item.variantIds.includes(c.id)||!variantMatches(e.member,e.item,c))return false;seen.add(key);return true;});
  };return {gear:match(false),wear:match(true)};
 }catch{return {gear:false,wear:false};}
}

export function validateSavedProjection(value:ProjectionResult,ref:ProjectionReference){
 const keys=['bookingId','attemptId','revision','decision','decisionFingerprint','observationFingerprint','providerStatus','bookingState','attemptState','operatorActionRequired','duplicate'];
 if(!value||Object.keys(value).sort().join()!==keys.sort().join()||value.bookingId!==ref.bookingId||value.attemptId!==ref.attemptId||value.observationFingerprint!==ref.observationFingerprint||!hash(value.decisionFingerprint)||!Number.isSafeInteger(value.revision)||value.revision<1||!projectionDecisions.includes(value.decision)||value.duplicate!==false||typeof value.operatorActionRequired!=='boolean'||value.operatorActionRequired!==(value.decision.startsWith('BLOCK_')||value.decision==='REQUIRES_OPERATOR_RECONCILIATION')||!(value.providerStatus===null||['PENDING','COMPLETED','FAILED','CANCELED'].includes(value.providerStatus))||!['DRAFT','PAYMENT_PENDING','PAYMENT_REVIEW','CONFIRMED_DEV','COMPLETED_DEV'].includes(value.bookingState)||!['SUBMITTING','UNKNOWN','PENDING','COMPLETED','FAILED','REVIEW'].includes(value.attemptState))throw new ProjectionError('INVALID_SAVED_PROJECTION');
}
