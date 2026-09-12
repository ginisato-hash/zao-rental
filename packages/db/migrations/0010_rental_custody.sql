-- Additive custody records only. Existing ledger guards, columns and privileges stay intact.
CREATE TABLE rental_preparations(id uuid PRIMARY KEY REFERENCES rental_bookings(id),store_id text NOT NULL REFERENCES ledger_stores(id),checked_in_at timestamptz NOT NULL,checked_in_by text NOT NULL REFERENCES staff_members(id),prepared_at timestamptz,prepared_by text REFERENCES staff_members(id),fit_evidence jsonb,version integer NOT NULL DEFAULT 1 CHECK(version>0),CHECK((prepared_at IS NULL)=(fit_evidence IS NULL)));
CREATE TABLE rental_loan_items(
 id uuid PRIMARY KEY,cycle_id uuid NOT NULL,booking_id uuid NOT NULL REFERENCES rental_bookings(id),requirement_key text NOT NULL,
 asset_id uuid REFERENCES ledger_assets(id),pole_id uuid REFERENCES ledger_poles(id),pole_slot integer,
 family text NOT NULL CHECK(family IN ('SKI','SKI_BOOT','SNOWBOARD','SNOWBOARD_BOOT','POLE')),variant_id uuid NOT NULL REFERENCES ledger_variants(id),
 unit text NOT NULL CHECK(unit IN ('PAIR','BOARD')),quantity integer NOT NULL CHECK(quantity=1),pickup_store text NOT NULL REFERENCES ledger_stores(id),
 checked_out_at timestamptz NOT NULL,checked_out_by text NOT NULL REFERENCES staff_members(id),due_at timestamptz NOT NULL,
 state text NOT NULL CHECK(state IN ('OUT','RECEIVED')),version integer NOT NULL DEFAULT 1 CHECK(version>0),UNIQUE(booking_id,requirement_key),
 CHECK((asset_id IS NULL)<>(pole_id IS NULL)),CHECK((family='POLE')=(pole_id IS NOT NULL)),CHECK((pole_id IS NULL)=(pole_slot IS NULL))
);
CREATE UNIQUE INDEX rental_one_active_asset ON rental_loan_items(asset_id) WHERE state='OUT';
CREATE TABLE rental_return_batches(id uuid PRIMARY KEY,owner_id text NOT NULL REFERENCES staff_members(id),store_id text NOT NULL REFERENCES ledger_stores(id),created_at timestamptz NOT NULL,version integer NOT NULL DEFAULT 1 CHECK(version>0));
CREATE TABLE rental_return_candidates(id uuid PRIMARY KEY,batch_id uuid NOT NULL REFERENCES rental_return_batches(id),request_key uuid NOT NULL,scan_sha256 text NOT NULL CHECK(length(scan_sha256)=64),asset_id uuid,pole_id uuid,loan_item_id uuid REFERENCES rental_loan_items(id),cycle_id uuid,loan_version integer,scanned_at timestamptz NOT NULL,state text NOT NULL CHECK(state IN ('CANDIDATE','RECEIVED','REVIEW')),outcome text NOT NULL,UNIQUE(batch_id,request_key),UNIQUE(batch_id,loan_item_id),CHECK((loan_item_id IS NULL)=(cycle_id IS NULL)));
CREATE TABLE rental_receipts(id uuid PRIMARY KEY,loan_item_id uuid NOT NULL UNIQUE REFERENCES rental_loan_items(id),candidate_id uuid NOT NULL UNIQUE REFERENCES rental_return_candidates(id),received_store text NOT NULL REFERENCES ledger_stores(id),actor text NOT NULL REFERENCES staff_members(id),scanned_at timestamptz NOT NULL,confirmed_at timestamptz NOT NULL,actual_received_at timestamptz NOT NULL,CHECK(actual_received_at<=confirmed_at));
CREATE TABLE rental_inspections(id uuid PRIMARY KEY,loan_item_id uuid NOT NULL UNIQUE REFERENCES rental_loan_items(id),actor text NOT NULL REFERENCES staff_members(id),store_id text NOT NULL REFERENCES ledger_stores(id),inspected_at timestamptz NOT NULL,result text NOT NULL CHECK(result='READY'),evidence text NOT NULL CHECK(length(btrim(evidence)) BETWEEN 1 AND 160));
-- Actual receipt location is an immutable fact even when ledger reintegration remains blocked.
CREATE VIEW rental_actual_custody AS SELECT DISTINCT ON(l.asset_id) l.asset_id,r.received_store AS actual_store,r.id AS receipt_id,r.actual_received_at,CASE WHEN r.received_store<>l.pickup_store THEN 'CROSS_STORE_REINTEGRATION_REQUIRED' WHEN i.id IS NULL THEN 'RETURNED_PENDING_INSPECTION' ELSE 'INSPECTED_DATE_BLOCK_APPLIES' END AS state FROM rental_receipts r JOIN rental_loan_items l ON l.id=r.loan_item_id LEFT JOIN rental_inspections i ON i.loan_item_id=l.id WHERE l.asset_id IS NOT NULL ORDER BY l.asset_id,r.actual_received_at DESC,r.id DESC;
CREATE VIEW rental_inventory_blocks AS
 SELECT l.id,l.asset_id,l.pole_id,(l.due_at AT TIME ZONE 'Asia/Tokyo')::date AS starts_on,'9999-12-31'::date AS ends_on,'OVERDUE_OUT'::text AS reason FROM rental_loan_items l WHERE l.state='OUT' AND l.due_at<=inventory_clock()
 UNION ALL SELECT l.id,l.asset_id,l.pole_id,(r.actual_received_at AT TIME ZONE 'Asia/Tokyo')::date,
 CASE WHEN i.id IS NULL OR r.received_store<>l.pickup_store THEN '9999-12-31'::date ELSE greatest((b.conditions->'period'->>'endDate')::date,(r.actual_received_at AT TIME ZONE 'Asia/Tokyo')::date) END,
 CASE WHEN r.received_store<>l.pickup_store THEN 'CROSS_STORE_REINTEGRATION_REQUIRED' WHEN i.id IS NULL THEN 'INSPECTION_PENDING' ELSE 'CONTRACT_DATE_BLOCK' END
 FROM rental_receipts r JOIN rental_loan_items l ON l.id=r.loan_item_id JOIN rental_bookings b ON b.id=l.booking_id LEFT JOIN rental_inspections i ON i.loan_item_id=l.id;
