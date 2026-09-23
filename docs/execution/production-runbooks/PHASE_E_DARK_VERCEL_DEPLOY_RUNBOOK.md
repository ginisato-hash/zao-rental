# Phase E runbook — dark Vercel Production deploy

**Status: written, not executed.** No Vercel command was run while writing this beyond what R2B already did (`vercel link`, in the `prod-r2b-backup-automation` worktree, confirmed gitignored/harmless). No deploy was created.

## What "dark" means here, concretely

**Updated by the PROD integration-correction pass**: the original version of this runbook relied on the fact that nothing in the app ever called `installProductionBootstrap()` at all — that gap is now closed. [apps/web/src/instrumentation.ts](../../../apps/web/src/instrumentation.ts) now calls [`installProductionHostingComposition()`](../../../packages/core/src/guest/production-hosting-composition.ts) once at process startup (never from a route), which itself calls `installProductionBootstrap()` — but only when an explicit, allowlisted activation env var (`ZAO_PRODUCTION_HOSTING_ACTIVATION=R3_DARK_PRODUCTION_COMPOSITION`) is set, and even then it always composes with **every business flag hardcoded false** (`booking`/`guestRecovery`/`payment`/`media`/`avatar`/`staffOperations` all `false` — there is no env key that can turn any of them on; see that file's own tests). "Dark deploy" now means two independent, stacked safety layers: (1) if the activation env var is absent, hosting composition is a no-op and `installProductionBootstrap` is never called at all — the original "not called" guarantee, preserved; (2) even if an operator *does* set the activation variable (e.g. to prove DB-identity binding for real), the composed runtime still cannot serve guest/staff/payment/media traffic, because every flag is false. `/api/readiness` ([apps/web/src/app/api/readiness/route.ts](../../../apps/web/src/app/api/readiness/route.ts)) reports `{ready:false, stage:'FEATURE_FLAGS'}` whenever hosting composition is not activated, and `{ready:true, stage:'READY'}` with every capability `OFF`/`UNCONNECTED` if it is. "Dark deploy" in this runbook means: **deploy the built app to a Vercel Production target with the hosting-activation env var absent (preferred) or, if present, with zero payment/media/DB-role secrets beyond what dark-profile identity binding needs** — reachable at its Production URL (if protection allows) but serving no real guest traffic and taking no real Square/payment action either way. Turning any business flag on for real is a distinct, later, separately-authorized step this runbook does not cover.

## Preconditions

1. **Phase D (Neon bootstrap) does not need to happen first.** The app's readiness gate does not depend on the database being bootstrapped — it depends on `installProductionBootstrap` being called with real input, which this runbook deliberately does not do. The two runbooks are independent; do either first.
2. **The existing Vercel project** (already linked via `vercel link` during R2B, per that worktree's `.vercel/project.json` — gitignored, never committed) is the one to use. Do not create a second Production project for this app; that would fragment domain/env history the way several historical Avatar-phase incidents in this repo's `CLAUDE.md` already document going wrong.
3. **Deployment Protection should be ON** (Vercel's "Standard Protection" or stricter) before this deploy is promoted to Production, matching every prior Production/Preview deploy in this project's history. Confirm this setting in the Vercel dashboard/CLI metadata (read-only) before deploying, not after.
4. **Zero Production secrets are set** in the Vercel project's Production environment at deploy time — no Square access token, no `PGPASSWORD`/database URL, no age recipient beyond what R2B's inert backup workflow already documents, no webhook signature key. This is the actual mechanism that keeps the deploy dark; it is not enforced by Vercel itself, so this is a manual checklist item to verify, not a technical guarantee.
5. **`vercel.json`** (repo root) already defines the build: `framework: nextjs`, pinned `npm@11.12.1` install/build commands, `outputDirectory: apps/web/.next`. No changes needed for a dark deploy.

## Exact steps

```bash
# From the linked worktree (or re-link with `vercel link` if starting fresh — never a new project):
vercel whoami                      # confirm the authenticated account/team is the right one
vercel project ls                  # confirm the existing zao-rental project, not a new one
vercel env ls production           # READ-ONLY: confirm this list is still empty/minimal before deploying
vercel deploy --prod --yes         # builds and deploys to the actual Production target
```

Do not pass `--build-env`/`--env` flags that would inject any secret at this step. Do not run this from a shell history or terminal that might leak into logs.

## Immediately after deploy — verify, don't activate

```bash
curl -s https://<production-domain>/api/health
curl -s https://<production-domain>/api/readiness
```

Expected: `/api/readiness` returns `{"ready":false,"stage":"FEATURE_FLAGS"}` (or an equivalent not-ready shape — check [readiness-http.ts](../../../apps/web/src/lib/readiness-http.ts) for the exact response format at the time this actually runs). If it ever reports `ready:true`, STOP immediately — that means something already satisfied the activation gate unexpectedly (e.g. a leaked env var from a different environment), and this is a real incident, not a successful dark deploy.

If Deployment Protection is on, the above `curl` calls may need Vercel's bypass token or must be run from an authenticated browser session instead — do not disable protection just to run this check.

## R3 dark acceptance — what "proving the hosting composition" additionally requires

Per the integration-correction directive, a bare "readiness stays false with zero secrets" smoke test is not R3 acceptance by itself. Before treating R3 as actually accepted for a real deploy, separately confirm and record:

1. **Minimum Production DB role credentials**: the 11 `productionServices` roles (see `scripts/production-app-roles.ts`) each need a real `PRODUCTION_DB_ROLE_<SERVICE>`/`PRODUCTION_DB_PASSWORD_<SERVICE>` pair set in Vercel's Production environment *only once the operator has actually run the Phase D role-plan SQL and flipped each role to `LOGIN`* — setting these env vars before that point would just fail `validateProductionCredential`'s structural checks, not silently succeed.
2. **Hosting bootstrap activation**: `ZAO_PRODUCTION_HOSTING_ACTIVATION=R3_DARK_PRODUCTION_COMPOSITION` is the one switch; everything else in the allowlist (`VERCEL_ENV`/`VERCEL_PROJECT_ID`/`VERCEL_DEPLOYMENT_ID`/`VERCEL_URL`/`PRODUCTION_DB_HOST`/`PRODUCTION_DB_NAME`/the 22 role+password vars/4 signing keys/2 key versions) must also be present — see [production-hosting-composition.ts](../../../packages/core/src/guest/production-hosting-composition.ts)'s `ALLOWLISTED_KEYS` for the exact, complete list.
3. **Exact main/deployment identity**: `VERCEL_PROJECT_ID`/`VERCEL_DEPLOYMENT_ID`/`VERCEL_URL` must match the real, intended Production project/deployment — these are validated only for *shape*, not against a pinned expected value (unlike R2B's host-fingerprint pin), so a manual visual cross-check against the Vercel dashboard before setting them remains the operator's responsibility.
4. **DB connection proof**: with all flags false, `composeProductionRuntime` never actually opens a database connection (`active` stays empty) — so reaching `READY` in this dark profile does **not** by itself prove the DB role credentials are real/reachable, only that their *shape* validated. A real DB-reachability proof needs a separate, later step once a flag is turned on (e.g. `staffOperations`), which is intentionally outside this runbook's dark scope.
5. **Feature flags off**: confirmed structurally, not just by convention — `payment`/`media` (and every other flag) are hardcoded `false` in `production-hosting-composition.ts` with no env override path at all (see that file's own unit test asserting this via source inspection).
6. **Rollback**: if `/api/readiness` ever reports `ready:true` unexpectedly, or the deploy fails its health check, use Vercel's built-in Instant Rollback (promote the prior deployment) — see the Phase J runbook's "Rollback plan" section; no custom rollback tooling exists or is needed here.

## What this explicitly does NOT do

No DNS change, no custom domain, no public launch, no marketing/customer-facing announcement. No Square/payment/webhook credential is set. No real guest booking, inventory, or notification traffic. Turning any business flag on for real, or building the corresponding non-dark hosting profile, is a separate, later, explicitly-authorized runbook this document does not attempt to write yet, since it depends on which Production secrets (Square, backup, webhook roles) are ready and which Owner decisions (go-live date, real inventory import, first real payment) haven't been made.

## Current-code corrections (production-activation-readiness, from merged main `2843540` code)

The R3 acceptance list above predates two later code changes; where it disagrees, the code wins:

- **Dark profile reads no DB passwords.** `production-hosting-composition.ts` (F1) reads only the 11
  `PRODUCTION_DB_ROLE_<SERVICE>` names and supplies `secrets.database:{}`; items 1–2's
  `PRODUCTION_DB_PASSWORD_<SERVICE>` / "22 role+password vars" are not read by the dark profile.
- **Vercel project identity is pinned, not shape-only.** `issueExactProductionIdentity` compares
  `sha256(VERCEL_PROJECT_ID)` with `EXPECTED_PRODUCTION_VERCEL_PROJECT_FINGERPRINT_SHA256`, and the Neon
  host/database likewise, before any bootstrap is installed (item 3).
- **A separate commercial profile now exists.** `ZAO_PRODUCTION_HOSTING_ACTIVATION=R5_COMMERCIAL_PRODUCTION_COMPOSITION`
  selects `installProductionCommercialComposition()` instead of the dark profile (never both). Its exact
  environment names, which are secret, and the no-write plan are printed by `npm run production:activation-plan`;
  see `docs/execution/production-activation-readiness/RESULT.md`. Deploying it is a later attended gate,
  after the Phase D bootstrap, role LOGIN provisioning and credential installation.
