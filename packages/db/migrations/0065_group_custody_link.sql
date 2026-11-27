-- 0065 Group custody link (Issue #47 B4, split out of 0064 by the Owner decision of 2026-11-27, option A).
-- Forward-only and additive on top of 0064: 0001-0064 are unchanged. This migration connects a CONFIRMED group to the ordinary custody
-- (preparation / checkout / return). It is the part of the original 0064 that touches objects owned by the custody executor role
-- (the ordinary loan validator rental_validate_loan, rental_apply_receipt, rental_stage_guard, and the owner change of
-- rental_validate_group_loan). In Production the database owner holds no membership of that role, so this file CANNOT be applied by the
-- owner path: it stays UNAPPLIED until a privileged path is designed (see docs/execution/group/RELEASE_RUNBOOK.md). Production is
-- explicitly allowed to run on 0064 alone: the application detects the absence of this link in the database and closes every group
-- loan / return entry with GROUP_CUSTODY_NOT_ACTIVATED, and ordinary (booking) custody never reads a column this file adds.
--
-- Contents: loan subject columns (group_part_id, hold_id), group_part_preparations, the group loan validator and its trigger, the
-- ordinary validator limited to non-group loans, the group-aware rental_apply_receipt / rental_stage_guard, the group-aware
-- rental_inventory_blocks view, the full group_custody_stage_ok / group_custody_hold_update (0064 only allowed the transfer_attention flag),
-- and the full group_order_guard / group_consistency (0064 omits the loan references they need once loans can exist).

-- =================================================================== CUSTODY CONNECTION (Issue #47 B4: CONFIRMED + unsettled groups can be prepared / checked out / returned)
-- A group part has no booking and never a provider payment, so custody gets a parallel, narrowly-scoped door beside the ordinary one.
-- The ordinary path is untouched: its validator still demands booking + payment_state=SUCCESS (trigger now fires only for non-group loans).
-- A group loan is allowed only when: the group is CONFIRMED with confirmation_basis GROUP_ADMIN_APPROVED, the part is the active one,
-- the hold is ACTIVE with payment_state NONE (never SUCCESS), and every existing physical rule (exact full-period asset witness,
-- store boundary, prepared fit evidence, promise match, PAIR conservation, blocks, transfers) holds exactly as for a booking.
ALTER TABLE rental_loan_items ADD COLUMN group_part_id uuid REFERENCES group_order_parts(id);
-- The promise (hold) of a group loan, copied from its part so that readers that already see rental_loan_items need no group table.
ALTER TABLE rental_loan_items ADD COLUMN hold_id uuid REFERENCES inventory_holds(id);
ALTER TABLE rental_loan_items ALTER COLUMN booking_id DROP NOT NULL;
ALTER TABLE rental_loan_items ADD CONSTRAINT rental_loan_subject CHECK((booking_id IS NULL)<>(group_part_id IS NULL) AND (group_part_id IS NULL OR amendment_id IS NULL) AND (group_part_id IS NULL)=(hold_id IS NULL));
CREATE UNIQUE INDEX rental_group_requirement ON rental_loan_items(group_part_id,requirement_key) WHERE group_part_id IS NOT NULL;
CREATE INDEX rental_loan_group_part ON rental_loan_items(group_part_id) WHERE group_part_id IS NOT NULL;

CREATE TABLE group_part_preparations(
 id uuid PRIMARY KEY REFERENCES group_order_parts(id),store_id text NOT NULL REFERENCES ledger_stores(id),
 checked_in_at timestamptz NOT NULL,checked_in_by text NOT NULL REFERENCES staff_members(id),
 prepared_at timestamptz,prepared_by text REFERENCES staff_members(id),fit_evidence jsonb,
 version integer NOT NULL DEFAULT 1 CHECK(version>0),CHECK((prepared_at IS NULL)=(fit_evidence IS NULL))
);
CREATE TRIGGER group_part_preparations_lock BEFORE INSERT OR UPDATE OR DELETE ON group_part_preparations FOR EACH STATEMENT EXECUTE FUNCTION inventory_lock();
CREATE TRIGGER group_part_preparations_audit AFTER INSERT OR UPDATE ON group_part_preparations FOR EACH ROW EXECUTE FUNCTION rental_audit();

-- Does this group member need an in-store physical fit confirmation? (MANUAL_FIT_REQUIRED, however the fit record spells it.)
CREATE FUNCTION group_member_manual_fit(p_fit jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
 SELECT coalesce(p_fit->>'status'='MANUAL_FIT_REQUIRED' OR p_fit->>'kind'='MANUAL_FIT_REQUIRED' OR p_fit->'fit'->>'kind'='MANUAL_FIT_REQUIRED',false)
$$;

CREATE FUNCTION rental_validate_group_loan() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE gp group_order_parts;go group_orders;h inventory_holds;m jsonb;it jsonb;v record;now_at timestamptz;mk text;
BEGIN
 PERFORM pg_advisory_xact_lock(71820600);
 PERFORM rental_internal.assert_actor('RENTAL_CHECKOUT',NEW.pickup_store,NEW.checked_out_by);
 SELECT * INTO STRICT gp FROM group_order_parts WHERE id=NEW.group_part_id;
 SELECT * INTO STRICT go FROM group_orders WHERE id=gp.group_id;
 SELECT * INTO STRICT h FROM inventory_holds WHERE id=gp.hold_id;
 now_at:=inventory_clock();
 IF NOT gp.active OR go.status<>'CONFIRMED' OR go.confirmation_basis IS DISTINCT FROM 'GROUP_ADMIN_APPROVED' OR go.confirmed_at IS NULL OR NEW.booking_id IS NOT NULL OR NEW.amendment_id IS NOT NULL
  OR h.payment_state<>'NONE' OR h.confirmed_at IS NOT NULL OR h.state<>'ACTIVE' OR h.allocation_stage<>'PREPARATION_FIXED' OR h.transfer_attention IS NOT NULL
  OR NEW.hold_id IS DISTINCT FROM gp.hold_id OR NEW.cycle_id<>gp.id OR NEW.pickup_store<>h.pickup_store OR NEW.due_at<>h.due_at OR NEW.checked_out_at>now_at OR NEW.state<>'OUT' OR NEW.version<>1
  OR ((now_at AT TIME ZONE 'Asia/Tokyo')::date<>h.occupancy_start AND (h.conditions->'period'->>'slot'<>'MULTIDAY' OR (now_at AT TIME ZONE 'Asia/Tokyo')::date<h.occupancy_start OR (now_at AT TIME ZONE 'Asia/Tokyo')::date>h.occupancy_end))
  OR (now_at AT TIME ZONE 'Asia/Tokyo')::time<time '08:30' OR now_at<h.starts_at OR now_at>=h.due_at OR (now_at AT TIME ZONE 'Asia/Tokyo')::time>=time '17:00' THEN RAISE EXCEPTION 'CUSTODY_CHECKOUT_INVALID' USING ERRCODE='23514';END IF;
 SELECT member,item INTO m,it FROM jsonb_array_elements(h.conditions->'members') member CROSS JOIN LATERAL jsonb_array_elements(member->'items') item WHERE (member->>'key')||':'||(item->>'family')=NEW.requirement_key;
 SELECT v1.*,m1.catalog_season INTO v FROM ledger_variants v1 JOIN ledger_models m1 ON m1.id=v1.model_id WHERE v1.id=NEW.variant_id;
 IF m IS NULL OR it IS NULL OR NOT(it->'variantIds' ? NEW.variant_id::text) OR it->>'family'<>NEW.family OR m->>'age'<>v.age OR m->>'tier'<>v.tier OR (it ? 'modelPromise' AND ((it->'modelPromise'->>'modelId') IS DISTINCT FROM v.model_id::text OR (it->'modelPromise'->>'variantId') IS DISTINCT FROM v.id::text OR (it->'modelPromise'->>'season') IS DISTINCT FROM v.catalog_season)) THEN RAISE EXCEPTION 'CUSTODY_PROMISE_MISMATCH' USING ERRCODE='23514';END IF;
 IF NOT EXISTS(SELECT 1 FROM group_part_preparations p CROSS JOIN LATERAL jsonb_array_elements(p.fit_evidence->'selections') s WHERE p.id=gp.id AND p.store_id=NEW.pickup_store AND p.prepared_at IS NOT NULL AND s->>'requirementKey'=NEW.requirement_key AND (s->>'assetId')::uuid IS NOT DISTINCT FROM NEW.asset_id AND (s->>'poleId')::uuid IS NOT DISTINCT FROM NEW.pole_id) THEN RAISE EXCEPTION 'CUSTODY_PREPARATION_REQUIRED' USING ERRCODE='23514';END IF;
 -- A size outside what can be fitted online (MANUAL_FIT_REQUIRED) is lent only after the in-store physical fit was recorded for that member.
 mk:=split_part(NEW.requirement_key,':',1);
 IF EXISTS(SELECT 1 FROM group_members gm WHERE gm.group_id=go.id AND 'p'||lpad(gm.ordinal::text,3,'0')=mk AND group_member_manual_fit(gm.fit))
  AND NOT EXISTS(SELECT 1 FROM group_part_preparations p WHERE p.id=gp.id AND p.fit_evidence->'manualFit'->mk->>'confirmed'='true') THEN RAISE EXCEPTION 'CUSTODY_MANUAL_FIT_REQUIRED' USING ERRCODE='23514';END IF;
 IF (SELECT count(*) FROM inventory_claims WHERE hold_id=h.id AND requirement_key=NEW.requirement_key AND active AND day>=h.occupancy_start AND asset_id IS NOT DISTINCT FROM NEW.asset_id AND pole_id IS NOT DISTINCT FROM NEW.pole_id)<>h.occupancy_end-h.occupancy_start+1 THEN RAISE EXCEPTION 'CUSTODY_FULL_PERIOD_WITNESS_REQUIRED' USING ERRCODE='23514';END IF;
 IF NEW.asset_id IS NOT NULL THEN
  IF NOT EXISTS(SELECT 1 FROM ledger_assets WHERE id=NEW.asset_id AND variant_id=NEW.variant_id AND family=NEW.family AND status='AVAILABLE' AND store_id=NEW.pickup_store AND unit=NEW.unit) THEN RAISE EXCEPTION 'CUSTODY_ASSET_NOT_READY' USING ERRCODE='23514';END IF;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM ledger_poles WHERE id=NEW.pole_id AND variant_id=NEW.variant_id AND store_id=NEW.pickup_store AND status='AVAILABLE' AND quantity>0 AND NEW.unit='PAIR') THEN RAISE EXCEPTION 'CUSTODY_POOL_NOT_READY' USING ERRCODE='23514';END IF;
  IF (SELECT count(*) FROM rental_loan_items WHERE pole_id=NEW.pole_id AND state='OUT')+(SELECT count(*) FROM rental_inventory_blocks WHERE pole_id=NEW.pole_id AND reason='CONTRACT_DATE_BLOCK' AND starts_on<=(now_at AT TIME ZONE 'Asia/Tokyo')::date AND ends_on>=(now_at AT TIME ZONE 'Asia/Tokyo')::date)>=(SELECT quantity FROM ledger_poles WHERE id=NEW.pole_id) THEN RAISE EXCEPTION 'CUSTODY_PAIR_NOT_READY' USING ERRCODE='23514';END IF;
 END IF;
 IF EXISTS(SELECT 1 FROM rental_inventory_blocks WHERE asset_id=NEW.asset_id AND starts_on<=h.occupancy_end AND ends_on>=h.occupancy_start) OR EXISTS(SELECT 1 FROM transfer_pieces p JOIN transfer_batches t ON t.id=p.batch_id WHERE p.asset_id=NEW.asset_id AND p.state NOT IN ('READY','CLOSED','CANCELLED') AND NOT(p.state='PLANNED' AND t.source_store=NEW.pickup_store AND t.scheduled_date>=h.occupancy_end AND t.issue IS NULL)) OR EXISTS(SELECT 1 FROM inventory_constraints WHERE (asset_id=NEW.asset_id OR pole_id=NEW.pole_id) AND starts_on<=h.occupancy_end AND ends_on>=h.occupancy_start) THEN RAISE EXCEPTION 'CUSTODY_STOCK_BLOCKED' USING ERRCODE='23514';END IF;
 NEW.checked_out_at:=now_at;RETURN NEW;
END$$;
REVOKE ALL ON FUNCTION rental_validate_group_loan() FROM PUBLIC;
-- The ordinary validator keeps judging only bookings (its body is unchanged); a group loan can never reach it, nor skip the group one.
DROP TRIGGER rental_validate_loan ON rental_loan_items;
CREATE TRIGGER rental_validate_loan BEFORE INSERT ON rental_loan_items FOR EACH ROW WHEN (NEW.group_part_id IS NULL) EXECUTE FUNCTION rental_validate_loan();
CREATE TRIGGER rental_validate_group_loan BEFORE INSERT ON rental_loan_items FOR EACH ROW WHEN (NEW.group_part_id IS NOT NULL) EXECUTE FUNCTION rental_validate_group_loan();

CREATE OR REPLACE FUNCTION rental_apply_receipt(receipt_uuid uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE r rental_receipts;l rental_loan_items;c rental_return_candidates;b rental_return_batches;booking rental_bookings;hold_uuid uuid;dest uuid;ready uuid;now_at timestamptz;
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
 -- A group part has no booking: its promise is the part's own hold. Everything below is keyed by that hold.
 IF l.group_part_id IS NULL THEN SELECT * INTO STRICT booking FROM rental_bookings WHERE id=l.booking_id;hold_uuid:=booking.hold_id;
 ELSE SELECT hold_id INTO STRICT hold_uuid FROM group_order_parts WHERE id=l.group_part_id;END IF;
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
 UPDATE inventory_claims SET active=false WHERE hold_id=hold_uuid AND requirement_key=l.requirement_key AND active AND asset_id IS NOT DISTINCT FROM l.asset_id AND pole_id IS NOT DISTINCT FROM l.pole_id;
 UPDATE inventory_holds SET transfer_attention='CUSTODY_RECONCILIATION_REQUIRED',version=version+1 WHERE id<>hold_uuid AND state='ACTIVE' AND id IN(SELECT hold_id FROM inventory_claims WHERE active AND (asset_id=l.asset_id OR pole_id=l.pole_id OR transfer_piece_id IN(SELECT p.id FROM transfer_pieces p JOIN transfer_batches t ON t.id=p.batch_id WHERE (p.asset_id=l.asset_id OR p.source_pole_id=l.pole_id) AND t.issue='CUSTODY_RECONCILIATION_REQUIRED')));
 INSERT INTO rental_custody_events VALUES(r.id,l.id,l.pickup_store,r.received_store,dest,ready,now_at);
 UPDATE rental_loan_items SET state='RECEIVED',version=version+1 WHERE id=l.id;
 UPDATE rental_return_candidates SET state='RECEIVED',outcome='RECEIVED' WHERE id=c.id;
 DELETE FROM rental_internal.effects WHERE tx=txid_current() AND pid=pg_backend_pid() AND receipt_id=r.id;
END$$;

CREATE OR REPLACE FUNCTION rental_stage_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$DECLARE b rental_bookings;gp group_order_parts;BEGIN
 IF session_user<>current_database()||'_custody' OR NEW.allocation_stage=OLD.allocation_stage THEN RETURN NEW;END IF;
 PERFORM rental_internal.assert_actor('RENTAL_CHECKOUT',OLD.pickup_store,current_setting('zao.actor',true));
 SELECT * INTO gp FROM group_order_parts WHERE hold_id=OLD.id;
 IF FOUND THEN
  -- Group promise: confirmed by the administrator (GROUP_ADMIN_APPROVED), never by a provider payment; payment_state stays NONE.
  IF group_custody_stage_ok(OLD,NEW) THEN RETURN NEW;END IF;
  RAISE EXCEPTION 'CUSTODY_STAGE_INVALID' USING ERRCODE='23514';
 END IF;
 SELECT * INTO b FROM rental_bookings WHERE hold_id=OLD.id;
 IF NOT FOUND OR NOT booking_is_confirmed(b.mode,b.state) OR OLD.payment_state<>'SUCCESS' OR OLD.transfer_attention IS NOT NULL THEN RAISE EXCEPTION 'CUSTODY_STAGE_INVALID' USING ERRCODE='23514';END IF;
 IF OLD.allocation_stage='PROVISIONAL' AND NEW.allocation_stage='PREPARATION_FIXED' AND EXISTS(SELECT 1 FROM rental_preparations WHERE id=b.id AND prepared_at IS NOT NULL) THEN RETURN NEW;END IF;
 IF OLD.allocation_stage='PREPARATION_FIXED' AND NEW.allocation_stage='RENTAL_FIXED' AND (SELECT count(*) FROM rental_loan_items WHERE booking_id=b.id AND state='OUT')=(SELECT count(*) FROM jsonb_array_elements(b.conditions->'members') m CROSS JOIN LATERAL jsonb_array_elements(m->'items') i WHERE i->>'family' NOT IN ('WEAR_JACKET','WEAR_PANTS')) THEN RETURN NEW;END IF;
 RAISE EXCEPTION 'CUSTODY_STAGE_INVALID' USING ERRCODE='23514';
END$$;


CREATE OR REPLACE VIEW rental_inventory_blocks AS
 SELECT l.id,l.asset_id,l.pole_id,(h.due_at AT TIME ZONE 'Asia/Tokyo')::date AS starts_on,'9999-12-31'::date AS ends_on,'OVERDUE_OUT'::text AS reason FROM rental_loan_items l JOIN rental_bookings b ON b.id=l.booking_id JOIN inventory_holds h ON h.id=b.hold_id WHERE l.state='OUT' AND h.due_at<=inventory_clock()
 UNION ALL SELECT l.id,l.asset_id,CASE WHEN i.inspection_id IS NOT NULL THEN e.ready_pool ELSE NULL END,(r.actual_received_at AT TIME ZONE 'Asia/Tokyo')::date,
 CASE WHEN i.inspection_id IS NULL THEN '9999-12-31'::date ELSE greatest(coalesce(t.contracted_end_on,(b.conditions->'period'->>'endDate')::date),(r.actual_received_at AT TIME ZONE 'Asia/Tokyo')::date) END,
 CASE WHEN i.inspection_id IS NULL THEN 'INSPECTION_PENDING' ELSE 'CONTRACT_DATE_BLOCK' END
 FROM rental_custody_events e JOIN rental_receipts r ON r.id=e.receipt_id JOIN rental_loan_items l ON l.id=e.loan_item_id JOIN rental_bookings b ON b.id=l.booking_id LEFT JOIN rental_inspection_events i ON i.loan_item_id=l.id LEFT JOIN ops_receipt_terms t ON t.receipt_id=r.id
 -- Group parts: no booking; the promise window comes from the part's own hold. Same block semantics as above.
 UNION ALL SELECT l.id,l.asset_id,l.pole_id,(h.due_at AT TIME ZONE 'Asia/Tokyo')::date,'9999-12-31'::date,'OVERDUE_OUT'::text FROM rental_loan_items l JOIN inventory_holds h ON h.id=l.hold_id WHERE l.group_part_id IS NOT NULL AND l.state='OUT' AND h.due_at<=inventory_clock()
 UNION ALL SELECT l.id,l.asset_id,CASE WHEN i.inspection_id IS NOT NULL THEN e.ready_pool ELSE NULL END,(r.actual_received_at AT TIME ZONE 'Asia/Tokyo')::date,
 CASE WHEN i.inspection_id IS NULL THEN '9999-12-31'::date ELSE greatest((h.conditions->'period'->>'endDate')::date,h.occupancy_end,(r.actual_received_at AT TIME ZONE 'Asia/Tokyo')::date) END,
 CASE WHEN i.inspection_id IS NULL THEN 'INSPECTION_PENDING' ELSE 'CONTRACT_DATE_BLOCK' END
 FROM rental_custody_events e JOIN rental_receipts r ON r.id=e.receipt_id JOIN rental_loan_items l ON l.id=e.loan_item_id AND l.group_part_id IS NOT NULL JOIN inventory_holds h ON h.id=l.hold_id LEFT JOIN rental_inspection_events i ON i.loan_item_id=l.id;

DO $$DECLARE executor text:=current_database()||'_custody_executor';BEGIN
 EXECUTE format('ALTER FUNCTION rental_validate_group_loan() OWNER TO %I',executor);
 EXECUTE format('GRANT SELECT ON group_order_parts,group_orders,group_members,group_part_preparations TO %I',executor);
END$$;
REVOKE ALL ON group_part_preparations FROM PUBLIC;

-- =================================================================== FULL GUARDS (loans exist from here on)
-- 0064 carries the same functions without the stage edges / loan references; these definitions replace them
-- (owner-owned functions: CREATE OR REPLACE keeps owner, ACL and settings).
-- Custody (checkout preparation / checkout) may move a CONFIRMED group part's hold GROUP_RESERVED -> PREPARATION_FIXED -> RENTAL_FIXED
-- and may flag transfer_attention on any group hold (rental_apply_receipt does this to other promises that share a returned item).
-- group_custody_stage_ok is the single statement of when a stage edge is legal for a group part; it is checked here (every role that may
-- touch custody) and again by rental_stage_guard (the dedicated custody role). Nothing else about a group hold changes through this door.
CREATE FUNCTION group_custody_stage_ok(o inventory_holds,n inventory_holds) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE gp record;go record;-- records: this function is created before the group tables
BEGIN
 SELECT * INTO gp FROM group_order_parts WHERE hold_id=o.id;IF NOT FOUND THEN RETURN false;END IF;
 SELECT * INTO go FROM group_orders WHERE id=gp.group_id;
 -- Confirmed by the administrator (GROUP_ADMIN_APPROVED), never by a provider payment: payment_state stays NONE.
 IF NOT gp.active OR go.status<>'CONFIRMED' OR go.confirmation_basis IS DISTINCT FROM 'GROUP_ADMIN_APPROVED' OR o.payment_state<>'NONE' OR o.state<>'ACTIVE' OR o.transfer_attention IS NOT NULL THEN RETURN false;END IF;
 IF o.allocation_stage='GROUP_RESERVED' AND n.allocation_stage='PREPARATION_FIXED' THEN RETURN EXISTS(SELECT 1 FROM group_part_preparations WHERE id=gp.id AND prepared_at IS NOT NULL);END IF;
 IF o.allocation_stage='PREPARATION_FIXED' AND n.allocation_stage='RENTAL_FIXED' THEN RETURN (SELECT count(*) FROM rental_loan_items WHERE group_part_id=gp.id AND state='OUT')=(SELECT count(*) FROM jsonb_array_elements(o.conditions->'members') m CROSS JOIN LATERAL jsonb_array_elements(m->'items') i WHERE i->>'family' NOT IN ('WEAR_JACKET','WEAR_PANTS'));END IF;
 RETURN false;
END$$;
CREATE OR REPLACE FUNCTION group_custody_hold_update(o inventory_holds,n inventory_holds) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$BEGIN
 RETURN session_user IN (current_database()||'_custody',current_database()||'_operations')
  AND (to_jsonb(n)-ARRAY['allocation_stage','version','transfer_attention'])=(to_jsonb(o)-ARRAY['allocation_stage','version','transfer_attention'])
  AND EXISTS(SELECT 1 FROM group_order_parts p WHERE p.hold_id=o.id)
  AND (n.allocation_stage=o.allocation_stage OR group_custody_stage_ok(o,n));
END$$;
CREATE OR REPLACE FUNCTION group_order_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE actor text:=current_setting('zao.actor',true);perm text;admin boolean:=true;ev text:=NEW.last_action->>'event';
BEGIN
 IF TG_OP='DELETE' OR NOT group_op_allowed() THEN RAISE EXCEPTION 'GROUP_DIRECT_WRITE' USING ERRCODE='23514';END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'DRAFT' OR NEW.revision<>1 THEN RAISE EXCEPTION 'GROUP_INVALID_CREATE' USING ERRCODE='23514';END IF;
  RETURN NEW;
 END IF;
 IF OLD.status IN ('RELEASED','CANCELLED') THEN RAISE EXCEPTION 'GROUP_TERMINAL' USING ERRCODE='23514';END IF;
 IF NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'GROUP_REVISION' USING ERRCODE='23514';END IF;
 IF (NEW.id,NEW.group_number,NEW.owner_secret_sha256,NEW.created_at,NEW.payment_method) IS DISTINCT FROM (OLD.id,OLD.group_number,OLD.owner_secret_sha256,OLD.created_at,OLD.payment_method) THEN RAISE EXCEPTION 'GROUP_IMMUTABLE' USING ERRCODE='23514';END IF;
 IF OLD.status NOT IN ('DRAFT','QUOTED') AND (NEW.pickup_store,NEW.return_store,NEW.period,NEW.contract_version) IS DISTINCT FROM (OLD.pickup_store,OLD.return_store,OLD.period,OLD.contract_version) THEN RAISE EXCEPTION 'GROUP_IMMUTABLE' USING ERRCODE='23514';END IF;
 IF OLD.confirmed_at IS NOT NULL AND (NEW.confirmed_at,NEW.confirmed_by,NEW.confirmed_quote_id,NEW.confirmed_total_jpy,NEW.confirmation_basis) IS DISTINCT FROM (OLD.confirmed_at,OLD.confirmed_by,OLD.confirmed_quote_id,OLD.confirmed_total_jpy,OLD.confirmation_basis) THEN RAISE EXCEPTION 'GROUP_IMMUTABLE' USING ERRCODE='23514';END IF;
 IF NEW.status=OLD.status THEN
  IF NEW.status IN ('DRAFT','QUOTED') THEN admin:=false;
  ELSIF ev='GROUP_DISCOUNTED' THEN perm:='GROUP_DISCOUNT';
  ELSIF NEW.status='CONFIRMED' THEN
   -- A confirmed group changes only by explicit, audited events (on-site payment bookkeeping has its own table).
   RAISE EXCEPTION 'GROUP_CONFIRMED_IMMUTABLE' USING ERRCODE='23514';
  ELSE perm:='GROUP_APPROVE';END IF;
 ELSE
  IF (OLD.status,NEW.status) IN (('DRAFT','QUOTED'),('QUOTED','DRAFT'),('QUOTED','REVIEW_HELD')) THEN admin:=false;
  ELSIF (OLD.status,NEW.status) IN (('REVIEW_HELD','CONFIRMED'),('REVIEW_HELD','CHANGES_REQUESTED'),('CHANGES_REQUESTED','REVIEW_HELD')) THEN perm:='GROUP_APPROVE';
  ELSIF (OLD.status,NEW.status) IN (('REVIEW_HELD','RELEASED'),('CHANGES_REQUESTED','RELEASED')) THEN perm:='GROUP_RELEASE';
  ELSIF (OLD.status,NEW.status)=('CONFIRMED','CANCELLED') THEN perm:='GROUP_CANCEL';
   -- Custody: a group with an item still out cannot be cancelled (same rule as an ordinary booking): return it first.
   IF EXISTS(SELECT 1 FROM rental_loan_items l JOIN group_order_parts gp ON gp.id=l.group_part_id WHERE gp.group_id=OLD.id AND l.state='OUT') THEN RAISE EXCEPTION 'GROUP_LOANS_OUT' USING ERRCODE='23514';END IF;
  ELSE RAISE EXCEPTION 'GROUP_ILLEGAL_TRANSITION %->%',OLD.status,NEW.status USING ERRCODE='23514';END IF;
 END IF;
 IF admin THEN
  IF actor IS NULL OR NOT group_staff_can(actor,perm,ARRAY[NEW.pickup_store,NEW.return_store]) THEN RAISE EXCEPTION 'GROUP_NOT_AUTHORIZED' USING ERRCODE='42501';END IF;
  IF NEW.status='CONFIRMED' AND OLD.status<>'CONFIRMED' AND NEW.confirmed_by IS DISTINCT FROM actor THEN RAISE EXCEPTION 'GROUP_NOT_AUTHORIZED' USING ERRCODE='42501';END IF;
  IF NEW.status='RELEASED' AND NEW.released_by IS DISTINCT FROM actor THEN RAISE EXCEPTION 'GROUP_NOT_AUTHORIZED' USING ERRCODE='42501';END IF;
  IF NEW.status='CANCELLED' AND NEW.cancelled_by IS DISTINCT FROM actor THEN RAISE EXCEPTION 'GROUP_NOT_AUTHORIZED' USING ERRCODE='42501';END IF;
 ELSIF actor IS DISTINCT FROM 'group:'||NEW.id THEN RAISE EXCEPTION 'GROUP_NOT_AUTHORIZED' USING ERRCODE='42501';END IF;
 NEW.updated_at:=clock_timestamp();
 RETURN NEW;
END$$;
CREATE OR REPLACE FUNCTION group_consistency() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE g group_orders;n integer;m integer;bad integer;
BEGIN
 SELECT * INTO g FROM group_orders WHERE id=NEW.id;
 IF g.status IN ('REVIEW_HELD','CHANGES_REQUESTED','CONFIRMED') THEN
  SELECT coalesce(sum(member_count),0) INTO n FROM group_order_parts WHERE group_id=g.id AND active;
  SELECT count(*) INTO m FROM group_members WHERE group_id=g.id;
  IF g.member_count<1 OR n<>g.member_count OR m<>g.member_count THEN RAISE EXCEPTION 'GROUP_PARTS_INCOMPLETE' USING ERRCODE='23514';END IF;
  SELECT count(*) INTO bad FROM group_order_parts p JOIN inventory_holds h ON h.id=p.hold_id WHERE p.group_id=g.id AND p.active
   AND (h.state<>'ACTIVE' OR h.allocation_stage<>ALL(CASE WHEN g.status='CONFIRMED' THEN ARRAY['GROUP_RESERVED','PREPARATION_FIXED','RENTAL_FIXED'] ELSE ARRAY['GROUP_RESERVED'] END) OR h.expires_at IS NOT NULL OR h.payment_state<>'NONE' OR h.confirmed_at IS NOT NULL
        OR ((SELECT count(*) FROM inventory_claims c WHERE c.hold_id=h.id AND c.active)=0 AND NOT (g.status='CONFIRMED' AND EXISTS(SELECT 1 FROM rental_loan_items l WHERE l.group_part_id=p.id))));
  IF bad>0 OR (SELECT count(*) FROM group_order_parts WHERE group_id=g.id AND active)<>(SELECT count(*) FROM group_order_parts p JOIN inventory_holds h ON h.id=p.hold_id WHERE p.group_id=g.id AND p.active) THEN RAISE EXCEPTION 'GROUP_HOLD_NOT_PROTECTED' USING ERRCODE='23514';END IF;
 ELSIF g.status IN ('RELEASED','CANCELLED') THEN
  IF EXISTS(SELECT 1 FROM group_order_parts p JOIN inventory_holds h ON h.id=p.hold_id WHERE p.group_id=g.id AND p.active AND (h.state='ACTIVE' OR EXISTS(SELECT 1 FROM inventory_claims c WHERE c.hold_id=h.id AND c.active))) THEN RAISE EXCEPTION 'GROUP_RELEASE_PARTIAL' USING ERRCODE='23514';END IF;
 ELSE
  IF EXISTS(SELECT 1 FROM group_order_parts WHERE group_id=g.id AND active) THEN RAISE EXCEPTION 'GROUP_PARTS_UNEXPECTED' USING ERRCODE='23514';END IF;
 END IF;
 RETURN NULL;
END$$;
