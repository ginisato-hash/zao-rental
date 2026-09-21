# P6 S3 Owner gate — NOT AUTHORITY / NOT EXECUTED

S2 result: **S2_PASS**, [safe result](p6/s2-evidence/safe-result.json).
Execution/manifest commit: `8ec42146401a4469b55f453ff28867ba5035bbc1`. Provider payment ID: `pezzekG1LQRt4MVKF0X4sgRCx1FZY`.
Amount100 JPY, Square Sandbox only, COMPLETED. Reference/location matched the immutable request.
Merchant MLKDVEDH1ME21 is bound through Owner-adopted R7 S1 and unchanged server Preview location; no merchant field was invented in Payment.

Operator POST1; CreatePayment1; conditional GetPayment0; automatic/manual retry0.
Fixed idempotencyKey: `1fc46b8b-ce24-49f6-b809-c1594c2788b5`.
Fixed request fingerprint: `19ad7d88b5c1f0bce8e209195e1ee4c84b76e89bf6e14ac306dfc9cc2a84a9d2`.
Operation manifest and exclusive fsync guard are retained. The guard/instance latch/provider idempotency boundary is the Owner-approved Sandbox-only exception, not distributed exactly-once HTTP proof.

## Separate possible next authorities

| Candidate | What Owner must authorize explicitly | Remaining acceptance |
|---|---|---|
| Lookup / recovery | The existing safe payment ID, GET count/time cap, exact unchanged account/version; no CreatePayment resend | Real response-loss/timeout recovery was not deliberately generated. Any UNKNOWN without safe ID still stops |
| Webhook | Dedicated protected receiver design, exact notification URL, subscription/event scope, Owner-installed signature key, durable receipt/journal and DB permissions, real delivery count | Raw-body signature, duplicate/out-of-order, durable ACK/recovery remain fixture-only or unconnected |
| Refund | This Sandbox payment ID only, explicit JPY amount no more than original remaining amount, fixed new refund key and count | Refund0 so far. S2 success is not refund permission; no operational customer refund |

Web Payments SDK/tokenization remains untested: S2 used the official Sandbox fixed source only. Booking state updates, real DB reconciliation, inventory/custody, real customers, Production and S3 provider calls are not authorized.
Do not use the old P4 20payment/5refund limits as a new authority. Do not reset budgets, repeat S1, rotate credentials, create another S2 Preview or refund/delete this payment as cleanup.

R7 FAIL_SECURITY_BOUNDARY remains recorded separately. S2 observations began only after Owner confirmed the target application; no callback URL/title/accessibility dump, Cookie/token/storage export or raw provider body was recorded.
The accepted R3 Preview remains. The exact S2 Preview/routes are removed only after evidence remote readback; final cleanup is recorded in P6 status.

Next Owner action: choose and approve a bounded **S3 authority**. This document grants none.
