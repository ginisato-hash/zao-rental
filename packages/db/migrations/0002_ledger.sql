-- Ledger only. Counts do not represent interval availability, holds, sales or fit approval.
CREATE TABLE ledger_stores (id text PRIMARY KEY CHECK (id IN ('MOUNTAIN_BASE','ONSEN_BASE')), name text NOT NULL);
INSERT INTO ledger_stores VALUES ('MOUNTAIN_BASE','Mountain Base'),('ONSEN_BASE','Onsen Base');
CREATE TABLE ledger_models (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text NOT NULL UNIQUE CHECK(code ~ '^[A-Z0-9][A-Z0-9_-]{1,39}$'),
 name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 160), brand text NOT NULL CHECK(length(brand)<=80),
 family text NOT NULL CHECK(family IN ('SKI','SNOWBOARD','SKI_BOOT','SNOWBOARD_BOOT','POLE','WEAR')),
 UNIQUE(id,family),
 notes text NOT NULL CHECK(length(notes)<=500), source_kind text NOT NULL CHECK(source_kind IN ('SYNTHETIC','UNVERIFIED')),
 source_document text NOT NULL CHECK(length(btrim(source_document)) BETWEEN 1 AND 160), source_locator text NOT NULL CHECK(length(btrim(source_locator)) BETWEEN 1 AND 160),
 UNIQUE(source_document,source_locator), version integer NOT NULL DEFAULT 1 CHECK(version>0), created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
-- Lexical identity only: fold ASCII case/whitespace, never convert units or fit sizes.
CREATE FUNCTION ledger_size_key(value text) RETURNS text LANGUAGE sql IMMUTABLE STRICT AS $$
 SELECT lower(regexp_replace(value COLLATE "C", '[[:space:]]+', '', 'g'))
$$;
CREATE TABLE ledger_variants (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), model_id uuid NOT NULL, family text NOT NULL CHECK(family IN ('SKI','SNOWBOARD','SKI_BOOT','SNOWBOARD_BOOT','POLE')),
 age text NOT NULL CHECK(age IN ('ADULT','KIDS')), tier text NOT NULL CHECK(tier IN ('REGULAR','PREMIUM')),
 size text NOT NULL CHECK(length(size) BETWEEN 1 AND 32 AND size=btrim(size)),
 size_key text GENERATED ALWAYS AS (ledger_size_key(size)) STORED,
 FOREIGN KEY(model_id,family) REFERENCES ledger_models(id,family), UNIQUE(id,family), UNIQUE(model_id,age,tier,size_key),
 notes text NOT NULL CHECK(length(notes)<=500), source_kind text NOT NULL CHECK(source_kind IN ('SYNTHETIC','UNVERIFIED')),
 source_document text NOT NULL CHECK(length(btrim(source_document)) BETWEEN 1 AND 160), source_locator text NOT NULL CHECK(length(btrim(source_locator)) BETWEEN 1 AND 160),
 UNIQUE(source_document,source_locator), version integer NOT NULL DEFAULT 1 CHECK(version>0), created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE ledger_assets (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), variant_id uuid NOT NULL, family text NOT NULL CHECK(family IN ('SKI','SNOWBOARD','SKI_BOOT','SNOWBOARD_BOOT')),
 label_code text GENERATED ALWAYS AS (id::text) STORED UNIQUE,
 label_copies integer GENERATED ALWAYS AS (CASE WHEN family='SKI' THEN 2 ELSE 1 END) STORED,
 unit text GENERATED ALWAYS AS (CASE WHEN family='SNOWBOARD' THEN 'BOARD' ELSE 'PAIR' END) STORED,
 initial_store_id text NOT NULL REFERENCES ledger_stores(id), store_id text NOT NULL REFERENCES ledger_stores(id),
 CHECK(initial_store_id=store_id),
 status text NOT NULL CHECK(status IN ('UNVERIFIED','AVAILABLE','MAINTENANCE','RETIRED')),
 bsl_status text NOT NULL CHECK(bsl_status IN ('UNVERIFIED','RECORDED','NOT_APPLICABLE')),
 bsl_mm integer, bsl_evidence text NOT NULL CHECK(length(bsl_evidence)<=160),
 CHECK ((family='SKI_BOOT' AND ((bsl_status='UNVERIFIED' AND bsl_mm IS NULL AND bsl_evidence='') OR (bsl_status='RECORDED' AND bsl_mm IS NOT NULL AND bsl_mm BETWEEN 1 AND 999 AND length(btrim(bsl_evidence))>0))) OR
        (family<>'SKI_BOOT' AND bsl_status='NOT_APPLICABLE' AND bsl_mm IS NULL AND bsl_evidence='')),
 FOREIGN KEY(variant_id,family) REFERENCES ledger_variants(id,family),
 notes text NOT NULL CHECK(length(notes)<=500), source_kind text NOT NULL CHECK(source_kind IN ('SYNTHETIC','UNVERIFIED')),
 source_document text NOT NULL CHECK(length(btrim(source_document)) BETWEEN 1 AND 160), source_locator text NOT NULL CHECK(length(btrim(source_locator)) BETWEEN 1 AND 160),
 UNIQUE(source_document,source_locator), version integer NOT NULL DEFAULT 1 CHECK(version>0), created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX ledger_assets_store_variant_idx ON ledger_assets(store_id,variant_id);
