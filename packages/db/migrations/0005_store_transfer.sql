-- E07 additive upgrade. 0001-0004 remain immutable.
ALTER TABLE staff_role_permissions DROP CONSTRAINT staff_role_permissions_permission_check;
ALTER TABLE staff_role_permissions ADD CHECK(permission IN ('INVENTORY_VIEW','INVENTORY_EDIT','STAFF_MANAGE','HOLD_VIEW','HOLD_EDIT','TRANSFER_VIEW','TRANSFER_PLAN','TRANSFER_DISPATCH','TRANSFER_RECEIVE'));
ALTER TABLE staff_permission_overrides DROP CONSTRAINT staff_permission_overrides_permission_check;
ALTER TABLE staff_permission_overrides ADD CHECK(permission IN ('INVENTORY_VIEW','INVENTORY_EDIT','STAFF_MANAGE','HOLD_VIEW','HOLD_EDIT','TRANSFER_VIEW','TRANSFER_PLAN','TRANSFER_DISPATCH','TRANSFER_RECEIVE'));
-- No default grants. A batch commits explicitly estimated readiness, never automatic receipt.
CREATE TABLE transfer_batches(
 id uuid PRIMARY KEY, source_store text NOT NULL REFERENCES ledger_stores(id), destination_store text NOT NULL REFERENCES ledger_stores(id),
 scheduled_date date NOT NULL, planned_ready_at timestamptz NOT NULL, needed_by timestamptz NOT NULL,
 basis text NOT NULL CHECK(length(btrim(basis)) BETWEEN 1 AND 160),
 state text NOT NULL DEFAULT 'PLANNED' CHECK(state IN ('PLANNED','DEPARTED','CANCELLED')),
 departed_at timestamptz, issue text CHECK(length(issue) BETWEEN 1 AND 160), version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(source_store<>destination_store),CHECK(planned_ready_at>=((scheduled_date+time '17:00') AT TIME ZONE 'Asia/Tokyo') AND needed_by>=planned_ready_at),
 CHECK((state='DEPARTED')=(departed_at IS NOT NULL))
);
-- Pole rows below are fungible PAIR accounting slices of a quantity line, not physical IDs/QRs.
CREATE TABLE transfer_pieces(
 id uuid PRIMARY KEY, batch_id uuid NOT NULL REFERENCES transfer_batches(id), line_key uuid NOT NULL, ordinal integer NOT NULL CHECK(ordinal>0),
 asset_id uuid REFERENCES ledger_assets(id), source_pole_id uuid REFERENCES ledger_poles(id), destination_pole_id uuid REFERENCES ledger_poles(id), receipt_pole_id uuid REFERENCES ledger_poles(id),
 state text NOT NULL DEFAULT 'PLANNED' CHECK(state IN ('PLANNED','IN_TRANSIT','RECEIVED','READY','CANCELLED','CLOSED')),
 received_at timestamptz, ready_at timestamptz,
 CHECK((asset_id IS NOT NULL AND source_pole_id IS NULL AND destination_pole_id IS NULL AND receipt_pole_id IS NULL) OR (asset_id IS NULL AND source_pole_id IS NOT NULL AND destination_pole_id IS NOT NULL AND receipt_pole_id IS NOT NULL)),
 CHECK((received_at IS NOT NULL)=(state IN ('RECEIVED','READY','CLOSED'))),CHECK((ready_at IS NOT NULL)=(state IN ('READY','CLOSED'))),CHECK(ready_at>=received_at),UNIQUE(batch_id,line_key,ordinal)
);
CREATE UNIQUE INDEX transfer_one_asset ON transfer_pieces(asset_id) WHERE state NOT IN ('CANCELLED','CLOSED');
CREATE INDEX transfer_source_pole ON transfer_pieces(source_pole_id,state);
CREATE TABLE transfer_requests(actor text NOT NULL REFERENCES staff_members(id),request_key uuid NOT NULL,fingerprint text NOT NULL CHECK(length(fingerprint)=64),batch_id uuid NOT NULL REFERENCES transfer_batches(id),PRIMARY KEY(actor,request_key));
CREATE TABLE transfer_history(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,batch_id uuid NOT NULL REFERENCES transfer_batches(id),actor text NOT NULL REFERENCES staff_members(id),entity_id uuid NOT NULL,event text NOT NULL,before_data jsonb,after_data jsonb NOT NULL,occurred_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE INDEX transfer_history_batch ON transfer_history(batch_id,id);
CREATE FUNCTION transfer_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$BEGIN
 INSERT INTO transfer_history(batch_id,actor,entity_id,event,before_data,after_data) VALUES(coalesce((to_jsonb(NEW)->>'batch_id')::uuid,NEW.id),current_setting('zao.actor'),NEW.id,TG_TABLE_NAME||'_'||TG_OP,CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) ELSE NULL END,to_jsonb(NEW));RETURN NEW;
