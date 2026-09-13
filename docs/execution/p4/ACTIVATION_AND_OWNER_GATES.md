# P4 activation gates / actual external connections NOT_RUN

| Area | Owner decision | Proven locally / still required |
|---|---|---|
| Guest draft/checkout | BALANCED8values approved | Versioned values + regression; production config remainsnull until Vercel ingress verified |
| Confirmed booking | Separate high-entropy read capability | Real DB and ordinary UI; original due, owner issue, expiry/revoke/replay. Email delivery and cookie-loss support recovery remainunconnected |
| Hosting | Vercel direct candidate | No front proxy. Provider peer identity/header overwrite must be observed in actual Vercel before opening production composition |
| Sandbox | <=20 synthetic payments, <=5 refunds authorized | Fixtures + real DB only. ApplicationUNCONFIRMED, secret storeUNSELECTED, HTTPS receiverNOT_CREATED. Real0/0 |
| Storage | R2 first candidate | SDK handler/signature fixtures. Account/bucket/credential/rights/CDN purge and real object operations notperformed; no contract/paid plan |
| Backup | RPO<=5min/RTO<=4h/30days/monthly+importantmigration | Selection target only. Offhost/encryption/PITR/provider and measured RPO/RTO pending |
| Coupon | Independent couponOFF at first launch | Existing guest service rejects non-nullcoupon; staff synthetic pricing fixtures not actual coupons. Prior-day15:00JST completed-payment5% unchanged |
| Business/legal | Tax/salesdates/cleaning/NAP/legalrights pending | No fabricated values/chargeReadyfalse; delayedpickup originaldue/price unchanged |
| Real stock/devices/search | Owner/source/field input pending | No actual importcommit/phonecamera/SearchConsole/GBP/listing actions |
| Deployment | Not authorized | No deploy/domain/externaltunnel/productionmigration |

## Exact external resume steps (only when Owner supplies nonsecret metadata)
1. Owner confirms/creates a Sandbox application and selects the approved secret store.
2. Fix one Sandbox merchant/location set, appID and API2026-08-19; verify read-only.
3. Fix a Sandbox-only HTTPS receiver, signature URL/key storage, callback/origin policy.
4. Resolve secret values directly in the approved server environment; never chat/repo/logs.
5. Fix one durable activation journal target and approvalIDP4-SANDBOX-OWNER-R1. Preserve
   counters across process/worktree restarts; do not replace the DB to restart the allowance.
6. Wire Web Payments Sandbox SDK source tokenization and the receiver/backend authority
   through the reviewed boundary. Current normal guest payment route stays unavailable.
   Browser redirect/paid=true never confirms. Live tokenization/webhook registration,
   session-independent receiver reconciliation and secret rotation still need proof.
7. Run bounded actual trials and record sanitized provider IDs/counts/environment separately
   from fixtures. UNKNOWN: retain the same attempt/key, lookup only with verified providerID;
   never issue a new charge key. Auth/quota/network uncertainty: stop affected operation.
8. Sandbox refund fixture does not complete real refund acceptance. Unknown refund has no
   automatic resend/amount release; explicit provider reconciliation remains a live gate.

## Development reproduction
`npm run setup` then `npm run verify` from this worktree. `test:activation-p4` owns isolated
Postgres/Web/browser and terminates them. `test:unit` includes R2 SDK fixtures. They use
synthetic staff/guest/stock/payment transport and generated in-memory development secrets;
no external service credential is read. Production build `/api/booking-access` returns503.
Screenshot `.local/screenshots/p4-confirmed-booking.png` contains only synthetic summary/QR,
never the bearer cookie. Width emulation is not a real iPhone/Android test.

Do not post raw HTTP traces or DB clusters. Existing CI observations34749426170 and
34756544102 remain historical unresolved observations; P4 successes are not root-cause proof.
PR3 remains Draft, RunnerUNATTENDED_HOLD. Only PR14 was authorized for merge.
