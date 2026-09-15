# Post-R15 Avatar A2/A3 checkpoint

A2/A3 **SELF_VERIFIED PASS**; independent review **NOT_RUN** (maximum1, used0).
Feature OFF, customer-visible=false. No renderer, booking insertion, toggle, dressing UI,
visual editor, image upload or Production deployment. Next exact gate after this milestone:
**AVATAR PHASE 4 — CUSTOMER VISUAL RENDERER**; no automatic continuation.

- Starting R15: `efb73933a6d3816958882205cfa3623447194625` (terminal PASS).
- Historical Avatar design: `9783373612440acef4c077b0ae23925aa467743d`.
- Branch: `codex/post-r15-avatar-a2-a3`; both historical branches frozen.
- Main remains `3061dbbbe00294e5baebba2405028c907d6e6e85`; no new PR/main merge.
- Source authority: POST_R15_AVATAR_A2_A3_AUTHORITY.md. Supplied PDF is a reference,
  not authority for its later renderer/admin/Issue/deployment instructions.

## A2

Additive `0031_avatar_visuals.sql`; previous30 migration bytes/hashes unchanged.
One metadata table, nullable ledger references, exact SKI promise constraints, stable UUID,
normalized anchor/position, active/disabled state, stable order and active-default uniqueness.
Existing immutable media/revision/release records are reused. An explicit Avatar purpose
grant in the immutable content revision is mandatory; generic model photo rights are not enough.
No image bytes/URL/credentials in the new table; no new media/rights/product master.

## A3

Optional `MemberRecommendation.visualization` v1; read-only repository performs one SELECT
for three candidate directions and optional layers. Current release, immutable revision,
use/digest binding, rights/expiry/internal-only/processed state gate every exact and fallback.
Pure mapper copies original candidate lengths and positive finite ratios only. REGULAR never
promises a model; PREMIUM exact metadata must match the full existing promise. WEAR has no
ski ratio; SNOWBOARD has no ski visualization. Missing/unavailable visuals preserve the
original business result. Auth/business loader errors reject outside the visual error boundary.
No route auto-exposes the feature or reruns RecommendationService.preview/select/HOLD/quote.

## Evidence and limits

-197 unit tests PASS (28 Avatar,169 related existing recommendation/staff/HOLD/payment).
-39 real local PostgreSQL checks PASS: Avatar15 (fresh + upgrade), recommendation/staff17,
 guest7. No skips. Normal booking/HOLD/quote/auth flows also succeed with zero visual rows.
-Lint, typecheck, local Next build, secret scan and diff check PASS; see validation.json/logs.
-Visual path business mutations0; provider operations Square/hosted Neon/Vercel/R2/external
 browser/Production0. GitHub source synchronization and the authorized static Claude review
 are reported separately from provider operations. No R15 live replay.
-Only synthetic metadata/private local fixture bytes were used. Production artwork, authoring
 of usage grants, and media delivery remain unimplemented. Any future byte-serving path must
 reauthorize current rights/release; a metadata reference is not a permanent delivery grant.
-R15 historical hosted runner intentionally refuses migration plans beyond its frozen30;
 the added Number() changes TypeScript checking only. Old R15 branch/code remains untouched.
-This milestone selects relevant regressions; it does not claim every historical test suite,
 remote CI, visual UI/mobile Safari acceptance or any hosted integration has run.

The next source/evidence commit will bind the one independent static review. Review receipts
will be documentation/evidence descendants, distinguished from the reviewed code HEAD.
