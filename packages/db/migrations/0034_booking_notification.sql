-- M1.6 durable delivery bookkeeping, owned local databases only.
DO $$BEGIN IF current_database() !~ '^zr_[a-f0-9]{12}$' THEN RAISE EXCEPTION 'Dedicated development database required';END IF;END$$;
ALTER TABLE staff_role_permissions DROP CONSTRAINT staff_role_permissions_permission_check;
ALTER TABLE staff_permission_overrides DROP CONSTRAINT staff_permission_overrides_permission_check;
ALTER TABLE staff_role_permissions ADD CHECK(permission IN ('INVENTORY_VIEW','INVENTORY_EDIT','STAFF_MANAGE','HOLD_VIEW','HOLD_EDIT','TRANSFER_VIEW','TRANSFER_PLAN','TRANSFER_DISPATCH','TRANSFER_RECEIVE','QUOTE_VIEW','QUOTE_CREATE','PRICE_EDIT','BOOKING_VIEW','BOOKING_CREATE','RENTAL_CHECKOUT','RENTAL_RETURN','RENTAL_AMEND','REFUND_OVERRIDE','INVENTORY_RECONCILE','NOTIFICATION_RESEND'));
ALTER TABLE staff_permission_overrides ADD CHECK(permission IN ('INVENTORY_VIEW','INVENTORY_EDIT','STAFF_MANAGE','HOLD_VIEW','HOLD_EDIT','TRANSFER_VIEW','TRANSFER_PLAN','TRANSFER_DISPATCH','TRANSFER_RECEIVE','QUOTE_VIEW','QUOTE_CREATE','PRICE_EDIT','BOOKING_VIEW','BOOKING_CREATE','RENTAL_CHECKOUT','RENTAL_RETURN','RENTAL_AMEND','REFUND_OVERRIDE','INVENTORY_RECONCILE','NOTIFICATION_RESEND'));
-- Draft only; assign the next migration number from M1.5 terminal remote HEAD.
-- Immutable rental_notifications captures remain canonical and are never rewritten.
CREATE TABLE booking_notification_outbox (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 event_type text NOT NULL CHECK(event_type IN ('BOOKING_CONFIRMED','BOOKING_RECOVERY','BOOKING_AMENDED','PAYMENT_ACTION_REQUIRED','REFUND_STATUS')),
 booking_id uuid NOT NULL REFERENCES rental_bookings(id),
 recipient_reference uuid NOT NULL REFERENCES rental_bookings(id),
 dedupe_key text NOT NULL UNIQUE CHECK(length(dedupe_key) BETWEEN 1 AND 180),
 recovery_request_id uuid,
 parent_delivery_id uuid REFERENCES booking_notification_outbox(id),
 locale text NOT NULL CHECK(locale IN ('ja','en')),
 template_version text NOT NULL CHECK(template_version='BOOKING_NOTIFICATION_V1'),
 status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','SENDING','SENT','RETRYABLE_FAILURE','PERMANENT_FAILURE','SUPPRESSED','UNKNOWN')),
 attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 3),
 next_attempt_at timestamptz,
 claim_id uuid,claim_until timestamptz,
 provider_message_id text CHECK(provider_message_id ~ '^[-A-Za-z0-9_]{1,128}$'),
 created_at timestamptz NOT NULL DEFAULT inventory_clock(),
 sent_at timestamptz,
 last_safe_failure_code text NOT NULL DEFAULT 'NONE' CHECK(last_safe_failure_code IN ('NONE','DELIVERY_UNCONNECTED','RATE_LIMITED','PROVIDER_UNAVAILABLE','PERMANENT_REJECT','ACCEPTANCE_UNKNOWN','RETRY_EXHAUSTED','RECOVERY_EXPIRED_OR_REVOKED','TEMPLATE_UNAVAILABLE','RECIPIENT_UNAVAILABLE')),
 CHECK(recipient_reference=booking_id),
 CHECK((event_type='BOOKING_RECOVERY')=(recovery_request_id IS NOT NULL)),
 CHECK((status='SENDING')=(claim_id IS NOT NULL AND claim_until IS NOT NULL)),
 CHECK((claim_id IS NULL)=(claim_until IS NULL)),
 CHECK((status='SENT')=(sent_at IS NOT NULL)),
 CHECK(status<>'SENT' OR provider_message_id IS NOT NULL),
 FOREIGN KEY(booking_id,recovery_request_id) REFERENCES booking_access.recoveries(booking_id,request_id)
);
CREATE INDEX booking_notification_due ON booking_notification_outbox(next_attempt_at,id) WHERE status IN ('PENDING','RETRYABLE_FAILURE');
CREATE INDEX booking_notification_booking ON booking_notification_outbox(booking_id,created_at);
REVOKE ALL ON booking_notification_outbox FROM PUBLIC;
-- Functions/audit/role grants follow only once scoped ownership and test cases are implemented.
-- These functions own only delivery/recovery bookkeeping, never booking state.
ALTER TABLE booking_access.recoveries ADD COLUMN notification_derivation text NOT NULL DEFAULT 'GUEST_V1' CHECK(notification_derivation IN ('GUEST_V1','EMAIL_V1'));

