# Prelaunch UI/UX audit — findings ledger

Source of truth for disposition is GitHub (this branch, this file, and the linked commits/PR).
Sources reviewed: `.local/ui-review/findings-customer.json` (23 items) and
`.local/ui-review/findings-staff.json` (8 items). This ledger intentionally does not collapse
partial fixes, split findings, or open sub-items into "done" — see the Notes column.

Verified HEAD for every "PASS"/"covered" row below is `5c8142d` on
`claude/prelaunch-uiux-local-audit` (base `cdfdde1ea5f86aae27cd8518a80b112b8ea5ea76`), unless a
row states an earlier verification SHA explicitly. All verification is local/synthetic
(isolated PostgreSQL + `chromium.launch({channel:'chrome'})`); no Production, real payment, real
inventory, or real notification delivery is involved anywhere in this ledger. Current independent
review state is `2c63b59` (see the `2026-09-19` re-review note below) — the branch's most recently
reviewed and accepted HEAD.

**2026-09-19 correction (history-correction batch, `5c8142d`):** an independent review of
`1cb989a` (posted on [PR #25](https://github.com/ginisato-hash/zao-rental/pull/25)) found two
real defects in CH-04A's history handling — UIR-03 (HIGH) and UIR-04 (MEDIUM), both fixed in this
batch (see their own rows below and the commit message on `5c8142d`). CH-04A was reopened to
OPEN/FIX_IN_PROGRESS pending the reviewer's own re-check of this fix; the prior `376894e` rows for
CH-04A and everything else were preserved below, not deleted.

**2026-09-19 independent re-review at `2c63b59` — HISTORY_CORRECTION_REVIEW_PASS.** ChatGPT /
Technical Director independently re-fetched PR #25, the UIR-03/UIR-04 diff, `GuestBooking.tsx`,
the updated regression tests, this file, and the completed Foundation CI run (`35449537327`,
success). New findings for this correction scope: **BLOCKER 0 / HIGH 0 / MEDIUM 0**. **UIR-03 and
UIR-04 are CLOSED**, and **CH-04A is recorded as fixed again** (see its row below, now DONE/FIXED
rather than OPEN). This does not close CH-04B (OPEN/DESIGN_GATE), CH-02 (PARTIAL_FIX), NR-03
(PARTIALLY_COVERED), or NR-04 (NOT_RUN_PHYSICAL_DEVICE), and is not approval to merge `main` or
activate Production — Owner acceptance remains separate. Full record:
[PR #25 comment](https://github.com/ginisato-hash/zao-rental/pull/25#issuecomment-5742964726).

**Correction to the prior implementer report:** the CI checkout was GitHub's synthetic PR merge
commit `e324f562` (not `2c63b59` literally, as this file previously implied by using the plain
head SHA as "the CI checkout SHA"). The reviewer confirmed a 0-file diff between `2c63b59` and
`e324f562`, so the tested tree is equivalent to the submitted source tree — the CI result stands,
but the earlier "CI checkout SHA... matches this PR's current headRefOid exactly" framing was
imprecise about GitHub Actions' own merge-commit checkout behavior for `pull_request`-triggered
runs, and is corrected here for the record.

## Customer findings (`findings-customer.json`)

| ID | Severity | Execution status | Disposition | Verified head | Notes |
|----|----------|-------------------|-------------|----------------|-------|
| CB-01 | BLOCKER | DONE | FIXED | 376894e | Guest API error codes mapped to ja/en copy in `GUEST_ERROR_COPY`; message rendered near the triggering control. |
| CH-01 | HIGH | DONE | FIXED | 376894e | Step-1 date validation (end >= start) added; button disabled until valid. |
| CH-02 | HIGH | PARTIAL | PARTIAL_FIX | 376894e | Booking/payment state enums and reference field now localized; HOLD timestamp shown in JST. Do **not** count as fully closed — see original finding for any sub-items not re-verified this batch. |
| CH-03 | HIGH | DONE | FIXED | 376894e | Timestamps rendered in JST via `Intl.DateTimeFormat`. |
| CH-04A | HIGH | DONE | **FIXED — re-closed 2026-09-19 by independent re-review at `2c63b59`** | 2c63b59 | Originally closed at `376894e`, reopened when the independent review of `1cb989a` found UIR-03/UIR-04 in the history-navigation logic that record described, fixed at `5c8142d`, then re-closed after the reviewer's independent re-check returned `HISTORY_CORRECTION_REVIEW_PASS` (BLOCKER 0/HIGH 0/MEDIUM 0) at `2c63b59` — see the correction note above and [the full review](https://github.com/ginisato-hash/zao-rental/pull/25#issuecomment-5742964726). Current mechanism: native History API only; `history.state` stores only an allowlisted `{step}` integer, never input/contact/tokens/booking data; no HOLD/payment/preview/selection network re-execution on popstate; `backToStep` always pushes a fresh entry rather than ever calling `history.go()` (a `go()`-triggered hard reload in this app was found to be reported by Navigation Timing as a plain `'reload'`, indistinguishable from an unrelated `location.reload()` elsewhere in this app); reachable step is clamped via `computeMaxStep` against whether displayed input/selection still matches the server's draft, with a `draft.locked` bypass since a locked draft is never further editable regardless of step. |
| UIR-03 | HIGH | DONE | **CLOSED** (reviewer verdict, `2c63b59`) | 2c63b59 | New finding from the independent review of `1cb989a` (not in the original 23/8-item source files). After reaching the final review, editing equipment/dates or a candidate direction without resubmitting, then using Back/Forward, could land back on the review with the OLD server contract still checkout-ready while the screen showed newer, unsaved local values. Fixed via `computeMaxStep` (clamps the reachable step to whether currently displayed input/selection still matches what the server actually has for this draft) and `contractSynced` (gates the checkout button itself on that same sync check, as defense in depth). A `draft.locked` bypass was added after this fix regressed two existing suites (`tests/readiness/booking-access-ui.ts`'s "acknowledged revoke then deliberate resave", `tests/readiness/guest-ui.ts`'s "owned Web restart") — a locked/confirmed draft does not always echo `input` back, which without the bypass wrongly capped it at step 1; both suites reconfirmed passing after the fix. Verified live in a real browser (network-traced) plus at the function level against the reviewer's own counter-examples; the candidate-direction-divergence sub-case specifically is verified at the function level only — no live path can reach it without either resubmitting (which clears it) or reloading (which discards the local pick being tested), documented inline in the test. Independently re-reviewed and CLOSED at `2c63b59`: reviewer found no path reintroducing browser persistence, bypassing server authority, or causing history navigation to perform HOLD/payment business writes. |
| UIR-04 | MEDIUM | DONE | **CLOSED** (reviewer verdict, `2c63b59`) | 2c63b59 | New finding from the independent review of `1cb989a`. A step NUMBER was being used as a proxy for real browser history ENTRY COUNT: a direct visit/restore (`replaceState`) could jump the step value without creating any new real entry, so `backToStep`'s old `history.go(delta)` could guess wrong and jump past the app entirely (UIR-04-A); separately, a fresh, unsaved-but-locally-valid step 1 could never be reached via Forward because the old formula required server-confirmed input before allowing step 1 at all (UIR-04-B). Fixed with `historyStackRef`/`historyPosRef` tracking only entries this mounted instance actually knows are real, and `backToStep` now always pushes a fresh entry instead of calling `history.go()`. Verified live in a real browser: UIR-04-A confirmed via `history.length` (a push always adds exactly one entry, asserted directly) and by observing that a direct restore's "edit" action stays on `/book` rather than leaving the app; UIR-04-B confirmed by reaching step 1 via Forward with nothing yet saved to the server. Independently re-reviewed and CLOSED at `2c63b59`: reviewer confirmed the step-delta-as-entry-distance assumption is fully removed and history state still carries only the allowlisted step metadata. |
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

## History-correction batch (`5c8142d`) — UIR-03/UIR-04

Requested by the independent review of `1cb989a` (PR #25 comment). Scope was intentionally
limited to the two new findings; UIR-01/02, locale/CSS work, staff route fixes, and CM-07/CL-04
were explicitly not touched again, and were not. CH-04B remains untouched and still
OPEN/DESIGN_GATE — no browser-side Input persistence was added.

- `apps/web/src/components/GuestBooking.tsx`: `computeMaxStep`, `contractSynced`,
  `historyStackRef`/`historyPosRef`, `initialRequestedStepRef`, and the Navigation-Timing-gated
  mount effect (see file comments for the full reasoning, including the two live regressions
  found and fixed while building this: the `draft.locked` bypass and the `navType==='back_forward'`
  narrowing).
- `tests/public/normal-ui.ts`: one consolidated JA regression case and one EN case (see UIR-03/
  UIR-04 rows above for exact coverage). Bundled into the existing suite, no new harness.
- Lint/typecheck/build/secret-scan and the full previously-verified suite set
  (`tests/public/normal-ui.ts`, `tests/readiness/{booking-access-ui,guest-ui,booking-recovery-ui}.ts`)
  all reconfirmed passing at `5c8142d` before push.
- An emergent finding surfaced while verifying this live (not a code change, record-only): in
  this app's actual dev-mode Next.js runtime, **any** `popstate` event on `/[locale]/book` — a
  real Back/Forward, this app's own `history.go()` fallback, or even a synthetic dispatch — is
  intercepted by Next.js's own global popstate handling and turned into a full document reload,
  confirmed via a live network trace (fresh `GET /ja/book` + static assets + a fresh
  `/api/guest/context` round trip). That reload resets all local React state before any
  in-progress unsaved edit could reach a mismatched checkout, which independently narrows UIR-03's
  exposure in this exact runtime (not something this fix relies on or controls) but also means
  the precise "local edit survives navigation" scenario could not be exercised as a live
  end-to-end browser test — `computeMaxStep`/`contractSynced` are verified as defense in depth at
  the function level instead, against the reviewer's own exact counter-examples.

## Explicitly remaining / open items

- **CH-04A** — re-closed DONE/FIXED at `2c63b59` (reviewer verdict `HISTORY_CORRECTION_REVIEW_PASS`).
- **CH-04B** — OPEN/DESIGN_GATE, see above. Not counted toward CH-04's completion.
- **CH-02** — PARTIAL_FIX, not fully closed.
- **NR-03** — PARTIALLY_COVERED; the exact browser-UI price-review click, insufficient-stock
  messaging, and HOLD-expiry-elapsing states remain NOT_RUN.
- **NR-04** — NOT_RUN_PHYSICAL_DEVICE (no real camera in this environment).
- **CM-07, CL-04** — ACCEPTED_NO_CHANGE / BOUNDARY_PRESERVED (intentional behavior, not defects).

This submission is an implementer finishing batch, not UI-phase completion approval. That still
requires the Technical Director's independent review on GitHub and, separately, the Owner's own
on-screen acceptance.
