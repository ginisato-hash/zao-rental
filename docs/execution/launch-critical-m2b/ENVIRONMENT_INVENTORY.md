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

## Neon — ACCOUNT AND SANDBOX EXIST, PRODUCTION NOT CREATED

An earlier revision of this document said Neon was "absent entirely". That was wrong, and the
mistake is worth naming: no CLI and no local configuration were found on this machine, and
that was read as the provider not existing. Absence of tooling is not absence of an account.

The Owner has confirmed:

| field | value |
| --- | --- |
| project | `zao-rental-sandbox-development` |
| project id | `jolly-rain-06413569` |
| organisation | `org-delicate-dream-81592413` |
| region | `aws-ap-southeast-1` |
| PostgreSQL | 18 |
| plan | `free_v3` |
| history retention | 21600 s (6 hours) |
| default branch | `main` |

```
NEON_ACCOUNT:    EXISTS
NEON_SANDBOX:    EXISTS
NEON_PRODUCTION: NOT_CREATED
```

This project is the sandbox/development environment and **must not be reused for Production**.

Two consequences follow. The Production database should sit in `aws-ap-southeast-1` alongside
the existing APAC environment, with the Vercel runtime co-located in `sin1`, rather than the
Tokyo pairing suggested in the earlier revision — that suggestion is withdrawn. And the
sandbox's 6-hour history retention is far below the 7-day retention with point-in-time
recovery the launch gate requires, so if the Production plan cannot provide it,
`HUMAN_BILLING_GATE` applies and `BACKUP` stays `BLOCKED`. No plan change was made.

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
| Production database | BLOCKED | schema cannot be created yet — see `PRODUCTION_BOOTSTRAP_BOUNDARY.md`; plan must also reach 7-day retention + PITR |
| Production migrations | BLOCKED | depends on the database |
| Square identity | BLOCKED | Owner: Production credentials and expected identity |
| Square webhook | BLOCKED | depends on Square and a Production origin |
| R2 Production bucket | AVAILABLE | may be created; Avatar rights still unapproved |
| Notification provider | BLOCKED | Owner: provider choice and terms |
| Custom domain | BLOCKED | Owner: hostname choice; cutover is a separate gate |
| Backup / PITR | BLOCKED | depends on the database |
| Real inventory import | BLOCKED | Owner: the inventory file |
| Dark Production deploy | BLOCKED | needs the database before it can start |
