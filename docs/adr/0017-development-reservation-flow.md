# ADR 0017: supervised synthetic reservation / payment development flow

Status: implemented payment/preview subset; custody mutation BLOCKED. Delegation
ZAO-RENTAL-FLOW-DEV-R1, base137352fcaa7b28f88aef5100479297f74e64b4aa. No production authority.

## Boundaries

Use existing Better Auth password sessions, staff/store permissions, HOLD planner and
immutable private quotes. The normal app remains `UNCONNECTED` for booking payment.
It cannot enable a fake gateway through a body, redirect, environment toggle or cookie.
`tests/flow-app` is a separate loopback test composition of the same pages, real sessions,
protected handlers and real PostgreSQL services. Only that test composition imports the
synthetic gateway. The actual NODE_ENV=production also rejects simulated gateways.
No external Square transport, webhook endpoint, email provider, customer account or public
preview URL is configured. `chargeReady=false` and pending tax basis never change.
The preview accepts only explicit SYNTHETIC names / synthetic-*@example.invalid addresses;
these are test boundaries, not new commercial identity/terms rules.

A booking copies the quote conditions, full immutable price snapshot/hash and contact consent
version, with an authorized caller/request fingerprint. Payment attempt and globally unique key
are committed BEFORE gateway submission. One attempt per booking means even another submitted key
cannot create another payment. Ambiguous submission remains UNKNOWN/SUBMITTING until lookup;
no automatic retry, replacement charge, scheduler or background service exists.
Failed/canceled provider terminal evidence persists across local REVIEW and cannot be silently
promoted by contradictory events. Event IDs bind payload hashes. Signature verification uses
raw bytes, exact notification URL and constant-time HMAC comparison; a verified event triggers
provider lookup, never confirmation from its embedded paid/status/amount. The offline replay
entry requires the existing verified staff session. External callback identity/job wiring and
Square Sandbox acceptance remain unimplemented and must not be inferred from this replay test.
The test gateway is process-local: server restart with an unresolved attempt requires independent
provider evidence; missing fake evidence stays incomplete and never creates another request.

Confirmation requires matching booking/key/provider/merchant/location/JPY/integer amount, actual
payment completion time, original live HOLD, current complete claims and matching conditions.
A late success becomes PAYMENT_REVIEW without resurrection or new claims. Confirmed development
bookings use the existing SUCCESS protection beyond the original expires_at; expires_at never
extends. `confirmed_at` distinguishes a paid flexible witness, which the shared existing full-
period planner can reassign only within saved variants/conditions. Fixed/prepared/shipped assets
remain pinned. Ordinary owner HOLD amendment still rejects paid/fixed records.
Coupon redemption and zero-amount commercial confirmation are explicitly unconnected; previews
with those conditions cannot be converted into this synthetic payment path. No pricing source
or tax/rounding/discount priority is newly approved by this ADR.

## Partial E12 work and stopping boundary

0010 adds empty loan-cycle, candidate, receipt, inspection and custody projection tables only.
The app role receives no new rights to them. Pure return-cycle tests check immutable whole-Asset
identity, stale cycles, duplicates and separate candidate/receipt semantics. There is NO ordinary
loan/return API, camera/return UI, physical receipt operation or inventory reintegration yet.
Do not claim E12 or the complete E13 loop passed. The exact rejected operations and next bounded
approval are in FLOW_DEV_BLOCKED_PERMISSIONS.md. Existing ledger guards, applied0001-0008 and
application-role grants are unchanged. Pair label policy is a pure contract; old boot labelCopies
presentation is not yet changed. Tests do not prove real smartphone/camera readiness.

## Primary sources verified 2026-09-12

- https://developer.squareup.com/docs/webhooks/step3validate — signed notification URL + raw body.
- https://developer.squareup.com/docs/webhooks/overview — duplicate delivery / retry boundary.
- https://developer.squareup.com/docs/payments-api/webhooks — event versus payment lifecycle.
- https://developer.squareup.com/reference/square/payments-api/create-payment — saved idempotency key, amount/location/reference.
- https://developer.squareup.com/reference/square/objects/CardPaymentTimeline — captured_at, not arbitrary updated_at, is card capture evidence.
- https://github.com/soldair/node-qrcode — pinned QR encoding implementation.
- https://github.com/cozmo/jsQR — raw image QR decode test. No remote image/scan service.

## Review correction boundary

Source validation and confirmation reread the server inventory clock after awaited validation.
UNKNOWN fallback requires current stored pickup/return scope even when a provider response is lost.
0011 only enforces scan-before-confirmation on the unconnected receipt table; actual physical
receipt remains a separate timestamp and may precede scanning. No writer grants are added.
See FLOW_DEV_REVIEW_FOLLOWUP.md for red/green SQL synchronization and remaining evidence limits.
