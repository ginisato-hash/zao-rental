> Historical pre-redesign/WIP audit recovered from Claude. Findings describe that checkpoint, not the final candidate. See TAKEOVER_RECONCILIATION.md and VALIDATION.md for final dispositions and receipts.

# Functional Control Matrix: customer and public transaction surfaces

Scope: `apps/web/src/components/{GuestBooking,SquareCardPayment,BookingAccess,BookingCancellation,BookingRecovery,GuestRecovery,RequestBookingRecovery,GuestAvatarPreview,AvatarFitPreview,AvatarCustomerPreview,PublicPage,PublicChrome,HomeCampaigns}.tsx`, `guest-format.ts`, and the route files `app/page.tsx`, `app/customer/page.tsx`, `app/[locale]/**/page.tsx`. Line numbers are physical lines; most lines are very long.
Snapshot: f2 worktree, read 2026-10-13. Read-only audit; no code was changed.

Abbreviations: **GB** = GuestBooking.tsx. **`req()`** = `GB:61 request(path,body)`: it fetches `'/api/guest'+path`, uses GET when there is no body and POST with a JSON body otherwise, sets `cache:'no-store'` and `content-type: application/json`, and throws `Error(data.error)` with `.status` when the response is not ok. **`run(fn)`** = `GB:262`, the single wrapper for every wizard mutation (see the security notes). **`attempt(n,go)`** = `GB:307`, client validation that runs before a forward action.

## 0. Cross-cutting security and behaviour invariants (apply to many rows)

| # | Invariant | Where |
|---|---|---|
| S1 | Server: the guest API rejects a POST unless the `Origin` header equals the deployment origin and `sec-fetch-site` is not `cross-site`. **Every mutating call must stay a same-origin `fetch` from the page.** Do not move it to a third-party form post or another origin. | `lib/guest-http.ts` (ORIGIN_REJECTED 403) |
| S2 | Server: any query string on `/api/guest/*` is rejected (`INVALID_QUERY`). **Never add query params to these fetch URLs.** | guest-http.ts |
| S3 | Guest identity is an httpOnly-style cookie set by `POST /api/guest/context` with an **empty-object body `{}`** (the server rejects any keys). The module-level `starting` promise (GB:20) dedupes concurrent context creation across remounts. | GB:20, GB:249 |
| S4 | `run()` double-submit guard: `inFlight` ref (GB:112) makes a second call a no-op. `ticket` ref makes a stale response ignored. `alive` ref guards against updates after unmount. `busy` state disables controls. **Every mutation in the wizard must go through `run()`.** | GB:262-264 |
| S5 | Optimistic concurrency: every draft mutation sends `draftId` plus `expectedRevision` (from the last server draft). Checkout also sends `reviewHash`. The server rejects stale writes with `STALE_DRAFT`. | GB:320,353,356,369 |
| S6 | On a 401 from `run()`, local state is wiped: draft, input, directions, sessionStorage caches, savedInputJson. | GB:262 |
| S7 | `REFRESH_ON_ERROR` (`PRICE_CHANGED_REVIEW_REQUIRED`, `PRICE_REVIEW_REQUIRED`, `HOLD_OR_QUOTE_RECONCILIATION_REQUIRED`) triggers a **GET-only** re-read of `/draft`. It is never a payment retry. | GB:108, GB:264 |
| S8 | Error codes are never rendered raw. `errorText(code)` maps through `GUEST_ERROR_COPY` (GB:92), and unknown codes fall back to generic copy. Booking, payment, quote and preview enums are likewise mapped (GB:93,94,98,104), with a generic fallback. | GB:268,310 |
| S9 | Session storage holds non-secret data only. GB keeps a per-draft Input envelope (`zao-guest-draft-input:v2:<draftId>`, GB:36-60) and removes the legacy `zao-guest-draft-input` once (GB:250). Request-id keys: `zao-guest-recovery-request`, `zao-booking-access-request:<bookingId>`, `zao-booking-access-pending-revoke`, `zao-booking-recovery-exchange:<sha256(code)>`, `zao-booking-recovery-prepare:<bookingId>`. Codes, tokens and card data never go into storage or URLs. | listed files |
| S10 | History: only `{step:number}` is ever put in `history.state` (`pushState`/`replaceState`). A popstate is clamped by `computeMaxStep`. | GB:80-91,169-203,246-247 |
| S11 | Unsaved-input protection: `beforeunload` prompt (GB:260), and `guardNav` with `window.confirm` on the header links (GB:261). It is driven by `unsavedInput` (GB:162), **not** by `touched`. | GB:162,260-261 |
| S12 | **No `<form>` element exists in the wizard.** Buttons have no `type` attribute (default `submit`). If a redesign wraps steps in a `<form>`, every untyped button becomes a submit button. Either keep no form, or add `type="button"`. The wizard relies on `fieldset disabled` (GB:330) to disable all step 0-2 controls while `busy` or `draft.locked`. | GB:330 |

## 1. Control matrix

### 1A. `/[locale]/book`: GuestBooking wizard (route `app/[locale]/book/page.tsx:6` passes `locale` plus `legal={complete,terms,cancellation}`; the route is `noindex`)

