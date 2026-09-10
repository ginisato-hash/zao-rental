# Mac execution state — 2026-09-11 JST

Dedicated project: `/Users/gini/Projects/zao-rental` (did not exist before this task).
Initial local state: no directory/no Git; no existing user work was overwritten.
GitHub: `ginisato-hash/zao-rental`, private, HTTPS origin, viewer ADMIN; main initialized
by GitHub README, not a direct local push. Source bootstrap is local tag `bootstrap/v0.4`.
Branch: `codex/e00-e01-foundation`. Final base/head, draft PR and exact CI/review results are
recorded in the final execution report; this file does not pre-claim future CI/review success.

CLI verification: codex 0.153.4 ChatGPT login; Claude Code 2.1.220 claude.ai Team login;
gh 2.93.0 keyring HTTPS. A sandbox-only Claude check initially reported no auth; a normal
Keychain check returned authenticated. The first sandbox gh network check failed; normal
read-only API succeeded. No credential values were displayed or copied.
Runtime: Node 24.15.0, npm 11.12.1, Python 3, macOS arm64. No docker/psql/postgres service
was on PATH. The dedicated npm launcher executes PostgreSQL 18.4 with a fresh local cluster
and stops it after integration. No persistent service, OS user or scheduler is installed.

Original archive verification: bootstrap SHA-256
`39e50cdfd6e034c4731242eecc1a6340a864d6e1eae2c9b14b903115fea049ff` matched the pack.
The 27 original Python tests passed on this Mac; see `evidence/mac-bootstrap-recheck.log`.
Reference hash checks ensure business documents/config/tests remain identical.

Remaining activation gates:
- branch protection API returned HTTP 403: upgrade or public repo would be required; neither changed;
  personal plan fields were unavailable, so no paid plan is inferred;
- Runner simulation is not a live Codex→CI→Claude→repair acceptance loop;
- no controller trust boundary/signing-key deployment or GitHub Claude OAuth secret provisioned;
- no autonomous daemon, auto merge, deploy, pricing publication, real Square or E03–E18 execution;
- 32 operational runtime cases, OIDC auth, production migration/restore and real-device QR are unexecuted.

ESLint 10 was incompatible with Next's bundled plugins and failed lint; ESLint 9 pin and its
support-ended warning are documented in ADR 0007. No rule was disabled to make lint pass.
New executable verification writes command/exit records to `.local/evidence/<run-id>/` and
`.local/manual-evidence/commands.jsonl`; the handoff copies these to user-facing outputs.

First remote CI run 34494168137 failed only at real-PG shutdown (57P01) after seven DB assertions.
The fix waits for socket end events before stopping PG and reports background errors without dumping
Client objects. Local regression verification now passes 24 unit + 7 DB + 6 E2E + 27 original tests.
See evidence/mac-shutdown-fix/. Remote rerun remains independently reported by its run ID.
Claude external review invocation was blocked by automatic approval review pending explicit user
consent to send the private snapshot to Anthropic; no Claude inference had been called at this point.
