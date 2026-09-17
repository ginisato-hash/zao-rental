-- M2A field acceptance records, owned local databases only.
DO $$BEGIN IF current_database() !~ '^zr_[a-f0-9]{12}$' THEN RAISE EXCEPTION 'Dedicated development database required';END IF;END$$;
ALTER TABLE staff_role_permissions DROP CONSTRAINT staff_role_permissions_permission_check;
ALTER TABLE staff_permission_overrides DROP CONSTRAINT staff_permission_overrides_permission_check;
ALTER TABLE staff_role_permissions ADD CHECK(permission IN ('INVENTORY_VIEW','INVENTORY_EDIT','STAFF_MANAGE','HOLD_VIEW','HOLD_EDIT','TRANSFER_VIEW','TRANSFER_PLAN','TRANSFER_DISPATCH','TRANSFER_RECEIVE','QUOTE_VIEW','QUOTE_CREATE','PRICE_EDIT','BOOKING_VIEW','BOOKING_CREATE','RENTAL_CHECKOUT','RENTAL_RETURN','RENTAL_AMEND','REFUND_OVERRIDE','INVENTORY_RECONCILE','NOTIFICATION_RESEND','OPERATIONS_VIEW','OPERATIONS_ACKNOWLEDGE','FIELD_ACCEPTANCE'));
ALTER TABLE staff_permission_overrides ADD CHECK(permission IN ('INVENTORY_VIEW','INVENTORY_EDIT','STAFF_MANAGE','HOLD_VIEW','HOLD_EDIT','TRANSFER_VIEW','TRANSFER_PLAN','TRANSFER_DISPATCH','TRANSFER_RECEIVE','QUOTE_VIEW','QUOTE_CREATE','PRICE_EDIT','BOOKING_VIEW','BOOKING_CREATE','RENTAL_CHECKOUT','RENTAL_RETURN','RENTAL_AMEND','REFUND_OVERRIDE','INVENTORY_RECONCILE','NOTIFICATION_RESEND','OPERATIONS_VIEW','OPERATIONS_ACKNOWLEDGE','FIELD_ACCEPTANCE'));

-- A field acceptance record says only what staff observed while exercising the ordinary
-- screens. It grants nothing, changes no business state, and its note is a fixed enum so
-- no customer name, contact, booking detail or free text can ever be stored here.
CREATE TABLE field_acceptance_records(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 run_id uuid NOT NULL,
 scenario text NOT NULL CHECK(scenario IN ('IPHONE_QR_SCAN','ANDROID_QR_SCAN','MANUAL_ASSET_ID_FALLBACK','DUPLICATE_SCAN','CAMERA_PERMISSION_DENIED','OFFLINE','RECONNECT','CHECKOUT','PARTIAL_RETURN','CROSS_STORE_RETURN','INSPECTION_REQUIRED','POLE_QUANTITY','WEAR_QUANTITY','LABEL_DAMAGED_MANUAL_FALLBACK')),
 device_class text NOT NULL CHECK(device_class IN ('IOS','ANDROID','DESKTOP','NOT_APPLICABLE')),
 store_id text NOT NULL CHECK(store_id IN ('MOUNTAIN_BASE','ONSEN_BASE','SYSTEM')),
 result text NOT NULL CHECK(result IN ('PASS','FAIL','NOT_RUN')),
 safe_note text NOT NULL DEFAULT 'NONE' CHECK(safe_note IN ('NONE','CAMERA_PERMISSION_DENIED','OFFLINE_QUEUED','RECONNECTED','SCAN_TIMEOUT','LABEL_UNREADABLE','MANUAL_FALLBACK_USED','DUPLICATE_SCAN_IGNORED','DEVICE_UNAVAILABLE','BLOCKED_BY_PERMISSION','SEE_OPERATIONS_EXCEPTION')),
 actor text NOT NULL REFERENCES staff_members(id),
 recorded_at timestamptz NOT NULL DEFAULT inventory_clock(),
 UNIQUE(run_id,scenario,device_class)
);
CREATE INDEX field_acceptance_run ON field_acceptance_records(run_id,scenario);
REVOKE ALL ON field_acceptance_records FROM PUBLIC;

CREATE FUNCTION field_acceptance_record(p_run uuid,p_scenario text,p_device text,p_store text,p_result text,p_note text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$DECLARE r field_acceptance_records;BEGIN
 PERFORM ops_assert_console_store(p_store,'OPERATIONS_VIEW');PERFORM ops_assert_console_store(p_store,'FIELD_ACCEPTANCE');
 IF p_run IS NULL OR p_result IS NULL OR p_result NOT IN ('PASS','FAIL','NOT_RUN') THEN RAISE EXCEPTION 'FIELD_RESULT_REQUIRED' USING ERRCODE='23514';END IF;
 INSERT INTO field_acceptance_records(run_id,scenario,device_class,store_id,result,safe_note,actor)
 VALUES(p_run,p_scenario,p_device,p_store,p_result,coalesce(p_note,'NONE'),current_setting('zao.actor'))
 ON CONFLICT(run_id,scenario,device_class) DO UPDATE SET result=excluded.result,safe_note=excluded.safe_note,actor=excluded.actor,recorded_at=inventory_clock()
 RETURNING * INTO r;
 INSERT INTO ops_history(resource,entity_id,actor,event,after_data) VALUES('field_acceptance_records',r.id,current_setting('zao.actor'),'FIELD_ACCEPTANCE_RECORDED',jsonb_build_object('runId',r.run_id,'scenario',r.scenario,'deviceClass',r.device_class,'store',r.store_id,'result',r.result,'safeNote',r.safe_note,'businessStateChanged',false));
 RETURN jsonb_build_object('id',r.id,'runId',r.run_id,'scenario',r.scenario,'deviceClass',r.device_class,'store',r.store_id,'result',r.result,'safeNote',r.safe_note,'businessStateChanged',false);
END$$;
-- Every scenario is reported, so an unexercised one reads NOT_RUN instead of disappearing.
CREATE FUNCTION field_acceptance_status(p_run uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$DECLARE result jsonb;BEGIN
 PERFORM ops_assert_actor('OPERATIONS_VIEW',ARRAY[]::text[],current_setting('zao.actor',true));
 SELECT jsonb_agg(x ORDER BY x.scenario) INTO result FROM (
  SELECT s.scenario,coalesce(r.result,'NOT_RUN') AS result,r.device_class AS "deviceClass",r.store_id AS store,r.safe_note AS "safeNote",r.recorded_at AS "recordedAt"
  FROM unnest(ARRAY['IPHONE_QR_SCAN','ANDROID_QR_SCAN','MANUAL_ASSET_ID_FALLBACK','DUPLICATE_SCAN','CAMERA_PERMISSION_DENIED','OFFLINE','RECONNECT','CHECKOUT','PARTIAL_RETURN','CROSS_STORE_RETURN','INSPECTION_REQUIRED','POLE_QUANTITY','WEAR_QUANTITY','LABEL_DAMAGED_MANUAL_FALLBACK']) s(scenario)
  LEFT JOIN LATERAL (SELECT * FROM field_acceptance_records f WHERE f.run_id=p_run AND f.scenario=s.scenario ORDER BY f.recorded_at DESC,f.id DESC LIMIT 1) r ON true
 ) x;RETURN coalesce(result,'[]'::jsonb);
END$$;
REVOKE ALL ON FUNCTION field_acceptance_record(uuid,text,text,text,text,text),field_acceptance_status(uuid) FROM PUBLIC;
