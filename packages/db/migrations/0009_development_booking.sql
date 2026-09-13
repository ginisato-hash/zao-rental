-- New development-flow records. Applied 0001-0008 are unchanged. No default staff grants.
ALTER TABLE staff_role_permissions DROP CONSTRAINT staff_role_permissions_permission_check;
ALTER TABLE staff_role_permissions ADD CHECK(permission IN ('INVENTORY_VIEW','INVENTORY_EDIT','STAFF_MANAGE','HOLD_VIEW','HOLD_EDIT','TRANSFER_VIEW','TRANSFER_PLAN','TRANSFER_DISPATCH','TRANSFER_RECEIVE','QUOTE_VIEW','QUOTE_CREATE','PRICE_EDIT','BOOKING_VIEW','BOOKING_CREATE','RENTAL_CHECKOUT','RENTAL_RETURN'));
ALTER TABLE staff_permission_overrides DROP CONSTRAINT staff_permission_overrides_permission_check;
ALTER TABLE staff_permission_overrides ADD CHECK(permission IN ('INVENTORY_VIEW','INVENTORY_EDIT','STAFF_MANAGE','HOLD_VIEW','HOLD_EDIT','TRANSFER_VIEW','TRANSFER_PLAN','TRANSFER_DISPATCH','TRANSFER_RECEIVE','QUOTE_VIEW','QUOTE_CREATE','PRICE_EDIT','BOOKING_VIEW','BOOKING_CREATE','RENTAL_CHECKOUT','RENTAL_RETURN'));
-- ACTIVE denotes the underlying protective witness, not a booking or an extended lease.
-- confirmed_at lets the planner distinguish paid flexible commitments from unknown payment.
ALTER TABLE inventory_holds ADD COLUMN confirmed_at timestamptz;
CREATE TABLE rental_bookings(
 id uuid PRIMARY KEY REFERENCES inventory_reservations(id),owner_id text NOT NULL REFERENCES staff_members(id),
 request_key uuid NOT NULL,fingerprint text NOT NULL CHECK(length(fingerprint)=64),
 hold_id uuid NOT NULL UNIQUE REFERENCES inventory_holds(id),quote_id uuid NOT NULL UNIQUE REFERENCES price_quotes(id),
 conditions jsonb NOT NULL,price_snapshot jsonb NOT NULL,price_sha256 text NOT NULL CHECK(length(price_sha256)=64),
 contact jsonb NOT NULL,mode text NOT NULL CHECK(mode='SIMULATED_DEV'),
 state text NOT NULL CHECK(state IN ('DRAFT','PAYMENT_PENDING','PAYMENT_REVIEW','CONFIRMED_DEV','COMPLETED_DEV')),
 confirmed_at timestamptz,version integer NOT NULL DEFAULT 1 CHECK(version>0),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(owner_id,request_key),CHECK(price_snapshot->>'chargeReady'='false'),CHECK((state IN ('CONFIRMED_DEV','COMPLETED_DEV'))=(confirmed_at IS NOT NULL))
);
CREATE TABLE rental_payment_attempts(
 id uuid PRIMARY KEY,booking_id uuid NOT NULL UNIQUE REFERENCES rental_bookings(id),actor text NOT NULL REFERENCES staff_members(id),
 idempotency_key uuid NOT NULL UNIQUE,merchant_id text NOT NULL,location_id text NOT NULL,amount_jpy bigint NOT NULL CHECK(amount_jpy BETWEEN 1 AND 100000000),currency text NOT NULL CHECK(currency='JPY'),
 state text NOT NULL CHECK(state IN ('SUBMITTING','UNKNOWN','PENDING','COMPLETED','FAILED','REVIEW')),
 provider_id text UNIQUE,provider_state text,provider_updated_at timestamptz,completed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE rental_provider_events(event_id text PRIMARY KEY,attempt_id uuid NOT NULL REFERENCES rental_payment_attempts(id),payload_sha256 text NOT NULL CHECK(length(payload_sha256)=64),outcome text NOT NULL,received_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE rental_requests(actor text NOT NULL REFERENCES staff_members(id),request_key uuid NOT NULL,fingerprint text NOT NULL CHECK(length(fingerprint)=64),result jsonb NOT NULL,PRIMARY KEY(actor,request_key));
CREATE TABLE rental_notifications(id uuid PRIMARY KEY,booking_id uuid NOT NULL UNIQUE REFERENCES rental_bookings(id),destination text NOT NULL CHECK(destination ~ '^synthetic-[a-z0-9-]+@example\.invalid$'),state text NOT NULL CHECK(state='CAPTURED_TEST_ONLY'),created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE rental_history(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,actor text NOT NULL REFERENCES staff_members(id),entity_id uuid NOT NULL,event text NOT NULL,before_data jsonb,after_data jsonb NOT NULL,occurred_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE FUNCTION rental_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$BEGIN
 INSERT INTO rental_history(actor,entity_id,event,before_data,after_data) VALUES(current_setting('zao.actor'),NEW.id,TG_TABLE_NAME||'_'||TG_OP,CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD)-'contact' ELSE NULL END,to_jsonb(NEW)-'contact');RETURN NEW;
END$$;
CREATE TRIGGER rental_history_guard BEFORE INSERT OR UPDATE OR DELETE ON rental_history FOR EACH ROW EXECUTE FUNCTION ledger_append_only();
CREATE FUNCTION rental_booking_guard() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
 IF TG_OP='DELETE' OR (to_jsonb(NEW)-ARRAY['state','confirmed_at','version']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','confirmed_at','version']) OR NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'immutable booking contract' USING ERRCODE='23514';END IF;RETURN NEW;
END$$;
CREATE TRIGGER rental_booking_guard BEFORE UPDATE OR DELETE ON rental_bookings FOR EACH ROW EXECUTE FUNCTION rental_booking_guard();
CREATE TRIGGER rental_bookings_lock BEFORE INSERT OR UPDATE OR DELETE ON rental_bookings FOR EACH STATEMENT EXECUTE FUNCTION inventory_lock();
CREATE TRIGGER rental_payments_lock BEFORE INSERT OR UPDATE OR DELETE ON rental_payment_attempts FOR EACH STATEMENT EXECUTE FUNCTION inventory_lock();
CREATE TRIGGER rental_bookings_audit AFTER INSERT OR UPDATE ON rental_bookings FOR EACH ROW EXECUTE FUNCTION rental_audit();
CREATE TRIGGER rental_payments_audit AFTER INSERT OR UPDATE ON rental_payment_attempts FOR EACH ROW EXECUTE FUNCTION rental_audit();
CREATE TRIGGER rental_events_immutable BEFORE UPDATE OR DELETE ON rental_provider_events FOR EACH ROW EXECUTE FUNCTION pricing_immutable();
CREATE TRIGGER rental_notifications_immutable BEFORE UPDATE OR DELETE ON rental_notifications FOR EACH ROW EXECUTE FUNCTION pricing_immutable();
REVOKE ALL ON FUNCTION rental_audit(),rental_booking_guard() FROM PUBLIC;
