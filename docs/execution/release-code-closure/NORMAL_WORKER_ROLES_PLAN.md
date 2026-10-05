# Normal worker — three-role credential plan, scheduler, monitoring and stop (minimal delta)

Authority: Issue 47 (Owner direct instruction 2026-10-04; TD continuation). This is a plan and an acceptance contract. It does
not apply anything. Application needs the new candidate's independent TD review and natural CI, the pre-migration Production
backup, migrations 0054/0055 and the four approved EXECUTE grants (all already specified in `PUBLICATION_HANDOFF.md`).

Out of scope and unchanged: the ten commercial roles (production-credential-activation/5, complete — never reset, restarted or
re-activated), the five expired F2 payment-role windows (never extended, renewed or reused), refund/notification limits (fixed 0
in code), the held M4 outbox, and any real payment, refund or mail.

## 1. Roles, purpose, privilege, sink, validity, stop

| Role (`<db>` = `neondb`) | Used for | Privilege (existing, reviewed) | Production sink (name only) | Validity / rotation | Stop and failure handling |
|---|---|---|---|---|---|
| `<db>_pay_dispatch` (`dispatcher`) | Enqueue reconciliation jobs for provider-bound production payments created after the cutoff | CONNECT; USAGE on `payment_reconciliation`; EXECUTE `dispatch_normal(text,integer,timestamptz)` (approved EXECUTE 1 of 4) plus its existing production dispatch functions; no table access | `PRODUCTION_WORKER_DB_PASSWORD_DISPATCHER` (Production, sensitive) | LOGIN with `VALID UNTIL 'infinity'` only after the proof chain below; rotate on suspicion or personnel change, one role at a time | Contained to `NOLOGIN PASSWORD NULL VALID UNTIL 'infinity'` (idempotent) after the scheduler is disabled and drained |
| `<db>_pay_truth` (`worker`) | Claim jobs under a lease, load persisted context, finalize with a fenced lease token | USAGE on `payment_reconciliation`; EXECUTE `claim_normal(text,integer,text,timestamptz)` (EXECUTE 2 of 4), `claim_production`, `finalize_production`, `load_context_production`; no table access | `PRODUCTION_WORKER_DB_PASSWORD_WORKER` | as above | as above |
| `<db>_pay_projection` (`projector`) | Project settled provider truth into the booking/hold/attempt state in one transaction | EXECUTE `payment_projection.normal_candidates(text,timestamptz,integer)` (EXECUTE 3 of 4) and the existing projection functions; column-limited SELECT/UPDATE listed in `productionPaymentActivationGrants`; no new table or DML grant | `PRODUCTION_WORKER_DB_PASSWORD_PROJECTOR` | as above | as above |
| `<db>_operations` (existing, already active) | Read-only backlog metric; notification/refund ports (limits 0) | Existing grants plus EXECUTE `notification_due_normal(timestamptz,integer)` (EXECUTE 4 of 4) | none new (existing commercial sink) | unchanged | unchanged |

No role gains membership in another role, ownership, CREATE, or any table/DML privilege through this plan. The only new
database privileges are the four EXECUTE grants Owner-approved in Issue 47 comment 5970223877.

Other new names (environment of project `zao-rental`, Production target):

| Name | Kind | Meaning |
|---|---|---|
| `CRON_SECRET` | sensitive, random ≥32 characters | Vercel sends it as `Authorization: Bearer`; the route compares in constant time. **Bound first** (step 1), before any activation, so the dark reach proof can exist |
| `PRODUCTION_WORKER_ACCEPTED_AFTER` | plain, UTC `YYYY-MM-DDTHH:MM:SSZ` | Cutoff after the F2 window (never earlier than 2026-10-03T09:14:39Z, never in the future) |
| `PRODUCTION_WORKER_TICK_ACTIVATION` | plain, exactly `NORMAL_WORKER_TICK_APPROVED` | Start switch; absent means the route answers `NOT_ACTIVATED` without touching the database or provider. Set last |

## 2. Credential lifecycle (reuses the reviewed v5 state machine, generalized to this role family)

Contract `production-credential-activation/6` = the same one-shot chain as `/5`, with the role set replaced by the three roles
above and the sink names above. Each role, serially, only from a clean baseline:

1. Baseline containment to `NOLOGIN PASSWORD NULL VALID UNTIL 'infinity'` (idempotent; this resets nothing that is in use — the
   F2 window roles are expired, and this is a fresh containment, not an extension).
