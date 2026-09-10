# ADR 0005 — Editable tables with immutable published price books
Status: Accepted design direction; implementation pending.
Date: 2026-09-10

## Context
The owner wants nonlinear duration discounts, lower half-day prices, and the ability to change prices during the season without disrupting existing reservations.

## Decision
- Store final integer JPY prices by product and duration, separately from optional curve-generation settings.
- Initial half-day factor is 75%, rounded to nearest JPY 100, half up. Preserve the approved nonlinear whole-day proposal.
- Admins edit drafts, preview the complete price effect, then publish a new immutable version with an explicit activation/rental/store scope.
- New quotes use the effective book; valid existing quotes remain locked to their expiry. Confirmed reservations retain immutable pricing snapshots.
- Amendments require an explicit new quote, authorization and payment/refund reconciliation. No live-rate recalculation of history.
- Preserve audit history across publication, rollback and exceptional changes.

## Consequences
More records than a mutable price column, but safer payments, reversible future price changes, and analyzable rate experiments. Price, inventory availability and payment state remain distinct.
No production deployment or approval to charge is implied by this ADR.
