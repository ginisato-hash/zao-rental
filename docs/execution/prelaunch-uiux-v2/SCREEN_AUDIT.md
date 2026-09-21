# Phase UX-1 — Screen Audit

**Status:** Visual audit only. No product code was changed to produce this document or its
screenshots. No `DELETE`/`SHORTEN`/`MOVE`/`HIDE`/`ADVANCED`/`VISUAL`/`KEEP`/`ASSET`
annotations are applied here — that classification belongs to the Technical Director's
own review pass in Phase UX-2. This document only records what is currently on screen.

**Server:** customer screens, the reservation recheck, and the candidate-variance
maintained-server observation all used the already-running, Owner-maintained local dev
server at `http://127.0.0.1:38946` (`next-server`, pid 2101) — only ever navigated against
(GET/POST calls a normal visitor or one synthetic booking would make); never started,
stopped, or restarted. Staff/admin screens and the controlled candidate-variance
re-verification instead used a fully isolated, disposable local app + PostgreSQL instance
(see their own sections below), which was stopped and torn down after use and never shared
any state, account, or credential with the maintained server. No source file under
`apps/web` or `packages` was modified to produce this audit.

**Method:** screenshots were captured with a scripted headless Playwright browser
(`playwright`, already a repo devDependency) driving the running server directly —
the same kind of HTTP/browser traffic the interactive browser tool would produce, just
scripted so every shot could be saved to disk at exact 390×844 / 1440×900 viewports.
No new dev server was started; the target was always the existing
`http://127.0.0.1:38946`. All customer-flow data below is synthetic (fixture dates,
`SYNTHETIC Guest` / `synthetic-guest@example.invalid`, fixture pole/variant IDs).

**Date-fixture note:** this maintained server's inventory/pricing clock
(`inventory_clock()` → Postgres `clock_timestamp()`) is not aligned with the real
calendar; dates around the real "today" (2026) are rejected as `PRICE_PERIOD_NOT_COVERED`
or `PERIOD_ENDED` depending on how far out they are. The known-good synthetic date that
resolves inside the active price book/season window is **2035-01-05** (single day,
`1日 / Day` slot, Mountain Base → Mountain Base) — the same date already used by the
existing local review tooling at `.local/ui-review/audit/customer-audit.mts`. All
customer screenshots below use this date.

All screenshot paths below are relative to this document's own folder
(`docs/execution/prelaunch-uiux-v2/`), i.e. `screenshots/<file>`.

---

## Customer screens

Captured for JA (priority) and EN, each at 390×844 and 1440×900. 9 screens × 2 locales ×
2 viewports = **36 screenshots**, all present under `screenshots/customer-*`.

### 1. Top / landing (`/ja`, `/en`)

- `screenshots/customer-top-ja-390.png` / `-1440.png`
- `screenshots/customer-top-en-390.png` / `-1440.png`

Header: wordmark "ZAO / RENTAL", nav links "道具とウェア" (rental) and "受取・返却"
(pickup/return), locale switch "EN"/"日本語". Hero: headline "道具選びを済ませて、雪山へ。",
one paragraph of supporting copy, a single primary CTA button "日程から選ぶ" linking to
`/ja/book`, and a decorative "蔵王 / CHOOSE YOUR NEXT SNOW DAY" panel. Below the fold: a
one-line development-preview disclaimer ("予約受付前の開発プレビューです。実決済・本番予約は行いません。"),
a bulleted "蔵王のスキー・スノーボードレンタル" section (3 bullets), an "EXPLORE" grid of 4 cards
(SKI / SNOWBOARD / PREMIUM / WEAR, each with a one-line label + one paragraph + arrow icon
linking to `/ja/rental`), a footer link list to 7 content pages, and a dark footer with the
wordmark, one tagline, and a "スタッフ入口" (staff entrance) text link (no visible URL styling,
plain text in the footer).

Observations: single primary CTA above the fold, matches spec's "1 screen / 1 main CTA"
intent already. The development-preview disclaimer line sits directly under the hero CTA
on both viewports, not below the fold. "スタッフ入口" is the only way from the customer site to
`/staff/login`; it is a plain-text link with no visual separation from the tagline above it.