END$$;
CREATE TRIGGER transfer_batches_lock BEFORE INSERT OR UPDATE OR DELETE ON transfer_batches FOR EACH STATEMENT EXECUTE FUNCTION inventory_lock();
CREATE TRIGGER transfer_pieces_lock BEFORE INSERT OR UPDATE OR DELETE ON transfer_pieces FOR EACH STATEMENT EXECUTE FUNCTION inventory_lock();
CREATE TRIGGER transfer_batches_audit AFTER INSERT OR UPDATE ON transfer_batches FOR EACH ROW EXECUTE FUNCTION transfer_audit();
CREATE TRIGGER transfer_pieces_audit AFTER INSERT OR UPDATE ON transfer_pieces FOR EACH ROW EXECUTE FUNCTION transfer_audit();
CREATE TRIGGER transfer_history_guard BEFORE INSERT OR UPDATE OR DELETE ON transfer_history FOR EACH ROW EXECUTE FUNCTION ledger_append_only();
ALTER TABLE inventory_claims ADD COLUMN transfer_piece_id uuid REFERENCES transfer_pieces(id);
DROP INDEX inventory_pole_day;
CREATE UNIQUE INDEX inventory_pole_day ON inventory_claims(pole_id,pole_slot,day) WHERE active AND pole_id IS NOT NULL AND transfer_piece_id IS NULL;
CREATE UNIQUE INDEX inventory_transfer_pair_day ON inventory_claims(transfer_piece_id,day) WHERE active AND pole_id IS NOT NULL AND transfer_piece_id IS NOT NULL;
ALTER TABLE inventory_holds ADD COLUMN transfer_attention text;
-- Keep initial custody immutable; only a narrow owner-executed movement function changes current store.
ALTER TABLE ledger_assets DROP CONSTRAINT ledger_assets_check;
ALTER TABLE ledger_locations DROP CONSTRAINT ledger_locations_asset_id_key;
ALTER TABLE ledger_locations DROP CONSTRAINT ledger_locations_event_check;
ALTER TABLE ledger_locations ADD CHECK(event IN ('INITIAL_REGISTRATION','TRANSFER_RECEIPT'));
CREATE OR REPLACE FUNCTION ledger_guard() RETURNS trigger LANGUAGE plpgsql AS $$DECLARE k text;owner_name text;BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Ledger deletion is not supported';END IF;
 IF coalesce(current_setting('zao.actor',true),'') !~ '^[A-Za-z0-9_-]{1,80}$' OR length(btrim(coalesce(current_setting('zao.reason',true),''))) NOT BETWEEN 1 AND 160 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Trusted mutation context required';END IF;
 SELECT pg_get_userbyid(relowner) INTO owner_name FROM pg_class WHERE oid=TG_RELID;
 IF TG_OP='UPDATE' THEN
  FOREACH k IN ARRAY ARRAY['id','code','model_id','variant_id','family','age','tier','size','store_id','initial_store_id','source_kind','source_document','source_locator','created_at'] LOOP
   IF to_jsonb(NEW)->k IS DISTINCT FROM to_jsonb(OLD)->k AND NOT(k='store_id' AND TG_TABLE_NAME='ledger_assets' AND current_user=owner_name AND EXISTS(SELECT 1 FROM transfer_pieces p JOIN transfer_batches b ON b.id=p.batch_id WHERE p.asset_id=NEW.id AND p.state='RECEIVED' AND b.destination_store=to_jsonb(NEW)->>'store_id')) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Immutable ledger identity or custody';END IF;
  END LOOP;NEW.version:=OLD.version+1;NEW.updated_at:=clock_timestamp();
 ELSE IF NEW.version<>1 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Invalid initial version';END IF;END IF;RETURN NEW;
