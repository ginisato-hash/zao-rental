import type {Profile,MemberRecommendation} from '../../packages/contracts/src/recommendation';
import type {AvatarVisualUse,VisualMetadata} from '../../packages/contracts/src/avatar-visualization';
export const id=(n:number)=>'31000000-0000-4000-8000-'+String(n).padStart(12,'0');
export const now=new Date('2035-01-01T00:00:00Z');
export function recommendation(){
 const profile:Profile={key:'synthetic-avatar',sport:'SKI',heightCm:170,footCm:25.5,adultAtStart:true,tier:'REGULAR',ski:{weightKg:60,ageAtStart:30,level:'BEGINNER'},poleVariantId:id(9)};
 const candidate=(lengthCm:number)=>({lengthCm,member:{key:profile.key,product:'SKI_SET' as const,age:'ADULT' as const,tier:'REGULAR' as const,items:[{family:'SKI' as const,variantIds:[id(10)]},{family:'SKI_BOOT' as const,variantIds:[id(11),id(12)]},{family:'POLE' as const,variantIds:[id(9)]}]}});
 const result:MemberRecommendation={key:profile.key,targetCm:150,minCm:135,maxCm:165,bootCm:26.5,initialLengthCm:159,candidates:{RECOMMENDED:candidate(159),SHORTER:candidate(157),LONGER:candidate(161)},checks:[],reason:null,price:{totalJpy:7500},priceError:null};
 return {profile,recommendation:result};
}
export function visual(n=1,changes:Partial<VisualMetadata>={}):VisualMetadata{return {id:id(n),layer:'SKI',avatarType:null,match:'GENERIC_REFERENCE',modelId:null,variantId:null,season:null,skiLengthCm:null,mediaId:'synthetic-media',derivativeSha256:'a'.repeat(64),revisionId:id(90),releaseId:id(91),state:'ACTIVE',sortOrder:n,anchor:{x:0.5,y:1},position:{x:0.5,y:1},rightsEligible:true,rightsUntil:null,...changes};}
export function visualGrant(v:VisualMetadata):AvatarVisualUse{return {purpose:'AVATAR_VISUALIZATION_V1',visualId:v.id,layer:v.layer,avatarType:v.avatarType,match:v.match,modelId:v.modelId,variantId:v.variantId,season:v.season,skiLengthCm:v.skiLengthCm,mediaId:v.mediaId,derivativeSha256:v.derivativeSha256};}
