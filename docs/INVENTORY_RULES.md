# INVENTORY_RULES.md — Allocation and Location Feasibility v0.4

## Three different facts
1. Physical custody/status: where the item is and whether inspected/serviceable.
2. Rental commitment: who is promised what, for which entire interval.
3. Sellable capacity: whether a new requirement can be fulfilled without violating 1 or 2 or future transfer/turnaround constraints.
An AVAILABLE lifecycle value alone must never authorize a rental.

## Initial allocation granularity
With same_day_re_rental_enabled=false, an AM or PM booking claims a unit for the whole rental calendar date, not just its paid hours. Whole-day rentals claim every occupied calendar date. Keep the contractual windows independently (AM ends 12:00, PM starts 13:00) so slot-based capacity can be enabled later without changing historical contracts.
Use half-open time intervals internally and a clearly named date-based occupancy policy; avoid ambiguities at exactly 12:00, 13:00 and 17:00. Inspected early returns remain date-blocked for new customers at either store. A transport movement after checkout/return is a different operation from a second rental and can occur in the 17:00 batch while the date-block remains.

## Continuity, not independent date totals
Daily capacity sums are insufficient. If A is only free on day 1 and B is only free on day 2, their counts do not prove a two-day booking can use one continuous asset. Every accepted hold/booking must have a feasible continuous assignment plan, respecting sport, age, tier, selected length and any disclosed model constraint.
Maintain a transactionally protected internal planning allocation / feasibility witness; final physical handoff ID may still be assigned at pickup. Reassignment must preserve every existing commitment. Never count the same asset in two overlapping length buckets or both stores.
Bundles require all components: a ski set cannot confirm with only a board if boots or pole quantity is unavailable. A group request must have an explicit all-or-nothing hold boundary or a reviewed partial-booking UX; do not accidentally partially charge.

## Transfer planning
A planned transfer has distinct REQUESTED (not promised) and COMMITTED (capacity protected and operationally feasible) meanings. COMMITTED claims its units against source demand and records a specific upcoming batch, destination, expected ready-by time and evidence/assumptions.
Future destination capacity may include a feasible COMMITTED arrival, never an uncommitted suggestion. Physical checkout cannot occur until RECEIVED plus inspection/readiness. An IN_TRANSIT item is unavailable for immediate handoff at both stores but may retain one feasible future destination commitment.
A sealed/departed batch cannot accept new demand retroactively. Next batch is the next day's 17:00 operation unless staff explicitly record an exceptional trip through a separately reviewed authorized flow; no automatic exceptional-trip guarantee in V1.
Stock due back at 17:00 needs actual readiness before it joins a departing batch. Delays, missing items, changed return stores, breakdowns or failed inspection invalidate/replan affected future commitments and raise alerts. Do not silently continue selling the forecast as actual stock.

## Pole pools
Track quantity by category, length, location and date/interval, with movement and allocation ledgers. Held, lent, returned-but-date-blocked, inspected/free, damaged and in-transit quantities remain distinct. Apply identical transfer/no-recirculation semantics to the appropriate quantities without requiring a QR per pole pair.

## Future turnaround enablement
Persist the operational-policy version associated with a reservation claim. Never silently add overlapping PM claims to existing AM commitments on an unreviewed setting change. Turning reuse off must detect previously sold AM/PM overlap and require a migration/operations resolution plan. A feature flag is not a substitute for readiness buffers, tests and transactional claims.

## Required invariants
- No overlapping physical lending, negative pool quantity, or duplicate capacity consumption across stores/buckets.
- Hold create/replace/expire/confirm and assignment replan are transactional and idempotent.
- A returned item cannot become sellable merely because a refund completed, nor can a failed refund prevent recording a real return.
- Contractual dates, actual return, no-refund financial amount and reusable-future capacity can differ legitimately.
- Future early-return capacity releases require verified receipt/inspection and update, not an expected customer promise.
