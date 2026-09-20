# UX-5B — Staff Daily Manifest — design (DESIGN_GATE, no implementation)

Authority: PR #26 comment [`5748592542`](https://github.com/ginisato-hash/zao-rental/pull/26#issuecomment-5748592542)
(Technical Director — UX-5A PASS at HEAD `25c678e`; UX-5B Daily Manifest design authorization).

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
| `transfer_attention` | text/null | non-null blocks pickup (`CUSTODY_RECONCILIATION_REQUIRED`, etc.) |
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
(`0033:109`) guarantees at most one currently-active row per requirement key even across the
`amendment_id` exchange path added in `0033` — **the manifest never needs amendment-aware
branching; `state='OUT'`/`'RECEIVED'` remains the single source of truth regardless of whether
the row originated from the initial checkout or an amendment exchange.** Also carries
`due_at` (exact return cutoff for that specific item) and `pickup_store`.

Index: `rental_one_active_asset(asset_id) WHERE state='OUT'` (uniqueness, not a lookup aid for
this query shape), `rental_active_requirement`/`rental_initial_requirement`/
`rental_amended_requirement` (all keyed by `booking_id` or `amendment_id`, not by store/date).
**No index on `due_at` or `pickup_store` alone.**

### 2.5 `rental_no_pickup_events` (`0017_no_pickup_completion.sql:6`)

PK = `booking_id`. `outcome='NO_PICKUP_COMPLETED'` (only value), `due_at`, `completed_at`. Presence
of a row is the sole terminal "never picked up" fact; `rental_bookings.state` is separately moved
to `COMPLETED_DEV` by the same transaction (`0017:27`), so either fact alone is sufficient and
they cannot disagree by construction.

### 2.6 Receipt / custody: `rental_receipts` + `rental_custody_events` (`0010:15`, `0015_custody_boundary.sql:11`)

`rental_receipts` is the raw scan/confirm record; `rental_custody_events` is the *applied* (import
committed) fact, one row per `loan_item_id` (`UNIQUE`), carrying `source_store`, `actual_store`,
`applied_at`. **`rental_custody_events` existing, not `rental_receipts` alone, is the correct
"actually received" signal** — this is exactly what `CustodyService.returns()`
(`packages/core/src/rental/custody-service.ts:95`) already joins against.

### 2.7 Inspection: `rental_inspections` + `rental_inspection_events` (`0010:16`, `0015:12`)

Same split: `rental_inspections` is the raw record, `rental_inspection_events` (`inspection_id`
PK, `loan_item_id` `UNIQUE`) is the applied fact. Presence of an event row for a `loan_item_id` is
the sole "inspection complete" signal, exactly as `CustodyService.returns()` already reads it via
`LEFT JOIN rental_inspection_events i ON i.loan_item_id=l.id ... i.inspection_id`.

### 2.8 Operations exceptions: `ops_exceptions` (`0035_operations_console.sql:11`)

Read via `ops_list_exceptions(...)` (`0035:85`), never the raw table directly from application
code. Carries `booking_id`/`asset_id` (nullable — not every exception ties to one booking),
`store_id`, `severity`, `status`, `occurred_at`. Index: `ops_exception_recent(store_id,
occurred_at DESC,id DESC)`. **No index on `booking_id`** — see §9.

### 2.9 Existing service/authorization surface reused as-is

- `BookingService.authorize(permission, stores)` (`booking-service.ts:18`) — requires
  `BOOKING_VIEW` **and** the given `permission`, and that every `stores` entry is in
  `principal.storeIds`. The manifest's authorization must compose the same way (§5).
- `BookingService.list()` (`booking-service.ts:31`) — existing store/permission-scoped booking
  read; the manifest's booking half is a superset of this query, not a replacement.
