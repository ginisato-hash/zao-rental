> Historical original audit/reproduction record. Current owner delegation and item status are
> [AUDIT_AG_DELEGATION.md](AUDIT_AG_DELEGATION.md), [AUDIT_AG_OPERATIONS_UPDATE.md](AUDIT_AG_OPERATIONS_UPDATE.md),
> and [AUDIT_AG_STATUS.json](AUDIT_AG_STATUS.json). Findings, old budgets and stop gates below
> describe their original head; do not apply them as current authority or overwrite the evidence.

# E09 audit followup — two corrections, seven open tracking items

Authority: owner followup plus renewed four-hour window. Start2026-09-12T07:02:10.709598Z
(16:02:10.709598 JST), deadline2026-09-12T11:02:10.709598Z (20:02:10.709598 JST).
Base/main7caf8cea4af29bb0d07ed3a55838257d8a9ffe5c; inspected prior head
447d29e78488cfc2bd376c6e2ede20d372469acc. Initial local/remote SHA and clean worktree matched.
Only new-intake/quote consistency and explicit cm spelling are implementation scope.
PR9 remains Draft, no merge/E10/new stabilization task. E02 and PR3 held. No new public service,
production/migration application, real data, Square, fee change or controller change.

## Corrected observations

| Item | Judgment / evidence level | Before | Acceptance after correction |
|---|---|---|---|
| Same-day time mismatch | 再現確認 → 修正; normal UI + protected API + real PostgreSQL | DAY10:00/AM10:00/PM14:00 all saved ACTIVE HOLD, then HOLD_SAVED / RENTAL_ALREADY_STARTED, no quote | All three COMPLETE, same stored start/due times, valid private quote15000/11200/11200 JPY, readback identical, chargeReady=false |
| cm spelling | 再現確認 → 修正; normal ledger registration API through real DB and recommendation | 150 CM/Cm/tab-CM and26.5 CM/two-space-Cm registered but new variant ID omitted | Explicit same-unit case/spacing eligible; lowercase control stays eligible; unitless150/M/150mm remain omitted |

Reproducer `tests/recommendation/audit-followup-ui.ts`: initial meaningful baseline run8passed/
12failed (7time assertions,5cm) → corrected run20passed/0failed/0skipped. One earlier setup attempt
expected200 for an actual201 creation response; saved separately, not counted as a product defect.
The final verify/CI reruns this same20-case suite with the final restricted explicit-unit cm parser.
New `tests/unit/intake-window.test.ts` covers three time cases, exact closes, future bounds,
Tokyo date/backdated MULTIDAY, immutable conditions and missing/other-unit exclusion.

Same-day lost delivery is simulated only AFTER the actual selection/quote commits; reload a minute
later recovers original HOLD/quote IDs, persisted keys, counts, expiry and snapshot hash. Near-AM-close
quote expires12:00 while the original HOLD lease is unchanged; repeated quote lookup after cutoff
returns the same EXPIRED snapshot. Ordinary new AM12:00, DAY/PM17:00 and past-start MULTIDAY requests
are rejected. Existing future/coupon/early-discount tests are retained in full verification.
Full regression detected historical refusal-code compatibility differences (HOLD PERIOD_ENDED,
pricing RENTAL_ALREADY_STARTED); both were preserved in code, without lowering the old assertions.
No applied migration, stored snapshot or canonical price source was edited. See ADR0016 for the
time contract; OPERATIONS.md remains authority. No actual handoff/payment is claimed.

Evidence: [local reproduction manifest](evidence/e09-audit-followup/manifest.json), timestamp record,
before/after logs and manual audit observation log are committed. Final-head CI run/attempt/checkout
and tree, sanitized review manifest/original output are attached to PR9 after completion. An old
REVIEW_PASS is not evidence that these new findings have been resolved.

## Open audit tracking — no product fixes authorized here

`tests/recommendation/audit-observations.ts` is a finite manual reproducer with synthetic accounts
and an isolated DB. It is intentionally absent from verify: observed defects are not acceptance
passes that a future implementation should preserve. Exit0 means observations completed, not safety.
Line references in A-G refer to inspected baseline447d; final review supplies numbered new-head files.
The inspected A-D product files are unchanged by this followup; code-path comparisons to447d confirm
these are existing E05/E06/E07 defects exposed by E09 audit, not introduced by the two fixes.

### A — stale target staff settings (HIGH)

