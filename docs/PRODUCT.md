# PRODUCT.md — Product Definition v0.4

## Objective
Create a production-grade ski/snowboard rental reservation and inventory platform for approximately 500 sets of equipment across Mountain Base and Onsen Base, optimized for fast online booking and extremely fast staff handoff.

## Store model
- Mountain Base
- Onsen Base

Pickup and return stores are independent fields. Cross-store return and explicit inter-store stock movement are supported.

## Customer journey
1. Choose ski or snowboard.
2. Choose pickup store, planned return store, rental date/time slot and duration (AM half-day, PM half-day, or 1–10 days).
3. Choose product/tier and group size.
4. Enter required renter profile data.
5. System shows feasible recommended / shorter / longer items using the versioned rule set; customer explicitly confirms a length.
6. System verifies a continuous feasible allocation for the entire interval and pickup store, including initial whole-date occupancy and committed 17:00 transfers.
7. Inventory capacity is temporarily held.
8. Pricing engine applies eligible advance-payment discount and coupon adjustments.
9. Customer pays online with Square.
10. Verified payment success confirms reservation.
11. Customer receives one reservation QR code.
12. At shop, staff scans reservation QR and sees all renters and requirements.
13. Operational flow: check-in -> boots -> ski/board -> binding/final fit -> checkout.
14. Staff scans individual assets where required and confirms assignment.
15. Rental is checked out.
16. On return, assets are received/inspected; operational availability is separate from the same-date rental block. Early return does not automatically refund or reprice. Authorized staff may issue a recorded exception refund.

## Rentable products V1
Ski set:
- ski pair
- ski boot pair
- pole pair

Snowboard set:
- snowboard with binding setup
- snowboard boot pair

Also allow supported single-item rentals per configured price catalog.
Helmet is complimentary; reservation semantics are still to be finalized.
Wear is not part of current V1 customer product scope even though it appears in the legacy inventory workbook.

## Staff UX target
Normal prepaid pickup should require the minimum possible interaction and should never require re-entering customer booking data.

## V1 scope
- two-store inventory
- cross-store return
- daily 17:00 inter-store transfer workflow, with actual dispatch/receipt and protected future allocations
- AM 08:30–12:00 / PM 13:00–17:00 half-day + 1–10 day durations; no same-day reuse initially
- customer booking web app
- group renter profiles
- versioned equipment recommendation
- real-time availability
- temporary inventory holds
- configurable versioned pricing tables and coupon engine; immutable booking price snapshots
- 5% eligible advance-payment discount
- Square online payment/refund integration
- reservation QR
- staff mobile/PWA QR scanner
- asset assignment
- checkout / exchange / return
- admin reservation changes/extensions/shortening
- controlled cancellation/refund override with audit trail; REFUND_OVERRIDE may be granted to selected staff
- asset master and status
- maintenance/inspection events
- basic admin inventory dashboard
- utilization and rental history
- audit log
- Japanese and English foundations

## Explicitly not V1
- unreviewed/proprietary automatic alpine binding release-value logic
- deep integration with tuning machinery
- UHF RFID
- full offline conflict-free operation
- multi-resort enterprise accounting

## Performance targets
- QR recognition to useful screen: target < 1 second under normal store network conditions
- asset scan to usable asset response: target < 1 second
- availability query: target < 500 ms application round trip under planned load
- no inventory oversell in concurrency tests

## Confirmed age and inventory policy
Adult is age 13+ at rental start; Kids is under 13. Do not substitute across these categories. Ski pairs, snowboards, ski boot pairs and snowboard boot pairs are individual Assets; poles use size-based quantity inventory. See PRICING.md for the current initial season prices and revision workflow.
