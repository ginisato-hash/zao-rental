# ADR 0032 — P5 local production preflight and booking recovery

Status: adopted for supervised local development by Owner Night R1, not production activation.
Base: PR15 squash `6dfde8d8ab3d797ebbd081da7a563a82ab40182f`.
Authority: [unchanged Night R1](../execution/OWNER_NIGHT_R1_ORIGINAL.md).

## Recovery authority and lifecycle

The input/checkout guest context keeps its approved BALANCED policy. Confirmed-booking
read capability and recovery proof are separate. Recovery never modifies a booking,
payment, price, due, HOLD, allocation, custody or staff principal. Use the existing
standard HMAC-SHA256 mechanism with independently derived read/recovery roots and
separate purpose labels; database stores
only SHA-256 proof/capability digests. No custom password/cryptographic protocol.

Enrollment requires the current guest context and the booking's stored owner, confirmed
state and original due. It binds to the stored contact; a browser cannot override the
recipient. An injected delivery port gets the secret only in process memory. There is
no default mail/SMS provider or public mailbox/test retrieval endpoint. Test enrollment
uses the same service plus an in-memory delivery fixture, without an HTTP test backdoor.

Each enrollment request reserves one send durably. Same-key response loss or restart
uses delivery lookup only. Timeout aborts the transport and records UNKNOWN behavior;
it does not repeat send. A process lost before sending can therefore require operator
reconciliation. Merely receiving a provider acknowledgement is not customer identity
proof: possession of the delivered high-entropy proof authorizes the read-only exchange.
Email ownership/deliverability and verified support when both browser and proof are lost
remain external launch conditions, not implemented support impersonation.

One recovery proof exchanges once with an idempotency UUID. A simultaneous/reloaded
same-key exchange yields the same capability; another key is denied. Exchange rotates
previous read access. Preparing a replacement recovery proof rotates the old proof;
existing read access stays valid until explicit revoke or successful new exchange.
Revoking a proof also revokes only its own exchanged capability, never unrelated later
access. Read-capability revoke prevents old exchange replay from resurrecting it.
Stored rows and audits are immutable historical evidence except lifecycle timestamps.
All operations recheck confirmed status and original due after the booking lock.

Proof/capability expiry is the original return due, never the guest or 600-second HOLD
expiry. The current booking enum has no cancellation operation/state. Only
CONFIRMED_DEV/COMPLETED_DEV with confirmed_at and due in the future are eligible; other
states and expired records fail closed. A future cancellation implementation must
revoke these capabilities atomically. No cancellation/refund workflow is added here.
Database/browser cookie lifespan limits can require entering the proof again; no TTL
extension or booking mutation substitutes for recovery.

HTTP uses same-origin POST and exact fields, the existing peer/rate guard, HttpOnly,
SameSite=Strict, Secure on HTTPS, no-store and no-referrer. Raw proof is absent from URLs,
response JSON, logs, persisted web storage and analytics. The user enters it in a password
field; that temporary field value necessarily exists until the request completes. Only
proof digest + random request UUID persist in sessionStorage for replay. Mutation clears
old displayed data and suppresses concurrent focus reads; authoritative GET reloads it.
Production composition remains unconnected/fail closed. The SQL role has execute-only
access to narrow recovery/read functions, not contacts, tables, DDL or business writes.

## Local production rehearsal

Test-only IPC entrypoint `tests/readiness/rehearsal-server.ts` accepts an exact synthetic
configuration and owned loopback database roles. NODE_ENV=production is real, but the
composition, logical HTTPS origin and trusted socket binding are laboratory fixtures,
not deployed Vercel/TLS proof. No production runtime can import this entrypoint or enable
it with a broad flag. The actual built Next app is separately started with missing
configuration and must return 503 for guest/access while health stays readable.
Rehearsal covers migration, ready/health, process restart, response loss and cold
same-major backup/restore startup. Local readiness is distinct from production readiness.
Next's observed requested-SIGTERM exit143 is accepted only without forced termination
and with the owned port freed; worker exits remain code0. SIGKILL is not graceful success.

## Preflight and ingress

