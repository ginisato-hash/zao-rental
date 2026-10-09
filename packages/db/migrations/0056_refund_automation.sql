-- 0056: Owner decision 2026-10-09 (Issue #47 comment 6090166024).
-- (1) Every active STAFF/MANAGER/ADMIN may view bookings and refund within their store scope; inactive accounts, missing sessions
--     and out-of-scope stores are still refused by ops_assert_actor. VIEWER gets nothing. Explicit REFUND_OVERRIDE denials are
--     removed so that "every staff member" holds; future staff inherit through their role.
-- (2) Staff refund requests (ops_refund_requests) can be claimed (durable UNKNOWN before the provider call) and observed by the
--     trusted refund worker, mirroring cancellation_refund_claim/observe (0045). Same advisory lock 71820600, same shared
--     per-payment cap (enforced on INSERT by 0033/0045), no table grants. EXECUTE needs an explicit reviewed role delta.
INSERT INTO staff_role_permissions(role,permission) VALUES
 ('STAFF','BOOKING_VIEW'),('STAFF','REFUND_OVERRIDE'),('MANAGER','BOOKING_VIEW'),('MANAGER','REFUND_OVERRIDE'),('ADMIN','BOOKING_VIEW'),('ADMIN','REFUND_OVERRIDE')
 ON CONFLICT DO NOTHING;
-- Only explicit REFUND_OVERRIDE *denials* of STAFF/MANAGER/ADMIN members are removed (other permissions, VIEWER rows, account
-- state, store access and history are untouched). The removed rows are kept as evidence with the pre-change state.
CREATE TABLE staff_permission_override_removals(
 staff_id text NOT NULL REFERENCES staff_members(id),permission text NOT NULL,allowed boolean NOT NULL,staff_role text NOT NULL,staff_active boolean NOT NULL,
 migration text NOT NULL,removed_at timestamptz NOT NULL DEFAULT inventory_clock(),PRIMARY KEY(staff_id,permission,migration));
REVOKE ALL ON staff_permission_override_removals FROM PUBLIC;
INSERT INTO staff_permission_override_removals(staff_id,permission,allowed,staff_role,staff_active,migration)
 SELECT o.staff_id,o.permission,o.allowed,s.role,s.active,'0056' FROM staff_permission_overrides o JOIN staff_members s ON s.id=o.staff_id
 WHERE o.permission='REFUND_OVERRIDE' AND NOT o.allowed AND s.role IN ('STAFF','MANAGER','ADMIN');
DELETE FROM staff_permission_overrides o USING staff_members s
 WHERE s.id=o.staff_id AND o.permission='REFUND_OVERRIDE' AND NOT o.allowed AND s.role IN ('STAFF','MANAGER','ADMIN');

CREATE OR REPLACE FUNCTION ops_financial_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$DECLARE b rental_bookings;paid record;reserved bigint;BEGIN
 PERFORM pg_advisory_xact_lock(71820600);
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Immutable financial history' USING ERRCODE='23514';END IF;
 SELECT * INTO STRICT b FROM rental_bookings WHERE id=NEW.booking_id;
 -- 0056: the trusted refund-worker functions below claim/observe a refund without a staff session. They first mark the exact row in
 -- rental_internal.ops_refund_effects for this transaction/backend; no application role can write that schema, so setting a session
 -- variable or calling UPDATE directly still goes through the staff checks.
 IF TG_TABLE_NAME='ops_refund_requests' AND TG_OP='UPDATE'
    AND EXISTS(SELECT 1 FROM rental_internal.ops_refund_effects WHERE tx=txid_current() AND pid=pg_backend_pid() AND refund_id=NEW.id) THEN NULL;
 ELSIF TG_TABLE_NAME='ops_refund_requests' THEN
  PERFORM ops_assert_actor('BOOKING_VIEW',ARRAY[NEW.acting_store],current_setting('zao.actor',true));
  IF NEW.acting_store NOT IN (b.conditions->>'pickupStore',b.conditions->>'returnStore') AND NOT EXISTS(SELECT 1 FROM rental_receipts r JOIN rental_loan_items l ON l.id=r.loan_item_id WHERE l.booking_id=b.id AND r.received_store=NEW.acting_store) THEN RAISE EXCEPTION 'Refund booking scope denied' USING ERRCODE='42501';END IF;
  PERFORM ops_assert_actor('REFUND_OVERRIDE',ARRAY[NEW.acting_store],current_setting('zao.actor',true));
 ELSE PERFORM ops_assert_actor('BOOKING_VIEW',ARRAY[b.conditions->>'pickupStore',b.conditions->>'returnStore'],current_setting('zao.actor',true));PERFORM ops_assert_actor('RENTAL_AMEND',ARRAY[b.conditions->>'pickupStore',b.conditions->>'returnStore'],current_setting('zao.actor',true));END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.actor IS DISTINCT FROM current_setting('zao.actor',true) OR NEW.state<>'PENDING' OR NEW.dispatched_at IS NOT NULL OR NEW.provider_id IS NOT NULL OR NEW.provider_state IS NOT NULL OR NEW.provider_updated_at IS NOT NULL OR NEW.completed_at IS NOT NULL THEN RAISE EXCEPTION 'Invalid initial financial request' USING ERRCODE='23514';END IF;
  IF TG_TABLE_NAME='ops_refund_requests' THEN
   SELECT * INTO paid FROM ops_collected_payments WHERE id=NEW.payment_id AND booking_id=NEW.booking_id AND kind=NEW.payment_kind;
   IF NOT FOUND OR paid.provider_id IS NULL OR paid.provider_id<>NEW.payment_provider_id OR paid.merchant_id<>NEW.merchant_id OR paid.location_id<>NEW.location_id OR paid.amount_jpy<>NEW.collected_jpy OR paid.currency<>NEW.currency THEN RAISE EXCEPTION 'Refund original payment mismatch' USING ERRCODE='23514';END IF;
   IF EXISTS(SELECT 1 FROM ops_refund_requests WHERE booking_id=NEW.booking_id AND state IN ('PENDING','UNKNOWN','REVIEW')) OR EXISTS(SELECT 1 FROM ops_financial_alerts WHERE booking_id=NEW.booking_id) THEN RAISE EXCEPTION 'Refund reconciliation required' USING ERRCODE='23514';END IF;
   SELECT coalesce(sum(amount_jpy),0) INTO reserved FROM ops_refund_requests WHERE payment_id=NEW.payment_id AND payment_kind=NEW.payment_kind AND state<>'FAILED';
   IF reserved<>NEW.previous_reserved_jpy OR reserved+NEW.amount_jpy>paid.amount_jpy THEN RAISE EXCEPTION 'Refund cap exceeded' USING ERRCODE='23514';END IF;
  ELSE
   IF NOT EXISTS(SELECT 1 FROM ops_amendments a JOIN ops_amendment_quotes q ON q.id=a.id JOIN rental_payment_attempts p ON p.booking_id=a.booking_id WHERE a.id=NEW.amendment_id AND a.booking_id=NEW.booking_id AND (q.quote->>'additionalChargeJpy')::bigint=NEW.amount_jpy AND p.state='COMPLETED' AND p.merchant_id=NEW.merchant_id AND p.location_id=NEW.location_id AND p.currency=NEW.currency) THEN RAISE EXCEPTION 'Charge quote mismatch' USING ERRCODE='23514';END IF;
  END IF;
 ELSE
  IF (to_jsonb(NEW)-ARRAY['state','dispatched_at','provider_id','provider_state','provider_updated_at','completed_at','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','dispatched_at','provider_id','provider_state','provider_updated_at','completed_at','updated_at']) OR OLD.state IN ('COMPLETED','FAILED','REVIEW') OR (OLD.dispatched_at IS NOT NULL AND NEW.dispatched_at IS DISTINCT FROM OLD.dispatched_at) OR (OLD.provider_id IS NOT NULL AND NEW.provider_id IS DISTINCT FROM OLD.provider_id) OR (OLD.provider_updated_at IS NOT NULL AND (NEW.provider_updated_at IS NULL OR NEW.provider_updated_at<OLD.provider_updated_at)) THEN RAISE EXCEPTION 'Immutable financial request' USING ERRCODE='23514';END IF;
  IF OLD.dispatched_at IS NULL AND (NEW.state<>'UNKNOWN' OR NEW.dispatched_at IS NULL OR NEW.provider_id IS NOT NULL OR NEW.provider_state IS NOT NULL OR NEW.provider_updated_at IS NOT NULL OR NEW.completed_at IS NOT NULL) THEN RAISE EXCEPTION 'Persist unknown before provider dispatch' USING ERRCODE='23514';END IF;
 END IF;
 RETURN NEW;
END$$;

CREATE TABLE rental_internal.ops_refund_effects(tx bigint NOT NULL,pid integer NOT NULL,refund_id uuid NOT NULL,PRIMARY KEY(tx,pid,refund_id));
REVOKE ALL ON rental_internal.ops_refund_effects FROM PUBLIC;
CREATE FUNCTION ops_refund_row(p_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$SELECT to_jsonb(r)||jsonb_build_object('mode',b.mode,'idempotency_key',r.id::text) FROM ops_refund_requests r JOIN rental_bookings b ON b.id=r.booking_id WHERE r.id=p_id$$;
CREATE FUNCTION ops_refund_claim(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE claimed integer;
BEGIN
 PERFORM pg_advisory_xact_lock(71820600);
 PERFORM set_config('zao.actor','system:refund-worker',true);
 INSERT INTO rental_internal.ops_refund_effects VALUES(txid_current(),pg_backend_pid(),p_id) ON CONFLICT DO NOTHING;
 UPDATE ops_refund_requests SET state='UNKNOWN',dispatched_at=inventory_clock(),updated_at=inventory_clock() WHERE id=p_id AND state='PENDING' AND dispatched_at IS NULL;
 GET DIAGNOSTICS claimed=ROW_COUNT;
 DELETE FROM rental_internal.ops_refund_effects WHERE tx=txid_current() AND pid=pg_backend_pid() AND refund_id=p_id;
 IF claimed<>1 THEN RETURN NULL;END IF;RETURN ops_refund_row(p_id);
END $$;
CREATE FUNCTION ops_refund_observe(p_id uuid,p_observation jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE r ops_refund_requests;o jsonb:=p_observation;valid boolean;next_state text;at timestamptz;action text:='NONE';
BEGIN
 PERFORM pg_advisory_xact_lock(71820600);
 SELECT * INTO STRICT r FROM ops_refund_requests WHERE id=p_id FOR UPDATE;
 IF r.dispatched_at IS NULL THEN RAISE EXCEPTION 'REFUND_NOT_DISPATCHED';END IF;
 IF r.state IN ('COMPLETED','FAILED','REVIEW') THEN RETURN;END IF;
 valid:=(o->>'id' ~ '^[A-Za-z0-9_-]{1,100}$' AND o->>'paymentProviderId'=r.payment_provider_id AND o->>'merchantId'=r.merchant_id AND o->>'locationId'=r.location_id AND o->>'currency'='JPY' AND (o->>'amountJpy')::bigint=r.amount_jpy AND o->>'status' IN ('PENDING','COMPLETED','REJECTED','FAILED') AND (o->>'updatedAt')::timestamptz<=inventory_clock() AND (r.provider_id IS NULL OR r.provider_id=o->>'id')) IS TRUE;
 IF NOT valid THEN action:='REVIEW';
 ELSE
  at:=(o->>'updatedAt')::timestamptz;
  IF r.provider_updated_at>at THEN action:='NONE';
  ELSIF r.provider_updated_at=at AND r.provider_state<>o->>'status' THEN action:='REVIEW';
  ELSE action:='APPLY';next_state:=CASE o->>'status' WHEN 'COMPLETED' THEN 'COMPLETED' WHEN 'PENDING' THEN 'PENDING' ELSE 'FAILED' END;END IF;
 END IF;
 IF action='NONE' THEN RETURN;END IF;
 PERFORM set_config('zao.actor','system:refund-worker',true);
 INSERT INTO rental_internal.ops_refund_effects VALUES(txid_current(),pg_backend_pid(),p_id) ON CONFLICT DO NOTHING;
 IF action='REVIEW' THEN UPDATE ops_refund_requests SET state='REVIEW',updated_at=inventory_clock() WHERE id=r.id;
 ELSE UPDATE ops_refund_requests SET state=next_state,provider_id=o->>'id',provider_state=o->>'status',provider_updated_at=at,
  completed_at=CASE WHEN next_state='COMPLETED' THEN at ELSE NULL END,updated_at=inventory_clock() WHERE id=r.id;END IF;
 DELETE FROM rental_internal.ops_refund_effects WHERE tx=txid_current() AND pid=pg_backend_pid() AND refund_id=p_id;
END $$;
REVOKE ALL ON FUNCTION ops_refund_row(uuid),ops_refund_claim(uuid),ops_refund_observe(uuid,jsonb) FROM PUBLIC;
