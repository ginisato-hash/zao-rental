-- PROD-R6 (integration-corrected): additive Production payment admission. No existing
-- function/constraint value is removed; SIMULATED_DEV/SQUARE_SANDBOX and every SANDBOX-only
-- guard in 0023/0026/0028/0029 remain byte-identical and fully usable. Every existing row
-- (chargeReady='false', state in the original 5 values, notification CAPTURED_TEST_ONLY) keeps
-- satisfying the widened constraints below unchanged.
ALTER TABLE rental_bookings DROP CONSTRAINT rental_bookings_mode_check;
ALTER TABLE rental_bookings ADD CONSTRAINT rental_bookings_mode_check CHECK(mode IN ('SIMULATED_DEV','SQUARE_SANDBOX','SQUARE_PRODUCTION'));

-- A real commercial booking is confirmed as 'CONFIRMED' (never 'CONFIRMED_DEV'); every existing
-- DEV/Sandbox terminal state is untouched. The confirmed_at pairing check widens identically.
ALTER TABLE rental_bookings DROP CONSTRAINT rental_bookings_state_check;
ALTER TABLE rental_bookings ADD CONSTRAINT rental_bookings_state_check CHECK(state IN ('DRAFT','PAYMENT_PENDING','PAYMENT_REVIEW','CONFIRMED_DEV','COMPLETED_DEV','CONFIRMED'));
ALTER TABLE rental_bookings DROP CONSTRAINT rental_bookings_check;
ALTER TABLE rental_bookings ADD CHECK((state IN ('CONFIRMED_DEV','COMPLETED_DEV','CONFIRMED'))=(confirmed_at IS NOT NULL));

-- chargeReady='false' is a structural marker meaning "not yet reviewed for real charging" that
-- the entire pricing/quote pipeline (packages/core/src/pricing, packages/contracts/src/pricing.ts,
-- amendment.ts) hardcodes as a literal today — this migration only widens what the DATABASE will
-- accept for a SQUARE_PRODUCTION row; it does not and cannot make the pricing pipeline emit
-- chargeReady=true, which stays a separate, deliberate pricing-authorization decision. Every
-- existing SIMULATED_DEV/SQUARE_SANDBOX row keeps requiring exactly 'false', byte-identical.
ALTER TABLE rental_bookings DROP CONSTRAINT rental_bookings_price_snapshot_check;
ALTER TABLE rental_bookings ADD CONSTRAINT rental_bookings_price_snapshot_check CHECK(price_snapshot->>'chargeReady'='false' OR (mode='SQUARE_PRODUCTION' AND price_snapshot->>'chargeReady'='true'));

-- Real commercial notification: a genuine email address and a non-test captured state. The
-- original synthetic-only shape/state remain independently satisfiable, unchanged.
ALTER TABLE rental_notifications DROP CONSTRAINT rental_notifications_destination_check;
ALTER TABLE rental_notifications ADD CONSTRAINT rental_notifications_destination_check CHECK(destination ~ '^synthetic-[a-z0-9-]{1,64}@example\.invalid$' OR destination ~ '^[^@[:space:]]{1,200}@[^@[:space:]]{1,200}\.[^@[:space:]]{2,24}$');
ALTER TABLE rental_notifications DROP CONSTRAINT rental_notifications_state_check;
ALTER TABLE rental_notifications ADD CONSTRAINT rental_notifications_state_check CHECK(state IN ('CAPTURED_TEST_ONLY','CAPTURED'));

-- Mirrors payment_reconciliation.load_context (0026) exactly, substituting PRODUCTION/SQUARE_PRODUCTION
-- for SANDBOX/SQUARE_SANDBOX. No other predicate, join, or return shape differs.
CREATE FUNCTION payment_reconciliation.load_context_production(p_environment text,p_merchant text,p_payment text) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE a public.rental_payment_attempts;
BEGIN
 IF p_environment IS DISTINCT FROM 'PRODUCTION' THEN RETURN NULL;END IF;
 SELECT x.* INTO a FROM public.rental_payment_attempts x JOIN public.rental_bookings b ON b.id=x.booking_id
  WHERE x.provider_id=p_payment AND x.merchant_id=p_merchant AND b.mode='SQUARE_PRODUCTION' AND b.price_snapshot->>'chargeReady'='true';
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
 WHERE j.id=ANY(p_jobs) AND j.environment=p_environment AND b.mode='SQUARE_PRODUCTION' AND b.price_snapshot->>'chargeReady'='true';
