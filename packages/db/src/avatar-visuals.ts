import type {Pool} from 'pg';
import type {VisualMetadata} from '../../contracts/src/avatar-visualization';
import type {AvatarVisualReader} from '../../core/src/avatar/visualization';
// Narrow view/function surface: no workspace JSON or raw media-object SELECT.
export class PostgresAvatarVisuals implements AvatarVisualReader{
 constructor(private pool:Pick<Pool,'query'>){}
 async read(variantIds:readonly string[],now:Date):Promise<VisualMetadata[]>{
  return this.eligible(variantIds,now,null);
 }
 async findForDelivery(visualId:string,digest:string,now:Date):Promise<VisualMetadata|null>{
  const rows=await this.eligible([],now,visualId);
  return rows.length===1&&rows[0]!.derivativeSha256===digest?rows[0]!:null;
 }
 async readBytes(id:string,digest:string):Promise<Buffer|null>{
  return (await this.pool.query('SELECT avatar_visual_derivative($1::uuid,$2::text) AS bytes',[id,digest])).rows[0]?.bytes??null;
 }
 private async eligible(variantIds:readonly string[],now:Date,visualId:string|null):Promise<VisualMetadata[]>{
  if(variantIds.length>3||!Number.isFinite(now.getTime()))return [];
  const rows=(await this.pool.query(`
   SELECT v.* FROM avatar_current_visuals v
   WHERE (($3::uuid IS NULL AND (v.match_kind='GENERIC_REFERENCE' OR v.variant_id=ANY($1::uuid[]))) OR v.id=$3::uuid)
    AND (v.rights_until IS NULL OR v.rights_until>$2::timestamptz)
   ORDER BY v.sort_order,v.id LIMIT 17`,[[...new Set(variantIds)],now.toISOString(),visualId])).rows;
  // The largest request is two body types + four generic layers + three exact skis.
  // Duplicated/corrupt catalog JSON cannot silently create an arbitrary winner.
  if(rows.length>9||new Set(rows.map(r=>r.id)).size!==rows.length)return [];
  return rows.map(r=>({id:r.id,layer:r.layer,avatarType:r.avatar_type,match:r.match_kind,modelId:r.model_id,variantId:r.variant_id,season:r.season,skiLengthCm:r.ski_length_cm,mediaId:r.media_id,derivativeSha256:r.derivative_sha256,revisionId:r.revision_id,releaseId:r.release_id,state:r.state,sortOrder:r.sort_order,anchor:{x:r.anchor_x,y:r.anchor_y},position:{x:r.position_x,y:r.position_y},rightsEligible:true,rightsUntil:r.rights_until instanceof Date?r.rights_until.toISOString():r.rights_until}));
 }
}
