# R13 business projection activation gate

Current state: LOCAL_IMPLEMENTED, business apply NOT_ACTIVATED. This document does not grant execution authority. R10 remains LAST_OBSERVED_PENDING / S3_NONTERMINAL_DO_NOT_RETRY; no refund follow-up is allowed by R13.

| Required next evidence | Current result |
|---|---|
| Owner authorization for one bounded local/development DB migration and data scope | NOT_GRANTED in R13 |
| 0025–0027 real PostgreSQL migration syntax, constraints, rollback/forward recovery | NOT_RUN; existing migrations preserved; new schema additive |
| Narrow service principal and table/function permissions; PUBLIC denied | Static revokes only; no new grants, role or credential |
| Actual R12 context loader and finite accepted-truth → R13 reference composition | Test composition only; no runtime consumer |
| Source/job revision race, terminal truth without receipt, new generation dedupe | Fixture verified; real DB pending |
| R12 finalization committed before calling R13; never call under stream/job locks | Documented order; actual composition pending |
| Accepted provider observation from explicitly approved environment | Synthetic observations only; real provider request 0 |
| Valid completion with original quote/HOLD/claims and exact identity | Scripted repository fixture verified |
| Expired/due HOLD and missing gear/wear/transfer witnesses | Fixture verified; real DB counterexamples pending |
| Legacy startPayment/reconcile races, two projectors, lock timeout, final-time guard | Fixture verified; multi-connection PostgreSQL test pending |
| Crash/COMMIT response loss, journal/audit/job receipt exactly once | Fixture verified; process/connection crash drill pending |
| Actual history triggers and original actor/service origin attribution | Static/fixture only; least privilege execution pending |
| Operator read model for COMPLETED but fulfillment BLOCKED | Internal receipt only; no operational UI or automatic refund |
| Notification/outbox and current-state read authorization | NOT_WIRED; historical projection receipt is not current booking permission |
| Bounded query plans and 500-set concurrent workload | NOT_MEASURED; no performance claim |
| Independent review and exact-source CI | NOT_RUN (models prohibited; push pending approval) |

Before any live wiring, approve the environment and precise rights, use synthetic data, establish one fixed invocation budget, retain source/revision/idempotency evidence, and define operator ownership for a BLOCKED result. A truth job being RECONCILED is never sufficient to mark a booking confirmed. Recovery must inspect its projection receipt without creating another payment or HOLD.

For migration rollback, disable consumers and preserve the additive journal; do not drop audit/history or edit already applied migrations. R13 creates no consumer, so there is nothing to stop or deploy now.

Production and real customer/inventory/custody operations remain disabled. Actual provider HTTP, webhook delivery/subscription, Vercel login/env/deploy, DB connections, email/SMS, Runner/cron, browser and model invocation require separate authority. No secret goes into repo/chat/log. No broadening of main protection, no new PR/main merge.
