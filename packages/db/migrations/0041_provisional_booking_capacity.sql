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
-- total but can never satisfy a size-specific booking request (see provisional_capacity_available_on()).
--
-- V2 (TD correction): `quantity` is the immutable AS-REGISTERED base count — never updated after
-- insert (no UPDATE grant on this table exists anywhere in this migration or any role script).
-- The actual bookable quantity is always DERIVED: base + provisional_capacity_adjustments (signed
-- corrections) - provisional_capacity_materializations (confirmed-real deductions) — see
-- provisional_capacity_effective_quantity() below, the one place that arithmetic lives.
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

-- V2 (TD correction, item H): immutable corrections ledger — replaces the V1 design's direct
-- `UPDATE provisional_capacity_buckets SET quantity=...`. A correction (e.g. the Owner supplies a
-- smaller confirmed count than the original registration) is a new signed delta row, never an edit
-- to the original bucket. `delta` may be negative (reduction) or positive (upward correction not
-- already covered by registering a whole new source); zero is meaningless and rejected.
CREATE TABLE provisional_capacity_adjustments(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 bucket_id uuid NOT NULL REFERENCES provisional_capacity_buckets(id),
 delta integer NOT NULL CHECK(delta<>0),
 reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 300),
 actor text NOT NULL REFERENCES staff_members(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX provisional_capacity_adjustments_bucket ON provisional_capacity_adjustments(bucket_id);

-- V2 (TD correction, items I/J): partial, evidence-tied materialization — replaces the V1 design's
-- whole-bucket-only `active=false` flip. Each row is one confirmed conversion of provisional
-- quantity into real stock, tied to an actual real_data_acceptance row (never an arbitrary operator
-- claim that "this became real"): provisional 10 -> real 4 leaves 3 more materialization rows of up
-- to 6 remaining before the bucket is fully retired, never double-counted against
-- provisional_capacity_effective_quantity(). Materializing does NOT touch provisional_capacity_claims
-- — an ACTIVE claim is preserved exactly as it was; converting it to a real claim is a separate,
-- explicit reallocation (a hold amend/replan), never implied by capacity becoming real underneath it.
CREATE TABLE provisional_capacity_materializations(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 bucket_id uuid NOT NULL REFERENCES provisional_capacity_buckets(id),
 quantity integer NOT NULL CHECK(quantity BETWEEN 1 AND 100000),
 real_data_acceptance_id uuid NOT NULL REFERENCES real_data_acceptance(id),
 actor text NOT NULL REFERENCES staff_members(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX provisional_capacity_materializations_bucket ON provisional_capacity_materializations(bucket_id);

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
CREATE TRIGGER provisional_capacity_adjustments_lock BEFORE INSERT ON provisional_capacity_adjustments FOR EACH STATEMENT EXECUTE FUNCTION provisional_capacity_lock();
CREATE TRIGGER provisional_capacity_materializations_lock BEFORE INSERT ON provisional_capacity_materializations FOR EACH STATEMENT EXECUTE FUNCTION provisional_capacity_lock();
CREATE TRIGGER provisional_capacity_claims_lock BEFORE INSERT OR UPDATE ON provisional_capacity_claims FOR EACH STATEMENT EXECUTE FUNCTION provisional_capacity_lock();
REVOKE ALL ON FUNCTION provisional_capacity_lock() FROM PUBLIC;

-- V2 (TD correction): the single place the base/adjustments/materializations arithmetic lives —
-- every other function and the TS planner (provisionalCapacity() in
-- packages/core/src/inventory/provisional-capacity.ts) reads bookable quantity through this, never
-- the raw `quantity` column directly. Never negative by construction: materializations can never
-- exceed effective quantity at insert time (provisional_capacity_materialize_bucket enforces it).
-- SECURITY DEFINER: the HOLD role (and the provisional_capacity_claim_guard trigger, which fires
-- under whatever role is writing claims) needs to call this, but should never need direct SELECT
-- on provisional_capacity_adjustments/_materializations themselves — this function is the one
-- narrow, read-only window onto that arithmetic, not a new source/bucket authority.
CREATE FUNCTION provisional_capacity_effective_quantity(p_bucket_id uuid) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT b.quantity
  + coalesce((SELECT sum(a.delta)::int FROM provisional_capacity_adjustments a WHERE a.bucket_id=p_bucket_id),0)
  - coalesce((SELECT sum(m.quantity)::int FROM provisional_capacity_materializations m WHERE m.bucket_id=p_bucket_id),0)
 FROM provisional_capacity_buckets b WHERE b.id=p_bucket_id;
$$;

-- Row-level invariant, independent of the application path (mirrors wear_claim_guard,
-- 0013_wear_quantity.sql). No SECURITY DEFINER needed: this only ever runs as the owning table's
-- own trigger, invoked under whatever role already has INSERT/UPDATE on these tables.
CREATE FUNCTION provisional_capacity_claim_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE h inventory_holds;b provisional_capacity_buckets;used integer;bookable integer;BEGIN
 IF NEW.state<>'ACTIVE' THEN RETURN NEW;END IF;
 SELECT * INTO STRICT h FROM inventory_holds WHERE id=NEW.hold_id;
 SELECT * INTO STRICT b FROM provisional_capacity_buckets WHERE id=NEW.bucket_id;
 IF NOT b.active THEN RAISE EXCEPTION 'PROVISIONAL_BUCKET_INACTIVE' USING ERRCODE='23514';END IF;
 IF h.state<>'ACTIVE' OR NEW.day<h.occupancy_start OR NEW.day>h.occupancy_end THEN RAISE EXCEPTION 'INVALID_PROVISIONAL_CLAIM' USING ERRCODE='23514';END IF;
 bookable:=provisional_capacity_effective_quantity(NEW.bucket_id);
 SELECT coalesce(sum(c.quantity),0) INTO used FROM provisional_capacity_claims c JOIN inventory_holds x ON x.id=c.hold_id
  WHERE c.state='ACTIVE' AND c.bucket_id=NEW.bucket_id AND c.day=NEW.day AND c.id<>NEW.id AND x.state='ACTIVE'
   AND (x.expires_at>inventory_clock() OR x.payment_state IN ('PENDING','UNKNOWN','SUCCESS') OR x.allocation_stage<>'PROVISIONAL');
 IF used+NEW.quantity>bookable THEN RAISE EXCEPTION 'PROVISIONAL_CAPACITY_EXCEEDED' USING ERRCODE='23514';END IF;
 RETURN NEW;
END$$;
CREATE TRIGGER provisional_capacity_claim_guard BEFORE INSERT OR UPDATE ON provisional_capacity_claims FOR EACH ROW EXECUTE FUNCTION provisional_capacity_claim_guard();

-- V2 (TD correction, item L): SECURITY DEFINER with a fixed search_path, actor taken from the
-- already-authenticated `zao.actor` session setting (set by OperationsContext.transaction() before
-- any caller function runs — packages/core/src/operations/context.ts) — never a caller-supplied
-- p_actor parameter. This is the same shape real_data_accept() (0038_real_inventory_provenance.sql)
-- already establishes. Because the function itself now carries the INSERT rights, the operations
-- role needs only EXECUTE here, never direct INSERT on provisional_capacity_sources/_buckets — see
-- scripts/operations-roles.ts's negative-privilege proof in
-- tests/readiness/provisional-booking-capacity.ts.
--
-- Registers one immutable source plus its bucket rows in one statement-locked transaction (the
-- STATEMENT-level lock trigger above already serializes this against concurrent claims). Pure
-- INSERT, no update/delete path — later counts are new sources, never edits to this one (see
-- provisional_capacity_reduce_bucket for the one narrow, fail-closed exception).
CREATE FUNCTION provisional_capacity_register_source(p_sha256 text,p_filename text,p_buckets jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE v_source_id uuid;v_actor text;BEGIN
 v_actor:=current_setting('zao.actor');
 IF jsonb_typeof(p_buckets)<>'array' OR jsonb_array_length(p_buckets)=0 THEN RAISE EXCEPTION 'PROVISIONAL_SOURCE_EMPTY' USING ERRCODE='22023';END IF;
 INSERT INTO provisional_capacity_sources(source_sha256,original_filename,actor) VALUES(p_sha256,p_filename,v_actor) RETURNING id INTO v_source_id;
 INSERT INTO provisional_capacity_buckets(source_id,family,age,source_size,booking_size,size_mapping_status,quantity,provenance)
 SELECT v_source_id,x.family,x.age,x.source_size,x.booking_size,x.size_mapping_status,x.quantity,x.provenance
 FROM jsonb_to_recordset(p_buckets) AS x(family text,age text,source_size text,booking_size text,size_mapping_status text,quantity integer,provenance text);
 RETURN v_source_id;
END$$;

-- V2 (TD correction, item K): truthful, date-scoped NET availability — replaces the V1 design's
-- misleadingly-named provisional_capacity_available(), which returned gross bucket quantity with no
-- claims subtracted at all (no product code ever called it; only this migration's own test file
-- did). This is the real "how many of this family/age/booking_size are actually free on this one
-- day" answer: effective (bookable) quantity minus every other hold's ACTIVE claim for that exact
-- day, summed across every ACTIVE MAPPED bucket for that size — the same per-bucket, per-day
-- liveness predicate provisional_capacity_claim_guard and the TS planner already use.
CREATE FUNCTION provisional_capacity_available_on(p_family text,p_age text,p_booking_size text,p_day date) RETURNS integer
LANGUAGE sql STABLE AS $$
 SELECT coalesce(sum(GREATEST(provisional_capacity_effective_quantity(b.id)-coalesce(used.quantity,0),0)),0)::int
 FROM provisional_capacity_buckets b
 LEFT JOIN LATERAL (
  SELECT sum(c.quantity)::int AS quantity FROM provisional_capacity_claims c JOIN inventory_holds h ON h.id=c.hold_id
  WHERE c.state='ACTIVE' AND c.bucket_id=b.id AND c.day=p_day AND h.state='ACTIVE'
   AND (h.expires_at>inventory_clock() OR h.payment_state IN ('PENDING','UNKNOWN','SUCCESS') OR h.allocation_stage<>'PROVISIONAL')
 ) used ON true
 WHERE b.active AND b.size_mapping_status='MAPPED' AND b.family=p_family AND b.age=p_age AND b.booking_size=p_booking_size;
$$;

-- Fail-closed correction: a later, smaller confirmed count can never silently shrink capacity out
-- from under an already-promised active claim. Checks the single worst (highest-usage) day, since
-- that is the binding constraint the bucket's own claim_guard would otherwise enforce day-by-day.
-- V2 (TD correction, items H/L): records an immutable signed delta (provisional_capacity_adjustments)
-- instead of updating provisional_capacity_buckets.quantity directly; SECURITY DEFINER, actor from
-- current_setting('zao.actor'), no p_actor parameter (see provisional_capacity_register_source
-- above for the identical rationale). `p_new_quantity` is the caller's target effective quantity,
-- not a raw delta — this function computes and stores the delta itself.
CREATE FUNCTION provisional_capacity_reduce_bucket(p_bucket_id uuid,p_new_quantity integer) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE v_actor text;current_effective integer;delta integer;worst integer;BEGIN
 v_actor:=current_setting('zao.actor');
 IF p_new_quantity<0 THEN RAISE EXCEPTION 'PROVISIONAL_QUANTITY_INVALID' USING ERRCODE='22023';END IF;
 PERFORM 1 FROM provisional_capacity_buckets WHERE id=p_bucket_id FOR UPDATE;
 current_effective:=provisional_capacity_effective_quantity(p_bucket_id);
 IF p_new_quantity=current_effective THEN RETURN current_effective;END IF;
 delta:=p_new_quantity-current_effective;
 SELECT coalesce(max(daily.used),0) INTO worst FROM (
  SELECT sum(c.quantity)::int AS used FROM provisional_capacity_claims c JOIN inventory_holds h ON h.id=c.hold_id
  WHERE c.state='ACTIVE' AND c.bucket_id=p_bucket_id AND h.state='ACTIVE'
   AND (h.expires_at>inventory_clock() OR h.payment_state IN ('PENDING','UNKNOWN','SUCCESS') OR h.allocation_stage<>'PROVISIONAL')
  GROUP BY c.day
 ) daily;
 IF p_new_quantity<worst THEN RAISE EXCEPTION 'PROVISIONAL_CAPACITY_BELOW_ACTIVE_CLAIMS' USING ERRCODE='23514';END IF;
 INSERT INTO provisional_capacity_adjustments(bucket_id,delta,reason,actor) VALUES(p_bucket_id,delta,'CORRECTION',v_actor);
 INSERT INTO ops_history(resource,entity_id,actor,event,after_data) VALUES('provisional_capacity_bucket',p_bucket_id,v_actor,'PROVISIONAL_CAPACITY_ADJUSTED',jsonb_build_object('bucketId',p_bucket_id,'delta',delta,'newEffectiveQuantity',p_new_quantity,'worstActiveDay',worst));
 RETURN p_new_quantity;
END$$;

-- Converts confirmed-real quantity out of the provisional pool, tied to real import evidence, never
-- an arbitrary operator claim. Partial: provisional 10 -> real 4 records exactly 4, leaving 6
-- bookable; the bucket is only fully retired (active=false) once cumulative materialized quantity
-- reaches the bucket's effective quantity. Never touches provisional_capacity_claims — an existing
-- ACTIVE claim is neither deleted nor auto-converted; it still blocks physical handoff
-- (packages/core/src/payment/booking-service.ts's verifyPhysicalHandoff) until an explicit
-- reallocation (hold amend/replan) gives it a real inventory_claims/wear_claims row instead.
-- V2 (TD correction, items I/J/L): SECURITY DEFINER, actor from current_setting('zao.actor'), no
-- p_actor parameter; requires a real, existing real_data_acceptance row as evidence.
--
-- V3 (TD correction, P4): NOT ACTIVATED for this booking-intake release. Proving a
-- real_data_acceptance row merely EXISTS is not proof its family/age/size/quantity actually
-- matches this bucket, and this function can reduce provisional backing while ACTIVE provisional
-- promises against it still exist. Neither gap is safe to carry into activation, and closing them
-- properly is a physical-reconciliation subsystem this release deliberately does not build (the
-- Owner's immediate goal — source registration, additive sources, the immutable correction ledger,
-- and provisional claims — does not need it). The table/function shape is kept, unreachable by
-- design, for that later attended phase; unconditionally refusing here (before touching any row)
-- is the fail-closed choice over leaving it reachable-but-untested. No EXECUTE grant exists for
-- this function anywhere in this repository, for any runtime role — this guard additionally fails
-- closed even for the DB owner/migration connection that could otherwise call it directly.
CREATE FUNCTION provisional_capacity_materialize_bucket(p_bucket_id uuid,p_quantity integer,p_real_data_acceptance_id uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE v_actor text;b provisional_capacity_buckets;already integer;effective integer;BEGIN
 RAISE EXCEPTION 'PROVISIONAL_MATERIALIZATION_NOT_ACTIVATED' USING ERRCODE='0A000';
 v_actor:=current_setting('zao.actor');
 IF p_quantity<1 THEN RAISE EXCEPTION 'PROVISIONAL_QUANTITY_INVALID' USING ERRCODE='22023';END IF;
 SELECT * INTO STRICT b FROM provisional_capacity_buckets WHERE id=p_bucket_id FOR UPDATE;
 IF NOT b.active THEN RAISE EXCEPTION 'PROVISIONAL_BUCKET_ALREADY_INACTIVE' USING ERRCODE='23514';END IF;
 PERFORM 1 FROM real_data_acceptance WHERE id=p_real_data_acceptance_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'PROVISIONAL_MATERIALIZATION_EVIDENCE_REQUIRED' USING ERRCODE='23503';END IF;
 -- provisional_capacity_effective_quantity() already nets out every PRIOR materialization (it
 -- subtracts the full provisional_capacity_materializations sum for this bucket) — it IS the
 -- current remaining bookable quantity. Subtracting `already` a second time here would double
 -- count every prior materialization and make `remaining` go negative after the very first partial
 -- call, rejecting every subsequent one even when real quantity clearly remains.
 effective:=provisional_capacity_effective_quantity(p_bucket_id);
 IF p_quantity>effective THEN RAISE EXCEPTION 'PROVISIONAL_MATERIALIZATION_EXCEEDS_QUANTITY' USING ERRCODE='23514';END IF;
 SELECT coalesce(sum(quantity),0) INTO already FROM provisional_capacity_materializations WHERE bucket_id=p_bucket_id;
 INSERT INTO provisional_capacity_materializations(bucket_id,quantity,real_data_acceptance_id,actor) VALUES(p_bucket_id,p_quantity,p_real_data_acceptance_id,v_actor);
 IF p_quantity=effective THEN UPDATE provisional_capacity_buckets SET active=false,materialized_at=clock_timestamp() WHERE id=p_bucket_id;END IF;
 INSERT INTO ops_history(resource,entity_id,actor,event,after_data) VALUES('provisional_capacity_bucket',p_bucket_id,v_actor,'PROVISIONAL_CAPACITY_MATERIALIZED',jsonb_build_object('bucketId',p_bucket_id,'quantity',p_quantity,'cumulativeMaterialized',already+p_quantity,'effectiveQuantity',effective,'realDataAcceptanceId',p_real_data_acceptance_id));
 RETURN already+p_quantity;
END$$;

REVOKE ALL ON FUNCTION provisional_capacity_register_source(text,text,jsonb),provisional_capacity_reduce_bucket(uuid,integer),provisional_capacity_materialize_bucket(uuid,integer,uuid),provisional_capacity_available_on(text,text,text,date),provisional_capacity_effective_quantity(uuid) FROM PUBLIC;
