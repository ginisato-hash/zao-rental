-- M1: local operations records. Historical migrations0001-0032 remain unchanged.
-- migrate() applies the complete pending plan atomically; do not run against a hosted DB.
DO $$BEGIN
 IF current_database() !~ '^zr_[a-f0-9]{12}$' THEN RAISE EXCEPTION 'Dedicated development database required';END IF;
END$$;
ALTER TABLE staff_role_permissions DROP CONSTRAINT staff_role_permissions_permission_check;
ALTER TABLE staff_permission_overrides DROP CONSTRAINT staff_permission_overrides_permission_check;
ALTER TABLE staff_role_permissions ADD CHECK(permission IN ('INVENTORY_VIEW','INVENTORY_EDIT','STAFF_MANAGE','HOLD_VIEW','HOLD_EDIT','TRANSFER_VIEW','TRANSFER_PLAN','TRANSFER_DISPATCH','TRANSFER_RECEIVE','QUOTE_VIEW','QUOTE_CREATE','PRICE_EDIT','BOOKING_VIEW','BOOKING_CREATE','RENTAL_CHECKOUT','RENTAL_RETURN','RENTAL_AMEND','REFUND_OVERRIDE','INVENTORY_RECONCILE'));
ALTER TABLE staff_permission_overrides ADD CHECK(permission IN ('INVENTORY_VIEW','INVENTORY_EDIT','STAFF_MANAGE','HOLD_VIEW','HOLD_EDIT','TRANSFER_VIEW','TRANSFER_PLAN','TRANSFER_DISPATCH','TRANSFER_RECEIVE','QUOTE_VIEW','QUOTE_CREATE','PRICE_EDIT','BOOKING_VIEW','BOOKING_CREATE','RENTAL_CHECKOUT','RENTAL_RETURN','RENTAL_AMEND','REFUND_OVERRIDE','INVENTORY_RECONCILE'));
-- No role, including ADMIN, silently inherits the new financial/reconcile permissions.
CREATE TABLE ops_amendment_quotes(
 id uuid PRIMARY KEY,booking_id uuid NOT NULL REFERENCES rental_bookings(id),actor text NOT NULL REFERENCES staff_members(id),request_key uuid NOT NULL,
 fingerprint text NOT NULL CHECK(length(fingerprint)=64),expected_hold_version integer NOT NULL CHECK(expected_hold_version>0),
 before_conditions jsonb NOT NULL,conditions jsonb NOT NULL,quote jsonb NOT NULL,quote_sha256 text NOT NULL CHECK(length(quote_sha256)=64),
 loan_versions jsonb NOT NULL,assignment jsonb NOT NULL,reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 160),
 created_at timestamptz NOT NULL DEFAULT inventory_clock(),expires_at timestamptz NOT NULL,UNIQUE(actor,request_key),CHECK(expires_at>created_at)
);
CREATE TABLE ops_amendments(
 id uuid PRIMARY KEY REFERENCES ops_amendment_quotes(id),booking_id uuid NOT NULL REFERENCES rental_bookings(id),actor text NOT NULL REFERENCES staff_members(id),
 request_key uuid NOT NULL,fingerprint text NOT NULL CHECK(length(fingerprint)=64),fit_evidence text NOT NULL CHECK(length(fit_evidence)<=160),applied_at timestamptz NOT NULL DEFAULT inventory_clock(),UNIQUE(actor,request_key)
);
CREATE TABLE ops_charge_requests(
 id uuid PRIMARY KEY,booking_id uuid NOT NULL REFERENCES rental_bookings(id),amendment_id uuid NOT NULL UNIQUE REFERENCES ops_amendments(id),actor text NOT NULL REFERENCES staff_members(id),
 idempotency_key uuid NOT NULL UNIQUE,merchant_id text NOT NULL,location_id text NOT NULL,amount_jpy bigint NOT NULL CHECK(amount_jpy BETWEEN 1 AND 100000000),currency text NOT NULL CHECK(currency='JPY'),
 state text NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','UNKNOWN','COMPLETED','FAILED','REVIEW')),
 dispatched_at timestamptz,provider_id text,provider_state text,provider_updated_at timestamptz,completed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT inventory_clock(),updated_at timestamptz NOT NULL DEFAULT inventory_clock(),CHECK(state<>'COMPLETED' OR provider_id IS NOT NULL AND completed_at IS NOT NULL)
);
CREATE TABLE ops_refund_requests(
 id uuid PRIMARY KEY,booking_id uuid NOT NULL REFERENCES rental_bookings(id),payment_id uuid NOT NULL,payment_kind text NOT NULL CHECK(payment_kind IN ('ORIGINAL','ADDITIONAL')),
 actor text NOT NULL REFERENCES staff_members(id),acting_store text NOT NULL REFERENCES ledger_stores(id),request_key uuid NOT NULL,fingerprint text NOT NULL CHECK(length(fingerprint)=64),
 reason_category text NOT NULL CHECK(reason_category IN ('CUSTOMER_EXCEPTION','SERVICE_ISSUE','DUPLICATE_COLLECTION','OTHER_APPROVED')),reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 160),
 payment_provider_id text NOT NULL,merchant_id text NOT NULL,location_id text NOT NULL,amount_jpy bigint NOT NULL CHECK(amount_jpy BETWEEN 1 AND 100000000),currency text NOT NULL CHECK(currency='JPY'),
 collected_jpy bigint NOT NULL,previous_reserved_jpy bigint NOT NULL CHECK(previous_reserved_jpy>=0),policy_version text NOT NULL CHECK(policy_version='STAFF_EXCEPTION_V04'),
 state text NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','UNKNOWN','COMPLETED','FAILED','REVIEW')),
 dispatched_at timestamptz,provider_id text,provider_state text,provider_updated_at timestamptz,completed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT inventory_clock(),updated_at timestamptz NOT NULL DEFAULT inventory_clock(),UNIQUE(booking_id,request_key),
 CHECK(amount_jpy+previous_reserved_jpy<=collected_jpy),CHECK(state<>'COMPLETED' OR provider_id IS NOT NULL AND completed_at IS NOT NULL)
);
CREATE VIEW ops_collected_payments AS
 SELECT id,booking_id,'ORIGINAL'::text AS kind,merchant_id,location_id,amount_jpy,currency,provider_id,completed_at FROM rental_payment_attempts WHERE state='COMPLETED'
 UNION ALL SELECT id,booking_id,'ADDITIONAL',merchant_id,location_id,amount_jpy,currency,provider_id,completed_at FROM ops_charge_requests WHERE state='COMPLETED';
