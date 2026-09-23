-- Explicit commercial/development state pairing at physical operations and completion.
CREATE OR REPLACE FUNCTION rental_validate_loan() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$DECLARE b rental_bookings;h inventory_holds;m jsonb;it jsonb;v record;now_at timestamptz;exchange boolean;start_on date;BEGIN
 PERFORM pg_advisory_xact_lock(71820600);
 PERFORM rental_internal.assert_actor('RENTAL_CHECKOUT',NEW.pickup_store,NEW.checked_out_by);
 SELECT * INTO STRICT b FROM rental_bookings WHERE id=NEW.booking_id;SELECT * INTO STRICT h FROM inventory_holds WHERE id=b.hold_id;
 now_at:=inventory_clock();exchange:=NEW.amendment_id IS NOT NULL;start_on:=CASE WHEN exchange THEN greatest(h.occupancy_start,(now_at AT TIME ZONE 'Asia/Tokyo')::date) ELSE h.occupancy_start END;
 IF exchange AND NOT EXISTS(SELECT 1 FROM rental_internal.amendment_effects e WHERE e.tx=txid_current() AND e.pid=pg_backend_pid() AND e.amendment_id=NEW.amendment_id AND e.new_loan_id=NEW.id) THEN RAISE EXCEPTION 'AMENDMENT_CHECKOUT_EFFECT_REQUIRED' USING ERRCODE='23514';END IF;
 IF NOT booking_is_confirmed(b.mode,b.state) OR h.payment_state<>'SUCCESS' OR h.confirmed_at IS NULL OR h.state<>'ACTIVE' OR h.allocation_stage<>(CASE WHEN exchange THEN 'RENTAL_FIXED' ELSE 'PREPARATION_FIXED' END) OR h.transfer_attention IS NOT NULL OR NEW.cycle_id<>b.id OR NEW.pickup_store<>h.pickup_store OR NEW.due_at<>h.due_at OR NEW.checked_out_at>now_at OR NEW.state<>'OUT' OR NEW.version<>1 OR ((now_at AT TIME ZONE 'Asia/Tokyo')::date<>h.occupancy_start AND (h.conditions->'period'->>'slot'<>'MULTIDAY' OR (now_at AT TIME ZONE 'Asia/Tokyo')::date<h.occupancy_start OR (now_at AT TIME ZONE 'Asia/Tokyo')::date>h.occupancy_end)) OR (now_at AT TIME ZONE 'Asia/Tokyo')::time<time '08:30' OR now_at<h.starts_at OR now_at>=h.due_at OR (now_at AT TIME ZONE 'Asia/Tokyo')::time>=time '17:00' THEN RAISE EXCEPTION 'CUSTODY_CHECKOUT_INVALID' USING ERRCODE='23514';END IF;
 SELECT member,item INTO m,it FROM jsonb_array_elements(h.conditions->'members') member CROSS JOIN LATERAL jsonb_array_elements(member->'items') item WHERE (member->>'key')||':'||(item->>'family')=NEW.requirement_key;
 SELECT v1.*,m1.catalog_season INTO v FROM ledger_variants v1 JOIN ledger_models m1 ON m1.id=v1.model_id WHERE v1.id=NEW.variant_id;
 IF m IS NULL OR it IS NULL OR NOT(it->'variantIds' ? NEW.variant_id::text) OR it->>'family'<>NEW.family OR m->>'age'<>v.age OR m->>'tier'<>v.tier OR (it ? 'modelPromise' AND ((it->'modelPromise'->>'modelId') IS DISTINCT FROM v.model_id::text OR (it->'modelPromise'->>'variantId') IS DISTINCT FROM v.id::text OR (it->'modelPromise'->>'season') IS DISTINCT FROM v.catalog_season)) THEN RAISE EXCEPTION 'CUSTODY_PROMISE_MISMATCH' USING ERRCODE='23514';END IF;
 IF NOT exchange AND NOT EXISTS(SELECT 1 FROM rental_preparations p CROSS JOIN LATERAL jsonb_array_elements(p.fit_evidence->'selections') s WHERE p.id=b.id AND p.store_id=NEW.pickup_store AND p.prepared_at IS NOT NULL AND s->>'requirementKey'=NEW.requirement_key AND (s->>'assetId')::uuid IS NOT DISTINCT FROM NEW.asset_id AND (s->>'poleId')::uuid IS NOT DISTINCT FROM NEW.pole_id) AND NOT EXISTS(SELECT 1 FROM ops_amendments oa JOIN ops_amendment_quotes oq ON oq.id=oa.id CROSS JOIN LATERAL jsonb_array_elements(oq.assignment->'equipment') sel WHERE oa.booking_id=b.id AND oq.expected_hold_version+1=h.version AND length(btrim(oa.fit_evidence))>0 AND sel->>'key'=NEW.requirement_key AND (sel->>'asset')::uuid IS NOT DISTINCT FROM NEW.asset_id AND (sel->>'pole')::uuid IS NOT DISTINCT FROM NEW.pole_id) THEN RAISE EXCEPTION 'CUSTODY_PREPARATION_REQUIRED' USING ERRCODE='23514';END IF;
 IF (SELECT count(*) FROM inventory_claims WHERE hold_id=h.id AND requirement_key=NEW.requirement_key AND active AND day>=start_on AND asset_id IS NOT DISTINCT FROM NEW.asset_id AND pole_id IS NOT DISTINCT FROM NEW.pole_id)<>h.occupancy_end-start_on+1 THEN RAISE EXCEPTION 'CUSTODY_FULL_PERIOD_WITNESS_REQUIRED' USING ERRCODE='23514';END IF;
 IF NEW.asset_id IS NOT NULL THEN
  IF NOT EXISTS(SELECT 1 FROM ledger_assets WHERE id=NEW.asset_id AND variant_id=NEW.variant_id AND family=NEW.family AND status='AVAILABLE' AND store_id=NEW.pickup_store AND unit=NEW.unit) THEN RAISE EXCEPTION 'CUSTODY_ASSET_NOT_READY' USING ERRCODE='23514';END IF;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM ledger_poles WHERE id=NEW.pole_id AND variant_id=NEW.variant_id AND store_id=NEW.pickup_store AND status='AVAILABLE' AND quantity>0 AND NEW.unit='PAIR') THEN RAISE EXCEPTION 'CUSTODY_POOL_NOT_READY' USING ERRCODE='23514';END IF;
  IF (SELECT count(*) FROM rental_loan_items WHERE pole_id=NEW.pole_id AND state='OUT')+(SELECT count(*) FROM rental_inventory_blocks WHERE pole_id=NEW.pole_id AND reason='CONTRACT_DATE_BLOCK' AND starts_on<=(now_at AT TIME ZONE 'Asia/Tokyo')::date AND ends_on>=(now_at AT TIME ZONE 'Asia/Tokyo')::date)>=(SELECT quantity FROM ledger_poles WHERE id=NEW.pole_id) THEN RAISE EXCEPTION 'CUSTODY_PAIR_NOT_READY' USING ERRCODE='23514';END IF;
 END IF;
 IF EXISTS(SELECT 1 FROM rental_inventory_blocks WHERE asset_id=NEW.asset_id AND starts_on<=h.occupancy_end AND ends_on>=start_on) OR EXISTS(SELECT 1 FROM transfer_pieces p JOIN transfer_batches t ON t.id=p.batch_id WHERE p.asset_id=NEW.asset_id AND p.state NOT IN ('READY','CLOSED','CANCELLED') AND NOT(p.state='PLANNED' AND t.source_store=NEW.pickup_store AND t.scheduled_date>=h.occupancy_end AND t.issue IS NULL)) OR EXISTS(SELECT 1 FROM inventory_constraints WHERE (asset_id=NEW.asset_id OR pole_id=NEW.pole_id) AND starts_on<=h.occupancy_end AND ends_on>=start_on) THEN RAISE EXCEPTION 'CUSTODY_STOCK_BLOCKED' USING ERRCODE='23514';END IF;
 NEW.checked_out_at:=now_at;RETURN NEW;