- `CustodyService.returns(store)` (`custody-service.ts:95`) — **scoped by
  `owner_id=this.identity.subject`, i.e. the calling staff member's own saved return batches,
  not every batch at that store.** A manifest that shows *all* staff's return activity at a store
  would be a new scope decision beyond what's authorized today. `NEEDS_DETAIL_REVIEW`: whether
  UX-5B's return section stays per-actor (matching today) or becomes store-wide (a policy change
  requiring separate TD sign-off, not assumed here).
- `OperationsConsole.list()` (`packages/core/src/operations/console-service.ts:18`) — requires
  `OPERATIONS_VIEW`, calls `ops_collect_exceptions` then `ops_list_exceptions`; SYSTEM scope
  requires `principal.scope==='ALL'`. The manifest's exception attention flag reuses this same
  read, scoped to the manifest's own store, never `SYSTEM`.
- `BookingService.get()` (`booking-service.ts:30`) already opens
  `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY` for a single-booking read — this is the
  existing project pattern for consistent read-only transactions and is the one proposed for the
  manifest (§9.4), not a new mechanism.
- `pickupTiming(period, now)` (`packages/contracts/src/pickup.ts`) — an existing **pure,
  display-only** classifier (`RETURN_DUE_PASSED` / `OUTSIDE_HANDOVER_WINDOW` /
  `LATE_PICKUP_ELIGIBLE` / `PICKUP_WINDOW`) computed only from `period` and `now`, already used by
  `CustodyService.checkoutView`. This is the direct prior art for §7's next-action classification
  and should be reused/extended, not reinvented.

## 3. JST date/time contract

**The manifest's "today" must come from `inventory_clock()`, never `Date.now()` in the browser or
in Node.** Every existing business-date decision in this codebase — HOLD expiry/occupancy,
`ops_collect_exceptions`, `rental_apply_receipt`, `rental_validate_loan`'s checkout-window check —
reads `inventory_clock()` (`SELECT clock_timestamp()` by default,
`packages/db/migrations/0005_store_transfer.sql:113`, and test-overridable via
`CREATE OR REPLACE FUNCTION`). A manifest keyed to browser time would silently disagree with the
server's own notion of "today" the moment a staff device's clock, timezone, or a running
synthetic-clock test differs — and would break every existing `inventory_clock()`-based test
fixture pattern used across this repo. **This is a real, present-tense gap in the current UX-5A
Staff Home "本日" section, which does compute "today" from browser time
(`apps/web/src/components/StaffHome.tsx`, `todayJst()`); this design does not fix that — it is
called out so the manifest is not built the same way twice. Correcting UX-5A's Today section is
out of scope for this design doc and would need its own follow-up, not assumed here.**

Concrete contract for the manifest specifically:
- Manifest date parameter is a plain `YYYY-MM-DD` string in Asia/Tokyo, resolved server-side as
  `(inventory_clock() AT TIME ZONE 'Asia/Tokyo')::date` when the caller omits it; the client may
  request a specific date (for "yesterday's stragglers" style staff use) but the *default* must
  never be client-supplied.