CREATE TABLE ops_history(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,resource text NOT NULL,entity_id uuid NOT NULL,actor text NOT NULL,event text NOT NULL,before_data jsonb,after_data jsonb NOT NULL,occurred_at timestamptz NOT NULL DEFAULT inventory_clock());
CREATE TRIGGER ops_history_immutable BEFORE UPDATE OR DELETE ON ops_history FOR EACH ROW EXECUTE FUNCTION pricing_immutable();
CREATE FUNCTION ops_assert_actor(required_permission text,required_stores text[],expected_actor text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$DECLARE s staff_members;BEGIN
 IF current_setting('zao.actor',true) IS DISTINCT FROM expected_actor THEN RAISE EXCEPTION 'OPS_FORBIDDEN' USING ERRCODE='42501';END IF;
 PERFORM pg_advisory_xact_lock_shared(71820901,hashtext(expected_actor));
 PERFORM 1 FROM auth_session WHERE id=current_setting('zao.session',true) AND "userId"=expected_actor AND "expiresAt">clock_timestamp() FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'OPS_SESSION_INVALID' USING ERRCODE='42501';END IF;
 SELECT * INTO s FROM staff_members WHERE id=expected_actor;
 IF NOT FOUND OR NOT s.active OR required_stores IS NULL OR EXISTS(SELECT 1 FROM unnest(required_stores) x WHERE NOT EXISTS(SELECT 1 FROM ledger_stores WHERE id=x)) OR (s.scope<>'ALL' AND EXISTS(SELECT 1 FROM unnest(required_stores) x WHERE NOT EXISTS(SELECT 1 FROM staff_store_access WHERE staff_id=s.id AND store_id=x))) THEN RAISE EXCEPTION 'OPS_FORBIDDEN' USING ERRCODE='42501';END IF;
 IF EXISTS(SELECT 1 FROM staff_permission_overrides WHERE staff_id=s.id AND permission=required_permission AND NOT allowed) OR NOT(EXISTS(SELECT 1 FROM staff_permission_overrides WHERE staff_id=s.id AND permission=required_permission AND allowed) OR EXISTS(SELECT 1 FROM staff_role_permissions WHERE role=s.role AND permission=required_permission)) THEN RAISE EXCEPTION 'OPS_FORBIDDEN' USING ERRCODE='42501';END IF;
END$$;
REVOKE ALL ON FUNCTION ops_assert_actor(text,text[],text) FROM PUBLIC;
CREATE FUNCTION ops_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$BEGIN
 INSERT INTO ops_history(resource,entity_id,actor,event,before_data,after_data) VALUES(TG_TABLE_NAME,NEW.id,current_setting('zao.actor'),TG_OP,CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) ELSE NULL END,to_jsonb(NEW));RETURN NEW;
