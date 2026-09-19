# Prelaunch UI/UX audit — findings ledger

Source of truth for disposition is GitHub (this branch, this file, and the linked commits/PR).
Sources reviewed: `.local/ui-review/findings-customer.json` (23 items) and
`.local/ui-review/findings-staff.json` (8 items). This ledger intentionally does not collapse
partial fixes, split findings, or open sub-items into "done" — see the Notes column.

Verified HEAD for every "PASS"/"covered" row below is `376894e` on
`claude/prelaunch-uiux-local-audit` (base `cdfdde1ea5f86aae27cd8518a80b112b8ea5ea76`), unless a
row states an earlier verification SHA explicitly. All verification is local/synthetic
(isolated PostgreSQL + `chromium.launch({channel:'chrome'})`); no Production, real payment, real
inventory, or real notification delivery is involved anywhere in this ledger.

## Customer findings (`findings-customer.json`)

| ID | Severity | Execution status | Disposition | Verified head | Notes |
|----|----------|-------------------|-------------|----------------|-------|
| CB-01 | BLOCKER | DONE | FIXED | 376894e | Guest API error codes mapped to ja/en copy in `GUEST_ERROR_COPY`; message rendered near the triggering control. |
| CH-01 | HIGH | DONE | FIXED | 376894e | Step-1 date validation (end >= start) added; button disabled until valid. |
| CH-02 | HIGH | PARTIAL | PARTIAL_FIX | 376894e | Booking/payment state enums and reference field now localized; HOLD timestamp shown in JST. Do **not** count as fully closed — see original finding for any sub-items not re-verified this batch. |
| CH-03 | HIGH | DONE | FIXED | 376894e | Timestamps rendered in JST via `Intl.DateTimeFormat`. |
| CH-04A | HIGH | DONE | FIXED | 376894e | Browser Back/Forward now moves one step in the wizard via native History API only; `history.state` stores only an allowlisted `{step}` integer, never input/contact/tokens/booking data; no HOLD/payment/preview/selection network re-execution on popstate; reachable step is clamped to what the current draft/revision actually supports (`open()`'s `maxForDraft`), never reviving an editable state past lock/confirm; in-app back buttons (`backToStep`) use the same transition rule as browser Back/Forward. Verified via a real Playwright run that caught and fixed a genuine regression in the step-resolution logic (see commit history on this branch) before this state. |
| CH-04B | HIGH | **OPEN** | **DESIGN_GATE — not counted toward completion** | n/a | Reload-safe autosave for un-submitted input remains an open design question. The removed browser-side Input cache (UIR-01/02) was **not** revived and was **not** moved to localStorage/IndexedDB/history.state; no new API/migration/schema/TTL/auth work was done. What exists now: an accurate "unsaved changes" signal (`dirty`), a `window.confirm` guard (`guardNav`) on locale-switch/exit links, and a best-effort `beforeunload` handler (explicitly auxiliary only, per MDN's own reliability caveat, especially on mobile). CH-04 as a whole is **not** closed until this sub-item is resolved by a separate design decision. |
| CH-05 | HIGH | DONE | FIXED | 376894e | `blur()` no longer sets `reading=true` with no request behind it, so a pagehide→focus→pagehide race no longer leaves reload permanently disabled. TEST-OBS-02: the regression test in `tests/readiness/booking-access-ui.ts` now reuses the file's own `readGate`/`waitForBookingReadTestGate` mechanism to actually observe the reading-in-progress/disabled state before the second pagehide interrupts it, not just before/after. |
| CH-06 | HIGH | DONE | FIXED | 376894e | `locale` threaded through `BookingRecoveryForm`/`PrepareBookingRecovery`; all strings moved to the `t(ja,en)` pattern. |
| CH-07 | HIGH | DONE | FIXED | 376894e | `/[locale]/reservation` wrapped in the shared public shell/header; `locale` passed to `ConfirmedBooking`. |
| CM-01 | MEDIUM | DONE | FIXED | 376894e | Fieldset now scoped to `step<3` so completed steps aren't inertly disabled; step-2-with-no-preview fallback message added. |
| CM-02 | MEDIUM | DONE | FIXED | 376894e | Step-3 final review now renders localized `storeLabel`/`slotLabel`/`sportLabel`/`tierLabel` instead of raw database enums. |
| CM-03 | MEDIUM | DONE | FIXED | 376894e | EN/日本語 locale switch added to the booking page header (also now guarded by CH-04B's unsaved-input confirm). |
| CM-04 | MEDIUM | DONE | FIXED | 376894e | "Back to equipment" button added on step 2 (candidate step), matching step 1/4's back affordances. |
| CM-05 | MEDIUM | DONE | FIXED | 376894e | `GuestRecovery` moved inside `GuestBooking` itself (styled/laid out consistently) instead of being a separately styled sibling in `book/page.tsx`. |
| CM-06 | MEDIUM | DONE | FIXED | 376894e | `aria-busy`/disabled + a generic `role="status"` "処理中です…" message added on the primary forward buttons while `busy`. New test in `tests/public/normal-ui.ts` observes this via the existing checkout route-gate (request genuinely in flight), not a fixed sleep. |
| CM-07 | MEDIUM | N/A — no code change | **ACCEPTED_NO_CHANGE / BOUNDARY_PRESERVED** | n/a | Declined: `packages/contracts/src/index.ts`'s `foundationStatus.bookingAvailable:false` plus `tests/e2e/foundation.spec.ts` show this is an intentional pre-launch "kill switch," not a bug. Independently confirmed by the reviewer ("foundation testが準備中の入口を明示的に期待している"). |
| CL-01 | LOW | DONE | FIXED | 376894e | Raw QR text/content replaced with the intended rendering. |
| CL-02 | LOW | DONE | FIXED | 376894e | `<dl className="guest-price">` added with conditional hiding of zero-value adjustment rows. New test asserts both states: the default flow (no wear, no advance) shows only Subtotal/Group-estimate rows, and requesting the advance-payment estimate (within its qualification window) shows the "Estimated advance adjustment" row with a nonzero value; checked in JA and EN at 390px width. |
| CL-03 | LOW | DONE | FIXED | 376894e | Numeric input width capped (`max-width:10ch`) outside the mobile breakpoint; full-width inside it. |
| CL-04 | LOW | N/A — no code change | **ACCEPTED_NO_CHANGE / BOUNDARY_PRESERVED** | n/a | Declined: `guestAvatarHandler`'s single opaque `empty()` 404 response is very likely a deliberate anti-enumeration pattern shared across multiple distinct failure conditions, not a cosmetic bug. Independently confirmed by the reviewer ("複数条件をopaqueな404にまとめているため...共有handlerを204へ変えない判断を維持する"). |
| NR-01 | LOW | DONE (was NOT_RUN) | **COVERED_BY_EXISTING_SUITE** | 376894e | Original NOT_RUN reason (`ZAO_BOOKING_ACCESS_RUNTIME` unset under `startFlowApp({publicP0:true})` alone) does not apply to `tests/readiness/booking-access-ui.ts`, which boots with `publicP1`/`publicP4` and exercises the full SaveBookingAccess save/reload/revoke/resave flow end to end. Reconfirmed 7/7 PASS this batch. |
| NR-02 | LOW | DONE (was NOT_RUN) | **COVERED_BY_EXISTING_SUITE** | 376894e | `tests/readiness/guest-ui.ts` exercises recovery-code enrollment/response-loss/restart/reload and the touch-width matrix end to end. Reconfirmed 3/3 PASS this batch (after an unrelated core-logic bug this batch's own testing surfaced and fixed in `GuestBooking.tsx`'s step-resolution logic — see commit history). |
| NR-03 | LOW | PARTIAL (was NOT_RUN) | **PARTIALLY_COVERED — remainder genuinely NOT_RUN** | 376894e | The price-change-review *mechanism* (server rejects stale checkout with `PRICE_CHANGED_REVIEW_REQUIRED`, exposes the pending quote, `accept-price` retains the original HOLD/quote) is covered at the HTTP/service-integration level by `tests/public/guest-integrated.ts` ("price version changes after review require explicit new snapshot acceptance..."). That is not a browser-UI test: the literal click on "保存済みの新しい見積を確認・承認する", insufficient-stock messaging, and actual HOLD-expiry elapsing still require either unfreezing `inventory_clock()` mid-test or synthetic stock exhaustion, neither of which exists in an existing harness today. Left **NOT_RUN** rather than claimed, per this batch's own rule against reusing an adjacent PASS as if it covered the exact browser path. |
| NR-04 | LOW | PARTIAL (was NOT_RUN) | **NOT_RUN_PHYSICAL_DEVICE** (code path already reviewed) | n/a | No real camera exists in this environment; a real-device QR scan is out of scope for local/synthetic verification. Already verified in code/DOM: the confirmation renders a 240×240 data-URL QR with alt text `開発予約QR` and the exact `zao-rental:reservation:<id>` payload string. |

## Staff findings (`findings-staff.json`)

| ID | Severity | Execution status | Disposition | Verified head | Notes |
|----|----------|-------------------|-------------|----------------|-------|
| ST-01 | MEDIUM | DONE | FIXED | 376894e | Root cause: `tests/flow-app` (the local audit harness, not `apps/web` itself) never re-exported 8 real routes, so staff nav links 404'd inside the harness. Fixed with 8 one-line re-export files under `tests/flow-app/src/app/...`. This is a harness fix; the real `apps/web` pages and their permission gates were never broken. |
| ST-02 | LOW | DONE (was NOT_RUN) | **COVERED_BY_EXISTING_SUITE** | 376894e | `/admin/ops`. `tests/operations/console-ui.ts`: anonymous/unprivileged denial, normal exception list (no PII leak), readiness panel, acknowledge-permission boundary (with real DB snapshot equality proving no business-state mutation), responsive/no-external-request check. 5/5 PASS. |
| ST-03 | LOW | DONE (was NOT_RUN) | **COVERED_BY_EXISTING_SUITE** | 376894e | `/admin/notifications`. `tests/notification/normal-ui.ts`: safe status list + audited manual resend after lost HTTP response, permission/CSRF/responsive check, booking survives notification failure. 3/3 PASS. |
| ST-04 | LOW | DONE (was NOT_RUN) | **COVERED_BY_EXISTING_SUITE** | 376894e | `/admin/launch`. `tests/operations/launch-ui.ts`: permission boundary (401/403), read-only guarantee (no password/form fields, no forbidden-action buttons), responsive/no-external-request check. 5/5 PASS. |
| ST-05 | LOW | DONE (was NOT_RUN) | **COVERED_BY_EXISTING_SUITE** | 376894e | `/admin/inventory`. `tests/operations/normal-ui.ts`, 7/7 PASS (covers ST-05/06/07/08 and `/staff/rentals` together). |
| ST-06 | LOW | DONE (was NOT_RUN) | **COVERED_BY_EXISTING_SUITE** | 376894e | `/admin/prices`. Same suite as ST-05. |
| ST-07 | LOW | DONE (was NOT_RUN) | **COVERED_BY_EXISTING_SUITE** | 376894e | `/admin/assets`. Same suite as ST-05. |
| ST-08 | LOW | DONE (was NOT_RUN) | **COVERED_BY_EXISTING_SUITE** | 376894e | `/staff/amendments`. Same suite as ST-05. |

"Covered by existing automated suite, N/N PASS" means: the route/permission-boundary/no-leak
behavior was exercised by a real Playwright run against a real isolated PostgreSQL instance, not
personally re-reviewed pixel-by-pixel by the implementer this batch, and never inferred from a
permission-denial screen alone.

## Record-only corrections (no code change)

- **`guest-avatar-http.ts`**: already has a `HoldError.code === 'GUEST_RATE_LIMITED'` → HTTP 429
  branch. An earlier note describing this handler as returning only 404 for every failure
  condition was incomplete; corrected here, no code change.
- **Operations permission naming**: both `/admin/ops` and `/admin/launch` check the single
  existing `OPERATIONS_VIEW` permission. There is no separate `LAUNCH_VIEW` permission; an
  earlier note implying one was incorrect, corrected here, no code change.

## Test-hardening additions this batch (TEST-OBS-01, TEST-OBS-02, CM-06, CL-02)

Commit `376894e` on this branch. All three touched files reuse existing harnesses/fixtures
(`tests/public/normal-ui.ts`, `tests/readiness/booking-access-ui.ts`); no new test harness was
created and no product permission was loosened to make these pass.

- **TEST-OBS-01** (`tests/public/normal-ui.ts`, UIR-01/02 regression case): now asserts the
  logout call's actual HTTP status (200) instead of discarding it, captures the guest draft id
  before logout and asserts a genuinely different id after reload, and asserts the final
  "server-saved draft restores" case still has candidates visible after that whole sequence.
- **TEST-OBS-02** (`tests/readiness/booking-access-ui.ts`, CH-05 regression case): reuses the
  file's own `readGate`/`waitForBookingReadTestGate` mechanism so the test observes the
  reading-in-progress/disabled button state produced by the `focus` handler's GET request
  before the second `pagehide` interrupts it, instead of only checking state before/after.
- **CM-06** (`tests/public/normal-ui.ts`, final-checkout test): the existing
  `page.route('**/api/guest/checkout', ...)` response-gate callback now also asserts
  `aria-busy="true"`, `disabled`, and the "処理中です" status text while the request is
  genuinely in flight — no fixed `sleep`.
- **CL-02** (`tests/public/normal-ui.ts`, new case): asserts the zero-adjustment row set on the
  default flow (already implicitly exercised by the "guest ordinary mobile UI" case, now with
  explicit `dl.guest-price` assertions) and the non-zero "Estimated advance adjustment" row when
  the advance-payment checkbox is used within its qualification window; checked in both JA and
  EN at 390px width. Also documents, via an inline test comment (not a fix), that the EN
  candidate-direction radio label is currently the raw enum (`RECOMMENDED`) rather than
  localized copy — an observation, not a change, since localizing it was not in this batch's
  scope.

## Explicitly remaining / open items

- **CH-04B** — OPEN/DESIGN_GATE, see above. Not counted toward CH-04's completion.
- **CH-02** — PARTIAL_FIX, not fully closed.
- **NR-03** — PARTIALLY_COVERED; the exact browser-UI price-review click, insufficient-stock
  messaging, and HOLD-expiry-elapsing states remain NOT_RUN.
- **NR-04** — NOT_RUN_PHYSICAL_DEVICE (no real camera in this environment).
- **CM-07, CL-04** — ACCEPTED_NO_CHANGE / BOUNDARY_PRESERVED (intentional behavior, not defects).
This submission is an implementer finishing batch, not UI-phase completion approval. That still
requires the Technical Director's independent review on GitHub and, separately, the Owner's own
on-screen acceptance.
