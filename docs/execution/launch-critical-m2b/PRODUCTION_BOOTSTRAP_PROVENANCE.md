# Production bootstrap: transformation provenance

## The checksum distinction

`foundation_migrations.checksum` is the **CANONICAL SOURCE MIGRATION CHECKSUM** — the SHA256 of
the migration file on disk. For the twelve rewritten migrations it is deliberately *not* the
checksum of the bytes that were executed.

That is on purpose: it is what lets a Production registry and a local registry be compared
directly, and it is what `migrate()` checks when it decides a migration is already applied. The
bootstrap test asserts both databases report identical `(id, checksum)` rows and that each
checksum equals the digest of the canonical file.

The executed bytes are recorded separately, per migration, as `transformedSha256`. Nothing
infers one from the other.

## Provenance record

`bootstrapPlan(target)` emits one record per migration and `bootstrapProductionSchema()` returns
the transformed subset. Each record carries exactly:

- `id` — migration id
- `canonicalSha256` — SHA256 of the canonical source file
- `transformerVersion` — `production-bootstrap/2`
- `transformation` — `MIGRATION_TIME_DATABASE_IDENTITY_PREDICATE`, or `NONE`
- `transformedSha256` — SHA256 of the SQL actually executed
- `target` — the approved target database identity

plus a plan-level `planSha256` over the ordered provenance list. No secret values: the test
asserts the serialised provenance contains nothing outside `[A-Za-z0-9_@/{}[]":,.-]`.

## Transformer contract (fail-closed, exact)

Not a broad regex or a global substitution. For each of the twelve known guarded migrations the
transformer:

1. requires the exact source fragment `<subject> !~ '^zr_[a-f0-9]{12}$'`, where `<subject>` is
   pinned per migration (`0015` guards the local variable `n`; the other eleven call
   `current_database()` directly);
2. requires the exact occurrence count — 1 for a guarded migration, 0 for an unguarded one, and
   the pinned runtime counts `0028` = 1 and `0029` = 2;
3. requires that the single occurrence lies inside a top-level `DO $$…END$$;` span, so a guard
   in a function body is refused rather than rewritten;
4. replaces only that span with `<subject> <> '<target>'`;
5. asserts every byte before and after the replaced span is unchanged, and that no
   disposable-name predicate remains;
6. aborts on any other shape — `PRODUCTION_GUARD_SHAPE_UNEXPECTED`,
   `PRODUCTION_GUARD_FRAGMENT_UNEXPECTED`, `PRODUCTION_GUARD_NOT_MIGRATION_TIME`,
   `PRODUCTION_GUARD_COLLATERAL_CHANGE`, `PRODUCTION_GUARD_RESIDUAL`,
   `PRODUCTION_GUARD_COUNT_UNEXPECTED`.

Runtime guards in function bodies are never touched, and `0028`/`0029` are asserted
byte-identical before and after. Historical source files `0001`–`0039` remain byte-identical on
disk; nothing in the bootstrap writes them.

## Rehearsal record

Target `zao_rental_production_test`, transformer `production-bootstrap/2`, transformation class
`MIGRATION_TIME_DATABASE_IDENTITY_PREDICATE`, 12 of 39 migrations transformed.

`planSha256` = `27cc0ba6b959b2764563bcff1d097fcb0466f3cd6eddafd41b71ea9d02e7bc5c`

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

`planSha256` and every `transformedSha256` are bound to the target: the real Production target
has not been named, so its plan produces different digests, which are recorded at bootstrap time
from the run's own return value rather than copied from here.

## SECURITY_EQUIVALENCE coverage

The security fingerprint compares, between the canonical local database and the bootstrapped
one: derived custody roles, role attributes, role memberships, table/column/routine grants,
PUBLIC table grants and PUBLIC execute, SECURITY DEFINER flags with their pinned `search_path`,
table/schema/routine owners, row security, the approval registries and the seeded permission
registry. Transformed migration provenance is proved separately by the registry comparison
above.

Two normalisations are applied, and neither weakens the comparison: the database name and the
connected owner fold to `<ENVIRONMENT>` (role names are derived from the database name by
construction), and rows are sorted **after** folding, because the raw names collate differently
between the two environments while the content is what is being compared. Role catalogues are
scoped to the roles each database actually uses, since `pg_roles` is cluster-global and in a
shared test cluster would otherwise compare the cluster rather than the database.
