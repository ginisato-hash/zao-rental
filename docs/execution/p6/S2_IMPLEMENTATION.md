# R9/S2 implementation boundary

Owner authority is PRODUCTION_P6_S2_AUTHORITY.md. Immutable operation-manifest.json fixes 100JPY, official Sandbox fixed source and UUID identity. No DB or old P4 journal is used. R4/R6/R7/R8 and normal production payment/booking gates remain unchanged.

The temporary Preview routes use server-only environment binding, no parameters/body, same-origin intent, pure preflight and an instance attempted latch. The S2 transport permits one fixed CreatePayment and only a safe-ID conditional GetPayment. Full COMPLETED evidence never triggers extra GET. Missing/invalid evidence cannot be PASS; a nonterminal/uncertain safe ID can receive at most one GET. Known money/reference/location mismatch never gets a green-up lookup. Exceptions/timeout cannot trigger a second POST. Only bounded allowlisted metadata leave the service; merchant binding is adopted S1 evidence, not an invented Payment field.

Before actual invocation, tools/acceptance/s2-operator-guard.mjs exclusively creates and fsyncs the local guard, then invokes the one browser POST. A second process fails before dispatch. Unknown outcomes retain the guard. This is the Owner-controlled Sandbox exception; not a distributed exactly-once HTTP guarantee. Square fixed idempotency prevents duplicate logical payment if an accidental identical request reaches the provider. Production still requires shared durable journaling.

Validation: 30 new fixture/operator tests plus69 existing related tests =99PASS/0FAIL/0SKIP; secret scan/lint/typecheck/build exit0. Initial lint failure was a test variable named module, corrected to modulePath; initial evidence retained. No real Square/DB/Preview at this validation point. No Claude/Spark.

S2 runtime preflight reports instanceAttempted and LOCAL_EXCLUSIVE_FSYNC_CHECK_REQUIRED; it cannot observe the Mac filesystem. The operator separately verifies local guard absence, records that with preflight, then uses exclusive fsync immediately before POST. No token or auth-state is exported. Login observation starts only after Owner confirms the application page, never callback URLs/titles/accessibility.

After result evidence is pushed/read back, remove both temporary route files, validate and delete exactly the S2 Preview. Keep the R3 Preview, immutable manifest, local guard and Sandbox payment. S2_PASS authorizes S3 gate documentation only.
