# Existing lease fixture timing correction

Full regression2026-09-16T21-44-46.564Z stopped in tests/readiness/r14-postgres.ts when the fixture assigned lease_expires_at and claim_after using two independent clock_timestamp() calls. Migration0026 correctly requires their exact equality while CLAIMED. Usually the calls landed in the same microsecond; this run produced SQLSTATE23514. The fixture now materializes one timestamp and assigns both columns from it. No migration, lease invariant or product state machine changed.

The original failed log is retained. R15 and the remaining full-suite commands are rerun after the fix; earlier completed full-suite commands remain valid on the same product code. The combined validation receipt records both runs and does not erase the first failure. Lint/typecheck/secret scan/diff are checked again after this test-only edit.
