# R12 live webhook + reconciliation activation gate

This is a readiness record, **not execution authority**. R11 receiver/inbox and R12 jobs/worker/
truth engine are LOCAL_IMPLEMENTED. SQL is unapplied, runtime/provider/business apply disabled.
R10 remains LAST_OBSERVED_PENDING / S3_NONTERMINAL_DO_NOT_RETRY; finalization is deferred,
non-gating, and no further refund lookup or refund is included in this gate.

The next Owner authority must explicitly bind scope, budgets, exact code/deployment, dedicated
synthetic Sandbox DB, provider identities, protected ingress and cleanup. No login is needed for
finishing the current local task; all following live steps remain NOT_RUN.

| Gate | Evidence needed under separate authority |
| --- | --- |
| Dedicated dev PostgreSQL | Apply0025/0026 only to the approved isolated DB; migration drift/recovery, constraints/index plans, two-connection races, durable ACK/dispatch and actual process-crash tests |
| Runtime least privilege | Receiver receive-only; dispatcher dispatch-only; worker claim/finalize + trusted context reads; diagnostic read-only. Specific EXECUTE/USAGE grants after inspecting inherited PUBLIC/table privileges, no migration credential or business mutation grants |
| Consumer selection | R12 dispatcher consumes the RECEIVED+undispatched queue; do not also activate R11 legacy claim/settle consumers |
| Protected webhook delivery | Approved exact URL, signature secret and subscription; real raw-body signature/delivery evidence through a Protection-compatible machine ingress. No blanket Vercel bypass or secret URL |
| Finite worker | Explicit bounded run/batch/attempt/time budget and owned cleanup; no implied cron/daemon/Runner permission |
| Real GetPayment | Explicit Sandbox merchant/payment allowlist and lookup count; existing approved secret store only. Unknown payment-to-attempt binding blocks rather than guessing |
| Business projection | Separate approval, transactional apply/revalidation/idempotency evidence, expired HOLD/stock/terminal safety; ACCEPT_COMPLETED alone must not confirm a booking |
| Operational retention | Pending inbox age/count/alert, terminal/BLOCKED/DEAD counts, dedupe/observation/audit retention, controlled operator recovery, provider-stop policy and measured load |

No grants or roles are executed by0026. The SQL functions' future definer owner and EXECUTE callers
must be reviewed as a trust boundary. Read-only context functions can expose internal synthetic
payment identifiers/amount, not raw provider bodies; their future role cannot be a public guest.
The SQL retains generic environment isolation, but only the unconnected Sandbox adapter/context
path is implemented. No Production composition, credentials or endpoint activation is supplied.

## Mandatory actual-DB tests (not replaced by fixture success)

1. Two concurrent dispatchers: durable inbox signal to unique link/job/marker; rollback or unknown
   COMMIT response does not lose work. Hash conflicts before/after dispatch preserve original data.
2. Two workers: only one valid lease; expiry and process death recover; old token/revision cannot
   finalize. No HTTP inside transaction; statement/lock/idle failures release or discard connection.
3. New signal during lookup keeps READY work; terminal creates a new generation; BLOCKED/DEAD and
   auth/quota stop cannot reset by fresh events. Five attempts and24-hour cutoff hold at DB clock.
4. Indexed bounded query plans with unrelated payments/events; bulk context load versus repeated SQL;
   lease expiry for later rows in a sequential batch is visible, not hidden as successful processing.
5. Conflicting redelivery invalidates ongoing work; terminal history retained. Invalid normalized
   observation, out-of-range amount, stale revision and forbidden business/table writes are denied.
6. Restore/restart retains inbox/job/link/audit/stop and accepted provider observation. Verify WAL/
   durability rather than inferring it from mocked COMMIT. No destructive rollback of retained rows.

## Mandatory provider/runtime acceptance (also NOT_RUN)

- Actual approved Sandbox GetPayment with correct amountJPY, merchant/location, payment/reference
  binding and provider timestamps. Keep fixture-call counts separate from actual HTTP requests.
- Network abort/timeout and uncertain outcome recovery with the real adapter honoring AbortSignal;
  no new CreatePayment/refund/idempotency key; no repeated auth/quota calls or account fallback.
- Real duplicate/out-of-order webhook deliveries, pending then completed observations; record only
  sanitized IDs/hashes/status/time. Keep provider response bodies, signatures and credentials out.
- Concurrent-process auth/quota stop cannot cancel already-dispatched calls; choose admission and
  in-flight budget explicitly. Controlled diagnostic/recovery policy needs separate authorization.
- Revalidate current booking state in a future business transaction; no release/confirmation from
  webhook payload or stale context. Existing confirmed-stock and expired-HOLD regression required.
- DB-unavailable ACK5xx, dispatcher-unavailable backlog alert, runtime misconfiguration fail closed;
  deployments, env changes, subscriptions and quotas require explicit permission and metadata evidence.

## Current scope / cleanup

R12 actual provider/Square/payment/refund/webhook/DB/Vercel/browser/Playwright/model/Runner/Production
counts are0. No real credentials were read, extracted, copied or rotated. No browser, DB/Web server,
background worker or unrelated service was started/stopped. Finite tests/build children exited.
No new PR or main merge; save commits to the existing branch via existing GitHub auth only.

Next Owner action: **live webhook + reconciliation activation authority**, with the above gates
separated. That action must not silently revive R10 refund work or authorize Production/business apply.
