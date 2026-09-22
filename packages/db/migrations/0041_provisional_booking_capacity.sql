-- Owner decision (docs/execution/launch-critical-m2b/PROVISIONAL_SOURCE_B_AUDIT.md,
-- INVENTORY_SOURCE_AUDIT.md): a distinct, additive reservation-capacity layer for Owner-approved
-- provisional (planned/lower-bound) inventory quantities, never per-unit Asset identity and never
-- registered in real_inventory_sources/real_data_acceptance — those tables stay REAL_DATA only.
-- One property-wide shared pool (no MOUNTAIN_BASE/ONSEN_BASE split — the source itself carries no
-- trustworthy store split, so this schema does not invent one). Mirrors the existing wear_pools/
-- wear_claims quantity-pool pattern (packages/db/migrations/0013_wear_quantity.sql), not the
-- per-unit ledger_assets/inventory_claims pattern, and reuses the same global advisory-lock
-- serialization domain (pg_advisory_xact_lock(71820600)) the whole inventory subsystem already
-- shares, so provisional claims can never oversell against real/wear/pole claims made concurrently.

-- Immutable source record. classification/count_semantics are fixed single-value enums, not free
-- text, so a source can never be silently reclassified into something REAL_DATA-shaped.
CREATE TABLE provisional_capacity_sources(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 source_sha256 text NOT NULL UNIQUE CHECK(source_sha256 ~ '^[a-f0-9]{64}$'),
 original_filename text NOT NULL CHECK(length(original_filename) BETWEEN 1 AND 300),
 classification text NOT NULL DEFAULT 'OWNER_APPROVED_PROVISIONAL_BOOKING_CAPACITY_SOURCE' CHECK(classification='OWNER_APPROVED_PROVISIONAL_BOOKING_CAPACITY_SOURCE'),
 count_semantics text NOT NULL DEFAULT 'LOWER_BOUND_MAY_INCREASE' CHECK(count_semantics='LOWER_BOUND_MAY_INCREASE'),
 status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','SUPERSEDED')),
 actor text NOT NULL REFERENCES staff_members(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- One row per (source, family, age, source size) bucket. family is restricted to exactly the
-- Owner-approved six — POLE/HELMET/SNOWBOARD_BINDING (or anything else) cannot be inserted here
-- structurally, not merely by caller discipline. booking_size is NULL exactly when
-- size_mapping_status='UNRESOLVED' (no reviewed source-size alias exists yet, e.g. the SKI_BOOT/
-- SNOWBOARD_BOOT "NNX" tokens) — an unresolved bucket's quantity still counts toward the family
-- total but can never satisfy a size-specific booking request (see provisional_capacity_available()).
CREATE TABLE provisional_capacity_buckets(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 source_id uuid NOT NULL REFERENCES provisional_capacity_sources(id),
 family text NOT NULL CHECK(family IN ('SKI','SNOWBOARD','SKI_BOOT','SNOWBOARD_BOOT','WEAR_JACKET','WEAR_PANTS')),
 age text NOT NULL CHECK(age IN ('ADULT','KIDS')),
 source_size text NOT NULL CHECK(length(source_size) BETWEEN 1 AND 32),
 booking_size text CHECK(booking_size IS NULL OR length(booking_size) BETWEEN 1 AND 32),
 size_mapping_status text NOT NULL CHECK(size_mapping_status IN ('MAPPED','UNRESOLVED')),
 quantity integer NOT NULL CHECK(quantity BETWEEN 1 AND 100000),
 provenance text NOT NULL CHECK(length(provenance) BETWEEN 1 AND 300),
 active boolean NOT NULL DEFAULT true,
 materialized_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((size_mapping_status='MAPPED')=(booking_size IS NOT NULL)),
 CHECK((materialized_at IS NOT NULL)=(active=false) OR materialized_at IS NULL),
 UNIQUE(source_id,family,age,source_size)
);

-- The provisional analogue of wear_claims: one row per (hold, requirement, day). A hold/period
-- consumes quantity from the shared bucket total, never from a physical unit. `state` (not a
-- plain boolean) makes the three real lifecycle outcomes — held, released, converted to real
-- stock — first-class and queryable, matching the Owner's explicit released/materialized split.
CREATE TABLE provisional_capacity_claims(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 hold_id uuid NOT NULL REFERENCES inventory_holds(id),
 requirement_key text NOT NULL CHECK(length(requirement_key) BETWEEN 1 AND 100),
 bucket_id uuid NOT NULL REFERENCES provisional_capacity_buckets(id),
 day date NOT NULL,
 quantity integer NOT NULL CHECK(quantity BETWEEN 1 AND 20),
 state text NOT NULL DEFAULT 'ACTIVE' CHECK(state IN ('ACTIVE','RELEASED','MATERIALIZED')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 released_at timestamptz,
 materialized_at timestamptz
);
-- Idempotent replanning (deactivate+reinsert, matching writeWearClaims/writeAllocationClaims)
-- needs at most one ACTIVE row per (hold, requirement, day); RELEASED/MATERIALIZED history rows
-- for the same key are retained, never deleted.
CREATE UNIQUE INDEX provisional_one_requirement_day ON provisional_capacity_claims(hold_id,requirement_key,day) WHERE state='ACTIVE';
CREATE INDEX provisional_capacity_claims_bucket_day ON provisional_capacity_claims(bucket_id,day) WHERE state='ACTIVE';

CREATE FUNCTION provisional_capacity_lock() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN PERFORM pg_advisory_xact_lock(71820600);RETURN NULL;END$$;
CREATE TRIGGER provisional_capacity_sources_lock BEFORE INSERT OR UPDATE ON provisional_capacity_sources FOR EACH STATEMENT EXECUTE FUNCTION provisional_capacity_lock();
CREATE TRIGGER provisional_capacity_buckets_lock BEFORE INSERT OR UPDATE ON provisional_capacity_buckets FOR EACH STATEMENT EXECUTE FUNCTION provisional_capacity_lock();
CREATE TRIGGER provisional_capacity_claims_lock BEFORE INSERT OR UPDATE ON provisional_capacity_claims FOR EACH STATEMENT EXECUTE FUNCTION provisional_capacity_lock();
REVOKE ALL ON FUNCTION provisional_capacity_lock() FROM PUBLIC;

-- Row-level invariant, independent of the application path (mirrors wear_claim_guard,
-- 0013_wear_quantity.sql). No SECURITY DEFINER needed: this only ever runs as the owning table's
-- own trigger, invoked under whatever role already has INSERT/UPDATE on these tables.
CREATE FUNCTION provisional_capacity_claim_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE h inventory_holds;b provisional_capacity_buckets;used integer;BEGIN
 IF NEW.state<>'ACTIVE' THEN RETURN NEW;END IF;
 SELECT * INTO STRICT h FROM inventory_holds WHERE id=NEW.hold_id;
 SELECT * INTO STRICT b FROM provisional_capacity_buckets WHERE id=NEW.bucket_id;
 IF NOT b.active THEN RAISE EXCEPTION 'PROVISIONAL_BUCKET_INACTIVE' USING ERRCODE='23514';END IF;
 IF h.state<>'ACTIVE' OR NEW.day<h.occupancy_start OR NEW.day>h.occupancy_end THEN RAISE EXCEPTION 'INVALID_PROVISIONAL_CLAIM' USING ERRCODE='23514';END IF;
 SELECT coalesce(sum(c.quantity),0) INTO used FROM provisional_capacity_claims c JOIN inventory_holds x ON x.id=c.hold_id
  WHERE c.state='ACTIVE' AND c.bucket_id=NEW.bucket_id AND c.day=NEW.day AND c.id<>NEW.id AND x.state='ACTIVE'
   AND (x.expires_at>inventory_clock() OR x.payment_state IN ('PENDING','UNKNOWN','SUCCESS') OR x.allocation_stage<>'PROVISIONAL');
 IF used+NEW.quantity>b.quantity THEN RAISE EXCEPTION 'PROVISIONAL_CAPACITY_EXCEEDED' USING ERRCODE='23514';END IF;
 RETURN NEW;
END$$;
CREATE TRIGGER provisional_capacity_claim_guard BEFORE INSERT OR UPDATE ON provisional_capacity_claims FOR EACH ROW EXECUTE FUNCTION provisional_capacity_claim_guard();

-- Registers one immutable source plus its bucket rows in one statement-locked transaction (the
-- STATEMENT-level lock trigger above already serializes this against concurrent claims). Pure
-- INSERT, no update/delete path — later counts are new sources, never edits to this one
-- (see provisional_capacity_reduce_bucket for the one narrow, fail-closed exception).
CREATE FUNCTION provisional_capacity_register_source(p_sha256 text,p_filename text,p_actor text,p_buckets jsonb) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE v_source_id uuid;BEGIN
 IF jsonb_typeof(p_buckets)<>'array' OR jsonb_array_length(p_buckets)=0 THEN RAISE EXCEPTION 'PROVISIONAL_SOURCE_EMPTY' USING ERRCODE='22023';END IF;
 INSERT INTO provisional_capacity_sources(source_sha256,original_filename,actor) VALUES(p_sha256,p_filename,p_actor) RETURNING id INTO v_source_id;
 INSERT INTO provisional_capacity_buckets(source_id,family,age,source_size,booking_size,size_mapping_status,quantity,provenance)
 SELECT v_source_id,x.family,x.age,x.source_size,x.booking_size,x.size_mapping_status,x.quantity,x.provenance
 FROM jsonb_to_recordset(p_buckets) AS x(family text,age text,source_size text,booking_size text,size_mapping_status text,quantity integer,provenance text);
 RETURN v_source_id;
END$$;

-- Available (bookable) quantity for one family/age/booking_size, summed across every ACTIVE
-- bucket from every ACTIVE source that resolved to that exact catalogue size — this is how a
-- later source (test I: future delta) raises capacity without touching the original source's
-- rows, and how UNRESOLVED buckets are structurally excluded from size-specific booking (their
-- quantity is visible in provisional_capacity_family_totals, never here).
CREATE FUNCTION provisional_capacity_available(p_family text,p_age text,p_booking_size text) RETURNS integer
LANGUAGE sql STABLE AS $$
 SELECT coalesce(sum(quantity),0)::int FROM provisional_capacity_buckets
 WHERE active AND size_mapping_status='MAPPED' AND family=p_family AND age=p_age AND booking_size=p_booking_size;
$$;

-- Fail-closed reduction: a later, smaller confirmed count can never silently shrink capacity out
-- from under an already-promised active claim. Checks the single worst (highest-usage) day, since
-- that is the binding constraint the bucket's own claim_guard would otherwise enforce day-by-day.
CREATE FUNCTION provisional_capacity_reduce_bucket(p_bucket_id uuid,p_new_quantity integer,p_actor text) RETURNS provisional_capacity_buckets
LANGUAGE plpgsql AS $$
DECLARE b provisional_capacity_buckets;worst integer;BEGIN
 IF p_new_quantity<1 THEN RAISE EXCEPTION 'PROVISIONAL_QUANTITY_INVALID' USING ERRCODE='22023';END IF;
 SELECT * INTO STRICT b FROM provisional_capacity_buckets WHERE id=p_bucket_id FOR UPDATE;
 SELECT coalesce(max(daily.used),0) INTO worst FROM (
  SELECT sum(c.quantity)::int AS used FROM provisional_capacity_claims c JOIN inventory_holds h ON h.id=c.hold_id
  WHERE c.state='ACTIVE' AND c.bucket_id=p_bucket_id AND h.state='ACTIVE'
   AND (h.expires_at>inventory_clock() OR h.payment_state IN ('PENDING','UNKNOWN','SUCCESS') OR h.allocation_stage<>'PROVISIONAL')
  GROUP BY c.day
 ) daily;
 IF p_new_quantity<worst THEN RAISE EXCEPTION 'PROVISIONAL_CAPACITY_BELOW_ACTIVE_CLAIMS' USING ERRCODE='23514';END IF;
 UPDATE provisional_capacity_buckets SET quantity=p_new_quantity WHERE id=p_bucket_id RETURNING * INTO b;
 INSERT INTO ops_history(resource,entity_id,actor,event,after_data) VALUES('provisional_capacity_bucket',b.id,p_actor,'PROVISIONAL_CAPACITY_REDUCED',jsonb_build_object('bucketId',b.id,'newQuantity',p_new_quantity,'worstActiveDay',worst));
 RETURN b;
END$$;

-- Atomically retires a bucket once its quantity is confirmed as real physical stock: the bucket
-- stops counting toward availability, and every still-ACTIVE claim against it converts to
-- MATERIALIZED (the guest's provisional promise is preserved, not deleted, but it no longer
-- double-counts once real stock exists for it). This function alone never creates a real Asset —
-- pairing a materialization call with the actual real-data admission is an operational sequencing
-- decision made by the caller, not enforced here.
CREATE FUNCTION provisional_capacity_materialize_bucket(p_bucket_id uuid,p_actor text) RETURNS provisional_capacity_buckets
LANGUAGE plpgsql AS $$
DECLARE b provisional_capacity_buckets;BEGIN
 SELECT * INTO STRICT b FROM provisional_capacity_buckets WHERE id=p_bucket_id FOR UPDATE;
 IF NOT b.active THEN RAISE EXCEPTION 'PROVISIONAL_BUCKET_ALREADY_INACTIVE' USING ERRCODE='23514';END IF;
 UPDATE provisional_capacity_buckets SET active=false,materialized_at=clock_timestamp() WHERE id=p_bucket_id RETURNING * INTO b;
 UPDATE provisional_capacity_claims SET state='MATERIALIZED',materialized_at=clock_timestamp() WHERE bucket_id=p_bucket_id AND state='ACTIVE';
 INSERT INTO ops_history(resource,entity_id,actor,event,after_data) VALUES('provisional_capacity_bucket',b.id,p_actor,'PROVISIONAL_CAPACITY_MATERIALIZED',jsonb_build_object('bucketId',b.id,'quantity',b.quantity));
 RETURN b;
END$$;

REVOKE ALL ON FUNCTION provisional_capacity_register_source(text,text,text,jsonb),provisional_capacity_reduce_bucket(uuid,integer,text),provisional_capacity_materialize_bucket(uuid,text) FROM PUBLIC;