END$$;
CREATE OR REPLACE FUNCTION ledger_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$BEGIN
 INSERT INTO ledger_history(resource,entity_id,action,actor,reason,before_data,after_data) VALUES(TG_ARGV[0],NEW.id,CASE WHEN TG_OP='INSERT' THEN 'REGISTER' ELSE 'UPDATE' END,current_setting('zao.actor'),current_setting('zao.reason'),CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) ELSE NULL END,to_jsonb(NEW));
 IF TG_TABLE_NAME='ledger_assets' THEN
  IF TG_OP='INSERT' THEN INSERT INTO ledger_locations(asset_id,store_id,event) VALUES(NEW.id,NEW.initial_store_id,'INITIAL_REGISTRATION');
  ELSIF NEW.store_id<>OLD.store_id THEN INSERT INTO ledger_locations(asset_id,store_id,event) VALUES(NEW.id,NEW.store_id,'TRANSFER_RECEIPT');END IF;
 END IF;RETURN NEW;
END$$;
-- Invoker identity matters: app roles cannot imitate a privileged movement via a GUC.
CREATE OR REPLACE FUNCTION inventory_stock_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,pg_temp AS $$DECLARE owner_name text;BEGIN
 SELECT pg_get_userbyid(relowner) INTO owner_name FROM pg_class WHERE oid=TG_RELID;
 IF current_user=owner_name AND current_setting('zao.transfer_operation',true)='controlled' THEN RETURN NEW;END IF;
 IF NEW.status=OLD.status AND (TG_TABLE_NAME='ledger_assets' OR to_jsonb(NEW)->'quantity'=to_jsonb(OLD)->'quantity') THEN RETURN NEW;END IF;
 IF TG_TABLE_NAME='ledger_assets' THEN
  IF NEW.status<>'AVAILABLE' AND (EXISTS(SELECT 1 FROM inventory_claims WHERE asset_id=NEW.id AND active) OR EXISTS(SELECT 1 FROM transfer_pieces WHERE asset_id=NEW.id AND state NOT IN ('CANCELLED','CLOSED'))) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Protected inventory requires reconciliation';END IF;
 ELSE
  IF (NEW.quantity<>OLD.quantity OR NEW.status<>OLD.status) AND EXISTS(SELECT 1 FROM transfer_pieces WHERE (source_pole_id=NEW.id OR destination_pole_id=NEW.id OR receipt_pole_id=NEW.id) AND state NOT IN ('CANCELLED','CLOSED')) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Protected transfer quantity';END IF;
  IF EXISTS(SELECT 1 FROM inventory_claims WHERE pole_id=NEW.id AND active AND transfer_piece_id IS NULL AND (NEW.status<>'AVAILABLE' OR pole_slot>NEW.quantity)) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Protected quantity requires reconciliation';END IF;
 END IF;RETURN NEW;
