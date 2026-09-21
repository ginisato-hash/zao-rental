-- Phase5: bindings are immutable; only presentation/state can be changed.
-- Additive migration: historical0001–0031 bytes remain unchanged.
CREATE OR REPLACE FUNCTION public.avatar_visual_guard() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF ROW(NEW.id,NEW.layer,NEW.avatar_type,NEW.match_kind,NEW.model_id,NEW.variant_id,
     NEW.season,NEW.ski_length_cm,NEW.media_id,NEW.derivative_sha256,NEW.revision_id,NEW.release_id,NEW.created_at)
   IS DISTINCT FROM ROW(OLD.id,OLD.layer,OLD.avatar_type,OLD.match_kind,OLD.model_id,OLD.variant_id,
     OLD.season,OLD.ski_length_cm,OLD.media_id,OLD.derivative_sha256,OLD.revision_id,OLD.release_id,OLD.created_at)
  THEN RAISE EXCEPTION 'Immutable visual binding' USING ERRCODE='23514'; END IF;
  NEW.updated_at:=clock_timestamp();
 END IF;
 IF NEW.match_kind='EXACT_PROMISE' AND NOT public.avatar_visual_variant_matches(NEW.model_id,NEW.variant_id,NEW.season,NEW.ski_length_cm)
 THEN RAISE EXCEPTION 'Visual variant promise mismatch' USING ERRCODE='23514';END IF;
 RETURN NEW;
END$$;

-- The view owner checks private release/revision/workspace data. Callers get only
-- current eligible visual metadata, never source JSON or original byte privileges.
CREATE VIEW public.avatar_current_visuals WITH (security_barrier=true) AS
SELECT v.*, (media.value->>'rightsUntil')::timestamptz AS rights_until
   FROM public.avatar_visuals v
   JOIN public.content_revision_records revision ON revision.id=v.revision_id
   JOIN public.content_outbox outbox ON outbox.release_id=v.release_id
   JOIN public.content_workspace workspace ON workspace.id=true
   JOIN LATERAL jsonb_array_elements(workspace.value->'catalog'->'releases') release(value)
    ON release.value->>'id'=v.release_id::text AND workspace.value->'catalog'->>'current'=v.release_id::text
   JOIN LATERAL jsonb_array_elements(workspace.value->'catalog'->'revisions') current_revision(value)
    ON current_revision.value=revision.payload AND current_revision.value->>'id'=v.revision_id::text
   JOIN LATERAL jsonb_array_elements(workspace.value->'catalog'->'media') media(value) ON media.value->>'id'=v.media_id
   WHERE v.state='ACTIVE'
    AND (v.match_kind='GENERIC_REFERENCE' OR EXISTS(
      SELECT 1 FROM public.ledger_variants variant JOIN public.ledger_models model ON model.id=variant.model_id
      WHERE variant.id=v.variant_id AND variant.model_id=v.model_id AND variant.family='SKI' AND model.family='SKI'
       AND model.catalog_season=v.season AND variant.tier='PREMIUM'
       AND ((regexp_match(btrim(variant.size),'^([0-9]{1,3}(\.[0-9])?)\s*cm$','i'))[1])::double precision=v.ski_length_cm))
    AND release.value->'entries' ? v.revision_id::text AND revision.payload->'mediaIds' ? v.media_id
    AND media.value->'processed'='true'::jsonb AND media.value->'rightsConfirmed'='true'::jsonb
    AND media.value->'internalOnly'='false'::jsonb AND media.value->>'immutableSha256'=v.derivative_sha256
    AND (media.value->'rightsUntil'='null'::jsonb OR (media.value->>'rightsUntil')::timestamptz>clock_timestamp())
    AND revision.payload->'avatarVisualUses' @> jsonb_build_array(jsonb_build_object(
     'purpose','AVATAR_VISUALIZATION_V1','visualId',v.id::text,'layer',v.layer,'avatarType',v.avatar_type,
     'match',v.match_kind,'modelId',v.model_id::text,'variantId',v.variant_id::text,'season',v.season,
     'skiLengthCm',v.ski_length_cm,'mediaId',v.media_id,'derivativeSha256',v.derivative_sha256));
REVOKE ALL ON public.avatar_current_visuals FROM PUBLIC;

-- Bind bytes to a unique currently eligible visual, not a free digest lookup.
CREATE FUNCTION public.avatar_visual_derivative(visual_id uuid,digest text) RETURNS bytea
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT bytes FROM public.content_media_objects
 WHERE sha256=digest AND octet_length(bytes)<=4194304
  AND (SELECT count(*) FROM public.avatar_current_visuals
       WHERE id=visual_id AND derivative_sha256=digest)=1
$$;
REVOKE ALL ON FUNCTION public.avatar_visual_derivative(uuid,text) FROM PUBLIC;
