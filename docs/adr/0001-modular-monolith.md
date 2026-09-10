# ADR-0001 — Start as a Modular Monolith

Status: PROPOSED

## Decision
Implement V1 as a modular monolith with one transactional PostgreSQL database and explicit domain modules.

## Why
The planned 500-set inventory and expected transaction rate do not justify distributed-system complexity. Strong transaction guarantees are particularly valuable for inventory and payment consistency.

## Consequences
Positive:
- simpler atomic transactions
- simpler deployment and debugging
- faster implementation
- lower operational cost

Guardrail:
Module boundaries must be maintained so future extraction is possible if actual scale or organizational needs justify it.