END$$;
CREATE FUNCTION transfer_pool(variant uuid,store text,stock_status text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$DECLARE result uuid;BEGIN
 IF stock_status NOT IN ('AVAILABLE','MAINTENANCE') THEN RAISE EXCEPTION 'Invalid transfer pool';END IF;
 SELECT id INTO result FROM ledger_poles WHERE variant_id=variant AND store_id=store AND status=stock_status;
 IF result IS NULL THEN INSERT INTO ledger_poles(variant_id,store_id,quantity,status,notes,source_kind,source_document,source_locator) VALUES(variant,store,0,stock_status,'Transfer pool; counts only actual received stock','UNVERIFIED','E07 transfer pool',variant::text||'/'||store||'/'||stock_status) RETURNING id INTO result;END IF;RETURN result;
END$$;
CREATE FUNCTION transfer_move_stock(piece_id uuid,operation text,actual_time timestamptz) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$DECLARE p transfer_pieces;b transfer_batches;BEGIN
 PERFORM pg_advisory_xact_lock(71820600);PERFORM set_config('zao.transfer_operation','controlled',true);SELECT * INTO STRICT p FROM transfer_pieces WHERE id=piece_id;SELECT * INTO STRICT b FROM transfer_batches WHERE id=p.batch_id;
 IF operation='dispatch' AND p.state='PLANNED' AND b.state='DEPARTED' THEN
  UPDATE transfer_pieces SET state='IN_TRANSIT' WHERE id=p.id;
  IF p.source_pole_id IS NOT NULL THEN UPDATE ledger_poles SET quantity=quantity-1 WHERE id=p.source_pole_id;END IF;
 ELSIF operation='receive' AND p.state='IN_TRANSIT' AND actual_time>=b.departed_at THEN
  UPDATE transfer_pieces SET state='RECEIVED',received_at=actual_time WHERE id=p.id;
  IF p.asset_id IS NOT NULL THEN UPDATE ledger_assets SET store_id=b.destination_store WHERE id=p.asset_id;
  ELSE UPDATE ledger_poles SET quantity=quantity+1 WHERE id=p.receipt_pole_id;END IF;
 ELSIF operation='ready' AND p.state='RECEIVED' AND actual_time>=p.received_at THEN
  UPDATE transfer_pieces SET state='READY',ready_at=actual_time WHERE id=p.id;
  IF p.source_pole_id IS NOT NULL THEN UPDATE ledger_poles SET quantity=quantity-1 WHERE id=p.receipt_pole_id;UPDATE ledger_poles SET quantity=quantity+1 WHERE id=p.destination_pole_id;END IF;
 ELSE RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Invalid physical transition';END IF;PERFORM set_config('zao.transfer_operation','',true);
END$$;
CREATE OR REPLACE FUNCTION inventory_claim_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$DECLARE h inventory_holds;status text;qty integer;store text;p transfer_pieces;b transfer_batches;BEGIN
 IF NOT NEW.active THEN RETURN NEW;END IF;SELECT * INTO STRICT h FROM inventory_holds WHERE id=NEW.hold_id;
 IF h.state<>'ACTIVE' OR NEW.day<h.occupancy_start OR NEW.day>h.occupancy_end THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Invalid hold claim';END IF;
 IF NEW.transfer_piece_id IS NOT NULL THEN
  SELECT * INTO STRICT p FROM transfer_pieces WHERE id=NEW.transfer_piece_id;SELECT * INTO STRICT b FROM transfer_batches WHERE id=p.batch_id;
  IF b.destination_store<>h.pickup_store OR p.state IN ('CANCELLED','CLOSED') OR b.issue IS NOT NULL OR h.starts_at<b.planned_ready_at OR NEW.day<=b.scheduled_date OR (p.asset_id IS DISTINCT FROM NEW.asset_id) OR (p.destination_pole_id IS DISTINCT FROM NEW.pole_id) OR (NEW.pole_id IS NOT NULL AND NEW.pole_slot<>1) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Invalid transfer claim';END IF;RETURN NEW;
 END IF;
 IF NEW.asset_id IS NOT NULL THEN SELECT a.status,a.store_id INTO status,store FROM ledger_assets a WHERE a.id=NEW.asset_id;
  IF EXISTS(SELECT 1 FROM transfer_pieces xp JOIN transfer_batches xb ON xb.id=xp.batch_id WHERE xp.asset_id=NEW.asset_id AND xp.state NOT IN ('CANCELLED','CLOSED') AND (xp.state<>'PLANNED' OR NEW.day>xb.scheduled_date)) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Transfer protected asset';END IF;
 ELSE SELECT a.status,a.quantity,a.store_id INTO status,qty,store FROM ledger_poles a WHERE a.id=NEW.pole_id;
  qty:=qty-(SELECT count(*) FROM transfer_pieces WHERE destination_pole_id=NEW.pole_id AND state='READY');
 END IF;
 IF status<>'AVAILABLE' OR store<>h.pickup_store OR NEW.pole_slot>qty THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Invalid stock claim';END IF;RETURN NEW;
END$$;
REVOKE ALL ON FUNCTION transfer_audit(),transfer_pool(uuid,text,text),transfer_move_stock(uuid,text,timestamptz) FROM PUBLIC;

CREATE FUNCTION inventory_clock() RETURNS timestamptz LANGUAGE sql VOLATILE AS $$SELECT clock_timestamp()$$;
REVOKE ALL ON FUNCTION inventory_clock() FROM PUBLIC;

CREATE OR REPLACE VIEW ledger_records AS
SELECT 'models'::text AS resource,r.id,jsonb_build_object('id',r.id,'resource','models','notes',r.notes,'version',r.version,'sourceKind',r.source_kind,'sourceDocument',r.source_document,'sourceLocator',r.source_locator,'createdAt',r.created_at,'updatedAt',r.updated_at,'name',r.name,'code',r.code,'family',r.family,'brand',r.brand) AS data FROM ledger_models r
UNION ALL
SELECT 'variants'::text AS resource,r.id,jsonb_build_object('id',r.id,'resource','variants','notes',r.notes,'version',r.version,'sourceKind',r.source_kind,'sourceDocument',r.source_document,'sourceLocator',r.source_locator,'createdAt',r.created_at,'updatedAt',r.updated_at,'name',m.name,'code',r.id,'family',r.family,'modelId',r.model_id,'age',r.age,'tier',r.tier,'size',r.size) AS data FROM ledger_variants r JOIN ledger_models m ON m.id=r.model_id
UNION ALL
SELECT 'assets'::text AS resource,r.id,jsonb_build_object('id',r.id,'resource','assets','notes',r.notes,'version',r.version,'sourceKind',r.source_kind,'sourceDocument',r.source_document,'sourceLocator',r.source_locator,'createdAt',r.created_at,'updatedAt',r.updated_at,'name',m.name,'code',r.label_code,'family',r.family,'variantId',r.variant_id,'age',v.age,'tier',v.tier,'size',v.size,'storeId',r.store_id,'initialStoreId',r.initial_store_id,'status',r.status,'unit',r.unit,'labelCopies',r.label_copies,'custody',coalesce((SELECT CASE WHEN p.state='IN_TRANSIT' THEN 'IN_TRANSIT' WHEN p.state='RECEIVED' THEN 'RECEIVED_PENDING_INSPECTION' ELSE r.store_id END FROM transfer_pieces p WHERE p.asset_id=r.id AND p.state NOT IN ('CANCELLED','CLOSED') LIMIT 1),r.store_id),'bslStatus',r.bsl_status,'bslMm',r.bsl_mm,'bslEvidence',r.bsl_evidence) AS data FROM ledger_assets r JOIN ledger_variants v ON v.id=r.variant_id JOIN ledger_models m ON m.id=v.model_id
UNION ALL
SELECT 'poles'::text AS resource,r.id,jsonb_build_object('id',r.id,'resource','poles','notes',r.notes,'version',r.version,'sourceKind',r.source_kind,'sourceDocument',r.source_document,'sourceLocator',r.source_locator,'createdAt',r.created_at,'updatedAt',r.updated_at,'name',m.name,'code',r.id,'family',r.family,'variantId',r.variant_id,'age',v.age,'tier',v.tier,'size',v.size,'storeId',r.store_id,'status',r.status,'quantity',r.quantity,'unit',r.unit) AS data FROM ledger_poles r JOIN ledger_variants v ON v.id=r.variant_id JOIN ledger_models m ON m.id=v.model_id
UNION ALL
SELECT 'bundles'::text AS resource,r.id,jsonb_build_object('id',r.id,'resource','bundles','notes',r.notes,'version',r.version,'sourceKind',r.source_kind,'sourceDocument',r.source_document,'sourceLocator',r.source_locator,'createdAt',r.created_at,'updatedAt',r.updated_at,'name',r.name,'code',r.code,'family',r.family,'age',r.age,'tier',r.tier,'components',(SELECT jsonb_agg(jsonb_build_object('family',c.family,'quantity',c.quantity,'unit',c.unit) ORDER BY c.family) FROM ledger_bundle_components c WHERE c.bundle_id=r.id)) AS data FROM ledger_bundles r;

-- One ordinary direction/date batch; a departed batch cannot be bypassed by another.
CREATE UNIQUE INDEX transfer_daily_direction ON transfer_batches(source_store,destination_store,scheduled_date) WHERE state<>'CANCELLED';
