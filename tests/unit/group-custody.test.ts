import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {groupMemberNeedsManualFit} from '../../packages/core/src/rental/custody-service';

// The custody link is migration 0065 (split out of 0064: Owner decision 2026-11-27, option A); 0064 is the owner-applicable core.
const sql=readFileSync('packages/db/migrations/0065_group_custody_link.sql','utf8');
const core=readFileSync('packages/db/migrations/0064_group_order_core.sql','utf8');
const fn=(name:string)=>{let a=sql.indexOf('CREATE FUNCTION '+name);if(a<0)a=sql.indexOf('CREATE OR REPLACE FUNCTION '+name);const b=sql.indexOf('END$$;',a);assert.ok(a>=0&&b>a,name);return sql.slice(a,b);};
const ordinary=readFileSync('packages/db/migrations/0049_production_custody_states.sql','utf8');

test('manual-fit predicate: the group status, the size-edge FitMeta kind and the per-member selection fit all count; ordinary fits do not',()=>{
 assert.equal(groupMemberNeedsManualFit({status:'MANUAL_FIT_REQUIRED'}),true);
 assert.equal(groupMemberNeedsManualFit({kind:'MANUAL_FIT_REQUIRED'}),true);
 assert.equal(groupMemberNeedsManualFit({direction:'UP',fit:{kind:'MANUAL_FIT_REQUIRED'}}),true);
 for(const f of [null,undefined,{},{status:'OK'},{kind:'NORMAL'},{kind:'EDGE_BELOW'},{kind:'NEAREST_AVAILABLE'},{fit:{kind:'NORMAL'}}])assert.equal(groupMemberNeedsManualFit(f as never),false);
});

test('group loan validator: group-only gate (confirmed by GROUP_ADMIN_APPROVED, payment_state NONE) and it never accepts a payment SUCCESS shortcut',()=>{
 const v=fn('rental_validate_group_loan()');
 assert.match(v,/go\.confirmation_basis IS DISTINCT FROM 'GROUP_ADMIN_APPROVED'/);
 assert.match(v,/go\.status<>'CONFIRMED'/);
 assert.match(v,/h\.payment_state<>'NONE'/,'a group hold must keep payment_state NONE: a fabricated SUCCESS is refused, not honoured');
 assert.doesNotMatch(v,/'SUCCESS'/);
 assert.match(v,/h\.allocation_stage<>'PREPARATION_FIXED'/);
 for(const rule of ['CUSTODY_PREPARATION_REQUIRED','CUSTODY_FULL_PERIOD_WITNESS_REQUIRED','CUSTODY_ASSET_NOT_READY','CUSTODY_POOL_NOT_READY','CUSTODY_PAIR_NOT_READY','CUSTODY_STOCK_BLOCKED','CUSTODY_PROMISE_MISMATCH','CUSTODY_MANUAL_FIT_REQUIRED'])assert.match(v,new RegExp(rule),'group validator keeps the physical rule '+rule);
});

test('the ordinary booking validator and its payment gate are untouched: it only stops seeing group rows',()=>{
 assert.match(ordinary,/h\.payment_state<>'SUCCESS'/);
 assert.match(sql,/CREATE TRIGGER rental_validate_loan BEFORE INSERT ON rental_loan_items FOR EACH ROW WHEN \(NEW\.group_part_id IS NULL\)/);
 assert.match(sql,/CREATE TRIGGER rental_validate_group_loan BEFORE INSERT ON rental_loan_items FOR EACH ROW WHEN \(NEW\.group_part_id IS NOT NULL\)/);
 assert.doesNotMatch(sql,/CREATE OR REPLACE FUNCTION rental_validate_loan\(\)/,'0065 does not redefine the ordinary validator');
});

test('stage edges: one statement of the group rule (confirmed by GROUP_ADMIN_APPROVED, payment NONE) used by both the group hold guard and the custody stage guard; the ordinary branch text is the 0049 one',()=>{
 const ok=fn('group_custody_stage_ok(o inventory_holds,n inventory_holds)');
 assert.match(ok,/go\.confirmation_basis IS DISTINCT FROM 'GROUP_ADMIN_APPROVED'/);
 assert.match(ok,/o\.payment_state<>'NONE'/);
 assert.doesNotMatch(ok,/'SUCCESS'/);
 assert.match(fn('group_custody_hold_update(o inventory_holds,n inventory_holds)'),/group_custody_stage_ok\(o,n\)/);
 const g=sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION rental_stage_guard'),sql.indexOf('END$$;',sql.indexOf('CREATE OR REPLACE FUNCTION rental_stage_guard')));
 assert.match(g,/IF group_custody_stage_ok\(OLD,NEW\) THEN RETURN NEW;END IF;/);
 const ordinaryTail="IF NOT FOUND OR NOT booking_is_confirmed(b.mode,b.state) OR OLD.payment_state<>'SUCCESS' OR OLD.transfer_attention IS NOT NULL THEN RAISE EXCEPTION 'CUSTODY_STAGE_INVALID'";
 assert.ok(g.includes(ordinaryTail),'ordinary booking branch still requires payment_state SUCCESS');
});

test('no payment artefact path in group custody: the service never writes a booking, an attempt, a provider event or a payment state',()=>{
 const src=readFileSync('packages/core/src/rental/custody-service.ts','utf8');
 const group=src.slice(src.indexOf('GROUP CUSTODY (Issue #47 B4)'),src.indexOf('export type CustodyConditions'));
 for(const banned of ['INSERT INTO rental_bookings','INSERT INTO rental_payment_attempts','rental_provider_events',"payment_state='SUCCESS'",'payment_state=\'SUCCESS\'',"SET payment_state",'booking_cancellation_refunds'])assert.ok(!group.includes(banned),banned);
});

test('0064 (the owner-applicable core) touches no executor-owned object and carries no custody link; 0065 carries all of it',()=>{
 // Static proof of the split. The real proof (the owner applies 0064 on the Production topology; 0065 is refused 42501) is tests/operations/production-0057-owner-apply.ts.
 const code=core.split('\n').filter(l=>!l.trimStart().startsWith('--')).join('\n');
 for(const banned of ['rental_validate_loan','rental_validate_group_loan','rental_apply_receipt','rental_stage_guard','rental_inventory_blocks','rental_loan_items','group_part_preparations','group_member_manual_fit','group_custody_stage_ok','_custody_executor','OWNER TO','group_part_id'])assert.ok(!code.includes(banned),'0064 must not contain '+banned);
 for(const needed of ['rental_validate_group_loan','rental_apply_receipt','rental_stage_guard','rental_inventory_blocks','group_part_preparations','group_custody_stage_ok','_custody_executor','ALTER TABLE rental_loan_items ADD COLUMN group_part_id'])assert.ok(sql.includes(needed),'0065 must contain '+needed);
 // The two core functions that 0065 replaces exist in both, and the core version has no loan reference.
 assert.match(core,/CREATE FUNCTION group_custody_hold_update/);assert.match(sql,/CREATE OR REPLACE FUNCTION group_custody_hold_update/);
 assert.match(core,/CREATE FUNCTION group_order_guard/);assert.match(sql,/CREATE OR REPLACE FUNCTION group_order_guard/);
 assert.match(core,/CREATE FUNCTION group_consistency/);assert.match(sql,/CREATE OR REPLACE FUNCTION group_consistency/);
 assert.doesNotMatch(core.slice(core.indexOf('CREATE FUNCTION group_custody_hold_update'),core.indexOf('END$$;',core.indexOf('CREATE FUNCTION group_custody_hold_update'))),/group_custody_stage_ok/);
});
