# Development observations, not final-source failures

The first three narrow runs failed while constructing the scripted fixture: an invalid season label, an overbroad fake clock-query match and a null fake booking insertion. Each fixture was corrected; narrow-04 passed 106 tests. These are not claims that pre-R13 product code had the corresponding defects. Full current-source validation is in the parent directory.

The initial full suite passed 489; later combined worker/projection tests increased this to 491. Two typecheck attempts failed because Next.js declares NODE_ENV readonly. The test-only environment change now uses Reflect and restores the original value in finally. Production rejection remains unchanged. Final typecheck/build exit 0. Intermediate failures remain preserved and are not hidden by retry/skip.