| route/screen-state | component:line | control (element, accessible name JA / EN) | action | API call | security / permission dependency | disabled/loading/error/success | business semantics | must-preserve notes |
|---|---|---|---|---|---|---|---|---|
| all states (header) | GB:324 | `<Link className="wordmark">` containing `<BrandMark/>` (img alt=BRAND_NAME) → `/{locale}` | `onClick=guardNav` (confirm when there is unsaved input; `preventDefault` on cancel) | none | S11 | always enabled | home link | the guardNav handler is required on every header link |
| all (header nav `aria-label` メインナビゲーション / Main navigation) | GB:324 | `<Link>` プランを見る / View plans → `/{locale}/rental` | guardNav | none | S11 | — | leave to the plans page | test keys on `link 'プランを見る' exact` |
| all | GB:324 | `<Link>` text `EN` (ja) / `日本語` (en) → `/{other}/book`, `hrefLang` | guardNav | none | S11 | — | language switch (loses unsaved input) | `hrefLang` attribute |
| all | GB:325 | `<ol className="guest-steps" aria-label="予約の流れ/Booking steps">` with `li aria-current="step"`, class `guest-step--done`, `span.guest-step-number aria-hidden` | display only | — | — | — | 4-stage stepper (STEPS GB:102) | CSS keys on `li[aria-current]` and `.guest-step--done` |
| before draft | GB:329 | `<p role="status">` 予約用の画面を開いています… / Opening your booking workspace… | — | on mount: `POST /api/guest/context {}` then parallel `GET /draft`, `GET /options` (GB:249) | S3; the ticket guard | the step UI is not rendered until `draft` is set (GB:330) | create or resume the guest context | do not render the form before the draft loads |
| any (draft without checkout) | GB:324 | `p.guest-preview-note` 開発プレビューです… | — | — | shown when `!draft.checkout` (simulation or non-commercial) | — | dev disclaimer | the condition `draft&&!draft.checkout` |
| any | GB:326 | `p role=status .guest-status` 未保存の入力を復元しました / Unsaved entries restored | — | — | shown when `restoredNotice&&step<2` | — | CH-04B restore notice | test `getByText('未保存の入力を復元しました')` |
| any | GB:327 | `p role=status .guest-status` 保存されていない変更があります。… | — | — | shown when `touched&&unsavedInput` | — | unsaved banner | test `getByText('保存されていない変更があります')` |
| any | GB:328 | `p role="alert" .guest-alert` errorText(message) | — | — | S8 | shown while `message` is non-empty; cleared on success | server error copy | `role=alert` (tests read `getByRole('alert')`) |
| steps 0-2 | GB:330 | `<fieldset disabled={busy\|\|draft.locked}>` with `<legend>` = STEPS[min(step,2)] | — | — | S12 | disables every control on steps 0-2 | lock after HOLD/payment | keep the fieldset or an equivalent disable mechanism |
| step 0 | GB:332 | `input type=date`, label 利用開始日 / Start date (`label(text)` → `span.guest-label-text`) | `editInput` sets `period.startDate` and clamps `endDate` to ≥ start; `onBlur` → reveal('startDate') | none (local) | — | `aria-required`, `aria-invalid`/`aria-describedby="guest-err-startDate"` once revealed or attempted | rental start | the label text **is** the accessible name (exact match in tests). The required flag `span.guest-flag aria-hidden` sits outside the `<label>` (GB:301-302,321-323) |
| step 0 | GB:333 | `input type=date` 利用終了日 / End date, `min={startDate}` | sets `endDate`; reveal('endDate') | none | — | errors: missing, end<start, >10 days (GB:275-277) | rental end | `min` attribute; id `guest-err-endDate` |
| step 0 | GB:334 | `<select aria-label>` 利用枠 / Rental slot; options DAY 1日/Full day, AM 午前/Morning, PM 午後/Afternoon, MULTIDAY 2日以上/Multi-day | sets `period.slot`; reveal('slot') | none | — | errors: 1 day ⇒ AM/PM/DAY; 2–10 days ⇒ MULTIDAY (GB:278-279) | slot | option **values** DAY/AM/PM/MULTIDAY are the contract (test `selectOption('MULTIDAY')`) |
| step 0 | GB:335 | `<select aria-label>` 受取店舗 / Pickup store and 返却店舗 / Return store; options from `STORE_LABEL` (values MOUNTAIN_BASE / ONSEN_BASE, text = display name) | sets `pickupStore`/`returnStore` | none | — | — | stores; pickupStore also selects the Square `locationId` (GB:373) | option values must remain store IDs |
| step 0 | GB:336 | `button.guest-primary` 用品を選ぶ / Choose equipment | `attempt(0, ()=>pushStep(1))` (no server call) | none | — | on error: sets `attempted=0`, focuses the first invalid field (S-focus, §5) | proceed to equipment | exact name used by tests |
| step 1 | GB:337 | `.guest-compare` Regular / Premium articles | display only | — | — | — | plan explanation | — |
| step 1 | GB:338 | `input type=number` 利用人数 / Group size, min 1 max 20 | resizes `members` (keeps existing, appends `blank(j+1)` keyed `person-N`) | none | — | out-of-range values are ignored silently | group size 1–20 | `.guest-field--narrow`; member `key` format `person-N` (radio `name`) |
| step 1 (members>1) | GB:352 | `<details className="guest-person-toggle" open={n===activePersonIdx}>` with summary 利用者 N · {sportLabel} plus `span.guest-flag--error` 要確認 / Check | `onToggle` (opened) → `setActivePerson(n)` | none | UI only; never sent | the error flag shows when that person has a visible error | accordion per person | `attempt()` opens the person that holds the first error (GB:308) |
| step 1 per person | GB:340 | `<select aria-label>` 用品 N / Equipment N: SKI スキーセット, SNOWBOARD スノーボードセット, WEAR ウェアのみ | `sport(n,v)` resets tier, ski, height, foot, pole, model, wear (GB:266) | none | — | — | equipment type | label suffix ` N` (1-based) is in the accessible name (`'用品 1'`) |
| step 1 per person | GB:341 | `<select>` 年齢区分 N / Age category N: ADULT 大人, KIDS 子供 | resets tier, pole, model, jacket, pants; `ski.ageAtStart` 30/10 | none | — | — | adult/kid pricing | — |
| step 1 (not WEAR) | GB:342 | `<select>` プラン N / Plan N: REGULAR `Regular`; PREMIUM `Premium` (adult only) | sets tier; clears premiumModel and poleSize | none | — | — | Regular vs Premium | Premium offered only when `adultAtStart` |
| step 1 (not WEAR) | GB:343 | `input number` 身長cm N / Height cm N, 50–250 step 1 | `heightCm=Number(v)`; reveal(`m{n}-height`) | none | — | integer 50–250 error | sizing | id `guest-err-m{n}-height` |
| step 1 (not WEAR) | GB:344 | `input number` 足サイズcm N / Foot size cm N, 5–50 step 0.1, `inputMode=decimal` | footCm | none | — | 0.1 cm increments error | boot size | id `guest-err-m{n}-foot` |
| step 1 (SKI) | GB:345 | `input number` 体重kg N / Weight kg N, 5–300 step any | ski.weightKg | none | — | range error | ski length rec | id `guest-err-m{n}-weight` |
| step 1 (SKI) | GB:346 | `input number` 開始日の年齢 N / Age at start N, 0–120 | ski.ageAtStart | none | — | integer, and must match category (≥13 adult) | age rule | test `locator('#guest-err-m0-age')` |
| step 1 (SKI) | GB:347 | `<select>` スキーレベル N / Ski level N: BEGINNER 初級 / INTERMEDIATE 中級 / ADVANCED 上級 | ski.level | none | — | — | rec input | — |
| step 1 (SKI) | GB:348 | `<select aria-required>` ポールのサイズ N / Pole size N; placeholder `""` 選択してください / Choose a size; options `sizes(m,'POLE')` (`v.key`/`v.label`) | poleSize | none | — | required error | pole size | test `#guest-err-m0-pole`, `getByLabel('ポールのサイズ 1')` |
| step 1 (PREMIUM) | GB:349 | `<select aria-required>` モデルとシーズン N / Model and season N; placeholder 確認済みモデルから選択; options `name · season · lengths`; `<small>` when there are none | premiumModel | none | — | required for Premium | model promise | — |
| step 1 (WEAR) | GB:350 | `<select>` ウェアの用途 N / Wear sport N: SKI / SNOWBOARD | wearSport | none | — | — | wear use | — |
| step 1 per person | GB:351 | `<select>` ジャケットサイズ N / Jacket size N and パンツサイズ N / Pants size N; `""` 選択なし; options WEAR_JACKET / WEAR_PANTS sizes | jacketSize / pantsSize | none | — | `aria-required` once either is set or sport=WEAR; error if only one is set | jacket+pants is one set | required flag dynamic (`flag(m.sport==='WEAR')`) |
| step 1 | GB:353 | `p.guest-hint` 候補確認ではまだ在庫を確保しません。 | — | — | — | — | no HOLD yet | — |
| step 1 | GB:353 | `button.guest-secondary-button` 日程に戻る / Back to dates | `backToStep(0)` (pushes a history entry) | none | S10 | — | back | exact name in tests |
| step 1 | GB:353 | `button.guest-primary aria-busy={busy}` 候補と参考料金を確認 / Review sizes and estimates | `attempt(1, run(...))` | `POST /api/guest/draft {draftId, expectedRevision, input}` → then `POST /api/guest/preview {draftId:saved.id, expectedRevision:saved.revision}` | S4, S5 | busy → fieldset disabled; error → alert | save Input, then compute candidates and estimates (no HOLD) | the two-call order (save, then preview using the **returned** revision) |
| step 2 per person | GB:354 | `p` 参考料金 / Estimate: money(price.totalJpy) | — | — | — | — | per-person estimate | — |
| step 2 per person | GB:354 | `div.guest-candidates role="radiogroup" aria-label="利用者 N/Person N"` (plus aria-invalid/describedby `guest-err-c{n}`) containing `<label class="guest-candidate[ --primary]"><input type=radio name={m.key}>` in order SHORTER, RECOMMENDED, LONGER; text `span.guest-candidate-label` 短め/おすすめ/長め + `span.guest-candidate-value` `{lengthCm} cm` or 上下サイズ確認 / Wear sizes confirmed | `setDirections({[m.key]:d})` | none | radios render only when the candidate exists | error 長さを1つ選んでください。 | explicit length choice (no default) | radio `name`=member key; tests use `getByRole('radio',{name:/おすすめ/})` |
| step 2 per person | GB:354 | `p.guest-hint` previewReasonText(reason) | — | — | S8 | — | feasibility reason copy | — |
| step 2 per person | GB:354 | `<GuestAvatarPreview key={draft.id:revision:m.key} scope direction>` | see 1F | GET avatar | scoped to draft+revision+member | renders null on failure | optional visual | `key` forces a remount per revision |
| step 2 | GB:355 | `label.guest-choice` checkbox 全員のサイズ・モデル条件・ウェア構成を確認した / I confirm each person’s size, model promise and wear selections | `setAccepted` | none (the server receives a hard-coded `acceptedModelPolicy:true`) | client gate only | required (error key `accepted`) | consent to model/size promise | exact label in tests |
| step 2 | GB:355 | `label.guest-choice` checkbox 事前決済5％調整の見込みを確認する / Evaluate potential 5% advance-payment eligibility | `setAdvance` | sent as `wantAdvance` | part of `selectionSynced` (GB:87,167) | — | advance-payment discount flag | exact label in tests |
| step 2 | GB:356 | `button.guest-secondary-button` 用品とサイズに戻る / Back to equipment | backToStep(1) | none | — | — | back | — |
| step 2 | GB:356 | `button.guest-primary aria-busy` 全員分の最終確認へ / Review the whole group | `attempt(2, run(...))` | `POST /api/guest/selection {draftId, expectedRevision, directions, wantAdvance, couponCode:null, acceptedModelPolicy:true}` | S4, S5 | — | save selection → estimate and reviewHash | exact body keys (the server uses exact-key validation) |
| step 2 without preview | GB:357 | `p` 候補の内容を読み込めませんでした。… | — | — | — | — | error state | — |
| step 3 | GB:359 | `section.guest-review aria-label="全員分の確認/Group review"` with `h2` 最終確認 | — | — | — | — | final review region | tests use `getByRole('region',{name:'全員分の確認'})` |
| step 3, booking exists | GB:360 | `div.guest-result role="status"` containing `h3` bookingStatusText(state), `p.guest-result-total`, 決済状況: paymentStatusText per payment | — | — | S8 | — | booking outcome | heading text 予約が確認されました / Booking confirmed is used by tests |
| step 3, CONFIRMED / CONFIRMED_DEV | GB:360 | `<SaveBookingAccess bookingId>` (see 1C) | — | `POST /api/booking-access/issue` | — | — | save viewing access on this device | rendered only when `confirmedBooking` |
| step 3, booking with qrImage | GB:360 | `<picture><img width=240 height=240 alt>` 開発予約QR (state CONFIRMED_DEV) / 予約QR (Booking QR) | — | — | data URL from the server | — | booking QR | alt text is keyed in tests (`getByLabel('開発予約QR')`, `img 開発予約QR`) |
| step 3, booking not CONFIRMED/CONFIRMED_DEV/CANCELLED | GB:360 | `<button>` (no class) 決済状況を更新 / Check for a payment update | `run(req('/reconcile',{}))` | `POST /api/guest/reconcile {}` | S4 | `disabled={busy}` | re-read payment provider status (not a retry) | must remain non-payment (read/reconcile only) |
| step 3, booking and state ∉ COMPLETED/COMPLETED_DEV | GB:361 | `<BookingCancellation status={booking.cancellation}>` (see 1D, guest mode) | `onCancelled` → `run(GET /draft)` | `/api/guest/cancellation-preview`, `/api/guest/cancel` | — | — | guest self-cancel | — |
| step 3, booking | GB:375 | `<details className="guest-secondary">` summary 予約内容の詳細 / Booking details wraps the review body | native toggle | — | — | — | details are collapsed after booking | — |
| step 3, !locked | GB:363 | `button.guest-secondary-button` 条件を編集して再計算 / Edit and recalculate | backToStep(1) | none | `disabled={busy}` | — | go back to edit | exact name in tests (`Edit and recalculate` too) |
| step 3, booking | GB:364 | `p` 予約番号 / Booking reference: `<strong>{booking.id}</strong>` | — | — | — | — | reference for recovery requests | used as input to RequestBookingRecovery |
| step 3 | GB:365-366 | `dl.guest-facts` (dates, slot, stores, people) and per-person `article` `dl.guest-facts--compact` (length, model, wear) | — | — | — | — | review summary | — |
| step 3, estimate | GB:367 | `dl.guest-price`: 小計; ウェア調整 (only when bundleDiscount); 事前決済調整（見込み） (only when advanceDiscount); 全員分の参考総額 | — | — | — | — | price breakdown | **tests assert `dl.guest-price dt` texts exactly** `['小計','全員分の参考総額']`; conditional rows must stay conditional |
| step 3 | GB:368 | `p.guest-hint` 見積は最終確定額ではありません。; `p role=status .guest-alert` (legalBlocked); `small.guest-note` 税込 text | — | — | `legalBlocked = draft.checkout && legal.complete!==true` | — | legal gating notice | — |
| step 3, priceChanged | GB:369 | `section.guest-attention aria-label="料金の更新/Price update"` with h3, `dl.guest-price-change`, `button.guest-primary` 新しい料金を確認して続ける / Review the new price and continue | `run(...)` | `POST /api/guest/accept-price {draftId, expectedRevision, snapshotSha256}` | S4, S5; explicit accept, never automatic | `disabled={busy}` | accept the changed price before paying | region name and button text are keyed in tests |
| step 3, holdEnded or stockFailed | GB:370 | `section.guest-attention aria-label="予約を続けられません/This booking cannot continue"`, h3 在庫の確保期限が切れました / 在庫を確保できませんでした, `button.guest-primary` 最初から予約をやり直す / Start the booking again | `closeContext()` | `POST /api/guest/logout {}` then `location.assign('/{locale}')` | S4; wipes storage | `disabled={busy}` | abandon an unpayable draft | region name is keyed in tests |
| step 3, !booking && !holdEnded && !stockFailed | GB:371 | `input` (no type) `autoComplete=name`, label お名前 / Name (commercial) or お名前（架空） / Name (synthetic) | `setContact.displayName` | sent in checkout `contact` | `disabled={busy\|\|draft.locked}` | required error (`guest-err-name`) | buyer name | label text switches with `draft.checkout` |
| same | GB:371 | `input type=email inputMode=email autoComplete=email` メール / Email or メール（架空） / Email (synthetic) | setContact.email | contact.email; also Square `billingContact.email` | same | regex error (`guest-err-email`) | buyer email | — |
| same | GB:371 | `label.guest-choice` checkbox: commercial 利用開始48時間前までは全額返金。それ以降は自動返金なしのキャンセル規定に同意します。 / simulation 合成データによる開発確認であることを確認 | setContact.termsAccepted | `contact.termsAccepted` | same | required (`guest-err-terms`) | cancellation-policy consent | exact label texts keyed in tests |
| same (commercial, legal links) | GB:371 | `<a target=_blank rel=noopener>` 利用規約 / Terms of use; キャンセル・返金規定 / Cancellation and refund policy | navigation | — | `rel=noopener` | — | legal docs | keep `rel` |
| step 3, simulation (`!draft.checkout`) | GB:372 | `button.guest-cta-sticky.guest-primary aria-busy`: text 処理しています… / Working… (busy); この内容でもう一度支払う（開発用決済） / Pay again with these details (test payment) (locked); else この内容で支払う（開発用決済） / Pay with these details (test payment) | `attempt(3, run(req('/checkout',checkoutBody())))` | `POST /api/guest/checkout {locale, draftId, expectedRevision, reviewHash, contact:{displayName,email,termsAccepted}}` | S4, S5; `disabled = busy\|\|!simulation\|\|payBlocked` | busy label; `p role=status` 処理中です… | **server creates the HOLD, quote and booking, then starts payment** (`service.ts:54-56` → `prepare` → `startPayment`) | all three label variants are keyed in tests; sticky position via `.guest-cta-sticky` |
| step 3 | GB:372 | `p role=status` 内容が変更されています。… when `!contractSynced`; `p role=status` 処理中です… while busy; `p` この環境では決済接続が未設定です。 when `!simulation&&!checkout` | — | — | — | — | — | test `getByText('内容が変更されています')` |
| step 3, commercial (`draft.checkout`, !booking, estimate, !holdEnded, !stockFailed) | GB:373 | `<SquareCardPayment applicationId locationId={checkout.locations[pickupStore]} amountJpy={estimate.totalJpy} email>` (see 1B) | `onPay(token)` → `run(req('/checkout',{...checkoutBody(),paymentSource:token}))` | `POST /api/guest/checkout {…checkoutBody, paymentSource}` | `disabled = busy\|\|!termsAccepted\|\|!displayName.trim()\|\|!email\|\|payBlocked`. **This path does not call `attempt(3)`**, so it has no email regex check (difference vs. the simulation path) | — | real card payment with HOLD | the location comes from the **pickup** store |
| step 3, hold | GB:374 | `p.guest-hint` with `<time dateTime={hold.expiresAt}>` 在庫の確保期限 (ACTIVE) or the confirmed-stock sentence; `p.guest-hint` 保存済みの見積: money / quoteValidityText | — | — | S8 | — | hold expiry visibility | `<time dateTime>` |
| all (draft loaded) | GB:377 | `button.guest-secondary-button` 保存済みの結果を再読込 / Reload saved result | `run(req('/draft'))` | `GET /api/guest/draft` | S4 | `disabled={busy}` | safe re-read | exact name in tests |
| all (draft loaded) | GB:377 | `button.guest-secondary-button` この予約画面を閉じる / Close this booking context | `closeContext()` | `POST /api/guest/logout {}` then navigate to `/{locale}` | S4 | `disabled={busy}` | end guest context (cookie cleared server-side) | — |
| all (outside `<main>`, always) | GB:378 | `<details className="guest-secondary guest-main">` summary 予約をお持ちの方はこちら / Already have a booking? | native toggle | — | — | — | entry to GuestRecovery (1E) | summary text keyed in tests; rendered even before the draft loads |

