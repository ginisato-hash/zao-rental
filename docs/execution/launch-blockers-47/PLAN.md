# Launch blockers (Issue #47) — frozen plan, one candidate PR

Base: main `e664e02`. Branch: `codex/launch-blockers-47`. No production operation is part of this PR.

## Reproduced blockers (code)
1. `packages/core/src/payment/worker-tick.ts` hard-coded `notificationLimit/refundCreateLimit/refundBudgetJpy = 0`: after publication no
   confirmation / recovery / cancellation mail would be sent and no Square refund created.
2. No public JA/EN legal or policy pages (terms, privacy, Specified Commercial Transactions Act disclosure, cancellation); the
   "under review" notices are always shown, independent of any approval.

## Change (after TD W1/L1)
1. **Notifications (W1).** One bounded variable `PRODUCTION_WORKER_NOTIFICATION_LIMIT` (0–20 per tick). Unset = 0 (current behaviour);
   malformed/out of range = tick STOP before any worker/provider call. Delivery keeps the existing contract of migration 0055
   `notification_due_normal`: only `SQUARE_PRODUCTION` bookings created at/after `PRODUCTION_WORKER_ACCEPTED_AFTER` (so F2-era rows and
   `BLOCKED_RECIPIENT_UNVERIFIED` rows are never selected), durable claim, provider idempotency key, UNKNOWN => lookup only (no resend).
   Covered by `tests/readiness/normal-worker-acceptance.ts` (two consumers, two ticks, cutoff isolation, UNKNOWN never resent) via
   `test:production-runtime`, plus `tests/unit/worker-tick.test.ts` (unset 0, fail-closed parsing, two consecutive ticks). Setting the value
   is a separate approved production operation (recipient/count acceptance).
2. **Refunds (W1).** No durable cumulative refund budget, target list or approval window exists in the code; a per-tick budget resets every
   minute. Therefore the scheduled worker keeps `refundCreateLimit: 0, refundBudgetJpy: 0` hard-coded and reads no refund variable
   (a refund variable present in the platform environment is ignored — unit-tested). Refund LOOKUP of already-dispatched refunds with a
   provider ID continues. See "Refund operations" below.
3. **Legal pages (L1).** `config/content/public-legal.json` + `packages/core/src/content/public-legal.ts`: a document is published only when
   its JA **and** EN versions are both `OWNER_APPROVED` with approver, past UTC approval time and non-empty sections; otherwise 404 and no
   link. Route `/[locale]/legal/[doc]`, footer/checkout links, sitemap, indexing allowlist (`legal/*` indexable only with publication
   authority on the exact origin; book/booking/staff stay noindex). The "under review" notices disappear only when all four are approved.
   **Server-side gate:** the production runtime passes `legalCheckoutReady` to `GuestBookingService`; a commercial checkout is refused with
   `LEGAL_DOCUMENTS_NOT_APPROVED` (503) until all four documents are approved in both locales — a ticked checkbox cannot complete a real
   charge. All documents ship as `OWNER_TEXT_REQUIRED`; no legal wording, seller data or disclaimer is authored here. Tax-inclusive totals,
   the rental period and the 48-hour cancellation rule are already shown before payment, and the review step (price-change acceptance,
   back/edit) precedes payment.
4. `config/production/launch-gates.json`: only `TAX` records the Owner's 2026-10-04 tax-inclusive decision (head/policyRevision null, so the
   release evaluator still does not pass it); every other gate is unchanged.
5. `docs/REFUND_POLICY.md` is a hash-pinned reference and stays byte-identical. Its "previous-day 50% / same-day 100%" line is a superseded
   proposal; the rule in force is migration 0045 (cancelled ≥48 h before start, exactly 48 h included: full refund; later: no automatic refund).

## Refund operations after the initial launch (existing paths only)
- Guest cancellation ≥48 h creates a PENDING refund row (migration 0045); staff `REFUND_OVERRIDE` creates a PENDING row with an explicit
  amount. Neither is sent to Square by the scheduled worker.
- Execution: the supervised, per-target operator command `npm run production:payment-acceptance -- cancellation-refund-one` with an explicit
  release/tree, target booking/reference/job and refund amount (one Square RefundPayment, UNKNOWN => read-only reconciliation, no resend).
  It runs on the operator's Mac with the approved credentials; each run is a separately authorised production operation.
  It operates on `cancellation_refund_row` (guest-cancellation refunds) and verifies booking/merchant/location/payment/amount before
  any call. Whether staff `REFUND_OVERRIDE` rows can be executed through the same command is NOT verified here — treat staff exception
  refunds as an open operating gate (do them in the Square Dashboard only with ledger reconciliation, or add a reviewed path later).
- Publication gate: the Owner must name who runs it and the response time for pending refunds (e.g. daily). Until then, refunds are not
  automated and this is listed as an open operating gate, not a solved one. A durable refund budget for automatic CREATE would be a separate,
  reviewed change (not part of this PR).

## Not in scope
Price table on /prices, store address schema, refund-completed mail, media/avatar, real stock, any env/deploy/protection change.

## Verification
Targeted: `tests/unit/worker-tick.test.ts`, `tests/unit/public-legal.test.ts`, `tests/unit/publication-indexing.test.ts`,
`tests/unit/release-closure.test.ts`, `test:public-ui`, `test:public-content`; then the existing full gate (`npm run verify`) once,
one PR, TD review, one natural CI.