- **Pickup inclusion for date `D`**: `inventory_holds.occupancy_start = D` (arrival) — this is the
  natural "pickup due today" read, distinct from "period spans today" (which is a broader,
  already-partially-covered idea in UX-5A's own Today cards).
- **Return inclusion for date `D`**: `rental_loan_items.due_at` falls within `[D 00:00,
  D+1 00:00)` JST for `state='OUT'` items (i.e. the due date in JST equals `D`), independent of
  slot (AM/PM/DAY/MULTIDAY), since `due_at` is already the exact absolute cutoff computed by
  `normalizePeriod` (`packages/contracts/src/hold.ts:39`): AM → `endDate` 12:00 JST, PM/DAY/
  MULTIDAY → `endDate` 17:00 JST.
- **Midnight-crossing returns**: none exist today — every slot's `due_at` lands within normal JST
  business hours (12:00 or 17:00) per `normalizePeriod`; there is no overnight/AM-next-day slot in
  the current `Period` type (`'AM'|'PM'|'DAY'|'MULTIDAY'`). If a future slot type crossed
  midnight, its inclusion rule would need its own review — `NEEDS_DETAIL_REVIEW` as a forward
  note, not a current gap.
- **Multiday ongoing rentals**: a multiday booking whose `occupancy_start < D < occupancy_end`
  (already picked up, not yet due) is neither a "pickup" nor a "return" row for date `D` under the
  above rules. Whether the manifest should still surface it (e.g. under a third "ongoing" bucket)
  is `NEEDS_DETAIL_REVIEW` — the TD's field list names "pickups starting/due today" and "returns
  due today" specifically, not "everything currently out," so this design defaults to omitting
  ongoing-only rows and flags the omission rather than guessing a third bucket's shape.

## 4. Permission/store scope contract

Reuses `BookingService.authorize` exactly (`booking-service.ts:18`): a principal must have
`BOOKING_VIEW` **and** the specific capability being requested, **and** the requested store must
be in `principal.storeIds` (already `ALL`-expanded to every `ledger_stores` row by `loadStaff`,
`packages/auth/src/staff-auth.ts:33`, for `scope='ALL'` principals).

| Permission composition | Manifest behavior |
| --- | --- |
| `BOOKING_VIEW` only | Booking/period facts visible (name, period, state, store, total); pickup/return/next-action sections that require a capability the principal lacks are **omitted from the response**, not merely hidden client-side — matching UX5R-01/04's "server route is authoritative" principle extended to this new endpoint. |
| `BOOKING_VIEW + RENTAL_CHECKOUT` | Pickup-side facts (preparation/checkout state, pickup next-action) included for rows within the principal's stores. |
| `BOOKING_VIEW + RENTAL_RETURN` | Return-side facts (receipt/inspection state, return next-action) included. Per §2.9, if the return read stays per-actor, "included" here means *this actor's own* batches only — `NEEDS_DETAIL_REVIEW` as noted. |
| `BOOKING_VIEW` + both | Full row. |
| Neither `RENTAL_CHECKOUT` nor `RENTAL_RETURN` | Booking/period facts only; no next-action requiring either capability. |
| `OPERATIONS_VIEW` present | Exception attention flag/count included, itself scoped to the same store and never `SYSTEM` from this endpoint. |
| `OPERATIONS_VIEW` absent | Exception field omitted entirely (not `null`/zeroed — omitted, so its absence cannot be read as "no exceptions"). |
| `ASSIGNED` scope | `store` request parameter must be one of `principal.storeIds`; any other value is `403`, identical to `BookingService.authorize`'s existing `stores.some(s=>!p.storeIds.includes(s))` check. |
| `ALL` scope | Any real store id (`MOUNTAIN_BASE`/`ONSEN_BASE`) is permitted; `SYSTEM` is never a manifest store (exceptions with `store_id='SYSTEM'` are out of scope for a per-store daily manifest by construction). |

No row may ever be returned for a store outside `principal.storeIds`, at the SQL predicate level
(store is bound into the `WHERE`, exactly like `list()`'s `conditions->>'pickupStore'=ANY($1)`),
never filtered after the fact in application code and never simply hidden by the client.

## 5. Proposed read-only API contract (not implemented)

- **Method/path**: `GET /api/operations/manifest` — reusing the existing `/api/operations`
  route's session/permission plumbing (`apps/web/src/lib/operations-http.ts`) rather than adding a
  new top-level route family, consistent with this endpoint being an operations-style read
  composed from multiple existing authorities.
- **Query**: `store` (required, one of `principal.storeIds`), `date` (optional `YYYY-MM-DD`,
  defaults per §3).
- **Row identity**: `bookingId` (the canonical `rental_bookings.id`), since a manifest row is
  fundamentally "this booking's status today"; a booking with both a pickup-today and a
  return-today fact (same-day turnover) is `NEEDS_DETAIL_REVIEW` for whether it is one row with
  two facts or two rows — this design defaults to **one row per booking with independent
  `pickup`/`return` sub-objects**, since `bookingId` is the natural row key and a booking cannot
  have two different `contact`/`period` values.
- **Pagination**: bounded `LIMIT` per section (mirroring `BookingService.list()`'s existing
  `LIMIT 100` and `ops_list_exceptions`'s `LIMIT 51`/cursor pattern), not open-ended. A normal
  two-store day is expected to be small (§9.3); if a store ever exceeds the limit, the response
  should say so explicitly (a `truncated: true`-style flag) rather than silently drop rows —
  exact cursor shape `NEEDS_DETAIL_REVIEW` pending a real volume estimate.
- **Cache headers**: identical to every existing operations/custody/booking read —
  `Cache-Control: private, no-store` (`custody-http.ts`/`booking-http.ts`/`operations-http.ts`'s
  shared `privateHeaders`/`headers` constant).
- **Session stamp handling**: identical `x-zao-session` hash check against
  `createHash('sha256').update(s.stamp)` already used by every existing staff read
  (`custody-http.ts`, `operations-http.ts`).
- **Error semantics**: `401` unauthenticated, `403` forbidden store/permission (never a partial
  200 with redacted rows), `422` invalid `store`/`date`, `503` if the operations pool is
  unconnected — matching the existing `FlowError` code/status conventions used by every sibling
  endpoint.
- **No mutations**: this endpoint only ever issues read queries; acknowledging an exception stays
  on the existing `/api/operations/exception-acknowledge` endpoint, unchanged.
- **Stale/race-sensitive facts**: every fact is read inside one `REPEATABLE READ READ ONLY`
  transaction (§9.4), so the response is internally consistent as of one instant; it is not a
  live subscription, and a staff member can always drill into `/staff/rentals?booking=<id>` for
  the authoritative, freshest single-booking view (unchanged from UX-5A).

## 6. Response schema (proposed, not implemented)

```jsonc
{
  "store": "MOUNTAIN_BASE",
  "date": "2026-09-20",
  "generatedAt": "2026-09-20T01:00:00.000Z", // inventory_clock() at read time, for staff-visible staleness only
  "truncated": false,
  "rows": [
    {
      "bookingId": "…uuid…",           // secondary detail/navigation target only, per TD's UX shape
      "displayName": "…",              // contact.displayName
      "period": { "startDate": "2026-09-20", "endDate": "2026-09-20", "slot": "DAY" },
      "pickupStore": "MOUNTAIN_BASE",
      "returnStore": "MOUNTAIN_BASE",
      "bookingState": "CONFIRMED_DEV", // raw state, safe — already returned by list()
      "totalJpy": 13800,               // omitted if price_snapshot cannot be trusted (should not happen; see view())
      "equipmentCount": 3,             // count of distinct requirement keys under conditions.members
      "pickup": {                      // omitted entirely if principal lacks RENTAL_CHECKOUT
        "isPickupToday": true,
        "prepared": true,              // rental_preparations.prepared_at IS NOT NULL
        "checkedOut": false,           // EXISTS rental_loan_items WHERE booking_id=? AND state='OUT'
        "noPickup": false,             // EXISTS rental_no_pickup_events
        "timing": "PICKUP_WINDOW"      // pickupTiming(period, generatedAt) — reused, not reinvented
      },
      "return": {                      // omitted entirely if principal lacks RENTAL_RETURN
        "isReturnToday": false,
        "outCount": 3,                 // rental_loan_items state='OUT' due today
        "receivedCount": 0,            // rental_custody_events applied for this booking's loan items
        "inspectionPendingCount": 0    // received but no rental_inspection_events row
      },
      "exception": {                   // omitted entirely if principal lacks OPERATIONS_VIEW
        "attention": false,
        "count": 0,
        "topSeverity": null            // "INFO"|"WARN"|"ERROR"|null
      },
      "nextAction": "COMPLETE"         // §7; always present, computed only from the facts above
    }
  ]
}
```

No raw provider/payment id, capability token, email, or password/session material appears
anywhere in this shape — only what §2 already established is safe to expose (the existing
`list()`/`checkoutView`/`returns()` reads already surface booking id, display name, state, and
period; nothing here goes further than that).

## 7. Server-derived next-action classification

A finite, display-only enum computed **only** from the facts in §6, entirely server-side, using
`pickupTiming` (§2.9) as the base pickup-timing signal and the existing custody/receipt/inspection
presence facts for the rest. This never encodes payment/inventory truth in the browser — the
browser only ever displays the string the server returned.

| Class | Source facts (all pre-existing) | Notes |
| --- | --- | --- |
| `CHECK_PAYMENT_OR_EXCEPTION` | `bookingState IN ('PAYMENT_PENDING','PAYMENT_REVIEW')`, or `exception.attention` true for this booking | Cannot contradict `rental_validate_loan`'s own `CONFIRMED_DEV`/`payment_state='SUCCESS'` checkout guard — this class exists so staff never attempt pickup on a row the server would reject anyway. |
| `PREPARE_EQUIPMENT` | `bookingState='CONFIRMED_DEV'`, `pickup.prepared=false`, `pickup.timing` is `PICKUP_WINDOW` or `LATE_PICKUP_ELIGIBLE` | Mirrors `rental_validate_loan`'s `CUSTODY_PREPARATION_REQUIRED` precondition. |
| `CHECKOUT` | `pickup.prepared=true`, `pickup.checkedOut=false`, same timing gate | Mirrors the `allocation_stage='PREPARATION_FIXED'` precondition already enforced server-side at actual checkout time; this class is advisory only — the real gate stays in `rental_validate_loan`. |
| `OUT_WAIT_RETURN` | `pickup.checkedOut=true`, `return.outCount>0`, not due today | |
| `RECEIVE_RETURN` | `return.isReturnToday=true`, `return.outCount>return.receivedCount` | |
| `INSPECTION_PENDING` | `return.inspectionPendingCount>0` | |
| `COMPLETE` | all items `RECEIVED` and inspected, or `pickup.noPickup=true` | |
| `NO_ACTION` | `bookingState='DRAFT'`, or a multiday booking outside the today-pickup/today-return window (§3) | |
| `NEEDS_DETAIL_REVIEW` | any state combination not covered above — e.g. `pickup.timing='OUTSIDE_HANDOVER_WINDOW'` with `prepared=false` and same-day return already flagged, or partial checkout (some requirement keys `OUT`, others not, which today's schema does not appear to allow per the `rental_active_requirement` uniqueness but is not proven impossible by this design pass) | Per the TD's explicit instruction: if a state cannot be safely derived, classify here rather than guess. This class is the deliberate escape hatch, not a bug. |

Every class above is computed from a fact that already exists and is already independently
enforced by a real guard (`rental_validate_loan`, `rental_apply_receipt`,
`rental_apply_inspection`, `rental_complete_no_pickup`); the classification can suggest an action
but never substitutes for the mutation endpoint's own re-validation, exactly as UX-5A's Today
card already does today.

## 8. UX response shape

Already reflected in §6. Explicitly excluded per the TD's instruction: raw provider ids
(`rental_payment_attempts.provider_id`), capability/session tokens, `contact.email` (not
operationally necessary for a list view — the existing `/staff/rentals?booking=` detail view
already exposes what's needed once a staff member opens a specific booking), and the full
`price_snapshot`/`priceSha256` integrity payload (only the display total).

## 9. Query/read-model plan

### 9.1 Read sequence (service-composition plan, not SQL to be written yet)

1. One query: bookings whose `conditions->>'pickupStore'=$store OR conditions->>'returnStore'=$store`
   (matching `list()`'s existing predicate shape) **and** (`(conditions->'period'->>'startDate')::date=$date`
   for the pickup half **or** exists a `rental_loan_items` row for that booking with
   `due_at::date (AT TIME ZONE 'Asia/Tokyo')=$date` for the return half) — collect the resulting
   `bookingId` set once.
2. One batched query: `rental_preparations WHERE id = ANY($bookingIds)` (PK lookup, no fan-out).
3. One batched query: `rental_loan_items WHERE booking_id = ANY($bookingIds)`.
4. One batched query joining `rental_custody_events`/`rental_inspection_events` keyed by the
   `loan_item_id` set collected from step 3 (mirrors `returns()`'s existing single-JOIN shape,
   just parameterized by a batch of ids instead of a whole store).
5. One batched query: `rental_no_pickup_events WHERE booking_id = ANY($bookingIds)`.
6. One `ops_list_exceptions`-equivalent read for the store (reusing that existing function,
   already a single bounded query), then group its rows by `booking_id` in application code.
7. Compose §6/§7 per booking in application code from the in-memory batch results.

This is 6 bounded queries total regardless of row count (no per-booking query), directly avoiding
N+1 — the existing `assignment()` (`custody-service.ts:28`) pattern of several sequential queries
is fine for a *single* booking's detail view but must not be repeated per row for a manifest.

### 9.2 Existing indexes usable as-is

`rental_preparations` PK (`id`), `rental_active_requirement`/`rental_initial_requirement` on
`rental_loan_items`, the `UNIQUE` indexes on `rental_custody_events.loan_item_id` and
`rental_inspection_events.loan_item_id`, `rental_no_pickup_events` PK, `ops_exception_recent`.

### 9.3 Indexes this design believes would be needed — DESIGN_GATE, not authorized here

- `rental_bookings`: an expression index on `(conditions->>'pickupStore')`,
  `(conditions->>'returnStore')`, and `(conditions->'period'->>'startDate')` — today's `list()`
  already pays this same full-scan cost, so the manifest does not make an existing gap worse, but
  a manifest queried once per shift-start by every staff member is a plausible reason to finally
  add it. **No migration is proposed in this document; this is flagged for a future, separately
  reviewed migration.**
- `inventory_holds(pickup_store, occupancy_start)` / `(return_store, occupancy_end)` — would let
  the pickup/return date filters above use an index instead of a sequential scan once volume
  grows. Same DESIGN_GATE status.
- `ops_exceptions(booking_id)` — to avoid a sequential scan when grouping exceptions by booking in
  step 6 above at real volume. Same DESIGN_GATE status.

Target upper bound: `NEEDS_DETAIL_REVIEW` — this design has no real production booking-volume
number to size "a normal two-store daily manifest" against; the synthetic fixtures in §10 exercise
correctness, not a throughput target. Whoever approves the eventual index migration should also
set this number from real (or realistically projected) daily booking counts.

### 9.4 Repeatable-read consistency

Wrap steps 1–6 in one `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY` transaction — the exact
mechanism `BookingService.get()` already uses (`booking-service.ts:30`) for a consistent
multi-query read. No new consistency primitive is proposed.

### 9.5 N+1 avoidance

Covered by §9.1's batching. The one intentional exception is that step 6's exception rows are
grouped in application code rather than a SQL `GROUP BY`, since `ops_list_exceptions` is an
existing opaque function or an existing route already used by `OperationsConsole`, not a query the
manifest is meant to reimplement.

## 10. Test plan (synthetic PostgreSQL fixtures only; no implementation in this phase)

Modeled on the existing `startDevelopmentApp`/`writeAccount`/`HoldService`+`QuoteService`+
`BookingService`+`CustodyService` fixture pattern already used by `tests/staff/home-ui.ts` and
`tests/operations/console-ui.ts` in this repo:

1. **Store-scope isolation**: a booking at `ONSEN_BASE` must never appear in a `MOUNTAIN_BASE`
   manifest request, for a principal with access to both stores.
2. **Permission composition**: the five rows of §4's table, each asserted against a real
   synthetic account (mirroring the `ux5a-full`/`ux5a-narrow`/`ux5a-inverse` account pattern from
   `tests/staff/home-ui.ts`) — including the `BOOKING_VIEW=false` inverse composition already
   proven necessary by UX5R-04.
3. **Today pickup**: a booking with `occupancy_start=today` appears with `pickup.isPickupToday`.
4. **Multiday ongoing rental**: a booking spanning `today` but not starting/ending today does not
   appear as a pickup or return row (§3's default), and this behavior is asserted explicitly (not
   merely absence-by-omission) so a future change to the inclusion rule fails a test on purpose.
5. **Cross-store return**: a booking picked up at one store and returned at the other still
   attributes its return-side facts to the *return* store's manifest, not the pickup store's.
6. **Prepared but not checked out**: `rental_preparations.prepared_at` set,
   `rental_loan_items` absent → `nextAction='CHECKOUT'`.
7. **Checked out and due today**: `state='OUT'`, `due_at` today → `nextAction` is
   `RECEIVE_RETURN` once return-due, `OUT_WAIT_RETURN` before.
8. **Returned but inspection pending**: `rental_custody_events` row exists,
   `rental_inspection_events` does not → `nextAction='INSPECTION_PENDING'`.
9. **No-pickup completion**: `rental_no_pickup_events` row exists → `nextAction='COMPLETE'`,
   never `PREPARE_EQUIPMENT`/`CHECKOUT`.
10. **Payment/transfer exception → detail review**: a booking with a live `PAYMENT_PENDING` or
    `inventory_holds.transfer_attention` fact classifies as `CHECK_PAYMENT_OR_EXCEPTION`, not
    `PREPARE_EQUIPMENT`.
11. **Concurrent state change / repeatable-read consistency**: start the manifest's transaction,
    mutate a loan item's state in a separate connection mid-read, and assert the manifest response
    reflects one consistent snapshot rather than a mix of before/after facts — analogous to the
    existing response-loss/reload regression pattern already used throughout this repo's UI tests.
12. **Zero client-side state inference**: an end-to-end UI-level assertion (once implemented) that
    the rendered next-action text always matches the server-returned `nextAction` string verbatim,
    with no client computation from `bookingState` alone — the same category of regression
    UX5R-01 added for the existing Today card.

## 11. Explicit out-of-scope (this phase)

No schema/migration. No new business-state table. No materialized cache. No Production
activation. No main merge. No Staff Home implementation change (this document itself is the only
artifact produced). No endpoint implementation — §5/§6 are proposals for the next, separately
authorized phase.

## 12. Open design gates (`NEEDS_DETAIL_REVIEW` summary)

1. §2.9 — whether the return section stays per-actor (matching today's `CustodyService.returns`)
   or becomes store-wide for the manifest.
2. §3 — whether a multiday ongoing rental (neither pickup nor return today) should get a third
   manifest bucket.
3. §5 — exact pagination/cursor shape if a store's daily volume ever exceeds a single bounded page.
4. §7 — whether a partial-checkout state (some requirement keys `OUT`, others not) is actually
   reachable under the current schema; treated as `NEEDS_DETAIL_REVIEW`/`NEEDS_DETAIL_REVIEW`
   fallback rather than assumed impossible.
5. §9.3 — the real index migration shape and the throughput target it should be sized against.
6. UX-5A's own Today section computing "today" from browser time (§3) — flagged, not fixed, in
   this document; a correction would be separate follow-up work, not part of UX-5B.

## Submission

Posting `ZAO_UIUX_V2_STAFF_MANIFEST_DESIGN_READY_FOR_TD_REVIEW` on PR #26 per the authorizing
comment. No endpoint implementation proceeds until the TD explicitly approves this design.
