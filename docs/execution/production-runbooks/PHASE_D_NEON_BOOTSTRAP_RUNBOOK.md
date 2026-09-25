# Phase D runbook — live Neon Production schema bootstrap

**Status: written, not executed.** No live Neon connection was made while writing this. Every command below is documented for a future, explicitly-authorized Owner session to run — it is not run here.

## What this does

Applies the canonical migration set (`packages/db/src/migration-plan.ts`, `0001`–`0050` as of merged main `2843540` (originally `0001`–`0040` at this integration) — the migration-0040 naming collision between the original PROD-R4/R6/R7 branches is resolved: `0040_production_payment_admission.sql` is the sole canonical `0040`; the R4 backup role and R7 webhook roles were converted to operational role plans, never migrations — see `docs/execution/production-integration/RESULT.md`) to a real, empty Neon Production database, using the existing `bootstrapProductionSchema()` in [scripts/production-bootstrap.ts](../../../scripts/production-bootstrap.ts) — the same mechanism `npm run test:m2b-bootstrap` proves locally against a disposable cluster. This runbook does not add any new code; it documents how to invoke the existing, already-tested function against a real target.

## Official route since PROD-R0.7-C: `bootstrapProductionFoundation()`

For any new Production activation, `bootstrapProductionFoundation(ownerPool, 'neondb')` in
[scripts/production-bootstrap.ts](../../../scripts/production-bootstrap.ts) is the only authorised route.
`bootstrapProductionSchema()` alone is a schema-only primitive: diagnostic/legacy use only, never a new
Production activation. The Owner authorises the `foundationPlanSha256` that `npm run production:activation-plan`
prints (it binds the unchanged schema `planSha256`, `production-role-provisioning/1`, the role provisioning
plan digest, its proof contract and the authority-tagged grants).

In the same single transaction as the schema (`BEGIN` → advisory lock → 0001–0050 with Option D → role
provisioning → Option D cleanup → proofs → `COMMIT`; any failure rolls all of it back):

1. As the owner, create the persistent manager `neondb_role_admin` (NOLOGIN NOSUPERUSER NOCREATEDB CREATEROLE
   NOINHERIT NOREPLICATION NOBYPASSRLS). The owner receives ADMIN automatically; `GRANT … TO SESSION_USER WITH SET
   TRUE, INHERIT FALSE` adds SET. Proven before use: owner→manager ADMIN, SET, no INHERIT.
2. `SET LOCAL ROLE neondb_role_admin`, create the 17 operational roles from the existing generators (backup,
   5 payment, 11 app; all NOLOGIN), `RESET ROLE`. The owner therefore holds no direct membership in any of them
   (measured on real Neon, PROD-R0.7-A/B: a role the owner creates directly leaves it an irrevocable ADMIN row).
3. As the owner, run the OWNER-authority grants (backup, payment, app). Proof: no ACL entry to an operational role
   has a custody role as grantor — while the Option D bridge is still inherited, an owner-issued grant on a
   custody-owned object would otherwise succeed under the executor's authority.
4. `SET LOCAL ROLE neondb_custody_executor` (the Option D bridge still exists), run the single CUSTODY_EXECUTOR
   grant (EXECUTE on `rental_apply_receipt`, `rental_apply_inspection`, `rental_complete_no_pickup`,
   `ops_checkout_amendment`, `ops_reconcile_poles` to `neondb_operations`), `RESET ROLE`. Proof: custody-granted
   entries equal exactly that set. No membership is added.
5. The existing Option D cleanup and proofs, unchanged.
6. Before `COMMIT`: manager exactly as above, no custody membership and cannot SET either custody role; the 17
   roles NOLOGIN/NOSUPERUSER/NOCREATEDB/NOCREATEROLE/NOREPLICATION/NOBYPASSRLS with INHERIT only for
   `neondb_backup`; manager→each role ADMIN only (no INHERIT, no SET), no other members; the only operational
   membership is `neondb_backup IN pg_read_all_data`; `neondb_operations` has EXECUTE on the five custody functions.

No LOGIN, password or credential is created. Each role's LOGIN is a later, separately Owner-approved step taken
through `SET ROLE neondb_role_admin`. Proven locally by `tests/operations/production-foundation.ts`
(`npm run test:production-foundation`, also part of `test:m2b-bootstrap`): fault injection at six stages, three
mutations, schema delta equal to `migrate()`, and an identical foundation security delta on two provider baselines.

The Production database already bootstrapped with `bootstrapProductionSchema()` (Phase B, pre-write evidence
2026-09-24 22:17:53.72769+00, LSN 0/1BB75A8) is not empty, so this route refuses it; how to reach the foundation
state there is a separate TD/Owner decision. No restore, PITR or branch operation is implied by this section.

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

There is currently no permanent CLI wrapper around `bootstrapProductionFoundation` (or the legacy schema-only `bootstrapProductionSchema`) — it's only ever called from the test suite today. Do not add one as part of running this; a one-off invocation is safer and leaves no permanent script pointing at Production. From the repository root, with `pg` already a dependency:

```bash
node --import tsx -e "
import {Pool} from 'pg';
import {bootstrapProductionFoundation} from './scripts/production-bootstrap.ts';
const pool = new Pool({
  host: process.env.PGHOST, port: Number(process.env.PGPORT ?? 5432),
  database: process.env.PGDATABASE, user: process.env.PGUSER, password: process.env.PGPASSWORD,
  ssl: { rejectUnauthorized: true, ca: (await import('node:fs')).readFileSync(process.env.PGSSLROOTCERT ?? '/etc/ssl/certs/ca-certificates.crt', 'utf8') },
});
try {
  const result = await bootstrapProductionFoundation(pool, process.env.PGDATABASE);
  console.log(JSON.stringify(result, null, 2));
} finally { await pool.end(); }
"
```

