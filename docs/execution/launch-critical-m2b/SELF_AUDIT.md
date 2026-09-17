# M2B implementation self-audit

Claude is the Primary Implementer and Production Connection Operator, so nothing here is an
independent review.

```
role:                    PRIMARY_IMPLEMENTER
m2bIndependentReview:    INDEPENDENT_REVIEW_PENDING
classification:          M2B_BOOTSTRAP_AND_INVENTORY_PREP_READY_FOR_INDEPENDENT_REVIEW
```

## Continuation round

**Neon inventory corrected.** The earlier claim that Neon was "absent entirely" was wrong: no
CLI and no local configuration were found, and that was read as the provider not existing. The
account and a sandbox project exist; only the Production project does not. The region guidance
is corrected with it — Production belongs in `aws-ap-southeast-1` beside the existing sandbox,
with the runtime in `sin1`, not the Tokyo pairing suggested before.

**Provisional inventory audited.** The Owner-supplied workbook was verified against its
expected SHA256 before being read, and every figure was recomputed rather than copied: 86 rows,
1492 units, 1121 supported, 371 unsupported. It is classified provisional, so it is **not**
registered as an approved real source and `REAL_DATA` stays `NOT_RUN`.

Two things the audit found that the brief did not anticipate. Nineteen item codes repeat, but
only three are genuine split lines; the other sixteen are distinct JP sizes sharing one model
code, and aggregating them would have invented or destroyed variants. And all eighteen ski rows
carry no JP size at all, so the length was taken from the product name and cross-checked
against the item code suffix — all eighteen agreed, none was guessed.

**Production bootstrap implemented and proved.** `LOCAL_COUPLING_CLASSIFICATION.md` enumerates
the local-only coupling as A1 development foundation artifacts, A2 historical R15 Sandbox
activation artifacts, B the twelve migration-time guards, C database-derived role names and D
the application-layer payment guards. The bootstrap rewrites only the identity test inside the
twelve top-level guard blocks, demanding the exact approved target database instead of the
disposable `zr_` pattern — a narrower test, not a weaker one — and leaves the additional
ownership and role assertions in those blocks untouched.

The transformer is exact and fail-closed, not a global substitution: each guarded migration is
named with the exact subject expression it may carry, the occurrence count is pinned (including
the runtime counts `0028` = 1 and `0029` = 2 that must never be rewritten), the match must lie
inside a top-level `DO $$…END$$;` span, and every byte outside the single replaced span is
asserted unchanged. Six distinct shape changes are proved to abort rather than pass through.
`0001`–`0039` remain byte-identical on disk.

`foundation_migrations.checksum` is recorded as the canonical source migration checksum, never
the checksum of executed bytes; the executed bytes are recorded separately per migration as
`transformedSha256`, with transformer version, transformation class, approved target and a
plan-level `planSha256` (`PRODUCTION_BOOTSTRAP_PROVENANCE.md`). The provenance is asserted to
contain no value outside identifiers and digests.

**Both equivalences hold.** `STRUCTURAL_EQUIVALENCE` — identical normalised fingerprint over
schemas, tables, columns, constraints, indexes, functions, triggers, views and types.
`SECURITY_EQUIVALENCE` — identical derived custody roles, role attributes, role memberships,
table/column/routine grants, PUBLIC grants and PUBLIC execute, SECURITY DEFINER flags with
pinned `search_path`, table/schema/routine owners, row security, approval registries and the
seeded permission registry; plus assertions that no role reaches an escalation attribute
directly or through a membership. The migration registry matches exactly, `migrate()` afterwards
is inert across the full prefix, and A1/A2 registries are asserted at 0 rows in the bootstrapped
database. Ten cases, all PASS; Production DDL 0.

One correction worth recording: the first `SECURITY_EQUIVALENCE` failures were defects in the
comparison, not in the bootstrap. Rows were sorted by SQL before normalisation, so the two
environments' raw role names collated differently; and `pg_roles` is cluster-global, so a shared
test cluster was being compared instead of the database. Sorting after folding and scoping role
catalogues to the roles each database actually uses fixed both without weakening the comparison.

**Terminal A was not reached.** `M2B_PRODUCTION_CONNECTED_DARK_READY_FOR_PHYSICAL_ACCEPTANCE`
requires a dedicated Production database, verified Square Production identity, a configured
webhook and a dark Production deployment. None of those can be created from here: the
provider accounts and the inventory file do not exist yet. What follows is what was done and
what each gate is waiting for.

## Done

**Environment inventory** (`ENVIRONMENT_INVENTORY.md`). Read-only discovery across Vercel,
Neon, Cloudflare R2 and the domain state, before any mutation. No token, password, connection
string, signing secret or environment value was printed or written. `vercel link` writes a
`.env.local` containing an OIDC token and appends to `.gitignore`; the file was deleted
immediately, the `.gitignore` edit reverted, and the tree left clean.

