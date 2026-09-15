# R13: Transactional payment projection (local only)

Status: LOCAL_IMPLEMENTED / FIXTURE_VERIFIED. Business apply live wiring: NOT_ACTIVATED.
Authority: [R13 original](PRODUCTION_P6_R13_LOCAL_AUTHORITY.md). Original R11/R12 evidence and R10 `LAST_OBSERVED_PENDING / S3_NONTERMINAL_DO_NOT_RETRY` are unchanged.

## Responsibility and authority

Provider GET → R12 truth validation and durable stream/job → explicit persisted reference → R13 pure business decision → one transaction → business states and projection receipt.

`PaymentProjectionPort.project(ProjectionReference)` accepts only booking/attempt/job identifiers, truth revision/fingerprint, normalized observation fingerprint and expected projection revision. It does not accept an observation, webhook payload, amount, paid flag or runtime credential from the caller. `PgPaymentProjection` re-reads the persisted R12 stream/job under locks. Hashes detect inconsistent evidence; they are not authentication and must never be exposed as an authorization bypass. There is no public route or runtime composition.

Source acceptance requires SANDBOX; RECONCILED or RETRY_WAIT evidence; no security block; the exact stream revision; ACCEPT_<status> or NOOP_DUPLICATE; recomputed R12 decision fingerprint; exact normalized observation hash and merchant/payment identity. Unsupported, uncommitted, superseded or security-blocked source is rejected before mutation. The source receipt identifies the R12 decision/context that was accepted. A later R12 stream cannot silently replace the referenced observation.

The pure decision separately checks persisted attempt/booking identity, expected amount and JPY, reference/idempotency/provider/merchant/location, commercial snapshot and quote relation, original HOLD conditions/due, protection and transfer facts. Ten allowlisted provider fields are normalized; raw provider/webhook bodies, contacts, card data and secrets never enter the journal. An invalid internal source is an error, not booking confirmation.

## Existing semantics

No booking/payment/HOLD business states were added. Existing `BookingService` and R12 worker remain unmodified and unconnected to the new port. `CONFIRMED_DEV` remains development-only; `chargeReady=false` remains required. This does not complete a production payment path.

| Decision | Existing state effects |
|---|---|
| KEEP_PENDING | attempt PENDING; HOLD payment PENDING; booking unchanged |
| APPLY_COMPLETED | attempt COMPLETED; booking CONFIRMED_DEV; HOLD payment SUCCESS and confirmed_at; original TTL/conditions/price untouched |
| APPLY_FAILED / APPLY_CANCELED | attempt FAILED (provider_state preserves FAILED/CANCELED); booking PAYMENT_REVIEW; HOLD payment FAILURE; no release/deletion/retry |
| BLOCK_EXPIRED_HOLD / BLOCK_INVENTORY_DRIFT / BLOCK_TRANSFER_ATTENTION / BLOCK_PRICE_INTEGRITY for COMPLETED | accepted provider COMPLETED retained; attempt REVIEW and booking PAYMENT_REVIEW; HOLD/claims not revived or reacquired; operator required |
| BLOCK_IDENTITY_MISMATCH / BLOCK_CONFLICT / invalid target or terminal transition | no unsafe business write; source truth remains; explicit diagnostic or safe no-op |
| NOOP_DUPLICATE / NOOP_STALE / NOOP_TERMINAL | no business regression, duplicate confirmation or notification |

For other invalid HOLD transitions, COMPLETED may be retained as REVIEW without changing the HOLD; contradictory terminal failure-to-completion remains blocked. REVIEW containing completed truth is never automatically repaired merely because inventory later looks valid.

Older observations cannot regress state. Identical normalized observation fingerprints dedupe. Different content at the same provider timestamp is BLOCK_CONFLICT on this new path, as R13 explicitly requires. Historical R12/BookingService same-time transition semantics are retained; fixtures cover this deliberate distinction.

## Transaction and lock order

`BEGIN` → local transaction timeouts / synchronous_commit → dedicated development DB name check → existing advisory lock **71820600** → booking → attempt → HOLD → projection head → quote and claims/transfer reads → R12 stream → R12 job → final DB clock → decision → business writes → head CAS → append-only event → job receipt → explicit `COMMIT`.