END$$;
REVOKE ALL ON FUNCTION ops_audit() FROM PUBLIC;
CREATE FUNCTION ops_financial_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$DECLARE b rental_bookings;paid record;reserved bigint;BEGIN
 PERFORM pg_advisory_xact_lock(71820600);
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Immutable financial history' USING ERRCODE='23514';END IF;
 SELECT * INTO STRICT b FROM rental_bookings WHERE id=NEW.booking_id;
 IF TG_TABLE_NAME='ops_refund_requests' THEN
  PERFORM ops_assert_actor('BOOKING_VIEW',ARRAY[NEW.acting_store],current_setting('zao.actor',true));
  IF NEW.acting_store NOT IN (b.conditions->>'pickupStore',b.conditions->>'returnStore') AND NOT EXISTS(SELECT 1 FROM rental_receipts r JOIN rental_loan_items l ON l.id=r.loan_item_id WHERE l.booking_id=b.id AND r.received_store=NEW.acting_store) THEN RAISE EXCEPTION 'Refund booking scope denied' USING ERRCODE='42501';END IF;
  PERFORM ops_assert_actor('REFUND_OVERRIDE',ARRAY[NEW.acting_store],current_setting('zao.actor',true));
 ELSE PERFORM ops_assert_actor('BOOKING_VIEW',ARRAY[b.conditions->>'pickupStore',b.conditions->>'returnStore'],current_setting('zao.actor',true));PERFORM ops_assert_actor('RENTAL_AMEND',ARRAY[b.conditions->>'pickupStore',b.conditions->>'returnStore'],current_setting('zao.actor',true));END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.actor IS DISTINCT FROM current_setting('zao.actor',true) OR NEW.state<>'PENDING' OR NEW.dispatched_at IS NOT NULL OR NEW.provider_id IS NOT NULL OR NEW.provider_state IS NOT NULL OR NEW.provider_updated_at IS NOT NULL OR NEW.completed_at IS NOT NULL THEN RAISE EXCEPTION 'Invalid initial financial request' USING ERRCODE='23514';END IF;
  IF TG_TABLE_NAME='ops_refund_requests' THEN
   SELECT * INTO paid FROM ops_collected_payments WHERE id=NEW.payment_id AND booking_id=NEW.booking_id AND kind=NEW.payment_kind;
   IF NOT FOUND OR paid.provider_id IS NULL OR paid.provider_id<>NEW.payment_provider_id OR paid.merchant_id<>NEW.merchant_id OR paid.location_id<>NEW.location_id OR paid.amount_jpy<>NEW.collected_jpy OR paid.currency<>NEW.currency THEN RAISE EXCEPTION 'Refund original payment mismatch' USING ERRCODE='23514';END IF;
   IF EXISTS(SELECT 1 FROM ops_refund_requests WHERE booking_id=NEW.booking_id AND state IN ('PENDING','UNKNOWN','REVIEW')) OR EXISTS(SELECT 1 FROM ops_financial_alerts WHERE booking_id=NEW.booking_id) THEN RAISE EXCEPTION 'Refund reconciliation required' USING ERRCODE='23514';END IF;
   SELECT coalesce(sum(amount_jpy),0) INTO reserved FROM ops_refund_requests WHERE payment_id=NEW.payment_id AND payment_kind=NEW.payment_kind AND state<>'FAILED';
   IF reserved<>NEW.previous_reserved_jpy OR reserved+NEW.amount_jpy>paid.amount_jpy THEN RAISE EXCEPTION 'Refund cap exceeded' USING ERRCODE='23514';END IF;
  ELSE
   IF NOT EXISTS(SELECT 1 FROM ops_amendments a JOIN ops_amendment_quotes q ON q.id=a.id JOIN rental_payment_attempts p ON p.booking_id=a.booking_id WHERE a.id=NEW.amendment_id AND a.booking_id=NEW.booking_id AND (q.quote->>'additionalChargeJpy')::bigint=NEW.amount_jpy AND p.state='COMPLETED' AND p.merchant_id=NEW.merchant_id AND p.location_id=NEW.location_id AND p.currency=NEW.currency) THEN RAISE EXCEPTION 'Charge quote mismatch' USING ERRCODE='23514';END IF;
  END IF;
 ELSE
  IF (to_jsonb(NEW)-ARRAY['state','dispatched_at','provider_id','provider_state','provider_updated_at','completed_at','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','dispatched_at','provider_id','provider_state','provider_updated_at','completed_at','updated_at']) OR OLD.state IN ('COMPLETED','FAILED','REVIEW') OR (OLD.dispatched_at IS NOT NULL AND NEW.dispatched_at IS DISTINCT FROM OLD.dispatched_at) OR (OLD.provider_id IS NOT NULL AND NEW.provider_id IS DISTINCT FROM OLD.provider_id) OR (OLD.provider_updated_at IS NOT NULL AND (NEW.provider_updated_at IS NULL OR NEW.provider_updated_at<OLD.provider_updated_at)) THEN RAISE EXCEPTION 'Immutable financial request' USING ERRCODE='23514';END IF;
  IF OLD.dispatched_at IS NULL AND (NEW.state<>'UNKNOWN' OR NEW.dispatched_at IS NULL OR NEW.provider_id IS NOT NULL OR NEW.provider_state IS NOT NULL OR NEW.provider_updated_at IS NOT NULL OR NEW.completed_at IS NOT NULL) THEN RAISE EXCEPTION 'Persist unknown before provider dispatch' USING ERRCODE='23514';END IF;
 END IF;
 RETURN NEW;
