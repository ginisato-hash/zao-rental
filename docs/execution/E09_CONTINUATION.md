# E09-02 — unfinished HOLD work after intake closes

Current owner decision (2026-09-12) supersedes only the earlier blanket denial of
new work after intake close when it is actually a qualified continuation of a live
HOLD. No customer after-hours pickup, confirmed booking/payment, or post-rental
exchange is implemented. PR9 remains Draft; A-G repairs and E10 are not authorized.

Baseline: 1f336f6aac4df092b36c1c35e9cc1987e2fa53fd, base/main
7caf8cea4af29bb0d07ed3a55838257d8a9ffe5c. Prior Claude E09-02 HIGH and the
post-review experiment remain intact in PR comment5644649889. The proposed next-day
ACTIVE example is impossible under the unmodified600s lease: old/current code both
returned EXPIRED/HOLD_NOT_CHANGEABLE. A real differential was demonstrated within
the lease:16:55 MULTIDAY hold,17:05 expiry,17:01 amendment rejected by1f336f6 while
old447d availability/amend succeeded. Old quote creation already rejected past
starts, so neither result proves a previously implemented mid-rental exchange.

## Current decision table

| Operation / condition | Admission and result |
|---|---|
| New HOLD, no verified HOLD-backed preview/quote | Existing newIntakeWindow; same-day AM before12:00, other slots before17:00; past start date denied |
| Future-date advance planning | Normal intake; time outside today's shop hours alone is not a refusal |
| Live owned mutable HOLD, same non-size group scope, after intake close but before original expiry and due | HOLD_CONTINUATION; explicit size selection may change after full inventory/protection checks |
| Linked HOLD with changed period/slot/store/group/product/age/class/equipment family | No continuation exemption; normal intake of changed conditions must independently pass |
| At original expires_at or later | No new mutation or quote; no resurrection, renewal or fixed-state release |
| At AM12:00 / DAY17:00 due or later, even if lease remains | No continuation; MULTIDAY due is its final date17:00 |
| Fixed preparation/rental, PENDING/UNKNOWN/SUCCESS payment, protected transfer or attention | No continuation regardless of wall clock |
| Same authenticated saved request key | Reconcile original result before fresh admission; current expiry/state still shown; never create new claims/quote |
| Cancel / get / list | Do not apply new intake close; retain ownership, permission, payment and fixed-state protections |
| Actual checked-out/paid exchange | Future separately approved loan/exchange boundary; not a600s HOLD extension |

The exact preserved non-size scope is reservationId, startDate/endDate/slot, pickup
and return stores, the set of member keys, and each member's product (which implies
sport), age, tier and set of equipment families. Arrays are compared by semantic
key/family, not order. Variant selections remain in actual conditions, hashes,
solver input, final quote equality and audit. Changing a size is explicit and uses
the existing catalog/recommendation constraints; no model promise, hidden
substitution, age/class fallback, BSL/DIN, left/right asset or occupancy change.

## Shared judgment and service boundaries

`contracts/hold-intake.ts` owns non-size scope, candidate projection, mutable lease
checks and new-vs-continuation admission. `core/inventory/intake-context.ts` adds
the existing database transfer protection query. Both domain roles already have
the needed SELECT grants: no new privilege, schema or public bypass route.

Every consumer fetches its own authorized DB row. An ID or client boolean is never
an exception. The current state must be ACTIVE, expires_at strictly future, due_at
future, PROVISIONAL, payment NONE/FAILURE, no transfer attention/protected piece.
The stored expiry was written by both baseline and current HoldService as the
server acceptance clock plus the fixed600 seconds. Because amend/reassign/replay
never changes it, expiry minus600 seconds reconstructs that acceptance instant.
The shared check verifies normal intake would have accepted the saved conditions
at that instant. This uses the domain clock encoded in the lease, not the audit
wall clock (which intentionally differs when test owners inject dates). Invalid
or after-close acceptance evidence fails closed. No TTL mutation is introduced.

HoldService performs owner/reservation/store/permission checks before inventory
locking and again after lock acquisition. It then reads server time and fresh
state/version. After planning, it checks time/lease again before writing. Amend
uses expectedVersion; it is mandatory when the after-close exception applies.
Existing normal HOLD UI now sends the observed version. Same-key lookup precedes
fresh version/state/admission decisions, but never bypasses current authorization.
Physical reassign preserves the existing condition/lease and shares protection
checks. Full-period solver and claim writes retain their existing atomic lock.

