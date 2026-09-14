# R12 payment reconciliation — local, not activated

Authority: `PRODUCTION_P6_R12_LOCAL_AUTHORITY.md`. The parent implemented this finite library
on top of R11; no independent model was launched. Real PostgreSQL, provider, browser, Vercel,
runner and business projection are not connected. `ACCEPT_COMPLETED` and `RECONCILED` mean
**validated reconciliation evidence**, never a confirmed booking or a new right to release stock.
All decisions carry `businessApply: NOT_ACTIVATED`; normal `chargeReady=false` remains.

## Receipt, durable signal and dispatch

The unchanged R11 HTTP route verifies exact URL/raw bytes, validates minimum metadata, awaits
committed `square_webhook.receive`, then ACKs. It does not import or invoke R12. We chose a
separate dispatcher instead of adding provider/job contention to the public ACK transaction.

0026 adds `job_dispatched_at` and an indexed eligible-inbox queue; the existing durable inbox is
the future-work signal before ACK. `dispatch(environment, limit)` atomically locks eligible inbox
rows, coalesces a job, inserts the unique event link and marks dispatch complete. A rollback leaves
the inbox eligible. No partial job/link/marker can commit. A recorded hash conflict is excluded
before dispatch or poisons the linked job afterward. Original signal fields are not rewritten.

Dispatch is explicit and bounded (1–100; worker uses at most20). No polling runtime exists yet.
Pending inbox signals therefore remain pending, not silently marked processed. Before activation,
measure undispatched age/count and alert on an unavailable dispatcher; R12 does not claim a live
liveness guarantee. The R11 row's RECEIVED state and R12 dispatch marker describe different steps.
**Do not activate legacy R11 inbox claim/settle concurrently with this dispatcher.** The R12
activation grant list supersedes that historical proposed consumer, while receive remains unchanged.

## Durable model / state transitions

`0026_payment_reconciliation.sql` adds private `payment_reconciliation` tables:

| Table | Purpose |
| --- | --- |
| streams | Environment/merchant/payment identity, generation, latest normalized observation, truth revision |
| jobs | Source event/hash, state, attempt/due time, lease owner/token/expiry, technical deadline, safe decision metadata |
| events | Unique environment/event link to one job; no raw body |
| audit | Job/state/attempt/error/decision/time only |
| provider_stops | Sticky merchant/environment auth or quota stop; no automatic clear |

| Current state | Allowed result |
| --- | --- |
| READY / due RETRY_WAIT | CLAIMED with a new lease token and incremented attempt |
| CLAIMED with expired lease | CLAIMED under a new token, or DEAD at attempt/deadline limit |
| CLAIMED valid lease | RETRY_WAIT, RECONCILED, BLOCKED or DEAD |
| CLAIMED plus additional signal during lookup | Successful finalize preserves READY work in this generation |
| RECONCILED plus a distinct relevant event | A new generation; the old terminal job stays terminal |
| BLOCKED / DEAD / security conflict | No automatic reopen; later events link without resetting budgets |

Partial unique index allows only one READY/CLAIMED/RETRY_WAIT job per payment identity. Several
created/updated events arriving before a claim coalesce into one lookup. Repeated event ID is
deduplicated by the inbox and link PK. Each new relevant post-terminal signal may create a bounded
new generation; it never resets an old job. Retention/rate admission for long-term event history
is an activation/operations gate, not an implicit destructive cleanup.

## Claims, crashes and write fencing

`claim` uses indexed due selection, LIMIT and `FOR UPDATE SKIP LOCKED`; maximum batch20, default
worker batch1. DB clock determines a60-second lease and a fresh UUID token. Finalize takes stream
then job locks, samples time after lock acquisition, and checks token, expiry, job/stream truth
revision and conflict flag. Stale workers cannot settle a new lease. No provider wait occurs in
this transaction. Claim budget includes crash attempts even when no lookup was made.

Repository methods await explicit COMMIT with synchronous_commit, lock/statement/idle timeouts.
An uncertain commit returns a sanitized failure, never an immediate repeat. A future run reads
committed state: a completed job is not claimed again, an uncommitted claim recovers by its lease.
The worker returns `SAVED` with a **proposedState**, not a claim that the DB must have kept that
state (a concurrent signal can leave READY). Diagnostics read the persisted state separately.

Guarantees designed: at-least-once receipt, durable dedupe, atomic claim, idempotent decision,
stale-write rejection and terminal protection. Provider GET may repeat after a crash/response loss;
no globally unique execution or side effect guarantee is asserted. SQL locks, process crashes and
WAL durability still need actual PostgreSQL acceptance; the present concurrency proof is a shared
fixture model plus scripted transaction/static SQL checks.

## Provider authority and existing booking semantics

`PaymentTruthProvider` is provider-neutral. `SquareSandboxPaymentTruth` receives an explicit
transport, has no credential loader/default HTTP implementation, and can only issue the existing
fixed Sandbox `GET /v2/payments/{id}` contract. R12 tests inject fixtures. Version comes from
existing `SQUARE_VERSION`; no new Square protocol or SDK is introduced.