END$$;

CREATE OR REPLACE FUNCTION rental_stage_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$DECLARE b rental_bookings;BEGIN
 IF session_user<>current_database()||'_custody' OR NEW.allocation_stage=OLD.allocation_stage THEN RETURN NEW;END IF;
 PERFORM rental_internal.assert_actor('RENTAL_CHECKOUT',OLD.pickup_store,current_setting('zao.actor',true));
 SELECT * INTO b FROM rental_bookings WHERE hold_id=OLD.id;
 IF NOT FOUND OR NOT booking_is_confirmed(b.mode,b.state) OR OLD.payment_state<>'SUCCESS' OR OLD.transfer_attention IS NOT NULL THEN RAISE EXCEPTION 'CUSTODY_STAGE_INVALID' USING ERRCODE='23514';END IF;
 IF OLD.allocation_stage='PROVISIONAL' AND NEW.allocation_stage='PREPARATION_FIXED' AND EXISTS(SELECT 1 FROM rental_preparations WHERE id=b.id AND prepared_at IS NOT NULL) THEN RETURN NEW;END IF;
 IF OLD.allocation_stage='PREPARATION_FIXED' AND NEW.allocation_stage='RENTAL_FIXED' AND (SELECT count(*) FROM rental_loan_items WHERE booking_id=b.id AND state='OUT')=(SELECT count(*) FROM jsonb_array_elements(b.conditions->'members') m CROSS JOIN LATERAL jsonb_array_elements(m->'items') i WHERE i->>'family' NOT IN ('WEAR_JACKET','WEAR_PANTS')) THEN RETURN NEW;END IF;
 RAISE EXCEPTION 'CUSTODY_STAGE_INVALID' USING ERRCODE='23514';
