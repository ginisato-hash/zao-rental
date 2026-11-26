import {createHash} from 'node:crypto';
import {canonical,type HoldConditions,type HoldMember} from './hold';
import {halfUpBps} from './pricing';

/** Group order foundation (Issue #47 B3-B6, corrected by comment 7197417902).
 * One parent group = at most MAX_PARTS ordinary parts of at most PART_SIZE (the existing per-hold limit) members.
 * There is deliberately no expiry, extension or EXPIRED anywhere in this module: a review hold ends only by an
 * explicit administrator release (or formal cancellation after confirmation). Settlement is on site only. */
export const MAX_MEMBERS=100;
export const PART_SIZE=20;
export const MAX_PARTS=MAX_MEMBERS/PART_SIZE;
export const MAX_ADMIN_MESSAGE=2000;
export const GROUP_PAYMENT_METHOD='PAY_ON_SITE' as const;
export const GROUP_CONFIRMATION_BASIS='GROUP_ADMIN_APPROVED' as const;

export class GroupError extends Error{constructor(public code:string,public status=422,public detail?:unknown){super(code);this.name='GroupError';}}

export const GROUP_STATUSES=['DRAFT','QUOTED','REVIEW_HELD','CHANGES_REQUESTED','CONFIRMED','RELEASED','CANCELLED'] as const;
export type GroupStatus=typeof GROUP_STATUSES[number];
export const GROUP_TERMINAL:readonly GroupStatus[]=['RELEASED','CANCELLED'];
/** Legal edges. Who may take them is enforced again in the database (group_order_guard). */
export const GROUP_TRANSITIONS:Readonly<Record<GroupStatus,readonly GroupStatus[]>>={
 DRAFT:['QUOTED'],QUOTED:['DRAFT','REVIEW_HELD'],REVIEW_HELD:['CONFIRMED','CHANGES_REQUESTED','RELEASED'],
 CHANGES_REQUESTED:['REVIEW_HELD','RELEASED'],CONFIRMED:['CANCELLED'],RELEASED:[],CANCELLED:[]};
export function canTransition(from:GroupStatus,to:GroupStatus){return GROUP_TRANSITIONS[from].includes(to);}
/** Statuses in which every part hold exists, is GROUP_RESERVED and is protected. */
export const GROUP_HELD:readonly GroupStatus[]=['REVIEW_HELD','CHANGES_REQUESTED','CONFIRMED'];

/** Customer-facing notifications. Every other event is internal. No expiry/extension event exists. */
export const NOTIFIABLE_EVENTS=['GROUP_REVIEW_HELD','GROUP_CONFIRMED','GROUP_CHANGES_REQUESTED','GROUP_RELEASED','GROUP_CANCELLED'] as const;
export const groupDedupeKey=(groupId:string,eventType:string,revision:number)=>`${groupId}:${eventType}:${revision}`;

export type GroupMemberInput={memberId?:string;label?:string;profile:Record<string,unknown>;selection:Omit<HoldMember,'key'>;fit?:Record<string,unknown>};
export const memberKey=(ordinal:number)=>'p'+String(ordinal).padStart(3,'0');
export function partCount(members:number){return Math.ceil(members/PART_SIZE);}
/** Stable, order-preserving partition: member ordinal 1..20 -> part 1, 21..40 -> part 2 ... */
export function partitionMembers<T>(members:readonly T[]):T[][]{
 if(members.length<1||members.length>MAX_MEMBERS)throw new GroupError(members.length<1?'GROUP_EMPTY':'GROUP_TOO_LARGE');
 const parts:T[][]=[];for(let i=0;i<members.length;i+=PART_SIZE)parts.push(members.slice(i,i+PART_SIZE));return parts;
}
export type GroupPeriod=HoldConditions['period'];
export function memberConditions(base:{contractVersion?:HoldConditions['contractVersion'];reservationId:string;pickupStore:HoldConditions['pickupStore'];returnStore:HoldConditions['returnStore'];period:GroupPeriod},members:{ordinal:number;selection:Omit<HoldMember,'key'>}[]):HoldConditions{
 return {...(base.contractVersion?{contractVersion:base.contractVersion}:{}),reservationId:base.reservationId,pickupStore:base.pickupStore,returnStore:base.returnStore,period:base.period,members:members.map(m=>({key:memberKey(m.ordinal),...m.selection}))};
}
export const sha256=(value:unknown)=>createHash('sha256').update(typeof value==='string'?value:canonical(value)).digest('hex');