END$$;
REVOKE ALL ON FUNCTION ops_financial_guard() FROM PUBLIC;
CREATE TRIGGER ops_charge_guard BEFORE INSERT OR UPDATE OR DELETE ON ops_charge_requests FOR EACH ROW EXECUTE FUNCTION ops_financial_guard();
CREATE TRIGGER ops_refund_guard BEFORE INSERT OR UPDATE OR DELETE ON ops_refund_requests FOR EACH ROW EXECUTE FUNCTION ops_financial_guard();
CREATE TABLE ops_import_stages(id uuid PRIMARY KEY,actor text NOT NULL REFERENCES staff_members(id),stage jsonb NOT NULL,stage_sha256 text NOT NULL CHECK(length(stage_sha256)=64),created_at timestamptz NOT NULL DEFAULT inventory_clock());
CREATE TABLE ops_import_sources(source_key text PRIMARY KEY,source_sha256 text NOT NULL CHECK(length(source_sha256)=64),stage_id uuid NOT NULL REFERENCES ops_import_stages(id),actor text NOT NULL REFERENCES staff_members(id),committed_at timestamptz NOT NULL DEFAULT inventory_clock());
CREATE TABLE ops_import_commits(id uuid PRIMARY KEY REFERENCES ops_import_stages(id),actor text NOT NULL REFERENCES staff_members(id),request_key uuid NOT NULL,stage_sha256 text NOT NULL CHECK(length(stage_sha256)=64),result jsonb NOT NULL,committed_at timestamptz NOT NULL DEFAULT inventory_clock(),UNIQUE(actor,request_key));
CREATE TABLE ops_stocktakes(id uuid PRIMARY KEY,store_id text NOT NULL REFERENCES ledger_stores(id),actor text NOT NULL REFERENCES staff_members(id),request_key uuid NOT NULL,baseline jsonb NOT NULL,observations jsonb NOT NULL DEFAULT '{"assets":[],"quantities":{}}',revision integer NOT NULL DEFAULT 1 CHECK(revision>0),state text NOT NULL DEFAULT 'COUNTING' CHECK(state IN ('COUNTING','REVIEW_REQUIRED','RECONCILED')),created_at timestamptz NOT NULL DEFAULT inventory_clock(),UNIQUE(actor,request_key));
CREATE TABLE ops_stocktake_reconciliations(id uuid PRIMARY KEY,stocktake_id uuid NOT NULL REFERENCES ops_stocktakes(id),actor text NOT NULL REFERENCES staff_members(id),request_key uuid NOT NULL,reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 160),before_data jsonb NOT NULL,after_data jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT inventory_clock(),UNIQUE(actor,request_key));
CREATE TABLE ops_requests(actor text NOT NULL REFERENCES staff_members(id),request_key uuid NOT NULL,fingerprint text NOT NULL CHECK(length(fingerprint)=64),result jsonb NOT NULL,PRIMARY KEY(actor,request_key));
DO $$DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['ops_amendment_quotes','ops_amendments','ops_import_stages','ops_import_commits','ops_stocktake_reconciliations','ops_requests','ops_import_sources'] LOOP
  EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION pricing_immutable()',t||'_immutable',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['ops_amendment_quotes','ops_amendments','ops_charge_requests','ops_refund_requests','ops_import_stages','ops_import_commits','ops_stocktakes','ops_stocktake_reconciliations'] LOOP
  EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH STATEMENT EXECUTE FUNCTION inventory_lock()',t||'_lock',t);
  EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION ops_audit()',t||'_audit',t);
 END LOOP;
