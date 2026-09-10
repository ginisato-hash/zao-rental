# ADR-0004 — Square Server/Webhook State Is Payment Authority

Status: PROPOSED

## Decision
The customer browser is never authoritative for payment completion. Local payment state is reconciled from server-side Square API/webhook evidence, with persisted event deduplication.

## Requirements
- webhook signature verification
- event ID deduplication
- idempotent transition handlers
- recovery/reconciliation path if the webhook is delayed or uncertain
- no duplicate inventory confirmation on retry/replay
