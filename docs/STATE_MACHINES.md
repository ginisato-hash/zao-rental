# STATE_MACHINES.md — State Machines v0.4

## Reservation
DRAFT -> HOLD_PENDING -> PAYMENT_PENDING -> CONFIRMED -> COMPLETED
Operational/commercial exceptions: EXPIRED, CANCELLED, PAYMENT_REVIEW, AMENDMENT_PENDING.
Refund balance is a separate derived dimension (NONE / PARTIAL / FULL with pending amounts); a partial refund must not destroy the reservation's checked-out/returned state.

## Inventory hold
ACTIVE -> CONFIRMED | EXPIRED | RELEASED
Replacement of an ACTIVE hold is one transaction: commit replacement + release prior claim, or preserve the prior valid claim. No TTL reset just for tapping another length button. A pending/unknown payment attempt prevents uncontrolled hold mutation and requires reconciliation.

## Customer operational workflow (per renter / item)
BOOKED -> CHECKED_IN -> BOOT_PENDING -> BOOT_DONE -> EQUIPMENT_PENDING -> EQUIPMENT_ASSIGNED -> BINDING_FINAL_FIT -> READY -> CHECKED_OUT -> RETURN_IN_PROGRESS -> RETURNED
Branches: EXCHANGE_IN_PROGRESS, ISSUE_REVIEW, NO_SHOW. Skip non-applicable product stations through explicit rules.

## Asset physical lifecycle
AVAILABLE -> ASSIGNED -> OUT -> RETURNED_PENDING_INSPECTION -> AVAILABLE
Exceptions: MAINTENANCE, RETIRED, EXCHANGE_PENDING.
AVAILABLE denotes serviceable physical state, not unconditional sellable capacity. In V1 an inspected AM return is AVAILABLE + date-blocked and cannot serve another customer's PM rental. Keep the occupancy claim separate. Blocks follow the asset between stores.

## Transfer order and batch
Order: REQUESTED -> COMMITTED -> PICKING -> IN_TRANSIT -> RECEIVED
REQUESTED has no promised future capacity. COMMITTED protects source/destination feasibility. REQUESTED/COMMITTED/PICKING may cancel only after existing promises/custody have been safely revalidated. IN_TRANSIT cannot simply disappear; resolve with receipt/return-to-origin/exception events.
Batch: PLANNED -> SEALED -> DEPARTED -> RECEIVED -> RECONCILED, with PARTIAL / EXCEPTION flags at line level.
17:00 is the scheduled operation start. DEPARTED/RECEIVED require actual staff actions, not a scheduled time tick. No retroactive line additions after departure. One-way versus round-trip timing is not inferred from the 10-minute drive.
A transfer can preserve a feasible future destination booking, but immediate checkout is forbidden until physical receipt and readiness.

## Provider payment / local reconciliation
Persist Square's raw payment lifecycle separately from local booking/ledger states. Local submission may be CREATED / SUBMITTING / UNKNOWN / RECONCILED; Square payment status is not a refund-balance status.
No redirect-only confirmation. Webhook verification and deduplication are required.

## Exception refund
Local: DRAFT -> AUTHORIZED -> SUBMITTING -> PENDING -> COMPLETED
Branches: UNKNOWN, FAILED, REJECTED, CANCELLED_BEFORE_SUBMISSION, REVIEW_REQUIRED.
Provider refund status stored separately: PENDING / COMPLETED / FAILED / REJECTED when provided by Square.
A timeout maps to UNKNOWN until reconciliation, not automatic retry with another key. PENDING/UNKNOWN retains the reserved refundable balance until resolved. Never automatically free unknown funds or mark a refund complete on button press.

## Critical invariants
- Each reservation confirmation has valid price, payment evidence/policy and feasible protected inventory.
- Physical assignment and checkout revalidate complete date/length/store/category constraints.
- Return at either store requires receipt/inspection and does not bypass the no-recirculation block.
- Refund and operational return are independent.
- Future policy activation cannot silently revoke existing promises.
