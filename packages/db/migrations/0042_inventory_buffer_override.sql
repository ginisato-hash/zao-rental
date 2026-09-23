-- Owner decision (release-code-closure): 95% public reservation capacity across physical/wear/
-- provisional inventory, with staff INVENTORY_BUFFER_OVERRIDE able to draw on the remaining
-- operational capacity. This migration adds only the durable state and audit trail the override
-- needs — capacity math itself lives in application code (allocation.ts/wear-capacity.ts/
-- provisional-capacity.ts), exactly like the existing quantity-pool mechanisms.

-- New permission, no default role grant — matching every permission added since 0003_staff_auth.sql's
-- original seed (HOLD_VIEW, RENTAL_CHECKOUT, FIELD_ACCEPTANCE, etc.): who actually has it is an
-- Owner/ADMIN staff-management decision made afterward via staff_role_permissions/
-- staff_permission_overrides, never baked into a migration.
ALTER TABLE staff_role_permissions DROP CONSTRAINT staff_role_permissions_permission_check;
ALTER TABLE staff_permission_overrides DROP CONSTRAINT staff_permission_overrides_permission_check;
ALTER TABLE staff_role_permissions ADD CHECK(permission IN ('INVENTORY_VIEW','INVENTORY_EDIT','STAFF_MANAGE','HOLD_VIEW','HOLD_EDIT','TRANSFER_VIEW','TRANSFER_PLAN','TRANSFER_DISPATCH','TRANSFER_RECEIVE','QUOTE_VIEW','QUOTE_CREATE','PRICE_EDIT','BOOKING_VIEW','BOOKING_CREATE','RENTAL_CHECKOUT','RENTAL_RETURN','RENTAL_AMEND','REFUND_OVERRIDE','INVENTORY_RECONCILE','NOTIFICATION_RESEND','OPERATIONS_VIEW','OPERATIONS_ACKNOWLEDGE','FIELD_ACCEPTANCE','INVENTORY_BUFFER_OVERRIDE'));
ALTER TABLE staff_permission_overrides ADD CHECK(permission IN ('INVENTORY_VIEW','INVENTORY_EDIT','STAFF_MANAGE','HOLD_VIEW','HOLD_EDIT','TRANSFER_VIEW','TRANSFER_PLAN','TRANSFER_DISPATCH','TRANSFER_RECEIVE','QUOTE_VIEW','QUOTE_CREATE','PRICE_EDIT','BOOKING_VIEW','BOOKING_CREATE','RENTAL_CHECKOUT','RENTAL_RETURN','RENTAL_AMEND','REFUND_OVERRIDE','INVENTORY_RECONCILE','NOTIFICATION_RESEND','OPERATIONS_VIEW','OPERATIONS_ACKNOWLEDGE','FIELD_ACCEPTANCE','INVENTORY_BUFFER_OVERRIDE'));

ALTER TABLE inventory_holds ADD COLUMN buffer_override boolean NOT NULL DEFAULT false;

-- Append-only audit trail: who invoked the buffer, for which hold, and why. `classification`
-- exists to keep this log self-describing if a second override kind is ever added; today it is
-- always STAFF_BUFFER_OVERRIDE — a request that merely respects the ordinary 95% public ceiling
-- is never recorded here at all.
CREATE TABLE inventory_buffer_override_log(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 hold_id uuid NOT NULL REFERENCES inventory_holds(id),
 actor text NOT NULL REFERENCES booking_actors(id),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 300),
 classification text NOT NULL DEFAULT 'STAFF_BUFFER_OVERRIDE' CHECK(classification='STAFF_BUFFER_OVERRIDE'),
 occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX inventory_buffer_override_log_hold_idx ON inventory_buffer_override_log(hold_id,id);
CREATE TRIGGER inventory_buffer_override_log_guard BEFORE UPDATE OR DELETE ON inventory_buffer_override_log FOR EACH ROW EXECUTE FUNCTION ledger_append_only();

-- SECURITY DEFINER, exactly mirroring inventory_record_replan (0004_period_hold.sql): the actor
-- column is always the authenticated zao.actor session setting, never a caller-supplied value,
-- so the log cannot be forged by whichever DB role happens to call it. The application layer
-- (HoldService) is the actual authorization boundary — it must verify INVENTORY_BUFFER_OVERRIDE
-- and store scope, and must refuse a guest actor structurally, before this function is ever
-- reached; this function only makes the resulting use durable and attributable.
CREATE FUNCTION inventory_buffer_override_record(p_hold_id uuid,p_reason text) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE v_id bigint;
BEGIN
 IF p_reason IS NULL OR length(btrim(p_reason))=0 OR length(p_reason)>300 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVENTORY_BUFFER_OVERRIDE_REASON_INVALID';END IF;
 INSERT INTO inventory_buffer_override_log(hold_id,actor,reason) VALUES(p_hold_id,current_setting('zao.actor'),p_reason) RETURNING id INTO v_id;
 RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION inventory_buffer_override_record(uuid,text) FROM PUBLIC;
