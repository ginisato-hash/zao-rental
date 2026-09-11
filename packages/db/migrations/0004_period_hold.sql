-- Additive E06; original 0001/0002/0003 and business/price configuration are untouched.
ALTER TABLE staff_role_permissions DROP CONSTRAINT staff_role_permissions_permission_check;
ALTER TABLE staff_role_permissions ADD CHECK(permission IN ('INVENTORY_VIEW','INVENTORY_EDIT','STAFF_MANAGE','HOLD_VIEW','HOLD_EDIT'));
ALTER TABLE staff_permission_overrides DROP CONSTRAINT staff_permission_overrides_permission_check;
ALTER TABLE staff_permission_overrides ADD CHECK(permission IN ('INVENTORY_VIEW','INVENTORY_EDIT','STAFF_MANAGE','HOLD_VIEW','HOLD_EDIT'));
-- Explicit individual grants only. No existing role gains new powers during upgrade.
CREATE TABLE inventory_reservations(id uuid PRIMARY KEY, owner_id text NOT NULL REFERENCES staff_members(id));
CREATE TABLE inventory_holds(
 id uuid PRIMARY KEY, reservation_id uuid NOT NULL REFERENCES inventory_reservations(id), owner_id text NOT NULL REFERENCES staff_members(id),
 pickup_store text NOT NULL REFERENCES ledger_stores(id), return_store text NOT NULL REFERENCES ledger_stores(id), conditions jsonb NOT NULL,
 starts_at timestamptz NOT NULL, due_at timestamptz NOT NULL CHECK(due_at>starts_at),
 occupancy_start date NOT NULL, occupancy_end date NOT NULL CHECK(occupancy_end>=occupancy_start AND occupancy_end<occupancy_start+10),
 occupancy_policy text NOT NULL DEFAULT 'WHOLE_TOKYO_DATE_V1' CHECK(occupancy_policy='WHOLE_TOKYO_DATE_V1'),
 expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 state text NOT NULL CHECK(state IN ('ACTIVE','RELEASED','EXPIRED')),
 payment_state text NOT NULL DEFAULT 'NONE' CHECK(payment_state IN ('NONE','PENDING','UNKNOWN','SUCCESS','FAILURE')),
 allocation_stage text NOT NULL DEFAULT 'PROVISIONAL' CHECK(allocation_stage IN ('PROVISIONAL','PREPARATION_FIXED','RENTAL_FIXED')),
 version integer NOT NULL DEFAULT 1 CHECK(version>0)
);
CREATE UNIQUE INDEX inventory_one_active_reservation ON inventory_holds(reservation_id) WHERE state='ACTIVE';
CREATE TABLE inventory_claims(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, hold_id uuid NOT NULL REFERENCES inventory_holds(id), requirement_key text NOT NULL,
 asset_id uuid REFERENCES ledger_assets(id), pole_id uuid REFERENCES ledger_poles(id), pole_slot integer,
 day date NOT NULL, active boolean NOT NULL DEFAULT true,
 CHECK((asset_id IS NOT NULL AND pole_id IS NULL AND pole_slot IS NULL) OR (asset_id IS NULL AND pole_id IS NOT NULL AND pole_slot>0))
);
CREATE UNIQUE INDEX inventory_asset_day ON inventory_claims(asset_id,day) WHERE active AND asset_id IS NOT NULL;
CREATE UNIQUE INDEX inventory_pole_day ON inventory_claims(pole_id,pole_slot,day) WHERE active AND pole_id IS NOT NULL;
CREATE INDEX inventory_hold_claims ON inventory_claims(hold_id);
CREATE TABLE inventory_requests(owner_id text NOT NULL REFERENCES staff_members(id), request_key uuid NOT NULL, fingerprint text NOT NULL CHECK(length(fingerprint)=64), result jsonb NOT NULL, PRIMARY KEY(owner_id,request_key));
CREATE TABLE inventory_history(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, hold_id uuid NOT NULL REFERENCES inventory_holds(id), actor text NOT NULL REFERENCES staff_members(id), event text NOT NULL, before_data jsonb, after_data jsonb NOT NULL, occurred_at timestamptz NOT NULL DEFAULT clock_timestamp());
-- Trusted future operational input, no app-role writer or public endpoint. Blocking only in E06.
CREATE TABLE inventory_replans(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, actor text NOT NULL REFERENCES staff_members(id), before_claims jsonb NOT NULL, after_claims jsonb NOT NULL, occurred_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE inventory_constraints(id uuid PRIMARY KEY, asset_id uuid REFERENCES ledger_assets(id), pole_id uuid REFERENCES ledger_poles(id), starts_on date NOT NULL, ends_on date NOT NULL CHECK(ends_on>=starts_on), kind text NOT NULL CHECK(kind IN ('MAINTENANCE','OUT','TRANSFER_UNVERIFIED')), evidence_ref text NOT NULL CHECK(length(evidence_ref) BETWEEN 1 AND 160), CHECK((asset_id IS NULL)<>(pole_id IS NULL)));
CREATE FUNCTION inventory_lock() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN PERFORM pg_advisory_xact_lock(71820600);RETURN NULL;END$$;
-- Lock BEFORE any row locks; all writers of stock/claims/operational constraints share this boundary.
CREATE TRIGGER inventory_assets_lock BEFORE INSERT OR UPDATE OR DELETE ON ledger_assets FOR EACH STATEMENT EXECUTE FUNCTION inventory_lock();
CREATE TRIGGER inventory_poles_lock BEFORE INSERT OR UPDATE OR DELETE ON ledger_poles FOR EACH STATEMENT EXECUTE FUNCTION inventory_lock();
CREATE TRIGGER inventory_claims_lock BEFORE INSERT OR UPDATE OR DELETE ON inventory_claims FOR EACH STATEMENT EXECUTE FUNCTION inventory_lock();
CREATE TRIGGER inventory_holds_lock BEFORE INSERT OR UPDATE OR DELETE ON inventory_holds FOR EACH STATEMENT EXECUTE FUNCTION inventory_lock();
CREATE TRIGGER inventory_constraints_lock BEFORE INSERT OR UPDATE OR DELETE ON inventory_constraints FOR EACH STATEMENT EXECUTE FUNCTION inventory_lock();
CREATE FUNCTION inventory_stock_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_TABLE_NAME='ledger_assets' THEN
  IF NEW.status<>'AVAILABLE' AND EXISTS(SELECT 1 FROM inventory_claims WHERE asset_id=NEW.id AND active) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Protected inventory requires reconciliation';END IF;
 ELSE
  IF EXISTS(SELECT 1 FROM inventory_claims WHERE pole_id=NEW.id AND active AND (NEW.status<>'AVAILABLE' OR pole_slot>NEW.quantity)) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Protected quantity requires reconciliation';END IF;
 END IF; RETURN NEW;
END$$;
CREATE TRIGGER inventory_asset_stock_guard BEFORE UPDATE ON ledger_assets FOR EACH ROW EXECUTE FUNCTION inventory_stock_guard();
CREATE TRIGGER inventory_pole_stock_guard BEFORE UPDATE ON ledger_poles FOR EACH ROW EXECUTE FUNCTION inventory_stock_guard();
CREATE FUNCTION inventory_claim_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE h inventory_holds; status text; qty integer; store text;
BEGIN
 IF NOT NEW.active THEN RETURN NEW;END IF;
 SELECT * INTO STRICT h FROM inventory_holds WHERE id=NEW.hold_id;
 IF h.state<>'ACTIVE' OR NEW.day<h.occupancy_start OR NEW.day>h.occupancy_end THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Invalid hold claim';END IF;
 IF NEW.asset_id IS NOT NULL THEN SELECT a.status,a.store_id INTO status,store FROM ledger_assets a WHERE a.id=NEW.asset_id;
 ELSE SELECT p.status,p.quantity,p.store_id INTO status,qty,store FROM ledger_poles p WHERE p.id=NEW.pole_id;END IF;
 IF status<>'AVAILABLE' OR store<>h.pickup_store OR NEW.pole_slot>qty THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Invalid stock claim';END IF;RETURN NEW;
END$$;
CREATE TRIGGER inventory_claim_guard BEFORE INSERT OR UPDATE ON inventory_claims FOR EACH ROW EXECUTE FUNCTION inventory_claim_guard();
CREATE FUNCTION inventory_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 INSERT INTO inventory_history(hold_id,actor,event,before_data,after_data) VALUES(NEW.id,current_setting('zao.actor'),CASE WHEN TG_OP='INSERT' THEN 'CREATE' WHEN NEW.state<>OLD.state THEN NEW.state ELSE 'AMEND' END,CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) ELSE NULL END,to_jsonb(NEW));RETURN NEW;
END$$;
CREATE TRIGGER inventory_audit AFTER INSERT OR UPDATE ON inventory_holds FOR EACH ROW EXECUTE FUNCTION inventory_audit();
CREATE TRIGGER inventory_history_guard BEFORE INSERT OR UPDATE OR DELETE ON inventory_history FOR EACH ROW EXECUTE FUNCTION ledger_append_only();
REVOKE ALL ON FUNCTION inventory_stock_guard(),inventory_claim_guard(),inventory_audit(),inventory_lock() FROM PUBLIC;

CREATE FUNCTION inventory_record_replan(before_claims jsonb,after_claims jsonb) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 INSERT INTO inventory_replans(actor,before_claims,after_claims) VALUES(current_setting('zao.actor'),before_claims,after_claims)
$$;
REVOKE ALL ON FUNCTION inventory_record_replan(jsonb,jsonb) FROM PUBLIC;
