# GitHub-schedule backup — operating gate (Owner, before SCHEDULED_BACKUP_ACCEPTED)

The GitHub `schedule:` source is best effort. GitHub documents that scheduled runs can be delayed or dropped under load,
and that in a public repository scheduled workflows are automatically disabled after 60 days without repository activity.
The in-repo freshness workflow is itself scheduled, so it cannot report its own disabling. This is therefore **not** a
guaranteed hourly RPO, and acceptance needs an independent control:

1. Enabling is a separate approved release step: set `PRODUCTION_BACKUP_SCHEDULER_SOURCE` explicitly (`GITHUB_SCHEDULE`
   or `CLOUDFLARE_DISPATCH`). Unset or any other value makes every run fail closed before any secret.
2. Owner/operator check at least every 14 days (well inside the 60-day limit), recorded in Issue #47:
   `gh workflow list --all` shows `Production Backup` and `Production Backup Freshness` as `active`, and the latest
   freshness run is green. If either shows `disabled_inactivity`, re-enable it and treat the gap as missing backups.
3. Repository activity (a commit/PR merge) at least every 50 days keeps scheduled workflows enabled.
4. A red `Production Backup Freshness` run, or a red `Production Backup` run (including a refused ambiguous slot:
   job started > 30 min after its created_at), means a slot may be missing; the next on-time run restores coverage.
5. If an independent monitor outside GitHub is wanted, it is a new Owner-approved component (not part of this change).
6. Timestamp semantics (best effort, not authoritative): for the GitHub source `scheduled_at` is the run's `created_at`
   as GitHub recorded it — neither GitHub's intended scheduled occurrence (not exposed) nor the moment the dump is taken.
   The daily copy follows the creation hour (UTC 09); a 09:17 event delayed past 10:00 is simply not promoted that day
   (the freshness workflow turns red). Re-runs within 30 minutes keep the same R2 key; later re-runs are refused.
7. The selector variable must exist at repository level only (no same-named environment variable): the gate compares the
   repository-level value with the environment-resolved one and fails closed if they differ. Release proof = a run of both
   jobs after setting it.
8. Key uniqueness is not guaranteed: `created_at` has one-second precision, so two different runs created in the same second
   would write the same R2 key and the later upload overwrites the earlier one. Re-runs of one run share its key by design.

## Release procedure (separate approved step; nothing here is done by PR #56)
Preconditions: PR #56 merged by Owner/TD decision after natural CI success + review; `PRODUCTION_BACKUP_ACTIVATION=R4_APPROVED` already in place.
1. Set the selector at REPOSITORY level only (Settings → Secrets and variables → Actions → Variables → Repository variables):
   `PRODUCTION_BACKUP_SCHEDULER_SOURCE` = `GITHUB_SCHEDULE` (or `CLOUDFLARE_DISPATCH` to keep the Cloudflare source).
   Confirm there is no same-named variable under the `production-backup` environment or the organisation.
2. Verify the job branches in production without a backup being taken by choosing the value deliberately:
   - With the value unset/garbage, a run of `Production Backup` must go red in the `Activation gate` step (no secret step runs).
   - With `GITHUB_SCHEDULE`: the next natural `schedule` run must show `selector` ✓, `slot` ✓ (its `scheduled_at` output equals the run `created_at`),
     `backup` ✓ with the `Run production backup` step ✓. A `workflow_dispatch` must be refused red at the gate (do not dispatch manually without separate authority).
   - With `CLOUDFLARE_DISPATCH`: a natural `schedule` run shows `slot` skipped and `backup` gate skip (green, no backup); only the Worker's dispatch backs up.
3. Acceptance evidence: object read-back in R2 for the key derived from the run's `created_at`, plus a green `Production Backup Freshness` run.
4. Owner acceptance of the monitoring limits (items above: 60-day auto-disable, no guaranteed RPO) is recorded in Issue #47.
