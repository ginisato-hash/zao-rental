-- R6: additive Production payment admission. No existing function/constraint value is removed;
-- SIMULATED_DEV/SQUARE_SANDBOX and every SANDBOX-only guard in 0023/0026/0028/0029 remain
-- byte-identical and fully usable. This migration only ever *adds* a new accepted mode value and
-- two new SQL functions that mirror the existing SANDBOX-only context loaders for the parallel
-- PRODUCTION case. dispatch/claim/finalize/provider_stops/streams (0026) already accept
-- PRODUCTION as a first-class environment value and are untouched here.
ALTER TABLE rental_bookings DROP CONSTRAINT rental_bookings_mode_check;
ALTER TABLE rental_bookings ADD CONSTRAINT rental_bookings_mode_check CHECK(mode IN ('SIMULATED_DEV','SQUARE_SANDBOX','SQUARE_PRODUCTION'));

-- Mirrors payment_reconciliation.load_context (0026) exactly, substituting PRODUCTION/SQUARE_PRODUCTION
-- for SANDBOX/SQUARE_SANDBOX. No other predicate, join, or return shape differs.
CREATE FUNCTION payment_reconciliation.load_context_production(p_environment text,p_merchant text,p_payment text) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE a public.rental_payment_attempts;
BEGIN
 IF p_environment IS DISTINCT FROM 'PRODUCTION' THEN RETURN NULL;END IF;
 SELECT x.* INTO a FROM public.rental_payment_attempts x JOIN public.rental_bookings b ON b.id=x.booking_id
  WHERE x.provider_id=p_payment AND x.merchant_id=p_merchant AND b.mode='SQUARE_PRODUCTION' AND b.price_snapshot->>'chargeReady'='false';
 IF NOT FOUND THEN RETURN NULL;END IF;
 RETURN payment_reconciliation.format_context(a);
END$$;
CREATE FUNCTION payment_reconciliation.load_contexts_production(p_environment text,p_jobs uuid[]) RETURNS SETOF jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF coalesce(cardinality(p_jobs),0)>20 THEN RAISE EXCEPTION 'INVALID_CONTEXT_BATCH' USING ERRCODE='22023';END IF;
 IF p_environment IS DISTINCT FROM 'PRODUCTION' THEN RETURN;END IF;
 RETURN QUERY SELECT jsonb_build_object('jobId',j.id,'context',payment_reconciliation.format_context(a))
 FROM payment_reconciliation.jobs j JOIN public.rental_payment_attempts a ON a.provider_id=j.payment_id AND a.merchant_id=j.merchant_id
 JOIN public.rental_bookings b ON b.id=a.booking_id
 WHERE j.id=ANY(p_jobs) AND j.environment=p_environment AND b.mode='SQUARE_PRODUCTION' AND b.price_snapshot->>'chargeReady'='false';
END$$;
REVOKE ALL ON FUNCTION payment_reconciliation.load_context_production(text,text,text),payment_reconciliation.load_contexts_production(text,uuid[]) FROM PUBLIC;
