> Historical pre-redesign/WIP audit recovered from Claude. Findings describe that checkpoint, not the final candidate. See TAKEOVER_RECONCILIATION.md and VALIDATION.md for final dispositions and receipts.

# C. UI dependency map: recommendation / operations / flow / content / avatar / Playwright e2e

Repo: `/Users/ginisato/Documents/Codex/2026-10-03/files-pasted-by-the-user-zao/work/f2` (read-only audit, 2026-10-13).
All `apps/web/src/...` references are relative to `apps/web/src/`. Test line numbers are `cat -n` lines. Most test files are written as one statement per line, so one line often holds a whole `check(...)` with many assertions.

Classification:
- **B = BEHAVIOURAL**: accessible names of actions or controls, form labels used for filling, status or role semantics, URLs, API results, numbers or state codes rendered from data.
- **P = PRESENTATIONAL**: class names, CSS selectors, layout or geometry, decorative or explanatory copy, screenshots.
- **B/P**: an accessible name or text that is pure copy, but that the test uses as a hard locator.

Global facts (apply to every section):
- **No baseline screenshot comparison anywhere.** `grep toHaveScreenshot|toMatchSnapshot tests/` finds nothing, and there is no `*-snapshots` directory. Every `page.screenshot` call is evidence only. Most write to `.local/screenshots/`. Avatar tests write to committed `docs/execution/avatar-phase{4,5}/screenshots/` and record a sha256 in `screenshots.json`, so rerunning after a redesign rewrites committed evidence files but does not fail. `playwright.config.ts:7` sets `screenshot:'only-on-failure'` and `trace:'retain-on-failure'`.
- **Horizontal-overflow assertions** (`document.documentElement.scrollWidth<=innerWidth`, sometimes `+1`) appear in almost every file, at 320–1440 px widths. These are CSS-driven hard failures.
- **Shared app shell.** `tests/flow-app/src/app/layout.tsx` re-exports `apps/web/src/app/layout.tsx` (`globals.css`). `tests/ui-app/src/app/layout.tsx:2` imports `apps/web/src/app/globals.css` directly. Any element added to the global layout (header buttons, forms, nav) appears on every tested page. See the launch-gate "only one button" assertion in §6.

---

## 0. Runners and apps served

| Runner | How | App served |
|---|---|---|
| `scripts/development-app.ts:10-19` `startDevelopmentApp({built:true})` | `next start apps/web` with `NODE_ENV=production` (needs a prior `npm run build`) | real `apps/web` |
| `tests/flow/launcher.ts:88-89` `startFlowApp(...)` | `next dev tests/flow-app --webpack`, `NODE_ENV=development` | `tests/flow-app` (thin re-exports of `apps/web` pages and components, plus test-only routes) |
| `playwright.config.ts:9` (`npm run test:e2e` = `playwright test`) | webServer 1: `next start apps/web` on `webPort`; webServer 2: `next dev tests/ui-app --webpack` on `webPort+1` | projects `desktop` (Desktop Chrome) and `mobile` (iPhone 13 profile on chromium), workers 1, retries 0 |

All tsx scripts run via `node --import tsx <file>`. `scripts/verify.mjs:10` runs every npm script listed below, plus `test:e2e`, in sequence.

---

## 1. Shared helpers (documented once)

| Helper / pattern | Test location(s) | Locators / assertions | Producing source | Class |
|---|---|---|---|---|
| `login(c,email)` | rec/normal-ui:24, audit:22, continuation:26, ops/normal-ui:28, console:28, launch:20, flow/normal-ui:14, content:24 and 126, avatar phase4:30, phase5:95-96 | `goto('/staff/login')`; `getByLabel('メールアドレス',{exact:true}).fill`; `getByLabel('パスワード',{exact:true}).fill`; `getByRole('button',{name:'ログイン',exact:true}).click()`; `waitForURL(origin+'/staff/ledger')` (console/launch use `'**/staff/ledger'`) | `components/StaffLogin.tsx:12` (labels wrap inputs; button text `'ログイン'`, which becomes `'確認中…'` while busy); redirect `StaffLogin.tsx:9` `window.location.replace('/staff/ledger')`; the fieldset is disabled until hydrated (`useSyncExternalStore`, :5) | B: label text, button name, post-login URL `/staff/ledger` |
| phase5:96 sign-in response | `waitForResponse(pathname==='/api/auth/sign-in/email')` must be 200 | `StaffLogin.tsx:8` fetch path | B |
| `profile(i,sport)` | rec/normal-ui:32, audit:27, flow/normal-ui:31 | `getByLabel('競技 '+i,{exact})`.selectOption('SKI'/'SNOWBOARD'); `'利用開始時の年齢区分 '+i`→'ADULT'; `'身長cm '+i`.fill('170'); `'足サイズcm '+i`.fill('25.5'); SKI only: `'体重kg '+i`, `'利用開始時の年齢 '+i`, `'レベル '+i`→'BEGINNER', `'ポールのサイズ '+i`→variant UUID | `components/RecommendationWorkspace.tsx:43` (競技, 年齢区分 via `aria-label`; 身長cm, 足サイズcm via wrapping `<label>` text), `:46` (体重kg, 利用開始時の年齢 via label text; レベル, ポールのサイズ via `aria-label`). Option **values** `SKI/SNOWBOARD/ADULT/BEGINNER` and the pole variant id are selected | B (labels with index suffix " N", option values) |
| `accept()` / model-policy checkbox | rec/normal-ui:33, audit:31, continuation:45 and 57, flow/normal-ui:33 | `getByLabel('モデル指定なし・表示したサイズとクラスを選択条件とすることを確認').check()` | `RecommendationWorkspace.tsx:51` (label text; the integrated variant uses another text) | B/P: long copy used as a locator |
| logout pattern | rec/normal-ui:43, flow/normal-ui:41 (x2) | `getByRole('link',{name:'ログアウト',exact:true})` then `getByRole('button',{name:'ログアウトする',exact:true})`, `waitForURL(origin+'/staff/login')` | link `RecommendationWorkspace.tsx:40` (`<a href="/staff/logout">ログアウト</a>` in the header nav); the same link exists in `BookingWorkspace.tsx:23`; button `components/StaffLogout.tsx:6`; redirect `StaffLogout.tsx:5` | B |
| hydration probe | flow/normal-ui:41 | `expect.poll(()=>button.evaluate(b=>typeof b.onclick)).toBe('function')` on 'ログアウトする' | relies on React assigning `onclick` for an element with an `onClick` prop (`StaffLogout.tsx:6`) | P/implementation: breaks if the logout becomes a `<form action>` or a server action |
| `seedRecommendation`, `requestFor`, `fid`, `FakeGateway` (`tests/recommendation/fixture.ts`, `tests/inventory/fixture.ts`, `tests/flow/fixture.ts`) | many | **No locators.** DB seed and fake gateway only | n/a | — |
| failure diagnostics only (non-asserting) | rec/normal-ui:45 `getByRole('status').textContent()` and screenshot `.local/screenshots/e09-failure.png`; flow/normal-ui:44 `getByRole('alert')`, `locator('select').evaluateAll(aria-label/options)`, `getByRole('status')`; asset-reader:31 `querySelectorAll('video')`, `[role=status]` | n/a | no pass/fail impact |

---

## 2. `tests/recommendation/normal-ui.ts` (E09)

- **Runner:** `npm run test:recommendations-ui` (package.json:36). `startDevelopmentApp({built:true})` → `next start apps/web`.
- **Viewport:** contexts at 1280×960 (:23); a temporary 390×844 viewport at :36.
- **Routes:** `/staff/login`, `/staff/users`, `/staff/quotes`, `/staff/recommendations`. Expected URLs: `/staff/ledger` after login, `/staff/login` after logout.
- **API status checks** (`request.*`, no UI): `/api/recommendations/options` 401 anonymous (:27); `/api/recommendations` 403 bootstrap (:27), 401 after logout (:43), 403 after the permission is denied (:43); POST `/api/recommendations` 403 without origin, 422 with `totalJpy`, 403 for an outside store, 403 for a foreign preview (:42); `/api/quotes/:id` 200 with `validity==='HOLD_CONDITIONS_MISMATCH'` (:37). Route interception on `**/api/recommendations/*/select` (:36) and on POST `origin+'/api/recommendations'` (:39).