CREATE FUNCTION notification_enqueue_confirmed(p_booking uuid,p_locale text DEFAULT 'ja') RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp SET lock_timeout='1s' AS $$DECLARE result uuid;BEGIN
 IF p_locale NOT IN ('ja','en') THEN RAISE EXCEPTION 'INVALID_LOCALE' USING ERRCODE='23514';END IF;
 INSERT INTO booking_notification_outbox(event_type,booking_id,recipient_reference,dedupe_key,locale,template_version,next_attempt_at)
 SELECT 'BOOKING_CONFIRMED',b.id,b.id,'booking-confirmed:'||b.id||':1',p_locale,'BOOKING_NOTIFICATION_V1',inventory_clock()
 FROM rental_bookings b JOIN rental_notifications n ON n.booking_id=b.id WHERE b.id=p_booking AND b.confirmed_at IS NOT NULL AND b.state IN ('CONFIRMED_DEV','COMPLETED_DEV')
 ON CONFLICT(dedupe_key) DO NOTHING;
 SELECT id INTO result FROM booking_notification_outbox WHERE dedupe_key='booking-confirmed:'||p_booking||':1';RETURN result;
END$$;
CREATE FUNCTION notification_sync_confirmed() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$DECLARE r record;n integer:=0;BEGIN
 FOR r IN SELECT b.id FROM rental_bookings b JOIN rental_notifications e ON e.booking_id=b.id WHERE b.confirmed_at IS NOT NULL AND b.state IN ('CONFIRMED_DEV','COMPLETED_DEV') AND NOT EXISTS(SELECT 1 FROM booking_notification_outbox o WHERE o.dedupe_key='booking-confirmed:'||b.id||':1') ORDER BY b.id LIMIT 100 LOOP
  PERFORM notification_enqueue_confirmed(r.id,'ja');n:=n+1;
 END LOOP;RETURN n;
END$$;

CREATE FUNCTION booking_access.queue_recovery(p_context uuid,p_actor text,p_guest_hash text,p_booking uuid,p_request uuid,p_code_hash text,p_key_version text,p_locale text)
RETURNS TABLE(expires_at timestamptz,replayed boolean) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$DECLARE r record;t timestamptz;BEGIN
 IF p_locale NOT IN ('ja','en') THEN RAISE EXCEPTION 'INVALID_LOCALE' USING ERRCODE='23514';END IF;
 -- The original locked ownership/expiry/rotation checks remain authoritative.
 SELECT * INTO r FROM booking_access.prepare_recovery(p_context,p_actor,p_guest_hash,p_booking,p_request,p_code_hash,p_key_version);
 t:=inventory_clock();
 IF NOT r.replayed AND (EXISTS(SELECT 1 FROM booking_access.recoveries WHERE booking_id=p_booking AND request_id<>p_request AND created_at>t-interval '1 minute') OR (SELECT count(*) FROM booking_access.recoveries WHERE booking_id=p_booking AND created_at>t-interval '1 day')>3) THEN RAISE EXCEPTION 'NOTIFICATION_RATE_LIMITED' USING ERRCODE='P0429';END IF;
 INSERT INTO booking_notification_outbox(event_type,booking_id,recipient_reference,dedupe_key,recovery_request_id,locale,template_version,next_attempt_at)
 VALUES('BOOKING_RECOVERY',p_booking,p_booking,'booking-recovery:'||p_booking||':'||p_request,p_request,p_locale,'BOOKING_NOTIFICATION_V1',t) ON CONFLICT(dedupe_key) DO NOTHING;
 RETURN QUERY SELECT r.expires_at,r.replayed;