### 1B. SquareCardPayment.tsx (inside GB step 3, commercial only)

| state | line | control | action | API call | security | states | semantics | must-preserve |
|---|---|---|---|---|---|---|---|---|
| mount | :16 | `<Script src="https://web.squarecdn.com/v1/square.js" strategy="afterInteractive">` | onReady → loaded; onError → error | Square CDN | CSP/script origin | — | load Web Payments SDK | exact script URL |
| loaded | :11-14,:16 | `<div ref={container}/>` (empty div; the Square card iframe is attached here) | `payments(appId,locationId).card().attach(div)`; destroyed on unmount or prop change | Square | card data stays in Square's iframe; the token is never stored (comment :6-7) | `ready` after attach | card entry | the container must stay a plain, empty, React-unmanaged child. Do not put children inside it |
| any | :16 | `section aria-labelledby={useId}` with `h3` カードで支払う / Pay by card | — | — | — | — | — | the useId linkage |
| ready | :16 | `<button aria-busy={busy}>` 支払って予約を確定 / Pay and confirm booking · ¥amount | `pay()` → `card.tokenize({amount:String(amountJpy),currencyCode:'JPY',intent:'CHARGE',customerInitiated:true,sellerKeyedIn:false,billingContact:{email}})` → `onPay(token)` | (GB) POST /api/guest/checkout with paymentSource | `sending` ref double-submit guard; `disabled = disabled\|\|busy\|\|!ready\|\|!safeInteger(amount)\|\|amount<1` | error `p role="alert"` カード情報または決済状況を確認してください。 | charge | tests match `getByRole('button',{name:/Pay/})` / `/支払う/` |