RecommendationService constructs a full input group scope on the server, then
passes one member key and the observed DB version alongside each single-member
candidate. The shared contract verifies that projection, instead of comparing one
member with the entire old group. Each candidate remains advisory; all members'
final selected conditions go through one atomic HOLD amendment and version check.
Changed scopes fall back to normal admission, so referencing an old HOLD cannot
add people or extend dates after close. Final quote input comes from the committed
HOLD, with exact selected-conditions equality checked again.

QuoteService.preview keeps its no-HOLD/no-coupon public-value shape; an optional
server-internal, typed candidate context carries the full scope/member/version
and HOLD ID. It re-reads and authorizes that row using its existing read-only
transaction and validates the same shared admission. No new HTTP preview or
authorization flag is exposed. Preview does not create HOLD, formal quote or
coupon reservation. Formal create takes inventory then pricing lock, checks a
fresh clock/state, and rechecks at insertion time. Its continuation expiry is
bounded by original HOLD expiry, final due, private quote TTL and applicable
coupon/estimated-early limits, never the already-past start/intake-close time.
Previously saved quote amounts/expiry/hash remain immutable; chargeReady=false.

## Verification classification

First14-case normal password/UI/API/PostgreSQL test on baseline1f336f6:8pass/6fail.
The UI counterexample received409 instead of201. Additional failures covered lost
response/recovery and absent after-close/version handling. They were not hidden
by skips. The first corrected run passed the same14 cases; a test-only synthetic
identity lookup and the coupon recovery's completion assertion were corrected/
completed before it. Three additional edge cases cover direct domain replay,
client-flag/version refusal, and quote expiry during a synchronized lock wait.

`tests/recommendation/continuation-ui.ts` uses the built normal app, actual password
sessions/Origin protection, app DB roles and isolated PostgreSQL. It proves:
- 2-member16:55→17:01 length/reference-price/selection/amend/quote/reload, original17:05 TTL;
- closed new intake, expiry exactly/after17:05 and next day, AM/DAY due cutoffs;
- non-size changes, foreign owner, stale version, fixed/payment/attention refusals;
- one remaining145cm asset raced by separate holds, atomic success/failure;
- lost delivered HTTP response, reload after expiry, stable saved domain keys;
- actual quote failure after HOLD commit (missing synthetic coupon), same-key
 recovery after existing privileged test-only coupon configuration, no coupon use;
- amend and quote waiting on inventory lock while the test-owner clock crosses
 expiry, synchronized using actual pg_stat_activity (no long sleep/system clock change);
- direct key replay and no client continuation/unversioned-change exemption.

Fixed/payment/attention fixtures use owner SQL against this disposable test DB;
they are not a claim of newly implemented live dispatch or payment. Existing E07
real workflows and other regressions remain in verify. Pure contract tests cover
scope projection, malformed acceptance timing, future planning and all protected
states. Normal app does not receive a test principal or clock control endpoint.
Mobile browser widths are not a physical phone claim. Full verify, final-head CI
and static review outcomes are recorded per SHA in the PR, not preclaimed here.

## Remaining gates

A-G remain OPEN exactly as tracked in E09_AUDIT_FOLLOWUP.md: stale staff settings,
actor authorization during ledger lock waits, expired active claims, READY transfer
cleanup, allocation limits/scope, HTTP/schema mismatch, repeated quote SQL/mixed
load. No product repair for them is part of this delta. A/B/F remain proposed
pre-E09-merge gates. Global80/240 and mixed-load performance are not newly tested.
Prior preview p95 numbers still mean preview HTTP only, not HOLD+quote total.

Existing Claude calls0/1/2 are retained (3 launches). New authority permits call3
for this fix and call4 only if call3 findings require a correction; cumulative
maximum5. Existing Team/creditsOFF/static-only direct route, no Runner/adapters.
Provide prior HIGH, counterevidence, this contract, full incremental diff, tests,
CI and A-G. Scoped approval does not imply system-wide unresolved0 or merge.
Stop only owned DB/Web/browser/Claude; no E10, production, Square, real inventory,
new host rights/services, PR3 adoption or unattended execution.

Final local verify2026-09-12T09:31:57.798Z completed21commands, all exit0,
including continuation17pass, prior audit20pass and unit80pass, with0skips.
The last implementation refinement uses the same version-aware admission closure
before planning and before writing, so crossing the intake cutoff during planning
cannot avoid the continuation expectedVersion guard. A prior full21-command verify
also passed; it preceded this refinement and is retained separately, not substituted
for the final code evidence. CI/review must still target the committed head.
