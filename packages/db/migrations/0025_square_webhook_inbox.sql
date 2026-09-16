-- LOCAL DRAFT: additive only; R11 does not apply this migration or grant a login.
-- Signals only: no FK or write to booking, payment journal, inventory or custody.
CREATE SCHEMA square_webhook;
REVOKE ALL ON SCHEMA square_webhook FROM PUBLIC;
CREATE TABLE square_webhook.inbox (
 environment text NOT NULL CHECK(environment IN ('SANDBOX','PRODUCTION')),
 event_id text NOT NULL CHECK(event_id ~ '^[A-Za-z0-9_-]{1,128}$'),
 event_type text NOT NULL CHECK(event_type IN ('payment.created','payment.updated')),
 merchant_id text NOT NULL CHECK(merchant_id ~ '^[A-Za-z0-9_-]{1,100}$'),
 payment_id text NOT NULL CHECK(payment_id ~ '^[A-Za-z0-9_-]{1,100}$'),
 body_sha256 text NOT NULL CHECK(body_sha256 ~ '^[a-f0-9]{64}$'),
 received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 state text NOT NULL DEFAULT 'RECEIVED' CHECK(state IN ('RECEIVED','RECONCILING','RECONCILED','FAILED_RETRYABLE','BLOCKED')),
 attempt integer NOT NULL DEFAULT 0 CHECK(attempt BETWEEN 0 AND 5),
 claim_token uuid, lease_until timestamptz, next_attempt_at timestamptz,
 processed_at timestamptz, reconciled_at timestamptz,
 last_error text CHECK(last_error IN ('PROVIDER_UNAVAILABLE','IDENTITY_MISMATCH','UNSUPPORTED_PAYMENT','MANUAL_REVIEW','ATTEMPTS_EXHAUSTED','EVENT_HASH_CONFLICT')),
 conflict_count integer NOT NULL DEFAULT 0 CHECK(conflict_count BETWEEN 0 AND 65535),
 conflict_at timestamptz, last_conflict_sha256 text CHECK(last_conflict_sha256 ~ '^[a-f0-9]{64}$'),
 PRIMARY KEY(environment,event_id),
 CHECK((state='RECONCILING')=(claim_token IS NOT NULL AND lease_until IS NOT NULL)),
 CHECK((claim_token IS NULL)=(lease_until IS NULL)),
 CHECK((state='FAILED_RETRYABLE')=(next_attempt_at IS NOT NULL)),
 CHECK((state='RECONCILED')=(reconciled_at IS NOT NULL)),
 CHECK((conflict_count=0)=(conflict_at IS NULL AND last_conflict_sha256 IS NULL))
);
CREATE INDEX webhook_claim_queue ON square_webhook.inbox(environment,received_at,event_id)
 WHERE state IN ('RECEIVED','FAILED_RETRYABLE','RECONCILING');
REVOKE ALL ON square_webhook.inbox FROM PUBLIC;

-- Returns only after this statement's caller commits. Conflict is stored, NOT raised/rolled back.
CREATE FUNCTION square_webhook.receive(p_environment text,p_event text,p_type text,p_merchant text,p_payment text,p_hash text)
 RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET lock_timeout='2s' AS $$
DECLARE old square_webhook.inbox;
BEGIN
 INSERT INTO square_webhook.inbox(environment,event_id,event_type,merchant_id,payment_id,body_sha256)
 VALUES(p_environment,p_event,p_type,p_merchant,p_payment,p_hash) ON CONFLICT(environment,event_id) DO NOTHING;
 IF FOUND THEN RETURN 'INSERTED';END IF;
 SELECT * INTO STRICT old FROM square_webhook.inbox WHERE environment=p_environment AND event_id=p_event FOR UPDATE;
 IF old.body_sha256=p_hash AND old.event_type=p_type AND old.merchant_id=p_merchant AND old.payment_id=p_payment THEN RETURN 'DUPLICATE';END IF;
 -- Preserve original identity/hash; bounded conflict audit invalidates any live worker lease.
 -- A completed reconciliation stays historical; conflict_count still records the mismatch.
 UPDATE square_webhook.inbox SET conflict_count=least(conflict_count+1,65535),conflict_at=clock_timestamp(),last_conflict_sha256=p_hash,
  state=CASE WHEN state='RECONCILED' THEN state ELSE 'BLOCKED' END,
  claim_token=NULL,lease_until=NULL,next_attempt_at=NULL,last_error='EVENT_HASH_CONFLICT',processed_at=clock_timestamp()
 WHERE environment=p_environment AND event_id=p_event;
 RETURN 'HASH_CONFLICT';
