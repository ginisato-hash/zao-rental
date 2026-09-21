# UX-5D — Staff Home Manifest integration evidence

Authority: PR #26 comment [`5751536035`](https://github.com/ginisato-hash/zao-rental/pull/26#issuecomment-5751536035)
(Technical Director — UX-5C SERVER PASS / UX-5D Staff Home integration authorization).
This batch is UI/integration only: no Manifest server business semantics, Branch A/B/C/D SQL,
`nextAction`/`taskAction` classification, custody/wear mutation logic, schema, permission, or
pricing/HOLD/payment change is made anywhere in this diff.

## Current final state (as of UX-5E, HEAD `999d1fd`)

`apps/web/src/components/StaffHome.tsx` has three layers of correction on top of the §1–§14
UX-5D baseline below, each closing findings from an independent TD review:
§15 (UX-5D correction batch 1 — R01/R02/R03 store-switch/staleness races, TD comment
`5751679611`) and §16 (UX-5E — the initial-Manifest-failure retry trap, TD comment `5754989874`).
§1–§14 remain the accurate description of the overall integration (Manifest as the sole
operational data source, `activeStore`, server-date authority, action-label mapping,
CUSTODY_ONLY rendering, pagination) — §15 and §16 only change *how failures and races during
that integration are handled*, never what the Manifest server returns or how it is interpreted.

## 1. Scope delivered

- `apps/web/src/components/StaffHome.tsx` now consumes `GET /api/operations/manifest` as the
  single operational data source for the "本日の業務" (Daily Manifest) section, in place of the
  old separate `/api/custody/returns` and `/api/operations/exceptions` summary fetches.
- `apps/web/src/components/staff-home.css` — two small rules for the new action/attention text.
- `tests/staff/home-ui.ts` — extended with the required UX-5D coverage (§9).
- `docs/execution/prelaunch-uiux-v2/STAFF_MANIFEST_SERVER_IMPLEMENTATION.md` §2 corrected to
  describe the two-snapshot architecture (the non-blocking follow-up from TD comment `5751536035`),
  no longer the pre-UX5C-R01 single-transaction description.
- This document.
- No file under `packages/`, `packages/db/migrations`, `scripts/operations-roles.ts`, or any
  payment/HOLD/pricing/recommendation/Square code was touched.

## 2. Before / after Staff Home data sources

