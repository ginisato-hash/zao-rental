# R14_PARTIAL — development PostgreSQL accepted, external activation blocked

Starting HEAD: `d0a1f66b8cfa97ad1b5e5bd06f409e056604cf0a`  
Authority: `e3895960fb6a3dc887dfea10cdc7ffcfacbf98bc`  
Implementation: `bb26d87e2bad0a0514849b2487db18355c4590dd`  
Main remains `3061dbbbe00294e5baebba2405028c907d6e6e85`. Same branch `codex/external-acceptance-p6`; no new/open PR, merge, production deployment or independent model review.

## Passed

- One local isolated PostgreSQL: 0001–0029 applied, 0001–0027 byte-identical to starting HEAD. 0028 locked source reader; 0029 scoped development dispatch/claim. Tables, constraints, indexes, triggers, grants and function owners/search paths saved in `db-final-metadata.json`.
- **28 real-DB checks** (21 + 4 + 3), **495 unit/fixture/static regressions**, zero final failures/skips. lint, typecheck, build and secret scan exit 0. The fresh all-in-one command was not rerun on a second database; one incremental owned session and a fresh finite child supplied these results.
- Six separate runtime/test roles. No superuser/create-role/create-DB/bypass-RLS; forbidden access tested. Diagnostic/public cannot mutate; projector cannot alter R12 jobs, stock, price, contact, HOLD TTL or notification delivery.
- Signed synthetic receiver: duplicate/hash conflict, failed write 503, actual owned connection termination, no receipt after failure; independent connection sees nothing before COMMIT and ACK waits for it.
- R12: two dispatchers/workers, one lease, expiry/stale finalize, attempt/deadline ceilings, sticky auth/quota blocks, active event and new generations.
- R13: one synthetic booking `CONFIRMED_DEV`; one projection event and exactly two business audit updates for the initial apply. Two projectors and COMMIT-response-loss replay do not duplicate effects. Later composition replays add only per-job receipts, not another confirmation.
- Reject expired HOLD, **due boundary with HOLD still valid**, missing gear/wear, transfer attention, cancelled transfer, bad price snapshot, mismatched payment identity, stale revision. Transaction failure rolls back business/history/journal; no new HOLD, refund, resurrection or notifications.

## Not accepted / not performed

- **BLOCKED_PROTECTED_WEBHOOK_INGRESS**: compatible single POST ingress preserving ordinary Preview protection not established from official mechanisms.
- **BLOCKED_VERCEL_LOGIN**: current project/protection metadata not verified because existing CLI authentication was unavailable. No login was started for a route that is independently blocked.
- **BLOCKED_EXTERNAL_DB_PROVISIONING**: no verified externally reachable development DB selected/configured. Local DB is not exposed to the network.
- Live webhook/signature delivery, real GetPayment truth, new payment and hosted E2E: **NOT RUN**. Local HMAC/provider fixtures are not Square evidence. New-booking confirmation through the entire hosted composition is unverified.
- All Square request counts **0**, Preview **0**, subscription **0**, refund **0**, R10 lookup **0**, Production **0**, real customer/inventory/custody **0**. Historical R3 and R10 unchanged. No secrets/auth callback observed or exposed by this execution; pattern scan is not a comprehensive security audit.

## Closure / next step

Owned runtime role connections **0**. PostgreSQL stopped at `2026-09-15T02:43:08.519Z`; owned PID and port listener absent. Synthetic cluster retained stopped for evidence, no reusable plaintext credential retained. No owned Web/browser/model process.

Owner decision: a supported protected machine-ingress architecture and isolated hosted development DB; restore Vercel authentication only when that path is viable. See [exact blockers](../../R14_PROTECTED_INGRESS_GATE.md). No P7 execution/gate-pass is asserted. Main/Production/Square follow-up remain bounded by the applicable authority.

Detailed IDs/hashes are in `synthetic-chain.json`, `composition-chain.json`, `source-manifest.json`, `migration-hashes.json`, and `validation.json`. The final evidence commit contains this file; its normal remote push/readback is recorded in the parent workspace, avoiding a self-referential hash.