CREATE TABLE ledger_poles (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), variant_id uuid NOT NULL, family text NOT NULL DEFAULT 'POLE' CHECK(family='POLE'),
 store_id text NOT NULL REFERENCES ledger_stores(id), quantity integer NOT NULL CHECK(quantity BETWEEN 0 AND 1000000),
 unit text NOT NULL DEFAULT 'PAIR' CHECK(unit='PAIR'), status text NOT NULL CHECK(status IN ('UNVERIFIED','AVAILABLE','MAINTENANCE','RETIRED')),
 FOREIGN KEY(variant_id,family) REFERENCES ledger_variants(id,family), UNIQUE(variant_id,store_id,status),
 notes text NOT NULL CHECK(length(notes)<=500), source_kind text NOT NULL CHECK(source_kind IN ('SYNTHETIC','UNVERIFIED')),
 source_document text NOT NULL CHECK(length(btrim(source_document)) BETWEEN 1 AND 160), source_locator text NOT NULL CHECK(length(btrim(source_locator)) BETWEEN 1 AND 160),
 UNIQUE(source_document,source_locator), version integer NOT NULL DEFAULT 1 CHECK(version>0), created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE ledger_bundles (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text NOT NULL UNIQUE CHECK(code ~ '^[A-Z0-9][A-Z0-9_-]{1,39}$'), name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 160),
 family text NOT NULL CHECK(family IN ('SKI_SET','SNOWBOARD_SET')), age text NOT NULL CHECK(age IN ('ADULT','KIDS')), tier text NOT NULL CHECK(tier IN ('REGULAR','PREMIUM')),
 sales_enabled boolean NOT NULL DEFAULT false CHECK(sales_enabled=false),
 notes text NOT NULL CHECK(length(notes)<=500), source_kind text NOT NULL CHECK(source_kind IN ('SYNTHETIC','UNVERIFIED')),
 source_document text NOT NULL CHECK(length(btrim(source_document)) BETWEEN 1 AND 160), source_locator text NOT NULL CHECK(length(btrim(source_locator)) BETWEEN 1 AND 160),
 UNIQUE(source_document,source_locator), version integer NOT NULL DEFAULT 1 CHECK(version>0), created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
-- Requirements, not rows in physical stock. No implicit Asset creation or variant substitution.
CREATE VIEW ledger_bundle_components AS
 SELECT id AS bundle_id, c.family, 1 AS quantity, c.unit FROM ledger_bundles b
 CROSS JOIN LATERAL (VALUES ('SKI','PAIR'),('SKI_BOOT','PAIR'),('POLE','PAIR')) c(family,unit) WHERE b.family='SKI_SET'
 UNION ALL
 SELECT id, c.family, 1, c.unit FROM ledger_bundles b
 CROSS JOIN LATERAL (VALUES ('SNOWBOARD','BOARD'),('SNOWBOARD_BOOT','PAIR')) c(family,unit) WHERE b.family='SNOWBOARD_SET';
