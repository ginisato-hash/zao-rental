-- A missing POLE claim is never evidence. Only this durable, validated witness can exempt it.
CREATE TABLE inventory_pole_exemptions(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 hold_id uuid NOT NULL REFERENCES inventory_holds(id),
 requirement_key text NOT NULL,
 day date NOT NULL,
 store_id text NOT NULL REFERENCES ledger_stores(id),
 variant_ids uuid[] NOT NULL CHECK(cardinality(variant_ids)>0),
 reason text NOT NULL DEFAULT 'NO_REGISTERED_RELEVANT_POLE_CAPACITY' CHECK(reason='NO_REGISTERED_RELEVANT_POLE_CAPACITY'),
 active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX inventory_pole_exemptions_active ON inventory_pole_exemptions(hold_id,requirement_key,day) WHERE active;
CREATE FUNCTION inventory_pole_exemption_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR NOT OLD.active OR NEW.active OR (to_jsonb(NEW)-'active')<>(to_jsonb(OLD)-'active') THEN RAISE EXCEPTION 'IMMUTABLE_POLE_EXEMPTION';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER inventory_pole_exemption_guard BEFORE UPDATE OR DELETE ON inventory_pole_exemptions FOR EACH ROW EXECUTE FUNCTION inventory_pole_exemption_guard();
CREATE FUNCTION inventory_sync_pole_exemptions(p_hold uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE h inventory_holds; m jsonb; i jsonb; variants uuid[]; k text;
BEGIN
 PERFORM pg_advisory_xact_lock(71820600);
 SELECT * INTO STRICT h FROM inventory_holds WHERE id=p_hold FOR UPDATE;
 UPDATE inventory_pole_exemptions SET active=false WHERE hold_id=p_hold AND active;
 IF h.state<>'ACTIVE' THEN RETURN;END IF;
 FOR m IN SELECT value FROM jsonb_array_elements(h.conditions->'members') LOOP
  FOR i IN SELECT value FROM jsonb_array_elements(m->'items') WHERE value->>'family'='POLE' LOOP
   SELECT array_agg(value::uuid) INTO variants FROM jsonb_array_elements_text(i->'variantIds');
   k:=(m->>'key')||':POLE';
   -- Unavailable/empty registered pools still establish tracked capacity; a sold-out pool
   -- must never become an exemption. Incoming transfers likewise establish relevant stock.
   IF NOT EXISTS(SELECT 1 FROM ledger_poles p WHERE p.variant_id=ANY(variants) AND
     (p.store_id=h.pickup_store OR EXISTS(SELECT 1 FROM transfer_pieces t JOIN transfer_batches b ON b.id=t.batch_id
      WHERE t.source_pole_id=p.id AND b.destination_store=h.pickup_store AND t.state NOT IN ('CANCELLED','CLOSED')))) THEN
    INSERT INTO inventory_pole_exemptions(hold_id,requirement_key,day,store_id,variant_ids)
    SELECT h.id,k,d::date,h.pickup_store,variants FROM generate_series(h.occupancy_start,h.occupancy_end,interval '1 day') d
    WHERE NOT EXISTS(SELECT 1 FROM inventory_claims c WHERE c.hold_id=h.id AND c.requirement_key=k AND c.day=d::date AND c.active);
   END IF;
  END LOOP;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION inventory_sync_pole_exemptions(uuid) FROM PUBLIC;
CREATE FUNCTION inventory_release_pole_exemptions() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF NEW.state<>'ACTIVE' THEN UPDATE inventory_pole_exemptions SET active=false WHERE hold_id=NEW.id AND active;END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER inventory_release_pole_exemptions AFTER UPDATE OF state ON inventory_holds FOR EACH ROW EXECUTE FUNCTION inventory_release_pole_exemptions();
-- Upgrade only records exemptions whose conditions are independently provable now.
SELECT inventory_sync_pole_exemptions(id) FROM inventory_holds WHERE state='ACTIVE';
