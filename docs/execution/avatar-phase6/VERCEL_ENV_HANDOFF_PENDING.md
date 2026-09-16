# Dedicated Preview configuration checkpoint

Owner direct approval is committed at 161174a0a1cb16e93ea2eae9dadb8bdec2b25c2a.
One dedicated project was created: zao-rental-avatar-preview /
prj_EonVxKra8p9txdZ7O2Ko6t1A8biW. Vercel Authentication is ON;
Git integration is absent, Node24.x, custom-domain auto-assignment disabled.
The exact project ID is now pinned in the fail-closed runtime.

The initial two-entry branch-scoped env request failed. A metadata read confirmed
zero env entries. A subsequent nonsecret marker request proved GIT_LINK_REQUIRED;
it also failed. The correction uses Preview-only env in this isolated project;
the runtime still requires the exact Phase6 branch. No Git integration is added.

Automatic approval review rejected the corrected secret handoff before execution
twice, including after a local payload-scope check and reference to the adopted §7.
Its stated reason was that general Preview env authority did not explicitly name
these specific secrets being sent to Vercel. A narrowly scoped Owner question is
pending; no alternative transmission path is attempted. This is neither a secret
exposure event nor an application/provider failure or a capacity error.

The concrete handoff is:

- Destination: this exact dedicated project's Preview environment only.
- ZAO_AVATAR_PHASE6: plain marker PROTECTED_PREVIEW_V1.
- ZAO_HOSTED_PREVIEW_RUNTIME: sensitive variable containing six Phase6-only Neon
  runtime role credentials, the guest signing key and a bucket-limited read-only
  R2 credential expiring 2026-09-17T08:18:35.188Z (local conservative expiry).
- No database owner, Production, Square, payment, refund or webhook credential.
- Values pass through process memory/stdin; no stdout, chat, repository or evidence.

The transmission operator is ready outside Git and reuses the existing 0600
runtime payload. It first requires zero existing env entries and the exact project
and protection setting; it then writes only the two Preview entries and verifies
names/types/targets, without outputting values. No new key is generated.

Preview deployments remain0/2, Hosted E2E NOT_RUN, Claude initial0/1 and correction0/1.
Deployment and browser acceptance operators are prepared locally but not executed.
The deployment operator requires clean exact remote HEAD, protection, Preview-only
allowlisted env, the inspected upload manifest, and an fsynced one-shot budget guard.
It explicitly passes --target preview to avoid implicit first-deployment Production.
The browser operator never reads/copies cookies or saves authentication state.

Local49 affected unit tests, typecheck and build passed after the project-ID pin.
Lint and secret pattern scan passed. Upload dry-run excludes local databases,
credentials, source photos, raster files and archives; the runtime manifest remains.
The exclusion file is necessary because Vercel's dry-run included .local despite
its existing Git ignore rule. No upload occurred during these dry-runs.

R2 write key remains revoked/removed. The one runtime read key and task Neon OAuth
remain live only for the pending authorized setup; no browser or handoff server is
left open. Revoke setup OAuth and remove local secret files at final completion.
All historical incidents and consumed budgets remain unchanged. No Phase7.
