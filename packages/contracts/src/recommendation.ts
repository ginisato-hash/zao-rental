import Ajv from 'ajv';
import schema from './recommendation-input.schema.json';
import {HoldError,normalizePeriod,type HoldConditions,type Period,type Feasibility} from './hold';
import type {StoreId} from './ledger';
export const RECOMMENDATION_RULE='HEIGHT_MINUS_20_WINDOW_15_BOOT_PLUS_1_V1' as const;
export const MODEL_POLICY='EXPLICIT_SIZE_CLASS_NO_MODEL_PROMISE_V1' as const;
export const DIRECTIONS=['RECOMMENDED','SHORTER','LONGER'] as const;
export type Direction=typeof DIRECTIONS[number];
export type Profile={key:string;sport:'SKI'|'SNOWBOARD';heightCm:number;footCm:number;adultAtStart:boolean;tier:'REGULAR'|'PREMIUM';ski:{weightKg:number;ageAtStart:number;level:'BEGINNER'|'INTERMEDIATE'|'ADVANCED'}|null;poleVariantId:string|null};
export type RecommendationInput={pickupStore:StoreId;returnStore:StoreId;period:Period;members:Profile[]};
export type Variant={id:string;family:string;age:string;tier:string;size:string};
export type Candidate={lengthCm:number;member:HoldConditions['members'][number]};
export type MemberRecommendation={key:string;targetCm:number;minCm:number;maxCm:number;bootCm:number;initialLengthCm:number|null;candidates:Record<Direction,Candidate|null>;checks:{lengthCm:number;result:Feasibility}[];reason:string|null;price:Record<string,unknown>|null;priceError:string|null};
export class RecommendationError extends HoldError{}
const validate=new Ajv({allErrors:false,multipleOfPrecision:10}).compile(schema);
export function parseRecommendation(value:unknown):RecommendationInput{
 if(!validate(value))throw new RecommendationError('INVALID_RECOMMENDATION_INPUT');const x=value as RecommendationInput;normalizePeriod(x.period);
 if(new Set(x.members.map(m=>m.key)).size!==x.members.length)throw new RecommendationError('DUPLICATE_MEMBER');
 for(const m of x.members){if(m.tier==='PREMIUM'&&!m.adultAtStart)throw new RecommendationError('PRODUCT_NOT_OFFERED');if(m.sport==='SKI'){if(!m.ski||!m.poleVariantId||m.adultAtStart!==(m.ski.ageAtStart>=13))throw new RecommendationError('SKI_PROFILE_OR_AGE_MISMATCH');}else if(m.ski!==null||m.poleVariantId!==null)throw new RecommendationError('UNNECESSARY_SNOWBOARD_INPUT');}
 return x;
}
export function sizing(profile:Pick<Profile,'heightCm'|'footCm'>){const targetCm=profile.heightCm-20;return {targetCm,minCm:targetCm-15,maxCm:targetCm+15,bootCm:(Math.round(profile.footCm*10)+10)/10};}
// Only explicit numeric centimetres are eligible. Unknown legacy text is never guessed.
export function centimetres(size:string):number|null{const m=/^(\d{1,3}(?:\.\d)?)\s*cm$/.exec(size.trim());return m?Number(m[1]):null;}
export function rankCandidates<T extends {lengthCm:number}>(all:T[],target:number):Record<Direction,T|null>{
 const ordered=all.filter(x=>Math.abs(x.lengthCm-target)<=15).sort((a,b)=>Math.abs(a.lengthCm-target)-Math.abs(b.lengthCm-target)||a.lengthCm-b.lengthCm);
 const recommended=ordered[0]??null;
 return {RECOMMENDED:recommended,SHORTER:recommended?[...ordered].filter(x=>x.lengthCm<recommended.lengthCm).sort((a,b)=>b.lengthCm-a.lengthCm)[0]??null:null,LONGER:recommended?[...ordered].filter(x=>x.lengthCm>recommended.lengthCm).sort((a,b)=>a.lengthCm-b.lengthCm)[0]??null:null};
}
export function buildMembers(profile:Profile,variants:Variant[]):{candidates:Candidate[];reason:string|null}{
 const s=sizing(profile),age=profile.adultAtStart?'ADULT':'KIDS';const catalog=variants.filter(v=>v.age===age&&v.tier===profile.tier);
 const bootFamily=profile.sport==='SKI'?'SKI_BOOT':'SNOWBOARD_BOOT';const boots=catalog.filter(v=>v.family===bootFamily&&centimetres(v.size)===s.bootCm).map(v=>v.id).sort();
 if(!boots.length)return {candidates:[],reason:'BOOT_SIZE_NOT_FOUND'};
 const pole=profile.sport==='SKI'?catalog.find(v=>v.family==='POLE'&&v.id===profile.poleVariantId):null;
 if(profile.sport==='SKI'&&!pole)throw new RecommendationError('POLE_VARIANT_MISMATCH');
 const boards=catalog.filter(v=>v.family===profile.sport&&centimetres(v.size)!==null&&Math.abs(centimetres(v.size)!-s.targetCm)<=15);
 const lengths=[...new Set(boards.map(v=>centimetres(v.size)!))].sort((a,b)=>a-b);
 if(lengths.length>32||boots.length>6||lengths.some(n=>boards.filter(v=>centimetres(v.size)===n).length>6))return {candidates:[],reason:'INDETERMINATE_CATALOG_LIMIT'};
 return {reason:lengths.length?null:'NO_CATALOG_LENGTH',candidates:lengths.map(lengthCm=>({lengthCm,member:{key:profile.key,product:profile.sport==='SKI'?'SKI_SET':'SNOWBOARD_SET',age,tier:profile.tier,items:[{family:profile.sport,variantIds:boards.filter(v=>centimetres(v.size)===lengthCm).map(v=>v.id).sort()},{family:bootFamily,variantIds:boots},...(pole?[{family:'POLE' as const,variantIds:[pole.id]}]:[])]}}))};
}
