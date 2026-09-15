# Avatar Phase4 implementation checkpoint

Codex self-validation **PASS**. Independent review **NOT_RUN**; initial0/1,
conditional correction0/1 (only after a corrected BLOCKER/HIGH/MEDIUM). No intermediate
review was run. Current code/evidence will be committed, pushed and read back before review.

Starting remote HEAD: `96a34aee8dccb66dca11199af29c33aaf1127546`.
New branch: `codex/avatar-phase4-customer-renderer`. A2/A3, R15, historical Avatar and main
remain frozen. No force push/new PR/main merge. Customer-visible **false**.

## Implementation

- AvatarFitPreview renders body/pants/jacket/boots with ski beside the body. It accepts
  visualization v1, active Direction and locale; no DB/API fetch or business callback.
- Common-floor physical lengths use the A3 ratio exactly. Canonical artboard and stage
  union scale uniformly; longer-than-body skis are included without cropping/shortening.
- ja/en text measurements and full disclaimer remain accessible; image layers are decorative.
  Missing body/ski/layer is omitted, never replaced with fake artwork; zero art means no renderer.
- `/preview/avatar?preview=<owned-saved-id>&member=<key>&locale=ja|en` uses the same customer
  component behind existing staff session, BOOKING_VIEW and existing recommendation
  HOLD_VIEW/QUOTE_VIEW/store/owner checks. Both appearances are resolved once. Controls
  only switch preloaded payloads; no preview/select/resume/HOLD/quote invocation.
- Dedicated GET `/avatar-media/<visualUuid>/<digest>` requires staff BOOKING_VIEW and current
  DB row/digest/release/immutable revision/purpose/media/rights eligibility. It rechecks
  rights after byte read/decode and staff session before response. Denials are404, no private
  bytes/workspace/URLs/keys are exposed. WebP alpha is decoded/validated with existing Sharp;
  SVG/animation/metadata/trailing chunks/wrong artboard/physical padding are refused.
- Images use private,no-store and unoptimized direct same-origin Next Image requests.
  Existing `/media`, GuestBooking, payment/HOLD/quote/recommendation code are unchanged.
- All0001–0031 migration bytes unchanged; migration/schema/writer/editor API additions0.
  No runtime role/provisioner added. Existing local synthetic content_read test role receives
  needed SELECT/EXECUTE grants inside the fixture only; do not promote this broad role.
- Real artwork, uploads, customer grants/activation, appearance persistence, public links,
  GuestBooking insertion, provider integration and deployments remain out of scope.

## Validation evidence

Node24.15.0/npm11.12.1; existing dependencies and cached Chromium1243 reused, downloads0.
235 unit/related regression tests PASS (23 renderer,212 A2/A3 and related existing tests).
71 real local PostgreSQL checks PASS (Phase4 media/security27, A2/A3 15, recommendation/staff17,
guest7, content rights/release5). 27 browser checks PASS (Phase4 22, existing GuestBooking5).
No failed/skipped checks in final runs. This is not a claim that all historical suites ran.

Twelve physical measurements span320/390/768/1440px and150/153/187cm skis at170cm body.
Maximum ski-height error0.0125px; maximum baseline difference0.015625px. Overflow0,
fatal console0, hydration errors0, Phase4 business POST0/external requests0. Browser is
Chromium153, including iPhone-sized viewport, not actual Safari/device acceptance.
Eight synthetic-only screenshots are hashed and recorded; parent visually inspected mobile
recommended and desktop longer examples. They are test artwork, not completed product assets.

Lint/typecheck/local Next build/secret scan/git diff check PASS. All owned browser/Next/PG
processes and pools closed. Pattern secret scan has finite coverage. Source/evidence integrity,
logs, preparation corrections, numeric measurements and screenshots are saved here.

Renderer/media business writes0; normal synthetic business regression fixtures exercise
their existing local writes separately. Square/hosted Neon/Vercel/R2/external media/browser/
Production/real payment/real customer/email/SMS/new service0. GitHub branch synchronization
and authorized static Claude review are separate control-plane actions. R15 live replay0.

## Prior LOWs and boundary

AV-1 LOW remains OPEN: no writer/editor introduced; read-time purpose binding fails closed.
AV-2 LOW remains recorded: Owner now explicitly selects zero-art/no-renderer/no-fake behavior.
This product decision is not an independent closure claim. AV-3 LOW remains OPEN: no new
hosted/runtime role, no workspace JSON response; production privilege minimization is pending.

Next exact gate after Phase4 PASS: **AVATAR PHASE 5 — GUEST BOOKING INTEGRATION + REAL ARTWORK
ACTIVATION**. No automatic continuation, real artwork, public activation or deployment.
