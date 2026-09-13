# ADR0020: quantity wear, edition promises and development pricing

Status: implemented subset awaiting independent review. Owner quantity override in
`../execution/WEAR_QUANTITY_OWNER_OVERRIDE.md` supersedes only the archived v1.2
individual-garment proposal. Same FLOW-DEV-R1 budget and production gates.

Wear variants identify age/category, JACKET or PANTS, size and explicit compatible
sports. A pool identifies that variant at a store; neither the pool ID nor a loan/event
ID identifies a particular garment. No wear Asset, serial, QR or pseudo-unit slots exist.
Upper/lower size selections are independent. Public use of mixed sizes is not approved.
WEAR_SET is a commercial line, while two quantity requirements participate atomically
with the entire group's equipment requirements. Quantity claims never add physical stock
and are excluded from serialized assignment and its dependency graph.

Premium integrated choices require exact model+catalog season+selected variant, preserved
in HOLD/quote/payment conditions. Regular and legacy model-nonpromised conditions retain
that policy. Existing eighteen equipment products and216 prices remain unchanged. New
wear prices are an immutable development proposal,24 explicit values. Same-person qualifying
equipment SET applies20% to that person's wear only, then existing coupon/advance order.
Unapproved coupon+bundle combination is rejected. Five percent is a payment-time estimate,
not earned by quote creation. Taxes/season publication/chargeReady=false stay unresolved.

New additive0012 metadata and0013 quantity tables do not modify applied0001–0011.
An earlier unpublished0012 individual-garment prototype ran only in automatically removed
isolated test clusters; its diff/SQL/logs were archived outside the worktree on override.
Legacy equipment-only requests read optional metadata through JSON projections and do not touch wear claims; populated-prefix upgrade tests retain their original pre-migration writes. New edition/wear requirements still require matching metadata, never a permissive fallback. There is no installed garment-Asset data to delete or convert. Existing databases receive
only the new ordered migrations, with concurrent and recovery regression checks.

Physical pools hold READY/ON_LOAN/RETURNED_PENDING/CLEANING/TODAY_BLOCKED/IN_TRANSIT/
UNAVAILABLE. Actual checkout/receipt moves quantities under the existing inventory lock.
Loan/receipt quantities and immutable event facts witness bucket transitions. Stock edits
and transfer plans preserve all effective period claims; logical protection is not physical
stock. After a real receipt changes location, existing future promises remain recorded;
a pool with insufficient actually-ready quantity displays preparation/relocation attention.
Unconfirmed cleaning or transit arrival never contributes new sellable capacity. Current
implementation is conservative: it does not promise forecast cleaning completions or
inbound transfer supply. A ready-only quantity change cannot resolve protected deficits
by deleting the promises. Cleaning duration and real200-unit interpretation are unknown.

Planned transfers reserve source-ready quantity immediately and conservatively until
cancellation/dispatch. Only READY can be shipped; actual arrival is separate from17:00
scheduled departure, and no17:10 auto-arrival exists. Actual receipt needs separate ready
confirmation. No adding to departed transfers. The clothing quantity transfer API does
not modify equipment transfer guards or enable the blocked equipment custody adapter.

Normal staff sessions, fresh DB permissions and operation-specific stores authorize each
write before and after inventory-lock waits. Dedicated development role receives only new
wear-table rights; no new role defaults or actual accounts. No application DDL, raw SQL
input or exposure of migration credentials. The ordinary production route has no wear
connection; a separate validated tests/flow-app composition provides the synthetic UI loop.

Quantity checkout records per-member, per-component obligations; multiple receipts preserve
actual destination separately from planned destination. Returned quantities cannot exceed
loan quantity. Idempotency key and expected revision reject duplicate/conflicting actions.
Care completion before the next calendar date stays TODAY_BLOCKED; next-day release requires
actual ready evidence. Unknown returns remain quarantined outside sellable counts and bind
once to an exact obligation. No automatic refund. Exact corrections/backdating are not yet
exposed; no silent historical overwrite is permitted.

Normal password UI/API/real PG and frame/viewport tests are separate from real-phone camera,
real inventory or real Square. Existing equipment custody boundary remains blocked by the
recorded automatic approval decision. The whole E10–E13 milestone and all UI/CMS P0 cases
must not be called complete by the wear subset's tests or review.