END$$;

-- Each exchange starts a new immutable loan generation. Original rows are retained.
ALTER TABLE rental_loan_items ADD COLUMN amendment_id uuid REFERENCES ops_amendments(id);
ALTER TABLE rental_loan_items DROP CONSTRAINT rental_loan_items_booking_id_requirement_key_key;
CREATE UNIQUE INDEX rental_initial_requirement ON rental_loan_items(booking_id,requirement_key) WHERE amendment_id IS NULL;
CREATE UNIQUE INDEX rental_amended_requirement ON rental_loan_items(amendment_id,requirement_key) WHERE amendment_id IS NOT NULL;
CREATE UNIQUE INDEX rental_active_requirement ON rental_loan_items(booking_id,requirement_key) WHERE state='OUT';
ALTER TABLE wear_loans ADD COLUMN amendment_id uuid REFERENCES ops_amendments(id);
ALTER TABLE wear_loans DROP CONSTRAINT wear_loans_booking_id_requirement_key_key;
CREATE UNIQUE INDEX wear_initial_requirement ON wear_loans(booking_id,requirement_key) WHERE amendment_id IS NULL;
CREATE UNIQUE INDEX wear_amended_requirement ON wear_loans(amendment_id,requirement_key) WHERE amendment_id IS NOT NULL;
CREATE UNIQUE INDEX wear_active_requirement ON wear_loans(booking_id,requirement_key) WHERE returned<quantity;

-- Snapshot the effective contract at receipt without editing historical receipt rows.
CREATE TABLE ops_receipt_terms(receipt_id uuid PRIMARY KEY REFERENCES rental_receipts(id),contracted_end_on date NOT NULL);
CREATE TRIGGER ops_receipt_terms_immutable BEFORE UPDATE OR DELETE ON ops_receipt_terms FOR EACH ROW EXECUTE FUNCTION pricing_immutable();
CREATE FUNCTION ops_receipt_terms_capture() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$BEGIN
 INSERT INTO ops_receipt_terms SELECT NEW.id,greatest((b.conditions->'period'->>'endDate')::date,h.occupancy_end) FROM rental_loan_items l JOIN rental_bookings b ON b.id=l.booking_id JOIN inventory_holds h ON h.id=b.hold_id WHERE l.id=NEW.loan_item_id;RETURN NEW;
END$$;
REVOKE ALL ON FUNCTION ops_receipt_terms_capture() FROM PUBLIC;
CREATE TRIGGER ops_receipt_terms_capture AFTER INSERT ON rental_receipts FOR EACH ROW EXECUTE FUNCTION ops_receipt_terms_capture();
CREATE OR REPLACE VIEW rental_inventory_blocks AS
 SELECT l.id,l.asset_id,l.pole_id,(h.due_at AT TIME ZONE 'Asia/Tokyo')::date AS starts_on,'9999-12-31'::date AS ends_on,'OVERDUE_OUT'::text AS reason FROM rental_loan_items l JOIN rental_bookings b ON b.id=l.booking_id JOIN inventory_holds h ON h.id=b.hold_id WHERE l.state='OUT' AND h.due_at<=inventory_clock()
 UNION ALL SELECT l.id,l.asset_id,CASE WHEN i.inspection_id IS NOT NULL THEN e.ready_pool ELSE NULL END,(r.actual_received_at AT TIME ZONE 'Asia/Tokyo')::date,
 CASE WHEN i.inspection_id IS NULL THEN '9999-12-31'::date ELSE greatest(coalesce(t.contracted_end_on,(b.conditions->'period'->>'endDate')::date),(r.actual_received_at AT TIME ZONE 'Asia/Tokyo')::date) END,
 CASE WHEN i.inspection_id IS NULL THEN 'INSPECTION_PENDING' ELSE 'CONTRACT_DATE_BLOCK' END
 FROM rental_custody_events e JOIN rental_receipts r ON r.id=e.receipt_id JOIN rental_loan_items l ON l.id=e.loan_item_id JOIN rental_bookings b ON b.id=l.booking_id LEFT JOIN rental_inspection_events i ON i.loan_item_id=l.id LEFT JOIN ops_receipt_terms t ON t.receipt_id=r.id;
