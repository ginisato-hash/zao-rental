# ADR 0014 — Supervised E07 store transfers

Status: implemented candidate; CI and independent review are recorded per exact head, not implied by this ADR.
Authority: owner-approved PR #6 exact-head merge, then one supervised E07 Draft PR. PR #6 was
squashed to `ace5fd2251d5bbe54950196daf4e514287bd803d`; its tree equals the approved E06 tree.
No PR #3 code, Runner activation, production data/deploy or customer lending/return is included.

## Reuse and state boundaries

Reuse E05 password/session/RBAC, E06 whole-Tokyo-date solver/global transaction advisory lock,
append-only audit and the existing worktree-owned PostgreSQL launcher. Add 0005 after the immutable
0001–0004 prefix; do not replace the framework, ORM, inventory solver or authentication system.
`transfer_batches.PLANNED` plus its transactionally protected pieces represents the existing
COMMITTED order / PLANNED batch concept. A request without successful protection creates nothing.
`DEPARTED` seals the batch and records actual departure. Piece states IN_TRANSIT, RECEIVED, READY
separate custody from receipt and preparation. CANCELLED is pre-departure only; issues never erase
physical movement. CLOSED retires an already-ready projection only when no active claim refers to it.

The ordinary batch is unique per direction/date. It is scheduled at 17:00. Actual departure is a staff
operation at/after 17:00 on that date; lines may be added while still PLANNED, including after 17:00
before actual departure. A second batch cannot circumvent a departed batch. No automatic daytime
trip or 17:10 receipt exists. Expected readiness and needed-by are explicit timestamps with a recorded
staff basis. No travel/loading/preparation duration, vehicle count, or simultaneous-route capability
is inferred. Staff must confirm route and readiness feasibility; automated vehicle route scheduling
is not implemented. These are estimates, never evidence of physical receipt or customer handoff.

## Stock protection

An Asset remains one immutable ID (ski pair, both boot pair kinds); no side/sub-Asset state.
The source remains the last registered store during transport; `custody=IN_TRANSIT` overrides shelf
interpretation in the ledger UI. Only formal actual receipt changes the current store and adds a
location history. Original store, model, size, age and class remain immutable in basic edits.
Physical availability is not a reservation count or permission to lend.

Pole transport is size/variant-specific PAIR quantity. Internal quantity slices allow partial receipt,
idempotent accounting and exact day-capacity claims; they are neither physical pole identities nor
QR labels. The UI takes pair counts. Dispatch removes physical source quantity; receipt adds only
received quantity to the destination MAINTENANCE pool; explicit readiness moves that quantity to
AVAILABLE. A protected future projection can exist before physical receipt, but is counted only once.
Ready projection slices are subtracted from ordinary pool capacity until archived; active claims
keep their projection. Ordinary unprivileged claim writes compact fungible source-pool slots after
shipment; the existing replan audit records before/after. No extra privileged compaction function
or role grant is introduced.

E06 still solves complete periods/all components. Before departure, an Asset can satisfy a source
period ending on/before the batch date; a future destination request needs the protected transfer,
selected variant, next-date boundary and readiness estimate. In-transit/received-unready items never
become immediate capacity. Dispatch-pinned or affected witnesses are preserved, not automatically
rearranged. Cancellation/TTL changes release only the rental HOLD, not shipment. An affected HOLD
retains claims and gets attention; elapsed readiness is also derived on reads, without a daemon.
The allocator does not turn unrelated stock shortages into transfer prerequisites.

Planning an exact source unit that conflicts with a future promise is rejected explicitly; E07 does
not optimize routes or automatically move fixed promises. Staff may select another feasible unit.
Prepared/rental-fixed same-day stock is not presumed returned/inspected. Existing OUT/maintenance
constraints remain blocking. Actual customer return, occupancy release and scanner work remain E12.

## Authorization and trust

Four explicit permissions: TRANSFER_VIEW, TRANSFER_PLAN, TRANSFER_DISPATCH, TRANSFER_RECEIVE.
No role gains them by default. Plan/add/cancel require both stores; dispatch requires the source;
receive/ready require the destination. Issue recording requires a relevant dispatch/receive grant.
DB rechecks active staff, revision and stores before the allocation lock and again within it.
Normal API uses verified password sessions, origin validation, strict JSON, no-store responses and
session-bound pending-request storage. IDs/roles/stores supplied by a browser confer no authority.
The transfer role has no auth credentials, DDL, staff administration or direct audit mutation rights.
Narrow stock-movement functions use fixed SQL and state-checked transfer references; a caller GUC
alone cannot change custody through a ledger update. Migration ownership is not passed to Next.

## Verification boundaries

Real PostgreSQL tests cover a populated PR6 prefix, current sessions/old claims, transfer/HOLD
competition, one Asset and fungible quantity conservation, partial receipt, replay, scope refusal,
fixed witnesses and audit. Normal Next UI tests use real synthetic password login, protected API and
PostgreSQL. The database clock function normally returns `clock_timestamp()`; only the disposable
DB owner replaces it in tests. App roles cannot replace it. No test principal or clock-setting route
exists. Lost-response tests lose the response after a real committed API mutation.
Screenshots are desktop/mobile viewport simulations, not physical-phone acceptance.

No actual stock/customer/staff data, production setup, payment, lending, return, automatic dispatch,
or autonomous model execution is asserted by these tests. Daily operational route/readiness values
and real-device/real-staff acceptance remain human operational gates.