### 1C. BookingAccess.tsx: SaveBookingAccess (GB step 3) and ConfirmedBooking (`/[locale]/reservation`; route `reservation/page.tsx:7`, `noindex`, `referrer: no-referrer`, `main.guest-main style overflowWrap:anywhere`)

| state | line | control | action | API call | security | states | semantics | must-preserve |
|---|---|---|---|---|---|---|---|---|
| GB confirmed | :18 | `section aria-label="予約閲覧の保存/Save booking access"` containing `<button>` 予約閲覧をこの端末へ保存 / Save booking access to this device | `save()` | `POST /api/booking-access/issue {bookingId, requestId}` | requestId persisted at `sessionStorage['zao-booking-access-request:'+bookingId]` and reused (idempotent); `active` ref guard | `disabled={busy}`; `p role=status` success or unconfirmed copy | issue device-bound viewing access | region name and button text keyed in tests |
| saved | :18 | `<Link>` 保存した予約とQRを開く / Open the saved booking and QR → `/{locale}/reservation` | navigate | — | — | shown when `saved` | open the saved view | link name keyed in tests |
| GB confirmed | :18 | `<PrepareBookingRecovery>` (1E) | | | | | | |
| reservation mount | :29-38 | (no control) the initial `GET /api/booking-access` | setView or message | GET `/api/booking-access` | cookie-bound access; a 503 `BOOKING_ACCESS_UNCONFIGURED` gets a distinct message (:27) | `p role=status` message | read booking | **`pagehide` clears the view; `focus`/`pageshow` re-read it** (privacy on bfcache). Keep these listeners |
| reservation | :40 | `section aria-label="保存済み予約/Saved booking"`, `h1` 予約確認・QR, status text, period, stores, `<time dateTime={dueAt}>`, total, `img alt="保存済み予約QR/Saved booking QR"` 240×240 | — | — | — | — | view | img alt keyed in tests |
| reservation, cancellable | :40 | `<BookingCancellation accessBookingId={view.id} onCancelled={reload}>` (1D) or the text キャンセルするには… | — | `/api/booking-access/cancellation-preview`, `/cancel` | `cancellationAllowed` from server (10-minute recovery window) | — | cancel via access | — |
| reservation | :40 | `<button>` 予約を再読込 / Reload booking | `reload()` | GET `/api/booking-access` | ticket guard; `revoking` ref blocks it | `disabled={busy\|\|reading}` | re-read | exact name keyed |
| reservation | :40-57 | `<button>` この端末の予約閲覧権を失効 / Revoke viewing access on this device | stores `zao-booking-access-pending-revoke`=bookingId, then POST, then clears the issue request key and the pending key | `POST /api/booking-access/revoke {}` | `revoking` ref; pending-revoke survives a lost acknowledgement | `disabled={busy\|\|reading\|\|(!view&&!pendingBookingId)}`; status message | revoke device access | button name keyed |
| reservation | :57 | `<BookingRecoveryForm beforeChange afterChange>` (1E) | the before hook clears the view and sets busy; the after hook re-reads | — | — | — | — | — |

### 1D. BookingCancellation.tsx (guest mode: base `/api/guest/`; access mode, when `accessBookingId` is set: base `/api/booking-access/` with `bookingId` in the body)