// ---------------------------------------------------------------- pricing of the group (per-member base comes from the existing calculate())
export type Adjustment={target:'MEMBER'|'GROUP';memberId?:string;method:'FIXED_JPY'|'PERCENT_BPS';value:number;reason:string};
export type MemberBase={memberId:string;ordinal:number;baseJpy:number};
export type MemberTotal=MemberBase&{memberDiscountJpy:number;afterMemberJpy:number;groupDiscountJpy:number;finalJpy:number};
export type GroupTotals={members:MemberTotal[];baseJpy:number;memberDiscountJpy:number;groupDiscountJpy:number;totalJpy:number;
 /** Per applied adjustment: amounts before/after (for the audit row). Group-level before/after are for the whole remainder. */
 audit:{target:'MEMBER'|'GROUP';memberId:string|null;beforeJpy:number;afterJpy:number}[]};
const isInt=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v);
export function validateAdjustment(a:Adjustment){
 if(!a||(a.target!=='MEMBER'&&a.target!=='GROUP')||(a.method!=='FIXED_JPY'&&a.method!=='PERCENT_BPS'))throw new GroupError('ADJUSTMENT_INVALID');
 if(!isInt(a.value)||a.value<1||a.value>(a.method==='PERCENT_BPS'?10000:100_000_000))throw new GroupError('ADJUSTMENT_INVALID');
 if(typeof a.reason!=='string'||!a.reason.trim()||a.reason.length>200)throw new GroupError('ADJUSTMENT_REASON_REQUIRED');
 if((a.target==='MEMBER')!==(typeof a.memberId==='string'))throw new GroupError('ADJUSTMENT_INVALID');
}
/** Largest-remainder split of `total` over `weights` (stable: ties go to the lowest index). Sum is exact. */
export function allocateExact(total:number,weights:readonly number[]):number[]{
 const sum=weights.reduce((n,w)=>n+w,0);if(!isInt(total)||total<0||sum<=0||total>sum)throw new GroupError('ADJUSTMENT_EXCEEDS_REMAINDER');
 const base=weights.map(w=>Number(BigInt(total)*BigInt(w)/BigInt(sum))),rem=weights.map((w,i)=>({i,r:Number(BigInt(total)*BigInt(w)%BigInt(sum))}));
 let left=total-base.reduce((n,x)=>n+x,0);rem.sort((a,b)=>b.r-a.r||a.i-b.i);for(const x of rem){if(left<=0)break;if(x.r>0){base[x.i]!+=1;left--;}}
 return base;
}
/** Discount order (Owner): per-participant first (one method per participant), then one group-wide discount over what remains.
 * A discount can never exceed its target's remainder (no negative amount); the group-wide discount is spread over members in
 * proportion to their remainder (largest remainder, stable by ordinal), never onto a member without a remainder. */
