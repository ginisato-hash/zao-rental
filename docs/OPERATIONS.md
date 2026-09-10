# OPERATIONS.md — Store Operations v0.4

Status: owner operational decisions recorded; application implementation and production activation pending.
The v0.4 rules supersede the former AM deadline of 13:00 and unqualified same-day availability after inspection.

## Stores and hours
Mountain Base and Onsen Base use the same workflow and hours, Asia/Tokyo.
Open 08:30; close 17:00. No previous-day collection. No separate final checkout cutoff is added, but a new rental must still have a positive valid time interval.

| Product | Start / earliest pickup | Return deadline |
|---|---|---|
| AM half-day | 08:30 | 12:00 |
| PM half-day | 13:00 | 17:00 |
| 1–10 calendar days | 08:30 on first day | 17:00 on final day |

12:00–13:00 is the interval between half-day products, not a newly imposed store closure. Do not represent AM as 08:30–13:00. Half-day prices remain those approved in v0.3; changing a time boundary does not recalculate them.

## Initial no-recirculation policy
Do not rent the same returned equipment to another customer on the same date in V1. In particular, an AM rental consumes its unit's entire date for booking-capacity purposes, so AM and PM requests cannot both consume that unit.
The same restriction follows assets across store boundaries. Returning at the other store does not reset it. A returned pole quantity is blocked for the date within its pool ledger; unused quantities may still be rented.

Physical return, inspection, rental-capacity availability and accounting are distinct. An item may be physically present and inspected yet unavailable for another rental until the next date. Do not fake a MAINTENANCE state solely to enforce this rule. Staff display should distinguish "返却済・本日再貸出不可" from "整備待ち".
Existing holds also consume this daily capacity. A released/expired hold with no actual checkout may release its claim. An exchange within the same customer's continuing rental is not a second-customer rental; the replacement still needs capacity and fit validation. Returned exchanged items remain blocked for the date.
Early return before a multi-day contractual end can release unused future capacity only after physical return, inspection and an explicit allocation update; it does not refund or rewrite the contract. Default earliest reuse is next operating date, and only if no other block applies.

## Future AM-to-PM reuse
The owner reserved a 60-minute scheduled gap (12:00 to 13:00). This is not proof every equipment family can be turned around in 60 minutes.
Retain separate contractual intervals, actual return timestamps, inspection/ready timestamps, policy versions and reservation-capacity claims now. A later scoped policy can enable reuse by store/equipment family/effective date after turnaround settings and staffing are validated.
Enabling is an audited policy change with existing-commitment revalidation, not a client-side switch that resets all holds. Never change an existing customer's deadline without notice/acceptance. In enabled mode, future availability planning must allow the configured buffer; actual checkout additionally requires actual return, receipt and readiness. Late/failed turnaround creates an exception and must not silently double-lend.

## Daily transfers
Owner premise: staff run inter-store movement daily from 17:00; driving between the stores is approximately 10 minutes.
Treat 17:00 as the scheduled start of the closing transfer operation, not proof all pickups/loading/transport/receipt have finished at 17:10. Both directions and loading time must be represented; no assumption of two simultaneous vehicles. Record actual departures and arrivals.
Use a daily TransferBatch plus lines for individual assets and pooled pole quantities. Prepare the next operating day's requirements and a dispatch list. Staff confirm picking, departure, arrival and inspection with identifiers/counts. Protect the source store's existing commitments.

## Transfer-based online promises
Current shelf stock and feasible future arrival stock are different. Other-store stock can support a future booking only with a committed, non-duplicated transfer allocation that can be ready at the pickup store in time. A suggestion/request alone is not capacity.
No automatic emergency trip during opening hours is promised. A customer needing stock today cannot book it at the other store on the assumption that "the drive only takes 10 minutes".
After today's 17:00 batch is sealed/departed, stock left at the other store cannot be promised for tomorrow morning using that missed batch. Show a feasible pickup store/date instead. Stock already physically received at the pickup store is a different case and may support tomorrow's reservations.
Returned goods due at 17:00 join the day's movement only if physically received, inspected and included before their relevant departure; late or unready goods are not presumed on the vehicle. Inbound uncertainty that jeopardizes a confirmed future allocation must raise an exception for reassignment/operations review.
The receiving app must allow authorized after-hours transfer receipt even though customer pickup closes at 17:00.

## Cross-store return
Allowed in both directions. Record the actual receiving location, including an unexpected receiving store. Revalidate subsequent rental/transfer commitments if the actual return store differs from the plan. Receipt does not bypass inspection or the same-date block.

## Workflow
CHECK-IN -> BOOTS -> SKI/BOARD -> BINDING / FINAL FIT -> CHECKOUT.
Track each renter/item separately from the group header. Early-return inventory actions and exception refund actions are separate; see REFUND_POLICY.md.