| state | line | control | action | API call | security | states | semantics | must-preserve |
|---|---|---|---|---|---|---|---|---|
| not cancelled | :17 | `section aria-label="予約のキャンセル/Cancel booking"` containing `<button>` 予約をキャンセル / Cancel booking | `act(false)` | `POST {base}cancellation-preview` body `{}` or `{bookingId}` | `pending` ref guard | `disabled={busy}`; `p role="alert"` error | get refund preview | region name and button text keyed (exact) |
| preview shown | :17 | `h3` キャンセル内容の最終確認, refund `<strong>`, paymentUncertain note, policy text; `<button>` この返金額でキャンセルを確定 / Confirm cancellation with this refund amount | `act(true)` | `POST {base}cancel {bookingId?, requestKey, previewHash}` | **`requestKey` = `crypto.randomUUID()` stored in the `key` ref once and reused for every retry (idempotency)**; `previewHash` binds the shown refund amount | on non-ok: preview cleared and error shown | irreversible cancel | keep the 2-step preview → confirm; never confirm without previewHash |
| preview shown | :17 | `<button>` 予約を維持する / Keep booking | `setPreview(null)` | none | — | — | abort | name keyed |
| cancelled | :15-16 | `section aria-label="キャンセル状況/Cancellation status"`, `h3` 予約をキャンセルしました, `p role=status` refund label, late reason, refunded amount; `<button>` 状況を更新 / Refresh status | `onCancelled()` (parent re-read) | parent GET | — | `disabled={busy}` | refund status view | region names keyed in tests (JA/EN) |

### 1E. Recovery components

| state | component:line | control | action | API call | security | states | semantics | must-preserve |
|---|---|---|---|---|---|---|---|---|
| GB footer details | GuestRecovery:8 | `section.guest-main aria-label="予約画面の回復/Recover booking access"` containing `<button>` 回復コードを作成 / Create recovery code | `enroll()` | `GET /api/guest/security` then `POST /api/guest/recovery-code {expectedRevision:m.revision}` | `busy` state guard (no ref) | `disabled={busy}`; `p role=status` message | enrol a 43-character recovery code for this guest context | region name and button text keyed |
| after enrol | GuestRecovery:8 | `label` checkbox 回復コードを表示 / Show recovery code | `setShow` toggles the input type | none | — | — | reveal code | — |
| after enrol | GuestRecovery:8 | `input readOnly type=password/text autoComplete=off` label 保存する回復コード / Recovery code to keep (inline style maxWidth 100%) | — | — | code shown only in memory | — | copy code | label keyed |
| always | GuestRecovery:8 | `input type=password maxLength=43 autoComplete=off` 控えた回復コード / Your recovery code | setCode | — | — | — | enter code | label keyed |
| always | GuestRecovery:8 | `<button>` 保存済み予約画面を回復 / Recover saved booking | `recover()`, then on success remove the key, clear the code, `location.reload()` | `POST /api/guest/recover {code, requestId}`, requestId from `sessionStorage['zao-guest-recovery-request']` | idempotent requestId; server sets the cookie | `disabled={busy\|\|code.length!==43}` | restore guest context | the `location.reload()` is load-bearing (GB mount treats `reload` navType as a fresh baseline, GB:169-190) |
| reservation | BookingRecovery:21 | `section aria-label="予約閲覧の復旧/Recover booking access"` containing `h2` 別の端末で予約を確認 and `<form method="post" onSubmit=preventDefault>` | — | — | — | — | — | the form has `method="post"` but submission is always prevented; keep `preventDefault` |
| reservation | BookingRecovery:21 | `input type=password autoComplete=off maxLength=43` label 予約復旧コード / Recovery code | setCode | — | — | `disabled={busy}` | — | label keyed exact |
| reservation | BookingRecovery:21 | submit `<button>` 復旧コードで予約を開く / Open the booking with this code | `send('exchange')` | `POST /api/booking-access/recovery/exchange {code, requestId}` with requestId at `sessionStorage['zao-booking-recovery-exchange:'+sha256hex(code)]` | regex `^[-_A-Za-z0-9]{43}$`; raw code never stored; `active` ref | `disabled={busy\|\|!code}`; success → `window.location.reload()`; failure → code cleared and `p role=status` | exchange the code for 10-minute access | name keyed exact |
| reservation | BookingRecovery:21 | `<button type="button">` この復旧コードを失効 / Revoke this recovery code | `send('revoke')` | `POST /api/booking-access/recovery/revoke {code}` | same | same | revoke the code and its access | `type="button"` (must not submit) |
| GB confirmed (inside SaveBookingAccess) | BookingRecovery:26 | `section aria-label="予約復旧コードの配送/Deliver a recovery code"` containing `<button>` 復旧コードの配送・照合 / Deliver and reconcile the recovery code | inline async | `POST /api/booking-access/recovery/prepare {bookingId, requestId}` with requestId at `sessionStorage['zao-booking-recovery-prepare:'+bookingId]` | `active` ref, idempotent | `disabled={busy}`; message by `delivery` QUEUED/DELIVERED/other | queue code delivery | — |
| reservation (inside BookingRecoveryForm) | RequestBookingRecovery:7 | `section aria-label="予約復旧を依頼/Request booking recovery"`, `h3`, `<form method=post onSubmit=preventDefault>`; `input required maxLength=36 autoComplete=off` 予約番号 / Booking reference (trimmed on change); `input required type=email maxLength=254 autoComplete=email` 登録メールアドレス / Registered email; submit 復旧を依頼する / Request recovery | `send()` | `POST /api/booking-access/recovery/request {bookingId, email(lowercased, trimmed), requestId, locale}` | `intent` ref reuses the requestId while bookingId and email are unchanged; `active` ref; 429 has its own copy | `disabled` while busy or a field is empty; `p role=status` | request a code by email | **locale comes from `usePathname().startsWith('/en/')`**, not a prop. Keep the route shape or pass a prop |

### 1F. Avatar previews

| state | component:line | control | action | API call | security | states | semantics | must-preserve |
|---|---|---|---|---|---|---|---|---|
| GB step 2 | GuestAvatarPreview:12-19 | (fetch) | — | `GET /api/guest/avatar/{guestAvatarPath(scope)}` (`credentials:same-origin`, abortable) | scope = draftId, revision, memberKey | renders null when there is no path, no payload, or an error; no retry | optional | read-only; no business callback |
| loaded | GuestAvatarPreview:23 | `section.guest-avatar aria-label="参考イメージの見た目/Reference appearance"` containing a fieldset/legend 見た目 and `<button type=button aria-pressed>` 見た目 N / Appearance N | `setAppearance` | none | — | — | change illustration only | `aria-pressed` (CSS `.avatar-buttons button[aria-pressed=true]`); names `'見た目 2'` / `'Appearance 2'` keyed |
| loaded | AvatarFitPreview:20-30 | no controls. `section.avatar-fit aria-label="サイズの見た目を確認/Visual size reference"`, `h2` 長さのバランスを見る, `[data-avatar-stage]`, `.avatar-layer[data-layer][data-match] aria-hidden` with `<Image unoptimized>` src `/guest-avatar-media/{scope}/{id}/{sha}`, `.avatar-measures aria-live="polite"`, `.avatar-disclaimer` | Layer `onError` → hide | GET images (unoptimized, so each GET re-authorizes) | scoped media path | — | — | tests key on `[data-avatar-stage]`, `[data-layer="AVATAR"|"SKI"] img`, `.avatar-disclaimer`, heading 長さのバランスを見る, text `Your height`; keep `unoptimized` |
| staff preview (no customer route found in scope) | AvatarCustomerPreview:11-12 | appearance `<button type=button aria-pressed>` 見た目 N; direction buttons 短め/おすすめ/長め with `<small>{cm}</small>`, `disabled` when there is no candidate | setAppearance / setDirection | none | — | `p role=status` when there is no artwork | staff-only visual | `aria-pressed`, disabled logic |

