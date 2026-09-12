-- E08 is private development estimation; no production price publication or payment capability.
ALTER TABLE staff_role_permissions DROP CONSTRAINT staff_role_permissions_permission_check;
ALTER TABLE staff_role_permissions ADD CHECK(permission IN ('INVENTORY_VIEW','INVENTORY_EDIT','STAFF_MANAGE','HOLD_VIEW','HOLD_EDIT','TRANSFER_VIEW','TRANSFER_PLAN','TRANSFER_DISPATCH','TRANSFER_RECEIVE','QUOTE_VIEW','QUOTE_CREATE','PRICE_EDIT'));
ALTER TABLE staff_permission_overrides DROP CONSTRAINT staff_permission_overrides_permission_check;
ALTER TABLE staff_permission_overrides ADD CHECK(permission IN ('INVENTORY_VIEW','INVENTORY_EDIT','STAFF_MANAGE','HOLD_VIEW','HOLD_EDIT','TRANSFER_VIEW','TRANSFER_PLAN','TRANSFER_DISPATCH','TRANSFER_RECEIVE','QUOTE_VIEW','QUOTE_CREATE','PRICE_EDIT'));
-- New permissions have no role defaults.
CREATE TABLE price_books(id uuid PRIMARY KEY,created_by text NOT NULL REFERENCES staff_members(id),source_book_id uuid REFERENCES price_books(id),source_sha256 text NOT NULL CHECK(length(source_sha256)=64),table_jpy jsonb NOT NULL CHECK(jsonb_typeof(table_jpy)='object'),state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','PRIVATE_AVAILABLE')),rental_from date NOT NULL,rental_until date NOT NULL CHECK(rental_until>=rental_from),revision integer NOT NULL DEFAULT 1 CHECK(revision>0),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),CHECK(rental_until-rental_from<=3660));
-- One explicit shared-store activation channel. Successors supersede the entire prior channel, never individual daily rows.
CREATE TABLE price_activations(id uuid PRIMARY KEY,book_id uuid NOT NULL UNIQUE REFERENCES price_books(id),effective_at timestamptz NOT NULL UNIQUE,predecessor_id uuid UNIQUE REFERENCES price_activations(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(id,book_id));
CREATE UNIQUE INDEX price_activation_first ON price_activations((predecessor_id IS NULL)) WHERE predecessor_id IS NULL;
CREATE TABLE coupon_versions(id uuid PRIMARY KEY,code text NOT NULL UNIQUE CHECK(code ~ '^[A-Z0-9-]{1,32}$'),terms jsonb NOT NULL CHECK(jsonb_typeof(terms)='object'),created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE price_quotes(id uuid PRIMARY KEY,actor text NOT NULL REFERENCES staff_members(id),request_key uuid NOT NULL,request_fingerprint text NOT NULL CHECK(length(request_fingerprint)=64),book_id uuid NOT NULL REFERENCES price_books(id),activation_id uuid NOT NULL REFERENCES price_activations(id),coupon_id uuid REFERENCES coupon_versions(id),hold_id uuid REFERENCES inventory_holds(id),hold_version integer,conditions jsonb NOT NULL,snapshot jsonb NOT NULL,snapshot_sha256 text NOT NULL CHECK(length(snapshot_sha256)=64),expires_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(actor,request_key),FOREIGN KEY(activation_id,book_id) REFERENCES price_activations(id,book_id),CHECK((snapshot->>'currency'='JPY' AND snapshot->>'chargeReady'='false') IS TRUE));
CREATE INDEX price_quotes_actor ON price_quotes(actor,created_at DESC,id);
-- Reservation is a separate future booking boundary, not consumed by quote lookup. No public redemption endpoint.
CREATE TABLE coupon_reservations(id uuid PRIMARY KEY,coupon_id uuid NOT NULL REFERENCES coupon_versions(id),quote_id uuid NOT NULL UNIQUE REFERENCES price_quotes(id),actor text NOT NULL REFERENCES staff_members(id),operation_key uuid NOT NULL,expires_at timestamptz NOT NULL,UNIQUE(actor,operation_key));
CREATE INDEX coupon_reservation_capacity ON coupon_reservations(coupon_id,expires_at);
CREATE TABLE pricing_history(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,actor text NOT NULL REFERENCES staff_members(id),entity_id uuid NOT NULL,event text NOT NULL,before_data jsonb,after_data jsonb NOT NULL,occurred_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE FUNCTION pricing_lock() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN PERFORM pg_advisory_xact_lock(71820800);RETURN NULL;END$$;
CREATE FUNCTION pricing_immutable() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Immutable price evidence';END$$;
CREATE FUNCTION price_book_guard() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
 IF TG_OP='DELETE' OR OLD.state='PRIVATE_AVAILABLE' OR NEW.id<>OLD.id OR NEW.created_by<>OLD.created_by OR NEW.source_sha256<>OLD.source_sha256 OR NEW.source_book_id IS DISTINCT FROM OLD.source_book_id OR NEW.created_at<>OLD.created_at OR NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Immutable or stale price book';END IF;RETURN NEW;
END$$;
CREATE FUNCTION price_activation_guard() RETURNS trigger LANGUAGE plpgsql AS $$DECLARE prior price_activations;BEGIN
 IF NOT EXISTS(SELECT 1 FROM price_books WHERE id=NEW.book_id AND state='PRIVATE_AVAILABLE') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Book is not privately available';END IF;
 SELECT * INTO prior FROM price_activations ORDER BY effective_at DESC LIMIT 1;
 IF (prior.id IS NOT NULL AND (NEW.predecessor_id IS DISTINCT FROM prior.id OR NEW.effective_at<=prior.effective_at)) OR (prior.id IS NULL AND NEW.predecessor_id IS NOT NULL) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Ambiguous activation predecessor';END IF;RETURN NEW;
END$$;
CREATE FUNCTION pricing_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$BEGIN
 INSERT INTO pricing_history(actor,entity_id,event,before_data,after_data) VALUES(current_setting('zao.actor'),NEW.id,TG_TABLE_NAME||'_'||TG_OP,CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) ELSE NULL END,to_jsonb(NEW));RETURN NEW;
END$$;
CREATE TRIGGER price_books_lock BEFORE INSERT OR UPDATE OR DELETE ON price_books FOR EACH STATEMENT EXECUTE FUNCTION pricing_lock();
CREATE TRIGGER price_book_guard BEFORE UPDATE OR DELETE ON price_books FOR EACH ROW EXECUTE FUNCTION price_book_guard();
CREATE TRIGGER price_book_audit AFTER INSERT OR UPDATE ON price_books FOR EACH ROW EXECUTE FUNCTION pricing_audit();
CREATE TRIGGER price_activations_lock BEFORE INSERT OR UPDATE OR DELETE ON price_activations FOR EACH STATEMENT EXECUTE FUNCTION pricing_lock();
CREATE TRIGGER price_activation_guard BEFORE INSERT ON price_activations FOR EACH ROW EXECUTE FUNCTION price_activation_guard();
CREATE TRIGGER price_activations_immutable BEFORE UPDATE OR DELETE ON price_activations FOR EACH ROW EXECUTE FUNCTION pricing_immutable();
CREATE TRIGGER price_activations_audit AFTER INSERT ON price_activations FOR EACH ROW EXECUTE FUNCTION pricing_audit();
CREATE TRIGGER coupons_lock BEFORE INSERT OR UPDATE OR DELETE ON coupon_versions FOR EACH STATEMENT EXECUTE FUNCTION pricing_lock();
CREATE TRIGGER coupons_immutable BEFORE UPDATE OR DELETE ON coupon_versions FOR EACH ROW EXECUTE FUNCTION pricing_immutable();
CREATE TRIGGER coupons_audit AFTER INSERT ON coupon_versions FOR EACH ROW EXECUTE FUNCTION pricing_audit();
CREATE TRIGGER quotes_immutable BEFORE UPDATE OR DELETE ON price_quotes FOR EACH ROW EXECUTE FUNCTION pricing_immutable();
CREATE TRIGGER quotes_audit AFTER INSERT ON price_quotes FOR EACH ROW EXECUTE FUNCTION pricing_audit();
CREATE TRIGGER coupon_reservation_lock BEFORE INSERT OR UPDATE OR DELETE ON coupon_reservations FOR EACH STATEMENT EXECUTE FUNCTION pricing_lock();
CREATE TRIGGER coupon_reservations_immutable BEFORE UPDATE OR DELETE ON coupon_reservations FOR EACH ROW EXECUTE FUNCTION pricing_immutable();
CREATE TRIGGER coupon_reservations_audit AFTER INSERT ON coupon_reservations FOR EACH ROW EXECUTE FUNCTION pricing_audit();
CREATE TRIGGER pricing_history_guard BEFORE INSERT OR UPDATE OR DELETE ON pricing_history FOR EACH ROW EXECUTE FUNCTION ledger_append_only();
REVOKE ALL ON FUNCTION pricing_audit() FROM PUBLIC;