**Review LOW closed** (migration `0039`, function only). `real_data_acceptance.accepted_quantity`
counted quantity-backed *rows*; it now sums the physical quantity those rows carried. Asset
backed rows stay in `accepted_assets`. Proven with a receipt covering both a ski row and a
pole row per store: 250 Assets and 250 pole pairs, reported separately. This changes no
readiness semantics.

**Production security negatives** (`tests/operations/production-security.ts`). Three cases
from the required list that were not yet covered anywhere: a charge cannot be created while
payment is off and no attempt row appears; nothing is delivered while notification is off and
no attempt is consumed; a restore can never target a Production or otherwise unowned
identity, and always creates its own database.

The remainder of the required negatives were already covered and were re-run, not rewritten:
Preview and Sandbox configuration rejection, public R2 exposure rejection (`PUBLIC`
visibility, `r2DevEnabled`, any public domain) and owner/admin runtime role rejection in
`tests/unit/production-configuration.test.ts`; wrong merchant, swapped locations and wrong
webhook origin or path in `tests/operations/connection-harness.ts`; runtime role writing the
approval registry, unapproved digest, one-store claimed as two and withdrawn approval in
`tests/operations/import-rehearsal.ts`; assigned-store staff reading the global launch gate in
`tests/operations/launch-gate.ts`; anonymous and unprivileged access to `/admin/launch` in
`tests/operations/launch-ui.ts`.

**Operator material.** `REAL_INVENTORY_REQUEST.md` states exactly what the inventory file and
the catalogue behind it must contain, and `FIELD_ACCEPTANCE_SEQUENCE.md` gives the physical
test sequence. Both make clear that nothing is inferred and that unperformed scenarios stay
`NOT_RUN`.

## Blocked, and on what

| gate | blocked on |
| --- | --- |
| Production database | Owner: Production Neon project in `aws-ap-southeast-1` and its plan. The account and a sandbox project exist; the Production project does not |
| Production migrations, roles, acceptance | the database |
| Real inventory import | Owner: the inventory file and the catalogue behind it. `REAL_INVENTORY_FILE_REQUIRED` |
| Square Production identity | Owner: Production credentials and the approved expected identity |
| Square webhook | Square credentials and a stable Production origin |
| R2 Production bucket | can be created, but Avatar rights are still unapproved so media stays off |
| Notification provider | Owner: provider choice and any terms it carries |
| Custom domain | Owner: which hostname; the cutover is a separate gate regardless |
| Backup / PITR | the database. Neon PITR alone cannot meet Owner policy OWNER-P4-R1 — see `BACKUP_POLICY_GAP.md` |
| Dark Production deploy | the database; the runtime fails closed without it |
| Field and staff acceptance | real inventory, printed labels and devices |

## What the launch gate will say

`DB_SCHEMA` reflects the local registry only. `REAL_DATA` stays `NOT_RUN`: there is no
approved source and no receipt, and a synthetic rehearsal can never produce one. `PAYMENT`,
`WEBHOOK`, `MEDIA`, `NOTIFICATION` and `BACKUP` stay `NOT_RUN` while unconnected.
`FIELD_DEVICE` and `STAFF_REHEARSAL` stay `NOT_RUN` until performed. Nothing was forced.

## Operation counts

Production deploys 0. Production database mutations 0. Square requests 0. Real payments or
refunds 0. Real inventory imports 0. External e-mail or SMS 0. Domain changes 0. Secrets
read, printed or written 0. Provider mutations of any kind 0 — discovery was read-only.
Migrations added 1 (`0039`); `0001`–`0038` byte-identical, and no migration file was edited in
this round. Production DDL 0: the bootstrap was exercised only against a local database named
`zao_rental_production_test`.

## Outstanding for review

The persisted `^zr_` CHECK constraints need no migration. Nothing in the application writes the
A1 tables (`foundation_metadata`, `telemetry_events`) or the A2 tables
(`r15_activation.manifest`, `r15_activation.operations`), so Production creates them and leaves
them empty and inactive, asserted at 0 rows. `0030` belongs to the finite R15 Square Sandbox
acceptance and is never a Production activation mechanism. The earlier proposal to widen those
checks is withdrawn, and no fake `zr_` namespace is inserted.

What remains open is `PAYMENT_PROJECTION_PRODUCTION_BLOCKER`
(`PAYMENT_PROJECTION_PRODUCTION_BLOCKER.md`): `PgPaymentProjection`,
`payment_projection.lock_source`, `payment_reconciliation.dispatch_target` and
`payment_reconciliation.claim_target` are deliberately development/Sandbox constrained. This
blocks real Production payment projection and reconciliation and the controlled real payment
gate. It does **not** block the Production bootstrap, a dark Vercel deployment, Square
Production identity verification or webhook configuration. It is deliberately not fixed in this
bootstrap scope — clearing it changes reviewed payment-admission code — and is carried into the
next pre-payment implementation and review gate.
