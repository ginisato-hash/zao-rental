# Terminal after governance correction review (2026-09-15)

R15_PARTIAL / CHANGES_REQUIRED. F1/F2 demonstrated corrections independently accepted;
F3 HIGH hosted acceptance sequencing remains open. F4/NEW1 LOW remain.
See [exact review, validation correction, gates and closure](p6/r15-governance/FINAL_RESULT.md).
No new external operation after Governance reset; no additional pre-live review slot.
The post-review test-driver evidence correction is explicitly not independently re-reviewed.
Main/Avatar unchanged. No new terms/login request or second resource creation.

## Preserved earlier governance checkpoint

# Current governance and correction checkpoint (2026-09-15)

Read [AI_DEVELOPMENT_GOVERNANCE.md](AI_DEVELOPMENT_GOVERNANCE.md) first.
The initial before-live review is CHANGES_REQUIRED (HIGH3 / LOW1), exact head9026227.
See [original and correction disposition](p6/r15-governance/FINDING_DISPOSITION.md).
Governance review budget: initial used1, correction max1, final post-live max1.
New external operations remain stopped while HIGH findings are unresolved.

Owner Neon consent is resolved. Resource store_i5vh0ZEKo2ikcVo9 was created once BEFORE
Governance reset, Free/free_v3, no connected projects. Never create again or repeat terms.
Hosted credential read403 remains unreconciled; no hosted migrations/roles/requests done.
Local correction adds durable R15 reservations (0030; original29 unchanged) and a bounded
non-disclosing signature-key sink. Actual hosted application, key handoff, operator wiring,
real manifest and live acceptance remain unexecuted. See disposition for exact gates.
Avatar stays untouched during R15. Historical checkpoints below are preserved, not current.

## Historical continuation and implementation records

# Current continuation checkpoint (2026-09-15)

Read `PRODUCTION_P6_R15_CONTINUATION_AUTHORITY.md` and `p6/r15-continuation/RESULT.md`.
R15 is PARTIAL / BLOCKED_NEON_TERMS_PROPAGATION. Team installation/resource/configuration
counts remain0. No new add/create retry or deployment was made. Dedicated Project exists;
failed historical deploy1 is deleted; main R3 and protection are unchanged. The ONLY
budget amendment is ingress total3 (used1/deleted; remaining2 conditional on DB readiness).
Original source/start/counters remain. Operator wiring and non-disclosing key handoff are
still incomplete, not a ready live integration. Avatar may proceed to A0+A1 docs only
after remote terminal readback. No A2/A3 while human-blocked.

## Historical implementation and earlier checkpoint records (preserved below)

# R15 dedicated Sandbox ingress — implementation and resume contract

Authority: `PRODUCTION_P6_R15_AUTHORITY.md`, starting source `dffa78c10825fdb44bd7cb123c2b8b2b4e2113c9`.
R14_PARTIAL and R10 LAST_OBSERVED_PENDING / S3_NONTERMINAL_DO_NOT_RETRY remain historical.
This record does not claim live external acceptance. The initial Vercel login gate was resolved; the current gate is automatic approval review requiring explicit chat adoption of R15 before dedicated Project creation.

## Implemented independently of external credentials

- `apps/webhook-ingress` is a separate Node.js Web Handler deployable, without Next UI. Exact routes: POST `/api/webhooks/square`, GET `/health`; others 404/405. Health is liveness, not a DB/secret readiness claim.
- R11 raw-byte HMAC, fixed notification URL, 64 KiB limit, merchant check and durable receipt are reused. Bad configuration, inherited credential names, signature or merchant cannot open a pool. Query strings are rejected. HMAC uses configured stable URL, never Host/XFF.
- Only the dedicated stable `zao-rental-webhook-sandbox.vercel.app` production domain and SANDBOX_WEBHOOK_INGRESS_ONLY composition are accepted. No Square access token, worker, business projection, auth UI or booking route exists in this app.
- Receiver pool is lazy, bounded and TLS certificate verified; database namespace and receiver role must match. It has no credential fallback. Idle driver errors are suppressed without printing driver objects. Vercel's own ephemeral OIDC system variable is not a Square credential and is not consumed by the app.
- Shared role-grant source preserves the R14 grant matrix. R15 additionally removes broad dispatch/claim execution; only target-filtered variants are granted. Setup owner, six runtime/probe roles and passwords are separate. Passwords are generated and held in memory, not files/env/logs. Existing role names cause a reconcile stop rather than rotation/recreation.
- Hosted setup requires explicit zero incremental cost, provider resource identity, resource-derived namespace, exact Neon host and verified TLS. Original migrations 0001–0029, including filenames, are checked against preserved R14 hashes before migration. Provisioning is an explicit function, never an import side effect.
- `r15HostedComposition` accepts only server-injected role pools and a fixed booking/attempt/payment/location. It verifies Sandbox merchant/100 JPY context before the injected provider, runs one finite batch and refuses a second invocation on the same instance. HTTP budget still requires the external exclusive/fsynced guard; this in-memory latch is not a cross-instance exactly-once guarantee.
- The normal NODE_ENV=production projection rejection remains. A separate opaque server-issued R15 capability permits the approved main project's Preview build only, with an exact synthetic booking/attempt/DB target. The DB additionally checks actual database/current role before business locks. Serialized/forged permits and other targets are rejected. Ordinary application routes do not import or instantiate this composition.

