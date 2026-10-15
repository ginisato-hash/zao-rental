-- R67 provisional catalog bridge. Additive only: 0001-0057 are not rewritten.
-- 1. A canonical size comparison boundary, so Source A "145" / Source B "145 cm" and boot
--    shells "25/25.5" match catalog sizes without editing any source evidence string.
-- 2. POLE becomes a provisional-capacity family (R67 supplemental source; never ledger_poles).
-- 3. Catalog models created from accepted provisional capacity are explicitly marked as
--    booking selectors, not received physical stock. No ledger_assets/ledger_poles are created.
-- 4. Premium model promises bind to the exact provisional bucket(s) of that model/length and
--    consume only that binding; Regular demand shares the same bucket ceiling (single-counted).

CREATE FUNCTION provisional_size_key(p_family text,p_size text) RETURNS text
LANGUAGE plpgsql IMMUTABLE STRICT SET search_path=pg_catalog AS $$
DECLARE m text[];lo numeric;hi numeric;s text:=btrim(p_size);
BEGIN
 IF p_family IN ('SKI','SNOWBOARD','POLE') THEN
  m:=regexp_match(s,'^([0-9]{2,3})(\.0)?[[:space:]]*(cm)?$','i');
  IF m IS NULL THEN RETURN s;END IF;
  RETURN m[1]::integer::text||' cm';
 ELSIF p_family IN ('SKI_BOOT','SNOWBOARD_BOOT') THEN
  m:=regexp_match(s,'^([0-9]{1,2}(\.[05])?)([[:space:]]*/[[:space:]]*([0-9]{1,2}(\.[05])?))?[[:space:]]*(cm)?$','i');
  IF m IS NULL THEN RETURN s;END IF;
  lo:=m[1]::numeric;hi:=coalesce(m[4]::numeric,lo);
  IF hi<lo OR hi-lo>1 THEN RETURN s;END IF;
  RETURN trim_scale(lo)::text||CASE WHEN hi<>lo THEN '/'||trim_scale(hi)::text ELSE '' END||' cm';
 END IF;
 RETURN s;
END$$;

ALTER TABLE provisional_capacity_buckets DROP CONSTRAINT provisional_capacity_buckets_family_check;
ALTER TABLE provisional_capacity_buckets ADD CONSTRAINT provisional_capacity_buckets_family_check
 CHECK(family IN ('SKI','SNOWBOARD','SKI_BOOT','SNOWBOARD_BOOT','POLE','WEAR_JACKET','WEAR_PANTS'));

ALTER TABLE ledger_models ADD COLUMN catalog_role text NOT NULL DEFAULT 'PHYSICAL'
 CHECK(catalog_role IN ('PHYSICAL','PROVISIONAL_BOOKING_SELECTOR'));
COMMENT ON COLUMN ledger_models.catalog_role IS 'PROVISIONAL_BOOKING_SELECTOR: sellable against accepted provisional capacity only; not received physical stock. Handoff stays blocked until materialized.';