### 1G. Public chrome and pages (`/[locale]/[[...page]]`, `/legal/[doc]`, `/rental/premium/[slug]`, `/reservation`)

| state | component:line | control | action | API | security | states | semantics | must-preserve |
|---|---|---|---|---|---|---|---|---|
| all public | PublicChrome:42-46 | `Link.pc-logo aria-label="{BRAND_NAME} ホーム/home"` (inside `h1` with `span.pc-sr` heading when homeHeading) | `close()` | — | — | — | home | on home the logo sits in `<h1>` with sr-only text |
| desktop | PublicChrome:47 | `nav.pc-links aria-label="メインナビゲーション"`: レンタル/RENTAL, 店舗/STORES, よくある質問/FAQ, 予約する/BOOK | navigate | — | — | — | primary nav | — |
| mobile | PublicChrome:48 | `button.pc-menu-btn type=button aria-expanded aria-controls="pc-menu" aria-label="メニューを開く/Open menu"` text MENU | `setOpen(true)` | — | — | — | open modal menu | tests: name メニューを開く; focus returns here (checked via aria-label) |
| menu open | PublicChrome:51 | `div#pc-menu.pc-menu role=dialog aria-modal=true aria-label="メニュー/Menu"` | see §5 | — | — | `.pc-pill.is-open{visibility:hidden}`; `.public-shell:has(.pc-menu) .pc-view{visibility:hidden}` | modal menu | id `pc-menu`; tests check white link colour, contrast, CTA hidden, inert background |
| menu open | PublicChrome:52 | `button.pc-menu-close aria-label="メニューを閉じる/Close menu"` text CLOSE | `returnFocus=true; setOpen(false)` | — | — | — | close | name keyed |
| menu open | PublicChrome:53,55,56,58 | links: categories (SKI, SNOWBOARD, WEAR, PREMIUM, キッズ・ファミリー, 料金); small (受取・返却, よくある質問, 予約の確認/MY BOOKING → /reservation, ENGLISH/日本語 with hrefLang); `Link.pc-menu-book` 予約する/BOOK; campaign cards `Link.pc-menu-card` | `onClick=close` | — | — | — | nav | `.pc-menu-cats a`, `.pc-menu-small a` (tests check colour); link `SKI` exact |
| all public | PublicChrome:73-76 | footer `.pc-footer` columns of links (stores, rental, booking incl. /reservation, legal from `legalLinks`, language with hrefLang); `Link /staff/login` スタッフ入口/STAFF | navigate | — | — | — | — | `.pc-footer a` is used by tests |
| home | HomeCampaigns:27-28 | `section.pc-hero aria-roledescription="カルーセル/carousel" aria-label={heading}` with touch, keyboard and hover/focus handlers | swipe ≥48px, horizontal ratio 1.5, ≤800ms → step; ArrowLeft/Right → step; hover/focus pause; click capture cancels a click after a swipe | — | — | autoplay every 5000ms unless paused, reduced motion, <2 items, or `document.hidden` | campaign carousel | tests dispatch `mouseenter` on `.pc-hero`, CDP swipes |
| home | HomeCampaigns:30-31 | `Link.pc-slide[.is-active] aria-hidden={!active} tabIndex=-1` with a picture (desktop source ≥768px) | navigate | — | — | — | campaign photo | test reads `.pc-slide.is-active` href = `.pc-view` href |
| home | HomeCampaigns:34-36 | `ul.pc-wheel aria-label="企画/Campaigns"` with `li aria-hidden={d!==0}` containing `<button type=button tabIndex aria-current>` {title} | `step(d)` | — | — | only distinct rows (VIS-02) | wheel | tests: `.pc-wheel li button` count 3 unique; exactly 1 `li[aria-hidden="false"]` |
| home | HomeCampaigns:38 | `p.pc-title-m aria-live={paused?'polite':'off'}` | — | — | — | — | mobile title | `.pc-title-m` keyed |
| home | HomeCampaigns:39 | `.pc-step` `<button type=button aria-label="前の企画/Previous campaign">&lt;` and `"次の企画/Next campaign">&gt;` | step(∓1) | — | — | — | prev/next | aria-labels |
| home | HomeCampaigns:40 | `Link.pc-view` {current.label} → current.href (CSS vars `--btn-bg`, `--btn-fg`) | navigate | — | — | hidden while the menu is open (CSS) | campaign CTA | `.pc-view` keyed (visibility asserted) |
| content pages | PublicPage:27 | `Link.public-cta` 日程から選ぶ / Start with dates → `/{locale}/book` | navigate | — | — | — | booking entry | — |
| /rental hub | PublicPage:25 | `<details className="public-explore public-secondary">` summary 用品カテゴリから選ぶ / Browse by equipment category | toggle | — | — | — | category cards | — |
| content pages | PublicPage:24 | `Link.public-card` (span = path segment upper-cased, b heading, small summary) | navigate | — | — | — | category cards | — |
| /rental/premium | PublicPage:32 | `Link` `{name} · {season}` → model page | navigate | — | — | — | verified models | — |
| content pages | PublicPage:33 | `nav.public-links aria-label="ご利用ガイド/Rental guides"` of links | navigate | — | — | — | guide links | — |
| premium model page | premium/[slug]/page.tsx:12 | `Link` Premium (back); `Link.public-cta` 日程から選ぶ → /book | navigate | — | — | WITHDRAWN slug → `permanentRedirect('/{locale}/retired/{slug}')` | model detail | redirect behaviour |
| legal page | legal/[doc]/page.tsx:11-14 | none (text only) | — | — | unapproved document → 404 | — | legal text | — |
| `/` | app/page.tsx:3 | none: `redirect('/ja')` | — | — | — | — | — | keep |
| `/customer` | app/customer/page.tsx:3 | none: `redirect('/ja/book')` | — | — | — | — | legacy entry | keep |

## 2. GuestBooking wizard step machine

- **State variable:** `step` (`useState(0)`, GB:111). The step is set only through `pushStep(n)` (GB:246), `backToStep(n)` (GB:247), `open()` initial/forward (GB:227-233), and `onPopState` (GB:191-200). Each of these also resets `touched` (and `attempted`).
- **Steps (STEPS GB:102):** 0 日程・店舗 / Dates & stores; 1 用品・利用者情報 / Equipment & people; 2 候補選択 / Choose sizes; 3 全員分確認・支払い / Review & pay. Steps 0-2 render inside `<fieldset disabled={busy||draft.locked}>` (GB:330). Step 3 is `section.guest-review` outside the fieldset (GB:359).
- **Progress cap:** `computeMaxStep(draft,input,directions,advance)` (GB:80-91). It returns:
  - 0 when there is no draft;
  - 3 when `locked`;
  - 1 when the period is valid;
  - 2 only when `inputSynced` and `preview` exists;
  - 3 only when `selectionSynced` and one of selection, booking or hold exists.
  It clamps popstate and the initial resume.
- **Progression gates:**
  - 0→1: `attempt(0)`, client-only (dates, ≤10 days, slot rule). No API call.
  - 1→2: `attempt(1)` per-person checks (GB:281-294), then `POST /draft` (save Input), then `POST /preview`. The step advances via `open()` (maxForDraft > current).
  - 2→3: `attempt(2)` (a direction for every person plus the `accepted` checkbox), then `POST /selection`. The server returns the estimate and `reviewHash`.
  - Pay (step 3): `attempt(3)` (name, email regex, termsAccepted) for the simulation button; the `disabled` predicate for Square. Both are additionally blocked by `payBlocked = !contractSynced || priceReviewRequired || holdEnded || stockFailed || legalBlocked` (GB:318).
