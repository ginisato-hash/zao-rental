# Phase UX-1 — Screen Audit

**Status:** Visual audit only. No product code was changed to produce this document or its
screenshots. No `DELETE`/`SHORTEN`/`MOVE`/`HIDE`/`ADVANCED`/`VISUAL`/`KEEP`/`ASSET`
annotations are applied here — that classification belongs to the Technical Director's
own review pass in Phase UX-2. This document only records what is currently on screen.

**Server:** the already-running, Owner-maintained local dev server at
`http://127.0.0.1:38946` (`next-server`, pid 2101). The server was only ever navigated
against (GET/POST calls a normal visitor or one synthetic booking would make); it was
never started, stopped, or restarted, and no source file under `apps/web` or `packages`
was modified to produce this audit.

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
apply), but it never showed the booking/QR that was just confirmed and saved in the same
run — it consistently rendered the no-access/expired state instead. This route also uses a
visibly different page shell (no shared header/footer/nav styling) from every other
customer screen captured above.

---

## Staff screens — BLOCKED

**Result: 0 of the requested staff screens were captured.** Per the coordinator's
correction, the existing credential file `.local/ui-review/credentials.txt` (already
present in this worktree, gitignored, not created by this session) was read **directly at
runtime by a throwaway Node/Playwright script** — the email/password never passed through
this agent's own context, any Bash command, or any file this agent wrote — and used once,
solely to fill `/staff/login`'s own email/password fields and submit the existing form. No
new staff account was created, no password was reset, and no permission was changed.

What happened: the blank `/staff/login` form was captured safely (before any value was
entered) at both 390 and 1440 — `screenshots/staff-login-390.png` and
`screenshots/staff-login-1440.png`. The one login submission did not complete within the
capture script's wait window: the button remained in its own busy state ("確認中…") and the
page neither redirected to `/staff/ledger` nor showed a visible error, so login success
could not be confirmed. A second, more patient verification attempt was itself blocked by
this environment's own safety control (flagged as a credential-handling/exploration
action), so no further login attempts were made, per the instruction not to retry or
brute-force. One screenshot from the single attempt inadvertently captured the still-filled
email field before the app's own post-submit reset ran (the password field was correctly
masked); that image was deleted immediately and is not present in the output directory —
no credential-bearing image is included anywhere in this deliverable.

Because authentication could not be confirmed, **none of the following routes were
captured**, and no code, config, account, or password was touched to try to unblock them:

| Spec item | Existing route (`apps/web/src/app/staff/*` or `apps/web/src/app/admin/*`) | Status |
|---|---|---|
| home | `/staff` | BLOCKED — auth not confirmed |
| ledger | `/staff/ledger` | BLOCKED — auth not confirmed |
| rental | `/staff/rentals` | BLOCKED — auth not confirmed |
| amendments | `/staff/amendments` | BLOCKED — auth not confirmed |
| holds | `/staff/holds` | BLOCKED — auth not confirmed |
| quotes | `/staff/quotes` | BLOCKED — auth not confirmed |
| transfers | `/staff/transfers` | BLOCKED — auth not confirmed |
| wear | `/staff/wear` | BLOCKED — auth not confirmed |
| inventory | `/admin/inventory` | BLOCKED — auth not confirmed |
| prices | `/admin/prices` | BLOCKED — auth not confirmed |
| assets | `/admin/assets` | BLOCKED — auth not confirmed |
| notifications | `/admin/notifications` | BLOCKED — auth not confirmed |
| ops | `/admin/ops` | BLOCKED — auth not confirmed |
| launch | `/admin/launch` | BLOCKED — auth not confirmed |

**Correction to this agent's own original draft:** the original pass here searched only
`apps/web/src/app/staff/*` and concluded these six had no route at all. That was wrong —
they exist as real, permission-gated pages under `apps/web/src/app/admin/*`
(`admin/inventory`, `admin/prices`, `admin/assets`, `admin/notifications`, `admin/ops`,
`admin/launch`, each checking a staff permission such as `OPERATIONS_VIEW`/
`INVENTORY_VIEW`/`PRICE_EDIT`/`QUOTE_VIEW` per file), confirmed by directly checking the
file tree for `/admin` as well as `/staff`. They are gated by the same staff login, so
they remain BLOCKED for the same reason as the `/staff/*` rows above, not because no page
exists. All 14 requested items do map to real routes; none are missing from the codebase.

**To unblock:** the Owner/Technical Director should confirm whether the credential in
`.local/ui-review/credentials.txt` is expected to be currently valid on this specific
maintained server instance, or supply/refresh one. No further login attempts should be
scripted from this task without that confirmation.

---

## Screenshot inventory

- Customer: `docs/execution/prelaunch-uiux-v2/screenshots/customer-*.png` — 36 files
  (9 screens × {ja, en} × {390, 1440}).
- Staff: `docs/execution/prelaunch-uiux-v2/screenshots/staff-login-390.png` and
  `staff-login-1440.png` only (2 files) — both the blank, pre-submission login form.
