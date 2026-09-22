# PROD-R7 — Square/webhook static security hardening (audit + one closed gap)

Base: `main` `72628ba0e06ef1518e45b7178a577dc484adb9f2`. Branch `claude/prod-r7-webhook-hardening`. Worktree `work/prod-r7-webhook-hardening`. No PR — same discipline as R4/R5/R6.

## Audit: signature verification, replay window, dedup/ordering, merchant allowlisting, log redaction

Read [square-boundary.ts](../../../packages/core/src/payment/square-boundary.ts), [square-webhook-receiver.ts](../../../packages/core/src/payment/square-webhook-receiver.ts), [square-webhook-inbox.ts](../../../packages/core/src/payment/square-webhook-inbox.ts) (core interface), [packages/db/src/square-webhook-inbox.ts](../../../packages/db/src/square-webhook-inbox.ts), and migration [0025_square_webhook_inbox.sql](../../../packages/db/migrations/0025_square_webhook_inbox.sql). No defect found in any of the following; each is enforced exactly where it should be:

- **Signature verification**: `verifySquareWebhook` ([square-boundary.ts:5](../../../packages/core/src/payment/square-boundary.ts)) computes HMAC-SHA256 over `notificationUrl + raw body` (Square's documented contract) and compares with `timingSafeEqual`, not `===`. Body capped at 65536 bytes, signature shape-checked as exactly a 32-byte base64 value, `notificationUrl` required to be `https://`, before any HMAC computation runs.
- **Body-size DoS floor enforced twice**: `rawBytes()` in the receiver rejects on `Content-Length` before reading, and again on a running total while streaming — a client that lies about `Content-Length` or omits it entirely still can't force an oversized read.
- **Signature checked before JSON parsing**: an unsigned or wrongly-signed body is rejected (403) before `JSON.parse` ever runs on it.
- **Merchant allowlisting**: `envelope.merchant_id !== config.merchantId` is rejected 403 — a signed webhook for a different (even legitimate Square) merchant is not accepted.
- **Event-type allowlisting without breaking Square's retry contract**: only `payment.created`/`payment.updated` are queued; any other correctly-signed, correct-merchant event gets an explicit `200 IGNORED_UNSUPPORTED_EVENT` — this is a deliberate exception so Square doesn't retry forever on an event type this app doesn't (yet) act on, and the code comments this explicitly as "NOT a durable payment ACK."
- **Replay/dedup**: durable, not in-memory — `PRIMARY KEY(environment, event_id)` in `square_webhook.inbox`, with `receive()` using `INSERT ... ON CONFLICT DO NOTHING` then a `FOR UPDATE` re-check. A genuine duplicate (same id, same body hash, same type/merchant/payment) returns `DUPLICATE`; an event ID reused with **different** content is flagged `HASH_CONFLICT` and the row is marked `BLOCKED` with a bounded `conflict_count` — it is never silently overwritten or replayed.
- **Ordering/lease fencing for reconciliation**: `claim()` uses `FOR UPDATE SKIP LOCKED` ordered by `(received_at, event_id)`, a `claim_token`/`lease_until` pair, and bounded attempts (max 5 → `BLOCKED`/`ATTEMPTS_EXHAUSTED`); `settle()` only applies if `claim_token` and an unexpired lease still match — a worker whose lease already expired (reclaimed by another worker) cannot retroactively settle a claim it no longer holds.
- **`SECURITY DEFINER SET search_path=pg_catalog,pg_temp`** on all three SQL functions — the standard Postgres hardening against search-path hijacking for definer-rights functions.
- **Log/response redaction**: the receiver's `reply()` never echoes back request content; every failure path returns a fixed classification string, never a raw error message, stack trace, or DB error detail (`catch{return reply(503,'WEBHOOK_INBOX_UNAVAILABLE')}` swallows the real cause completely). Retry-count/reason and forwarded-URL/Host headers are explicitly *not* trusted for anything (per the file's own header comment) — confirmed no code path reads them.

