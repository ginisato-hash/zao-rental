# Repository-wide classification of the local-database coupling

Every reference to `current_database()`, the `zr_<12hex>` pattern, `foundation_metadata`,
`telemetry_events`, `seed()` and database-derived role names, classified by what it does and
what it means for Production. Enumerated from the repository, not from memory.

## A — persisted schema constraints (2)

Both carry a `^zr_[a-f0-9]{12}$` check on an identity column, but they are **not the same kind
of artifact** and must not be classified together. `0030_r15_operation_guard` is not a
foundation artifact.

### A1 — development foundation artifacts

| where | constraint |
| --- | --- |
| `0001_foundation` | `foundation_metadata.namespace PRIMARY KEY CHECK (namespace ~ '^zr_[a-f0-9]{12}$')`, referenced by `telemetry_events.namespace` |

**Decision: created in Production but left empty; no fake `zr_` namespace is inserted.**

The evidence is that nothing in the application writes them. `seed()` and `recordTelemetry()`
are exported from `packages/db/src/index.ts` and called only by `scripts/development-app.ts`,
`scripts/integration.ts`, `scripts/ledger-integration.ts`, `tests/flow/launcher.ts` and the
readiness tests. No route, service or runtime module in `apps/web` or `packages/core` calls
either. `foundation_metadata` and `telemetry_events` appear outside the migrations only as
Drizzle table definitions in `packages/db/src/schema.ts`.

So the tables are created by the bootstrap, stay empty in Production, and their `^zr_` checks
are never exercised. If Production telemetry is wanted later it needs a successor with its own
identity column, which is a separate decision, not a bootstrap workaround.

### A2 — historical sandbox activation artifacts

| where | constraint |
| --- | --- |
| `0030_r15_operation_guard` | `r15_activation.manifest` and `r15_activation.operations`, with a `database_name` column under the same check |

`0030` belongs explicitly to the **finite R15 Square Sandbox acceptance**, which is closed
history. It is not a foundation artifact and it is not a general activation mechanism.

**Decision: created in Production but left empty and inactive, and never used as a Production
activation mechanism.** Any Production payment activation needs its own gate; reusing the R15
Sandbox manifest for it is prohibited.

Emptiness of both A1 and A2 is asserted, not assumed: `approvalRegistryRows()` counts
`foundation_metadata`, `telemetry_events`, `r15_activation.manifest` and
`r15_activation.operations` in the bootstrapped database and the test requires 0 for each.

## B — migration-time guards (12)

`0015`, `0016`, `0017`, `0018`, `0019`, `0033`, `0034`, `0035`, `0036`, `0037`, `0038`, `0039`
raise at DDL time unless the database matches `^zr_[a-f0-9]{12}$`.

Handled by the bootstrap, which rewrites **only the identity test** inside the twelve
top-level `DO $$…END$$;` blocks so it demands the exact approved target database instead of
the disposable pattern. Everything else in those blocks is preserved — `0016` also asserts
function ownership and `0017` asserts the custody executor role exists, and both survive
untouched. `0028` and `0029` are compared byte-for-byte before and after rewriting.

The rewrite passes two independent gates: a committed approved-source manifest pinning all
thirty-nine reviewed digests and each guard's byte offset, and a SQL scanner that requires the
guard to sit at an identifier boundary inside the body of a top-level `DO` statement, in code
context. An earlier version inferred "top level" from a line-start regular expression, which
accepted guards hidden in comments, strings and dynamic SQL; see
[PRODUCTION_BOOTSTRAP_PROVENANCE.md](PRODUCTION_BOOTSTRAP_PROVENANCE.md).

## C — role names derived from the database name

`current_database()||'_custody_executor'` appears in `0015`, `0016`, `0017` and `0033`, and
`payment-projection.ts` expects `current_database()+'_pay_projection'`.

In a database called `zao_rental_production` these derive `zao_rental_production_custody_executor`
and so on. That is coherent, and it means **no local role name is copied to Production**: the
names follow the Production database's own identity. The schema fingerprint normalises the
database name so the two environments still compare equal.

## D — application-layer guards (1, newly found)

`packages/db/src/payment-projection.ts` refuses unless `current_database()` matches
`^zr_[a-f0-9]{12}$` **and** the connected role equals `<database>_pay_projection`. This is a
TypeScript guard, not SQL, so no schema work can clear it.

Together with the SQL runtime guards in `0028` (`payment_projection.lock_source`) and `0029`
(`payment_reconciliation.claim_target`, `payment_reconciliation.dispatch_target`), the payment
projection and reconciliation subsystem is development-only by construction at every layer.

**Recorded as `PAYMENT_PROJECTION_PRODUCTION_BLOCKER`** — see
[PAYMENT_PROJECTION_PRODUCTION_BLOCKER.md](PAYMENT_PROJECTION_PRODUCTION_BLOCKER.md). It does
not block the Production bootstrap, the dark Vercel deployment, Square Production identity
verification or webhook configuration. It does block real Production payment projection and
reconciliation, and the controlled real payment gate. It is deliberately **not fixed in this
bootstrap scope**; it is carried into the next pre-payment implementation and review gate.

## Other references, not blocking

- `packages/auth/src/config.ts` requires `^zr_` for the **development** configuration only; the
  Production configuration is a separate, stricter parser.
- `packages/auth/src/hosted-preview-config.ts` pins `zr_852b20c4d4b0`, a historical Phase6
  preview constant.
- `packages/core/src/payment/r15-projection-authority.ts` pins the preview Vercel project id
  and is preview-scoped.
- `apps/webhook-ingress/src/config.ts` already requires a `*.neon.tech` host on port 5432,
  which is Production-shaped and needs no change.

## Summary

| category | count | cleared by the bootstrap? |
| --- | --- | --- |
| A1 development foundation artifacts | 1 (2 tables) | not needed — created, left empty, asserted 0 rows |
| A2 historical R15 sandbox activation artifacts | 1 (2 tables) | not needed — created, left empty and inactive, asserted 0 rows |
| B migration-time guards | 12 | yes, by moving the identity test to the approved target |
| C derived role names | 5 sites | yes, they follow the Production database name |
| D application-layer guards | 1 + 3 SQL functions | **no** — `PAYMENT_PROJECTION_PRODUCTION_BLOCKER`, carried forward |
