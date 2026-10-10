# Launch blockers (Issue #47) — plan, one candidate PR (#57)

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
   **Server-side gate:** the production runtime passes `legalCheckoutReady` to `GuestBookingService`; the shared private `prepare()` (used by
  both `POST /api/guest/prepare-payment` and `POST /api/guest/checkout`) and the checkout entry refuse a commercial charge with
   `LEGAL_DOCUMENTS_NOT_APPROVED` (503) before any HOLD/booking/payment attempt/Square call, until all four documents are approved in both
   locales — a ticked checkbox cannot complete a real charge. Existing-booking lookup/cancellation and non-commercial flows are not gated; the
   UI shows a payment-unavailable notice and disables payment while blocked. All documents ship as `OWNER_TEXT_REQUIRED`; no legal wording, seller data or disclaimer is authored here. Tax-inclusive totals,
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

## Owner decisions of 2026-10-09 (Issue #47 comment 6090166024) — supersede the W1 refund stance above
- **Online refunds are automatic** for cancellations meeting the 48 h rule (decided at acceptance time); ineligible online refund
  requests are auto-rejected with the reason shown and provider POST 0. Technical failure / PENDING / UNKNOWN is never turned into an
  "ineligible" rejection. The "refund CREATE always 0 / one-by-one supervised refunds / waiting for an Owner refund operator" stance is
  SUPERSEDED. Production env keeps automatic refunds at 0 only until this change is reviewed and accepted (explicit switch).
- **Every active, authenticated STAFF** in store scope can refund in the staff app, including exceptions outside the online rule, with the
  existing amount/reason/confirmation/audit. Not admin/DB-owner escalation; inactive/unauthenticated denied.
- **Production connection** of staff refunds (`ops_refund_requests`) to Square, reusing the existing routing, durable UNKNOWN-before-POST,
  idempotency keys and the shared per-payment remaining-balance cap (online + store, counting COMPLETED/PENDING/UNKNOWN/REVIEW). No test
  adapter in production; `cancellation-refund-one` is not the staff path.
- `docs/REFUND_POLICY.md` stays byte-identical (hash-pinned); these decisions override its older text for the current plan.
- Seller/contact decided; legal drafts prepared (`DRAFT_FOR_OWNER_REVIEW`); the checkout/prepare-payment legal gate stays.
- Live acceptance approved: 1 card payment ≤ ¥5,000, its same-amount full refund, 1 mail in total (to s_sato@yuge-zao.com), card entered
  by the Owner — executed only after review, CI, merge/release identity, legal gate, pre-production backup/rollback.
- SALOMON logo / supplied product photos: Owner-confirmed web use; file location still to be identified (not in repo / this Mac).
- B4 backup risk accepted by the Owner; technical proof (monitor delivery, natural backup, R2 readback) still pending in PR #56.

## Implementation of the 2026-10-09 refund decisions (this candidate)
- `packages/db/migrations/0056_refund_automation.sql` (candidate, TD review pending): role defaults BOOKING_VIEW + REFUND_OVERRIDE for
  STAFF/MANAGER/ADMIN (VIEWER none); removes only explicit REFUND_OVERRIDE *denials* of those roles, archiving them with the pre-change state in
  `staff_permission_override_removals`; `ops_refund_row/claim/observe` (SECURITY DEFINER, lock 71820600, durable UNKNOWN before the POST,
  observation validation identical to 0045); the guard admits these functions only via a per-transaction marker in
  `rental_internal.ops_refund_effects`, which no application role can write (a session variable cannot forge it — tested).
- Worker: `PRODUCTION_WORKER_REFUND_CREATE_LIMIT` (0–20/tick, unset 0 = stop switch); per-tick JPY ceiling = per-row maximum, so a positive
  limit is never blocked by a budget. Staff lane is offered only when the operations role holds EXECUTE on the three functions.
- Per-person revocation of REFUND_OVERRIDE is rejected by the account API; the staff UI states that STAFF and above refund by default.
- Online ineligible cancellations show the reason (deadline 48 h before start) and create no refund row (0045 behaviour, unchanged).
- Production installer (not executed): `npm run production:install-refund-automation -- migrate` (exact registry 0001–0055 with reviewed
  checksums → 0056 only; drift/extra rows refused; failure rolls back; lost COMMIT ⇒ read-only reconciliation; replay refused) and
  `-- grants` (exactly three EXECUTE grants to `<db>_operations`, ACL delta proven). The frozen 0053→0055 installer is unchanged (pinned) and
  now refuses because the plan contains 0056 — it was already applied in production on 2026-10-06.
- Legal: the eight documents posted in comment 6090581287 are `OWNER_APPROVED` (佐藤慎太郎, 2026-10-09T22:53:05Z, comment 6090629658); the
  commercial gate stays and now fails closed when the check is missing, throws or is not exactly true (R57-01).
