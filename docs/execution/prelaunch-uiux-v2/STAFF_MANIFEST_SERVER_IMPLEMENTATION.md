# UX-5C — Staff Manifest server implementation evidence

Authority: PR #26 comment [`5749991741`](https://github.com/ginisato-hash/zao-rental/pull/26#issuecomment-5749991741)
(Technical Director — UX-5B DESIGN PASS / server implementation authorization).
Correction batch 1 closes [comment `5751235980`](https://github.com/ginisato-hash/zao-rental/pull/26#issuecomment-5751235980)
(Technical Director — UX-5C SERVER REQUEST_CHANGES on candidate HEAD `2d3d2a8`, submission
`5751199806`; findings UX5C-R01 through UX5C-R04). See §12 for what changed and why.
Design source: `docs/execution/prelaunch-uiux-v2/STAFF_MANIFEST_DESIGN.md`.

## 1. Scope delivered

- Read-only `ManifestService` (`packages/core/src/operations/manifest-service.ts`).
- `GET /api/operations/manifest` added to `apps/web/src/lib/operations-http.ts`, with exact
  allowlisted query keys `store`/`date`/`section`/`cursor`/`pageSize`; unknown keys `422`.
- No POST/mutation route added. No other existing `operationsHandler` branch changed.
- `npm run test:operations-manifest` script added to `package.json`.
- No schema, migration, index, DB role, GRANT, or permission expansion. No Staff Home wiring.

## 2. Architecture

`ManifestService.manifest()` authorizes (`BOOKING_VIEW` + requested store in `principal.storeIds`),
then runs two separate snapshots per page (see §3 for exactly why this is two, not one):

1. **`businessSnapshot()`** opens `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY` and calls
   `read()`, which runs `candidateKeys()` — Branch A (pickup today / no-pickup completion day),
   Branch B/B-wear (equipment/wear return due today), Branch C/C-wear (actual-store receipt,
   current or carry-over pending). Each candidate branch is gated by the composed capability
   (`RENTAL_CHECKOUT` for pickup branches, `RENTAL_RETURN` for return/custody branches) — a
   `BOOKING_VIEW`-only caller never even issues the candidate queries for a capability it lacks.
   Row keys (`B:<bookingId>` / `E:<loanItemId>` / `W:<wearReceiptId>`) are sorted, sliced by the
   opaque cursor and `pageSize`, and only the page's rows are read in full via batched queries.
   `bookingRow()` composes the safe `BOOKING_SCOPED` projection and the permission-aware
   `nextAction` (`classify()`); `custodyOnlyEquipmentRow()`/`custodyOnlyWearRow()` compose the
   minimal `CUSTODY_ONLY` projection with server-derived `taskState`/`taskAction`. This snapshot
   owns `generatedAt` and issues no `INSERT`/`UPDATE`/`DELETE`.
2. **`exceptionSnapshot()`**, only when the caller has `OPERATIONS_VIEW`, opens its own plain
   `BEGIN ISOLATION LEVEL REPEATABLE READ` connection afterward and walks `ops_list_exceptions`'s
   own `(occurredAt,id)` cursor to exhaustion, so `count`/`topSeverity` are exact, never a partial
   first page. `mergeExceptions()` merges its tally into `BOOKING_SCOPED` rows only.
   `ops_collect_exceptions` and `OperationsConsole.list()` are never called.

## 3. Transaction mode: two separate MVCC snapshots (corrected per UX5C-R01, §12)

The design document and the service's own original comment specified a literal Postgres
`BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY` transaction for the whole manifest read,
including the exception metadata. Running the real acceptance tests against Postgres 16 found
this is incompatible with also calling `ops_list_exceptions` (required by TD Clarification 2):
that function calls `ops_assert_console_store` → `ops_assert_actor`, which does
`SELECT 1 FROM auth_session ... FOR SHARE` (`0033_launch_operations.sql:48`) for its
session-liveness check. Postgres unconditionally forbids any row-locking clause inside a
`READ ONLY` transaction, regardless of the function's own privileges (`SECURITY DEFINER` does
not change this) — every call failed with SQLSTATE `25006`.

