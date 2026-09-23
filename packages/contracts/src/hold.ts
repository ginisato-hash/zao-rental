import Ajv from 'ajv';
import schema from './hold-input.schema.json';
import type {StoreId} from './ledger';
export const HOLD_TTL_SECONDS=600; // Owner-approved development default; no production activation.
export const OCCUPANCY_POLICY='WHOLE_TOKYO_DATE_V1' as const;
export type Period={startDate:string;endDate:string;slot:'AM'|'PM'|'DAY'|'MULTIDAY'};
export type EquipmentFamily='SKI'|'SNOWBOARD'|'SKI_BOOT'|'SNOWBOARD_BOOT'|'POLE'|'WEAR_JACKET'|'WEAR_PANTS';
export type ModelPromise={modelId:string;season:string;variantId:string};
export type HoldItem={family:EquipmentFamily;variantIds:string[];modelPromise?:ModelPromise};
export type HoldMember={key:string;product:'SKI_SET'|'SNOWBOARD_SET'|'SINGLE'|'WEAR_SET';age:'ADULT'|'KIDS';tier:'REGULAR'|'PREMIUM'|'STANDARD';wear?:boolean;wearSport?:'SKI'|'SNOWBOARD';items:HoldItem[]};
export type HoldConditions={contractVersion?:'INTEGRATED_V1_2';reservationId:string;pickupStore:StoreId;returnStore:StoreId;period:Period;members:HoldMember[]};
export function isWear(family:string){return family==='WEAR_JACKET'||family==='WEAR_PANTS';}
// Owner decision (release-code-closure, Phase 1): POLE is removed from public feasibility
// blocking — no physical or provisional inventory has ever been registered for it (see
// RESULT.md §10), so it must never make an otherwise-satisfiable SKI_SET unbookable. POLE
// remains a required structural member of SKI_SET (see families check below) and is still
// shown to staff on the daily manifest; it is simply never inventory-claim-tracked, exactly
// like an item the store hands out ad hoc without per-unit accounting.
export function isPole(family:string){return family==='POLE';}
export function memberSport(m:HoldMember){return m.product==='WEAR_SET'?m.wearSport!:m.product==='SNOWBOARD_SET'||m.items.some(i=>i.family==='SNOWBOARD'||i.family==='SNOWBOARD_BOOT')?'SNOWBOARD':'SKI';}
export function itemTier(m:HoldMember,item:HoldItem){return isWear(item.family)?'STANDARD':m.tier;}
export type PromiseVariant={id:string;family:string;age:string;tier:string;model_id?:string;catalog_season?:string|null;compatible_sports?:string[]|null};
// One decision shared by advisory pricing and the real all-period allocator.
export function variantMatches(m:HoldMember,item:HoldItem,v:PromiseVariant|undefined){return !!v&&v.family===item.family&&v.age===m.age&&v.tier===itemTier(m,item)&&(!isWear(item.family)||!!v.compatible_sports?.includes(memberSport(m)))&&(!item.modelPromise||(v.id===item.modelPromise.variantId&&v.model_id===item.modelPromise.modelId&&v.catalog_season===item.modelPromise.season));}

