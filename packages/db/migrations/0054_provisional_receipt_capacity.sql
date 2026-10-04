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
  IF v.tier<>(CASE WHEN v.family IN ('WEAR_JACKET','WEAR_PANTS') THEN 'STANDARD' ELSE 'REGULAR' END) THEN
   RAISE EXCEPTION 'PROVISIONAL_RECEIPT_INCOMPATIBLE_TIER' USING ERRCODE='23514';
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

-- A receipt moves supply, not promises. Check the final claim set so an explicit paid
-- amendment can release its provisional claim and create its physical claim atomically.
-- The existing per-variant/per-pool ceilings remain; this additional shared ceiling
-- prevents new physical claims from consuming supply already promised provisionally.
CREATE FUNCTION provisional_receipt_claim_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE f text;a text;s text;t text;capacity bigint;used_all bigint;used_public bigint;
BEGIN
 IF TG_TABLE_NAME='provisional_capacity_claims' THEN
  IF NEW.state<>'ACTIVE' THEN RETURN NEW;END IF;
  SELECT family,age,booking_size INTO f,a,s FROM provisional_capacity_buckets WHERE id=NEW.bucket_id;
 ELSIF TG_TABLE_NAME='inventory_claims' THEN
  IF NOT NEW.active OR NEW.asset_id IS NULL THEN RETURN NEW;END IF;
  SELECT v.family,v.age,v.size,v.tier INTO f,a,s,t FROM ledger_assets x JOIN ledger_variants v ON v.id=x.variant_id WHERE x.id=NEW.asset_id;
  IF t<>'REGULAR' THEN RETURN NEW;END IF;
 ELSE
  IF NOT NEW.active THEN RETURN NEW;END IF;
  SELECT v.family,v.age,v.size INTO f,a,s FROM wear_pools p JOIN ledger_variants v ON v.id=p.variant_id WHERE p.id=NEW.pool_id;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM provisional_capacity_receipts r JOIN provisional_capacity_buckets b ON b.id=r.bucket_id WHERE b.family=f AND b.age=a AND b.booking_size=s) THEN RETURN NEW;END IF;
 PERFORM pg_advisory_xact_lock(71820600);
 SELECT coalesce(sum(q),0) INTO capacity FROM (
  SELECT provisional_capacity_effective_quantity(b.id)::bigint q FROM provisional_capacity_buckets b JOIN provisional_capacity_sources p ON p.id=b.source_id
   WHERE b.active AND b.size_mapping_status='MAPPED' AND p.status='ACTIVE' AND b.family=f AND b.age=a AND b.booking_size=s
  UNION ALL SELECT count(*) FROM ledger_assets x JOIN ledger_variants v ON v.id=x.variant_id WHERE x.status='AVAILABLE' AND v.tier='REGULAR' AND v.family=f AND v.age=a AND v.size=s
  UNION ALL SELECT coalesce(sum(p.ready),0) FROM wear_pools p JOIN ledger_variants v ON v.id=p.variant_id WHERE v.family=f AND v.age=a AND v.size=s
 ) supply;
 SELECT coalesce(sum(q),0),coalesce(sum(q) FILTER(WHERE NOT buffer_override),0) INTO used_all,used_public FROM (
  SELECT c.hold_id,c.quantity::bigint q FROM provisional_capacity_claims c JOIN provisional_capacity_buckets b ON b.id=c.bucket_id
   WHERE c.state='ACTIVE' AND c.day=NEW.day AND b.family=f AND b.age=a AND b.booking_size=s
  UNION ALL SELECT c.hold_id,1 FROM inventory_claims c JOIN ledger_assets x ON x.id=c.asset_id JOIN ledger_variants v ON v.id=x.variant_id
   WHERE c.active AND c.day=NEW.day AND v.tier='REGULAR' AND v.family=f AND v.age=a AND v.size=s
  UNION ALL SELECT c.hold_id,c.quantity FROM wear_claims c JOIN wear_pools p ON p.id=c.pool_id JOIN ledger_variants v ON v.id=p.variant_id
   WHERE c.active AND c.day=NEW.day AND v.family=f AND v.age=a AND v.size=s
    AND NOT EXISTS(SELECT 1 FROM wear_loans l JOIN rental_bookings b ON b.id=l.booking_id WHERE b.hold_id=c.hold_id)
 ) claims JOIN inventory_holds h ON h.id=claims.hold_id
 WHERE h.state='ACTIVE' AND (h.expires_at>inventory_clock() OR h.payment_state IN ('PENDING','UNKNOWN','SUCCESS') OR h.allocation_stage<>'PROVISIONAL');
 IF used_all>capacity OR used_public>floor(capacity*.95) THEN
  RAISE EXCEPTION 'PROVISIONAL_RECEIPT_CAPACITY_RESERVED' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END$$;
REVOKE ALL ON FUNCTION provisional_receipt_claim_guard() FROM PUBLIC;
CREATE CONSTRAINT TRIGGER provisional_receipt_physical_guard AFTER INSERT OR UPDATE ON inventory_claims
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION provisional_receipt_claim_guard();
CREATE CONSTRAINT TRIGGER provisional_receipt_wear_guard AFTER INSERT OR UPDATE ON wear_claims
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION provisional_receipt_claim_guard();
CREATE CONSTRAINT TRIGGER provisional_receipt_provisional_guard AFTER INSERT OR UPDATE ON provisional_capacity_claims
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION provisional_receipt_claim_guard();
