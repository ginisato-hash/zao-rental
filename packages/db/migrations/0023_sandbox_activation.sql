-- Additive sandbox execution journal. No production mode or real credential exists here.
ALTER TABLE rental_bookings DROP CONSTRAINT rental_bookings_mode_check;
ALTER TABLE rental_bookings ADD CONSTRAINT rental_bookings_mode_check CHECK(mode IN ('SIMULATED_DEV','SQUARE_SANDBOX'));
CREATE TABLE sandbox_activation_runs (
 id text PRIMARY KEY CHECK(id='P4-SANDBOX-OWNER-R1'),
 evidence text NOT NULL CHECK(evidence IN ('FIXTURE','REAL_SANDBOX')),
 merchant_id text NOT NULL,location_ids jsonb NOT NULL,
 payment_limit integer NOT NULL CHECK(payment_limit=20),refund_limit integer NOT NULL CHECK(refund_limit=5),
 stopped_reason text CHECK(stopped_reason IN ('SQUARE_AUTH_STOP','SQUARE_QUOTA_STOP','SQUARE_BUDGET_EXHAUSTED')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE sandbox_activation_calls (
 run_id text NOT NULL REFERENCES sandbox_activation_runs(id),
 operation text NOT NULL CHECK(operation IN ('PAYMENT','REFUND')),
 request_key uuid NOT NULL,reference_id uuid NOT NULL,payment_id text,
 fingerprint text NOT NULL CHECK(fingerprint ~ '^[a-f0-9]{64}$'),
 amount_jpy bigint NOT NULL CHECK(amount_jpy>0),
 status text NOT NULL CHECK(status IN ('SUBMITTING','UNKNOWN','OBSERVED')),
 result jsonb,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(run_id,operation,request_key),UNIQUE(run_id,operation,reference_id),
 CHECK((operation='REFUND')=(payment_id IS NOT NULL))
);
REVOKE ALL ON sandbox_activation_runs,sandbox_activation_calls FROM PUBLIC;

-- Runtime can stop an activation, never change its authority or clear the stop.
CREATE FUNCTION sandbox_activation_guard() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
 IF (to_jsonb(NEW)-'stopped_reason') IS DISTINCT FROM (to_jsonb(OLD)-'stopped_reason') OR OLD.stopped_reason IS NOT NULL AND NEW.stopped_reason IS DISTINCT FROM OLD.stopped_reason THEN RAISE EXCEPTION 'immutable activation approval' USING ERRCODE='23514';END IF;RETURN NEW;
END$$;
REVOKE ALL ON FUNCTION sandbox_activation_guard() FROM PUBLIC;
CREATE TRIGGER sandbox_activation_guard BEFORE UPDATE ON sandbox_activation_runs FOR EACH ROW EXECUTE FUNCTION sandbox_activation_guard();
