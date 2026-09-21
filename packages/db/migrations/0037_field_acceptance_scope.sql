-- M2A correction R1, owned local databases only.
DO $$BEGIN IF current_database() !~ '^zr_[a-f0-9]{12}$' THEN RAISE EXCEPTION 'Dedicated development database required';END IF;END$$;

-- IR-01: the uniqueness key omitted the store, so a staff member scoped to one store could
-- reach an existing row recorded at another store and overwrite its result. The store is
-- part of the identity of a field acceptance record.
ALTER TABLE field_acceptance_records DROP CONSTRAINT field_acceptance_records_run_id_scenario_device_class_key;
ALTER TABLE field_acceptance_records ADD CONSTRAINT field_acceptance_records_run_scenario_device_store_key UNIQUE(run_id,scenario,device_class,store_id);

-- IR-02: a scenario and a device class were validated independently, so a physical-device
-- scenario could be recorded as PASS from a desktop. Bind them.
ALTER TABLE field_acceptance_records ADD CONSTRAINT field_acceptance_records_device_matrix CHECK(
 CASE scenario
  WHEN 'IPHONE_QR_SCAN' THEN device_class='IOS'
  WHEN 'ANDROID_QR_SCAN' THEN device_class='ANDROID'
  WHEN 'DUPLICATE_SCAN' THEN device_class IN ('IOS','ANDROID')
  WHEN 'CAMERA_PERMISSION_DENIED' THEN device_class IN ('IOS','ANDROID')
  WHEN 'OFFLINE' THEN device_class IN ('IOS','ANDROID')
  WHEN 'RECONNECT' THEN device_class IN ('IOS','ANDROID')
  WHEN 'MANUAL_ASSET_ID_FALLBACK' THEN device_class IN ('IOS','ANDROID','DESKTOP')
  WHEN 'LABEL_DAMAGED_MANUAL_FALLBACK' THEN device_class IN ('IOS','ANDROID','DESKTOP')
  ELSE device_class IN ('IOS','ANDROID','DESKTOP','NOT_APPLICABLE')
 END);

