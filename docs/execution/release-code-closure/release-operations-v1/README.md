# ZAO_RELEASE_OPERATIONS_V1 installer v1 — review manifest (Issue 47)

Status: **review material only. Nothing here has been applied.** Technical Director decision (Issue #47 comment 5987066963, section 3): the business approvals for the remaining publication steps already exist; this ONE additive, case-scoped settings addition replaces per-command approval for the exact commands they need. The Owner applies it once, only after the Technical Director's PASS of these exact bytes, together with the already reviewed backup installer (v2) in one sitting.

| Item | Value |
|---|---|
| Installer | `ZAO_Claude_Release_Operations_Setup_v1.py` (this directory) |
| Installer sha256 | **Not recorded by Primary.** The execution environment refused Primary's attempt to hash the installer file (`[Self-Modification]`); that was not worked around. The Technical Director records the sha256 of the reviewed bytes, and the Owner checks it with `shasum -a 256 <installer>` before applying (the Owner sheet says so). |
| Requires | `ZAO_R49_AUTONOMY_V1` already saved in the user-scope settings (refuses otherwise). Builds on `ZAO_R49_BACKUP_V1` (installer v2, bytes unchanged, applied separately or first). |
| Writes | `permissions.allow` (35 exact rules), `autoMode.environment` (5), `autoMode.allow` (5) — appended only |
| Never changed | `permissions.ask/deny`, `autoMode.soft_deny/hard_deny`, hooks, sandbox, managed controls, mode, every other key; preservation is asserted before writing; byte-exact backup; `--undo` restores only if settings are unchanged since |
| Modes | preview (default), `--apply`, `--undo <receipt>`, `--print-manifest` (prints the exact rules and entries below; writes nothing) |
| Not included | a change of the project's deployment protection (the final protection switch stays the Owner's one dashboard action or a later separately reviewed helper), DNS provider access, the parent domain's records, raw Neon/Vercel/GitHub POST or PATCH, reading any password or token, reissuing the existing commercial roles, billing, unapproved payments/refunds/mail, any permission or hook change |

## Pinned files (the installer refuses to run if any differs)

The lifecycle code of PR #51 (merged source), the fixed SQL, and the four files PR #50's backup installer already pins:

