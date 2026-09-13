-- ZAO-FLOW-CUSTODY-DB-BOUNDARY-R1. migrate() wraps CREATE/REVOKE/GRANT in one transaction.
-- Only fresh, worktree-owned synthetic clusters. Never a production provisioning mechanism.
DO $$DECLARE n text:=current_database();BEGIN
 IF n !~ '^zr_[a-f0-9]{12}$' THEN RAISE EXCEPTION 'Dedicated development database required';END IF;
 EXECUTE format('CREATE ROLE %I NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS',n||'_custody_executor');
 EXECUTE format('CREATE ROLE %I NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS',n||'_custody');
END$$;
CREATE SCHEMA rental_internal;
REVOKE ALL ON SCHEMA rental_internal FROM PUBLIC;
CREATE TABLE rental_internal.effects(tx bigint NOT NULL,pid integer NOT NULL,receipt_id uuid,inspection_id uuid,asset_id uuid,store_id text,pole_id uuid,delta integer,CHECK((receipt_id IS NULL)<>(inspection_id IS NULL)));
CREATE TABLE rental_custody_events(receipt_id uuid PRIMARY KEY REFERENCES rental_receipts(id),loan_item_id uuid NOT NULL UNIQUE REFERENCES rental_loan_items(id),source_store text NOT NULL REFERENCES ledger_stores(id),actual_store text NOT NULL REFERENCES ledger_stores(id),received_pool uuid REFERENCES ledger_poles(id),ready_pool uuid REFERENCES ledger_poles(id),applied_at timestamptz NOT NULL);
CREATE TABLE rental_inspection_events(inspection_id uuid PRIMARY KEY REFERENCES rental_inspections(id),loan_item_id uuid NOT NULL UNIQUE REFERENCES rental_loan_items(id),applied_at timestamptz NOT NULL);
ALTER TABLE rental_inspections ADD COLUMN expected_version integer NOT NULL DEFAULT 2 CHECK(expected_version>0);
CREATE TRIGGER rental_custody_events_immutable BEFORE UPDATE OR DELETE ON rental_custody_events FOR EACH ROW EXECUTE FUNCTION pricing_immutable();
CREATE TRIGGER rental_inspection_events_immutable BEFORE UPDATE OR DELETE ON rental_inspection_events FOR EACH ROW EXECUTE FUNCTION pricing_immutable();
ALTER TABLE ledger_locations DROP CONSTRAINT ledger_locations_event_check;
ALTER TABLE ledger_locations ADD CHECK(event IN ('INITIAL_REGISTRATION','TRANSFER_RECEIPT','RETURN_RECEIPT'));

-- Private helper is not callable by application roles. Inputs never form SQL/identifiers.
CREATE FUNCTION rental_internal.assert_actor(required_permission text,required_store text,expected_actor text) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,pg_temp AS $$DECLARE actor text:=current_setting('zao.actor',true);s staff_members;p text;BEGIN
 IF actor IS DISTINCT FROM expected_actor OR actor IS NULL THEN RAISE EXCEPTION 'CUSTODY_FORBIDDEN' USING ERRCODE='42501';END IF;
 PERFORM pg_advisory_xact_lock_shared(71820901,hashtext(actor));
 -- Prevent concurrent logout/password revocation from passing between this check and commit.
 PERFORM 1 FROM auth_session WHERE id=current_setting('zao.session',true) AND "userId"=actor AND "expiresAt">clock_timestamp() FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'CUSTODY_SESSION_INVALID' USING ERRCODE='42501';END IF;
 SELECT * INTO s FROM staff_members WHERE id=actor;
 IF NOT FOUND OR NOT s.active OR (s.scope<>'ALL' AND NOT EXISTS(SELECT 1 FROM staff_store_access WHERE staff_id=actor AND store_id=required_store)) THEN RAISE EXCEPTION 'CUSTODY_FORBIDDEN' USING ERRCODE='42501';END IF;
 FOREACH p IN ARRAY ARRAY['BOOKING_VIEW',required_permission] LOOP
  IF EXISTS(SELECT 1 FROM staff_permission_overrides WHERE staff_id=actor AND permission=p AND NOT allowed) OR NOT(EXISTS(SELECT 1 FROM staff_permission_overrides WHERE staff_id=actor AND permission=p AND allowed) OR EXISTS(SELECT 1 FROM staff_role_permissions WHERE role=s.role AND permission=p)) THEN RAISE EXCEPTION 'CUSTODY_FORBIDDEN' USING ERRCODE='42501';END IF;
 END LOOP;
