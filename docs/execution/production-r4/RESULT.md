# PROD-R4 — backup-role SQL, local proof, and age-identity custody analysis (code-only, inert)

Base: `main` `72628ba0e06ef1518e45b7178a577dc484adb9f2` (PROD-R2B accepted/merged HEAD). Branch `claude/prod-r4-backup-role`. Worktree `work/prod-r4-backup-role`. No PR opened — same Actions-budget-conservation discipline as PROD-R6.

## Scope

R2B's `production-backup.ts` takes whatever `PGUSER`/`PGPASSWORD` it's given via secrets — it has no opinion on what privileges that credential should actually hold. R4's job is to design, and locally prove, the least-privilege database role a real Production backup credential should be, and separately analyze (without creating one) how the matching age decryption private key should be held.

## What this adds

- [packages/db/migrations/0040_production_backup_role.sql](../../../packages/db/migrations/0040_production_backup_role.sql) — additive migration creating `<database>_backup`: `NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOREPLICATION NOBYPASSRLS`, granted `CONNECT ON DATABASE` and membership in the built-in `pg_read_all_data` role. `INHERIT` (not the `NOINHERIT` used by `_custody_executor`/`_custody` in migration `0015`) is deliberate: those roles are only ever used via `SET ROLE` from an app-level LOGIN identity for one narrow operation; a backup role is instead meant to be the direct LOGIN identity for the whole `pg_dump` session, so its `pg_read_all_data` membership must be automatically active on connection. `pg_read_all_data` (built into Postgres since v14) grants `USAGE`+`SELECT` on every table/view/sequence in every current and *future* schema in one grant — unlike `_custody_executor`'s curated per-table list, a backup role must survive schema evolution without a new migration every time a table is added, so an enumerated list would be the wrong tool here.
- The role is created `NOLOGIN` — inert, no password, not a live credential. It only becomes usable when an operator separately runs `ALTER ROLE <database>_backup LOGIN PASSWORD '...'` directly against the real database, exactly mirroring how this codebase already handles every other connection-identity credential (see "Why no automatic bootstrap-manifest guard" and "Precedent" below) — never scripted, never in git.
- Registered in the Production-bootstrap guard-rewrite mechanism, since (unlike `_pay_projection`) this role is a structural concern that must exist identically in every environment: `scripts/production-bootstrap.ts`'s `GUARDED` map gained `'0040':'current_database()'`, `GUARD_MIGRATIONS` became `13` (was `12`), and `config/production/bootstrap-source-manifest.json` gained migration `0040`'s entry with its guard's exact structurally-located offset/fragment (computed via the project's own `locateMigrationGuard`, not hand-counted). `tests/operations/production-bootstrap.ts`'s own `GUARDED` list was updated to match — confirmed via `npm run test:m2b-bootstrap`: 14/14 PASS, `migrations:40`, `guardsRewritten:13`, `STRUCTURAL_EQUIVALENCE`/`SECURITY_EQUIVALENCE` both PASS (the bootstrap-rewritten Production-shaped database's schema and privileges, including this new role and its grants, are byte-for-byte equivalent to the canonically-migrated reference).
- [scripts/backup-roles.ts](../../../scripts/backup-roles.ts) (new) — `provisionBackupRole(owner, identity)`, matching the established `scripts/custody-roles.ts`/`scripts/flow-roles.ts` convention exactly: for a disposable `zr_[a-f0-9]{12}` test database only, flips the migration-created NOLOGIN role into LOGIN with a fresh random local-only password and returns a connected pool. It grants nothing itself — migration `0040` already did that — it only provisions a throwaway local credential for tests, the same pattern this codebase already uses everywhere else for role-scoped local testing.
- [tests/readiness/production-backup-role.ts](../../../tests/readiness/production-backup-role.ts) (new, `npm run test:production-backup-role`, wired into `scripts/verify.mjs`) — 4 cases against a real local PostgreSQL cluster: role-attribute proof via `pg_roles` (`rolcanlogin/rolinherit/rolsuper/rolcreatedb/rolcreaterole/rolreplication/rolbypassrls`), a representative `SELECT` across every schema (`public`, `rental_internal`, `booking_access`, `square_webhook`, `payment_reconciliation`, `payment_projection`, `r15_activation`), a write/DDL/role-creation denial proof (`UPDATE`/`DELETE`/`CREATE TABLE`/`CREATE ROLE` all rejected `42501`), and a **mutation test**: revoking `pg_read_all_data` makes every schema unreadable again (proving the grant is load-bearing, not vacuous), then re-granting restores read access. All 4 PASS.

