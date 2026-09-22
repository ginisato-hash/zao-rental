# Phase J — publication-readiness audit (read-only/static; no DNS or public-launch action)

Base: `main` `72628ba0e06ef1518e45b7178a577dc484adb9f2`. No code was changed for this audit; findings are documented, one is flagged as a concrete future prerequisite.

## Env/activation inventory

Rather than hand-compile a list of env var names (error-prone and easily stale), the canonical inventory already exists as a type: [`ProductionRuntimeInput`](../../../packages/core/src/guest/production-runtime.ts) — `configuration` (+ its approved SHA-256), `deployment` (Vercel project/release/origin identity), `secrets` (per-service DB credentials + guest/staff/access/recovery signing keys), an optional `payment` binding (Square Production merchant + token accessor), an optional `media` binding (R2 read credential), and a mandatory `audit` callback for every startup stage. `installProductionBootstrap()` is only ever meant to be called once by "a trusted server bootstrap/hosting integration, never a route" (the code's own comment) — confirmed no route in `apps/web/src/app` calls it. Until it's called with real input, `productionRequested()`/`bootstrapProductionRuntime()` leave the app permanently in the `FEATURE_FLAGS` startup stage.

## Health/readiness

- `/api/health` and `/api/readiness` exist and are real. `readinessResponse()` ([readiness-http.ts](../../../apps/web/src/lib/readiness-http.ts)) deliberately reveals only `{status:'READY'|'UNAVAILABLE'}` with `200`/`503` — "no component, identity or failure detail," per its own comment — good, this is the correct public shape.
- A separate, staff-authenticated detail view (`readinessDetails()`, same file) requires a live session (`staff.status==='authorized'`) **and** either `canManage()` or the `OPERATIONS_VIEW` permission before returning per-component status (`APP`/`DB`/`GUEST`/`PAYMENT_ADAPTER`/`WEBHOOK`/`MEDIA`/`NOTIFICATION`), and even then only from a fixed, closed enum of safe values (`READY`/`UNAVAILABLE`/`OFF`/`CONFIGURED`/`CONFIGURED_ACTIVATION_PENDING`/`UNCONNECTED`) — "even if a future adapter adds diagnostic fields," confirmed the allowlist filters anything else out. No auth boundary gap found here.

## Security headers ([next.config.ts](../../../apps/web/next.config.ts))

Present on every route: `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, plus `X-Robots-Tag: noindex, nofollow` (see the indexing finding below) and `poweredByHeader: false`. `/api/*` additionally gets `Cache-Control: private, no-store`.

**Not present**: an explicit `Content-Security-Policy` and an explicit `Strict-Transport-Security` header. Neither is necessarily a launch-blocker — Vercel typically applies HSTS automatically for HTTPS-only custom domains, and this app's staff/guest surfaces may not need a restrictive CSP if there's no third-party script/inline-content risk — but this wasn't verified either way, so it's recorded as an open item to explicitly confirm (not fix) before public launch, not a defect.

## Robots/indexing policy — the one concrete launch prerequisite found

[`indexingEnabled()`](../../../packages/core/src/content/public-pages.ts) is defined as:

```ts
export function indexingEnabled(){return process.env.NODE_ENV!=='production'&&process.env.ZAO_TEST_PUBLIC_INDEXING==='1';}
```

This single function governs **both** `robots.ts`'s `disallow:'/'` vs. allow-list, **and** (via the identical condition duplicated in `next.config.ts`'s `headers()`) whether the blanket `X-Robots-Tag: noindex, nofollow` is emitted — the two signals agree with each other, which is good; there's no internal contradiction. But the condition itself is a **test-only escape hatch**: it can only ever be `true` in a *non-production* environment with an explicit test flag set. In actual Vercel Production (`NODE_ENV==='production'`), this is unconditionally `false` — meaning **the site cannot be indexed in real Production today, under any environment-variable configuration**, by design.

This is the correct, safe default for a pre-launch project (nothing gets accidentally indexed before the Owner is ready), but it means real public launch is not just a matter of flipping an env var — **a small, deliberate code change to `indexingEnabled()`** (e.g., reading a genuine launch-readiness flag instead of the test-only one) **is a real, concrete prerequisite that does not exist yet.** Recording this now so it isn't discovered as a surprise at actual launch time; not fixed here, since deciding the real flag's name/semantics is a launch-timing decision for the Owner, not a technical defect to silently correct.

## Rollback plan

No custom rollback tooling exists in this repository, and none is needed: Vercel deployments are immutable and atomic, and its built-in "Instant Rollback" (promote a prior deployment to Production) is the standard, already-available mechanism. The Phase E runbook's dark-deploy discipline (verify `/api/readiness` immediately after every deploy) doubles as the rollback trigger condition — if a deploy ever reports `ready:true` unexpectedly, or fails its health check, roll back via that existing Vercel mechanism rather than attempting a fix-forward deploy under pressure.

## What this explicitly does NOT do

No DNS record was read or changed. No custom domain was added. No public launch, indexing flag, or Production secret was set. No code was changed as a result of this audit — the one finding above (`indexingEnabled()`) is recorded as a future prerequisite, not fixed, since fixing it means choosing real launch semantics that are the Owner's decision.
