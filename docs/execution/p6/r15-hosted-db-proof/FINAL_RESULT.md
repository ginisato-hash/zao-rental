# R15 F3 hosted DB proof — HOSTED_DB_PROOF_FAIL

Starting local/remote HEAD: `de78cafeedb3181c476f2a70dab08169748ae8da`.
This report belongs to its containing evidence commit; that commit is not a PASS review target.
Owner authority SHA-256: `71e1c11c33a14a1488b83e759adec9ab27d08892757e634b93c9b463ed33fede`.

## Result and stop

The single provider-supported credential handoff succeeded (HTTP200). Real TLS PostgreSQL
metadata established Neon/non-loopback and the existing resource's empty initial state.
The canonical `migrateHostedDevelopment` invocation then failed with SQLSTATE `42501`
(`insufficient_privilege`). The exact failing SQL statement/migration number was not
retained; no specific privilege cause is claimed. There was no migration retry or fix.
Read-only follow-up confirmed complete rollback: no foundation_migrations table, no user
tables, only public schema, and no ZAO runtime roles. Owner CASE C applies.

| Check | Observed result |
| --- | --- |
| Existing resource | store_i5vh0ZEKo2ikcVo9; available; free_v3 / Free; paymentMethodRequired false; connected projects0 before execution |
| New Neon resources | 0 |
| Credential acquisition | PASS; logical attempt1/1; observed credential HTTP request1; retry0; normal Owner login/email verification |
| Hosted identity | Neon, non-loopback; host fingerprint only retained; setup owner verified |
| Development database | zr_852b20c4d4b0 created once and retained empty |
| Migration sources | PASS: unchanged 0001–0029 plus exact0030; 30 source hashes verified |
| Hosted migrations | FAIL/42501; canonical invocation1; applied0; rollback confirmed |
| Six-role model | NOT_RUN; provisioning0; runtime roles/credentials0 |
| Positive tests | NOT_RUN; executed0/pass0/fail0 |
| Negative tests | NOT_RUN; executed0/pass0/fail0 |
| Hosted guard tests | NOT_RUN; executed0/pass0/fail0; no action reservations |
| Credential staging | NONE; no secret files; RAM references cleared; process terminated |
| Cleanup | DB pools/browser closed; empty owned database retained; guard retained |
| Vercel mutation/deploy | 0/0 |
| Square/payment/refund/webhook/Production | all0 |
| Secret exposure | 0 in tool output, terminal, Git, evidence, prompt, argv, history or exported browser state |

The normal auth flow resumed once after Owner-reported email verification. Local browser
binary/module-loader preparation errors occurred before any dependent DB operation; they
did not repeat credential acquisition or migration. After cleanup, the idle local operator
was terminated with SIGINT (exit1); DB cleanup had already completed successfully.

## Independent review and remaining gate

Claude F3 review **NOT_RUN (0/1)** because hosted proof did not pass. Total review budget
maximum4: initial1/1 consumed; correction1/1 consumed; F3 hosted proof0/1; post-live final0/1
reserved. Historical initial CHANGES_REQUIRED (HIGH3/LOW1) and correction CHANGES_REQUIRED
are unchanged. F1/F2 remain closed only in their demonstrated scopes. F3 remains OPEN/HIGH;
F4 and NEW1 remain LOW. Current counts: BLOCKER0/HIGH1/MEDIUM0/LOW2. The post-review
b541999→de78cafe test-driver/evidence correction remains independently unreviewed.

Next exact gate: ChatGPT Technical Director assessment of the migration permission failure
and the unchanged hosted migration path. Any next execution requires explicit bounded Owner
authority that reconciles the retained empty database and credential reacquisition. Do not
retry migrations, broaden permissions, recreate resource/database, change product/migration/
role policy, launch Claude, or resume Vercel/ingress/Square/webhook/live acceptance here.

## Evidence

See authority, preflight, resource metadata, source hashes, hosted metadata, migration result,
post-failure readback, NOT_RUN role/test records, credential handling, cleanup, operation
counts and review-result JSON files in this directory. Product/migration/role sources are
unchanged. Local validation and final GitHub readback are recorded separately.

Local evidence checks: secret scan PASS (1530 candidate files at check time), reference
check PASS (32 byte-preserved files), JSON parsing PASS, diff check PASS, authority hash
PASS, product/migration/role-policy and historical review preservation PASS. Lint,
typecheck and build were not rerun for these authority/evidence/status-only changes.
