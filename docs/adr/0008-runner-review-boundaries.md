# ADR 0008 — Disabled single-controller Runner and independent review proposal

Status: simulation implemented; live adapters, trusted deployment and live round trip unexecuted.
No scheduler, automatic merge, production path, added provider or API billing exists in this change.

## State and minimum executable boundary

`tools/automation/cli.ts --dry-run` generates ephemeral test approval keys, validates the signed
fixture, exclusively claims a local task via atomic mkdir, persists a run and outputs inert argv plans.
It calls no subprocess/API. Every result is SIMULATION_ONLY. Any other flag, including `--live`, exits 2.
The evaluator tests approval → implementation evidence → draft → current CI → current Claude review
→ FIX_REQUIRED (at most twice) → AWAITING_APPROVAL. It does not attest that a model or CI ran.

Productionizing this proposal requires reviewed adapters, not changing a boolean. The future controller
must obtain all evidence independently; model-reported `headSha`, changed files and CI success are not proof.
A process dies with a claim: retain it, compare PID/start time/lease/task/spec/base/worktree and remote
PR SHA, then have the trusted controller reconcile. Never steal expired leases or reset another tree.
The current claim is local single-Mac locking, not distributed queue coordination.

## Approval and protected policy

READY label/PR text is not approval. A controller-only approval records task ID, READY state, base SHA,
approved spec SHA-256, canonical allowed paths, merged prerequisites, expiry and Ed25519 signature.
An approver private key stays outside agent-accessible storage. The verified public key/policy hash must
come from a separate trust channel. `loadProtectedPolicy` rejects a path resolving inside the worktree
and a mismatched pinned hash. Symlink/absolute path normalization is required.

A file outside a repo but writable by the same OS user is **not an effective trust boundary**. Live mode
requires a separate OS principal/container boundary with read-only controller policy and a restricted
worker filesystem. The controller binary, its schemas/prompts, argv adapter, policy, allowed check names,
signer trust root, workflow SHAs and credential helpers must also be protected. Agent changes to a local
copy do not update the trusted controller. Initial owner-scope control-file changes require manual review.
Protected paths include workflows, instructions, automation, lockfile, migrations and execution policy.
A future adapter must inspect both sides of renames, modes/symlinks, staged/unstaged/untracked files and
`git diff --name-status -z base..head`, validate branch/ref and reject out-of-scope paths before push.

## SHA, CI and review

Persist run/task ID, base/head, spec hash, CLI versions, diff list, commands/exits, CI run ID, review target,
approval digest, rounds and state transitions. Validate task-result and review-result JSON schemas.
Controller must re-fetch PR head and ensure base/spec have not changed immediately before every transition.
Require named checks from the trusted CI workflow at the exact head with the correct GitHub App identity;
No checks, pending results, wrong workflow, self-posted status or old head cannot advance.
Completed CI failure enters bounded repair before review; pending results need controller polling,
not a new model invocation. GitHub merge-SHA CI
must additionally bind the tested merge tree to the current head/base. No default-branch success reuse.

Review submission is inert snapshot text + evidence under a trusted contract, with no candidate hooks,
settings, tools or source execution. Do not checkout candidate code next to OAuth/GitHub credentials.
A separate credential-free CI job runs tests; an optional separate publisher with minimal checks:write
may post validated review evidence, but cannot merge. A local Claude Team review is valid model evidence,
not an independent human account's approving GitHub review. New push invalidates review and CI evidence.

`claude-review-proposal.yml` is manual-only with a literal false reviewer gate. Its source of truth must
be a protected controller repo/ref on activation; candidate PR workflows cannot define their own review
policy. No secret has been created. Official Claude OAuth setup must be done by the owner for this repo
only; a local Team login is not automatically a GitHub Actions secret. Do not copy local credential files.
No API-key fallback. GitHub App installation/permissions remain a separate explicit activation step.

## Stops, limits and external operations

All errors fail closed. 401/403/auth → BLOCKED; 429/quota/credits → BLOCKED; invalid/missing JSON or review,
unknown side effect, timeout/network, spec mismatch, protected changes, new head or wall time ≥60 min →
BLOCKED. No automatic credit use or paid provider switch. Two finding-fix rounds maximum, then owner.
A future child-process adapter must also enforce timeouts, process-group shutdown and an approved model
usage budget before spawn; current simulation wall-clock tests are not runtime budget enforcement.

No auto-merge, live payments/refunds, price publication, deploy or dependent task release. Prerequisites
release only after externally verified merge. Poll with gh/API without model calls; invoke models only
on changed actionable evidence. One runner and one reviewer. No cron/launchd/automation installation.

## GitHub-specific remaining gates

Fresh repo is private with ADMIN CLI access, origin main initialized by GitHub README; implementation
pushes only the feature branch. Branch-protection read returned 403 requiring Pro or public visibility.
Plan metadata was unavailable. No contract/visibility change was made. Until effective protection is
available, only manual owner integration; no enabling autonomous merge. CI still runs on draft PRs.
Actual PR event/re-run behavior must be measured with its real credential; GITHUB_TOKEN-created events
may not trigger downstream workflows. Repo-limited App or explicit dispatch is a future reviewed choice.

## Official sources checked

- [OpenAI non-interactive CLI and output schema](https://learn.chatgpt.com/docs/non-interactive-mode)
- [OpenAI authentication](https://developers.openai.com/codex/auth/)
- [Claude GitHub Actions, subscription OAuth, limits](https://code.claude.com/docs/en/github-actions)
- [GitHub immutable Actions pins and credential isolation](https://docs.github.com/en/actions/reference/security/secure-use)

Installed CLI: codex 0.153.4 (ChatGPT), Claude Code 2.1.220 (claude.ai Team), gh 2.93.0 (keyring HTTPS).
Authentication was checked with sanitized metadata; no model API credential was read or displayed.

## PR #1 independent-review follow-up: explicit acceptance

The review-result schema already enumerates verdicts PASS/CHANGES_REQUIRED/BLOCKED and severities
BLOCKER/HIGH/MEDIUM/LOW; baseline runtime probes confirm unknown verdicts/severities are rejected
by AJV. The initial review snapshot omitted that schema, so its current fail-open premise was not
established by the supplied evidence. Nevertheless the evaluator now independently requires exact
PASS, no unverified items, and only MEDIUM/LOW (or no findings) before AWAITING_APPROVAL. Unknown
future values cannot become permission to advance merely because a schema enum expands. Tests cover
unknown values, PASS with HIGH/BLOCKER, permitted advisory findings, unverified evidence and the
repair cap. This is a disabled-runner guard improvement; the independent reviewer must reassess it,
and the implementer does not unilaterally dismiss the HIGH finding or declare review PASS.
