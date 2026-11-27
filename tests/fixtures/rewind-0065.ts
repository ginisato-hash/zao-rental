import type {Pool} from 'pg';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
const mig=(file:string)=>readFileSync(resolve(process.cwd(),'packages/db/migrations',file),'utf8');
const between=(text:string,from:string,to:string)=>{const a=text.indexOf(from),b=text.indexOf(to,a);if(a<0||b<0)throw new Error('REWIND_SOURCE_NOT_FOUND '+from);return text.slice(a,b);};
const asReplace=(sql:string)=>sql.replace(/^CREATE FUNCTION/m,'CREATE OR REPLACE FUNCTION');
const core=mig('0064_group_order_core.sql');
/** The exact pre-0065 definitions that 0065 replaces: the ordinary custody objects (read from the migrations that introduced them) and the
 * core guards exactly as 0064 defines them (read from 0064 itself), so neither can drift. */
const PRE_0065_DEFINITIONS=[
 between(mig('0033_launch_operations.sql'),'CREATE OR REPLACE VIEW rental_inventory_blocks AS','CREATE TABLE rental_internal.amendment_effects'),
 between(mig('0015_custody_boundary.sql'),'CREATE FUNCTION rental_apply_receipt','REVOKE ALL ON FUNCTION rental_apply_receipt').replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION'),
 between(mig('0049_production_custody_states.sql'),'CREATE OR REPLACE FUNCTION rental_stage_guard','CREATE OR REPLACE FUNCTION rental_complete_no_pickup'),
 asReplace(between(core,'CREATE FUNCTION group_custody_hold_update','CREATE FUNCTION group_hold_guard')),
 asReplace(between(core,'CREATE FUNCTION group_order_guard','CREATE TRIGGER group_order_guard')),
 asReplace(between(core,'CREATE FUNCTION group_consistency','CREATE CONSTRAINT TRIGGER group_consistency')),
].join('\n');
/** Emulates a database at 0064 only (group order core applied, custody link NOT applied): removes exactly what 0065 added, in dependency order.
 * Test fixture for the "Production runs on 0064 alone" state and for the historical-registry restore fixtures. Not a product operation. */
export const REWIND_0065_SQL=`
${PRE_0065_DEFINITIONS}
DROP TRIGGER IF EXISTS rental_validate_group_loan ON rental_loan_items;
DROP TRIGGER IF EXISTS rental_validate_loan ON rental_loan_items;
CREATE TRIGGER rental_validate_loan BEFORE INSERT ON rental_loan_items FOR EACH ROW EXECUTE FUNCTION rental_validate_loan();
ALTER TABLE rental_loan_items DROP CONSTRAINT IF EXISTS rental_loan_subject;
DROP INDEX IF EXISTS rental_group_requirement;
DROP INDEX IF EXISTS rental_loan_group_part;
ALTER TABLE rental_loan_items DROP COLUMN IF EXISTS hold_id,DROP COLUMN IF EXISTS group_part_id;
ALTER TABLE rental_loan_items ALTER COLUMN booking_id SET NOT NULL;
DROP TABLE IF EXISTS group_part_preparations;
DROP FUNCTION IF EXISTS rental_validate_group_loan(),group_member_manual_fit(jsonb),group_custody_stage_ok(inventory_holds,inventory_holds);
DELETE FROM foundation_migrations WHERE id='0065';`;
export async function rewind0065(pool:Pick<Pool,'query'>){await pool.query(REWIND_0065_SQL);}
