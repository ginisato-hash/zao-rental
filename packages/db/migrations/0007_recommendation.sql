-- Advisory previews and durable orchestration only; no second inventory or price authority.
CREATE TABLE recommendation_previews (
 id uuid PRIMARY KEY, owner_id text NOT NULL REFERENCES staff_members(id), request_key uuid NOT NULL,
 fingerprint text NOT NULL CHECK(length(fingerprint)=64), rule_version text NOT NULL,
 model_policy text NOT NULL, input jsonb NOT NULL, offered jsonb NOT NULL,
 reservation_id uuid NOT NULL, replacement_hold_id uuid REFERENCES inventory_holds(id), replacement_version integer,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(owner_id,request_key), CHECK((replacement_hold_id IS NULL)=(replacement_version IS NULL))
);
CREATE INDEX recommendation_previews_owner ON recommendation_previews(owner_id,created_at DESC,id);
CREATE TABLE recommendation_selections (
 preview_id uuid PRIMARY KEY REFERENCES recommendation_previews(id), owner_id text NOT NULL REFERENCES staff_members(id),
 request_key uuid NOT NULL, fingerprint text NOT NULL CHECK(length(fingerprint)=64), selection jsonb NOT NULL,
 conditions jsonb NOT NULL, hold_key uuid NOT NULL UNIQUE, quote_key uuid NOT NULL UNIQUE,
 hold_id uuid REFERENCES inventory_holds(id), quote_id uuid REFERENCES price_quotes(id),
 stage text NOT NULL DEFAULT 'INTENT' CHECK(stage IN ('INTENT','HOLD_FAILED','HOLD_SAVED','COMPLETE')),
 outcome text, created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(owner_id,request_key), CHECK(stage<>'COMPLETE' OR (hold_id IS NOT NULL AND quote_id IS NOT NULL))
);
CREATE TABLE recommendation_history (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, preview_id uuid NOT NULL REFERENCES recommendation_previews(id),
 actor text NOT NULL, stage text NOT NULL, occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE FUNCTION recommendation_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'append-only recommendation evidence' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='recommendation_previews' AND TG_OP='UPDATE' THEN RAISE EXCEPTION 'immutable preview' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND (to_jsonb(NEW)-ARRAY['hold_id','quote_id','stage','outcome','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['hold_id','quote_id','stage','outcome','updated_at']) THEN RAISE EXCEPTION 'immutable selected conditions' USING ERRCODE='23514'; END IF;
 IF NEW.owner_id IS DISTINCT FROM nullif(current_setting('zao.actor',true),'') THEN RAISE EXCEPTION 'actor required' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER recommendation_preview_guard BEFORE INSERT OR UPDATE OR DELETE ON recommendation_previews FOR EACH ROW EXECUTE FUNCTION recommendation_guard();
CREATE TRIGGER recommendation_selection_guard BEFORE INSERT OR UPDATE OR DELETE ON recommendation_selections FOR EACH ROW EXECUTE FUNCTION recommendation_guard();
CREATE FUNCTION recommendation_log() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN INSERT INTO recommendation_history(preview_id,actor,stage) VALUES(NEW.preview_id,NEW.owner_id,NEW.stage); RETURN NEW; END $$;
CREATE TRIGGER recommendation_selection_log AFTER INSERT OR UPDATE ON recommendation_selections FOR EACH ROW EXECUTE FUNCTION recommendation_log();
REVOKE ALL ON FUNCTION recommendation_guard(),recommendation_log() FROM PUBLIC;