| Test line | Locator / assertion (verbatim) | Producer | Class / redesign note |
|---|---|---|---|
| 28 | `getByRole('button',{name:'スタッフを作成',exact:true})` | `components/StaffManagement.tsx:13` | B |
| 28 | `getByRole('form',{name:'スタッフ作成'})` | `StaffManagement.tsx:14` `<form aria-label=...>` | B: must stay a `<form>` with this aria-label |
| 28 | `f.getByLabel('表示名',{exact:true})`, `'メールアドレス'`, `'初期パスワード（15〜128文字）'` (non-exact) | `StaffManagement.tsx:14` | B |
| 28 | `f.getByLabel('Role',{exact:true}).selectOption('ADMIN'/'STAFF')` | `StaffManagement.tsx:15` `aria-label="Role"`, option text = value | B |
| 28 | `f.getByLabel('店舗範囲',{exact:true}).selectOption('ALL'/'ASSIGNED')` | `StaffManagement.tsx:16` | B (option values) |
| 28 | `f.getByLabel('Mountain Station',{exact:true}).check()` | `StaffManagement.tsx:16` checkbox label `storeDisplayName(s)`; text from `packages/contracts/src/store-display.ts:3` | B (display name comes from contracts) |
| 28 | `f.getByLabel(label,{exact:true}).selectOption('allow')` for `'自分の非公開見積閲覧','自分の非公開見積作成','期間在庫・自分のHOLD閲覧','自分のHOLD取得・変更','料金版の設定（全店ADMINのみ）'` | `StaffManagement.tsx:17` (select `aria-label` from the permission map; option values `default/allow/deny`) | B |
| 28 | `f.getByRole('button',{name:'スタッフ設定を保存'})` | `StaffManagement.tsx:17` | B |
| 28 | `expect(getByRole('heading',{name,exact:true})).toBeVisible()` (name = '合成料金管理' / '合成推薦担当') | `StaffManagement.tsx:18` `<h2>{s.displayName}</h2>` in `.staff-cards` | B/P: the staff card must keep the display name as a heading |
| 31 | `ap.getByLabel('料金の対象開始日')`, `'料金の対象終了日'` fill | `components/QuoteWorkspace.tsx:41` | B |
| 31 | `getByRole('button',{name:'開発用の初期料金を設定'})` | `QuoteWorkspace.tsx:41` | B |
| 31 | `getByRole('region',{name:'料金版',exact:true})` toContainText `'PRIVATE_AVAILABLE'` | `QuoteWorkspace.tsx:40` `<section aria-label="料金版">`; the state code is rendered from data | B: the region and the raw state code must remain visible |
| 35 | `getByRole('heading',{name:'サイズ選択からHOLD・見積へ'})` | `RecommendationWorkspace.tsx:40` h1 | B/P: page title copy |
| 35 | `getByLabel('利用開始日',{exact:true})`, `'利用終了日'` fill; `'利用区分'` selectOption('AM') | `RecommendationWorkspace.tsx:42` (label text; 利用区分 via `aria-label`; option values DAY/AM/PM/MULTIDAY) | B |
| 35 | `getByRole('button',{name:'利用者を追加',exact:true})` | `RecommendationWorkspace.tsx:47` | B |
| 35 | `expect(getByLabel('体重kg 2'/'利用開始時の年齢 2'/'レベル 2')).toHaveCount(0)` after switching to SNOWBOARD | `RecommendationWorkspace.tsx:46` (conditional `m.sport==='SKI'`) | B: ski-only fields must be removed from the DOM, not just hidden |
| 35 | `getByRole('button',{name:'推薦候補を確認',exact:true})` | `RecommendationWorkspace.tsx:48` | B |
| 35 | `getByRole('region',{name:'推薦候補',exact:true})` toContainText `'大きめ推奨'` | region `RecommendationWorkspace.tsx:48`; text `:49` (explanatory copy 「大きめ推奨」) | region B; `'大きめ推奨'` P (explanatory copy) |
| 35 | `getByRole('article',{name:'利用者 '+n+' の候補'})` toContainText `'基準 150cm'`, `'145 cm'`, `'155 cm'`, `'ブーツ 26.5cm'` | `RecommendationWorkspace.tsx:50` (`<article aria-label>`; h3 `` · 基準 ${targetCm}cm``; `candidate.lengthCm+' cm'`; `ブーツ {bootCm}cm`) | B (numbers); exact spacing (`150cm` without a space vs `145 cm` with one) is P but load-bearing |
| 36 | `getByRole('button',{name:'おすすめを選ぶ '+i,exact:true})` | `RecommendationWorkspace.tsx:50` `{labels[d]}を選ぶ {i+1}`, labels at `:15` | B |
| 36 | `getByLabel('早割5％の適用見込みを確認').check()` | `RecommendationWorkspace.tsx:51` | B |
| 36 | `getByRole('button',{name:'全員分をHOLDして見積を保存',exact:true})` | `RecommendationWorkspace.tsx:51` | B |
| 36 | `getByRole('button',{name:'同じ要求を照合・再送'})` visible after the select response is aborted, still present after reload | `RecommendationWorkspace.tsx:57` (pending kept in sessionStorage) | B (retry semantics) |
| 36 | `getByRole('region',{name:'見積詳細',exact:true})` toContainText `'10,640 円'` | `RecommendationWorkspace.tsx:54` `見積合計 {toLocaleString()} 円` | B: number format `ja` grouping + `' 円'` with a space |
| 36 | `getByRole('region',{name:'保存結果',exact:true})` toContainText `holdId` | `RecommendationWorkspace.tsx:52` `HOLD {id} / ...` | B: raw HOLD UUID must stay visible |
| 36 | screenshot `.local/screenshots/e09-recommendation-desktop.png` (fullPage), `e09-recommendation-mobile-width.png` | — | P, evidence only |
| 36 | `setViewportSize(390×844)`; `evaluate(scrollWidth<=innerWidth)` | CSS `components/holds.css`, `recommendation.css` (imported `RecommendationWorkspace.tsx:7-8`) | P, hard fail on overflow |
| 37 | fill dates → `expect(region '見積詳細').toHaveCount(0)` | `RecommendationWorkspace.tsx:54` rendered only when `view.quote&&view.selectionMatchesHold`; `changed()` clears the view | B |
| 37 | `'短めを選ぶ 1'`, `'長めを選ぶ 2'` buttons | `:50`, `:15` | B |
| 37 | region `'保存結果'` toContainText `'COMPLETE'` | `:52` `{view.selection.stage}` | B (raw stage code) |
| 38 | article `'利用者 3 の候補'` visible; buttons `'短めを選ぶ 1'/'短めを選ぶ 3'`, `'おすすめを選ぶ 2'` | `:50` | B |
| 38 | region `'保存結果'` toContainText `'HOLD_FAILED'` and `'INSUFFICIENT'` | `:52` stage / outcome codes | B |
| 38 | region `'見積詳細'` toHaveCount(0) | `:54` | B |
| 39 | `getByRole('button',{name:'利用者 3 を除く',exact:true})`, `'利用者 2 を除く'` | `:47` | B |
| 39 | `expect(getByLabel('身長cm 1')).toHaveValue('180')`; `getByLabel('競技 2')` count 0; region `'推薦候補'` count 0 | `:43`, `:48` | B (late-response guard) |
| 40 | article `'利用者 1 の候補'` toContainText `'基準 180cm'` / `'基準 129cm'` | `:50` | B |
| 40 | `recommended=getByRole('button',{name:'おすすめを選ぶ 1'})` enabled; **`recommended.locator('..')`** toContainText `'166 cm'`/`'134 cm'` and `'割引前の参考額'` | `:50`: the button's **direct parent** is the per-direction `<div key={d}>` that also holds the length `<p>` and the price `<p>割引前の参考額 … 円</p>` | **High risk, structural.** The parent of the button must be the card containing the length and price text. Wrapping the button in another element breaks this |
| 40 | direction button (`'長めを選ぶ 1'`/`'短めを選ぶ 1'`) `toBeDisabled()`; parent `..` toContainText `'該当する在庫候補なし／選択不可'`; not `'割引前の参考額'`; not `'料金未確認'` | `:50` (`disabled={…||!candidate}`, fallback text, `料金未確認：` only when a candidate exists without a price) | B (copy is a hard locator) + structural parent |
| 43 | `getByRole('button',{name:new RegExp('推薦 '+previewId.slice(0,8))})` | `:57` `推薦 {p.id.slice(0,8)} · {startDate}` | B: the saved-list button must start with `推薦 ` + 8-char id |
| 43 | region `'保存結果'` toContainText `holdId` and `'一致しません'` | `:52` `表示した選択条件と現在のHOLDは一致しません。…` | B/P: copy substring |
| 43 | `bp.getByRole('button',{name:'スタッフを編集：合成推薦担当'})` | `StaffManagement.tsx:18` `aria-label={`スタッフを編集：${displayName}`}` (visible text is `設定を編集`) | B: aria-label, not the visible text |
| 43 | `getByRole('form',{name:'スタッフ更新'})`; select `'期間在庫・自分のHOLD閲覧'`→`'deny'`; save; form toHaveCount(0) | `StaffManagement.tsx:14,17` | B (the form closes on save) |
| 43 | after reload: `getByRole('heading',{name:'推薦プレビューの利用権限が必要です'})` | `app/staff/recommendations/page.tsx:5` | B |

---

## 3. `tests/recommendation/audit-followup-ui.ts`

- **Runner:** `npm run test:recommendation-audit` (package.json:37); `next start apps/web`; viewport 1280×960 (:21).
- **Routes:** `/staff/login`, `/staff/recommendations`. Staff are created via API (`/api/staff-users` 201) and prices via `/api/quotes/private-initialize` 201. No UI for either.
- **API/JSON expectations:** POST `/api/recommendations` response JSON `preview.offered[].candidates.RECOMMENDED` (:30); `/select` response `hold.state 'ACTIVE'`, `selection.stage 'COMPLETE'`, `quote.snapshot.totalJpy 15000/11200`, `chargeReady false`, `validity 'VALID_PRIVATE_ESTIMATE'`, period instants (:37-38); `/api/holds`, `/api/quotes` 409/422 (:53), 201 (:56); `/api/ledger/*` 201 (:63); POST `/api/recommendations` 201 (:65). Route abort on `**/api/recommendations/*/select` (:46).

| Line | Locator / assertion | Producer | Class / note |
|---|---|---|---|
| 22 | login helper | §1 | B |
| 27 | `profile()` (local copy, same labels) | §1 / `RecommendationWorkspace.tsx:43,46` | B |
| 29 | `getByLabel('利用開始日'/'利用終了日',{exact})` fill; `getByLabel('利用区分')`.selectOption(DAY/AM/PM) | `:42` | B |
| 29 | `'利用者を追加'` button | `:47` | B |
| 30 | `waitForResponse(url===origin+'/api/recommendations' && POST)`; `'推薦候補を確認'` | `:48` | B |
| 31 | `'おすすめを選ぶ '+i`; model-policy checkbox label | `:50`, `:51` | B |
| 35 | `waitForResponse(url.endsWith('/select'))`; `'全員分をHOLDして見積を保存'` | `:51` | B |
| 40 | after reload `getByRole('button',{name:new RegExp('推薦 '+id8)})`; region `'見積詳細'` toContainText `total.toLocaleString()+' 円'` (`'15,000 円'`, `'11,200 円'`) | `:57`, `:54` | B |
| 46 | `getByRole('button',{name:'同じ要求を照合・再送'})` visible; after reload click | `:57` | B |
| 47 | region `'見積詳細'` toContainText `'15,000 円'` | `:54` | B |
| 49 | screenshot `.local/screenshots/e09-audit-same-day.png` fullPage | — | P, evidence |

No overflow or geometry checks. No keyboard checks.

---

## 4. `tests/recommendation/continuation-ui.ts` (E09-02)

- **Runner:** `npm run test:recommendation-continuation` (package.json:38); `next start apps/web`; viewport 1280×1000 (:26).
- **Routes:** `/staff/login`, `/staff/recommendations`. Most cases are pure API: `/api/recommendations`, `/select`, `/resume`, `/api/holds/:id/amend|availability|reassign|cancel`, `/api/quotes`, with statuses 201/200/403/409/422 and JSON fields `result` (`AMENDED`/`EXPIRED`/`INSUFFICIENT`/`RELEASED`), `replayed`, `selection.stage`/`outcome` (`STALE_HOLD_VERSION`, `HOLD_SAVED`, `COUPON_NOT_FOUND`), `error==='HOLD_EXPIRED_OR_RELEASED'` (:69). None of these depend on the UI.

