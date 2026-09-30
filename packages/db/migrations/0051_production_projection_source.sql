-- Production counterpart of the preserved development-only source reader (0028).
-- The caller binds the persisted job to its already validated merchant/payment target.
CREATE FUNCTION payment_projection.lock_source_production(p_job uuid,p_merchant text,p_payment text) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET lock_timeout='2s' AS $$
DECLARE j payment_reconciliation.jobs;s payment_reconciliation.streams;
BEGIN
 SELECT * INTO j FROM payment_reconciliation.jobs WHERE id=p_job AND environment='PRODUCTION' AND merchant_id=p_merchant AND payment_id=p_payment;
 IF NOT FOUND THEN RETURN NULL;END IF;
 -- Match reconciliation finalize/dispatch: stream first, then job, never the reverse.
 SELECT * INTO STRICT s FROM payment_reconciliation.streams WHERE environment='PRODUCTION' AND merchant_id=p_merchant AND payment_id=p_payment FOR UPDATE;
 SELECT * INTO j FROM payment_reconciliation.jobs WHERE id=p_job AND environment='PRODUCTION' AND merchant_id=p_merchant AND payment_id=p_payment FOR UPDATE;
 IF NOT FOUND THEN RETURN NULL;END IF;
 RETURN jsonb_build_object('jobId',j.id,'environment',j.environment,'merchantId',j.merchant_id,'paymentId',j.payment_id,'state',j.state,'securityBlocked',j.security_blocked,'truthRevision',s.truth_revision,'decision',j.decision,'decisionFingerprint',j.decision_fingerprint,'contextFingerprint',j.context_fingerprint,'observation',s.latest);
END$$;
REVOKE ALL ON FUNCTION payment_projection.lock_source_production(uuid,text,text) FROM PUBLIC;