### 2. Rental / plan comparison (`/ja/rental`, `/en/rental`)

- `screenshots/customer-rental-ja-390.png` / `-1440.png`
- `screenshots/customer-rental-en-390.png` / `-1440.png`

Same header/footer shell as Top. Heading "あなたの滑りに合うプランを。", one paragraph, the same
"日程から選ぶ" CTA and 蔵王 hero panel repeated, then a bulleted "蔵王レンタルのプラン比較" section (2
bullets: Regular vs Premium one-liners) and the same 4-card EXPLORE grid as Top (SKI /
SNOWBOARD / PREMIUM / WEAR), each card linking onward (not to a single unified
Regular-vs-Premium comparison table as sketched in spec §4.2 — there is no side-by-side
price/benefit table on this route; the comparison is presented as two bullet lines of text
above the 4 cards).

Observations: this route largely duplicates Top's hero/CTA/EXPLORE-grid content rather than
presenting the spec's requested Regular/Premium comparison table (photo, one-liner, model
column, price, price delta, CTA per plan). No per-plan price is shown on this screen.

### 3. Book — step 0, dates & stores (`/ja/book` fresh)

- `screenshots/customer-book-step0-ja-390.png` / `-1440.png`
- `screenshots/customer-book-step0-en-390.png` / `-1440.png`

Captured on first load, before any field is filled. Step indicator "1. 日程 / 2. 用品とサイズ /
3. 候補を選ぶ / 4. 全員分を確認" (current step underlined). Card "日程・店舗" with: 利用開始日 (native
date input), 利用終了日 (native date input), 利用枠 select (1日/Day, 午前/Morning, 午後/Afternoon,
2日以上/Multi-day — defaults to 1日/Day), 受取店舗 select (Mountain Base / Onsen Base), 返却店舗
select (Mountain Base / Onsen Base), and a "用品を選ぶ" button. Below the card: "保存済みの結果を
再読込" and "この予約画面を閉じる" buttons, then the recovery region (see screen 8).

Observations: no min/max on the date inputs; the EN 利用枠 option labels are shown bilingual
("1日 / Day", "午前 / Morning", …) rather than English-only. Store names appear as their
already-formatted display names ("Mountain Base", "Onsen Base"), not raw enum IDs, on this
screen.

### 4. Book — step 1, equipment & size (after filling dates, before pole size)

- `screenshots/customer-book-step1-ja-390.png` / `-1440.png`
- `screenshots/customer-book-step1-en-390.png` / `-1440.png`

Reached by filling 2035-01-05→2035-01-05 and clicking "用品を選ぶ". Shows a persistent status
line "保存されていない変更があります。移動すると失われます。" immediately on arrival (before the visitor
has changed anything on this step). Then a "一人ずつ選択" Regular/Premium explainer pair, a
利用人数 (party size) number input (defaults 1), and one "利用者 1" card with: 用品
(equipment: スキーセット/スノーボードセット/ウェアのみ), 年齢区分 (大人/子供), プラン (Regular/Premium),
身長cm, 足サイズcm, 体重kg, 開始日の年齢, スキーレベル (初級/中級/上級), ポールのサイズ (defaults to
"選択してください" — unselected), ジャケットサイズ, パンツサイズ (both default "選択なし"). All numeric
fields arrive pre-filled with plausible defaults (170cm / 25.5cm / 60kg / age 30) except
pole size, which is required but unselected by default. Footer note: "スキーを選んだ方はポールの
サイズも選んでください。" Buttons: "日程に戻る" and "候補と参考料金を確認". At 1440px the per-person
fields lay out in 2 columns; at 390px they stack in 1 column.

Observations: the "unsaved changes" banner is present on first arrival at this step, before
any user edit, which reads as a warning about something the visitor hasn't done yet.

### 5. Candidate — step 2, size selection

- `screenshots/customer-candidate-ja-390.png` / `-1440.png`
- `screenshots/customer-candidate-en-390.png` / `-1440.png`

