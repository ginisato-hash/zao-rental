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
   created > 45 min after its :17 slot), means a slot may be missing; the next on-time run restores coverage.
5. If an independent monitor outside GitHub is wanted, it is a new Owner-approved component (not part of this change).
