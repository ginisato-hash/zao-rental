import type {Pool} from 'pg';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
const mig=(file:string)=>readFileSync(resolve(process.cwd(),'packages/db/migrations',file),'utf8');
const between=(text:string,from:string,to:string)=>{const a=text.indexOf(from),b=text.indexOf(to,a);if(a<0||b<0)throw new Error('REWIND_SOURCE_NOT_FOUND '+from);return text.slice(a,b);};
/** The exact pre-0064 definitions that 0064 replaces (read from the migrations that introduced them, so they cannot drift). */
const PRE_0064_DEFINITIONS=[
 between(mig('0033_launch_operations.sql'),'CREATE OR REPLACE VIEW rental_inventory_blocks AS','CREATE TABLE rental_internal.amendment_effects'),
 between(mig('0015_custody_boundary.sql'),'CREATE FUNCTION rental_apply_receipt','REVOKE ALL ON FUNCTION rental_apply_receipt').replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION'),
 between(mig('0049_production_custody_states.sql'),'CREATE OR REPLACE FUNCTION rental_stage_guard','CREATE OR REPLACE FUNCTION rental_complete_no_pickup'),
].join('\n');
/** Emulates a database dumped before 0064 (group order core): removes exactly what 0064 added, in dependency order.
 * Used by the historical-registry restore/role-plan fixtures, like the earlier per-migration rewinds. Not a product operation. */
export const REWIND_0064_SQL=`
${PRE_0064_DEFINITIONS}
-- group custody connection (loan subject columns, preparations, validators)
DROP TRIGGER IF EXISTS rental_validate_group_loan ON rental_loan_items;
DROP TRIGGER IF EXISTS rental_validate_loan ON rental_loan_items;
CREATE TRIGGER rental_validate_loan BEFORE INSERT ON rental_loan_items FOR EACH ROW EXECUTE FUNCTION rental_validate_loan();
ALTER TABLE rental_loan_items DROP CONSTRAINT IF EXISTS rental_loan_subject;
DROP INDEX IF EXISTS rental_group_requirement;
DROP INDEX IF EXISTS rental_loan_group_part;
ALTER TABLE rental_loan_items DROP COLUMN IF EXISTS hold_id,DROP COLUMN IF EXISTS group_part_id;
ALTER TABLE rental_loan_items ALTER COLUMN booking_id SET NOT NULL;
DROP TABLE IF EXISTS group_part_preparations;
DROP FUNCTION IF EXISTS rental_validate_group_loan(),group_member_manual_fit(jsonb);
DROP TRIGGER IF EXISTS group_hold_guard ON inventory_holds;
DROP TRIGGER IF EXISTS group_claim_guard ON inventory_claims;
DROP TRIGGER IF EXISTS group_claim_guard ON provisional_capacity_claims;
DROP TRIGGER IF EXISTS group_claim_guard ON wear_claims;
DROP TRIGGER IF EXISTS group_booking_guard ON rental_bookings;
DROP TABLE IF EXISTS group_notification_outbox,group_requests,group_payments,group_change_requests,group_adjustments,group_consents,group_quotes,group_order_parts,group_members,group_events,group_orders,group_entrance_history,group_entrance CASCADE;
DROP SEQUENCE IF EXISTS group_number_seq;
DROP FUNCTION IF EXISTS group_custody_hold_update(inventory_holds,inventory_holds);
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
