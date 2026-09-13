# ADR 0024 — Receipt-bound development custody

Status: implementation under ZAO-FLOW-CUSTODY-DB-BOUNDARY-R1; verification is recorded separately.

Use existing BookingService/session, inventory lock71820600 and actor settings lock71820901,
confirmed development bookings, exact full-period allocation witnesses and the inert0010/0011
custody records. Add0015; preserve all applied0001–0014 checksums. One Asset is one ski pair,
board or boot pair. A pole loan row is a fungible PAIR accounting slice, never a physical QR.
Wear retains quantity pools and independent wear rows, joined by booking/member and a shared
cycle ID for newly checked-out records. Existing immutable records are not rewritten.

A dedicated worktree custody client has named reads/inserts and narrow state/version updates.
It has no membership in the NOLOGIN custody executor, migration owner or table owner, and no
location/history/loan-state writes. Application code supplies a server-verified subject/session;
no HTTP actor, role, continuation or owner flag becomes authority. The database validates that
session and current active staff/BOOKING_VIEW/operation/store scope again inside mutation.

Acquire inventory lock, then shared actor-settings lock, then session row SHARE lock, then
mutate. Staff settings writers take the existing exclusive actor lock. Thus a revocation that
commits while a custody request waits on inventory is visible after acquisition. Session row
locking also serializes logout/password/session deletion against the mutation. Post-lock server
time and pinned loan version are authoritative, not screen state. Unauthorized preflight does
not wait on inventory. The executor needs UPDATE on the session ID column solely for PostgreSQL
row-lock privilege checking; no exposed function updates session data or accepts an expiry.

Publicly named rental_apply_receipt(uuid) and rental_apply_inspection(uuid) have pinned
pg_catalog,public,pg_temp search paths; public has no CREATE. Creation, PUBLIC revocation,
owner assignment and execute grants happen within migrate()'s single transaction. Private
helpers have no application EXECUTE or schema access. Follow PostgreSQL18's official
[SECURITY DEFINER guidance](https://www.postgresql.org/docs/18/sql-createfunction.html#SQL-CREATEFUNCTION-SECURITY).

The new executor does not own the equipment ledger. Receipt-only transaction/backend-bound
private effect rows authorize exact Asset/destination or one PAIR delta. The location guard
checks executor identity and the matching still-OUT, unapplied receipt/candidate version.
Other migration-owned functions cannot accidentally enter that branch. Existing E07 movement
logic is retained. The trusted migration superuser can inherently change DDL; this is not an
OS/database-superuser containment claim, and app roles cannot assume that identity.

After physical receipt, append custody/location evidence, retire only that booking/requirement/
physical witness's claims, preserve all other claims and mark affected promises for reconciliation.
Unreturned group members remain OUT. Confirmed protection never relies on a ten-minute TTL.
Receipt and inspection do not alter price snapshots or refund anything. Inspection removes the
indefinite inspection block, but leaves the maximum of contractual end date and receipt date.
No same-day reuse, including Premium and cross-store receipt. Actual return never automatically
moves equipment back to planned/source store.

Poles move exactly one attributed PAIR from source accounting pool to actual-destination
maintenance; inspection moves it to that destination's available pool. Uninspected pairs do
not become sellable. Calendar blocks remain separate quantity placements. Unknown quantities
cannot complete an arbitrary loan. Receipt/candidate uniqueness and saved request keys protect
network replay and two-terminal attempts; stale candidates never attach to a newer cycle.

Preparation records explicit full-group witness confirmation and human fit evidence. It does
not compute DIN or certify safety from body data. Current custody entrypoints exist only in the
isolated synthetic development app, with normal staff login/API authorization. Normal apps/web
has no custody mutation route or simulated payment activation. Real phone/camera, Square,
production and actual people/inventory remain untested and unauthorized.

Physical checkout additionally respects the existing first-day slot start and shop close17:00 JST;
MULTIDAY HOLD continuation after17:00 never authorizes customer handover. Returns remain
recordable after due/close. Saved mutation keys resolve current authorized loan/batch state,
without changing original request evidence or applying a receipt twice.

Current services require custody migrations; old-prefix upgrade tests seed explicit historical
rows in their old schemas before migration. They do not skip custody checks in runtime.
