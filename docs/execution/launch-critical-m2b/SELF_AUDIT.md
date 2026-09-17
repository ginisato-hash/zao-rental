# M2B implementation self-audit

Claude is the Primary Implementer and Production Connection Operator, so nothing here is an
independent review.

```
role:                    PRIMARY_IMPLEMENTER
m2bIndependentReview:    INDEPENDENT_REVIEW_PENDING
classification:          M2B_BLOCKED_ON_OWNER_PROVIDER_GATES
```

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
| Production database | Owner: provider account, region, plan. No Neon CLI, configuration or Vercel resource exists |
| Production migrations, roles, acceptance | the database |
| Real inventory import | Owner: the inventory file and the catalogue behind it. `REAL_INVENTORY_FILE_REQUIRED` |
| Square Production identity | Owner: Production credentials and the approved expected identity |
| Square webhook | Square credentials and a stable Production origin |
| R2 Production bucket | can be created, but Avatar rights are still unapproved so media stays off |
| Notification provider | Owner: provider choice and any terms it carries |
| Custom domain | Owner: which hostname; the cutover is a separate gate regardless |
| Backup / PITR | the database |
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
Migrations added 1 (`0039`); `0001`–`0038` byte-identical.