| Line | Locator / assertion | Producer | Class / note |
|---|---|---|---|
| 26 | login (closes the page) | §1 | B |
| 43 | `getByRole('button',{name:new RegExp('推薦 '+id8)})`; region `'保存結果'` visible | `RecommendationWorkspace.tsx:57`, `:52` | B |
| 44 | `waitForResponse` POST `/api/recommendations` 201; `'推薦候補を確認'` | `:48` | B. Re-preview from a loaded saved view must send `replaceHoldId` |
| 45 | article `'利用者 1 の候補'` toContainText `'割引前の参考額'` | `:50` | B/P copy |
| 45 | `'長めを選ぶ 1'`, `'おすすめを選ぶ 2'`, model-policy checkbox, `'全員分をHOLDして見積を保存'`; `waitForResponse(endsWith('/select'))` | `:50-51` | B |
| 46 | reload, `'推薦 '+id8` button, region `'見積詳細'` toContainText `'VALID_PRIVATE_ESTIMATE'` | `:57`, `:54` `{quote.id} / {quote.validity}` | B: the raw validity code must stay visible |
| 46 | screenshot `.local/screenshots/e09-continuation.png` | — | P evidence |
| 57 | `'推薦 '+id8`; `'推薦候補を確認'` (201); `'短めを選ぶ 1'`, `'おすすめを選ぶ 2'`, checkbox; route-abort `/select`; `'同じ要求を照合・再送'` visible; reload; click; region `'見積詳細'` toContainText `'EXPIRED'` | `:57`, `:50-54` | B |

---

## 5. `tests/operations/normal-ui.ts` (M1)

- **Runner:** `npm run test:operations-ui` (package.json:99). `startDevelopmentApp({built:true,operations:true})` → `next start apps/web`.
- **Viewport:** 1440×1000 (:27). Responsive sweep at 390/768/1440 × 960 (:50).
- **External requests:** every non-origin, non-`data:` request is aborted and counted, and `external===0` is asserted (:27, :54). A redesign that loads Google Fonts, a CDN, or remote images on these pages **fails** this test.
- **Routes:** `/staff/login`, `/staff/amendments`, `/admin/inventory`, `/admin/assets`, `/admin/prices`, `/staff/rentals`.
- **API checks (:51-54):** `/api/operations/inventory` 401/403; `/api/operations/refund` 403; `/api/operations/stocktake-create` without origin 403; `/api/bookings/:id/payment` 503.

| Line | Locator / assertion | Producer | Class / note |
|---|---|---|---|
| 33 | `getByLabel('予約ID',{exact:true}).fill` | `components/AmendmentWorkspace.tsx:21` | B |
| 33 | `getByRole('button',{name:'変更対象を読み込む'})` | `AmendmentWorkspace.tsx:21` | B |
| 33 | `getByRole('heading',{name:'変更内容',exact:true})` visible | `AmendmentWorkspace.tsx:23` `<h2>` | B/P: section heading as a state signal |
| 33 | `getByLabel('返却日',{exact:true}).fill('2035-02-06')` | `AmendmentWorkspace.tsx:23` | B |
| 33 | `getByLabel('操作理由（詳細な個人情報は記入しない）')` | `AmendmentWorkspace.tsx:22` | B |
| 33 | `getByRole('button',{name:'変更見積を固定'})` | `AmendmentWorkspace.tsx:27` | B |
| 33 | `getByRole('heading',{name:'変更見積',exact:true})` visible, then count 0 after confirming | `AmendmentWorkspace.tsx:27` `<h3>` | B/P |
| 33 | `getByRole('button',{name:'この見積で変更を確定'})` | `AmendmentWorkspace.tsx:28` | B |
| 34 | `getByRole('button',{name:'入金・返金残額を照合'})` | `AmendmentWorkspace.tsx:21` | B |
| 34 | `getByRole('heading',{name:'入金と返金残額'})` | `AmendmentWorkspace.tsx:29` | B/P |
| 34 | `getByLabel('元の入金').selectOption(paymentId)` | `AmendmentWorkspace.tsx:30` (option value = payment id) | B |
| 34 | `getByLabel('返金依頼額（円）').fill('100')` | `:30` | B |
| 34 | `getByRole('button',{name:'例外返金を依頼する'})` | `:30` | B |
| 35 | `getByRole('button',{name:'棚卸を開始',exact:true})` | `components/InventoryOperationsWorkspace.tsx:22` | B |
| 35 | `getByRole('button',{name:'棚卸を読み込む',exact:true})` | `:23` | B |
| 35 | `getByRole('heading',{name:'棚卸の照合',exact:true})` | `:25` | B/P |
| 35 | `getByLabel('用品の個体ID',{exact:true}).fill`; `getByRole('button',{name:'入力したIDを照合へ送る'})` | `components/AssetQrInput.tsx:26` (embedded in InventoryOperationsWorkspace:25) | B |
| 35 | `getByText('今回の読取: 1件',{exact:false})` | `InventoryOperationsWorkspace.tsx:25` `今回の読取: {n}件（まだ保存されていません）` | B/P: format `': '` (half-width colon + space) + `件` |
| 35 | `getByRole('button',{name:'読取・数量を保存して差異確認へ'})` | `:26` | B |
| 36 | `goto('/admin/assets')` (re-exports `app/staff/ledger/page.tsx`); `getByRole('button',{name:'個体台帳',exact:true})` | `components/ledger/LedgerWorkspace.tsx:8` (tabs map) | B |
| 36 | `getByPlaceholder('モデル名・ID').fill(id)` | `LedgerWorkspace.tsx:42` | B/P: **placeholder** used as the locator |
| 36 | `getByRole('button',{name:/^詳細：/})` | `LedgerWorkspace.tsx:51` `aria-label={`詳細：${name} ${size??code}`}` (visible text `見る ↗`) | B: aria-label prefix `詳細：` |
| 36 | `getByRole('heading',{name:'用品ラベル',exact:true})` | `components/AssetLabelSheet.tsx:6` `<h3>` | B/P |
| 36 | **`locator('.asset-label')` toHaveCount(2)**; **`locator('.asset-label code')`** allTextContents == [id,id] | `AssetLabelSheet.tsx:5` `<article className="asset-label">…<code>{id}</code>` | **P: class name and `<code>` element are hard dependencies** |
| 41 | `getByLabel('CSVファイル').setInputFiles(...)` | `InventoryOperationsWorkspace.tsx:30` (file input wrapped by label) | B: must remain a real `<input type=file>` labelled `CSVファイル` |
| 41 | `getByRole('button',{name:'dry-runを保存',exact:true})` | `:30` | B |
| 41 | `getByText('dry-run: 確定可能',{exact:false})` | `:31` `dry-run: {stage.ready?'確定可能':'要修正'} · {n}行` (JSX joins `dry-run: ` + `確定可能`) | B/P copy+format |
| 41 | `getByLabel('投入理由').fill`; `getByRole('button',{name:'検証済みの在庫を投入',exact:true})` | `:31` | B |
| 45-47 | `getByRole('button',{name:'料金版を読み込む',exact:true})` | `components/PriceAdminWorkspace.tsx:13` | B |
| 45,46 | `getByLabel('料金版',{exact:false}).selectOption(bookId)` | `PriceAdminWorkspace.tsx:14` (option value = book id) | B: non-exact, so any new label containing `料金版` makes this ambiguous (strict-mode error) |
| 45 | `getByLabel('理由',{exact:true})`, `getByLabel('対象開始日')`, `getByLabel('対象終了日')` | `PriceAdminWorkspace.tsx:14` | B. Non-exact `対象開始日`, so a label like `料金の対象開始日` on the same page would collide |
| 45 | `getByRole('button',{name:'選択した料金版からdraftを作る'})` | `:14` | B |
| 46 | `getByRole('button',{name:'料金表と差分を表示'})` | `:14` | B |
| 46 | `getByRole('heading',{name:/DRAFT · revision/})` | `:15` `<h2>{state} · revision {revision}</h2>` | B/P: middle-dot separator format |
| 46 | `getByLabel('商品',{exact:false}).selectOption(product)`; `getByLabel('金額（円）').fill` | `:16` (`<label>商品<select>`; the `<th>商品</th>` at :15 is not a label) | B: non-exact `商品` would collide with any new label containing `商品` |
| 46 | `getByRole('button',{name:'draftを更新する'})` | `:16` | B. Relies on the 期間 select defaulting to the first duration key (`DAY_1`) |
| 47 | `getByRole('heading',{name:'複製元との差分'})` | `:15` `<h3>` | B/P |
| 47 | `getByLabel('適用日時').fill('2035-01-02T10:00')` | `:16` label `適用日時（この端末の時間帯）`, `type="datetime-local"` | B: input type must stay datetime-local |
| 47 | `getByRole('button',{name:'表示した料金版を確定・適用する'})` | `:16` | B |
| 50 | for widths 390/768/1440 and paths `/admin/assets,/admin/inventory,/staff/amendments,/staff/rentals,/admin/prices`: **`locator('h1').first()` visible**; `scrollWidth<=innerWidth` (no +1) | h1s: `LedgerWorkspace.tsx:35`, `InventoryOperationsWorkspace.tsx:19`, `AmendmentWorkspace.tsx:19`, `CustodyWorkspace.tsx:38`, `PriceAdminWorkspace.tsx:12`; CSS `operations.css`, `holds.css`, `ledger/ledger.css` | P: every page needs a visible `<h1>`; strict overflow check with no +1 tolerance |

---

## 6. `tests/operations/console-ui.ts` (M17 operations console)

- **Runner:** `npm run test:operations-console-ui` (package.json:101); `next start apps/web` (operations); viewport 1440×1000; external requests blocked and `external===0` asserted (:27, :105).
- **Routes:** `/staff/login`, `/admin/ops`. Route mock: `/\/api\/operations\/exceptions\?/` is fulfilled with synthetic rows (:61).
- **API checks:** `/api/operations/exceptions` 401/403 (:44-45, :86); POST `/api/operations/exception-acknowledge` 403 (:87). A request listener asserts the listing sends no POST (:60, :68).

