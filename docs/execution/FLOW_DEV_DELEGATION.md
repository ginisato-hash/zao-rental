# ZAO-RENTAL-FLOW-DEV-R1 — owner delegation

Authority: direct owner instruction in this Codex session, 2026-09-12. This is a new
bounded delegation; A-G is completed and its records/budgets are retained, never added.
Owner authorized exact PR9 head f060662206b350a4b26aa653fdc45b04b828fecb merge after
base/CI/review/manifest reconciliation. Result is recorded in FLOW_DEV_STATUS.json.
Uncommitted final A-G status is preserved and reconciled here without changing that head.

Continue E10-E13 in one dedicated supervised development branch through synthetic
booking input -> recommendation/explicit selection -> whole-group HOLD/quote -> payment
reconciliation -> explicitly simulated development confirmation/QR -> staff reception,
assignment, checkout -> mixed continuous-scan return including another store. Do not
stop for each phase or require a ChatGPT handoff/main merge between phases.

Payment: deterministic isolated test adapter and real local PostgreSQL. Implement
idempotency, verified webhook ingestion, duplicate/out-of-order events, unknown-result
reconciliation and amount/currency/merchant/location/booking matching. No redirect,
paid=true or browser button can supply payment evidence. Normal chargeReady=false remains.
UNKNOWN must not create another charge key; success after lost/expired inventory cannot
oversell. Confirmed commitments outlive the original 600-second lease without extending it.
Square Sandbox setup/credentials, any real Square request and public webhook remain
BLOCKED_EXTERNAL_NOT_AUTHORIZED, not completed by simulated testing.

Private customer preview only, no public URL/tunnel/real notifications. Existing staff
password sessions, store scope and explicit permissions remain. Reservation QR is opaque
and never authorization; authorized operational staff may receive a handoff without
removing owner checks from the existing HOLD/quote/recommendation APIs. Preserve flexible
provisional witnesses and preparation/dispatch/checkout fixed protection.

Return: scan immutable Asset ID, resolve and persist exact loan cycle; one scan of either
label on a ski or boot pair equals one Asset. No left/right sub-assets or mandatory double
scan. Server-persisted candidates, resume, per-line batch results, duplicate/retry/parallel
idempotency, no retargeting stale scans to a new cycle. Poles remain size-based PAIR quantities
with explicit loan attribution. Receipt, inspection and re-rental are separate; no same-day
re-rental or automatic early-return refund. Cross-store physical receipt must remain a fact,
with custody history and future-promise issues recorded. No custom DIN/safety inference.
Camera simulation/viewport tests are distinct from real-phone scanning.

Run01 starts 2026-09-12T13:26:35Z (22:26:35 JST); deadline2026-09-12T21:26:35Z
(2026-09-13 06:26:35 JST). Max8h/run,24h active total,8new Claude starts shared,
reserve >=1 for final integration. Never reset on reread/retry/compaction. Previous A-G
starts3 and historical E09 starts4 are retained separately, unused budgets not added.
Claude: existing Team/extra creditsOFF, direct static route only; no code/file/external
access/MCP/hooks/plugins/past context. Approved payload: relevant source/schema/contracts,
synthetic tests and sanitized evidence only; no real people/credentials/cookies/revenue/other
projects. Stop affected auth/quota/communication problem without changing credentials or
billing; continue safe independent work. Persist progress, next step and remaining budget.

End at Draft PR with tested development loop + independent review, or no safe independent
work/budget exhaustion. E10 real Sandbox and E13 all production-like conditions remain
incomplete when not actually tested. No new-PR merge, E14+, production, real data, real
Square/charges/refunds, new cost/contract/external privileges, PR3/Runner, scheduler,
self-restart, host changes or other projects. Stop only owned DB/Web/browser/Claude.