CREATE OR REPLACE FUNCTION field_acceptance_record(p_run uuid,p_scenario text,p_device text,p_store text,p_result text,p_note text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$DECLARE r field_acceptance_records;BEGIN
 PERFORM ops_assert_console_store(p_store,'OPERATIONS_VIEW');PERFORM ops_assert_console_store(p_store,'FIELD_ACCEPTANCE');
 IF p_run IS NULL OR p_result IS NULL OR p_result NOT IN ('PASS','FAIL','NOT_RUN') THEN RAISE EXCEPTION 'FIELD_RESULT_REQUIRED' USING ERRCODE='23514';END IF;
 -- Conflict resolution is scoped to this store, so a record from another store is never reached.
 INSERT INTO field_acceptance_records(run_id,scenario,device_class,store_id,result,safe_note,actor)
 VALUES(p_run,p_scenario,p_device,p_store,p_result,coalesce(p_note,'NONE'),current_setting('zao.actor'))
 ON CONFLICT(run_id,scenario,device_class,store_id) DO UPDATE SET result=excluded.result,safe_note=excluded.safe_note,actor=excluded.actor,recorded_at=inventory_clock()
 RETURNING * INTO r;
 INSERT INTO ops_history(resource,entity_id,actor,event,after_data) VALUES('field_acceptance_records',r.id,current_setting('zao.actor'),'FIELD_ACCEPTANCE_RECORDED',jsonb_build_object('runId',r.run_id,'scenario',r.scenario,'deviceClass',r.device_class,'store',r.store_id,'result',r.result,'safeNote',r.safe_note,'businessStateChanged',false));
 RETURN jsonb_build_object('id',r.id,'runId',r.run_id,'scenario',r.scenario,'deviceClass',r.device_class,'store',r.store_id,'result',r.result,'safeNote',r.safe_note,'businessStateChanged',false);
END$$;

-- IR-01: reading was global. Every read now names a store and is checked against the
-- maintained session, and only explicit ALL scope may read the SYSTEM aggregate.
DROP FUNCTION field_acceptance_status(uuid);
CREATE FUNCTION field_acceptance_status(p_run uuid,p_store text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$DECLARE result jsonb;BEGIN
 PERFORM ops_assert_console_store(p_store,'OPERATIONS_VIEW');
 SELECT jsonb_agg(x ORDER BY x.scenario) INTO result FROM (
  SELECT s.scenario,coalesce(r.result,'NOT_RUN') AS result,r.device_class AS "deviceClass",r.store_id AS store,r.safe_note AS "safeNote",r.recorded_at AS "recordedAt"
  FROM unnest(ARRAY['IPHONE_QR_SCAN','ANDROID_QR_SCAN','MANUAL_ASSET_ID_FALLBACK','DUPLICATE_SCAN','CAMERA_PERMISSION_DENIED','OFFLINE','RECONNECT','CHECKOUT','PARTIAL_RETURN','CROSS_STORE_RETURN','INSPECTION_REQUIRED','POLE_QUANTITY','WEAR_QUANTITY','LABEL_DAMAGED_MANUAL_FALLBACK']) s(scenario)
  LEFT JOIN LATERAL (
   SELECT * FROM field_acceptance_records f
   WHERE f.run_id=p_run AND f.scenario=s.scenario
    -- SYSTEM is the cross-store aggregate and needs explicit ALL scope, checked above.
    AND (p_store='SYSTEM' OR f.store_id=p_store)
   -- Across stores the worst result wins, so one store's failure is never hidden by
   -- another store's pass. Within a store the most recent record stands.
   ORDER BY CASE WHEN p_store='SYSTEM' THEN CASE f.result WHEN 'FAIL' THEN 0 WHEN 'NOT_RUN' THEN 1 ELSE 2 END ELSE 0 END,f.recorded_at DESC,f.id DESC LIMIT 1) r ON true
 ) x;RETURN coalesce(result,'[]'::jsonb);
END$$;
REVOKE ALL ON FUNCTION field_acceptance_status(uuid,text) FROM PUBLIC;

-- IR-05B: real inventory readiness must rest on an explicit acceptance receipt bound to a
-- committed import, not on how a source file happens to be named. No credential or personal
-- data is recorded: identifiers, digests and counts only.
CREATE TABLE real_data_acceptance(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 stage_id uuid NOT NULL REFERENCES ops_import_stages(id),
 commit_id uuid NOT NULL UNIQUE REFERENCES ops_import_commits(id),
 source_sha256 text NOT NULL CHECK(source_sha256 ~ '^[a-f0-9]{64}$'),
 accepted_rows integer NOT NULL CHECK(accepted_rows>0),
 accepted_assets integer NOT NULL CHECK(accepted_assets>=0),
 accepted_quantity integer NOT NULL CHECK(accepted_quantity>=0),
 stores text[] NOT NULL CHECK(array_length(stores,1)>0 AND stores<@ARRAY['MOUNTAIN_BASE','ONSEN_BASE']),
 source_class text NOT NULL CHECK(source_class='REAL'),
 synthetic boolean NOT NULL DEFAULT false CHECK(synthetic=false),
 actor text NOT NULL REFERENCES staff_members(id),
 accepted_at timestamptz NOT NULL DEFAULT inventory_clock()
);
REVOKE ALL ON real_data_acceptance FROM PUBLIC;

CREATE FUNCTION real_data_accept(p_commit uuid,p_source_sha256 text,p_stores text[]) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE c ops_import_commits;s ops_import_stages;rows_accepted integer;assets integer;quantity integer;r real_data_acceptance;BEGIN
 -- Declaring real stock is a cross-store statement, so it needs explicit ALL scope.
 -- Declaring real stock is an inventory act across both stores, so it needs INVENTORY_EDIT
 -- with explicit ALL scope. ops_assert_console_store enforces the scope for SYSTEM.
 PERFORM ops_assert_console_store('SYSTEM','INVENTORY_EDIT');
 SELECT * INTO c FROM ops_import_commits WHERE id=p_commit;IF NOT FOUND THEN RAISE EXCEPTION 'IMPORT_COMMIT_NOT_FOUND' USING ERRCODE='23514';END IF;
 SELECT * INTO s FROM ops_import_stages WHERE id=c.id;IF NOT FOUND THEN RAISE EXCEPTION 'IMPORT_STAGE_NOT_FOUND' USING ERRCODE='23514';END IF;
 IF p_source_sha256 IS DISTINCT FROM (s.stage->>'sourceSha256') THEN RAISE EXCEPTION 'SOURCE_DIGEST_MISMATCH' USING ERRCODE='23514';END IF;
 IF p_stores IS NULL OR NOT (p_stores<@ARRAY['MOUNTAIN_BASE','ONSEN_BASE']) OR array_length(p_stores,1) IS NULL THEN RAISE EXCEPTION 'STORE_COVERAGE_REQUIRED' USING ERRCODE='23514';END IF;
 -- Counts are recomputed from what the commit actually applied, never supplied by the caller.
 SELECT count(*)::int INTO rows_accepted FROM ops_import_sources WHERE stage_id=c.id;
 IF rows_accepted=0 THEN RAISE EXCEPTION 'IMPORT_COMMIT_EMPTY' USING ERRCODE='23514';END IF;
 SELECT coalesce((c.result->>'assetsAdded')::int,0) INTO assets;
 SELECT greatest(rows_accepted-assets,0) INTO quantity;
 INSERT INTO real_data_acceptance(stage_id,commit_id,source_sha256,accepted_rows,accepted_assets,accepted_quantity,stores,source_class,actor)
 VALUES(c.id,c.id,p_source_sha256,rows_accepted,assets,quantity,p_stores,'REAL',current_setting('zao.actor')) RETURNING * INTO r;
 INSERT INTO ops_history(resource,entity_id,actor,event,after_data) VALUES('real_data_acceptance',r.id,current_setting('zao.actor'),'REAL_DATA_ACCEPTED',jsonb_build_object('commitId',r.commit_id,'acceptedRows',r.accepted_rows,'acceptedAssets',r.accepted_assets,'stores',to_jsonb(r.stores),'sourceClass','REAL','synthetic',false));
 RETURN jsonb_build_object('id',r.id,'commitId',r.commit_id,'acceptedRows',r.accepted_rows,'acceptedAssets',r.accepted_assets,'acceptedQuantity',r.accepted_quantity,'stores',to_jsonb(r.stores),'sourceClass','REAL','synthetic',false);
END$$;
CREATE FUNCTION real_data_acceptance_status() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$DECLARE result jsonb;BEGIN
 PERFORM ops_assert_actor('OPERATIONS_VIEW',ARRAY[]::text[],current_setting('zao.actor',true));
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',a.id,'commitId',a.commit_id,'acceptedRows',a.accepted_rows,'acceptedAssets',a.accepted_assets,'acceptedQuantity',a.accepted_quantity,'stores',to_jsonb(a.stores),'acceptedAt',a.accepted_at,'commitPresent',c.id IS NOT NULL) ORDER BY a.accepted_at DESC),'[]'::jsonb)
 INTO result FROM real_data_acceptance a LEFT JOIN ops_import_commits c ON c.id=a.commit_id;RETURN result;
END$$;
REVOKE ALL ON FUNCTION real_data_accept(uuid,text,text[]),real_data_acceptance_status() FROM PUBLIC;
