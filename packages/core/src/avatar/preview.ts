import type {Pool} from 'pg';
import type {StaffPrincipal} from '../../../auth/src/staff-auth';
import {authorizeBookingActor} from '../../../auth/src/booking-actor';
import {HoldError} from '../../../contracts/src/hold';
import {AVATAR_TYPES} from '../../../contracts/src/avatar-visualization';
import type {AvatarType,AvatarVisualizationV1} from '../../../contracts/src/avatar-visualization';
import type {RecommendationInput,MemberRecommendation} from '../../../contracts/src/recommendation';
import {mapAvatarVisualization,type AvatarVisualReader} from './visualization';
export type AvatarPreviewPayloads=Record<AvatarType,AvatarVisualizationV1|null>;
/** Read an existing owned recommendation only. Never invoke preview/select/resume. */
export async function loadAvatarPreview(pool:Pick<Pool,'query'>,principal:StaffPrincipal,previewId:string,memberKey:string,reader:AvatarVisualReader,now:Date):Promise<AvatarPreviewPayloads>{
 const permissions=['BOOKING_VIEW','HOLD_VIEW','QUOTE_VIEW'];await authorizeBookingActor(pool,principal,permissions);
 const row=(await pool.query<{input:RecommendationInput;offered:MemberRecommendation[]}>('SELECT input,offered FROM recommendation_previews WHERE id=$1 AND owner_id=$2',[previewId,principal.subject])).rows[0];
 if(!row)throw new HoldError('FORBIDDEN',403);
 await authorizeBookingActor(pool,principal,permissions,[row.input.pickupStore,row.input.returnStore]);
 const profile=row.input.members.find(p=>p.key===memberKey),recommendation=row.offered.find(p=>p.key===memberKey);
 if(!profile||!recommendation)throw new HoldError('FORBIDDEN',403);
 let metadata:Awaited<ReturnType<AvatarVisualReader['read']>>=[];
 try{const variants=[...new Set(Object.values(recommendation.candidates).flatMap(c=>c?.member.items.flatMap(i=>i.family==='SKI'&&i.modelPromise?[i.modelPromise.variantId]:[])??[]))];metadata=await reader.read(variants,now);}catch{/* Optional visuals unavailable, business/auth errors remain outside this catch. */}
 await authorizeBookingActor(pool,principal,permissions,[row.input.pickupStore,row.input.returnStore]);
 return Object.fromEntries(AVATAR_TYPES.map(type=>[type,mapAvatarVisualization(recommendation,profile,metadata,now,type)])) as AvatarPreviewPayloads;
}