END$$;
REVOKE ALL ON FUNCTION payment_reconciliation.load_context_production(text,text,text),payment_reconciliation.load_contexts_production(text,uuid[]) FROM PUBLIC;

-- R6-B: the generic dispatch()/claim() (0026) already accept 'PRODUCTION' as a caller-supplied
-- environment value across every merchant — technically sufficient, but not a deliberately bound
-- Production admission path. These two additive functions instead hardcode environment='PRODUCTION'
-- as a literal (never a parameter, so SANDBOX cannot be passed) and require an explicit, validated
-- merchant, so a Production worker can never sweep another merchant's rows by omission. Same
-- jobs/streams tables, same lease/idempotency semantics, same finalize(); existing dispatch()/
-- claim()/dispatch_target()/claim_target() (0026/0029) are untouched.
CREATE FUNCTION payment_reconciliation.dispatch_production(p_merchant text,p_limit integer) RETURNS integer
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET lock_timeout='2s' AS $$
DECLARE e square_webhook.inbox;s payment_reconciliation.streams;j payment_reconciliation.jobs;n integer:=0;fresh boolean;
BEGIN
 IF p_merchant IS NULL OR p_merchant !~ '^[A-Za-z0-9_-]{1,100}$' OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'INVALID_PRODUCTION_DISPATCH' USING ERRCODE='22023';END IF;
 FOR e IN SELECT i.* FROM square_webhook.inbox i WHERE i.environment='PRODUCTION' AND i.merchant_id=p_merchant AND i.job_dispatched_at IS NULL AND i.state='RECEIVED' AND i.conflict_count=0 ORDER BY i.received_at,i.event_id LIMIT p_limit FOR UPDATE SKIP LOCKED LOOP
  INSERT INTO payment_reconciliation.streams(environment,merchant_id,payment_id) VALUES(e.environment,e.merchant_id,e.payment_id) ON CONFLICT DO NOTHING;
  SELECT * INTO STRICT s FROM payment_reconciliation.streams WHERE environment=e.environment AND merchant_id=e.merchant_id AND payment_id=e.payment_id FOR UPDATE;
  SELECT * INTO j FROM payment_reconciliation.jobs WHERE environment=e.environment AND merchant_id=e.merchant_id AND payment_id=e.payment_id AND generation=s.generation FOR UPDATE;
  fresh:=NOT FOUND OR (j.state='RECONCILED' AND NOT j.security_blocked);
  IF fresh THEN
   INSERT INTO payment_reconciliation.jobs(environment,merchant_id,payment_id,generation,source_event_id,source_fingerprint)
    VALUES(e.environment,e.merchant_id,e.payment_id,s.generation+1,e.event_id,e.body_sha256) RETURNING * INTO j;
   IF EXISTS(SELECT 1 FROM payment_reconciliation.provider_stops p WHERE p.environment=e.environment AND p.merchant_id=e.merchant_id) THEN
    UPDATE payment_reconciliation.jobs SET state='BLOCKED',terminal_at=clock_timestamp(),last_error=(SELECT p.code FROM payment_reconciliation.provider_stops p WHERE p.environment=e.environment AND p.merchant_id=e.merchant_id) WHERE id=j.id RETURNING * INTO j;
   END IF;
   UPDATE payment_reconciliation.streams SET generation=j.generation WHERE environment=e.environment AND merchant_id=e.merchant_id AND payment_id=e.payment_id;
  ELSE
   UPDATE payment_reconciliation.jobs SET signal_revision=signal_revision+1,updated_at=clock_timestamp() WHERE id=j.id RETURNING * INTO j;
  END IF;
  INSERT INTO payment_reconciliation.events(environment,event_id,job_id,event_type,body_sha256) VALUES(e.environment,e.event_id,j.id,e.event_type,e.body_sha256);
  UPDATE square_webhook.inbox SET job_dispatched_at=clock_timestamp() WHERE environment=e.environment AND event_id=e.event_id;
  INSERT INTO payment_reconciliation.audit(job_id,action,attempt,state) VALUES(j.id,CASE WHEN fresh THEN 'CREATED' ELSE 'COALESCED' END,j.attempt,j.state);n:=n+1;
 END LOOP;RETURN n;