CREATE TABLE rental_internal.amendment_effects(tx bigint NOT NULL,pid integer NOT NULL,amendment_id uuid NOT NULL,new_loan_id uuid NOT NULL PRIMARY KEY);
REVOKE ALL ON rental_internal.amendment_effects FROM PUBLIC;
DO $$BEGIN EXECUTE format('ALTER TABLE rental_internal.amendment_effects OWNER TO %I',current_database()||'_custody_executor');END$$;

CREATE OR REPLACE FUNCTION rental_validate_loan() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$DECLARE b rental_bookings;h inventory_holds;m jsonb;it jsonb;v record;now_at timestamptz;exchange boolean;start_on date;BEGIN
 PERFORM pg_advisory_xact_lock(71820600);
 PERFORM rental_internal.assert_actor('RENTAL_CHECKOUT',NEW.pickup_store,NEW.checked_out_by);
 SELECT * INTO STRICT b FROM rental_bookings WHERE id=NEW.booking_id;SELECT * INTO STRICT h FROM inventory_holds WHERE id=b.hold_id;
 now_at:=inventory_clock();exchange:=NEW.amendment_id IS NOT NULL;start_on:=CASE WHEN exchange THEN greatest(h.occupancy_start,(now_at AT TIME ZONE 'Asia/Tokyo')::date) ELSE h.occupancy_start END;
 IF exchange AND NOT EXISTS(SELECT 1 FROM rental_internal.amendment_effects e WHERE e.tx=txid_current() AND e.pid=pg_backend_pid() AND e.amendment_id=NEW.amendment_id AND e.new_loan_id=NEW.id) THEN RAISE EXCEPTION 'AMENDMENT_CHECKOUT_EFFECT_REQUIRED' USING ERRCODE='23514';END IF;
 IF b.state<>'CONFIRMED_DEV' OR h.payment_state<>'SUCCESS' OR h.confirmed_at IS NULL OR h.state<>'ACTIVE' OR h.allocation_stage<>(CASE WHEN exchange THEN 'RENTAL_FIXED' ELSE 'PREPARATION_FIXED' END) OR h.transfer_attention IS NOT NULL OR NEW.cycle_id<>b.id OR NEW.pickup_store<>h.pickup_store OR NEW.due_at<>h.due_at OR NEW.checked_out_at>now_at OR NEW.state<>'OUT' OR NEW.version<>1 OR ((now_at AT TIME ZONE 'Asia/Tokyo')::date<>h.occupancy_start AND (h.conditions->'period'->>'slot'<>'MULTIDAY' OR (now_at AT TIME ZONE 'Asia/Tokyo')::date<h.occupancy_start OR (now_at AT TIME ZONE 'Asia/Tokyo')::date>h.occupancy_end)) OR (now_at AT TIME ZONE 'Asia/Tokyo')::time<time '08:30' OR now_at<h.starts_at OR now_at>=h.due_at OR (now_at AT TIME ZONE 'Asia/Tokyo')::time>=time '17:00' THEN RAISE EXCEPTION 'CUSTODY_CHECKOUT_INVALID' USING ERRCODE='23514';END IF;
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

