-- 0064 Group order core (Issue #47, comments 7197143646 + priority correction 7197417902). Additive/expand only:
-- 0001-0063 are unchanged. Nothing here changes a normal booking: a normal hold stays PROVISIONAL with a mandatory expires_at.
-- OWNER-APPLICABLE: this file touches no object owned by the custody executor role (Owner decision 2026-11-27, option A). The connection of a
-- group to custody (loan columns, preparation record, group loan validator, group-aware rental_apply_receipt / rental_stage_guard) is the
-- separate forward migration 0065_group_custody_link.sql, which Production does not apply until a privileged path is designed.
--
-- Owner decisions encoded here (7197417902):
--  * ONE permanent, reusable entrance (hash only). No per-group invite, approval, expiry, use limit or single-use consumption.
--    The entrance is only the capability to START a new application; each application gets its own opaque group id and
--    owner secret hash (group_orders.owner_secret_sha256). The entrance shares no access to any existing group.
--  * Review holds have NO expiry. They are a distinct, explicit protection kind: inventory_holds.allocation_stage =
--    'GROUP_RESERVED' with expires_at IS NULL (never a far-future date). Every existing capacity predicate already reads
--    "allocation_stage<>'PROVISIONAL'" as protected and expireInventoryHolds only touches 'PROVISIONAL', so the existing
--    inventory/provisional/wear/transfer/sales-stop sources of truth see these claims and nothing expires them.
--    They end only by an explicit ADMIN release (group status RELEASED) or by formal cancellation of a confirmed group.
--  * Confirmation basis is GROUP_ADMIN_APPROVED, payment_method is fixed PAY_ON_SITE. No rental_bookings /
--    rental_payment_attempts / provider event / payment_state=SUCCESS is ever created for a group; on-site receipts are
--    recorded only in group_payments (append-only, actor/permission checked in the database).

-- ---------------------------------------------------------------- permissions (ADMIN only; no MANAGER/STAFF grant)
ALTER TABLE staff_role_permissions DROP CONSTRAINT staff_role_permissions_permission_check;
ALTER TABLE staff_permission_overrides DROP CONSTRAINT staff_permission_overrides_permission_check;
ALTER TABLE staff_role_permissions ADD CHECK(permission IN ('INVENTORY_VIEW','INVENTORY_EDIT','STAFF_MANAGE','HOLD_VIEW','HOLD_EDIT','TRANSFER_VIEW','TRANSFER_PLAN','TRANSFER_DISPATCH','TRANSFER_RECEIVE','QUOTE_VIEW','QUOTE_CREATE','PRICE_EDIT','BOOKING_VIEW','BOOKING_CREATE','RENTAL_CHECKOUT','RENTAL_RETURN','RENTAL_AMEND','REFUND_OVERRIDE','INVENTORY_RECONCILE','NOTIFICATION_RESEND','OPERATIONS_VIEW','OPERATIONS_ACKNOWLEDGE','FIELD_ACCEPTANCE','INVENTORY_BUFFER_OVERRIDE','GROUP_VIEW','GROUP_ENTRANCE_MANAGE','GROUP_APPROVE','GROUP_DISCOUNT','GROUP_RELEASE','GROUP_CANCEL','GROUP_PAYMENT_RECORD'));
ALTER TABLE staff_permission_overrides ADD CHECK(permission IN ('INVENTORY_VIEW','INVENTORY_EDIT','STAFF_MANAGE','HOLD_VIEW','HOLD_EDIT','TRANSFER_VIEW','TRANSFER_PLAN','TRANSFER_DISPATCH','TRANSFER_RECEIVE','QUOTE_VIEW','QUOTE_CREATE','PRICE_EDIT','BOOKING_VIEW','BOOKING_CREATE','RENTAL_CHECKOUT','RENTAL_RETURN','RENTAL_AMEND','REFUND_OVERRIDE','INVENTORY_RECONCILE','NOTIFICATION_RESEND','OPERATIONS_VIEW','OPERATIONS_ACKNOWLEDGE','FIELD_ACCEPTANCE','INVENTORY_BUFFER_OVERRIDE','GROUP_VIEW','GROUP_ENTRANCE_MANAGE','GROUP_APPROVE','GROUP_DISCOUNT','GROUP_RELEASE','GROUP_CANCEL','GROUP_PAYMENT_RECORD'));
INSERT INTO staff_role_permissions(role,permission) VALUES
 ('ADMIN','GROUP_VIEW'),('ADMIN','GROUP_ENTRANCE_MANAGE'),('ADMIN','GROUP_APPROVE'),('ADMIN','GROUP_DISCOUNT'),('ADMIN','GROUP_RELEASE'),('ADMIN','GROUP_CANCEL'),('ADMIN','GROUP_PAYMENT_RECORD')
 ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------- explicit no-expiry protection kind
ALTER TABLE inventory_holds DROP CONSTRAINT inventory_holds_allocation_stage_check;
ALTER TABLE inventory_holds ADD CONSTRAINT inventory_holds_allocation_stage_check CHECK(allocation_stage IN ('PROVISIONAL','PREPARATION_FIXED','RENTAL_FIXED','GROUP_RESERVED'));
ALTER TABLE inventory_holds ALTER COLUMN expires_at DROP NOT NULL;
-- A normal (PROVISIONAL) hold always has an expiry; a GROUP_RESERVED hold never has one.
ALTER TABLE inventory_holds ADD CONSTRAINT inventory_hold_expiry_required CHECK(allocation_stage<>'PROVISIONAL' OR expires_at IS NOT NULL);
ALTER TABLE inventory_holds ADD CONSTRAINT inventory_hold_group_no_expiry CHECK(allocation_stage<>'GROUP_RESERVED' OR expires_at IS NULL);

-- Only the dedicated group application role, inside an explicit group operation, may create/change/release a group hold or
-- its claims. (session_user check is the same pattern as the custody role; zao.group_op is only an intent flag.)
CREATE FUNCTION group_op_allowed() RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT coalesce(current_setting('zao.group_op',true)='on',false) AND session_user=current_database()||'_group'
$$;
-- Custody may flag transfer_attention on any group hold (the ordinary rental_apply_receipt does this to other promises that share a returned item).
-- This is the ONLY change a custody session may make to a group hold in 0064: the allocation stage never moves (a group loan, preparation and
-- the stage edges GROUP_RESERVED -> PREPARATION_FIXED -> RENTAL_FIXED belong to 0065, the custody link). 0065 replaces this function.
CREATE FUNCTION group_custody_hold_update(o inventory_holds,n inventory_holds) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$BEGIN
 RETURN session_user IN (current_database()||'_custody',current_database()||'_operations')
  AND (to_jsonb(n)-ARRAY['allocation_stage','version','transfer_attention'])=(to_jsonb(o)-ARRAY['allocation_stage','version','transfer_attention'])
  AND EXISTS(SELECT 1 FROM group_order_parts p WHERE p.hold_id=o.id)
  AND n.allocation_stage=o.allocation_stage;
END$$;
CREATE FUNCTION group_hold_guard() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.allocation_stage='GROUP_RESERVED' AND NOT group_op_allowed() THEN RAISE EXCEPTION 'GROUP_HOLD_PROTECTED' USING ERRCODE='23514';END IF;
  RETURN NEW;
 END IF;
 IF TG_OP='DELETE' THEN
  IF OLD.allocation_stage='GROUP_RESERVED' THEN RAISE EXCEPTION 'GROUP_HOLD_PROTECTED' USING ERRCODE='23514';END IF;
  RETURN OLD;
 END IF;
 IF (OLD.allocation_stage='GROUP_RESERVED' OR NEW.allocation_stage='GROUP_RESERVED') AND NOT group_op_allowed() AND NOT group_custody_hold_update(OLD,NEW) THEN RAISE EXCEPTION 'GROUP_HOLD_PROTECTED' USING ERRCODE='23514';END IF;
 RETURN NEW;
END$$;
CREATE TRIGGER group_hold_guard BEFORE INSERT OR UPDATE OR DELETE ON inventory_holds FOR EACH ROW EXECUTE FUNCTION group_hold_guard();

CREATE FUNCTION group_claim_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o jsonb:=to_jsonb(OLD);n jsonb:=to_jsonb(NEW);released boolean;
BEGIN
 released:=CASE WHEN TG_TABLE_NAME='provisional_capacity_claims' THEN o->>'state'='ACTIVE' AND n->>'state'<>'ACTIVE'
  ELSE (o->>'active')::boolean AND NOT (n->>'active')::boolean END;
 IF released AND NOT group_op_allowed() AND EXISTS(SELECT 1 FROM inventory_holds h WHERE h.id=(o->>'hold_id')::uuid AND h.allocation_stage='GROUP_RESERVED' AND h.state='ACTIVE') THEN
  RAISE EXCEPTION 'GROUP_HOLD_PROTECTED' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END$$;
CREATE TRIGGER group_claim_guard BEFORE UPDATE ON inventory_claims FOR EACH ROW EXECUTE FUNCTION group_claim_guard();
CREATE TRIGGER group_claim_guard BEFORE UPDATE ON provisional_capacity_claims FOR EACH ROW EXECUTE FUNCTION group_claim_guard();
CREATE TRIGGER group_claim_guard BEFORE UPDATE ON wear_claims FOR EACH ROW EXECUTE FUNCTION group_claim_guard();

-- A group hold can never become an ordinary booking (no Square path, no duplicate payment from a normal confirmation link).
CREATE FUNCTION group_booking_guard() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
 IF EXISTS(SELECT 1 FROM inventory_holds h WHERE h.id=NEW.hold_id AND h.allocation_stage='GROUP_RESERVED') THEN RAISE EXCEPTION 'GROUP_HOLD_NOT_BOOKABLE' USING ERRCODE='23514';END IF;
 RETURN NEW;
END$$;
CREATE TRIGGER group_booking_guard BEFORE INSERT ON rental_bookings FOR EACH ROW EXECUTE FUNCTION group_booking_guard();

-- ---------------------------------------------------------------- authorization (same effective-permission rule as loadStaff)
CREATE FUNCTION group_staff_can(p_actor text,p_permission text,p_stores text[]) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT coalesce((
  SELECT s.active AND s.role='ADMIN'
   AND (s.scope='ALL' OR NOT EXISTS(SELECT 1 FROM unnest(p_stores) st WHERE NOT EXISTS(SELECT 1 FROM staff_store_access a WHERE a.staff_id=s.id AND a.store_id=st)))
   AND (SELECT CASE WHEN count(*) FILTER(WHERE NOT x.allowed)>0 THEN false ELSE coalesce(bool_or(x.allowed),false) END
        FROM (SELECT permission,true AS allowed FROM staff_role_permissions WHERE role=s.role UNION ALL SELECT permission,allowed FROM staff_permission_overrides WHERE staff_id=s.id) x
        WHERE x.permission=p_permission)
  FROM staff_members s WHERE s.id=p_actor),false)
$$;

-- ---------------------------------------------------------------- entrance (single permanent row; hash only)
CREATE TABLE group_entrance(
 id smallint PRIMARY KEY CHECK(id=1),
 token_sha256 text NOT NULL CHECK(token_sha256 ~ '^[a-f0-9]{64}$'),
 enabled boolean NOT NULL,generation integer NOT NULL DEFAULT 1 CHECK(generation>0),
 updated_by text NOT NULL REFERENCES staff_members(id),updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE group_entrance_history(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,generation integer NOT NULL,action text NOT NULL CHECK(action IN ('ROTATE','ENABLE','DISABLE')),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 200),actor text NOT NULL REFERENCES staff_members(id),occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE FUNCTION group_append_only() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
 IF TG_OP IN ('UPDATE','DELETE') THEN RAISE EXCEPTION 'GROUP_APPEND_ONLY' USING ERRCODE='23514';END IF;
 IF NOT group_op_allowed() THEN RAISE EXCEPTION 'GROUP_DIRECT_WRITE' USING ERRCODE='23514';END IF;
 RETURN NEW;
END$$;
CREATE TRIGGER group_entrance_history_guard BEFORE INSERT OR UPDATE OR DELETE ON group_entrance_history FOR EACH ROW EXECUTE FUNCTION group_append_only();
CREATE FUNCTION group_entrance_guard() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
 IF TG_OP='DELETE' OR NOT group_op_allowed() OR NOT group_staff_can(NEW.updated_by,'GROUP_ENTRANCE_MANAGE',(SELECT array_agg(id) FROM ledger_stores)) THEN RAISE EXCEPTION 'GROUP_ENTRANCE_FORBIDDEN' USING ERRCODE='42501';END IF;
 RETURN NEW;
END$$;
CREATE TRIGGER group_entrance_guard BEFORE INSERT OR UPDATE OR DELETE ON group_entrance FOR EACH ROW EXECUTE FUNCTION group_entrance_guard();

-- ---------------------------------------------------------------- group orders
CREATE SEQUENCE group_number_seq;
CREATE TABLE group_orders(
 id uuid PRIMARY KEY,
 group_number text NOT NULL UNIQUE DEFAULT 'G-'||lpad(nextval('group_number_seq')::text,6,'0'),
 owner_secret_sha256 text NOT NULL UNIQUE CHECK(owner_secret_sha256 ~ '^[a-f0-9]{64}$'),
 status text NOT NULL CHECK(status IN ('DRAFT','QUOTED','REVIEW_HELD','CHANGES_REQUESTED','CONFIRMED','RELEASED','CANCELLED')),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 contact_name text NOT NULL CHECK(length(btrim(contact_name)) BETWEEN 1 AND 120),
 contact_email text NOT NULL CHECK(length(contact_email) BETWEEN 3 AND 254 AND contact_email !~ '[\r\n]'),
 contact_phone text CHECK(contact_phone IS NULL OR length(contact_phone) BETWEEN 3 AND 40),
 locale text NOT NULL CHECK(locale IN ('ja','en')),
 group_label text NOT NULL CHECK(length(btrim(group_label)) BETWEEN 1 AND 120),
 pickup_store text NOT NULL REFERENCES ledger_stores(id),return_store text NOT NULL REFERENCES ledger_stores(id),
 contract_version text NOT NULL,period jsonb NOT NULL,
 member_count integer NOT NULL DEFAULT 0 CHECK(member_count BETWEEN 0 AND 100),
 payment_method text NOT NULL DEFAULT 'PAY_ON_SITE' CHECK(payment_method='PAY_ON_SITE'),
 confirmation_basis text CHECK(confirmation_basis='GROUP_ADMIN_APPROVED'),
 confirmed_at timestamptz,confirmed_by text REFERENCES staff_members(id),confirmed_quote_id uuid,confirmed_total_jpy bigint CHECK(confirmed_total_jpy IS NULL OR confirmed_total_jpy>=0),
 held_at timestamptz,released_at timestamptz,released_by text REFERENCES staff_members(id),release_reason text CHECK(release_reason IS NULL OR length(btrim(release_reason)) BETWEEN 1 AND 300),
 cancelled_at timestamptz,cancelled_by text REFERENCES staff_members(id),
 last_action jsonb NOT NULL DEFAULT '{}'::jsonb,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((confirmation_basis IS NULL)=(confirmed_at IS NULL) AND (confirmed_at IS NULL)=(confirmed_by IS NULL) AND (confirmed_at IS NULL)=(confirmed_total_jpy IS NULL)),
 CHECK((status='RELEASED')=(released_at IS NOT NULL AND released_by IS NOT NULL AND release_reason IS NOT NULL)),
 CHECK((status='CANCELLED')=(cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL)),
 CHECK(status NOT IN ('CONFIRMED') OR confirmed_at IS NOT NULL),
 CHECK(status IN ('DRAFT','QUOTED','RELEASED') OR held_at IS NOT NULL OR status='CANCELLED')
);
CREATE INDEX group_orders_status ON group_orders(status,created_at,id);

CREATE TABLE group_events(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 group_id uuid NOT NULL REFERENCES group_orders(id),revision integer NOT NULL,event_type text NOT NULL CHECK(length(event_type) BETWEEN 1 AND 60),
 actor text NOT NULL,payload jsonb NOT NULL DEFAULT '{}'::jsonb,occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX group_events_group ON group_events(group_id,id);
CREATE TRIGGER group_events_guard BEFORE INSERT OR UPDATE OR DELETE ON group_events FOR EACH ROW EXECUTE FUNCTION group_append_only();

CREATE TABLE group_members(
 id uuid PRIMARY KEY,group_id uuid NOT NULL REFERENCES group_orders(id),
 ordinal integer NOT NULL CHECK(ordinal BETWEEN 1 AND 100),
 label text NOT NULL CHECK(length(label) BETWEEN 0 AND 40),
 profile jsonb NOT NULL,selection jsonb NOT NULL,fit jsonb NOT NULL DEFAULT '{}'::jsonb,
 part_no integer CHECK(part_no IS NULL OR part_no BETWEEN 1 AND 5),
 UNIQUE(group_id,ordinal),CHECK(pg_column_size(profile)<8192 AND pg_column_size(selection)<8192 AND pg_column_size(fit)<8192)
);
CREATE FUNCTION group_member_guard() RETURNS trigger LANGUAGE plpgsql AS $$DECLARE s text;gid uuid;BEGIN
 gid:=CASE WHEN TG_OP='DELETE' THEN OLD.group_id ELSE NEW.group_id END;
 SELECT status INTO s FROM group_orders WHERE id=gid;
 IF NOT group_op_allowed() OR (s NOT IN ('DRAFT','QUOTED','CHANGES_REQUESTED') AND coalesce(current_setting('zao.group_amend',true),'')<>'on') THEN RAISE EXCEPTION 'GROUP_MEMBERS_LOCKED' USING ERRCODE='23514';END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END$$;
CREATE TRIGGER group_member_guard BEFORE INSERT OR UPDATE OR DELETE ON group_members FOR EACH ROW EXECUTE FUNCTION group_member_guard();

-- Parts: <=5 ordinary (<=20 member) holds bound to one parent. active=false only when an approved amend replaced them.
CREATE TABLE group_order_parts(
 id uuid PRIMARY KEY,group_id uuid NOT NULL REFERENCES group_orders(id),part_no integer NOT NULL CHECK(part_no BETWEEN 1 AND 5),
 generation integer NOT NULL CHECK(generation>0),
 hold_id uuid NOT NULL UNIQUE REFERENCES inventory_holds(id),reservation_id uuid NOT NULL UNIQUE REFERENCES inventory_reservations(id),
 member_count integer NOT NULL CHECK(member_count BETWEEN 1 AND 20),claim_count integer NOT NULL CHECK(claim_count>0),
 active boolean NOT NULL DEFAULT true,created_revision integer NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX group_parts_active ON group_order_parts(group_id,part_no) WHERE active;
CREATE FUNCTION group_part_guard() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
 IF NOT group_op_allowed() OR TG_OP='DELETE' THEN RAISE EXCEPTION 'GROUP_PART_PROTECTED' USING ERRCODE='23514';END IF;
 IF TG_OP='UPDATE' AND ((to_jsonb(NEW)-'active') IS DISTINCT FROM (to_jsonb(OLD)-'active') OR NOT OLD.active OR NEW.active) THEN RAISE EXCEPTION 'GROUP_PART_PROTECTED' USING ERRCODE='23514';END IF;
 RETURN NEW;
END$$;
CREATE TRIGGER group_part_guard BEFORE INSERT OR UPDATE OR DELETE ON group_order_parts FOR EACH ROW EXECUTE FUNCTION group_part_guard();

CREATE TABLE group_quotes(
 id uuid PRIMARY KEY,group_id uuid NOT NULL REFERENCES group_orders(id),version integer NOT NULL CHECK(version>0),
 kind text NOT NULL CHECK(kind IN ('ESTIMATE','CONFIRMED')),group_revision integer NOT NULL,
 price_book_id uuid NOT NULL REFERENCES price_books(id),activation_id uuid NOT NULL REFERENCES price_activations(id),
 lines jsonb NOT NULL,adjustments jsonb NOT NULL DEFAULT '[]'::jsonb,
 subtotal_jpy bigint NOT NULL CHECK(subtotal_jpy>=0),bundle_discount_jpy bigint NOT NULL CHECK(bundle_discount_jpy>=0),
 member_discount_jpy bigint NOT NULL CHECK(member_discount_jpy>=0),group_discount_jpy bigint NOT NULL CHECK(group_discount_jpy>=0),
 total_jpy bigint NOT NULL CHECK(total_jpy>=0),advance_discount_jpy bigint NOT NULL DEFAULT 0 CHECK(advance_discount_jpy=0),
 items_digest text NOT NULL CHECK(items_digest ~ '^[a-f0-9]{64}$'),digest text NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'),
 no_charge_confirmed boolean NOT NULL DEFAULT false,created_by text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(group_id,version),
 CHECK(total_jpy=subtotal_jpy-bundle_discount_jpy-member_discount_jpy-group_discount_jpy),
 CHECK(total_jpy>0 OR no_charge_confirmed)
);
ALTER TABLE group_orders ADD CONSTRAINT group_confirmed_quote_fk FOREIGN KEY(confirmed_quote_id) REFERENCES group_quotes(id);
CREATE TRIGGER group_quotes_guard BEFORE INSERT OR UPDATE OR DELETE ON group_quotes FOR EACH ROW EXECUTE FUNCTION group_append_only();

CREATE TABLE group_consents(
 id uuid PRIMARY KEY,group_id uuid NOT NULL REFERENCES group_orders(id),quote_id uuid NOT NULL UNIQUE REFERENCES group_quotes(id),
 quote_digest text NOT NULL,items_digest text NOT NULL,max_total_jpy bigint NOT NULL CHECK(max_total_jpy>=0),
 terms_version text NOT NULL,terms_sha256 text NOT NULL CHECK(terms_sha256 ~ '^[a-f0-9]{64}$'),
 explanation_confirmed boolean NOT NULL CHECK(explanation_confirmed),accepted_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER group_consents_guard BEFORE INSERT OR UPDATE OR DELETE ON group_consents FOR EACH ROW EXECUTE FUNCTION group_append_only();

-- Admin discounts. A "set" is one complete replacement; older sets stay as history. Within one target one method only.
CREATE TABLE group_adjustments(
 id uuid PRIMARY KEY,group_id uuid NOT NULL REFERENCES group_orders(id),set_no integer NOT NULL CHECK(set_no>0),
 target text NOT NULL CHECK(target IN ('MEMBER','GROUP')),member_id uuid, -- plain uuid: members may be replaced by an approved amend while history stays
 
 method text NOT NULL CHECK(method IN ('FIXED_JPY','PERCENT_BPS')),value integer NOT NULL CHECK(value>0),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 200),actor text NOT NULL REFERENCES staff_members(id),
 before_jpy bigint NOT NULL CHECK(before_jpy>=0),after_jpy bigint NOT NULL CHECK(after_jpy>=0 AND after_jpy<=before_jpy),
 occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((target='MEMBER')=(member_id IS NOT NULL)),CHECK(method<>'PERCENT_BPS' OR value<=10000)
);
CREATE UNIQUE INDEX group_adjustments_one_method ON group_adjustments(group_id,set_no,target,coalesce(member_id,'00000000-0000-0000-0000-000000000000'::uuid));
CREATE FUNCTION group_adjustment_guard() RETURNS trigger LANGUAGE plpgsql AS $$DECLARE g group_orders;BEGIN
 IF TG_OP IN ('UPDATE','DELETE') OR NOT group_op_allowed() THEN RAISE EXCEPTION 'GROUP_APPEND_ONLY' USING ERRCODE='23514';END IF;
 SELECT * INTO g FROM group_orders WHERE id=NEW.group_id;
 IF NOT group_staff_can(NEW.actor,'GROUP_DISCOUNT',ARRAY[g.pickup_store,g.return_store]) OR NEW.actor IS DISTINCT FROM current_setting('zao.actor',true) THEN RAISE EXCEPTION 'GROUP_NOT_AUTHORIZED' USING ERRCODE='42501';END IF;
 RETURN NEW;
END$$;
CREATE TRIGGER group_adjustment_guard BEFORE INSERT OR UPDATE OR DELETE ON group_adjustments FOR EACH ROW EXECUTE FUNCTION group_adjustment_guard();

-- Customer requests (change / decline) are only recorded for the administrator; they never release anything.
CREATE TABLE group_change_requests(
 id uuid PRIMARY KEY,group_id uuid NOT NULL REFERENCES group_orders(id),kind text NOT NULL CHECK(kind IN ('CHANGE','DECLINE','ADMIN_REQUEST')),
 body text NOT NULL CHECK(length(body) BETWEEN 0 AND 2000),payload jsonb NOT NULL DEFAULT '{}'::jsonb,
 status text NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','APPLIED','REJECTED')),created_revision integer NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),resolved_at timestamptz,resolved_by text
);
CREATE FUNCTION group_change_request_guard() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
 IF TG_OP='DELETE' OR NOT group_op_allowed() THEN RAISE EXCEPTION 'GROUP_APPEND_ONLY' USING ERRCODE='23514';END IF;
 IF TG_OP='UPDATE' AND (OLD.status<>'OPEN' OR NEW.status='OPEN' OR (to_jsonb(NEW)-'status'-'resolved_at'-'resolved_by') IS DISTINCT FROM (to_jsonb(OLD)-'status'-'resolved_at'-'resolved_by')) THEN RAISE EXCEPTION 'GROUP_APPEND_ONLY' USING ERRCODE='23514';END IF;
 RETURN NEW;
END$$;
CREATE TRIGGER group_change_request_guard BEFORE INSERT OR UPDATE OR DELETE ON group_change_requests FOR EACH ROW EXECUTE FUNCTION group_change_request_guard();

-- On-site receipts only. RECEIPT/REVERSAL, append-only; nothing here is a provider/Square record.
CREATE TABLE group_payments(
 id uuid PRIMARY KEY,group_id uuid NOT NULL REFERENCES group_orders(id),kind text NOT NULL CHECK(kind IN ('RECEIPT','REVERSAL')),
 amount_jpy bigint NOT NULL CHECK(amount_jpy>0),method text NOT NULL CHECK(method IN ('CASH','CARD_AT_COUNTER','OTHER_ON_SITE')),
 received_at timestamptz NOT NULL,note text NOT NULL DEFAULT '' CHECK(length(note)<=300),
 reverses_id uuid UNIQUE REFERENCES group_payments(id),reason text CHECK(reason IS NULL OR length(btrim(reason)) BETWEEN 1 AND 300),
 recorded_by text NOT NULL REFERENCES staff_members(id),recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((kind='REVERSAL')=(reverses_id IS NOT NULL) AND (kind='REVERSAL')=(reason IS NOT NULL))
);
CREATE FUNCTION group_payment_guard() RETURNS trigger LANGUAGE plpgsql AS $$DECLARE g group_orders;net bigint;r group_payments;BEGIN
 IF TG_OP IN ('UPDATE','DELETE') OR NOT group_op_allowed() THEN RAISE EXCEPTION 'GROUP_APPEND_ONLY' USING ERRCODE='23514';END IF;
 SELECT * INTO g FROM group_orders WHERE id=NEW.group_id FOR UPDATE;
 IF g.status<>'CONFIRMED' THEN RAISE EXCEPTION 'GROUP_NOT_CONFIRMED_FOR_PAYMENT' USING ERRCODE='23514';END IF;
 IF NEW.recorded_by IS DISTINCT FROM current_setting('zao.actor',true) OR NOT group_staff_can(NEW.recorded_by,'GROUP_PAYMENT_RECORD',ARRAY[g.pickup_store,g.return_store]) THEN RAISE EXCEPTION 'GROUP_NOT_AUTHORIZED' USING ERRCODE='42501';END IF;
 SELECT coalesce(sum(CASE kind WHEN 'RECEIPT' THEN amount_jpy ELSE -amount_jpy END),0) INTO net FROM group_payments WHERE group_id=NEW.group_id;
 IF NEW.kind='RECEIPT' AND net+NEW.amount_jpy>g.confirmed_total_jpy THEN RAISE EXCEPTION 'GROUP_OVERPAYMENT' USING ERRCODE='23514';END IF;
 IF NEW.kind='REVERSAL' THEN
  SELECT * INTO r FROM group_payments WHERE id=NEW.reverses_id;
  IF NOT FOUND OR r.kind<>'RECEIPT' OR r.group_id<>NEW.group_id OR r.amount_jpy<>NEW.amount_jpy THEN RAISE EXCEPTION 'GROUP_REVERSAL_INVALID' USING ERRCODE='23514';END IF;
 END IF;
 RETURN NEW;
END$$;
CREATE TRIGGER group_payment_guard BEFORE INSERT OR UPDATE OR DELETE ON group_payments FOR EACH ROW EXECUTE FUNCTION group_payment_guard();

CREATE TABLE group_requests(
 actor_key text NOT NULL,request_key uuid NOT NULL,fingerprint text NOT NULL CHECK(length(fingerprint)=64),result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(actor_key,request_key)
);
CREATE TRIGGER group_requests_guard BEFORE INSERT OR UPDATE OR DELETE ON group_requests FOR EACH ROW EXECUTE FUNCTION group_append_only();

-- ---------------------------------------------------------------- state machine guard
CREATE FUNCTION group_order_guard() RETURNS trigger LANGUAGE plpgsql AS $$
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
   -- (0064 has no group loan: nothing can be out. 0065, the custody link, replaces this function with the "item still out" rule.)
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
CREATE TRIGGER group_order_guard BEFORE INSERT OR UPDATE OR DELETE ON group_orders FOR EACH ROW EXECUTE FUNCTION group_order_guard();

-- Atomic outcome invariant, checked at COMMIT: whatever the application did, a group is never visible half held / half released.
CREATE FUNCTION group_consistency() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE g group_orders;n integer;m integer;bad integer;
BEGIN
 SELECT * INTO g FROM group_orders WHERE id=NEW.id;
 IF g.status IN ('REVIEW_HELD','CHANGES_REQUESTED','CONFIRMED') THEN
  SELECT coalesce(sum(member_count),0) INTO n FROM group_order_parts WHERE group_id=g.id AND active;
  SELECT count(*) INTO m FROM group_members WHERE group_id=g.id;
  IF g.member_count<1 OR n<>g.member_count OR m<>g.member_count THEN RAISE EXCEPTION 'GROUP_PARTS_INCOMPLETE' USING ERRCODE='23514';END IF;
  SELECT count(*) INTO bad FROM group_order_parts p JOIN inventory_holds h ON h.id=p.hold_id WHERE p.group_id=g.id AND p.active
   AND (h.state<>'ACTIVE' OR h.allocation_stage<>'GROUP_RESERVED' OR h.expires_at IS NOT NULL OR h.payment_state<>'NONE' OR h.confirmed_at IS NOT NULL
        OR (SELECT count(*) FROM inventory_claims c WHERE c.hold_id=h.id AND c.active)=0);
  -- (0065, the custody link, replaces this function: a confirmed part may then be PREPARATION_FIXED / RENTAL_FIXED and, once lent, hold no active claim.)
  IF bad>0 OR (SELECT count(*) FROM group_order_parts WHERE group_id=g.id AND active)<>(SELECT count(*) FROM group_order_parts p JOIN inventory_holds h ON h.id=p.hold_id WHERE p.group_id=g.id AND p.active) THEN RAISE EXCEPTION 'GROUP_HOLD_NOT_PROTECTED' USING ERRCODE='23514';END IF;
 ELSIF g.status IN ('RELEASED','CANCELLED') THEN
  IF EXISTS(SELECT 1 FROM group_order_parts p JOIN inventory_holds h ON h.id=p.hold_id WHERE p.group_id=g.id AND p.active AND (h.state='ACTIVE' OR EXISTS(SELECT 1 FROM inventory_claims c WHERE c.hold_id=h.id AND c.active))) THEN RAISE EXCEPTION 'GROUP_RELEASE_PARTIAL' USING ERRCODE='23514';END IF;
 ELSE
  IF EXISTS(SELECT 1 FROM group_order_parts WHERE group_id=g.id AND active) THEN RAISE EXCEPTION 'GROUP_PARTS_UNEXPECTED' USING ERRCODE='23514';END IF;
 END IF;
 RETURN NULL;
END$$;
CREATE CONSTRAINT TRIGGER group_consistency AFTER INSERT OR UPDATE ON group_orders DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION group_consistency();

-- ---------------------------------------------------------------- customer notification outbox (mirrors the booking outbox model)
-- The booking outbox is FK-bound to rental_bookings (a group has none), so groups get their own table of the same shape.
-- Rows are created only by the event trigger below, in the same transaction as the state commit.
CREATE TABLE group_notification_outbox(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),group_id uuid NOT NULL REFERENCES group_orders(id),event_id bigint NOT NULL UNIQUE REFERENCES group_events(id),
 event_type text NOT NULL CHECK(event_type IN ('GROUP_REVIEW_HELD','GROUP_CONFIRMED','GROUP_CHANGES_REQUESTED','GROUP_RELEASED','GROUP_CANCELLED')),
 dedupe_key text NOT NULL UNIQUE CHECK(length(dedupe_key) BETWEEN 1 AND 180),locale text NOT NULL CHECK(locale IN ('ja','en')),
 template_version text NOT NULL CHECK(template_version='GROUP_NOTIFICATION_V1'),
 admin_message text CHECK(admin_message IS NULL OR (length(admin_message)<=2000 AND admin_message !~ '[\x00-\x08\x0b\x0c\x0e-\x1f]')),
 status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','SENDING','SENT','RETRYABLE_FAILURE','PERMANENT_FAILURE','SUPPRESSED','UNKNOWN')),
 attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 3),next_attempt_at timestamptz,claim_id uuid,claim_until timestamptz,
 provider_message_id text CHECK(provider_message_id ~ '^[-A-Za-z0-9_]{1,128}$'),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),sent_at timestamptz,
 last_safe_failure_code text NOT NULL DEFAULT 'NONE' CHECK(last_safe_failure_code IN ('NONE','RATE_LIMITED','PROVIDER_UNAVAILABLE','PERMANENT_REJECT','ACCEPTANCE_UNKNOWN','RETRY_EXHAUSTED','TEMPLATE_UNAVAILABLE','RECIPIENT_UNAVAILABLE')),
 CHECK((status='SENDING')=(claim_id IS NOT NULL AND claim_until IS NOT NULL)),CHECK((claim_id IS NULL)=(claim_until IS NULL)),
 CHECK((status='SENT')=(sent_at IS NOT NULL)),CHECK(status<>'SENT' OR provider_message_id IS NOT NULL)
);
CREATE INDEX group_notification_due ON group_notification_outbox(next_attempt_at,id) WHERE status IN ('PENDING','RETRYABLE_FAILURE');

-- Status change => immutable event (so a state can never change without its event), notifiable event => outbox, one tx.
CREATE FUNCTION group_order_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE t text;
BEGIN
 IF TG_OP='INSERT' THEN t:='GROUP_STARTED';
 ELSIF NEW.status<>OLD.status THEN
  t:=CASE NEW.status WHEN 'QUOTED' THEN 'GROUP_QUOTED' WHEN 'DRAFT' THEN 'GROUP_REOPENED' WHEN 'REVIEW_HELD' THEN CASE OLD.status WHEN 'QUOTED' THEN 'GROUP_REVIEW_HELD' ELSE 'GROUP_CHANGE_APPLIED' END
   WHEN 'CHANGES_REQUESTED' THEN 'GROUP_CHANGES_REQUESTED' WHEN 'CONFIRMED' THEN 'GROUP_CONFIRMED' WHEN 'RELEASED' THEN 'GROUP_RELEASED' WHEN 'CANCELLED' THEN 'GROUP_CANCELLED' END;
 ELSE t:=coalesce(NEW.last_action->>'event','GROUP_REVISED');END IF;
 INSERT INTO group_events(group_id,revision,event_type,actor,payload) VALUES(NEW.id,NEW.revision,t,coalesce(current_setting('zao.actor',true),'unknown'),
  jsonb_build_object('status',NEW.status)||(NEW.last_action-'event'));
 RETURN NULL;
END$$;
CREATE TRIGGER group_order_event AFTER INSERT OR UPDATE ON group_orders FOR EACH ROW EXECUTE FUNCTION group_order_event();

CREATE FUNCTION group_event_outbox() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$DECLARE g group_orders;BEGIN
 IF NEW.event_type NOT IN ('GROUP_REVIEW_HELD','GROUP_CONFIRMED','GROUP_CHANGES_REQUESTED','GROUP_RELEASED','GROUP_CANCELLED') THEN RETURN NULL;END IF;
 SELECT * INTO g FROM group_orders WHERE id=NEW.group_id;
 -- A newer state makes every not-yet-delivered older notice stale: it is suppressed, never delivered late (no "currently held" after a release).
 UPDATE group_notification_outbox SET status='SUPPRESSED' WHERE group_id=NEW.group_id AND status IN ('PENDING','RETRYABLE_FAILURE') AND event_id<NEW.id;
 INSERT INTO group_notification_outbox(group_id,event_id,event_type,dedupe_key,locale,template_version,admin_message,next_attempt_at)
 VALUES(NEW.group_id,NEW.id,NEW.event_type,NEW.group_id||':'||NEW.event_type||':'||NEW.revision,g.locale,'GROUP_NOTIFICATION_V1',NEW.payload->>'message',clock_timestamp())
 ON CONFLICT(dedupe_key) DO NOTHING;
 RETURN NULL;
END$$;
CREATE TRIGGER group_event_outbox AFTER INSERT ON group_events FOR EACH ROW EXECUTE FUNCTION group_event_outbox();

-- Each group's allocator identity (inventory ownership FK needs a booking_actors row). Narrow definer function.
CREATE FUNCTION group_register_actor(p_group uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$BEGIN
 IF NOT group_op_allowed() OR NOT EXISTS(SELECT 1 FROM group_orders WHERE id=p_group) THEN RAISE EXCEPTION 'GROUP_ACTOR_FORBIDDEN' USING ERRCODE='42501';END IF;
 INSERT INTO booking_actors(id,kind) VALUES('group:'||p_group,'GUEST') ON CONFLICT DO NOTHING;
 RETURN 'group:'||p_group;
END$$;
REVOKE ALL ON FUNCTION group_register_actor(uuid) FROM PUBLIC;
REVOKE ALL ON group_entrance,group_entrance_history,group_orders,group_events,group_members,group_order_parts,group_quotes,group_consents,group_adjustments,group_change_requests,group_payments,group_requests,group_notification_outbox FROM PUBLIC;
REVOKE ALL ON FUNCTION group_hold_guard(),group_claim_guard(),group_booking_guard(),group_append_only(),group_entrance_guard(),group_member_guard(),group_part_guard(),group_adjustment_guard(),group_change_request_guard(),group_payment_guard(),group_order_guard(),group_consistency(),group_order_event(),group_event_outbox() FROM PUBLIC;
