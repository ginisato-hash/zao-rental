# FLOW development: automatic approval review boundary

Delegation ZAO-RENTAL-FLOW-DEV-R1; existing no-privilege-expansion constraint retained.
These are tool approval decisions, not a claim that the owner withdrew the feature request.
None of the three rejected commands executed. No alternate/indirect execution was used.

1. Proposed custody migration was rejected because it dropped an existing generated column/view,
   rewrote ledger security guards/constraints and included write/SECURITY DEFINER capabilities.
   It was replaced with genuinely additive, unconnected custody tables/views (0010), with no
   existing ledger guard/column/view deletion. Physical store/quantity changes remain unconnected.
2. Proposed rental service and role changes were rejected for expanding existing role privileges
   and introducing inventory claim/HOLD/loan/return write paths without accepted validation.
   No ordinary rental mutation service or grants from that command were written or executed.
3. Staff-management permission UI changes were rejected for exposing checkout/return permissions.
   StaffManagement.tsx remains unchanged. Existing API schema knows flow permissions, but they
   have no role defaults. Only explicit synthetic test account setup has exercised them.

## Concrete next approval to complete the flow

Only the dedicated, freshly created development PostgreSQL and new flow code are involved.
No OS/global/Keychain/GitHub/Square credentials, host privilege, real staff or production grants.
Owner decision needed: approve the following limited development DB/UI boundary change, with
counterexample tests and independent review before it is considered usable:

- Expose/preserve the already declared BOOKING_VIEW/BOOKING_CREATE and explicit
  RENTAL_CHECKOUT/RENTAL_RETURN choices in the existing administrator form. No default grant.
  Currently editing a flow-enabled synthetic account through the old form can remove the new
  explicit overrides; this fails closed but the management UI is incomplete.
- Allow a new purpose-specific application role to insert loan/preparation/batch/candidate/receipt/
  inspection records and update only their allowed state/version fields. Never credentials,
  audit history, price snapshots, schema or roles.
- Permit full-period assignment through the existing allocator under the repository inventory
  lock and fresh session/permission/store checks; authorized receipt can replace only its exact
  fulfilled loan-item claims with inspection/no-reuse protection. No arbitrary HOLD condition,
  expiry or owner changes. Unknown/fixed/other-store promises remain protected.
- Introduce a narrow actual-receipt custody operation, referencing a unique, current loan cycle
  and immutable receipt, to move actual Asset location / attributed pole PAIR quantity. Validate
  actor/store, uniqueness and conservation; retain history and mark unsupported future promises
  for reconciliation. Do not drop identity columns/views or provide a general guard bypass.
- Existing HOLD/transfer readers may read a projection of custody/date blocks without contact,
  session, credentials or payment data. This is the only proposed existing-role read addition.

The receipt function/SQL and grants still need implementation after that decision; the rejected
code is not staged as an executable workaround. Required tests: cross-terminal exact-cycle
replay, late/stale scan, mixed/partial/early/overdue/cross-store receipt, pair conservation,
inspection/date blocks, concurrent HOLD/transfer and unprivileged direct SQL denial. Model/frame
camera tests remain distinct from physical phone. This is a proposed boundary, not granted rights.
