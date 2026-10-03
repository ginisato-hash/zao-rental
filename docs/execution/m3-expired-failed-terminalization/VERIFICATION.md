# F2 local validation

All 74 commands in the macOS verification sequence finished green after fixes. The `npm run verify` entry point was invoked once. It stopped on an old 52-migration assertion; the failed command and remaining commands were then continued explicitly without invoking the entry point again. Additional findings were another stale migration count, the candidate function search_path, and one local PostgreSQL fixture start collision. The count assertions now require 53; application references in 0053 are schema-qualified with search_path fixed to pg_catalog, pg_temp. The fixture test passed when run alone and all remaining DB tests ran sequentially.

Focused projection/acceptance tests passed (180 cases), as did Production role plans (54 real-PG cases), Production foundation (10 cases, 53 migrations and 150 owner grants), typecheck, lint, secret scan, and whitespace checks. Role-plan and Foundation checks were repeated after the final SQL change. The ordinary bound FAILED path and existing COMPLETED fixtures remain covered.

Real-PG coverage includes FAILED/CANCELED response loss, exactly one guarded call with no preceding generic attempt UPDATE, duplicate projection, rollback at function/head/event/receipt boundaries, all requested identity/security counterexamples, zero-refund cancellation/outbox, strict ACLs, and the 0051→0052→0053 installer sequence including checksum/posture drift, partial failure, replay and lost COMMIT acknowledgement.

No live payment lookup/reconciliation, refund request, migration, projection or notification was performed as part of these local tests. Generated avatar/R15 evidence was retained locally and excluded from this F2 change.