| File | sha256 |
|---|---|
| `scripts/production-restore-evidence.ts` | `2092f424ad1da7c095f12cd363887290bb6273a7d6e979c121e4f2ea0cc2675b` |
| `scripts/lib/registry-digest.ts` | `a144dfcb1c7b6799daf45628b1f72cd2a6c45ef07713525fcb0ffd08b8d38180` |
| `scripts/lib/production-owner-session.ts` | `21ff1f63f1df87561f3a244ebd6b499c2a116ee4e77b34e50443f82e266674fc` |
| `scripts/production-install-normal-worker.ts` | `0fedc4bb9e0d7f8a6d9ca66fb4d51c2ef737fd73565ede175b62a34110904a3f` |
| `scripts/production-normal-worker-migration.ts` | `1fd13e722b2895ec5cef5a103a96b1137b8dcbf9732d3a1a4b52a08fd20934b5` |
| `scripts/production-normal-worker-grants.ts` | `16582f0da02b1dc30f9233ae12cd5eaea10e6f57b5fef124aeca0e9233e8285c` |
| `scripts/production-worker-credential.ts` | `2ce917f92e877c8ebe513cdd1d50331b6672f4d0667e3ee1f755f275afe7a928` |
| `scripts/production-worker-dormant-proof.ts` | `278e31dac86e745e8fc0c63b4d24fefd5c18bee645681391a48984617903acbe` |
| `scripts/production-worker-freshness.ts` | `255c1d2618dfad7edec87231bdfa1b88224f333c3741a8c5b2190f89b78ac70c` |
| `packages/db/migrations/0054_provisional_receipt_capacity.sql` | `6aefbc51e167b2c070c35212e27a83d5a49545cd7012ecbb67ab9c7edfb5aea8` |
| `packages/db/migrations/0055_normal_production_worker.sql` | `ef13d125dd5a7a516e437f97a8e7e2c418fbe8f6fd70973f1917428e2cfc9f03` |
| `scripts/production-backup-credential.ts` (PR #50 pin) | `e71a9ca8e9e283c619fa4591c9ddd2d28223b7d2ba1515cd9025cd27fb1e5c72` |
| `scripts/production-backup-object-get.ts` (PR #50 pin) | `64fca6e2628a485394fc9a2b0fa4642e2fab412993985782526eb78056813c08` |
| `scripts/production-credential-activation.ts` (PR #50 pin) | `f4f96805ccf5d92f4382d545135121b6e3f411cc366c9dc1a113f3b6f7278abf` |
| `scripts/production-backup.ts` (PR #50 pin) | `a571e89675c70c38d342c54441db66313c976c55b1d31e1be873ece2105596e6` |

`tests/unit/release-operations-installer.test.ts` fails if any pinned file or package script no longer matches the installer, so a later source change forces a re-pin and a new review. The pins above are for the candidate that carries the worker Neon adapter (M3); they are re-checked at the final exact source.

`package.json` must carry exactly these eight scripts (the only npm commands the installer allows):

```
production:restore-evidence-finalize       = node --import tsx scripts/production-restore-evidence.ts
production:install-normal-worker-migration = node --import tsx scripts/production-install-normal-worker.ts migrate
production:install-normal-worker-grants    = node --import tsx scripts/production-install-normal-worker.ts grants
production:worker-roles-contain            = node --import tsx scripts/production-worker-credential.ts contain
production:worker-bind-cron-secret         = node --import tsx scripts/production-worker-credential.ts bind-cron-secret
production:worker-dormant-proof            = node --import tsx scripts/production-worker-dormant-proof.ts
production:worker-roles-provision          = node --import tsx scripts/production-worker-credential.ts provision
monitor:worker-freshness                   = node --import tsx scripts/production-worker-freshness.ts
```

## Design points

- No rule allows a raw Neon, Vercel or GitHub write. Database and credential effects happen only inside the reviewed, no-argument package scripts, which keep owner URIs and passwords in process memory, print fixed codes and carry their own admission checks (accepted merged main, clean tree, machine-derived restore PASS, live-derived dark proof). Sensitive Vercel variables (CRON_SECRET and the three worker password sinks) are written only by those scripts over stdin.
- Variables Primary sets directly are non-secret: `PRODUCTION_RELEASE_ID`, `PRODUCTION_WORKER_ACCEPTED_AFTER` (canonical UTC cutoff), `PRODUCTION_WORKER_TICK_ACTIVATION` (constant `NORMAL_WORKER_TICK_APPROVED`, exact value in the rule), `PRODUCTION_PUBLIC_ORIGIN` (exact value `https://salomon-rental.yuge-zao.com`), `PRODUCTION_PUBLICATION_APPROVAL`; each with a matching `env rm` for stop/rollback. The only wildcards are one canonical value (release commit, cutoff, publication record) and one `dpl_*` deployment id for `vercel inspect`.
- Deployment is `vercel deploy --cwd <worktree> --prod --yes` for exactly project `prj_ehUMOzM77em9DVnHJBJffncD5hg7` in scope `zao-food-map`; the domain rules attach and inspect only `salomon-rental.yuge-zao.com` for project `zao-rental`; `dig` and `curl` are read-only checks of that one host (every mention of `yuge-zao.com` in a rule is the full host; asserted by the test).
- The installer text states the order and stop conditions; it does not make the steps happen. "No dormant log lines" is never a PASS and project protection is never lowered to obtain a proof.
- Owner-only and absent from every rule and entry: the settings application itself, the age identity, the R2 credentials, MFA/login, the DNS provider account, the final protection switch, any new billing.

## Executed / not executed

- Executed (synthetic only, `tests/unit/release-operations-installer.test.ts`): pins equal the repository, package scripts equal, a synthetic HOME with a synthetic worktree: preview writes nothing, `--print-manifest`, apply is additive and idempotent, every other key is preserved, undo is byte-exact and refused after a later edit; refusal (settings untouched, no backup directory) on a changed lifecycle file, SQL file, backup helper or package script, a missing autonomy policy, a missing `permissions` object, a missing settings file and another origin repository. Rule-shape assertions: no raw API/write verbs/tokens/shell composition, the exact wildcard set, the parent domain never addressed.
- Not executed: the installer against the Owner's real settings; the effective-configuration readback in the Desktop session (`installed` and `effective` are separate facts — only the readback proves the latter); any Production, Neon, Vercel, GitHub-environment or DNS operation.
- Owner action pending: apply the reviewed backup installer (v2) and this installer once after the Technical Director's PASS (one sitting, preview first), then the one-shot items in `OWNER_ONE_SHOT_SHEET.md`.

# Exact rules and entries the installer appends (rendered by `--print-manifest` on a synthetic HOME; `<HOME>` stands for the Owner home directory)

## permissions.allow (35 exact rules appended)

1. `Bash(npm --prefix <HOME>/Documents/Codex/2026-10-03/files-pasted-by-the-user-zao/work/f2 run production:restore-evidence-finalize)`
2. `Bash(npm --prefix <HOME>/Documents/Codex/2026-10-03/files-pasted-by-the-user-zao/work/f2 run production:install-normal-worker-migration)`
3. `Bash(npm --prefix <HOME>/Documents/Codex/2026-10-03/files-pasted-by-the-user-zao/work/f2 run production:install-normal-worker-grants)`
4. `Bash(npm --prefix <HOME>/Documents/Codex/2026-10-03/files-pasted-by-the-user-zao/work/f2 run production:worker-roles-contain)`
5. `Bash(npm --prefix <HOME>/Documents/Codex/2026-10-03/files-pasted-by-the-user-zao/work/f2 run production:worker-bind-cron-secret)`
6. `Bash(npm --prefix <HOME>/Documents/Codex/2026-10-03/files-pasted-by-the-user-zao/work/f2 run production:worker-dormant-proof)`
7. `Bash(npm --prefix <HOME>/Documents/Codex/2026-10-03/files-pasted-by-the-user-zao/work/f2 run production:worker-roles-provision)`
8. `Bash(npm --prefix <HOME>/Documents/Codex/2026-10-03/files-pasted-by-the-user-zao/work/f2 run monitor:worker-freshness -- --expected-active)`
9. `Bash(npm --prefix <HOME>/Documents/Codex/2026-10-03/files-pasted-by-the-user-zao/work/f2 run monitor:worker-freshness -- --intentional-stop)`
10. `Bash(<HOME>/.npm/_npx/69f9afb961c37556/node_modules/.bin/vercel env add PRODUCTION_RELEASE_ID production --value * --no-sensitive --yes --project prj_ehUMOzM77em9DVnHJBJffncD5hg7 --scope zao-food-map)`
11. `Bash(<HOME>/.npm/_npx/69f9afb961c37556/node_modules/.bin/vercel env rm PRODUCTION_RELEASE_ID production --yes --project prj_ehUMOzM77em9DVnHJBJffncD5hg7 --scope zao-food-map)`
12. `Bash(<HOME>/.npm/_npx/69f9afb961c37556/node_modules/.bin/vercel env add PRODUCTION_WORKER_ACCEPTED_AFTER production --value * --no-sensitive --yes --project prj_ehUMOzM77em9DVnHJBJffncD5hg7 --scope zao-food-map)`
13. `Bash(<HOME>/.npm/_npx/69f9afb961c37556/node_modules/.bin/vercel env rm PRODUCTION_WORKER_ACCEPTED_AFTER production --yes --project prj_ehUMOzM77em9DVnHJBJffncD5hg7 --scope zao-food-map)`
14. `Bash(<HOME>/.npm/_npx/69f9afb961c37556/node_modules/.bin/vercel env add PRODUCTION_WORKER_TICK_ACTIVATION production --value NORMAL_WORKER_TICK_APPROVED --no-sensitive --yes --project prj_ehUMOzM77em9DVnHJBJffncD5hg7 --scope zao-food-map)`
15. `Bash(<HOME>/.npm/_npx/69f9afb961c37556/node_modules/.bin/vercel env rm PRODUCTION_WORKER_TICK_ACTIVATION production --yes --project prj_ehUMOzM77em9DVnHJBJffncD5hg7 --scope zao-food-map)`
16. `Bash(<HOME>/.npm/_npx/69f9afb961c37556/node_modules/.bin/vercel env add PRODUCTION_PUBLIC_ORIGIN production --value https://salomon-rental.yuge-zao.com --no-sensitive --yes --project prj_ehUMOzM77em9DVnHJBJffncD5hg7 --scope zao-food-map)`
17. `Bash(<HOME>/.npm/_npx/69f9afb961c37556/node_modules/.bin/vercel env rm PRODUCTION_PUBLIC_ORIGIN production --yes --project prj_ehUMOzM77em9DVnHJBJffncD5hg7 --scope zao-food-map)`
18. `Bash(<HOME>/.npm/_npx/69f9afb961c37556/node_modules/.bin/vercel env add PRODUCTION_PUBLICATION_APPROVAL production --value * --no-sensitive --yes --project prj_ehUMOzM77em9DVnHJBJffncD5hg7 --scope zao-food-map)`
19. `Bash(<HOME>/.npm/_npx/69f9afb961c37556/node_modules/.bin/vercel env rm PRODUCTION_PUBLICATION_APPROVAL production --yes --project prj_ehUMOzM77em9DVnHJBJffncD5hg7 --scope zao-food-map)`
20. `Bash(<HOME>/.npm/_npx/69f9afb961c37556/node_modules/.bin/vercel deploy --cwd <HOME>/Documents/Codex/2026-10-03/files-pasted-by-the-user-zao/work/f2 --prod --yes --project prj_ehUMOzM77em9DVnHJBJffncD5hg7 --scope zao-food-map)`
21. `Bash(<HOME>/.npm/_npx/69f9afb961c37556/node_modules/.bin/vercel inspect dpl_* --scope zao-food-map)`
22. `Bash(<HOME>/.npm/_npx/69f9afb961c37556/node_modules/.bin/vercel domains add salomon-rental.yuge-zao.com zao-rental --scope zao-food-map)`
23. `Bash(<HOME>/.npm/_npx/69f9afb961c37556/node_modules/.bin/vercel domains inspect salomon-rental.yuge-zao.com --scope zao-food-map)`
24. `Bash(dig +short A salomon-rental.yuge-zao.com)`
25. `Bash(dig +short AAAA salomon-rental.yuge-zao.com)`
26. `Bash(dig +short CNAME salomon-rental.yuge-zao.com)`
27. `Bash(curl -sS -o /dev/null -D - https://salomon-rental.yuge-zao.com/)`
28. `Bash(curl -sS -o /dev/null -D - https://salomon-rental.yuge-zao.com/ja)`
29. `Bash(curl -sS -o /dev/null -D - https://salomon-rental.yuge-zao.com/en)`
30. `Bash(curl -sS -o /dev/null -D - https://salomon-rental.yuge-zao.com/robots.txt)`
31. `Bash(curl -sS -o /dev/null -D - https://salomon-rental.yuge-zao.com/sitemap.xml)`
32. `Bash(curl -sS -o /dev/null -D - https://salomon-rental.yuge-zao.com/api/readiness)`
33. `Bash(git -C <HOME>/Documents/Codex/2026-10-03/files-pasted-by-the-user-zao/work/f2 fetch origin)`
34. `Bash(git -C <HOME>/Documents/Codex/2026-10-03/files-pasted-by-the-user-zao/work/f2 switch --detach origin/main)`
35. `Edit(~/Documents/Codex/2026-10-03/files-pasted-by-the-user-zao/work/f2/.local/evidence/production-worker/**)`

The `autoMode.environment` (5) and `autoMode.allow` (5) entries are printed in full by `python3 ZAO_Claude_Release_Operations_Setup_v1.py --print-manifest` (the exact text is in the installer's `context_entries()` and `classifier_allow_entries()`); they restate the targets, the not-authorized list, the reviewed commands, the variables and their values, the deployment/domain limits and the strict step order with the stop/rollback meaning.