CREATE FUNCTION rental_loan_guard() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
 IF TG_OP='DELETE' OR (to_jsonb(NEW)-ARRAY['state','version']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','version']) OR OLD.state<>'OUT' OR NEW.state<>'RECEIVED' OR NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'immutable loan cycle' USING ERRCODE='23514';END IF;RETURN NEW;
END$$;
CREATE TRIGGER rental_loan_guard BEFORE UPDATE OR DELETE ON rental_loan_items FOR EACH ROW EXECUTE FUNCTION rental_loan_guard();
CREATE FUNCTION rental_attempt_guard() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
 IF TG_OP='DELETE' OR (to_jsonb(NEW)-ARRAY['state','provider_id','provider_state','provider_updated_at','completed_at','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','provider_id','provider_state','provider_updated_at','completed_at','updated_at']) OR (OLD.state='COMPLETED' AND NEW IS DISTINCT FROM OLD) OR (OLD.provider_id IS NOT NULL AND OLD.provider_id IS DISTINCT FROM NEW.provider_id) THEN RAISE EXCEPTION 'immutable payment identity or terminal result' USING ERRCODE='23514';END IF;RETURN NEW;
END$$;
CREATE TRIGGER rental_attempt_guard BEFORE UPDATE OR DELETE ON rental_payment_attempts FOR EACH ROW EXECUTE FUNCTION rental_attempt_guard();
CREATE TRIGGER rental_preparations_lock BEFORE INSERT OR UPDATE OR DELETE ON rental_preparations FOR EACH STATEMENT EXECUTE FUNCTION inventory_lock();
CREATE TRIGGER rental_preparations_audit AFTER INSERT OR UPDATE ON rental_preparations FOR EACH ROW EXECUTE FUNCTION rental_audit();
CREATE TRIGGER rental_loan_items_lock BEFORE INSERT OR UPDATE OR DELETE ON rental_loan_items FOR EACH STATEMENT EXECUTE FUNCTION inventory_lock();
CREATE TRIGGER rental_loan_items_audit AFTER INSERT OR UPDATE ON rental_loan_items FOR EACH ROW EXECUTE FUNCTION rental_audit();
CREATE TRIGGER rental_return_batches_lock BEFORE INSERT OR UPDATE OR DELETE ON rental_return_batches FOR EACH STATEMENT EXECUTE FUNCTION inventory_lock();
CREATE TRIGGER rental_return_batches_audit AFTER INSERT OR UPDATE ON rental_return_batches FOR EACH ROW EXECUTE FUNCTION rental_audit();
CREATE TRIGGER rental_return_candidates_lock BEFORE INSERT OR UPDATE OR DELETE ON rental_return_candidates FOR EACH STATEMENT EXECUTE FUNCTION inventory_lock();
CREATE TRIGGER rental_return_candidates_audit AFTER INSERT OR UPDATE ON rental_return_candidates FOR EACH ROW EXECUTE FUNCTION rental_audit();
CREATE TRIGGER rental_receipts_lock BEFORE INSERT OR UPDATE OR DELETE ON rental_receipts FOR EACH STATEMENT EXECUTE FUNCTION inventory_lock();
CREATE TRIGGER rental_receipts_audit AFTER INSERT OR UPDATE ON rental_receipts FOR EACH ROW EXECUTE FUNCTION rental_audit();
CREATE TRIGGER rental_inspections_lock BEFORE INSERT OR UPDATE OR DELETE ON rental_inspections FOR EACH STATEMENT EXECUTE FUNCTION inventory_lock();
CREATE TRIGGER rental_inspections_audit AFTER INSERT OR UPDATE ON rental_inspections FOR EACH ROW EXECUTE FUNCTION rental_audit();
CREATE TRIGGER rental_receipts_immutable BEFORE UPDATE OR DELETE ON rental_receipts FOR EACH ROW EXECUTE FUNCTION pricing_immutable();
CREATE TRIGGER rental_inspections_immutable BEFORE UPDATE OR DELETE ON rental_inspections FOR EACH ROW EXECUTE FUNCTION pricing_immutable();
REVOKE ALL ON FUNCTION rental_loan_guard(),rental_attempt_guard() FROM PUBLIC;
