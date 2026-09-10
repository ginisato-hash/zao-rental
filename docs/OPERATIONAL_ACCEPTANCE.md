# OPERATIONAL_ACCEPTANCE.md — Required Runtime Evidence v0.4

This is an acceptance checklist for later implementation. These scenarios have NOT been executed against a rental application by the bootstrap build. The included Python tests validate seed values/document consistency only.

## Hours and same-day stock
O01. AM confirmation/email/staff screen show due 12:00; PM shows 13:00–17:00. Existing monetary prices are unchanged.
O02. One eligible pair, concurrent AM and PM requests same date: at most one protected hold/confirmation while reuse is disabled. If the first unconsumed hold expires, the other can retry; no oversell.
O03. Actual AM return 11:00 + inspection 11:10 still cannot fulfill PM today, at either store.
O04. A pole pool of 2 pairs with 1 AM-used quantity has only 1 unused pair available for a second rental that day after return; no return-based inflation.
O05. Tomorrow's availability may include an inspected returned item only after location/commitment checks. A failed inspection blocks it.
O06. Fully early-returned multi-day rental releases verified unused future allocation only through explicit allocation update; no automatic refund, original price snapshot unchanged.
O07. Same-customer equipment exchange remains possible with valid replacement capacity and final-fit check; exchanged-back item is not available to a new customer today.
O08. Future reuse policy requires a configured buffer, audit, effective scope and revalidation. Late AM return/unfinished inspection cannot silently fulfill a 13:00 PM handoff. Turning reuse off detects already-sold overlaps.

## Recommendation choice
O09. Height 170, eligible lengths 145/150/155: recommended 150, shorter145, longer155.
O10. Repeated button clicks never drift beyond original height-20 +/-15; option directions remain anchored to initial recommended length.
O11. Ineligible age category or tier is never offered, including when all eligible stock is depleted. Sold-out direction is disabled, not fabricated.
O12. Multi-day candidate tests fail when daily capacity exists but no continuous feasible asset assignment does.
O13. Two customers race for one candidate: one succeeds; rejected swap retains the previous valid hold rather than losing both choices. Use a real database concurrency test.
O14. Browsing three choices does not create three holds. A group/bundle hold includes all required boots and poles atomically.
O15. Paid customer's selected length cannot silently change. Exact-model promise versus disclosed equivalent-model rule is honored.
O16. Selection change during payment UNKNOWN does not initiate an unrelated second charge. Expired holds do not revive by UI toggling.

## Two-store transfers
O17. Tomorrow morning booking needing another-store stock before today's batch: reserve a feasible committed transfer, protect source demand, and show it on dispatch list.
O18. Same-day booking cannot rely on the 17:00 trip for a pickup earlier that day.
O19. After today's trip departed, stock left behind cannot support tomorrow morning via a retroactive transfer. Stock already received locally is handled separately.
O20. Exactly 17:10 time passage never auto-receives cargo. After-hours staff receipt records identifiers/counts and inspection.
O21. Return due17:00 but late/unready at dispatch is not presumed shipped. Protect/alert any affected next-day promise.
O22. Unexpected cross-store return triggers downstream allocation checks; its date-block persists across stores.
O23. Both directions, partial arrival, pole quantities, missing item and insufficient vehicle/staff-ready time are represented without double counting.

## Early return and refunds
O24. Early-return scan does not reprice/refund even for unused days and even when inventory is released for tomorrow.
O25. Selected staff with REFUND_OVERRIDE may submit an exception; ordinary staff/anonymous/cross-scope requests fail server-side.
O26. Reason and explicit amount required. Do not require injury diagnoses; no hidden bypass URL.
O27. Two simultaneous partial refunds against the remaining collected amount cannot over-reserve or over-refund it.
O28. Duplicate submit, network timeout, webhook retry/out-of-order delivery preserve one logical refund. UNKNOWN does not become FAILED or spawn a fresh key.
O29. UI differentiates request pending/completed/rejected; provider payment can remain COMPLETED while the local refund balance changes.
O30. Inventory return succeeds independently of refund failure. Refunding an unreturned item does not make it available.
O31. Refund at the return store can link the original other-store payment with authorized scope; externally made Square refunds reconcile before further refund.
O32. Permission revocation and changed policy do not leave an old browser session authorized; submission checks server-side current permission and audited request.