| Line | Locator / assertion | Producer | Class / note |
|---|---|---|---|
| 41,43 | `getByRole('heading',{name:'運用状況の閲覧権限が必要です'})` (anonymous and plain staff) | `app/admin/ops/page.tsx:6` | B |
| 42 | `getByRole('heading',{name:'運用例外'})` count 0 for anonymous | `components/OpsWorkspace.tsx:35` h1 | B |
| 49 | `getByRole('button',{name:'読み込む',exact:true})` | `OpsWorkspace.tsx:43` | B |
| 50 | `getByRole('heading',{name:'PAYMENT_PENDING'}).first()` | `OpsWorkspace.tsx:50` `<h2>{e.eventType}</h2>` | B: the raw event code must be a heading |
| 51 | **`locator('section[aria-label="例外一覧"]').innerText()`** must not include guest email / name / `sim_` / `SYNTHETIC-MERCHANT`; must include `'現在も継続中'` | `OpsWorkspace.tsx:49` `<section aria-label="例外一覧">`; text `:52` | **P (CSS attribute selector on element type `section`)**. B for the PII exclusion |
| 63 | `getByLabel('状態').selectOption('ALL')` | `OpsWorkspace.tsx:41` `aria-label="状態"` | B. Non-exact here (exact at :99); any new label containing `状態` collides |
| 64 | `list.getByText('オンライン返金',{exact:false})` | `OpsWorkspace.tsx:54` | B/P |
| 66 | innerText must contain **verbatim** `'オンライン返金 / 金額: ¥7,500 / 経過: 3時間 / 要手動調査：結果不明・Provider IDなし（自動再送しません）'` and `'店頭返金 / 金額: ¥300 / 経過: 3時間 / Provider IDあり：照合中（自動・再送なし）'` | `OpsWorkspace.tsx:54` (row format), `:11` `refundStatus`, `:12` `elapsed` | **High risk: an exact composite string.** Separators `' / '`, `¥` + `toLocaleString('ja-JP')`, `時間`. It must stay inside one text block, because innerText would insert newlines if the parts were split into block elements |
| 67 | `list.getByRole('button',{name:/再送\|返金/})` count 0 | `OpsWorkspace.tsx:58` (only `確認済みにする`) | B: no button with 再送/返金 in its name may be added to rows |
| 77 | `getByRole('button',{name:'稼働状況',exact:true})` | `OpsWorkspace.tsx:44` | B |
| 78 | **`locator('section[aria-label="稼働状況"]')`** innerText includes `APP, DB, GUEST, PAYMENT_ADAPTER, MEDIA, NOTIFICATION` and excludes `postgres,127.0.0.1,password,zr_,sk_,Error` | `OpsWorkspace.tsx:48`, `COMPONENTS` `:13` | P selector; B content. Note that `'Error'` must not appear anywhere in the section copy |
| 85 | reader: `getByRole('button',{name:'確認済みにする'})` count 0 | `OpsWorkspace.tsx:58` (`canAcknowledge`) | B |
| 89 | `getByRole('button',{name:'確認済みにする'}).first().click()` | `:58` | B |
| 90 | `getByRole('status')` toContainText `'入金・返金・在庫・予約の状態は変わりません'` | `OpsWorkspace.tsx:33` message, `:47` `<p role="status">` | B. **Strict mode:** exactly one `role=status` element may exist on the page |
| 99 | `getByLabel('状態',{exact:true}).selectOption('ALL')` | `:41` | B |
| 101 | `getByRole('heading',{name:'運用例外'})` visible | `:35` | B. Non-exact name; strict mode means no second heading may contain `運用例外` |
| 102 | **`locator('section[aria-label="例外一覧"] article').first()`** visible | `:49` `<article>` per row | **P: rows must stay `<article>` elements inside that section** |
| 103 | `scrollWidth<=innerWidth+1` at 390/768/1440 (height 900) | inline styles at `:49`, global CSS | P |

---

## 7. `tests/operations/launch-ui.ts` (M2a labels and launch gate)

- **Runner:** `npm run test:m2a-launch-ui` (package.json:109); `next start apps/web` (operations); viewport 1440×1000; external requests blocked, `external===0` (:19, :91).
- **Routes:** `/staff/login`, `/staff/ledger`, `/admin/launch`. API: `/api/admin/launch` 403/401 (:71-72).

| Line | Locator / assertion | Producer | Class / note |
|---|---|---|---|
| 26 | `getByRole('button',{name:'個体台帳',exact:true}).click().catch(()=>{})` | `LedgerWorkspace.tsx:8` | B (failure tolerated) |
| 27 | `getByLabel('競技',{exact:true}).selectOption('SKI'/'SNOWBOARD').catch()` | `LedgerWorkspace.tsx:44` (filter label; option values SKI/SNOWBOARD/WEAR) | B (failure tolerated) |
| 28 | **`locator('table tbody tr').filter({hasText:family}).first()`** | `LedgerWorkspace.tsx:51` (`<table>` rows; family text via `label(row.family)`) | **P: the ledger list must stay an HTML `<table>` with `tbody tr`.** The row must contain the literal `SKI`/`SNOWBOARD` text (from `label()`; verify the mapping keeps the code or substring) |
| 29 | `first.getByRole('button',{name:/^詳細：/})` | `:51` aria-label | B |
| 30 | **`locator('aside[aria-label="台帳詳細"]')`** | `:55` `<aside className="ledger-detail" aria-label="台帳詳細">` | **P: element must stay `<aside>`** (the role-based locator in ledger-ui.spec uses `complementary`, which is the same constraint) |
| 35 | **`detail.locator('.ledger-id').first().innerText()`** matches `/^[0-9a-f-]{36}$/` | `:55` `<dd className="ledger-id">{detail.id}</dd>` | **P: class `ledger-id`**; the element must contain only the UUID |
| 37-39 | `detail.locator('.asset-label')` toHaveCount(2); `.nth(i).locator('code')` innerText == id | `AssetLabelSheet.tsx:5-6` | **P** |
| 40 | `detail.locator('canvas[aria-label="用品QR '+id+'"]').first()` visible | `AssetLabelSheet.tsx:5` | P/B: must stay a `<canvas>` with that aria-label |
| 41 | `detail.locator('section',{has:page.locator('.asset-label')}).first().innerText()` must not contain `@`, `090`, `電話`, `住所`, `様` | `AssetLabelSheet.tsx:6` `<section>` wrapper | P (`section` element); B (no PII). **Copy constraint: no `様` or `@` may appear in label copy** |
| 47 | board: `.asset-label` count 1 | `AssetLabelSheet.tsx:6` (copies logic) | B (count) via P selector |
| 49-51 | `'ポール数量'` tab; `table tbody tr` first → `詳細：` button; `aside[aria-label="台帳詳細"] .asset-label` count 0 | `LedgerWorkspace.tsx:8,51,55` | P/B |
| 56-57 | **`.asset-label` `getBoundingClientRect().width` >0 and <=280** | `operations.css` `.asset-label{width:260px;padding:8px;border:1px}` (= 278 px border-box) | **P geometry: high risk.** Padding/border/width changes above 280 fail |
| 58-59 | **`getComputedStyle(.asset-label).breakInside==='avoid'`** | `operations.css` `.asset-label{break-inside:avoid}` | **P CSS property asserted** |
| 60-63 | `emulateMedia({media:'print'})`: `.asset-label` visibility `'visible'`; **`footer.ledger-footer`** visibility `'hidden'` | `operations.css` `@media print{body>*{visibility:hidden}.asset-labels,.asset-labels *{visibility:visible}}`; footer `LedgerWorkspace.tsx:56` `<footer className="ledger-footer">` | **P: print CSS plus the `footer.ledger-footer` element/class are hard dependencies** |
| 68,70 | `getByRole('heading',{name:'公開準備状況の閲覧権限が必要です'})` | `app/admin/launch/page.tsx:6` | B |
| 73 | `getByRole('button',{name:'読み込む',exact:true})` | `components/LaunchGateView.tsx:18` | B |
| 74,88 | `getByRole('row',{name:/DBスキーマ/})` visible | `LaunchGateView.tsx:6` LABEL map, `:21` `<tr><th scope=row>` | B (table semantics plus label copy) |
| 75 | `getByRole('row',{name:/実在庫データ/})` toContainText `'未実施'` | `:6` (`REAL_DATA:'実在庫データ'`), `:7` STATE `NOT_RUN:'未実施'` | B |
| 77 | `locator('input[type="password"]').count()==0` | page-wide | B |
| 78 | **`locator('form').count()==0`** on `/admin/launch` | page-wide, including the global layout | **High risk: a global header with a `<form>` (search, logout form) fails this** |
| 79 | no button matching `/本番接続\|デプロイ\|有効化\|決済実行\|秘密/` | page-wide | B |
| 80 | **`getByRole('button').allInnerTexts()` filtered: every non-empty button other than `'読み込む'` or one containing `'ログアウト'` must not exist (count 0)** | page-wide, including layout | **Highest risk: adding any button (menu toggle, theme toggle, "閉じる", skip-link button, icon button with text) to `/admin/launch` or the global layout fails.** Icon-only buttons with empty innerText pass |
| 87 | `getByRole('heading',{name:'公開準備状況'})` | `LaunchGateView.tsx:15` h1 (non-exact; the denial heading also contains it, but that is not rendered when authorized) | B |
| 89 | `scrollWidth<=innerWidth+1` at 390/768/1440 | CSS | P |

---

## 8. `tests/flow/normal-ui.ts` (FLOW)

- **Runner:** `npm run test:flow-ui` (package.json:45). `startFlowApp()` → `next dev tests/flow-app` (`NODE_ENV=development`).
- **Viewport:** 1280×960 (:13); temporary 390×844 (:34). A JS-disabled context is used at :24.
- **Routes:** `/staff/login`, `/staff/users`, `/staff/quotes`, `/staff/recommendations`, then `/preview/rental?quote=…` reached via a link, and `/preview/rental`. `GET /staff/logout` returns 200 (:30).
- **API:** `/api/bookings` 401; `/api/bookings/capabilities` 200 (:16), mocked to `{mode:'LOCAL_OPERATIONS',…}` at :36; `/api/staff-users` 201; `/api/quotes/private-initialize` 201 (:29); `/api/recommendations/options` 200 with a pole variant (:30); POST `/api/bookings` 403/422 (:40). The payment route `**/api/bookings/*/payment` returns JSON `state==='CONFIRMED_DEV'` before being aborted (:34).
- **Wrappers:** `tests/flow-app/src/app/staff/{users,quotes,recommendations,login,logout,ledger}/page.tsx` and `preview/rental/page.tsx` re-export the apps/web pages one to one. `api/bookings` composes `apps/web/src/lib/booking-http` with the test flow service in `ISOLATED_TEST` mode. That is why `BookingWorkspace` shows the "開発予約" variants.

