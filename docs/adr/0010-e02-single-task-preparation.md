# ADR 0010 — one-task connection preparation; unattended Runner on hold

PR #2's F8 fix received one newly authorized static REVIEW_PASS and was squash-merged at
be8c50ad35abefb6f95e45e5e4b1a7da37650176. The reviewed head was
2fab657c1c1186612956a649cc6cc312ceb363be. This new branch is preparation only; it is not part of
that Claude review or merge authorization. No business feature or live model task is implemented.

## Roles and real read-only connection

The trusted controller, implementation worker, static reviewer and publisher are separate roles.
The controller's GitHub inspector uses an absolute existing gh binary from an empty temporary cwd.
It retains only host HOME/PATH/LANG/TMPDIR; gh uses existing authentication itself. No token is read
from Keychain/config, printed, copied, created or given to the worker. Endpoint construction is a
closed GET-only operation enum, fixed to ginisato-hash/zao-rental. There is no arbitrary URL, shell
string, mutation endpoint or provider fallback. A failed auth/quota/network/JSON read latches a stop;
there is no automatic second request. Provider error contents are not reflected into logs.

CI acceptance binds repository ID/name, workflow ID/path/active state and pinned workflow Git blob,
event=pull_request, head repository/head SHA, explicit run ID and latest run attempt, completed/success
on both run and attempt responses, and the checked-out merge SHA/parents/tree. The merge parents must
be the expected base/head and the head tree must match. Current run and PR identity are read last.
A name such as foundation, an unrelated SUCCESS, a stale attempt, or a candidate-changed workflow
cannot satisfy this comparison. Pins must come from the trusted owner/controller, not task output.
The observed historical PR #2 CI is read evidence, not authority for a future changed task/base.

The actual GET-only check passed against the existing PR #2 and CI. Its output explicitly says
writeAuthorizationProven=false and liveDispatchProven=false. Development-time PR publications by
Codex do not prove a future restricted publisher's credential scope. A repository-only publisher,
model-parent integration, signed provenance receipts and external reconciliation remain unwired.
Do not issue new tokens, change authentication, add a secret store or expand scope without a separate
owner decision. These are not prerequisites to keep using the current human-triggered workflow.

The reviewer uses the F8 shared staticReviewArgs contract and existing Team auth with credits OFF,
from an empty cwd. The worker gets only PATH/LANG/run TMPDIR. No HOME, GitHub/provider token, loader,
Git configuration or shared control socket is passed. These are tested command-worker properties;
a real authenticated Codex parent has not been wired or isolated by this preparation.

## Actual Mac boundary and the missing outer boundary

The new Mac probe uses installed Codex 0.153.4 and managed-policy-inclusive permissions. Only the
fixed inert probe file and runtime files are readable; the controller directory is explicitly denied.
The actual sandbox denies reads of controller code, policy, controller state and a synthetic secret,
and denies connection to a test-owned Unix control socket that a host-side positive control reaches.
A candidate-file write succeeds. No actual secret file or existing service socket is accessed.

Separately, a fixed harmless Node child starts a new session (detached=true / setsid), has no stdio
or IPC back to the worker and expires after 20 seconds. The normal guardian's process-group timeout
leaves this detached process alive. The test confirms this known gap, then cleans only its unique
PID/start-identity/run-token fixture. That explicit trusted-fixture cleanup is NOT containment of
arbitrary untrusted descendants. Existing normal timeout/cancel/crash/parent-death tests still pass.
No sleep/skip/retry is used to make a live containment claim pass.

No docker, colima, limactl, podman, Apple container, orb, prlctl or vmrun CLI was present on this Mac.
No outer per-run process namespace/job boundary was provisioned or tested. HOME/worktree separation,
Seatbelt read denial and PID/process-group cleanup are not a substitute. outerBoundaryReadiness always
returns UNATTENDED_HOLD; dispatchLive always throws, even if a caller claims a CLI is installed.

If unattended work remains desired, the proposed outer boundary is one disposable Linux job/container
inside an owner-approved VM/runtime, with its own PID namespace terminated as one run resource.
No host HOME, controller/policy/state, secrets, host PID/network namespace, privileged mode or shared
Docker/VM control socket may be exposed. Inputs/outputs would be explicit per-run copies, with pinned
image/runtime hashes and a tested termination handle; this has not been installed or implemented.
The same harmless detached/guardian-loss cases must pass there before a live model request. An image
or CLI name alone is not proof. OS/VM/service installation requires a separate narrow authorization.
Given that larger change, the current recommendation is to defer the unattended Runner and continue
owner-triggered Codex implementation → tests/CI → separately approved static review for product work.

## One next task and usage

E02_NEXT_DEMO.manifest.json pins the controller/policy candidate, starting base, two existing files,
acceptance, role/network boundaries, proposed start limits, timeout and stopping resources. It is
an unsigned plan, not a task approval. Any base/runtime/controller/policy change invalidates it.
The fixed source commit includes the unchanged merged controller plus a disabled policy-plan file;
it is not yet an owner-approved deployment. Signer public-key placeholders are intentionally unusable.

The proposed outer cap is two Codex CLI starts (implementation + at most one fix), two Claude CLI
starts (review + at most one recheck), 60 minutes total, and no paid fallback. The old core's historical
maxFixRounds=2/three-start ceiling has not been changed or secretly treated as the new two-start gate.
nextStartDecision tests the stricter plan with fake histories, but is not a durable live launcher.
Unknown effects/auth/quota/credits stop, even if fewer than two starts are recorded. The future trusted
launcher must reserve each start in the existing protected journal before launching, then record
PID/start/end/status, exact head and source-specific usage metadata. Internal model/API request counts
are a distinct nullable metric; CLI starts cannot be substituted for them. Tokens/cached tokens and
reported cost estimates are not evidence of billed overage. The outer launcher is still absent.

## Verification split

| Evidence | Result / scope |
|---|---|
| Actual GitHub GET inspector | PR #2/CI repo/workflow/run/attempt/head/merge verified; no write proof |
| Actual Mac probe | Five read/socket denials; candidate write succeeds; no model |
| Actual detached process | Survives group stop, then fixture-only cleanup; gap confirmed |
| Existing Mac/POSIX tests | Normal owned descendants stop; unrelated fixture preserved |
| CI/auth/quota/cap failures | Fake responses/history only; no repeated model/API failure injection |
| Outer container/VM termination | Not installed, not tested, unattended dispatch blocked |
| Authenticated model/publisher wiring | Not implemented or exercised |

`npm run verify` adds test:preparation:macos only on actual macOS. Linux CI checks the portable tests
and makes no claim that a skipped/emulated Mac case passed. Read-only GitHub inspection is explicit
and outside ordinary test/CI runs; it never requires authentication during fake tests.

Sources used to resolve the CI metadata contract: [GitHub workflow run API](https://docs.github.com/en/rest/actions/workflow-runs)
and [re-run behavior](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/re-run-workflows-and-jobs).
