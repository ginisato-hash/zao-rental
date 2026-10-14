import {dinAdvisory,DIN_REFERENCE,type DinAdvisory} from './din';
import {suggestPole} from './pole';
import {centimetres,type Profile} from './recommendation';
import {HoldError} from './hold';
class FlowError extends HoldError{constructor(code:string,status=409){super(code,status);}}
function flowObject(value:unknown,keys:string[]){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join()!==[...keys].sort().join())throw new FlowError('STRUCTURED_PREPARATION_REQUIRED',422);return value as Record<string,unknown>;}
import {canonical,isWear,type HoldConditions} from './hold';
export type PreparationItem={requirement_key:string;asset_id:string|null;pole_id:string|null;variant_id:string;family:string;size:string;name:string;catalog_season:string|null;bsl_status:string|null;bsl_mm:number|null};
export type PreparationMember={memberKey:string;product:string;age:string;tier:string;profile:Profile|null;items:PreparationItem[];wear:{family:string;size:string}[];needsBinding:boolean;needsPole:boolean;needsWear:boolean;ownBoot:boolean;bootAssetId:string|null;bslMm:number|null;poleSuggestedCm:number|null;din:DinAdvisory|null};
export type PreparationInput={version:'ZAO_PREP_V2';members:{memberKey:string;bootAssetId:string|null;bslMm:number|null;ownBootConfirmed:boolean;equipmentConfirmed:boolean;bindingCompatibilityConfirmed:boolean;bindingSetupConfirmed:boolean;poleSelectedCm:number|null;wearPrepared:boolean}[]};
export type PreparationEvidence={version:'ZAO_PREP_V2';conditions?:HoldConditions;selections:{requirementKey:string;assetId:string|null;poleId:string|null}[];members:(PreparationInput['members'][number]&{bslSource:'ASSET'|'PHYSICAL_OBSERVATION'|null;confirmedBy:string;confirmedAt:string;profile:Profile|null;poleSuggestedCm:number|null;dinReferenceValue:number|null;dinReferenceVersion:string|null;dinReferenceSource:typeof DIN_REFERENCE|null;bindingSetupConfirmedBy:string|null;bindingSetupConfirmedAt:string|null})[]};
export function preparationMembers(conditions:HoldConditions,profiles:Profile[],items:PreparationItem[],wearVariants:{id:string;family:string;size:string}[],poleSizes:number[]):PreparationMember[]{
 return conditions.members.map(m=>{
  const assigned=items.filter(i=>i.requirement_key.startsWith(m.key+':')),boot=assigned.find(i=>i.family==='SKI_BOOT');
  const profile=profiles.find(p=>p.key===m.key)??null,needsBinding=m.items.some(i=>i.family==='SKI'),needsPole=m.items.some(i=>i.family==='POLE'),needsWear=m.items.some(i=>isWear(i.family));
  const bslMm=boot?.bsl_status==='RECORDED'?boot.bsl_mm:null;
  return {memberKey:m.key,product:m.product,age:m.age,tier:m.tier,profile,items:assigned,wear:m.items.filter(i=>isWear(i.family)).map(i=>({family:i.family,size:wearVariants.find(v=>v.id===i.variantIds[0])?.size??''})),needsBinding,needsPole,needsWear,ownBoot:needsBinding&&!m.items.some(i=>i.family==='SKI_BOOT'),bootAssetId:boot?.asset_id??null,bslMm,poleSuggestedCm:needsPole&&profile?.heightCm?suggestPole(profile.heightCm,poleSizes):null,din:needsBinding?memberDin(profile,bslMm):null};
 });
}
/** Only an explicit V1.3 skier type is DIN input; a historical generic level leaves the reference unavailable. */
export function memberDin(profile:Profile|null,bslMm:number|null){const ski=profile?.ski;return dinAdvisory(ski?.skierType&&profile!.heightCm&&bslMm?{heightCm:profile!.heightCm,weightKg:ski.weightKg,ageAtStart:ski.ageAtStart,skierType:ski.skierType,bslMm}:null);}
export function recordPreparation(value:unknown,members:PreparationMember[],actor:string,at:string,selections:PreparationEvidence['selections'],conditions?:HoldConditions):PreparationEvidence{
 const input=flowObject(value,['version','members']);
 if(input.version!=='ZAO_PREP_V2'||!Array.isArray(input.members)||input.members.length!==members.length)throw new FlowError('STRUCTURED_PREPARATION_REQUIRED',422);
 const keys=new Set<string>();
 const saved=input.members.map(raw=>{
  const r=flowObject(raw,['memberKey','bootAssetId','bslMm','ownBootConfirmed','equipmentConfirmed','bindingCompatibilityConfirmed','bindingSetupConfirmed','poleSelectedCm','wearPrepared']);
  const m=members.find(m=>m.memberKey===r.memberKey);
  if(!m||keys.has(m.memberKey))throw new FlowError('INCOMPLETE_PREPARATION',422);keys.add(m.memberKey);
  if(['ownBootConfirmed','equipmentConfirmed','bindingCompatibilityConfirmed','bindingSetupConfirmed','wearPrepared'].some(k=>typeof r[k]!=='boolean')||r.equipmentConfirmed!==true)throw new FlowError('PHYSICAL_CONFIRMATION_REQUIRED',422);
  if(r.bootAssetId!==m.bootAssetId)throw new FlowError('PREPARED_ASSIGNMENT_CHANGED');
  const hasSkiBoot=!!m.bootAssetId||m.ownBoot;
  if(!hasSkiBoot&&r.bslMm!==null)throw new FlowError('UNEXPECTED_BSL',422);
  if(m.bslMm!==null&&r.bslMm!==m.bslMm)throw new FlowError('ASSET_BSL_CHANGED');
  const bslMm=m.bslMm??r.bslMm;
  if((m.needsBinding||bslMm!==null)&&(!Number.isInteger(bslMm)||Number(bslMm)<150||Number(bslMm)>450))throw new FlowError('ACTUAL_BSL_REQUIRED',422);
  if(m.ownBoot&&r.ownBootConfirmed!==true)throw new FlowError('ACTUAL_BOOT_REQUIRED',422);
  const din=m.needsBinding?memberDin(m.profile,bslMm as number):null;
  if(m.needsBinding&&(r.bindingCompatibilityConfirmed!==true||r.bindingSetupConfirmed!==true))throw new FlowError('BINDING_CONFIRMATION_REQUIRED',422);
  if(m.needsBinding&&!m.profile?.ski?.skierType)throw new FlowError('SKIER_TYPE_DECLARATION_REQUIRED',422);
  if(m.needsBinding&&din?.value==null)throw new FlowError('DIN_REFERENCE_UNAVAILABLE',422);
  if(m.needsPole&&(m.poleSuggestedCm===null||!Number.isFinite(r.poleSelectedCm)||Number(r.poleSelectedCm)<30||Number(r.poleSelectedCm)>200))throw new FlowError('POLE_PHYSICAL_SELECTION_REQUIRED',422);
  const assignedPole=m.items.find(i=>i.family==='POLE');
  if(assignedPole&&centimetres(assignedPole.size)!==r.poleSelectedCm)throw new FlowError('POLE_ASSIGNMENT_CHANGED',422);
  if(!m.needsPole&&r.poleSelectedCm!==null)throw new FlowError('UNEXPECTED_POLE_SELECTION',422);
  if(m.needsWear&&r.wearPrepared!==true)throw new FlowError('WEAR_PREPARATION_REQUIRED',422);
  return {...r as PreparationInput['members'][number],bslMm:bslMm as number|null,bslSource:hasSkiBoot&&bslMm!==null?(m.bslMm!==null?'ASSET':'PHYSICAL_OBSERVATION') as 'ASSET'|'PHYSICAL_OBSERVATION':null,confirmedBy:actor,confirmedAt:at,profile:m.profile,poleSuggestedCm:m.poleSuggestedCm,dinReferenceValue:din?.value??null,dinReferenceVersion:din?.version??null,dinReferenceSource:m.needsBinding?DIN_REFERENCE:null,bindingSetupConfirmedBy:m.needsBinding?actor:null,bindingSetupConfirmedAt:m.needsBinding?at:null};
 });
 return {version:'ZAO_PREP_V2',...(conditions?{conditions}:{}),selections,members:saved};
}
/** Recheck current assignment and recorded asset metadata; observations never transfer to another boot. */
export function preparationStillValid(evidence:unknown,items:PreparationItem[],conditions?:HoldConditions){
 if(!evidence||typeof evidence!=='object')return false;
 const e=evidence as PreparationEvidence;
 // Historical non-V2 records stay readable for audit only; they never authorize a current checkout.
 if(e.version!=='ZAO_PREP_V2')return false;
 if(!Array.isArray(e.selections))return false;
 const current=items.map(i=>({requirementKey:i.requirement_key,assetId:i.asset_id,poleId:i.pole_id})).sort((a,b)=>a.requirementKey.localeCompare(b.requirementKey));
 if(canonical(current)!==canonical([...e.selections].sort((a,b)=>a.requirementKey.localeCompare(b.requirementKey))))return false;
 if(conditions&&canonical(e.conditions??null)!==canonical(conditions))return false;
 return Array.isArray(e.members)&&e.members.every(m=>{
  const boot=items.find(i=>i.requirement_key===m.memberKey+':SKI_BOOT');
  if((boot?.asset_id??null)!==m.bootAssetId)return false;
  if(boot?.bsl_status==='RECORDED'&&boot.bsl_mm!==m.bslMm)return false;
  if(m.bslSource==='ASSET'&&boot?.bsl_status!=='RECORDED')return false;
  const pole=items.find(i=>i.requirement_key===m.memberKey+':POLE');
  return !pole||centimetres(pole.size)===m.poleSelectedCm;
 });
}
