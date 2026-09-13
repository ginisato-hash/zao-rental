-- Owner explicitly approved LATE_PICKUP_BOUNDARY_PROPOSAL.md in this session.
-- Fresh dedicated synthetic development DB only. No production provisioning.
DO $$BEGIN
 IF current_database() !~ '^zr_[a-f0-9]{12}$' OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_database()||'_custody_executor' AND NOT rolcanlogin AND NOT rolsuper AND NOT rolcreaterole AND NOT rolcreatedb) THEN RAISE EXCEPTION 'Dedicated custody development database required';END IF;
END$$;
CREATE TABLE rental_no_pickup_events(
 booking_id uuid PRIMARY KEY REFERENCES rental_bookings(id),actor text NOT NULL REFERENCES staff_members(id),
 due_at timestamptz NOT NULL,completed_at timestamptz NOT NULL,
 outcome text NOT NULL CHECK(outcome='NO_PICKUP_COMPLETED'),CHECK(completed_at>=due_at)
);
CREATE TRIGGER rental_no_pickup_immutable BEFORE UPDATE OR DELETE ON rental_no_pickup_events FOR EACH ROW EXECUTE FUNCTION pricing_immutable();
CREATE FUNCTION rental_complete_no_pickup(booking_uuid uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE b rental_bookings;h inventory_holds;now_at timestamptz;actor text:=current_setting('zao.actor',true);
BEGIN
 PERFORM pg_advisory_xact_lock(71820600);
 SELECT * INTO b FROM rental_bookings WHERE id=booking_uuid;
 IF NOT FOUND THEN RAISE EXCEPTION 'NO_PICKUP_NOT_FOUND' USING ERRCODE='23514';END IF;
 PERFORM rental_internal.assert_actor('RENTAL_CHECKOUT',b.conditions->>'pickupStore',actor);
 IF EXISTS(SELECT 1 FROM rental_no_pickup_events WHERE booking_id=b.id) THEN RETURN;END IF;
 SELECT * INTO STRICT h FROM inventory_holds WHERE id=b.hold_id;
 now_at:=inventory_clock();
 IF b.state<>'CONFIRMED_DEV' OR b.confirmed_at IS NULL OR h.state<>'ACTIVE' OR h.payment_state<>'SUCCESS' OR h.confirmed_at IS NULL OR h.due_at>now_at OR EXISTS(SELECT 1 FROM rental_loan_items WHERE booking_id=b.id) OR EXISTS(SELECT 1 FROM wear_loans WHERE booking_id=b.id) THEN RAISE EXCEPTION 'NO_PICKUP_NOT_ELIGIBLE' USING ERRCODE='23514';END IF;
 -- Only this completed contract; fixed-stage history and dispatched movements are untouched.
 UPDATE inventory_claims SET active=false WHERE hold_id=h.id AND active;
 UPDATE wear_claims SET active=false WHERE hold_id=h.id AND active;
 UPDATE inventory_holds SET state='RELEASED',version=version+1 WHERE id=h.id;
 UPDATE rental_bookings SET state='COMPLETED_DEV',version=version+1 WHERE id=b.id;
 INSERT INTO rental_no_pickup_events VALUES(b.id,actor,h.due_at,now_at,'NO_PICKUP_COMPLETED');
END$$;
REVOKE ALL ON FUNCTION rental_complete_no_pickup(uuid) FROM PUBLIC;
REVOKE ALL ON rental_no_pickup_events FROM PUBLIC;
DO $$DECLARE executor text:=current_database()||'_custody_executor';app text:=current_database()||'_custody';BEGIN
 EXECUTE format('GRANT SELECT ON wear_loans,wear_claims,rental_no_pickup_events TO %I',executor);
 EXECUTE format('GRANT INSERT ON rental_no_pickup_events TO %I',executor);
 EXECUTE format('GRANT UPDATE(active) ON wear_claims TO %I',executor);
 EXECUTE format('GRANT UPDATE(state,version) ON inventory_holds,rental_bookings TO %I',executor);
 EXECUTE format('ALTER FUNCTION rental_complete_no_pickup(uuid) OWNER TO %I',executor);
 EXECUTE format('GRANT SELECT ON rental_no_pickup_events TO %I',app);
 EXECUTE format('GRANT EXECUTE ON FUNCTION rental_complete_no_pickup(uuid) TO %I',app);
END$$;
