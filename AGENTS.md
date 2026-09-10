# AGENTS.md — Codex Operating Contract

## Role
You are the primary implementation agent for the ZAO Rental System. Implement approved GitHub issues only. Architecture and domain rules are authoritative in `/docs`.

## Before changing code
Read, in order:
1. `docs/PRODUCT.md`
2. `docs/DOMAIN_MODEL.md`
3. `docs/STATE_MACHINES.md`
4. `docs/ARCHITECTURE.md`
5. Relevant ADRs in `docs/adr/`
6. The assigned issue and acceptance criteria

## Hard rules
- Never push directly to `main`.
- Never weaken tests to make CI pass.
- Never bypass type errors with broad `any` unless explicitly approved.
- Never disable webhook signature verification in production code.
- Never make destructive database migrations without explicit approval.
- All schema changes require migrations.
- Payment and inventory mutations must be idempotent.
- Do not assign the same physical asset to overlapping active rentals.
- Do not invent binding safety formulas.
- One PR should have one coherent responsibility.
- Do not alter another agent's branch/worktree.

## Definition of Done
A task is not done until all applicable items pass:
- lint
- typecheck
- unit tests
- integration tests
- migration validation
- end-to-end tests
- build
- security-sensitive checks
- concise PR summary with failure modes tested

## PR report format
Include:
- What changed
- Why
- Files/modules touched
- Database changes
- State transitions affected
- Concurrency/idempotency considerations
- Tests added/run
- Known limitations
- Rollback notes

## Pricing review requirements
For price-related work read docs/PRICING.md and docs/PRICING_ACCEPTANCE.md. Do not treat the v0.3 seed test as evidence that an admin UI, payment integration or transactional booking engine is implemented. Never reprice historical bookings from a mutable current-price table.

## Operational revision v0.4
Read docs/OPERATIONS.md, docs/INVENTORY_RULES.md, docs/RECOMMENDATION_ENGINE.md, docs/REFUND_POLICY.md and docs/OPERATIONAL_ACCEPTANCE.md. AM ends12:00. Initial same-date reuse is disabled. Capacity is not the lifecycle AVAILABLE flag. Treat transfer commitment versus physical receipt separately; do not auto-receive at17:10. Never cross adult/kids or silently change selected length/tier. Early returns do not automatically refund. Selected staff may receive explicit REFUND_OVERRIDE, never an authorization bypass. Seed tests are not runtime booking/DB/payment/UX tests.
