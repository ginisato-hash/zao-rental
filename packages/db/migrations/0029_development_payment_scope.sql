-- R14: bounded development overloads of 0026. State machine and lock order unchanged; only
-- admission and selected merchant/payment scope narrow. No existing function is replaced.
CREATE FUNCTION payment_reconciliation.dispatch_target(p_environment text,p_limit integer,p_merchant text,p_payment text) RETURNS integer
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET lock_timeout='2s' AS $$
DECLARE e square_webhook.inbox;s payment_reconciliation.streams;j payment_reconciliation.jobs;n integer:=0;fresh boolean;
BEGIN
 IF current_database() !~ '^zr_[a-f0-9]{12}$' OR p_environment IS DISTINCT FROM 'SANDBOX' OR p_limit IS DISTINCT FROM 1 OR p_merchant IS NULL OR p_merchant !~ '^[A-Za-z0-9_-]{1,100}$' OR p_payment IS NULL OR p_payment !~ '^[A-Za-z0-9_-]{1,100}$' THEN RAISE EXCEPTION 'DEVELOPMENT_TARGET_REQUIRED' USING ERRCODE='22023';END IF;
 IF p_environment IS NULL OR p_environment NOT IN ('SANDBOX','PRODUCTION') OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'INVALID_DISPATCH' USING ERRCODE='22023';END IF;
 FOR e IN SELECT i.* FROM square_webhook.inbox i WHERE i.environment=p_environment AND i.merchant_id=p_merchant AND i.payment_id=p_payment AND i.job_dispatched_at IS NULL AND i.state='RECEIVED' AND i.conflict_count=0 ORDER BY i.received_at,i.event_id LIMIT p_limit FOR UPDATE SKIP LOCKED LOOP
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
CREATE FUNCTION payment_reconciliation.claim_target(p_environment text,p_owner text,p_limit integer,p_merchant text,p_payment text) RETURNS SETOF jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET lock_timeout='2s' AS $$
DECLARE j payment_reconciliation.jobs;s payment_reconciliation.streams;t timestamptz;
BEGIN
 IF current_database() !~ '^zr_[a-f0-9]{12}$' OR p_environment IS DISTINCT FROM 'SANDBOX' OR p_limit IS DISTINCT FROM 1 OR p_merchant IS NULL OR p_merchant !~ '^[A-Za-z0-9_-]{1,100}$' OR p_payment IS NULL OR p_payment !~ '^[A-Za-z0-9_-]{1,100}$' THEN RAISE EXCEPTION 'DEVELOPMENT_TARGET_REQUIRED' USING ERRCODE='22023';END IF;
 IF p_environment IS NULL OR p_environment NOT IN ('SANDBOX','PRODUCTION') OR p_owner IS NULL OR p_owner !~ '^[-A-Za-z0-9_]{1,100}$' OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION 'INVALID_CLAIM' USING ERRCODE='22023';END IF;
 FOR j IN SELECT x.* FROM payment_reconciliation.jobs x WHERE x.environment=p_environment AND x.merchant_id=p_merchant AND x.payment_id=p_payment AND x.state IN ('READY','CLAIMED','RETRY_WAIT') AND x.claim_after<=clock_timestamp() ORDER BY x.claim_after,x.id LIMIT p_limit FOR UPDATE SKIP LOCKED LOOP
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

REVOKE ALL ON FUNCTION payment_reconciliation.dispatch_target(text,integer,text,text),payment_reconciliation.claim_target(text,text,integer,text,text) FROM PUBLIC;