- **HOLD / payment preparation:** there is **no client-side HOLD call**. Preview and selection explicitly do not hold stock (GB:353 hint; test "without early HOLD" asserts `inventory_holds` count 0). The HOLD, quote and booking are created server-side inside `POST /api/guest/checkout` (`packages/core/src/guest/service.ts:54-56`: `prepare()` then `bookings.startPayment`). The `/prepare-payment` endpoint exists server-side but is **not called** by this UI. After checkout the draft is `locked`, and `hold` is set with `state` and `expiresAt`.
- **Derived post-checkout states (GB:312-318):**
  - `confirmedBooking` = booking.state ∈ {CONFIRMED, CONFIRMED_DEV}.
  - `holdEnded` = no booking, hold exists, and hold.state≠ACTIVE.
  - `stockFailed` = no booking, locked, and no hold.
  - `priceChanged` = no booking, !holdEnded, priceReviewRequired, and quote.validity==='VALID_PRIVATE_ESTIMATE'.
  - The accept-price section shows when priceChanged. The cannot-continue section shows when holdEnded or stockFailed (the only action is closeContext).
- **After success (booking exists):** `div.guest-result role=status` (status heading, total, payment states, `SaveBookingAccess` when confirmed, QR image, reconcile button when not final), then `BookingCancellation` (unless COMPLETED). The review body is collapsed into `<details>` 予約内容の詳細 and includes the 予約番号.
- **Recovery section:** `<details className="guest-secondary guest-main">` 予約をお持ちの方はこちら containing `<GuestRecovery>` (GB:378). It is rendered **always**, outside `<main>`, even before the draft loads and at every step. GuestRecovery's success does `location.reload()`, and the GB mount treats a non-`back_forward` navigation as a fresh baseline adopting the server step (GB:169-190).
- **Other state machinery:** the sessionStorage Input envelope (restore only on the initial load, same draft, revision and fingerprint; GB:53-60,208-210,253-255). The simulation prefill of contact uses `SYNTHETIC Guest` / `synthetic-guest@example.invalid` (GB:235). `activePerson` is UI-only (GB:149). `shown`/`attempted` drive inline error visibility (GB:154,299-300).

## 3. className inventory (for CSS rewrite)

JS-coupled classes are **bold**. Coupled means used by component JS, server tests, or CSS whose behaviour the tests assert.

