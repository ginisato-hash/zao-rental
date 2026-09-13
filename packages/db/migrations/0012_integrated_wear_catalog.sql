-- Owner-adopted v1.2 development catalog. No grants, role defaults, custody writer,
-- security-definer function or replacement of existing ledger guard/audit functions.
ALTER TABLE ledger_models DROP CONSTRAINT ledger_models_family_check;
ALTER TABLE ledger_models ADD CONSTRAINT ledger_models_family_check CHECK(family IN ('SKI','SNOWBOARD','SKI_BOOT','SNOWBOARD_BOOT','POLE','WEAR','WEAR_JACKET','WEAR_PANTS'));
ALTER TABLE ledger_models ADD COLUMN catalog_season text CHECK(catalog_season ~ '^20[0-9]{2}/[0-9]{2}$');
ALTER TABLE ledger_variants DROP CONSTRAINT ledger_variants_family_check;
ALTER TABLE ledger_variants ADD CONSTRAINT ledger_variants_family_check CHECK(family IN ('SKI','SNOWBOARD','SKI_BOOT','SNOWBOARD_BOOT','POLE','WEAR_JACKET','WEAR_PANTS'));
ALTER TABLE ledger_variants DROP CONSTRAINT ledger_variants_tier_check;
ALTER TABLE ledger_variants ADD CONSTRAINT ledger_variants_tier_check CHECK(tier IN ('REGULAR','PREMIUM','STANDARD'));
ALTER TABLE ledger_variants ADD COLUMN compatible_sports text[];
ALTER TABLE ledger_variants ADD CONSTRAINT garment_class_compatibility CHECK(
 CASE WHEN family IN ('WEAR_JACKET','WEAR_PANTS') THEN
 tier='STANDARD' AND compatible_sports IS NOT NULL AND cardinality(compatible_sports) BETWEEN 1 AND 2 AND array_position(compatible_sports,NULL) IS NULL
 AND compatible_sports <@ ARRAY['SKI','SNOWBOARD']::text[] AND (cardinality(compatible_sports)=1 OR compatible_sports[1]<>compatible_sports[2])
 ELSE tier IN ('REGULAR','PREMIUM') AND compatible_sports IS NULL END);
-- Owner quantity override: ledger_assets intentionally still excludes all wear kinds.
-- Catalog edition and compatibility cannot be edited underneath existing promises.
CREATE FUNCTION catalog_identity_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='ledger_models' THEN IF NEW.catalog_season IS DISTINCT FROM OLD.catalog_season THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Catalog edition is immutable'; END IF; END IF;
 IF TG_TABLE_NAME='ledger_variants' THEN IF NEW.compatible_sports IS DISTINCT FROM OLD.compatible_sports THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Compatibility is immutable'; END IF; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER catalog_model_identity BEFORE UPDATE ON ledger_models FOR EACH ROW EXECUTE FUNCTION catalog_identity_guard();
CREATE TRIGGER catalog_variant_identity BEFORE UPDATE ON ledger_variants FOR EACH ROW EXECUTE FUNCTION catalog_identity_guard();
CREATE OR REPLACE VIEW ledger_records AS
SELECT 'models'::text AS resource,r.id,jsonb_build_object('id',r.id,'resource','models','notes',r.notes,'version',r.version,'sourceKind',r.source_kind,'sourceDocument',r.source_document,'sourceLocator',r.source_locator,'createdAt',r.created_at,'updatedAt',r.updated_at,'name',r.name,'code',r.code,'family',r.family,'brand',r.brand,'catalogSeason',r.catalog_season) AS data FROM ledger_models r
UNION ALL
SELECT 'variants'::text AS resource,r.id,jsonb_build_object('id',r.id,'resource','variants','notes',r.notes,'version',r.version,'sourceKind',r.source_kind,'sourceDocument',r.source_document,'sourceLocator',r.source_locator,'createdAt',r.created_at,'updatedAt',r.updated_at,'name',m.name,'code',r.id,'family',r.family,'modelId',r.model_id,'age',r.age,'tier',r.tier,'size',r.size,'compatibleSports',r.compatible_sports,'catalogSeason',m.catalog_season) AS data FROM ledger_variants r JOIN ledger_models m ON m.id=r.model_id
UNION ALL
SELECT 'assets'::text AS resource,r.id,jsonb_build_object('id',r.id,'resource','assets','notes',r.notes,'version',r.version,'sourceKind',r.source_kind,'sourceDocument',r.source_document,'sourceLocator',r.source_locator,'createdAt',r.created_at,'updatedAt',r.updated_at,'name',m.name,'code',r.label_code,'family',r.family,'variantId',r.variant_id,'age',v.age,'tier',v.tier,'size',v.size,'storeId',r.store_id,'initialStoreId',r.initial_store_id,'status',r.status,'unit',r.unit,'labelCopies',r.label_copies,'custody',coalesce((SELECT CASE WHEN p.state='IN_TRANSIT' THEN 'IN_TRANSIT' WHEN p.state='RECEIVED' THEN 'RECEIVED_PENDING_INSPECTION' ELSE r.store_id END FROM transfer_pieces p WHERE p.asset_id=r.id AND p.state NOT IN ('CANCELLED','CLOSED') LIMIT 1),r.store_id),'catalogSeason',m.catalog_season,'compatibleSports',v.compatible_sports,'bslStatus',r.bsl_status,'bslMm',r.bsl_mm,'bslEvidence',r.bsl_evidence) AS data FROM ledger_assets r JOIN ledger_variants v ON v.id=r.variant_id JOIN ledger_models m ON m.id=v.model_id
UNION ALL
SELECT 'poles'::text AS resource,r.id,jsonb_build_object('id',r.id,'resource','poles','notes',r.notes,'version',r.version,'sourceKind',r.source_kind,'sourceDocument',r.source_document,'sourceLocator',r.source_locator,'createdAt',r.created_at,'updatedAt',r.updated_at,'name',m.name,'code',r.id,'family',r.family,'variantId',r.variant_id,'age',v.age,'tier',v.tier,'size',v.size,'storeId',r.store_id,'status',r.status,'quantity',r.quantity,'unit',r.unit) AS data FROM ledger_poles r JOIN ledger_variants v ON v.id=r.variant_id JOIN ledger_models m ON m.id=v.model_id
UNION ALL
SELECT 'bundles'::text AS resource,r.id,jsonb_build_object('id',r.id,'resource','bundles','notes',r.notes,'version',r.version,'sourceKind',r.source_kind,'sourceDocument',r.source_document,'sourceLocator',r.source_locator,'createdAt',r.created_at,'updatedAt',r.updated_at,'name',r.name,'code',r.code,'family',r.family,'age',r.age,'tier',r.tier,'components',(SELECT jsonb_agg(jsonb_build_object('family',c.family,'quantity',c.quantity,'unit',c.unit) ORDER BY c.family) FROM ledger_bundle_components c WHERE c.bundle_id=r.id)) AS data FROM ledger_bundles r;
