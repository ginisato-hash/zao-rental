-- 0062 store sales stops (Owner request 2026-11-22: day-level stop of sales, mainly for temporary closure). Additive only:
-- 0001-0061 unchanged, no existing row is changed and no booking is cancelled.
-- * One row per (station, day) that is stopped. A booking whose rental period (start..end, inclusive) touches a stopped day
--   at its pickup or return station is refused for guests by the application (HoldService); staff may continue after an
--   explicit on-screen warning. Existing bookings are only listed for staff, never changed.
-- * Writes go only through store_sales_stop_set() (SECURITY DEFINER, actor from the authenticated zao.actor setting; the
--   application checks INVENTORY_EDIT and the stations with ops_assert_actor first). Every change is appended to the
--   history; neither table accepts UPDATE, and the history accepts no DELETE.
-- * store_sales_stopped_days() exposes only station + day (no reason, no actor) so the public booking page can show the
--   stopped days; it is the only object PUBLIC may execute.
-- * Defence in depth that does not depend on the application version (PR74-ROLLBACK-01): a BEFORE trigger on inventory_holds
--   refuses a GUEST-owned ACTIVE hold whose period or stations touch a stopped day (SQLSTATE P0062). It fires on INSERT and on an
--   UPDATE that changes the period or stations (or reactivates the hold), so an application build that predates 0062 cannot
--   take a public booking on a stopped day either. STAFF-owned holds are never refused (staff continue after the warning), and
--   updates that keep the same period and stations (payment state, expiry, allocation) are not affected.
CREATE TABLE store_sales_stops(
 store_id text NOT NULL REFERENCES ledger_stores(id),
 day date NOT NULL,
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 160),
 created_by text NOT NULL CHECK(length(created_by) BETWEEN 1 AND 120),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(store_id,day)
);
CREATE TABLE store_sales_stop_history(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 store_id text NOT NULL REFERENCES ledger_stores(id),
 day date NOT NULL,
 action text NOT NULL CHECK(action IN ('STOP','RELEASE')),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 160),
 actor text NOT NULL CHECK(length(actor) BETWEEN 1 AND 120),
 occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX store_sales_stop_history_day_idx ON store_sales_stop_history(day,store_id,id);
CREATE FUNCTION store_sales_stop_guard() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
 RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='STORE_SALES_STOP_IMMUTABLE';
END$$;
CREATE TRIGGER store_sales_stops_no_update BEFORE UPDATE ON store_sales_stops FOR EACH ROW EXECUTE FUNCTION store_sales_stop_guard();
CREATE TRIGGER store_sales_stop_history_append_only BEFORE UPDATE OR DELETE ON store_sales_stop_history FOR EACH ROW EXECUTE FUNCTION store_sales_stop_guard();
REVOKE ALL ON store_sales_stops,store_sales_stop_history FROM PUBLIC;
REVOKE ALL ON FUNCTION store_sales_stop_guard() FROM PUBLIC;

