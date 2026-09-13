-- Only the owner-approved handover time predicate changes. NO new function,
-- role, ACL, owner or privilege; CREATE OR REPLACE preserves existing owner/ACL.
-- Historical migration0015 remains immutable. No no-pickup release implementation here.
DO $$BEGIN
 IF current_database() !~ '^zr_[a-f0-9]{12}$' THEN RAISE EXCEPTION 'Dedicated development database required';END IF;
 IF (SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid='public.rental_validate_loan()'::regprocedure)<>current_database()||'_custody_executor' THEN RAISE EXCEPTION 'Unexpected custody function owner';END IF;
END$$;
CREATE OR REPLACE FUNCTION rental_validate_loan() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$DECLARE b rental_bookings;h inventory_holds;m jsonb;it jsonb;v record;now_at timestamptz;BEGIN
 PERFORM pg_advisory_xact_lock(71820600);
 PERFORM rental_internal.assert_actor('RENTAL_CHECKOUT',NEW.pickup_store,NEW.checked_out_by);
 SELECT * INTO STRICT b FROM rental_bookings WHERE id=NEW.booking_id;SELECT * INTO STRICT h FROM inventory_holds WHERE id=b.hold_id;
 now_at:=inventory_clock();
 IF b.state<>'CONFIRMED_DEV' OR h.payment_state<>'SUCCESS' OR h.confirmed_at IS NULL OR h.state<>'ACTIVE' OR h.allocation_stage<>'PREPARATION_FIXED' OR h.transfer_attention IS NOT NULL OR NEW.cycle_id<>b.id OR NEW.pickup_store<>h.pickup_store OR NEW.due_at<>h.due_at OR NEW.checked_out_at>now_at OR NEW.state<>'OUT' OR NEW.version<>1 OR ((now_at AT TIME ZONE 'Asia/Tokyo')::date<>h.occupancy_start AND (h.conditions->'period'->>'slot'<>'MULTIDAY' OR (now_at AT TIME ZONE 'Asia/Tokyo')::date<h.occupancy_start OR (now_at AT TIME ZONE 'Asia/Tokyo')::date>h.occupancy_end)) OR (now_at AT TIME ZONE 'Asia/Tokyo')::time<time '08:30' OR now_at<h.starts_at OR now_at>=h.due_at OR (now_at AT TIME ZONE 'Asia/Tokyo')::time>=time '17:00' THEN RAISE EXCEPTION 'CUSTODY_CHECKOUT_INVALID' USING ERRCODE='23514';END IF;
 SELECT member,item INTO m,it FROM jsonb_array_elements(b.conditions->'members') member CROSS JOIN LATERAL jsonb_array_elements(member->'items') item WHERE (member->>'key')||':'||(item->>'family')=NEW.requirement_key;
 SELECT v1.*,m1.catalog_season INTO v FROM ledger_variants v1 JOIN ledger_models m1 ON m1.id=v1.model_id WHERE v1.id=NEW.variant_id;
 IF m IS NULL OR it IS NULL OR NOT(it->'variantIds' ? NEW.variant_id::text) OR it->>'family'<>NEW.family OR m->>'age'<>v.age OR m->>'tier'<>v.tier OR (it ? 'modelPromise' AND ((it->'modelPromise'->>'modelId') IS DISTINCT FROM v.model_id::text OR (it->'modelPromise'->>'variantId') IS DISTINCT FROM v.id::text OR (it->'modelPromise'->>'season') IS DISTINCT FROM v.catalog_season)) THEN RAISE EXCEPTION 'CUSTODY_PROMISE_MISMATCH' USING ERRCODE='23514';END IF;
 IF NOT EXISTS(SELECT 1 FROM rental_preparations p CROSS JOIN LATERAL jsonb_array_elements(p.fit_evidence->'selections') s WHERE p.id=b.id AND p.store_id=NEW.pickup_store AND p.prepared_at IS NOT NULL AND s->>'requirementKey'=NEW.requirement_key AND (s->>'assetId')::uuid IS NOT DISTINCT FROM NEW.asset_id AND (s->>'poleId')::uuid IS NOT DISTINCT FROM NEW.pole_id) THEN RAISE EXCEPTION 'CUSTODY_PREPARATION_REQUIRED' USING ERRCODE='23514';END IF;
 IF (SELECT count(*) FROM inventory_claims WHERE hold_id=h.id AND requirement_key=NEW.requirement_key AND active AND asset_id IS NOT DISTINCT FROM NEW.asset_id AND pole_id IS NOT DISTINCT FROM NEW.pole_id)<>h.occupancy_end-h.occupancy_start+1 THEN RAISE EXCEPTION 'CUSTODY_FULL_PERIOD_WITNESS_REQUIRED' USING ERRCODE='23514';END IF;
 IF NEW.asset_id IS NOT NULL THEN
  IF NOT EXISTS(SELECT 1 FROM ledger_assets WHERE id=NEW.asset_id AND variant_id=NEW.variant_id AND family=NEW.family AND status='AVAILABLE' AND store_id=NEW.pickup_store AND unit=NEW.unit) THEN RAISE EXCEPTION 'CUSTODY_ASSET_NOT_READY' USING ERRCODE='23514';END IF;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM ledger_poles WHERE id=NEW.pole_id AND variant_id=NEW.variant_id AND store_id=NEW.pickup_store AND status='AVAILABLE' AND quantity>0 AND NEW.unit='PAIR') THEN RAISE EXCEPTION 'CUSTODY_POOL_NOT_READY' USING ERRCODE='23514';END IF;
  IF (SELECT count(*) FROM rental_loan_items WHERE pole_id=NEW.pole_id AND state='OUT')+(SELECT count(*) FROM rental_inventory_blocks WHERE pole_id=NEW.pole_id AND reason='CONTRACT_DATE_BLOCK' AND starts_on<=(now_at AT TIME ZONE 'Asia/Tokyo')::date AND ends_on>=(now_at AT TIME ZONE 'Asia/Tokyo')::date)>=(SELECT quantity FROM ledger_poles WHERE id=NEW.pole_id) THEN RAISE EXCEPTION 'CUSTODY_PAIR_NOT_READY' USING ERRCODE='23514';END IF;
 END IF;
 IF EXISTS(SELECT 1 FROM rental_inventory_blocks WHERE asset_id=NEW.asset_id AND starts_on<=h.occupancy_end AND ends_on>=h.occupancy_start) OR EXISTS(SELECT 1 FROM transfer_pieces p JOIN transfer_batches t ON t.id=p.batch_id WHERE p.asset_id=NEW.asset_id AND p.state NOT IN ('READY','CLOSED','CANCELLED') AND NOT(p.state='PLANNED' AND t.source_store=NEW.pickup_store AND t.scheduled_date>=h.occupancy_end AND t.issue IS NULL)) OR EXISTS(SELECT 1 FROM inventory_constraints WHERE (asset_id=NEW.asset_id OR pole_id=NEW.pole_id) AND starts_on<=h.occupancy_end AND ends_on>=h.occupancy_start) THEN RAISE EXCEPTION 'CUSTODY_STOCK_BLOCKED' USING ERRCODE='23514';END IF;
 NEW.checked_out_at:=now_at;RETURN NEW;
END$$;
