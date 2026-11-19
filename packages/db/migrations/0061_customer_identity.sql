-- 0061 minimal customer identity (Issue #47 consolidated order §5). Additive only: 0001-0060 unchanged. Not a CRM.
-- * owner_id is the creating actor (staff or guest), never a customer id; equal names/emails never prove the same person.
-- * Every booking created after this migration gets a link in its own creation transaction: a new profile, or the
--   profile a staff member explicitly selected (contact.customerProfileId, validated by the service and re-checked here).
-- * Existing bookings are not backfilled or merged. Reads show an unlinked booking as one legacy customer keyed by its id.
-- * The only change to an existing booking's customer is customer_link_legacy(): an unlinked booking joins the customer of
--   another booking (a new profile is created when that one is legacy too), under lock, idempotent per request key.
CREATE TABLE customer_profiles(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 display_name text NOT NULL CHECK(length(btrim(display_name)) BETWEEN 1 AND 120),
 email text CHECK(email IS NULL OR length(email) BETWEEN 3 AND 254),
 created_by text NOT NULL CHECK(length(created_by) BETWEEN 1 AND 120),
 created_at timestamptz NOT NULL DEFAULT inventory_clock()
);
CREATE TABLE customer_booking_links(
 booking_id uuid PRIMARY KEY REFERENCES rental_bookings(id),
 customer_id uuid NOT NULL REFERENCES customer_profiles(id),
 source text NOT NULL CHECK(source IN ('BOOKING_CREATE','STAFF_SELECTED','LEGACY_LINK')),
 linked_by text NOT NULL CHECK(length(linked_by) BETWEEN 1 AND 120),
 linked_at timestamptz NOT NULL DEFAULT inventory_clock()
);
CREATE INDEX customer_booking_links_customer ON customer_booking_links(customer_id,linked_at);
CREATE TABLE customer_link_requests(
 actor text NOT NULL REFERENCES staff_members(id),
 request_key uuid NOT NULL,
 booking_id uuid NOT NULL REFERENCES rental_bookings(id),
 target text NOT NULL CHECK(length(target) BETWEEN 1 AND 80),
 result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT inventory_clock(),
 PRIMARY KEY(actor,request_key)
);
REVOKE ALL ON customer_profiles,customer_booking_links,customer_link_requests FROM PUBLIC;
CREATE TRIGGER customer_profiles_immutable BEFORE UPDATE OR DELETE ON customer_profiles FOR EACH ROW EXECUTE FUNCTION pricing_immutable();
CREATE TRIGGER customer_booking_links_immutable BEFORE UPDATE OR DELETE ON customer_booking_links FOR EACH ROW EXECUTE FUNCTION pricing_immutable();
CREATE TRIGGER customer_link_requests_immutable BEFORE UPDATE OR DELETE ON customer_link_requests FOR EACH ROW EXECUTE FUNCTION pricing_immutable();

-- New bookings: profile + link in the creation transaction. A selected profile must exist; anything else fails the insert.
CREATE FUNCTION customer_capture_booking() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$DECLARE selected uuid;cid uuid;BEGIN
 IF NEW.contact ? 'customerProfileId' THEN
  selected:=(NEW.contact->>'customerProfileId')::uuid;
  IF NOT EXISTS(SELECT 1 FROM customer_profiles WHERE id=selected) THEN RAISE EXCEPTION 'CUSTOMER_PROFILE_NOT_FOUND' USING ERRCODE='23503';END IF;
  INSERT INTO customer_booking_links(booking_id,customer_id,source,linked_by) VALUES(NEW.id,selected,'STAFF_SELECTED',NEW.owner_id);
 ELSE
  INSERT INTO customer_profiles(display_name,email,created_by) VALUES(coalesce(nullif(btrim(NEW.contact->>'displayName'),''),'—'),nullif(NEW.contact->>'email',''),NEW.owner_id) RETURNING id INTO cid;
  INSERT INTO customer_booking_links(booking_id,customer_id,source,linked_by) VALUES(NEW.id,cid,'BOOKING_CREATE',NEW.owner_id);
 END IF;
 RETURN NEW;
END$$;
REVOKE ALL ON FUNCTION customer_capture_booking() FROM PUBLIC;
CREATE TRIGGER customer_capture_booking AFTER INSERT ON rental_bookings FOR EACH ROW EXECUTE FUNCTION customer_capture_booking();

-- Staff may see a booking when they can see its current pickup or return station.
CREATE FUNCTION customer_booking_visible(p_actor text,p_booking uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT coalesce((SELECT staff_can_view_store(p_actor,coalesce(h.pickup_store,b.conditions->>'pickupStore')) OR staff_can_view_store(p_actor,coalesce(h.return_store,b.conditions->>'returnStore'))
  FROM rental_bookings b LEFT JOIN inventory_holds h ON h.id=b.hold_id WHERE b.id=p_booking),false)
$$;
REVOKE ALL ON FUNCTION customer_booking_visible(text,uuid) FROM PUBLIC;

-- Link an unlinked (legacy) booking to the customer of another visible booking ('legacy:<id>') or a profile that already
-- has a visible booking. Both bookings are locked and re-checked; replay of the same request returns the stored result;
-- a different input under the same key, or a booking already linked meanwhile, is a conflict.
CREATE FUNCTION customer_link_legacy(p_request uuid,p_booking uuid,p_target text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE v_actor text:=current_setting('zao.actor',true);prior customer_link_requests;target_booking uuid;target_profile uuid;src rental_bookings;out jsonb;BEGIN
 PERFORM ops_assert_actor('BOOKING_CREATE','{}'::text[],v_actor);
 SELECT * INTO prior FROM customer_link_requests WHERE customer_link_requests.actor=v_actor AND request_key=p_request;
 IF FOUND THEN IF prior.booking_id<>p_booking OR prior.target<>p_target THEN RAISE EXCEPTION 'IDEMPOTENCY_MISMATCH' USING ERRCODE='23505';END IF;RETURN prior.result;END IF;
 IF p_target ~ '^legacy:[0-9a-f-]{36}$' THEN target_booking:=substr(p_target,8)::uuid;
 ELSIF p_target ~ '^[0-9a-f-]{36}$' THEN target_profile:=p_target::uuid;
 ELSE RAISE EXCEPTION 'CUSTOMER_TARGET_INVALID' USING ERRCODE='22023';END IF;
 IF target_booking=p_booking THEN RAISE EXCEPTION 'CUSTOMER_TARGET_INVALID' USING ERRCODE='22023';END IF;
 PERFORM 1 FROM rental_bookings WHERE id IN (p_booking,target_booking) ORDER BY id FOR UPDATE;
 IF NOT customer_booking_visible(v_actor,p_booking) THEN RAISE EXCEPTION 'OPS_FORBIDDEN' USING ERRCODE='42501';END IF;
 IF EXISTS(SELECT 1 FROM customer_booking_links WHERE booking_id=p_booking) THEN RAISE EXCEPTION 'CUSTOMER_ALREADY_LINKED' USING ERRCODE='23505';END IF;
 IF target_booking IS NOT NULL THEN
  IF NOT customer_booking_visible(v_actor,target_booking) THEN RAISE EXCEPTION 'OPS_FORBIDDEN' USING ERRCODE='42501';END IF;
  SELECT customer_id INTO target_profile FROM customer_booking_links WHERE booking_id=target_booking;
  IF target_profile IS NULL THEN
   SELECT * INTO src FROM rental_bookings WHERE id=target_booking;
   INSERT INTO customer_profiles(display_name,email,created_by) VALUES(coalesce(nullif(btrim(src.contact->>'displayName'),''),'—'),nullif(src.contact->>'email',''),v_actor) RETURNING id INTO target_profile;
   INSERT INTO customer_booking_links(booking_id,customer_id,source,linked_by) VALUES(target_booking,target_profile,'LEGACY_LINK',v_actor);
  END IF;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM customer_booking_links l WHERE l.customer_id=target_profile AND customer_booking_visible(v_actor,l.booking_id)) THEN RAISE EXCEPTION 'OPS_FORBIDDEN' USING ERRCODE='42501';END IF;
 END IF;
 INSERT INTO customer_booking_links(booking_id,customer_id,source,linked_by) VALUES(p_booking,target_profile,'LEGACY_LINK',v_actor);
 out:=jsonb_build_object('customerId',target_profile,'bookingId',p_booking);
 INSERT INTO customer_link_requests(actor,request_key,booking_id,target,result) VALUES(v_actor,p_request,p_booking,p_target,out);
 RETURN out;
END$$;
REVOKE ALL ON FUNCTION customer_link_legacy(uuid,uuid,text) FROM PUBLIC;