## One real gap found and closed: the receiver/reconciler roles never actually existed

Migration `0025`'s own closing comment already specified least-privilege receiver/reconciler roles as future work ("Future dedicated receiver login: USAGE square_webhook + EXECUTE receive(...) only. Separate reconciler login: ... claim/settle only.") — but no migration, anywhere in this repository, ever created them (`grep -rl square_webhook_receiver` across `packages/db/migrations` and `scripts` returned nothing before this branch). Until this is closed, the only way to run the receiver/reconciler in Production would be to hand them some existing broader credential — exactly the kind of privilege creep this project's other roles (`_custody_executor`, the new PROD-R4 `_backup`) are designed to avoid.

- [packages/db/migrations/0040_square_webhook_roles.sql](../../../packages/db/migrations/0040_square_webhook_roles.sql) — additive migration creating exactly what the 0025 comment described: `<database>_square_webhook_receiver` (`EXECUTE` on `receive()` only) and `<database>_square_webhook_reconciler` (`EXECUTE` on `claim()`/`settle()` only), both `NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOREPLICATION NOBYPASSRLS` — inert until an operator separately flips one to LOGIN with a real password, out of band, never in git, exactly mirroring PROD-R4's `_backup` role. Registered in the Production-bootstrap guard-rewrite mechanism (`GUARD_MIGRATIONS` 12→13, matching R4's pattern) since these are structural roles needed identically in every environment. `npm run test:m2b-bootstrap`: 14/14 PASS, `migrations:40`, `guardsRewritten:13`, `STRUCTURAL_EQUIVALENCE`/`SECURITY_EQUIVALENCE` both PASS.
- [scripts/webhook-roles.ts](../../../scripts/webhook-roles.ts) (new) — `provisionWebhookReceiverRole`/`provisionWebhookReconcilerRole`, matching the established `scripts/custody-roles.ts`/`scripts/backup-roles.ts` convention: local-cluster-only, fresh random password, no privilege grants of its own.
- [tests/readiness/square-webhook-roles.ts](../../../tests/readiness/square-webhook-roles.ts) (new, `npm run test:square-webhook-roles`, wired into `scripts/verify.mjs`) — 4 cases against a real local PostgreSQL cluster: role-attribute proof, the receiver can call `receive()` (INSERTED/DUPLICATE) but is rejected calling `claim()`/`settle()` or touching `square_webhook.inbox` directly, the reconciler can `claim()`/`settle()` but is rejected calling `receive()` or touching the table directly, and a **mutation test**: revoking the receiver's one `EXECUTE` grant breaks `receive()`, re-granting restores it. All 4 PASS.

## Verification

- `npm run test:m2b-bootstrap`: 14/14 PASS (`migrations:40`, `guardsRewritten:13`).
- `npm run test:square-webhook-roles`: 4/4 PASS, including the mutation test.
- `npm run test:unit` (full glob): 700/700 PASS.
- `npm run lint` / `npm run typecheck`: PASS, 0 errors.
- `node scripts/check-secrets.mjs`: PASS, 2313 files, 0 findings.
- `npm run test:integration` (`scripts/integration.ts` + `scripts/ledger-integration.ts`): PASS, 21 cases.
- `npm run test:m2b-security`: PASS, 3 cases, `chargesCreated:0`, `notificationsSent:0`, `productionRestores:0`.
- The same three pre-existing hardcoded migration-count snapshots already found on the R4/R6 branches were hit again here independently (this branch also forked before those fixes existed) and fixed the same mechanical way: `tests/unit/payment-activation.test.ts`, `scripts/integration.ts`, `scripts/ledger-integration.ts`.

## Zero-counts

Real Square API calls: 0. Live webhook deliveries: 0. Production DB connections: 0. Live/dormant credentials created: 0 (both new roles are NOLOGIN). PRs opened: 0.
