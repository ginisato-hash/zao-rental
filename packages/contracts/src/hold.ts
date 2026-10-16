import Ajv from 'ajv';
import schema from './hold-input.schema.json';
import type {StoreId} from './ledger';
import {brandContractError} from './contract-error';
export const HOLD_TTL_SECONDS=600; // Owner-approved development default; no production activation.
export const OCCUPANCY_POLICY='WHOLE_TOKYO_DATE_V1' as const;
export type Period={startDate:string;endDate:string;slot:'AM'|'PM'|'DAY'|'MULTIDAY';startAt?:'08:30'|'13:00';returnBy?:'12:00'|'17:00'};
export type ContractVersion='INTEGRATED_V1_2'|'INTEGRATED_V1_3'|'INTEGRATED_V1_4';
/** V1.3 rules (explicit item family, accessory pole witness) also apply to V1.4. */
export function atLeastV13(v:string|undefined){return v==='INTEGRATED_V1_3'||v==='INTEGRATED_V1_4';}
/** R67 V1.4 date boundaries: start 08:30/13:00 on the first date, return 12:00/17:00 on the last.
 * The legacy slot is derived (never chosen independently) so slot-based readers stay correct. */
export function boundarySlot(startDate:string,endDate:string,startAt:'08:30'|'13:00',returnBy:'12:00'|'17:00'):Period['slot']{
 if(startDate!==endDate)return 'MULTIDAY';
 if(startAt==='13:00'&&returnBy==='12:00')throw new HoldError('INVALID_PERIOD');
 return startAt==='13:00'?'PM':returnBy==='12:00'?'AM':'DAY';
}
function startTime(p:Period){return p.startAt??(p.slot==='PM'?'13:00':'08:30');}
function returnTime(p:Period){return p.returnBy??(p.slot==='AM'?'12:00':'17:00');}
export type EquipmentFamily='SKI'|'SNOWBOARD'|'SKI_BOOT'|'SNOWBOARD_BOOT'|'POLE'|'WEAR_JACKET'|'WEAR_PANTS';
export type ModelPromise={modelId:string;season:string;variantId:string};
export type HoldItem={family:EquipmentFamily;variantIds:string[];modelPromise?:ModelPromise};
export type HoldMember={key:string;product:'SKI_SET'|'SNOWBOARD_SET'|'SINGLE'|'WEAR_SET';age:'ADULT'|'KIDS';tier:'REGULAR'|'PREMIUM'|'STANDARD';wear?:boolean;wearSport?:'SKI'|'SNOWBOARD';items:HoldItem[]};
export type HoldConditions={contractVersion?:ContractVersion;reservationId:string;pickupStore:StoreId;returnStore:StoreId;period:Period;members:HoldMember[]};
export function isWear(family:string){return family==='WEAR_JACKET'||family==='WEAR_PANTS';}
// Only SKI_SET accessory poles may use an absence witness when no tracked pool exists.
// Paid standalone poles always require normal inventory claims and custody.
export function isPole(family:string){return family==='POLE';}
export function isAccessoryPole(member:Pick<HoldMember,'product'>,family:string){return member.product==='SKI_SET'&&isPole(family);}
export function memberSport(m:HoldMember){return m.product==='WEAR_SET'?m.wearSport!:m.product==='SNOWBOARD_SET'||m.items.some(i=>i.family==='SNOWBOARD'||i.family==='SNOWBOARD_BOOT')?'SNOWBOARD':'SKI';}
export function itemTier(m:HoldMember,item:HoldItem){return isWear(item.family)?'STANDARD':m.tier;}
/** Premium's model promise covers the ski/board only; its boots/poles come from the common Regular fit pool (R67). */
export function isFitAccessory(family:string){return family==='SKI_BOOT'||family==='SNOWBOARD_BOOT'||family==='POLE';}
export function tierMatches(m:HoldMember,item:HoldItem,tier:string){const want=itemTier(m,item);return tier===want||(want==='PREMIUM'&&isFitAccessory(item.family)&&tier==='REGULAR');}
export type PromiseVariant={id:string;family:string;age:string;tier:string;model_id?:string;catalog_season?:string|null;compatible_sports?:string[]|null};
// One decision shared by advisory pricing and the real all-period allocator.
export function variantMatches(m:HoldMember,item:HoldItem,v:PromiseVariant|undefined){return !!v&&v.family===item.family&&v.age===m.age&&tierMatches(m,item,v.tier)&&(!isWear(item.family)||!!v.compatible_sports?.includes(memberSport(m)))&&(!item.modelPromise||(v.id===item.modelPromise.variantId&&v.model_id===item.modelPromise.modelId&&v.catalog_season===item.modelPromise.season));}