Reached after selecting a pole size and clicking "候補と参考料金を確認". Card "保存済みの条件" with
one line of guidance ("候補は目安です。長さを明示的に選択してください。"), then per-person "利用者 1" /
"参考料金: ¥7,500" and 3 radio options presented as plain text rows (no size-comparison bar
or visual chart): "長め 155 cm" (or 165cm at 1440 — the fixture returned a different
"長め" value between runs, see note below), "短め 145 cm", "おすすめ 150 cm" — no radio
pre-selected. Two required checkboxes follow: "全員のサイズ・モデル条件・ウェア構成を確認した" and
"事前決済5%調整の見込みを確認する". Buttons "用品とサイズに戻る" and "全員分の最終確認へ" (disabled until
a size + both checkboxes are set).

Observations: the three candidates are plain radio rows, not the "primary UI" length
comparison sketched in spec §4.7; there is no avatar/visual size aid on this screen at all
in the current build. The "長め" value differed between two otherwise-identical capture runs
(155cm vs 165cm for the same fixture inputs) — candidate math may not be fully
deterministic run-to-run, worth the Technical Director's attention though not diagnosed
further here (no code was changed to investigate).

### 6. Review — step 3/4, final group confirmation

- `screenshots/customer-review-ja-390.png` / `-1440.png`
- `screenshots/customer-review-en-390.png` / `-1440.png`