| Line | Locator / assertion | Producer | Class / note |
|---|---|---|---|
| 18 | `getByRole('button',{name:'スタッフを編集：SYNTHETIC Creator'})` | `StaffManagement.tsx:18` | B |
| 18 | `expect(getByLabel('予約の閲覧')).toHaveValue('allow')`; `getByLabel('受付・貸出')` toHaveValue `'default'` | `StaffManagement.tsx:17` (select aria-label; values `default/allow/deny`) | B (option values) |
| 19 | `getByLabel('受付・貸出')`, `'返却・検品'` selectOption('allow'); `'スタッフ設定を保存'`; `getByRole('form',{name:'スタッフ更新'})` count 0 | `:17`, `:14` | B |
| 20 | `getByLabel('予約の作成')` toHaveValue 'allow'; `'返却・検品'` 'allow' then 'deny' | `:17` | B |
| 24 | JS-disabled `/staff/quotes`: `getByRole('status')` toContainText `'セッションを確認中'`; `getByLabel('料金の対象開始日')` count 0 | `components/StaffSessionBoundary.tsx:22` `<p role="status">セッションを確認中…</p>` (the SSR fallback before hydration) | B: SSR must render only the boundary status, not the workspace |
| 25-27 | route-gate `**/api/quotes/catalog`; `getByLabel('料金の対象開始日')` toBeDisabled, then toBeEnabled; `getByRole('button',{name:'開発用の初期料金を設定'})` disabled | `QuoteWorkspace.tsx:41` (fieldset disabled until the catalog loads) | B |
| 29 | fill `料金の対象開始日/終了日`; `waitForResponse(/api/quotes/private-initialize POST)` 201; region `'料金版'` toContainText `'PRIVATE_AVAILABLE'` | `QuoteWorkspace.tsx:40-41` | B |
| 33 | recommendation flow: `利用開始日/終了日`, `profile()`, `利用者を追加`, `推薦候補を確認`, `おすすめを選ぶ 1/2`, model-policy checkbox, `全員分をHOLDして見積を保存`; region `'見積詳細'` visible | `RecommendationWorkspace.tsx:42-54` | B |
| 33 | `getByRole('link',{name:'予約情報・決済結果へ'})` | `RecommendationWorkspace.tsx:54` `<a href="/preview/rental?quote=…">` | B: link plus URL |
| 33 | `getByRole('heading',{name:'予約情報と決済照合'})` | `components/BookingWorkspace.tsx:23` h1 | B/P |
| 33 | `getByLabel('保存済み見積ID').inputValue()` (prefilled from `?quote=`) | `BookingWorkspace.tsx:25` | B |
| 33 | `getByLabel('合成氏名').fill`, `getByLabel('架空メール宛先').fill`, `getByLabel('開発用の合成予約であり、営業規約・請求の確定ではないことを確認').check()` | `BookingWorkspace.tsx:25` | B (long copy as locator) |
| 33 | `getByRole('button',{name:'合成予約情報を保存',exact:true})` | `:25` | B |
| 33 | `getByRole('region',{name:'開発予約詳細'})` toContainText `'DRAFT'` | `:26` section aria-label, state `<strong>` | B |
| 34 | `getByRole('button',{name:'テストアダプタへ照合要求'})` | `:27` | B |
| 34 | `getByRole('button',{name:'同じ保存済み要求を照合'})` visible after abort and reload | `:28` | B |
| 34 | region `'開発予約詳細'` toContainText `'CONFIRMED_DEV'` | `:26` | B |
| 34 | `getByLabel('開発予約QR')` visible; `.evaluate(node as HTMLCanvasElement).getContext('2d').getImageData` → jsQR decodes `'zao-rental:reservation:'+bookingId` | `BookingWorkspace.tsx:12` `<canvas aria-label="開発予約QR">` (QR width 220, margin 4) | **B/P: must stay a `<canvas>`** (not `<img>`/`<svg>`) with that aria-label, and must render a decodable QR |
| 34 | screenshots `.local/screenshots/flow-booking-desktop.png`, `flow-booking-mobile-width.png`; at 390 px `scrollWidth<=innerWidth` | holds.css | P, evidence plus overflow |
| 36 | (capabilities mocked to LOCAL_OPERATIONS) `getByRole('button',{name:/SYNTHETIC Mixed Group.*CONFIRMED_DEV/})` | `BookingWorkspace.tsx:28` `{display_name} · {startDate} · {state}` | B: list-button text order name…state |
| 36 | `getByRole('region',{name:'予約詳細'})` toContainText `'決済状況 COMPLETED'` | `:26` (non-test mode label `'決済状況'` + `' '` + `p.state`) | B/P format |
| 36 | `getByText('合成データ専用のテスト環境です。実予約・実決済ではありません。')` count 0; button `'合成予約情報を保存'` count 0 | `:23`, `:25` (mode-conditional) | B |
| 36 | `getByRole('link',{name:'権限を確認して道具の受付・貸出・返却へ'})` toHaveAttribute `'href','/staff/rentals'` | `:27` | B: href |
| 41 | logout via link/button plus the onclick hydration probe | §1 | B / implementation |
| 41 | `back.goto('/preview/rental')`; button `/SYNTHETIC Mixed Group.*CONFIRMED_DEV/`; region `'開発予約詳細'` toContainText bookingId | `BookingWorkspace.tsx:28,26` | B |
| 42 | viewer `/preview/rental`: `getByRole('heading',{name:'非公開の予約プレビュー'})`; `getByText('SYNTHETIC Mixed Group',{exact:true})` count 0 | `app/preview/rental/page.tsx:5` | B |

---

## 9. `tests/flow/asset-reader-ui.ts` (+ `tests/flow/AssetReaderFixture.tsx`)

- **Runner:** `npm run test:asset-reader` (package.json:46); `next dev tests/flow-app`. Route `/test-asset-reader` comes from `tests/flow-app/src/app/test-asset-reader/page.tsx`. It only works when `NODE_ENV==='development'` and `ZAO_TEST_FLOW_RUNTIME` is set, and renders `AssetReaderFixture`.
- **Fixture** `tests/flow/AssetReaderFixture.tsx:4`: renders the apps/web **`AssetQrInput`** (`apps/web/src/components/AssetQrInput.tsx`) plus test-only controls: checkbox `合成照合応答を保留`, button `合成応答を完了`, `<output aria-label="合成照合開始数">`, button `入力部品を閉じる`, `<output aria-label="検出ID一覧">`. Inline style `maxWidth:640, padding:12`. These test-only elements are not affected by the redesign.
- **Context:** 390×844, `hasTouch:true`; an init script defines `window.__name`. Camera is faked by overriding `navigator.mediaDevices.getUserMedia` with a canvas `captureStream`. `context.setOffline(true/false)`.

| Line | Locator / assertion | Producer | Class / note |
|---|---|---|---|
| 14 | `getByRole('button',{name:'カメラを開く'})` toBeEnabled after load | `AssetQrInput.tsx:25` (disabled until `ready` and online) | B |
| 15 | `getByLabel('用品の個体ID').fill(invalid)`; `getByRole('button',{name:'入力したIDを照合へ送る'})` | `AssetQrInput.tsx:26` | B |
| 15,24,26,28 | **`getByRole('region',{name:'用品QR入力'}).getByRole('status')`** toContainText `'用品の個体ID'` / `'許可を待っています'` / `'許可がありません'` / `'見つかりません'` / `'まだ確認できません'` | region `AssetQrInput.tsx:24` `<section aria-label="用品QR入力">`; status `:26` `<p role="status">`; messages `:18` (`用品の個体IDを読み取ってください。`, `…まだ確認できません。`), `:26` (`カメラの許可を待っています。`), `:22` (`カメラの許可がありません…`, `カメラが見つかりません…`) | B: the status messages carry state semantics. **Copy changes break this** |
| 15 | `scrollWidth<=innerWidth` at 390 | AssetQrInput inline styles | P |
| 23 | `'カメラを開く'` click; QR frames decoded; `'カメラを止める'` click → tracks `['ended']` | `AssetQrInput.tsx:25`, `:20-21` (`<video>` + hidden `<canvas>`, jsQR every 150 ms) | B |
| 27 | offline → `'カメラを開く'` toBeDisabled; online → enabled | `:17` offline listener, `:25` | B |
| 27 | **for every button in region `用品QR入力`: `boundingBox().height>=44`** | `AssetQrInput.tsx:25-26` inline `style={{minHeight:44,minWidth:44}}` | **P geometry asserted: touch-target size must stay ≥44 px** |
| 27 | widths 320/360/390/430/768/1024: `scrollWidth<=innerWidth` | AssetQrInput (`video` maxWidth 480, width 100%) | P |
| 28 | `getByRole('button',{name:'カメラを開く'}).tap()`; `'カメラを止める'` `.tap()` | `:25` | B (touch) |
| 28 | `getByRole('button',{name:'入力したIDを照合へ送る'})` toBeDisabled while pending | `:26` `disabled={…||pending||…}` | B |
| 29 | after reload: `'カメラを止める'` toBeDisabled | `:25` | B |

---

## 10. `tests/content/normal-ui.ts` (+ `Workspace.tsx`, `PhotoWorkspace.tsx`)

- **Runner:** `npm run test:content-fixture` (package.json:52). `startFlowApp({contentFixture:true,warmRoutes:true})` → `next dev tests/flow-app`. Includes a real Web restart (`app.restartWeb()`, :47).
- **Viewport:** 390×844 (:23).
- **Routes:** `/staff/login` (apps/web `StaffLogin`), `/staff/content-fixture` (**test-only page** `tests/flow-app/src/app/staff/content-fixture/page.tsx`, which renders `tests/content/Workspace.tsx` → `ContentFixtureWorkspace`).
- **What comes from apps/web here:** only the login page; `StaffSessionBoundary` and `invalidateStaffView` (`Workspace.tsx:4`, `PhotoWorkspace.tsx:5`); and the stylesheet **`apps/web/src/components/holds.css`** (`Workspace.tsx:5`, `<main className="holds">`). Every content locator below is produced by the **test-owned** `Workspace.tsx` / `PhotoWorkspace.tsx`, so it is immune to apps/web markup or copy changes. holds.css changes still affect the overflow checks and the screenshots.
- **API:** `/api/session` 200 (stamp); `/api/content-fixture*` 401/409/403/200/503; `/api/photo-fixture/*` 200/409/503 (`retry-after:'1'`), errors `PHOTO_JOB_MISMATCH/PHOTO_REQUEST/PHOTO_SIZE/FIXTURE_LOCKED`; derivative content type webp; POST `/api/staff-users` 201; PATCH `/api/staff-users/:id` 200. :127 reads `apps/web/src/lib/staff-runtime.ts` and asserts it **does not contain `content-fixture`**. That is a source-text assertion on an apps/web lib file, not UI.

