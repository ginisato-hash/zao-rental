# Production activation readiness — code closure (no live action)

Base: merged main `2843540fb0385000e7e5ab939d3c3f5412bd2d36` (tree `06a11dac…`). Branch
`claude/production-activation-readiness`. Target outcome `PRODUCTION_ACTIVATION_CODE_READY`, not
`PRODUCTION_ACTIVE`. Production writes 0, Square calls 0, Resend sends 0, deploys 0, DNS changes 0.

## What changed, per TD gap

**A — commercial composition.** `packages/core/src/guest/production-commercial-composition.ts` adds
`installProductionCommercialComposition()` beside the unchanged R3 dark profile. Token
`ZAO_PRODUCTION_HOSTING_ACTIVATION=R5_COMMERCIAL_PRODUCTION_COMPOSITION`; `instrumentation.ts` calls both
installers and each is inert unless the token is its own, so at most one installs the bootstrap.
It reads only `COMMERCIAL_ALLOWLISTED_KEYS` (no env scan), requires `VERCEL_ENV=production`, derives a
validated `ProductionConfiguration` with fixed flags (booking, guestRecovery, payment, staffOperations on;
media/avatar off), and supplies DB passwords only for the ten services those flags open (never
`avatar_read`). The real override-free `issueExactProductionIdentity` runs before installation. Startup
makes no provider request; Square/Resend are in-memory bindings over the platform fetch. Thrown errors are
value-free codes. Guest security uses the committed Owner-approved values
(`guest.p4-approved-policy.json`) with adapter `vercel-production-direct`; the operator attests the digest
via `PRODUCTION_GUEST_POLICY_SHA256`. The guest peer comes only from `x-vercel-forwarded-for`
(`vercel-production-peer.ts`, same trust basis as the existing Preview adapter); all other peer fields come
from configuration.

**B/C — two-store routing.** `square-production-routing.ts` adds `RoutedSquareProductionGateway` and
`RoutedSquareProductionRefundGateway`. Each store has its own strict single-location
`FetchSquareProductionTransport` (unchanged). Routing uses only the durable row's `locationId`; unknown
location, merchant mismatch, crossed wiring, duplicate locations or a non-Production transport fail closed
before any credential read or fetch. The card token is per-call only; UNKNOWN, no-retry and idempotency
semantics are the unchanged engine's.

**D — Production webhook.** Canonical receiver is a separate deployment of the existing small
`apps/webhook-ingress` (the main web app route stays Sandbox/preview-only). Classification
`PRODUCTION_WEBHOOK_INGRESS_ONLY`; notification URL must equal `https://$VERCEL_PROJECT_PRODUCTION_URL/api/webhooks/square`;
explicit merchant and signature key; receiver URL must be the pinned Production host (fingerprint), database
`neondb`, user `neondb_pay_receipt`, non-pooler, `sslmode=verify-full` only. Any other credential (Square
token, Sandbox/R15 values, generic DB URL) disables it. New `PgSquareProductionWebhookInbox` calls only
`square_webhook.receive_production(...)`, refuses a non-PRODUCTION signal before connecting and exposes no
claim/settle. The generic/Sandbox `PgSquareWebhookInbox` is behaviourally unchanged. Real-PG proof: the
Production receiver role persists PRODUCTION rows (INSERTED/DUPLICATE/HASH_CONFLICT) and the generic
adapter under that role fails closed (no EXECUTE on `receive()`), writing nothing.

**E — publication/noindex.** The static page-wide `X-Robots-Tag` in `next.config.ts` is removed (security
headers and the static API noindex remain). `proxy.ts` now decides via pure `indexablePage(approved, origin,
path, query)`: noindex unless PublicationAuthority is installed, origin is exactly `https://salomonzao.rent`
and the path is an allowlisted query-free public path. `robots.txt` uses the same authority through
`robotsRules()`; the sitemap is empty without it. An env flag alone cannot enable indexing.

**F — origin.** The commercial profile requires `PRODUCTION_PUBLIC_ORIGIN`, parsed strictly (https, no
path/port/userinfo): exactly `https://salomonzao.rent` or one `*.vercel.app` hostname. Host,
X-Forwarded-Host and the request URL are never used. Transition: pre-domain live acceptance uses a
`*.vercel.app` origin, where `issuePublicationAuthority` is impossible (origin mismatch); after the domain is
bound, the origin is switched to `https://salomonzao.rent` and redeployed; only then can a per-release
`PRODUCTION_PUBLICATION_APPROVAL` (`{state,origin,releaseId,approvedBy,approvedAt}`, releaseId =
`PRODUCTION_RELEASE_ID`, the 40-hex source commit, cross-checked with `VERCEL_GIT_COMMIT_SHA` when present)
be installed. It must stay absent until publication GO.

