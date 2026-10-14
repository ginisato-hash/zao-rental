import {profileFields} from './profile-fields';
import {suggestPole} from './pole';
import type {AvatarVisualizationV1} from './avatar-visualization';
import Ajv from 'ajv';
import schema from './recommendation-input.schema.json';
import {HoldError,normalizePeriod,variantMatches,type HoldConditions,type Period,type Feasibility} from './hold';
import type {StoreId} from './ledger';
import {SKIER_TYPES,type SkierType} from './din';
export const RECOMMENDATION_RULE='HEIGHT_MINUS_20_WINDOW_15_BOOT_PLUS_1_V1' as const;
export const MODEL_POLICY='EXPLICIT_SIZE_CLASS_NO_MODEL_PROMISE_V1' as const;
export const DIRECTIONS=['RECOMMENDED','SHORTER','LONGER'] as const;
export type Direction=typeof DIRECTIONS[number];
export type Profile={key:string;sport:'SKI'|'SNOWBOARD'|'WEAR';heightCm:number|null;footCm:number|null;wearSelection?:{jacketVariantId:string;pantsVariantId:string};wearSport?:'SKI'|'SNOWBOARD';modelSelection?:{modelId:string;season:string};adultAtStart:boolean;tier:'REGULAR'|'PREMIUM'|'STANDARD';ski:{weightKg:number;ageAtStart:number;level?:'BEGINNER'|'INTERMEDIATE'|'ADVANCED';skierType?:SkierType}|null;poleVariantId?:string|null;itemFamily?:'SKI'|'SKI_BOOT'|'SNOWBOARD'|'SNOWBOARD_BOOT'|'POLE'};
export type RecommendationInput={contractVersion?:'INTEGRATED_V1_2'|'INTEGRATED_V1_3';pickupStore:StoreId;returnStore:StoreId;period:Period;members:Profile[]};
export type Variant={id:string;family:string;age:string;tier:string;size:string;model_id?:string;catalog_season?:string|null;compatible_sports?:string[]|null;model_name?:string;poleStores?:string[]};
export type Candidate={lengthCm:number;member:HoldConditions['members'][number]};
export type MemberRecommendation={visualization?:AvatarVisualizationV1;key:string;targetCm:number;minCm:number;maxCm:number;bootCm:number;initialLengthCm:number|null;candidates:Record<Direction,Candidate|null>;checks:{lengthCm:number;result:Feasibility}[];reason:string|null;price:Record<string,unknown>|null;priceError:string|null};
export class RecommendationError extends HoldError{}
const validate=new Ajv({allErrors:false,multipleOfPrecision:10}).compile(schema);
export function parseRecommendation(value:unknown):RecommendationInput{
 if(!validate(value))throw new RecommendationError('INVALID_RECOMMENDATION_INPUT');const x=value as RecommendationInput;normalizePeriod(x.period);
 if(new Set(x.members.map(m=>m.key)).size!==x.members.length)throw new RecommendationError('DUPLICATE_MEMBER');
 for(const m of x.members){
  const current=x.contractVersion==='INTEGRATED_V1_3',integrated=x.contractVersion==='INTEGRATED_V1_2'||current;
  if(current?m.poleVariantId!=null:m.poleVariantId===undefined)throw new RecommendationError('INVALID_POLE_INPUT');
  if(m.itemFamily&&(!current||m.sport==='WEAR'||(m.itemFamily.startsWith('SNOWBOARD')?'SNOWBOARD':'SKI')!==m.sport||(!['SKI','SNOWBOARD'].includes(m.itemFamily)&&m.tier!=='REGULAR')))throw new RecommendationError('PRODUCT_NOT_OFFERED');
  if(!integrated&&(m.sport==='WEAR'||m.wearSelection||m.modelSelection||m.wearSport||m.tier==='STANDARD'))throw new RecommendationError('CONTRACT_VERSION_REQUIRED');
  if(m.sport==='WEAR'){if(!m.wearSelection||!m.wearSport||m.tier!=='STANDARD'||m.heightCm!==null||m.footCm!==null||m.ski!==null||m.poleVariantId!=null||m.modelSelection)throw new RecommendationError('INVALID_WEAR_PROFILE');continue;}
  const fields=current?profileFields(m.sport,m.itemFamily):{height:true,foot:true,ski:m.sport==='SKI'};
  if((fields.height?m.heightCm===null:m.heightCm!==null)||(fields.foot?m.footCm===null:m.footCm!==null)||m.tier==='STANDARD'||m.wearSport)throw new RecommendationError('INVALID_EQUIPMENT_PROFILE');
  if(m.tier==='PREMIUM'&&!m.adultAtStart)throw new RecommendationError('PRODUCT_NOT_OFFERED');
  if(integrated&&m.tier==='PREMIUM'&&!m.modelSelection||m.tier!=='PREMIUM'&&m.modelSelection)throw new RecommendationError('MODEL_PROMISE_REQUIRED');
  if(fields.ski){if(!m.ski||(!current&&!m.poleVariantId)||m.adultAtStart!==(m.ski.ageAtStart>=13))throw new RecommendationError('SKI_PROFILE_OR_AGE_MISMATCH');if(current&&!Number.isInteger(m.ski.weightKg))throw new RecommendationError('INVALID_RECOMMENDATION_INPUT');
   // V1.3 takes only the explicit DIN skier type; V1.2 keeps its generic level, which is never a DIN type.
   if(current?m.ski.level!==undefined||!SKIER_TYPES.includes(m.ski.skierType!):m.ski.skierType!==undefined||m.ski.level===undefined)throw new RecommendationError('SKIER_TYPE_REQUIRED');}else if(m.ski!==null||m.poleVariantId!=null)throw new RecommendationError(m.sport==='SNOWBOARD'?'UNNECESSARY_SNOWBOARD_INPUT':'INVALID_EQUIPMENT_PROFILE');
 }
 return x;
}
export function sizing(profile:Pick<Profile,'heightCm'|'footCm'|'itemFamily'>){const fields=profileFields('SKI',profile.itemFamily);if(fields.height&&profile.heightCm===null||fields.foot&&profile.footCm===null)throw new RecommendationError('SIZE_NOT_APPLICABLE');const targetCm=profile.heightCm===null?0:profile.heightCm-20;return {targetCm,minCm:profile.heightCm===null?0:targetCm-15,maxCm:profile.heightCm===null?0:targetCm+15,bootCm:profile.footCm===null?0:(Math.round(profile.footCm*10)+10)/10};}
// Only explicit numeric centimetres are eligible. Unknown legacy text is never guessed.
// Case matches ledger_size_key's lexical fold. Retain the existing whitespace
// allowance around a contiguous numeric value and explicit cm unit; never infer units.
export function centimetres(size:string):number|null{const m=/^(\d{1,3}(?:\.\d)?)\s*cm$/i.exec(size.trim());return m?Number(m[1]):null;}
export function rankCandidates<T extends {lengthCm:number}>(all:T[],target:number):Record<Direction,T|null>{
 const ordered=all.filter(x=>Math.abs(x.lengthCm-target)<=15).sort((a,b)=>Math.abs(a.lengthCm-target)-Math.abs(b.lengthCm-target)||a.lengthCm-b.lengthCm);
 const recommended=ordered[0]??null;
 return {RECOMMENDED:recommended,SHORTER:recommended?[...ordered].filter(x=>x.lengthCm<recommended.lengthCm).sort((a,b)=>b.lengthCm-a.lengthCm)[0]??null:null,LONGER:recommended?[...ordered].filter(x=>x.lengthCm>recommended.lengthCm).sort((a,b)=>a.lengthCm-b.lengthCm)[0]??null:null};
}
export function buildMembers(profile:Profile,variants:Variant[],version?:RecommendationInput['contractVersion']):{candidates:Candidate[];reason:string|null}{
 const age=profile.adultAtStart?'ADULT':'KIDS';
 const wearItems=profile.wearSelection?[{family:'WEAR_JACKET' as const,variantIds:[profile.wearSelection.jacketVariantId]},{family:'WEAR_PANTS' as const,variantIds:[profile.wearSelection.pantsVariantId]}]:[];
 const wearMember:HoldConditions['members'][number]={key:profile.key,product:'WEAR_SET',age,tier:'STANDARD',wearSport:profile.wearSport??(profile.sport==='SNOWBOARD'?'SNOWBOARD':'SKI'),items:wearItems};
 if(wearItems.some(item=>!variantMatches(wearMember,item,variants.find(v=>v.id===item.variantIds[0]))))throw new RecommendationError('WEAR_VARIANT_MISMATCH');
 if(profile.sport==='WEAR')return {reason:null,candidates:[{lengthCm:0,member:wearMember}]};
 const sport=profile.sport;const s=sizing(profile);const catalog=variants.filter(v=>v.age===age&&v.tier===profile.tier);
 const bootFamily:'SKI_BOOT'|'SNOWBOARD_BOOT'=profile.sport==='SKI'?'SKI_BOOT':'SNOWBOARD_BOOT';const boots=catalog.filter(v=>v.family===bootFamily&&centimetres(v.size)===s.bootCm).map(v=>v.id).sort();
 const needsBoot=!profile.itemFamily||profile.itemFamily===bootFamily;
 if(needsBoot&&!boots.length)return {candidates:[],reason:'BOOT_SIZE_NOT_FOUND'};
 const poles=catalog.filter(v=>v.family==='POLE'&&centimetres(v.size)!==null);
 const suggested=suggestPole(profile.heightCm!,poles.map(v=>centimetres(v.size)!));
 const pole=profile.sport==='SKI'?(version==='INTEGRATED_V1_3'?poles.filter(v=>centimetres(v.size)===suggested).sort((a,b)=>a.id.localeCompare(b.id))[0]:catalog.find(v=>v.family==='POLE'&&v.id===profile.poleVariantId)):null;
 if(profile.sport==='SKI'&&version!=='INTEGRATED_V1_3'&&!pole)throw new RecommendationError('POLE_VARIANT_MISMATCH');
 const poleItem={family:'POLE' as const,variantIds:pole?[pole.id]:[]};
 const member=(items:HoldConditions['members'][number]['items']):HoldConditions['members'][number]=>({key:profile.key,product:profile.itemFamily?'SINGLE':sport==='SKI'?'SKI_SET':'SNOWBOARD_SET',age,tier:profile.tier,...(wearItems.length?{wear:true}:{}),items:[...items,...wearItems]});
 if(profile.itemFamily===bootFamily)return {reason:null,candidates:[{lengthCm:s.bootCm,member:member([{family:bootFamily,variantIds:boots}])}]};
 if(profile.itemFamily==='POLE')return pole?{reason:null,candidates:[{lengthCm:0,member:member([poleItem])}]}:{reason:'INSUFFICIENT',candidates:[]};
 const boards=catalog.filter(v=>v.family===sport&&(!profile.modelSelection||v.model_id===profile.modelSelection.modelId&&v.catalog_season===profile.modelSelection.season)&&centimetres(v.size)!==null&&Math.abs(centimetres(v.size)!-s.targetCm)<=15);
 const lengths=[...new Set(boards.map(v=>centimetres(v.size)!))].sort((a,b)=>a-b);
 if(lengths.length>32||boots.length>6||lengths.some(n=>boards.filter(v=>centimetres(v.size)===n).length>6))return {candidates:[],reason:'INDETERMINATE_CATALOG_LIMIT'};
 return {reason:lengths.length?null:'NO_CATALOG_LENGTH',candidates:lengths.map(lengthCm=>({lengthCm,member:member([{family:sport,variantIds:boards.filter(v=>centimetres(v.size)===lengthCm).map(v=>v.id).sort(),...(profile.modelSelection?{modelPromise:{...profile.modelSelection,variantId:boards.find(v=>centimetres(v.size)===lengthCm)!.id}}:{})},...(!profile.itemFamily?[{family:bootFamily,variantIds:boots},...(sport==='SKI'?[poleItem]:[])]:[])])}))};
}
