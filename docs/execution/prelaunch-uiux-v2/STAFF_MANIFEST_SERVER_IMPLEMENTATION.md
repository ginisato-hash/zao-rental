# UX-5C — Staff Manifest server implementation evidence

Authority: PR #26 comment [`5749991741`](https://github.com/ginisato-hash/zao-rental/pull/26#issuecomment-5749991741)
(Technical Director — UX-5B DESIGN PASS / server implementation authorization).
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
then opens one `BEGIN ISOLATION LEVEL REPEATABLE READ` transaction per page and calls `read()`:

1. `candidateKeys()` — Branch A (pickup today / no-pickup completion day), Branch B/B-wear
   (equipment/wear return due today), Branch C/C-wear (actual-store receipt, current or
   carry-over pending). Each candidate branch is gated by the composed capability
   (`RENTAL_CHECKOUT` for pickup branches, `RENTAL_RETURN` for return/custody branches) —
   a `BOOKING_VIEW`-only caller never even issues the candidate queries for a capability it lacks.
2. Row keys (`B:<bookingId>` / `E:<loanItemId>` / `W:<wearReceiptId>`) are sorted, sliced by the
   opaque cursor and `pageSize`, and only the page's rows are read in full via batched queries.
3. `bookingRow()` composes the safe `BOOKING_SCOPED` projection and the permission-aware
   `nextAction` (`classify()`); `custodyOnlyEquipmentRow()`/`custodyOnlyWearRow()` compose the
   minimal `CUSTODY_ONLY` projection with server-derived `taskState`/`taskAction`.
4. Exception metadata (`exceptions()`) walks `ops_list_exceptions`'s own `(occurredAt,id)` cursor
   to exhaustion inside the same transaction, so `count`/`topSeverity` are exact, never a partial
   first page. `ops_collect_exceptions` and `OperationsConsole.list()` are never called.

## 3. A load-bearing correction to the design's transaction mode

The design document and the service's own original comment specified a literal Postgres
`BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY` transaction. Running the real acceptance
tests against Postgres 16 found this is incompatible with also calling `ops_list_exceptions`
(required by TD Clarification 2): that function calls `ops_assert_console_store` →
`ops_assert_actor`, which does `SELECT 1 FROM auth_session ... FOR SHARE`
(`0033_launch_operations.sql:48`) for its session-liveness check. Postgres unconditionally
forbids any row-locking clause inside a `READ ONLY` transaction, regardless of the function's
own privileges (`SECURITY DEFINER` does not change this) — every call to the manifest's
`exceptions()` method failed with SQLSTATE `25006`.

The transaction now uses `BEGIN ISOLATION LEVEL REPEATABLE READ` (isolation only, not the
literal `READ ONLY` mode). This still gives the one-snapshot-per-page consistency guarantee
`STAFF_MANIFEST_DESIGN.md` §9.4/§9.5 requires; the manifest itself issues no `INSERT`/`UPDATE`/
`DELETE` anywhere, which is what "read-only" means for the zero-mutation acceptance test (§7
below) and for the endpoint's own contract — it is not the same thing as the database enforcing
it via the `READ ONLY` transaction flag. `exceptions()` also had to set `zao.session` (not only
`zao.actor`) before calling `ops_list_exceptions`, matching the pairing every other caller of
`ops_assert_actor` in this codebase already uses (`OperationsContext.transaction()`).

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
  `deepEqual` — PASS.
- The suite reports `{"businessMutations":0,"providerCalls":0,"hostedDb":0}` on its final line.
- A dedicated case holds a `REPEATABLE READ` transaction open, performs a concurrent booking
  creation on a separate connection, and asserts the held transaction's own `rental_bookings`
  count is unaffected — PASS.

## 9. Exception full-page aggregation evidence

A dedicated case seeds 60 additional `ops_exceptions` rows (exceeding `ops_list_exceptions`'s own
51-row page) against one booking and asserts the manifest's `exception.count>=61` (not a
truncated ~51) and `topSeverity==='ERROR'` — PASS, proving `exceptions()` walks the function's own
cursor to exhaustion inside the one read-only transaction rather than reporting a partial page.

## 10. Test results

`npm run test:operations-manifest` — **17/17 PASS**, covering: auth/permission/store failure
modes; server `inventory_clock()`-derived date; BOOKING_VIEW-only row suppression; permission
composition response shapes; PREPARE_EQUIPMENT/CHECKOUT/OUT_WAIT_RETURN/RECEIVE_RETURN
(equipment-only, wear-only, mixed) per TD Clarification 1; MULTIDAY no-pickup Branch D; same-day
receipt+inspection COMPLETE with no standing later-day row; inspection-pending carry-over;
wear RETURNED_PENDING/CLEANING/UNAVAILABLE→NEEDS_DETAIL_REVIEW semantics; cross-store
BOOKING_SCOPED vs CUSTODY_ONLY with the forbidden-field assertion and server-derived
`taskState`/`taskAction`; store-wide two-staff task visibility; generic-exception
non-interference and zero-mutation; exact exception aggregation past one page; full-set cursor
pagination with cross-context `422`; REPEATABLE READ isolation under a concurrent mutation.

Regression suite: `npm run lint` PASS, `npm run typecheck` PASS, `npm run build` PASS,
`npm run check:secrets` PASS, `npm run test:operations-console` PASS, `npm run test:custody`
PASS, `npm run test:wear` PASS.

`npm run test:auth` and `npm run test:staff-home-ui` were **not run**: both require
`startDevelopmentApp`, which binds a single deterministic web port derived from this worktree's
absolute path (`scripts/worktree.ts`'s `worktreeIdentity()`); that port was already held by this
worktree's long-running maintained UI review server (`.local/ui-review/server.ts`, verified by
process ancestry and cwd, not stopped). This diff touches no auth or Staff Home code
(`git diff --stat` is limited to `apps/web/src/lib/operations-http.ts`, `package.json`, and the
two new manifest files), so there is no plausible mechanism for a regression in either suite from
this change; the gap is an environmental scheduling conflict, not evidence of a passing or
failing state.

## 11. Boundaries confirmed unchanged

`git diff --stat` (tracked files): `apps/web/src/lib/operations-http.ts` (+2/-2, the one GET
branch and allowlist entry), `package.json` (+1, the new test script). New files:
`packages/core/src/operations/manifest-service.ts`, `tests/operations/manifest.ts`, and this
document. No file under `packages/db/migrations`, `scripts/operations-roles.ts`, Staff Home
(`apps/web/src/app/staff/**`, `apps/web/src/components/StaffHome.tsx`), or any
payment/HOLD/pricing/Square code was touched.
