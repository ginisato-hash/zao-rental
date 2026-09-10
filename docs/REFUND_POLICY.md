# REFUND_POLICY.md — Early Return and Staff Exceptions v0.4

## Confirmed owner decision
Early return does not normally create a refund. Do not automatically shorten/reprice the paid contract when staff scan an item back in, even when days remain. Preserve the approved price-book/promotion snapshot and paid amount.
Exceptions (for example, an injury-related request) may be refunded fully or partly by a staff account with an explicit REFUND_OVERRIDE permission. This permission is not restricted to an owner-only role, but ordinary STAFF accounts do not silently inherit it.
This is a documented staff function behind normal authentication/authorization, not a hidden URL, secret shared PIN, universal credential or bypass of payment controls. Server-side permission checks are mandatory.

## Flow
Reservation / returned renter or item -> 例外返金 -> reason category and short note -> explicitly entered/confirmed JPY amount -> original collected amount / previous and pending refunds / remaining refundable balance -> confirmation -> server refund request -> pending/completed/failed status.
Do not mechanically refund a number of unused days at a derived daily rate. Show a suggested amount only if a separately approved policy defines it; final exception amount is explicit.
Support partial groups and multiple collected payments: link each refund to the original payment(s), payment location(s), renter/item allocation and the reservation's refund ledger. The staff member's current store need not be the original payment location.

## Permission and audit
Record actor, effective permission, acting store, reservation, payment, reason, JPY amount, before/after balances, request ID, policy version, timestamp and provider refund ID/status. Keep refund approval separate from price editing, granting permissions and deleting audit history.
An owner/admin can assign this capability to selected staff with optional configured amount/store scopes. Numeric limits are not yet specified; do not invent a financial threshold. Until grants/scopes are configured, fail closed. A generic STAFF label is never sufficient authorization.
Reason is required; injury diagnosis or medical documents are not required by this feature. Avoid storing detailed medical narratives in general booking notes or sending them to the provider; use minimal operational reason categories.

## Refund correctness
Use one stable idempotency key for one approved logical refund request. A timeout/unknown response is not failure and cannot trigger a new unrelated refund ID/key. Persist the request and reconcile provider state.
Reserve the requested refundable amount transactionally against completed plus pending/in-flight refunds before calling Square. This prevents two staff phones refunding the same remaining amount. Observe actual provider status; HTTP success/request-created or local button press is not proof of a completed refund.
The local ledger must reconcile external refunds made through the Square Dashboard as well as this app. Do not permit total authorized/refunded amounts to exceed collected funds after prior refunds.
Square payment completion status and refund status are different. In particular, a Square payment may remain COMPLETED while refunds exist; do not overwrite the raw payment status with a locally derived REFUNDED label.

## Return is independent of money
Actual return, receipt and inspection can complete even if a refund is pending/rejected. Verified unused future dates may be released by an allocation event without refunding the customer; same-date reuse remains disabled. A refund by itself must never release an unreturned physical item.
Before-use shortening, cancellation and product-change financial rules are distinct and not newly authorized by this early-return decision. Existing proposal: previous-day cancellation 50%, same-day 100%; rule publication/legal review remains a separate production task.

## Current primary API references checked for this update
Square RefundPayment: https://developer.squareup.com/reference/square/refunds/refund-payment
Supports partial/full refunds, original payment link, amount validation and required idempotency key.
Square Refund Payments: https://developer.squareup.com/docs/payments-api/refund-payments
Documents refund states and refund.updated reconciliation; payment status remains COMPLETED even after a refund.
Verified 2026-09-10. These citations establish API capabilities, not approval of this shop's commercial/legal policies. No live Square action occurred in this package build.