END$$;

CREATE FUNCTION booking_access.request_recovery(p_booking uuid,p_email text,p_request uuid,p_code_hash text,p_key_version text,p_locale text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp SET lock_timeout='2s' AS $$
DECLARE b rental_bookings;h inventory_holds;r booking_access.recoveries;t timestamptz;BEGIN
 IF p_request IS NULL OR p_code_hash IS NULL OR p_code_hash !~ '^[a-f0-9]{64}$' OR p_key_version IS NULL OR p_key_version !~ '^[A-Za-z0-9_-]{1,64}$' OR p_locale NOT IN ('ja','en') THEN RETURN;END IF;
 SELECT * INTO b FROM rental_bookings WHERE id=p_booking AND lower(btrim(contact->>'email'))=p_email FOR UPDATE;
 IF NOT FOUND THEN RETURN;END IF;
 SELECT * INTO h FROM inventory_holds WHERE id=b.hold_id;t:=inventory_clock();
 IF b.confirmed_at IS NULL OR b.state NOT IN ('CONFIRMED_DEV','COMPLETED_DEV') OR h.due_at<=t THEN RETURN;END IF;
 SELECT * INTO r FROM booking_access.recoveries WHERE booking_id=b.id AND request_id=p_request;
 IF FOUND THEN RETURN;END IF;
 -- Existing/nonexisting/rate-suppressed requests all produce the same public response.
 IF EXISTS(SELECT 1 FROM booking_access.recoveries WHERE booking_id=b.id AND created_at>t-interval '1 minute') OR (SELECT count(*) FROM booking_access.recoveries WHERE booking_id=b.id AND created_at>t-interval '1 day')>=3 THEN RETURN;END IF;
 INSERT INTO booking_access.recovery_audit(booking_id,request_id,action,created_at) SELECT booking_id,request_id,'ROTATED',t FROM booking_access.recoveries WHERE booking_id=b.id AND revoked_at IS NULL;
 UPDATE booking_access.recoveries SET revoked_at=t WHERE booking_id=b.id AND revoked_at IS NULL;
 INSERT INTO booking_access.recoveries(booking_id,request_id,code_sha256,key_version,created_at,expires_at,notification_derivation) VALUES(b.id,p_request,p_code_hash,p_key_version,t,least(h.due_at,t+interval '15 minutes'),'EMAIL_V1');
 INSERT INTO booking_access.recovery_audit(booking_id,request_id,action,created_at) VALUES(b.id,p_request,'PREPARED',t);
 INSERT INTO booking_notification_outbox(event_type,booking_id,recipient_reference,dedupe_key,recovery_request_id,locale,template_version,next_attempt_at)
 VALUES('BOOKING_RECOVERY',b.id,b.id,'booking-recovery:'||b.id||':'||p_request,p_request,p_locale,'BOOKING_NOTIFICATION_V1',t);
END$$;

CREATE FUNCTION notification_claim(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$DECLARE o booking_notification_outbox;t timestamptz;BEGIN
 SELECT * INTO o FROM booking_notification_outbox WHERE id=p_id FOR UPDATE;IF NOT FOUND THEN RETURN NULL;END IF;t:=inventory_clock();
 IF o.status='SENDING' AND o.claim_until<=t THEN UPDATE booking_notification_outbox SET status='UNKNOWN',last_safe_failure_code='ACCEPTANCE_UNKNOWN',claim_id=NULL,claim_until=NULL,next_attempt_at=NULL WHERE id=o.id;RETURN NULL;END IF;
 IF o.status NOT IN ('PENDING','RETRYABLE_FAILURE') OR o.attempt_count>=3 OR o.next_attempt_at IS NULL OR o.next_attempt_at>t THEN RETURN NULL;END IF;
 IF o.event_type='BOOKING_RECOVERY' AND NOT EXISTS(SELECT 1 FROM booking_access.recoveries r WHERE r.booking_id=o.booking_id AND r.request_id=o.recovery_request_id AND r.revoked_at IS NULL AND r.expires_at>t AND r.exchanged_at IS NULL) THEN
  UPDATE booking_notification_outbox SET status='SUPPRESSED',next_attempt_at=NULL,last_safe_failure_code='RECOVERY_EXPIRED_OR_REVOKED' WHERE id=o.id;RETURN NULL;
 END IF;
 UPDATE booking_notification_outbox SET status='SENDING',attempt_count=attempt_count+1,claim_id=gen_random_uuid(),claim_until=t+interval '1 minute',next_attempt_at=NULL,last_safe_failure_code='NONE' WHERE id=o.id RETURNING * INTO o;
 RETURN jsonb_build_object('id',o.id,'claimId',o.claim_id,'dedupeKey',o.dedupe_key);
END$$;
CREATE FUNCTION notification_material(p_id uuid,p_claim uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$DECLARE o booking_notification_outbox;b rental_bookings;r booking_access.recoveries;BEGIN
 SELECT * INTO o FROM booking_notification_outbox WHERE id=p_id AND status='SENDING' AND claim_id=p_claim AND claim_until>inventory_clock();IF NOT FOUND THEN RETURN NULL;END IF;
 SELECT * INTO b FROM rental_bookings WHERE id=o.booking_id AND confirmed_at IS NOT NULL AND state IN ('CONFIRMED_DEV','COMPLETED_DEV');IF NOT FOUND THEN RETURN NULL;END IF;
 IF o.event_type='BOOKING_RECOVERY' THEN SELECT * INTO r FROM booking_access.recoveries WHERE booking_id=b.id AND request_id=o.recovery_request_id AND revoked_at IS NULL AND expires_at>inventory_clock() AND exchanged_at IS NULL;IF NOT FOUND THEN RETURN NULL;END IF;END IF;
 RETURN jsonb_build_object('id',o.id,'eventType',o.event_type,'locale',o.locale,'dedupeKey',o.dedupe_key,'bookingId',b.id,'recipient',b.contact->>'email','conditions',b.conditions,'priceSnapshot',b.price_snapshot,'priceSha256',b.price_sha256,'paymentStatus',(SELECT state FROM rental_payment_attempts WHERE booking_id=b.id ORDER BY created_at DESC LIMIT 1),'recovery',CASE WHEN o.event_type='BOOKING_RECOVERY' THEN jsonb_build_object('requestId',r.request_id,'ownerId',b.owner_id,'derivation',r.notification_derivation,'codeHash',r.code_sha256,'keyVersion',r.key_version,'expiresAt',r.expires_at) ELSE NULL END);
END$$;
CREATE FUNCTION notification_settle(p_id uuid,p_claim uuid,p_result text,p_provider text,p_failure text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$DECLARE o booking_notification_outbox;t timestamptz;new_status text;BEGIN
 SELECT * INTO o FROM booking_notification_outbox WHERE id=p_id FOR UPDATE;IF NOT FOUND OR o.status<>'SENDING' OR o.claim_id IS DISTINCT FROM p_claim THEN RETURN false;END IF;t:=inventory_clock();
 IF p_result='ACCEPTED' AND p_provider ~ '^[-A-Za-z0-9_]{1,128}$' THEN new_status:='SENT';p_failure:='NONE';
 ELSIF p_result='NOT_ACCEPTED' AND p_failure IN ('RATE_LIMITED','PROVIDER_UNAVAILABLE') THEN new_status:=CASE WHEN o.attempt_count>=3 THEN 'PERMANENT_FAILURE' ELSE 'RETRYABLE_FAILURE' END;IF o.attempt_count>=3 THEN p_failure:='RETRY_EXHAUSTED';END IF;
 ELSIF p_result='REJECTED' AND p_failure='PERMANENT_REJECT' THEN new_status:='PERMANENT_FAILURE';
 ELSIF p_result='SUPPRESSED' AND p_failure IN ('RECOVERY_EXPIRED_OR_REVOKED','TEMPLATE_UNAVAILABLE','RECIPIENT_UNAVAILABLE') THEN new_status:='SUPPRESSED';
 ELSE new_status:='UNKNOWN';p_failure:='ACCEPTANCE_UNKNOWN';END IF;
 UPDATE booking_notification_outbox SET status=new_status,claim_id=NULL,claim_until=NULL,provider_message_id=CASE WHEN new_status='SENT' THEN p_provider ELSE NULL END,sent_at=CASE WHEN new_status='SENT' THEN t ELSE NULL END,next_attempt_at=CASE WHEN new_status='RETRYABLE_FAILURE' THEN t+(power(2,o.attempt_count)*interval '1 minute') ELSE NULL END,last_safe_failure_code=p_failure WHERE id=o.id;
 IF new_status='SENT' AND o.event_type='BOOKING_RECOVERY' THEN PERFORM booking_access.recovery_delivered((SELECT code_sha256 FROM booking_access.recoveries WHERE booking_id=o.booking_id AND request_id=o.recovery_request_id));END IF;RETURN true;
END$$;
CREATE FUNCTION notification_unknown(p_id uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$DECLARE o booking_notification_outbox;BEGIN
 SELECT * INTO o FROM booking_notification_outbox WHERE id=p_id FOR UPDATE;IF NOT FOUND THEN RETURN NULL;END IF;
 IF o.status='SENDING' AND o.claim_until<=inventory_clock() THEN UPDATE booking_notification_outbox SET status='UNKNOWN',claim_id=NULL,claim_until=NULL,last_safe_failure_code='ACCEPTANCE_UNKNOWN' WHERE id=o.id;o.status:='UNKNOWN';END IF;
 IF o.status='UNKNOWN' THEN RETURN o.dedupe_key;END IF;RETURN NULL;
END$$;
CREATE FUNCTION notification_reconciled(p_id uuid,p_provider text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$DECLARE o booking_notification_outbox;BEGIN
 IF p_provider IS NULL OR p_provider !~ '^[-A-Za-z0-9_]{1,128}$' THEN RETURN false;END IF;
 UPDATE booking_notification_outbox SET status='SENT',sent_at=inventory_clock(),provider_message_id=p_provider,last_safe_failure_code='NONE' WHERE id=p_id AND status='UNKNOWN' RETURNING * INTO o;IF NOT FOUND THEN RETURN false;END IF;
 IF o.event_type='BOOKING_RECOVERY' THEN PERFORM booking_access.recovery_delivered((SELECT code_sha256 FROM booking_access.recoveries WHERE booking_id=o.booking_id AND request_id=o.recovery_request_id));END IF;RETURN true;
END$$;
CREATE FUNCTION notification_due() RETURNS TABLE(id uuid) LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT id FROM booking_notification_outbox WHERE status IN ('PENDING','RETRYABLE_FAILURE') AND next_attempt_at<=inventory_clock() OR status='SENDING' AND claim_until<=inventory_clock() ORDER BY created_at,id LIMIT 100
$$;
CREATE FUNCTION notification_status(p_store text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$DECLARE result jsonb;BEGIN
 PERFORM ops_assert_actor('BOOKING_VIEW',ARRAY[p_store],current_setting('zao.actor',true));
 SELECT coalesce(jsonb_agg(x ORDER BY x."createdAt" DESC),'[]'::jsonb) INTO result FROM (
  SELECT o.id,o.booking_id AS "bookingId",o.event_type AS "eventType",o.status,o.attempt_count AS "attemptCount",o.next_attempt_at AS "nextAttemptAt",o.created_at AS "createdAt",o.sent_at AS "sentAt",o.last_safe_failure_code AS "lastSafeFailureCode"
  FROM booking_notification_outbox o JOIN rental_bookings b ON b.id=o.booking_id WHERE p_store IN (b.conditions->>'pickupStore',b.conditions->>'returnStore') ORDER BY o.created_at DESC LIMIT 100
 ) x;RETURN result;
END$$;
CREATE FUNCTION notification_resend(p_id uuid,p_request uuid,p_store text,p_reason text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$DECLARE o booking_notification_outbox;b rental_bookings;result uuid;t timestamptz;BEGIN
 PERFORM pg_advisory_xact_lock(71820600);
 PERFORM ops_assert_actor('BOOKING_VIEW',ARRAY[p_store],current_setting('zao.actor',true));PERFORM ops_assert_actor('NOTIFICATION_RESEND',ARRAY[p_store],current_setting('zao.actor',true));
 IF p_reason IS NULL OR p_reason NOT IN ('CUSTOMER_REQUEST','DELIVERY_RECOVERY') OR p_request IS NULL THEN RAISE EXCEPTION 'NOTIFICATION_REASON_REQUIRED' USING ERRCODE='23514';END IF;
 SELECT * INTO o FROM booking_notification_outbox WHERE id=p_id FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'NOTIFICATION_NOT_FOUND' USING ERRCODE='23514';END IF;
 SELECT * INTO b FROM rental_bookings WHERE id=o.booking_id;IF p_store NOT IN (b.conditions->>'pickupStore',b.conditions->>'returnStore') THEN RAISE EXCEPTION 'NOTIFICATION_SCOPE_DENIED' USING ERRCODE='42501';END IF;
 SELECT id INTO result FROM booking_notification_outbox WHERE dedupe_key='manual:'||p_id||':'||p_request;IF FOUND THEN RETURN result;END IF;
 IF o.status<>'SENT' AND NOT(o.status='PERMANENT_FAILURE' AND o.last_safe_failure_code='RETRY_EXHAUSTED') OR o.parent_delivery_id IS NOT NULL THEN RAISE EXCEPTION 'NOTIFICATION_RESEND_UNSAFE' USING ERRCODE='23514';END IF;
 IF EXISTS(SELECT 1 FROM booking_notification_outbox WHERE parent_delivery_id=o.id AND status IN ('PENDING','SENDING','RETRYABLE_FAILURE','UNKNOWN')) THEN RAISE EXCEPTION 'NOTIFICATION_RESEND_UNSAFE' USING ERRCODE='23514';END IF;
 -- At most three explicit generations per booking/day, with a one-minute cooldown.
 t:=inventory_clock();IF EXISTS(SELECT 1 FROM booking_notification_outbox WHERE booking_id=o.booking_id AND parent_delivery_id IS NOT NULL AND created_at>t-interval '1 minute') OR (SELECT count(*) FROM booking_notification_outbox WHERE booking_id=o.booking_id AND parent_delivery_id IS NOT NULL AND created_at>t-interval '1 day')>=3 THEN RAISE EXCEPTION 'NOTIFICATION_RESEND_RATE_LIMIT' USING ERRCODE='P0429';END IF;
 IF o.event_type='BOOKING_RECOVERY' AND NOT EXISTS(SELECT 1 FROM booking_access.recoveries WHERE booking_id=o.booking_id AND request_id=o.recovery_request_id AND revoked_at IS NULL AND expires_at>t AND exchanged_at IS NULL) THEN RAISE EXCEPTION 'RECOVERY_EXPIRED_OR_REVOKED' USING ERRCODE='23514';END IF;
 INSERT INTO booking_notification_outbox(event_type,booking_id,recipient_reference,dedupe_key,recovery_request_id,parent_delivery_id,locale,template_version,next_attempt_at)
 VALUES(o.event_type,o.booking_id,o.booking_id,'manual:'||p_id||':'||p_request,o.recovery_request_id,o.id,o.locale,o.template_version,t) RETURNING id INTO result;
 INSERT INTO ops_history(resource,entity_id,actor,event,after_data) VALUES('booking_notification_outbox',result,current_setting('zao.actor'),'MANUAL_RESEND_REQUESTED',jsonb_build_object('bookingId',o.booking_id,'parentDeliveryId',o.id,'reason',p_reason,'store',p_store));RETURN result;
END$$;
REVOKE ALL ON FUNCTION notification_enqueue_confirmed(uuid,text),notification_sync_confirmed(),notification_claim(uuid),notification_material(uuid,uuid),notification_settle(uuid,uuid,text,text,text),notification_unknown(uuid),notification_reconciled(uuid,text),notification_due(),notification_status(text),notification_resend(uuid,uuid,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION booking_access.queue_recovery(uuid,text,text,uuid,uuid,text,text,text),booking_access.request_recovery(uuid,text,uuid,text,text,text) FROM PUBLIC;
