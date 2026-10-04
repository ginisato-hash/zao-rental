# ZAO_R49_BACKUP_V1 installer v2 — review manifest (Issue 47)

Status: **review material only. Nothing here has been applied.** The Owner applies the installer once, only after the Technical Director's PASS.

| Item | Value |
|---|---|
| Installer | `ZAO_Claude_Backup_Scope_Setup_v2.py` (this directory), 34911 bytes |
| Installer sha256 | `c31bd76223e300ddef800af64825add0527048c1533202dcc9b5a3061063e013` |
| Requires | `ZAO_R49_AUTONOMY_V1` already saved in the user-scope settings (refuses otherwise) |
| Writes | `permissions.allow` (22 exact rules), `autoMode.environment` (5), `autoMode.allow` (6) — appended only |
| Never changed | `permissions.ask/deny`, `autoMode.soft_deny/hard_deny`, hooks, sandbox, managed controls, mode, every other key; preservation is asserted before writing; byte-exact backup; `--undo` restores only if settings are unchanged since |
| Modes | preview (default), `--apply`, `--undo <receipt>` |
| Helper commit | `26788ed74f71a88d8687e55376452fa625f5672c` |

## Pinned files (the installer refuses to run if any differs)

| File | sha256 |
|---|---|
| `scripts/production-backup-credential.ts` | `8b261b532c0c6e84b7928594e96bc0e43333bcc360a13d63f2389a3335f13d77` |
| `scripts/production-credential-activation.ts` | `f4f96805ccf5d92f4382d545135121b6e3f411cc366c9dc1a113f3b6f7278abf` |
| `scripts/production-backup.ts` | `a571e89675c70c38d342c54441db66313c976c55b1d31e1be873ece2105596e6` |

`package.json` must also carry exactly these four scripts (the only commands the installer allows for the lifecycle):

```
backup:set-age-recipient = node --import tsx scripts/production-backup-credential.ts set-age-recipient
backup:role-provision    = node --import tsx scripts/production-backup-credential.ts provision
backup:role-finalize     = node --import tsx scripts/production-backup-credential.ts finalize
backup:role-contain      = node --import tsx scripts/production-backup-credential.ts contain
```

## Design points

- No rule allows a raw `reset_password` POST. The helper is the only route: exact project `curly-union-23141081`, branch `br-long-king-azkou4fy`, role `neondb_backup`; one POST after a durable local guard is claimed; the response is captured in memory (child stdout is never inherited); the new password goes only to `gh secret set PRODUCTION_BACKUP_PGPASSWORD` over stdin (no `--body`); an unknown outcome is never resent.
- The owner role's connection URI is obtained through the Neon API into process memory only (host must equal the exact endpoint host, which must match the committed Production fingerprint) and is used only for the reviewed role-lifecycle statements and read-only posture readbacks. It is never printed, stored or passed in argv. This is the one point the Technical Director asked to review in the helper source before final acceptance.
- LOGIN lease is 90 minutes from the **database clock** (the first Production Backup workflow times out at 30 minutes). `finalize` (VALID UNTIL `infinity`) requires a restore PASS record. Any failure: delete `PRODUCTION_BACKUP_PGPASSWORD` and the activation variable, contain the role to `NOLOGIN PASSWORD NULL VALID UNTIL 'infinity'`, never retry `reset_password` blindly.
- Owner-only and absent from every rule and entry: `PRODUCTION_BACKUP_R2_ACCESS_KEY_ID`, `PRODUCTION_BACKUP_R2_SECRET_ACCESS_KEY`, the age identity, R2 token issuance.

## Executed / not executed

- Executed (synthetic only): installer preview, apply, second apply (idempotent), preservation, undo byte-identity, refusal on tampered helper/import/package script and on missing `ZAO_R49_AUTONOMY_V1`, all on a synthetic HOME; helper unit tests, and the real-PostgreSQL lifecycle leg in `test:production-foundation`.
- Not executed: the installer against the Owner's real settings; the effective-configuration readback in the Desktop session; any Neon, GitHub-environment or R2 operation against Production.
- Owner action pending: applying the installer once (after TD PASS), the age key custody and public recipient, the Cloudflare R2 credential into the protected sink, login/MFA.