判定: 再現確認 — actual StaffManagement form + protected API + real DB.
Sources: StaffManagement.tsx StaffRow/save (lines4–11), auth/accounts.ts AccountSettings/
writeAccount (lines8,33–49), staff-input.schema.json update. List includes revision, but the edit
body/schema does not carry expected target revision; target UPDATE only filters id, then replaces
all permissions/stores. Open target form in admin1, admin2 disables and denies INVENTORY_EDIT,
admin1 saves old form: active=false→true, edit=false→true; target revision increases but is not used
as an update precondition. The acting admin's stamp does not encode another staff member's settings.
Fix candidate: target expectedRevision in schema/UI/API, check under target row lock before any
changes, conflict409 and explicit reload; whole role/permission/store update atomic. Test both
admin orderings, disable/revoke/store removal, independent actor revocation and stale harmless edit.
Proposed gate: **before E09 merge**, definitely before E10/real accounts/production. Not accepted as
an operational limitation or repaired by newer session cookies. This is target concurrency, not B.

### B — ledger actor permissions revoked during lock wait (HIGH)

判定: 再現確認 — normal authenticated API + real DB two-connection race, not UI reproduction.
Sources: lib/ledger-runtime.ts handleLedger; catalog/ledger-service.ts constructor/transaction/update
(lines17–30,69–90). Runtime resolves once; service stores role/store scope. A permission-allowed
asset edit waits for inventory advisory lock71820600. Observe actual wait in this isolated DB,
admin commits INVENTORY_EDIT=false, release lock: request returns200 and writes notes after revoke.
Initial authorization and forbidden-store pre-lock check work, but no DB refresh after waiting.
Fix candidate: actor identity/session revision revalidation at the mutation lock/transaction boundary,
defined lock order with revocation; preserve pre-lock rejection and target optimistic version.
Test privilege/store removal and disable before/during lock wait, same-request atomicity, no deadlocks.
Proposed gate: **before E09 merge**, not a substitute for A; also before any real staff operation.

### C — expired HOLD active claims block ledger maintenance/quantity (MEDIUM)

判定: 再現確認 — normal APIs + real DB. Sources: inventory/expiry.ts; HoldService.get/view;
catalog/ledger-service.ts update; migration0005 transfer_inventory_guard lines72–75.
Create ski-set HOLD, advance test clock11minutes, get reports EXPIRED yet3active claims remain.
Asset MAINTENANCE and pole quantity0 both422 until a domain command reconciles expiration.
Guard checks active claims rather than effective HOLD time; ledger update never invokes expiry.
Fix candidate: shared bounded reconciliation under inventory lock before evaluating ledger mutation,
preserving payment UNKNOWN/PENDING and fixed/allocation/dispatch protection, with explicit audit.
Do not blanket-delete claims or rely on a periodic runner. Test safe expiry, mixed fixed/pending,
concurrent HOLD acquisition and ledger update, zero/partial pole changes, unrelated transaction.
Proposed gate: **before E10 starts**, and before real inventory/staff operational use; E09 merge
requires explicit acknowledgment of this restricted-development limitation, not a zero-findings claim.

### D — unreferenced completed READY transfer still blocks ledger (MEDIUM)

判定: 再現確認 — normal transfer/ledger APIs + real DB; no QR/physical receipt performed.
Sources: transfer-service.ts add lines27–32 (only opportunistic READY→CLOSED cleanup);
migration0005 state guard/index lines26,72–75, transfer_move_stock ready lines88–94.
Plan board+pole, dispatch17:00, actually receive17:12, mark readiness through normal APIs. With
zero active referencing claims both pieces stay READY. Asset maintenance and destination pole
quantity0 both422. No fabricated17:10 receipt or double stock increment was used in the probe.
Fix candidate: explicit safe completion/reconciliation boundary after receipt/readiness, maintaining
history and future-claim projection, protected issue/fixed claims and replay identity. Reconcile
without requiring an unrelated next transfer.add. Test assets/poles, referenced vs unreferenced,
partial readiness, concurrency and later HOLD creation. Never erase dispatched moves on HOLD expiry.
Proposed gate: **before E10 starts**, before operational inventory use. Historical receipt is kept.

### E — allocation search and global scope (MEDIUM; bounded-development limits)

