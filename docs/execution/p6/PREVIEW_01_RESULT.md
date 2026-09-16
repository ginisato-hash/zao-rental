# P6 — first Preview attempt stopped and removed

Owner authorized one protected Preview deployment for build/start/health/fail-closed
checks. No Square request, DB connection, provider activation, Production target/alias,
secret values, env pull, protection bypass or second deploy was authorized.

## Exact inputs and actual outcome

- Source head `763caec75f3257abad6ad6d691637ae138c84cdb`; tree `a929d1e3012e16a611557c0364c1b90708c54b7b`.
- Remote main `3061dbbbe00294e5baebba2405028c907d6e6e85`; remote P6 equals source head; clean worktree.
- 218 tracked app/package/config inputs, byte-checked to commit, plus `.vercelignore`.
  No local env, DB, logs, tests, other worktrees, credentials or .git uploaded.
- Project `prj_ehUMOzM77em9DVnHJBJffncD5hg7`, protection `all_except_custom_domains`, Git integration absent.
- Explicit CLI `--target preview`, one creation request only; no force/redeploy.
- **Unexpected actual target: production**. ID `dpl_93LKqdiYs68WSWjfDPCG5YdpyiBs`.
- Returned URL `https://zao-rental-qixd46nkq-zao-food-map.vercel.app` — **removed, not a usable Preview**.
- Build ERROR `invalid_engines_value`: npm install exit1/EBADENGINE. Required Node24.15.x/npm11.12.x;
  actual cloud Node24.19.0/npm11.17.0. No Next build or app startup succeeded.
- Source-level cause: bundled client discards explicit preview target before POST;
  Vercel defaults the first deployment to production. See evidence/source-diagnosis.
- This violated the requested target boundary. It is not recorded as Production0
  or Preview success. The failed deployment was removed by its exact ID; readback:
  deployments0, aliases0, project retained, protection unchanged. No settings/secret edits.

## Verification and counts

| Item | Actual result |
|---|---|
| Preview creation | 0; requested1 |
| Unexpected Production-target creation | 1, ERROR, removed1 |
| Production READY / currently remaining deployments | 0 / 0 |
| Build / startup | dependency installation failed / not reached |
| health / readiness / runtime fail-closed | NOT_RUN; app never started |
| Protection | metadata enabled before/after; authenticated application access not tested |
| Square actual requests / payments / refunds / webhook deliveries | 0 / 0 / 0 / 0 |
| DB / R2 / email / new Claude calls | 0 / 0 / 0 / 0 |
| Secret values fetched/displayed/persisted | 0 |

Counts describe this task's operations and the failed deployment before application
build/start. Square telemetry was not queried (that would itself require forbidden
Square requests). `/api/health` remains liveness-only by code contract; no HTTP200
or fail-closed503 was measured on this failed deployment. Prior local tests/CI/review
are retained; they are not substituted for Vercel runtime evidence.

## Stop and next decision

One authorized deploy attempt is consumed. No retry, S1, DB/provider activation or
Production fallback. Source and installed CLI remain unchanged. Before another
attempt, establish an officially supported first-Preview-only route and a reviewed
Node/npm compatibility change; the repository-root Next output path also still needs
verification. Additional implementation/deploy scope must be authorized. Do not
request more Square keys at this point.

No owned DB/Web/browser/Claude was started. Deploy/readback/remove CLI processes
completed; no background worker. Only this failed deployment was removed.

Evidence: [preview-01-evidence/acceptance-result.json](preview-01-evidence/acceptance-result.json),
[safe build diagnostic](preview-01-evidence/safe-build-diagnostics.json),
[cleanup readback](preview-01-evidence/cleanup-readback.json),
[source diagnosis](preview-01-evidence/source-diagnosis.md).
