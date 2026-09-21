# R15 external checkpoint and runtime correction

State: BLOCKED_NEON_PROVISIONING. This is not R15_PASS.

The Owner directly adopted R15 and later reported Neon terms accepted. Original
start 2026-09-15T03:06:48Z remains. Main 3061dbbbe00294e5baebba2405028c907d6e6e85.

## External results

- Created dedicated Project `zao-rental-webhook-sandbox`, ID
  `prj_whzxwR1vj0CBBnm1UD6dz5ALPMbA`, Standard Protection, no Git autodeploy or env values.
- Deployment 1 `dpl_G7dFJ6e6bNk9i3VKeGBpfskvA26V`, source
  `982b96e5916ec55ff0ca8a6c63e93c383801574d`, tree
  `0c2a18c986a12f28d421d98cffd799f3f1dff07e`, build READY.
- Stable URL https://zao-rental-webhook-sandbox.vercel.app. Dedicated unique deployment
  and existing main URL both return unauthenticated302 without following redirects.
- Actual health/webhook invocation returned500, not the intended200/503. Safe runtime
  log proves ERR_MODULE_NOT_FOUND for extensionless src/handler. Other UI/source paths
  tested returned404. Direct /api/health also invoked the failed module; its application
  rejection must be rechecked after the fixed deployment.
- No DB, signature key, Square token or business UI was configured on ingress.
- Neon `free_v3`, sin1, auth=false, no-connect/no-env-pull remains blocked before creation.
  Owner acceptance report is retained; account-scoped CLI metadata still shows0 Neon
  installations and0 resources. Second completed add returned terms-required. No contract
  was accepted by the agent; no billing/credential operation occurred.

## Corrective implementation and evidence

R15 entrypoints now import an explicit runtime.cjs artifact produced by
`npm run build:ingress`. Existing business imports and rules are unchanged. The build
bundles the existing receiver, pg and required contracts with locked esbuild0.28.2;
pg-native remains an unused optional external. Generated runtime.cjs is ignored by Git
and must be generated from the exact source and hashed in the next upload manifest.

The new regression transpiles the same ESM entrypoints and loads them with ordinary
Node in production mode, without tsx/TS loaders: old imports fail with the same module
error, corrected imports return health200 / unconfigured webhook503 / alias404.
Canonical510 tests, secret scan, lint, both typechecks and main build pass. Original31
real local Postgres checks are reused because DB/service implementation is unchanged.
No hosted DB, real webhook or provider acceptance is inferred from these results.

Automatic approval capacity errors temporarily blocked provisioning and canonical
code writes before execution. A writable candidate proved the runtime fix; the same
normal review path then allowed canonical application. No review/auth bypass was used.
Candidate full suite had one missing-Git preflight failure; canonical suite has510/510.

## Remaining sequence and budgets

Resolve team-specific Neon installation state with Owner; then create/adopt max1 free
resource and proceed with unchanged R15 hosted migration/role/negative tests. Do not
reuse the add command without a provider-state change. Finish main protected Preview
operator routes and non-disclosing signature-key handoff, fixed payment manifest and
one-shot guards. Reserve dedicated deploy2 for the corrected artifact and real signature
configuration. No additional deploy is authorized beyond the R15 total2.

Used: dedicated Project1, dedicated deploy1. Hosted DB0; main Preview0; main Production0;
Square subscription/payment/lookup/refund/test-delivery0; real data0; models0. Previous
R9/R10 and R14 records are untouched. No new PR or main merge. Valid live webhook0.

The dedicated deployment is retained for bounded recovery (no secrets/DB). Any cleanup
must follow safe evidence push/readback. Owner's browser was not read or modified;
no local DB/Web/browser/Claude was started in this resume, and finite test/CLI children
have exited. No claim is made about provider-wide traffic outside this task.

## Final bounded cleanup / restart record
+
+Correction source: 7a9b4e7836a12de202bf6a91ee6fb404e555c25f, tree
+23c86566d0970b3f6533058839683efff5ab4690. Safe result, failure and validation evidence
+were pushed and read back byte-for-byte before cleanup. Generated fixed runtime and
+140-file upload passed dry-run at that source; no second deployment was submitted.
+
+Deleted only failed owned deployment dpl_G7dFJ6e6bNk9i3VKeGBpfskvA26V. Dedicated
+Project remains; active deployments0 and stable /health now404. Existing main R3,
+Standard Protection and six Preview-only env metadata entries are unchanged.
+No env value was read, copied or staged. All finite owned validation/CLI work ended;
+no DB, Web, browser or Claude process was started in this resume. Source/candidate
+artifacts remain as files, not background processes. Source main is unchanged.
+
+Current gate remains Neon marketplace installation: Owner says terms accepted, but
+CLI's team-scoped readback says installations0/resources0 and add returns terms-required.
+An exact Team/source=cli completion check was requested; no third completed add was run.
+Do not interpret platform approval-review capacity errors as Vercel authentication
+failure, and do not create another login or change authentication. Resume from provider
+metadata reconciliation once Owner's team installation is visible. All R15 budgets and
+the original start persist; ingress deploy used1 of2, all Square/hosted DB budgets unused.
+
+No new remote CI or independent model review was started in R15. Local green and
+fixed artifact dry-run are not hosted/live E2E evidence. R15 remains partial.
+