| Line | Locator / assertion | Producer | Class / note |
|---|---|---|---|
| 24, 126 | login helper | apps/web `StaffLogin.tsx:12` | B |
| 28 | `getByRole('region',{name:'現在の下書き'})` toContainText `'合成 SKI'` | `tests/content/Workspace.tsx:21` | test-owned |
| 36, 120 | `getByLabel('CSVファイル').setInputFiles` | `Workspace.tsx:20` | test-owned |
| 37, 120 | `getByRole('button',{name:'差分を検証して保存',exact:true})` | `Workspace.tsx:20` | test-owned |
| 37-38, 120 | `getByRole('button',{name:/^有効な下書きを反映/})` count 1 | `Workspace.tsx:21` | test-owned |
| 38-39 | `getByRole('button',{name:'同じ保存要求を照合'})` | `Workspace.tsx:21` | test-owned |
| 39, 45 | `getByRole('status',{name:'説明処理状態'})` toContainText `'一部の下書きを保存済み'` / `'保存済み'` | `Workspace.tsx:18,21` | test-owned |
| 45 | `'下書き全体のreleaseを検証'`; `/^非公開releaseへ反映/` | `Workspace.tsx:21` | test-owned |
| 46 | `scrollWidth<=innerWidth` at 390; screenshot `.local/screenshots/content-fixture-mobile-width.png` | **apps/web `holds.css`** styles `main.holds` | P: an overflow failure is possible if `.holds` CSS changes |
| 47 | after restart: `getByText('現在の非公開release '+id,{exact:true})` | `Workspace.tsx:21` | test-owned |
| 55, 86 | `getByRole('region',{name:'写真一括fixture'})` | `PhotoWorkspace.tsx:19` | test-owned |
| 57, 61 | `getByLabel('写真ファイル').setInputFiles(50 files)` | `PhotoWorkspace.tsx:19` | test-owned |
| 58-66 | `'選択した写真を送信・再開'`, `'写真処理を中断'`, `'保存済み写真jobを照合'`; status `'写真処理状態'` texts `'未確認または拒否'`, `'処理結果を保存'`, `'別の写真・説明処理が実行中'`, `'保存済み。未送信分は'`; region contains `'変換済み 3'` | `PhotoWorkspace.tsx:16-19` | test-owned |
| 68 | `scrollWidth<=innerWidth`; **element screenshot** `getByRole('region',{name:'写真一括fixture'}).screenshot({path:'.local/screenshots/photo-fixture-mobile-width.png'})` | holds.css + test markup | P evidence |
| 113 | `getByLabel('資料のJSONファイル')`; `'資料の行を照合して保存'`; region `'メーカー資料fixture'` toContainText `'保存済み照合行 2件'` | `Workspace.tsx:21` | test-owned |

---

## 11. `tests/avatar/phase4-e2e.ts`

- **Runner:** **no npm script references this file.** `test:avatar` (package.json:96) runs `phase5-upgrade`, `phase5-e2e`, and phase6 files, but not phase4, and `scripts/verify.mjs` does not run it either. It can only be invoked manually: `node --import tsx tests/avatar/phase4-e2e.ts`.
- **Likely stale:** line 31 asserts `migrationPlan.length===31`, while phase5:26 expects ≥32 migrations. Treat it as an orphan with low redesign priority, but its selectors overlap with phase5.
- **App:** `startFlowApp({publicP0:true})` → `next dev tests/flow-app`; `/preview/avatar` is re-exported from `apps/web/src/app/preview/avatar/page.tsx`.
- **Viewport:** 1440×1000, sweep 320/390/768/1440 (height 844 below 768, else 1000). External requests blocked (`externalAttempts===0`, :75); business POSTs counted (=0); `pageerror` and console `/hydration|uncaught|maximum update/i` must be empty (:28, :75).
- **Routes:** `/staff/login`, `/preview/avatar?preview=…&member=…` (and `&locale=en`), `/avatar-media/:id/:sha` (200 webp, headers `cache-control: private, no-store`, `x-content-type-options: nosniff`), `/media/...` 404, `/ja` (HTML must not contain `/preview/avatar`, :73). :73 also reads `apps/web/src/components/GuestBooking.tsx` source and asserts it does not include `'AvatarFitPreview'` (a source-text assertion, B).
- **Evidence written:** `docs/execution/avatar-phase4/{screenshots/*.png, screenshots.json, browser-measurements.json, local-e2e.json}`.

| Line | Locator / assertion | Producer | Class / note |
|---|---|---|---|
| 29, 53 | anonymous / denied HTML matches `/Staff sign-in/` | `app/preview/avatar/page.tsx:13` (`Staff sign-in and read permissions are required.`) | B/P: the English copy fragment is a hard check |
| 57 | `getByRole('heading',{name:'長さのバランスを見る'})` | `components/AvatarFitPreview.tsx:21` h2 | B/P |
| 61 | `getByRole('button',{name:new RegExp('^'+name)})` with name ∈ `短め/おすすめ/長め` | `components/AvatarCustomerPreview.tsx:12` (button text `{label}<small>{cm} cm</small>`; labels `AvatarFitPreview.tsx:10`) | B: accessible name must start with the direction label |
| 61 | **`locator('[data-layer="SKI"] img')`**, **`[data-layer="AVATAR"] img`** visible | `AvatarFitPreview.tsx:12` `data-layer={box.visual.layer}` + Next `<Image fill>` → `<img>` | **P/test hook: `data-layer` attributes and an `<img>` child are required** |
| 62, 72 | **`[data-avatar-stage] img`** all `complete && naturalHeight>0`; count 5 (:72) / 2 (:70) | `AvatarFitPreview.tsx:22` `data-avatar-stage` | P/test hook |
| 63-65 | **geometry:** for every `[data-layer]` `getBoundingClientRect`; `|ski.height − body.height·length/170| ≤ 1px`; `|ski.bottom − body.bottom| ≤ 1`; all layers inside the stage ±1 px; non-SKI/AVATAR layers coincide with the body box (<1 px); `ski.x > body.right`; no horizontal overflow | inline `style={{left,top,width,height}}` % from `packages/core/src/avatar/layout`; CSS `components/avatar.css` `.avatar-stage{position:relative;width:100%;max-width:352px}`, `.avatar-layer{position:absolute}`, `.avatar-layer img{object-fit:fill}` | **P geometry with 1 px tolerance: highest-risk CSS area.** Any border, padding, or transform on `.avatar-stage`/`.avatar-layer`, or a change to object-fit/aspect-ratio, breaks it |
| 65 | screenshots `{390,1440}-{150,153,187}-full-layers.png` | — | P evidence (committed dir) |
| 68 | `getByRole('button',{name:'見た目 2',exact:true})`; AVATAR img `src` changes; `naturalHeight===1000`; screenshot `desktop-appearance2` | `AvatarCustomerPreview.tsx:11` | B |
| 69 | `&locale=en`: `getByText('Your height',{exact:true})`; `getByRole('button',{name:'Appearance 2',exact:true})`; **`locator('.avatar-disclaimer')`** toContainText `'completed payment'` | `AvatarFitPreview.tsx:26` (`Your height` inside `<span>`), `AvatarCustomerPreview.tsx:11`, `AvatarFitPreview.tsx:11,29` | P: class `.avatar-disclaimer` plus a legal-copy fragment |
| 70 | 390 px: `[data-avatar-stage] img` count 2; screenshot `mobile-missing-optional-layers` | — | P |
| 71 | `[data-avatar-stage]` count 0; `getByRole('status')` toContainText `'表示できる素材がありません'` | `AvatarCustomerPreview.tsx:13` `<p role="status">` | B. Strict: a single status element |
| 72 | `img[src*="_next/image"]` count 0 (5 requests to `/avatar-media/`) | `AvatarFitPreview.tsx:13` `<Image unoptimized … loading="lazy">` | **B/P: images must stay `unoptimized`** (no Next optimizer). Lazy loading must still load all 5 visible layers |

---

## 12. `tests/avatar/phase5-e2e.ts`

- **Runner:** `npm run test:avatar` (package.json:96, second step). `startFlowApp({publicP0:true,avatarPhase5:true,warmRoutes:true})` → `next dev tests/flow-app`. Guest pages `/ja/book` and `/en/book` re-export `apps/web/src/app/[locale]/book/page.tsx` (`GuestBooking`). The guest API is test-composed (`tests/flow-app/src/app/api/guest/[[...record]]/route.ts`, `apps/web/src/lib/guest-http`).
- **Viewport:** 390×844, sweep 320/390/768/1440. External requests blocked; `visualPosts===0`; console fatal filter as in phase4. Routes warmed at :39: `/ja`, `/en/book`, `/staff/login`, `/staff/ledger`, `/api/auth/get-session`.
- **API:** `/api/guest/draft`, `/api/guest/avatar/:draft/:rev/:member` (200 `{APPEARANCE_1,APPEARANCE_2}`, `cache-control private, no-store`), `/guest-avatar-media/...` (200 webp, `vary` includes cookie; 404 for 9 negative cases; 405 for POST), `/api/guest/context`, `/api/guest/preview`, `/api/guest/logout` 200, `/avatar-media` and `/preview/avatar` permission checks (`/Staff sign-in/`).
- **Evidence:** `docs/execution/avatar-phase5/{screenshots/*.png,screenshots.json,browser-measurements.json,local-e2e.json}`.

