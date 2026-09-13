# P1 release checklist — deployment remains unapproved

All real decisions/evidence must reference the release head, configuration revision, owner/approver, timestamp and evidence expiry. `config/production/launch-gates.json` remains pending; no environment flag or UI button can turn this checklist into deployment authority.

| Area | Required production evidence / remaining operation | Current verification boundary |
|---|---|---|
| Guest policy | Owner chooses access, absolute, recovery, replay TTL, retention and admission budgets; version immutable | PG policy fingerprint, expiry/revoke/rate/replay tests with synthetic values |
| Trusted ingress | Hosting-specific trusted proxy/socket identity, IP minimization, edge limits and capacity | Injected server peer adapter; no forwarded-header trust or live edge |
| Recovery | Safe code storage UX, key continuity/rotation, recovery-code loss procedure, accessible translations | Normal UI/API/PG replay; no email or identity-proof support workflow |
| Retention | Profile/preview/contact/contract retention, consent/legal hold/deletion decision | Bounded unused-draft redaction only; booking/audit untouched |
| Square | Explicit Sandbox credentials/merchant/location/tokenization, verified notification URL, Sandbox replay/UNKNOWN/live webhook matrix | Pure adapter fixtures + existing actual-PG simulated state machine; real Sandbox incomplete |
| Migration | Rehearse additive0021 on restore of prior release; verify checksums, foreign keys, row counts, permissions and concurrency; backups first | Existing migration rollback/recovery/populated-upgrade regression; no production apply |
| DB rollback | Roll back application only where schema-compatible; if any migration fails transaction/history remain unchanged; no blind down-migration or truncate | Existing transaction-failure recovery and checksum drift tests; new table drop not a prod rollback procedure |
| Backup/restore | Select encrypted backup/PITR provider, retention/RPO/RTO and key owner; restore into a separate restricted DB and compare constraints/counts/snapshots; record timed evidence | Production backup/PITR/restore not executed or configured |
| Secrets | Existing approved secret manager/identity, least-privilege app/migration separation, audit access, rotation rehearsal; no secrets in CLI/log/trace | API errors restricted; pseudonymous rate keys, hash-only recovery; new store/credentials absent |
| Media provider | Private immutable originals; approved derivatives only; digest/CAS/revision; withdraw/revalidate after fetch; rollback still checks current rights; CDN purge proof | PG adapter + provider-neutral interface; actual provider/CDN unconnected |
| Real catalog | Actual receipts, document digest/row, model/season/SKU/variant, store, pair/piece units, explicit immutable IDs; reconcile totals/ADD vs REPLACE | Synthetic deterministic planner, no real import or production writer |
| Observability | Approved metrics/log sink, retention/access controls, request ID; code-only failures; exclude cookies/body/contact/address/recovery/payment tokens | Strict categorical event schema; external sink/retention not configured |
| Alert | Deliver test alarms for UNKNOWN/payment mismatch, DB health, backup failure and rate saturation; on-call owner and escalation | Delivery/owner/SLO unresolved; no test email sent |
| Health/readiness | Minimal public liveness; private dependency readiness (DB/schema/policy/credentials); deploy only after bound evidence and operator approval | Existing health path and validated readiness contract; no live production probe |
| Release/rollback | Signed review + exact CI/head/config, owner release approval, maintenance/drain plan, migration compatibility, smoke/rollback criteria | New PR remains Draft; no production release or auto-merge |
| Device | Actual iOS Safari/Android Chrome/tablet, front/rear camera, deny/revoke permission, background/rotation/slow radio, duplicate scan, offline/reload, exact loan cycle | Chromium synthetic camera +320/360/390/430/768/1024 widths/touch; real hardware pending |
| CWV | Field collection consent/sampling/device/route categories; LCP/INP/CLS; real network/CPU evidence; no ranking promise | LAB/FIELD metric contract only; not actual CWV measurements |
| SEO | Current JA/EN initial HTML, canonical/hreflang/x-default/sitemap/robots/JSON-LD; private and query noindex; only verified model/NAP/rights | Full P0 SEO regression retained, production indexing still off |
| External listing | Owner public release first, then Search Console, Google Business Profile and Zao official rental listing | No external registration/submission performed |

## Commercial / legal owner decisions

Tax classification and calculation approval; season; actual coupons/stacking; cleaning durations; official NAP; cancellation/refund copy; final delayed-pickup copy; material rights are **not set by P1**. The owner-approved delayed pickup behavior remains binding; final customer/legal wording still requires review. Approved business rules including no unused-day refund, original return due/price, no same-day recirculation and wear size quantities remain unchanged.

## Supervised operations

No sweeper, scheduler, Runner or service is installed. Production readiness does not mean production-ready. Start development through existing test/demo scripts only with synthetic data, bound127.0.0.1 and isolated worktree DB; stop only owned processes in finally/Ctrl+C. Do not use raw production dumps in this repository or review payload. Production operations require separate approval and provisioned environment.