CREATE TABLE ledger_history (
 event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), resource text NOT NULL, entity_id uuid NOT NULL,
 action text NOT NULL CHECK(action IN ('REGISTER','UPDATE')), actor text NOT NULL CHECK(actor ~ '^[A-Za-z0-9_-]{1,80}$'),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 160), before_data jsonb, after_data jsonb NOT NULL,
 occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX ledger_history_entity_idx ON ledger_history(resource,entity_id,occurred_at);
CREATE TABLE ledger_locations (
 event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), asset_id uuid NOT NULL UNIQUE REFERENCES ledger_assets(id),
 store_id text NOT NULL REFERENCES ledger_stores(id), event text NOT NULL CHECK(event='INITIAL_REGISTRATION'),
 occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE ledger_import_receipts (source_document text PRIMARY KEY, checksum text NOT NULL CHECK(checksum ~ '^[a-f0-9]{64}$'), source_kind text NOT NULL CHECK(source_kind='SYNTHETIC'));
CREATE FUNCTION ledger_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE k text;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Ledger deletion is not supported'; END IF;
 IF coalesce(current_setting('zao.actor',true),'') !~ '^[A-Za-z0-9_-]{1,80}$' OR length(btrim(coalesce(current_setting('zao.reason',true),''))) NOT BETWEEN 1 AND 160 THEN
  RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Trusted mutation context required';
 END IF;
 IF TG_OP='UPDATE' THEN
  FOREACH k IN ARRAY ARRAY['id','code','model_id','variant_id','family','age','tier','size','store_id','initial_store_id','source_kind','source_document','source_locator','created_at'] LOOP
   IF to_jsonb(NEW)->k IS DISTINCT FROM to_jsonb(OLD)->k THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Immutable ledger identity or custody'; END IF;
  END LOOP;
  NEW.version:=OLD.version+1; NEW.updated_at:=clock_timestamp();
 ELSE
  IF NEW.version<>1 THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Invalid initial version'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION ledger_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO ledger_history(resource,entity_id,action,actor,reason,before_data,after_data)
 VALUES(TG_ARGV[0],NEW.id,CASE WHEN TG_OP='INSERT' THEN 'REGISTER' ELSE 'UPDATE' END,current_setting('zao.actor'),current_setting('zao.reason'),CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) ELSE NULL END,to_jsonb(NEW));
 IF TG_TABLE_NAME='ledger_assets' AND TG_OP='INSERT' THEN
  INSERT INTO ledger_locations(asset_id,store_id,event) VALUES(NEW.id,NEW.initial_store_id,'INITIAL_REGISTRATION');
 END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION ledger_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP<>'INSERT' OR pg_trigger_depth()<2 THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='History is trigger-owned and append-only'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER history_append_only BEFORE INSERT OR UPDATE OR DELETE ON ledger_history FOR EACH ROW EXECUTE FUNCTION ledger_append_only();
CREATE TRIGGER locations_append_only BEFORE INSERT OR UPDATE OR DELETE ON ledger_locations FOR EACH ROW EXECUTE FUNCTION ledger_append_only();

CREATE TRIGGER models_guard BEFORE INSERT OR UPDATE OR DELETE ON ledger_models FOR EACH ROW EXECUTE FUNCTION ledger_guard();
CREATE TRIGGER models_audit AFTER INSERT OR UPDATE ON ledger_models FOR EACH ROW EXECUTE FUNCTION ledger_audit('models');

CREATE TRIGGER variants_guard BEFORE INSERT OR UPDATE OR DELETE ON ledger_variants FOR EACH ROW EXECUTE FUNCTION ledger_guard();
CREATE TRIGGER variants_audit AFTER INSERT OR UPDATE ON ledger_variants FOR EACH ROW EXECUTE FUNCTION ledger_audit('variants');

CREATE TRIGGER assets_guard BEFORE INSERT OR UPDATE OR DELETE ON ledger_assets FOR EACH ROW EXECUTE FUNCTION ledger_guard();
CREATE TRIGGER assets_audit AFTER INSERT OR UPDATE ON ledger_assets FOR EACH ROW EXECUTE FUNCTION ledger_audit('assets');

