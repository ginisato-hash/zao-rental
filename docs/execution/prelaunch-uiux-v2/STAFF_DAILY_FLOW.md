# Staff Daily Flow — UX-5A operational dashboard — evidence

Authority: PR #26 comment [`5747279731`](https://github.com/ginisato-hash/zao-rental/pull/26#issuecomment-5747279731)
(Technical Director — Customer simplification PASS, Phase UX-5 Staff Daily Flow authorization,
UX-5A implementation batch, UX-5B DESIGN_GATE).

Commit: `0facf8c` (code/tests/screenshots).

## UX-5A — implementation

| Item | Change | File(s) |
| --- | --- | --- |
| Staff Home → operational dashboard | `/staff` no longer renders the one-link page. It now renders `StaffHome`: reservation QR/search, Today, Pickup/immediate work, Returns in progress, Exceptions (compact), then a collapsed secondary Ledger/Admin links section — each section gated on the actual staff permission it needs (`BOOKING_VIEW`, `RENTAL_CHECKOUT`, `RENTAL_RETURN`, `OPERATIONS_VIEW`), never a role/route heuristic. | `app/staff/page.tsx`, `components/StaffHome.tsx`, `components/staff-home.css` |
| Booking search / reservation QR | New `BookingSearchInput` accepts a canonical booking UUID or the existing `zao-rental:reservation:<uuid>` QR payload (manual input or camera scan). It never creates a new QR format or booking identifier, and never touches `AssetQrInput`/`assetIdFromQr` (Asset-only, unchanged). A new client-safe `bookingIdFromInput` in `packages/contracts/src/reservation-qr.ts` mirrors the existing server-only `parseReservationQr` (same prefix/ID shape) without pulling `node:crypto` into the client bundle. | `components/BookingSearchInput.tsx`, `packages/contracts/src/reservation-qr.ts` |
| Today booking cards | Uses the existing `GET /api/bookings` (already store/permission-scoped server-side). Filters client-side to bookings whose period includes today (Asia/Tokyo). Shows date/slot, guest name, booking state, pickup/return store, total — raw booking ID stays out of the card. "この予約を開く" appears only for `CONFIRMED_DEV`/`COMPLETED_DEV` bookings; other states show text only, so the card never infers pickup/checkout readiness — that stays with the custody detail. | `components/StaffHome.tsx` |
| QR/search → pickup workflow | Both the search box and a Today card's "この予約を開く" navigate to `/staff/rentals?booking=<id>`. `CustodyWorkspace` gained an additive `presetBooking` prop: on mount, if `canCheckout` and the value round-trips through the same `bookingIdFromInput` validation, it prefills the existing booking field and fires the exact same `/api/custody/booking/:id` lookup the button already performed. No existing aria-label, button text or DOM order changed, so the whole existing custody test surface (`test:custody`, `test:custody-ui`, `test:late-pickup`) still exercises the same selectors. | `components/CustodyWorkspace.tsx`, `app/staff/rentals/page.tsx` |
| Returns in progress | Staff Home reuses `GET /api/custody/returns?store=` (unchanged) and shows two counts: open return batches, and received-but-not-yet-inspected items. Labelled "進行中の返却" / "検品待ち" — never "本日返却予定", since the endpoint is not a complete today's-expected-returns population (that is exactly the UX-5B gate below). | `components/StaffHome.tsx` |
| Exceptions (compact) | Store-scoped `GET /api/operations/exceptions?...&status=UNACKNOWLEDGED&ageHours=0` (unchanged), rendered as a short list (severity/type/store) with a link to the existing full `/admin/ops` console. No acknowledge action here — this stays observational and does not duplicate the admin console. Hidden entirely without `OPERATIONS_VIEW`. | `components/StaffHome.tsx` |