`npm run --silent production:preflight` reads Git/GitHub only, prints JSON on stdout and
human gates on stderr; current pending state exits2. `-- --offline` reads no GitHub and
keeps remote evidence NOT_RUN. It does not publish, alter rules or load credentials.
The exact CI gate binds repository, workflow/event, final head, latest main, integration
parents/tree, run/attempt and all jobs. A dirty worktree cannot inherit HEAD's CI PASS.
Documentation and fixture success cannot manufacture an external gate PASS.

A trusted dispatcher may bind canonical out-of-band peer metadata to an exact Request
object through a private WeakMap. Headers never establish identity. Clones are unbound
until explicitly bound by that dispatcher. IPv4/mapped IPv6 are normalized; zone/list/
malformed values fail closed. This is an adapter seam, not verified Vercel metadata.
Same-NAT quotas remain the existing real-DB production-composition regression.

## Square, storage and resources

Sandbox activation metadata requires distinct two-store locations, Sandbox environment,
fixed API version, exact HTTPS receiver, metadata-only secret references and fixed20/5
budgets. It remains DISABLED. An injected resolver supplies access/signature secrets;
there is no environment discovery or default secret store. Receiver validation uses
exact original bytes and configured URL before parsing/lookup. At most one active and
one explicitly dated retiring key are accepted; expired grace is denied. Actual Square
retry-signing behavior, registration and key cutover require later Sandbox evidence.
The existing durable journal prevents repeated UNKNOWN POSTs and survives actual child
process replacement; no budget reset. Payment lookup/webhook reconciliation stays bound
to booking/amount/currency/merchant/location. UNKNOWN refund with no authoritative refund
ID remains stopped for verified reconciliation; do not infer an ID or POST again.

R2 uses operation-scoped SDK clients and a freshly resolved credential snapshot per
operation, so SDK memoization cannot silently retain a rotated credential. In-flight
operations finish with their admitted snapshot; issued signed tickets remain bounded
by expiry and cannot claim instantaneous provider revocation. Existing CMS rights,
revision and purge-receipt checks remain authority. Media backup port requires private,
encrypted off-host capture, exact immutable objects and a separate restore acknowledgement;
fixture acknowledgements are not real backup/PITR acceptance.

Owned test resources carry root/namespace/run/command/cluster UUID, kind and PIDs in a
sidecar (never inside uninitialized PG data). Preflight floors: 4GiB for full verify,
2GiB before each new cluster/copy. They are operational safety limits, not rental rules.
Only successful commands with saved hash-verified logs can dispose matching stopped
resources after child and PostgreSQL exit. Failed, unknown, symlinked or live resources
remain. Cleanup intent/result is evidence. These markers are not a hostile-code sandbox.

## Primary references consulted

- [OWASP recovery guidance](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html): random proof, single use, expiry, side channel, rate control.
- [Vercel request headers](https://vercel.com/docs/headers/request-headers): provider behavior needs verification at the actual ingress.
- [Square signature validation](https://developer.squareup.com/docs/webhooks/step3validate): configured notification URL and exact raw body.
- [Square signature key replacement](https://developer.squareup.com/reference/square/webhooksubscriptions-api/update-webhook-subscription-signature-key): activation procedure still external.
- [R2 presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/): bounded bearer access, separate from CMS rights and cache purge.

## P5-F1 corrective review record

Initial independent review returned REVIEW_PASS but retained LOW P5-F1. Codex treated
that as unresolved, not findings0. No current purpose collision/exploit was demonstrated.
The structural property (different effective roots) failed after extracting the exact
existing runtime derivation into a shared function without changing its behavior. This
is a runtime-equivalent unit counterexample, not an old-head live exploit or DB failure.
The corrected derivation keeps the P4 access-root label/vector unchanged, derives the
recovery root with a distinct label, and uses development-recovery-v1 for new recovery
composition. Test enrollment and the production-mode fixture use the same derivation.
Old read capabilities and P4 issue replay stay compatible. Previously issued synthetic
P5 recovery proofs are not silently re-enrolled under another key: mismatched same-key
prepare/replay fails closed; fresh owner enrollment is explicit. No real proofs exist.
The independently computed fixed synthetic read-root vector, accidental identical-message
cross-root test and full response-loss/UI/PG regressions verify the intended property.
This changes neither secret storage nor credentials/permissions/price/HOLD/business rules.
