# ZAO Production Integration / Correction — RESULT

Branch: `claude/prod-runtime-integration`. Base: exact `main` `72628ba0e06ef1518e45b7178a577dc484adb9f2` (tree `6732993ae34c75c7d13d5da2525bfd840b435925`). No PR opened. Source branches `claude/prod-r4-backup-role`, `claude/prod-r5-inventory-hardening`, `claude/prod-r6-payment-admission`, `claude/prod-r7-webhook-hardening`, `claude/prod-runbooks` are untouched (not force-pushed, rewritten, or deleted) — this is a fresh integration branch, not a merge of them.

This document does not mark any subsystem PASS merely because its original overnight branch said PASS. Every claim below is re-derived from what actually exists and actually ran on this exact branch.

## 1. Migration-0040 collision — resolved

R4, R6, and R7 each independently added a different `0040_*.sql`. Per the TD's decision: **`0040_production_payment_admission.sql`** (R6's) is the sole canonical migration `0040`. R4's backup-role migration and R7's webhook-role migration were **not** integrated as schema migrations — see §3/§4. `config/production/bootstrap-source-manifest.json`, `migration-plan.ts`, `GUARD_MIGRATIONS`, and every hardcoded migration-count snapshot (`tests/unit/payment-activation.test.ts`, `scripts/integration.ts`, `scripts/ledger-integration.ts`) were recomputed **once, centrally**, against this final `0040` — not three independent edits carried forward. `GUARD_MIGRATIONS` stays **12** (unchanged): migration `0040` carries no `zr_*` dev-safety guard, matching R6's original design.

Migration `0040` itself was extended beyond R6's original content with two additive Production reconciliation-admission functions (`dispatch_production`/`claim_production`, see §5) and a minimal schema widening for a real (non-`_DEV`) confirmed booking state and real notification delivery (see §7), on top of R6's original mode-check widening and `load_context_production`/`load_contexts_production`.

Verified: `npm run test:m2b-bootstrap` → 14/14 PASS, `migrations:40`, `guardsRewritten:12`, `structuralEquivalence:PASS`, `securityEquivalence:PASS`.

## 2. What was reused vs. rejected, and why

| From | Reused as-is | Rejected / changed | Why |
|---|---|---|---|
| R4 | Local disposable-PG proof pattern, mutation-test discipline | The migration file itself | Backup identity is an operational credential, not schema (§3) |
| R6 | Migration `0040`'s mode-check widening, `load_context_production`/`load_contexts_production`, core `payment-projection.ts`/db-layer/`payment-reconciliation.ts` logic (all copied in verbatim — the target shape stayed compatible) | `productionProjectionPermit`'s raw-`env`-record signature | Not evidence of Production; replaced with a validated `ProductionConfiguration` input (§6) |
| R7 | Static audit findings (HMAC/replay/dedup/lease-fencing/search_path/redaction — all still accurate, re-verified against the actual code, not re-copied as prose) | The new `_square_webhook_receiver`/`_square_webhook_reconciler` role family and its migration | Duplicates the existing `_pay_*` role architecture instead of extending it (§4) |
| R5 | The audit's conclusion (no defect in dry-run/atomicity/idempotency) — unchanged, still accurate | — (R5 added a real policy layer this pass, see §9, which the original branch didn't have) | |
| runbooks | Phase D/E/J structure and most content | Migration-count assumptions, the "installProductionBootstrap is never called" framing in Phase E | Both were stale the moment R3's hosting composition (§8) was actually built |

## 3. R4 disposition — backup role converted from migration to operational plan