| Line | Locator / assertion | Producer | Class / note |
|---|---|---|---|
| 42 | `goto('/ja/book')`; `getByLabel('利用開始日',{exact:true})` toBeEnabled, fill; `getByLabel('利用終了日',{exact:true})` fill | `components/GuestBooking.tsx:332-333` (`<label><span class="guest-label-text">…</span><input>`; the required flag is `aria-hidden`, `:302`) | B: the label text must not gain visible extra words (exact) |
| 42 | `getByRole('button',{name:'用品を選ぶ',exact:true})` | `GuestBooking.tsx:336` | B |
| 42 | `getByLabel('ポールのサイズ 1',{exact:true}).selectOption('pole-'+variants.pole)` | `GuestBooking.tsx:348` (`aria-label`); option value from `packages/core/src/guest/service.ts:21` | B |
| 42 | `getByRole('button',{name:'候補と参考料金を確認',exact:true})` | `GuestBooking.tsx:353` | B |
| 42, 104 | `getByRole('radio',{name:/おすすめ/})` visible / check | `GuestBooking.tsx:354` (radio `<input type=radio>` inside `<label>` with `directionLabel(d)`, `:268`) | B: candidates must stay native radios labelled by the direction word |
| 42 | `[data-avatar-stage]` count 0 (no art) | `AvatarFitPreview.tsx:22` via `GuestAvatarPreview` | P hook |
| 71 | after reload `[data-avatar-stage]` count 1; all imgs loaded | `components/GuestAvatarPreview.tsx:22-23` → `AvatarFitPreview` | P hook |
| 74 | `getByRole('radio',{name:new RegExp(label)}).check()` with label `短め/おすすめ/長め` | `GuestBooking.tsx:354,268` | B |
| 75-77 | **geometry:** `[data-layer="AVATAR"]` and `[data-layer="SKI"]` bounding boxes: `|ski.h − body.h·lengthCm/170| ≤ 1`, `|ski.bottom − body.bottom| ≤ 1`; no overflow at 320–1440 | `AvatarFitPreview.tsx:12`, `avatar.css`, plus the guest page CSS `components/guest.css` (stage width) | **P geometry: high risk** |
| 77 | screenshots `{390,1440}-{SHORTER,RECOMMENDED,LONGER}` | — | P evidence |
| 79 | `getByRole('button',{name:'見た目 2',exact:true})`; AVATAR img src changes; `naturalHeight===1000`; no extra metadata request; `img[src*="_next/image"]` count 0; screenshot `desktop-appearance2` | `GuestAvatarPreview.tsx:23` | B; the unoptimized requirement as in phase4 |
| 80 | `goto('/en/book')`: `getByRole('button',{name:'Appearance 1',exact:true})`; `.avatar-disclaimer` toContainText `'completed payment'` | `GuestAvatarPreview.tsx:23`, `AvatarFitPreview.tsx:11,29` | P class + copy |
| 81, 87 | (on the `/en/book` page) `getByRole('radio',{name:/RECOMMENDED/i})` visible; `[data-avatar-stage]` count 0 | `GuestBooking.tsx:268` en label `'Recommended'` | B. Works only because the page is English at that point |
| 85-86 | `waitForResponse(/api/guest/avatar/ 503)` after reload | `GuestAvatarPreview` fetch | B |
| 96 | staff login (sign-in response 200) | §1 | B |
| 104 | `/ja/book`: radio `/おすすめ/` check; `getByLabel('全員のサイズ・モデル条件・ウェア構成を確認した').check()`; `getByRole('button',{name:'全員分の最終確認へ'})`; `getByRole('region',{name:'全員分の確認'})` toContainText `'全員分の参考総額'` | `GuestBooking.tsx:355`, `:356`, `:359` (`<section aria-label>`), `:367` (`<dt>`) | B (`全員分の参考総額` is a field label used as content proof) |
| 105 | `getByRole('button',{name:'この予約画面を閉じる'})`; `waitForResponse(/api/guest/logout)` 200; `waitForURL(origin+'/ja')` | `GuestBooking.tsx:377` | B: URL after close is `/ja` |

---

## 13. Playwright `tests/e2e/*.spec.ts` (`npm run test:e2e`)

Config `playwright.config.ts:1-10`: two projects (`desktop` = Desktop Chrome 1280×720; `mobile` = iPhone 13 390×664 viewport, touch, chromium). Server A: `next start apps/web` on `webPort` (production build of real apps/web, with no DB runtime configured, so staff and booking surfaces are unauthenticated or unconfigured). Server B: `next dev tests/ui-app` on `webPort+1`. Default `baseURL` is server A. `ledger-ui.spec.ts:3` switches to server B.

### 13a. `foundation.spec.ts` (server A, apps/web)

| Line | Dependency | Producer | Class |
|---|---|---|---|
| 3 | GET `/` (no redirect following) → 307, location pathname `/ja` | `app/page.tsx:3` `redirect('/ja')` | B |
| 4 | GET `/customer` → 307 → `/ja/book` | `app/customer/page.tsx:3` | B |
| 5 | `page.goto('/')`; `toHaveURL(/\/ja$/)`; `getByRole('heading',{level:1})` visible | `components/PublicPage.tsx:27` `<h1>{page.heading}</h1>` | B/P. **Strict mode: exactly one h1** on `/ja` (any second h1, e.g. in a hero or logo, fails) |
| 6 | `getByText('この画面は開発用の基盤です')` count 0 | (absent everywhere) | P negative |
| 9-14 | `/api/internal/worker-tick` 401 `{state:'UNAUTHORIZED'}`, `cache-control` contains `no-store`; POST 405 | API | B |
| 18-19 | `/api/staff`, `/api/admin` 401 `{error:'AUTHENTICATION_REQUIRED'}` | API | B |
| 20 | `page.goto('/staff')` and `/admin`: **`getByRole('heading')` toHaveText `'認証が必要です'`** | `app/staff/page.tsx:8`, `app/admin/page.tsx:7` | **B/P. Strict: exactly ONE heading of any level on the unauthenticated `/staff` and `/admin` pages.** A layout header with an h1–h6 breaks this |
| 24-26 | `/api/health` 200 JSON equal to `{service:'zao-rental',stage:'foundation',bookingAvailable:false}`; `x-robots-tag: noindex, nofollow` | API | B |

### 13b. `booking-access.spec.ts` (server A)

API only: `/api/booking-access` 503 `{error:'BOOKING_ACCESS_UNCONFIGURED'}`, no `set-cookie`; POST `/api/booking-access/issue` 503 (:3-4). No UI.

### 13c. `ledger-auth.spec.ts` (server A)

| Line | Dependency | Producer | Class |
|---|---|---|---|
| 3 | `goto('/staff/ledger')`; `getByRole('heading',{name:'認証が必要です'})` visible; `getByRole('button',{name:'＋ 登録'})` count 0 | `app/staff/ledger/page.tsx:8`; `LedgerWorkspace.tsx:40` | B |
| 4-7 | `/api/ledger/{models,variants,assets,poles,bundles}` GET/POST/PATCH → 401 `{error:'AUTHENTICATION_REQUIRED'}`, `no-store` | API | B |
| 8 | `/test-ledger`, `/tests/ui-app`, `/race` → 404 on apps/web | routing | B: do not add these routes to apps/web |

### 13d. `ledger-ui.spec.ts` (server B, `tests/ui-app`)

- `tests/ui-app/src/app/page.tsx`: `<LedgerWorkspace client={fixtureClient} canEdit testNotice/>` from `apps/web/src/components/ledger/LedgerWorkspace.tsx`. Layout imports `apps/web/src/app/globals.css` (`tests/ui-app/src/app/layout.tsx:2`).
- `tests/ui-app/src/app/race/page.tsx` adds `<section aria-label="応答順序テスト">` with `保留応答：N / 完了応答：M`, `最初の応答を返す`, `最後の応答を返す` (test-owned) above the same `LedgerWorkspace`.
- `tests/ui-app/fixture-client.ts` implements `LedgerClient` (type from `apps/web/src/components/ledger/client`) over `tests/fixtures/ledger-sample`. It assumes `labelCopies` and `unit` fields and `history[]` with `action/reason`. It is coupled to the LedgerClient interface, not to markup.

| Line | Dependency | Producer | Class / note |
|---|---|---|---|
| 5 | `getByText('6 件の台帳記録')` | `LedgerWorkspace.tsx:40` `` `${total} 件の台帳記録` `` | B (count) / format |
| 5 | `getByText('合成サンプルを使った画面テストです。実スタッフのログイン・実在庫ではありません。')` | `LedgerWorkspace.tsx:36` (`testNotice`) | P copy (exact full sentence) |
| 6 | `scrollWidth<=innerWidth` (desktop 1280 and iPhone 13 390) | `ledger/ledger.css`, `globals.css` | P |
| 7, 13, 28 | screenshots `.local/screenshots/ledger-${project}-{list,detail,registration}.png` | — | P evidence |
| 8 | `getByRole('combobox',{name:'年齢区分',exact:true}).selectOption('KIDS')` → `'1 件の台帳記録'`; `getByRole('cell',{name:'子供 / Regular 100 cm',exact:true})` | filter `LedgerWorkspace.tsx:45`; cell `:51` `{label(age)} / {label(tier)}<span>{size}</span>` | **B/P: the cell accessible name relies on `.ledger-shell td span{display:block}` (ledger.css) to insert the space before `100 cm`.** If the span becomes inline, the name becomes `…Regular100 cm` and the exact match fails |
| 9-10 | `getByRole('combobox',{name:'クラス',exact:true}).selectOption('PREMIUM'/'')` → `'0 件の台帳記録'` | `:45` | B |
| 11 | `getByLabel('サイズ',{exact:true}).fill('160CM')` → `'1 件の台帳記録'`; cell `'大人 / Regular 160 cm'` | `:46` | B + same span/display dependency |
| 12 | `getByRole('button',{name:'詳細：検証用スキーブーツ 26.5 cm'})`; `getByRole('complementary',{name:'台帳詳細'})`; `detail.getByText('要確認・未記録',{exact:true})` | `:51` aria-label; `:55` `<aside>`; BSL text `:55` | B (`<aside>` required) |
| 14 | `getByRole('button',{name:'基本情報を更新'})`; `getByRole('region',{name:'更新フォーム'})`; `form.getByLabel('備考',{exact:true})`, `getByLabel('更新理由')`; `getByRole('button',{name:'変更を保存'})`; detail text `'合成サンプルの表示確認'` (exact); `'更新 · 画面テストで確認'` | `:55` (button), `:74` section aria-label, `:92` inputs, `:93` submit, history `:55` `{登録\|更新} · {reason}` | B; history format `'更新 · '` (middle dot) is P but load-bearing |
| 15 | `getByRole('button',{name:'ポール数量',exact:true})`; `getByRole('cell',{name:/6 ペア/})`; `getByText('2 件の台帳記録 / 数量単位：ペア（2本）')` | tabs `:8`; cell `:51`; text `:40` | B/P format |
| 16 | `'セット構成'` tab; `getByRole('button',{name:/詳細：スキーセット/})`; `detail.getByText('ポール × 1 ペア')`; `getByRole('cell',{name:'構成定義のみ 物理在庫を増やしません'}).first()` | `:8`, `:51`, components list `:55` (`{label(family)} × {q} {ペア}`), cell `:51` (same span spacing dependency) | B/P |
| 19 | `getByRole('button',{name:'商品モデル',exact:true})`; `getByRole('button',{name:'＋ 登録',exact:true})`; `getByRole('region',{name:'登録フォーム'})` | `:8`, `:40` (full-width `＋` + space), `:74` | B |
| 20 | `form.getByLabel('商品コード')`, `getByLabel('名称',{exact:true})`, `getByLabel('データ区分').selectOption('SYNTHETIC')`, `getByLabel('出典文書')`, `getByLabel('出典の行・セル・記録キー')`; `getByRole('button',{name:'登録を保存'})` | `:76-77`, `:91`, `:93` (`input()` helper labels) | B |
| 21 | `'7 件の台帳記録'`; `getByRole('button',{name:'詳細：画面テスト追加モデル UI-DEMO-MODEL'})`; detail `getByText('model-create-case')` | `:40`, `:51` (`size??code`), `:55` source locator `<small>` | B |
| 26 | `form.getByRole('combobox',{name:'サイズ・区分',exact:true}).selectOption('…0105')` | `:81` | B |
| 27 | `getByRole('combobox',{name:'BSL確認状況',exact:true}).selectOption('UNVERIFIED')` | `:90` | B |
| 29 | detail `'要確認・未記録'` (exact), `'synthetic-boot-create'` | `:55` | B |
| 30 | `getByRole('button',{name:'詳細：検証用ポール 110 cm'})`; `edit.getByLabel('数量（ペア / 1ペア＝2本）').fill('8')`; `getByLabel('更新理由')`; `'変更を保存'`; detail `getByText('8 ペア（1ペア＝2本）')`; `'更新 · 合成サンプルの数量訂正'` | `:51`, `:89`, `:92-93`, `:55` | B/P format |
| 34 | `settle()` = `evaluate` double `requestAnimationFrame` | — | timing |
| 35-42 | `/race`: `getByRole('region',{name:'応答順序テスト'})` (test-owned); `'詳細：検証用スキー 160 cm'` (exact), `'詳細：検証用スキーブーツ 26.5 cm'`; `'ポール数量'`, `'個体台帳'` tabs; `detail.getByRole('heading',{name:'検証用スキー',exact:true})` count 0 / `'検証用スキーブーツ'` visible | `LedgerWorkspace.tsx:8,51`; detail `<h2>{detail.name}</h2>` `:55`; selection-counter late-response guard (`selection.current`) | B: the detail name must be a heading inside `<aside>` |

