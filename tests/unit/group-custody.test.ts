import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {groupMemberNeedsManualFit} from '../../packages/core/src/rental/custody-service';

const sql=readFileSync('packages/db/migrations/0064_group_order_core.sql','utf8');
const fn=(name:string)=>{const a=sql.indexOf('CREATE FUNCTION '+name),b=sql.indexOf('END$$;',a);assert.ok(a>=0&&b>a,name);return sql.slice(a,b);};
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
 assert.doesNotMatch(sql,/CREATE OR REPLACE FUNCTION rental_validate_loan\(\)/,'0064 does not redefine the ordinary validator');
});

test('stage guard: the group branch demands the confirmed group and NONE payment; the ordinary branch text is the 0049 one',()=>{
 const g=sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION rental_stage_guard'),sql.indexOf('END$$;',sql.indexOf('CREATE OR REPLACE FUNCTION rental_stage_guard')));
 assert.match(g,/go\.confirmation_basis IS DISTINCT FROM 'GROUP_ADMIN_APPROVED'/);
 assert.match(g,/OLD\.payment_state<>'NONE'/);
 const ordinaryTail="IF NOT FOUND OR NOT booking_is_confirmed(b.mode,b.state) OR OLD.payment_state<>'SUCCESS' OR OLD.transfer_attention IS NOT NULL THEN RAISE EXCEPTION 'CUSTODY_STAGE_INVALID'";
 assert.ok(g.includes(ordinaryTail),'ordinary booking branch still requires payment_state SUCCESS');
});

test('no payment artefact path in group custody: the service never writes a booking, an attempt, a provider event or a payment state',()=>{
 const src=readFileSync('packages/core/src/rental/custody-service.ts','utf8');
 const group=src.slice(src.indexOf('GROUP CUSTODY (Issue #47 B4)'),src.indexOf('export type CustodyConditions'));
 for(const banned of ['INSERT INTO rental_bookings','INSERT INTO rental_payment_attempts','rental_provider_events',"payment_state='SUCCESS'",'payment_state=\'SUCCESS\'',"SET payment_state",'booking_cancellation_refunds'])assert.ok(!group.includes(banned),banned);
});
