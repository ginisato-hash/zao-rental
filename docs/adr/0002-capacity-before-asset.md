# ADR-0002 — Reserve Feasible Requirements Before Physical Handoff
Status: Revised proposed architecture, v0.4. Owner workflow confirmed; runtime validation pending.

## Decision
Customers reserve the chosen requirement (sport/category/tier/length and any promised model) rather than a specific physical asset ID. Final asset scan/assignment occurs at pickup.
This does NOT mean independent aggregate daily counts are sufficient. Maintain a protected internal feasible allocation across the entire requested interval, with distinct store location and committed transfer edges. Replans must preserve every active claim.
V1 half-day requirements consume the whole rental date per unit, and that block follows cross-store returns. Time-based reuse is a later explicitly activated operational policy.

## Consequences
Retains physical handoff flexibility without phantom multi-day availability or cross-store double counting. Recommendation buttons cannot promise different lengths from the held requirement. Exact-model guarantees need explicit constraints, not merely a product image.
Database/solver choice, contention strategy and performance must be demonstrated by implementation tests before freeze/production claims.
