# Pricing implementation acceptance criteria

## Seed validation — included in this archive
- 18 unique sale products, each with AM/PM and 1–10 day integer JPY prices.
- AM and PM initially equal; half-day rates use 75% with JPY 100 HALF_UP rounding.
- One-day values unchanged; all initial multi-day values match the approved curve after rounding.
- Total price strictly increases with whole-day duration; average daily price does not increase.
- Each extra-day increment is positive and non-increasing for the initial seed.
- Buying a set is no more expensive than its separately priced components.
- No kids premium and no snowboard poles; advance half-day examples 5,320 / 6,460 / 2,850 yen.
- Seed remains DRAFT with no automatic production activation.

## Must be implemented and tested separately
1. An editor changes only the half-day row; daily and other duration rows stay unchanged unless explicitly regenerated.
2. Publishing V2 affects a newly generated quote but not an unexpired V1 quote or confirmed V1 booking.
3. Editing rental dates/quantity invalidates the old quote; no client value can select a cheaper stale amount for altered goods.
4. Quote expiry or discount-cutoff crossing requires a fresh customer-confirmed quote; no silent higher charge.
5. Concurrent publication and checkout deterministically select one version and persist its exact amount.
6. Duplicate/stale webhook delivery never re-reads the live price table for a past payment.
7. A staff account cannot edit/publish price books; stale editors cannot overwrite a newer draft unnoticed.
8. Price-book rollback preserves history and existing booking prices.
9. Amendment preview persists the original snapshot, shows the delta, applies explicit coupon/promotion rules, and performs at most one successful collection/refund per operation key.
10. Partial group cancellation uses a reproducible allocated amount and prevents over-refund. No new live price can inflate cancellation penalties.
11. Overlapping scope, missing dates, missing duration, negative prices, wrong currency and undefined tax treatment block publication/charge as applicable.
12. Coupons cannot produce negative totals or bypass usage limits under concurrency; zero-total flows are explicitly tested.
13. Browser/payment timeout yields reconciliation, not an unrelated duplicate charge.
14. Analytics group by effective version, segment and availability; price changes do not modify historical reporting amounts.

Evidence required: unit, transactional integration, authorization and payment-sandbox end-to-end tests. The local seed tests alone do not satisfy these runtime criteria.