Trusted context comes from the server's persisted payment attempt, using existing unique
provider_id + merchant binding and SQUARE_SANDBOX booking mode with chargeReady=false. It never
uses webhook/browser amount or reference as the expected contract. Contexts are bulk-loaded for
up to20 jobs in one indexed join, avoiding one context SQL round trip per job. Individual finalize
transactions remain intentional; they are not a claim of throughput at500 sets or production load.
Unbound UNKNOWN attempts, orphan Sandbox acceptance payments, or missing context become BLOCKED
before lookup. Do not guess a booking mapping, change idempotency key or retry R10 refunds.

The pure `decidePaymentTruth` engine reuses PaymentRequest, PaymentObservation and matchPayment:
provider/payment, reference, idempotency binding, merchant, location, positive integerJPY amount,
currency, status, provider updated/completed times must match. Copy only the ten normalized
observation fields; strip arbitrary provider fields. Square does not echo request idempotency in
this response: the existing adapter binds it from the trusted attempt and verifies payment ID and
reference; do not misdescribe it as a separately returned provider field.

| Decision | Meaning |
| --- | --- |
| ACCEPT_PENDING | Valid nonterminal observation; bounded follow-up work |
| ACCEPT_COMPLETED / ACCEPT_FAILED / ACCEPT_CANCELED | Valid evidence proposed for a future transactional business boundary |
| NOOP_DUPLICATE | Same normalized observation; PENDING still needs bounded follow-up |
| NOOP_STALE | Older provider timestamp; no downgrade, PENDING still needs bounded follow-up |
| NOOP_TERMINAL | Preserve existing COMPLETED or failed/canceled terminal protection |
| BLOCKED_EVIDENCE_MISMATCH | Contract/identity/money/time evidence is invalid |
| BLOCKED_INVALID_TRANSITION | Failed/canceled evidence contradicts later completion; needs review |

Webhook arrival order is not provider order. Equal provider timestamps can support PENDING to
COMPLETED consistently with the existing BookingService; terminal protection remains. UNKNOWN is
local uncertainty, never a provider enum. Fingerprints hash engine version, expected/current/latest
context, payment ID and normalized decision, not worker clock or webhook receipt order.

BookingService.reconcile/reconcileVerifiedWebhook/recordObservation and the original contracts are
unchanged. Its existing transaction, HOLD/due/claim/transfer/early-discount checks remain the future
projection boundary. Tests invoke the actual recordObservation method with scripted SQL and a
synthetic clock: duplicate event protection, terminal handling, expired-HOLD PAYMENT_REVIEW and
ordinary valid completion remain. These are not actual database/inventory/authorization tests.
A future business apply must re-read/lock current business context after lookup, validate idempotent
apply plus HOLD/stock/payment constraints, and persist apply evidence transactionally. R12's saved
context fingerprint does not lock or authorize booking state. No such write port is composed here.

## Retry, stop and deadlines

Technical limits only: five claims per generation,24-hour age cutoff,60-second lease, at most5s
lookup, default batch1 / maximum20, exponential delay10*2^(attempt-1)*(0.5+jitter), rounded up,
maximum300s. Pending observations use the same bounded follow-up budget. No change to HOLD600s,
booking due, prices or payment idempotency. No scheduler/timer loop; a per-call abort deadline is
finite and cleared. A future real transport must honor AbortSignal; a fake timeout is not proof
that an arbitrary external transport stops its network operation.

| Result | Durable action |
| --- | --- |
| Network / provider5xx | RETRY_WAIT only within attempt/deadline limit |
|401/403 | AUTH_BLOCKED; sticky merchant stop |
|429 | RATE_LIMITED; sticky merchant stop; no automatic retry/account fallback |
|404 | NOT_FOUND_BLOCKED |
| Invalid response / mismatch / missing binding | BLOCKED |
| Attempt/age exhausted | DEAD |

The sequential worker stops the remaining batch when auth/quota is observed. Future claims and
new events respect the persisted merchant stop. Already in-flight calls in another process cannot
be retroactively canceled by that record; this is an explicit live-acceptance limitation. Other
claimed rows expire safely and consume the ordinary attempt budget. A large sequential batch can
also outlive its leases; stale rows are skipped/reclaimed, never accepted late. Default1 avoids
assuming parallel throughput. BLOCKED/DEAD diagnostics are bounded/read-only; no reset UI/API.

## Security and operations

Migration revokes PUBLIC access on schema/tables/sequences/functions, fixes SECURITY DEFINER
search_path, grants no runtime login and writes no booking/inventory/custody tables. Code never
logs raw payloads, credential, signature, Cookie, card/customer data or exception message. Durable
observation has only the existing allowlisted ten fields; hashes bind event and decision evidence.
Safe diagnostics expose job/payment identity, state, generation, attempts, error/decision and time;
lease token is an internal capability and is not a public diagnostic field.

0025 is unchanged.0026 is additive; older migration assertions now include the next version, but
actual migration/integration scripts were not run. Rollback follows the repository's forward
migration/drift policy: disable future consumers and preserve inbox/job/audit rows; do not rewrite
applied0025/0026 or delete evidence. Any corrective DDL needs a later additive migration.

See `PRODUCTION_P6_RECONCILIATION_ACTIVATION_GATE.md` for explicit untested/unauthorized steps and
`p6/r12-local/RESULT.md` for source hashes, test logs and exact commits.
