# R10/S3 implementation and finite acceptance boundary

Authority: ../PRODUCTION_P6_S3_AUTHORITY.md, explicitly adopted by Owner in normal chat.
R10 budgets: Preview1, controlled operator POST1, GetPayment1, refund POST1,
conditional GetRefund1 only for successful POST with exact PENDING refund and safe ID.
No retry, CreatePayment, S1, webhook, DB, model, new PR or production activity.

## Source contracts

Only pezzekG1LQRt4MVKF0X4sgRCx1FZY / 100JPY / adopted S1 merchant-location binding.
S3's manifest pins operation and refund UUID once, plus explicit R10 synthetic reason.
S2 immutable request supplies original booking reference. Existing squareObservation
and matchPayment validate the lookup. Any prior refund/conflicting total also blocks.
Square has no Payment.merchant field; its authority is the adopted S1 + server binding.

S3Call/transport are separate because shared SquareCall and SandboxRefundTrial use a
P4-only reason. Shared transport and P4 journal remain unchanged. Refund field validation
reuses SandboxRefundObservation's contract, without running the old database journal.
No unsupported metadata, credential expiry or API response fields are fabricated.

## Official references checked 2026-09-15 JST

- [GetPayment](https://developer.squareup.com/reference/square/payments-api/get-payment): exact fixed payment ID; response identity and captured timeline checked.
- [RefundPayment](https://developer.squareup.com/reference/square/refunds-api/refund-payment): fixed idempotency_key, payment_id, amount_money and reason; no unlinked/gift-card/application fee fields. Version2026-08-19.
- [GetPaymentRefund](https://developer.squareup.com/reference/square/refunds-api/get-payment-refund): only the safe refund ID returned by the authorized PENDING POST.

## Runtime and output safety

Temporary POST and provider-free preflight use existing pure environment checks;
Preview/Sandbox/exact version/merchant/app/location/token format/public-secret rejection.
No UI link, sitemap or GET invocation. Same-origin intent required; body/query inputs
rejected. Vercel standard login protection must be independently verified before use.

The local exclusive/fsync guard is reserved before the whole workflow (therefore before
refund), carrying authority commit/deployment/manifest/payment/key/amount. Same-instance
latch is additional protection. Fixed Square idempotency protects the logical refund.
This is the Owner-approved Sandbox-only exception, not distributed HTTP exactly-once proof.
Production still requires its shared durable journal.

Each provider call has a 5second deadline with abort, no automatic/manual retry, fixed
HTTPS Sandbox URL, redirect:error/cache:no-store/credentials:omit, bounded JSON response.
Only whitelisted identity, amounts/status, normalized payment dates, counts and hashes
leave the server. Raw provider bodies/cards/credentials/errors are never published.
Known mismatch is not retried into PASS. HTTP2xx alone never suffices.
COMPLETED refund ends with no lookup; valid PENDING permits one GET. Still pending,
failed/rejected, auth/rate-limit/mismatch/unknown all stop without new POST.

## Validation and evidence

144 fixture tests pass, including45 R10 tests/guard cases and99 existing related tests.
Secret scan/lint/typecheck/build exit0. Two initial typecheck failures are retained:
JPY literal narrowing, then separate P4 reason contract; no shared boundary was relaxed.
Legacy RefundTrial regression uses a fake journal, not a real-DB durability claim.
No actual provider request has occurred at this predeployment checkpoint.

Immutable manifest/source must be committed, pushed and remotely read back before dispatch.
Result must be saved remotely before deleting temporary routes, validating and deleting
only the exact S3 Preview. Accepted R3, all histories, local guards and provider objects
remain. No refund is issued as cleanup. S3PASS permits S4 gate documentation only.
