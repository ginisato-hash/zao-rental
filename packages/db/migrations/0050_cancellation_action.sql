-- Recovery proof, not a read capability, issues a ten-minute CANCEL-only authority.
CREATE TABLE booking_access.cancellation_actions(
 booking_id uuid NOT NULL,request_id uuid NOT NULL,
 token_sha256 text NOT NULL UNIQUE CHECK(token_sha256 ~ '^[a-f0-9]{64}$'),
 key_version text NOT NULL CHECK(key_version ~ '^[A-Za-z0-9_-]{1,64}$'),
 action text NOT NULL DEFAULT 'CANCEL' CHECK(action='CANCEL'),
 issued_at timestamptz NOT NULL,expires_at timestamptz NOT NULL,
 PRIMARY KEY(booking_id,request_id),
 FOREIGN KEY(booking_id,request_id) REFERENCES booking_access.capabilities(booking_id,request_id),
 CHECK(expires_at>issued_at AND expires_at<=issued_at+interval '10 minutes')
);
REVOKE ALL ON booking_access.cancellation_actions FROM PUBLIC;
CREATE FUNCTION booking_access.exchange_recovery_with_cancellation(p_code_hash text,p_exchange uuid,p_read_hash text,p_action_hash text,p_key_version text)
RETURNS TABLE(expires_at timestamptz,remaining_seconds integer,replayed boolean,cancel_expires_at timestamptz,cancel_remaining_seconds integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp SET lock_timeout='2s' AS $$
DECLARE r record;c booking_access.capabilities;a booking_access.cancellation_actions;t timestamptz;
BEGIN
 IF p_action_hash IS NULL OR p_action_hash !~ '^[a-f0-9]{64}$' OR p_action_hash=p_read_hash THEN RAISE EXCEPTION 'CANCELLATION_AUTHORITY_DENIED' USING ERRCODE='42501';END IF;
 -- This verifies the actual recovery secret and pins the exact read capability/booking.
 SELECT * INTO STRICT r FROM booking_access.exchange_recovery(p_code_hash,p_exchange,p_read_hash,p_key_version);
 SELECT * INTO STRICT c FROM booking_access.capabilities WHERE token_sha256=p_read_hash AND request_id=p_exchange FOR UPDATE;
 t:=inventory_clock();
 SELECT * INTO a FROM booking_access.cancellation_actions WHERE booking_id=c.booking_id AND request_id=c.request_id;
 IF FOUND THEN
  IF a.token_sha256<>p_action_hash OR a.key_version<>p_key_version THEN RAISE EXCEPTION 'CANCELLATION_AUTHORITY_DENIED' USING ERRCODE='42501';END IF;
 ELSE
  INSERT INTO booking_access.cancellation_actions(booking_id,request_id,token_sha256,key_version,issued_at,expires_at)
  VALUES(c.booking_id,c.request_id,p_action_hash,p_key_version,t,least(c.expires_at,t+interval '10 minutes')) RETURNING * INTO a;
 END IF;
 -- Lost exchange responses reproduce the same capability and expiry, never extend it.
 RETURN QUERY SELECT r.expires_at,r.remaining_seconds,r.replayed,CASE WHEN a.expires_at>t THEN a.expires_at END,greatest(0,floor(extract(epoch FROM a.expires_at-t))::integer);
END$$;
CREATE FUNCTION booking_access.assert_cancellation(p_hash text,p_booking uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE a booking_access.cancellation_actions;c booking_access.capabilities;b rental_bookings;t timestamptz;
BEGIN
 PERFORM pg_advisory_xact_lock(71820600);
 SELECT * INTO a FROM booking_access.cancellation_actions WHERE token_sha256=p_hash AND booking_id=p_booking AND action='CANCEL';
 IF NOT FOUND THEN RAISE EXCEPTION 'CANCELLATION_AUTHORITY_DENIED' USING ERRCODE='42501';END IF;
 SELECT * INTO STRICT b FROM rental_bookings WHERE id=a.booking_id FOR UPDATE;
 SELECT * INTO STRICT c FROM booking_access.capabilities WHERE booking_id=a.booking_id AND request_id=a.request_id FOR UPDATE;
 t:=inventory_clock();
 IF a.expires_at<=t OR c.expires_at<=t OR c.revoked_at IS NOT NULL OR NOT booking_state_valid(b.mode,b.state) THEN RAISE EXCEPTION 'CANCELLATION_AUTHORITY_DENIED' USING ERRCODE='42501';END IF;
 PERFORM set_config('zao.actor',b.owner_id,true);
 PERFORM set_config('zao.reason','Verified recovery CANCEL action',true);
END$$;
CREATE FUNCTION booking_access.cancellation_ready(p_hash text,p_booking uuid) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM booking_access.cancellation_actions a JOIN booking_access.capabilities c USING(booking_id,request_id)
 WHERE a.token_sha256=p_hash AND a.booking_id=p_booking AND a.action='CANCEL' AND a.expires_at>inventory_clock() AND c.expires_at>inventory_clock() AND c.revoked_at IS NULL)
$$;
CREATE FUNCTION booking_access.cancellation_status(p_read_hash text) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT booking_cancellation_status(booking_id) FROM booking_access.read(p_read_hash)
$$;
CREATE FUNCTION booking_access.cancellation_preview(p_hash text,p_booking uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$BEGIN
 PERFORM booking_access.assert_cancellation(p_hash,p_booking);
 IF EXISTS(SELECT 1 FROM booking_cancellations WHERE booking_id=p_booking) THEN RETURN jsonb_build_object('cancelled',booking_cancellation_status(p_booking));END IF;
 RETURN booking_cancellation_preview(p_booking);
END$$;
CREATE FUNCTION booking_access.cancel(p_hash text,p_booking uuid,p_request uuid,p_preview jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$BEGIN
 IF p_request IS NULL THEN RAISE EXCEPTION 'CANCELLATION_AUTHORITY_DENIED' USING ERRCODE='42501';END IF;
 PERFORM booking_access.assert_cancellation(p_hash,p_booking);
 RETURN booking_cancel(p_booking,p_request,p_preview);
END$$;
REVOKE ALL ON FUNCTION booking_access.exchange_recovery_with_cancellation(text,uuid,text,text,text),booking_access.assert_cancellation(text,uuid),booking_access.cancellation_ready(text,uuid),booking_access.cancellation_status(text),booking_access.cancellation_preview(text,uuid),booking_access.cancel(text,uuid,uuid,jsonb) FROM PUBLIC;
