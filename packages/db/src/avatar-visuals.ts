import type {Pool} from 'pg';
import type {VisualMetadata} from '../../contracts/src/avatar-visualization';
import type {AvatarVisualReader} from '../../core/src/avatar/visualization';
// Single SELECT against one statement snapshot. Neither this repository nor the mapper
// publishes media. Future byte serving must reauthorize current rights/release again.
export class PostgresAvatarVisuals implements AvatarVisualReader{
 constructor(private pool:Pick<Pool,'query'>){}
 async read(variantIds:readonly string[],now:Date):Promise<VisualMetadata[]>{
  if(variantIds.length>3||!Number.isFinite(now.getTime()))return [];
  const rows=(await this.pool.query(`
   SELECT v.*,media.value->>'rightsUntil' AS rights_until
   FROM avatar_visuals v
   JOIN content_revision_records revision ON revision.id=v.revision_id
   JOIN content_outbox outbox ON outbox.release_id=v.release_id
   JOIN content_workspace workspace ON workspace.id=true
   JOIN LATERAL jsonb_array_elements(workspace.value->'catalog'->'releases') release(value)
    ON release.value->>'id'=v.release_id::text AND workspace.value->'catalog'->>'current'=v.release_id::text
   JOIN LATERAL jsonb_array_elements(workspace.value->'catalog'->'revisions') current_revision(value)
    ON current_revision.value=revision.payload AND current_revision.value->>'id'=v.revision_id::text
   JOIN LATERAL jsonb_array_elements(workspace.value->'catalog'->'media') media(value) ON media.value->>'id'=v.media_id
   WHERE v.state='ACTIVE' AND (v.match_kind='GENERIC_REFERENCE' OR v.variant_id=ANY($1::uuid[]))
    AND (v.match_kind='GENERIC_REFERENCE' OR avatar_visual_variant_matches(v.model_id,v.variant_id,v.season,v.ski_length_cm))
    AND release.value->'entries' ? v.revision_id::text AND revision.payload->'mediaIds' ? v.media_id
    AND media.value->'processed'='true'::jsonb AND media.value->'rightsConfirmed'='true'::jsonb
    AND media.value->'internalOnly'='false'::jsonb AND media.value->>'immutableSha256'=v.derivative_sha256
    AND (media.value->'rightsUntil'='null'::jsonb OR (media.value->>'rightsUntil')::timestamptz>$2::timestamptz)
    AND revision.payload->'avatarVisualUses' @> jsonb_build_array(jsonb_build_object(
     'purpose','AVATAR_VISUALIZATION_V1','visualId',v.id::text,'layer',v.layer,'avatarType',v.avatar_type,
     'match',v.match_kind,'modelId',v.model_id::text,'variantId',v.variant_id::text,'season',v.season,
     'skiLengthCm',v.ski_length_cm,'mediaId',v.media_id,'derivativeSha256',v.derivative_sha256))
   ORDER BY v.sort_order,v.id LIMIT 17`,[[...new Set(variantIds)],now.toISOString()])).rows;
  // The largest request is two body types + four generic layers + three exact skis.
  // Duplicated/corrupt catalog JSON cannot silently create an arbitrary winner.
  if(rows.length>9||new Set(rows.map(r=>r.id)).size!==rows.length)return [];
  return rows.map(r=>({id:r.id,layer:r.layer,avatarType:r.avatar_type,match:r.match_kind,modelId:r.model_id,variantId:r.variant_id,season:r.season,skiLengthCm:r.ski_length_cm,mediaId:r.media_id,derivativeSha256:r.derivative_sha256,revisionId:r.revision_id,releaseId:r.release_id,state:r.state,sortOrder:r.sort_order,anchor:{x:r.anchor_x,y:r.anchor_y},position:{x:r.position_x,y:r.position_y},rightsEligible:true,rightsUntil:r.rights_until}));
 }
}