# Exact rules and entries the installer appends (rendered from the installer with <HOME> standing for the Owner home directory)

## permissions.allow (22 exact rules appended)

1. `Bash(<HOME>/.npm/_npx/978debf9b3a75271/node_modules/.bin/neon api /projects/curly-union-23141081)`
2. `Bash(<HOME>/.npm/_npx/978debf9b3a75271/node_modules/.bin/neon api /projects/curly-union-23141081/branches/br-long-king-azkou4fy)`
3. `Bash(<HOME>/.npm/_npx/978debf9b3a75271/node_modules/.bin/neon api /projects/curly-union-23141081/branches/br-long-king-azkou4fy/databases)`
4. `Bash(<HOME>/.npm/_npx/978debf9b3a75271/node_modules/.bin/neon api /projects/curly-union-23141081/branches/br-long-king-azkou4fy/databases/neondb)`
5. `Bash(<HOME>/.npm/_npx/978debf9b3a75271/node_modules/.bin/neon api /projects/curly-union-23141081/branches/br-long-king-azkou4fy/roles)`
6. `Bash(<HOME>/.npm/_npx/978debf9b3a75271/node_modules/.bin/neon api /projects/curly-union-23141081/branches/br-long-king-azkou4fy/roles/neondb_backup)`
7. `Bash(<HOME>/.npm/_npx/978debf9b3a75271/node_modules/.bin/neon api /projects/curly-union-23141081/branches/br-long-king-azkou4fy/endpoints)`
8. `Bash(<HOME>/.npm/_npx/32026684e21afda6/node_modules/.bin/wrangler r2 bucket info zao-rental-prod-backup)`
9. `Bash(<HOME>/.npm/_npx/32026684e21afda6/node_modules/.bin/wrangler r2 bucket lifecycle list zao-rental-prod-backup)`
10. `Bash(<HOME>/.npm/_npx/32026684e21afda6/node_modules/.bin/wrangler whoami)`
11. `Bash(gh secret list --env production-backup --repo ginisato-hash/zao-rental)`
12. `Bash(gh variable list --env production-backup --repo ginisato-hash/zao-rental)`
13. `Bash(gh secret set PRODUCTION_BACKUP_R2_ACCOUNT_ID --env production-backup --repo ginisato-hash/zao-rental)`
14. `Bash(gh variable set PRODUCTION_BACKUP_BUCKET --env production-backup --repo ginisato-hash/zao-rental --body zao-rental-prod-backup)`
15. `Bash(gh secret delete PRODUCTION_BACKUP_PGPASSWORD --env production-backup --repo ginisato-hash/zao-rental)`
16. `Bash(gh variable delete PRODUCTION_BACKUP_ACTIVATION --env production-backup --repo ginisato-hash/zao-rental)`
17. `Bash(npm --prefix <HOME>/Documents/Codex/2026-10-03/files-pasted-by-the-user-zao/work/f2 run backup:set-age-recipient)`
18. `Bash(npm --prefix <HOME>/Documents/Codex/2026-10-03/files-pasted-by-the-user-zao/work/f2 run backup:role-provision)`
19. `Bash(npm --prefix <HOME>/Documents/Codex/2026-10-03/files-pasted-by-the-user-zao/work/f2 run backup:role-finalize)`
20. `Bash(npm --prefix <HOME>/Documents/Codex/2026-10-03/files-pasted-by-the-user-zao/work/f2 run backup:role-contain)`
21. `Edit(~/Documents/Codex/2026-10-03/files-pasted-by-the-user-zao/work/f2/.local/evidence/production-backup/**)`
22. `Bash(gh workflow run production-backup.yml --repo ginisato-hash/zao-rental --ref main -f scheduled_at=*)`

## autoMode.environment (5 entries appended; every existing entry stays)

