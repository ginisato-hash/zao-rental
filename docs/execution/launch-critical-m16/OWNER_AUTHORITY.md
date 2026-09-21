# Owner direct authority — M1.6 Booking notification + recovery delivery core

Adopted from the Owner's current chat request (Japanese headings preserved; layout normalized). Base is M1.5 terminal remote HEAD; new branch `codex/launch-critical-notification`. External email/SMS send 0, provider contracts 0, Production 0. Complete code so a provider can be connected later.

1. EXISTING RECOVERY FIRST: BookingAccess, BookingRecovery, guest recovery routes, booking QR and confirmed booking view remain canonical. No parallel recovery system.
2. DELIVERY DOMAIN: provider-neutral BookingNotificationDelivery (or existing naming). Events BOOKING_CONFIRMED, BOOKING_RECOVERY, BOOKING_AMENDED, PAYMENT_ACTION_REQUIRED, REFUND_STATUS. Never fake a business event that is not implemented.
3. DURABLE OUTBOX: persist id, eventType, booking/reference, canonical recipient hash/reference, locale, templateVersion, status, attemptCount, nextAttemptAt, nullable providerMessageId, createdAt, nullable sentAt, lastSafeFailureCode. No raw secrets. Minimize body/PII; resolve recipient from authoritative booking immediately before delivery where possible.
4. IDEMPOTENCY: canonical business-event dedupe key; concurrent enqueue creates one row. Response loss must not blindly generate duplicate rows/messages. Do not claim provider exactly-once.
5. RETRY MODEL: bounded attempts with pending/sending/sent/retryable/permanent/suppressed states. Timeout ambiguity handled safely; no blind immediate retry. Staff/admin can see dead letters.
6. TEST DELIVERY ADAPTER: local/CI InMemory or Loopback. Actual mail network 0. Test success, timeout before acceptance, timeout after acceptance,429,5xx,permanent rejection.
7. PRODUCTION PROVIDER BOUNDARY: adapter interface only, missing credentials fail closed. Unselected provider remains explicitly BOOKING_RECOVERY_DELIVERY_UNCONNECTED. Do not select/add Resend,SendGrid,SES or other provider/dependency.
8. JA/EN TEMPLATES: confirmation and recovery. Canonical booking summary, pickup/return stores/dates, payment status, access URL/code and QR access path. No recovery secret/code logs, unnecessary PII in links.
9. RECOVERY SECURITY: enumeration-resistant public responses for matching/nonmatching email/booking, rate limits. Reuse existing single-purpose, expiry, revocation, hash-at-rest and logout/session boundaries.
10. STAFF UI: notification status, last safe result, manual resend request. Explicit permission, reason per existing audit policy, idempotency and rate limit. Do not expose recipient secrets/values excessively.
11. BUSINESS CONTINUITY: notification failure never rolls back successful payment, confirmed booking, inventory or custody. Separate failure management; prove with real PostgreSQL.
12. TESTS: confirmation/duplicate/concurrent enqueue, successful/retryable/permanent/ambiguous delivery, manual resend, unauthorized denial, recovery enumeration/rate limit, booking survives delivery failure, JA/EN templates and secret-free logs. Full regression.
13. REVIEW/CI: one Claude initial static review focused on PII, recovery secret, idempotency, retry, booking independence, authorization. Correct BLOCKER/HIGH/MEDIUM. CI PASS, stacked Draft PR. Current repository contract permits at most one correction review only for B/H/M, no pointless loops or extra billing.

Terminal: `NOTIFICATION_RECOVERY_CORE_READY_PROVIDER_CONNECTION_PENDING`.
Then M1.7 may start automatically. Actual external mail remains 0.

# Owner direct authority — M1.7 next stage

Base M1.6 terminal remote HEAD; branch `codex/launch-critical-operations`. Production provider mutation0. Reuse existing audit/event model, not a new analytics system.

- Detect payment pending/unknown, webhook reconciliation, HOLD expired, transfer delayed, return inspection, inventory discrepancy, refund pending/unknown, notification/media/recovery failure. Reuse existing names where present.
- Safe exception fields: eventType,occurredAt,correlation/internal booking or asset reference,store,severity,status,resolvedAt,resolution actor. No password/token/cookie/card/full email/phone/raw provider payload/signed URL.
- `/admin/ops`: read-focused unresolved exceptions, payment, transfers, inspection, inventory, notifications, refunds and readiness. Filter store/type/severity/age;390/768/desktop.
- Resolve only acknowledges exception. Explicit staff/admin permission, reason, actor, time and audit. Never silently repair payment/inventory/refund business state.
- Reuse M1.5 health/readiness APP/DB/GUEST/PAYMENT_ADAPTER/MEDIA/NOTIFICATION safe status only.
- Synthetic failures DB transient/provider timeout/payment unknown/notification/media/transfer delay/refund ambiguity; compare booking business state to exception state.
- Owned ephemeral PostgreSQL canonical migrations + synthetic booking/payment/HOLD/custody/audit. Logical backup/export to fresh empty DB, restore, registry/hash and critical fingerprint comparisons. Backup fixture contains no secrets. Define excluded/regenerated ephemeral sessions. Do not claim Production PITR.
- Restore matches confirmed booking, immutable quote, reconciliation state, custody,HOLD,transfer,audit.
- Short runbook for paymentUNKNOWN,delayedwebhook,inventory mismatch,lostdevice/QR,notificationoutage,DBrestore,mediaoutage: symptom,what not to do,safecheck,manualaction,escalation.
- Synthetic ~500 sets/2 stores/representative bookings; local/CI p50/p95 measurement, explicit synthetic origin. No invented strict SLA; identify N+1 or seconds-scale regressions.
- Tests opsauth/store scope/redaction/resolve/no business mutation/failure injection/backup/restore/fingerprint/500set baseline, full regression.
- Claude initial1 focused on PII/secret,false resolution,restore correctness,authorization,business separation; correct B/H/M; CI PASS, stacked Draft PR.

Terminal: `OPERATIONS_AND_RESTORE_REHEARSAL_READY_FOR_FIELD_ACCEPTANCE`. Stop here. Real provider0,Production0,real customer0. No main merge.
