# ADR0031 — P4 Sandbox activation and confirmed booking access

Accepted for dedicated development verification. Production composition stays closed.
Direct Owner P4 decisions and subsequent missing-resource answer are in
[PRODUCTION_P4_APPROVAL](../execution/PRODUCTION_P4_APPROVAL.md).

## Confirmed booking capability
Input context and booking confirmation have different lifetimes. Keep BALANCED input
policy and HOLD600s unchanged. A separate HMAC-SHA256, purpose-separated 256-bit capability
uses a 32-byte server key. Only SHA256 is persisted; same booking/owner/request/key-version
reconstructs the same result after response loss. This reuses standard Node crypto and the
existing recovery pattern; no new encryption/session protocol. The current implementation
is a revocable restricted session, not an email/password-reset token.

Issue requires the live owner guest context and confirmed booking, rechecked after locks.
Expiry is the original return due; read never slides it. Rotation revokes the prior capability;
old request replay cannot revive a revoked record. Read returns only id/state/mode/stores/
period/due/total/price hash/QR, no contact, body measurements, payment actions or inventory
rights. Issuance/revocation audit contains identifiers/actions, never raw token/hash.

HttpOnly/SameSite Strict/Path=/api/booking-access; Secure on HTTPS. No token in URL,
JSON, DOM, localStorage, analytics or logs. sessionStorage holds only a non-secret request UUID.
POST requires exact Origin and rejects cross-site; every response is no-store/no-referrer.
UI acknowledges save only after response, clears on revoke/page exit, and revalidates on return.
A separate execute-only development DB role gets three fixed functions, no table/DDL rights.
No existing staff/guest/flow permissions are broadened by that role.

Browser persistence can be capped (cookie Max-Age capped400days); server validity remains
original due. Loss of the cookie and expired guest context cannot be repaired by a public ID.
Cross-device/email delivery, production secret store/key lifecycle and support recovery are
unconnected gates. Production route503 persists until a separately approved composition
with trusted ingress/rate limiting/secret handling exists. This is not a production login claim.

## Square activation
Existing raw Sandbox gateway remains SQUARE_UNCONNECTED. Only the explicit journal wrapper
uses SQUARE_SANDBOX and the approved activation ID; BookingService accepts this only in
nonproduction test/development with matching configuration. Mode is immutable in the booking,
synthetic contact only, CONFIRMED_DEV and chargeReady=false remain. No normal public payment
route is enabled. Existing SIMULATED_DEV tests remain separate.

One persistent approval journal reserves before POST. Unknown/submitting calls count toward20;
reconstruction/replay does not reset counts or repeat POST. Auth/quota stop is durable and
cannot be cleared by the runtime role. Verified webhook may recover a missing provider ID
only after a signed matching merchant event and fresh lookup verifying payment ID, booking,
amount/currency/location. Same event dedups; out-of-order body is not financial authority.
The HTTP webhook remains unconnected; this is authenticated service-level fixture proof,
not an unauthenticated backend worker or public receiver.

Sandbox refund trial is an isolated workbench, no customer/staff refund endpoint. It only
uses payments recorded as completed in that journal, reserves partial amounts, caps5,
requires same-key replay, and blocks further refunds for unknown results. Failed/refused
amounts remain conservatively reserved. Refund reconciliation/real activation require
separate evidence; no automatic release, business refund, quote edit or inventory change.

Real counters remain0. A shared durable activation database, exact merchant/location and
secret/HTTPS configuration must be fixed before actual requests; rebuilding a fixture DB
is not authority to reset real counters. SDK/tokenization/account/webhook activation itself
is not verified while the Owner's three external prerequisites are missing.

## Storage
R2 first candidate uses pinned AWS SDK3.1131.0 / Node>=20 (localNode24.15).
No custom SigV4 implementation, credential chain or automatic retry. Fixed R2 endpoint,
private originals/derivatives, conditional immutable writes, hash verification and SDK
private-original signed reads. Existing CMS remains the rights/release authority. CDN
purge is a separate injected receipt boundary; pending receipt is not success. Signed
URLs already issued can survive until expiry; logical withdrawal does not erase caches.
Fixtures exercise SDK requests/signing with synthetic in-memory material, not actual R2.

## Primary references (retrieved2026-09-13)
- [OWASP session management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
- [Square Sandbox](https://developer.squareup.com/docs/devtools/sandbox/overview)
- [Square payment create](https://developer.squareup.com/reference/square/payments-api/create-payment)
- [Square refunds](https://developer.squareup.com/reference/square/refunds/refund-payment)
- [Square PaymentRefund](https://developer.squareup.com/reference/square/objects/PaymentRefund)
- [R2 S3 compatibility](https://developers.cloudflare.com/r2/api/s3/api/)
- [R2 signed URL SDK examples](https://developers.cloudflare.com/r2/api/s3/presigned-urls/)