CREATE FUNCTION ops_checkout_amendment(amendment_uuid uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$DECLARE q ops_amendment_quotes;a ops_amendments;b rental_bookings;h inventory_holds;i jsonb;new_id uuid;now_at timestamptz;BEGIN
 PERFORM pg_advisory_xact_lock(71820600);
 SELECT * INTO STRICT a FROM ops_amendments WHERE id=amendment_uuid;SELECT * INTO STRICT q FROM ops_amendment_quotes WHERE id=a.id;
 SELECT * INTO STRICT b FROM rental_bookings WHERE id=a.booking_id;SELECT * INTO STRICT h FROM inventory_holds WHERE id=b.hold_id;
 PERFORM rental_internal.assert_actor('RENTAL_AMEND',h.pickup_store,a.actor);PERFORM rental_internal.assert_actor('RENTAL_CHECKOUT',h.pickup_store,a.actor);
 IF q.actor<>a.actor OR q.booking_id<>b.id OR h.conditions<>q.conditions OR h.version<>q.expected_hold_version+1 OR h.allocation_stage<>'RENTAL_FIXED' THEN RAISE EXCEPTION 'AMENDMENT_NOT_APPLIED' USING ERRCODE='23514';END IF;
 now_at:=inventory_clock();
 FOR i IN SELECT value FROM jsonb_array_elements(q.assignment->'equipment') LOOP
  IF EXISTS(SELECT 1 FROM rental_loan_items l WHERE l.booking_id=b.id AND l.requirement_key=i->>'key' AND l.state='OUT' AND l.asset_id IS NOT DISTINCT FROM (i->>'asset')::uuid AND l.pole_id IS NOT DISTINCT FROM (i->>'pole')::uuid AND l.variant_id=(i->>'variantId')::uuid) THEN CONTINUE;END IF;
  IF length(btrim(a.fit_evidence))=0 THEN RAISE EXCEPTION 'EXCHANGE_FIT_EVIDENCE_REQUIRED' USING ERRCODE='23514';END IF;
  new_id:=gen_random_uuid();INSERT INTO rental_internal.amendment_effects VALUES(txid_current(),pg_backend_pid(),a.id,new_id);
  INSERT INTO rental_loan_items(id,cycle_id,booking_id,requirement_key,asset_id,pole_id,pole_slot,family,variant_id,unit,quantity,pickup_store,checked_out_at,checked_out_by,due_at,state,amendment_id)
   VALUES(new_id,b.id,b.id,i->>'key',(i->>'asset')::uuid,(i->>'pole')::uuid,(i->>'poleSlot')::integer,i->>'family',(i->>'variantId')::uuid,CASE WHEN i->>'family'='SNOWBOARD' THEN 'BOARD' ELSE 'PAIR' END,1,h.pickup_store,now_at,a.actor,h.due_at,'OUT',a.id);
  DELETE FROM rental_internal.amendment_effects WHERE new_loan_id=new_id;
 END LOOP;
 IF (SELECT count(*) FROM rental_loan_items WHERE booking_id=b.id AND state='OUT')<>jsonb_array_length(q.assignment->'equipment') THEN RAISE EXCEPTION 'AMENDMENT_ACTIVE_LOAN_MISMATCH' USING ERRCODE='23514';END IF;
END$$;
REVOKE ALL ON FUNCTION ops_checkout_amendment(uuid) FROM PUBLIC;
DO $$DECLARE executor text:=current_database()||'_custody_executor';BEGIN
 EXECUTE format('ALTER FUNCTION ops_checkout_amendment(uuid) OWNER TO %I',executor);
 EXECUTE format('GRANT SELECT ON ops_amendments,ops_amendment_quotes TO %I',executor);
 EXECUTE format('GRANT INSERT ON rental_loan_items TO %I',executor);
END$$;
CREATE FUNCTION ops_accept_amendment() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$DECLARE q ops_amendment_quotes;b rental_bookings;h inventory_holds;BEGIN
 SELECT * INTO STRICT q FROM ops_amendment_quotes WHERE id=NEW.id;SELECT * INTO STRICT b FROM rental_bookings WHERE id=q.booking_id;SELECT * INTO STRICT h FROM inventory_holds WHERE id=b.hold_id;
 PERFORM ops_assert_actor('RENTAL_AMEND',ARRAY[h.pickup_store,h.return_store],NEW.actor);PERFORM ops_assert_actor('BOOKING_VIEW',ARRAY[h.pickup_store,h.return_store],NEW.actor);
 IF q.actor<>NEW.actor OR q.booking_id<>NEW.booking_id OR b.state<>'CONFIRMED_DEV' OR q.expires_at<=inventory_clock() OR h.version<>q.expected_hold_version OR h.conditions<>q.before_conditions THEN RAISE EXCEPTION 'AMENDMENT_QUOTE_STALE' USING ERRCODE='23514';END IF;
 RETURN NEW;
END$$;
REVOKE ALL ON FUNCTION ops_accept_amendment() FROM PUBLIC;
CREATE TRIGGER ops_accept_amendment BEFORE INSERT ON ops_amendments FOR EACH ROW EXECUTE FUNCTION ops_accept_amendment();
CREATE FUNCTION ops_paid_contract_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$BEGIN
 IF OLD.payment_state='SUCCESS' AND (NEW.conditions,NEW.pickup_store,NEW.return_store,NEW.starts_at,NEW.due_at,NEW.occupancy_start,NEW.occupancy_end) IS DISTINCT FROM (OLD.conditions,OLD.pickup_store,OLD.return_store,OLD.starts_at,OLD.due_at,OLD.occupancy_start,OLD.occupancy_end) THEN
  IF NEW.version<>OLD.version+1 OR NEW.pickup_store<>OLD.pickup_store OR NEW.return_store<>OLD.return_store OR NOT EXISTS(SELECT 1 FROM ops_amendments a JOIN ops_amendment_quotes q ON q.id=a.id JOIN rental_bookings b ON b.id=a.booking_id WHERE b.hold_id=OLD.id AND q.expected_hold_version=OLD.version AND q.before_conditions=OLD.conditions AND q.conditions=NEW.conditions AND a.actor=current_setting('zao.actor',true)) THEN RAISE EXCEPTION 'PAID_CONTRACT_AMENDMENT_REQUIRED' USING ERRCODE='23514';END IF;
 END IF;RETURN NEW;
END$$;
REVOKE ALL ON FUNCTION ops_paid_contract_guard() FROM PUBLIC;
CREATE TRIGGER ops_paid_contract_guard BEFORE UPDATE ON inventory_holds FOR EACH ROW EXECUTE FUNCTION ops_paid_contract_guard();

-- Existing physical loans satisfy only their exact pool/requirement claim.
CREATE OR REPLACE FUNCTION wear_claim_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE h inventory_holds;p wear_pools;used integer;planned integer;
BEGIN
 IF NOT NEW.active THEN RETURN NEW;END IF;
 SELECT * INTO STRICT h FROM inventory_holds WHERE id=NEW.hold_id;SELECT * INTO STRICT p FROM wear_pools WHERE id=NEW.pool_id;
 IF h.state<>'ACTIVE' OR p.store_id<>h.pickup_store OR NEW.day<h.occupancy_start OR NEW.day>h.occupancy_end THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Invalid wear capacity claim'; END IF;
 IF EXISTS(SELECT 1 FROM wear_loans l WHERE l.booking_id=h.reservation_id AND l.requirement_key=NEW.requirement_key AND l.pool_id=NEW.pool_id AND l.quantity-l.returned=NEW.quantity) THEN RETURN NEW;END IF;
 SELECT coalesce(sum(c.quantity),0) INTO used FROM wear_claims c JOIN inventory_holds x ON x.id=c.hold_id WHERE c.active AND c.pool_id=p.id AND c.day=NEW.day AND c.id<>NEW.id AND x.state='ACTIVE' AND (x.expires_at>inventory_clock() OR x.payment_state IN ('PENDING','UNKNOWN','SUCCESS') OR x.allocation_stage<>'PROVISIONAL') AND NOT EXISTS(SELECT 1 FROM wear_loans l WHERE l.booking_id=x.reservation_id);
 SELECT coalesce(sum(quantity),0) INTO planned FROM wear_transfers WHERE source_pool_id=p.id AND state='PLANNED';
 IF used+NEW.quantity+planned>p.ready THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Wear capacity exceeded';END IF;RETURN NEW;
END $$;

-- Record reasons on new pricing audit events, preserving historical rows as NULL.
ALTER TABLE pricing_history ADD COLUMN reason text CHECK(reason IS NULL OR length(btrim(reason)) BETWEEN 1 AND 160);
CREATE OR REPLACE FUNCTION pricing_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$BEGIN
 INSERT INTO pricing_history(actor,entity_id,event,before_data,after_data,reason) VALUES(current_setting('zao.actor'),NEW.id,TG_TABLE_NAME||'_'||TG_OP,CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) ELSE NULL END,to_jsonb(NEW),nullif(current_setting('zao.reason',true),''));RETURN NEW;
