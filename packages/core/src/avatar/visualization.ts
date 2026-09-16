import {DIRECTIONS,type Candidate,type MemberRecommendation,type Profile} from '../../../contracts/src/recommendation';
import {AVATAR_TYPES,type AvatarType,type AvatarVisualizationV1,type VisualLayer,type VisualMetadata,type VisualRef} from '../../../contracts/src/avatar-visualization';
export const AVATAR_DISCLAIMER='相対的な見た目の参考です。適合・安全・在庫・モデル確約・予約成立・決済完了を保証しません。';
const positive=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n)&&n>0;
const normalized=(n:number)=>Number.isFinite(n)&&n>=0&&n<=1;
const ref=(v:VisualMetadata):VisualRef=>({id:v.id,layer:v.layer,match:v.match,derivativeSha256:v.derivativeSha256,revisionId:v.revisionId,releaseId:v.releaseId,anchor:{...v.anchor},position:{...v.position}});
// Deliberately no service, query, clock, provider, URL generation or business write.
export function mapAvatarVisualization(recommendation:MemberRecommendation,profile:Profile,metadata:readonly VisualMetadata[],now:Date,avatarType?:AvatarType):AvatarVisualizationV1|null{
 if(recommendation.key!==profile.key||!Number.isFinite(now.getTime())||profile.sport==='SNOWBOARD'||profile.sport==='SKI'&&!positive(profile.heightCm))return null;
 const offered=DIRECTIONS.flatMap(d=>recommendation.candidates[d]?[recommendation.candidates[d]!]:[]).filter(c=>c.member.key===profile.key&&c.member.product===(profile.sport==='WEAR'?'WEAR_SET':'SKI_SET'));
 if(!offered.length)return null;
 const valid=metadata.filter(v=>v.state==='ACTIVE'&&v.rightsEligible&&/^[a-f0-9]{64}$/.test(v.derivativeSha256)
  &&[v.anchor.x,v.anchor.y,v.position.x,v.position.y].every(normalized)
  &&(v.rightsUntil===null||Number.isFinite(Date.parse(v.rightsUntil))&&Date.parse(v.rightsUntil)>now.getTime()));
 // The DB prevents active slot ambiguity; malformed injected snapshots also fail closed.
 const unique=(rows:VisualMetadata[])=>rows.length===1?rows[0]!:null;
 const generic=(layer:VisualLayer,type:AvatarType|null=null)=>unique(valid.filter(v=>v.layer===layer&&v.avatarType===type&&v.match==='GENERIC_REFERENCE'&&v.modelId===null&&v.variantId===null&&v.season===null&&v.skiLengthCm===null));
 const skiVisual=(candidate:Candidate)=>{
  const ski=candidate.member.items.find(i=>i.family==='SKI'),promise=ski?.modelPromise;
  const exact=candidate.member.tier==='PREMIUM'&&promise&&ski.variantIds.length===1&&ski.variantIds[0]===promise.variantId
   ?unique(valid.filter(v=>v.layer==='SKI'&&v.match==='EXACT_PROMISE'&&v.modelId===promise.modelId&&v.variantId===promise.variantId&&v.season===promise.season&&v.skiLengthCm===candidate.lengthCm)):null;
  return exact??generic('SKI');
 };
 const candidates:AvatarVisualizationV1['candidates']={RECOMMENDED:null,SHORTER:null,LONGER:null};
 for(const direction of DIRECTIONS){const c=recommendation.candidates[direction];if(profile.sport!=='SKI'||!c||!offered.includes(c)||!c.member.items.some(i=>i.family==='SKI')||!positive(c.lengthCm))continue;
  const ratio=c.lengthCm/profile.heightCm!;if(!positive(ratio))continue;const v=skiVisual(c);
  candidates[direction]={skiLengthCm:c.lengthCm,skiToBodyRatio:ratio,visual:v?ref(v):null,fallback:v?.match??null};
 }
 if(profile.sport==='SKI'&&!DIRECTIONS.some(d=>candidates[d]))return null;
 const avatar=avatarType&&AVATAR_TYPES.includes(avatarType)?generic('AVATAR',avatarType):null;
 // Optional layers illustrate existing offered items only, and do not promise a model.
 const familyPresent=(family:string)=>offered.some(c=>c.member.items.some(i=>i.family===family));
 const boot=profile.sport==='SKI'&&familyPresent('SKI_BOOT')?generic('BOOT'):null;
 const jacket=familyPresent('WEAR_JACKET')?generic('JACKET'):null,pants=familyPresent('WEAR_PANTS')?generic('PANTS'):null;
 if(!avatar&&!boot&&!jacket&&!pants&&!DIRECTIONS.some(d=>candidates[d]?.visual))return null;
 return {version:1,...(avatarType&&AVATAR_TYPES.includes(avatarType)?{avatarType}:{}),...(profile.sport==='SKI'?{customerHeightCm:profile.heightCm!}:{}),avatar:avatar?ref(avatar):null,candidates,boot:boot?ref(boot):null,jacket:jacket?ref(jacket):null,pants:pants?ref(pants):null,disclaimer:AVATAR_DISCLAIMER};
}
export interface AvatarVisualReader{read(variantIds:readonly string[],now:Date):Promise<readonly VisualMetadata[]>;}
/** Internal opt-in composition only; no route calls this. Authorize/load business data
 * BEFORE the optional failure boundary. A failed auth/business load remains an error. */
export async function withAvatarVisualization(loadAuthorized:()=>Promise<{recommendation:MemberRecommendation;profile:Profile}>,reader:AvatarVisualReader,now:Date,avatarType?:AvatarType):Promise<MemberRecommendation>{
 const {recommendation,profile}=await loadAuthorized();
 if(profile.sport==='SNOWBOARD'||profile.sport==='SKI'&&!positive(profile.heightCm))return recommendation;
 try{
  const variants=[...new Set(DIRECTIONS.flatMap(d=>recommendation.candidates[d]?.member.items.flatMap(i=>i.family==='SKI'&&i.modelPromise?[i.modelPromise.variantId]:[])??[]))];
  const visual=mapAvatarVisualization(recommendation,profile,await reader.read(variants,now),now,avatarType);
  return visual?{...recommendation,visualization:visual}:recommendation;
 }catch{return recommendation;}
}
