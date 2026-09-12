# CI operation-boundary followup

Head f65282f0c3e4cb2371bf7e4aee214dd816da6659 passed all35local verification
commands (.local/evidence/2026-09-12T19-29-33.350Z), including125unit,9contentUI
and16browser component cases. CI34714307630/attempt1 instead stopped in
test:flow-restart, broad stage `UI price and source`. Its intentionally sanitized
log does not identify the exact failed await. It does not establish a product
regression or a definitive timeout cause. Preserve the failed run, no rerun.

The restart regression now distinguishes initial price reads, price input, POST
commit response, reload response, saved display, HOLD/quote APIs, booking save and
booking display. It waits for and asserts realHTTP status at each write boundary
before asserting the rendered result, and waits for initial reads to finish before
price setup. The existing per-operation timeout, UI behavior, API implementation,
HOLD/UNKNOWN expectations and actual Next-process restart are unchanged. Failure
logging includes only local test source lines, never raw URL/query/password data.
The updated local normal-auth/realDB/restart case passes with owned cleanup.

This is a test synchronization and diagnosis correction, not proof of the original
CI failure cause. Final new-head CI is required; do not call an unrun test passed.
Use the prior35command full local record plus the changed-test/lint/type supplement;
all latest tests will also run in final-head CI. No product source changed after
f65282f. The older content50-photo final-expect CI failure likewise retains its
limited diagnosis; new evidence checks each of50uploads rather than hiding errors.
