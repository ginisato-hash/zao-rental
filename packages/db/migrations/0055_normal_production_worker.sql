-- Normal two-store bound-payment selection. Existing attended 0052 entrypoints are not used.
-- New narrow EXECUTE surfaces require an explicit reviewed role delta; no table grants.
CREATE FUNCTION payment_reconciliation.dispatch_normal(p_merchant text,p_limit integer,p_since timestamptz) RETURNS integer
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET lock_timeout='2s' AS $$
DECLARE e square_webhook.inbox;s payment_reconciliation.streams;j payment_reconciliation.jobs;n integer:=0;fresh boolean;
BEGIN
 IF p_since IS NULL THEN RAISE EXCEPTION 'NORMAL_WORKER_WINDOW_REQUIRED' USING ERRCODE='22023';END IF;
 IF p_merchant IS NULL OR p_merchant !~ '^[A-Za-z0-9_-]{1,100}$' OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'INVALID_PRODUCTION_DISPATCH' USING ERRCODE='22023';END IF;
 FOR e IN SELECT i.* FROM square_webhook.inbox i WHERE i.environment='PRODUCTION' AND i.merchant_id=p_merchant AND i.job_dispatched_at IS NULL AND i.state='RECEIVED' AND i.conflict_count=0  AND EXISTS(SELECT 1 FROM public.rental_payment_attempts a JOIN public.rental_bookings b ON b.id=a.booking_id WHERE a.provider_id=i.payment_id AND a.merchant_id=i.merchant_id AND b.mode='SQUARE_PRODUCTION' AND b.created_at>=p_since) ORDER BY i.received_at,i.event_id LIMIT p_limit FOR UPDATE SKIP LOCKED LOOP
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
CREATE FUNCTION payment_reconciliation.claim_normal(p_owner text,p_limit integer,p_merchant text,p_since timestamptz) RETURNS SETOF jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET lock_timeout='2s' AS $$
DECLARE j payment_reconciliation.jobs;s payment_reconciliation.streams;t timestamptz;
BEGIN
 IF p_since IS NULL THEN RAISE EXCEPTION 'NORMAL_WORKER_WINDOW_REQUIRED' USING ERRCODE='22023';END IF;
 IF p_merchant IS NULL OR p_merchant !~ '^[A-Za-z0-9_-]{1,100}$' OR p_owner IS NULL OR p_owner !~ '^[-A-Za-z0-9_]{1,100}$' OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION 'INVALID_PRODUCTION_CLAIM' USING ERRCODE='22023';END IF;
 FOR j IN SELECT x.* FROM payment_reconciliation.jobs x WHERE x.environment='PRODUCTION' AND x.merchant_id=p_merchant AND x.state IN ('READY','CLAIMED','RETRY_WAIT') AND x.claim_after<=clock_timestamp()  AND EXISTS(SELECT 1 FROM public.rental_payment_attempts a JOIN public.rental_bookings b ON b.id=a.booking_id WHERE a.provider_id=x.payment_id AND a.merchant_id=x.merchant_id AND b.mode='SQUARE_PRODUCTION' AND b.created_at>=p_since) ORDER BY x.claim_after,x.id LIMIT p_limit FOR UPDATE SKIP LOCKED LOOP
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

REVOKE ALL ON FUNCTION payment_reconciliation.dispatch_normal(text,integer,timestamptz),payment_reconciliation.claim_normal(text,integer,text,timestamptz) FROM PUBLIC;

CREATE FUNCTION payment_projection.normal_candidates(p_merchant text,p_since timestamptz,p_limit integer) RETURNS SETOF jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT jsonb_build_object('bookingId',b.id,'attemptId',a.id,'jobId',j.id,'paymentId',a.provider_id,
  'truthRevision',s.truth_revision,'truthFingerprint',j.decision_fingerprint,'observation',s.latest,'expectedRevision',coalesce(h.revision,0))
 FROM payment_reconciliation.jobs j JOIN payment_reconciliation.streams s
  ON s.environment=j.environment AND s.merchant_id=j.merchant_id AND s.payment_id=j.payment_id
 JOIN public.rental_payment_attempts a ON a.provider_id=j.payment_id AND a.merchant_id=j.merchant_id
 JOIN public.rental_bookings b ON b.id=a.booking_id
 LEFT JOIN payment_projection.heads h ON h.attempt_id=a.id
 WHERE j.environment='PRODUCTION' AND j.merchant_id=p_merchant AND b.mode='SQUARE_PRODUCTION' AND b.created_at>=p_since
  AND j.state='RECONCILED' AND NOT j.security_blocked AND j.generation=s.generation AND j.decision_fingerprint IS NOT NULL
  AND s.latest IS NOT NULL AND NOT EXISTS(SELECT 1 FROM payment_projection.job_receipts r WHERE r.job_id=j.id)
 ORDER BY j.updated_at,j.id LIMIT greatest(0,least(p_limit,20))
$$;
REVOKE ALL ON FUNCTION payment_projection.normal_candidates(text,timestamptz,integer) FROM PUBLIC;

CREATE FUNCTION notification_due_normal(p_since timestamptz,p_limit integer) RETURNS TABLE(id uuid,action text)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT o.id,CASE WHEN o.status IN ('UNKNOWN','SENDING') THEN 'LOOKUP' ELSE 'SEND' END
 FROM booking_notification_outbox o JOIN rental_bookings b ON b.id=o.booking_id
 WHERE b.mode='SQUARE_PRODUCTION' AND b.created_at>=p_since AND
  (o.status IN ('PENDING','RETRYABLE_FAILURE') AND o.next_attempt_at<=inventory_clock()
   OR o.status='UNKNOWN' AND (o.next_attempt_at IS NULL OR o.next_attempt_at<=inventory_clock())
   OR o.status='SENDING' AND o.claim_until<=inventory_clock())
 ORDER BY coalesce(o.next_attempt_at,o.claim_until,o.created_at),o.id LIMIT greatest(0,least(p_limit,20))
$$;
REVOKE ALL ON FUNCTION notification_due_normal(timestamptz,integer) FROM PUBLIC;