-- Stop (p_stop=true) or release (false) every day from p_from to p_to (inclusive, at most 366 days) at each given station.
-- Idempotent per (station, day): stopping a stopped day or releasing an open day changes nothing and writes no history.
-- Returns the number of (station, day) pairs that actually changed.
CREATE FUNCTION store_sales_stop_set(p_stores text[],p_from date,p_to date,p_stop boolean,p_reason text) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE v_actor text:=current_setting('zao.actor',true);v_store text;v_day date;v_changed integer:=0;v_n integer;
BEGIN
 IF v_actor IS NULL OR length(v_actor) NOT BETWEEN 1 AND 120 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='STORE_SALES_STOP_ACTOR_REQUIRED';END IF;
 IF p_stop IS NULL OR p_from IS NULL OR p_to IS NULL OR p_to<p_from OR p_to-p_from>365 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='STORE_SALES_STOP_RANGE_INVALID';END IF;
 IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 160 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='STORE_SALES_STOP_REASON_INVALID';END IF;
 IF p_stores IS NULL OR cardinality(p_stores) NOT BETWEEN 1 AND 10 OR EXISTS(SELECT 1 FROM unnest(p_stores) x WHERE NOT EXISTS(SELECT 1 FROM ledger_stores s WHERE s.id=x)) THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='STORE_SALES_STOP_STORE_INVALID';END IF;
 PERFORM pg_advisory_xact_lock(71820620);
 FOREACH v_store IN ARRAY (SELECT array_agg(DISTINCT x ORDER BY x) FROM unnest(p_stores) x) LOOP
  v_day:=p_from;
  WHILE v_day<=p_to LOOP
   IF p_stop THEN
    INSERT INTO store_sales_stops(store_id,day,reason,created_by) VALUES(v_store,v_day,btrim(p_reason),v_actor) ON CONFLICT DO NOTHING;
   ELSE
    DELETE FROM store_sales_stops WHERE store_id=v_store AND day=v_day;
   END IF;
   GET DIAGNOSTICS v_n=ROW_COUNT;
   IF v_n=1 THEN
    INSERT INTO store_sales_stop_history(store_id,day,action,reason,actor) VALUES(v_store,v_day,CASE WHEN p_stop THEN 'STOP' ELSE 'RELEASE' END,btrim(p_reason),v_actor);
    v_changed:=v_changed+1;
   END IF;
   v_day:=v_day+1;
  END LOOP;
 END LOOP;
 RETURN v_changed;
END$$;
REVOKE ALL ON FUNCTION store_sales_stop_set(text[],date,date,boolean,text) FROM PUBLIC;

-- Stopped days for the given stations within [p_from, p_to] (at most 400 days). Station and day only.
CREATE FUNCTION store_sales_stopped_days(p_stores text[],p_from date,p_to date) RETURNS TABLE(store_id text,day date)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT s.store_id,s.day FROM store_sales_stops s
 WHERE p_stores IS NOT NULL AND p_from IS NOT NULL AND p_to IS NOT NULL AND p_to>=p_from AND p_to-p_from<=400
  AND s.store_id=ANY(p_stores) AND s.day BETWEEN p_from AND p_to
 ORDER BY s.day,s.store_id
$$;
REVOKE ALL ON FUNCTION store_sales_stopped_days(text[],date,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION store_sales_stopped_days(text[],date,date) TO PUBLIC;
-- Guest holds on stopped days are refused by the database as well as by the application (see header).
CREATE FUNCTION store_sales_stop_hold_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE first_day date; last_day date;
BEGIN
 IF NEW.state<>'ACTIVE' THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND OLD.state='ACTIVE' AND NEW.pickup_store=OLD.pickup_store AND NEW.return_store=OLD.return_store
  AND NEW.conditions->'period' IS NOT DISTINCT FROM OLD.conditions->'period' AND NEW.occupancy_start=OLD.occupancy_start AND NEW.occupancy_end=OLD.occupancy_end THEN
  RETURN NEW;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM booking_actors a WHERE a.id=NEW.owner_id AND a.kind='GUEST') THEN RETURN NEW; END IF;
 -- The rental period, exactly as the application judges it (HoldService / assertNotSalesStopped).
 first_day:=coalesce((NEW.conditions->'period'->>'startDate')::date,NEW.occupancy_start);
 last_day:=coalesce((NEW.conditions->'period'->>'endDate')::date,NEW.occupancy_end);
 IF EXISTS(SELECT 1 FROM store_sales_stops x WHERE x.store_id IN (NEW.pickup_store,NEW.return_store) AND x.day BETWEEN first_day AND last_day) THEN
  RAISE EXCEPTION 'STORE_SALES_STOPPED' USING ERRCODE='P0062';
 END IF;
 RETURN NEW;
END$$;
REVOKE ALL ON FUNCTION store_sales_stop_hold_guard() FROM PUBLIC;
CREATE TRIGGER store_sales_stop_hold_guard BEFORE INSERT OR UPDATE ON inventory_holds FOR EACH ROW EXECUTE FUNCTION store_sales_stop_hold_guard();
