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
