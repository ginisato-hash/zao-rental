# Input and recovery checkpoint (before v1.2 integration)

- Exact head adf6af80a1fd5e89ccaf3d8d459b27ad145352db: review2 PASS, no new findings;
  original and manifest retained. This is scoped review, not E12 completion.
- QR input component accepts immutable Asset UUID only, native camera pixels stay local,
  4 synthetic MediaStream cases pass; no actual phone and no receipt API connection.
  Initial camera fixture failed because a detached canvas did not emit changed frames;
  captureStream(0)+explicit requestFrame makes frame delivery deterministic, actual jsQR remains.
  Initial lint/ref and browser transpiler/locator errors are retained in outer evidence.
- Full Next process restart: original page HMR caused ERR_ABORTED during restart;
  test closes that page and reopens using the same authenticated browser context after restart.
  Distinct process IDs, same saved attempt/key/TTL, UNKNOWN retained, no fabricated QR/charge.
- Normal administrator UI now explicitly preserves booking permission and sets/revokes rental
  permissions, no role defaults. 6 ordinary UI/API/real-DB flow cases pass.
- Actual PostgreSQL race: ordinary writeAccount holds exclusive actor advisory lock while
  waiting for its target row; UNKNOWN fallback passes old preflight, blocks on shared lock,
  then rejects after the administrator commits store removal. No product auth change.
- Failed early test harnesses used process.exitCode overwritten during cleanup; final harnesses
  explicitly exit1 after cleanup on failure. Historical log failures are not successes.

The exact custody guard/privileged-function/grant proposal was rejected before execution.
The owner-approved UI-only portion was independently allowed and implemented. No denied SQL
or role grants executed. Full loan/return integration remains blocked pending exact resolution.
The new v1.2 owner instruction is next; same run deadline/review budget, no reset.
