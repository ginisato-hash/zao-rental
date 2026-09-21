# R3 actual Preview acceptance

Bounded Preview acceptance completed 2026-09-14. Square S1 is not authorized by this result.

## Source and deployment

- Actual Preview: `dpl_2tskZombWNMhwEKB6NG96FxkzmhL`.
- URL: https://zao-rental-cfswundgr-zao-food-map.vercel.app
- Deployed head: `d0bfe551dd6f7fa63ccf0bba97da03292e89cc4e`.
- Deployed tree: `a8788ecd2c799003b287faa0eb1817c15d2c6b43`.
- Product tested at `de1d530ec65d0a73d23938b4b4fd9f88e178b74f`; subsequent source commit adds authority/evidence only. Final result-record commits are not redeploys and do not change product code.
- Main remains `3061dbbbe00294e5baebba2405028c907d6e6e85`.
- API raw target is null; CLI inspect labels it Preview, and actual request rows independently state `environment=preview`. No production promotion/alias/custom domain. Protection remains `all_except_custom_domains`; unauthenticated GET302, Owner browser login then HTML rendered.

## Verification

| Check | Result |
|---|---|
| local Node / npm | 24.15.0 / 11.12.1 |
| npm ci / lint / typecheck / build | all exit0 |
| focused runtime + preflight regressions | 13 PASS, 0 fail, 0 skip |
| unit | 177 PASS, 0 fail, 0 skip |
| lock after npm ci | unchanged |
| full verify / real DB | not selected; no business change or external DB authority |
| Vercel install/build | SUCCESS; Node24.19.0, npm11.12.1, Next16.3.4 |
| Next startup | root and staff HTML rendered; exact deployment serverless GETs |
| GET /api/health | 200, liveness only |
| GET /api/guest | 503, expected unconnected fail closed |
| GET /api/booking-access | 503, expected unconfigured fail closed |
| GET /api/staff | 401, application staff authentication required |
| production / Square activation | false / unconnected |

No dedicated HTTP readiness endpoint exists. Dependency readiness is **false**, proven by existing protected route refusals and composition contracts, not by falsely treating health200 as readiness. JSON navigation was blocked by the in-app client (`ERR_BLOCKED_BY_CLIENT`), but the HTTP requests reached the deployment. Exact HTTP statuses above come from Vercel request metadata. JSON bodies were not displayed; expected error semantics come from deployed code. Vercel login is separate from staff authentication.

Request-log CLI emitted valid exact-deployment rows then exited1 with a permission error. Those rows are retained with that limitation; no full-log completeness claim. No permission/global config changes were made. Raw log messages, cookies, headers, login redirects/nonces and env values were not saved. Favicon404 is a cosmetic observation, not a server startup failure.

## Authority and cleanup

Parent (Astra) owned local integration, deployment boundary and bootstrap cleanup. Prior Spark01 runtime inventory and Spark02 four-case regression were integrated; no additional Spark or Claude starts. The bootstrap `dpl_C44zbkSu1uu4WbPNj9uCLA8zDJWP` was removed only after actual Preview/build/protection success. Readback: one actual Preview remains, live aliases0, custom domains0, unchanged Project settings. No additional deployment is authorized.

Actual Square requests/payments/refunds/webhooks, external DB/R2/email/SMS, secret exposure, Production Square env and Production app deployment in this continuation: **all0**. This is an owned-action/source audit, not provider-wide telemetry. Earlier failed unexpected-production Attempt1 and the explicitly authorized static production-metadata bootstrap are preserved in their separate records; they are not rewritten as zero historical creations.

No local DB/Web/Claude started; finite CLI/tests completed. Preview is intentionally retained. Owner preview tab21, blank API tabs22-25 and staff tab26 remain; Codex native UI cleanup was denied, so no bypass was attempted. Browser tabs do not run a local DB/service. No external activation, main push/merge, other-project operation or Runner activation.

## Evidence and next action

Evidence: [manifest](r3-continuation-evidence/manifest-sha256.json), [commands](r3-continuation-evidence/commands.json), [upload manifest](r3-continuation-evidence/upload-manifest.json), [build](r3-continuation-evidence/safe-cloud-build.json), [runtime HTTP metadata](r3-continuation-evidence/runtime-acceptance.json), [result](r3-continuation-evidence/final-acceptance.json), [cleanup](r3-continuation-evidence/cleanup-readback.json).

Stop before Square S1. Next Owner decision is bounded merchant/location read-only Sandbox acceptance; no token should be supplied in chat/repo. No P6 independent review/CI was started for this record-only checkpoint and P5 review/CI is not presented as covering this P6 deployment.