CREATE TABLE provisional_model_bindings(
 variant_id uuid NOT NULL REFERENCES ledger_variants(id),
 bucket_id uuid NOT NULL REFERENCES provisional_capacity_buckets(id),
 quantity integer NOT NULL CHECK(quantity BETWEEN 1 AND 100000),
 provenance text NOT NULL CHECK(length(provenance) BETWEEN 1 AND 300),
 actor text NOT NULL REFERENCES staff_members(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(variant_id,bucket_id)
);
REVOKE ALL ON provisional_model_bindings FROM PUBLIC;
CREATE TRIGGER provisional_model_bindings_immutable BEFORE UPDATE OR DELETE ON provisional_model_bindings
 FOR EACH ROW EXECUTE FUNCTION pricing_immutable();
CREATE TRIGGER provisional_model_bindings_lock BEFORE INSERT ON provisional_model_bindings
 FOR EACH STATEMENT EXECUTE FUNCTION provisional_capacity_lock();

CREATE FUNCTION provisional_model_binding_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE v ledger_variants;m ledger_models;b provisional_capacity_buckets;BEGIN
 SELECT * INTO STRICT v FROM ledger_variants WHERE id=NEW.variant_id;
 SELECT * INTO STRICT m FROM ledger_models WHERE id=v.model_id;
 SELECT * INTO STRICT b FROM provisional_capacity_buckets WHERE id=NEW.bucket_id;
 IF v.tier<>'PREMIUM' OR v.family NOT IN ('SKI','SNOWBOARD') OR m.catalog_season IS NULL
  OR b.family<>v.family OR b.age<>v.age OR b.size_mapping_status<>'MAPPED'
  OR provisional_size_key(b.family,b.booking_size)<>provisional_size_key(v.family,v.size)
  OR NEW.quantity>b.quantity OR NEW.actor IS DISTINCT FROM current_setting('zao.actor',true) THEN
  RAISE EXCEPTION 'PROVISIONAL_MODEL_BINDING_INVALID' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END$$;
REVOKE ALL ON FUNCTION provisional_model_binding_guard() FROM PUBLIC;
CREATE TRIGGER provisional_model_binding_guard BEFORE INSERT ON provisional_model_bindings
 FOR EACH ROW EXECUTE FUNCTION provisional_model_binding_guard();

-- A Premium claim names the promised variant; it may use only a bucket bound to that variant
-- and never more than the binding quantity on a day. The existing per-bucket claim guard still
-- enforces the shared Regular+Premium bucket ceiling.
ALTER TABLE provisional_capacity_claims ADD COLUMN promise_variant_id uuid REFERENCES ledger_variants(id);
CREATE FUNCTION provisional_model_claim_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE cap integer;used integer;BEGIN
 IF NEW.state<>'ACTIVE' OR NEW.promise_variant_id IS NULL THEN RETURN NEW;END IF;
 SELECT quantity INTO cap FROM provisional_model_bindings WHERE variant_id=NEW.promise_variant_id AND bucket_id=NEW.bucket_id;
 IF cap IS NULL THEN RAISE EXCEPTION 'PROVISIONAL_MODEL_BINDING_REQUIRED' USING ERRCODE='23514';END IF;
 SELECT coalesce(sum(c.quantity),0) INTO used FROM provisional_capacity_claims c JOIN inventory_holds x ON x.id=c.hold_id
  WHERE c.state='ACTIVE' AND c.bucket_id=NEW.bucket_id AND c.promise_variant_id=NEW.promise_variant_id AND c.day=NEW.day AND c.id<>NEW.id AND x.state='ACTIVE'
   AND (x.expires_at>inventory_clock() OR x.payment_state IN ('PENDING','UNKNOWN','SUCCESS') OR x.allocation_stage<>'PROVISIONAL');
 IF used+NEW.quantity>cap THEN RAISE EXCEPTION 'PROVISIONAL_MODEL_CAPACITY_EXCEEDED' USING ERRCODE='23514';END IF;
 RETURN NEW;
END$$;
REVOKE ALL ON FUNCTION provisional_model_claim_guard() FROM PUBLIC;
CREATE TRIGGER provisional_model_claim_guard BEFORE INSERT OR UPDATE ON provisional_capacity_claims
 FOR EACH ROW EXECUTE FUNCTION provisional_model_claim_guard();

-- 0054 receipt functions, unchanged except that bucket/variant sizes compare canonically.
CREATE OR REPLACE FUNCTION provisional_capacity_receive_import() RETURNS trigger
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
    WHERE p.status='ACTIVE' AND bucket.family=v.family AND bucket.age=v.age AND provisional_size_key(bucket.family,bucket.booking_size)=provisional_size_key(v.family,v.size)) THEN
    RAISE EXCEPTION 'PROVISIONAL_RECEIPT_SOURCE_REQUIRED' USING ERRCODE='23514';
   END IF;
   CONTINUE;
  END IF;
  IF v.tier<>(CASE WHEN v.family IN ('WEAR_JACKET','WEAR_PANTS') THEN 'STANDARD' ELSE 'REGULAR' END) THEN
   RAISE EXCEPTION 'PROVISIONAL_RECEIPT_INCOMPATIBLE_TIER' USING ERRCODE='23514';
  END IF;
  SELECT count(*)::int INTO matches FROM provisional_capacity_buckets bucket
   WHERE bucket.source_id=v_source_id AND bucket.family=v.family AND bucket.age=v.age AND provisional_size_key(bucket.family,bucket.booking_size)=provisional_size_key(v.family,v.size) AND bucket.size_mapping_status='MAPPED';
  IF matches<>1 THEN RAISE EXCEPTION 'PROVISIONAL_RECEIPT_BUCKET_AMBIGUOUS' USING ERRCODE='23514';END IF;
  SELECT * INTO STRICT b FROM provisional_capacity_buckets bucket WHERE bucket.source_id=v_source_id AND bucket.family=v.family AND bucket.age=v.age AND bucket.size_mapping_status='MAPPED' AND provisional_size_key(bucket.family,bucket.booking_size)=provisional_size_key(v.family,v.size) FOR UPDATE;
  q:=(e->'source'->>'quantity')::integer;
  IF e->'source'->>'sourceKind'<>'SHOP_RECEIPT' OR e->'source'->>'intent'<>'ADD' OR q<1 OR q>provisional_capacity_effective_quantity(b.id) THEN
   RAISE EXCEPTION 'PROVISIONAL_RECEIPT_QUANTITY_INVALID' USING ERRCODE='23514';
  END IF;
  INSERT INTO provisional_capacity_receipts(source_key,commit_id,bucket_id,quantity,actor)
   VALUES(e->>'sourceKey',NEW.id,b.id,q,s.actor);
  INSERT INTO ops_history(resource,entity_id,actor,event,after_data)
   VALUES('provisional_capacity_bucket',b.id,s.actor,'PROVISIONAL_CAPACITY_RECEIVED',jsonb_build_object('commitId',NEW.id,'sourceId',v_source_id,'quantity',q));
 END LOOP;
 RETURN NEW;