END$$;
REVOKE ALL ON FUNCTION rental_internal.assert_actor(text,text,text) FROM PUBLIC;

CREATE FUNCTION rental_apply_receipt(receipt_uuid uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE r rental_receipts;l rental_loan_items;c rental_return_candidates;b rental_return_batches;booking rental_bookings;dest uuid;ready uuid;now_at timestamptz;
BEGIN
 PERFORM pg_advisory_xact_lock(71820600);
 SELECT * INTO r FROM rental_receipts WHERE id=receipt_uuid;
 IF NOT FOUND THEN RAISE EXCEPTION 'CUSTODY_NOT_FOUND' USING ERRCODE='23514';END IF;
 SELECT * INTO STRICT c FROM rental_return_candidates WHERE id=r.candidate_id;
 SELECT * INTO STRICT b FROM rental_return_batches WHERE id=c.batch_id;
 PERFORM rental_internal.assert_actor('RENTAL_RETURN',r.received_store,r.actor);
 IF b.owner_id<>r.actor OR b.store_id<>r.received_store THEN RAISE EXCEPTION 'CUSTODY_FORBIDDEN' USING ERRCODE='42501';END IF;
 IF EXISTS(SELECT 1 FROM rental_custody_events WHERE receipt_id=r.id) THEN RETURN;END IF;
 SELECT * INTO STRICT l FROM rental_loan_items WHERE id=r.loan_item_id;
 SELECT * INTO STRICT booking FROM rental_bookings WHERE id=l.booking_id;
 now_at:=inventory_clock();
 IF l.state<>'OUT' OR c.state<>'CANDIDATE' OR c.loan_item_id<>l.id OR c.cycle_id<>l.cycle_id OR c.loan_version<>l.version OR c.asset_id IS DISTINCT FROM l.asset_id OR c.pole_id IS DISTINCT FROM l.pole_id OR r.scanned_at<>c.scanned_at OR r.actual_received_at<l.checked_out_at OR r.confirmed_at>now_at OR r.confirmed_at<r.scanned_at OR r.confirmed_at<r.actual_received_at THEN RAISE EXCEPTION 'CUSTODY_STALE_OR_INVALID_RECEIPT' USING ERRCODE='23514';END IF;
 IF l.asset_id IS NOT NULL THEN
  INSERT INTO rental_internal.effects(tx,pid,receipt_id,asset_id,store_id) VALUES(txid_current(),pg_backend_pid(),r.id,l.asset_id,r.received_store);
  UPDATE ledger_assets SET store_id=r.received_store WHERE id=l.asset_id;
 ELSE
  SELECT id INTO dest FROM ledger_poles WHERE variant_id=l.variant_id AND store_id=r.received_store AND status='MAINTENANCE';
  IF dest IS NULL THEN INSERT INTO ledger_poles(variant_id,store_id,quantity,status,notes,source_kind,source_document,source_locator) VALUES(l.variant_id,r.received_store,0,'MAINTENANCE','Received PAIR pending inspection','SYNTHETIC','CUSTODY_BOUNDARY_R1',l.variant_id::text||'/'||r.received_store||'/MAINTENANCE') RETURNING id INTO dest;END IF;
  SELECT id INTO ready FROM ledger_poles WHERE variant_id=l.variant_id AND store_id=r.received_store AND status='AVAILABLE';
  IF ready IS NULL THEN INSERT INTO ledger_poles(variant_id,store_id,quantity,status,notes,source_kind,source_document,source_locator) VALUES(l.variant_id,r.received_store,0,'AVAILABLE','Inspected PAIR; calendar blocks remain','SYNTHETIC','CUSTODY_BOUNDARY_R1',l.variant_id::text||'/'||r.received_store||'/AVAILABLE') RETURNING id INTO ready;END IF;
  INSERT INTO rental_internal.effects(tx,pid,receipt_id,pole_id,delta) VALUES(txid_current(),pg_backend_pid(),r.id,l.pole_id,-1),(txid_current(),pg_backend_pid(),r.id,dest,1);
  UPDATE ledger_poles SET quantity=quantity-1 WHERE id=l.pole_id;
  UPDATE ledger_poles SET quantity=quantity+1 WHERE id=dest;
 END IF;
 UPDATE transfer_batches t SET issue='CUSTODY_RECONCILIATION_REQUIRED',version=version+1 WHERE t.state<>'CANCELLED' AND EXISTS(SELECT 1 FROM transfer_pieces p WHERE p.batch_id=t.id AND p.state NOT IN ('CANCELLED','CLOSED') AND (p.asset_id=l.asset_id AND t.source_store<>r.received_store OR p.source_pole_id=l.pole_id));
 -- Exact booking + requirement + physical witness only. No other promise is released.
 UPDATE inventory_claims SET active=false WHERE hold_id=booking.hold_id AND requirement_key=l.requirement_key AND active AND asset_id IS NOT DISTINCT FROM l.asset_id AND pole_id IS NOT DISTINCT FROM l.pole_id;
 UPDATE inventory_holds SET transfer_attention='CUSTODY_RECONCILIATION_REQUIRED',version=version+1 WHERE id<>booking.hold_id AND state='ACTIVE' AND id IN(SELECT hold_id FROM inventory_claims WHERE active AND (asset_id=l.asset_id OR pole_id=l.pole_id OR transfer_piece_id IN(SELECT p.id FROM transfer_pieces p JOIN transfer_batches t ON t.id=p.batch_id WHERE (p.asset_id=l.asset_id OR p.source_pole_id=l.pole_id) AND t.issue='CUSTODY_RECONCILIATION_REQUIRED')));
 INSERT INTO rental_custody_events VALUES(r.id,l.id,l.pickup_store,r.received_store,dest,ready,now_at);
 UPDATE rental_loan_items SET state='RECEIVED',version=version+1 WHERE id=l.id;
 UPDATE rental_return_candidates SET state='RECEIVED',outcome='RECEIVED' WHERE id=c.id;
 DELETE FROM rental_internal.effects WHERE tx=txid_current() AND pid=pg_backend_pid() AND receipt_id=r.id;
END$$;
REVOKE ALL ON FUNCTION rental_apply_receipt(uuid) FROM PUBLIC;

CREATE FUNCTION rental_apply_inspection(inspection_uuid uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$DECLARE i rental_inspections;l rental_loan_items;e rental_custody_events;r rental_receipts;BEGIN
 PERFORM pg_advisory_xact_lock(71820600);SELECT * INTO i FROM rental_inspections WHERE id=inspection_uuid;
 IF NOT FOUND THEN RAISE EXCEPTION 'CUSTODY_NOT_FOUND' USING ERRCODE='23514';END IF;
 PERFORM rental_internal.assert_actor('RENTAL_RETURN',i.store_id,i.actor);
 IF EXISTS(SELECT 1 FROM rental_inspection_events WHERE inspection_id=i.id) THEN RETURN;END IF;
 SELECT * INTO STRICT l FROM rental_loan_items WHERE id=i.loan_item_id;
 SELECT * INTO STRICT e FROM rental_custody_events WHERE loan_item_id=l.id;
 SELECT * INTO STRICT r FROM rental_receipts WHERE id=e.receipt_id;
 IF l.state<>'RECEIVED' OR i.expected_version<>l.version OR i.store_id<>e.actual_store OR i.inspected_at<r.confirmed_at OR i.inspected_at>inventory_clock() THEN RAISE EXCEPTION 'CUSTODY_STALE_INSPECTION' USING ERRCODE='23514';END IF;
 IF l.pole_id IS NOT NULL THEN
  INSERT INTO rental_internal.effects(tx,pid,inspection_id,pole_id,delta) VALUES(txid_current(),pg_backend_pid(),i.id,e.received_pool,-1),(txid_current(),pg_backend_pid(),i.id,e.ready_pool,1);
  UPDATE ledger_poles SET quantity=quantity-1 WHERE id=e.received_pool;
  UPDATE ledger_poles SET quantity=quantity+1 WHERE id=e.ready_pool;
 END IF;
 INSERT INTO rental_inspection_events VALUES(i.id,l.id,inventory_clock());
 DELETE FROM rental_internal.effects WHERE tx=txid_current() AND pid=pg_backend_pid() AND inspection_id=i.id;
END$$;
REVOKE ALL ON FUNCTION rental_apply_inspection(uuid) FROM PUBLIC;

-- Also validates direct INSERT through the dedicated role. No executable generic admin API.
CREATE FUNCTION rental_validate_loan() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$DECLARE b rental_bookings;h inventory_holds;m jsonb;it jsonb;v record;now_at timestamptz;BEGIN
 PERFORM pg_advisory_xact_lock(71820600);
 PERFORM rental_internal.assert_actor('RENTAL_CHECKOUT',NEW.pickup_store,NEW.checked_out_by);
 SELECT * INTO STRICT b FROM rental_bookings WHERE id=NEW.booking_id;SELECT * INTO STRICT h FROM inventory_holds WHERE id=b.hold_id;
 now_at:=inventory_clock();
 IF b.state<>'CONFIRMED_DEV' OR h.payment_state<>'SUCCESS' OR h.confirmed_at IS NULL OR h.state<>'ACTIVE' OR h.allocation_stage<>'PREPARATION_FIXED' OR h.transfer_attention IS NOT NULL OR NEW.cycle_id<>b.id OR NEW.pickup_store<>h.pickup_store OR NEW.due_at<>h.due_at OR NEW.checked_out_at>now_at OR NEW.state<>'OUT' OR NEW.version<>1 OR (now_at AT TIME ZONE 'Asia/Tokyo')::date<>h.occupancy_start OR now_at<h.starts_at OR now_at>=h.due_at OR (now_at AT TIME ZONE 'Asia/Tokyo')::time>=time '17:00' THEN RAISE EXCEPTION 'CUSTODY_CHECKOUT_INVALID' USING ERRCODE='23514';END IF;
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
REVOKE ALL ON FUNCTION rental_validate_loan() FROM PUBLIC;
CREATE TRIGGER rental_validate_loan BEFORE INSERT ON rental_loan_items FOR EACH ROW EXECUTE FUNCTION rental_validate_loan();

CREATE OR REPLACE VIEW rental_inventory_blocks AS
 SELECT l.id,l.asset_id,l.pole_id,(l.due_at AT TIME ZONE 'Asia/Tokyo')::date AS starts_on,'9999-12-31'::date AS ends_on,'OVERDUE_OUT'::text AS reason FROM rental_loan_items l WHERE l.state='OUT' AND l.due_at<=inventory_clock()
 UNION ALL SELECT l.id,l.asset_id,CASE WHEN i.inspection_id IS NOT NULL THEN e.ready_pool ELSE NULL END,(r.actual_received_at AT TIME ZONE 'Asia/Tokyo')::date,
 CASE WHEN i.inspection_id IS NULL THEN '9999-12-31'::date ELSE greatest((b.conditions->'period'->>'endDate')::date,(r.actual_received_at AT TIME ZONE 'Asia/Tokyo')::date) END,
 CASE WHEN i.inspection_id IS NULL THEN 'INSPECTION_PENDING' ELSE 'CONTRACT_DATE_BLOCK' END
 FROM rental_custody_events e JOIN rental_receipts r ON r.id=e.receipt_id JOIN rental_loan_items l ON l.id=e.loan_item_id JOIN rental_bookings b ON b.id=l.booking_id LEFT JOIN rental_inspection_events i ON i.loan_item_id=l.id;
CREATE OR REPLACE VIEW rental_actual_custody AS SELECT DISTINCT ON(l.asset_id) l.asset_id,e.actual_store,r.id AS receipt_id,r.actual_received_at,CASE WHEN i.inspection_id IS NULL THEN 'RETURNED_PENDING_INSPECTION' ELSE 'INSPECTED_DATE_BLOCK_APPLIES' END AS state FROM rental_custody_events e JOIN rental_receipts r ON r.id=e.receipt_id JOIN rental_loan_items l ON l.id=e.loan_item_id LEFT JOIN rental_inspection_events i ON i.loan_item_id=l.id WHERE l.asset_id IS NOT NULL ORDER BY l.asset_id,r.actual_received_at DESC,r.id DESC;

CREATE FUNCTION rental_internal.asset_effect(asset uuid,destination text) RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,pg_temp AS $$BEGIN
 IF current_user<>current_database()||'_custody_executor' THEN RETURN false;END IF;
 RETURN EXISTS(SELECT 1 FROM rental_internal.effects x JOIN rental_receipts r ON r.id=x.receipt_id JOIN rental_loan_items l ON l.id=r.loan_item_id JOIN rental_return_candidates c ON c.id=r.candidate_id WHERE x.tx=txid_current() AND x.pid=pg_backend_pid() AND x.asset_id=asset AND x.store_id=destination AND l.asset_id=asset AND l.state='OUT' AND l.version=c.loan_version AND r.received_store=destination AND r.actor=current_setting('zao.actor') AND NOT EXISTS(SELECT 1 FROM rental_custody_events WHERE receipt_id=r.id));
END$$;
REVOKE ALL ON FUNCTION rental_internal.asset_effect(uuid,text) FROM PUBLIC;
CREATE OR REPLACE FUNCTION ledger_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$DECLARE k text;owner_name text;BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Ledger deletion is not supported';END IF;
 IF coalesce(current_setting('zao.actor',true),'') !~ '^[A-Za-z0-9_-]{1,80}$' OR length(btrim(coalesce(current_setting('zao.reason',true),''))) NOT BETWEEN 1 AND 160 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Trusted mutation context required';END IF;
 SELECT pg_get_userbyid(relowner) INTO owner_name FROM pg_class WHERE oid=TG_RELID;
 IF TG_OP='UPDATE' THEN
  FOREACH k IN ARRAY ARRAY['id','code','model_id','variant_id','family','age','tier','size','store_id','initial_store_id','source_kind','source_document','source_locator','created_at'] LOOP
   IF to_jsonb(NEW)->k IS DISTINCT FROM to_jsonb(OLD)->k THEN
    IF k='store_id' AND TG_TABLE_NAME='ledger_assets' THEN
     IF current_user=current_database()||'_custody_executor' THEN
      IF rental_internal.asset_effect(NEW.id,to_jsonb(NEW)->>'store_id') THEN CONTINUE;END IF;
     ELSIF current_user=owner_name AND NOT EXISTS(SELECT 1 FROM rental_loan_items WHERE asset_id=NEW.id AND state='OUT') AND EXISTS(SELECT 1 FROM transfer_pieces p JOIN transfer_batches b ON b.id=p.batch_id WHERE p.asset_id=NEW.id AND p.state='RECEIVED' AND b.destination_store=to_jsonb(NEW)->>'store_id') THEN CONTINUE;
     END IF;
    END IF;
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Immutable ledger identity or custody';
   END IF;
  END LOOP;NEW.version:=OLD.version+1;NEW.updated_at:=clock_timestamp();
 ELSE IF NEW.version<>1 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Invalid initial version';END IF;END IF;RETURN NEW;
END$$;
CREATE OR REPLACE FUNCTION ledger_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$BEGIN
 INSERT INTO ledger_history(resource,entity_id,action,actor,reason,before_data,after_data) VALUES(TG_ARGV[0],NEW.id,CASE WHEN TG_OP='INSERT' THEN 'REGISTER' ELSE 'UPDATE' END,current_setting('zao.actor'),current_setting('zao.reason'),CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) ELSE NULL END,to_jsonb(NEW));
 IF TG_TABLE_NAME='ledger_assets' THEN
  IF TG_OP='INSERT' THEN INSERT INTO ledger_locations(asset_id,store_id,event) VALUES(NEW.id,NEW.initial_store_id,'INITIAL_REGISTRATION');
  ELSIF NEW.store_id<>OLD.store_id THEN INSERT INTO ledger_locations(asset_id,store_id,event) VALUES(NEW.id,NEW.store_id,CASE WHEN EXISTS(SELECT 1 FROM rental_internal.effects WHERE tx=txid_current() AND pid=pg_backend_pid() AND asset_id=NEW.id AND store_id=NEW.store_id AND receipt_id IS NOT NULL) THEN 'RETURN_RECEIPT' ELSE 'TRANSFER_RECEIPT' END);END IF;
 END IF;RETURN NEW;
END$$;
CREATE OR REPLACE FUNCTION inventory_stock_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,pg_temp AS $$DECLARE owner_name text;BEGIN
 SELECT pg_get_userbyid(relowner) INTO owner_name FROM pg_class WHERE oid=TG_RELID;
 IF current_user=current_database()||'_custody_executor' AND TG_TABLE_NAME='ledger_poles' THEN
  IF EXISTS(SELECT 1 FROM rental_internal.effects WHERE tx=txid_current() AND pid=pg_backend_pid() AND pole_id=NEW.id AND delta=NEW.quantity-OLD.quantity AND NEW.status=OLD.status) THEN RETURN NEW;END IF;
 END IF;
 IF current_user=owner_name AND current_setting('zao.transfer_operation',true)='controlled' THEN
  IF TG_TABLE_NAME='ledger_poles' THEN
   IF NEW.quantity<(SELECT count(*) FROM rental_loan_items WHERE pole_id=NEW.id AND state='OUT') THEN RAISE EXCEPTION 'Loaned pairs cannot move' USING ERRCODE='23514';END IF;
  END IF;RETURN NEW;END IF;
 IF (TG_TABLE_NAME='ledger_assets' AND EXISTS(SELECT 1 FROM rental_loan_items l LEFT JOIN rental_inspection_events i ON i.loan_item_id=l.id WHERE l.asset_id=NEW.id AND (l.state='OUT' OR i.inspection_id IS NULL))) OR (TG_TABLE_NAME='ledger_poles' AND EXISTS(SELECT 1 FROM rental_loan_items l WHERE l.pole_id=NEW.id AND l.state='OUT')) THEN
  IF NEW.status IS DISTINCT FROM OLD.status OR (TG_TABLE_NAME='ledger_poles' AND to_jsonb(NEW)->'quantity' IS DISTINCT FROM to_jsonb(OLD)->'quantity') THEN RAISE EXCEPTION 'Custody protected stock' USING ERRCODE='23514';END IF;
 END IF;
 IF NEW.status=OLD.status AND (TG_TABLE_NAME='ledger_assets' OR to_jsonb(NEW)->'quantity'=to_jsonb(OLD)->'quantity') THEN RETURN NEW;END IF;
 IF TG_TABLE_NAME='ledger_assets' THEN
  IF NEW.status<>'AVAILABLE' AND (EXISTS(SELECT 1 FROM inventory_claims WHERE asset_id=NEW.id AND active) OR EXISTS(SELECT 1 FROM transfer_pieces WHERE asset_id=NEW.id AND state NOT IN ('CANCELLED','CLOSED'))) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Protected inventory requires reconciliation';END IF;
 ELSE
  IF (NEW.quantity<>OLD.quantity OR NEW.status<>OLD.status) AND EXISTS(SELECT 1 FROM transfer_pieces WHERE (source_pole_id=NEW.id OR destination_pole_id=NEW.id OR receipt_pole_id=NEW.id) AND state NOT IN ('CANCELLED','CLOSED')) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Protected transfer quantity';END IF;
  IF EXISTS(SELECT 1 FROM inventory_claims WHERE pole_id=NEW.id AND active AND transfer_piece_id IS NULL AND (NEW.status<>'AVAILABLE' OR pole_slot>NEW.quantity)) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Protected quantity requires reconciliation';END IF;
 END IF;RETURN NEW;
END$$;

-- No membership is granted to the executor/table/migration owners. No app DDL.
DO $$DECLARE executor text:=current_database()||'_custody_executor';app text:=current_database()||'_custody';f text;BEGIN
 EXECUTE format('ALTER SCHEMA rental_internal OWNER TO %I',executor);
 EXECUTE format('ALTER TABLE rental_internal.effects OWNER TO %I',executor);
 EXECUTE format('GRANT USAGE ON SCHEMA public TO %I',executor);
 EXECUTE format('GRANT SELECT ON staff_members,staff_store_access,staff_permission_overrides,staff_role_permissions,ledger_assets,ledger_poles,ledger_variants,ledger_models,inventory_holds,inventory_claims,inventory_constraints,transfer_pieces,transfer_batches,rental_bookings,rental_preparations,rental_loan_items,rental_return_candidates,rental_return_batches,rental_receipts,rental_inspections,rental_custody_events,rental_inspection_events,rental_inventory_blocks TO %I',executor);
 EXECUTE format('GRANT SELECT(id,"userId","expiresAt"),UPDATE(id) ON auth_session TO %I',executor); -- required only for FOR SHARE; no public mutator reaches this grant
 EXECUTE format('GRANT UPDATE(store_id) ON ledger_assets TO %I',executor);
 EXECUTE format('GRANT INSERT,UPDATE(quantity) ON ledger_poles TO %I',executor);
 EXECUTE format('GRANT UPDATE(active) ON inventory_claims TO %I',executor);
 EXECUTE format('GRANT UPDATE(transfer_attention,version) ON inventory_holds TO %I',executor);
 EXECUTE format('GRANT UPDATE(issue,version) ON transfer_batches TO %I',executor);
 EXECUTE format('GRANT UPDATE(state,version) ON rental_loan_items TO %I',executor);
 EXECUTE format('GRANT UPDATE(state,outcome) ON rental_return_candidates TO %I',executor);
 EXECUTE format('GRANT INSERT ON rental_custody_events,rental_inspection_events TO %I',executor);
 EXECUTE format('GRANT EXECUTE ON FUNCTION inventory_clock() TO %I',executor);
 FOREACH f IN ARRAY ARRAY['rental_apply_receipt(uuid)','rental_apply_inspection(uuid)','rental_validate_loan()','rental_internal.assert_actor(text,text,text)','rental_internal.asset_effect(uuid,text)'] LOOP
  EXECUTE format('ALTER FUNCTION %s OWNER TO %I',f,executor);
 END LOOP;
 EXECUTE format('GRANT USAGE ON SCHEMA public TO %I',app);
 EXECUTE format('GRANT EXECUTE ON FUNCTION rental_apply_receipt(uuid),rental_apply_inspection(uuid),inventory_clock() TO %I',app);
END$$;

-- A custody client cannot use its narrow stage grant to unfix another allocation.
CREATE FUNCTION rental_stage_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$DECLARE b rental_bookings;BEGIN
 IF session_user<>current_database()||'_custody' OR NEW.allocation_stage=OLD.allocation_stage THEN RETURN NEW;END IF;
 PERFORM rental_internal.assert_actor('RENTAL_CHECKOUT',OLD.pickup_store,current_setting('zao.actor',true));
 SELECT * INTO b FROM rental_bookings WHERE hold_id=OLD.id;
 IF NOT FOUND OR b.state<>'CONFIRMED_DEV' OR OLD.payment_state<>'SUCCESS' OR OLD.transfer_attention IS NOT NULL THEN RAISE EXCEPTION 'CUSTODY_STAGE_INVALID' USING ERRCODE='23514';END IF;
 IF OLD.allocation_stage='PROVISIONAL' AND NEW.allocation_stage='PREPARATION_FIXED' AND EXISTS(SELECT 1 FROM rental_preparations WHERE id=b.id AND prepared_at IS NOT NULL) THEN RETURN NEW;END IF;
 IF OLD.allocation_stage='PREPARATION_FIXED' AND NEW.allocation_stage='RENTAL_FIXED' AND (SELECT count(*) FROM rental_loan_items WHERE booking_id=b.id AND state='OUT')=(SELECT count(*) FROM jsonb_array_elements(b.conditions->'members') m CROSS JOIN LATERAL jsonb_array_elements(m->'items') i WHERE i->>'family' NOT IN ('WEAR_JACKET','WEAR_PANTS')) THEN RETURN NEW;END IF;
 RAISE EXCEPTION 'CUSTODY_STAGE_INVALID' USING ERRCODE='23514';
END$$;
REVOKE ALL ON FUNCTION rental_stage_guard() FROM PUBLIC;
CREATE TRIGGER rental_stage_guard BEFORE UPDATE OF allocation_stage ON inventory_holds FOR EACH ROW EXECUTE FUNCTION rental_stage_guard();
DO $$BEGIN EXECUTE format('ALTER FUNCTION rental_stage_guard() OWNER TO %I',current_database()||'_custody_executor');END$$;

-- Actual at-store quantity excludes OUT pairs; the ledger's accounting pool is not a location count.
CREATE VIEW rental_pole_custody AS SELECT p.id,p.store_id,p.variant_id,p.status,p.quantity AS accounted_pairs,
 (SELECT count(*)::integer FROM rental_loan_items l WHERE l.pole_id=p.id AND l.state='OUT') AS out_pairs,
 p.quantity-(SELECT count(*)::integer FROM rental_loan_items l WHERE l.pole_id=p.id AND l.state='OUT') AS at_store_pairs FROM ledger_poles p;
CREATE FUNCTION rental_transfer_custody_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$BEGIN
 IF NEW.state IN ('IN_TRANSIT','RECEIVED') AND NEW.state<>OLD.state AND NEW.asset_id IS NOT NULL AND (EXISTS(SELECT 1 FROM rental_loan_items WHERE asset_id=NEW.asset_id AND state='OUT') OR EXISTS(SELECT 1 FROM rental_inventory_blocks WHERE asset_id=NEW.asset_id AND reason='INSPECTION_PENDING')) THEN RAISE EXCEPTION 'Custody blocks physical transfer' USING ERRCODE='23514';END IF;RETURN NEW;
END$$;
REVOKE ALL ON FUNCTION rental_transfer_custody_guard() FROM PUBLIC;
CREATE TRIGGER rental_transfer_custody_guard BEFORE UPDATE ON transfer_pieces FOR EACH ROW EXECUTE FUNCTION rental_transfer_custody_guard();

-- Ledger quantity is accounting stock, not period availability or physical at-store stock.
CREATE OR REPLACE VIEW ledger_records AS
SELECT 'models'::text AS resource,r.id,jsonb_build_object('id',r.id,'resource','models','notes',r.notes,'version',r.version,'sourceKind',r.source_kind,'sourceDocument',r.source_document,'sourceLocator',r.source_locator,'createdAt',r.created_at,'updatedAt',r.updated_at,'name',r.name,'code',r.code,'family',r.family,'brand',r.brand,'catalogSeason',r.catalog_season) AS data FROM ledger_models r
UNION ALL
SELECT 'variants'::text AS resource,r.id,jsonb_build_object('id',r.id,'resource','variants','notes',r.notes,'version',r.version,'sourceKind',r.source_kind,'sourceDocument',r.source_document,'sourceLocator',r.source_locator,'createdAt',r.created_at,'updatedAt',r.updated_at,'name',m.name,'code',r.id,'family',r.family,'modelId',r.model_id,'age',r.age,'tier',r.tier,'size',r.size,'compatibleSports',r.compatible_sports,'catalogSeason',m.catalog_season) AS data FROM ledger_variants r JOIN ledger_models m ON m.id=r.model_id
UNION ALL
SELECT 'assets'::text AS resource,r.id,jsonb_build_object('id',r.id,'resource','assets','notes',r.notes,'version',r.version,'sourceKind',r.source_kind,'sourceDocument',r.source_document,'sourceLocator',r.source_locator,'createdAt',r.created_at,'updatedAt',r.updated_at,'name',m.name,'code',r.label_code,'family',r.family,'variantId',r.variant_id,'age',v.age,'tier',v.tier,'size',v.size,'storeId',r.store_id,'initialStoreId',r.initial_store_id,'status',r.status,'unit',r.unit,'labelCopies',r.label_copies,'custody',CASE WHEN EXISTS(SELECT 1 FROM rental_loan_items l WHERE l.asset_id=r.id AND l.state='OUT') THEN 'OUT' WHEN EXISTS(SELECT 1 FROM rental_actual_custody c WHERE c.asset_id=r.id AND c.state='RETURNED_PENDING_INSPECTION') THEN 'RETURNED_PENDING_INSPECTION' ELSE coalesce((SELECT CASE WHEN p.state='IN_TRANSIT' THEN 'IN_TRANSIT' WHEN p.state='RECEIVED' THEN 'RECEIVED_PENDING_INSPECTION' ELSE r.store_id END FROM transfer_pieces p WHERE p.asset_id=r.id AND p.state NOT IN ('CANCELLED','CLOSED') LIMIT 1),r.store_id) END,'catalogSeason',m.catalog_season,'compatibleSports',v.compatible_sports,'bslStatus',r.bsl_status,'bslMm',r.bsl_mm,'bslEvidence',r.bsl_evidence) AS data FROM ledger_assets r JOIN ledger_variants v ON v.id=r.variant_id JOIN ledger_models m ON m.id=v.model_id
UNION ALL
SELECT 'poles'::text AS resource,r.id,jsonb_build_object('id',r.id,'resource','poles','notes',r.notes,'version',r.version,'sourceKind',r.source_kind,'sourceDocument',r.source_document,'sourceLocator',r.source_locator,'createdAt',r.created_at,'updatedAt',r.updated_at,'name',m.name,'code',r.id,'family',r.family,'variantId',r.variant_id,'age',v.age,'tier',v.tier,'size',v.size,'storeId',r.store_id,'status',r.status,'quantity',r.quantity,'outPairs',(SELECT q.out_pairs FROM rental_pole_custody q WHERE q.id=r.id),'atStorePairs',(SELECT q.at_store_pairs FROM rental_pole_custody q WHERE q.id=r.id),'unit',r.unit) AS data FROM ledger_poles r JOIN ledger_variants v ON v.id=r.variant_id JOIN ledger_models m ON m.id=v.model_id
UNION ALL
SELECT 'bundles'::text AS resource,r.id,jsonb_build_object('id',r.id,'resource','bundles','notes',r.notes,'version',r.version,'sourceKind',r.source_kind,'sourceDocument',r.source_document,'sourceLocator',r.source_locator,'createdAt',r.created_at,'updatedAt',r.updated_at,'name',r.name,'code',r.code,'family',r.family,'age',r.age,'tier',r.tier,'components',(SELECT jsonb_agg(jsonb_build_object('family',c.family,'quantity',c.quantity,'unit',c.unit) ORDER BY c.family) FROM ledger_bundle_components c WHERE c.bundle_id=r.id)) AS data FROM ledger_bundles r;
