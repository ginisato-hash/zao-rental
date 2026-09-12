# E08 supervised private pricing and quotes

Authority: current owner request, after separately authorized exact E07 merge. Repository
`ginisato-hash/zao-rental`, branch `codex/pricing-quote-e08`, base
`0743950977bb074cdc6833e17c0980239150829e`. PR3 and Runner remain held without adoption.
Canonical commercial sources: PRICING.md, PRICING_ACCEPTANCE.md and config/pricing/. ADR 0015
records implementation decisions without changing the canonical explicit table. E03 is only the
necessary time/quote contract; no all-E03 completion claim.

TASKS E08 mapping:
- Server-side product/age/class/half-day–10-day lookup, one version per quote, totals/adjustments,
  frozen amount and input fingerprints: implemented.
- Explicit draft vs private availability, effective time, immutable history, optimistic edit and
  concurrent activation/create: services and real DB tests; full price-editor UI is later.
- Early 5% conditions: private estimate and pure verified-completion boundary, no Square/payment.
- Coupons: explicit dates/product/store/minimum/basis/cap/stacking, no consumption on lookup;
  atomic active-capacity reservation tests. Real redemption/lifetime limits are NOT complete.
- Quote/HOLD consistency: owner/stores/conditions/expiry/payment/transfer attention; no HOLD extension.
- Staff-only read/create/setup UI and protected API, actual DB persistence and reload: implemented;
  exact execution results live in PR evidence, not assumed from this document.
- Confirmed booking/AmendmentQuote/payment linkage, real coupon redemption, commercial override UI,
  customer publication, operational staff/phone acceptance and production migration: unimplemented.

API (same-origin POST, no-store, fresh password session/permissions/store scope):
`GET /api/quotes`, `GET /api/quotes/{id}` (own quotes), `/catalog`, `/options`;
`POST /api/quotes` accepts exactly requestKey + input {conditions,holdId,couponCode,wantAdvance}.
No client amounts, actor, role or verified-payment field. `/private-initialize` additionally requires
PRICE_EDIT + ADMIN + ALL and accepts only an explicit date scope/request key. No public quote, coupon
redemption, general price mutation or payment endpoint exists. The development-only runtime is still
loopback-only with separate app roles, not an ambient DATABASE_URL or production connection.

Unresolved gates: tax-inclusive/exclusive classification, actual season/sales dates, production quote
TTL, real coupon terms including lifetime limits/stacking/minimum basis, publication authorization,
zero-price confirmation and amendment/payment reconciliation. Existing HALF_UP and proposal ordering
are explicitly labelled calculation conventions, not newly approved commercial rules. No paid services.

Evidence rules: real PostgreSQL tests vs pure unit tests vs browser width simulation remain distinct.
No mock UI data; response-loss tests discard only delivery after a real commit. No real accounts,
customer data, cookies, password hashes or browser traces are included in Claude payloads. Existing
static review route only: initial + at most two rereviews, own manifest/head/hash; no Runner adapter.
E07 used its final permitted review; its budget is not replenished by E08.

Stop at E08 Draft PR with exact-head CI/review, or record INCOMPLETE on quota/auth/timeout. No merge,
E09+, Square, production price publication, real data, new host services or authority enlargement.
