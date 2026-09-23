# Phase D runbook — live Neon Production schema bootstrap

**Status: written, not executed.** No live Neon connection was made while writing this. Every command below is documented for a future, explicitly-authorized Owner session to run — it is not run here.

## What this does

Applies the canonical migration set (`packages/db/src/migration-plan.ts`, `0001`–`0050` as of merged main `2843540` (originally `0001`–`0040` at this integration) — the migration-0040 naming collision between the original PROD-R4/R6/R7 branches is resolved: `0040_production_payment_admission.sql` is the sole canonical `0040`; the R4 backup role and R7 webhook roles were converted to operational role plans, never migrations — see `docs/execution/production-integration/RESULT.md`) to a real, empty Neon Production database, using the existing `bootstrapProductionSchema()` in [scripts/production-bootstrap.ts](../../../scripts/production-bootstrap.ts) — the same mechanism `npm run test:m2b-bootstrap` proves locally against a disposable cluster. This runbook does not add any new code; it documents how to invoke the existing, already-tested function against a real target.

## Preconditions (verify all of these before connecting to anything real)

1. **A real Neon Production database/branch already exists** and is empty (no tables, views, or materialized views outside `pg_catalog`/`information_schema` — `bootstrapProductionSchema` checks this itself and refuses with `PRODUCTION_DATABASE_NOT_EMPTY` if not, but confirm this is the intended fresh target before connecting at all).
2. **You know the real database name** (the `target` argument). It must match `IDENTIFIER = /^[a-z][a-z0-9_]{2,62}$/` and must **not** match the disposable `zr_[a-f0-9]{12}` pattern — `assertProductionTarget()` enforces this, but confirm by inspection first; a mistaken disposable-shaped name would simply fail closed, not connect to the wrong database.
3. **Host identity confirmation** — this bootstrap path (unlike the R2B backup mechanism) has no built-in host-fingerprint check, because it's invoked with a caller-supplied `Pool`, not through the backup CLI's env-var pipeline. Before connecting, independently compute `sha256(lowercase(trim(PGHOST)))` and compare it by eye against the value you separately know is the real Production Neon endpoint — do **not** trust an env var alone. (R2B's backup mechanism pins this as `EXPECTED_PRODUCTION_HOST_FINGERPRINT_SHA256 = '7ad9939654fde65fa8bf8c4c043e33ca9053036d2137cf7616d365a11876c3fc'` in [scripts/production-backup.ts](../../../scripts/production-backup.ts) — if this is the same Production database R2B backs up, that same fingerprint should match.)
4. **TLS**: connect with `sslmode=verify-full` and a real CA root (R2B uses `/etc/ssl/certs/ca-certificates.crt` on its pinned `postgres:18` runner — use the equivalent trusted root for whatever machine actually runs this).
5. **Nobody else is mid-migration** — this is a one-time bootstrap of an empty database; there is no concurrent-writer scenario to worry about beyond the advisory lock (`pg_advisory_xact_lock(71820401)`) the function itself takes.
6. **A rollback plan exists** — since this runs inside one transaction (`BEGIN`/`COMMIT`/`ROLLBACK` on any error), a failure partway through leaves the database exactly as empty as before. No manual rollback procedure is needed for a failed attempt; only a *successful* bootstrap that later needs to be undone would require `DROP SCHEMA public CASCADE` (and every other created schema) — which is destructive and must be its own separately-authorized decision, not assumed here.

## Recorded plan before any write (added by production-activation-readiness)

Run `npm run production:activation-plan` from the exact release commit first. It is no-write (no DB,
provider or network access; credential names only) and prints the canonical migration count, bootstrap
`planSha256`/`sourceManifestSha256`, role names and SQL digests, the pinned host fingerprint to compare
against, and a `planDigestSha256`. The attended authorization should name that digest; the bootstrap
result's `planSha256`/`manifestSha256` must equal the plan's.

## Exact invocation

There is currently no permanent CLI wrapper around `bootstrapProductionSchema` — it's only ever called from the test suite today. Do not add one as part of running this; a one-off invocation is safer and leaves no permanent script pointing at Production. From the repository root, with `pg` already a dependency:

```bash
node --import tsx -e "
import {Pool} from 'pg';
import {bootstrapProductionSchema} from './scripts/production-bootstrap.ts';
const pool = new Pool({
  host: process.env.PGHOST, port: Number(process.env.PGPORT ?? 5432),
  database: process.env.PGDATABASE, user: process.env.PGUSER, password: process.env.PGPASSWORD,
  ssl: { rejectUnauthorized: true, ca: (await import('node:fs')).readFileSync(process.env.PGSSLROOTCERT ?? '/etc/ssl/certs/ca-certificates.crt', 'utf8') },
});
try {
  const result = await bootstrapProductionSchema(pool, process.env.PGDATABASE);
  console.log(JSON.stringify(result, null, 2));
} finally { await pool.end(); }
"
```

Set `PGHOST`/`PGPORT`/`PGDATABASE`/`PGUSER`/`PGPASSWORD`/`PGSSLROOTCERT` in the shell environment immediately before running this, from a source only the Owner controls (never committed, never pasted into chat/logs) — the same operational discipline already established for the R2B backup credential.

## Expected result and what to verify after

`bootstrapProductionSchema` returns `{applied, guardsRewritten, target, transformerVersion, planSha256, manifestSha256, provenance}`. Compare `guardsRewritten` against the current `GUARD_MIGRATIONS` constant in `scripts/production-bootstrap.ts` at the time this actually runs (**12**, unchanged by this integration — none of migration `0040`'s functions carry a `zr_*` dev-safety guard, so it added no new guarded migration) — a mismatch means the manifest and code have drifted and the run would already have thrown before reaching this point, so this is really a sanity check on the returned value matching what you expect, not a live risk.

After a successful run, before treating the database as ready for any other Production activity:
1. **Verify by pre/post delta equivalence, not absolute equality.** A managed Neon owner and a local cluster owner have different role postures, which `securityFingerprint()` rightly includes (its role closure starts at `current_user`), so an absolute Production-vs-local comparison fails for reasons unrelated to the bootstrap. Instead compare `fingerprintDelta(before, after)` of Production with that of a fresh local canonical database, for both `schemaFingerprint()` and `securityFingerprint()`, every category, and require `deltaMismatch(...)` to be empty. Provider baseline rows cancel out only if unchanged; any change on either side stays visible (proved by `tests/operations/production-bootstrap-delta.ts`). Sequence: (1) Production PRE schema fingerprint, (2) Production PRE security fingerprint, (3) `migrationOwnerPosture()` recorded as separate evidence, (4) local empty PRE fingerprints, (5) local `migrate()`, (6) local POST fingerprints, (7) canonical deltas fixed, (8) `bootstrapProductionSchema()`, (9) Production POST fingerprints, (10) Production deltas, (11) delta equivalence, (12) registry checks, (13) STOP.
2. Confirm `SELECT count(*) FROM foundation_migrations` equals the migration count you expect (50; `npm run production:activation-plan` prints the exact current count).
3. **Then apply the role plans** — this is the next deliberate step, still entirely operator-run, still no LOGIN credential created automatically: `productionBackupRoleSql()` ([scripts/production-backup-role.ts](../../../scripts/production-backup-role.ts)), `productionPaymentRoleCreateSql()`/`productionPaymentActivationGrants()` ([scripts/production-payment-roles.ts](../../../scripts/production-payment-roles.ts)), and `productionAppRoleCreateSql()`/`productionAppRoleGrantSql()` ([scripts/production-app-roles.ts](../../../scripts/production-app-roles.ts)) each return plain SQL statement arrays for the real database name — run them against the same target, in that order, then separately `ALTER ROLE ... LOGIN PASSWORD ...` each one only when its credential is actually needed (see `docs/execution/production-integration/RESULT.md` for the full role inventory and what each one can and cannot do).

## What this explicitly does NOT do

No Square/payment/webhook LOGIN credential is created or activated by this step. No real customer data is written. No Vercel deploy is triggered by this (see the companion Phase E runbook — the two are independent; this can run before or after Phase E). No DNS/public launch changes.

## Known blocker before execution (production-bootstrap-delta-verification)

A local rehearsal with a Neon-shaped owner (non-superuser, `CREATEDB CREATEROLE`, member of a provider role)
shows the canonical migrations currently require superuser: `bootstrapProductionSchema()` is rejected with
SQLSTATE 42501 at `ALTER SCHEMA rental_internal OWNER TO <db>_custody_executor` ("must be able to SET ROLE"),
and with `createrole_self_grant='set, inherit'` the next failure is `ALTER FUNCTION … OWNER TO <db>_custody_executor`
("permission denied for schema public"). The transaction rolls back completely (no objects, no roles). Neon's
`neondb_owner` is not a superuser, so Phase B should not be attempted until this is dispositioned.