The global lock is the existing inventory/BookingService convention, not a new lock. It must be acquired before row locks, matching legacy writers and their triggers. R12 stream-before-job order is preserved. R12 finalization never takes the business advisory lock; no R13 HTTP/provider callback runs while locked. A future caller must not enter R13 while holding a R12 stream/job lock: commit the truth phase first. Tests inspect the order and model contention; they do not establish PostgreSQL deadlock freedom.

Clock is sampled after source-lock waits and immediately before writes. Confirmation SQL repeats active/provisional/payment/expiry/due conditions using `inventory_clock()`. If a boundary is crossed after proposed writes, zero affected HOLD rows aborts and rolls back everything. A later explicit replay can record the BLOCK instead; no automatic retry is installed. Price snapshot/dates/HOLD TTL never change.

The repository is instantiated only from an injected pool. No Pool, URL, credentials or environment reader is supplied. NODE_ENV production rejects projection, and the DB-name guard permits only the existing `zr_<12 hex>` development naming convention. These guards are defense in depth, not a complete privilege boundary. The module has no runtime importer. Actual least-privilege DB grants remain a separate activation gate.

## Dedupe, history and R12 job finalization

Migration 0027 adds private `payment_projection.heads`, `events`, `job_receipts` only. Existing 0001–0026 are unchanged. Unique `(attempt_id, observation_fingerprint)` fences repeat business effects; unique `(attempt_id, revision)` and a head compare-and-swap fence stale decisions. Provider ID/timestamp, truth/observation/decision hashes, previous/new states, block decision, revision and DB time are saved. Journal and job receipts reject UPDATE/DELETE. PUBLIC access is revoked; there are no new grants or roles.

Business state, existing audit-trigger effects, projection event and R12 job receipt share a transaction. Audit uses the original initiating actor, with `INTERNAL_LOCAL_PROJECTION` origin explicitly recorded in the new journal; this is not a claim that the customer/staff acted during projection. Future live execution needs an approved service principal and scoped rights. The fixture models existing audit effects; real triggers have not run here.

R12 `RECONCILED` means provider truth persisted, not booking confirmed. Truth finalization commits first. Only the presence of a R13 receipt proves that this observation was considered for business projection. A job may therefore be RECONCILED while business projection is absent or BLOCKED. A future finite consumer must reconcile accepted truth without a receipt; it cannot rely solely on R12 claimBatch, which correctly excludes terminal truth jobs. No consumer, schedule, fallback or runtime wiring is activated here.

Same job/fingerprint replay returns the validated stored result before current clock/revision checks, without mutation. A new R12 generation of the same observation must prove its current accepted source; it adds only a job receipt referencing the existing event. COMMIT response loss is reconciled by replaying that reference, not another payment key. The replay result is a **historical projection receipt**, not a live booking authorization/view. Current state must still be read through existing authorized get/list paths.

Crash before R12 finalization leaves no accepted proof. Lease recovery may perform another fixture lookup and persist truth; it cannot create a second payment. Crash before/during R13 commit leaves no partial business state. Crash after commit returns the saved receipt on explicit replay. R12 truth remains durable regardless of R13 rollback. The combined fixture exercises these phases and a later duplicate job generation.

No notifications are created by R13, including the old synthetic CAPTURED record. Legacy notification behavior is preserved in BookingService fixtures. Delivery/outbox composition is a later gate; confirmation must not be equated with notification delivery.

## Bounded work and evidence limits

Projection addresses one booking/attempt/job by indexed keys. Claim read is one union capped at 1401 rows; validation uses a keyed map, not per-item SQL. Existing schema caps 20 members, 10 days and five items per member (1000 required rows maximum); the 1401 query cap is conservative and does not expand the business contract. Overflow/duplicates/missing or incompatible rows block instead of silently accepting a prefix. Transfer aggregation is scoped to the HOLD. No all-inventory query or new distributed infrastructure was added.

500 sets is a design target, **not a measured throughput result**. Existing global serialization, query plans, disk durability, actual constraints/trigger effects and real concurrent PostgreSQL transactions remain untested in R13. SQL tests are static inspection and scripted responses; shared-memory interleavings are fixture evidence only. No browser, DB, provider, Vercel, model or Runner was started.

See [activation gate](PRODUCTION_P6_BUSINESS_PROJECTION_ACTIVATION_GATE.md) and [local result](p6/r13-local/RESULT.md).
