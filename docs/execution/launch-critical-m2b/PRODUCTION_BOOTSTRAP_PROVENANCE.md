# Production bootstrap: transformation provenance

Transformer `production-bootstrap/3`. Supersedes `/2`, which the independent review of
`38e6e40` found would accept guards it should have refused.

## Two independent gates

A guard is rewritten only if **both** gates agree. Either refuses on its own, and the test
exercises each separately so neither can be carried by the other.

### Gate 1 — approved source

`config/production/bootstrap-source-manifest.json` pins, for each of the thirty-nine reviewed
migrations: its id, file, SHA256, runtime-guard count, and — where one exists — the exact byte
`offset`, `subject` and `fragment` of the single guard that may be rewritten.

It is **committed data, loaded and never recomputed**. Computing a digest from whatever is on
disk records provenance but proves nothing about approval, which is the distinction the review
drew. Re-pinning the manifest is therefore a visible change to reviewed source, reviewed as
such; there is deliberately no tool in the repository that re-pins it automatically. A test
asserts every pinned digest still matches its file and every pinned offset still holds its
pinned fragment, so drift shows up as a failure rather than as a silent re-pin.

Refusals: `PRODUCTION_SOURCE_UNKNOWN_MIGRATION`, `PRODUCTION_SOURCE_NOT_APPROVED`,
`PRODUCTION_MANIFEST_LENGTH_MISMATCH`, `PRODUCTION_MANIFEST_FILE_MISMATCH`,
`PRODUCTION_MANIFEST_RUNTIME_GUARD_MISMATCH`, `PRODUCTION_GUARD_PIN_MISMATCH`.

### Gate 2 — structure

`locateMigrationGuard()` finds the guard using a SQL scanner that honours line comments,
nestable block comments, single-quoted strings, quoted identifiers and dollar quoting. The
guard must be:

1. the exact literal fragment `<subject> !~ '^zr_[a-f0-9]{12}$'`, with `<subject>` pinned per
   migration (`0015` guards the variable `n`; the other eleven call `current_database()`);
2. present exactly once, at an **identifier boundary**, so `n` never matches the tail of
   `tenant_n`;
3. inside the dollar-quoted body of a **top-level `DO` statement** — determined by scanning
   statements, not by a line-start regular expression;
4. in **code** context within that body, not inside a comment or a nested literal.

Refusals: `PRODUCTION_GUARD_SHAPE_UNEXPECTED`, `PRODUCTION_GUARD_FRAGMENT_UNEXPECTED`,
`PRODUCTION_GUARD_NOT_MIGRATION_TIME`, `PRODUCTION_GUARD_NOT_CODE`,
`PRODUCTION_GUARD_COLLATERAL_CHANGE`, `PRODUCTION_GUARD_RESIDUAL`,
`PRODUCTION_GUARD_COUNT_UNEXPECTED`.

### What the previous transformer accepted

Reproduced against `38e6e40` before the fix; all four were accepted and rewritten. All are now
refused by Gate 2 on structure alone and by Gate 1 on bytes.

| input | `/2` | `/3` structural refusal |
| --- | --- | --- |
| guard inside a block comment | accepted | `NOT_MIGRATION_TIME` |
| guard inside a dollar-quoted string | accepted | `NOT_MIGRATION_TIME` |
| guard inside dynamic SQL in a function | accepted | `NOT_MIGRATION_TIME` |
| `0015` subject renamed `n` → `tenant_n` | accepted | `FRAGMENT_UNEXPECTED` |
| guard commented out inside a `DO` body | — | `NOT_CODE` |

The six earlier negative controls (guard removed, second guard added, wrong subject, unguarded
migration gains a guard, runtime-guard count drift, unknown id) still refuse.

## The checksum distinction

`foundation_migrations.checksum` is the **CANONICAL SOURCE MIGRATION CHECKSUM** — the SHA256 of
the reviewed file on disk. For the twelve rewritten migrations it is deliberately *not* the
checksum of the bytes executed. That is what lets a Production registry and a local registry be
compared directly, and what `migrate()` checks when deciding a migration is already applied.

The executed bytes are recorded separately as `transformedSha256`. Nothing infers one from the
other. Each provenance record carries `id`, `canonicalSha256`, `approvedSha256` (the pinned
value, which must equal the canonical one), `transformerVersion`, `transformation`,
`transformedSha256` and `target`; the plan carries `manifestSha256` and `planSha256`. The test
asserts the serialised provenance contains nothing outside identifiers and digests.

## Rehearsal record

Target `zao_rental_production_test`, transformation class
`MIGRATION_TIME_DATABASE_IDENTITY_PREDICATE`, 12 of 39 migrations transformed.

- `manifestSha256` = `4c1fb5b51f2fa16e12d7368d0c84d562016c1ed04d39a0e13a1660fc7355df6c`
- `planSha256` = `a889a4d4d70ad213f3ea0a7d73930f6feeb380d812fbe6d3231ecbe690184f40`
- schema fingerprint = `b3c045839c94a1c1f4b1f384c7fa994911cf1facf561829c3ec48b596f1b57fa`

