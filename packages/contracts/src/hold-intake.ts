import {canonical,HOLD_TTL_SECONDS,HoldError,newIntakeWindow,normalizePeriod,type HoldConditions,type PaymentBoundary} from './hold';

// Size choices are omitted only from this comparison, never from the saved promise,
// feasibility solver, final quote equality or immutable request fingerprint.
export type HoldScope=Omit<HoldConditions,'members'>&{members:{key:string;product:HoldConditions['members'][number]['product'];age:HoldConditions['members'][number]['age'];tier:HoldConditions['members'][number]['tier'];wear?:boolean;wearSport?:'SKI'|'SNOWBOARD';models?:{family:string;modelId:string;season:string}[];families:HoldConditions['members'][number]['items'][number]['family'][]}[]};
export function holdScope(c:HoldConditions):HoldScope{return {...c,members:c.members.map(m=>({key:m.key,product:m.product,age:m.age,tier:m.tier,...(m.wear!==undefined?{wear:m.wear}:{}),...(m.wearSport?{wearSport:m.wearSport}:{}),...(m.items.some(i=>i.modelPromise)?{models:m.items.filter(i=>i.modelPromise).map(i=>({family:i.family,modelId:i.modelPromise!.modelId,season:i.modelPromise!.season})).sort((a,b)=>a.family.localeCompare(b.family))}:{}),families:m.items.map(i=>i.family).sort()})).sort((a,b)=>a.key.localeCompare(b.key))};}
export type IntakeHold={id:string;reservation_id:string;owner_id:string;conditions:HoldConditions;expires_at:Date;due_at:Date;state:string;payment_state:PaymentBoundary;allocation_stage:string;version:number;transfer_attention:string|null};
// Constructed by the recommendation service, never accepted from HTTP bodies.
// A full group scope plus one member key avoids mistaking a one-person candidate for
// a change of group size. A fresh DB row/version is still required by every consumer.
export type CandidateContext={scope:HoldScope;memberKey:string;expectedVersion:number};
export type QuoteCandidateContext=CandidateContext&{holdId:string};
export function candidateScope(c:HoldConditions,context:CandidateContext):HoldScope{
 const projected={...context.scope,members:context.scope.members.filter(m=>m.key===context.memberKey)};
 if(c.members.length!==1||projected.members.length!==1||c.members[0]!.key!==context.memberKey||canonical(holdScope(c))!==canonical(projected))throw new HoldError('INVALID_CONTINUATION_CONTEXT');
 return context.scope;
}
export function assertMutableLease(h:IntakeHold,now:Date){
 if(h.state!=='ACTIVE'||now>=h.expires_at)throw new HoldError('HOLD_EXPIRED_OR_RELEASED',409);
 if(now>=h.due_at)throw new HoldError('PERIOD_ENDED');
 if(h.allocation_stage!=='PROVISIONAL')throw new HoldError('ALLOCATION_FIXED',409);
 if(!['NONE','FAILURE'].includes(h.payment_state))throw new HoldError('PAYMENT_RECONCILIATION_REQUIRED',409);
 if(h.transfer_attention)throw new HoldError('TRANSFER_ALLOCATION_FIXED',409);
}
export function intakeWindow(c:HoldConditions,now:Date,h:IntakeHold|null=null,context?:CandidateContext){
 if(!h){if(context)throw new HoldError('INVALID_CONTINUATION_CONTEXT');return {...newIntakeWindow(c.period,now),mode:'NEW_INTAKE' as const};}
 assertMutableLease(h,now);
 if(h.reservation_id!==c.reservationId)throw new HoldError('IMMUTABLE_RESERVATION');
 if(context&&(!Number.isInteger(context.expectedVersion)||context.expectedVersion!==h.version))throw new HoldError('STALE_HOLD_VERSION',409);
 const scope=context?candidateScope(c,context):holdScope(c);
 try{return {...newIntakeWindow(c.period,now),mode:'NEW_INTAKE' as const};}catch(e){
  if(!(e instanceof HoldError)||!['INTAKE_CLOSED','START_DATE_PAST'].includes(e.code))throw e;
  // Existing 600s leases are always written as server decision time +600s. Their
  // expiry is never extended by amend/reassign. Reconstruct that saved acceptance
  // time, rather than using client flags or the audit wall clock in test fixtures.
  const acceptedAt=new Date(h.expires_at.getTime()-HOLD_TTL_SECONDS*1000);
  if(acceptedAt>now||canonical(scope)!==canonical(holdScope(h.conditions)))throw e;
  try{newIntakeWindow(h.conditions.period,acceptedAt);}catch{throw new HoldError('HOLD_ACCEPTANCE_NOT_PROVEN',409);}
  // This is unfinished staff work within the original lease, not a rental exchange.
  // Never use the already-past product start/intake close as a new quote deadline.
  const due=normalizePeriod(h.conditions.period).dueAt;
  if(Date.parse(due)!==h.due_at.getTime())throw new HoldError('HOLD_PERIOD_MISMATCH',409);
  return {mode:'HOLD_CONTINUATION' as const,intakeClosesAt:new Date(c.period.startDate+(c.period.slot==='AM'?'T12:00:00+09:00':'T17:00:00+09:00')).toISOString(),quoteBoundaryAt:new Date(Math.min(h.expires_at.getTime(),h.due_at.getTime())).toISOString()};
 }
}