export class HoldError extends Error{constructor(public code:string,public status=422){super(code);}}
const validate=new Ajv({allErrors:false}).compile(schema);
export function parseConditions(value:unknown):HoldConditions {
 if(!validate(value))throw new HoldError('INVALID_CONDITIONS');
 const c=value as HoldConditions;normalizePeriod(c.period);
 if(new Set(c.members.map(m=>m.key)).size!==c.members.length)throw new HoldError('DUPLICATE_MEMBER');
 for(const m of c.members){
  const integrated=c.contractVersion==='INTEGRATED_V1_2',wearItems=m.items.filter(i=>isWear(i.family)),gear=m.items.filter(i=>!isWear(i.family)),families=gear.map(i=>i.family).sort().join(',');
  if(!integrated&&(m.product==='WEAR_SET'||m.wear!==undefined||m.wearSport!==undefined||wearItems.length||m.tier==='STANDARD'||m.items.some(i=>i.modelPromise)))throw new HoldError('CONTRACT_VERSION_REQUIRED');
  if(new Set(m.items.map(i=>i.family)).size!==m.items.length)throw new HoldError('INCOMPLETE_SET');
  if((m.product==='SKI_SET'&&families!=='POLE,SKI,SKI_BOOT')||(m.product==='SNOWBOARD_SET'&&families!=='SNOWBOARD,SNOWBOARD_BOOT')||(m.product==='SINGLE'&&gear.length!==1)||(m.product==='WEAR_SET'&&gear.length))throw new HoldError('INCOMPLETE_SET');
  const needsWear=m.product==='WEAR_SET'||m.wear===true;
  if(needsWear?wearItems.map(i=>i.family).sort().join(',')!=='WEAR_JACKET,WEAR_PANTS':wearItems.length!==0)throw new HoldError('INCOMPLETE_WEAR_SET');
  if(m.product==='WEAR_SET'?(m.tier!=='STANDARD'||!m.wearSport||m.wear!==undefined):(m.tier==='STANDARD'||m.wearSport!==undefined))throw new HoldError('INVALID_PRODUCT_CLASS');
  for(const item of m.items){if(isWear(item.family)&&item.variantIds.length!==1)throw new HoldError('WEAR_EXPLICIT_SIZE_REQUIRED');const board=item.family==='SKI'||item.family==='SNOWBOARD';if(integrated&&m.tier==='PREMIUM'&&board&&!item.modelPromise)throw new HoldError('MODEL_PROMISE_REQUIRED');if(item.modelPromise&&(!board||m.tier!=='PREMIUM'||item.variantIds.length!==1||item.variantIds[0]!==item.modelPromise.variantId))throw new HoldError('MODEL_PROMISE_MISMATCH');}
 }

 return c;
}
export function utcDate(date:string):number{if(!/^20\d{2}-\d{2}-\d{2}$/.test(date))throw new HoldError('INVALID_DATE');const ms=Date.parse(date+'T00:00:00Z');if(!Number.isFinite(ms)||new Date(ms).toISOString().slice(0,10)!==date)throw new HoldError('INVALID_DATE');return ms;}
export function normalizePeriod(p:Period){
 const first=utcDate(p.startDate),last=utcDate(p.endDate),days=(last-first)/86400000+1;
 if(!Number.isInteger(days)||days<1||days>10||!['AM','PM','DAY','MULTIDAY'].includes(p.slot)||p.slot!=='MULTIDAY'&&days!==1)throw new HoldError('INVALID_PERIOD');
 const dates=Array.from({length:days},(_,i)=>new Date(first+i*86400000).toISOString().slice(0,10));
 const startsAt=new Date(p.startDate+(p.slot==='PM'?'T13:00:00+09:00':'T08:30:00+09:00')).toISOString();
 const dueAt=new Date(p.endDate+(p.slot==='AM'?'T12:00:00+09:00':'T17:00:00+09:00')).toISOString();
 return {timezone:'Asia/Tokyo',policy:OCCUPANCY_POLICY,dates,days,startsAt,dueAt,occupancyStartsAt:new Date(first-9*3600000).toISOString(),occupancyEndsAt:new Date(last+15*3600000).toISOString()};
}
// New requests may book ahead, or be accepted on their first Tokyo date while the
// selected product still has time left. OPERATIONS.md closes first-day intake at17:00
// (AM12:00); this is distinct from a MULTIDAY contract's final return deadline.
// Never put these clock-dependent decisions into saved conditions or request fingerprints.
export function newIntakeWindow(period:Period,now:Date){
 const normalized=normalizePeriod(period),ms=now.getTime();
 if(!Number.isFinite(ms))throw new HoldError('INVALID_CLOCK');
 if(ms>=Date.parse(normalized.dueAt))throw new HoldError('PERIOD_ENDED');
 const today=new Date(ms+9*3600000).toISOString().slice(0,10);
 if(period.startDate<today)throw new HoldError('START_DATE_PAST',409);
 const intakeClosesAt=new Date(period.startDate+(period.slot==='AM'?'T12:00:00+09:00':'T17:00:00+09:00')).toISOString();
 if(ms>=Date.parse(intakeClosesAt))throw new HoldError('INTAKE_CLOSED',409);
 // Ahead-of-slot quotes retain the original start-time bound. Once that time has
 // arrived, a new quote uses the still-open intake deadline, never a past expiry.
 const quoteBoundaryAt=ms<Date.parse(normalized.startsAt)?normalized.startsAt:intakeClosesAt;
 return {intakeClosesAt,quoteBoundaryAt};
}
export type PaymentBoundary='NONE'|'PENDING'|'UNKNOWN'|'SUCCESS'|'FAILURE';
export function paymentDecision(state:PaymentBoundary,active:boolean,expired:boolean,reacquired:boolean){
 if(state==='PENDING'||state==='UNKNOWN')return 'RECONCILIATION_REQUIRED';
 if(state==='SUCCESS')return (active&&!expired||reacquired)?'INVENTORY_ONLY_VALID_PAYMENT_VERIFICATION_REQUIRED':'INVENTORY_REACQUIRE_REQUIRED';
 return expired?'MAY_EXPIRE':'MAY_CHANGE';
}
// Untrusted external hint only: flags do not grant capacity. E07 uses protected database transfer projections.
export type TransferEvidence={batchId:string;scheduledAt:string;state:'REQUESTED'|'COMMITTED'|'SEALED'|'DEPARTED'|'RECEIVED';actualReceivedAt:string|null;inspectionReady:boolean;protectedAllocation:boolean};
export function transferDecision(e:TransferEvidence,addingLine=false){
 if(addingLine&&['SEALED','DEPARTED','RECEIVED'].includes(e.state))return 'BATCH_CLOSED';
 if(!e.scheduledAt.endsWith('T17:00:00+09:00'))return 'INVALID_SCHEDULE';
 if(e.state==='RECEIVED'&&e.actualReceivedAt&&e.inspectionReady&&e.protectedAllocation)return 'E07_RECEIPT_VERIFICATION_REQUIRED';
 return 'TRANSFER_PLAN_REQUIRED';
}
export function canonical(value:unknown):string{if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';if(value!==null&&typeof value==='object')return '{'+Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+':'+canonical(v)).join(',')+'}';return JSON.stringify(value);}
export type Feasibility='FEASIBLE'|'INSUFFICIENT'|'TRANSFER_PLAN_REQUIRED'|'INDETERMINATE';