2. Temporary password and `VALID UNTIL 'infinity'` while NOLOGIN, then exactly one Neon `reset_password`; never retried blindly.
3. `LOGIN` with a bounded `VALID UNTIL` lease derived from database time.
4. Direct TLS login with the real client path (`acceptanceDatabaseConfig`, verify-full, channel binding), `verifyAcceptanceRole`,
   and the role's `has_function_privilege` check (what `runProductionWorker` itself enforces).
5. Write the Production sensitive sink; read back metadata only (never the value).
6. One-shot finalization `VALID UNTIL 'infinity'` with its readback. Any failed step ends in containment (NOLOGIN, sink deleted).

Rotation is the same chain for one role at a time while the scheduler is Disabled and drained; the new value reaches the
running deployment only through the next deployment of the already accepted release (environment is bound at build).

## 3. Scheduler, activation order and first reach proof

Vercel Cron (Pro plan confirmed) calls `GET /api/internal/worker-tick` every minute; one finite tick (`maxDuration` 60 s, plan
deadline 50 s, batch 20). No GitHub Actions workflow and no copy of the commercial secrets are created.

The route checks the `Authorization: Bearer` header **before** it checks activation, and an unauthorized call logs nothing. So a
dormant log line can only exist when the deployment already carries `CRON_SECRET` and the platform sent the matching header:
`CRON_SECRET` is bound first and independently of any database or provider activation. Fixed order (machine-checked against
`scripts/production-activation-plan.ts`):

```
ACTIVATION_ORDER
1. BIND_CRON_SECRET
2. DEPLOY_ACCEPTED_RELEASE_DARK
3. VERIFY_REAL_CRON_DORMANT_LOG
4. ACTIVATE_WORKER_ROLE_CREDENTIALS
5. BIND_ACCEPTED_AFTER_CUTOFF
6. BIND_ACTIVATION_TOKEN_LAST
```

1. Bind `CRON_SECRET` (Production, sensitive, random ≥32 characters). Nothing else of this plan is bound: no worker role password,
   no cutoff, **no `PRODUCTION_WORKER_TICK_ACTIVATION`**.
2. Deploy the accepted release dark (cron definition present). Environment is bound at build, so a later environment change
   reaches the runtime only through a new deployment of the same accepted release (environment-only, no code change).
3. **Dark reach proof:** the real Vercel scheduler calls the route with its own `Authorization: Bearer <CRON_SECRET>` and the runtime
   logs show one `normal_worker_tick_dormant` line per minute, no `normal_worker_tick` line and no database or provider work.
   Whether Vercel Cron passes the project's All Deployments protection is **not documented and not yet verified**; the dormant
   lines are the only proof. Their absence is never success (it means the scheduler is not arriving or not authorized). A manual
   `curl` — even with the secret — never substitutes for the scheduler, protection is not removed to make it pass, and activation
   is never bound ahead of this proof.
   The proof is **machine-collected**: the exact dark deployment id is written to `.local/evidence/production-worker/dark-deployment-id.txt`
   (the deploy is run from the clean accepted-main checkout with `vercel deploy --prod`, so Vercel records the commit itself), then
   `npm run production:worker-dormant-proof` (read-only: three `vercel api` GETs and `vercel logs --json`) builds `dormant-proof.json`
   only if that deployment is READY, the project's current production deployment, built from the accepted `origin/main` commit with the
   cron defined, protection still `all`, `CRON_SECRET` the only sensitive Production binding of this plan, and the route's whole
   request log in a 15-minute window is GET 200 `normal_worker_tick_dormant` over at least three distinct minutes at one-minute
   cadence, the latest within five minutes, with no `normal_worker_tick` line. `provisionWorkerRoles` does not read the file as
   truth: it re-derives every claim from live readbacks, so a stale, hand-written or minimal file, a deployment that is no longer
   current, an activation name already bound or a protection change all refuse before any mutation.
   Readbacks are all-or-nothing: a reduced deployment view (no `projectId`, `crons`, `createdAt` or `meta`), a missing `readyState`,
   `target`, `crons` or protection field, a non-zero CLI exit, unparseable output, an env list with a further page or hidden
   production variables (`pagination.next`, `hiddenProductionEnvCount` — an absence claim needs the whole list), a log that reached
   its `--limit`, a log row without a path or a log item of an unknown shape are each a refusal, never a default. Log rows that carry
   a `projectId` / `environment` must match this project / production.
   **What "real Cron" rests on.** Vercel documents the scheduler's `vercel-cron/1.0` user agent, the `x-vercel-cron-schedule` header and
   a `cron` request type, but none of them is a field of the `vercel logs --json` rows (the REST runtime-log schema has none either), so
   they are neither read nor trusted and the event name alone never decides. The proof rests on the Bearer secret (checked before the
   dormant line, generated in memory and never shown), the deployment being production and current, and the cadence rule; delivery is
   documented as best effort (a minute can arrive twice or be missed, which the cadence rule tolerates up to one missed minute).
   A platform-side on-demand run (dashboard "Run", `vercel crons run`) cannot be told apart from the schedule in this log: the
   cadence rule only makes faking it by hand impractical, and they must not be used during the proof window.