END$$;

CREATE OR REPLACE FUNCTION provisional_receipt_claim_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE f text;a text;s text;t text;k text;capacity bigint;used_all bigint;used_public bigint;
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
 k:=provisional_size_key(f,s);
 IF NOT EXISTS(SELECT 1 FROM provisional_capacity_receipts r JOIN provisional_capacity_buckets b ON b.id=r.bucket_id WHERE b.family=f AND b.age=a AND provisional_size_key(b.family,b.booking_size)=k) THEN RETURN NEW;END IF;
 PERFORM pg_advisory_xact_lock(71820600);
 SELECT coalesce(sum(q),0) INTO capacity FROM (
  SELECT provisional_capacity_effective_quantity(b.id)::bigint q FROM provisional_capacity_buckets b JOIN provisional_capacity_sources p ON p.id=b.source_id
   WHERE b.active AND b.size_mapping_status='MAPPED' AND p.status='ACTIVE' AND b.family=f AND b.age=a AND provisional_size_key(b.family,b.booking_size)=k
  UNION ALL SELECT count(*) FROM ledger_assets x JOIN ledger_variants v ON v.id=x.variant_id WHERE x.status='AVAILABLE' AND v.tier='REGULAR' AND v.family=f AND v.age=a AND provisional_size_key(v.family,v.size)=k
  UNION ALL SELECT coalesce(sum(p.ready),0) FROM wear_pools p JOIN ledger_variants v ON v.id=p.variant_id WHERE v.family=f AND v.age=a AND provisional_size_key(v.family,v.size)=k
 ) supply;
 SELECT coalesce(sum(q),0),coalesce(sum(q) FILTER(WHERE NOT buffer_override),0) INTO used_all,used_public FROM (
  SELECT c.hold_id,c.quantity::bigint q FROM provisional_capacity_claims c JOIN provisional_capacity_buckets b ON b.id=c.bucket_id
   WHERE c.state='ACTIVE' AND c.day=NEW.day AND b.family=f AND b.age=a AND provisional_size_key(b.family,b.booking_size)=k
  UNION ALL SELECT c.hold_id,1 FROM inventory_claims c JOIN ledger_assets x ON x.id=c.asset_id JOIN ledger_variants v ON v.id=x.variant_id
   WHERE c.active AND c.day=NEW.day AND v.tier='REGULAR' AND v.family=f AND v.age=a AND provisional_size_key(v.family,v.size)=k
  UNION ALL SELECT c.hold_id,c.quantity FROM wear_claims c JOIN wear_pools p ON p.id=c.pool_id JOIN ledger_variants v ON v.id=p.variant_id
   WHERE c.active AND c.day=NEW.day AND v.family=f AND v.age=a AND provisional_size_key(v.family,v.size)=k
    AND NOT EXISTS(SELECT 1 FROM wear_loans l JOIN rental_bookings b ON b.id=l.booking_id WHERE b.hold_id=c.hold_id)
 ) claims JOIN inventory_holds h ON h.id=claims.hold_id
 WHERE h.state='ACTIVE' AND (h.expires_at>inventory_clock() OR h.payment_state IN ('PENDING','UNKNOWN','SUCCESS') OR h.allocation_stage<>'PROVISIONAL');
 IF used_all>capacity OR used_public>floor(capacity*.95) THEN
  RAISE EXCEPTION 'PROVISIONAL_RECEIPT_CAPACITY_RESERVED' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END$$;

