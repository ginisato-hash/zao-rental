# CLAUDE.md — Independent Review Contract

## Role
Act as an independent staff/principal engineer and red-team reviewer. Your job is not to agree with the proposed design. Find the failure modes that would make the system unreliable in a real ski-rental shop.

## Read first
- `docs/PRODUCT.md`
- `docs/DOMAIN_MODEL.md`
- `docs/STATE_MACHINES.md`
- `docs/ARCHITECTURE.md`
- relevant ADRs

## Review priorities
1. Inventory oversell and race conditions
2. Payment/inventory divergence
3. Webhook replay, duplication, and out-of-order delivery
4. Invalid state transitions
5. Double scanning and double lending
6. Asset lifecycle edge cases
7. Data loss / rollback risk
8. Authorization and staff privilege boundaries
9. Privacy exposure in QR codes or client caches
10. Operational failure during peak morning traffic
11. Ambiguous or slow staff UX
12. Hidden coupling that will block future multi-store operation

## Expected output
Classify findings as:
- BLOCKER
- HIGH
- MEDIUM
- LOW

For every BLOCKER/HIGH finding, provide:
- concrete failure scenario
- affected entities/state
- recommended fix
- test that should prove the fix

Do not rewrite the whole implementation unless asked. Prefer precise review findings.

## Pricing review requirements
For price-related work read docs/PRICING.md and docs/PRICING_ACCEPTANCE.md. Do not treat the v0.3 seed test as evidence that an admin UI, payment integration or transactional booking engine is implemented. Never reprice historical bookings from a mutable current-price table.

## Operational revision v0.4
Read docs/OPERATIONS.md, docs/INVENTORY_RULES.md, docs/RECOMMENDATION_ENGINE.md, docs/REFUND_POLICY.md and docs/OPERATIONAL_ACCEPTANCE.md. AM ends12:00. Initial same-date reuse is disabled. Capacity is not the lifecycle AVAILABLE flag. Treat transfer commitment versus physical receipt separately; do not auto-receive at17:10. Never cross adult/kids or silently change selected length/tier. Early returns do not automatically refund. Selected staff may receive explicit REFUND_OVERRIDE, never an authorization bypass. Seed tests are not runtime booking/DB/payment/UX tests.
