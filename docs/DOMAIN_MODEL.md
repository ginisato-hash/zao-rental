# DOMAIN_MODEL.md — Domain Model v0.4

## Core design principles
- Reservation capacity is not a physical asset assignment.
- Booking reserves capacity by requirement/category; physical asset assignment normally occurs at pickup.
- Asset lifecycle state is separate from customer/rental workflow state.
- Store location is mutable state and never embedded in a permanent asset identifier.
- Every meaningful physical movement, commercial override, and critical state transition is auditable.

## Core entities

### Store
Two initial records: Mountain Base, Onsen Base.
Fields include timezone, opening/closing times, active status.

### Customer
Booking contact / representative with contact and consent metadata.

### Reservation
Commercial booking container.
Key fields include:
- pickup_store_id
- planned_return_store_id
- starts_at / ends_at
- duration_type: HALF_DAY_AM | HALF_DAY_PM | MULTI_DAY
- rental_days where applicable
- pricing snapshot
- payment state
- reservation state
- reservation code

### Renter
Individual within a reservation group.

### RenterProfile
Versioned recommendation/safety inputs captured at booking time.

### EquipmentRequirement
Reservable specification requirement for one renter and equipment family.

### InventoryBucket
An availability projection by store, family, tier, selected length and interval; NOT independently authoritative pooled counts. Source truth is feasible protected asset/pool allocations plus time/location policy.

### InventoryHold
Temporary claim while payment completes.

### Asset
Physical rentable unit.
Recommended V1 individual assets:
- ski pair
- snowboard
- ski boot pair
- snowboard boot pair

Poles are approved as pooled size inventory. Helmets remain complimentary; guaranteed reservation semantics still require a decision.

Ski pair rule:
- one ski pair = one Asset
- same asset ID/QR may be applied to both skis
- component/maintenance detail can represent exceptional single-ski damage

### AssetIdentifier
QR/barcode/NFC/RFID-capable identifier abstraction.

### AssetLocation
Current physical store/location state.
Can represent Mountain Base, Onsen Base, IN_TRANSIT, maintenance area, etc.

### AssetTransfer
Explicit inter-store transfer order/movement with origin, destination, state and audit metadata.

### AssetAssignment
Physical assignment to renter/requirement for an interval.

### Rental
Operational checkout/return aggregate.

### RentalEvent
Immutable movement/workflow events.

### MaintenanceEvent
Inspection, waxing, edge work, repair, binding service, damage, retirement decision.

### Product / Bundle / PriceRule
Catalog configuration separates products from price tables and duration pricing.

### Coupon
Configurable promotional adjustment rules and usage controls.

### Payment
Local Square payment/refund representation.

### PaymentEvent
Deduplicated Square webhook/event history.

### AuditEvent
Critical change history, including admin overrides.

## Key invariants
- Asset IDs never encode store because assets may transfer.
- A physical Asset cannot have overlapping active assignments.
- IN_TRANSIT/MAINTENANCE/RETIRED assets cannot be immediately handed out. A committed IN_TRANSIT arrival may retain only a feasible future destination allocation; maintenance/retired inventory is not presumed serviceable.
- An expired/released hold cannot confirm inventory without a valid availability transaction.
- Replayed payment webhooks must not duplicate confirmed inventory or refunds.
- Cross-store return changes inventory location only after physical receipt/return processing.

## Pricing additions v0.3
### PriceBookVersion / PriceBookEntry
Editable drafts, immutable published versions, store/date scope, and explicit final JPY values per product/duration. Activation is deliberate, not implied by a seed file.
### Quote / BookingPriceSnapshot
Time-bounded server quote and immutable accepted booking amounts, price/promotion/policy version references, adjustments, currency/tax data and expiry.
### AmendmentQuote / ReservationAmendment
Append-only explicit commercial changes. Preserve original snapshot and audit/collection/refund linkage.
### Age category
ADULT at 13+ on rental start, otherwise KIDS; record on renter/requirement and inventory. Cross-category substitution is prohibited.

## Operational additions v0.4
### OperationalPolicyVersion / RentalOccupancyClaim
Versioned per-store/family/date policy. Preserve contractual starts/due, actual returned/inspected/ready timestamps, and the distinct whole-date no-recirculation block. Block follows asset across stores; pool quantity ledger mirrors it.
### AllocationPlan / PlannedAssetClaim
A protected feasible witness for continuous fulfillment of active holds/bookings, independent of final pickup scan. No double counting across length candidates or stores. Replans preserve all commitments.
### RecommendationSelection
Original target, initial recommended available length, chosen direction, selected length/tier, displayed model, model-guarantee policy, rule version and quote/hold fingerprint.
### TransferBatch / TransferLine
Daily scheduled start17:00, actual departure/receipt, origin/destination, committed protected allocations, individual IDs or pole quantities, readiness evidence and exceptions. Ten-minute travel is an estimate, not automatic receipt.
### PolePoolMovement / PoleOccupancyClaim
Category/size/store/date counts for reserved, checked-out, returned/date-blocked, free and in-transit quantities.
### RefundRequest / RefundAllocation / StaffPermissionGrant
Explicit staff authorization, reason and positive JPY amount, immutable request key, collected/pending/completed balance ledger, linked original payment and provider refund state. Raw Square payment state remains independent. See REFUND_POLICY.md.
