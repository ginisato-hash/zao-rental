# Return mode — authoritative owner decisions, 2026-09-11

This is the current canonical return contract, superseding the earlier proposed
left/right partial-receipt requirement. Implementation is assigned to E12 follow-up,
not to E06. Existing v0.4 references are preserved as historical source evidence.

## Physical unit and QR identity (confirmed)

A ski pair (two skis), a ski boot pair, and a snowboard boot pair are each **one Asset**.
Both sides carry the same immutable Asset ID QR. One scan from either side represents
the whole Asset; a batch confirmation receives that entire Asset against one loan item.
Scanning the same ID from both sides is a duplicate within the same loan cycle and must
not increase receipt or stock counts. The QR never contains mutable reservation data.
There are no side IDs/child Assets, side rental/return states, mandatory two-side scans,
mandatory side-check checkbox, or side-only partial-receipt flow. A missing/damaged
physical component is an exception/inspection record on the single Asset. Board returned
but boots outstanding, or different group members' returns, remain valid partial returns
because those are different Assets/loan items. Poles stay size-based PAIR quantities.
The existing boot `labelCopies` presentation was introduced before this owner decision;
E12 label/scan acceptance must cover two identical boot labels without creating new stock.

## Continuous staff return operation

Confirm actual receiving store -> keep camera open -> continuously scan equipment QR ->
resolve Asset to a specific active loan_item / rental-cycle / reservation / renter ->
append normal candidates -> confirm the batch -> leave unresolved items visible.
A reservation QR per customer or confirmation after every normal scan is not mandatory.
Persist scan candidates on the server so interrupted work can resume. Never label an
unacknowledged request saved/received. Batch results are persisted per item: successful
items are not processed again when unresolved items are retried.

A scan records its resolved loan-item ID, cycle ID and version, not just Asset ID. At
confirmation revalidate that exact target. A stale scan must not attach itself to the
newest rental cycle. Idempotency must cover same-batch duplicate IDs, simultaneous
terminals, repeat confirmation and network retries. Uniqueness is per loan-item/cycle,
not forever per Asset; the next legitimate rental cycle can return the same Asset.

Accept today's, early, overdue and cross-store returns. Unknown ID, absent loan or
already-returned loan goes to review. Absence of a scan alone cannot declare loss,
late fees, charges, refunds or reservation completion. Physical mixed pole quantities
and attribution to particular loan items are separate facts: unidentified quantity
must not complete an arbitrary reservation.

## Facts versus future feasibility

Receipt, inspection/maintenance and sellable capacity are separate. Receiving does
not automatically set AVAILABLE. Preserve whole-date no-reuse, future allocations and
location constraints. Early receipt does not rewrite the contract amount or refund.
Cross-store receipt records actual custody and immutable movement history. If future
promises need replanning, create an exception; do not reject the fact of physical receipt
merely because the future plan is infeasible. E06's ledger-edit guard is not the future
physical-receipt operation. E12/E07 must introduce a transaction that records receipt,
marks affected commitments for reconciliation and prevents further unsupported selling.

Keep scanned_at, confirmed_at and actual_received_at distinct. Corrections to receipt
time require a specific permission, reason and append-only history. Record the server-
verified staff actor and actual receiving store. A browser store/actor is not authority.

## E12 acceptance, all still unimplemented

- Mixed reservations and group partial return across different Assets; one batch, no
  mandatory customer QR, no per-normal-scan dialog.
- Early, overdue and cross-store receipt; actual custody retained even if future plans
  need exception/reallocation; no automatic amount/fee/refund change.
- Both identical side labels scanned -> one candidate/receipt for the same loan cycle.
  Missing/damaged components -> one-Asset inspection issue, no side-management workflow.
- Same-batch and cross-terminal duplicate scans/confirmation/retry never double-count.
- Server-saved candidates resume after interruption; unknown network results remain unknown.
- An old scan after return and re-rental is rejected for its old cycle; it cannot receive
  the new loan. Reconfirming completed items is idempotent, unresolved items remain actionable.
- Inspection-pending receipt does not make stock sellable; same-day and future claims persist.
- Pole pair quantity difference and uncertain attribution remain separate unresolved facts.
- Staff/store denial, receipt-time correction permission/reason/history, no PII in QR/logs.

No return camera/UI, loan table, receipt mutation, production action or Square operation
is implemented by this document or E06. E06's claims already use immutable whole Assets
and separate dates/stages, so no left/right schema is required.
