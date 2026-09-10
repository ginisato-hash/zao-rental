# ARCHITECTURE.md — Architecture v0.4

## Architecture style
Start as a modular monolith with explicit domain boundaries. Do not introduce microservices unless measured operational need appears.

## Proposed stack direction
- TypeScript end to end where practical
- Next.js / React for customer, staff, and admin experiences
- PostgreSQL as source-of-truth transactional database
- Square APIs for payment
- staff interface as installable PWA/mobile web experience using device camera for QR scanning
- GitHub Actions for CI
- containerized/reproducible development environment

Exact framework versions, ORM, auth provider, hosting, and observability vendor should be decided in ADRs after implementation environment review.

## Logical modules
- identity/auth
- customer
- catalog
- recommendation
- availability
- booking
- inventory-hold
- payment-square
- asset
- rental-operations
- maintenance
- analytics
- audit

## Customer application
Responsibilities:
- product/rental selection
- dates/group composition
- renter profiles
- recommendation presentation
- availability feedback
- checkout initiation
- reservation confirmation and QR

Must not directly decide final payment success or mutate asset assignment.

## Staff application
Optimized for mobile camera workflow.
Core routes/actions:
- scan reservation QR
- reservation/group detail
- scan asset QR
- assign/exchange
- checkout
- return/inspection
- asset quick lookup

## Admin application
- catalog/inventory setup
- asset onboarding/import
- label/identifier administration
- pricing/policy
- maintenance queue
- utilization/reporting
- user/staff access
- audit inspection

## Transaction boundaries
Inventory hold creation and capacity decrement/check must occur atomically.
Physical asset assignment must reject interval overlap at database/domain level, not UI level only.
Webhook event deduplication must be persisted.

## QR model
Customer QR:
- opaque reservation access token / short identifier
- no personal profile in QR payload

Asset QR:
- opaque asset identifier or short URL
- same identifier can be printed on both skis in one pair
- human-readable fallback ID printed next to code

## Caching
Do not optimize prematurely. Inventory count alone is modest, but continuous allocation, transfer planning, contention and network latency still require measured load tests.
Staff experience may cache safe read-only/day-of-operation data later, but server remains authoritative for conflicting mutations.

## Offline position for V1
PWA assets and safe read data may be cached. Full offline lending is NOT V1 because two staff devices can create conflicting physical assignments while disconnected. If later implemented, it needs an explicit conflict-resolution protocol.

## Security boundaries
- least-privilege staff roles
- no customer PII embedded in physical QR labels
- payment card data remains with Square
- verify webhook signatures
- secrets only in environment/secret manager
- auditable admin overrides
- rate limiting/abuse controls on public booking endpoints

## Observability
At minimum, structured logs and metrics for:
- hold creation/release/expiry
- availability conflicts
- payment webhook processing
- reservation/payment divergence
- scan failures
- assignment conflicts
- checkout/return latency

## Deployment environments
- local/agent
- staging using Square sandbox
- production using Square production credentials

Production data and credentials must not be accessible to autonomous agents by default.

## Operational architecture v0.4
Read OPERATIONS.md, INVENTORY_RULES.md, RECOMMENDATION_ENGINE.md and REFUND_POLICY.md before inventory/payment changes. Keep contractual time, capacity claims, actual physical state, transfer plan and refund ledger independent. Initial no-recirculation blocks are date-based; future reuse is a versioned policy, not a schema replacement.
Recommendation candidates are advisory projections; confirmed selected requirements require atomic continuous allocation. A 17:00 batch may support future destination capacity only with a protected feasible transfer. No clock-triggered fictitious receipt.
Return and refund commands are separate transactions. Staff exception refunds use server-side capability checks and pending-balance reservation, with provider reconciliation. No UI bypass or production secrets in browser state.
