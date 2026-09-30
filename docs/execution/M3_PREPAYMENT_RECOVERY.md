# M3 recovery: permission completion and preparation before payment

Base: `3fe3de9b6c155ce09a5a66e2f9bd6e5872929aaa`. Scope is the exact missing
QUOTE_VIEW permission and a shared guest preparation boundary. The existing one
Production ADMIN/session, Source B (88 buckets / 520), two models/two variants,
M2 deployment and publication OFF must be preserved. This source change itself
performs no Production mutation, deployment, payment, refund, email or DNS write.

## First ADMIN

Future `production:bootstrap-first-admin` invocations create only the two explicit
overrides PRICE_EDIT and QUOTE_VIEW. Existing ADMIN defaults remain unchanged.
There is no blanket grant and no change to the development bootstrap or to
SELF_ACCESS_CHANGE_FORBIDDEN. The existing Production account must not be recreated.

After the combined Owner approval and merge, use the attended command:

```sh
npm run production:complete-first-admin-commercial
```

It accepts no arguments, identity, permission, password or profile input. The
existing approved owner DB URL is injected through process memory in
`PRODUCTION_STAFF_BOOTSTRAP_DATABASE_URL`; the CLI removes that variable before
Git subprocesses. Do not expand the URL in argv, shell history or evidence.

Admission reuses the reviewed canonical-repo / clean fresh-main / fixed Production
host / neondb / verified TLS / exact current-session-database owner guards.
One transaction takes the bootstrap advisory lock and locks the account/access
tables against concurrent changes. It requires one staff/user/credential account,
the pinned canonical Owner email fingerprint, active ADMIN / ALL, no store
assignments, PRICE_EDIT=true and no unrelated overrides. QUOTE_VIEW=false or any
target/state conflict returns PRODUCTION_FIRST_ADMIN_PERMISSION_RECONCILIATION_REQUIRED.
QUOTE_VIEW=true returns ALREADY_READY without writing.

The only row inserted is QUOTE_VIEW=true. The existing trigger increments the
staff revision and records PERMISSION_CHANGED under
`production-first-admin-commercial-permissions`. Before and after COMMIT, safe
readback checks the same target, revision and exactly one attributable audit.
The post-COMMIT check is read-only. Commit uncertainty or failed committed
readback requires read-only reconciliation, never a blind retry.

The CLI does not modify profiles, passwords, roles, scope or sessions. Refresh
GET /api/session after completion; the old public session stamp may be stale.
Require QUOTE_VIEW + PRICE_EDIT and GET /api/quotes/catalog HTTP 200.

## Guest preparation

POST /api/guest/prepare-payment accepts exactly draftId, expectedRevision, contact,
reviewHash and optional locale. Payment sources, provider IDs/status/observations,
paid flags and all other keys are rejected before stock mutation. The maintained
guest cookie, origin, body-size and security guards apply.

Both prepare-payment and checkout invoke the same internal preparation operation:
revision/selection/review checks, normalized idempotent contact and locale,
catalog reapproval, recommendation selection, HOLD, persisted quote, price review
comparison, BookingService.create and guest_drafts.booking_id persistence.
No parallel booking engine or alternate commercial authority is introduced.

prepare-payment additionally verifies the prepared DRAFT still has an active,
usable quote/HOLD with current protected claims and commercial authority, and no
payment attempt. It does not call startPayment or a gateway. Identical calls reuse
the existing IDs and never extend TTL. Expired or otherwise unusable preparation
fails closed. A changed contact/locale remains an idempotency mismatch.

checkout remains compatible with the current UI. Commercial checkout still
requires paymentSource; it reuses preparation and invokes startPayment. Existing
payment attempt replay semantics remain in BookingService. No UI redesign is
part of this change.

## Local proof and limits

Tests cover exact permission completion, refusal, idempotency, profile/password
preservation, audit/revision and refreshed normal session. The local DB fixture
maps only its synthetic email fingerprint to the pinned public fingerprint;
the actual CLI exposes no target/fingerprint override and is never run on Production.

Guest HTTP tests use real isolated PostgreSQL, real HOLD/quote/booking services,
approved price arithmetic and a local gateway spy. Only the already-issued
Production identity lookup is mocked in that isolated test process; the real
issuer is unchanged and cannot issue a capability for a synthetic target.
Pinned Production identity acceptance remains a separate hosted gate. Tests prove
one DRAFT/HOLD/quote with zero attempts/calls, repeated/concurrent replay without
TTL changes, payment-material rejection, checkout reuse with one gateway call,
contact/locale/revision/review rejection, and expiry. Existing integrated tests
cover price changes between review and selection through both entrypoints.

## Later release and M3 continuation

The source-ready gate requests one combined Owner approval: merge this exact PR,
one new-main Production deployment, and one permission completion. Before approval
there are no Production writes. For that deployment bind both build and runtime
PRODUCTION_RELEASE_ID and VERCEL_GIT_COMMIT_SHA to the new main, including matching
Git metadata. Preserve existing credentials, origin, All Deployments protection
and absence of publication approval. No blind second deployment on failure.

After acceptance and permission completion, initialize the single approved
PRIVATE_AVAILABLE revision-2 pricebook/activation for a range containing
2027-01-15; no edits. Use a fresh normal guest context for Adult WEAR_SET M/M,
Mountain → Mountain, 2027-01-15 DAY, no coupon/advance discount. Call
prepare-payment, never checkout, and freeze the actual persisted commercial quote
as LIVE_CHARGE_JPY and FULL_REFUND_JPY.

Continue authorized non-money M3-D preparation. The eventual money gate binds the
scenario, commercial authority, exact quoted amount and maximum authorized JPY.
Do not depend on a response within the 600-second HOLD window. After approval,
if expired, create a fresh identical normal flow and require the fresh actual
quote amount to equal the approved amount with unchanged commercial authority.
Otherwise STOP_M3_PRICE_CHANGED_AFTER_MONEY_APPROVAL, with no charge. Never extend
the old HOLD or rewrite its quote. Provider/payment/refund mutations remain
subject to their current explicit Owner authority; publication stays OFF.
