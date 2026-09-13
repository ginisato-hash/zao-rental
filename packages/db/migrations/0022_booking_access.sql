-- Dedicated development migration; production migration/release is separately gated.
-- No booking, payment, HOLD, custody or staff authority is granted to this boundary.
CREATE SCHEMA booking_access;
REVOKE ALL ON SCHEMA booking_access FROM PUBLIC;
CREATE TABLE booking_access.capabilities (
 booking_id uuid NOT NULL REFERENCES public.rental_bookings(id),
 request_id uuid NOT NULL, token_sha256 text UNIQUE NOT NULL CHECK(token_sha256 ~ '^[a-f0-9]{64}$'),
 key_version text NOT NULL CHECK(key_version ~ '^[A-Za-z0-9_-]{1,64}$'),
 issued_at timestamptz NOT NULL, expires_at timestamptz NOT NULL, revoked_at timestamptz,
 PRIMARY KEY(booking_id,request_id), CHECK(expires_at>issued_at)
);
CREATE UNIQUE INDEX booking_access_live ON booking_access.capabilities(booking_id) WHERE revoked_at IS NULL;
CREATE TABLE booking_access.audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, booking_id uuid NOT NULL REFERENCES public.rental_bookings(id),
 request_id uuid NOT NULL, action text NOT NULL CHECK(action IN ('ISSUED','ROTATED','REVOKED')),
 created_at timestamptz NOT NULL
);
REVOKE ALL ON ALL TABLES IN SCHEMA booking_access FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA booking_access FROM PUBLIC;

CREATE FUNCTION booking_access.issue(p_context uuid,p_actor text,p_guest_hash text,p_booking uuid,p_request uuid,p_token_hash text,p_key_version text)
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
 IF g.revoked_at IS NOT NULL OR g.expires_at<=now_at OR b.confirmed_at IS NULL OR b.state NOT IN ('CONFIRMED_DEV','COMPLETED_DEV') OR h.due_at<=now_at THEN RAISE EXCEPTION 'BOOKING_ACCESS_DENIED' USING ERRCODE='42501';END IF;
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

CREATE FUNCTION booking_access.read(p_hash text)
 RETURNS TABLE(booking_id uuid,state text,mode text,pickup_store text,return_store text,period jsonb,due_at timestamptz,total_jpy bigint,price_sha256 text,expires_at timestamptz)
 LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT b.id,b.state,b.mode,b.conditions->>'pickupStore',b.conditions->>'returnStore',b.conditions->'period',h.due_at,(b.price_snapshot->>'totalJpy')::bigint,b.price_sha256,c.expires_at
 FROM booking_access.capabilities c JOIN public.rental_bookings b ON b.id=c.booking_id JOIN public.inventory_holds h ON h.id=b.hold_id
 WHERE c.token_sha256=p_hash AND c.revoked_at IS NULL AND c.expires_at>public.inventory_clock()
 AND h.due_at>public.inventory_clock() AND b.confirmed_at IS NOT NULL AND b.state IN ('CONFIRMED_DEV','COMPLETED_DEV')
$$;
CREATE FUNCTION booking_access.revoke(p_hash text) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp SET lock_timeout='2s' AS $$
DECLARE cap booking_access.capabilities; now_at timestamptz;
BEGIN
 SELECT * INTO cap FROM booking_access.capabilities WHERE token_sha256=p_hash;
 IF NOT FOUND THEN RETURN;END IF;
 PERFORM 1 FROM public.rental_bookings WHERE id=cap.booking_id FOR UPDATE;
 now_at:=public.inventory_clock();
 UPDATE booking_access.capabilities SET revoked_at=now_at WHERE token_sha256=p_hash AND revoked_at IS NULL;
 IF FOUND THEN INSERT INTO booking_access.audit(booking_id,request_id,action,created_at) VALUES(cap.booking_id,cap.request_id,'REVOKED',now_at);END IF;
END$$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA booking_access FROM PUBLIC;
