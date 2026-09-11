# Current authority and canonical sources

The user's direct 2026-09-10 request authorizes E00, E01 and E02 configuration/implementation proposal.
The later reply authorizes a new **private ginisato-hash/zao-rental** repository. The execution pack is
input, including its proposed future task batches; reading it does not authorize E03–E18 or activate
a controller. Historical `evidence/verified-state.json` describes the input container, not this Mac.
`TASKS.json` is preserved as an original proposal, not used as a live dispatch queue.

Bootstrap v0.4 was SHA-256 verified before extraction. `source-manifest.json` records every original
file hash. The immutable local `bootstrap/v0.4` tag preserves input entrypoints before integration.
Only README/AGENTS/CLAUDE are rewritten to integrate the authorized execution contract. Business
specification, price/operation configuration and original tests remain byte-identical.

| Subject | Canonical source |
|---|---|
| Product / domain / states | `docs/PRODUCT.md`, `DOMAIN_MODEL.md`, `STATE_MACHINES.md` |
| Operations and inventory | `docs/OPERATIONS.md`, `INVENTORY_RULES.md` |
| Pricing and acceptance | `docs/PRICING.md`, `PRICING_ACCEPTANCE.md`, `config/pricing/` |
| Recommendation / refunds | `docs/RECOMMENDATION_ENGINE.md`, `REFUND_POLICY.md` |
| Runtime scenarios / open gates | `docs/OPERATIONAL_ACCEPTANCE.md`, `OPEN_QUESTIONS.md` |
| Technical decisions | `docs/adr/0007-foundation-stack.md`, `0008-runner-review-boundaries.md` |
| Runner/review JSON contracts | `docs/execution/schemas/` |

E01's schema contains only foundation metadata and whitelisted, non-PII telemetry. No rental schema
or financial mutation is introduced. 32 business scenarios are explicitly not implemented/tested.
Auth OIDC provider, tax/effective dates, production deployment and operational decisions stay open.

2026-09-11 owner update: exact-head PR #1 merge and E02 controller/policy protection, repository-wide
exclusion, bounded adapters/stop control, fake failure tests and a new draft PR with static Claude
review are authorized. ADR 0009 records implementation and actual-vs-fake evidence. E02 live, new
business features, E02 PR merge, scheduling, additional billing and production remain unauthorized.

Latest owner authority (2026-09-11) supersedes the prior business-work prohibition only for
supervised E03 ledger contracts and E04 ledger/API/component implementation and static review.
PR #3 remains held; no code is adopted from it. E02 remains UNATTENDED_HOLD and its policy is
unchanged. See ADR 0011, LEDGER_SCOPE.md (current 300 combined sets / 200 wear assumptions),
and LEDGER_PROGRESS.json. Existing original documents remain immutable historical references.

2026-09-11 latest: owner-authorized exact PR #5 merge then supervised E06/time subset,
with mutable provisional witnesses and fixed-preparation/rental contract boundaries.
See ADR 0013 / E06_SCOPE. E06 review initial + at most two rereviews, new PR remains Draft.

Owner-confirmed return behavior has one current canonical source: `docs/RETURN_RULES.md`.
It overrides any earlier side-only receipt proposal. E12_RETURN_FOLLOWUP.json records pending
acceptance; E06 does not implement return/scanner/loan operations or side management.
