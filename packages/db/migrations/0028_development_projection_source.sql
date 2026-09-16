-- Additive R14 development capability. No existing migration or business state changes.
CREATE FUNCTION payment_projection.lock_source(p_job uuid) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET lock_timeout='2s' AS $$
DECLARE j payment_reconciliation.jobs;s payment_reconciliation.streams;
BEGIN
 IF current_database() !~ '^zr_[a-f0-9]{12}$' THEN RAISE EXCEPTION 'DEVELOPMENT_DATABASE_REQUIRED' USING ERRCODE='42501';END IF;
 SELECT * INTO j FROM payment_reconciliation.jobs WHERE id=p_job AND environment='SANDBOX';
 IF NOT FOUND THEN RETURN NULL;END IF;
 SELECT * INTO STRICT s FROM payment_reconciliation.streams WHERE environment=j.environment AND merchant_id=j.merchant_id AND payment_id=j.payment_id FOR UPDATE;
 SELECT * INTO STRICT j FROM payment_reconciliation.jobs WHERE id=p_job FOR UPDATE;
 RETURN jsonb_build_object('jobId',j.id,'environment',j.environment,'merchantId',j.merchant_id,'paymentId',j.payment_id,'state',j.state,'securityBlocked',j.security_blocked,'truthRevision',s.truth_revision,'decision',j.decision,'decisionFingerprint',j.decision_fingerprint,'contextFingerprint',j.context_fingerprint,'observation',s.latest);
END$$;
REVOKE ALL ON FUNCTION payment_projection.lock_source(uuid) FROM PUBLIC;
-- Caller can lock/read accepted source without UPDATE access to R12 jobs or streams.
-- R13 validates every returned field; no browser endpoint or runtime grant is installed here.
