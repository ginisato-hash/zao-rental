# Exact development custody changes requiring automatic approval review resolution

Delegation ZAO-RENTAL-FLOW-DEV-R1. Previous bounded owner approval remains valid.
This record does not grant rights or reset budgets. The proposed implementation command was
rejected before execution; no SQL, role grant, ledger guard or UI mutation in that command ran.

Automatic approval review reason (original):
> This action persistently alters ledger constraints and guard logic, adds SECURITY DEFINER functions and broad DML/grants; the approval covers bounded development custody behavior but does not clearly authorize these exact security-boundary changes or their blast radius.

## Exact proposed scope for a human decision

Only a newly migrated, synthetic, isolated PostgreSQL cluster owned by the rental-flow-dev
worktree. No existing production/development service, real accounts, global rights, OS, GitHub,
Keychain or external connection changes. Applied0001-0011 files remain immutable.

1. Add0012_rental_operations.sql. Extend ledger_locations event CHECK to include RETURN_RECEIPT,
   retaining existing rows/events. In ledger_guard, permit a store change only for table-owner
   execution whose exact receipt, still-OUT loan, Asset ID, destination and verified actor match.
   In ledger_audit record RETURN_RECEIPT (existing transfer auditing remains).
2. Add narrow SECURITY DEFINER functions with pinned search_path, PUBLIC execute revoked:
   rental_assert_actor validates a real unexpired session, active staff, explicit BOOKING_VIEW
   plus RENTAL_RETURN and actual receiving store; rental_apply_receipt accepts only receipt UUID,
   validates pinned loan cycle/version/times/batch owner, then moves that one Asset or one
   attributed pole PAIR, writes immutable custody history, retires only fulfilled item claims,
   and marks other affected promises for reconciliation without deleting them.
   rental_apply_inspection accepts only inspection UUID and moves its one received pole PAIR
   from maintenance to available pool; date/contract blocks remain. No arbitrary SQL/table/column,
   owner, expiry or quantity input. Application roles cannot acquire table-owner identity.
3. New flow role: SELECT/INSERT only on named new preparation/loan/batch/candidate/receipt/
   inspection/correction tables; column-only updates to preparation and candidate state;
   INSERT and UPDATE(active) on inventory_claims for existing allocator witnesses;
   UPDATE(allocation_stage,version) on inventory_holds for preparation/checkout fixation;
   execute the exact receipt/inspection and existing allocation-audit functions only.
   No credential, price, history modification, DDL, role management, HOLD condition/expiry writes.
   Existing ledger/HOLD/transfer roles gain SELECT only on contact-free custody/block projections.
4. Explicit BOOKING_VIEW/CREATE and RENTAL_CHECKOUT/RETURN administrative form choices.
   No default permission or actual account registration/change.

Risks to verify before adoption: an incorrectly guarded owner function could change protected
stock; incorrect claim retirement could release another promise; pair movement could alter total
quantity; direct role SQL could forge receipt/actor; outdated scope could outlive revocation.
Required real-DB counterexamples cover these, exact-cycle duplicate/partial/cross-store receipt,
future HOLD conflicts, no same-day reuse and no production test-adapter activation. Independent
static review and final exact-head CI are mandatory. This proposal is not implemented/verified.

If this precise boundary cannot be approved, the physical custody integration stays BLOCKED;
QR/UI and pure contracts can continue, but the full development loop cannot be declared complete.

Recorded at 2026-09-12T15:37:48.759126+00:00