`packages/db/migrations/0040_production_backup_role.sql` (R4's original) is **not** part of this branch. In its place: [scripts/production-backup-role.ts](../../../scripts/production-backup-role.ts) — `productionBackupRoleSql(databaseName, roleName?)`, a pure function returning `CREATE ROLE ... NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOREPLICATION NOBYPASSRLS` + `GRANT CONNECT`/`GRANT pg_read_all_data` SQL strings. No DB access, no password, no live/dormant credential created by this code.

Local proof ([tests/readiness/production-role-plans.ts](../../../tests/readiness/production-role-plans.ts), against a real, fully-bootstrapped, non-`zr_*` `zao_rental_role_plan_test` database in the same disposable cluster — the same pattern `tests/operations/production-bootstrap.ts` already established): role is NOLOGIN until provisioned; once flipped to LOGIN locally, it can `SELECT` across every schema (`public`/`square_webhook`/`payment_reconciliation`/`payment_projection`); cannot `UPDATE`/`DELETE`/`CREATE TABLE`/`CREATE ROLE`; a mutation test proves revoking `pg_read_all_data` breaks read access and re-granting restores it. As before: no `pg_dump`/`pg_restore` binary or Docker exists in this sandbox, so the proof targets the SQL privilege boundary `pg_dump` actually depends on, not the binary itself (disclosed, not hidden).

R4 remains **`R4_BLOCKED_ON_OWNER_CONTROLLED_AGE_IDENTITY_CUSTODY`** — unchanged from the original branch. No age keypair, real or test, was generated in this integration pass.

## 4. R7 disposition — extends the existing `_pay_*` role architecture, no new role family

The `_square_webhook_receiver`/`_square_webhook_reconciler` roles and their migration from the original R7 branch are **not** part of this branch. Instead, [scripts/production-payment-roles.ts](../../../scripts/production-payment-roles.ts) generalizes the **existing** local-only `scripts/payment-activation-grants.ts` (`_pay_receipt`/`_pay_dispatch`/`_pay_truth`/`_pay_projection`/`_pay_diagnostic`) to a real (non-`zr_*`) Production database name, with two additions: `_pay_truth` also gets `load_context_production`/`load_contexts_production` (R6-A, see §6) and `_pay_dispatch`/`_pay_truth` also get `dispatch_production`/`claim_production` (R6-B, see §5). `_pay_receipt`'s existing `square_webhook.receive()` grant needed no change at all — that function was already environment-agnostic (`environment` is a plain parameter, not hardcoded), so it already covers Production webhook receipt.

R7's original static-audit findings (signature verification, replay/dedup, lease fencing, search-path hardening, fixed error responses) are re-confirmed accurate against the actual current code in this pass — no regression found. The one correction: R7's `RESULT.md` claim that "no existing least-privilege webhook identity architecture existed" was wrong; `_pay_receipt` already was that architecture. This integration's `RESULT.md` (this file) supersedes that claim.

## 5. R6-A/R6-B — real privilege tests and a deliberate Production reconciliation admission path

**R6-A**: `payment_reconciliation.load_context_production`/`load_contexts_production` are granted to `_pay_truth` only (§4), and [tests/readiness/production-role-plans.ts](../../../tests/readiness/production-role-plans.ts) proves this with real PostgreSQL privilege checks (not fixtures): `_pay_truth` can call them; `_pay_receipt`/`_pay_dispatch`/`_pay_diagnostic` cannot; no role owns any application object; every role is `NOSUPERUSER`/`NOCREATEDB`/`NOCREATEROLE`/`NOBYPASSRLS`.

**R6-B**: the original R6 branch used the generic `dispatch(environment, limit)`/`claim(environment, owner, limit)` (0026) for Production, which — while structurally capable of accepting `'PRODUCTION'` — sweeps every merchant in that environment, with no explicit merchant binding. This integration adds `payment_reconciliation.dispatch_production(merchant, limit)`/`claim_production(owner, limit, merchant)` (in migration `0040`): `environment='PRODUCTION'` is a **literal inside the function body, never a parameter** — there is no way to pass `'SANDBOX'` to these two functions at all — and `merchant` is a required, validated, filtered parameter. Same `jobs`/`streams` tables, same lease/idempotency semantics, same `finalize()` (already environment-agnostic and job-id-keyed, needed no change); the existing generic `dispatch`/`claim`/`dispatch_target`/`claim_target` (0026/0029) are byte-for-byte untouched.

Mutation-tested merchant boundary (`tests/readiness/production-role-plans.ts`): a second merchant's webhook event is dispatched independently; `dispatch_production('merchant-1', ...)` never sweeps merchant-2's row; `claim_production(..., 'merchant-1')` never sees merchant-2's job. A separate mutation test revokes/restores `_pay_truth`'s `claim_production` grant.

## 6. R6-C — Production projection permit now requires validated server configuration, not raw env

The original `productionProjectionPermit(env, target)` accepted a raw `Record<string, string|undefined>` (any object with the right 3 magic string values) plus a caller-supplied database-name string. [packages/core/src/payment/production-projection-authority.ts](../../../packages/core/src/payment/production-projection-authority.ts) now requires an actual `ProductionConfiguration` — the same type `productionConfiguration()` in `packages/auth/src/production-config.ts` already strictly parses (real `.neon.tech` host shape, deployment-owned HTTPS origin, digest-approved structure) — and derives `database`/`merchantId` only from that object.

**A real, adversarially-caught gap, fixed in this pass**: my first version only shape-checked the config's fields, which a hand-built plain object (never actually validated) could still satisfy. The dedicated test caught this (`Missing expected exception`) on first run. Fixed by adding a `WeakSet`-backed capability check to `production-config.ts` itself (`isValidatedProductionConfiguration`) — mirroring the exact pattern `ProductionProjectionPermit` already uses for itself — so only an object `productionConfiguration()` actually produced and vouches for is accepted, never a duck-typed lookalike. This is exactly the class of gap R6-C was asked to close; it is disclosed here rather than smoothed over, per the "no false PASS" instruction.

Deliberately **not** added: a rejection of `zr_*`-shaped `config.database.name` inside the permit function. The project's own established `tests/readiness/normal-production-fixture.ts` convention deliberately uses a disposable cluster's own `zr_*` database name as the stand-in "Production" identity for fully-local runtime testing (there is no other way to exercise the full runtime without live Neon credentials). Adding that rejection would make the permit incompatible with the project's own established test convention for no real security gain, since the actual evidence requirement (a genuinely-validated `ProductionConfiguration`) is already enforced.

15/15 unit tests pass ([tests/unit/production-payment-admission.test.ts](../../../tests/unit/production-payment-admission.test.ts)), including the corrected end-to-end admission case and every existing R6 mode/DB/role-crossing test (all copied in verbatim, all still pass, since the DB-layer's own identity floor was untouched).

## 7. R6-D — end-to-end commercial booking path: real, but deliberately gated on a pricing decision I am not making

Traced the whole path (`quote → booking → payment attempt → provider result → reconciliation → projection → confirmed booking`) and found it is **more deeply development-only than "add `SQUARE_PRODUCTION` to the projection"** suggested:

- `rental_bookings` has a **table-level CHECK constraint** `price_snapshot->>'chargeReady'='false'` (migration `0009`) — not just application logic. `chargeReady:false as const` is a hardcoded literal across the entire pricing/quote pipeline (`packages/core/src/pricing/quote-service.ts`, `packages/contracts/src/pricing.ts`, `amendment.ts`), asserting "this pricing output has never been reviewed for real commercial charging" — it is not a per-booking flag anyone flips.
- `rental_notifications` has `destination CHECK(destination ~ '^synthetic-...@example\.invalid$')` and `state CHECK(state='CAPTURED_TEST_ONLY')` — the table itself cannot store a real email or a real captured state today.
- `BookingService` unconditionally: forbids `NODE_ENV=production`, accepts only `SIMULATED_DEV`/`SQUARE_SANDBOX` gateway kinds, uses `syntheticContact()`, requires `chargeReady===false`, writes `'CONFIRMED_DEV'`, tags the reason `'DEVELOPMENT_FLOW'`.

**What this pass did, honestly bounded**: migration `0040` additively widens `rental_bookings_state_check` to add `'CONFIRMED'` (a real, non-`_DEV` terminal state, alongside the untouched `CONFIRMED_DEV`/`COMPLETED_DEV`) and widens `rental_notifications`'s destination/state checks to additionally accept a real email address and `'CAPTURED'`. The `price_snapshot` check now accepts **either** the existing `chargeReady='false'` **or** (`mode='SQUARE_PRODUCTION'` **and** `chargeReady='true'`) — the database can now represent a real commercial booking, but nothing in this pass makes the pricing pipeline ever actually emit `chargeReady:true`.

**What was deliberately not done**: a `ProductionBookingService`/production-capable booking path was not built this pass. Building one that actually creates real commercial bookings requires deciding "is our current pricing calculation authoritative enough to charge real money against" — that is a pricing/business-authorization decision, not a code-integration one, and fabricating a path that bypasses it (e.g. a stub that always returns a fake production-ready price) would be worse than not building it: it would look activated without being reviewed. This is recorded as an explicit, real gap — not silently deferred, not claimed done. `BookingService`'s existing behavior is untouched and re-verified byte-for-byte (`tests/flow/payment.ts`: 23/23 PASS unchanged).

## 8. R6-E — idempotency / ambiguous-outcome coverage: what already exists, what was not added

The existing test suite (`tests/flow/payment.ts`, `packages/core/src/payment/payment-projection.ts`'s `decidePaymentProjection`) already covers several of the 15 named scenarios structurally: duplicate/repeated idempotency key (`rental_payment_attempts.idempotency_key UNIQUE`), same key + changed payload (`ops_requests`/attempt fingerprint mismatch → `IDEMPOTENCY_MISMATCH`), duplicated/out-of-order webhook (`square_webhook.inbox` dedup + `payment_reconciliation.jobs`'s `signal_revision`/`claimed_revision` staleness check), process-restart-safe reconciliation (lease/fencing tokens in `claim`/`finalize`). This pass did not add new dedicated tests for the remaining named scenarios (double/triple click at the HTTP layer, provider-accepted-but-response-lost, sync-vs-webhook race, DB-commit-fails-after-provider-ack, duplicate/lost refund) — given the R6-D pricing gate above, there is no real commercial charge path yet to exercise these against meaningfully; building a full 15-scenario suite against the `SIMULATED_DEV`/`SQUARE_SANDBOX` path alone would risk testing something other than what the named scenarios actually describe (real commercial ambiguous-charge handling). This is recorded as a known gap, not fabricated coverage.

Production webhook configuration resolver (§10 of the original directive): also not implemented this pass, for the same reason the original R6 branch gave — an honest Production resolver needs a real merchant ID/notification URL/receiver DB role shape to validate against, which don't exist yet; fabricating placeholders would look activated without being real.

## 9. R5 — real-data admission scope, now enforced with a policy layer (not just documented)

The original R5 branch was audit-only (no code). This pass adds an actual, tested policy layer:

- `planStockImport(rows, variants, prior, catalogRevision, approvedFamilyScope?)` ([packages/core/src/content/stock-import-plan.ts](../../../packages/core/src/content/stock-import-plan.ts)) — new optional parameter; a row whose matched variant's family isn't in the supplied scope gets issue `FAMILY_NOT_IN_APPROVED_SCOPE`. Optional and defaulted to `undefined` (no restriction) — the generic importer is not crippled; every pre-existing test exercising all 7 families via the unscoped call continues to pass unchanged.
- The scope is part of the hashed staged material (`stageStockImport`) — staging the same file under a different scope produces a different `stageSha256`. `commitImportDryRun` **always reuses the scope recorded at stage time** (`stage.plan.approvedFamilyScope`), never a fresh caller-supplied one — there is no parameter through which a commit could widen it.
- `InventoryOperations`'s constructor takes an optional `approvedFamilyScope` (also defaulted to unrestricted, so the existing 500-item/7-family `tests/operations/import-rehearsal.ts` fixture — which exercises the generic importer for infrastructure testing, not specifically real-data admission — needed no rewrite once the restriction moved from "always-on inside `stageImport`" to "constructor-supplied"). `REAL_DATA_APPROVED_FAMILY_SCOPE = ['SKI','SNOWBOARD','SKI_BOOT','SNOWBOARD_BOOT']` is the constant the actual real-data production entry point is expected to construct with.

Tests: [tests/unit/real-data-family-scope.test.ts](../../../tests/unit/real-data-family-scope.test.ts) (5 cases: each approved family passes, each excluded family fails while the generic importer still accepts it unscoped, a mixed batch fails atomically, the digest changes with the scope, commit cannot widen the staged scope) plus one real-PostgreSQL case appended to `tests/operations/import-rehearsal.ts` proving a scope-constructed `InventoryOperations` instance rejects `POLE` end-to-end while the generic instance in the same test admits it freely.

## 10. R3 — hosting composition (the confirmed missing glue) and application role plan

**Confirmed gap, now closed**: `apps/web/src/instrumentation.ts` called `bootstrapProductionRuntime()` but nothing ever called `installProductionBootstrap(input)` first, so Production could never reach `READY` through Vercel env configuration alone, regardless of what was set.

[packages/core/src/guest/production-hosting-composition.ts](../../../packages/core/src/guest/production-hosting-composition.ts) — `installProductionHostingComposition()`, now called from `instrumentation.ts` before `bootstrapProductionRuntime()`, never from a route:
- Explicit activation switch (`ZAO_PRODUCTION_HOSTING_ACTIVATION==='R3_DARK_PRODUCTION_COMPOSITION'`), default OFF (any other/missing value is a no-op, not an error).
- Parses a fixed, exhaustive allowlist of env keys only — no generic env dump anywhere in the file.
- Validates exact Vercel identity (`VERCEL_ENV==='production'`, deployment project/release/origin present) and Neon Production host/database/role bindings for all 11 `productionServices` (reusing `productionConfiguration()`'s own strict parsing — real `.neon.tech` host shape, no owner/admin/superuser-shaped role names).
- Constructs a real `ProductionRuntimeInput` and calls `installProductionBootstrap()` exactly once; a second call anywhere in the process hits that function's own existing duplicate-install guard.
- Composes the **R3 dark profile only**: every business flag (`booking`/`guestRecovery`/`payment`/`media`/`avatar`/`staffOperations`) is hardcoded `false` — there is no env key in the allowlist that could turn any of them on structurally, confirmed by a test that inspects the function's own source.

11/11 unit tests pass ([tests/unit/production-hosting-composition.test.ts](../../../tests/unit/production-hosting-composition.test.ts)), all pure (no PostgreSQL needed, since `active` stays empty with every flag false so `composeProductionRuntime` never opens a connection): missing activation → `NOT_ACTIVATED`; Preview rejected; wrong project/release/origin rejected; wrong/missing DB host/name rejected; a missing role/password for any one of the 11 services rejected; an owner/admin-shaped role name rejected (via `productionConfiguration()`'s own check); malformed signing keys rejected; no secret value ever appears in a thrown error message; **the composition actually reaches `{ready:true, stage:'READY'}` with `PAYMENT_ADAPTER:'OFF'`, `MEDIA:'OFF'`, `NOTIFICATION:'UNCONNECTED'`, `payment:null`, `guest:null`** — the real proof the directive asked for, not just "stays FEATURE_FLAGS"; duplicate installation rejected.

**Production application-role plan** ([scripts/production-app-roles.ts](../../../scripts/production-app-roles.ts)) — reuses (not duplicates) the exact grant lists already proven locally in `scripts/application-roles.ts`/`guest-roles.ts`/`content-roles.ts`/`booking-access-role.ts`/`avatar-read-role.ts`/`operations-roles.ts`, generalized to a real database name, for all 11 `productionServices`. The local scripts guard several grants behind a runtime `to_regclass`/`to_regprocedure` check because a local test cluster may be mid-migration; a real Production database is always bootstrapped with the complete, current migration set, so those grants are included unconditionally here — the condition they tested is always true for a genuine target, not removed. Local proof covers 3 of the 11 roles in full depth (`auth`, `hold`, `booking_access` — chosen to span plain-table grants, column-level grants, and schema-scoped function-only grants) plus one mutation test, in [tests/readiness/production-role-plans.ts](../../../tests/readiness/production-role-plans.ts); the other 8 roles (`ledger`/`transfer`/`pricing`/`recommendation`/`guest`/`content_read`/`avatar_read`/`operations`) have their grant-SQL generated by the identical mechanism but were not individually re-verified against a live role in this pass — a known, disclosed limitation, not a claim of full coverage.

Credential material (real passwords) remains a later, separate, attended provisioning step for every role in every plan — nothing in this integration generates or stores one.

## 11. Runbooks (Phase D/E/J) — corrected

- **Phase D**: now references the final `0040`-only migration count (40) and `GUARD_MIGRATIONS=12` (unchanged), and adds the role-plan application step (backup/payment/app roles, in that order) as the next deliberate step after schema bootstrap — previously not mentioned at all since those scripts didn't exist yet.
- **Phase E**: the "installProductionBootstrap is never called" framing is corrected — it now *is* called, gated by the explicit activation switch and the all-flags-false dark profile (both described above) instead. A new "R3 dark acceptance" section documents the 6 items §14 of the directive required (minimum DB role credentials, hosting activation switch, exact deployment identity, the honest limit of what "DB connection proof" means when `active` is empty, flags-off as a structural guarantee, and rollback via Vercel's existing Instant Rollback).
- **Phase J**: unchanged — its findings (readiness/health boundary, security headers, the `indexingEnabled()` test-only-escape-hatch launch prerequisite) don't depend on migration numbering and remain accurate.

## 12. Local test matrix (this exact branch)

- `npm run test:m2b-bootstrap`: 14/14 PASS (`migrations:40`, `guardsRewritten:12`, structural/security equivalence both PASS).
- `npm run test:unit` (full glob): 731/731 PASS.
- `node --import tsx --test tests/unit/production-payment-admission.test.ts`: 15/15 PASS.
- `node --import tsx --test tests/unit/production-hosting-composition.test.ts`: 11/11 PASS.
- `node --import tsx --test tests/unit/real-data-family-scope.test.ts`: 5/5 PASS.
- `node --import tsx tests/readiness/production-role-plans.ts` (real disposable PostgreSQL, `zao_rental_role_plan_test` — backup role + payment roles + 3-of-11 app roles): 16/16 PASS.
- `node --import tsx --test tests/flow/payment.ts` (real PostgreSQL, existing dev/Sandbox path unchanged): 23/23 PASS.
- `npm run test:m2a-import` (real PostgreSQL, `InventoryOperations` end-to-end incl. the new R5 scope check): 12/12 PASS.
- `node --import tsx tests/operations/inventory.ts`: 8/8 PASS.
- `npm run test:integration` (`scripts/integration.ts` + `scripts/ledger-integration.ts`): 21/21 PASS.
- `npm run lint` / `npm run typecheck`: both PASS, 0 errors/warnings.
- `node scripts/check-secrets.mjs`: PASS, 2323 files, 0 findings.
- Full `npm run verify` (~70-script CI-equivalent suite, including the macOS-only `codex`-CLI-dependent `test:controller:macos`): **not run** this pass, for the same pre-existing environmental reasons already disclosed in the overnight RESULT.md files (no `codex` binary on this Mac; the full battery is also disk-heavy and every directly-relevant test above was independently run and passed instead of relying on that battery). Disk was monitored throughout (see below) and stayed well clear of the `DISK_BLOCKED` floor at every check.

## 13. Mutation tests performed (deliberately broken, dedicated test failed as expected, restored, re-confirmed PASS)

1. Production DB identity binding (`payment-projection.ts`'s `PROJECTION_PRODUCTION_DB_ONLY` floor) — inherited unchanged from R6, re-verified still passes.
2. Production role grant for the context loader — revoking `_pay_truth`'s `claim_production` grant broke it; re-granting restored it.
3. Production/Sandbox environment crossing — `dispatch_production`/`claim_production` hardcode `'PRODUCTION'`; there is no parameter path to pass `'SANDBOX'` (structural, not a runtime toggle — the "mutation" here is attempting the call, which the function signature itself refuses).
4. Merchant boundary — a second merchant's job is provably never swept by `dispatch_production('merchant-1', ...)`.
5. Backup role read grant — revoking `pg_read_all_data` broke every-schema read access; re-granting restored it.
6. Application role grant (`hold`'s `SELECT` on `inventory_holds`) — revoked, broke, restored.
7. `productionProjectionPermit`'s config-validation capability — the adversarial test itself caught a real gap (a hand-built plain object was initially accepted); fixed with the `WeakSet` capability check in §6, then re-confirmed the same adversarial test now fails closed.
8. Hosting-activation gate — every one of the 7 negative-path unit tests in `production-hosting-composition.test.ts` is itself a mutation of the one valid fixture (wrong Vercel env, wrong project/release/origin, wrong DB host/name, missing role/password, forbidden role-name substring, malformed signing key) — each dedicated assertion fails without the specific guard and passes with it.

Not performed as a literal "break the real-inventory four-family gate" mutation beyond what's already in `tests/unit/real-data-family-scope.test.ts` (which directly tests both sides of that boundary by construction rather than via a separate break/restore cycle, since there's no stateful grant to mutate — the scope is a pure function parameter).

## 14. Known environmental limitations (disclosed, not hidden)

- No `pg_dump`/`pg_restore` binary or Docker exists in this sandbox — the backup-role proof targets the SQL privilege boundary instead of the binary (unchanged from the original R4 finding).
- Full `npm run verify` was not run this pass (§12) — the `codex`-CLI-dependent macOS controller test remains a pre-existing gap unrelated to any of this work, and re-running the full disk-heavy battery was judged lower-value than the targeted real-PostgreSQL runs actually performed, all of which passed.
- 8 of the 11 Production application roles have generated grant SQL but were not individually role-tested against a live PostgreSQL instance this pass (§10) — only `auth`/`hold`/`booking_access` were.
- R6-D/R6-E are genuinely incomplete, not just under-tested: there is no real commercial (`SQUARE_PRODUCTION`, `chargeReady:true`) booking path, because the pricing pipeline's `chargeReady:false` is a structural, business-level assertion this integration pass correctly declined to override unilaterally (§7). The Production webhook configuration resolver is similarly deferred (§8), for the same "don't fabricate what would look activated" reason the original R6 branch already gave.
- Phase B (read-only Neon/Vercel Production metadata verification) was not performed in this session.

## 15. Zero-counts

Production SQL executed against any real database: 0. Vercel Production deploys: 0. Real Square API calls: 0. Real payments/refunds: 0. Real inventory imports: 0. DNS/public-launch changes: 0. Age keypairs (real or test) generated: 0. Live/dormant credentials created: 0 (every role in every plan is `NOLOGIN` until an operator separately provisions it, out of band). PRs opened: 0. GitHub Actions consumed: 0.