END$$;
CREATE FUNCTION payment_reconciliation.claim_production(p_owner text,p_limit integer,p_merchant text) RETURNS SETOF jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET lock_timeout='2s' AS $$
DECLARE j payment_reconciliation.jobs;s payment_reconciliation.streams;t timestamptz;
BEGIN
 IF p_merchant IS NULL OR p_merchant !~ '^[A-Za-z0-9_-]{1,100}$' OR p_owner IS NULL OR p_owner !~ '^[-A-Za-z0-9_]{1,100}$' OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION 'INVALID_PRODUCTION_CLAIM' USING ERRCODE='22023';END IF;
 FOR j IN SELECT x.* FROM payment_reconciliation.jobs x WHERE x.environment='PRODUCTION' AND x.merchant_id=p_merchant AND x.state IN ('READY','CLAIMED','RETRY_WAIT') AND x.claim_after<=clock_timestamp() ORDER BY x.claim_after,x.id LIMIT p_limit FOR UPDATE SKIP LOCKED LOOP
  t:=clock_timestamp();
  IF EXISTS(SELECT 1 FROM payment_reconciliation.provider_stops p WHERE p.environment=j.environment AND p.merchant_id=j.merchant_id) THEN
   UPDATE payment_reconciliation.jobs SET state='BLOCKED',last_error=(SELECT p.code FROM payment_reconciliation.provider_stops p WHERE p.environment=j.environment AND p.merchant_id=j.merchant_id),lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,terminal_at=t,updated_at=t WHERE id=j.id;CONTINUE;
  END IF;
  IF j.attempt>=5 OR j.deadline_at<=t THEN
   UPDATE payment_reconciliation.jobs SET state='DEAD',last_error=CASE WHEN deadline_at<=t THEN 'DEADLINE_EXCEEDED' ELSE 'ATTEMPTS_EXHAUSTED' END,lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,terminal_at=t,updated_at=t WHERE id=j.id;
   INSERT INTO payment_reconciliation.audit(job_id,action,attempt,state) VALUES(j.id,'EXHAUSTED',j.attempt,'DEAD');CONTINUE;
  END IF;
  SELECT * INTO STRICT s FROM payment_reconciliation.streams WHERE environment=j.environment AND merchant_id=j.merchant_id AND payment_id=j.payment_id;
  UPDATE payment_reconciliation.jobs SET state='CLAIMED',attempt=attempt+1,claimed_revision=signal_revision,truth_revision=s.truth_revision,lease_owner=p_owner,lease_token=gen_random_uuid(),lease_expires_at=t+interval '60 seconds',claim_after=t+interval '60 seconds',updated_at=t WHERE id=j.id RETURNING * INTO j;
  INSERT INTO payment_reconciliation.audit(job_id,action,attempt,state) VALUES(j.id,'CLAIMED',j.attempt,j.state);
  RETURN NEXT jsonb_build_object('id',j.id,'environment',j.environment,'merchantId',j.merchant_id,'paymentId',j.payment_id,'generation',j.generation,'sourceEventId',j.source_event_id,'sourceFingerprint',j.source_fingerprint,'signalRevision',j.claimed_revision,'truthRevision',j.truth_revision,'attempt',j.attempt,'leaseOwner',j.lease_owner,'leaseToken',j.lease_token,'leaseExpiresAt',j.lease_expires_at,'deadlineAt',j.deadline_at,'latest',s.latest);
 END LOOP;
END$$;
REVOKE ALL ON FUNCTION payment_reconciliation.dispatch_production(text,integer),payment_reconciliation.claim_production(text,integer,text) FROM PUBLIC;
