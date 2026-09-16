# M1.6 initial review disposition

Initial exact85a9f752: BLOCKER0 HIGH0 MEDIUM2 LOW1. One initial consumed.

- M1: GuestBooking sends selected ja/en locale at checkout; the saved checkout intent and immutable booking freeze it. Replay cannot silently change language. Confirmation hook and outage-repair sync read that canonical field, without caller locale override. Real PostgreSQL guest English checkout asserts booking and outbox en and rejects locale drift. Existing legacy/staff callers default ja.
- M2: runBatch now separates SEND from LOOKUP. Ambiguous results wait at least1minute; lookup reservations space UNKNOWN probes by10minutes even with concurrent batches. Expired SENDING claims are lookup-only. Accepted lookup marks SENT; absent/unknown lookup never authorizes a send. PostgreSQL timeout-after-accept proof closes through runBatch with unchanged send count and unchanged booking. Timeout-before-accept stays UNKNOWN.
- LOW1: initial review records residual recovery timing side channel. Generic response/status, canonical UUID booking reference, peer/booking limits remain; LOW recorded only.

Correction review max1 after targeted validation; no provider transport activated.
