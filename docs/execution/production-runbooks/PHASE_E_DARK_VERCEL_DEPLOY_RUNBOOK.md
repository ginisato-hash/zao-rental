# Phase E runbook — dark Vercel Production deploy

**Status: written, not executed.** No Vercel command was run while writing this beyond what R2B already did (`vercel link`, in the `prod-r2b-backup-automation` worktree, confirmed gitignored/harmless). No deploy was created.

## What "dark" means here, concretely

This app already has a built-in, fail-closed activation gate: [packages/core/src/guest/production-bootstrap.ts](../../../packages/core/src/guest/production-bootstrap.ts). `installProductionBootstrap()` is only ever meant to be called once, by a trusted server-bootstrap integration, "never a route" (the code's own comment). Until that call happens with real, valid input, `/api/readiness` ([apps/web/src/app/api/readiness/route.ts](../../../apps/web/src/app/api/readiness/route.ts)) reports `{ready:false, stage:'FEATURE_FLAGS'}` and `getProductionRuntime()` returns `null` everywhere. "Dark deploy" in this runbook means: **deploy the built app to a Vercel Production target with zero Production secrets set**, so this gate is never satisfied and the app is live-but-inert — reachable at its Production URL (if protection allows) but answering every readiness check as not-ready, serving no real guest traffic, taking no real Square/payment action. Activating it for real is a distinct, later, separately-authorized step this runbook does not cover.

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

## What this explicitly does NOT do

No DNS change, no custom domain, no public launch, no marketing/customer-facing announcement. No Square/payment/webhook credential is set. No real guest booking, inventory, or notification traffic. Activation (calling `installProductionBootstrap` with real input) is a separate, later, explicitly-authorized runbook this document does not attempt to write yet, since it depends on which Production secrets (DB, Square, backup, webhook roles) are ready and which Owner decisions (go-live date, real inventory import, first real payment) haven't been made.
