-- Optional presentation metadata only. No stock, allocation, pricing or payment grants.
-- Bytes and immutable revision/release records remain in the existing content subsystem.
CREATE TABLE avatar_visuals (
 id uuid PRIMARY KEY,
 layer text NOT NULL CHECK(layer IN ('AVATAR','SKI','BOOT','JACKET','PANTS')),
 avatar_type text CHECK(avatar_type IN ('APPEARANCE_1','APPEARANCE_2')),
 match_kind text NOT NULL CHECK(match_kind IN ('EXACT_PROMISE','GENERIC_REFERENCE')),
 model_id uuid REFERENCES ledger_models(id),
 variant_id uuid REFERENCES ledger_variants(id),
 season text,
 ski_length_cm double precision,
 media_id text NOT NULL CHECK(media_id ~ '^[A-Za-z0-9_-]{1,100}$'),
 derivative_sha256 text NOT NULL REFERENCES content_media_objects(sha256),
 revision_id uuid NOT NULL REFERENCES content_revision_records(id),
 release_id uuid NOT NULL REFERENCES content_outbox(release_id),
 state text NOT NULL DEFAULT 'DISABLED' CHECK(state IN ('ACTIVE','DISABLED')),
 sort_order integer NOT NULL DEFAULT 0 CHECK(sort_order BETWEEN 0 AND 9999),
 anchor_x double precision NOT NULL DEFAULT 0.5 CHECK(anchor_x BETWEEN 0 AND 1),
 anchor_y double precision NOT NULL DEFAULT 1 CHECK(anchor_y BETWEEN 0 AND 1),
 position_x double precision NOT NULL DEFAULT 0.5 CHECK(position_x BETWEEN 0 AND 1),
 position_y double precision NOT NULL DEFAULT 1 CHECK(position_y BETWEEN 0 AND 1),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((layer='AVATAR' AND avatar_type IS NOT NULL) OR (layer<>'AVATAR' AND avatar_type IS NULL)),
 CHECK((match_kind='GENERIC_REFERENCE' AND model_id IS NULL AND variant_id IS NULL AND season IS NULL AND ski_length_cm IS NULL)
   OR (match_kind='EXACT_PROMISE' AND layer='SKI' AND model_id IS NOT NULL AND variant_id IS NOT NULL
       AND season IS NOT NULL AND season ~ '^20[0-9]{2}/[0-9]{2}$'
       AND ski_length_cm IS NOT NULL AND ski_length_cm>0 AND ski_length_cm<'Infinity'::double precision))
);
-- One active visual per presentation/promise slot, including NULL generic references.
-- Disabled historical alternatives may coexist. No random/default tie breaking.
CREATE UNIQUE INDEX avatar_visual_active_slot ON avatar_visuals
 (layer,avatar_type,model_id,variant_id,season,ski_length_cm) NULLS NOT DISTINCT WHERE state='ACTIVE';
CREATE FUNCTION avatar_visual_variant_matches(model uuid,variant uuid,season text,length_cm double precision)
RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM ledger_variants v JOIN ledger_models m ON m.id=v.model_id
 WHERE v.id=variant AND v.model_id=model AND v.family='SKI' AND m.family='SKI'
 AND m.catalog_season=season AND v.tier='PREMIUM'
 AND ((regexp_match(btrim(v.size),'^([0-9]{1,3}(\.[0-9])?)\s*cm$','i'))[1])::double precision=length_cm)
$$;
CREATE FUNCTION avatar_visual_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF NEW.id<>OLD.id OR NEW.created_at<>OLD.created_at THEN RAISE EXCEPTION 'Immutable visual identity';END IF;
  NEW.updated_at:=clock_timestamp();
 END IF;
 IF NEW.match_kind='EXACT_PROMISE' AND NOT avatar_visual_variant_matches(NEW.model_id,NEW.variant_id,NEW.season,NEW.ski_length_cm)
 THEN RAISE EXCEPTION 'Visual variant promise mismatch' USING ERRCODE='23514';END IF;
 RETURN NEW;
END$$;
CREATE TRIGGER avatar_visual_metadata_guard BEFORE INSERT OR UPDATE ON avatar_visuals FOR EACH ROW EXECUTE FUNCTION avatar_visual_guard();
REVOKE ALL ON avatar_visuals FROM PUBLIC;
REVOKE ALL ON FUNCTION avatar_visual_guard(),avatar_visual_variant_matches(uuid,uuid,text,double precision) FROM PUBLIC;
