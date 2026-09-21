# PR17 Ready-triggered CI repair

The M1 entry check initially matched PR17 HEAD `708ef95e4e4f7e1e08d8f866f2e80f80e921daaa` and main `3061dbbbe00294e5baebba2405028c907d6e6e85`. Prior run35132989079 passed. PR text was refreshed and Draft was changed to Ready under Owner authority.

Ready-triggered run35136611724 failed in `tests/readiness/booking-access-ui.ts` during the initial/reload pending-read scenario: `route.fulfill: Route is already handled!`. No merge was attempted. This is a newly observed test failure, not a reason to rerun unchanged code until green.

The test now waits at a browser fetch-delivery gate after the actual authenticated GET completes, retaining the original response. It no longer keeps a Playwright Route alive across the pending-read scenario. Both initial-load and reload-button cases retain assertions: QR absent, revoke disabled, exactly one live capability, and deliberate revoke enabled only after response delivery. No production code, assertion, retry or skip changes.

Local validation: six booking-access browser scenarios PASS with owned PostgreSQL; 686 unit tests PASS (skipped0), lint/typecheck/secret scan/diff checks PASS. The sandboxed unit launch denied process identity and loopback operations (EPERM); the ordinary local-permission run passed without test changes. The test's first launch could not find the browser in the default cache; using the already-installed matching Chromium resolved that environment issue before any scenario ran. No browser download or provider operation.

The repair changes PR17 HEAD. The Owner's exact708ef95 merge target is retained as historical authority; a different SHA must not be silently substituted. Required CI on the repaired HEAD is pending; main remains unchanged and PR17 is unmerged.

Production operations, real payments, real inventory imports: 0. M1 feature implementation has not begun; its branch must originate at the approved merged main.
