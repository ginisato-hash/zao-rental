# R13 local result

Started: 2026-09-15T01:15:54Z / 2026-09-15 10:15:54 JST.
Completed local validation: 2026-09-15T01:50:19.528717+00:00.

| Item | Evidence |
|---|---|
| Starting local/remote | `49f0a50e79b7b53d9a13fd66c334bc168b5beea7` |
| Authority commit | `dcc4b3440c2fb5cba49dc7e7eb3507d7e3b97508` |
| Implementation / validated source | `f4d43bf8ae0934a6b0072355839fcf6b0840177e` |
| Source tree | `5479e94a01b3a1f104432a9aa1614c9d72b74b48` |
| Final local evidence commit | The git commit containing this result; follows validated source with docs/log/status only |
| Migration | 0027_payment_projection.sql; **not applied** |
| Tests | 491 passed, 109 new R13, 0 failed, 0 skipped; fixture/static/scripted SQL |
| Secret scan / lint / typecheck / build | exit 0 each; [commands and logs](validation.json) |
| Live apply / independent model review / CI | NOT_ACTIVATED / NOT_RUN / NOT_TRIGGERED |
| GitHub | **PUSH_PENDING_APPROVAL — AUTO_REVIEW_DENIED**, not auth failure; remote unchanged |

The new decision/transaction boundary validates persisted R12 evidence, full identity/price/HOLD/claims/transfer conditions, and applies existing states only. The existing 71820600 advisory lock precedes booking/attempt/HOLD/head and stream/job locks. Projection events and job receipts are atomic with business updates and historical audit effects. Unique observation identity and revision CAS protect against duplicate/concurrent application. Stored receipt replay is historical, never new authorization.

COMPLETED with expired HOLD, missing gear/wear or transfer trouble is retained as provider truth and blocked for operator reconciliation; it does not revive inventory or refund. Failed/canceled keep existing PAYMENT_REVIEW/HOLD FAILURE semantics without deleting/releasing. Same-timestamp content conflict blocks the new projection path. Legacy BookingService remains unchanged.

Covered: valid/pending/failed/canceled, mismatch fields, exact due/expiry, fixed/invalid HOLD, snapshot/coupon/advance bounds, gear/wear/Premium claims, stale/duplicate/conflict, two projectors, legacy startPayment/reconcile, lease recovery, new R12 generation, pre/mid-transaction crashes, head CAS, final expiry fence, COMMIT response loss, exactly-once modeled history/journal. R12 lease→truth→projection composition is fixture-only; RECONCILED alone is not booking confirmation.

Not run: actual migration/DB roles/locks/constraints/triggers, real sessions/browser/UI, provider, external webhook, Vercel, full verify, independent review or CI. No performance benchmark for 500 sets. No actual data, credentials, notifications, refund/charge, Runner, new PR or main merge.

[Source file manifest](source-manifest.json) · [Preservation](preservation.json) · [Owned resource closure](owned-resource-closure.json) · [Remote observation](remote-observation.json).

All prohibited external calls are 0. No DB/Web/browser/Claude/Spark resource was started; finite tests/build have exited. R10 remains LAST_OBSERVED_PENDING / S3_NONTERMINAL_DO_NOT_RETRY.

Next: approve only the concrete GitHub save blocked by automatic review if desired; see [push record](../R13_PUSH_PENDING.md). Separately, [live webhook + reconciliation + business projection activation](../../PRODUCTION_P6_BUSINESS_PROJECTION_ACTIVATION_GATE.md) requires Owner authority and real development-DB evidence. R13 itself grants no activation.
