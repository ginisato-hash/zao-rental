import type {Pool} from 'pg';
/** Emulates a database dumped before 0064 (group order core): removes exactly what 0064 added, in dependency order.
 * Used by the historical-registry restore/role-plan fixtures, like the earlier per-migration rewinds. Not a product operation. */
export const REWIND_0064_SQL=`
DROP TRIGGER IF EXISTS group_hold_guard ON inventory_holds;
DROP TRIGGER IF EXISTS group_claim_guard ON inventory_claims;
DROP TRIGGER IF EXISTS group_claim_guard ON provisional_capacity_claims;
DROP TRIGGER IF EXISTS group_claim_guard ON wear_claims;
DROP TRIGGER IF EXISTS group_booking_guard ON rental_bookings;
DROP TABLE IF EXISTS group_notification_outbox,group_requests,group_payments,group_change_requests,group_adjustments,group_consents,group_quotes,group_order_parts,group_members,group_events,group_orders,group_entrance_history,group_entrance CASCADE;
DROP SEQUENCE IF EXISTS group_number_seq;
DROP FUNCTION IF EXISTS group_register_actor(uuid),group_event_outbox(),group_order_event(),group_consistency(),group_order_guard(),group_payment_guard(),group_change_request_guard(),group_adjustment_guard(),group_part_guard(),group_member_guard(),group_entrance_guard(),group_append_only(),group_staff_can(text,text,text[]),group_booking_guard(),group_claim_guard(),group_hold_guard(),group_op_allowed();
ALTER TABLE inventory_holds DROP CONSTRAINT IF EXISTS inventory_hold_expiry_required,DROP CONSTRAINT IF EXISTS inventory_hold_group_no_expiry;
ALTER TABLE inventory_holds ALTER COLUMN expires_at SET NOT NULL;
ALTER TABLE inventory_holds DROP CONSTRAINT inventory_holds_allocation_stage_check;
ALTER TABLE inventory_holds ADD CONSTRAINT inventory_holds_allocation_stage_check CHECK(allocation_stage IN ('PROVISIONAL','PREPARATION_FIXED','RENTAL_FIXED'));
DELETE FROM staff_permission_overrides WHERE permission LIKE 'GROUP\\_%';
DELETE FROM staff_role_permissions WHERE permission LIKE 'GROUP\\_%';
ALTER TABLE staff_role_permissions DROP CONSTRAINT staff_role_permissions_permission_check;
ALTER TABLE staff_permission_overrides DROP CONSTRAINT staff_permission_overrides_permission_check;
ALTER TABLE staff_role_permissions ADD CHECK(permission IN ('INVENTORY_VIEW','INVENTORY_EDIT','STAFF_MANAGE','HOLD_VIEW','HOLD_EDIT','TRANSFER_VIEW','TRANSFER_PLAN','TRANSFER_DISPATCH','TRANSFER_RECEIVE','QUOTE_VIEW','QUOTE_CREATE','PRICE_EDIT','BOOKING_VIEW','BOOKING_CREATE','RENTAL_CHECKOUT','RENTAL_RETURN','RENTAL_AMEND','REFUND_OVERRIDE','INVENTORY_RECONCILE','NOTIFICATION_RESEND','OPERATIONS_VIEW','OPERATIONS_ACKNOWLEDGE','FIELD_ACCEPTANCE','INVENTORY_BUFFER_OVERRIDE'));
ALTER TABLE staff_permission_overrides ADD CHECK(permission IN ('INVENTORY_VIEW','INVENTORY_EDIT','STAFF_MANAGE','HOLD_VIEW','HOLD_EDIT','TRANSFER_VIEW','TRANSFER_PLAN','TRANSFER_DISPATCH','TRANSFER_RECEIVE','QUOTE_VIEW','QUOTE_CREATE','PRICE_EDIT','BOOKING_VIEW','BOOKING_CREATE','RENTAL_CHECKOUT','RENTAL_RETURN','RENTAL_AMEND','REFUND_OVERRIDE','INVENTORY_RECONCILE','NOTIFICATION_RESEND','OPERATIONS_VIEW','OPERATIONS_ACKNOWLEDGE','FIELD_ACCEPTANCE','INVENTORY_BUFFER_OVERRIDE'));
DELETE FROM foundation_migrations WHERE id='0064';`;
export async function rewind0064(pool:Pick<Pool,'query'>){await pool.query(REWIND_0064_SQL);}