4. Only after step 3: worker role credentials per section 2 (sinks written, probes passed).
5. `PRODUCTION_WORKER_ACCEPTED_AFTER`.
6. `PRODUCTION_WORKER_TICK_ACTIVATION` last, in the final environment-only deployment, then watch the first ticks.

Also unverified until that first dark run: that the Vercel Node runtime carries none of `NODE_TLS_REJECT_UNAUTHORIZED`,
`NODE_EXTRA_CA_CERTS`, `SSL_CERT_FILE`, `SSL_CERT_DIR` (the worker refuses to run if any is set).

## 4. Monitoring (no migration, no new service)

- Every tick logs one JSON line: `normal_worker_tick` with `state` (`COMPLETED` is the only success), counters, the read-only
  backlog (`pendingPayments`, `oldestPendingAgeSeconds` — provider-bound, non-terminal production payments) and duration;
  `normal_worker_tick_dormant` when not activated. Unauthorized calls log nothing.
- `scripts/production-worker-freshness.ts` evaluates those lines from outside the worker (`vercel logs … --json | npm run
  monitor:worker-freshness -- --expected-active`): alert when no `COMPLETED` tick for 5 minutes, three consecutive non-success ticks,
  oldest pending age over 15 minutes, or a dormant answer while active is expected. `--intentional-stop` never alerts and a
  dormant/NOT_ACTIVATED tick is never counted as success. Sending an alert is held until a recipient is confirmed.
- A provider stop (`PROVIDER_STOP`) and any failure return HTTP 500 so the scheduled run is visibly failed in the cron history.

## 5. Stop, drain and rollback

1. **Disable** the cron job in project settings (the scheduler is the origin of every tick; `CRON_SECRET` removal or role expiry
   alone is not a stop). Cron delivery is best-effort and may duplicate or miss runs; the SQL lease and durable claims make that safe.
2. **Drain**: wait at least 90 s (plan deadline 50 s + the existing lookup timeout); confirm the last `normal_worker_tick` line is
   complete and `pg_stat_activity` shows no `zao_normal_worker_%` sessions. Never interrupt an in-flight tick; the worker only
   reads from the provider in this phase (refund-create limit 0), and no non-idempotent request is resent in any case.
3. Only then remove `PRODUCTION_WORKER_TICK_ACTIVATION` (effective at the next deployment) and, if needed, contain the roles.
4. **Rollback**: Instant Rollback to the recorded accepted deployment (per Vercel's documentation the cron jobs defined in the
   rolled-back deployment are the ones invoked from the next scheduled run); keep protection and sales-off; no destructive
   database change.
5. UNKNOWN stays UNKNOWN: a dispatched refund or payment without a provider identity is never re-POSTed or looked up.

## 6. Acceptance already proven on synthetic data (real PostgreSQL, fake provider)

`tests/unit/worker-tick.test.ts`, `tests/unit/worker-freshness.test.ts`, `tests/e2e/foundation.spec.ts` (anonymous 401, no cache,
no redirect, POST 405), `tests/readiness/normal-worker-acceptance.ts` (two consumers, claim crash, UNKNOWN never resent, bounded
CREATE/LOOKUP lanes) and `tests/readiness/normal-worker-continuity.ts` (two independent sessions at once, backlog larger than a
batch drained exactly once, skipped ticks recovered, stopped consumer recovered after lease expiry, warm repeated ticks, every
session gone after cleanup, backlog metric). **Not proven here:** the real Vercel scheduler under protection, real TLS role
identity inside the Vercel runtime, real Square lookups.