CREATE TRIGGER poles_guard BEFORE INSERT OR UPDATE OR DELETE ON ledger_poles FOR EACH ROW EXECUTE FUNCTION ledger_guard();
CREATE TRIGGER poles_audit AFTER INSERT OR UPDATE ON ledger_poles FOR EACH ROW EXECUTE FUNCTION ledger_audit('poles');

CREATE TRIGGER bundles_guard BEFORE INSERT OR UPDATE OR DELETE ON ledger_bundles FOR EACH ROW EXECUTE FUNCTION ledger_guard();
CREATE TRIGGER bundles_audit AFTER INSERT OR UPDATE ON ledger_bundles FOR EACH ROW EXECUTE FUNCTION ledger_audit('bundles');

CREATE VIEW ledger_records AS
SELECT 'models'::text AS resource,r.id,jsonb_build_object('id',r.id,'resource','models','notes',r.notes,'version',r.version,'sourceKind',r.source_kind,'sourceDocument',r.source_document,'sourceLocator',r.source_locator,'createdAt',r.created_at,'updatedAt',r.updated_at,'name',r.name,'code',r.code,'family',r.family,'brand',r.brand) AS data FROM ledger_models r
UNION ALL
SELECT 'variants'::text AS resource,r.id,jsonb_build_object('id',r.id,'resource','variants','notes',r.notes,'version',r.version,'sourceKind',r.source_kind,'sourceDocument',r.source_document,'sourceLocator',r.source_locator,'createdAt',r.created_at,'updatedAt',r.updated_at,'name',m.name,'code',r.id,'family',r.family,'modelId',r.model_id,'age',r.age,'tier',r.tier,'size',r.size) AS data FROM ledger_variants r JOIN ledger_models m ON m.id=r.model_id
UNION ALL
SELECT 'assets'::text AS resource,r.id,jsonb_build_object('id',r.id,'resource','assets','notes',r.notes,'version',r.version,'sourceKind',r.source_kind,'sourceDocument',r.source_document,'sourceLocator',r.source_locator,'createdAt',r.created_at,'updatedAt',r.updated_at,'name',m.name,'code',r.label_code,'family',r.family,'variantId',r.variant_id,'age',v.age,'tier',v.tier,'size',v.size,'storeId',r.store_id,'initialStoreId',r.initial_store_id,'status',r.status,'unit',r.unit,'labelCopies',r.label_copies,'bslStatus',r.bsl_status,'bslMm',r.bsl_mm,'bslEvidence',r.bsl_evidence) AS data FROM ledger_assets r JOIN ledger_variants v ON v.id=r.variant_id JOIN ledger_models m ON m.id=v.model_id
UNION ALL
SELECT 'poles'::text AS resource,r.id,jsonb_build_object('id',r.id,'resource','poles','notes',r.notes,'version',r.version,'sourceKind',r.source_kind,'sourceDocument',r.source_document,'sourceLocator',r.source_locator,'createdAt',r.created_at,'updatedAt',r.updated_at,'name',m.name,'code',r.id,'family',r.family,'variantId',r.variant_id,'age',v.age,'tier',v.tier,'size',v.size,'storeId',r.store_id,'status',r.status,'quantity',r.quantity,'unit',r.unit) AS data FROM ledger_poles r JOIN ledger_variants v ON v.id=r.variant_id JOIN ledger_models m ON m.id=v.model_id
UNION ALL
SELECT 'bundles'::text AS resource,r.id,jsonb_build_object('id',r.id,'resource','bundles','notes',r.notes,'version',r.version,'sourceKind',r.source_kind,'sourceDocument',r.source_document,'sourceLocator',r.source_locator,'createdAt',r.created_at,'updatedAt',r.updated_at,'name',r.name,'code',r.code,'family',r.family,'age',r.age,'tier',r.tier,'components',(SELECT jsonb_agg(jsonb_build_object('family',c.family,'quantity',c.quantity,'unit',c.unit) ORDER BY c.family) FROM ledger_bundle_components c WHERE c.bundle_id=r.id)) AS data FROM ledger_bundles r;
