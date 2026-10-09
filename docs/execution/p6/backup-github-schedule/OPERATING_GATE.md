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

## Release procedure (separate approved steps; nothing here is done by PR #56)
Never set a garbage selector value in Production and never dispatch manually to exercise error paths: those paths are
covered by the offline tests (S1, S2, S2b, S4). Production steps below only observe natural runs.

### A. Pre-release verification — NO production backup is taken
Preconditions: PR #56 merged by Owner/TD decision after natural CI success + review. Selector still unset.
1. Observe the next natural `schedule` run of `Production Backup`: `selector` ✓, `slot` skipped, `backup` **skipped**
   (no `production-backup` environment entry, no secret step). This is the inert-by-default state.
2. Confirm in Settings → Secrets and variables → Actions that `PRODUCTION_BACKUP_SCHEDULER_SOURCE` exists nowhere yet
   (repository, `production-backup` environment, organisation), so the later setting has a single repository-level source.
3. Note: while unset, a Cloudflare Worker dispatch (if its cron ever fires) is refused red in `slot` — no backup, no
   environment entry. Record it as expected, not as a failure of the backup body.

### B. Activation and live backup verification — requires separate Owner authority
1. Owner sets the REPOSITORY variable `PRODUCTION_BACKUP_SCHEDULER_SOURCE=GITHUB_SCHEDULE` (only there).
2. Observe the next natural `schedule` run: `selector` ✓, `slot` ✓ with `scheduled_at` equal to the run's `created_at`,
   `backup` ✓ with `Activation gate` passed=true (repository and environment values equal) and `Run production backup` ✓.
3. Read back the R2 object for the key derived from that `scheduled_at` (and the daily copy when created in UTC hour 09).
4. Observe a green `Production Backup Freshness` run.
5. Owner records acceptance of the monitoring limits (items 1–8 above) in Issue #47. Rollback = delete the variable
   (schedule runs skip again); no code change needed.