Reached after picking a candidate size, checking both step-2 checkboxes, and clicking
"全員分の最終確認へ". Step indicator now shows step 4 ("4. 全員分を確認") active. Card "最終確認"
with a "条件を編集して再計算" button, then plain lines: `2035-01-05 → 2035-01-05 · 1日 / Day`,
`Mountain Base → Mountain Base`, `利用者 1 · スキーセット · Regular`,
`155 cm · モデル非指定 · 選択なし / 選択なし`, a disclaimer ("税区分・営業規約は公開前確認中。見積は請求
確定ではありません。"), 小計 / 全員分の参考総額 (¥7,500 both, since 1 person), synthetic 名前/メール
inputs (pre-filled "SYNTHETIC Guest" / "synthetic-guest@example.invalid"), a required
checkbox "合成データによる開発確認であることを確認", and the checkout button "在庫をHOLDして開発用決済を照合"
(disabled until the checkbox is checked).

Observations: this single screen already carries both the spec's "review" step and the
"HOLD_PAYMENT" checkout action together (no separate payment screen exists in the current
build). The checkout button label itself names internal mechanics ("HOLDして…決済を照合")
rather than a customer-facing action. "選択なし / 選択なし" for wear fields reads as a raw
placeholder pair rather than a single "ウェアなし" style statement.

### 7. Booking result (after checkout — CONFIRMED_DEV state)

- `screenshots/customer-booking-result-ja-390.png` / `-1440.png`
- `screenshots/customer-booking-result-en-390.png` / `-1440.png`

Rendered on the same route/step after "在庫をHOLDして開発用決済を照合" is clicked. Adds, above the
already-visible review block: "保存済み見積: ¥7,500 / HOLD_RECONCILIATION_REQUIRED", then a
"予約が確認されました" card with 予約番号 (a full UUID, e.g.
`911a1efb-79db-48cd-bc58-f677d003dbba`), the price again, "決済状況: 完了", a large QR code
image, a "予約閲覧をこの端末へ保存" button, one paragraph about shared devices/email delivery, and
a secondary button "復旧コードの配送・照合". The step-4 form above (name/email inputs, the
synthetic-data checkbox, the now-disabled checkout button) all remain visible and editable
on screen alongside the confirmation.

Observations: the confirmation headline sits below a raw state string
(`HOLD_RECONCILIATION_REQUIRED`); the booking reference shown to the customer is a full
UUID rather than a short reference code; the now-obsolete step-1–4 form/CTA stays on
screen after success instead of the page settling into a single "done" state.

### 8. Recovery (booking recovery area on `/ja/book`)

- `screenshots/customer-recovery-ja-390.png` / `-1440.png`
- `screenshots/customer-recovery-en-390.png` / `-1440.png`

This is not a separate route — it is a region titled "予約画面の回復" ("Recover booking access"
in EN) that is present near the bottom of `/ja/book` regardless of which of the 4 wizard
steps is active (it was visible on every step screenshot captured above, e.g. under the
step-0 and step-1 cards). The screenshots here are a close-up of that region on its own:
one paragraph of guidance ("メールアドレスや予約番号だけでは回復できません。回復しても料金・予約期限・HOLD期限
は変わりません。"), a "回復コードを作成" (create recovery code) button, a password-type "控えた回復
コード" (recovery code you wrote down) input, and a "保存済み予約画面を回復" (recover saved booking
screen) button (disabled until a code is entered).

Observations: this widget is always present on the booking route, not something reached via
its own navigation step; a first-time visitor sees "recover a saved booking" UI before they
have ever made a booking.

### 9. Reservation confirmation (`/ja/reservation`, `/en/reservation`)

- `screenshots/customer-reservation-confirmation-ja-390.png` / `-1440.png`
- `screenshots/customer-reservation-confirmation-en-390.png` / `-1440.png`

Reached after clicking "予約閲覧をこの端末へ保存" on the booking-result screen, then navigating to
`/ja/reservation`. Header here is a *different*, lighter shell than the rest of the
customer site (plain "ZAO / RENTAL" wordmark + a single "予約する" link, cream background,
no nav/footer). Body: heading "予約確認・QR", a one-line dev-preview disclaimer, then the
status line actually shown was **"予約の閲覧権がないか、失効・期限切れです。"** ("no view access, or it
has expired") with a disabled "予約を再読込" (reload) button and a disabled "この端末の予約閲覧権を
失効" (revoke) button — i.e. even immediately after clicking "save to this device" on the
same run, this page did not show the just-created booking/QR. Below that, a "別の端末で予約を
確認" (check on another device) box with a 予約復旧コード input, "復旧コードで予約を開く" / "この復旧
コードを失効" buttons, and a nested "復旧コードを依頼" (request a recovery code) box with 予約番号 /
登録メールアドレス inputs and a "復旧を依頼する" button.

Observations: this route was technically reached (screen captured, "not reached" does not
apply). This route also uses a visibly different page shell (no shared header/footer/nav
styling) from every other customer screen captured above.

**UX1-EV-02 recheck (resolved, not a harness bug):** re-ran the full save/open sequence
against the maintained server in a single Playwright `BrowserContext`/`Page` (per the TD's
exact 9-step recheck procedure), with the booking-access `POST /api/booking-access/issue`
response instrumented directly (status + timing, no cookie values logged). Result across 4
separate attempts (1 initial + 3 retries via the app's own "保存の完了は未確認です。同じ要求を
再照合してください" retry affordance): **`POST /api/booking-access/issue` returned HTTP 503
every single time**, `GET /api/booking-access` also returned 503, and no `zao_booking_access`
cookie was ever set (checked for existence only, per instruction). The earlier
"expired/no-access" observation was a downstream symptom of this 503, not a browser-context
bug in the audit script — the corrected recheck screenshots
(`screenshots/customer-reservation-confirmation-recheck-ja-390.png` / `-1440.png`) show the
booking-result screen itself, since the "保存した予約とQRを開く" link never appears without a
successful save.

This is consistent with the original NR-01 finding's documented condition
(`ZAO_BOOKING_ACCESS_RUNTIME` not connected when the app is started without the
`publicP1`/`publicP4`-equivalent flags) — i.e. a characteristic of how this maintained
review server instance happens to be started, not a product code defect. The existing
`tests/readiness/booking-access-ui.ts` suite (which boots with those flags) independently
and repeatedly verifies the identical save→open→QR-visible contract succeeding (reconfirmed
passing earlier in this same session's history-correction batch). No BookingAccess product
code was changed to investigate or "fix" this, per UX-1 scope.

---

## Staff / admin screens

**Result: 28/28 target screens captured (14 routes × 390/1440).** Per UX1-EV-01, the
maintained server's credential was never used again for this — instead, a throwaway script
(deleted after use, never committed) booted a fully isolated, disposable local app +
PostgreSQL instance via the same `startDevelopmentApp({operations:true})` +
`bootstrapDevelopmentAdmin` + `writeAccount` pattern already used by
`tests/operations/{console-ui,launch-ui,normal-ui}.ts` and `tests/notification/normal-ui.ts`.
A synthetic ADMIN account (`uxaudit-operator@example.invalid`, random throwaway password,
scope `ALL`) was created **only inside that disposable database** with every permission
those precedent files use across their own synthetic accounts (`INVENTORY_VIEW/EDIT`,
`BOOKING_VIEW/CREATE`, `HOLD_VIEW/EDIT`, `QUOTE_VIEW/CREATE`, `PRICE_EDIT`,
`TRANSFER_VIEW/PLAN/DISPATCH/RECEIVE`, `OPERATIONS_VIEW/ACKNOWLEDGE`, `FIELD_ACCEPTANCE`,
`RENTAL_CHECKOUT/RETURN/AMEND`, `NOTIFICATION_RESEND`), logged in through the real
`/staff/login` → `/api/auth/sign-in/email` → `/staff/ledger` form, then all 14 routes were
visited and screenshotted at 390 and 1440. `tests/recommendation/fixture.ts`'s
`seedRecommendation` populated realistic catalog/inventory data first (visible in the
ledger's 16 records below), and pages with an explicit "読み込む" load action
(amendments/quotes/inventory/prices/notifications/ops/launch) had it clicked once before
capture, matching how the precedent test suites themselves interact with those pages. The
isolated app/DB was stopped cleanly afterward. **The maintained server's own account,
credentials, and permissions were never touched**, and no product/test code was added to
the repo to enable this (the capture script lived under this worktree's already-gitignored
`.local/` and was deleted when done).

| Spec item | Route | Screenshots | Notes |
|---|---|---|---|
| home | `/staff` | `staff-home-{390,1440}.png` | Minimal: a heading and one "道具の台帳へ" link, nothing else. |
| ledger | `/staff/ledger` | `staff-ledger-{390,1440}.png` | Full "個体台帳" inventory table, 16 seeded records (skis/boards/boots), search/filter row, per-store status pills, a right-rail explainer panel. |
| rental | `/staff/rentals` | `staff-rentals-{390,1440}.png` | Rental/pickup workspace. |
| amendments | `/staff/amendments` | `staff-amendments-{390,1440}.png` | Amendment workspace, load button clicked; no seeded amendment records, so the list itself renders empty under its own filter controls. |
| holds | `/staff/holds` | `staff-holds-{390,1440}.png` | Hold workspace; no seeded active holds (none were created for this capture), so shows its normal empty state. |
| quotes | `/staff/quotes` | `staff-quotes-{390,1440}.png` | Quote workspace, load button clicked. |
| transfers | `/staff/transfers` | `staff-transfers-{390,1440}.png` | Transfer workspace. |
| wear | `/staff/wear` | `staff-wear-{390,1440}.png` | Wear-specific inventory view. |
| inventory | `/admin/inventory` | `admin-inventory-{390,1440}.png` | Inventory operations workspace, load button clicked. |
| prices | `/admin/prices` | `admin-prices-{390,1440}.png` | Price admin workspace, load button clicked. |
| assets | `/admin/assets` | `admin-assets-{390,1440}.png` | Asset/label printing view (ski/board QR labels). |
| notifications | `/admin/notifications` | `admin-notifications-{390,1440}.png` | Notification workspace, load button clicked. |
| ops | `/admin/ops` | `admin-ops-{390,1440}.png` | "運用例外" (operations exceptions) workspace, load button clicked; a one-paragraph explainer ("ここは業務状態の記録ではなく観測です…") precedes the filter controls; no seeded exceptions, so the result list is empty under the filters. A dev-mode "Compiling…" HMR badge is visible in one corner of this screenshot — that is a `next dev` tooling artifact of this capture method, not part of the shipped product UI. |
| launch | `/admin/launch` | `admin-launch-{390,1440}.png` | Launch-readiness gate, load button clicked. |

Two pre-existing blank-form screenshots remain from the earlier attempt against the
maintained server: `staff-login-390.png` / `staff-login-1440.png` (still valid as the
actual `/staff/login` screen's own appearance, unrelated to which server backs it).

**Note on empty states:** several pages above show their genuine empty/no-activity state
because this capture intentionally created no holds, amendments, or transfers beyond what
`seedRecommendation` provides — showing the actual current empty state is itself accurate
audit evidence, not a gap; populating every workflow state was out of scope for a visual
inventory pass.

---

## UX1-EV-03 — Candidate length variance (resolved: inventory-sensitive, not nondeterministic)

The original audit observed the "長め" (longer) candidate as 155cm in one capture and 165cm
in another for nominally the same input. Reverifying on the maintained server just now (for
the same 2035-01-05 input used originally) surfaced an even more direct version of the same
effect: only the "おすすめ" (recommended) candidate rendered at all — "短め"/"長め" had
become unavailable — consistent with this server's inventory for that date having been
further consumed by the many synthetic bookings this session's various audit passes have
since created against it (candidates the server returns as unavailable simply don't render
a radio row at all: `{Object.entries(m.candidates).map(([d,c])=>c&&<label ...>)}` in
`GuestBooking.tsx` skips any `null` candidate).

To test this properly under the TD's exact "same DB snapshot, no intervening HOLD/booking"
condition, a fresh **isolated** app + database was booted (same harness pattern as
UX1-EV-01, `startFlowApp({publicP0:true})` + `seedRecommendation`, a fixed
`inventory_clock()`), and the identical preview flow (same dates, same pole size, no
selection/checkout — `候補と参考料金を確認` only) was run twice against that one untouched
instance, back to back, with `inventory_holds` row count checked before/between/after (0 the
entire time, confirming preview truly never HOLDs stock, matching the UI's own "候補確認では
まだ在庫を確保しません" copy). Result: **both runs returned byte-identical candidates** —
`長め 155 cm`, `短め 145 cm`, `おすすめ 150 cm` both times.

**Classification: expected inventory-sensitive behavior, not a recommendation/candidate
determinism bug.** Under a genuinely fixed inventory snapshot the computation is stable;
the variation seen both originally and again just now tracks real inventory consumption on
a long-lived, repeatedly-booked-against server, not randomness in the algorithm. No
recommendation/candidate logic was inspected further or changed, per UX-1 scope.

---

## Foundation CI

- PR #26's own run [`35455085882`](https://github.com/ginisato-hash/zao-rental/actions/runs/35455085882) (HEAD `6c2d6880b12dbee25bd54f5c7714541f7d64e5f1`) completed: **success**.
- Per the TD's clarification (PR #26 changes only docs/screenshots, so this run is a valid
  repeat observation for the same product-code tree): the parent HEAD `6652a125`'s Foundation
  CI run `35453883418` failure (`PHASE5_E2E_FAILED normal draft revision change immediately
  invalidates prior metadata/media URLs`, actual 503 / expected 200) is recorded as a
  **non-deterministic CI/test incident** — the immediately preceding run on the same
  product-code tree (`35449537327`) passed this exact check, and this repeat run
  (`35455085882`) also passed it. No separate rerun of `35453883418` was performed, per
  instruction. No product code was changed in response to this.

---

## Screenshot inventory

- Customer: `docs/execution/prelaunch-uiux-v2/screenshots/customer-*.png` — 36 files
  (9 screens × {ja, en} × {390, 1440}), plus 2 reservation-recheck files
  (`customer-reservation-confirmation-recheck-ja-{390,1440}.png`) — **38 customer files**.
- Staff/admin: `docs/execution/prelaunch-uiux-v2/screenshots/{staff,admin}-*.png` — 28 files
  from the isolated-harness capture (14 routes × {390, 1440}) plus the 2 earlier blank
  `staff-login-{390,1440}.png` shots — **30 staff/admin files**.
- **68 screenshots total.**
