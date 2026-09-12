# E09 scope and acceptance mapping

Base 7caf8cea4af29bb0d07ed3a55838257d8a9ffe5c; branch codex/recommendation-e09. TASKS E09 is a preserved proposal, not a live Runner
queue. This direct owner instruction permits the shared contract/DB/API/UI changes needed to connect
recommendation with E06/E07/E08; it does not loosen protected Runner paths or complete unrelated E03.
Read ADR0016 and canonical RECOMMENDATION_ENGINE.md rather than duplicating business rules.

Implemented for synthetic supervised development:
- strict competition-specific profiles and one versioned size rule;
- actual complete-set variants + existing period/location/transfer feasibility;
- anchored recommended/shorter/longer cards, explicit choice/model policy acceptance;
- saved input/offers/choice, group all-or-nothing HOLD, optimistic amendment, failure retention;
- durable same-key recovery across HOLD and quote commits, old-response/old-quote rejection;
- normal email/password staff page /staff/recommendations and /api/recommendations APIs;
- existing role permissions, scoped owner checks, additive migration and least-privilege app role.

POST /api/recommendations: exact requestKey/input/replaceHoldId, saves an advisory preview only.
GET /api/recommendations, /options, /UUID: owner-scoped readback/options.
POST /UUID/select: requestKey + explicit directions/wantAdvance/couponCode/acceptedModelPolicy.
POST /UUID/resume: empty object; reconciles the saved selection using its original domain keys.
No browser-supplied amounts, variants, actor, role, reservation completion, transfer, charge or coupon
consumption are accepted by these new endpoints. Existing domain APIs remain separately protected.

Evidence targets: source price unchanged; independent sizing values; real DB migration from populated
E08; mixed-sport UI -> ordinary session/API -> real PostgreSQL; duplicate/competing group selection,
failed/concurrent amendments, domain-response loss, expiry, and forbidden requests; late UI response
and amount invalidation; 300 combined synthetic equipment units with stated HTTP concurrency/p50/p95.
Exact pass counts, commands, screenshot/benchmark and CI/reviewer hashes belong to per-head evidence.
No future feature is skipped and counted as complete.

Unresolved commercial decisions: public model guarantee/equivalent-product policy, pole automatic
sizing, boot neighboring-size fallback, fitting approval/BSL/DIN, and E08 tax/production dates/TTL/
real coupon terms. Unimplemented features: customer public booking, real coupon redemption/lifetime
use limit, commercial price editor/publication approval, booking/payment confirmation, Square,
checkout/QR/return, real-user and physical-phone validation. Pending operational body-data retention
and production deployment controls must be approved before real data use. These are not E09 PASS gates.

Review: existing Claude Team, creditsOFF, static supplied documents only, initial1 + max2 rereviews.
No execution/tools/MCP/hooks/plugins/automatic history or Runner. Manifest, exact SHA, sanitized logs.
The owner explicitly approved public repository visibility for supervisor audit; only this project's
sanitized code/specification/synthetic evidence may be published. No credentials, actual body/customer/
staff information, sales PDFs or other projects. Stop at new Draft PR, never merge or start E10.
Finite deadline 2026-09-12T06:04:53Z; only owned DB/Web/browser cleanup.

Current E09 audit-followup authority supersedes only the earlier expired time window:
started 2026-09-12T07:02:10.709598Z / 16:02:10.709598 JST; deadline
2026-09-12T11:02:10.709598Z / 20:02:10.709598 JST. Never extend on reread/retry.
Read [E09_AUDIT_FOLLOWUP.md](E09_AUDIT_FOLLOWUP.md). Implement only same-day intake/quote consistency and explicit cm
spelling consistency; other A-G audit findings are investigation/tracking only. PR9 remains Draft;
no merge/E10/stabilization implementation. Existing review calls initial1+rereview1 consumed;
only final rereview1 remains, after both fixes, verification and exact-head CI. Include unresolved
audit findings, never reuse an old PASS or claim the whole system has zero findings. Existing Team,
extra creditsOFF, direct static route with no execution/external tools. No new connections/billing.

Latest owner authority: E09-02 limited continuation-contract correction only, from head
1f336f6aac4df092b36c1c35e9cc1987e2fa53fd. Read E09_CONTINUATION.md, which supersedes
the prior blanket after-close denial. New finite start 2026-09-12T09:12:44.905388+00:00, deadline
2026-09-12T13:12:44.905388+00:00 (2026-09-12T22:12:44.905388+09:00 JST). Never extend on reread/retry.
Prior3 Claude launches retained; at most2 additional static launches (cumulative5),
second only for necessary corrections from the first. No merge; A-G product repairs
remain outside scope. Existing Team/creditsOFF/tool-free direct route, PR3 Draft,
Runner UNATTENDED_HOLD and all previous production/host/service prohibitions remain.