export function computeGroupTotals(bases:readonly MemberBase[],adjustments:readonly Adjustment[]):GroupTotals{
 const sorted=[...bases].sort((a,b)=>a.ordinal-b.ordinal);if(!sorted.length)throw new GroupError('GROUP_EMPTY');
 const byMember=new Map<string,Adjustment>(),groupAdj:Adjustment[]=[];
 for(const a of adjustments){validateAdjustment(a);if(a.target==='GROUP'){groupAdj.push(a);continue;}
  if(!sorted.some(m=>m.memberId===a.memberId))throw new GroupError('ADJUSTMENT_TARGET_UNKNOWN');if(byMember.has(a.memberId!))throw new GroupError('ADJUSTMENT_ONE_METHOD_PER_TARGET');byMember.set(a.memberId!,a);}
 if(groupAdj.length>1)throw new GroupError('ADJUSTMENT_ONE_METHOD_PER_TARGET');
 const audit:GroupTotals['audit']=[];
 const members:MemberTotal[]=sorted.map(m=>{
  const a=byMember.get(m.memberId);let d=0;
  if(a){d=a.method==='FIXED_JPY'?a.value:halfUpBps(m.baseJpy,a.value);if(d>m.baseJpy)throw new GroupError('ADJUSTMENT_EXCEEDS_REMAINDER',422,{memberId:m.memberId});audit.push({target:'MEMBER',memberId:m.memberId,beforeJpy:m.baseJpy,afterJpy:m.baseJpy-d});}
  return {...m,memberDiscountJpy:d,afterMemberJpy:m.baseJpy-d,groupDiscountJpy:0,finalJpy:m.baseJpy-d};});
 const remainder=members.reduce((n,m)=>n+m.afterMemberJpy,0);let groupDiscount=0;
 const g=groupAdj[0];
 if(g){groupDiscount=g.method==='FIXED_JPY'?g.value:halfUpBps(remainder,g.value);if(groupDiscount>remainder)throw new GroupError('ADJUSTMENT_EXCEEDS_REMAINDER',422,{target:'GROUP'});
  const shares=remainder>0?allocateExact(groupDiscount,members.map(m=>m.afterMemberJpy)):[];
  members.forEach((m,i)=>{m.groupDiscountJpy=shares[i]??0;m.finalJpy=m.afterMemberJpy-m.groupDiscountJpy;});
  audit.push({target:'GROUP',memberId:null,beforeJpy:remainder,afterJpy:remainder-groupDiscount});}
 const baseJpy=sorted.reduce((n,m)=>n+m.baseJpy,0),memberDiscountJpy=members.reduce((n,m)=>n+m.memberDiscountJpy,0),totalJpy=members.reduce((n,m)=>n+m.finalJpy,0);
 if(baseJpy-memberDiscountJpy-groupDiscount!==totalJpy||members.some(m=>m.finalJpy<0))throw new GroupError('GROUP_TOTAL_MISMATCH',500);
 return {members,baseJpy,memberDiscountJpy,groupDiscountJpy:groupDiscount,totalJpy,audit};
}

export function validateAdminMessage(value:unknown):string|null{
 if(value===undefined||value===null||value==='')return null;
 if(typeof value!=='string'||value.length>MAX_ADMIN_MESSAGE||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))throw new GroupError('MESSAGE_INVALID');
 return value;
}
export function validateReason(value:unknown,max=300):string{
 if(typeof value!=='string'||!value.trim()||value.length>max)throw new GroupError('REASON_REQUIRED');return value.trim();
}

export type GroupSettlement={paymentMethod:typeof GROUP_PAYMENT_METHOD;status:'UNPAID'|'PARTIALLY_PAID'|'PAID'|'NO_CHARGE'|'NOT_APPLICABLE';totalJpy:number;receivedJpy:number;outstandingJpy:number};
/** Settlement is derived from real on-site receipts only. It is never a payment-provider state. */
export function settlementOf(confirmedTotal:number|null,receipts:{kind:'RECEIPT'|'REVERSAL';amountJpy:number}[]):GroupSettlement{
 if(confirmedTotal===null)return {paymentMethod:GROUP_PAYMENT_METHOD,status:'NOT_APPLICABLE',totalJpy:0,receivedJpy:0,outstandingJpy:0};
 if(confirmedTotal===0)return {paymentMethod:GROUP_PAYMENT_METHOD,status:'NO_CHARGE',totalJpy:0,receivedJpy:0,outstandingJpy:0};
 const received=receipts.reduce((n,r)=>n+(r.kind==='RECEIPT'?r.amountJpy:-r.amountJpy),0);
 return {paymentMethod:GROUP_PAYMENT_METHOD,status:received<=0?'UNPAID':received>=confirmedTotal?'PAID':'PARTIALLY_PAID',totalJpy:confirmedTotal,receivedJpy:received,outstandingJpy:Math.max(0,confirmedTotal-received)};
}