END$$;

CREATE OR REPLACE FUNCTION rental_complete_no_pickup(booking_uuid uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE b rental_bookings;h inventory_holds;now_at timestamptz;actor text:=current_setting('zao.actor',true);
BEGIN
 PERFORM pg_advisory_xact_lock(71820600);
 SELECT * INTO b FROM rental_bookings WHERE id=booking_uuid;
 IF NOT FOUND THEN RAISE EXCEPTION 'NO_PICKUP_NOT_FOUND' USING ERRCODE='23514';END IF;
 PERFORM rental_internal.assert_actor('RENTAL_CHECKOUT',b.conditions->>'pickupStore',actor);
 IF EXISTS(SELECT 1 FROM rental_no_pickup_events WHERE booking_id=b.id) THEN RETURN;END IF;
 SELECT * INTO STRICT h FROM inventory_holds WHERE id=b.hold_id;
 now_at:=inventory_clock();
 IF NOT booking_is_confirmed(b.mode,b.state) OR b.confirmed_at IS NULL OR h.state<>'ACTIVE' OR h.payment_state<>'SUCCESS' OR h.confirmed_at IS NULL OR h.due_at>now_at OR EXISTS(SELECT 1 FROM rental_loan_items WHERE booking_id=b.id) OR EXISTS(SELECT 1 FROM wear_loans WHERE booking_id=b.id) THEN RAISE EXCEPTION 'NO_PICKUP_NOT_ELIGIBLE' USING ERRCODE='23514';END IF;
 -- Only this completed contract; fixed-stage history and dispatched movements are untouched.
 UPDATE inventory_claims SET active=false WHERE hold_id=h.id AND active;
 UPDATE wear_claims SET active=false WHERE hold_id=h.id AND active;
 UPDATE provisional_capacity_claims SET state='RELEASED',released_at=now_at WHERE hold_id=h.id AND state='ACTIVE';
 UPDATE inventory_holds SET state='RELEASED',version=version+1 WHERE id=h.id;
 UPDATE rental_bookings SET state=CASE WHEN b.mode='SQUARE_PRODUCTION' THEN 'COMPLETED' ELSE 'COMPLETED_DEV' END,version=version+1 WHERE id=b.id;
 INSERT INTO rental_no_pickup_events VALUES(b.id,actor,h.due_at,now_at,'NO_PICKUP_COMPLETED');
END$$;

DO $$BEGIN EXECUTE format('GRANT SELECT,UPDATE(state,released_at) ON provisional_capacity_claims TO %I',current_database()||'_custody_executor');END$$;
