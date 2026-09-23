# Release code closure

Authority: Owner's 2026-09-23 Codex takeover directive. Code/local tests only; no PR
until separately instructed. No main merge or live activation.

## Checkpoints

- Production Identity V5: `ff5727f7d6bd02e2eb0707d5dccd246513cfc4d9`.
  Normal push, exact remote SHA match, clean worktree, Actions 0.
- V5 merged into inventory: `982851e82a15822278bf61fabdd1f9bd4565dcf5`.
  Normal two-parent merge, no conflicts. Normal push, exact remote SHA match,
  clean worktree, Actions 0. Targeted validation: 38 identity/admission unit tests;
  29 role/readiness, 12 runtime and 35 provisional inventory PostgreSQL cases;
  lint/typecheck/secret scan passed.
- Release branch created from that exact integrated HEAD: `claude/release-code-closure`.

## A — Commercial price authority

Implemented exact-identity-issued opaque authority and record-bound permits. The approved
logical equipment PriceBook `ZAO_2026_27_V1`, source revision `0.3`, wear revision
`ZAO-WEAR-CATALOG-UX-20260913-V1_2`, source digests, combined table digest and initial
available DB revision 2 are pinned. The database UUID is bound per permit; a different
record/revision/digest invalidates it. Changing sources cannot silently change the pins.
Quote creation can attach `chargeReady:true` only with registered authority; ordinary
Sandbox/development quotes remain false. Migration 0043 adds the corresponding snapshot
storage shape without removing immutable quote/book guards. Prices, duration math and
approved discounts are unchanged. Existing pricing regression and direct schema/forged-
authority PostgreSQL proof pass. Genuine Production capability acceptance remains a live
attended check; no testing identity issuer is introduced.

Narrow factual gap retained: source tax display basis is `PENDING_OWNER_CONFIRMATION`.
No tax arithmetic or tax-inclusive/exclusive label was invented.

## Remaining code phases

B Square Production; C exact-one protection including durable POLE exemption; D cancellation
and refund settlement; E Resend; F publication. Amendment reserve-capacity disposition and
historical prefix fixtures remain required. Full verify has not run.

## B — Square Production and booking admission

One shared Square engine and fetch transport now handle both environments. Production uses
`https://connect.squareup.com`, its own credential environment and merchant/location bindings,
with the existing request format, deadlines, validation, HMAC, UNKNOWN handling and GetPayment.
No default fetch, credentials, retries or live activation were added. Booking/quote composition
requires a registered exact identity bound to the same configuration before commercial create
is usable. Production completion writes CONFIRMED, never CONFIRMED_DEV. Projection validates
persisted approved price facts; its internal SQL worker is separately tested with synthetic
Production-shaped rows and persisted provider truth in owned PostgreSQL. Public permit gates
are unchanged. Production role plans include only the new booking writes and price/provisional
reads required by these paths.

Proof: 6 Production adapter cases; existing 26 transport/readiness unit cases; 131 projection/
admission regressions; local commercial SQL proof; 12 normal runtime, 29 role-plan, 10 Square
transport and 23 payment PostgreSQL cases passed. Real identity acceptance remains attended.

Provider references (official, read-only):
- https://developer.squareup.com/docs/build-basics/general-considerations/using-rest-api
- https://developer.squareup.com/reference/square/payments-api

C audit found two concrete issues retained from V4 that will be corrected next: provisional
wear is rejected by the physical-wear count, and missing POLE is treated as optional without
a durable exemption witness. No claim of complete Production inventory proof is made yet.
