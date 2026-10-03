-- Factual receipt is distinct from publication/real_data_acceptance. Bind a staged receipt
-- explicitly to its original provisional source; never infer provenance from a size alone.
-- The commit trigger shares the inventory serialization boundary and rolls back physical
-- inserts if provenance/capacity fails. No additional runtime grants, no 0041 guard removal.
CREATE TABLE provisional_capacity_receipts(
 source_key text PRIMARY KEY REFERENCES ops_import_sources(source_key),
 commit_id uuid NOT NULL REFERENCES ops_import_commits(id),
 bucket_id uuid NOT NULL REFERENCES provisional_capacity_buckets(id),
 quantity integer NOT NULL CHECK(quantity BETWEEN 1 AND 100000),
 actor text NOT NULL REFERENCES staff_members(id),
 created_at timestamptz NOT NULL DEFAULT inventory_clock()
);
CREATE INDEX provisional_capacity_receipts_bucket ON provisional_capacity_receipts(bucket_id);
REVOKE ALL ON provisional_capacity_receipts FROM PUBLIC;
CREATE TRIGGER provisional_capacity_receipts_immutable BEFORE UPDATE OR DELETE ON provisional_capacity_receipts
 FOR EACH ROW EXECUTE FUNCTION pricing_immutable();

CREATE OR REPLACE FUNCTION provisional_capacity_effective_quantity(p_bucket_id uuid) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT b.quantity
  + coalesce((SELECT sum(a.delta)::int FROM provisional_capacity_adjustments a WHERE a.bucket_id=p_bucket_id),0)
  - coalesce((SELECT sum(m.quantity)::int FROM provisional_capacity_materializations m WHERE m.bucket_id=p_bucket_id),0)
  - coalesce((SELECT sum(r.quantity)::int FROM provisional_capacity_receipts r WHERE r.bucket_id=p_bucket_id),0)
 FROM provisional_capacity_buckets b WHERE b.id=p_bucket_id;
$$;

CREATE FUNCTION provisional_capacity_receive_import() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE s ops_import_stages;v_source_id uuid;e jsonb;v ledger_variants;b provisional_capacity_buckets;matches integer;q integer;
BEGIN
 PERFORM pg_advisory_xact_lock(71820600);
 SELECT * INTO STRICT s FROM ops_import_stages WHERE id=NEW.id;
 IF s.actor IS DISTINCT FROM current_setting('zao.actor',true) OR NEW.actor<>s.actor THEN
  RAISE EXCEPTION 'PROVISIONAL_RECEIPT_ACTOR_MISMATCH' USING ERRCODE='42501';
 END IF;
 v_source_id:=(s.stage->>'provisionalSourceId')::uuid;
 IF v_source_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM provisional_capacity_sources p WHERE p.id=v_source_id AND p.status='ACTIVE') THEN
  RAISE EXCEPTION 'PROVISIONAL_RECEIPT_SOURCE_INVALID' USING ERRCODE='23514';
 END IF;
 FOR e IN SELECT entry FROM jsonb_array_elements(s.stage->'plan'->'entries') entry
  JOIN ops_import_sources src ON src.source_key=entry->>'sourceKey' AND src.stage_id=NEW.id
 LOOP
  SELECT * INTO STRICT v FROM ledger_variants WHERE id=(e->'source'->>'variantId')::uuid;
  PERFORM ops_assert_actor('INVENTORY_EDIT',ARRAY[e->'source'->>'storeId'],s.actor);
  IF v.family IN ('POLE','HELMET','SNOWBOARD_BINDING') THEN CONTINUE;END IF;
  IF v_source_id IS NULL THEN
   IF EXISTS(SELECT 1 FROM provisional_capacity_buckets bucket JOIN provisional_capacity_sources p ON p.id=bucket.source_id
    WHERE p.status='ACTIVE' AND bucket.family=v.family AND bucket.age=v.age AND bucket.booking_size=v.size) THEN
    RAISE EXCEPTION 'PROVISIONAL_RECEIPT_SOURCE_REQUIRED' USING ERRCODE='23514';
   END IF;
   CONTINUE;
  END IF;
  SELECT count(*)::int INTO matches FROM provisional_capacity_buckets bucket
   WHERE bucket.source_id=v_source_id AND bucket.family=v.family AND bucket.age=v.age AND bucket.booking_size=v.size AND bucket.size_mapping_status='MAPPED';
  IF matches<>1 THEN RAISE EXCEPTION 'PROVISIONAL_RECEIPT_BUCKET_AMBIGUOUS' USING ERRCODE='23514';END IF;
  SELECT * INTO STRICT b FROM provisional_capacity_buckets bucket WHERE bucket.source_id=v_source_id AND bucket.family=v.family AND bucket.age=v.age AND bucket.booking_size=v.size FOR UPDATE;
  q:=(e->'source'->>'quantity')::integer;
  IF e->'source'->>'sourceKind'<>'SHOP_RECEIPT' OR e->'source'->>'intent'<>'ADD' OR q<1 OR q>provisional_capacity_effective_quantity(b.id) THEN
   RAISE EXCEPTION 'PROVISIONAL_RECEIPT_QUANTITY_INVALID' USING ERRCODE='23514';
  END IF;
  INSERT INTO provisional_capacity_receipts(source_key,commit_id,bucket_id,quantity,actor)
   VALUES(e->>'sourceKey',NEW.id,b.id,q,s.actor);
  -- Existing claims are retained until the normal paid amendment explicitly assigns stock.
  INSERT INTO ops_history(resource,entity_id,actor,event,after_data)
   VALUES('provisional_capacity_bucket',b.id,s.actor,'PROVISIONAL_CAPACITY_RECEIVED',jsonb_build_object('commitId',NEW.id,'sourceId',v_source_id,'quantity',q));
 END LOOP;
 RETURN NEW;
END$$;
REVOKE ALL ON FUNCTION provisional_capacity_receive_import() FROM PUBLIC;
CREATE TRIGGER provisional_capacity_receive_import AFTER INSERT ON ops_import_commits
 FOR EACH ROW EXECUTE FUNCTION provisional_capacity_receive_import();
