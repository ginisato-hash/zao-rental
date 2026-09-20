# UX-5B — Staff Daily Manifest — design (DESIGN_GATE, no implementation)

Authority: PR #26 comment [`5748592542`](https://github.com/ginisato-hash/zao-rental/pull/26#issuecomment-5748592542)
(Technical Director — UX-5A PASS at HEAD `25c678e`; UX-5B Daily Manifest design authorization).

**Correction batch 1**: closed [comment `5748832358`](https://github.com/ginisato-hash/zao-rental/pull/26#issuecomment-5748832358)
(REQUEST_CHANGES — design only; findings UX5B-D01 through UX5B-D07).

**Correction batch 2**: closes [comment `5749532490`](https://github.com/ginisato-hash/zao-rental/pull/26#issuecomment-5749532490)
(REQUEST_CHANGES — design only; findings UX5B-R01 through UX5B-R05, re-reviewing candidate HEAD
`8f0ac9a`/submission `5749506864`). D02 and D04 were reconfirmed accepted by that review; R01-R05
are addressed in place below. This is the same document throughout, corrected in place each time,
never restarted.

This document is design/research only. No schema, migration, endpoint or Staff Home change is
made in this phase. Every field below was read directly from the migration or service source
cited next to it; nothing about current schema/behavior is inferred. Anything that cannot be
derived this way is marked **`NEEDS_DETAIL_REVIEW`** rather than guessed.

## 1. Goal

One read-only, permission/store-scoped Staff Daily Manifest covering, for a given store and date:
pickups starting/due today, returns due today, preparation state, checked-out state, actual
receipt state, inspection state, relevant exceptions, and one server-derived display next-action
classification — without any client-side inference of workflow state.

## 2. Source-of-truth mapping

Every fact below is a stored column or an existing derived view/function; the manifest may only
read these, never introduce a new canonical state.

### 2.1 `rental_bookings` (`packages/db/migrations/0009_development_booking.sql:9`)

| Field | Type | Note |
| --- | --- | --- |
| `id` | uuid PK | = `inventory_reservations.id`; canonical booking id |
| `owner_id` | text | creating staff actor, not the assigned pickup/return staff |
| `hold_id` | uuid UNIQUE | 1:1 to `inventory_holds` |
| `conditions` | jsonb | `HoldConditions`: `period{startDate,endDate,slot}`, `members[]`, `pickupStore`, `returnStore` |
| `price_snapshot` | jsonb | `totalJpy`, `chargeReady` (always `false` per `CHECK`), etc. |
| `contact` | jsonb | `displayName`/`email`; email must stay out of the manifest response (§8) |
| `mode` | text | `'SIMULATED_DEV'` only today (`CHECK`) |
| `state` | text | `DRAFT`\|`PAYMENT_PENDING`\|`PAYMENT_REVIEW`\|`CONFIRMED_DEV`\|`COMPLETED_DEV`; `CHECK((state IN ('CONFIRMED_DEV','COMPLETED_DEV'))=(confirmed_at IS NOT NULL))` |
| `version` | integer | optimistic lock, unrelated to manifest reads (read-only) |

**Important, and load-bearing for §7**: `rental_bookings.state` only ever reaches `COMPLETED_DEV`
via `rental_complete_no_pickup` (`0017_no_pickup_completion.sql:27`). A booking that is picked up,
fully returned, and fully inspected through the *normal* path stays `CONFIRMED_DEV` forever —
`state` alone cannot distinguish "ongoing" from "normally completed." Completion for a normally
returned booking is a **derived** fact (§7), never read off `state`.

No index beyond the PK and the two `UNIQUE` FKs (`hold_id`, `quote_id`) and
`UNIQUE(owner_id,request_key)`. **No index exists on `conditions->>'pickupStore'`,
`conditions->>'returnStore'` or any period field.** `BookingService.list()`
(`packages/core/src/payment/booking-service.ts:31`) already does a full-table
`conditions->>'pickupStore'=ANY($1) OR conditions->>'returnStore'=ANY($1)` scan today; this is
existing behavior, not new — see §9 for the index question, marked DESIGN_GATE, not authorized here.

### 2.2 `inventory_holds` (`packages/db/migrations/0004_period_hold.sql:8`)

| Field | Type | Note |
| --- | --- | --- |
| `pickup_store`, `return_store` | text (real columns, not JSON) | `REFERENCES ledger_stores(id)` |
| `starts_at`, `due_at` | timestamptz | exact handover/return cutoffs, see §3 |
| `occupancy_start`, `occupancy_end` | date | JST calendar dates the hold physically occupies |
| `occupancy_policy` | text | `'WHOLE_TOKYO_DATE_V1'` (`CHECK`, only value today) |
| `state` | text | `ACTIVE`\|`RELEASED`\|`EXPIRED` |
| `payment_state` | text | `NONE`\|`PENDING`\|`UNKNOWN`\|`SUCCESS`\|`FAILURE` |
| `allocation_stage` | text | `PROVISIONAL`\|`PREPARATION_FIXED`\|`RENTAL_FIXED` — the authoritative pickup-progress fact |
| `transfer_attention` | text/null | non-null blocks pickup (`CUSTODY_RECONCILIATION_REQUIRED`, etc.) — a **canonical** booking-level exception fact, not a generic `ops_exceptions` row (§7). |
| `confirmed_at` | timestamptz/null (added `0009`) | non-null once payment succeeded |
| `version` | integer | read-only here |

Index: `inventory_holds_owner_idx(owner_id,created_at DESC,id)` only. **No index on
`pickup_store`/`return_store`/`occupancy_start`/`occupancy_end`.**

### 2.3 `rental_preparations` (`0010_rental_custody.sql:2`)

PK is `id = booking_id` (1:1, O(1) lookup by booking id — no join fan-out risk). Fields:
`store_id`, `checked_in_at/by`, `prepared_at`/`prepared_by` (both null until prepared — that pair
is the sole "prepared" fact), `fit_evidence` jsonb, `version`.

### 2.4 `rental_loan_items` (`0010_rental_custody.sql:3`, altered `0033_launch_operations.sql:105`)

One row per requirement key per checkout attempt. `state IN ('OUT','RECEIVED')`; the partial
unique index `rental_active_requirement(booking_id,requirement_key) WHERE state='OUT'`
(`0033:109`) guarantees at most one currently-`OUT` row per requirement key even across the
`amendment_id` exchange path added in `0033` — **the manifest never needs amendment-aware
branching; `state='OUT'`/`'RECEIVED'` remains the single source of truth regardless of whether
the row originated from the initial checkout or an amendment exchange.** Also carries
`due_at` (exact return cutoff for that specific item) and `pickup_store`.

**Correction (UX5B-D01)**: a row moving from `OUT` to `RECEIVED` (via `rental_apply_receipt`,
`0015_custody_boundary.sql:66`) is exactly the transition from "return due" to "inspection
pending." A candidate-selection query that only looks at `state='OUT'` rows due today therefore
*loses* the row the instant it is received — the manifest must read `rental_loan_items`
regardless of `state`, and treat `state`/receipt/inspection presence as three independent facts
composed in application code, not as a single filtered candidate set. See §9.1's corrected branches.

Index: `rental_one_active_asset(asset_id) WHERE state='OUT'` (uniqueness, not a lookup aid for
this query shape), `rental_active_requirement`/`rental_initial_requirement`/
`rental_amended_requirement` (all keyed by `booking_id` or `amendment_id`, not by store/date).
**No index on `due_at` or `pickup_store` alone.**

### 2.5 `rental_no_pickup_events` (`0017_no_pickup_completion.sql:6`)

PK = `booking_id`. `outcome='NO_PICKUP_COMPLETED'` (only value), `due_at`, `completed_at`. Presence
of a row is the sole terminal "never picked up" fact; `rental_bookings.state` is separately moved
to `COMPLETED_DEV` by the same transaction (`0017:27`), so either fact alone is sufficient and
they cannot disagree by construction. Visibility gated by `RENTAL_CHECKOUT` (§4) — this table is
written only by the checkout-family `rental_complete_no_pickup` function.

### 2.6 Receipt / custody: `rental_receipts` + `rental_custody_events` (`0010:15`, `0015_custody_boundary.sql:11`)

`rental_receipts` is the raw scan/confirm record; `rental_custody_events` is the *applied* (import
committed) fact, one row per `loan_item_id` (`UNIQUE`), carrying `source_store`, **`actual_store`**,
`applied_at`.

**Correction (UX5B-D02)**: `rental_apply_receipt` (`0015:34`) never requires
`actual_store = the booking's planned returnStore` — a receipt can be, and in the existing schema
is explicitly allowed to be, received at a different store than planned (`CROSS_STORE_REINTEGRATION_REQUIRED`
is a *ledger*-side follow-up concern, not a block on receiving). The manifest must therefore
attribute inspection/receipt work to `rental_custody_events.actual_store`, never to the booking's
planned `returnStore`. See §9.1's Branch C.

**Correction (UX5B-R01)**: `applied_at` (the exact receipt-application instant) is what lets Branch
C distinguish "received on this manifest date" from "received on an earlier date and still
carrying over." Without also matching on `applied_at`'s JST date, a booking whose inspection
completes on the same day it was received has no candidate branch left at all the moment
inspection finishes (Branch B drops it once `state<>'OUT'`; the pre-R01 Branch C dropped it once
inspection existed) — see §9.1 Branch C's corrected predicate.

### 2.7 Inspection: `rental_inspections` + `rental_inspection_events` (`0010:16`, `0015:12`)

Same split: `rental_inspections` is the raw record, `rental_inspection_events` (`inspection_id`
PK, `loan_item_id` `UNIQUE`) is the applied fact. Presence of an event row for a `loan_item_id` is
the sole "inspection complete" signal, exactly as `CustodyService.returns()` already reads it via
`LEFT JOIN rental_inspection_events i ON i.loan_item_id=l.id ... i.inspection_id`.

### 2.8 Operations exceptions: `ops_exceptions` (`0035_operations_console.sql:11`)

Read via `ops_list_exceptions(...)` (`0035:85`) — **this function is a pure `SELECT`, no write**.
Rows are populated/refreshed by `ops_collect_exceptions(store)` (`0035:58`, `INSERT ... ON
CONFLICT DO NOTHING`), an existing mutating function called today by `OperationsConsole.list()`
whenever any staff member loads `/admin/ops` (`packages/core/src/operations/console-service.ts:18`).

**Correction (UX5B-R03)**: the manifest itself never calls `ops_collect_exceptions`, in any
transaction, inside or outside its own request. It reads only the already-collected
`ops_list_exceptions` projection — a **snapshot of whatever the existing `/admin/ops` collection
path last observed**, not a forced fresh collection. See §5.4/§9.2.

Carries `booking_id`/`asset_id` (nullable — not every exception ties to one booking), `store_id`,
`severity`, `status`, `occurred_at`. Index: `ops_exception_recent(store_id, occurred_at DESC,id
DESC)`. **No index on `booking_id`** — see §9.
See §5.4/§7 (UX5B-D04, UX5B-R03) for how this composes with the manifest's read-only transaction
and next-action classification.

### 2.9 Existing service/authorization surface reused as-is

- `BookingService.authorize(permission, stores)` (`booking-service.ts:18`) — requires
  `BOOKING_VIEW` **and** the given `permission`, and that every `stores` entry is in
  `principal.storeIds`. The manifest's authorization must compose the same way (§4).
- `BookingService.list()` (`booking-service.ts:31`) — existing store/permission-scoped booking
  read; the manifest's booking half is a superset of this query, not a replacement.
- `CustodyService.returns(store)` (`custody-service.ts:95`) — **scoped by
  `owner_id=this.identity.subject`, i.e. the calling staff member's own saved return batches,
  not every batch at that store.** A manifest that shows *all* staff's return activity at a store
  would be a new scope decision beyond what's authorized today. `NEEDS_DETAIL_REVIEW`: whether
  UX-5B's return section stays per-actor (matching today) or becomes store-wide (a policy change
  requiring separate TD sign-off, not assumed here). This does not affect §9.1's Branches B/C,
  which read `rental_loan_items`/`rental_custody_events` directly (store-scoped, not actor-scoped)
  rather than reusing `returns()`'s actor-scoped batch list.
- `OperationsConsole.list()` (`packages/core/src/operations/console-service.ts:18`) — requires
  `OPERATIONS_VIEW`, calls `ops_collect_exceptions` then `ops_list_exceptions`; SYSTEM scope
  requires `principal.scope==='ALL'`. Per UX5B-R03 (§5.4), the manifest **never calls this method
  and never calls `ops_collect_exceptions` itself, in any transaction**; it reads only
  `ops_list_exceptions`, the existing pure-`SELECT` projection, as a snapshot of whatever
  `OperationsConsole.list()` (or any other caller of `ops_collect_exceptions`) last collected.
  Collection stays exclusively that existing path's responsibility.
- `BookingService.get()` (`booking-service.ts:30`) already opens
  `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY` for a single-booking read — this is the
  existing project pattern for consistent read-only transactions and is the one proposed for the
  manifest (§9.4), not a new mechanism.
- `pickupTiming(period, now)` (`packages/contracts/src/pickup.ts`) — an existing **pure,
  display-only** classifier (`RETURN_DUE_PASSED` / `OUTSIDE_HANDOVER_WINDOW` /
  `LATE_PICKUP_ELIGIBLE` / `PICKUP_WINDOW`) computed only from `period` and `now`, already used by
  `CustodyService.checkoutView`. This is the direct prior art for §7's next-action classification
  and should be reused/extended, not reinvented.

### 2.10 Wear (UX5B-D03): `WearService` + `wear_loans`/`wear_receipts`/`wear_pools` (`0013_wear_quantity.sql`)

`rental_loan_items.family` explicitly excludes `WEAR_JACKET`/`WEAR_PANTS`
(`0010_rental_custody.sql:6`'s `CHECK`); wear has its own, structurally different, quantity-pool
model that a "complete" manifest cannot ignore — `rental_complete_no_pickup`
(`0017:22`) itself already requires `NOT EXISTS(SELECT 1 FROM wear_loans WHERE booking_id=b.id)`
before allowing no-pickup completion, proving wear is already part of contract completion today.

| Table | Key fields | Note |
| --- | --- | --- |
| `wear_loans` (`0013:14`) | `booking_id`, `member_key`, `requirement_key` (`UNIQUE(booking_id,requirement_key)`), `quantity`, `returned` (cumulative, `0<=returned<=quantity` — **partial return is representable**), `planned_pickup_store`, `planned_return_store`, `checked_out_at` | **No `due_at` column.** Wear's due date is the booking's `conditions.period.endDate` (booking-level), not a per-item date like equipment. |
| `wear_receipts` (`0013:20`) | `loan_id`, `quantity`, `actual_store`, `received_at`, `state IN ('RETURNED_PENDING','CLEANING','TODAY_BLOCKED','READY','UNAVAILABLE')` | `state='READY'` is wear's analogue of equipment's "inspected"; the other four states are **not interchangeable** — see the UX5B-R02 correction below. |
| `wear_pools` | store/variant quantity pools | Not booking-scoped; irrelevant to a per-booking manifest row. |

**Correction (UX5B-R02)**: the four non-`READY` `wear_receipts` states have distinct operational
meanings and must not all be surfaced to staff as one "inspection pending" signal:
- `RETURNED_PENDING` — care/cleaning has not started yet;
- `CLEANING` — cleaning in progress;
- `TODAY_BLOCKED` — cleaning is done but the same-day-reuse block (`wear_guard`'s
  `eligible_on`/`ready_at` handling, `packages/core/src/wear/service.ts`'s `cleaning()`) still
  applies;
- `UNAVAILABLE` — not a normal pending-care state; this codebase does not establish a single safe
  staff action for it from the manifest's read-only vantage point.

None of `RETURNED_PENDING`/`CLEANING`/`TODAY_BLOCKED` means "go inspect this" the way equipment's
missing `rental_inspection_events` row does — cleaning is a backend/laundry workflow, not a
front-desk action. See §6/§7.1 for the response fields and next-action classes this produces.

Relevant `WearService` (`packages/core/src/wear/service.ts`) reads, as actually authorized today:
- `loans(bookingId, receivingStore)` (`:33`) — requires `BOOKING_VIEW` **and `RENTAL_RETURN`**
  (not `RENTAL_CHECKOUT`) even to view a booking's wear loans.
- `bookingSummary(bookingId, receivingStore)` (`:34`) — requires `BOOKING_VIEW` plus **either**
  `RENTAL_RETURN` or `RENTAL_CHECKOUT` (`p.permissions.includes('RENTAL_RETURN')||...includes('RENTAL_CHECKOUT')`),
  and separately computes `canCheckout`/`canReturn` booleans.
- `checkout(...)` (`:54`) — `RENTAL_CHECKOUT`, mirroring equipment.
- `receive(...)` (`:66`) — `RENTAL_RETURN`, mirroring equipment.

**Manifest design decision**: for consistency with §4's equipment composition (and because the
manifest is a read surface, not `bookingSummary`'s own endpoint), wear pickup-side facts follow
the same `RENTAL_CHECKOUT` gate as equipment pickup, and wear return-side facts follow the same
`RENTAL_RETURN` gate as equipment return — matching what `loans()` already hard-requires for the
return half. A row's `wear` sub-object (§6) is included under those same composed capabilities,
never a third, separate permission rule.

**Manifest design decision (completion, unchanged by this correction)**: `nextAction` may never
classify as `COMPLETE` (§7) while a booking has any `wear_loans` row with `returned < quantity`,
or any associated `wear_receipts` row not in state `READY` — `RETURNED_PENDING`/`CLEANING`/
`TODAY_BLOCKED`/`UNAVAILABLE` all still block `COMPLETE` identically; UX5B-R02 only changes which
**class** the manifest surfaces while blocked (§7.1), never whether `COMPLETE` is reachable. This
directly extends `rental_complete_no_pickup`'s own existing wear check to the *normal* return
path, which today has no equivalent enforcement at the booking-state level (§2.1) — the
manifest's derived completion fact is exactly the gap that enforcement doesn't cover, not a new
business rule.

**Manifest design decision (checkout ordering, UX5B-R02)**: equipment and wear checkout are two
independent mutations (`rental_validate_loan`'s `INSERT` trigger vs. `WearService.checkout`), so a
booking can legitimately have either domain checked out first. The manifest's pickup facts (§6)
must expose `equipmentRequired`/`equipmentPrepared`/`equipmentCheckedOut` and
`wearRequired`/`wearCheckedOut` as independent booleans rather than folding wear into a single
`prepared`/`checkedOut` pair, so §7's classification can require "prepared, if equipment is
required" without conflating it with "every required domain checked out" (§7.1).

## 3. JST date/time contract

**The manifest's "today" must come from `inventory_clock()`, never `Date.now()` in the browser or
in Node.** Every existing business-date decision in this codebase — HOLD expiry/occupancy,
`ops_collect_exceptions`, `rental_apply_receipt`, `rental_validate_loan`'s checkout-window check —
reads `inventory_clock()` (`SELECT clock_timestamp()` by default,
`packages/db/migrations/0005_store_transfer.sql:113`, and test-overridable via
`CREATE OR REPLACE FUNCTION`). A manifest keyed to browser time would silently disagree with the
server's own notion of "today" the moment a staff device's clock, timezone, or a running
synthetic-clock test differs. **This is a real, present-tense gap in the current UX-5A Staff Home
"本日" section, which does compute "today" from browser time
(`apps/web/src/components/StaffHome.tsx`, `todayJst()`); this design does not fix that — it is
called out so the manifest is not built the same way twice. Correcting UX-5A's Today section is
out of scope for this design doc and would need its own follow-up, not assumed here.**
(This same gap is why `tests/staff/home-ui.ts` needed the time-of-day fix in commit `38847e0`:
the test's own clock override had to be pinned to a safe time on the *real* JST date precisely
because Staff Home's Today filter is real-wall-clock-driven today.)

Concrete contract for the manifest specifically:
- Manifest date parameter is a plain `YYYY-MM-DD` string in Asia/Tokyo, resolved server-side as
  `(inventory_clock() AT TIME ZONE 'Asia/Tokyo')::date` when the caller omits it; the client may
  request a specific date (for "yesterday's stragglers" style staff use) but the *default* must
  never be client-supplied.
- **Pickup inclusion for date `D`**: `inventory_holds.occupancy_start = D` (arrival).
- **Return-due inclusion for date `D`**: `rental_loan_items.due_at` falls within `[D 00:00,
  D+1 00:00)` JST **and `state='OUT'`** — this branch specifically means "still owed back today,"
  not "everything ever due on `D`" (corrected scope per UX5B-D01; see §9.1 Branch B).
- **Inspection-pending carry-over (UX5B-D01, resolved; visibility corrected by UX5B-R01)**: a
  received-but-uninspected item remains visible on every later day's manifest until inspected, via
  a **separate branch keyed on `rental_custody_events.actual_store`** (§9.1 Branch C), independent
  of the original due date. It is never presented as "due today" — its manifest label is
  inspection-pending carry-over, a distinct fact from the return-due fact. **Additionally (R01)**:
  a receipt is also a Branch C candidate on the manifest date it was actually applied
  (`rental_custody_events.applied_at`'s JST date), **regardless of whether inspection has since
  completed** — otherwise a booking received and inspected on the same day has no candidate branch
  left the instant inspection finishes, and `COMPLETE` (§7) could never be emitted for it. The wear
  mirror (Branch C-wear) applies the identical rule on `wear_receipts.received_at`.
- **Midnight-crossing returns**: none exist today — every slot's `due_at` lands within normal JST
  business hours (12:00 or 17:00) per `normalizePeriod` (`packages/contracts/src/hold.ts:39`);
  there is no overnight/AM-next-day slot in the current `Period` type
  (`'AM'|'PM'|'DAY'|'MULTIDAY'`). If a future slot type crossed midnight, its inclusion rule would
  need its own review — `NEEDS_DETAIL_REVIEW` as a forward note, not a current gap.
- **Multiday ongoing rentals**: a multiday booking whose `occupancy_start < D < occupancy_end`
  (already picked up, not yet due) is neither a pickup nor a return-due row for date `D`. This
  design defaults to omitting ongoing-only rows from the manifest entirely (they need no staff
  action today) rather than adding a third bucket — `NEEDS_DETAIL_REVIEW` remains open only on
  whether a future iteration wants an explicit "currently out, nothing due" visibility bucket for
  situational awareness; it is not required by the TD's named field list ("pickups starting/due
  today," "returns due today").

## 4. Permission/store scope contract

Reuses `BookingService.authorize` exactly (`booking-service.ts:18`): a principal must have
`BOOKING_VIEW` **and** the specific capability being requested, **and** the requested store must
be in `principal.storeIds` (already `ALL`-expanded to every `ledger_stores` row by `loadStaff`,
`packages/auth/src/staff-auth.ts:33`, for `scope='ALL'` principals).

| Permission composition | Manifest behavior |
| --- | --- |
| `BOOKING_VIEW` only | Booking/period facts visible (name, period, state, store, total) — **`inventory_holds.transfer_attention` is not one of them** (it is not part of today's `BookingService.list()`/`get()` projection either). Pickup/return/wear sub-objects are **omitted from the response**, not merely hidden client-side. `nextAction` is restricted to `CHECK_PAYMENT_OR_EXCEPTION` (from `bookingState` only, never from `transfer_attention` — corrected by UX5B-R05, §7.1) or `NO_ACTION` — never a class derived from an omitted fact. |
| `BOOKING_VIEW + RENTAL_CHECKOUT` | Pickup-side facts (`equipmentRequired`/`equipmentPrepared`/`equipmentCheckedOut`, `wearRequired`/`wearCheckedOut`, pickup next-action) included. This is also the minimum composition at which `transfer_attention` may influence `nextAction` (UX5B-R05, §7.1) — it is the existing capability that already legitimately acts on pickup-blocking operational facts. Return-side facts omitted; `nextAction` never surfaces a return-derived class (§7.1). |
| `BOOKING_VIEW + RENTAL_RETURN` | Return-side facts (receipt/inspection state, wear return state) included, matching `WearService.loans()`'s own `RENTAL_RETURN` gate for the wear half. Pickup-side facts (in particular `pickup.equipmentPrepared`) omitted; `nextAction` never surfaces `PREPARE_EQUIPMENT`/`CHECKOUT`. |
| `BOOKING_VIEW` + both | Full row, full `nextAction` enum available. |
| Neither `RENTAL_CHECKOUT` nor `RENTAL_RETURN` | Same as `BOOKING_VIEW` only. |
| `OPERATIONS_VIEW` present | Exception attention flag/count/`topSeverity` included, scoped to the same store and never `SYSTEM` from this endpoint. Per UX5B-D04, this **never changes `nextAction`** — see §7.2. |
| `OPERATIONS_VIEW` absent | Exception field omitted entirely (not `null`/zeroed). |
| `ASSIGNED` scope | `store` request parameter must be one of `principal.storeIds`; any other value is `403`, identical to `BookingService.authorize`'s existing `stores.some(s=>!p.storeIds.includes(s))` check. |
| `ALL` scope | Any real store id (`MOUNTAIN_BASE`/`ONSEN_BASE`) is permitted; `SYSTEM` is never a manifest store (exceptions with `store_id='SYSTEM'` are out of scope for a per-store daily manifest by construction). |

No row may ever be returned for a store outside `principal.storeIds`, at the SQL predicate level,
never filtered after the fact in application code and never simply hidden by the client.

## 5. Proposed read-only API contract (not implemented)

- **Method/path**: `GET /api/operations/manifest` — reusing the existing `/api/operations`
  route's session/permission plumbing (`apps/web/src/lib/operations-http.ts`).
- **Query**: `store` (required, one of `principal.storeIds`), `date` (optional `YYYY-MM-DD`,
  defaults per §3), `section` (optional `pickup`\|`return`\|`all`, default `all` — a candidate-set
  **filter**, not a pagination mechanism; see §5.3), `cursor`/`pageSize` (pagination — §5.1,
  UX5B-R04).
- **Row identity**: `bookingId` (the canonical `rental_bookings.id`). A booking with both a
  pickup-today fact and a return-due-today fact (same-day turnover) is **one row** with
  independent `pickup`/`return` sub-objects, since `bookingId` is the natural row key and a
  booking cannot have two different `contact`/`period` values.

### 5.1 Pagination contract (UX5B-D07 / UX5B-R04, resolved)

UX5B-R04 rejected the prior `LIMIT 300` + `422 MANIFEST_SCOPE_TOO_LARGE` + `section` design: an
overflow *inside a single branch* was not actually retrievable through `section`, since
`section=pickup` still returns the same over-300 Branch A rows. There is also no proven maximum
booking count for a store/day, so a bounded-complete contract cannot be justified. This design now
uses **real deterministic keyset (seek) pagination** instead:

- **Candidate set**: the deduped union of `bookingId`s selected by every branch the requested
  `section` includes (§9.1 A / B+C+wear-mirrors / all), computed once inside the manifest's
  `REPEATABLE READ READ ONLY` transaction (§9.5) for that page's request.
- **Sort/cursor field**: `bookingId` alone (ascending). `bookingId` is a UUID primary key
  (`rental_bookings.id`), already unique per row, so — unlike `ops_list_exceptions`'s
  `(occurred_at, id)` compound cursor (`0035:85`), which needs a tie-break because `occurred_at`
  can collide — a single-column cursor is sufficient here; no tie-break field is needed. This
  intentionally optimizes for a stable, dependency-free, always-available seek key over a
  staff-friendly display order; client-side grouping/sorting for display (e.g. by pickup time) is
  a presentational concern layered on top of the fully-retrieved, deduped page set and does not
  affect pagination correctness.
- **Query**: `WHERE bookingId > $cursor ORDER BY bookingId ASC LIMIT $pageSize + 1` against the
  deduped candidate set, applied *after* branch union/dedup and *before* the batched per-booking
  reads (§9.2) — so the expensive batched queries (steps 4-9 of §9.2) only ever run for the one
  page's `bookingId`s, not the whole candidate set.
- **`pageSize`**: optional, default `100`, maximum `300` (`422` if outside `[1,300]` or
  non-integer) — a per-request work bound, not a whole-manifest limit; unlike the rejected D07
  design, exceeding it never rejects the request, it just means more pages.
- **Response fields**: `nextCursor` (the last row's `bookingId` on this page, or `null` on the
  last page) and `hasMore` (`true` iff the `LIMIT $pageSize+1` query returned a `$pageSize+1`th
  row, which is discarded before serialization). The client advances by passing the previous
  page's `nextCursor` as the next request's `cursor`.
- **Duplicate/omission guarantee, and its limit**: within one page (one `REPEATABLE READ READ
  ONLY` transaction), the union/dedup/order is exact by construction. Across pages, each page is
  its own separate HTTP request and its own separate transaction — there is no cross-request
  snapshot. A booking that enters or leaves candidacy *between* two page requests (e.g. it becomes
  due today, or completes) can therefore be seen on 0 or on 2 page-fetches for that walk; this is
  the same inherent, accepted behavior as any other keyset-paginated list in this codebase (e.g.
  `ops_list_exceptions`'s own `p_before_time`/`p_before_id` cursor) and is not a defect this design
  needs to solve. Within a single page, `bookingId` uniqueness means no row can appear twice or be
  skipped.
- **Full-retrieval proof obligation**: walking `cursor`→`nextCursor` until `hasMore=false` must
  return the exact expected `bookingId` set with no duplicates and no omissions, for a candidate
  set exceeding one `pageSize` — this is the corrected UX5B-R04 test (§10 item 17), replacing the
  rejected `422`-only test.

### 5.2 Cache/session/error semantics (unchanged from prior draft)

- **Cache headers**: `Cache-Control: private, no-store`, identical to every existing
  operations/custody/booking read (shared `privateHeaders`/`headers` constant in
  `custody-http.ts`/`booking-http.ts`/`operations-http.ts`).
- **Session stamp handling**: identical `x-zao-session` hash check against
  `createHash('sha256').update(s.stamp)` already used by every existing staff read.
- **Error semantics**: `401` unauthenticated, `403` forbidden store/permission (never a partial
  200 with redacted rows), `422` invalid `store`/`date`/`section`/`cursor`/`pageSize` (§5.1),
  `503` if the operations pool is unconnected.
- **No mutations**: this endpoint only ever issues read queries — full stop. Per UX5B-R03 (§5.4),
  it does not call `ops_collect_exceptions` or any other mutating function, in any transaction,
  inside or outside its own request. Acknowledging an exception stays on the existing
  `/api/operations/exception-acknowledge` endpoint; exception *collection* stays the existing
  `/admin/ops` (`OperationsConsole.list()`) path's responsibility, entirely outside this endpoint.

### 5.3 `section` query parameter (a candidate-set filter, not pagination — corrected by UX5B-R04)

`section=all` (default) includes every branch a permission composition allows. `section=pickup`
restricts the candidate set to Branch A only (§9.1); `section=return` restricts to Branches B+C
(+ their wear mirrors). `section` narrows *which* branches contribute to the candidate set before
pagination (§5.1) applies; it is never itself a mechanism for retrieving rows beyond one page, and
does not interact with `422` in any way — a single branch's row count has no upper bound that
triggers an error, it simply spans more pages.

### 5.4 Exception read vs. read-only transaction (UX5B-D06 / UX5B-R03, resolved)

**Chosen model (corrected by UX5B-R03)**: the manifest **never calls `ops_collect_exceptions`**,
in any transaction, inside or outside its own HTTP request. It only ever performs one read:

1. Open `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY` (§9.5) and, inside it, call
   `ops_list_exceptions(...)` (`0035:85`) — confirmed to be a pure `SELECT`, so it is safe inside a
   `READ ONLY` transaction alongside the rest of the manifest's reads.

Exception *collection* (`ops_collect_exceptions`, `0035:58`, an `INSERT ... ON CONFLICT DO
NOTHING`) remains exclusively the responsibility of the existing `/admin/ops`
(`OperationsConsole.list()`) path, entirely outside the manifest. This means the manifest's
`exception` sub-object (§6) is a **snapshot of whatever that existing path last collected**, which
may be stale relative to the instant a staff member requests the manifest — that staleness is an
accepted, documented trade-off for the manifest endpoint being genuinely, unconditionally
read-only, not a defect. (The prior "batch 1" design ran `ops_collect_exceptions` as a separate
step immediately before the manifest's read-only snapshot, inside the same HTTP request; UX5B-R03
correctly identified that this still made the manifest *endpoint* observably mutate state on every
call, which contradicts both the phase goal and the original UX5B-D06 instruction. This correction
removes that call entirely rather than relocating it again.)

## 6. Response schema (proposed, not implemented)

```jsonc
{
  "store": "MOUNTAIN_BASE",
  "date": "2026-09-20",
  "section": "all",
  "generatedAt": "2026-09-20T01:00:00.000Z", // inventory_clock() at read time, for staff-visible staleness only
  "pageSize": 100,
  "nextCursor": null,                        // last row's bookingId, or null on the last page (UX5B-R04, §5.1)
  "hasMore": false,                          // true iff another page exists; never a silent partial page
  "rows": [
    {
      "bookingId": "…uuid…",           // secondary detail/navigation target only, per TD's UX shape
      "displayName": "…",              // contact.displayName
      "period": { "startDate": "2026-09-20", "endDate": "2026-09-20", "slot": "DAY" },
      "pickupStore": "MOUNTAIN_BASE",
      "returnStore": "MOUNTAIN_BASE",
      "bookingState": "CONFIRMED_DEV", // raw state, safe — already returned by list()
      "totalJpy": 13800,               // omitted if price_snapshot cannot be trusted (should not happen; see view())
      "equipmentCount": 3,             // count of distinct non-wear requirement keys under conditions.members
      "pickup": {                      // omitted entirely if principal lacks RENTAL_CHECKOUT
        "isPickupToday": true,
        "equipmentRequired": true,     // equipmentCount > 0 (UX5B-R02: split from wear so a wear-only booking never needs equipment prep)
        "equipmentPrepared": true,     // rental_preparations.prepared_at IS NOT NULL; meaningless/ignored when equipmentRequired=false
        "equipmentCheckedOut": false,  // EXISTS rental_loan_items WHERE booking_id=? AND state='OUT'
        "noPickup": false,             // EXISTS rental_no_pickup_events
        "timing": "PICKUP_WINDOW",     // pickupTiming(period, generatedAt) — reused, not reinvented
        "wearRequired": true,
        "wearCheckedOut": false        // EXISTS wear_loans WHERE booking_id=?
      },
      "return": {                      // omitted entirely if principal lacks RENTAL_RETURN
        "isReturnDueToday": false,     // Branch B: state='OUT' AND due today (§9.1) — corrected scope, UX5B-D01
        "outCount": 3,                 // rental_loan_items state='OUT', regardless of due date
        "receivedHereCount": 0,        // rental_custody_events.actual_store = this store, received today OR still inspection-pending (Branch C, corrected UX5B-R01)
        "inspectionPendingHereCount": 0, // received here (any date) but no rental_inspection_events row — carry-over, UX5B-D01
        "wearOutstandingQuantity": 0,  // sum(wear_loans.quantity - returned) — not yet returned by guest at all
        "wearReturnedPendingQuantity": 0, // sum(wear_receipts.quantity) WHERE state='RETURNED_PENDING' — care not started (UX5B-R02, replaces the old single wearReceiptPending boolean)
        "wearCleaningQuantity": 0,        // sum(...) WHERE state='CLEANING'
        "wearTodayBlockedQuantity": 0,    // sum(...) WHERE state='TODAY_BLOCKED'
        "wearUnavailableQuantity": 0,     // sum(...) WHERE state='UNAVAILABLE' — no single safe action; drives NEEDS_DETAIL_REVIEW (§7.1)
        "wearReadyQuantity": 0            // sum(...) WHERE state='READY'
      },
      "exception": {                   // omitted entirely if principal lacks OPERATIONS_VIEW
        "attention": false,
        "count": 0,
        "topSeverity": null            // "INFO"|"WARN"|"ERROR"|null — attention metadata only, never drives nextAction (UX5B-D04); a snapshot of the last existing collection, never freshly collected by this endpoint (UX5B-R03)
      },
      "nextAction": "COMPLETE"         // §7; permission-aware (UX5B-D05, corrected UX5B-R05) — never derived from a sub-object omitted above
    }
  ]
}
```

No raw provider/payment id, capability token, email, or password/session material appears
anywhere in this shape.

## 7. Server-derived next-action classification

A finite, display-only enum computed **only** from facts the *calling principal is authorized to
see* (UX5B-D05) — never from a sub-object that §4/§6 omit for that principal — using
`pickupTiming` (§2.9) as the base pickup-timing signal and the presence facts from §2 for the rest.
This never encodes payment/inventory truth in the browser.

### 7.1 Classes, source facts, and the permission composition each requires

Classes are evaluated in the order listed and the **first matching class wins** — this ordering is
new bookkeeping made necessary by UX5B-R02's domain split (equipment and wear facts can now be
true/false independently, so more than one row of this table can match at once; e.g. a booking
that is both `equipmentCheckedOut=false` and has `wearCleaningQuantity>0` matches both `CHECKOUT`
and `WEAR_CARE_IN_PROGRESS` — `CHECKOUT` wins because pickup-side work is listed first and remains
actionable *today*, whereas wear care is a background process). Payment/exception concerns are
checked first because they can block every later mutation (`rental_validate_loan` itself would
reject checkout on `transfer_attention IS NOT NULL`, per §2.2).

| Class | Source facts (all pre-existing) | Requires (else never returned to that caller) |
| --- | --- | --- |
| `CHECK_PAYMENT_OR_EXCEPTION` | `bookingState IN ('PAYMENT_PENDING','PAYMENT_REVIEW')` **or** `inventory_holds.transfer_attention IS NOT NULL` | `bookingState` alone needs only `BOOKING_VIEW`. `transfer_attention` is evaluated **only** when the composition also has `RENTAL_CHECKOUT` — corrected by UX5B-R05; a `BOOKING_VIEW`-only caller never sees this class triggered by `transfer_attention`, since that field is not otherwise exposed to that composition (§4). |
| `PREPARE_EQUIPMENT` | `bookingState='CONFIRMED_DEV'`, `pickup.equipmentRequired=true`, `pickup.equipmentPrepared=false`, `pickup.timing` is `PICKUP_WINDOW` or `LATE_PICKUP_ELIGIBLE` | `RENTAL_CHECKOUT`. Corrected by UX5B-R02: never true for a wear-only booking (`equipmentRequired=false`), where this predicate is unconditionally false. |
| `CHECKOUT` | `bookingState='CONFIRMED_DEV'`, equipment-preparation gate satisfied (`!pickup.equipmentRequired \|\| pickup.equipmentPrepared`), **at least one required domain not yet checked out** (`(pickup.equipmentRequired && !pickup.equipmentCheckedOut) \|\| (pickup.wearRequired && !pickup.wearCheckedOut)`), same timing gate | `RENTAL_CHECKOUT`. Corrected by UX5B-R02: reachable for a wear-only booking directly (no equipment gate to satisfy), and reachable regardless of whether equipment or wear is checked out first — the old predicate required equipment specifically `checkedOut=false` *and* wear already done, which made a mixed booking with equipment already out but wear still pending fall through to no actionable class at all. |
| `OUT_WAIT_RETURN` | `pickup.equipmentCheckedOut=true` (or `!pickup.equipmentRequired`), `return.outCount>0`, not due today | `RENTAL_CHECKOUT` **and** `RENTAL_RETURN` (needs both pickup and return facts). Unchanged scope from batch 1 — still equipment-`outCount`-driven; see §12 for the analogous wear-only gap this correction does not fix, left open as its own flagged item since UX5B-R02 only required the checkout stage to be domain-aware. |
| `RECEIVE_RETURN` | `return.isReturnDueToday=true`, `return.outCount>0` | `RENTAL_RETURN`. Unchanged scope from batch 1 (equipment-specific), for the same reason as `OUT_WAIT_RETURN` above. |
| `INSPECTION_PENDING` | `return.inspectionPendingHereCount>0` | `RENTAL_RETURN`. Corrected by UX5B-R02: **equipment-only** now — no longer also triggered by any non-`READY` wear receipt (that was the exact overclaim UX5B-R02 rejected). |
| `WEAR_CARE_IN_PROGRESS` (new, UX5B-R02) | `return.wearReturnedPendingQuantity>0 \|\| return.wearCleaningQuantity>0 \|\| return.wearTodayBlockedQuantity>0`, **and** `return.wearUnavailableQuantity=0` | `RENTAL_RETURN`. Display-only/informational — cleaning is a backend workflow, so this class explicitly does **not** imply a staff action is owed today, unlike `INSPECTION_PENDING`/`RECEIVE_RETURN`. |
| `COMPLETE` | every equipment requirement `RECEIVED` and inspected, **and** `return.wearOutstandingQuantity=0 && wearReturnedPendingQuantity=0 && wearCleaningQuantity=0 && wearTodayBlockedQuantity=0 && wearUnavailableQuantity=0` (i.e. every returned wear unit is `READY`), or `pickup.noPickup=true` — completion gating itself is **unchanged** by this correction batch (§2.10); only which candidate branch keeps the row visible on completion day changed (UX5B-R01, §9.1 Branch C) | `RENTAL_CHECKOUT` **and** `RENTAL_RETURN` (completion depends on both pickup and return facts) |
| `NO_ACTION` | `bookingState='DRAFT'`; a multiday booking outside the today window (§3); or the neutral fallback for a composition that cannot see the facts needed for a more specific class (§7.3) | any |
| `NEEDS_DETAIL_REVIEW` | any state combination not covered above — e.g. partial checkout (some requirement keys `OUT`, others not, which today's schema does not appear to allow per `rental_active_requirement`'s uniqueness but is not proven impossible by this design pass), `return.wearUnavailableQuantity>0` (UX5B-R02: no single safe staff action is established for `UNAVAILABLE` from this read-only design pass), or a wear/equipment combination where one side is `COMPLETE`-eligible and the other is not yet determinable | any |

Every class above is computed from a fact that already exists and is already independently
enforced by a real guard (`rental_validate_loan`, `rental_apply_receipt`,
`rental_apply_inspection`, `rental_complete_no_pickup`, `WearService.checkout`/`receive`); the
classification can suggest an action but never substitutes for the mutation endpoint's own
re-validation.

### 7.2 UX5B-D04 — exception attention is metadata, never workflow authority

`exception.attention`/`count`/`topSeverity` (§6) are surfaced purely as staff-visible attention
metadata from `ops_exceptions`, which is explicitly observational
(`packages/db/migrations/0035_operations_console.sql:8-10`'s own comment: "never the authority for
payment, inventory, refund, custody or delivery"). `nextAction` is computed only from the
canonical facts in §7.1's table — `bookingState` and `inventory_holds.transfer_attention` — which
already happen to be the same underlying conditions that generate the `PAYMENT_PENDING` and
`TRANSFER_DELAYED` exception types (`0035:31`, `0035:39`) in the first place. No other exception
type (`WEBHOOK_*`, `NOTIFICATION_FAILED`, `STORAGE_FAILED`, `DB_UNAVAILABLE`, `PROVIDER_TIMEOUT`,
`INVENTORY_INVARIANT_FAILED`, `RETURN_INSPECTION_REQUIRED`) has a per-booking canonical field this
design can point `nextAction` at without inventing one, so none of them ever changes `nextAction` —
`RETURN_INSPECTION_REQUIRED` in particular is intentionally redundant with (not a driver of)
`return.inspectionPendingHereCount`, which already comes from `rental_inspection_events` directly.

### 7.3 UX5B-D05 / UX5B-R05 — permission-aware classification, by composition

| Composition | Classes ever returned |
| --- | --- |
| `BOOKING_VIEW` only | `CHECK_PAYMENT_OR_EXCEPTION` (from `bookingState` only — **never** from `transfer_attention`, corrected by UX5B-R05), `NO_ACTION` |
| `BOOKING_VIEW + RENTAL_CHECKOUT` | above, **now including the `transfer_attention`-triggered half of `CHECK_PAYMENT_OR_EXCEPTION`** (UX5B-R05 — this is the minimum composition authorized to see that pickup-blocking fact), plus `PREPARE_EQUIPMENT`, `CHECKOUT`; once every required domain is checked out, falls back to `NO_ACTION` (return-side facts needed for `OUT_WAIT_RETURN`/`RECEIVE_RETURN`/`INSPECTION_PENDING`/`WEAR_CARE_IN_PROGRESS`/`COMPLETE` are not visible to this composition) |
| `BOOKING_VIEW + RENTAL_RETURN` | baseline (`bookingState`-only `CHECK_PAYMENT_OR_EXCEPTION`), plus `RECEIVE_RETURN`, `INSPECTION_PENDING`, `WEAR_CARE_IN_PROGRESS`, and the `wearUnavailableQuantity`-triggered half of `NEEDS_DETAIL_REVIEW`; a not-yet-checked-out booking is `NO_ACTION` here (this composition cannot tell "not prepared" from "not checked out," and does not need to, since it can act on neither) |
| `BOOKING_VIEW` + both | full table in §7.1 |

## 8. UX response shape

Already reflected in §6. Explicitly excluded: raw provider ids
(`rental_payment_attempts.provider_id`), capability/session tokens, `contact.email`, and the full
`price_snapshot`/`priceSha256` integrity payload (only the display total).

## 9. Query/read-model plan

### 9.1 Corrected candidate branches (UX5B-D01, UX5B-D02)

Three **paired, not independently `OR`ed**, branches, each producing a `bookingId` set for a given
`$store`/`$date`, unioned before per-booking composition:

- **Branch A — pickup**: `rental_bookings b JOIN inventory_holds h ON h.id=b.hold_id WHERE
  h.pickup_store=$store AND h.occupancy_start=$date`. Populates `pickup.*`.
- **Branch B — return due, not yet received anywhere**: `... JOIN rental_loan_items l ON
  l.booking_id=b.id WHERE h.return_store=$store AND l.state='OUT' AND (l.due_at AT TIME ZONE
  'Asia/Tokyo')::date=$date`. Populates `return.isReturnDueToday`/`outCount`. An item that has
  already moved to `RECEIVED` (anywhere) naturally drops out of this branch — it is not "still
  due," it is "received," which is Branch C's concern. This is what makes cross-store attribution
  deterministic (UX5B-D02): a due item is either still owed at the planned return store (Branch B)
  or already received somewhere specific (Branch C), never both at once.
- **Branch C — actual receipt, corrected for same-day completion visibility (UX5B-R01)**:
  `rental_custody_events e JOIN rental_loan_items l ON l.id=e.loan_item_id JOIN rental_bookings b
  ON b.id=l.booking_id WHERE e.actual_store=$store AND (
  (e.applied_at AT TIME ZONE 'Asia/Tokyo')::date=$date
  OR NOT EXISTS(SELECT 1 FROM rental_inspection_events i WHERE i.loan_item_id=l.id)
  )`. Populates `return.receivedHereCount`/`inspectionPendingHereCount`, keyed on the *actual*
  receiving store. The `OR` is the UX5B-R01 correction: the pre-correction predicate
  (`NOT EXISTS(... inspection_events ...)` alone) dropped a booking from every branch the instant
  its inspection completed, making `COMPLETE` (§7.1) unreachable for a same-day receipt+inspection.
  Now a receipt is a Branch C candidate **either** because it happened on `$date` (regardless of
  inspection status — so a same-day `COMPLETE` still has a row to attach to) **or** because
  inspection is still outstanding from an earlier date (carry-over, independent of `$date`, per
  §3) — never both meaning the same thing, since `return.inspectionPendingHereCount` (derived
  separately in §9.2 step 6, not by branch membership) is what actually distinguishes "done" from
  "still pending" once the row is selected.
- **Wear mirrors of B/C**: **B-wear** — `wear_loans wl JOIN rental_bookings b ON b.id=wl.booking_id
  WHERE wl.planned_return_store=$store AND wl.returned<wl.quantity AND
  (b.conditions->'period'->>'endDate')::date=$date`; **C-wear — corrected identically to Branch C
  (UX5B-R01)** — `wear_receipts wr JOIN wear_loans wl ON wl.id=wr.loan_id WHERE
  wr.actual_store=$store AND ( (wr.received_at AT TIME ZONE 'Asia/Tokyo')::date=$date OR
  wr.state<>'READY' )` — a wear receipt is a candidate either because it was received on `$date`
  (regardless of state, so same-day `READY` still has a row) or because it is still not `READY`
  from an earlier date (carry-over).
- **Branch A** has no wear-specific mirror: wear pickup is part of the same booking-level pickup
  event as equipment, already covered by Branch A; `pickup.wearCheckedOut` is a fact composed from
  `wear_loans` existence for that `bookingId`, not a separate candidate branch.

`section=pickup` restricts the branch union to Branch A only; `section=return` restricts it to
B+C (+ wear mirrors). Pagination over the resulting deduped `bookingId` union is a **separate**
concern, corrected by UX5B-R04 — see §5.1 (no per-branch row cap exists any more).

### 9.2 Read sequence (service-composition plan, not SQL to be written yet)

Corrected by UX5B-R03 (no `ops_collect_exceptions` call anywhere in this sequence — the manifest
performs zero mutations) and UX5B-R04 (cursor applied before the batched per-booking reads, so
those reads only ever cover one page):

1. Open `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY` (§9.5). Everything below runs inside it.
2. One query per requested branch (§9.1), collecting the union of matching `bookingId`s (and, for
   Branch C, the matching `loan_item_id`s directly, since Branch C's own row is already keyed by
   `loan_item_id`).
3. Dedup the union to a `bookingId` set, apply `WHERE bookingId > $cursor ORDER BY bookingId ASC
   LIMIT $pageSize + 1` (§5.1, UX5B-R04), discard the `$pageSize+1`th row after computing
   `hasMore`/`nextCursor` from its presence, and keep only the resulting page's `bookingId`s for
   every step below.
4. One batched query: `rental_preparations WHERE id = ANY($pageBookingIds)` (PK lookup, no
   fan-out).
5. One batched query: `rental_loan_items WHERE booking_id = ANY($pageBookingIds)`.
6. One batched query joining `rental_custody_events`/`rental_inspection_events` keyed by the
   `loan_item_id` set collected from step 5 and Branch C, restricted to the page.
7. One batched query: `rental_no_pickup_events WHERE booking_id = ANY($pageBookingIds)`.
8. One batched query: `wear_loans WHERE booking_id = ANY($pageBookingIds)`.
9. One batched query joining `wear_receipts` keyed by the `loan_id` set from step 8.
10. `ops_list_exceptions(...)` (`0035:85`, pure `SELECT` — §5.4) for the store, grouped by
    `booking_id` in application code. This is the **only** exception-related call the manifest
    makes; it never calls `ops_collect_exceptions`.
11. Compose §6/§7 per booking in application code from the in-memory batch results.

Steps 4-10 only ever run for one page's `bookingId`s (bounded by `pageSize`, max 300), not the
whole candidate set — this is a bounded number of queries regardless of total row count (no
per-booking query), directly avoiding N+1.

### 9.3 Existing indexes usable as-is

`rental_bookings` PK (`id`) — the btree index backing this PK is what makes UX5B-R04's `WHERE
bookingId > $cursor ORDER BY bookingId ASC` keyset pagination (§5.1) efficient without any new
index. Also `rental_preparations` PK (`id`), `rental_active_requirement`/`rental_initial_requirement`
on `rental_loan_items`, the `UNIQUE` indexes on `rental_custody_events.loan_item_id` and
`rental_inspection_events.loan_item_id`, `rental_no_pickup_events` PK, `wear_loans`
`UNIQUE(booking_id,requirement_key)`, `ops_exception_recent`.

### 9.4 Indexes this design believes would be needed — DESIGN_GATE, not authorized here

Unchanged from the prior draft, no index change proposed in this correction:
- `rental_bookings`: expression indexes on `(conditions->>'pickupStore')`,
  `(conditions->>'returnStore')`, `(conditions->'period'->>'startDate')`.
- `inventory_holds(pickup_store, occupancy_start)` / `(return_store, occupancy_end)`.
- `ops_exceptions(booking_id)`.
- `rental_loan_items(due_at)` (Branch B does a full scan without it) and
  `rental_custody_events(actual_store, applied_at)` (Branch C's corrected UX5B-R01 predicate reads
  both columns together). The wear mirror likewise implies `wear_receipts(actual_store,
  received_at)` for Branch C-wear. Same DESIGN_GATE status — no migration proposed here.

Target upper bound for a "normal" two-store day is no longer a blocking question for this design:
UX5B-R04 replaced the bounded-ceiling contract with real cursor pagination (§5.1), so there is no
number that this document needs to prove or tune. A real volume figure remains useful input for
*whether/when* the §9.4 indexes above are worth adding, which stays its own separate, still-open
`NEEDS_DETAIL_REVIEW` (§12) — it no longer gates the pagination contract itself.

### 9.5 Repeatable-read consistency

Wrap steps 2–11 of §9.2 in one `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY` transaction — the
exact mechanism `BookingService.get()` already uses (`booking-service.ts:30`). Corrected by
UX5B-R03: there is no step that needs to run *outside* it any more, since the manifest no longer
calls `ops_collect_exceptions` (or any other mutating function) at all. Each page of a
cursor-paginated walk (§5.1) opens its own such transaction — see §5.1's cross-page consistency
note for what that does and does not guarantee across separate page requests.

### 9.6 N+1 avoidance

Covered by §9.2's batching, extended to the wear tables per §2.10.

## 10. Test plan (synthetic PostgreSQL fixtures only; no implementation in this phase)

Modeled on the existing `startDevelopmentApp`/`writeAccount`/`HoldService`+`QuoteService`+
`BookingService`+`CustodyService`+`WearService` fixture pattern already used by
`tests/staff/home-ui.ts` and `tests/operations/console-ui.ts` in this repo:

1. **Store-scope isolation**: a booking at `ONSEN_BASE` must never appear in a `MOUNTAIN_BASE`
   manifest request, for a principal with access to both stores.
2. **Permission composition**: the compositions in §4/§7.3, each asserted against a real synthetic
   account (mirroring the `ux5a-full`/`ux5a-narrow`/`ux5a-inverse` account pattern), including a
   specific assertion that a `RENTAL_CHECKOUT`-only response never contains a `RECEIVE_RETURN`/
   `INSPECTION_PENDING`/`WEAR_CARE_IN_PROGRESS`/`COMPLETE` `nextAction` and vice versa (UX5B-D05),
   **and (new, UX5B-R05) that a `BOOKING_VIEW`-only response never contains `nextAction` driven by
   `transfer_attention`** — seed a booking with `inventory_holds.transfer_attention` set (a live
   `CUSTODY_RECONCILIATION_REQUIRED` fact from a real cross-store reconciliation scenario, not a
   hand-set column) and assert: the `BOOKING_VIEW`-only response's `nextAction` is `NO_ACTION` (not
   `CHECK_PAYMENT_OR_EXCEPTION`), while the same booking read by a `BOOKING_VIEW+RENTAL_CHECKOUT`
   principal *does* get `CHECK_PAYMENT_OR_EXCEPTION`. This is the explicit "hidden operational fact
   must not leak into `nextAction`" proof the re-review asked for.
3. **Today pickup**: a booking with `occupancy_start=today` appears via Branch A with
   `pickup.isPickupToday`.
4. **Multiday ongoing rental**: a booking spanning `today` but not starting/ending today does not
   appear via any branch, asserted explicitly (not merely absence-by-omission).
5. **Cross-store return (corrected, UX5B-D02)**: a booking picked up at store X, planned to return
   at store X, but *actually* received at store Y: appears at X via Branch B while `state='OUT'`;
   the instant it is received at Y, it disappears from X's Branch B and appears at Y's Branch C —
   asserted as two sequential manifest reads (before/after the receipt), never simultaneously
   actionable at both stores.
6. **Prepared but not checked out**: `rental_preparations.prepared_at` set,
   `rental_loan_items` absent → `nextAction='CHECKOUT'` for a full/checkout-composed caller
   (`pickup.equipmentPrepared=true`, `pickup.equipmentCheckedOut=false`).
7. **Checked out and due today**: `state='OUT'`, `due_at` today → `RECEIVE_RETURN` for a
   return-composed caller, `OUT_WAIT_RETURN` before due, `NO_ACTION` for a checkout-only caller
   throughout.
8. **Wear-only pickup (new, UX5B-R02)**: a booking whose `conditions.members[].items` are entirely
   `WEAR_JACKET`/`WEAR_PANTS` (`equipmentCount=0`, `pickup.equipmentRequired=false`) →
   `nextAction` is **never** `PREPARE_EQUIPMENT` at any point (there is no equipment preparation
   record to create), and is `CHECKOUT` once `bookingState='CONFIRMED_DEV'` and the timing gate
   passes, driven purely by `wearRequired && !wearCheckedOut`. After `WearService.checkout()`,
   `wearCheckedOut=true` and `nextAction` falls through past `CHECKOUT` (to `OUT_WAIT_RETURN`/
   `NO_ACTION` depending on `RENTAL_RETURN` visibility).
9. **Mixed checkout ordering (new, UX5B-R02)**: a booking requiring both equipment and wear,
   asserted through both valid orderings against a full-capability caller:
   - **gear-first**: equipment prepared and checked out (`equipmentCheckedOut=true`), wear not yet
     checked out (`wearCheckedOut=false`) → `nextAction='CHECKOUT'` (proving the pre-correction bug
     — which required equipment specifically `checkedOut=false` — is fixed: the class must remain
     `CHECKOUT`, not silently fall through to `NO_ACTION`/`OUT_WAIT_RETURN`, while wear is still
     outstanding).
   - **wear-first**: wear checked out (`wearCheckedOut=true`), equipment prepared but not yet
     checked out (`equipmentCheckedOut=false`) → `nextAction='CHECKOUT'` still, driven by the
     equipment side this time.
   - Once **both** domains are checked out → `nextAction` clears `CHECKOUT` regardless of which
     order they were done in.
10. **Returned but inspection pending (corrected, UX5B-D01)**: `rental_custody_events` row exists
    (loan `state='RECEIVED'`), `rental_inspection_events` does not → the booking still appears
    (via Branch C, not Branch B) with `nextAction='INSPECTION_PENDING'`, proving the fix to the
    candidate-set bug that made this case impossible under the original draft.
11. **Same-day return-to-complete visibility (new, UX5B-R01)**: a booking due today → received
    today (`rental_custody_events.applied_at` on `$date`) → inspected today (same `$date`) → the
    row is still present in that date's manifest (selected by Branch C's "received on `$date`"
    clause, since the "inspection missing" clause no longer applies) with `nextAction='COMPLETE'`.
    This is the direct regression test for the bug the re-review found: under the pre-R01
    predicate, this exact sequence produced zero candidate rows and `COMPLETE` was unreachable.
12. **Mixed gear+wear same-day completion (new, UX5B-R01)**: equipment received and inspected
    today, and every wear receipt reaches `READY` today (`wear_receipts.received_at` on `$date`)
    → the booking still appears on that date's manifest (via Branch C **and** C-wear's "received
    on `$date`" clauses together) with `nextAction='COMPLETE'`.
13. **Inspection-pending carry-over across days**: a receipt from a prior day, still uninspected,
    still appears on the *current* day's manifest via Branch C, explicitly asserted at two
    different `$date` values. **Also assert the negative**: if that same loan item's inspection
    completes on a day *after* the receipt date, the booking drops out of the manifest on that
    later day (it is neither "received on `$date`" nor "still pending") — the same-day guarantee
    from items 11/12 is intentionally scoped to the day the work actually finished, not to every
    subsequent day.
14. **No-pickup completion**: `rental_no_pickup_events` row exists → `nextAction='COMPLETE'`,
    never `PREPARE_EQUIPMENT`/`CHECKOUT`.
15. **Wear care-in-progress states distinguished from inspection-pending (new, UX5B-R02)**:
    equipment fully received and inspected, wear returned but its `wear_receipts` row is in
    `RETURNED_PENDING`, `CLEANING`, or `TODAY_BLOCKED` (parametrized over all three) →
    `nextAction='WEAR_CARE_IN_PROGRESS'`, **never** `INSPECTION_PENDING` and **never** `COMPLETE`.
    A fourth case, `wear_receipts.state='UNAVAILABLE'`, asserts `nextAction='NEEDS_DETAIL_REVIEW'`
    instead (no class claims a single safe action for it, per §7.1).
16. **Mixed equipment+wear, both complete (UX5B-D03)**: equipment inspected and every
    `wear_receipts` row `READY` → `nextAction='COMPLETE'` (the general, not-necessarily-same-day
    version of items 11/12).
17. **Payment/transfer exception → detail review, split by composition (UX5B-D05 / UX5B-R05)**: a
    booking with a live `PAYMENT_PENDING` `bookingState` classifies as `CHECK_PAYMENT_OR_EXCEPTION`
    for **every** composition including `BOOKING_VIEW`-only. A separate booking with a live
    `inventory_holds.transfer_attention` fact classifies as `CHECK_PAYMENT_OR_EXCEPTION` **only**
    for a `RENTAL_CHECKOUT`-composed caller, and as `NO_ACTION` for `BOOKING_VIEW`-only (see item 2
    for the same assertion from the permission-composition angle).
18. **Generic exception does not override canonical next action (UX5B-D04)**: a booking with
    an unrelated `WEBHOOK_FAILED`/`NOTIFICATION_FAILED` exception attached (via `booking_id`) but
    otherwise `CHECKOUT`-eligible still classifies as `CHECKOUT`, with `exception.attention=true`
    shown separately.
19. **Concurrent state change / repeatable-read consistency**: start the manifest's transaction,
    mutate a loan item's state in a separate connection mid-read, and assert the manifest response
    reflects one consistent snapshot rather than a mix of before/after facts.
20. **The manifest never mutates `ops_exceptions` (corrected, UX5B-R03)**: seed an exception
    *source* condition (e.g. a live `PAYMENT_PENDING` payment attempt) for a store where
    `ops_collect_exceptions` has **not** been run, call the manifest for that store, and assert
    `ops_exceptions` gained **zero** new rows as a result — proving the manifest itself performs no
    write, not merely that a write happens outside its read-only transaction. Then separately
    invoke the existing `/admin/ops` collection path (`OperationsConsole.list()`) and re-call the
    manifest, asserting the now-collected exception appears in `exception.count` — proving the
    manifest's exception data is a snapshot of that existing, separate collection step, not a
    fresh one it triggers.
21. **Cursor pagination — full, duplicate-free, omission-free retrieval (corrected, UX5B-R04)**:
    seed more than 300 candidate `bookingId`s for one store/date/section combination (replacing the
    rejected D07 "seed >300, assert 422" test), then walk the manifest with a small `pageSize`
    (e.g. `pageSize=5`) from `cursor=null` through successive `nextCursor`s until `hasMore=false`,
    and assert: (a) the union of every page's `bookingId`s equals the full expected candidate set
    exactly, (b) no `bookingId` appears on more than one page, (c) no `bookingId` is missing, and
    (d) the same walk at `pageSize=300` (the maximum) also succeeds and returns the complete set in
    fewer pages. Also assert `422` for `pageSize=0`, `pageSize=301`, and a non-integer `pageSize`.
22. **Zero client-side state inference**: an end-to-end UI-level assertion (once implemented) that
    the rendered next-action text always matches the server-returned `nextAction` string verbatim,
    across the full class list in §7.1 including `WEAR_CARE_IN_PROGRESS`.

## 11. Explicit out-of-scope (this phase)

No schema/migration. No new business-state table. No materialized cache. No Production
activation. No main merge. No Staff Home implementation change (this document itself is the only
artifact produced). No endpoint implementation — §5/§6 are proposals for the next, separately
authorized phase. No index change (§9.4).

## 12. Open design gates (`NEEDS_DETAIL_REVIEW` summary)

1. §2.9 — whether the return section stays per-actor (matching today's `CustodyService.returns`)
   or becomes store-wide for the manifest. *(Unaffected by any correction so far; still open.)*
2. §3 — whether a multiday ongoing rental (neither pickup nor return today) should get a third,
   explicit "currently out" manifest bucket. *(Narrowed from the prior draft: defaulting to
   omission is now the stated design, not an open question; only the optional future bucket
   remains open.)*
3. §9.4 — the real daily-volume number that would justify actually adding the listed indexes. No
   longer gates the pagination contract itself (UX5B-R04 replaced the volume-dependent bounded
   ceiling with real cursor pagination), so this is now purely an indexing-priority question, not a
   correctness one.
4. §7.1 — whether the partial-checkout state (some requirement keys `OUT`, others not) is actually
   reachable under the current schema.
5. **New (identified while closing UX5B-R02, not itself required by R01-R05)**: `OUT_WAIT_RETURN`
   and `RECEIVE_RETURN` (§7.1) remain equipment-`outCount`-specific, unlike the now domain-aware
   `CHECKOUT`/`PREPARE_EQUIPMENT` pair. A booking whose equipment is fully returned but whose wear
   was never returned at all (`wearOutstandingQuantity>0`, no `wear_receipts` row yet — distinct
   from item 15/§10's "returned but not `READY`" case) falls to `NEEDS_DETAIL_REVIEW` today rather
   than a class analogous to `OUT_WAIT_RETURN`/`RECEIVE_RETURN`. UX5B-R02's instruction was scoped
   to the checkout stage; extending the same domain-aware treatment to the return-due stage is
   flagged here for a future review, not silently added in this batch.
6. UX-5A's own Today section computing "today" from browser time (§3) — flagged, not fixed, in
   this document.

Resolved by UX5B-D01–D07 (closed by "Correction batch 1"): the original candidate-set/carry-over
question, cross-store attribution/duplication, exception-read-vs-read-only composition, and the
first pagination-strategy question.

Resolved by UX5B-R01–R05 (closed by "Correction batch 2", this batch): same-day return-to-complete
manifest visibility (R01); wear-only and mixed-domain checkout classification, and collapsing every
non-`READY` wear state into one `INSPECTION_PENDING` signal (R02); the manifest endpoint actually
performing a mutation via `ops_collect_exceptions` (R03); the D07 pagination contract not actually
being retrievable on a single-branch overflow, replaced by real cursor pagination (R04); and
`transfer_attention` leaking into a `BOOKING_VIEW`-only `nextAction` (R05).

## Submission

Posting `ZAO_UIUX_V2_STAFF_MANIFEST_DESIGN_READY_FOR_TD_REVIEW` on PR #26 per the authorizing
comment. No endpoint implementation proceeds until the TD explicitly approves this design.
