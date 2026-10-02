-- Production-only terminalization for a lost checkout response whose authoritative Square truth is
-- FAILED/CANCELED after the original HOLD expired. This is not a general cancellation authority:
-- the caller must already be inside the canonical payment projection transaction with the original
-- booking actor installed in the transaction-local audit context.
CREATE FUNCTION payment_projection.terminalize_expired_unbound_failed_production(
 p_booking uuid,p_attempt uuid,p_job uuid,p_merchant text,p_payment text,p_truth_revision bigint,p_truth_fingerprint text
) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=pg_catalog,public,payment_projection,payment_reconciliation,pg_temp
 SET lock_timeout='2s' AS $$
DECLARE s payment_reconciliation.streams;j payment_reconciliation.jobs;
 b rental_bookings;a rental_payment_attempts;h inventory_holds;q price_quotes;
 o jsonb;preview jsonb;result jsonb;actor text;reason text;t timestamptz;
BEGIN
 IF p_booking IS NULL OR p_attempt IS NULL OR p_job IS NULL OR p_merchant IS NULL OR p_merchant !~ '^[A-Za-z0-9_-]{1,100}$'
  OR p_payment IS NULL OR p_payment !~ '^[A-Za-z0-9_-]{1,100}$' OR p_truth_revision IS NULL OR p_truth_revision<1
  OR p_truth_fingerprint IS NULL OR p_truth_fingerprint !~ '^[a-f0-9]{64}$'
 THEN RAISE EXCEPTION 'INVALID_PRODUCTION_FAILED_TERMINALIZATION' USING ERRCODE='22023';END IF;

 actor:=current_setting('zao.actor',true);reason:=current_setting('zao.reason',true);
 IF actor IS NULL OR reason IS DISTINCT FROM 'PAYMENT_PROJECTION_LOCAL'
 THEN RAISE EXCEPTION 'PRODUCTION_FAILED_TERMINALIZATION_DENIED' USING ERRCODE='42501';END IF;

 SELECT * INTO s FROM payment_reconciliation.streams
  WHERE environment='PRODUCTION' AND merchant_id=p_merchant AND payment_id=p_payment FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'PRODUCTION_FAILED_TERMINALIZATION_SOURCE_MISMATCH' USING ERRCODE='23514';END IF;
 SELECT * INTO j FROM payment_reconciliation.jobs
  WHERE id=p_job AND environment='PRODUCTION' AND merchant_id=p_merchant AND payment_id=p_payment FOR UPDATE;
 IF NOT FOUND OR j.state<>'RECONCILED' OR j.security_blocked OR j.decision NOT IN ('ACCEPT_FAILED','ACCEPT_CANCELED')
  OR s.truth_revision<>p_truth_revision OR j.decision_fingerprint IS DISTINCT FROM p_truth_fingerprint
 THEN RAISE EXCEPTION 'PRODUCTION_FAILED_TERMINALIZATION_SOURCE_MISMATCH' USING ERRCODE='23514';END IF;

 o:=s.latest;
 IF payment_reconciliation.valid_observation(o) IS DISTINCT FROM true
  OR o->>'providerId' IS DISTINCT FROM p_payment
  OR o->>'merchantId' IS DISTINCT FROM p_merchant
  OR (j.decision='ACCEPT_FAILED' AND o->>'status'<>'FAILED')
  OR (j.decision='ACCEPT_CANCELED' AND o->>'status'<>'CANCELED')
  OR o->'completedAt' IS DISTINCT FROM 'null'::jsonb
 THEN RAISE EXCEPTION 'PRODUCTION_FAILED_TERMINALIZATION_SOURCE_MISMATCH' USING ERRCODE='23514';END IF;

 SELECT * INTO b FROM rental_bookings WHERE id=p_booking FOR UPDATE;
 SELECT * INTO a FROM rental_payment_attempts WHERE id=p_attempt AND booking_id=p_booking FOR UPDATE;
 IF b.id IS NULL OR a.id IS NULL THEN RAISE EXCEPTION 'PRODUCTION_FAILED_TERMINALIZATION_TARGET_MISMATCH' USING ERRCODE='23514';END IF;
 SELECT * INTO h FROM inventory_holds WHERE id=b.hold_id FOR UPDATE;
 SELECT * INTO q FROM price_quotes WHERE id=b.quote_id;
 t:=inventory_clock();

 IF b.mode<>'SQUARE_PRODUCTION' OR b.state NOT IN ('PAYMENT_PENDING','PAYMENT_REVIEW') OR b.confirmed_at IS NOT NULL
  OR a.actor IS DISTINCT FROM b.owner_id OR actor IS DISTINCT FROM a.actor
  OR a.provider_id IS NOT NULL OR a.state NOT IN ('SUBMITTING','UNKNOWN','PENDING','REVIEW')
  OR h.id IS NULL OR h.owner_id IS DISTINCT FROM b.owner_id OR h.reservation_id IS DISTINCT FROM b.id
  OR h.state<>'ACTIVE' OR h.confirmed_at IS NOT NULL OR h.allocation_stage<>'PROVISIONAL' OR h.payment_state NOT IN ('PENDING','UNKNOWN')
  OR (h.expires_at>t AND h.due_at>t)
  OR q.id IS NULL OR q.actor IS DISTINCT FROM b.owner_id OR q.hold_id IS DISTINCT FROM h.id OR q.coupon_id IS NOT NULL
  OR q.snapshot_sha256 IS DISTINCT FROM b.price_sha256 OR q.snapshot IS DISTINCT FROM b.price_snapshot
  OR b.price_snapshot->>'chargeReady' IS DISTINCT FROM 'true'
  OR b.price_snapshot->>'currency' IS DISTINCT FROM 'JPY'
  OR (b.price_snapshot->>'totalJpy')::bigint IS DISTINCT FROM a.amount_jpy
  OR o->>'referenceId' IS DISTINCT FROM b.id::text
  OR o->>'idempotencyKey' IS DISTINCT FROM a.idempotency_key::text
  OR o->>'merchantId' IS DISTINCT FROM a.merchant_id
  OR o->>'locationId' IS DISTINCT FROM a.location_id
  OR (o->>'amountJpy')::bigint IS DISTINCT FROM a.amount_jpy
  OR o->>'currency' IS DISTINCT FROM a.currency
  OR EXISTS(SELECT 1 FROM ops_collected_payments WHERE booking_id=b.id)
 THEN RAISE EXCEPTION 'PRODUCTION_FAILED_TERMINALIZATION_TARGET_MISMATCH' USING ERRCODE='23514';END IF;

 UPDATE rental_payment_attempts
  SET state='FAILED',provider_id=p_payment,provider_state=o->>'status',
      provider_updated_at=(o->>'updatedAt')::timestamptz,completed_at=NULL,updated_at=t
  WHERE id=a.id;

 preview:=booking_cancellation_preview(b.id);
 IF preview->>'bookingId' IS DISTINCT FROM b.id::text
  OR coalesce((preview->>'refundAmountJpy')::bigint,-1)<>0
  OR coalesce((preview->>'paymentUncertain')::boolean,true)
 THEN RAISE EXCEPTION 'PRODUCTION_FAILED_TERMINALIZATION_REFUND_MISMATCH' USING ERRCODE='23514';END IF;

 result:=booking_cancel(b.id,p_job,preview);
 IF result->>'refundStatus' IS DISTINCT FROM 'REFUND_NONE'
  OR coalesce((result->>'refundAmountJpy')::bigint,-1)<>0
  OR NOT EXISTS(SELECT 1 FROM booking_cancellations WHERE booking_id=b.id AND maximum_refund_jpy=0 AND payment_uncertain=false)
  OR EXISTS(SELECT 1 FROM booking_cancellation_refunds WHERE booking_id=b.id)
 THEN RAISE EXCEPTION 'PRODUCTION_FAILED_TERMINALIZATION_REFUND_MISMATCH' USING ERRCODE='23514';END IF;

 RETURN result;
END$$;
REVOKE ALL ON FUNCTION payment_projection.terminalize_expired_unbound_failed_production(uuid,uuid,uuid,text,text,bigint,text) FROM PUBLIC;
