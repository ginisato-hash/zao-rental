# Attended Production payment acceptance

M2 is closed at main `c103ed31e39b4863fc29db36f4d1e15e22d3283d`, tree
`6ffbd4aae43da12a059e7f1c6417978e7bd3c899`. This change prepares the M3 path.
It does not authorize a Production mutation, deployment, payment, refund, email,
publication, credential activation, or subscription creation.

## Invocation and identity

Run from the exact clean, merged checkout, after recording the current Vercel
Production release identity. The CLI compares local HEAD/tree and a fresh
`git ls-remote origin refs/heads/main` with the explicitly supplied release/tree.
The configuration's release must agree. Do not use the old M2 release for a later
merged source or claim that an unmerged candidate is the Production release.

```
npm run production:payment-acceptance -- preflight --input /absolute/private/m3-input.json
npm run production:payment-acceptance -- reconcile-one --input /absolute/private/m3-input.json
npm run production:payment-acceptance -- diagnostics --input /absolute/private/m3-input.json
npm run production:payment-acceptance -- project-one --input /absolute/private/m3-input.json
npm run production:payment-acceptance -- cancellation-refund-one --input /absolute/private/m3-input.json
```

Every command also accepts `--plan /absolute/non-secret-plan.json`: exactly `releaseId`, `tree`, `target`,
`reference`, `jobId`, `refund`, merged in process memory over the secure input (which must not already carry them;
only `configuration.deployment.releaseId` follows the plan). Merchant, locations, hosts, roles, credentials and
origin cannot be supplied. `reconcile-one` uses the exact-payment Production functions of migration 0052 so an older
unrelated inbox event is never dispatched; a lost checkout response (attempt `UNKNOWN`, `provider_id` null) is
recoverable only through one `GetPayment` that matches every persisted fact, and its payment may bind only after
the booking is already cancelled. See `docs/execution/m3-targeted-recovery/PLAN.md`.

The input is an owner-owned regular file, mode 0600, outside the checkout, at most
64 KiB. No ambient environment activation or credential fallback exists. Assemble
it only from approved secure sources; do not put credentials in arguments, logs,
evidence, Git, or examples. Its exact top-level fields are:

| Field | Contract |
| --- | --- |
| `releaseId`, `tree` | Exact merged source SHA and tree |
| `configuration` | Existing `ProductionConfiguration`; fixed Production Neon/Vercel identity; main origin `https://zao-rental.vercel.app`; actual merchant and both exact locations |
| `databaseUrls` | Only required named bindings from the role table below; direct pinned host, neondb, exact user, verify-full; no owner URL |
| `square` | `accessToken`, `expiresAt`; approved Production personal token; `never` only for provider-confirmed non-expiring token |
| `target` | Null for preflight; otherwise exact persisted `PaymentRequest` fields plus `paymentId`; MOUNTAIN_BASE only for this acceptance |
| `reference` | Null except projection; exactly bookingId, attemptId, jobId, truthRevision, truthFingerprint, observationFingerprint, expectedRevision |
| `jobId` | Null or exact persisted job UUID for diagnostic reference extraction |
| `refund` | Null or exact id, amountJpy, authorizeCreate; amount must equal the full approved target charge |

`issueExactProductionIdentity` is the only issuer feeding reconciliation authority
and projection permits. There is no test issuer or synthetic identity override.
Every connected role proves authenticated TLS, database/user identity, absence of
membership/ownership/elevation, required Production function EXECUTE, and denial
of generic Sandbox-capable payment functions. Preflight makes zero provider calls.

| Binding | Role | Use |
| --- | --- | --- |
| receiver | neondb_pay_receipt | Preflight only; live ingress holds this credential separately |
| dispatcher | neondb_pay_dispatch | Production inbox dispatch |
| worker | neondb_pay_truth | Claim, persisted context, finalize |
| projector | neondb_pay_projection | Persisted truth reference and business projection |
| diagnostic | neondb_pay_diagnostic | Production diagnostic function |
| operations | neondb_operations | Existing CancellationRefundWorker only; never a replacement for any pay role |

## One finite chain

1. A later, separately approved real guest booking uses the main protected app's
   existing payment path. This CLI has no payment-create command. Record its one
   booking/attempt/idempotency key, exact amount, merchant/location, and returned
   payment ID. UNKNOWN without a verified provider ID is a manual gate, not a new POST.
2. The dedicated ingress preserves raw bytes and verifies the exact URL/signature,
   commits `receive_production` before ACK, and performs no lookup/business work.
3. `reconcile-one` dispatches at most one signal and claims at most one job. It
   refuses an unexpected queued merchant/payment or Sandbox claim before lookup.
   It compares the complete persisted request with the attended target, then
   performs at most one GetPayment using the existing fixed version 2026-08-19.
   A different queued claim is a stop; do not loop through other customers' jobs.
   SQL dispatch/claim are separate durable operations, so a rejected unexpected
   claim can retain its lease. No automatic recovery or repeat command is scheduled.
4. `diagnostics` with an exact jobId derives the seven-field reference from
   `payment_projection.lock_source`, the persisted attempt and projection head.
   It emits IDs, states and fingerprints, never observations/raw provider bodies.
5. `project-one` accepts only that exact reference and re-reads persisted truth
   under the existing transaction and locks. No caller observation can enter the
   projection. Stale revisions fail; duplicate replay preserves the stored result.
6. After Square COMPLETED, accepted truth, CONFIRMED booking, and guest cancellation
   earlier than the 48-hour boundary, the existing cancellation path creates the
   refund row. `cancellation-refund-one` requires the exact completed payment and
   full refund amount. `authorizeCreate=true` may only be supplied after the
   later Owner live-money approval. Its durable UNKNOWN reservation commits before
   the one refund POST. Existing provider ID means GET only; UNKNOWN without ID
   means manual reconciliation. No blind POST retry or second refund exists.

The operator closes all pools and terminates. No cron, daemon, infinite loop,
main-app webhook route, publication authority, email sender, or schema change is
introduced. Square GetPayment has no idempotency-key response field: this key is
bound to the trusted persisted attempt, while reference, payment ID, location,
currency and amount are checked against the provider observation.

Official contracts: [GetPayment](https://developer.squareup.com/reference/square/payments-api/get-payment),
[GetPaymentRefund](https://developer.squareup.com/reference/square/refunds-api/get-payment-refund),
[webhook signature verification](https://developer.squareup.com/docs/webhooks/step3validate).
The repository version remains 2026-08-19 regardless of the docs' current default.
