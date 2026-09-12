# Login hydration race found by quantity checkpoint CI

CI34707592327 checked branch head ad5ffedc76a463d881c4024090993667f9109ac3 by
workflow_dispatch after no PR synchronize run appeared. It failed in the existing
actual-Next-restart test during staff login. The browser navigated to the native form
GET URL before client handlers were ready. The local success did not refute this race.

A JavaScript-disabled normal login regression failed before the fix and passes after.
The ordinary form is now disabled until hydration and its native method is POST.
Normal authentication/authorization remains unchanged; no retry, timeout increase or
fixture bypass. Error reporting keeps the stage/type and omits URL/query/input details.

One failed artifact contained an ephemeral SYNTHETIC test password in a URL diagnostic.
Its test-only DB had already been stopped. A sanitized local copy and before/after hashes
are preserved; artifact10302361421 was removed and the run's artifact count read back0.
The failed run and failure conclusion remain. No real user credential was used or sent
for review. Do not transmit the unsanitized prior log. New full CI is required.