-- Existing runtime roles that already read provisional buckets also read the bindings.
DO $$DECLARE r record;BEGIN
 FOR r IN SELECT DISTINCT grantee FROM information_schema.role_table_grants
  WHERE table_schema='public' AND table_name='provisional_capacity_buckets' AND privilege_type='SELECT' AND grantee<>current_user
 LOOP EXECUTE format('GRANT SELECT ON provisional_model_bindings TO %I',r.grantee);END LOOP;
END$$;
GRANT EXECUTE ON FUNCTION provisional_size_key(text,text) TO PUBLIC;

-- 0057's accessory-pole witness, unchanged except: V1.4 is accepted like V1.3, and a Premium set
-- takes its pole from the common Regular fit pool (a Regular pole catalogue means a pole must be named).
CREATE OR REPLACE FUNCTION inventory_sync_pole_exemptions(p_hold uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE h inventory_holds; m jsonb; i jsonb; variants uuid[]; k text;
BEGIN
 PERFORM pg_advisory_xact_lock(71820600);
 SELECT * INTO STRICT h FROM inventory_holds WHERE id=p_hold FOR UPDATE;
 UPDATE inventory_pole_exemptions SET active=false WHERE hold_id=p_hold AND active;
 IF h.state<>'ACTIVE' THEN RETURN;END IF;
 FOR m IN SELECT value FROM jsonb_array_elements(h.conditions->'members') WHERE value->>'product'='SKI_SET' LOOP
  FOR i IN SELECT value FROM jsonb_array_elements(m->'items') WHERE value->>'family'='POLE' LOOP
   SELECT coalesce(array_agg(value::uuid),'{}'::uuid[]) INTO variants FROM jsonb_array_elements_text(i->'variantIds');
   IF cardinality(variants)=0 AND (coalesce(h.conditions->>'contractVersion','') NOT IN ('INTEGRATED_V1_3','INTEGRATED_V1_4') OR EXISTS(SELECT 1 FROM ledger_variants v WHERE v.family='POLE' AND v.age=m->>'age' AND v.tier IN (m->>'tier','REGULAR') AND btrim(v.size) ~* '^[0-9]{1,3}(\.[0-9])?[[:space:]]*cm$')) THEN
    RAISE EXCEPTION 'POLE_CATALOG_SELECTION_REQUIRED' USING ERRCODE='23514';
   END IF;
   k:=(m->>'key')||':POLE';
   -- Unavailable/empty registered pools still establish tracked capacity; a sold-out pool
   -- must never become an exemption. Incoming transfers likewise establish relevant stock.
   IF NOT EXISTS(SELECT 1 FROM ledger_poles p WHERE p.variant_id=ANY(variants) AND
     (p.store_id=h.pickup_store OR EXISTS(SELECT 1 FROM transfer_pieces t JOIN transfer_batches b ON b.id=t.batch_id
      WHERE t.source_pole_id=p.id AND b.destination_store=h.pickup_store AND t.state NOT IN ('CANCELLED','CLOSED')))) THEN
    INSERT INTO inventory_pole_exemptions(hold_id,requirement_key,day,store_id,variant_ids)
    SELECT h.id,k,d::date,h.pickup_store,variants FROM generate_series(h.occupancy_start,h.occupancy_end,interval '1 day') d
    WHERE NOT EXISTS(SELECT 1 FROM inventory_claims c WHERE c.hold_id=h.id AND c.requirement_key=k AND c.day=d::date AND c.active);
   END IF;
  END LOOP;
 END LOOP;
END $$;
