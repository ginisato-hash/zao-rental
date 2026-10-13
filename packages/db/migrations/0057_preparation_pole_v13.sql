-- Local/test R65 migration. No production apply authorized.
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
 FOR m IN SELECT value FROM jsonb_array_elements(h.conditions->'members') LOOP
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

-- An untracked V1.3 pole has a full-period absence witness and physical preparation
-- evidence, but no serialized loan row. Every other item still requires a loan.
DO $$BEGIN EXECUTE format('GRANT SELECT ON inventory_pole_exemptions TO %I',current_database()||'_custody_executor');END$$;
CREATE OR REPLACE FUNCTION rental_stage_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$DECLARE b rental_bookings;BEGIN
 IF session_user<>current_database()||'_custody' OR NEW.allocation_stage=OLD.allocation_stage THEN RETURN NEW;END IF;
 PERFORM rental_internal.assert_actor('RENTAL_CHECKOUT',OLD.pickup_store,current_setting('zao.actor',true));
 SELECT * INTO b FROM rental_bookings WHERE hold_id=OLD.id;
 IF NOT FOUND OR NOT booking_is_confirmed(b.mode,b.state) OR OLD.payment_state<>'SUCCESS' OR OLD.transfer_attention IS NOT NULL THEN RAISE EXCEPTION 'CUSTODY_STAGE_INVALID' USING ERRCODE='23514';END IF;
 IF OLD.allocation_stage='PROVISIONAL' AND NEW.allocation_stage='PREPARATION_FIXED' AND EXISTS(SELECT 1 FROM rental_preparations WHERE id=b.id AND prepared_at IS NOT NULL) THEN RETURN NEW;END IF;
 IF OLD.allocation_stage='PREPARATION_FIXED' AND NEW.allocation_stage='RENTAL_FIXED' AND (SELECT count(*) FROM rental_loan_items WHERE booking_id=b.id AND state='OUT')=(SELECT count(*) FROM jsonb_array_elements(b.conditions->'members') m CROSS JOIN LATERAL jsonb_array_elements(m->'items') i WHERE i->>'family' NOT IN ('WEAR_JACKET','WEAR_PANTS') AND NOT (b.conditions->>'contractVersion' IS NOT DISTINCT FROM 'INTEGRATED_V1_3' AND i->>'family'='POLE' AND (SELECT count(*) FROM inventory_pole_exemptions e WHERE e.hold_id=OLD.id AND e.requirement_key=(m->>'key')||':POLE' AND e.active AND e.day BETWEEN OLD.occupancy_start AND OLD.occupancy_end)=OLD.occupancy_end-OLD.occupancy_start+1)) THEN RETURN NEW;END IF;
 RAISE EXCEPTION 'CUSTODY_STAGE_INVALID' USING ERRCODE='23514';
END$$;
