-- M2B: correct the accepted physical quantity on a real-data receipt. Function only; no
-- schema change and no historical migration is touched.
DO $$BEGIN IF current_database() !~ '^zr_[a-f0-9]{12}$' THEN RAISE EXCEPTION 'Dedicated development database required';END IF;END$$;

-- accepted_quantity previously approximated the number of quantity-backed rows. It now sums
-- the physical quantity those rows actually carried, so a receipt reports how many poles and
-- wear pieces were accepted rather than how many lines mentioned them. Asset-backed rows stay
-- counted in accepted_assets.
CREATE OR REPLACE FUNCTION real_data_accept(p_commit uuid,p_expected_stores text[]) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE c ops_import_commits;s ops_import_stages;digest text;derived text[];rows_accepted integer;assets integer;quantity integer;r real_data_acceptance;BEGIN
 PERFORM ops_assert_console_store('SYSTEM','INVENTORY_EDIT');
 SELECT * INTO c FROM ops_import_commits WHERE id=p_commit;IF NOT FOUND THEN RAISE EXCEPTION 'IMPORT_COMMIT_NOT_FOUND' USING ERRCODE='23514';END IF;
 SELECT * INTO s FROM ops_import_stages WHERE id=c.id;IF NOT FOUND THEN RAISE EXCEPTION 'IMPORT_STAGE_NOT_FOUND' USING ERRCODE='23514';END IF;
 digest:=s.stage->>'sourceSha256';
 IF digest IS NULL OR digest !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'SOURCE_DIGEST_UNAVAILABLE' USING ERRCODE='23514';END IF;
 IF NOT EXISTS(SELECT 1 FROM real_inventory_sources WHERE source_sha256=digest) THEN RAISE EXCEPTION 'REAL_SOURCE_NOT_APPROVED' USING ERRCODE='23514';END IF;
 SELECT array_agg(DISTINCT store ORDER BY store) INTO derived FROM (
  SELECT e->'source'->>'storeId' AS store
  FROM jsonb_array_elements(s.stage->'plan'->'entries') e
  JOIN ops_import_sources src ON src.stage_id=c.id AND src.source_key=e->>'sourceKey'
 ) x WHERE store IS NOT NULL;
 IF derived IS NULL OR array_length(derived,1) IS NULL THEN RAISE EXCEPTION 'IMPORT_COMMIT_EMPTY' USING ERRCODE='23514';END IF;
 IF p_expected_stores IS NOT NULL AND NOT (derived<@p_expected_stores AND p_expected_stores<@derived) THEN RAISE EXCEPTION 'STORE_COVERAGE_MISMATCH' USING ERRCODE='23514';END IF;
 SELECT count(*)::int INTO rows_accepted FROM ops_import_sources WHERE stage_id=c.id;
 SELECT coalesce((c.result->>'assetsAdded')::int,0) INTO assets;
 SELECT coalesce(sum((e->'source'->>'quantity')::int),0)::int INTO quantity
 FROM jsonb_array_elements(s.stage->'plan'->'entries') e
 JOIN ops_import_sources src ON src.stage_id=c.id AND src.source_key=e->>'sourceKey'
 WHERE e->'source'->>'unit' IN ('PAIR_QUANTITY','PIECE_QUANTITY') AND (e->'source'->>'quantity') ~ '^[0-9]+$';
 INSERT INTO real_data_acceptance(stage_id,commit_id,source_sha256,accepted_rows,accepted_assets,accepted_quantity,stores,source_class,actor,approved_source_sha256)
 VALUES(c.id,c.id,digest,rows_accepted,assets,quantity,derived,'REAL',current_setting('zao.actor'),digest) RETURNING * INTO r;
 INSERT INTO ops_history(resource,entity_id,actor,event,after_data) VALUES('real_data_acceptance',r.id,current_setting('zao.actor'),'REAL_DATA_ACCEPTED',jsonb_build_object('commitId',r.commit_id,'acceptedRows',r.accepted_rows,'acceptedAssets',r.accepted_assets,'acceptedQuantity',r.accepted_quantity,'stores',to_jsonb(r.stores),'sourceClass','REAL','synthetic',false,'approvedSource',true));
 RETURN jsonb_build_object('id',r.id,'commitId',r.commit_id,'acceptedRows',r.accepted_rows,'acceptedAssets',r.accepted_assets,'acceptedQuantity',r.accepted_quantity,'stores',to_jsonb(r.stores),'sourceClass','REAL','synthetic',false,'approvedSource',true);
END$$;
