-- A quote records the proposed per-booking classification; acceptance re-authorizes it.
ALTER TABLE ops_amendment_quotes ADD COLUMN buffer_override boolean NOT NULL DEFAULT false;
ALTER TABLE ops_amendment_quotes ADD COLUMN buffer_override_reason text CHECK(buffer_override_reason IS NULL OR length(btrim(buffer_override_reason)) BETWEEN 1 AND 300);

CREATE OR REPLACE FUNCTION ops_accept_amendment() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$DECLARE q ops_amendment_quotes;b rental_bookings;h inventory_holds;BEGIN
 SELECT * INTO STRICT q FROM ops_amendment_quotes WHERE id=NEW.id;SELECT * INTO STRICT b FROM rental_bookings WHERE id=q.booking_id;SELECT * INTO STRICT h FROM inventory_holds WHERE id=b.hold_id;
 PERFORM ops_assert_actor('RENTAL_AMEND',ARRAY[h.pickup_store,h.return_store],NEW.actor);PERFORM ops_assert_actor('BOOKING_VIEW',ARRAY[h.pickup_store,h.return_store],NEW.actor);
 IF q.actor<>NEW.actor OR q.booking_id<>NEW.booking_id OR NOT booking_is_confirmed(b.mode,b.state) OR q.expires_at<=inventory_clock() OR h.version<>q.expected_hold_version OR h.conditions<>q.before_conditions THEN RAISE EXCEPTION 'AMENDMENT_QUOTE_STALE' USING ERRCODE='23514';END IF;
 IF q.buffer_override OR h.buffer_override THEN PERFORM ops_assert_actor('INVENTORY_BUFFER_OVERRIDE',ARRAY[h.pickup_store,h.return_store],NEW.actor);IF q.buffer_override_reason IS NULL THEN RAISE EXCEPTION 'BUFFER_OVERRIDE_REASON_REQUIRED' USING ERRCODE='23514';END IF;END IF;
 RETURN NEW;
END$$;