## Evidence distinctions

`p6/r15-evidence/validation.json` binds local checks to source hashes. The final local database run contains R14's 28 checks plus 3 R15 checks: ingress durable insert/replay, narrowed dispatch/claim grants, and production-build capability/role/replay. It is real loopback PostgreSQL with synthetic provider data; not Neon, a live webhook, real GetPayment, or a Vercel runtime claim. Source migrations are unchanged.

Unit/fixture checks cover inherited credential rejection, TLS/role/domain setup, signature/merchant/size/route rejection, COMMIT barrier, bounded worker failures, amount mismatch and capability forgery. Hosted privilege tests must still run after provisioning; local success is not substituted for them.

## External sequence after ordinary Owner login

1. Metadata-only verify existing main project/team/protection, duplicate dedicated project names and existing Neon resources. Do not inspect login/callback URL, title, AX tree or storage. Do not retrieve existing main Square env values.
2. Inspect current Neon product plans and native installation state. Select a proven free plan only. Creation uses `--no-connect --no-env-pull` to avoid automatic owner credentials on main Production/all targets. Interactive contract/consent, billing increase or org permission expansion is an explicit gate. Do not run generic `env pull`.
3. Provision max one dedicated dev resource, save metadata/zero-cost evidence, derive namespace, create the owned database, compare remote R14 migration hash evidence, apply 0001–0029 and separate roles. Secrets stay inside the provider/setup process, or a short-lived 0600 repo-external staging file if necessary.
4. Run hosted role negative tests and all required local checks before activation. Publish only receiver credential to dedicated ingress; main Preview gets dispatcher/worker/projector/diagnostic roles. No owner credential in either runtime.
5. Create dedicated project with `rootDirectory=apps/webhook-ingress`, outside-root shared source enabled, Node 24, no Git autodeploy and Standard Protection. Main project's settings remain unchanged. Verify actual build behavior of the new Web Handler routes; local typecheck is not remote build evidence.
6. Ingress deploy 1 establishes its stable public production domain, returning fail-closed without signature. Verify protection on its deployment/Preview URLs. Confirm main protection unchanged. Record deployment source SHA/tree.
7. Protected main Preview <=1: internal operator composition still needs final wiring to the fixed hosted resource/payment manifest. Reuse existing main Preview Square credential in-server only. Before subscription creation, finish and verify a signature-key handoff that consumes the response in-process into dedicated Vercel secret storage without showing/persisting it. Never extract the existing main access token or add it to ingress.
8. Create Sandbox subscription <=1, exact stable URL/events/version; unknown result means metadata reconciliation, not another create. Consume signature key safely; ingress deploy 2 on same stable URL. Optional official test delivery <=1 is receiver-only evidence if its payment is not lookupable.
9. Create one synthetic hosted booking/attempt/quote/HOLD/gear+wear fixture. Freeze new payment IDs/key/budgets in payment-operation-manifest.json, commit/push/readback, then fsync exclusive guard. Never reuse R9/R10. Conditional CreatePayment <=1,100 JPY,retry0.
10. Bounded diagnostic polling <=60 seconds observes durable natural webhook IDs/states. No arrival means BLOCKED_WEBHOOK_DELIVERY; never create another payment. After receipt, invoke finite protected worker once, GetPayment <=1. Verify provider truth and apply exact synthetic projection once. Run hosted negative cases with fixtures, no additional Square requests.
11. Save safe evidence, commit/push/read back before cleanup. Delete the owned main Preview and acceptance-only subscription; close or preserve the dedicated ingress per authority, retaining HMAC/receiver-only security if kept. Keep only synthetic hosted data/roles. No refund cleanup, R10 lookup, main merge or new PR.

