-- M2A correction R2: real inventory provenance, owned local databases only.
DO $$BEGIN IF current_database() !~ '^zr_[a-f0-9]{12}$' THEN RAISE EXCEPTION 'Dedicated development database required';END IF;END$$;

-- IR-05B: calling the acceptance function must not be what makes a source real. An approved
-- real inventory source is registered at the deployment-owned boundary: this table is owned
-- by the database owner and no application role is ever granted INSERT on it, so staff can
-- record that an approved file was imported but can never approve a file.
CREATE TABLE real_inventory_sources(
 source_sha256 text PRIMARY KEY CHECK(source_sha256 ~ '^[a-f0-9]{64}$'),
 label text NOT NULL CHECK(label ~ '^[A-Za-z0-9][A-Za-z0-9 ._:-]{0,79}$'),
 approved_at timestamptz NOT NULL DEFAULT inventory_clock()
);
REVOKE ALL ON real_inventory_sources FROM PUBLIC;

-- The receipt is bound to the approval that justified it.
-- Withdrawing an approval must be possible; the receipt then stops counting rather than
-- blocking the withdrawal.
ALTER TABLE real_data_acceptance ADD COLUMN approved_source_sha256 text REFERENCES real_inventory_sources(source_sha256) ON DELETE SET NULL;

-- Store coverage and the source digest are both derived from the committed import. The
-- caller may state what it expects, which is compared, but it is never the authority.
DROP FUNCTION real_data_accept(uuid,text,text[]);
CREATE FUNCTION real_data_accept(p_commit uuid,p_expected_stores text[]) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE c ops_import_commits;s ops_import_stages;digest text;derived text[];rows_accepted integer;assets integer;quantity integer;r real_data_acceptance;BEGIN
 -- Declaring an imported file as real stock is an inventory act across both stores.
 PERFORM ops_assert_console_store('SYSTEM','INVENTORY_EDIT');
 SELECT * INTO c FROM ops_import_commits WHERE id=p_commit;IF NOT FOUND THEN RAISE EXCEPTION 'IMPORT_COMMIT_NOT_FOUND' USING ERRCODE='23514';END IF;
 SELECT * INTO s FROM ops_import_stages WHERE id=c.id;IF NOT FOUND THEN RAISE EXCEPTION 'IMPORT_STAGE_NOT_FOUND' USING ERRCODE='23514';END IF;
 digest:=s.stage->>'sourceSha256';
 IF digest IS NULL OR digest !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'SOURCE_DIGEST_UNAVAILABLE' USING ERRCODE='23514';END IF;
 -- Provenance comes from the approved source register, never from the request.
 IF NOT EXISTS(SELECT 1 FROM real_inventory_sources WHERE source_sha256=digest) THEN RAISE EXCEPTION 'REAL_SOURCE_NOT_APPROVED' USING ERRCODE='23514';END IF;
 -- Coverage is derived from the rows this commit actually applied.
 SELECT array_agg(DISTINCT store ORDER BY store) INTO derived FROM (
  SELECT e->'source'->>'storeId' AS store
  FROM jsonb_array_elements(s.stage->'plan'->'entries') e
  JOIN ops_import_sources src ON src.stage_id=c.id AND src.source_key=e->>'sourceKey'
 ) x WHERE store IS NOT NULL;
 IF derived IS NULL OR array_length(derived,1) IS NULL THEN RAISE EXCEPTION 'IMPORT_COMMIT_EMPTY' USING ERRCODE='23514';END IF;
 IF p_expected_stores IS NOT NULL AND NOT (derived<@p_expected_stores AND p_expected_stores<@derived) THEN RAISE EXCEPTION 'STORE_COVERAGE_MISMATCH' USING ERRCODE='23514';END IF;
 SELECT count(*)::int INTO rows_accepted FROM ops_import_sources WHERE stage_id=c.id;
 SELECT coalesce((c.result->>'assetsAdded')::int,0) INTO assets;
 SELECT greatest(rows_accepted-assets,0) INTO quantity;
 INSERT INTO real_data_acceptance(stage_id,commit_id,source_sha256,accepted_rows,accepted_assets,accepted_quantity,stores,source_class,actor,approved_source_sha256)
 VALUES(c.id,c.id,digest,rows_accepted,assets,quantity,derived,'REAL',current_setting('zao.actor'),digest) RETURNING * INTO r;
 INSERT INTO ops_history(resource,entity_id,actor,event,after_data) VALUES('real_data_acceptance',r.id,current_setting('zao.actor'),'REAL_DATA_ACCEPTED',jsonb_build_object('commitId',r.commit_id,'acceptedRows',r.accepted_rows,'acceptedAssets',r.accepted_assets,'stores',to_jsonb(r.stores),'sourceClass','REAL','synthetic',false,'approvedSource',true));
 RETURN jsonb_build_object('id',r.id,'commitId',r.commit_id,'acceptedRows',r.accepted_rows,'acceptedAssets',r.accepted_assets,'acceptedQuantity',r.accepted_quantity,'stores',to_jsonb(r.stores),'sourceClass','REAL','synthetic',false,'approvedSource',true);
END$$;

-- A receipt stops counting if its commit disappears or its source digest no longer matches.
CREATE OR REPLACE FUNCTION real_data_acceptance_status() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$DECLARE result jsonb;BEGIN
 PERFORM ops_assert_actor('OPERATIONS_VIEW',ARRAY[]::text[],current_setting('zao.actor',true));
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',a.id,'commitId',a.commit_id,'acceptedRows',a.accepted_rows,'acceptedAssets',a.accepted_assets,'acceptedQuantity',a.accepted_quantity,'stores',to_jsonb(a.stores),'acceptedAt',a.accepted_at,
  'commitPresent',c.id IS NOT NULL,
  'sourceMatches',s.stage->>'sourceSha256' IS NOT DISTINCT FROM a.source_sha256,
  'sourceApproved',EXISTS(SELECT 1 FROM real_inventory_sources v WHERE v.source_sha256=a.source_sha256)) ORDER BY a.accepted_at DESC),'[]'::jsonb)
 INTO result FROM real_data_acceptance a
 LEFT JOIN ops_import_commits c ON c.id=a.commit_id
 LEFT JOIN ops_import_stages s ON s.id=a.stage_id;RETURN result;
END$$;
REVOKE ALL ON FUNCTION real_data_accept(uuid,text[]) FROM PUBLIC;
