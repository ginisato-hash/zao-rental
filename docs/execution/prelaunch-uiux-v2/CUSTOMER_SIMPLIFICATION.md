# Customer copy/hierarchy simplification and visual polish — evidence

Authority: PR #26 comment [`5746076048`](https://github.com/ginisato-hash/zao-rental/pull/26#issuecomment-5746076048)
(Technical Director, UX-1 PASS + Phase UX-2 annotations + Batch UX-3A/UX-4A implementation authorization).

Commits: `6a3300d` (Batch UX-3A), `25d0a6d` (Batch UX-4A), `5637752` (candidate-card CSS fix
found during this batch's own screenshot verification).

## Current final state (as of UX-5E, HEAD `999d1fd`)

This batch (UX-3A/UX-4A plus its UX3R/UX4R correction batch below) was TD-reviewed and PASSed;
no later batch in PR #26 touched customer-facing files again. Everything below — including the
correction batch — remains the accurate, current description of `GuestBooking.tsx`,
`BookingAccess.tsx`, `PublicPage.tsx` and their CSS as of the current HEAD. UX-5E's own final
customer-flow regression re-ran the covering suites (`tests/public/normal-ui.ts`,
`tests/readiness/guest-ui.ts`, `tests/readiness/booking-access-ui.ts`,
`tests/readiness/booking-recovery-ui.ts`), unchanged since this batch, via the consolidated
Foundation CI run recorded in the UX-5E submission comment — this worktree's single deterministic
web port (shared by every `startDevelopmentApp`/`startFlowApp`-based Playwright suite) is held by
its long-running maintained UI review server, so these suites cannot run locally here; see §13 of
`STAFF_MANIFEST_UI_INTEGRATION.md` for the same constraint and its Foundation CI workaround.

## Batch UX-3A — customer copy and hierarchy

| Item | Change | File(s) |
| --- | --- | --- |
| Raw internal enums | `draft.hold.state` / `draft.quote.validity` / EN candidate direction now go through customer-facing copy maps (`HOLD_STATE_COPY`, `QUOTE_VALIDITY_COPY`); unmapped values fall back to generic customer-safe text, never the raw enum. `view.mode` (booking-access) removed — conveyed no customer-actionable information. | `GuestBooking.tsx`, `BookingAccess.tsx` |
| HOLD/reconcile wording | Checkout CTA, its locked-retry state, and the post-confirmation "reconcile payment" button reworded to describe the customer action instead of HOLD/照合 internals. | `GuestBooking.tsx` |
| First-arrival dirty warning | Fixed: the "unsaved changes" banner required only "current input differs from last saved," which was also true for one render right after advancing from a freshly-filled step 0 — before anything on the new step had been touched. Added a `touched` state cleared on every step change and set only inside actual field-edit handlers. | `GuestBooking.tsx` |
| Recovery disclosure | `GuestRecovery` is now collapsed behind a `<details>`/`<summary>` ("予約をお持ちの方はこちら / Already have a booking?") instead of always-expanded. | `GuestBooking.tsx` |
| Result-first confirmed state | The booking-result card now renders immediately under the review heading; the pre-confirmation condition detail (dates/members/price/contact) moves into a secondary `<details>` once a booking exists. | `GuestBooking.tsx` |
| Review copy/order | Disclaimer shortened to the actionable fact ("this estimate is not final"), with the pre-launch tax/terms note demoted to `<small>`; the "選択なし / 選択なし" jacket+pants pairing collapses into one readable line when both are absent. | `GuestBooking.tsx` |
| Reservation dev-unconfigured copy | `/reservation`'s `ConfirmedBooking` now distinguishes a `BOOKING_ACCESS_UNCONFIGURED` (503) response from a genuine denied/expired access, using the explicit error code rather than one shared message. Header aligned to the shared `nav`-based pattern. | `BookingAccess.tsx`, `reservation/page.tsx` |

## Batch UX-4A — customer visual polish

| Item | Change | File(s) |
| --- | --- | --- |
| Candidate comparison | SHORTER/RECOMMENDED/LONGER now render as an explicit 3-card grid in that fixed order, with RECOMMENDED visually primary (border/background). Same server candidates/radios; no client recomputation. | `GuestBooking.tsx`, `guest.css` |
| Renter-card accordion | When the group has more than one person, only the active person's card is expanded by default (a `<details>` per person); a single-person group is unaffected (no accordion wrapper). | `GuestBooking.tsx`, `guest.css` |
| Mobile CTA | The checkout button is `position:sticky` at the bottom on narrow viewports only; validation/status messages remain in normal flow below it (not obscured). | `GuestBooking.tsx`, `guest.css` |
| `/rental` Regular vs Premium | Added a descriptive Regular/Premium comparison section using existing, already-reviewed copy — no invented prices. | `PublicPage.tsx`, `public.css` |

A screenshot-verification pass caught two CSS bugs in the candidate grid (oversized radio inputs
inheriting `.guest-main input{width:100%}`; the RECOMMENDED highlight losing to higher-specificity
base rules) — fixed in `5637752` and re-verified.

## Hard boundaries respected

No changes to pricing/recommendation logic, inventory availability, HOLD duration/start contract,
payment idempotency/retry/refund, auth/capability semantics, permissions, schema/migrations, or
Production config. `computeMaxStep`/`contractSynced` (the UIR-03/04 history-safety logic) are
untouched.

## Screenshots

Before: `docs/execution/prelaunch-uiux-v2/SCREEN_AUDIT.md` and its `screenshots/customer-*.png`
(captured pre-implementation, Phase UX-1).

After (this batch), 390/1440, captured via the isolated `startFlowApp` harness in the
`prelaunch-uiux-finishing` worktree — never the maintained review server:

- `screenshots/ux3a-4a-after/rental-ja-{390,1440}.png` — new Regular/Premium comparison section
- `screenshots/ux3a-4a-after/book-step1-ja-{390,1440}.png` — single-person card (no accordion; unchanged layout)
- `screenshots/ux3a-4a-after/candidate-ja-{390,1440}.png` — new 3-card comparison grid, RECOMMENDED highlighted
- `screenshots/ux3a-4a-after/review-ja-390.png` — shortened disclaimer, collapsed wear summary (from the passing `tests/public/normal-ui.ts` run)
- `screenshots/ux3a-4a-after/booking-result-ja-390.png` — result-first confirmed layout (from the passing test run)
- `screenshots/ux3a-4a-after/recovery-expanded-ja-{390,1440}.png` — recovery disclosure expanded
- `screenshots/ux3a-4a-after/reservation-unconfigured-ja-{390,1440}.png` — dev-unconfigured copy on the reservation route

## Verification

All run from the isolated `prelaunch-uiux-finishing` worktree (never the maintained dev server):

- `npm run lint` — pass (0 errors/warnings) at each commit
- `npm run typecheck` — pass
- `npm run build` — pass
- `npm run check:secrets` — pass (2269 files scanned)
- `tests/public/normal-ui.ts` — 11/11 pass, including 2 new regression tests added this batch
  (first-arrival dirty-warning fix; second-person accordion collapse/expand/reach-candidates)
- `tests/readiness/guest-ui.ts` — 3/3 pass (updated to expand the recovery disclosure before interacting)
- `tests/readiness/booking-access-ui.ts` — 7/7 pass
- `tests/readiness/booking-recovery-ui.ts` — 3/3 pass (P5 recovery UI, 3 groups)

Foundation CI: see the `ZAO_UIUX_V2_CUSTOMER_SIMPLIFICATION_READY_FOR_TD_REVIEW` report for the
run confirmed at this candidate HEAD.

## Correction batch — TD comment [`5746531522`](https://github.com/ginisato-hash/zao-rental/pull/26#issuecomment-5746531522)

Independent TD review of `e8241e4` returned REQUEST_CHANGES (HIGH 1, MEDIUM 2, LOW 1). This
batch closes all four findings on the same branch/PR, without reopening or re-litigating the
already-PASSed UX-1 audit or the already-adopted UX-3A/UX-4A batch above.

Commit: `88e1d1f` (code/tests/screenshots).

| Finding | Fix | File(s) |
| --- | --- | --- |
| UX3R-01 (HIGH) — unsaved-input protection silently disabled after a step transition | Split the single `dirty` flag into `unsavedInput` (current input vs. last server-saved input, independent of `touched`) and `showUnsavedHint` (`touched && unsavedInput`, presentation only). `guardNav` and the `beforeunload` handler now read `unsavedInput`; only the visible banner reads `showUnsavedHint`. No persistence/autosave was added; CH-04B remains DESIGN_GATE. | `GuestBooking.tsx` |
| UX3R-02 (MEDIUM) — full booking UUID still primary | Moved `予約番号: <strong>{draft.booking.id}</strong>` out of the primary `guest-result` card and into the existing secondary review body (rendered inside `<details>` once a booking exists). UUID value, QR payload and booking-ID semantics are unchanged. | `GuestBooking.tsx` |
| UX4R-01 (MEDIUM) — `/rental` still dominated by the generic landing composition | On `path === 'rental'` only: the Regular/Premium comparison now renders immediately after a compact hero (`public-hero--compact`, mountain illustration removed), before `public-detail`; the equipment-category EXPLORE grid is demoted into a collapsed `<details className="public-secondary">` ("用品カテゴリから選ぶ"). Other routes are visually unchanged. No prices were added; existing pricing contract untouched. | `PublicPage.tsx`, `public.css` |
| UX3R-03 (LOW) — `/reservation` shell only semantically aligned | `/reservation`'s header nav now includes the same locale-switch link as the public shell, and the page adds the same footer composition (wordmark, tagline, staff-access link) used by `PublicPage`. `BookingAccess`/auth/capability semantics are untouched. | `reservation/page.tsx` |

### Regression test

Added to `tests/public/normal-ui.ts` (`UX3R-01 regression`): fills dates on step 0, advances to
step 1 without saving, confirms the visible banner is hidden but a guarded locale-nav click still
triggers the native confirm and cancelling it keeps the user on `/ja/book` with the input intact;
then edits step 1, returns to step 0 (`backToStep(0)`), and confirms the guard still fires there too.

### Verification (this batch)

Run from the isolated `prelaunch-uiux-finishing` worktree, never the maintained review server in
`prelaunch-uiux-audit` (whose long-running `.local/ui-review` server and embedded PostgreSQL were
independently confirmed healthy — `/api/health` and `/ja/rental` both 200 — before and after this
batch's own test runs):

- `npm run lint` — pass (0 errors/warnings)
- `npm run typecheck` — pass
- `npm run build` — pass
- `npm run check:secrets` — pass (2284 tracked/candidate files scanned)
- `tests/public/normal-ui.ts` — 12/12 pass, including the new UX3R-01 regression case
- `tests/readiness/guest-ui.ts` — 3/3 pass
- `tests/readiness/booking-access-ui.ts` — 7/7 pass
- `tests/readiness/booking-recovery-ui.ts` — 3/3 pass
- `npm run test:avatar` — 9/9 suites pass (phase5-upgrade, phase5-e2e, artwork-activation,
  phase6-migrations, phase6-roles, phase6-guest, phase6-import, phase6-lock, tier2-rate)

### Screenshots (this batch)

- `screenshots/ux3a-4a-after/rental-ja-{390,1440}.png` — Regular/Premium comparison as first
  substantive content; equipment-category EXPLORE collapsed under "用品カテゴリから選ぶ"
- `screenshots/ux3a-4a-after/booking-result-ja-390.png` — confirmed-result card with confirmation/
  total/payment status/QR primary and the full booking reference moved into "予約内容の詳細"
- `screenshots/ux3a-4a-after/reservation-shell-ja-{390,1440}.png` — `/reservation` with the shared
  wordmark, locale switch and footer/staff-access link

### Hard boundaries confirmed

No changes to pricing/recommendation logic, inventory availability, HOLD duration/start contract,
payment idempotency/retry/refund, Square semantics, auth/capability semantics, permissions, schema/
migrations, or Production config. No client-side re-recommendation was introduced; candidate
selection still submits only server-returned SHORTER/RECOMMENDED/LONGER directions. CH-04B
(reload-safe autosave) remains an unimplemented DESIGN_GATE.

Next: Foundation CI at the consolidated HEAD, then
`ZAO_UIUX_V2_CUSTOMER_SIMPLIFICATION_READY_FOR_TD_REVIEW` on PR #26.