export class HoldError extends Error{constructor(public code:string,public status=422){super(code);brandContractError(this);}}
const validate=new Ajv({allErrors:false}).compile(schema);
export function parseConditions(value:unknown):HoldConditions {
 if(!validate(value))throw new HoldError('INVALID_CONDITIONS');
 const c=value as HoldConditions;normalizePeriod(c.period);
 if(new Set(c.members.map(m=>m.key)).size!==c.members.length)throw new HoldError('DUPLICATE_MEMBER');
 for(const m of c.members){
  const integrated=c.contractVersion==='INTEGRATED_V1_2'||atLeastV13(c.contractVersion),v14=c.contractVersion==='INTEGRATED_V1_4',wearItems=m.items.filter(i=>isWear(i.family)),gear=m.items.filter(i=>!isWear(i.family)),families=gear.map(i=>i.family).sort().join(',');
  if(!integrated&&(m.product==='WEAR_SET'||m.wear!==undefined||m.wearSport!==undefined||wearItems.length||m.tier==='STANDARD'||m.items.some(i=>i.modelPromise)))throw new HoldError('CONTRACT_VERSION_REQUIRED');
  if(new Set(m.items.map(i=>i.family)).size!==m.items.length)throw new HoldError('INCOMPLETE_SET');
  if((m.product==='SKI_SET'&&families!=='POLE,SKI,SKI_BOOT')||(m.product==='SNOWBOARD_SET'&&families!=='SNOWBOARD,SNOWBOARD_BOOT')||(m.product==='SINGLE'&&(v14?!singleItemsCompatible(gear.map(i=>i.family)):gear.length!==1))||(m.product==='WEAR_SET'&&gear.length))throw new HoldError('INCOMPLETE_SET');
  const needsWear=m.product==='WEAR_SET'||m.wear===true;
  if(needsWear?wearItems.map(i=>i.family).sort().join(',')!=='WEAR_JACKET,WEAR_PANTS':wearItems.length!==0)throw new HoldError('INCOMPLETE_WEAR_SET');
  if(m.product==='WEAR_SET'?(m.tier!=='STANDARD'||!m.wearSport||m.wear!==undefined):(m.tier==='STANDARD'||m.wearSport!==undefined))throw new HoldError('INVALID_PRODUCT_CLASS');
  for(const item of m.items){if(!item.variantIds.length&&!(atLeastV13(c.contractVersion)&&isAccessoryPole(m,item.family)))throw new HoldError('INVALID_CONDITIONS');if(isWear(item.family)&&item.variantIds.length!==1)throw new HoldError('WEAR_EXPLICIT_SIZE_REQUIRED');const board=item.family==='SKI'||item.family==='SNOWBOARD';if(integrated&&m.tier==='PREMIUM'&&board&&!item.modelPromise)throw new HoldError('MODEL_PROMISE_REQUIRED');if(item.modelPromise&&(!board||m.tier!=='PREMIUM'||item.variantIds.length!==1||item.variantIds[0]!==item.modelPromise.variantId))throw new HoldError('MODEL_PROMISE_MISMATCH');}
 }

 return c;
}
export function utcDate(date:string):number{if(!/^20\d{2}-\d{2}-\d{2}$/.test(date))throw new HoldError('INVALID_DATE');const ms=Date.parse(date+'T00:00:00Z');if(!Number.isFinite(ms)||new Date(ms).toISOString().slice(0,10)!==date)throw new HoldError('INVALID_DATE');return ms;}
export function normalizePeriod(p:Period){
 const first=utcDate(p.startDate),last=utcDate(p.endDate),days=(last-first)/86400000+1;
 if(!Number.isInteger(days)||days<1||days>10||!['AM','PM','DAY','MULTIDAY'].includes(p.slot)||(p.slot==='MULTIDAY')!==(days>1))throw new HoldError('INVALID_PERIOD');
 if((p.startAt===undefined)!==(p.returnBy===undefined)||p.startAt!==undefined&&(!['08:30','13:00'].includes(p.startAt)||!['12:00','17:00'].includes(p.returnBy!)||boundarySlot(p.startDate,p.endDate,p.startAt,p.returnBy!)!==p.slot))throw new HoldError('INVALID_PERIOD');
 const dates=Array.from({length:days},(_,i)=>new Date(first+i*86400000).toISOString().slice(0,10));
 const startsAt=new Date(p.startDate+'T'+startTime(p)+':00+09:00').toISOString();
 const dueAt=new Date(p.endDate+'T'+returnTime(p)+':00+09:00').toISOString();
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
 const intakeClosesAt=intakeClose(period);
 if(ms>=Date.parse(intakeClosesAt))throw new HoldError('INTAKE_CLOSED',409);
 // Ahead-of-slot quotes retain the original start-time bound. Once that time has
 // arrived, a new quote uses the still-open intake deadline, never a past expiry.
 const quoteBoundaryAt=ms<Date.parse(normalized.startsAt)?normalized.startsAt:intakeClosesAt;
 return {intakeClosesAt,quoteBoundaryAt};
}
/** First-day intake closes 17:00, or 12:00 when the whole rental ends at noon that day. */
export function intakeClose(period:Period){return new Date(period.startDate+(period.startDate===period.endDate&&returnTime(period)==='12:00'?'T12:00:00+09:00':'T17:00:00+09:00')).toISOString();}
/** V1.4 individual items: 1-3 unique gear families of one sport (ski: SKI/SKI_BOOT/POLE; board: SNOWBOARD/SNOWBOARD_BOOT). */
export function singleItemsCompatible(families:string[]){if(!families.length||new Set(families).size!==families.length)return false;const ski=['SKI','SKI_BOOT','POLE'],board=['SNOWBOARD','SNOWBOARD_BOOT'];return families.every(f=>ski.includes(f))||families.every(f=>board.includes(f));}
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
