# ZAO Rental operations runbook (M1.7)

Scope: local development composition. No provider, Production database or real customer is
connected. `/admin/ops` is an **observation** surface: acknowledging an exception records only
that a member of staff looked at it. It never changes payment, refund, booking, inventory,
HOLD, custody, transfer or delivery state. Always confirm the real state in the business screen
named under "Safe check".

Acknowledging is not resolving. An acknowledged exception whose underlying condition is still
true keeps reporting `現在も継続中` (source condition active).

## Payment UNKNOWN / PAYMENT_PENDING

- **Symptom** — `PAYMENT_UNKNOWN` or `PAYMENT_PENDING` in `/admin/ops`; booking is not confirmed.
- **Do not** — mark the booking paid, take a second payment, retry the charge, or edit
  `rental_payment_attempts` by hand.
- **Safe check** — booking screen state and the payment attempt state for the booking. Local
  knowledge of an interrupted acceptance is `UNKNOWN`; only a provider lookup may change it.
- **Manual action** — run the existing reconciliation for that booking. If it stays `UNKNOWN`,
  leave it and acknowledge with `VERIFIED_WITH_CANONICAL_RECORD` once you have checked the
  canonical record.
- **Escalate** — provider evidence contradicts local state (`PAYMENT_REVIEW`), or the amount
  differs.

## Webhook delayed / WEBHOOK_RECONCILIATION_REQUIRED

- **Symptom** — `WEBHOOK_RECONCILIATION_REQUIRED`, or `WEBHOOK_FAILED` when the job is
  `BLOCKED`/`DEAD`.
- **Do not** — replay a webhook by hand, or trust an amount or status carried in a notification.
- **Safe check** — the reconciliation job state for that payment. A notification only triggers a
  lookup; it never confirms a booking.
- **Manual action** — let the existing reconciliation worker run. A blocked job needs the
  evidence mismatch understood before anything else.
- **Escalate** — `BLOCKED_EVIDENCE_MISMATCH`, or a job past its deadline.

## Inventory mismatch / INVENTORY_INVARIANT_FAILED

- **Symptom** — a stocktake sits in `REVIEW_REQUIRED`.
- **Do not** — adjust counts to make the numbers agree, or change an asset that is currently out
  on loan.
- **Safe check** — the stocktake baseline against the counted observation, and any outstanding
  `OUT` loan items or active claims for the same asset or pole.
- **Manual action** — reconcile through the stocktake screen with `INVENTORY_RECONCILE`, giving a
  reason. Outstanding promises block reconciliation by design.
- **Escalate** — the physical count cannot be reconciled with active custody.

## Lost QR or device

- **Symptom** — a guest cannot present a reservation QR, or a staff device is lost.
- **Do not** — read a booking out to the guest, or re-issue a QR from an unverified request.
- **Safe check** — booking identity through the normal staff booking screen.
- **Manual action** — the guest requests booking recovery again; recovery proofs are short lived
  and single use. For a lost staff device, deactivate that staff account so its sessions stop.
- **Escalate** — suspected impersonation, or repeated failed recovery attempts
  (`GUEST_RECOVERY_ABUSE`).

## Notification outage / NOTIFICATION_FAILED, BOOKING_RECOVERY_FAILED

- **Symptom** — outbox rows in `RETRYABLE_FAILURE`, `PERMANENT_FAILURE` or `UNKNOWN`.
- **Do not** — assume the booking failed. Delivery and booking are separate: a confirmed booking
  stays confirmed when delivery fails. Never resend an `UNKNOWN` delivery.
- **Safe check** — booking state (must remain `CONFIRMED_DEV`) and the delivery row's status and
  `lastSafeFailureCode` in `/admin/notifications`.
- **Manual action** — `UNKNOWN` is lookup only; wait for reconciliation. A `SENT` or retry
  exhausted delivery may be resent with `NOTIFICATION_RESEND` and a reason.
- **Escalate** — the provider is unreachable for a prolonged period, or a recovery delivery
  expired before it reached the guest.

## Media outage / STORAGE_FAILED

- **Symptom** — `STORAGE_FAILED`; images or derivatives do not render.
- **Do not** — treat a booking or quote as invalid. Media never carries business authority.
- **Safe check** — the booking and quote remain readable and priced; only presentation degrades.
- **Manual action** — none in the console. Media is rebuilt from its source.
- **Escalate** — the outage blocks a customer-facing flow rather than only its imagery.

## Refund UNKNOWN / REFUND_PENDING

- **Symptom** — `REFUND_UNKNOWN` or `REFUND_PENDING` for a refund request.
- **Do not** — raise a second refund, change the amount, or dispatch again. An uncertain refund
  deliberately blocks a new request for the same payment.
- **Safe check** — the refund request row state and the refund cap against the collected amount.
- **Manual action** — reconcile the existing request only. It must settle to a terminal state
  before any new request is possible.
- **Escalate** — provider evidence contradicts the recorded refund, or the cap appears exceeded.

## Database restore

- **Symptom** — data loss or corruption in a local development database.
- **Do not** — claim a Production point-in-time restore. Nothing here proves provider PITR, RPO
  or RTO. Never restore into the source database.
- **Safe check** — `npm run test:operations-restore` rehearses export, fresh migration, restore
  and verification in an owned local cluster.
- **Manual action** — restore into a **new** database, then confirm the migration registry and
  checksums, every foreign key, and the critical fingerprint before using it.
- **Escalate** — always, before any restore outside a local development database.

**What a restore does not bring back.** Staff sign-in credentials, sessions and verification
rows, guest sessions and drafts, booking recovery and capability proofs, and content or media
objects are excluded on purpose. After a restore, staff sign in again and guests request
recovery again. Booking recovery deliveries are not restored, because the proofs they depend on
are revoked; confirmation deliveries are restored. `scripts/local-restore.ts` holds the
authoritative lists, and refuses to export while a reconciliation lease or an in-flight delivery
is held.
