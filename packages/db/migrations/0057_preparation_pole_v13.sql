-- R65 V1.3 pole witness. Owner-applicable on the reviewed Production topology: it touches only owner-owned objects and
-- leaves the custody-executor-owned rental_stage_guard() (0015/0049) and every custody privilege unchanged.
-- V1.3 needs a durable absence witness even when no POLE catalogue variant exists.
-- Historical conditions/claims are not rewritten. Existing nonempty witnesses are unchanged.
ALTER TABLE inventory_pole_exemptions DROP CONSTRAINT inventory_pole_exemptions_variant_ids_check;
ALTER TABLE inventory_pole_exemptions ADD CONSTRAINT inventory_pole_exemptions_variant_ids_check CHECK(cardinality(variant_ids)>=0);
CREATE OR REPLACE FUNCTION inventory_sync_pole_exemptions(p_hold uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE h inventory_holds; m jsonb; i jsonb; variants uuid[]; k text;
BEGIN
 PERFORM pg_advisory_xact_lock(71820600);
 SELECT * INTO STRICT h FROM inventory_holds WHERE id=p_hold FOR UPDATE;
 UPDATE inventory_pole_exemptions SET active=false WHERE hold_id=p_hold AND active;
 IF h.state<>'ACTIVE' THEN RETURN;END IF;
 FOR m IN SELECT value FROM jsonb_array_elements(h.conditions->'members') WHERE value->>'product'='SKI_SET' LOOP
  FOR i IN SELECT value FROM jsonb_array_elements(m->'items') WHERE value->>'family'='POLE' LOOP
   SELECT coalesce(array_agg(value::uuid),'{}'::uuid[]) INTO variants FROM jsonb_array_elements_text(i->'variantIds');
   IF cardinality(variants)=0 AND (h.conditions->>'contractVersion' IS DISTINCT FROM 'INTEGRATED_V1_3' OR EXISTS(SELECT 1 FROM ledger_variants v WHERE v.family='POLE' AND v.age=m->>'age' AND v.tier=m->>'tier' AND btrim(v.size) ~* '^[0-9]{1,3}(\.[0-9])?[[:space:]]*cm$')) THEN
    RAISE EXCEPTION 'POLE_CATALOG_SELECTION_REQUIRED' USING ERRCODE='23514';
   END IF;
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