- **GuestBooking:** **`public-shell`** (PublicChrome's menu uses `closest('.public-shell')` for inert, and CSS `:has(.pc-menu)`), `public-header`, `wordmark`, `guest-main`, `guest-preview-note`, `guest-steps` (CSS uses `li[aria-current]`), `guest-step--done`, `guest-step-number`, `guest-status`, `guest-alert`, `guest-grid`, `guest-field`, `guest-field--narrow`, `guest-flag`, `guest-flag--required`, `guest-flag--error`, `guest-label-text`, `guest-field-error` (its **id `guest-err-<key>`** is JS-coupled: `attempt()` queries `[aria-describedby="guest-err-<key>"]`; tests use `#guest-err-m0-age` and `#guest-err-m0-pole`), `guest-actions`, `guest-primary`, `guest-secondary-button`, `guest-compare`, **`guest-person`** (tests `locator('.guest-person')` in avatar tests), `guest-person-toggle`, `guest-hint`, `guest-candidates` (CSS `[aria-invalid=true]`), `guest-candidate`, `guest-candidate--primary`, `guest-candidate-label`, `guest-candidate-value`, `guest-choice`, `guest-review`, `guest-result`, `guest-result-total`, `guest-secondary` (details), `guest-facts`, `guest-facts--compact`, `guest-review-people`, **`guest-price`** (tests: `dl.guest-price dt/dd` exact texts), `guest-price-change`, `guest-note`, `guest-attention`, `guest-contact`, `guest-cta-sticky` (sticky CTA, visual but behavioural on mobile), `guest-footer-actions`.
- **GuestRecovery:** `guest-main` (on the section). Inline style `maxWidth:100%` / `boxSizing:border-box` on the inputs.
- **SquareCardPayment, BookingAccess, BookingCancellation, BookingRecovery, RequestBookingRecovery:** no classNames (unstyled except through ancestor `.guest-main` CSS). The reservation route wraps them in `main.guest-main` with inline `overflowWrap:anywhere`.
- **GuestAvatarPreview:** `guest-avatar`, `avatar-buttons` (CSS `button[aria-pressed=true]`).
- **AvatarFitPreview:** `avatar-fit`, `avatar-heading`, `avatar-eyebrow`, `avatar-stage-wrap`, `avatar-stage`, `avatar-floor`, `avatar-layer`, `avatar-measures`, `avatar-reference-label`, **`avatar-disclaimer`** (tests). **Data attributes:** `data-avatar-stage`, `data-layer`, `data-match` (tests); inline layout `style` (left, top, width, height %, aspectRatio, floor top) is computed. Keep it.
- **AvatarCustomerPreview:** `avatar-preview`, `avatar-preview-header`, `avatar-eyebrow`, `avatar-test-notice`, `avatar-preview-grid`, `avatar-controls`, `avatar-buttons`, `avatar-directions`, `avatar-control-note`.
- **PublicPage:** **`public-shell`**, `public-shell--home`, `public-home`, `public-preview-note`, `public-compare`, `public-compare-grid`, `public-card-grid`, `public-card`, `public-explore`, `public-secondary`, `public-main`, `public-head`, `public-lead`, `public-cta`, `public-detail`, `public-links`.
- **PublicChrome:** `pc-header`, **`pc-pill`** and **`is-open`** (CSS hides the pill when open), `pc-logo`, `pc-logo-img` (also BrandMark), **`pc-sr`** (sr-only home heading), `pc-links`, `pc-menu-btn`, **`pc-menu`** (CSS `:has(.pc-menu)` hides `.pc-view`; tests read its background alpha), `pc-menu-top`, `pc-menu-close`, **`pc-menu-cats`**, `pc-menu-foot`, **`pc-menu-small`** (tests assert link colour `rgb(255,255,255)`), `pc-menu-book`, `pc-menu-cards`, `pc-menu-card`, **`pc-footer`** (tests check inert and focus), `pc-footer-in`, `pc-footer-grid`, `pc-footer-logo`, `pc-copy`.
- **HomeCampaigns:** **`pc-hero`** (tests dispatch mouseenter), `pc-frame`, `pc-clip`, **`pc-slide`** and **`is-active`** (tests and CSS `opacity`/`pointer-events`), **`pc-wheel`** (tests: `li[aria-hidden]`, `li button`; inline `transform`/`opacity`/`color` per row), **`pc-title-m`** (tests), `pc-step`, **`pc-view`** (tests: href and visibility; CSS vars `--btn-bg`/`--btn-fg`; image CSS vars `--pos-d`/`--pos-m`).
- **Legal route:** `public-main`, `public-legal`, `public-detail`, `public-legal-meta`. **Premium route:** `public-main`, `public-cta`; inline `maxWidth`/`height:auto` on the img.
- **JS `querySelector`/`closest` in components:** only GB:308 (`[aria-describedby="guest-err-…"]`) and PublicChrome:29-31 (`closest('.public-shell')`, `:scope > *`, `a[href],button:not([disabled])` inside the panel). The inert logic marks **direct children of `.public-shell`** as inert except the panel. Therefore **the menu panel must remain a direct child of `.public-shell`**, and all other page content must be in sibling subtrees.

## 4. User-visible raw/internal or developer strings (relabel candidates; nothing was changed)

| location | string shown to customers |
|---|---|
| GuestRecovery:8 | 「…料金・予約期限・**HOLD期限**は変わりません」 / "…price, dates or **HOLD expiry**" (the internal term HOLD) |
| GuestRecovery:6 | 「…未接続の場合は準備完了まで利用できません」 / "an unconnected service is not ready" (developer wording) |
| GB:364 | 予約番号: raw booking UUID `draft.booking.id` (needed for recovery requests, but it is a raw UUID) |
| GB:311 / GB:365 | dates rendered as raw ISO `YYYY-MM-DD → YYYY-MM-DD` |
| BookingAccess:40 | `{view.period.startDate} → {view.period.endDate}` raw ISO dates |
| BookingAccess:40 | 開発用の合成予約です… shown whenever `view?.mode!=='SQUARE_PRODUCTION'`. This **includes while loading or on error (view null)**, so production users see the dev notice during loading |
| BookingAccess:17,18 | 「同じ要求を再照合してください」「メール復旧接続待ちです」「別端末へのメール配送は未接続です」 / "email-based recovery is not yet connected" |
| BookingAccess:56 | 「失効完了は未確認です。再度照合してください。」 (reconcile jargon) |
| BookingRecovery:19,26 | 「…照合してください」「配送事業者は未接続で…」「配送は未接続…コードをチャットへ送らないでください」; button 復旧コードの配送・照合 |
| RequestBookingRecovery:6 | "Delivery is not yet connected…" / 配送は現在未接続… |
| GB:324 | 開発プレビューです。架空の情報だけを使用してください。… (when `!draft.checkout`) |
| GB:371-372 | お名前（架空）, メール（架空）, 合成データによる開発確認であることを確認, この内容で支払う（開発用決済）, この内容でもう一度支払う（開発用決済）, この環境では決済接続が未設定です。 |
| GB:235 | prefilled contact values `SYNTHETIC Guest`, `synthetic-guest@example.invalid` (simulation) |
| GB:360 | QR alt 開発予約QR / Development booking QR (CONFIRMED_DEV) |
| GB:349 | 公開確認済みモデルはまだありません。 / "No models are approved for this preview yet." |
| GB:368, PublicPage:30 | 利用規約は公開前確認中です。 / 公開文言・利用規約は公開前確認中です。 |
| GB:92 error copy reachable by customers | `PAYMENT_NOT_CONNECTED_CHARGE_DISABLED`/`GUEST_UNCONNECTED`/`GUEST_PREVIEW_UNCONNECTED` → 「この環境では…未接続です」; `ANALYTICS_SHAPE` → 内部データの形式でエラー; `NO_PAYMENT_ATTEMPT` → 決済の照合対象 |
| GB:94 | PAYMENT_STATE `UNKNOWN` → 「…もう一度照合してください」 / "Reconcile again shortly." |
| GB:98 | QUOTE_VALIDITY `HOLD_RECONCILIATION_REQUIRED` → 決済状況の確認待ちです / "Waiting on a payment reconciliation" |
| GB:268 / GB:337 / GB:342 / GB:366 | `Regular` / `Premium` untranslated in JA (tierLabel, option text, h2) |
| GB:349 | option text `{p.name} · {p.season} · {lengths}` (season is a raw catalogue value) |
| GB:348,351 | size option text `v.label` (server catalogue labels, unverified for customer wording) |
| PublicPage:24 | card eyebrow `p.path.split('/')[1].toUpperCase()`, the raw URL segment (SKI/SNOWBOARD/WEAR/PREMIUM) |
| PublicPage:19, premium/[slug]:12 | 予約受付前の開発プレビューです… / 非公開開発プレビュー。公開承認は別途確認中です。 (when `!publicationApproved()`) |
| legal/[doc]:14 | `approvedAt.slice(0,10)`, a raw ISO date |
| AvatarFitPreview:21 | eyebrow `SIZE REFERENCE` (EN in JA) |
| AvatarCustomerPreview:10 | `ZAO RENTAL · STAFF PREVIEW`, `SYNTHETIC · TEST ONLY` (staff surface) |
| PublicChrome:48,52 | `MENU`, `CLOSE` (EN-only visible text; accessible names are localised) |
| BookingCancellation:16 | late-cancel deadline uses `toLocaleString` (EN `en-GB` + "JST"; JA without a JST suffix) instead of `jstDateTime` |

## 5. Focus, keyboard, live regions, scroll lock (must preserve)

| location | mechanism |
|---|---|
| PublicChrome:26-37 | **Modal menu:** on open, `document.body.style.overflow='hidden'` (restored to the previous value on close or unmount); every direct child of `.public-shell` except the panel gets `inert=true` (restored); focus moves to the first `a[href],button:not([disabled])` in the panel; **Tab/Shift+Tab focus trap** cycles within the panel; **Escape** closes; on close via Escape or CLOSE, focus returns to the MENU toggle (`returnFocus` ref). The toggle has `aria-expanded`/`aria-controls="pc-menu"`; the panel has `role=dialog aria-modal=true aria-label`. Menu links call `close()`, which does **not** return focus (navigation). Tests assert all of these (`tests/public/normal-ui.ts:64-80`). |
| HomeCampaigns:20-28 | `prefers-reduced-motion` disables autoplay; autoplay skips while `document.hidden`; **ArrowLeft/ArrowRight** on the section step the carousel (`preventDefault`); hover and focus pause, and blur resumes only when focus leaves the section (`relatedTarget`); touch swipe thresholds; `onClickCapture` swallows the click after a swipe. Slides use `tabIndex=-1` and `aria-hidden` when inactive; wheel buttons use roving `tabIndex` (0 only on active) and `aria-current`; `p.pc-title-m aria-live` is polite only while paused. |
| GB:307-308 | `attempt()` focuses the first invalid control after two `requestAnimationFrame`s, via `[aria-describedby="guest-err-<key>"]`, and first opens the owning person `<details>` (`setActivePerson`). |
| GB:304,303 | `aria-invalid` plus `aria-describedby="guest-err-<key>"` linking to `p.guest-field-error id`; errors show after blur (`reveal`) or a forward attempt. |
| GB:301-302 | required/optional flag is `aria-hidden`; required-ness is `aria-required`. |
| GB:325 | stepper `aria-current="step"`. |
| GB:326-329,360,368,372 | live regions: `role=status` (restore notice, unsaved banner, loading, booking result, legal-blocked, contract-changed, busy), `role=alert` (server error). |
| GB:353,356,372 | `aria-busy={busy}` on primary actions. |
| GB:169-203,246-247 | `popstate` handler and `history.pushState/replaceState({step})`: browser Back/Forward moves between steps (clamped). |
| GB:260-261 | `beforeunload` prompt and `window.confirm` link guard for unsaved input. |
| SquareCardPayment:16 | `role=alert` card error; `aria-busy` on the pay button; `aria-labelledby` section heading. |
| BookingAccess:34-35 | `pagehide` hides booking data; `focus`/`pageshow` re-fetch. `role=status` messages. |
| BookingCancellation:15-17, BookingRecovery:21,26, RequestBookingRecovery:7, GuestRecovery:8 | `role=status` / `role=alert` result messages. |
| AvatarFitPreview:25 | `.avatar-measures aria-live="polite"` (announces the length when the direction changes). |
| GuestAvatarPreview:23, AvatarCustomerPreview:11-12 | toggle buttons with `aria-pressed`. |
| (absent) | The wizard has no Escape handling, no focus trap and no scroll lock; there are no custom dialogs besides the PublicChrome menu. Native `<details>` is used for person cards, booking details and recovery. |

Note: GuestBooking renders its own `public-shell` and `public-header` (GB:324). It does **not** use `PublicHeader` or `PublicFrame`, so the `/book` route has no modal menu and no footer. The `/reservation`, legal and content routes use `PublicFrame`.
