# PRICING.md — Configurable Pricing v0.4

## Decision and implementation status
The owner approved the prior nonlinear multi-day proposal and requested a further half-day reduction and the ability to revise prices after observing demand.
For the initial implementation seed, half-day rates are set at approximately 75% of the one-day rate rather than the previous 85% proposal. This is a commercial starting choice, not a proven revenue optimum.
This document replaces the v0.2 linear/unresolved-duration assumptions. It is a specification; no admin UI or production API is implemented by this archive.

## Catalog and duration
Two stores initially share one price book: Mountain Base and Onsen Base.
Adult: 13 and over at rental start. Kids: under 13. No substitution between adult/kids inventory, even when nominal dimensions match. Kids premium is not offered in the initial price catalog.
Ski set: ski pair, ski boot pair, pole pair. Snowboard set: snowboard, bindings/setup, snowboard boot pair. Single-item prices are also supplied. Helmets are complimentary and wear is out of V1 scope.
AM: 08:30–12:00. PM: 13:00–17:00. Both have identical initial prices. Supported whole-day durations: 1–10. Do not invent 1.5-day/mixed-duration products.

## One-day base values and generation
One-day values are taken from the owner-supplied price-list screenshot. The owner approves keeping them unchanged for the initial season setup.
Multi-day generation discounts against `one_day_price * days`:

| Days | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Discount % | 0 | 8 | 13 | 17 | 21 | 24 | 27 | 30 | 33 | 36 |

Generate whole-day amounts with exact decimal/integer arithmetic and round to the nearest JPY 100, with exact halves rounded up. Generate half-day amounts as `one_day_price * 0.75`, with the same rounding.
These are generation helpers only. Persist the resulting explicit integer JPY price for every product and duration. At runtime, use the published table, not a hardcoded curve. Editing a half-day or 7-day amount must not force a one-day price change or other unrelated changes.

## Initial half-day prices
| Product (same ski/snowboard prices where applicable) | Adult | Kids |
|---|---:|---:|
| Set regular | 5,600 | 3,000 |
| Set premium | 6,800 | Not offered |
| Equipment only regular | 4,500 | 2,300 |
| Equipment only premium | 5,600 | Not offered |
| Boots only | 2,300 | 1,100 |
| Poles only (ski) | 1,100 | 800 |

A 75% generation factor is approximate after rounding; do not advertise all products as exactly 25% off.
The complete half-day plus 1–10 day table is in `config/pricing/zao-2026-27-v1.draft.json`.
No tax-inclusive/exclusive assumption is confirmed by this seed. Tax treatment must be finalized before customer publication; do not add tax to an already tax-inclusive price.

## Admin price-book workflow (to implement)
1. Authorized PRICING_EDITOR creates a draft by copying the current published version.
2. Edit one-day, AM/PM, individual durations, or a generation curve; explicitly preview recalculated amounts before applying them.
3. Display old/new prices, delta JPY, normalized duration saving, marginal extra-day price, eligible advance-payment price, and configured coupon interactions.
4. Set sales-effective timestamp, rental-date scope, and store scope. Reject ambiguous overlapping price-book selectors rather than relying on row order.
5. Validate and publish by authorized role. Once published, a price book is immutable. Changes create another version; publication and activation are separate states for scheduled books.
6. Record actor, reason, old/new version IDs, all changed values, and effective scopes in an immutable audit trail.
7. Roll back by publishing a new version copied from an earlier version. Do not delete history or reprice completed transactions.

Draft editing and price-book publication need optimistic concurrency protection. A normal staff account cannot publish prices or bypass coupon restrictions. Production activation requires the owner's go-ahead.

## Price selection and quote lock
Price books are chosen server-side using an explicit combination of quote creation time, rental-date scope, store, and product. Store scope is initially shared across both stores. A future store-specific book must have explicit precedence and pass overlap validation.
For V1, all occupied dates of a whole-day package must be covered by a valid price-book rental interval. Do not silently mix daily prices from different books; reject or route unsupported season-boundary quotes for review until a policy is approved.
A quote snapshots product, duration, date/store scope, selected version, all unit amounts and adjustments, final amount, currency, expiry and request fingerprint. Inventory-hold success is independent; a quote alone does not guarantee availability.
A published price change affects newly generated quotes only. An existing valid quote keeps its promised amount through its declared expiry. Quote expiry must respect inventory-hold and promotion cutoffs; do not silently extend an expired discount.
Once expired, regenerate a quote and obtain customer confirmation before charging a changed amount. A product/date change likewise requires a new amendment quote. Never trust a browser-supplied final amount.
A pending or unknown payment outcome is not permission to charge a new amount or create a new unrelated payment attempt. Preserve the accepted payment-attempt amount and reconcile the outcome with the booking/hold workflow.

## Advance discount and coupons
Preserve the v0.2 5% advance-payment policy: successful payment by 15:00 JST on the day before rental start; half-day rentals also qualify. Capture the promotion version/eligibility evidence and the exact amount accepted for payment.
The proposed order remains explicit duration table -> configured coupon -> eligible 5% advance discount. Each coupon defines combinability; do not silently activate a global stacking default. Validate coupons on the server and reserve/redeem limited-use coupons transactionally.
Round each final payable money adjustment to whole yen using HALF_UP, as an implementation convention requiring display consistency. Bound coupon discounts so amounts cannot become negative. A zero-total booking must have a reviewed no-payment confirmation path rather than sending an invalid zero charge.
Deadline-crossing payment handling must be tested before production: never retroactively increase a payment already submitted at an accepted amount. Any late success without valid capacity is an exception requiring reconciliation/refund handling, not automatic inventory oversell.

## Existing reservations and amendments
At confirmation, persist a booking price snapshot with version IDs, item prices, duration/date data, applied coupon/promotion adjustments, currency and tax breakdown (once defined), original payable total, and linked payment identifiers. Live catalog edits must not rewrite it.
Opening a booking, scanning a QR, receiving a webhook, or viewing a report must never trigger repricing against the latest catalog.
Use append-only AmendmentQuote and Amendment records for extensions, requested pre-use shortening, or product changes. An actual early return is NOT an automatic commercial shortening: v0.4 explicitly preserves the paid amount and forbids automatic early-return refunds; staff exceptions follow REFUND_POLICY.md. Default proposal: reprice the changed itinerary using the originally booked price-book version, retaining the original promotion only where still eligible. If that version lacks a required product/date/duration or coupon treatment is ambiguous, require a deliberate new quote/override; never silently switch to today's rates. This amendment policy remains subject to owner/reviewer approval before enabling production amendments.
Show old booked amount, newly quoted amount, change reason and collection/refund delta. Only an explicit authorized change plus the required payment/refund workflow updates the payable balance. Preserve the old snapshot and audit trail.
Cancellation penalties use the booked payable amount and the booking's policy snapshot, not today's list price. Cancellation commercial policy remains distinct and unchanged by v0.4. Early-return exceptions now explicitly permit selected staff with REFUND_OVERRIDE; see REFUND_POLICY.md. No new automatic entitlement to a shortening refund is introduced.

## Observe and adjust
Record price-book version alongside quote/checkout/payment events, product, adult/kids, duration, pickup store, rental date, lead time, and availability outcome. Reports should show booking count, revenue, average price, conversion denominator, and sold-out/hold-failure exclusions. Compare like-for-like segments; a higher post-change booking rate alone does not prove causation because demand changes across dates.
Enable deliberate revisions from those observations; do not implement automatic revenue-management price changes in V1.
