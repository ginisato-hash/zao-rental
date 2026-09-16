# R12 local implementation result — activation pending

R11 completed and remains recorded at `p6/s4-local/RESULT.md` (304 tests passed). R12 continued
without another model or an Owner handoff. Started2026-09-14T17:23:50Z /2026-09-15T02:23:50+09:00.

| Reference | Exact identity |
| --- | --- |
| R12 starting / R11 final HEAD | 78c99d7c2d8d22fedde0cbf884a609dbedfc414f |
| Authority commit | d91a4e6573c211898bbb392867d012a224e1171f |
| Main implementation | 713287e1b47ec43881c5788ee45c495d26bf121b |
| SQL composite access clarification / validated source | d1465c8d14acf08ad339e3dd2fb0546f1e85e1b9 |
| Validated source tree | b7e2300d8fd89ddb27577f94e56ea93f01a41067 |
| Main unchanged | 3061dbbbe00294e5baebba2405028c907d6e6e85 |
| Branch | codex/external-acceptance-p6 |

These commits were normally pushed and read back exactly (see publish JSONs). The final evidence
commit containing this result changes docs/status/logs only; resolve it with
`git log -1 --format=%H -- docs/execution/p6/r12-local/RESULT.md`. Source hashes bind all15
implementation/test/architecture files independently of that later evidence commit.

## Implemented scope

- R11 webhook ACK/inbox path unchanged. Separate atomic dispatch to durable0026 jobs/event links.
- One active job per environment/merchant/payment, event dedupe, terminal new generations, conflict
  poisoning, no automatic BLOCKED/DEAD reopen. Durable merchant AUTH_BLOCKED/RATE_LIMITED stop.
- Bounded SKIP LOCKED claims,60-second lease/token/revision fencing, five-attempt/24-hour budget,
  pure exponential jitter/backoff maximum300s, bounded read-only diagnostics and bulk expected-context query.
- Provider-neutral lookup port; injected unconnected Square Sandbox read adapter; pure ten-field
  normalized truth decision engine. Existing matchPayment and booking semantics retained.
- ACCEPT_PENDING/COMPLETED/FAILED/CANCELED, NOOP_DUPLICATE/STALE/TERMINAL,
  BLOCKED_EVIDENCE_MISMATCH/INVALID_TRANSITION. Business apply **NOT_ACTIVATED**.
- State: READY → CLAIMED → RETRY_WAIT / RECONCILED / BLOCKED / DEAD. New signal during lookup
  stays READY work; results report SAVED/proposedState without overstating the persisted state.

## Verification and limits

382/382 unit/readiness fixture/static tests, including78 new R12 cases. Failed0/skipped0.
R11 receiver/inbox, existing payment boundaries, contracts and scripted actual BookingService
recordObservation regressions included. Secret pattern scan, lint, typecheck, secretless Next build
all exit0. Initial lint unused-import warning (exit1) is preserved in lint-01.log; corrected before
final checks. Full command args/times/exit codes and log hashes are in validation.json.

Concurrency/crash/provider behavior uses a shared in-memory fixture, finite fake adapters and
scripted SQL protocol. Static migration checks are not a PostgreSQL syntax/apply/lock/WAL proof.
No full verify, actual DB/UI/provider acceptance, remote CI or independent Claude review was run.
The existing branch has no open PR; no new PR or workflow dispatch was created. Activation gates
include actual role denial, indexed query plans, live process crashes, network abort and business
revalidation. Do not equate these local results with production readiness or payment confirmation.

## Preservation and cleanup

Earlier25 migration files, ten existing receiver/payment/business source files and historical
R3/R4/R6/R7/R8/R9/R10/R11 status objects are unchanged against the starting commit (preservation.json).
R12 authority is an exact copy, SHA256 d2ed36a06be5435e373f1ed8ce97ca17b151b0c9c9d9408e2d4f7dd68541bbbc.

R10 remains LAST_OBSERVED_PENDING / S3_NONTERMINAL_DO_NOT_RETRY, finalization DEFERRED_NON_GATING.
No retry, additional lookup, refund, new idempotency key or reinterpretation of that evidence.

R12 prohibited external counts: Square/provider requests0, payment/refund0, webhook subscriptions/
real deliveries0, PostgreSQL connection/apply0, Vercel/auth/deploy/env0, browser/Playwright0,
Production0, Claude/Spark0, Runner/cron0. GitHub normal pushes/readback are the authorized exception.
No DB/Web/browser/Claude resources were started. All finite validation children exited; no unrelated
process, accepted Preview, provider object or existing service was changed.

## Next authority

Read `../../PRODUCTION_P6_RECONCILIATION_ACTIVATION_GATE.md` and
`../../PAYMENT_RECONCILIATION_ARCHITECTURE.md`. The next Owner action is **live webhook +
reconciliation activation authority**, explicitly separating dedicated DB/apply/grants, protected
webhook delivery, bounded actual GetPayment runtime and future transactional business projection.
No current action/approval request or R10 retry is needed to complete this local task.