判定: 9units/10members反例は再現確認 (pure actual solver); global boundsはコード上で確認、統合再現未実施.
Sources: period-matching.ts matchPeriods lines9–18, hold-service.ts plan lines78–100.
Single-day10demands each accepts the same9capacity1units. Pigeonhole proves shortage, but the actual
default100000 candidate-visit search throws INDETERMINATE. This is not false FEASIBLE or double
allocation; diagnostic is honest but avoidably inconclusive. Separately, plan loads up to81global
live HOLDs before date/variant filtering, rejects >80, builds all mutable requirements then rejects
>240. Fixed live HOLDs count toward80; unrelated dates/stores also enter these early limits.
The count is existing live HOLDs (excluding replacement), whereas240 includes candidate components.
No80-HOLD/240-component mixed-load performance was newly measured. Static source bounds are not
a throughput guarantee. Fix candidate: exact overlap/custody dependency components, necessary
interval-capacity/Hall-style shortage checks, symmetry reduction and a bounded complete matching
strategy preserving valid provisional rearrangements and fixed constraints. Do not raise limits
alone or replace with first-come greedy assignment. Test9/10, feasible reshuffle, fixed holdings,
disjoint dates and cross-store dependencies, cap boundaries, adversarial alternatives.
Proposed gate: **before E10 starts** for the9/10/group interaction and scope design; qualify capacity
before real data and production. Existing guard remains explicit, not hidden as ordinary sold-out.

### F — max group schema vs HTTP body size (MEDIUM)

判定: 再現確認 — actual parseConditions + readJson unit path; no DB existence claim for generated IDs.
Sources: hold-input.schema.json (20members×3components×6variants); lib/ledger-http.ts readJson
lines5–15 (UTF8 limit16384); hold-http.ts, quote-http.ts, recommendation-service.ts resume.
Schema-valid20-member SKI_SET direct HOLD envelope =18267UTF8bytes, rejected413 by real parser.
Direct quote adds wrapper fields and is also over cap; direct availability uses a conditions body.
E09 profile HTTP body and direction selection are smaller: no client variant array; saved selection
expands server-side and calls HoldService/QuoteService directly, so internal conditions are not
re-parsed by the16KiBHTTP guard. This is not evidence that maximum20-person E09 acquisition works:
solver/candidate limits in E still apply. Inspect these separate boundaries before choosing limits.
Fix candidate: agreed request-size contract derived from valid maximum inputs + bounded parsing,
or explicit smaller published schemas, with byte-boundary and endpoint-consistency tests. Do not
blindly remove the body cap. Proposed gate: **before E09 merge** because documented accepted group
inputs differ by normal endpoint; capacity-aware limits must also be tested before E10/real use.

### G — quote SQL repetition and mixed-operation load (MEDIUM)

判定: コード上で確認、統合再現・混在負荷計測は未実施.
Source: QuoteService.validateVariants lines31, create/preview callers, list/view lines41–42,
StaffAuth.loadStaff. Component validation loops one SELECT per member component (up to60); list
loads100quotes then invokes view serially, with repeated principal/store queries and linked HOLD/
transfer attention reads. This is not an observed performance failure or a measured end-to-end p95.
Fix candidate: collect variant IDs and validate all component relations in a batch; snapshot-safe
batched owner/permission/HOLD/attention reads and pagination, preserving transaction consistency,
revocation semantics, immutable quote validation and per-owner filters. Tests count queries and
mix list/create/update/HOLD/auth revocation workloads; report operation, size, p95 and failures.
Proposed gate: **before real data**, design/reproduction before E10 volume expansion; production
requires measured mixed-load limits. No unmeasured query caching is introduced in this followup.

## Performance evidence labels

Historical head447d preview-only results remain Mac p95=100.438875ms and CI p95=236.623062ms
(concurrency4,n32; original run34669586439). They measure authenticated POST recommendation HTTP
through response JSON, including feasibility/price/preview persistence; **not HOLD+quote total**.
Dataset:150ski pairs+150boards=300board Assets, separate300boot Assets and150pole PAIRS.
Workload: concurrency1/n8 or4/n32;2members/request(one ski,one board), DAY2035-05-01.
Catalog from the fixture: skier eligible lengths135/145/150/155/165, board145/150/155; complete-set
candidate checks5+3/request. Derived from fixture, not a measured live production candidate count.
One existing live HOLD from earlier functional scenarios is present when that benchmark runs;
it occupies2035-01-06, not May1. Stored failed selections are not additional HOLDs. There was no
80-live-HOLD benchmark. Final verify may produce fresh metrics, labeled separately; neither sample
establishes maximum group/stock capacity. New audit tests are small synthetic cases, not real import.

## Remaining verification and review boundary

No actual staff/customer/device data, public endpoints, production load, Square or live Runner tested.
A-D reproduced; E solver only plus static global bounds; F parser only; G static. No issue is
classified as refuted or already-resolved solely because the old review passed. There is no new
commercial decision here: existing hours/period/price/discount/occupancy rules are preserved.
Initial1+rereview1 used; final rereview1 authorized. Include A-G original findings and evidence with
the full delta since447d, complete changed functions/callers/schema, exact CI/head/tree and snapshot
hash. A scoped correction PASS must never be reported as system-wide zero unresolved findings.
Further product repairs/merge/E10 require the owner's next scope decision; this branch stays Draft.
