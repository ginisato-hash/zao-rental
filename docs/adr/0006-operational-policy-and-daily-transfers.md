# ADR-0006 — Separate Rental Windows, Occupancy Policy, Transfers and Refunds
Status: Accepted owner operational direction; implementation design subject to review.
Date: 2026-09-10

## Decision
- AM ends12:00; PM starts13:00. Prices remain unchanged.
- Disable same-date re-rental initially; preserve actual contractual windows and a versioned occupancy policy for future turnaround.
- Daily store transfer operations start17:00. Approximate driving time10min is not ready-by/receipt proof.
- Future destination capacity needs a committed feasible movement; actual checkout needs receipt plus readiness.
- Let customers explicitly choose recommended/shorter/longer within original size, category and availability bounds. Replacement holds are atomic.
- Early return has no automatic refund. Give selected staff an explicit exception-refund permission with audit and reconciled payment state; no authentication bypass.

## Consequences
More explicit domain state but fewer hidden assumptions. Operational changes do not silently reprice bookings or release conflicting stock. Enabling rotation later requires configured buffers and existing-reservation checks, not reimplementation of dates or irreversible remapping of asset IDs.