| migration | canonical sha256 | transformed sha256 |
| --- | --- | --- |
| `0015` | `f4885fade5b753e9…` | `1b28d833bbfdfd15…` |
| `0016` | `177f50e10a653ff1…` | `4682d3f50b7e56fb…` |
| `0017` | `a85917af78ced36e…` | `021a432ef4e4488f…` |
| `0018` | `b3d1c1c28b4536c5…` | `f851bdf777e1edf4…` |
| `0019` | `45d39bbc3f9e9795…` | `114efd3305215907…` |
| `0033` | `37bbb6edd26ba41c…` | `70810cd8aab2c8cc…` |
| `0034` | `2984df43162b9ae2…` | `47fc7fdd878e5451…` |
| `0035` | `8999c98b29118873…` | `970185ea482c05bc…` |
| `0036` | `b7c3726b530e7438…` | `dc8b38b888e02f2c…` |
| `0037` | `c3a9908e39512d84…` | `d34533ea253983fc…` |
| `0038` | `6206807d6748dfe3…` | `6e2f9e8d77027e60…` |
| `0039` | `ebac5b4ab802827b…` | `fc1e5f2b83a2c356…` |

`planSha256` and every `transformedSha256` are bound to the target. The real Production target
has not been named, so its plan produces different digests, recorded at bootstrap time from the
run's own return value rather than copied from here.

## SECURITY_EQUIVALENCE: what is compared, and proof that it detects

Compared between the canonical local database and the bootstrapped one: derived roles, role
attributes, role memberships (with `admin`, `inherit` and `set` options, reaching `pg_` parents
through a recursive closure), table / column / routine / schema / sequence grants and default
privileges — each with its grant option and with routines identified by signature — PUBLIC table,
column and routine privileges, `SECURITY DEFINER` flags with their pinned `search_path`, table /
schema / routine owners, row-security flags **and policy text** (`permissive`, `cmd`, `roles`,
`USING`, `WITH CHECK`), the approval registries and the seeded permission registry.

Agreement between two healthy databases proves nothing on its own, so each of the following is
injected into the Production-shaped database inside a transaction, asserted to change both the
fingerprint and its own category, and rolled back; equality with the canonical database is
re-asserted afterwards.

| injected change | category that must move |
| --- | --- |
| `pg_read_all_data` membership | `roleMemberships` |
| `pg_write_all_data` membership | `roleMemberships` |
| membership through a newly created parent role | `roleMemberships` |
| `ADMIN` / `INHERIT` / `SET` option, each compared against its opposite | `roleMemberships` |
| `SELECT(id)` granted to PUBLIC | `publicColumnGrants` |
| schema `CREATE` granted to a role | `schemaGrants` |
| schema `CREATE` granted to **PUBLIC** | `schemaGrants` |
| sequence `USAGE` granted to a role | `sequenceGrants` |
| sequence `USAGE` granted to **PUBLIC** | `sequenceGrants` |
| default privileges added | `defaultPrivileges` |
| table grant given `WITH GRANT OPTION` | `tableGrants` |
| row-security policy created | `rowSecurityPolicies` |
| owner swapped between two same-named routines of different signature | `routineOwners` |
| execute granted on one signature of a same-named pair | `routineGrants` |

In an ACL, grantee `0` is PUBLIC. The `/2` collections filtered it out with `a.grantee<>0`,
which silently dropped the widest grant there is; grantee `0` is now rendered as `PUBLIC` and
compared.

Two falsification runs confirm the mutation tests are not vacuous. Restoring the `/2`
membership filter makes `pg_read_all_data membership` fail (`expected roleMemberships, changed
roleAttributes`). Restoring the `/2` `a.grantee<>0` filter on schema grants makes
`PUBLIC schema CREATE grant went undetected` fail — under `/2` that grant did not move the
fingerprint at all.

## Normalisation: explicit identifiers, not substring replacement

`/2` folded the database name and the connected owner into one placeholder by substring
replacement, which could map two genuinely different custody roles to the same value. `/3`
builds an explicit map — `current_database()` → `<DATABASE>`, `current_user` →
`<MIGRATION_OWNER>`, and each role named `<database>_<suffix>` → `<DATABASE>_<suffix>` — and
substitutes **whole identifier tokens only**. A role belonging to another environment is not in
the map, so it survives literally and fails the comparison instead of being folded into the
local one.

Two conditions are refused rather than collapsed: a database whose name equals its owner's
(`PRODUCTION_FINGERPRINT_AMBIGUOUS_IDENTITY`) and two identifiers mapping to one placeholder
(`PRODUCTION_FINGERPRINT_IDENTIFIER_COLLISION`). The local worktree cluster names its database
and its owner identically, so the test creates a separate `zr_<12hex>` canonical database and
connects to it as the cluster owner — both environments then have owner ≠ database, which is
what makes the comparison symmetric. Rows are still sorted after normalisation, and no custody
role is excluded from the comparison to achieve any of this.