## Why no real `pg_dump` invocation (disclosed gap, not hidden)

This sandbox has no ambient `pg_dump`/`pg_restore` binary (`which pg_dump` → not found) and no Docker (`which docker` → not found) — the same environmental gap R2B's F3 already disclosed and worked around in CI only, via a pinned `postgres:18` container image unavailable here. `embedded-postgres`'s bundled binary set (checked directly under `node_modules/@embedded-postgres/darwin-arm64/native/bin/`) contains only `initdb`/`postgres`/`pg_ctl` — no dump/restore tools. Rather than fabricate a fake pass or skip the proof silently, this local proof instead verifies the exact SQL-level privilege boundary `pg_dump` actually depends on — a connecting role can `SELECT` everything it will dump and nothing else — directly, which is a complete substitute for what `pg_dump` itself would exercise at the database layer. The one thing not proven here is `pg_dump`'s own client-side behavior (its catalog-walking logic, dump format, etc.), which R2B's F3 already covers with the real binary in CI.

## Age-identity custody analysis — flagged, not resolved

`scripts/production-backup.ts` only ever reads `AGE_BACKUP_RECIPIENT` — the **public** recipient string, used solely to encrypt. There is no age **private** identity anywhere in this codebase, and there should not be: if the private key were reachable from any automated system (GitHub Actions, Vercel, the running app), a compromise of any of those would let an attacker decrypt every historical backup, defeating the entire point of asymmetric encryption here. This is confirmed correct as designed, not a gap.

The private identity's custody is therefore an organizational question, not a code one — and generating the real keypair myself would itself create exactly the "live/dormant credential" this task was told not to create (I would momentarily hold real private key material). So this is analysis and a recommendation only, explicitly **not executed**:

- Generate the keypair once, offline, on a machine the Owner controls directly (official `age-keygen`, matching the tool already vendored/verified in R2B-F2) — never inside any CI runner, container, or agent session.
- The private identity (`AGE-SECRET-KEY-1...`) should be stored in at least two independent, human-controlled locations that do not share a single failure mode — e.g. a password manager entry the Owner controls, plus one offline copy (printed, or on encrypted removable media in a safe) — so losing one device doesn't mean losing the ability to ever restore a backup.
- It must never be placed in `GITHUB_SECRET`/Vercel env/any location `production-backup.yml` or the running app can read — decryption is strictly a human, disaster-recovery-time action, never part of the automated backup pipeline.
- Only the derived **public** recipient string goes into `AGE_BACKUP_RECIPIENT` (already the only thing the code touches).

Flag: `R4_BLOCKED_ON_OWNER_CONTROLLED_AGE_IDENTITY_CUSTODY`. This is the deliberately correct outcome, not a failure — the same way PROD-R6's Phase D/E exclusion was deliberate. No age keypair of any kind was generated in this session.

## Verification

- `npm run test:m2b-bootstrap`: 14/14 PASS (`migrations:40`, `guardsRewritten:13`).
- `npm run test:production-backup-role`: 4/4 PASS, including the mutation test.
- `npm run test:unit` (full glob): 700/700 PASS.
- `npm run lint` (`eslint . --max-warnings=0`): PASS, 0 warnings/errors.
- `npm run typecheck`: PASS, 0 errors.
- `node scripts/check-secrets.mjs`: PASS, 2314 files scanned, 0 findings.
- `npm run test:integration`: PASS (`scripts/integration.ts` + `scripts/ledger-integration.ts`, 21 cases).
- Three pre-existing hardcoded migration-count snapshots — the same class already found and fixed independently on the PROD-R6 branch — were hit again here (this branch forked from `main` before that fix existed) and fixed the same way: `tests/unit/payment-activation.test.ts` (39→40), `scripts/integration.ts` and `scripts/ledger-integration.ts` (both appended `{id:'0040'}`).
- Full `npm run verify` (~70 scripts) not attempted on this branch — same disk/tooling environment already exercised for PROD-R6; not repeated here to avoid redundant disk churn given every directly-relevant test above already passed cleanly.

## Zero-counts

Real Square API calls: 0. Real payments: 0. Live Neon/Vercel Production connections: 0. Age keypairs generated (test-disposable or real): 0. Production secrets read or referenced: 0. PRs opened: 0. Existing migrations/guards/tests modified beyond the ones mechanically required by adding migration `0040` as a 13th guarded migration: 0.
