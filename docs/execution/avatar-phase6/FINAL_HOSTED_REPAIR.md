# Phase6 final hosted repair / one-shot acceptance

Owner authority: 2026-09-16 final hosted repair attachment, SHA256 `9c4114c2d7c31e426263e8a770f9a73744afa50f8e173d98d2a68f28145b1b11`.
Base/canonical starting HEAD: `2290e66db551d2ce2a961abbd836c9464b1e97a6`, branch `codex/avatar-phase6-hosted-preview`.

This supersedes the attempt4 stop only for the stated final architecture repair,
predeploy independent static review, and exactly one additional Preview attempt5.
The prior zero-deploy forensic and original local diagnostic work are preserved;
the new implementation adapts their safe enums rather than discarding that work.
AGENTS, CLAUDE, SCOPE, migrations0001–0032 and the frozen R15 verifier are unchanged.

## Boundary

The non-empty Preview-only sensitive runtime config is the capability. The legacy
marker does not activate runtime. Optional platform values can veto a capability:
VERCEL must be1, environment/target must bepreview, project must beexact when present;
a nonempty Git ref must be the Phase6 branch. Missing system values are not denials.
Unexpected ZAO/payment/Square/refund/webhook/ambient DB env keys remain forbidden.
The parser validates exact Neon resource/host/database, six role/TLS connections,
guest signing key and exact read-only R2 scope/expiry independently of platform env.

Request ingress requires HTTPS, Host=URL.host=x-vercel-deployment-url and the exact
immutable dedicated Preview hostname pattern. Nonstandard ports and static/custom
aliases are rejected. Origin is computed per request, not fixed at startup.
Only x-vercel-forwarded-for identifies the peer. Generic forwarding headers never
provide a fallback. Guest and Avatar share this validator and separate rate budgets.
Missing capability under NODE_ENV=production never calls the local fallback.
Startup/ingress diagnostics serialize only allowlisted error/stage enums.
No checkout, payment, simulation, media-rights, revision/digest or guest isolation
boundary is broadened. No visual operation gains business-write authority.

Provider documentation: https://vercel.com/docs/headers/request-headers
The direct Vercel ingress and protected dedicated project are part of the trust
boundary; header validators alone are not a replacement for Deployment Protection.

## Execution contract

All local validation must pass, then one tools/MCP/browser/provider-disabled Claude
static review (one correction review only if material findings require it). Freeze
reviewed code, commit/push/readback clean. Code changes after review invalidate it.
Predeploy gate checks exact project, Authentication ON, sensitive runtime Preview-only,
Production env0, forbidden env0, exact existing static bootstrap1, R2 expiry >=2h.
No renewal on expiry failure. Reuse the known successful attempt4 transport.

Attempt5 is application acceptance, never diagnostics-only. Confirm READY, canonical
Preview target, exact project/source, protection and env scope before app access.
One guarded readiness GET, retries0. Failure ends Hosted acceptance; no attempt6.
A pass enables only the necessary two-member, both-appearance, three-direction,
390/1440px hosted Neon/private R2, ratio, isolation/logout/revision/digest/rights and
429 checks. Visual recommendation/HOLD/quote/payment/business writes must remain0.

After Hosted PASS, or terminal attempt5 failure with no further Phase6 deploys,
delete only the exact static bootstrap and its exact alias after safe confirmation.
Historical Production deployments2/aliases2 remain forever; final current counts0.
Keep accepted protected Preview/private R2 objects/read credential as authorized.
Close owned runtime/browser resources and remove/revoke temporary task auth.
No second post-hosted Claude review if reviewed code is unchanged.

Terminal PASS must be `PHASE6_PROTECTED_HOSTED_PREVIEW_PASS_WITH_CONTAINED_VERCEL_PRODUCTION_DEVIATION`.
Otherwise record `PHASE6_IMPLEMENTATION_COMPLETE_HOSTED_ACCEPTANCE_DEFERRED` or the
actual fixed failure stage. No automatic attempt6 or Phase7/main merge.

Evidence is consolidated in final-predeploy-validation.json, final-review/, final
hosted acceptance receipts and status.json. Prior incident/history records remain.

## Predeploy review disposition / frozen code

Independent Claude review PASS: BLOCKER0/HIGH0/MEDIUM0/LOW3; initial1, correction0,
tools/MCP/browser/provider0. Source tree SHA256:
`71123341c45eafc71cc3f934122b9ec54949460b278c7c89d075a87a524a8744`.
The reviewed implementation is frozen. Review PASS is code readiness, not Hosted PASS.

- P6-1 LOW: hosted Avatar-route startup-failure subprocess coverage is narrower than
  Guest-route coverage. Existing handler catch is fail-closed; retain the coverage
  improvement for later authorized development, with no code change after review.
- P6-2 LOW: hostname syntax identifies a deployment of this dedicated project/team,
  not its Preview target. Preview authorization relies on sensitive capability env
  scoping plus optional platform contradiction guards. Provider env0/target readback
  is mandatory. The static Production deployment itself has the same URL shape;
  its absence of capability/functions is a separate, verified boundary.
- P6-3 LOW: preserve historical PHASE5-1 and its limited independent review scope.
  Actual hosted429 proof remains in the upcoming acceptance, never inferred from
  code review alone. Earlier AV-2/AV-3/PHASE5-1 histories are not erased.