### Staff visual rules followed
Mobile card-first (`.staff-card-grid`), 44px minimum targets (`staff-home.css`), one primary action per Today card, raw booking UUID kept out of the card (still shown, unabbreviated, inside the pickup workflow it links to), no new persistent client cache for workflow authority (`useOperationsRequest`'s existing session-storage pending/retry mechanism is only ever used here for plain reads, never a mutation), and every section still unmounts on the existing `StaffSessionBoundary` session-change signal.

## UX-5B — DESIGN_GATE (not implemented)

No new cross-domain Daily Manifest API was added. `Today`, `Returns in progress` and `Exceptions` each read only their own existing, already-scoped endpoint; none of them is presented as a complete expected-pickups/expected-returns-today manifest. A joined, permission/store-scoped read model spanning pickup+return+preparation+checkout+inspection state remains future work requiring its own TD design review, per the authorization comment.

## Hard boundaries confirmed

No changes to pricing/recommendation logic, inventory availability, HOLD duration/start contract, payment idempotency/retry/refund, Square semantics, auth/permission semantics, schema/migrations, or Production config. `AssetQrInput`/`assetIdFromQr` are byte-for-byte unchanged. `CustodyWorkspace`'s existing DOM (aria-labels, button names, ordering) is unchanged outside the additive `presetBooking` effect. No new business-state semantics; the exceptions view remains observational only.

## Regression tests

New `tests/staff/home-ui.ts` (`npm run test:staff-home-ui`), added to `scripts/verify.mjs`:
- Staff Home replaces the one-link page; a narrower (`BOOKING_VIEW`-only) staff account still sees Today/search but not Pickup/Returns/Exceptions.
- A real `CONFIRMED_DEV` booking (created through `HoldService`/`QuoteService`/`BookingService` against a real isolated PostgreSQL, not a fixture object) renders as a Today card and its "この予約を開く" button lands on `/staff/rentals?booking=<id>` with the pickup workflow already showing that booking.
- The booking-search box accepts the `zao-rental:reservation:<uuid>` QR payload text and reaches the same preselected pickup workflow.
- Returns in progress reflects a real open batch, then real received/inspection-pending counts after confirming it.
- The exceptions summary surfaces the real unacknowledged `PAYMENT_PENDING` exception generated by a second, still-pending booking, and the same read is `403` for a staff account without `OPERATIONS_VIEW`.
- Staff Home is usable at 390 and 1440 with no horizontal overflow.

New `tests/unit/reservation-qr.test.ts`: `bookingIdFromInput` accepts a bare UUID or the QR-prefixed string, rejects a left/right split ID, an Asset ID look-alike, or garbage — mirroring the existing `asset-qr.test.ts` contract test.

## Verification

Run from the isolated `prelaunch-uiux-finishing` worktree, never the maintained review server in
`prelaunch-uiux-audit`:

- `npm run lint` — pass (0 errors/warnings)
- `npm run typecheck` — pass
- `npm run build` — pass
- `npm run check:secrets` — pass
- `npm run test:unit` — 700/700 pass (includes the new `reservation-qr.test.ts`)
- `npm run test:auth` — 18/18 pass
- `npm run test:staff-diagnostic` — pass
- `npm run test:custody` / `test:custody-ui` / `test:late-pickup` — pass (existing `CustodyWorkspace` behavior unaffected by the additive `presetBooking` prop)
- `npm run test:operations-console-ui` — pass (existing `/admin/ops` console unaffected)
- `npm run test:staff-home-ui` — 6/6 pass (new)

## Screenshots

- `screenshots/ux5a-after/staff-home-{390,1440}.png` — full dashboard with a real Today card pair, real returns counters and real exception rows
- `screenshots/ux5a-after/staff-rentals-preselected-390.png` — `/staff/rentals?booking=<id>` landing already showing that booking's pickup detail

## Foundation CI

See the `ZAO_UIUX_V2_STAFF_DAILY_FLOW_READY_FOR_TD_REVIEW` report for the run confirmed at this
candidate HEAD.