---

## 14. `tests/ui-app` and `tests/flow-app` wrapper summary

- **tests/ui-app** (Playwright server B): `page.tsx` and `race/page.tsx` render `apps/web/src/components/ledger/LedgerWorkspace` with `fixtureClient`. `layout.tsx` imports `apps/web/src/app/globals.css` and wraps in `<html lang="ja"><body>`; it does **not** use the apps/web root layout, so layout-level redesign elements will not appear here. `api/health` returns `{service:'ledger-component-test-harness',synthetic:true}`. Adds the `応答順序テスト` section (race).
- **tests/flow-app** (`startFlowApp`): nearly every file is a one-line re-export of the matching `apps/web/src/app/**` page or route, including `layout.tsx`, `page.tsx`, `[locale]/*`, `admin/*`, `staff/*`, `preview/{avatar,integrated,rental}`, `api/*`, `avatar-media`, `guest-avatar-media`, `media`, and `proxy.ts` (re-exports `apps/web/src/proxy` with its own matcher). Test-specific additions and differences:
  - `api/bookings`, `api/custody`, `api/wear`: compose apps/web `lib/*-http` handlers with `tests/flow/test-runtime` services (`ISOLATED_TEST` mode). This is what makes the booking UI show "開発予約詳細" / "テストアダプタへ照合要求".
  - `api/guest/[[...record]]`: apps/web `guest-http` with the test flow service and an optional synthetic P1 security config.
  - `api/content-fixture`, `api/photo-fixture`: test handlers (`tests/content/http.ts`, `photo-http.ts`).
  - `staff/content-fixture/page.tsx`: test page → `tests/content/Workspace.tsx` (apps/web `StaffSessionBoundary` + `holds.css`).
  - `staff/rental/page.tsx` (singular): test page rendering apps/web `CustodyWorkspace` with its own denial `<h1>貸出返却の利用権限が必要です</h1>`. `BookingWorkspace.tsx:27` links to `/staff/rental` in ISOLATED_TEST mode.
  - `test-asset-reader/page.tsx`: renders `tests/flow/AssetReaderFixture.tsx` (apps/web `AssetQrInput`) only in development with `ZAO_TEST_FLOW_RUNTIME` set.
- **Implication:** markup, copy, and CSS changes in `apps/web/src/components/*` and `apps/web/src/app/**` flow directly into every flow-app test. There is no snapshot of the old UI inside the wrappers.

---

## 15. Keyboard, focus, touch, and media summary

- **No keyboard or focus assertions** anywhere: no `press`, `keyboard.*`, `toBeFocused`, or Tab traversal.
- **Touch:** `asset-reader-ui.ts:28-29` uses `.tap()` (context `hasTouch:true`); the mobile e2e project uses an iPhone 13 profile.
- **Print media:** `launch-ui.ts:60-63` (`emulateMedia print`, computed visibility).
- **Computed style or geometry assertions:** `launch-ui.ts:56-62` (label width ≤280, `breakInside`, print visibility); `asset-reader-ui.ts:27` (button height ≥44); `phase4-e2e.ts:63-65` and `phase5-e2e.ts:76-77` (layer bounding boxes ±1 px); overflow checks in rec/normal-ui:36, ops/normal-ui:50, console:103, launch:89, flow/normal-ui:34, asset-reader:15,27, content:46,68, phase4:64, phase5:76, ledger-ui:6.
- **Canvas pixel reads:** flow/normal-ui:34 (`getImageData` on `開発予約QR`). The asset-reader fixture feeds a canvas `captureStream` to `AssetQrInput`'s `<video>`.
- **sessionStorage contracts used by tests:** content:86 sets `zao-private-photo-job` (test-owned). Pending-request recovery after reload relies on the apps/web keys in `RecommendationWorkspace` (pendingKey), `BookingWorkspace` (storage), and `useOperationsRequest` (`zao-operations-<workspace>`). Changing those keys or their reload behaviour breaks the "同じ要求を照合・再送" / "同じ保存済み要求を照合" checks.

---

## Riskiest for redesign (top 10)

1. **`/admin/launch` button and form allow-list** (`tests/operations/launch-ui.ts:77-80`). The page must contain zero `<form>` elements, no password input, and **no button with text other than `読み込む` or one containing `ログアウト`**. Any global header, menu toggle, theme switch, or close button added via `app/layout.tsx` or `LaunchGateView` fails. Icon-only buttons with empty innerText are the only safe additions.
2. **Single-heading and single-h1 strictness on auth-gate pages** (`tests/e2e/foundation.spec.ts:5,20`, `ledger-auth.spec.ts:3`). `/staff` and `/admin` must render exactly one heading (`認証が必要です`), and `/ja` exactly one `<h1>`. A layout or brand header with a heading element breaks this.
3. **Avatar geometry within 1 px** (`phase5-e2e.ts:75-77`, and orphaned `phase4-e2e.ts:63-65`). `[data-avatar-stage]`, `[data-layer="SKI"|"AVATAR"]`, `<img>` children, absolute % boxes (`avatar.css` `.avatar-stage`, `.avatar-layer`, `object-fit:fill`), `Image unoptimized` (no `_next/image`), and `.avatar-disclaimer` containing "completed payment". Any padding, border, transform, or aspect change on these breaks the ratio checks.
4. **Asset label print and size CSS** (`launch-ui.ts:35-63`, `ops/normal-ui.ts:36`). Requires classes `.asset-label` (with `<code>` child) and `.ledger-id`; `footer.ledger-footer`; `aside[aria-label="台帳詳細"]`; `canvas[aria-label="用品QR <id>"]`; label border-box width ≤280 px; `break-inside:avoid`; the print rule `body>*{visibility:hidden}` + `.asset-labels *{visible}` in `operations.css`.
5. **Ledger list must stay a `<table>` with `tbody tr`** (`launch-ui.ts:28,50`), and cell accessible names depend on `.ledger-shell td span{display:block}` (`ledger-ui.spec.ts:8,11,16`, e.g. `'子供 / Regular 100 cm'`). Switching to cards or divs, or making the span inline, breaks this.
6. **Exact composite refund string in the ops console** (`console-ui.ts:66`): `'オンライン返金 / 金額: ¥7,500 / 経過: 3時間 / 要手動調査：結果不明・Provider IDなし（自動再送しません）'`. Also `section[aria-label="例外一覧"] article` (:102), `section[aria-label="稼働状況"]` (:78), a single `role=status` (:90), no `再送`/`返金` buttons in rows (:67), and the word `Error` must not appear in the health section.
7. **Recommendation candidate card structure** (`rec/normal-ui.ts:40`): `button.locator('..')` must be the per-direction card holding `"<n> cm"`, `"割引前の参考額 … 円"`, or `"該当する在庫候補なし／選択不可"` (`RecommendationWorkspace.tsx:50`). Also `article[aria-label="利用者 N の候補"]` with `基準 150cm`, `145 cm`, `ブーツ 26.5cm` (exact spacing), and button names `おすすめを選ぶ N` / `短めを選ぶ N` / `長めを選ぶ N`.
8. **External-request ban** (`ops/normal-ui.ts:27,54`, `console-ui.ts:27,105`, `launch-ui.ts:19,91`, `phase4:27,75`, `phase5:31-33,106`). Web fonts, CDNs, analytics, or remote images on staff, admin, guest, or avatar pages fail these suites. Self-host every asset.
9. **Overflow at 320–1440 px plus the AssetQrInput 44 px touch targets** (`asset-reader-ui.ts:27`, `scrollWidth<=innerWidth` with no +1 tolerance in rec, ops/normal, flow, content, asset-reader, ledger-ui). Content-fixture overflow also depends on apps/web `holds.css` (imported by the test `Workspace.tsx:5`).
10. **Copy used as hard locators or status semantics.** Long Japanese labels such as `モデル指定なし・表示したサイズとクラスを選択条件とすることを確認`, `開発用の合成予約であり、営業規約・請求の確定ではないことを確認`, `全員のサイズ・モデル条件・ウェア構成を確認した`, `操作理由（詳細な個人情報は記入しない）`, and `初期パスワード（15〜128文字）`. AssetQrInput status messages (`許可を待っています`, `許可がありません`, `見つかりません`, `まだ確認できません`, `用品の個体ID`). Format strings `dry-run: 確定可能`, `今回の読取: 1件`, `DRAFT · revision`, `更新 · <reason>`, `N 件の台帳記録`, `2 件の台帳記録 / 数量単位：ペア（2本）`, `決済状況 COMPLETED`, and `10,640 円` (space before 円). Raw state codes must stay rendered: `PRIVATE_AVAILABLE`, `COMPLETE`, `HOLD_FAILED`, `INSUFFICIENT`, `VALID_PRIVATE_ESTIMATE`, `EXPIRED`, `DRAFT`, `CONFIRMED_DEV`, `PAYMENT_PENDING` (as a heading).

Also note:
- Many locators use **non-exact** `getByLabel`. A redesign that adds a label containing `料金版`, `商品`, `状態`, `対象開始日`, or `適用日時` to the same page triggers Playwright strict-mode ambiguity (`ops/normal-ui.ts:45-47`, `console-ui.ts:63`).
- Several actions are located by **aria-label rather than visible text**: `スタッフを編集：<name>` (visible text `設定を編集`), `詳細：<name> <size|code>` (visible text `見る ↗`). Those aria-labels must survive.
- The logout hydration probe (`flow/normal-ui.ts:41`) requires a client `onClick` button, not a form or server action.
