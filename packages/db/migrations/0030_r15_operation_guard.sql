-- R15 finite Sandbox acceptance only. Empty until the migration owner installs
-- the committed/read-back manifest. Runtime roles cannot create or reset budgets.
CREATE SCHEMA r15_activation;
REVOKE ALL ON SCHEMA r15_activation FROM PUBLIC;
CREATE TABLE r15_activation.manifest (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 manifest_sha256 text NOT NULL CHECK(manifest_sha256 ~ '^[a-f0-9]{64}$'),
 resource_id text NOT NULL CHECK(resource_id='store_i5vh0ZEKo2ikcVo9'),
 database_name text NOT NULL CHECK(database_name ~ '^zr_[a-f0-9]{12}$'),
 booking_id uuid NOT NULL REFERENCES public.rental_bookings(id),
 attempt_id uuid NOT NULL REFERENCES public.rental_payment_attempts(id),
 idempotency_key text NOT NULL CHECK(length(idempotency_key) BETWEEN 1 AND 45),
 merchant_id text NOT NULL CHECK(merchant_id='MLKDVEDH1ME21'),
 location_id text NOT NULL CHECK(location_id ~ '^[A-Za-z0-9_-]{1,100}$'),
 environment text NOT NULL CHECK(environment='SANDBOX'),
 amount_jpy integer NOT NULL CHECK(amount_jpy=100),
 currency text NOT NULL CHECK(currency='JPY')
);
CREATE TABLE r15_activation.operations (
 action text PRIMARY KEY CHECK(action IN ('CREATE_PAYMENT','GET_PAYMENT')),
 manifest_sha256 text NOT NULL,
 state text NOT NULL DEFAULT 'RESERVED_POSSIBLY_DISPATCHED_NO_RETRY'
  CHECK(state='RESERVED_POSSIBLY_DISPATCHED_NO_RETRY'),
 reserved_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON ALL TABLES IN SCHEMA r15_activation FROM PUBLIC;
CREATE FUNCTION r15_activation.reserve(p_hash text,p_action text,p_booking uuid,p_attempt uuid,p_key text,p_location text,p_payment text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE m r15_activation.manifest; acquired boolean;
BEGIN
 SELECT * INTO m FROM r15_activation.manifest WHERE singleton;
 IF NOT FOUND OR m.manifest_sha256 IS DISTINCT FROM p_hash OR m.database_name<>current_database()
  OR m.booking_id IS DISTINCT FROM p_booking OR m.attempt_id IS DISTINCT FROM p_attempt
  OR m.idempotency_key IS DISTINCT FROM p_key OR m.location_id IS DISTINCT FROM p_location
  OR p_action IS NULL OR p_action NOT IN ('CREATE_PAYMENT','GET_PAYMENT') THEN RETURN false; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.rental_payment_attempts a JOIN public.rental_bookings b ON b.id=a.booking_id WHERE b.mode='SQUARE_SANDBOX' AND a.id=m.attempt_id
  AND a.booking_id=m.booking_id AND a.idempotency_key::text=m.idempotency_key
  AND a.merchant_id=m.merchant_id AND a.location_id=m.location_id
  AND a.amount_jpy=100 AND a.currency='JPY'
  AND ((p_action='CREATE_PAYMENT' AND p_payment IS NULL AND a.provider_id IS NULL AND a.state='SUBMITTING')
    OR (p_action='GET_PAYMENT' AND p_payment IS NOT NULL AND a.provider_id=p_payment))) THEN RETURN false; END IF;
 INSERT INTO r15_activation.operations(action,manifest_sha256) VALUES(p_action,p_hash)
 ON CONFLICT(action) DO NOTHING RETURNING true INTO acquired;
 RETURN coalesce(acquired,false);
END $$;
REVOKE ALL ON FUNCTION r15_activation.reserve(text,text,uuid,uuid,text,text,text) FROM PUBLIC;
