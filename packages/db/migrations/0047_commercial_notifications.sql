-- Production confirmation/recovery and cancellation reuse the existing durable outbox.
CREATE OR REPLACE FUNCTION notification_enqueue_confirmed(p_booking uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp SET lock_timeout='1s' AS $$DECLARE result uuid;BEGIN
 INSERT INTO booking_notification_outbox(event_type,booking_id,recipient_reference,dedupe_key,locale,template_version,next_attempt_at)
 SELECT 'BOOKING_CONFIRMED',b.id,b.id,'booking-confirmed:'||b.id||':1',b.notification_locale,'BOOKING_NOTIFICATION_V1',inventory_clock()
 FROM rental_bookings b LEFT JOIN rental_notifications n ON n.booking_id=b.id WHERE b.id=p_booking AND (b.mode='SQUARE_PRODUCTION' OR n.booking_id IS NOT NULL) AND b.confirmed_at IS NOT NULL AND booking_state_valid(b.mode,b.state) AND b.state IN ('CONFIRMED_DEV','COMPLETED_DEV','CONFIRMED','COMPLETED')
 ON CONFLICT(dedupe_key) DO NOTHING;
 SELECT id INTO result FROM booking_notification_outbox WHERE dedupe_key='booking-confirmed:'||p_booking||':1';RETURN result;
END$$;

CREATE OR REPLACE FUNCTION notification_sync_confirmed() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$DECLARE r record;n integer:=0;BEGIN
 FOR r IN SELECT b.id FROM rental_bookings b LEFT JOIN rental_notifications e ON e.booking_id=b.id WHERE (b.mode='SQUARE_PRODUCTION' OR e.booking_id IS NOT NULL) AND b.confirmed_at IS NOT NULL AND booking_state_valid(b.mode,b.state) AND b.state IN ('CONFIRMED_DEV','COMPLETED_DEV','CONFIRMED','COMPLETED') AND NOT EXISTS(SELECT 1 FROM booking_notification_outbox o WHERE o.dedupe_key='booking-confirmed:'||b.id||':1') ORDER BY b.id LIMIT 100 LOOP
  PERFORM notification_enqueue_confirmed(r.id);n:=n+1;
 END LOOP;RETURN n;
END$$;

CREATE OR REPLACE FUNCTION notification_material(p_id uuid,p_claim uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$DECLARE o booking_notification_outbox;b rental_bookings;r booking_access.recoveries;BEGIN
 SELECT * INTO o FROM booking_notification_outbox WHERE id=p_id AND status='SENDING' AND claim_id=p_claim AND claim_until>inventory_clock();IF NOT FOUND THEN RETURN NULL;END IF;
 SELECT * INTO b FROM rental_bookings WHERE id=o.booking_id AND (confirmed_at IS NOT NULL OR state='CANCELLED') AND booking_state_valid(mode,state) AND state IN ('CONFIRMED_DEV','COMPLETED_DEV','CONFIRMED','COMPLETED','CANCELLED');IF NOT FOUND THEN RETURN NULL;END IF;
 IF o.event_type='BOOKING_CONFIRMED' AND b.state='CANCELLED' THEN RETURN NULL;END IF;
 IF o.event_type='BOOKING_RECOVERY' THEN SELECT * INTO r FROM booking_access.recoveries WHERE booking_id=b.id AND request_id=o.recovery_request_id AND revoked_at IS NULL AND expires_at>inventory_clock() AND exchanged_at IS NULL;IF NOT FOUND THEN RETURN NULL;END IF;END IF;
 RETURN jsonb_build_object('id',o.id,'eventType',o.event_type,'locale',o.locale,'dedupeKey',o.dedupe_key,'bookingId',b.id,'recipient',b.contact->>'email','conditions',b.conditions,'priceSnapshot',b.price_snapshot,'priceSha256',b.price_sha256,'paymentStatus',(SELECT state FROM rental_payment_attempts WHERE booking_id=b.id ORDER BY created_at DESC LIMIT 1),'cancellation',booking_cancellation_status(b.id),'recovery',CASE WHEN o.event_type='BOOKING_RECOVERY' THEN jsonb_build_object('requestId',r.request_id,'ownerId',b.owner_id,'derivation',r.notification_derivation,'codeHash',r.code_sha256,'keyVersion',r.key_version,'expiresAt',r.expires_at) ELSE NULL END);
END$$;

CREATE OR REPLACE FUNCTION booking_access.issue(p_context uuid,p_actor text,p_guest_hash text,p_booking uuid,p_request uuid,p_token_hash text,p_key_version text)
 RETURNS TABLE(expires_at timestamptz,remaining_seconds integer,replayed boolean)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp SET lock_timeout='2s' AS $$
DECLARE g public.guest_contexts; b public.rental_bookings; h public.inventory_holds; old booking_access.capabilities; now_at timestamptz;
BEGIN
 IF p_guest_hash !~ '^[a-f0-9]{64}$' OR p_token_hash !~ '^[a-f0-9]{64}$' OR p_key_version !~ '^[A-Za-z0-9_-]{1,64}$' THEN RAISE EXCEPTION 'BOOKING_ACCESS_DENIED' USING ERRCODE='42501';END IF;
 -- Same order as guest checkout; no inventory lock/mutation. Recheck time after waits.
 SELECT * INTO g FROM public.guest_contexts WHERE id=p_context AND actor_id=p_actor AND token_sha256=p_guest_hash FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'BOOKING_ACCESS_DENIED' USING ERRCODE='42501';END IF;
 SELECT * INTO b FROM public.rental_bookings WHERE id=p_booking AND owner_id=p_actor FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'BOOKING_ACCESS_DENIED' USING ERRCODE='42501';END IF;
 SELECT * INTO h FROM public.inventory_holds WHERE id=b.hold_id;
 now_at:=public.inventory_clock();
 IF g.revoked_at IS NOT NULL OR g.expires_at<=now_at OR (b.confirmed_at IS NULL AND b.state<>'CANCELLED') OR NOT booking_state_valid(b.mode,b.state) OR b.state NOT IN ('CONFIRMED_DEV','COMPLETED_DEV','CONFIRMED','COMPLETED','CANCELLED') OR h.due_at<=now_at THEN RAISE EXCEPTION 'BOOKING_ACCESS_DENIED' USING ERRCODE='42501';END IF;
 SELECT * INTO old FROM booking_access.capabilities WHERE booking_id=p_booking AND request_id=p_request;
 IF FOUND THEN
  IF old.revoked_at IS NOT NULL OR old.expires_at<=now_at OR old.token_sha256<>p_token_hash OR old.key_version<>p_key_version THEN RAISE EXCEPTION 'BOOKING_ACCESS_DENIED' USING ERRCODE='42501';END IF;
  RETURN QUERY SELECT old.expires_at,least(34560000,floor(extract(epoch FROM old.expires_at-now_at))::integer),true;RETURN;
 END IF;
 INSERT INTO booking_access.audit(booking_id,request_id,action,created_at)
 SELECT booking_id,request_id,'ROTATED',now_at FROM booking_access.capabilities WHERE booking_id=p_booking AND revoked_at IS NULL;
 UPDATE booking_access.capabilities SET revoked_at=now_at WHERE booking_id=p_booking AND revoked_at IS NULL;
 INSERT INTO booking_access.capabilities VALUES(p_booking,p_request,p_token_hash,p_key_version,now_at,h.due_at,NULL);
 INSERT INTO booking_access.audit(booking_id,request_id,action,created_at) VALUES(p_booking,p_request,'ISSUED',now_at);
 RETURN QUERY SELECT h.due_at,least(34560000,floor(extract(epoch FROM h.due_at-now_at))::integer),false;
END$$;

CREATE OR REPLACE FUNCTION booking_access.read(p_hash text)
 RETURNS TABLE(booking_id uuid,state text,mode text,pickup_store text,return_store text,period jsonb,due_at timestamptz,total_jpy bigint,price_sha256 text,expires_at timestamptz)
 LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT b.id,b.state,b.mode,b.conditions->>'pickupStore',b.conditions->>'returnStore',b.conditions->'period',h.due_at,(b.price_snapshot->>'totalJpy')::bigint,b.price_sha256,c.expires_at
 FROM booking_access.capabilities c JOIN public.rental_bookings b ON b.id=c.booking_id JOIN public.inventory_holds h ON h.id=b.hold_id
 WHERE c.token_sha256=p_hash AND c.revoked_at IS NULL AND c.expires_at>public.inventory_clock()
 AND h.due_at>public.inventory_clock() AND (b.confirmed_at IS NOT NULL OR b.state='CANCELLED') AND booking_state_valid(b.mode,b.state) AND b.state IN ('CONFIRMED_DEV','COMPLETED_DEV','CONFIRMED','COMPLETED','CANCELLED')
$$;

CREATE OR REPLACE FUNCTION booking_access.prepare_recovery(p_context uuid,p_actor text,p_guest_hash text,p_booking uuid,p_request uuid,p_code_hash text,p_key_version text)
 RETURNS TABLE(expires_at timestamptz,recipient text,replayed boolean,delivered boolean)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp SET lock_timeout='2s' AS $$
DECLARE g public.guest_contexts;b public.rental_bookings;h public.inventory_holds;old booking_access.recoveries;t timestamptz;
BEGIN
 IF p_guest_hash IS NULL OR p_guest_hash !~ '^[a-f0-9]{64}$' OR p_code_hash IS NULL OR p_code_hash !~ '^[a-f0-9]{64}$' OR p_key_version IS NULL OR p_key_version !~ '^[A-Za-z0-9_-]{1,64}$' THEN RAISE EXCEPTION 'BOOKING_RECOVERY_DENIED' USING ERRCODE='42501';END IF;
 SELECT * INTO g FROM public.guest_contexts WHERE id=p_context AND actor_id=p_actor AND token_sha256=p_guest_hash FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'BOOKING_RECOVERY_DENIED' USING ERRCODE='42501';END IF;
 SELECT * INTO b FROM public.rental_bookings WHERE id=p_booking AND owner_id=p_actor FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'BOOKING_RECOVERY_DENIED' USING ERRCODE='42501';END IF;
 SELECT * INTO h FROM public.inventory_holds WHERE id=b.hold_id;t:=public.inventory_clock();
 IF g.revoked_at IS NOT NULL OR g.expires_at<=t OR (b.confirmed_at IS NULL AND b.state<>'CANCELLED') OR NOT booking_state_valid(b.mode,b.state) OR b.state NOT IN ('CONFIRMED_DEV','COMPLETED_DEV','CONFIRMED','COMPLETED','CANCELLED') OR h.due_at<=t OR coalesce(b.contact->>'email','')='' THEN RAISE EXCEPTION 'BOOKING_RECOVERY_DENIED' USING ERRCODE='42501';END IF;
 SELECT * INTO old FROM booking_access.recoveries WHERE booking_id=p_booking AND request_id=p_request;
 IF FOUND THEN
  IF old.revoked_at IS NOT NULL OR old.expires_at<=t OR old.exchanged_at IS NOT NULL OR old.code_sha256<>p_code_hash OR old.key_version<>p_key_version THEN RAISE EXCEPTION 'BOOKING_RECOVERY_DENIED' USING ERRCODE='42501';END IF;
  RETURN QUERY SELECT old.expires_at,b.contact->>'email',true,old.delivered_at IS NOT NULL;RETURN;
 END IF;
 INSERT INTO booking_access.recovery_audit(booking_id,request_id,action,created_at) SELECT booking_id,request_id,'ROTATED',t FROM booking_access.recoveries WHERE booking_id=p_booking AND revoked_at IS NULL;
 UPDATE booking_access.recoveries SET revoked_at=t WHERE booking_id=p_booking AND revoked_at IS NULL;
 INSERT INTO booking_access.recoveries(booking_id,request_id,code_sha256,key_version,created_at,expires_at) VALUES(p_booking,p_request,p_code_hash,p_key_version,t,h.due_at);
 INSERT INTO booking_access.recovery_audit(booking_id,request_id,action,created_at) VALUES(p_booking,p_request,'PREPARED',t);
 RETURN QUERY SELECT h.due_at,b.contact->>'email',false,false;
END$$;

CREATE OR REPLACE FUNCTION booking_access.exchange_recovery(p_code_hash text,p_exchange uuid,p_cap_hash text,p_key_version text)
 RETURNS TABLE(expires_at timestamptz,remaining_seconds integer,replayed boolean)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp SET lock_timeout='2s' AS $$
DECLARE r booking_access.recoveries;b public.rental_bookings;h public.inventory_holds;c booking_access.capabilities;t timestamptz;
BEGIN
 IF p_code_hash IS NULL OR p_code_hash !~ '^[a-f0-9]{64}$' OR p_cap_hash IS NULL OR p_cap_hash !~ '^[a-f0-9]{64}$' OR p_exchange IS NULL OR p_key_version IS NULL OR p_key_version !~ '^[A-Za-z0-9_-]{1,64}$' THEN RAISE EXCEPTION 'BOOKING_RECOVERY_DENIED' USING ERRCODE='42501';END IF;
 -- Invalid proof stops before a booking row lock. Shared booking lock serializes
 -- issue/rotation/revoke/exchange and prevents resurrection after an acknowledged revoke.
 SELECT * INTO r FROM booking_access.recoveries WHERE code_sha256=p_code_hash;
 IF NOT FOUND THEN RAISE EXCEPTION 'BOOKING_RECOVERY_DENIED' USING ERRCODE='42501';END IF;
 SELECT * INTO b FROM public.rental_bookings WHERE id=r.booking_id FOR UPDATE;
 SELECT * INTO r FROM booking_access.recoveries WHERE code_sha256=p_code_hash FOR UPDATE;
 SELECT * INTO h FROM public.inventory_holds WHERE id=b.hold_id;t:=public.inventory_clock();
 IF r.revoked_at IS NOT NULL OR r.expires_at<=t OR h.due_at<=t OR (b.confirmed_at IS NULL AND b.state<>'CANCELLED') OR NOT booking_state_valid(b.mode,b.state) OR b.state NOT IN ('CONFIRMED_DEV','COMPLETED_DEV','CONFIRMED','COMPLETED','CANCELLED') THEN RAISE EXCEPTION 'BOOKING_RECOVERY_DENIED' USING ERRCODE='42501';END IF;
 IF r.exchange_id IS NOT NULL THEN
  IF r.exchange_id<>p_exchange THEN RAISE EXCEPTION 'BOOKING_RECOVERY_DENIED' USING ERRCODE='42501';END IF;
  SELECT * INTO c FROM booking_access.capabilities WHERE booking_id=b.id AND request_id=p_exchange;
  IF NOT FOUND OR c.revoked_at IS NOT NULL OR c.expires_at<=t OR c.token_sha256<>p_cap_hash OR c.key_version<>p_key_version THEN RAISE EXCEPTION 'BOOKING_RECOVERY_DENIED' USING ERRCODE='42501';END IF;
  RETURN QUERY SELECT c.expires_at,least(34560000,floor(extract(epoch FROM c.expires_at-t))::integer),true;RETURN;
 END IF;
 -- A conflicting client request id is not permission to replace an old capability.
 IF EXISTS(SELECT 1 FROM booking_access.capabilities WHERE booking_id=b.id AND request_id=p_exchange) THEN RAISE EXCEPTION 'BOOKING_RECOVERY_DENIED' USING ERRCODE='42501';END IF;
 INSERT INTO booking_access.audit(booking_id,request_id,action,created_at) SELECT booking_id,request_id,'ROTATED',t FROM booking_access.capabilities WHERE booking_id=b.id AND revoked_at IS NULL;
 UPDATE booking_access.capabilities SET revoked_at=t WHERE booking_id=b.id AND revoked_at IS NULL;
 INSERT INTO booking_access.capabilities VALUES(b.id,p_exchange,p_cap_hash,p_key_version,t,least(r.expires_at,h.due_at),NULL);
 INSERT INTO booking_access.audit(booking_id,request_id,action,created_at) VALUES(b.id,p_exchange,'ISSUED',t);
 UPDATE booking_access.recoveries SET exchange_id=p_exchange,exchanged_at=t WHERE code_sha256=p_code_hash;
 INSERT INTO booking_access.recovery_audit(booking_id,request_id,action,created_at) VALUES(b.id,r.request_id,'EXCHANGED',t);
 RETURN QUERY SELECT least(r.expires_at,h.due_at),least(34560000,floor(extract(epoch FROM least(r.expires_at,h.due_at)-t))::integer),false;
END$$;

CREATE OR REPLACE FUNCTION booking_access.request_recovery(p_booking uuid,p_email text,p_request uuid,p_code_hash text,p_key_version text,p_locale text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp SET lock_timeout='2s' AS $$
DECLARE b rental_bookings;h inventory_holds;r booking_access.recoveries;t timestamptz;BEGIN
 IF p_request IS NULL OR p_code_hash IS NULL OR p_code_hash !~ '^[a-f0-9]{64}$' OR p_key_version IS NULL OR p_key_version !~ '^[A-Za-z0-9_-]{1,64}$' OR p_locale NOT IN ('ja','en') THEN RETURN;END IF;
 SELECT * INTO b FROM rental_bookings WHERE id=p_booking AND lower(btrim(contact->>'email'))=p_email FOR UPDATE;
 IF NOT FOUND THEN RETURN;END IF;
 SELECT * INTO h FROM inventory_holds WHERE id=b.hold_id;t:=inventory_clock();
 IF (b.confirmed_at IS NULL AND b.state<>'CANCELLED') OR NOT booking_state_valid(b.mode,b.state) OR b.state NOT IN ('CONFIRMED_DEV','COMPLETED_DEV','CONFIRMED','COMPLETED','CANCELLED') OR h.due_at<=t THEN RETURN;END IF;
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
CREATE FUNCTION notification_capture_production_confirmation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF NEW.mode='SQUARE_PRODUCTION' AND NEW.state='CONFIRMED' AND NEW.confirmed_at IS NOT NULL THEN PERFORM notification_enqueue_confirmed(NEW.id);END IF;RETURN NEW;
END $$;
CREATE TRIGGER notification_capture_production_confirmation AFTER INSERT OR UPDATE OF state ON rental_bookings FOR EACH ROW EXECUTE FUNCTION notification_capture_production_confirmation();
REVOKE ALL ON FUNCTION notification_capture_production_confirmation() FROM PUBLIC;
