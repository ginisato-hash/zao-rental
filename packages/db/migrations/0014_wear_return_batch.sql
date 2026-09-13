-- Saved quantity return candidates refer to immutable loan cycles, never garments.
CREATE TABLE wear_return_batches(
 id uuid PRIMARY KEY,store_id text NOT NULL REFERENCES ledger_stores(id),actor text NOT NULL REFERENCES staff_members(id),
 items jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(items)='array' AND jsonb_array_length(items)<=100),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),revision integer NOT NULL DEFAULT 1 CHECK(revision>0)
);
CREATE FUNCTION wear_batch_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Return batch evidence retained';END IF;
 IF coalesce(current_setting('zao.actor',true),'')='' OR coalesce(current_setting('zao.reason',true),'')='' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Trusted return batch audit required';END IF;
 IF TG_OP='UPDATE' THEN
  IF (to_jsonb(NEW)-ARRAY['items','revision'])<>(to_jsonb(OLD)-ARRAY['items','revision']) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Immutable batch identity';END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(OLD.items) old_item WHERE old_item->>'state'='RECEIVED' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.items) new_item WHERE new_item=old_item)) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Completed receipt cannot be rewritten';END IF;
  NEW.revision:=OLD.revision+1;
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER wear_batch_lock BEFORE INSERT OR UPDATE OR DELETE ON wear_return_batches FOR EACH STATEMENT EXECUTE FUNCTION inventory_lock();
CREATE TRIGGER wear_batch_guard BEFORE INSERT OR UPDATE OR DELETE ON wear_return_batches FOR EACH ROW EXECUTE FUNCTION wear_batch_guard();
CREATE TRIGGER wear_batch_audit AFTER INSERT OR UPDATE ON wear_return_batches FOR EACH ROW EXECUTE FUNCTION wear_audit();
REVOKE ALL ON FUNCTION wear_batch_guard() FROM PUBLIC;
