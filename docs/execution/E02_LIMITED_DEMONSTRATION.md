# Historical E02 demonstration proposal — superseded, NOT AUTHORIZED / NOT RUN

The current single-task plan is E02_NEXT_DEMO.manifest.json and ADR 0010. Its proposed cap is
2 Codex + 2 Claude CLI starts, not this historical three-start ceiling. No live dispatch is wired.

One candidate task: improve the unauthenticated wording in the staff entrance and its matching
browser assertions. Keep the current denial semantics unchanged. No inventory, price, payment,
DB structure, authorization code, controller/policy, CI, dependency or new business feature change.

Allowed tracked paths (exact files only):
- apps/web/src/app/staff/page.tsx
- tests/e2e/foundation.spec.ts

Task ID E02; a new approved spec digest must bind this document plus explicit acceptance criteria.
The owner must pin the merged E02 controller source SHA/tree, exported release manifest SHA-256,
policy hash, actual runtime binary hashes, sandbox profile and signed task approval via an independent
trust channel. This PR's unmerged code and ephemeral test keys are not deployment authority. The
current main SHA and proposed branch/worktree/ports must be revalidated when issuing that approval.

Acceptance: staff入口 explains that sign-in is not connected yet in clear Japanese and identifies
that staff operations are unavailable. Existing staff/admin API 401, server-side null principal,
spoofed header/query rejection and admin denial must remain unchanged. E2E checks the wording and
existing rejection. This document does not implement that UI task.

Maximum one active repository task, initial implementation 1 plus at most 2 repairs; independent
review 1 plus at most 2 re-reviews. Total maximum 3 Codex and 3 Claude CLI invocations. Each Claude invocation has at most 3 turns
(including structured-output formatting), so at most 9 Claude turns across the task. This is an
invocation budget, not a claim that each CLI performs exactly one HTTP/model request. Each invocation is bounded by a
controller deadline within the original 60-minute run budget. No model calls for CI polling or
unchanged evidence. Stop on auth/quota/credits, unknown effect, exceeded budget, stale SHA/base,
missing signatures, protected/out-of-scope changes, uncertain cleanup or failed sandbox probe.
No deliberate live failure injection; failure/repair paths are already exercised with fake adapters.

Prerequisites needing separate approval before any live request:
1. Merge this E02 preparation PR after final CI/independent review; issue an exact release/task approval.
2. Close ADR 0009's detached-process/guardian containment gap in an approved isolated job environment.
   Any required OS/VM/managed-settings changes need their own narrowly scoped authorization.
3. Wire and verify credentialed Codex parent versus command worker, subscription-only network/auth,
   extra usage OFF, GitHub repository-only publication credentials, trusted CI identity and signed
   reviewer receipts. The current LIVE adapter is deliberately disabled; no flag enables it.
4. Re-run the permission probe at the actual new worktree/release/runtime paths, then authorize only
   this task, its exact paths, call caps, draft publication and review. Authorize no merge/daemon/deploy.

Expected artifacts: immutable approval/release manifests, lease/run journal, exact base/head/spec and
snapshot digests, bounded command logs, one feature branch and one draft PR, matching CI and static
review, repair count and final AWAITING_APPROVAL or specific BLOCKED state. The owner decides merge.
