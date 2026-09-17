# M2B implementation self-audit

Claude is the Primary Implementer and Production Connection Operator, so nothing here is an
independent review.

```
role:                    PRIMARY_IMPLEMENTER
m2bIndependentReview:    INDEPENDENT_REVIEW_PENDING
classification:          M2B_CORRECTIONS_READY_FOR_INDEPENDENT_RECHECK
reviewedHead:            38e6e403d80e4f86ddfdea56f6c8423f60e41358 (REQUEST_CHANGES)
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

**Independent review of `38e6e40` returned REQUEST_CHANGES.** F1–F4 are addressed below. The
review was right on every point; two of its findings were reproduced here before being fixed.

| finding | what was wrong | what changed |
| --- | --- | --- |
| F1 HIGH | `migrationTimeSpans()` treated a line-start `DO $$` as proof of top level. A guard in a block comment, in a dollar-quoted string or in dynamic SQL inside a function was accepted and rewritten, and `0015`'s subject `n` matched the tail of `tenant_n`. All four reproduced. | Two independent gates. A committed approved-source manifest pins all 39 reviewed digests plus each guard's byte offset, subject and fragment; and a SQL scanner that understands comments, strings and dollar quoting requires the guard to sit at an identifier boundary, in the body of a top-level `DO`, in code context. Each gate refuses every counterexample alone. |
| F2 HIGH | The fingerprint named more categories but missed real differences: `pg_` membership edges were filtered out, PUBLIC was dropped from ACL collections by `grantee<>0`, routines were compared without signatures, grant options and RLS policy text were absent, and no test proved any difference was detectable. | Memberships reach `pg_` parents through a recursive closure and carry `admin`/`inherit`/`set`; grantee `0` is rendered as `PUBLIC`; routines are identified by signature; grant options, schema and sequence grants, default privileges and RLS policy text are compared. Fifteen privilege changes are injected into a real isolated PostgreSQL inside a transaction, each asserted to move both the fingerprint and its own category, then rolled back. |
| F3 MEDIUM | Substring folding of the database and owner names could map two genuinely different custody roles to one placeholder. | An explicit identifier map substituting whole tokens only. A foreign environment's role is not in the map, so it survives literally and fails the comparison. Ambiguous identity and placeholder collisions are refused, not collapsed. |
| F4 MEDIUM | `ACCESSORY_MODEL_DECISION.md` and `INVENTORY_OWNER_DECISIONS.md` treated all 227 binding units as `UNITE (4 IN 1 PACK)` and offered 227 × 4 = 908. | Corrected per source row: 144 UNITE (rows 70–72, 32/76/36) and 83 others (rows 83/87/88, 75/4/4). 908 was never defensible; 659 is an assumption-bearing illustration; none of 227, 659, 908 is a physical quantity. Recorded as a documentation error plus the Owner's scope limitation, not as the review being wrong. |

The two findings reproduced before fixing: the four F1 counterexamples were all accepted and
rewritten by the reviewed transformer. Restoring the reviewed F2 filters makes the new mutation
tests fail — and for a PUBLIC schema `CREATE` grant the reviewed fingerprint did not change at
all, so that grant would have passed a Production comparison unnoticed.

**Both equivalences hold, and are now shown to be sensitive.** `STRUCTURAL_EQUIVALENCE` over
schemas, tables, columns, constraints, indexes, functions, triggers, views and types.
`SECURITY_EQUIVALENCE` over the categories listed in `PRODUCTION_BOOTSTRAP_PROVENANCE.md`, with
every injected change detected and attributed. The migration registry matches exactly,
`migrate()` afterwards is inert across the full prefix, and A1/A2 registries are asserted at
0 rows. Thirteen cases, all PASS, no `NOT_RUN`.

**Inventory scope decided by the Owner.** This round registers `SKI`, `SNOWBOARD`, `SKI_BOOT`
and `SNOWBOARD_BOOT` only: 67 of 86 source rows, 901 of 1492 units. A snowboard is one lending
unit — board plus mounted binding, one Asset — so no binding gets an Asset, QR label, price,
reservation stock or quantity pool of its own; boots are one Asset per left/right pair.
`SNOWBOARD_BINDING`, `HELMET` and `POLE` are `EXCLUDED_BY_OWNER_SCOPE` (19 rows, 591 units)
with their schema, catalogue, importer, recommendation, reservation and label support
untouched; `WEAR_JACKET` and `WEAR_PANTS` are `FUTURE_INPUT_REQUIRED` and absent from this
source. The candidate file was verified to contain only the four in-scope families, and no
binding, helmet or pole row reaches it. Ski-boot BSL stays `UNVERIFIED_NULL`; nothing is
guessed. `ACCESSORY_MODEL_OWNER_GATE` is removed as a blocker for this scope, not resolved for
helmets.

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

The previous round reported "Production DDL 0", which was imprecise: DDL *was* executed, into a
Production-**shaped** local database. Stated correctly:

```
hostedProductionDdl:          0
realNeonProductionMutation:   0
productionShapedLocalDdl:     performed (local database zao_rental_production_test)
```

Production deploys 0. Square requests 0. Real payments or refunds 0. Real inventory imports 0.
External e-mail or SMS 0. Domain changes 0. Public DNS changes 0. `main` merges 0. Force pushes
0. Secrets read, printed or written 0. Provider mutations of any kind 0 — discovery was
read-only. Migrations added 0 in this round; `0001`–`0039` byte-identical, and no migration file
was edited.

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