## Deployment/configuration notes

The dedicated `vercel.json` uses explicit routing without a filesystem catch-all, to avoid publishing source/API aliases. It uses the existing root lockfile's pg version; no framework/ORM replacement. Import-time configuration is fail-closed and does not connect to a DB. Its remote packaging, rewritten `/health` Request URL and raw-body binding must be checked on the two allowed deploys, not assumed from local tests.

Primary references checked 2026-09-15:
- [Vercel Node.js Web Handler runtime](https://vercel.com/docs/functions/runtimes/node-js)
- [Vercel integration CLI — no-connect, no-env-pull, plan discovery and consent](https://vercel.com/docs/cli/integration)
- [Vercel Deployment Protection](https://vercel.com/docs/deployment-protection)

## Remaining work, not hidden as completed

Vercel authentication; free Neon resource/terms eligibility; hosted migrations and negative privileges; dedicated project identity/protection/build; secret handoff; temporary main acceptance routes; exact live payment manifest and operator guard; real subscription/delivery/provider/projection; external cleanup. None of these operations has been performed in the current local checkpoint. All external budgets remain unused. No new model/review has been started.

## Latest external checkpoint

Owner requested another authorize request; ordinary Vercel login exited 0 without auth output collection. Metadata readback verified existing main Standard Protection and no bypass, no Git autodeploy. Dedicated Project duplicates: 0. Existing integrations: 0. Native Neon catalog exposes `free_v3` (Free), with optional auth disabled in the proposed setup; no installation/provisioning was attempted.

Dedicated Project creation was rejected **before execution** by automatic approval review. First reason: separate Project and region not authorized. After proving source adoption against the pasted original and removing the region field, the second review required explicit Owner chat adoption of the attached R15 authority. No alternate route or further retry followed. No Project, DB, subscription, payment or deployment was created. See `p6/r15-evidence/approval-gate.json`. Existing main protection is unchanged. The next human action is limited to that explicit adoption; new technical choices are not being requested.

## Explicit adoption and provisioning update

The Owner directly adopted the full R15 in chat, resolving the prior automatic
approval gate. Dedicated Project creation is now verified, ID
`prj_whzxwR1vj0CBBnm1UD6dz5ALPMbA`, team `zao-food-map`, Standard Protection, no Git
autodeploy. The first CLI command exited 1; raw error was not retained. Read-only
list reconciliation proved no Project existed before a second bounded command
with documented creation fields succeeded. Node 24 and outside-root source support
were returned as enabled defaults. Do not claim a proved cause for the first error.

Neon free_v3 / sin1 / auth=false / no-connect / no-env-pull stopped before resource
creation with `integration_terms_acceptance_required`. R15 §34 reserves new provider
contracts to Owner; only that terms operation was requested. No terms, billing,
credential, DB or Square action has occurred. Independent ingress verification may
continue. Original start and all existing budgets remain unchanged.

Dedicated install now pins npm 11.12.1, matching the existing root package manager
and engine-strict contract, while keeping dependency scripts disabled. The existing
surface test checks this linkage. 509 related tests, secrets, lint, both typechecks
and main build pass again; remote dedicated packaging remains to be measured.

## Dedicated runtime failure and correction

Deploy1 built successfully but actual Node startup failed with extensionless ESM
imports. See p6/r15-evidence/RESUME_RESULT.md. The correction uses the build:ingress
locked CommonJS bundle behind explicit .cjs imports and a real emitted-JS/plain-Node
regression. Before the next upload, generate runtime.cjs from the exact committed
source, include its hash and build input manifest, and confirm it is included in the
dry-run. No ordinary main-app imports or business rules were altered.

Neon Owner terms acceptance was reported, but account-scoped installations remain0
and CLI still returns terms-required. Agent acceptance or blind resource retries are
not a remedy. Dedicated deploy2 remains available and is reserved for DB/signature-ready
acceptance; current deployed runtime has not been repaired by the local fix alone.
