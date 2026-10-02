# Targeted Production reconciliation for a lost checkout response

The first attended Production payment returned no provider response to the app: the attempt stayed `UNKNOWN` with `provider_id` null while Square delivered the signed `payment.created` webhook. The reviewed merchant-wide reconciliation path cannot recover that attempt.

1. `dispatch_production`/`claim_production` order by receipt time across the merchant, so an older unrelated event (a signed test delivery) is dispatched first. The attended wrapper then rejects the claim and leaves its lease.
2. `load_context_production` selects the attempt by `provider_id = payment`, which is null here.
3. `decidePaymentProjection` blocks any attempt whose `providerId` differs from the observation, including null.

Migration `0052` adds three Production-only functions (environment hard-coded, `PUBLIC` revoked): `dispatch_target_production(merchant, payment)`, `claim_target_production(owner, merchant, payment)` (both fixed to one row) and `load_context_target_production(attempt, booking, merchant, payment)`, which finds the attempt by persisted identity, accepts `provider_id` null or exactly the candidate payment, refuses a payment already bound to another attempt and writes nothing. Grants: dispatcher gets the first, the truth worker the other two. Historical `0001–0051` and every Sandbox function are unchanged.

The webhook payment ID is only a lookup candidate. `reconcile-one` performs at most one `GetPayment` and the existing `matchPayment`/`decidePaymentTruth` contract must match booking, idempotency key, merchant, location, amount and currency. The generic worker admits a null `providerId` only through an explicit `unboundCandidate` option that the attended operator alone sets for its own payment ID.

Projection admits a null attempt `providerId` only on an already `CANCELLED` booking (`CANCELLED_PAYMENT`): the booking is never revived, the HOLD is never reactivated and the cancellation refund obligation is created once. Every other branch still returns `BLOCK_IDENTITY_MISMATCH` for a null provider. The operator additionally refuses `diagnostics`/`project-one` for a null provider unless the booking is already `CANCELLED`.

`production:payment-acceptance <command> --input <secure file> [--plan <plan>]` accepts a non-secret plan containing exactly `releaseId`, `tree`, `target`, `reference`, `jobId`, `refund`; it is merged in memory over the immutable secure input (only `configuration.deployment.releaseId` follows the plan). The secure file is never rewritten.

## Attended order

1. Freeze the candidate; local verification, secret scan and Foundation CI pass; squash merge.
2. `production:install-targeted-reconciliation` once from the exact clean main with the pinned owner URL in process memory only (`PRODUCTION_PAYMENT_MIGRATION_DATABASE_URL`): fixed 0051→0052 transaction, registry checksum admission, grants for two roles, readback; `COMMIT_UNKNOWN` means read-only reconciliation, never a blind rerun.
3. One exact-main deployment, health/readiness/smoke; publication stays OFF and DNS unchanged.
4. Re-lease the five payment roles (`VALID UNTIL` only), preflight, targeted `reconcile-one`, normal guest cancellation, `diagnostics`, `project-one`, refund and the single cancellation email under the existing one-payment/one-refund/one-email authorisation.

No payment, refund or email authority is added by this change.
