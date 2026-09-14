-- Additive development migration; recovery only mints/revokes read capabilities.
-- No booking/payment/HOLD/inventory/custody mutation, and no raw code/token storage.
CREATE TABLE booking_access.recoveries (
 booking_id uuid NOT NULL REFERENCES public.rental_bookings(id), request_id uuid NOT NULL,
 code_sha256 text UNIQUE NOT NULL CHECK(code_sha256 ~ '^[a-f0-9]{64}$'),
 key_version text NOT NULL CHECK(key_version ~ '^[A-Za-z0-9_-]{1,64}$'),
 created_at timestamptz NOT NULL, expires_at timestamptz NOT NULL, revoked_at timestamptz,
 delivered_at timestamptz, exchange_id uuid, exchanged_at timestamptz,
 PRIMARY KEY(booking_id,request_id), CHECK(expires_at>created_at),
 CHECK((exchange_id IS NULL)=(exchanged_at IS NULL))
);
CREATE UNIQUE INDEX booking_recovery_live ON booking_access.recoveries(booking_id) WHERE revoked_at IS NULL;
CREATE TABLE booking_access.recovery_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, booking_id uuid NOT NULL REFERENCES public.rental_bookings(id),
 request_id uuid NOT NULL, action text NOT NULL CHECK(action IN ('PREPARED','DELIVERED','ROTATED','EXCHANGED','REVOKED')),
 created_at timestamptz NOT NULL
);
REVOKE ALL ON booking_access.recoveries,booking_access.recovery_audit FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA booking_access FROM PUBLIC;

CREATE FUNCTION booking_access.prepare_recovery(p_context uuid,p_actor text,p_guest_hash text,p_booking uuid,p_request uuid,p_code_hash text,p_key_version text)
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
 IF g.revoked_at IS NOT NULL OR g.expires_at<=t OR b.confirmed_at IS NULL OR b.state NOT IN ('CONFIRMED_DEV','COMPLETED_DEV') OR h.due_at<=t OR coalesce(b.contact->>'email','')='' THEN RAISE EXCEPTION 'BOOKING_RECOVERY_DENIED' USING ERRCODE='42501';END IF;
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

-- Acknowledgement is bookkeeping, not authority. Possessing the one-time code is
-- sufficient even if the delivery acknowledgement was lost after actual delivery.
CREATE FUNCTION booking_access.recovery_delivered(p_code_hash text) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE r booking_access.recoveries;t timestamptz;
BEGIN
 SELECT * INTO r FROM booking_access.recoveries WHERE code_sha256=p_code_hash;
 IF NOT FOUND THEN RETURN;END IF;
 PERFORM 1 FROM public.rental_bookings WHERE id=r.booking_id FOR UPDATE;t:=public.inventory_clock();
 UPDATE booking_access.recoveries SET delivered_at=t WHERE code_sha256=p_code_hash AND delivered_at IS NULL AND revoked_at IS NULL AND expires_at>t;
 IF FOUND THEN INSERT INTO booking_access.recovery_audit(booking_id,request_id,action,created_at) VALUES(r.booking_id,r.request_id,'DELIVERED',t);END IF;
END$$;

CREATE FUNCTION booking_access.exchange_recovery(p_code_hash text,p_exchange uuid,p_cap_hash text,p_key_version text)
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
 IF r.revoked_at IS NOT NULL OR r.expires_at<=t OR h.due_at<=t OR b.confirmed_at IS NULL OR b.state NOT IN ('CONFIRMED_DEV','COMPLETED_DEV') THEN RAISE EXCEPTION 'BOOKING_RECOVERY_DENIED' USING ERRCODE='42501';END IF;
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

-- A holder may withdraw its recovery proof; this never grants a write principal.
-- If already exchanged, revoke only that exchange's capability (not a later issue).
CREATE FUNCTION booking_access.revoke_recovery(p_code_hash text) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp SET lock_timeout='2s' AS $$
DECLARE r booking_access.recoveries;t timestamptz;
BEGIN
 SELECT * INTO r FROM booking_access.recoveries WHERE code_sha256=p_code_hash;
 IF NOT FOUND THEN RETURN;END IF;
 PERFORM 1 FROM public.rental_bookings WHERE id=r.booking_id FOR UPDATE;
 SELECT * INTO r FROM booking_access.recoveries WHERE code_sha256=p_code_hash FOR UPDATE;t:=public.inventory_clock();
 IF r.revoked_at IS NULL THEN
  UPDATE booking_access.recoveries SET revoked_at=t WHERE code_sha256=p_code_hash;
  INSERT INTO booking_access.recovery_audit(booking_id,request_id,action,created_at) VALUES(r.booking_id,r.request_id,'REVOKED',t);
  UPDATE booking_access.capabilities SET revoked_at=t WHERE booking_id=r.booking_id AND request_id=r.exchange_id AND revoked_at IS NULL;
  IF FOUND THEN INSERT INTO booking_access.audit(booking_id,request_id,action,created_at) VALUES(r.booking_id,r.exchange_id,'REVOKED',t);END IF;
 END IF;
END$$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA booking_access FROM PUBLIC;
