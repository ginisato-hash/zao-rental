# Preview target diagnosis — no new deployment

Observed installed CLI59.9.1: `deploy --target preview` reaches createArgs.target,
but bundled @vercel/client postDeployment changes target preview to undefined
before JSON serialization. Location: dist/chunks/chunk-OHQJEOP7.js lines46813–46815.
CLI deploy output only displays a first-production hint when local target is absent;
an explicit preview target therefore does not produce that hint.

The remote API actually returned target production. The API request raw body was
not intercepted/logged because credentials must not be exposed. This source behavior
and Vercel's documented first-deployment production default explain the observed
result; a guaranteed non-production first-deployment route is NOT verified.

Official source: https://vercel.com/docs/domains/working-with-domains/deploying-and-redirecting
CLI source, read only; no patch, bypass, settings change or second attempt.

Separate build failure: engine-strict=true with node24.15.x/npm11.12.x;
cloud provided Node24.19.0/npm11.17.0. npm install failed with EBADENGINE before
Next build. Do not simply remove engine-strict without a reviewed compatibility plan.
The root ./ versus apps/web/.next output discovery concern was not reached and
remains unverified. Current build/root/output settings were not changed.