The first correction attempt dropped `READ ONLY` from the *whole* manifest transaction. UX5C-R01
correctly rejected that: the `_operations` role has real `INSERT`/`UPDATE` grants on operational
tables (§ scripts/operations-roles.ts), so a plain `REPEATABLE READ` transaction only proves
*today's code path* happens not to write — it does not keep the database-enforced boundary
against an accidental future write in this read model. The service now splits the two concerns
into two separate connections/transactions with two separate MVCC snapshots, each independently
correct for what it does:

1. **`businessSnapshot()`** — the authoritative snapshot. Runs Branch A/B/C/D + wear mirrors,
   `booking`/`hold`/`custody`/`wear`/`no-pickup` reads, the `BOOKING_SCOPED`/`CUSTODY_ONLY`
   projections and `nextAction` composition, and owns `generatedAt`, all inside
   `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY` — literal Postgres-enforced `READ ONLY`,
   restored exactly as originally authorized. It never calls `ops_list_exceptions`.
2. **`exceptionSnapshot()`** — the observational snapshot, opened only when the caller has
   `OPERATIONS_VIEW` and only after the business snapshot has committed. Runs in its own
   connection under plain `BEGIN ISOLATION LEVEL REPEATABLE READ` (not `READ ONLY`, since
   `ops_assert_actor`'s `FOR SHARE` needs that), still issues zero writes of its own, still never
   calls `ops_collect_exceptions`, and still walks `ops_list_exceptions`'s own cursor to
   exhaustion (§9). `mergeExceptions()` merges its tally into `BOOKING_SCOPED` rows only, after
   both snapshots exist — `manifest()` is the only place that ever sees both results together.

**This means the exception snapshot is, by construction, a different MVCC snapshot from the
business snapshot** — a booking/exception change that commits in the gap between the two
`pool.connect()` calls can be reflected in one snapshot and not the other. This is an accepted,
documented trade-off, not a defect: exception metadata is explicitly observational
(`0035_operations_console.sql`'s own comment, "never the authority for payment, inventory,
refund, custody or delivery") and UX5B-D04 already requires it never drive `nextAction`, which is
decided entirely inside the authoritative business snapshot before the exception snapshot ever
runs. `exceptionSnapshot()` also sets `zao.session` (not only `zao.actor`) before calling
`ops_list_exceptions`, matching the pairing every other caller of `ops_assert_actor` in this
codebase already uses (`OperationsContext.transaction()`).

## 4. Other correctness fixes found by running the acceptance tests

The local diff inherited from the prior session's `ManifestService` had four further bugs, all
caught by actually running `test:operations-manifest` against real Postgres 16 for the first time
(the prior session stopped before ever executing the suite):

- **Branch A / stale no-pickup candidacy**: the plain "pickup today" query
  (`h.occupancy_start=$date`) had no exclusion for a booking that already has a
  `rental_no_pickup_events` row. For a MULTIDAY booking, whose no-pickup completion date is
  `occupancy_end`'s date, not `occupancy_start`'s, this meant a completed booking kept
  reappearing as a stale candidate on its original start date forever, violating the design's
  "never a standing historical fact" rule for terminal completions. Fixed by excluding bookings
  with an existing no-pickup event from Branch A's plain query; Branch D (the no-pickup query)
  is unaffected and remains the only branch that surfaces the booking on its completion date.
- **`equipmentDone`/`wearDone` false positives**: both were computed as "nothing currently
  outstanding" (`outCount===0`/`wl.length` sums `===0`), which is trivially true for a booking
  that has *never* been checked out, not only for one that completed a full cycle — so a
  freshly-confirmed, never-picked-up booking was misclassified `COMPLETE`. Fixed by additionally
  requiring `loans.length>0`/`wl.length>0` (the domain was actually engaged at all).
- **`CHECKOUT` reachable after a full return cycle**: `pickup.equipmentCheckedOut` is defined
  (per the documented response field) as "currently `state='OUT'`", which — unlike wear's
  `wearCheckedOut` (a loan row that persists forever) — resets to `false` once equipment is
  returned. `classify()`'s `CHECKOUT` branch used that same flag to mean "never checked out yet",
  so an already-returned-and-inspected booking was routed back to `CHECKOUT` instead of
  `COMPLETE`. Fixed with a separate `equipmentEverCheckedOut` (`loans.length>0`) signal used only
  for `CHECKOUT` eligibility, never in the response body.

None of these fixes change the documented response schema, the permission matrix, the cursor
format, or the branch SQL predicates beyond the one Branch A exclusion above.

## 5. Test-fixture bugs found and fixed (never previously executed)

`tests/operations/manifest.ts` also had several bugs of its own, all latent because the suite had
never been run to completion before this session:

- Granting `OPERATIONS_VIEW` directly to the shared fixture actor (`x.actor`) via a raw
  `staff_permission_overrides` insert bumped that staff row's `revision`
  (`staff_permission_audit` trigger, `0003_staff_auth.sql:85`), invalidating the principal
  already captured inside `x.holds`/`x.quotes`/`x.service` and failing every later
  `x.draft()` booking-actor authorization with a stale-revision `403`. Fixed by giving the
  "full capability" principal its own dedicated account instead.
- A clock/window mismatch: `custody.checkout()` requires `rental_validate_loan`'s own
  08:30–17:00 JST handover window (`0016_delayed_pickup.sql:14`); one check exercised it at
  05:00 JST.
- Several equipment-checkout scenarios shared the fixture's single default SKI/boot/pole asset
  units (only one physical unit each) while also leaving items checked out or received-but-
  uninspected forever, permanently exhausting that stock for every later test via
  `rental_inventory_blocks`' `OVERDUE_OUT`/inspection-pending branches
  (`0033_launch_operations.sql:125`). Fixed by using the recommendation fixture's distinct
  length-variant assets for scenarios that intentionally never complete a cycle, and by having
  scenarios that don't need to demonstrate an uninspected state actually inspect their equipment.
- A recommendation input mismatch (missing `poleVariantId`, and an unintended
  `wearSelection` bundle on a SKI member that needed a second wear-pool unit which wasn't
  available); a WEAR_SET's two separate `wear_loans` rows (jacket + pants) with only one
  received, leaving the booking genuinely still outstanding; a mismatched `bookingId`/date
  in one wear-care assertion block; a raw `wear_receipts` state mutation missing the
  `zao.actor`/`zao.reason` audit context `wear_guard()` requires
  (`0013_wear_quantity.sql:38`); an ambiguous `$1` parameter type across a uuid column and an
  explicit `::text` cast in one raw exception-seeding query; and one final scenario requesting a
  hold for a date that had already passed relative to the server clock advanced by earlier
  checks in the same run.

None of these fixture fixes touch service code; they are confined to `tests/operations/manifest.ts`.

## 6. API contract (implemented, matches design §5)

`GET /api/operations/manifest?store&date?&section?&cursor?&pageSize?`

- `401` unauthenticated, `403` wrong permission/store, `422` invalid `store`/`date`/`section`/
  `cursor`/`pageSize` or an unknown query key.
- Response: `{store,date,section,generatedAt,pageSize,nextCursor,hasMore,rows}`.
- `rows[].rowKind` is `BOOKING_SCOPED` (full projection, `key:"B:<bookingId>"`) or `CUSTODY_ONLY`
  (minimal projection, `key:"E:<loanItemId>"`/`"W:<wearReceiptId>"`, no `bookingId`/`displayName`/
  `totalJpy`/`period`/`bookingState`/`nextAction`, plus server-derived `taskState`/`taskAction`).
- Cursor: opaque base64url `{v,store,date,section,lastKey}`; a store/date/section mismatch or
  malformed cursor is `422` on every request, first page or continuation.

## 7. Permission matrix (implemented, matches design §4/§7.3)

| Composition | Behavior |
| --- | --- |
| none of the above | `403` |
| `BOOKING_VIEW` only | booking/period facts only; `pickup`/`return`/`exception` omitted; `nextAction` limited to `CHECK_PAYMENT_OR_EXCEPTION`(state-only)/`NO_ACTION` |
| `+ RENTAL_CHECKOUT` | adds `pickup`, `PREPARE_EQUIPMENT`/`CHECKOUT`, and the `transfer_attention`-triggered half of `CHECK_PAYMENT_OR_EXCEPTION` |
| `+ RENTAL_RETURN` | adds `return`, `RECEIVE_RETURN`/`INSPECTION_PENDING`/`WEAR_CARE_IN_PROGRESS`/`OUT_WAIT_RETURN`/`NEEDS_DETAIL_REVIEW` |
| `+ OPERATIONS_VIEW` | adds `exception` (never changes `nextAction`) |
| both `RENTAL_CHECKOUT`+`RENTAL_RETURN` | full class table, `COMPLETE` reachable |

Candidate branches themselves are skipped (not filtered after the fact) when the composed
capability is absent, verified by the `BOOKING_VIEW`-only test asserting an empty `rows: []`.

## 8. Zero-mutation and REPEATABLE READ evidence

- `test:operations-manifest`'s "a generic unrelated exception..." case snapshots every business
  and `ops_exceptions` table before and after a `full.manifest()` call and asserts an exact
  `deepEqual` — PASS. This covers both snapshots: the business connection and the exception
  connection each issue only `SELECT`s.
- The suite reports `{"businessMutations":0,"providerCalls":0,"hostedDb":0}` on its final line.
- A dedicated case holds a `REPEATABLE READ READ ONLY` transaction open on the business snapshot's
  connection, performs a concurrent booking creation on a separate connection, and asserts the
  held transaction's own `rental_bookings` count is unaffected — PASS. Because the business
  snapshot is Postgres-enforced `READ ONLY`, an accidental future `INSERT`/`UPDATE`/`DELETE` added
  to `businessSnapshot()`/`read()`/`bookingRow()`/`candidateKeys()` would fail at the database
  level with SQLSTATE `25006`, not merely happen to be absent from today's code path.

## 9. Exception full-page aggregation evidence

A dedicated case seeds 60 additional `ops_exceptions` rows (exceeding `ops_list_exceptions`'s own
51-row page) against one booking and asserts the manifest's `exception.count>=61` (not a
truncated ~51) and `topSeverity==='ERROR'` — PASS, proving `exceptionSnapshot()` walks the
function's own cursor to exhaustion inside its own read-write-capable-but-zero-write transaction,
independently of the business snapshot, rather than reporting a partial page.

## 10. Test results

`npm run test:operations-manifest` now runs two files and is **29/29 PASS**:

- `tests/operations/manifest.ts` (`ManifestService` direct, real PostgreSQL) — **17/17 PASS**,
  covering: auth/permission/store failure modes (including two impossible-but-well-shaped dates,
  §12 UX5C-R03); server `inventory_clock()`-derived date; BOOKING_VIEW-only row suppression;
  permission composition response shapes; PREPARE_EQUIPMENT/CHECKOUT/OUT_WAIT_RETURN/
  RECEIVE_RETURN (equipment-only, wear-only, mixed) per TD Clarification 1; MULTIDAY no-pickup
  Branch D; same-day receipt+inspection COMPLETE with no standing later-day row;
  inspection-pending carry-over; wear RETURNED_PENDING/CLEANING/UNAVAILABLE→NEEDS_DETAIL_REVIEW
  semantics; cross-store BOOKING_SCOPED vs CUSTODY_ONLY with the forbidden-field assertion and
  server-derived `taskState`/`taskAction`; store-wide two-staff task visibility; generic-exception
  non-interference and zero-mutation; exact exception aggregation past one page; full-set cursor
  pagination with cross-context `422`; REPEATABLE READ isolation under a concurrent mutation.
- `tests/operations/manifest-http.ts` (real `operationsHandler`, real PostgreSQL, real better-auth
  session, no live server/port — §12 UX5C-R02) — **12/12 PASS**: authorized GET success with
  `Cache-Control: private, no-store` / `Vary: Cookie`; anonymous → `401`; missing permission →
  `403`; wrong store → `403`; unknown query key → `422`; two impossible calendar dates → `422`;
  invalid `pageSize`/`cursor` → `422`; cursor context mismatch → `422` through HTTP;
  `x-zao-session` mismatch → `409`; `POST /manifest` → `404` (not a mutation surface).

Regression suite: `npm run lint` PASS, `npm run typecheck` PASS, `npm run build` PASS,
`npm run check:secrets` PASS, `npm run test:operations-console` PASS, `npm run test:custody`
PASS, `npm run test:wear` PASS.

`npm run test:auth` and `npm run test:staff-home-ui` were **not run locally**: both require
`startDevelopmentApp`, which binds a single deterministic web port derived from this worktree's
absolute path (`scripts/worktree.ts`'s `worktreeIdentity()`); that port was already held by this
worktree's long-running maintained UI review server (`.local/ui-review/server.ts`, verified by
process ancestry and cwd, not stopped). This diff touches no auth or Staff Home code, so there is
no plausible mechanism for a regression in either suite from this change. TD comment `5751235980`
independently confirmed both suites actually ran in Foundation CI `35522463886` at the prior
candidate HEAD (`test:auth` 18 checks, `test:staff-home-ui` 7/7) and are not an outstanding gap;
Foundation CI at the corrected HEAD (recorded in the PR submission comment) covers them again.

## 11. Boundaries confirmed unchanged

`git diff --stat` against base `a94af58` (tracked files): `apps/web/src/lib/operations-http.ts`
(+2/-2, the one GET branch and allowlist entry), `package.json` (+2: `test:operations-manifest`
now chains the new HTTP test), `scripts/verify.mjs` (+1: `test:operations-manifest` added to the
Foundation CI command list, §12 UX5C-R04). New files: `packages/core/src/operations/manifest-service.ts`,
`tests/operations/manifest.ts`, `tests/operations/manifest-http.ts`, and this document. No file
under `packages/db/migrations`, `scripts/operations-roles.ts`, Staff Home
(`apps/web/src/app/staff/**`, `apps/web/src/components/StaffHome.tsx`), or any
payment/HOLD/pricing/Square code was touched.

## 12. Corrections applied in response to TD REQUEST_CHANGES (comment `5751235980`)

Reviewed candidate HEAD `2d3d2a8` / submission `5751199806`. Verified-good findings (Branch
A/B/C/D + wear mirror gating, `BOOKING_SCOPED`/`CUSTODY_ONLY` conservatism, `CUSTODY_ONLY`
`taskState`/`taskAction`, domain-aware checkout/return classification, no `ops_collect_exceptions`/
`OperationsConsole.list()` calls, exception aggregation past 51 rows, context-bound cursor,
Foundation CI `35522463886` SUCCESS including `test:auth`/`test:staff-home-ui`) required no
change and are preserved exactly. Four corrections were required before Staff Home integration:

- **UX5C-R01 (HIGH)** — restored literal Postgres `READ ONLY` enforcement for the authoritative
  business snapshot by splitting it from the observational exception snapshot into two
  connections/transactions (§3). The exception snapshot's own zero-mutation and full-cursor-walk
  behavior (§8/§9) is unchanged; it just no longer shares a transaction with the business read.
- **UX5C-R02 (MEDIUM)** — added `tests/operations/manifest-http.ts`, a real-PostgreSQL test of
  the actual `GET /api/operations/manifest` route through `operationsHandler` (no live HTTP
  server/port — the same in-process `Request`-object pattern `tests/flow/fixture.ts`'s own
  `login()` already uses for `authHandler`), covering every status/header case UX5C-R02 asked for
  (§10).
- **UX5C-R03 (MEDIUM)** — `isCalendarDate()` now reuses `packages/contracts/src/hold.ts`'s
  existing `utcDate()` round-trip validator (regex shape + `Date.parse` + re-serialize) instead of
  regex shape alone, so `2035-02-31`/`2035-02-29` (non-leap) are rejected `422` before `$2::date`
  ever reaches Branch SQL. Added at both the service level (`tests/operations/manifest.ts`) and
  the HTTP level (`tests/operations/manifest-http.ts`).
- **UX5C-R04 (MEDIUM)** — added `'test:operations-manifest'` to `scripts/verify.mjs`'s fixed
  command list, next to the other operations server suites (`test:operations-console`,
  `test:operations-console-ui`), so Foundation CI (`npm run verify`) runs it on every future
  commit. Confirmed by inspecting the corrected-HEAD Foundation CI log for the actual
  `npm run test:operations-manifest` invocation and its `29/29 PASS` output (recorded in the PR
  submission comment).

No schema/migration/index/GRANT/auth-permission change; no Staff Home wiring; no Production/main
activity in any of the four corrections.