| Concern | Before (UX-5A) | After (UX-5D) |
| --- | --- | --- |
| Business "today" | `todayJst()` — browser `Intl.DateTimeFormat`, independent of the server | `GET /api/operations/manifest`'s own server-authoritative `date` field (`inventory_clock()`), fetched once for every `BOOKING_VIEW` principal regardless of composition |
| Pickup/return progress | `GET /api/custody/returns?store=<returnStore>` (batch count + naive `inspection_id IS NULL` count) | `GET /api/operations/manifest` rows' `pickup`/`return` sub-objects and server `nextAction`, rendered as task cards |
| Operational exceptions | `GET /api/operations/exceptions?store=<opsStore>&ageHours=0&status=UNACKNOWLEDGED`, listing up to 5 raw exceptions independently | Manifest's per-row `exception.attention`/`count`/`topSeverity` (observational only, §6), plus a static `/admin/ops` link for full detail |
| Store selection | two independent selectors: `returnStore` (返却の進行状況) and `opsStore` (運用の注意事項) | one `activeStore` selector, shown once in "本日の業務", driving the single Manifest request |
| CUSTODY_ONLY (actual-store-only) tasks | not represented at all (`/api/custody/returns`'s `received` list was never rendered as staff-facing cards) | rendered as minimal task cards (§7) |

`todayJst()` has been deleted from `StaffHome.tsx` entirely; nothing in the component computes a
business date from browser time anymore.

## 3. `activeStore` behavior

`activeStore` (`useState<StoreId>(stores[0])`) is the single selector for the operational Manifest
section. The fetched rows are tagged with the store they were fetched for
(`manifestState:{store,rows,cursor,hasMore}`); the rendered `manifestRows` is derived as
`manifestState.store===activeStore ? manifestState.rows : null` rather than being reset
imperatively inside the store-change effect. This means a stale previous-store card is
structurally impossible to render even for a single frame: the moment `activeStore` changes,
the derived value is `null` (rendered as the loading state) until the fresh response for the new
store lands and is tagged with it. Verified by `tests/staff/home-ui.ts`'s
"switching the active store discards the previous store's task cards immediately" case, which
selects `ONSEN_BASE` (a store with genuinely no equipment stock in the fixture) and asserts the
prior store's card is gone (`toHaveCount(0)`) and the real empty state is shown, not a residual
card.

An explicit "更新" refresh *within the same store* deliberately does **not** clear rows first —
`loadManifest(activeStore,null,false)` only replaces `manifestState` once the response arrives,
so a same-context refresh keeps showing the last confirmed data while in flight, per the
"loading state must not erase already-confirmed current-store data unless context changed"
requirement.

## 4. Server date authority

Every `BOOKING_VIEW` principal (not only those with checkout/return capability) triggers one
Manifest fetch on mount, purely to obtain the server's `date`. For a `BOOKING_VIEW`-only
principal this returns an empty `rows` array (candidate branches are permission-gated server-side
and never even queried, per the accepted UX-5C server), but `date` is still computed and returned
— it does not depend on checkout/return authorization. The informational "本日の予約" list now
filters `/api/bookings` using this `manifestDate`, not `todayJst()`; before the first Manifest
response arrives, the section shows "業務日付を確認しています…" rather than rendering a
(potentially wrong) filtered list against no known date yet.

`tests/staff/home-ui.ts` pins `inventory_clock()` to a fully synthetic business date
(`2035-06-16`), deliberately divorced from the real wall-clock date the CI runner happens to be
on. The suite asserts the "本日の予約" region literally contains that string. This is only
possible if the client used the server-provided date: a browser-clock-derived date would show the
real current year instead.

## 5. `BOOKING_VIEW`-only behavior preserved

The `narrow` (BOOKING_VIEW-only) test account still sees "本日の予約" (server-date-filtered,
read-only, no per-card action button) and the QR/search, "本日の業務", and "運用の注意事項"
regions are absent — identical visibility rules to the UX-5A-accepted behavior, just re-sourced.
No hidden operational candidacy is exposed to this composition: since Manifest returns empty rows
for it server-side already (UX-5C, unchanged here), there is nothing for the client to filter or
hide — the section simply isn't rendered for this composition at all, matching the original
design.

## 6. Server action mapping

`ACTION_LABEL`/`TASK_ACTION_LABEL` (`StaffHome.tsx`) are pure presentational `Record<string,string>`
lookups from the server's own `nextAction`/`taskAction` enum values to a Japanese label, exactly
the ten/four values documented in the design and this authorization comment. `actionLabel()`/
`taskActionLabel()` fail safe to `詳細確認` for any value not in the map — verified by a dedicated
test that intercepts the Manifest response with a fabricated `nextAction:'FUTURE_ACTION_NOT_YET_INVENTED'`
and asserts the card shows `詳細確認`. No other code path computes, infers, or overrides an action
from booking state, counts, or any other field — `bookingRow`/`custodyOnlyEquipmentRow`/
`custodyOnlyWearRow` in the server remain the only place `nextAction`/`taskAction` are decided.

A `BOOKING_SCOPED` row's action button (`{label}へ進む`, opening `/staff/rentals?booking=<id>`)
only renders when `nextAction` is in a fixed `ACTIONABLE` set (every class except `COMPLETE`/
`NO_ACTION`) — never for a booking with nothing left to do.

## 7. `CUSTODY_ONLY` rendering

`ManifestCustodyRow`'s type carries exactly the fields the server returns for this row kind
(`sourceStore`,`actualStore`,`family`,`taskState`,`taskAction`, and the equipment-only/wear-only
optional fields `requirementKey`/`size`/`age`) — no `bookingId`, `displayName`, price, or booking
period/state field exists on this type at all, so there is nothing for the component to
accidentally render or infer from. The card shows only `family` (+ size/age or requirement key),
`sourceStore→actualStore`, and the `taskActionLabel()` mapping of the server's own `taskAction`.

Verified end-to-end by `tests/staff/home-ui.ts`'s dedicated CUSTODY_ONLY case: a booking planned
entirely at `MOUNTAIN_BASE` is received at `ONSEN_BASE`; a principal scoped only to `ONSEN_BASE`
sees the resulting card and the test asserts the card contains `SKI`/`MOUNTAIN_BASE`/`ONSEN_BASE`/
`検品` (the server `taskAction=INSPECT` mapping) and does **not** contain the booking's real
display name, its booking id, any booking-state label, or the business date (proving no period
leak either, since the type doesn't carry `period` for this row kind).

## 8. Exception handling

Manifest's `exception.attention`/`count`/`topSeverity` are rendered as a `要注意` badge on
`BOOKING_SCOPED` cards only when `OPERATIONS_VIEW` is present (the field is `undefined` and thus
never rendered otherwise) and never influence `actionLabel()`'s input — the badge and the action
label are two independent pieces of the same row's already-server-decided facts. Staff Home issues
no `/api/operations/exceptions` request anywhere; the "運用の注意事項" section is now a static
description plus an `/admin/ops` link, with no data fetch of its own.

Verified by a dedicated test: a generic `ops_exceptions` row is inserted directly for a booking
already showing `検品待ち` (`INSPECTION_PENDING`); after reload the card still reads `検品待ち`
and now additionally shows `要注意` — proving the exception changed only the attention badge, not
the action.

## 9. Pagination

The opaque `nextCursor` is never decoded — `loadManifest()` only ever forwards it back verbatim as
the next request's `cursor` query parameter. `hasMore` renders an explicit `さらに読み込む` button
(no automatic full-walk). Appended pages are deduplicated by the server's own row `key`
(`new Set(priorRows.map(r=>r.key))`), verified by a dedicated test that intercepts two mocked
pages where the second page intentionally repeats the first page's row key and asserts the
rendered card count for that key stays at exactly one after "さらに読み込む". A store/date/section
context change (i.e. any `activeStore` change) never appends onto the prior context's rows — see
§3.

## 10. QR/search preserved

`BookingSearchInput` is untouched and still renders first, ahead of every Manifest-derived section,
for any principal with effective pickup capability. `tests/staff/home-ui.ts` keeps the existing
QR-payload-text search case, confirming it still lands the staff member preselected into the real
pickup workflow at `/staff/rentals?booking=<id>`.

## 11. Screenshots

`.local/screenshots/staff-home-390.png`, `.local/screenshots/staff-home-1440.png` (full-capability,
both regenerated against the new Manifest-driven layout), `.local/screenshots/staff-home-custody-only-390.png`
(the `ONSEN_BASE`-only principal's CUSTODY_ONLY card, at 390px), and
`.local/screenshots/staff-rentals-preselected-390.png` (unchanged pickup-workflow screen) are
produced by `tests/staff/home-ui.ts`'s screenshot case and uploaded as the `foundation-<sha>`
Foundation CI artifact (`.github/workflows/ci.yml`'s `upload-artifact` step already includes
`.local/screenshots/`). No horizontal overflow is asserted (`scrollWidth<=innerWidth+1`) at both
widths before each screenshot is taken.

## 12. Local test results

`npm run lint` PASS · `npm run typecheck` PASS · `npm run build` PASS · `npm run check:secrets`
PASS · `npm run test:operations-manifest` **29/29 PASS** (unchanged; this batch touches no
Manifest server code) · `npm run test:operations-console` PASS · `npm run test:custody` PASS ·
`npm run test:wear` PASS.

`npm run test:staff-home-ui` and `npm run test:auth` were **not run locally**: both require
`startDevelopmentApp`, which binds this worktree's single deterministic web port
(`scripts/worktree.ts`'s `worktreeIdentity()`), already held by this worktree's long-running
maintained UI review server (`.local/ui-review/server.ts`) — the same pre-existing, unrelated
environmental conflict recorded for the UX-5C submissions. `tests/staff/home-ui.ts` was
extensively rewritten this batch and could not be exercised locally as a result; it was verified
by `npm run lint`/`npm run typecheck` (both clean) and careful manual review of every Playwright
locator/assertion against the actual rendered markup, and is verified for real by Foundation CI
(§13), which runs in an environment with no such port conflict.

## 13. Foundation CI

One consolidated Foundation CI run at the UX-5D candidate HEAD is required before submission; its
run id, conclusion, and confirmation that `test:auth`/`test:staff-home-ui` actually executed and
passed (via the same "the fixed command list exits on first failure, and later commands ran" proof
used for the UX-5C submissions, plus direct log inspection) are recorded in the PR submission
comment, not duplicated here to avoid a second source of truth for a fact that can change between
writing this document and pushing.

## 14. Business/server semantics unchanged

No file under `packages/core/src/operations/manifest-service.ts`, any custody/wear service, any
migration, `scripts/operations-roles.ts`, or any auth/permission/pricing/HOLD/payment code was
modified in this batch. `git diff --stat` against the UX-5C-accepted HEAD is limited to
`apps/web/src/components/StaffHome.tsx`, `apps/web/src/components/staff-home.css`,
`tests/staff/home-ui.ts`, this document, and the one corrected paragraph in
`STAFF_MANIFEST_SERVER_IMPLEMENTATION.md` §2.

## 15. UX-5D Correction Batch 1 (R01/R02/R03)

Authority: PR #26 comment [`5751679611`](https://github.com/ginisato-hash/zao-rental/pull/26#issuecomment-5751679611)
(Technical Director — pre-CI REQUEST_CHANGES against candidate HEAD `fd59e51`). Client-only
correction; no Manifest server file was touched. Base candidate HEAD `fd59e51` also failed its
own Foundation CI run (`35528279806`) at test #4 for an unrelated pre-existing test-assertion bug
(§15.4), fixed in the same pass as these three findings since the same file was already open.

### 15.1 UX5D-R01 (HIGH) — in-flight-request race on active-store switch

`useOperationsRequest`'s single `lock.current` silently dropped the fresh store's request when a
switch happened while the previous store's request was still in flight, and the same held for a
load-more request in flight during a switch — leaving the UI showing no Manifest rows for the new
store until a manual refresh. Fixed by removing `useOperationsRequest` from the Manifest path
entirely: `loadManifest()` in `StaffHome.tsx` now fires its own `fetch()` unconditionally on every
call (initial load, store switch, load-more, refresh — never gated by a lock), and increments a
`useRef` generation counter (`manifestGeneration`) at call start. A response is only applied to
`manifestState` if its generation still matches `manifestGeneration.current` at resolution time;
an old, now-superseded response is silently discarded instead of corrupting the new store's state.
Verified by two new deterministic Playwright tests using `page.route()` with a manually-held
`Promise` gate: one holds the old store's initial request, switches store via the (never-disabled)
`<select>`, and asserts the new store's request fires and its row renders before the old response
is released, and that the old response's row never appears afterward; the second does the same for
a load-more request in flight during a switch.

### 15.2 UX5D-R02 (MEDIUM) — `manifestDate` not context-tagged

`date` was previously a standalone `useState` updated unconditionally by every Manifest response,
independent of `manifestState`'s store tag — a late, obsolete response could silently overwrite
the displayed business date even while its rows were correctly hidden. Fixed by moving `date`
inside the same store-tagged `manifestState` object and deriving `manifestDate` from
`forActiveStore` (`manifestState.store===activeStore?manifestState:null`) exactly like
rows/cursor/hasMore, so an obsolete-generation response can never reach the displayed date either.
Verified by a new test that holds the old store's response (carrying a deliberately different
`date`), switches store, and asserts the new store's date is shown immediately and the stale date
never appears even after the held response is released.

### 15.3 UX5D-R03 (MEDIUM) — BOOKING_VIEW-only Refresh did not refresh the Manifest date

The "本日の予約" section's only Refresh button reloaded `/api/bookings` alone
(`bookingsReq.load('/api/bookings', setBookings)`), leaving the hidden, authoritative Manifest
date fetch untouched — a BOOKING_VIEW-only principal's page could keep filtering Today against a
stale date across a business-date boundary until a full reload. Fixed by adding `refreshToday()`,
which calls both `bookingsReq.load(...)` and `loadManifest(activeStore,null,false)`, and wiring it
to the "本日の予約" section's Refresh button for every permission composition (the "本日の業務"
section's own Refresh/load-more buttons are unchanged, calling `loadManifest` directly). Verified
by a new test where a `narrowPage`-scoped route returns the business date on its first call and a
later date on every subsequent call; clicking the only visible Refresh button is asserted to move
the displayed date to the later value, with "本日の業務" confirmed absent throughout (never
exposed to this composition).

### 15.4 Retroactive test-assertion fixes (found via manual re-derivation, not new findings)

Three pre-existing assertions in `tests/staff/home-ui.ts` were corrected in the same pass, found by
manually re-deriving expected server state before trusting untestable-locally Playwright code
(this worktree cannot run `test:staff-home-ui` locally; see §12/§13):

- The "Today booking card action is gated by RENTAL_CHECKOUT" case asserted `貸出` (CHECKOUT)
  before the booking had actually been prepared; the true `nextAction` at that point is
  `PREPARE_EQUIPMENT` (`準備`) — this is what Foundation CI run `35528279806` caught at candidate
  HEAD `fd59e51`. Corrected to assert/click `準備`/`準備へ進む`.
- The post-checkout manifest assertion expected `貸出中` (OUT_WAIT_RETURN), but this fixture's
  booking is a single-day `DAY`-slot rental, whose `dueAt` calendar date (`normalizePeriod()`,
  `packages/contracts/src/hold.ts`) equals the pickup date itself — so `equipmentReturnDueToday`
  is already true immediately after checkout, and the server correctly returns `返却受付`
  (RECEIVE_RETURN), never `貸出中`. Corrected the assertion accordingly.
- The "switching the active store" test was positioned after the CUSTODY_ONLY test, by which point
  ONSEN_BASE legitimately holds real data (received there by the owner's ALL-scope account,
  visible to it as BOOKING_SCOPED) — breaking its "ONSEN_BASE is empty" precondition. Reordered to
  run immediately before the CUSTODY_ONLY test, while ONSEN_BASE is still genuinely empty for
  every account.

### 15.5 Verification

`npm run lint` PASS · `npm run typecheck` PASS · `npm run build` PASS · `npm run check:secrets`
PASS · `npm run test:operations-manifest` **29/29 PASS** (unchanged — no Manifest server file
touched in this batch) · `npm run test:operations-console` PASS · `npm run test:custody` PASS ·
`npm run test:wear` PASS. `git diff --stat` against the prior UX-5D HEAD (`fd59e51`) is limited to
`apps/web/src/components/StaffHome.tsx` and `tests/staff/home-ui.ts`. `test:staff-home-ui` and
`test:auth` were again not run locally (§12's port-conflict constraint, unchanged); this batch's
four new race/staleness tests are consequently verified for real only by the one consolidated
Foundation CI run recorded in the PR submission comment for this correction batch, whose log was
checked line-by-line (not just its overall conclusion) given this file's history of two prior
locally-uncaught bugs this session.

## 16. UX-5E — final acceptance: initial-Manifest-failure trap fixed for BOOKING_VIEW-only

Authority: PR #26 comment `5754989874` (Technical Director — UX-5D UI PASS / UX-5E final
integrated acceptance authorization). UX-5E's own explicit failure-state acceptance check (item 4
of that authorization) found one concrete current-head UI regression, fixed here in UI/test scope
only; no Manifest server file was touched.

### 16.1 The bug

In "本日の予約" (Today), the Refresh button and all of its content were nested inside
`{manifestDate?<>...</>:<p role="status">業務日付を確認しています…</p>}`. If the very first
Manifest read ever failed for any reason other than 401/403 (409/503/a network failure —
401/403 already end the session view via `invalidateStaffView`, which is unaffected by this bug),
`manifestState.store` stayed `null` forever, so `manifestDate` stayed `null` forever, so the
branch rendering the Refresh button never rendered at all. For a BOOKING_VIEW-only principal —
`showManifest` is false, so "本日の業務" (the section with its own, always-visible Refresh
button) never renders either — this left the "業務日付を確認しています…" text as a dead end
with **no control anywhere on the page** that could ever retry the read. A full page reload was
the only escape.

### 16.2 The fix

`apps/web/src/components/StaffHome.tsx`: moved the Refresh button and its status line out from
behind the `manifestDate` gate so they render unconditionally for every `canBookingView`
principal; the date-dependent booking list/secondary text remain gated on `manifestDate` so a
failed read still never fabricates a successful empty day. The status line now shows the real
error message when one exists, falling back to "業務日付を確認しています…" only while nothing —
success or failure — has resolved yet.

### 16.3 Verification of the four failure-state acceptance requirements

- **Never present a failed Manifest fetch as a successful empty operational day** — confirmed
  already correct pre-fix (rows/date only ever come from a successful response) and unaffected by
  the fix; both sections render nothing date/row-dependent while `manifestDate` is null.
- **BOOKING_VIEW-only must not be trapped indefinitely on 業務日付を確認しています…** — fixed;
  see 16.1/16.2.
- **A recoverable visible retry path must exist without exposing hidden operational sections** —
  fixed; the "本日の予約" Refresh button is now always visible for this composition, and
  "本日の業務" is never rendered for it (unchanged `showManifest` gating).
- **Same-context refresh may preserve previously confirmed rows; context changes must not** —
  confirmed already correct pre-fix (a failed refresh never calls `setManifestState`, so the last
  confirmed rows/date stay visible; a store switch is still governed by the UX5D-R01/R02
  generation-and-tagging mechanism, untouched here) and unaffected by the fix.

Three new deterministic Playwright tests added to `tests/staff/home-ui.ts`:
`UX5E-01` (the exact bug above: initial 503 on a BOOKING_VIEW-only page, Refresh visible/enabled
throughout, recovers on click), `UX5E-02` (409/503/network-failure on the full-capability page's
"本日の業務" Refresh each surface a non-empty status, never fabricate the empty-day message, and
never remove the real already-confirmed row), `UX5E-03` (a Manifest 401/403 still ends the session
view via the existing `StaffSessionBoundary` mechanism, confirming the new unconditional status
line never swallows or shadows that path).
