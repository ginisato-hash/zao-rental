import {profileFields} from './profile-fields';
import {suggestPole} from './pole';
import type {AvatarVisualizationV1} from './avatar-visualization';
import Ajv from 'ajv';
import schema from './recommendation-input.schema.json';
import {HoldError,normalizePeriod,variantMatches,atLeastV13,singleItemsCompatible,type HoldConditions,type Period,type Feasibility,type ContractVersion} from './hold';
import {lengthCm,bootRange,bootDistance,compareBootFit,canonicalSize,BOOT_MAX_DISTANCE_CM} from './size';
import type {StoreId} from './ledger';
import {SKIER_TYPES,type SkierType} from './din';
export const RECOMMENDATION_RULE='HEIGHT_MINUS_20_WINDOW_15_BOOT_PLUS_1_V1' as const;
export const MODEL_POLICY='EXPLICIT_SIZE_CLASS_NO_MODEL_PROMISE_V1' as const;
export const DIRECTIONS=['RECOMMENDED','SHORTER','LONGER'] as const;
export type Direction=typeof DIRECTIONS[number];
export type Profile={key:string;sport:'SKI'|'SNOWBOARD'|'WEAR';heightCm:number|null;footCm:number|null;wearSelection?:{jacketVariantId:string;pantsVariantId:string};wearSport?:'SKI'|'SNOWBOARD';modelSelection?:{modelId:string;season:string};adultAtStart:boolean;tier:'REGULAR'|'PREMIUM'|'STANDARD';ski:{weightKg:number;ageAtStart:number;level?:'BEGINNER'|'INTERMEDIATE'|'ADVANCED';skierType?:SkierType}|null;poleVariantId?:string|null;itemFamily?:ItemFamily;items?:ItemFamily[]};
export type ItemFamily='SKI'|'SKI_BOOT'|'SNOWBOARD'|'SNOWBOARD_BOOT'|'POLE';
export type RecommendationInput={contractVersion?:ContractVersion;pickupStore:StoreId;returnStore:StoreId;period:Period;members:Profile[]};
export type Variant={id:string;family:string;age:string;tier:string;size:string;model_id?:string;catalog_season?:string|null;compatible_sports?:string[]|null;model_name?:string;poleStores?:string[]};
export type Candidate={lengthCm:number;sizeLabel?:string;member:HoldConditions['members'][number]};
export type MemberRecommendation={visualization?:AvatarVisualizationV1;key:string;targetCm:number;minCm:number;maxCm:number;bootCm:number;initialLengthCm:number|null;candidates:Record<Direction,Candidate|null>;checks:{lengthCm:number;result:Feasibility}[];reason:string|null;price:Record<string,unknown>|null;priceError:string|null};
export class RecommendationError extends HoldError{}
const validate=new Ajv({allErrors:false,multipleOfPrecision:10}).compile(schema);
export function parseRecommendation(value:unknown):RecommendationInput{
 if(!validate(value))throw new RecommendationError('INVALID_RECOMMENDATION_INPUT');const x=value as RecommendationInput;normalizePeriod(x.period);
 if(new Set(x.members.map(m=>m.key)).size!==x.members.length)throw new RecommendationError('DUPLICATE_MEMBER');
 if((x.contractVersion==='INTEGRATED_V1_4')!==(x.period.startAt!==undefined))throw new RecommendationError('INVALID_PERIOD');
 for(const m of x.members){
  const current=atLeastV13(x.contractVersion),v14=x.contractVersion==='INTEGRATED_V1_4',integrated=x.contractVersion==='INTEGRATED_V1_2'||current;
  if(current?m.poleVariantId!=null:m.poleVariantId===undefined)throw new RecommendationError('INVALID_POLE_INPUT');
  if(m.itemFamily&&(x.contractVersion!=='INTEGRATED_V1_3'||m.sport==='WEAR'||(m.itemFamily.startsWith('SNOWBOARD')?'SNOWBOARD':'SKI')!==m.sport||(!['SKI','SNOWBOARD'].includes(m.itemFamily)&&m.tier!=='REGULAR')))throw new RecommendationError('PRODUCT_NOT_OFFERED');
  // V1.4: several individual items of the member's sport; Premium only when the ski/board itself is chosen.
  if(m.items&&(!v14||m.sport==='WEAR'||!singleItemsCompatible(m.items)||m.items.some(f=>(f.startsWith('SNOWBOARD')?'SNOWBOARD':'SKI')!==m.sport)||(m.tier==='PREMIUM'&&!m.items.includes(m.sport as ItemFamily))))throw new RecommendationError('PRODUCT_NOT_OFFERED');
  if(!integrated&&(m.sport==='WEAR'||m.wearSelection||m.modelSelection||m.wearSport||m.tier==='STANDARD'))throw new RecommendationError('CONTRACT_VERSION_REQUIRED');
  if(m.sport==='WEAR'){if(!m.wearSelection||!m.wearSport||m.tier!=='STANDARD'||m.heightCm!==null||m.footCm!==null||m.ski!==null||m.poleVariantId!=null||m.modelSelection)throw new RecommendationError('INVALID_WEAR_PROFILE');continue;}
  const fields=current?profileFields(m.sport,m.itemFamily,m.items):{height:true,foot:true,ski:m.sport==='SKI'};
  if((fields.height?m.heightCm===null:m.heightCm!==null)||(fields.foot?m.footCm===null:m.footCm!==null)||m.tier==='STANDARD'||m.wearSport)throw new RecommendationError('INVALID_EQUIPMENT_PROFILE');
  if(m.tier==='PREMIUM'&&!m.adultAtStart)throw new RecommendationError('PRODUCT_NOT_OFFERED');
  if(integrated&&m.tier==='PREMIUM'&&!m.modelSelection||m.tier!=='PREMIUM'&&m.modelSelection)throw new RecommendationError('MODEL_PROMISE_REQUIRED');
  if(fields.ski){if(!m.ski||(!current&&!m.poleVariantId)||m.adultAtStart!==(m.ski.ageAtStart>=13))throw new RecommendationError('SKI_PROFILE_OR_AGE_MISMATCH');if(current&&!Number.isInteger(m.ski.weightKg))throw new RecommendationError('INVALID_RECOMMENDATION_INPUT');
   // V1.3 takes only the explicit DIN skier type; V1.2 keeps its generic level, which is never a DIN type.
   if(current?m.ski.level!==undefined||!SKIER_TYPES.includes(m.ski.skierType!):m.ski.skierType!==undefined||m.ski.level===undefined)throw new RecommendationError('SKIER_TYPE_REQUIRED');}else if(m.ski!==null||m.poleVariantId!=null)throw new RecommendationError(m.sport==='SNOWBOARD'?'UNNECESSARY_SNOWBOARD_INPUT':'INVALID_EQUIPMENT_PROFILE');
 }
 return x;
}
export function sizing(profile:Pick<Profile,'heightCm'|'footCm'|'itemFamily'|'items'>){const fields=profileFields('SKI',profile.itemFamily,profile.items);if(fields.height&&profile.heightCm===null||fields.foot&&profile.footCm===null)throw new RecommendationError('SIZE_NOT_APPLICABLE');const targetCm=profile.heightCm===null?0:profile.heightCm-20;return {targetCm,minCm:profile.heightCm===null?0:targetCm-15,maxCm:profile.heightCm===null?0:targetCm+15,bootCm:profile.footCm===null?0:(Math.round(profile.footCm*10)+10)/10};}
// Only explicit numeric centimetres are eligible. Unknown legacy text is never guessed.
// Case matches ledger_size_key's lexical fold. Retain the existing whitespace
// allowance around a contiguous numeric value and explicit cm unit; never infer units.
export function centimetres(size:string):number|null{const m=/^(\d{1,3}(?:\.\d)?)\s*cm$/i.exec(size.trim());return m?Number(m[1]):null;}
// `preferLonger` (boots): on an equal distance never recommend the smaller size (R67 +1.0 cm rule).
export function rankCandidates<T extends {lengthCm:number}>(all:T[],target:number,preferLonger=false):Record<Direction,T|null>{
 const ordered=all.filter(x=>Math.abs(x.lengthCm-target)<=15).sort((a,b)=>Math.abs(a.lengthCm-target)-Math.abs(b.lengthCm-target)||(preferLonger?b.lengthCm-a.lengthCm:a.lengthCm-b.lengthCm));
 const recommended=ordered[0]??null;
 return {RECOMMENDED:recommended,SHORTER:recommended?[...ordered].filter(x=>x.lengthCm<recommended.lengthCm).sort((a,b)=>b.lengthCm-a.lengthCm)[0]??null:null,LONGER:recommended?[...ordered].filter(x=>x.lengthCm>recommended.lengthCm).sort((a,b)=>a.lengthCm-b.lengthCm)[0]??null:null};
}
/** Boot buckets ranked against the +1.0 cm target; variants sharing one canonical size form one option. */
export function bootOptions(variants:Variant[],family:'SKI_BOOT'|'SNOWBOARD_BOOT',targetCm:number){
 const groups=new Map<string,{label:string;range:NonNullable<ReturnType<typeof bootRange>>;ids:string[]}>();
 for(const v of variants){if(v.family!==family)continue;const r=bootRange(v.size);if(!r||bootDistance(r,targetCm)>BOOT_MAX_DISTANCE_CM+1e-9)continue;const label=canonicalSize(family,v.size);const g=groups.get(label)??{label,range:r,ids:[]};g.ids.push(v.id);groups.set(label,g);}
 return [...groups.values()].sort((a,b)=>compareBootFit(a.range,b.range,targetCm)).map(g=>({...g,ids:g.ids.sort(),lengthCm:Math.min(Math.max(targetCm,g.range.lo),g.range.hi)}));
}
/** Selected families for a member: null = a set; V1.3 one item; V1.4 several. */
export function memberItems(profile:Pick<Profile,'itemFamily'|'items'>):ItemFamily[]|null{return profile.items?.length?profile.items:profile.itemFamily?[profile.itemFamily]:null;}
export function buildMembers(profile:Profile,variants:Variant[],version?:RecommendationInput['contractVersion'],bootChoice=0):{candidates:Candidate[];reason:string|null;bootChoices?:number}{
 const age=profile.adultAtStart?'ADULT':'KIDS';
 const wearItems=profile.wearSelection?[{family:'WEAR_JACKET' as const,variantIds:[profile.wearSelection.jacketVariantId]},{family:'WEAR_PANTS' as const,variantIds:[profile.wearSelection.pantsVariantId]}]:[];
 const wearMember:HoldConditions['members'][number]={key:profile.key,product:'WEAR_SET',age,tier:'STANDARD',wearSport:profile.wearSport??(profile.sport==='SNOWBOARD'?'SNOWBOARD':'SKI'),items:wearItems};
 if(wearItems.some(item=>!variantMatches(wearMember,item,variants.find(v=>v.id===item.variantIds[0]))))throw new RecommendationError('WEAR_VARIANT_MISMATCH');
 if(profile.sport==='WEAR')return {reason:null,candidates:[{lengthCm:0,member:wearMember}]};
 const sport=profile.sport,s=sizing(profile),selected=memberItems(profile);
 const catalog=variants.filter(v=>v.age===age&&v.tier===profile.tier);
 // Premium's promise is the ski/board model; a boot/pole family with no Premium variant comes from the common Regular fit pool.
 const fitPool=variants.filter(v=>v.age===age&&(v.tier===profile.tier||profile.tier==='PREMIUM'&&v.tier==='REGULAR'&&!catalog.some(x=>x.family===v.family)));
 const bootFamily:'SKI_BOOT'|'SNOWBOARD_BOOT'=sport==='SKI'?'SKI_BOOT':'SNOWBOARD_BOOT';
 const wantBoard=!selected||selected.includes(sport),wantBoot=!selected||selected.includes(bootFamily),wantPole=sport==='SKI'&&(!selected||selected.includes('POLE'));
 const options=wantBoot?bootOptions(fitPool,bootFamily,s.bootCm):[];
 if(wantBoot&&!options.length)return {candidates:[],reason:'BOOT_SIZE_NOT_FOUND'};
 const boot=options[Math.min(bootChoice,options.length-1)];
 const poles=fitPool.filter(v=>v.family==='POLE'&&lengthCm(v.size)!==null);
 const suggested=profile.heightCm===null?null:suggestPole(profile.heightCm,poles.map(v=>lengthCm(v.size)!));
 const pole=wantPole?(atLeastV13(version)?poles.filter(v=>lengthCm(v.size)===suggested).sort((a,b)=>a.id.localeCompare(b.id))[0]:fitPool.find(v=>v.family==='POLE'&&v.id===profile.poleVariantId)):null;
 if(sport==='SKI'&&!selected&&!atLeastV13(version)&&!pole)throw new RecommendationError('POLE_VARIANT_MISMATCH');
 // A set's pole is a V1.3 accessory (may be empty); an individual pole must name real capacity.
 if(selected&&wantPole&&!pole)return {reason:'INSUFFICIENT',candidates:[]};
 const poleItem={family:'POLE' as const,variantIds:pole?[pole.id]:[]};
 const member=(items:HoldConditions['members'][number]['items']):HoldConditions['members'][number]=>({key:profile.key,product:selected?'SINGLE':sport==='SKI'?'SKI_SET':'SNOWBOARD_SET',age,tier:profile.tier,...(wearItems.length?{wear:true}:{}),items:[...items,...wearItems]});
 const extras=(withBoot:typeof boot|undefined)=>[...(wantBoot&&withBoot?[{family:bootFamily,variantIds:withBoot.ids}]:[]),...(wantPole?[poleItem]:[])];
 if(!wantBoard){
  if(wantBoot)return {reason:null,bootChoices:1,candidates:options.slice(0,3).map(o=>({lengthCm:o.lengthCm,sizeLabel:o.label,member:member(extras(o))}))};
  return pole?{reason:null,candidates:[{lengthCm:lengthCm(pole.size)!,sizeLabel:canonicalSize('POLE',pole.size),member:member(extras(undefined))}]}:{reason:'INSUFFICIENT',candidates:[]};
 }
 const boards=catalog.filter(v=>v.family===sport&&(!profile.modelSelection||v.model_id===profile.modelSelection.modelId&&v.catalog_season===profile.modelSelection.season)&&lengthCm(v.size)!==null&&Math.abs(lengthCm(v.size)!-s.targetCm)<=15);
 const lengths=[...new Set(boards.map(v=>lengthCm(v.size)!))].sort((a,b)=>a-b);
 if(lengths.length>32||(boot?.ids.length??0)>6||lengths.some(n=>boards.filter(v=>lengthCm(v.size)===n).length>6))return {candidates:[],reason:'INDETERMINATE_CATALOG_LIMIT'};
 return {reason:lengths.length?null:'NO_CATALOG_LENGTH',bootChoices:options.length,candidates:lengths.map(n=>({lengthCm:n,sizeLabel:n+' cm',member:member([{family:sport,variantIds:boards.filter(v=>lengthCm(v.size)===n).map(v=>v.id).sort(),...(profile.modelSelection?{modelPromise:{...profile.modelSelection,variantId:boards.find(v=>lengthCm(v.size)===n)!.id}}:{})},...extras(boot)])}))};
}
