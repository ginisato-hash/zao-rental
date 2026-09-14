-- Additive/local only. No external DB apply or role grant in R12.
CREATE SCHEMA payment_reconciliation;
REVOKE ALL ON SCHEMA payment_reconciliation FROM PUBLIC;
-- An allowlisted normalized observation, never a raw provider response.
CREATE FUNCTION payment_reconciliation.valid_observation(v jsonb) RETURNS boolean
 LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$ SELECT coalesce(
 jsonb_typeof(v)='object' AND v ?& ARRAY['providerId','referenceId','idempotencyKey','merchantId','locationId','amountJpy','currency','status','updatedAt','completedAt']
 AND v-ARRAY['providerId','referenceId','idempotencyKey','merchantId','locationId','amountJpy','currency','status','updatedAt','completedAt']='{}'::jsonb
 AND v->>'providerId' ~ '^[A-Za-z0-9_-]{1,100}$' AND v->>'merchantId' ~ '^[A-Za-z0-9_-]{1,100}$'
 AND v->>'referenceId' ~ '^[A-Za-z0-9_-]{1,100}$' AND v->>'idempotencyKey' ~ '^[A-Za-z0-9_-]{1,100}$' AND v->>'locationId' ~ '^[A-Za-z0-9_-]{1,100}$'
 AND jsonb_typeof(v->'amountJpy')='number' AND v->>'amountJpy' ~ '^[1-9][0-9]{0,15}$'
 AND CASE WHEN jsonb_typeof(v->'amountJpy')='number' THEN (v->>'amountJpy')::numeric<=9007199254740991 ELSE false END
 AND v->>'currency'='JPY' AND v->>'status' IN ('PENDING','COMPLETED','FAILED','CANCELED')
 AND v->>'updatedAt' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
 AND ((v->>'status'='COMPLETED' AND v->>'completedAt' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$') OR (v->>'status'<>'COMPLETED' AND v->'completedAt'='null'::jsonb)),false) $$;
-- Sticky merchant/environment circuit: no automatic clear or cross-account fallback.
CREATE TABLE payment_reconciliation.provider_stops (
 environment text NOT NULL CHECK(environment IN ('SANDBOX','PRODUCTION')),merchant_id text NOT NULL,
 code text NOT NULL CHECK(code IN ('AUTH_BLOCKED','RATE_LIMITED')),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(environment,merchant_id)
);
CREATE TABLE payment_reconciliation.streams (
 environment text NOT NULL CHECK(environment IN ('SANDBOX','PRODUCTION')),merchant_id text NOT NULL,payment_id text NOT NULL,
 generation integer NOT NULL DEFAULT 0 CHECK(generation>=0),truth_revision bigint NOT NULL DEFAULT 0 CHECK(truth_revision>=0),
 latest jsonb CHECK(latest IS NULL OR payment_reconciliation.valid_observation(latest)),
 PRIMARY KEY(environment,merchant_id,payment_id)
);
CREATE TABLE payment_reconciliation.jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),environment text NOT NULL,merchant_id text NOT NULL,payment_id text NOT NULL,generation integer NOT NULL CHECK(generation>0),
 source_event_id text NOT NULL,source_fingerprint text NOT NULL CHECK(source_fingerprint ~ '^[a-f0-9]{64}$'),
 signal_revision bigint NOT NULL DEFAULT 1 CHECK(signal_revision>0),claimed_revision bigint,truth_revision bigint,
 state text NOT NULL DEFAULT 'READY' CHECK(state IN ('READY','CLAIMED','RETRY_WAIT','RECONCILED','BLOCKED','DEAD')),
 attempt integer NOT NULL DEFAULT 0 CHECK(attempt BETWEEN 0 AND 5),claim_after timestamptz NOT NULL DEFAULT clock_timestamp(),
 lease_owner text,lease_token uuid,lease_expires_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 deadline_at timestamptz NOT NULL DEFAULT (clock_timestamp()+interval '24 hours'),terminal_at timestamptz,
 last_error text CHECK(last_error IN ('AUTH_BLOCKED','RATE_LIMITED','NETWORK_RETRYABLE','PROVIDER_5XX_RETRYABLE','NOT_FOUND_BLOCKED','INVALID_RESPONSE_BLOCKED','EVIDENCE_MISMATCH_BLOCKED','PAYMENT_CONTEXT_MISSING','ATTEMPTS_EXHAUSTED','DEADLINE_EXCEEDED','PENDING_OBSERVATION')),
 provider_status text CHECK(provider_status IN ('PENDING','COMPLETED','FAILED','CANCELED')),provider_updated_at timestamptz,
 decision text CHECK(decision IN ('ACCEPT_PENDING','ACCEPT_COMPLETED','ACCEPT_FAILED','ACCEPT_CANCELED','NOOP_DUPLICATE','NOOP_STALE','NOOP_TERMINAL','BLOCKED_EVIDENCE_MISMATCH','BLOCKED_INVALID_TRANSITION')),
 decision_fingerprint text CHECK(decision_fingerprint ~ '^[a-f0-9]{64}$'),context_fingerprint text CHECK(context_fingerprint ~ '^[a-f0-9]{64}$'),
 security_blocked boolean NOT NULL DEFAULT false,
 FOREIGN KEY(environment,merchant_id,payment_id) REFERENCES payment_reconciliation.streams,
 FOREIGN KEY(environment,source_event_id) REFERENCES square_webhook.inbox(environment,event_id),
 UNIQUE(environment,merchant_id,payment_id,generation),
 CHECK((state='CLAIMED')=(lease_owner IS NOT NULL AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)),
 CHECK((lease_token IS NULL)=(lease_expires_at IS NULL) AND (lease_token IS NULL)=(lease_owner IS NULL)),
 CHECK(state<>'CLAIMED' OR claim_after=lease_expires_at),
 CHECK((state IN ('RECONCILED','BLOCKED','DEAD'))=(terminal_at IS NOT NULL))
);
CREATE UNIQUE INDEX one_active_reconciliation ON payment_reconciliation.jobs(environment,merchant_id,payment_id) WHERE state IN ('READY','CLAIMED','RETRY_WAIT');
CREATE INDEX reconciliation_due ON payment_reconciliation.jobs(environment,claim_after,id) WHERE state IN ('READY','CLAIMED','RETRY_WAIT');
CREATE INDEX reconciliation_diagnostics ON payment_reconciliation.jobs(environment,updated_at DESC,id) WHERE state IN ('BLOCKED','DEAD') OR security_blocked;
CREATE TABLE payment_reconciliation.events (
 environment text NOT NULL,event_id text NOT NULL,job_id uuid NOT NULL REFERENCES payment_reconciliation.jobs,
 event_type text NOT NULL CHECK(event_type IN ('payment.created','payment.updated')),body_sha256 text NOT NULL CHECK(body_sha256 ~ '^[a-f0-9]{64}$'),linked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(environment,event_id),FOREIGN KEY(environment,event_id) REFERENCES square_webhook.inbox(environment,event_id)
);
CREATE INDEX reconciliation_event_job ON payment_reconciliation.events(job_id);
CREATE TABLE payment_reconciliation.audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,job_id uuid NOT NULL REFERENCES payment_reconciliation.jobs,
 action text NOT NULL CHECK(action IN ('CREATED','COALESCED','CLAIMED','FINALIZED','EXHAUSTED','SECURITY_BLOCKED')),
 attempt integer NOT NULL CHECK(attempt BETWEEN 0 AND 5),state text NOT NULL,decision text,code text,occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE square_webhook.inbox ADD COLUMN job_dispatched_at timestamptz;
CREATE INDEX webhook_undispatched ON square_webhook.inbox(environment,received_at,event_id) WHERE job_dispatched_at IS NULL AND state='RECEIVED' AND conflict_count=0;
REVOKE ALL ON ALL TABLES IN SCHEMA payment_reconciliation FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA payment_reconciliation FROM PUBLIC;

-- Separate bounded dispatcher; ACK already has the durable inbox signal. Link+job+marker are atomic.
CREATE FUNCTION payment_reconciliation.dispatch(p_environment text,p_limit integer) RETURNS integer
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET lock_timeout='2s' AS $$
DECLARE e square_webhook.inbox;s payment_reconciliation.streams;j payment_reconciliation.jobs;n integer:=0;fresh boolean;
BEGIN
 IF p_environment IS NULL OR p_environment NOT IN ('SANDBOX','PRODUCTION') OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'INVALID_DISPATCH' USING ERRCODE='22023';END IF;
 FOR e IN SELECT i.* FROM square_webhook.inbox i WHERE i.environment=p_environment AND i.job_dispatched_at IS NULL AND i.state='RECEIVED' AND i.conflict_count=0 ORDER BY i.received_at,i.event_id LIMIT p_limit FOR UPDATE SKIP LOCKED LOOP
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
   -- Signals do not reset attempts/deadline/backoff, reopen BLOCKED/DEAD, or invalidate a live lease.
   UPDATE payment_reconciliation.jobs SET signal_revision=signal_revision+1,updated_at=clock_timestamp() WHERE id=j.id RETURNING * INTO j;
  END IF;
  INSERT INTO payment_reconciliation.events(environment,event_id,job_id,event_type,body_sha256) VALUES(e.environment,e.event_id,j.id,e.event_type,e.body_sha256);
  UPDATE square_webhook.inbox SET job_dispatched_at=clock_timestamp() WHERE environment=e.environment AND event_id=e.event_id;
  INSERT INTO payment_reconciliation.audit(job_id,action,attempt,state) VALUES(j.id,CASE WHEN fresh THEN 'CREATED' ELSE 'COALESCED' END,j.attempt,j.state);n:=n+1;
 END LOOP;RETURN n;
END$$;
CREATE FUNCTION payment_reconciliation.claim(p_environment text,p_owner text,p_limit integer) RETURNS SETOF jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET lock_timeout='2s' AS $$
DECLARE j payment_reconciliation.jobs;s payment_reconciliation.streams;t timestamptz;
BEGIN
 IF p_environment IS NULL OR p_environment NOT IN ('SANDBOX','PRODUCTION') OR p_owner IS NULL OR p_owner !~ '^[-A-Za-z0-9_]{1,100}$' OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION 'INVALID_CLAIM' USING ERRCODE='22023';END IF;
 FOR j IN SELECT x.* FROM payment_reconciliation.jobs x WHERE x.environment=p_environment AND x.state IN ('READY','CLAIMED','RETRY_WAIT') AND x.claim_after<=clock_timestamp() ORDER BY x.claim_after,x.id LIMIT p_limit FOR UPDATE SKIP LOCKED LOOP
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
CREATE FUNCTION payment_reconciliation.finalize(p_id uuid,p_token uuid,p_revision bigint,p_state text,p_code text,p_retry integer,p_truth jsonb) RETURNS boolean
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET lock_timeout='2s' AS $$
DECLARE j payment_reconciliation.jobs;s payment_reconciliation.streams;t timestamptz;o jsonb;d text;
BEGIN
 IF (p_state IN ('RECONCILED','RETRY_WAIT','BLOCKED','DEAD') AND ((p_state='RETRY_WAIT' AND p_code IN ('NETWORK_RETRYABLE','PROVIDER_5XX_RETRYABLE','PENDING_OBSERVATION') AND p_retry BETWEEN 1 AND 300) OR (p_state<>'RETRY_WAIT' AND p_retry IS NULL))) IS NOT TRUE THEN RAISE EXCEPTION 'INVALID_OUTCOME' USING ERRCODE='22023';END IF;
 IF (p_state='RECONCILED' AND p_code IS NULL AND p_truth IS NOT NULL OR p_state='RETRY_WAIT' OR p_state='BLOCKED' AND p_code IN ('AUTH_BLOCKED','RATE_LIMITED','NOT_FOUND_BLOCKED','INVALID_RESPONSE_BLOCKED','EVIDENCE_MISMATCH_BLOCKED','PAYMENT_CONTEXT_MISSING') OR p_state='DEAD' AND p_code IN ('ATTEMPTS_EXHAUSTED','DEADLINE_EXCEEDED')) IS NOT TRUE THEN RAISE EXCEPTION 'INVALID_OUTCOME_CODE' USING ERRCODE='22023';END IF;
 IF p_truth IS NOT NULL THEN
  IF (jsonb_typeof(p_truth)='object' AND p_truth ?& ARRAY['decision','fingerprint','contextFingerprint','observation','businessApply'] AND p_truth-ARRAY['decision','fingerprint','contextFingerprint','observation','businessApply']='{}'::jsonb AND p_truth->>'businessApply'='NOT_ACTIVATED' AND p_truth->>'fingerprint' ~ '^[a-f0-9]{64}$' AND p_truth->>'contextFingerprint' ~ '^[a-f0-9]{64}$' AND (p_truth->'observation'='null'::jsonb OR payment_reconciliation.valid_observation(p_truth->'observation'))) IS NOT TRUE THEN RAISE EXCEPTION 'INVALID_TRUTH' USING ERRCODE='22023';END IF;
  o:=nullif(p_truth->'observation','null'::jsonb);d:=p_truth->>'decision';
  IF d IS NULL OR d NOT IN ('ACCEPT_PENDING','ACCEPT_COMPLETED','ACCEPT_FAILED','ACCEPT_CANCELED','NOOP_DUPLICATE','NOOP_STALE','NOOP_TERMINAL','BLOCKED_EVIDENCE_MISMATCH','BLOCKED_INVALID_TRANSITION') OR p_state='RECONCILED' AND (d LIKE 'BLOCKED_%' OR d='ACCEPT_PENDING' OR o IS NULL) THEN RAISE EXCEPTION 'INVALID_DECISION' USING ERRCODE='22023';END IF;
 END IF;
 SELECT * INTO j FROM payment_reconciliation.jobs WHERE id=p_id;IF NOT FOUND THEN RETURN false;END IF;
 -- Match dispatcher lock order. No provider call or booking lock lives inside this transaction.
 SELECT * INTO STRICT s FROM payment_reconciliation.streams WHERE environment=j.environment AND merchant_id=j.merchant_id AND payment_id=j.payment_id FOR UPDATE;
 SELECT * INTO STRICT j FROM payment_reconciliation.jobs WHERE id=p_id FOR UPDATE;t:=clock_timestamp();
 IF j.state<>'CLAIMED' OR p_token IS NULL OR j.lease_token<>p_token OR j.lease_expires_at<=t OR p_revision IS NULL OR j.truth_revision<>p_revision OR s.truth_revision<>p_revision OR j.security_blocked THEN RETURN false;END IF;
 IF j.deadline_at<=t THEN p_state:='DEAD';p_code:='DEADLINE_EXCEEDED';p_retry:=NULL;o:=NULL;d:=NULL;p_truth:=NULL;END IF;
 IF d LIKE 'ACCEPT_%' THEN
  IF (o IS NOT NULL AND d='ACCEPT_'||(o->>'status') AND o->>'providerId'=j.payment_id AND o->>'merchantId'=j.merchant_id AND (o->>'updatedAt')::timestamptz<=t AND (o->>'completedAt' IS NULL OR (o->>'completedAt')::timestamptz<=(o->>'updatedAt')::timestamptz) AND (s.latest IS NULL OR ((s.latest->>'status')='PENDING' AND (s.latest->>'updatedAt')::timestamptz<=(o->>'updatedAt')::timestamptz))) IS NOT TRUE THEN RAISE EXCEPTION 'UNSAFE_TRUTH_WRITE' USING ERRCODE='22023';END IF;
  UPDATE payment_reconciliation.streams SET latest=o,truth_revision=truth_revision+1 WHERE environment=j.environment AND merchant_id=j.merchant_id AND payment_id=j.payment_id;
 END IF;
 IF p_code IN ('AUTH_BLOCKED','RATE_LIMITED') THEN
  INSERT INTO payment_reconciliation.provider_stops(environment,merchant_id,code) VALUES(j.environment,j.merchant_id,p_code) ON CONFLICT DO NOTHING;
 END IF;
 -- An event arriving during lookup remains work; do not erase it at completion.
 IF p_state='RECONCILED' AND j.signal_revision>j.claimed_revision THEN p_state:='READY';END IF;
 IF p_state IN ('READY','RETRY_WAIT') AND j.attempt>=5 THEN p_state:='DEAD';p_code:='ATTEMPTS_EXHAUSTED';p_retry:=NULL;END IF;
 UPDATE payment_reconciliation.jobs SET state=p_state,last_error=p_code,claim_after=CASE WHEN p_state='RETRY_WAIT' THEN least(t+make_interval(secs=>p_retry),j.deadline_at) ELSE t END,
  lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,updated_at=t,terminal_at=CASE WHEN p_state IN ('RECONCILED','BLOCKED','DEAD') THEN t END,
  decision=d,decision_fingerprint=p_truth->>'fingerprint',context_fingerprint=p_truth->>'contextFingerprint',provider_status=o->>'status',provider_updated_at=(o->>'updatedAt')::timestamptz WHERE id=j.id;
 INSERT INTO payment_reconciliation.audit(job_id,action,attempt,state,decision,code) VALUES(j.id,'FINALIZED',j.attempt,p_state,d,p_code);RETURN true;
END$$;
-- A conflicting redelivery poisons linked work without deleting either evidence or terminal history.
CREATE FUNCTION payment_reconciliation.conflict() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF NEW.conflict_count>OLD.conflict_count THEN
  WITH blocked AS (UPDATE payment_reconciliation.jobs SET security_blocked=true,state=CASE WHEN state IN ('READY','CLAIMED','RETRY_WAIT') THEN 'BLOCKED' ELSE state END,
   last_error='EVIDENCE_MISMATCH_BLOCKED',lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,terminal_at=coalesce(terminal_at,clock_timestamp()),updated_at=clock_timestamp()
   WHERE id IN (SELECT e.job_id FROM payment_reconciliation.events e WHERE e.environment=NEW.environment AND e.event_id=NEW.event_id) RETURNING id,attempt,state)
  INSERT INTO payment_reconciliation.audit(job_id,action,attempt,state,code) SELECT id,'SECURITY_BLOCKED',attempt,state,'EVIDENCE_MISMATCH_BLOCKED' FROM blocked;
 END IF;RETURN NEW;
END$$;
CREATE TRIGGER reconciliation_conflict AFTER UPDATE OF conflict_count ON square_webhook.inbox FOR EACH ROW EXECUTE FUNCTION payment_reconciliation.conflict();
CREATE FUNCTION payment_reconciliation.diagnostics(p_environment text,p_limit integer) RETURNS SETOF jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'INVALID_DIAGNOSTIC_LIMIT' USING ERRCODE='22023';END IF;
 RETURN QUERY SELECT jsonb_build_object('id',j.id,'state',j.state,'generation',j.generation,'paymentId',j.payment_id,'attempt',j.attempt,'code',j.last_error,'decision',j.decision,'updatedAt',j.updated_at) FROM payment_reconciliation.jobs j WHERE j.environment=p_environment AND (j.state IN ('BLOCKED','DEAD') OR j.security_blocked) ORDER BY j.updated_at DESC,j.id LIMIT p_limit;
END$$;
-- Read-only binding through existing unique provider_id, not event-supplied price/status/reference.
-- UNKNOWN without a recorded provider ID remains a separate unresolved gate.
CREATE FUNCTION payment_reconciliation.format_context(a public.rental_payment_attempts) RETURNS jsonb
 LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $$ SELECT jsonb_build_object('expected',jsonb_build_object('attemptId',a.id,'bookingId',a.booking_id,'idempotencyKey',a.idempotency_key,'merchantId',a.merchant_id,'locationId',a.location_id,'amountJpy',a.amount_jpy,'currency',a.currency),
  'current',jsonb_build_object('state',a.state,'providerId',a.provider_id,'providerState',a.provider_state,'providerUpdatedAt',a.provider_updated_at),
  'latest',CASE WHEN a.provider_state IN ('PENDING','COMPLETED','FAILED','CANCELED') AND a.provider_updated_at IS NOT NULL THEN jsonb_build_object('providerId',a.provider_id,'referenceId',a.booking_id,'idempotencyKey',a.idempotency_key,'merchantId',a.merchant_id,'locationId',a.location_id,'amountJpy',a.amount_jpy,'currency',a.currency,'status',a.provider_state,'updatedAt',a.provider_updated_at,'completedAt',a.completed_at) ELSE NULL END) $$;
CREATE FUNCTION payment_reconciliation.load_context(p_environment text,p_merchant text,p_payment text) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE a public.rental_payment_attempts;
BEGIN
 IF p_environment IS DISTINCT FROM 'SANDBOX' THEN RETURN NULL;END IF;
 SELECT x.* INTO a FROM public.rental_payment_attempts x JOIN public.rental_bookings b ON b.id=x.booking_id
  WHERE x.provider_id=p_payment AND x.merchant_id=p_merchant AND b.mode='SQUARE_SANDBOX' AND b.price_snapshot->>'chargeReady'='false';
 IF NOT FOUND THEN RETURN NULL;END IF;
 RETURN payment_reconciliation.format_context(a);
END$$;
CREATE FUNCTION payment_reconciliation.load_contexts(p_environment text,p_jobs uuid[]) RETURNS SETOF jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF coalesce(cardinality(p_jobs),0)>20 THEN RAISE EXCEPTION 'INVALID_CONTEXT_BATCH' USING ERRCODE='22023';END IF;
 IF p_environment IS DISTINCT FROM 'SANDBOX' THEN RETURN;END IF;
 RETURN QUERY SELECT jsonb_build_object('jobId',j.id,'context',payment_reconciliation.format_context(a))
 FROM payment_reconciliation.jobs j JOIN public.rental_payment_attempts a ON a.provider_id=j.payment_id AND a.merchant_id=j.merchant_id
 JOIN public.rental_bookings b ON b.id=a.booking_id
 WHERE j.id=ANY(p_jobs) AND j.environment=p_environment AND b.mode='SQUARE_SANDBOX' AND b.price_snapshot->>'chargeReady'='false';
END$$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA payment_reconciliation FROM PUBLIC;
-- No grants or runtime login creation. Later isolated dispatcher/worker roles get
-- specific function EXECUTE only; no direct table/business writes or global role membership.