Set `PGHOST`/`PGPORT`/`PGDATABASE`/`PGUSER`/`PGPASSWORD`/`PGSSLROOTCERT` in the shell environment immediately before running this, from a source only the Owner controls (never committed, never pasted into chat/logs) — the same operational discipline already established for the R2B backup credential.

## Expected result and what to verify after

`bootstrapProductionFoundation` returns the schema result `{applied, guardsRewritten, target, transformerVersion, planSha256, manifestSha256, provenance}` plus `roleProvisioning` and `foundationPlanSha256`. Compare `guardsRewritten` against the current `GUARD_MIGRATIONS` constant in `scripts/production-bootstrap.ts` at the time this actually runs (**12**, unchanged by this integration — none of migration `0040`'s functions carry a `zr_*` dev-safety guard, so it added no new guarded migration) — a mismatch means the manifest and code have drifted and the run would already have thrown before reaching this point, so this is really a sanity check on the returned value matching what you expect, not a live risk.

After a successful run, before treating the database as ready for any other Production activity:
1. **Verify by pre/post delta equivalence, not absolute equality.** A managed Neon owner and a local cluster owner have different role postures, which `securityFingerprint()` rightly includes (its role closure starts at `current_user`), so an absolute Production-vs-local comparison fails for reasons unrelated to the bootstrap. Instead compare `fingerprintDelta(before, after)` of Production with that of a fresh local canonical database, for both `schemaFingerprint()` and `securityFingerprint()`, every category, and require `deltaMismatch(...)` to be empty. Provider baseline rows cancel out only if unchanged; any change on either side stays visible (proved by `tests/operations/production-bootstrap-delta.ts`). Sequence: (1) Production PRE schema fingerprint, (2) Production PRE security fingerprint, (3) `migrationOwnerPosture()` recorded as separate evidence, (4) local empty PRE fingerprints, (5) local `migrate()`, (6) local POST fingerprints, (7) canonical deltas fixed, (8) `bootstrapProductionSchema()`, (9) Production POST fingerprints, (10) Production deltas, (11) delta equivalence, (12) registry checks, (13) STOP.
2. Confirm `SELECT count(*) FROM foundation_migrations` equals the migration count you expect (50; `npm run production:activation-plan` prints the exact current count).
3. **Role plans are already applied by the foundation route** (NOLOGIN, inside the same transaction; see the section above). Superseded for new activations: applying `productionBackupRoleSql()`, `productionPaymentRoleCreateSql()`/`productionPaymentActivationGrants()` and `productionAppRoleCreateSql()`/`productionAppRoleGrantSql()` separately as the owner leaves it an ADMIN membership in every role and cannot grant the five custody-owned functions (PROD-R0.7-A). LOGIN/password for any role stays a separately Owner-approved step through `neondb_role_admin`.

## What this explicitly does NOT do

No Square/payment/webhook LOGIN credential is created or activated by this step. No real customer data is written. No Vercel deploy is triggered by this (see the companion Phase E runbook — the two are independent; this can run before or after Phase E). No DNS/public launch changes.

## Non-superuser owner compatibility (production-owner-compat/2, EPHEMERAL_ROLE_CREATOR)

Neon's `neondb_owner` is a CREATEROLE non-superuser. Under PostgreSQL 16+/18 a role it creates would leave it an
irrevocable ADMIN member, and ownership transfers need SET on the new owner plus CREATE on the target schema. The
Production bootstrap (never `migrate()`, never the migration files) therefore, inside the single transaction:
creates a NOLOGIN CREATEROLE `zao_boot_<16 hex>` role (derived from target, compatibility version and source-manifest
digest; refused if it already exists), runs only the pinned 0015 role-creation block as that role, bridges
`<db>_custody_executor` to the session with SET/INHERIT (grantor = the ephemeral role), grants the executor temporary
CREATE on `public` only, runs 0001–0050, revokes that grant and the bridge, proves the ephemeral role owns and is
granted nothing, drops it, and before COMMIT proves: ephemeral role absent, no owner membership in either custody
role, no dangling membership, executor CREATE on `public` false, and executor CREATE on the database false (never
granted). Any deviation rolls back.
Observed runtime contract (PostgreSQL 18.4, matching REL_18_STABLE source): `ALTER SCHEMA … OWNER TO` checks database
CREATE against the invoking/current user, not the destination owner, so the executor needs no database CREATE; the
PostgreSQL documentation describes the new owner's database CREATE, which does not match this runtime. `ALTER FUNCTION
… OWNER TO` does require the new owner to hold CREATE on the function's schema. Re-verify on any major-version change.
The 0015 anchor (role-block end, role-block SHA-256, first `OWNER TO` offset) is pinned in
`config/production/bootstrap-source-manifest.json`; the wrapper, bridge, cleanup and proof contract are bound into
`planSha256`. `createrole_self_grant` is not relied on. Proven locally by `tests/operations/production-bootstrap-owner-compat.ts`
(E1–E6, M1–M8; M4 is the PG18 compatibility proof that no database CREATE is required or granted).

Table/column grant categories of `securityFingerprint()` are rebuilt from the catalog with PostgreSQL 18's own
`information_schema` semantics minus the current-viewer filter, so the Production (non-superuser) and local
(superuser) fingerprints are comparable; `publicTableGrants` now includes real PUBLIC table grants.