END$$;

CREATE FUNCTION square_webhook.claim(p_environment text,p_lease_seconds integer)
 RETURNS TABLE(event_id text,event_type text,merchant_id text,payment_id text,body_sha256 text,claim_token uuid,attempt integer,lease_until timestamptz)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET lock_timeout='2s' AS $$
DECLARE picked square_webhook.inbox;t timestamptz;
BEGIN
 IF p_environment IS NULL OR p_environment NOT IN ('SANDBOX','PRODUCTION') OR p_lease_seconds IS NULL OR p_lease_seconds NOT BETWEEN 5 AND 300 THEN RAISE EXCEPTION 'INVALID_INBOX_CLAIM' USING ERRCODE='22023';END IF;
 SELECT i.* INTO picked FROM square_webhook.inbox i WHERE i.environment=p_environment AND
  (i.state='RECEIVED' OR i.state='FAILED_RETRYABLE' AND i.next_attempt_at<=clock_timestamp() OR i.state='RECONCILING' AND i.lease_until<=clock_timestamp())
 ORDER BY i.received_at,i.event_id LIMIT 1 FOR UPDATE SKIP LOCKED;
 IF NOT FOUND THEN RETURN;END IF;
 t:=clock_timestamp();
 IF picked.attempt>=5 THEN
  UPDATE square_webhook.inbox i SET state='BLOCKED',last_error='ATTEMPTS_EXHAUSTED',claim_token=NULL,lease_until=NULL,next_attempt_at=NULL,processed_at=t
   WHERE i.environment=p_environment AND i.event_id=picked.event_id;RETURN;
 END IF;
 RETURN QUERY UPDATE square_webhook.inbox i SET state='RECONCILING',attempt=i.attempt+1,claim_token=gen_random_uuid(),
  lease_until=t+make_interval(secs=>p_lease_seconds),next_attempt_at=NULL
  WHERE i.environment=p_environment AND i.event_id=picked.event_id
  RETURNING i.event_id,i.event_type,i.merchant_id,i.payment_id,i.body_sha256,i.claim_token,i.attempt,i.lease_until;
END$$;

CREATE FUNCTION square_webhook.settle(p_environment text,p_event text,p_token uuid,p_state text,p_error text,p_retry_seconds integer)
 RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET lock_timeout='2s' AS $$
DECLARE old square_webhook.inbox;t timestamptz;
BEGIN
 IF (
  (p_state='RECONCILED' AND p_error IS NULL AND p_retry_seconds IS NULL) OR
  (p_state='FAILED_RETRYABLE' AND p_error='PROVIDER_UNAVAILABLE' AND p_retry_seconds BETWEEN 1 AND 3600) OR
  (p_state='BLOCKED' AND p_error IN ('IDENTITY_MISMATCH','UNSUPPORTED_PAYMENT','MANUAL_REVIEW') AND p_retry_seconds IS NULL)
 ) IS NOT TRUE THEN RAISE EXCEPTION 'INVALID_INBOX_RESULT' USING ERRCODE='22023';END IF;
 SELECT * INTO old FROM square_webhook.inbox WHERE environment=p_environment AND event_id=p_event FOR UPDATE;
 IF NOT FOUND THEN RETURN false;END IF;t:=clock_timestamp();
 IF old.state<>'RECONCILING' OR p_token IS NULL OR old.claim_token<>p_token OR old.lease_until<=t THEN RETURN false;END IF;
 IF p_state='FAILED_RETRYABLE' AND old.attempt>=5 THEN p_state:='BLOCKED';p_error:='ATTEMPTS_EXHAUSTED';END IF;
 UPDATE square_webhook.inbox SET state=p_state,last_error=p_error,claim_token=NULL,lease_until=NULL,
  next_attempt_at=CASE WHEN p_state='FAILED_RETRYABLE' THEN t+make_interval(secs=>p_retry_seconds) END,
  processed_at=t,reconciled_at=CASE WHEN p_state='RECONCILED' THEN t END
 WHERE environment=p_environment AND event_id=p_event;
 RETURN true;
END$$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA square_webhook FROM PUBLIC;
-- No automatic grants to the existing broad runtime. Future dedicated receiver login:
-- USAGE square_webhook + EXECUTE receive(text,text,text,text,text,text) only.
-- Separate reconciler login: USAGE + EXECUTE claim(text,integer),settle(text,text,uuid,text,text,integer).
-- Neither login receives table writes, DDL, ownership, role membership or business mutation grants.
