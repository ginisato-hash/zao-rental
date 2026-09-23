-- Pure predicates carry no SQL/data authority and are also used by operational guards.
CREATE FUNCTION booking_is_confirmed(mode text,state text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
 SELECT coalesce((mode='SQUARE_PRODUCTION' AND state='CONFIRMED') OR (mode IN ('SIMULATED_DEV','SQUARE_SANDBOX') AND state='CONFIRMED_DEV'),false)
$$;
CREATE FUNCTION booking_is_completed(mode text,state text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
 SELECT coalesce((mode='SQUARE_PRODUCTION' AND state='COMPLETED') OR (mode IN ('SIMULATED_DEV','SQUARE_SANDBOX') AND state='COMPLETED_DEV'),false)
$$;
CREATE FUNCTION booking_state_valid(mode text,state text) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT coalesce(mode IN ('SIMULATED_DEV','SQUARE_SANDBOX','SQUARE_PRODUCTION') AND (state IN ('DRAFT','PAYMENT_PENDING','PAYMENT_REVIEW','CANCELLED') OR booking_is_confirmed(mode,state) OR booking_is_completed(mode,state)),false)
$$;
-- The accepted policy is a contract snapshot, never recalculated by a later policy revision.
CREATE TABLE booking_cancellation_policies(
 booking_id uuid PRIMARY KEY REFERENCES rental_bookings(id),
 policy_version text NOT NULL CHECK(policy_version='ZAO_CANCELLATION_V1'),
 free_cancellation_until timestamptz NOT NULL
);
CREATE TRIGGER booking_cancellation_policies_immutable BEFORE UPDATE OR DELETE ON booking_cancellation_policies FOR EACH ROW EXECUTE FUNCTION pricing_immutable();
CREATE FUNCTION booking_snapshot_cancellation_policy() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 INSERT INTO booking_cancellation_policies SELECT NEW.id,'ZAO_CANCELLATION_V1',starts_at-interval '48 hours' FROM inventory_holds WHERE id=NEW.hold_id;
 RETURN NEW;
END $$;
CREATE TRIGGER booking_snapshot_cancellation_policy AFTER INSERT ON rental_bookings FOR EACH ROW EXECUTE FUNCTION booking_snapshot_cancellation_policy();
INSERT INTO booking_cancellation_policies SELECT b.id,'ZAO_CANCELLATION_V1',h.starts_at-interval '48 hours' FROM rental_bookings b JOIN inventory_holds h ON h.id=b.hold_id;
ALTER TABLE rental_bookings DROP CONSTRAINT rental_bookings_state_check;
ALTER TABLE rental_bookings ADD CONSTRAINT rental_bookings_state_check CHECK(state IN ('DRAFT','PAYMENT_PENDING','PAYMENT_REVIEW','CONFIRMED_DEV','COMPLETED_DEV','CONFIRMED','COMPLETED','CANCELLED'));
ALTER TABLE rental_bookings DROP CONSTRAINT rental_bookings_check;
ALTER TABLE rental_bookings ADD CONSTRAINT rental_bookings_check CHECK(state='CANCELLED' OR (state IN ('CONFIRMED_DEV','COMPLETED_DEV','CONFIRMED','COMPLETED'))=(confirmed_at IS NOT NULL));
ALTER TABLE rental_bookings DROP CONSTRAINT rental_bookings_mode_state_check;
ALTER TABLE rental_bookings ADD CONSTRAINT rental_bookings_mode_state_check CHECK(booking_state_valid(mode,state));
CREATE FUNCTION booking_cancellation_terminal() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
 IF OLD.state='CANCELLED' AND NEW.state<>'CANCELLED' THEN RAISE EXCEPTION 'CANCELLED_BOOKING_IS_TERMINAL' USING ERRCODE='23514';END IF;RETURN NEW;
END $$;
CREATE TRIGGER booking_cancellation_terminal BEFORE UPDATE ON rental_bookings FOR EACH ROW EXECUTE FUNCTION booking_cancellation_terminal();
CREATE TABLE booking_cancellations(
 booking_id uuid PRIMARY KEY REFERENCES rental_bookings(id),actor text NOT NULL REFERENCES booking_actors(id),request_key uuid NOT NULL,
 policy_version text NOT NULL CHECK(policy_version='ZAO_CANCELLATION_V1'),free_cancellation_until timestamptz NOT NULL,
 cancelled_at timestamptz NOT NULL,maximum_refund_jpy bigint NOT NULL CHECK(maximum_refund_jpy>=0),payment_uncertain boolean NOT NULL
);
CREATE TRIGGER booking_cancellations_immutable BEFORE UPDATE OR DELETE ON booking_cancellations FOR EACH ROW EXECUTE FUNCTION pricing_immutable();
CREATE TABLE booking_cancellation_refunds(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),booking_id uuid NOT NULL REFERENCES booking_cancellations(booking_id),
 payment_id uuid NOT NULL,payment_kind text NOT NULL CHECK(payment_kind IN ('ORIGINAL','ADDITIONAL')),
 idempotency_key uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),payment_provider_id text NOT NULL,merchant_id text NOT NULL,location_id text NOT NULL,
 amount_jpy bigint NOT NULL CHECK(amount_jpy BETWEEN 1 AND 100000000),currency text NOT NULL DEFAULT 'JPY' CHECK(currency='JPY'),
 state text NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','UNKNOWN','COMPLETED','FAILED','REVIEW')),
 dispatched_at timestamptz,provider_id text,provider_state text,provider_updated_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT inventory_clock(),UNIQUE(payment_id,payment_kind),
 CHECK(state<>'COMPLETED' OR provider_id IS NOT NULL),CHECK(dispatched_at IS NOT NULL OR state='PENDING')
);
CREATE FUNCTION cancellation_refund_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE paid record; reserved bigint;
BEGIN
 PERFORM pg_advisory_xact_lock(71820600);
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'IMMUTABLE_CANCELLATION_REFUND';END IF;
 IF TG_OP='UPDATE' THEN
  IF (to_jsonb(NEW)-ARRAY['state','dispatched_at','provider_id','provider_state','provider_updated_at'])<>(to_jsonb(OLD)-ARRAY['state','dispatched_at','provider_id','provider_state','provider_updated_at']) OR OLD.state IN ('COMPLETED','FAILED','REVIEW') OR OLD.dispatched_at IS NOT NULL AND NEW.dispatched_at IS DISTINCT FROM OLD.dispatched_at OR OLD.provider_id IS NOT NULL AND NEW.provider_id IS DISTINCT FROM OLD.provider_id OR OLD.provider_updated_at IS NOT NULL AND (NEW.provider_updated_at IS NULL OR NEW.provider_updated_at<OLD.provider_updated_at) THEN RAISE EXCEPTION 'IMMUTABLE_CANCELLATION_REFUND';END IF;
  IF OLD.dispatched_at IS NULL AND (NEW.state<>'UNKNOWN' OR NEW.dispatched_at IS NULL OR NEW.provider_id IS NOT NULL) THEN RAISE EXCEPTION 'RESERVE_REFUND_BEFORE_DISPATCH';END IF;
 ELSE
  SELECT * INTO paid FROM ops_collected_payments WHERE id=NEW.payment_id AND kind=NEW.payment_kind AND booking_id=NEW.booking_id;
  SELECT coalesce(sum(amount_jpy),0) INTO reserved FROM ops_refund_requests WHERE payment_id=NEW.payment_id AND payment_kind=NEW.payment_kind AND state<>'FAILED';
  IF paid.id IS NULL OR NOT EXISTS(SELECT 1 FROM booking_cancellations WHERE booking_id=NEW.booking_id AND cancelled_at<=free_cancellation_until) OR paid.provider_id IS DISTINCT FROM NEW.payment_provider_id OR paid.merchant_id IS DISTINCT FROM NEW.merchant_id OR paid.location_id IS DISTINCT FROM NEW.location_id OR reserved+NEW.amount_jpy>paid.amount_jpy OR NEW.state<>'PENDING' OR NEW.dispatched_at IS NOT NULL THEN RAISE EXCEPTION 'INVALID_CANCELLATION_REFUND';END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER cancellation_refund_guard BEFORE INSERT OR UPDATE OR DELETE ON booking_cancellation_refunds FOR EACH ROW EXECUTE FUNCTION cancellation_refund_guard();
