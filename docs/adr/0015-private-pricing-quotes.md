# ADR 0015: Private, versioned E08 estimates

Accepted for supervised development, 2026-09-12. Business authority remains PRICING.md,
PRICING_ACCEPTANCE.md and the unchanged config/pricing/zao-2026-27-v1.draft.json. No price strategy,
curve regeneration, tax decision or production publication is introduced. E03 is only extended for
the quote/time contract; unrelated E03 work is not marked complete. E02 remains UNATTENDED_HOLD.

The existing Next.js / PostgreSQL / Better Auth architecture is retained. Migration 0006 adds
price books, explicit activation history, coupon configurations, immutable quotes and append-only
pricing history. Applied migrations 0001–0005 remain unchanged. The new local pricing DB role cannot
read credentials, edit inventory/HOLD, perform DDL or alter audit/quote history. Existing real-password
staff sessions are resolved again for each entry and each transaction. QUOTE_VIEW, QUOTE_CREATE and
PRICE_EDIT have no role defaults. PRICE_EDIT also requires ADMIN and explicit ALL-store scope.
The bootstrap admin cannot edit itself; it creates a separate explicitly authorized price admin.

Books copy all 18 x 12 explicit integer JPY values. source_sha256 fingerprints the canonical parsed
source document (sorted object keys), not its whitespace or original byte stream; review manifests
also hash the actual source bytes. A DRAFT is editable with an expected revision. PRIVATE_AVAILABLE
books are immutable, including future scheduled ones. One shared-store activation chain has an
explicit predecessor and unique increasing effective timestamp. The latest activation at quote time
supersedes the entire previous book; every rental date must fall inside its range. There is no fallback
to an older book, per-day version mixing or unapproved store-specific selector. General price-editor
UI, production publication and reasoned commercial approval remain future work; the normal UI exposes
only explicit development initialization and read-only version details. Draft copy/edit/activation
services and their concurrency are tested as internal administration boundaries.

Pricing writes serialize on advisory transaction lock 71820800. Any operation reading a HOLD for
use takes existing inventory lock 71820600 first, then pricing lock; it never modifies the HOLD.
Transactions have bounded lock/statement/idle timeouts and reauthorize before allocation locks.
Reads use one repeatable-read transaction. A request key plus server fingerprint prevents duplicate
quote creation after a lost response; a different payload cannot reuse that key. Quotes snapshot
conditions, one book and activation, coupon version, line items, adjustments, integer total, expiry,
calculation/promotion versions and a hash. GET never recalculates amounts. It reports expiry or linked
HOLD drift/release/payment uncertainty/transfer delay separately. This is not a payment authorization:
chargeReady is always false, including quotes without HOLDs. A confirmed booking can reference/copy
this immutable snapshot at the later payment boundary; no booking confirmation is implemented here.

BigInt applies whole-JPY HALF_UP adjustments. The explicit source table is never recomputed.
The existing proposal coupon-then-early order is explicit; each coupon must explicitly ALLOW stacking
or it is refused when early discount would apply. The synthetic coupon store basis is explicitly PICKUP_STORE; other bases require a future approved contract. Minimum basis is also explicit (eligible subtotal
or whole cart), avoiding a hidden commercial default. No real coupon is seeded. Versioned synthetic
coupons cover scope, validity, minimum, cap and stacking tests. Quote lookups consume no coupon capacity.
An internal, non-HTTP reservation boundary atomically limits active reservations with idempotence and
expiry. This is NOT lifetime redemption/use counting: redemption, release/cancellation policy and
booking/payment commits remain unconnected and block production coupon use. maxActiveReservations currently limits
active reservations only; its configuration must not be represented as a production lifetime-use cap.

Early discount is a versioned estimate, not permanent qualification. The pure future-payment contract
accepts only trusted verified completion timestamps, inclusive of the prior-day 15:00 JST cutoff.
At the exact cutoff, a new discounted quote would have zero lifetime and is refused; a verified payment
at that instant still qualifies. No client-supplied payment event is accepted. The development preview
TTL is 600 seconds and bounded by rental start, linked HOLD expiry, coupon expiry and estimated early
cutoff. Production quote TTL remains unapproved. Price changes do not rewrite prior valid quotes.

Tax classification, production sales/rental dates and coupon policies remain unconfirmed. The UI/API
label private estimates and pending tax, not tax-free or charge-final amounts. A zero total exposes a
manual-no-payment-confirmation gate, never a zero Square charge. All development ranges, users,
fixtures and clocks are explicit synthetic/operator-selected inputs, not inferred real operations.

Validation: 216 manually transcribed price cases and independent discount arithmetic, actual PostgreSQL
version/locking/audit/permissions/HOLD tests, plus ordinary built Next UI -> password session -> API -> DB.
The UI has no embedded public price table; price metadata comes from the protected API and pricing
imports in client code are type-only. E08_SCOPE maps implemented and future work; exact-head evidence,
CI and external static review are attached to the Draft PR. Static reviewers do not execute tests.

E08-01 review correction: quote expiry is the primary unusable status. HOLD-derived reasons are
computed for an otherwise time-valid quote, so a released/changed HOLD cannot hide EXPIRED. Amounts,
snapshot hashes, expiry deadlines, refusal behavior and chargeReady=false are unchanged. A real-DB
regression first failed on the reviewed head (HOLD_EXPIRED_OR_RELEASED vs EXPIRED), then passes with
this guard. This changes staff-facing diagnosis only, not commercial or payment policy.
