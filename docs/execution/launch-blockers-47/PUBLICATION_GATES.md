# Publication gates — what actually enforces each condition (Issue #47, inventory 6103023533)

`config/production/launch-gates.json` is read only by the offline report `scripts/production-preflight.ts` (and a test harness).
No runtime path and no installer reads it, so changing its states neither opens nor closes anything. Its states stay as they are
(no blanket PASS); each gate is closed by the sink below, bound to the final release.

| Condition | Enforcing sink (code) | Current evidence | Open |
|---|---|---|---|
| Publication (indexing, public origin) | `PRODUCTION_PUBLICATION_APPROVAL` env → `parsePublicationApproval` → `issuePublicationAuthority` (exact identity, origin `https://salomon-rental.yuge-zao.com`, `releaseId` = `PRODUCTION_RELEASE_ID` of the deployed release). `production-activation-plan.ts` keeps it absent until publication GO | Owner publication GO (Issue #47 title) | Bound only at the final release, after the TD publication decision |
| Commercial checkout | `legalCheckoutReady()` in `GuestBookingService.prepare()` / checkout (`packages/core/src/content/public-legal.ts`) | 8 legal texts `OWNER_APPROVED` (6090629658) | — |
| 0056 install | `requirePre0056RestorePass(root)` (`scripts/production-restore-evidence-pre0056.ts`) in `production-install-refund-automation.ts`; record `.local/evidence/production-backup/restore-pass-pre-0056.json` derived from `restore-drill-result-pre-0056.json` | — (the 2026-10-06 record is the frozen pre-0054 contract and stale) | Final PR merged → read back the Production registry (expected 0001–0055) → new natural backup's R2 object → isolated Production restore drill with `expectedMigrations: 55` → `npm run production:restore-evidence-finalize-pre-0056` (no arguments) → 0056 migrate / 3 grants / readback while the record is within 24 h |
| Backup schedule | `PRODUCTION_BACKUP_SCHEDULER_SOURCE` (PR #56, OPERATING_GATE A/B) | PR #56 merged (main 4a4a795); selector unset (inert) | A (inert natural run), B (activation, natural backup, R2 readback, freshness, notification delivery) |
| Worker mail / refunds | `PRODUCTION_WORKER_NOTIFICATION_LIMIT`, `PRODUCTION_WORKER_REFUND_CREATE_LIMIT` (unset = 0 = stopped), `PRODUCTION_WORKER_ACCEPTED_AFTER` | Owner decisions 6090166024 | Values bound for the limited live acceptance (1 payment ≤ ¥5,000, its full refund, 1 mail) |
| Store information | `config/content/public-p0-pages.json` store pages; `locationSchema` emits LocalBusiness only with verified address + telephone | Hours 08:30–17:00 both stores; Central Station address | Mountain Station handover address; store telephone/access (structured data stays off until then) |
| Visual acceptance | TD review (not code) | 5 image blobs (6102653395) | TD independent re-score (85 target) |

The final release is the main commit that is deployed with `PRODUCTION_RELEASE_ID`; the installers additionally require `HEAD == origin/main`, clean.