-- Staff exceptions retain their permission/scope/reason guards and share the same hard cap.
CREATE FUNCTION cancellation_staff_refund_cap() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE reserved bigint;
BEGIN
 PERFORM pg_advisory_xact_lock(71820600);
 SELECT coalesce(sum(amount_jpy),0) INTO reserved FROM booking_cancellation_refunds WHERE payment_id=NEW.payment_id AND payment_kind=NEW.payment_kind AND state<>'FAILED';
 IF reserved+NEW.previous_reserved_jpy+NEW.amount_jpy>NEW.collected_jpy THEN RAISE EXCEPTION 'REFUND_CAP_EXCEEDED' USING ERRCODE='23514';END IF;RETURN NEW;
END $$;
CREATE TRIGGER cancellation_staff_refund_cap BEFORE INSERT ON ops_refund_requests FOR EACH ROW EXECUTE FUNCTION cancellation_staff_refund_cap();
ALTER TABLE booking_notification_outbox DROP CONSTRAINT booking_notification_outbox_event_type_check;
ALTER TABLE booking_notification_outbox ADD CHECK(event_type IN ('BOOKING_CONFIRMED','BOOKING_RECOVERY','BOOKING_CANCELLED','BOOKING_AMENDED','PAYMENT_ACTION_REQUIRED','REFUND_STATUS'));
CREATE FUNCTION booking_cancellation_status(p_booking uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_object('policyVersion',p.policy_version,'freeCancellationUntil',p.free_cancellation_until,
 'cancelledAt',c.cancelled_at,'maximumRefundJpy',c.maximum_refund_jpy,
 'refundStatus',CASE WHEN c.booking_id IS NULL THEN NULL
  WHEN EXISTS(SELECT 1 FROM booking_cancellation_refunds WHERE booking_id=p_booking AND state IN ('UNKNOWN','REVIEW')) THEN 'REFUND_UNKNOWN'
  WHEN EXISTS(SELECT 1 FROM booking_cancellation_refunds WHERE booking_id=p_booking AND state='PENDING') THEN 'REFUND_PENDING'
  WHEN EXISTS(SELECT 1 FROM booking_cancellation_refunds WHERE booking_id=p_booking AND state='FAILED') THEN 'REFUND_FAILED'
  WHEN c.maximum_refund_jpy>0 AND (EXISTS(SELECT 1 FROM rental_payment_attempts WHERE booking_id=p_booking AND state IN ('SUBMITTING','UNKNOWN','PENDING','REVIEW')) OR EXISTS(SELECT 1 FROM ops_charge_requests WHERE booking_id=p_booking AND dispatched_at IS NOT NULL AND state IN ('PENDING','UNKNOWN','REVIEW'))) THEN 'PAYMENT_UNKNOWN'
  WHEN EXISTS(SELECT 1 FROM booking_cancellation_refunds WHERE booking_id=p_booking AND state='COMPLETED') THEN 'REFUND_COMPLETED' ELSE 'REFUND_NONE' END,
 'refundAmountJpy',coalesce((SELECT sum(amount_jpy) FROM booking_cancellation_refunds WHERE booking_id=p_booking AND state='COMPLETED'),0))
 FROM booking_cancellation_policies p LEFT JOIN booking_cancellations c ON c.booking_id=p.booking_id WHERE p.booking_id=p_booking
$$;
CREATE FUNCTION booking_cancellation_preview(p_booking uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE b rental_bookings;p booking_cancellation_policies;amount bigint;uncertain boolean;
BEGIN
 SELECT * INTO STRICT b FROM rental_bookings WHERE id=p_booking;
 IF b.owner_id IS DISTINCT FROM current_setting('zao.actor',true) THEN RAISE EXCEPTION 'CANCELLATION_OWNER_REQUIRED' USING ERRCODE='42501';END IF;
 SELECT * INTO STRICT p FROM booking_cancellation_policies WHERE booking_id=b.id;
 IF NOT booking_state_valid(b.mode,b.state) OR booking_is_completed(b.mode,b.state) OR EXISTS(SELECT 1 FROM rental_loan_items WHERE booking_id=b.id AND state='OUT') OR EXISTS(SELECT 1 FROM wear_loans WHERE booking_id=b.id AND returned<quantity) THEN RAISE EXCEPTION 'CANCELLATION_REQUIRES_STAFF' USING ERRCODE='23514';END IF;
 SELECT coalesce(sum(greatest(0,a.amount_jpy-coalesce((SELECT sum(r.amount_jpy) FROM ops_refund_requests r WHERE r.payment_id=a.id AND r.payment_kind=a.kind AND r.state<>'FAILED'),0))),0),coalesce(bool_or(a.state<>'COMPLETED'),false) INTO amount,uncertain FROM (
  SELECT id,amount_jpy,state,'ORIGINAL' AS kind FROM rental_payment_attempts WHERE booking_id=b.id AND state<>'FAILED'
  UNION ALL SELECT id,amount_jpy,state,'ADDITIONAL' FROM ops_charge_requests WHERE booking_id=b.id AND state<>'FAILED' AND dispatched_at IS NOT NULL
 ) a;
 RETURN jsonb_build_object('bookingId',b.id,'version',b.version,'policyVersion',p.policy_version,'freeCancellationUntil',p.free_cancellation_until,'refundAmountJpy',CASE WHEN inventory_clock()<=p.free_cancellation_until THEN amount ELSE 0 END,'paymentUncertain',uncertain);
END $$;
CREATE FUNCTION booking_cancellation_payment_observed(p_booking uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE v booking_cancellations;p record;reserved bigint;
BEGIN
 PERFORM pg_advisory_xact_lock(71820600);
 SELECT * INTO v FROM booking_cancellations WHERE booking_id=p_booking;
 IF NOT FOUND OR v.cancelled_at>v.free_cancellation_until THEN RETURN;END IF;
 FOR p IN SELECT * FROM ops_collected_payments WHERE booking_id=p_booking LOOP
  IF EXISTS(SELECT 1 FROM booking_cancellation_refunds WHERE payment_id=p.id AND payment_kind=p.kind) THEN CONTINUE;END IF;
  SELECT coalesce(sum(amount_jpy),0) INTO reserved FROM ops_refund_requests WHERE payment_id=p.id AND payment_kind=p.kind AND state<>'FAILED';
  IF p.amount_jpy>reserved THEN INSERT INTO booking_cancellation_refunds(booking_id,payment_id,payment_kind,payment_provider_id,merchant_id,location_id,amount_jpy) VALUES(p_booking,p.id,p.kind,p.provider_id,p.merchant_id,p.location_id,p.amount_jpy-reserved);END IF;
 END LOOP;
END $$;
CREATE FUNCTION booking_cancel(p_booking uuid,p_key uuid,p_preview jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE b rental_bookings;v jsonb;t timestamptz;
BEGIN
 PERFORM pg_advisory_xact_lock(71820600);
 SELECT * INTO STRICT b FROM rental_bookings WHERE id=p_booking FOR UPDATE;
 IF b.owner_id IS DISTINCT FROM current_setting('zao.actor',true) THEN RAISE EXCEPTION 'CANCELLATION_OWNER_REQUIRED' USING ERRCODE='42501';END IF;
 IF b.state='CANCELLED' THEN RETURN booking_cancellation_status(p_booking);END IF;
 PERFORM 1 FROM inventory_holds WHERE id=b.hold_id FOR UPDATE;
 v:=booking_cancellation_preview(p_booking);t:=inventory_clock();
 IF v IS DISTINCT FROM p_preview OR t>(v->>'freeCancellationUntil')::timestamptz AND (v->>'refundAmountJpy')::bigint>0 THEN RAISE EXCEPTION 'CANCELLATION_PREVIEW_CHANGED' USING ERRCODE='23514';END IF;
 INSERT INTO booking_cancellations(booking_id,actor,request_key,policy_version,free_cancellation_until,cancelled_at,maximum_refund_jpy,payment_uncertain)
 VALUES(b.id,b.owner_id,p_key,v->>'policyVersion',(v->>'freeCancellationUntil')::timestamptz,t,(v->>'refundAmountJpy')::bigint,(v->>'paymentUncertain')::boolean);
 UPDATE rental_bookings SET state='CANCELLED',version=version+1 WHERE id=b.id;
 UPDATE inventory_claims SET active=false WHERE hold_id=b.hold_id AND active;
 UPDATE wear_claims SET active=false WHERE hold_id=b.hold_id AND active;
 UPDATE provisional_capacity_claims SET state='RELEASED',released_at=t WHERE hold_id=b.hold_id AND state='ACTIVE';
 UPDATE inventory_holds SET state='RELEASED',version=version+1 WHERE id=b.hold_id AND state='ACTIVE';
 PERFORM booking_cancellation_payment_observed(b.id);
 INSERT INTO booking_notification_outbox(event_type,booking_id,recipient_reference,dedupe_key,locale,template_version,next_attempt_at)
 VALUES('BOOKING_CANCELLED',b.id,b.id,'booking-cancelled:'||b.id||':1',b.notification_locale,'BOOKING_NOTIFICATION_V1',t) ON CONFLICT(dedupe_key) DO NOTHING;
 RETURN booking_cancellation_status(b.id);
END $$;
REVOKE ALL ON booking_cancellation_policies,booking_cancellations,booking_cancellation_refunds FROM PUBLIC;
REVOKE ALL ON FUNCTION booking_snapshot_cancellation_policy(),booking_cancellation_terminal(),cancellation_refund_guard(),cancellation_staff_refund_cap(),booking_cancellation_preview(uuid),booking_cancellation_status(uuid),booking_cancellation_payment_observed(uuid),booking_cancel(uuid,uuid,jsonb) FROM PUBLIC;
CREATE FUNCTION cancellation_refund_row(p_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$SELECT to_jsonb(r)||jsonb_build_object('mode',b.mode) FROM booking_cancellation_refunds r JOIN rental_bookings b ON b.id=r.booking_id WHERE r.id=p_id$$;
CREATE FUNCTION cancellation_refund_claim(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(71820600);
 UPDATE booking_cancellation_refunds SET state='UNKNOWN',dispatched_at=inventory_clock() WHERE id=p_id AND state='PENDING' AND dispatched_at IS NULL;
 IF NOT FOUND THEN RETURN NULL;END IF;RETURN cancellation_refund_row(p_id);
END $$;
CREATE FUNCTION cancellation_refund_observe(p_id uuid,p_observation jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE r booking_cancellation_refunds;o jsonb:=p_observation;valid boolean;next_state text;
BEGIN
 PERFORM pg_advisory_xact_lock(71820600);
 SELECT * INTO STRICT r FROM booking_cancellation_refunds WHERE id=p_id FOR UPDATE;
 IF r.dispatched_at IS NULL THEN RAISE EXCEPTION 'REFUND_NOT_DISPATCHED';END IF;
 IF r.state IN ('COMPLETED','FAILED','REVIEW') THEN RETURN;END IF;
 valid:=(o->>'id' ~ '^[A-Za-z0-9_-]{1,100}$' AND o->>'paymentProviderId'=r.payment_provider_id AND o->>'merchantId'=r.merchant_id AND o->>'locationId'=r.location_id AND o->>'currency'='JPY' AND (o->>'amountJpy')::bigint=r.amount_jpy AND o->>'status' IN ('PENDING','COMPLETED','REJECTED','FAILED') AND (o->>'updatedAt')::timestamptz<=inventory_clock() AND (r.provider_id IS NULL OR r.provider_id=o->>'id')) IS TRUE;
 IF NOT valid THEN UPDATE booking_cancellation_refunds SET state='REVIEW' WHERE id=r.id;RETURN;END IF;
 IF r.provider_updated_at>(o->>'updatedAt')::timestamptz THEN RETURN;END IF;
 IF r.provider_updated_at=(o->>'updatedAt')::timestamptz AND r.provider_state<>o->>'status' THEN UPDATE booking_cancellation_refunds SET state='REVIEW' WHERE id=r.id;RETURN;END IF;
 next_state:=CASE o->>'status' WHEN 'COMPLETED' THEN 'COMPLETED' WHEN 'PENDING' THEN 'PENDING' ELSE 'FAILED' END;
 UPDATE booking_cancellation_refunds SET state=next_state,provider_id=o->>'id',provider_state=o->>'status',provider_updated_at=(o->>'updatedAt')::timestamptz WHERE id=r.id;
END $$;
REVOKE ALL ON FUNCTION cancellation_refund_row(uuid),cancellation_refund_claim(uuid),cancellation_refund_observe(uuid,jsonb) FROM PUBLIC;
