# M2B environment inventory

Read-only discovery taken before any provider mutation. Safe metadata only: no token,
password, connection string, signing secret, access key or environment value appears here or
was printed during discovery.

## Vercel — CONNECTED

| field | value |
| --- | --- |
| authenticated as | `s-sato-1780` |
| team | Yuge (`zao-food-map`) |
| project | `zao-rental` (`prj_ehUMOzM77em9DVnHJBJffncD5hg7`) |
| framework | Next.js, root `.`, Node 24.x |
| region | `iad1` |
| Production deployments | **none** — the project has never been deployed to Production |
| environment variables | **none configured**, in any target |

Other projects on the team: `zao-kiraku-website`, `zao-rental-avatar-preview`,
`zao-rental-webhook-sandbox`, `zao-food-map-pilot`, `zao-food-map`.

`vercel link` writes a `.env.local` containing an OIDC token and appends `.vercel` to
`.gitignore`. The file was deleted immediately, the `.gitignore` edit reverted, and the
working tree left clean. `.env*` and `.vercel/` were already ignored.

**Note for the Owner:** the project region is `iad1` (US East). For two stores in Japan the
database should sit in the same region as the runtime; choosing a Tokyo region for both is
worth deciding before the Production database is created, because moving it later is
disruptive.

## Neon — NOT CONFIGURED

No `neonctl` binary, no local Neon configuration, and `vercel integration ls` reports **no
resources** for the project, so the historical hosted development database is not attached to
anything. A dedicated Production database therefore does not exist yet.

`HUMAN_PROVIDER_GATE` — creating it needs an account decision and, depending on plan,
acceptance of terms or a billing change, which is an Owner action.

## Square — NOT CONNECTED

No Square CLI or Production credential is present. Historical evidence covers Sandbox only.

`HUMAN_PROVIDER_GATE` — Production access requires Owner-provided credentials and the
Owner-approved expected identity (merchant, both location IDs, webhook origin and path).

## Square webhook — BLOCKED ON PREREQUISITES

Needs Square Production credentials and a stable Production origin, neither of which exists.

## Cloudflare R2 — AUTHENTICATED, NO PRODUCTION BUCKET

Authenticated as `s_sato@yuge-zao.com`, account `dce72332f2b04366335908cc383996d6`.
Existing buckets: `kiraku-bi-data`, `kiraku-staff-ops-data` (other products) and
`zao-rental-avatar-p6` (Avatar Phase6 preview).

There is no dedicated Production media bucket. The Phase6 preview bucket and its credential
must not be reused for Production.

## Notification provider — OWNER DECISION PENDING

The Cloudflare token carries `email_sending (write)`, so Cloudflare Email Service is
technically reachable, but no provider has been chosen. Selecting one, and accepting any
terms it carries, is an Owner decision and is not made here.

## Custom domain — NOT PROVISIONED

The team holds `zao-kiraku.co.jp` and `tasteofzao.app`. Neither is a ZAO Rental public
domain. Which hostname the rental service will use is an Owner decision, and the final DNS
cutover is an Owner gate regardless.

## Backup / PITR — BLOCKED ON PREREQUISITES

Capability can only be verified once the Production database provider exists.

## Real inventory file — NOT PRESENT

`REAL_INVENTORY_FILE_REQUIRED`. No ZAO Rental equipment inventory file exists on this
machine; every recent spreadsheet found belongs to other products. See
`REAL_INVENTORY_REQUEST.md` for the exact template and the values that must be supplied.

## Summary

| subgate | state | blocking action |
| --- | --- | --- |
| Vercel project | READY | — |
| Production database | BLOCKED | Owner: provider account, region, plan |
| Production migrations | BLOCKED | depends on the database |
| Square identity | BLOCKED | Owner: Production credentials and expected identity |
| Square webhook | BLOCKED | depends on Square and a Production origin |
| R2 Production bucket | AVAILABLE | may be created; Avatar rights still unapproved |
| Notification provider | BLOCKED | Owner: provider choice and terms |
| Custom domain | BLOCKED | Owner: hostname choice; cutover is a separate gate |
| Backup / PITR | BLOCKED | depends on the database |
| Real inventory import | BLOCKED | Owner: the inventory file |
| Dark Production deploy | BLOCKED | needs the database before it can start |