**G — provisional registration.** `POST /api/operations/provisional-capacity-source` wires the existing
`ProvisionalCapacitySourceOperations.register()` into the maintained staff Operations route (staff session,
origin check, `requestKey`/`input`). The Production operations role plan adds only
`EXECUTE ON FUNCTION provisional_capacity_register_source(text,text,jsonb)`; direct source/bucket DML stays
denied (real-PG proof). No registration was performed anywhere except owned local clusters.

**11 — payload review.** `scripts/provisional-activation-report.ts` (read-only) reports registered, mapped
and requestable quantity per bucket against a supplied catalog variant list. Current result without a
Production catalog: 1,421 registered, 1,421 mapped, 0 requestable (`CATALOG_NOT_PROVIDED`). Matching is by
exact `ledger_variants.size`, and five family/age groups carry cross-source size-format drift, so any single
catalog size string can match only one source there:

| group | Source A format | Source B format |
|---|---|---|
| SNOWBOARD/ADULT, SNOWBOARD/KIDS | bare number (`150`) | `150 cm` |
| SNOWBOARD_BOOT/ADULT, /KIDS | bare half size (`22.5`) | shared `22/22.5` |
| SKI_BOOT/KIDS | bare (`20`) plus shared | shared `20/20.5` |

The guest recommender parses only `<n> cm` sizes (`centimetres()`), so shared `N/N.5` boot variants would be
exact-matchable but not guest-recommendable. Source B `31X → 31/31.5` stays mapped as the Owner rule
requires and is reported unrequestable unless an identical catalog variant exists. No payload or catalog
variant was changed or invented. Normalisation is a TD/Owner data decision before live registration.

**H / 13 — drift and operator tooling.** Launch staging `NOTIFICATION_PROVIDER` now lists
`SEND, IDEMPOTENT_SUBMISSION, UNKNOWN_NO_BLIND_RESEND` (no fake lookup). Stale "40 / thirty-nine
migrations" comments now say 0001–0050. Phase D/E runbooks carry current-code corrections.
`npm run production:activation-plan` is a no-write plan (no DB/provider/network; names only) printing
release head/tree, target `neondb`, 50 migrations, bootstrap `planSha256`/`sourceManifestSha256`, role names
and SQL digests, required credential names (web app, webhook ingress, backup workflow), the next write step,
its preconditions, rollback and proof, plus `planDigestSha256`. There is no APPLY entrypoint.

## Remaining live gates (unchanged, each separately attended)

Neon bootstrap → roles → LOGIN/credentials → Vercel env → deploy → runtime smoke → Square configuration →
small live payment → webhook ingress deploy/registration → cancellation/refund → Resend delivery →
provisional registration (after payload normalisation decision) → backup/restore → domain/DNS → copy/tax
wording → PUBLICATION_APPROVED → indexing/GO. Provisional materialisation remains NOT_ACTIVATED.

## Disclosed limits

- Exact-identity accept paths (commercial composition, Production ingress host pin) are provable only in the
  real environment; fixtures prove derivation and every reject path. No test-only issuer was added.
- Per-isolate publication behaviour on Vercel (proxy vs. instrumentation process) remains a live acceptance
  item; if the proxy cannot see the authority it fails closed (noindex).
- The Production payment reconciliation/projection worker runner is still library-only; synchronous
  create→observe and operator `reconcile` are the paths available for the first attended payment.

## Verification (local, disposable PostgreSQL/browser only)

- Linux-equivalent full verification: **73/73 groups exit 0** (2026-09-23T15:42:27Z start), evidence
  `.local/evidence/linux-equivalent-2026-09-23T15-42-27.145Z/commands.json`; 107 run-owned clusters
  disposed by unchanged test hygiene, 60 preexisting clusters preserved. It ran the exact group list of
  `scripts/verify.mjs` with its env/evidence/cleanup semantics, excluding only the darwin-only
  `test:controller:macos` (no `codex` binary on this host; the group is not part of GitHub CI).
  Literal `npm run verify` was therefore not run; `verify.mjs`/`test-hygiene.ts` are unchanged.
- Unit 811/811 (785 before this branch). Browser runs regenerated tracked historical Avatar/R15
  evidence files; they were archived with hashes outside the repository and restored to HEAD, so this
  branch changes none of them.