END$$;

-- Preserve immutable financial terminal facts; contradictory observations require review.
CREATE TABLE ops_financial_alerts(id uuid PRIMARY KEY,booking_id uuid NOT NULL REFERENCES rental_bookings(id),kind text NOT NULL CHECK(kind IN ('charge','refund')),request_id uuid NOT NULL,observation_sha256 text NOT NULL CHECK(length(observation_sha256)=64),code text NOT NULL CHECK(code='CONTRADICTORY_PROVIDER_EVIDENCE'),actor text NOT NULL REFERENCES staff_members(id),created_at timestamptz NOT NULL DEFAULT inventory_clock(),UNIQUE(kind,request_id,observation_sha256));
CREATE TRIGGER ops_financial_alerts_immutable BEFORE UPDATE OR DELETE ON ops_financial_alerts FOR EACH ROW EXECUTE FUNCTION pricing_immutable();
-- Browser response loss replays one saved private price-management result.
CREATE TABLE price_admin_requests(actor text NOT NULL REFERENCES staff_members(id),request_key uuid NOT NULL,fingerprint text NOT NULL CHECK(length(fingerprint)=64),result jsonb NOT NULL,PRIMARY KEY(actor,request_key));
CREATE TRIGGER price_admin_requests_immutable BEFORE UPDATE OR DELETE ON price_admin_requests FOR EACH ROW EXECUTE FUNCTION pricing_immutable();