1. ZAO_R49_BACKUP_V1: case-scoped addition to ZAO_R49_AUTONOMY_V1 (Issue #47 comment 5981665275 accepted it; v2 per comment 5981827674). Purpose: the pre-migration Production backup chain for ginisato-hash/zao-rental (backup, R2 readback, download, decrypt, disposable loopback PostgreSQL restore, invariants, RPO/RTO, cleanup) before migrations 0054/0055. Exact targets only: Neon project curly-union-23141081, branch br-long-king-azkou4fy, database neondb, role neondb_backup; GitHub Environment production-backup of ginisato-hash/zao-rental; the existing private Cloudflare R2 bucket zao-rental-prod-backup. These are destinations the Owner designated, not general trust. This entry changes nothing in ZAO_R49_AUTONOMY_V1, permission ask/deny rules, classifier hard_deny/soft_deny, hooks, sandbox or managed controls.

2. ZAO_R49_BACKUP_V1 Neon identity: the Neon CLI at <HOME>/.npm/_npx/978debf9b3a75271/node_modules/.bin/neon is the Owner's already-authenticated client; only the exact project, branch, database and role above may be addressed. Not authorized: neon me, projects list, orgs, api-keys, credentials, connection-string, psql, link/set-context, any other project/branch/database/role, branch create/reset/restore/delete, snapshots, endpoint restart or suspend, role create/delete, API-key or token creation, a raw reset_password or reveal_password call, reading ~/.config/neon or any other credential file. The only POST is the one inside the reviewed helper.

3. ZAO_R49_BACKUP_V1 Secrets and custody: names are identifiers, not values. The only credential this scope creates is the single password of role neondb_backup; it exists only in the helper's process memory and goes only to gh secret set PRODUCTION_BACKUP_PGPASSWORD over stdin (never stdout, logs, argv, a temp or environment file, the Issue or the chat). The helper also holds the neondb_owner connection URI in memory for the lifecycle statements; it is never printed or stored. R2 access-key credentials and the age identity (private key) are Owner-only: Claude never creates, reads, writes, regenerates or requests them, and never asks for permission to read the age identity file. The public age recipient is a non-secret Owner-supplied value.

4. ZAO_R49_BACKUP_V1 Data handling: the downloaded backup object is age ciphertext and stays only in a user-owned mode-0700 directory below the worktree's git-ignored .local/. Decryption needs the Owner-held identity and is run by the Owner as one command that prints only counts and digests. Claude restores only into an owned disposable loopback PostgreSQL named zr_<12 hex> (existing assertDisposableTarget/assertEmptyTarget), never over Production, and removes only successful owned disposable resources. No Production row data is read, exported or printed, and Claude writes no plaintext dump. Invariants are counts, migration registry/checksums and fingerprints.

5. ZAO_R49_BACKUP_V1 Order and stops: (1) age custody and the R2 credential sinks are ready; (2) neondb_backup is NOLOGIN and passwordless with privilege drift 0; (3) a temporary password is generated in memory; (4) SET LOCAL ROLE neondb_role_admin; (5) the temporary password is set while NOLOGIN; (6) ONE Neon reset_password POST; (7) the returned operations are finished; (8) a bounded LOGIN lease of 90 minutes from the DATABASE clock, covering the 30-minute first workflow; (9) a fresh direct TLS verify-full, channel-binding login; (10) read-only privilege/posture probes; (11) the PG credentials are sunk directly into the GitHub Environment; (12) PRODUCTION_BACKUP_ACTIVATION=R4_APPROVED last; (13) one Production Backup dispatch on main; (14) workflow SUCCESS; (15) encrypted R2 object readback; (16) Production restore drill PASS; (17) only after that PASS, steady-state LOGIN with VALID UNTIL 'infinity'; (18) then the hourly scheduler is enabled (outside this scope). Steps 1-12 are the provision helper, 17 is the finalize helper. On any failure: the scheduler is not enabled, PRODUCTION_BACKUP_PGPASSWORD is deleted, neondb_backup is contained to NOLOGIN PASSWORD NULL, and reset_password is never retried blindly. Migrations 0054/0055, the four EXECUTE grants, worker roles, CRON_SECRET, deployments, DNS and publication stay outside this scope and wait for the restore proof to PASS. A Neon PITR/branch snapshot may be recorded only as an extra read-only restore point (a UTC timestamp inside the project's history-retention window); creating Neon snapshots or branches is not authorized and never replaces the backup/restore proof.


## autoMode.allow (6 entries appended; every existing entry stays)

1. ZAO_R49_BACKUP_V1 Neon read-only verification: For ginisato-hash/zao-rental and the exact targets named in ZAO_R49_BACKUP_V1 only, permit exactly these GET reads: <HOME>/.npm/_npx/978debf9b3a75271/node_modules/.bin/neon api /projects/curly-union-23141081, <HOME>/.npm/_npx/978debf9b3a75271/node_modules/.bin/neon api /projects/curly-union-23141081/branches/br-long-king-azkou4fy, <HOME>/.npm/_npx/978debf9b3a75271/node_modules/.bin/neon api /projects/curly-union-23141081/branches/br-long-king-azkou4fy/databases, <HOME>/.npm/_npx/978debf9b3a75271/node_modules/.bin/neon api /projects/curly-union-23141081/branches/br-long-king-azkou4fy/databases/neondb, <HOME>/.npm/_npx/978debf9b3a75271/node_modules/.bin/neon api /projects/curly-union-23141081/branches/br-long-king-azkou4fy/roles, <HOME>/.npm/_npx/978debf9b3a75271/node_modules/.bin/neon api /projects/curly-union-23141081/branches/br-long-king-azkou4fy/roles/neondb_backup, <HOME>/.npm/_npx/978debf9b3a75271/node_modules/.bin/neon api /projects/curly-union-23141081/branches/br-long-king-azkou4fy/endpoints. They confirm project/branch/database/role identity, that neondb_backup exists, the direct (non-pooled) endpoint host and the project's history retention. They are metadata reads of the Owner's authenticated Neon identity; no credential value is read.

2. ZAO_R49_BACKUP_V1 Backup-role credential lifecycle (Technical Director accepted, v2): For ginisato-hash/zao-rental and the exact targets named in ZAO_R49_BACKUP_V1 only, permit ONLY the reviewed secret-safe helper, through exactly four commands run for <HOME>/Documents/Codex/2026-10-03/files-pasted-by-the-user-zao/work/f2: npm --prefix <HOME>/Documents/Codex/2026-10-03/files-pasted-by-the-user-zao/work/f2 run backup:set-age-recipient | backup:role-provision | backup:role-finalize | backup:role-contain. The helper (scripts/production-backup-credential.ts, sha256 8b261b532c0c...; direct imports scripts/production-credential-activation.ts and scripts/production-backup.ts also pinned) is the sole route to the Neon reset_password POST for role neondb_backup: a raw `neon api ... reset_password -X POST`, reveal_password, or any other direct POST/PUT/PATCH/DELETE to Neon is not authorized, and neither is editing the helper or its pinned imports under this entry. Inside, the helper: captures every Neon response in memory (child stdout is never inherited); claims a durable local guard and makes exactly one POST to /projects/curly-union-23141081/branches/br-long-king-azkou4fy/roles/neondb_backup/reset_password, never resending it after an unknown outcome; obtains the owner role's connection URI for database neondb on the exact branch through the Neon API into process memory only (host must equal the exact endpoint host; never printed or stored), solely to run the reviewed role-lifecycle statements (SET LOCAL ROLE neondb_role_admin; ALTER ROLE neondb_backup ...) and read-only role-posture readbacks, with no application-table read; sets the temporary password only while the role is NOLOGIN and never puts a secret in argv; leases LOGIN to a database-clock deadline of 90 minutes (the first Production Backup workflow has a 30-minute timeout); proves a fresh direct TLS verify-full, channel-binding login and read-only posture (no business row is read); sends the new password only to gh secret set PRODUCTION_BACKUP_PGPASSWORD over stdin; sets PRODUCTION_BACKUP_ACTIVATION last; and on any failure contains the role (NOLOGIN PASSWORD NULL VALID UNTIL 'infinity') and deletes that secret and the activation variable. finalize (VALID UNTIL 'infinity') runs only after a restore PASS record exists.

3. ZAO_R49_BACKUP_V1 GitHub Environment production-backup: For ginisato-hash/zao-rental and the exact targets named in ZAO_R49_BACKUP_V1 only, three variables are in scope: PRODUCTION_BACKUP_BUCKET (= zao-rental-prod-backup); AGE_BACKUP_RECIPIENT, the Owner's public age1... recipient, which Claude sets through npm run backup:set-age-recipient only after the helper validates it as a public recipient (a private AGE-SECRET-KEY value is rejected) and never overwrites with a different value; and PRODUCTION_BACKUP_ACTIVATION = R4_APPROVED, set by the provision helper strictly last after every precondition and sink is read back (deleted to stop). Secrets: the helper alone writes PRODUCTION_BACKUP_PGHOST, PRODUCTION_BACKUP_PGPORT, PRODUCTION_BACKUP_PGDATABASE, PRODUCTION_BACKUP_PGUSER, PRODUCTION_BACKUP_PGPASSWORD (PGHOST is the direct non-pooled host of the exact branch's endpoint and must match the committed Production fingerprint; PGPORT 5432; PGDATABASE neondb; PGUSER neondb_backup); Claude may also write PRODUCTION_BACKUP_R2_ACCOUNT_ID (a non-secret Cloudflare account id) with gh secret set over stdin. Metadata readback with gh secret list and gh variable list. Not authorized: any other secret or variable, repository- or organization-level secrets, other environments, the Owner-only PRODUCTION_BACKUP_R2_ACCESS_KEY_ID, PRODUCTION_BACKUP_R2_SECRET_ACCESS_KEY, changing environment protection or the branch policy, or reading a secret value.

4. ZAO_R49_BACKUP_V1 Production Backup run: For ginisato-hash/zao-rental and the exact targets named in ZAO_R49_BACKUP_V1 only, permit exactly one gh workflow run production-backup.yml --repo ginisato-hash/zao-rental --ref main -f scheduled_at=<canonical UTC ISO-8601> after the provision helper reports PROVISIONED and before the LOGIN lease deadline it printed, and read-only inspection (gh run list/view/log, artifacts) of that run. Not authorized: a rerun, a retry after a failed run without a reported cause, another workflow or ref, or a dispatch while PRODUCTION_BACKUP_ACTIVATION is unset. A failed run is read and reported.

5. ZAO_R49_BACKUP_V1 Cloudflare R2: For ginisato-hash/zao-rental and the exact targets named in ZAO_R49_BACKUP_V1 only, permit wrangler (<HOME>/.npm/_npx/32026684e21afda6/node_modules/.bin/wrangler) read-only operations on bucket zao-rental-prod-backup: r2 bucket info, r2 bucket lifecycle list, and r2 object get zao-rental-prod-backup/<key> --remote --file <path> for the object the Production Backup run produced (hourly/YYYY/MM/DD/<timestamp>.dump.age) into the mode-0700 directory below the worktree's .local/; plus one wrangler whoami to read the Cloudflare account id (non-secret) for PRODUCTION_BACKUP_R2_ACCOUNT_ID. Not authorized: object put or delete, bucket create or delete, lifecycle/CORS/domain/public-access changes, token or API-key creation, other buckets or accounts.

6. ZAO_R49_BACKUP_V1 Restore proof: For ginisato-hash/zao-rental and the exact targets named in ZAO_R49_BACKUP_V1 only, permit preparing the Owner's input file and one exact restore command (existing npm run restore:production-drill with the PG18 client from npm run setup:pg18-client), the post-restore registry/checksum/critical-fingerprint/row-count checks and RPO/RTO measurement against an owned loopback disposable PostgreSQL, recording the sanitized PASS (object key, ciphertext sha256) and the Owner's public recipient only under <HOME>/Documents/Codex/2026-10-03/files-pasted-by-the-user-zao/work/f2/.local/evidence/production-backup/, and cleanup of those owned resources and of Claude's local ciphertext copies. The Owner runs the single decrypt-and-restore command because it needs the private age identity; Claude never asks to read it.

