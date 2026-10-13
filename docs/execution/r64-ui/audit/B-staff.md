> Historical pre-redesign/WIP audit recovered from Claude. Findings describe that checkpoint, not the final candidate. See TAKEOVER_RECONCILIATION.md and VALIDATION.md for final dispositions and receipts.

# Part B — Staff-side browser tests: UI dependency map

Repo: `/Users/ginisato/Documents/Codex/2026-10-03/files-pasted-by-the-user-zao/work/f2` (read-only audit, 2026-10-13).
Legend: **B** = BEHAVIOURAL (accessible names of actions/controls, form labels used to fill, state/status semantics, URLs, API results, numbers/prices). **P** = PRESENTATIONAL (class names, layout, decorative copy, CSS selectors, screenshots). The source paths below are relative to `apps/web/src/` unless they start with `tests/` or `packages/`.

Playwright matching rules that matter for a redesign:
- `getByRole(..., {name})` without `exact:true` does a case-insensitive **substring** match. If a new element's name contains the old string, the locator now matches two elements and strict mode fails.
- `getByLabel(x,{exact:true})` resolves `<label>` text (wrapping or `for=`) **or** `aria-label`.
- `getByRole('region',{name})` needs a `<section>` with an accessible name (`aria-label`). If it becomes a `<div>`, or loses `aria-label`, the locator breaks.
- `getByRole('article',{name})` needs `<article aria-label=…>`.
- `getByRole('status')` needs `role="status"`. Several tests call it **page-wide**, so a second status element on the page causes a strict-mode failure.
- `toContainText` is a substring check on the region's full textContent.
- No test uses `toHaveScreenshot` or `toMatchSnapshot`. Every `page.screenshot` call only saves evidence to `.local/screenshots/` and is never compared with a baseline.

---

## 0. App served and shared helpers

### 0.1 Which app each runner serves

| Test file | npm script (package.json) | Launcher | App served |
|---|---|---|---|
| tests/staff/home-ui.ts | `test:staff-home-ui` (l.56) | `startDevelopmentApp({built:true,operations:true})` | **apps/web**: `next start apps/web` (scripts/development-app.ts:19), NODE_ENV=production. Needs an up-to-date `npm run build` (`next build apps/web --webpack`, package.json:18) of the redesigned UI first, or the run tests a stale `.next`. |
| tests/custody/normal-ui.ts | `test:custody-ui` (l.54) | `startFlowApp()` (tests/flow/launcher.ts:89) | **tests/flow-app** via `next dev tests/flow-app --webpack`. Pages re-export apps/web pages. **Exception:** `/staff/rental` (singular) is a fixture-only page (tests/flow-app/src/app/staff/rental/page.tsx) that renders `components/CustodyWorkspace` without the apps/web `/staff/rentals` nav wrapper. Layout re-exports `app/layout.tsx`. |
| tests/wear/normal-ui.ts | `test:wear-ui` (l.50) | `startFlowApp()` | tests/flow-app (re-exports `/staff/wear`, `/preview/integrated`, `/preview/rental`, `/staff/quotes`, `/staff/login`, `/staff/logout`, `/staff/ledger`) |
| tests/transfer/normal-ui.ts | `test:transfers-ui` (l.32) | `startDevelopmentApp({built:true})` | apps/web (built) |
| tests/inventory/normal-ui.ts | `test:holds-ui` (l.30) | `startDevelopmentApp({built:true})` | apps/web (built) |
| tests/pricing/normal-ui.ts | `test:quotes-ui` (l.34) | `startDevelopmentApp({built:true})` | apps/web (built) |
| tests/notification/normal-ui.ts | `test:notification-ui` (l.116) | `startDevelopmentApp({built:true,operations:true})` | apps/web (built) |

All scripts run as `node --import tsx <file>`. Each test uses its own Playwright `chromium.launch()`, not `@playwright/test`'s runner. tests/ui-app is **not** used by any of these seven files.

The imported fixture modules contain **no locators**: tests/inventory/fixture, tests/recommendation/fixture, tests/wear/fixture, tests/flow/fixture, tests/notification/loopback. They seed data only. tests/flow/launcher.ts only warms routes.

### 0.2 Shared UI helpers (each test copies them inline; documented here once)

**H-LOGIN.** Defined at home-ui.ts:56, custody:36, wear:19, transfer:16, inventory:16, pricing:16, notification:29 and notification:38 (inline).

| Locator / assertion | Source | Class |
|---|---|---|
| `goto('/staff/login')` | app/staff/login/page.tsx:4 | B (URL) |
| `getByLabel('メールアドレス',{exact:true}).fill` | components/StaffLogin.tsx:12 (`<label>メールアドレス<input name="email">`) | B. The label must stay exactly `メールアドレス`. |
| `getByLabel('パスワード',{exact:true}).fill` | StaffLogin.tsx:12 | B. Exact label. If the label becomes e.g. `パスワード（必須）`, the locator breaks. |
| `getByRole('button',{name:'ログイン',exact:true}).click()` | StaffLogin.tsx:12 (`{busy?'確認中…':'ログイン'}`) | B |
| `waitForURL('**/staff/ledger')` (home) / `waitForURL(origin+'/staff/ledger')` (others) | StaffLogin.tsx:9 `window.location.replace('/staff/ledger')` | B. The post-login redirect target must stay `/staff/ledger`. |

**H-LOGOUT-PAGE.** custody:40, wear:21, plus the second half of the transfer/inventory/pricing logout flows.

| Locator | Source | Class |
|---|---|---|
| `goto('/staff/logout')` → `getByRole('button',{name:'ログアウトする',exact:true}).click()` → `waitForURL(origin+'/staff/login')` | components/StaffLogout.tsx:5-6 | B |

**H-LOGOUT-LINK** (transfer:45, inventory:35, pricing:42): `getByRole('link',{name:'ログアウト',exact:true})`. Producers:
- TransferWorkspace.tsx:29
- HoldWorkspace.tsx:56
- QuoteWorkspace.tsx:39 (`<a href="/staff/logout">ログアウト</a>`)

B. The workspace header must keep a link with the exact name `ログアウト`. Changing it to a button breaks the locator, because these tests use role **link**.

**H-LOGOUT-BUTTON-LEDGER** (notification:40): on `/staff/ledger`, `getByRole('button',{name:'ログアウト',exact:true})` is clicked. Producer: components/StaffLedger.tsx:9 (`<button onClick={logout}>ログアウト</button>`). B. On the ledger toolbar this control must stay a **button**, while the workspaces use a **link** (inconsistent today; a unified redesign will break one of the two groups).

**H-PRICE-INIT** (custody:43, wear:23, pricing:23):

| Locator | Source | Class |
|---|---|---|
| `goto('/staff/quotes')` | app/staff/quotes/page.tsx | B |
| `getByLabel('料金の対象開始日').fill` / `getByLabel('料金の対象終了日').fill` | QuoteWorkspace.tsx:41 | B |
| `getByRole('button',{name:'開発用の初期料金を設定'})` | QuoteWorkspace.tsx:41 | B |
| `getByRole('region',{name:'料金版',exact:true})` toContainText `'PRIVATE_AVAILABLE'` | QuoteWorkspace.tsx:40 (`<section aria-label="料金版">`, raw `{b.state}`) | B. The raw enum must be rendered. |

**H-STAFF-CREATE** (transfer:20, inventory:22, pricing:20; pricing:43 for edit), on `/staff/users`:

| Locator | Source | Class |
|---|---|---|
| `getByRole('button',{name:'スタッフを作成',exact:true})` | StaffManagement.tsx:13 | B |
| `getByRole('form',{name:'スタッフ作成'})` / `{name:'スタッフ更新'}` | StaffManagement.tsx:14 (`<form aria-label=…>`) | B. The form needs `aria-label` to get the form role. |
| `f.getByLabel('表示名',{exact:true})`, `('メールアドレス',{exact:true})`, `('初期パスワード（15〜128文字）')` | StaffManagement.tsx:14 | B |
| `f.getByLabel('Role',{exact:true}).selectOption('ADMIN'/'STAFF')` | StaffManagement.tsx:15 (`aria-label="Role"`) | B |
| `f.getByLabel('店舗範囲',{exact:true}).selectOption('ALL'/'ASSIGNED')` | StaffManagement.tsx:16 | B (option values) |
| `f.getByLabel('Mountain Station',{exact:true}).check()`, `('Central Station',{exact:true})` | StaffManagement.tsx:16 (checkbox label = `storeDisplayName(s)`, packages/contracts/src/store-display.ts:3) | B |
| `f.getByLabel(<permission label>,{exact:true}).selectOption('allow'/'deny')` with labels `'店舗間移動の閲覧'`, `'移動計画の確保・取消'`, `'元店舗からの発送'`, `'移動先での受領・準備完了'`, `'期間在庫・自分のHOLD閲覧'`, `'自分のHOLD取得・変更'`, `'自分の非公開見積閲覧'`, `'自分の非公開見積作成'`, `'料金版の設定（全店ADMINのみ）'` | StaffManagement.tsx:17 (both the label text and the duplicated `aria-label` map; option values `default`/`allow`/`deny`) | B |
| `f.getByRole('button',{name:'スタッフ設定を保存'})` | StaffManagement.tsx:17 | B |
| `getByRole('heading',{name:<displayName>,exact:true})` (e.g. `'合成移動担当'`, `'合成HOLDスタッフ'`, `'合成料金管理'`, `'合成見積担当'`) | StaffManagement.tsx:18 (`<li><h2>{s.displayName}</h2>`) | B/P. Each staff card needs a heading element that holds the display name. |
| `getByRole('button',{name:'スタッフを編集：合成見積担当'})` | StaffManagement.tsx:18 (`aria-label={\`スタッフを編集：${s.displayName}\`}`) | B |
| `expect(form).toHaveCount(0)` after save | StaffManagement.tsx:12 `setEditing(undefined)` | B. The form must unmount after saving. |

**H-SESSION-ENDED** (home:408, custody:81, inventory:85): `getByRole('heading',{name:'セッションを確認してください'})`. Producer: components/StaffSessionBoundary.tsx:21. B.

**H-RECOMMEND→BOOK** (custody:46-50, wear:26-28, wear:51-53, wear:58, wear:74-78), `/preview/integrated` then `/preview/rental`. Producers:
- RecommendationWorkspace.tsx:42-66
- BookingWorkspace.tsx:12-27

The per-test tables below list them.

---

## 1. tests/staff/home-ui.ts (`npm run test:staff-home-ui`, apps/web built)

**Contexts:** 5 browser contexts with `viewport {width:390,height:844}` (l.55) and default timeout 15 s. They are owner (full), narrow (BOOKING_VIEW only), inverse, checkoutOnly and onsen.

**Routes:**
- `goto('/staff/login')` (l.56)
- `waitForURL('**/staff/ledger')` (l.56)
- `goto('/staff')` (many)
- `waitForURL(new RegExp('/staff/rentals\\?booking='+confirmedId))` (l.135, l.143)
- `goto('/staff/rentals?booking='+crossStoreId)` (l.201)
- `goto('/staff/rentals?booking='+confirmedId)` (l.444)

**Network constraints:**
- l.64: a request listener records every same-origin request whose frame pathname is exactly `/staff`.
- l.449: asserts that Staff Home **never** requests `/api/operations/exceptions*` or `/api/custody/returns*`. B. A redesign must not add, for example, an exceptions badge fetch.
- `page.route('**/api/operations/manifest*')` mocks are used at l.227, l.241, l.263, l.290, l.321, l.345, l.361, l.389, l.406, l.418 and l.425. They read query params `store` and `cursor`. Producer: StaffHome.tsx:86 (`/api/operations/manifest?store=…&section=all&pageSize=50&cursor=…`). B. The client must keep calling this endpoint with these params.
- Today's list also calls `/api/bookings` (StaffHome.tsx:107-108).
- Direct API calls: POST `/api/custody/batch|scan|confirm` (l.155-165, l.210-213), expecting status 200. GET `/api/operations/exceptions?...` with the narrow context (l.177), expecting **403**.

Reusable locators: `dailyBusiness()` = `getByRole('region',{name:'本日の業務'})` (l.78); `todayBooking()` = `getByRole('region',{name:'本日の予約'})` (l.79); `storeContext()` = `getByRole('region',{name:'店舗・営業日'})` (l.81). All three use substring names (not exact).

| Test line | Locator / assertion (verbatim) | Producer (`apps/web/src`) | Class / redesign risk |
|---|---|---|---|
| 56 | H-LOGIN | §0.2 | B |
| 78 | `getByRole('region',{name:'本日の業務'})` | components/StaffHome.tsx:143 `<section aria-label="本日の業務" aria-busy className="staff-manifest">` | B. Keep a `<section>` with this aria-label. Substring match: a second region whose name contains 本日の業務 breaks strict mode. |
| 79 | `getByRole('region',{name:'本日の予約'})` | StaffHome.tsx:150 `<section aria-label="本日の予約">` | B |
| 81 | `getByRole('region',{name:'店舗・営業日'})` | StaffHome.tsx:138 `<section aria-label="店舗・営業日" className="staff-context">` | B |
| 84, 110, 405, 411 | `getByRole('heading',{name:'スタッフホーム'})` toBeVisible | StaffHome.tsx:137 `<h1>スタッフホーム</h1>` | B. Substring: any other heading containing スタッフホーム gives a strict-mode error. |
| 85 | `getByRole('region',{name:'予約QR・検索'})` visible | components/BookingSearchInput.tsx:21 `<section aria-label="予約QR・検索" className="staff-search">` | B |
| 86, 95 | todayBooking() visible | StaffHome.tsx:150 | B |
| 89, 334, 337 | `todayBooking()` toContainText `'2035-06-16'` (businessDate) | StaffHome.tsx:158 (`本日が利用期間に含まれる予約（{manifestDate} JST）`) and card period text, l.159 | B. The server date must be rendered **inside the 本日の予約 region**. The date in 店舗・営業日 (l.140) does not count, because it is in a different region. |
| 90 | dailyBusiness() visible | StaffHome.tsx:143 | B |
| 91 | `getByRole('region',{name:'運用の注意事項'})` visible | StaffHome.tsx:162 | B |
| 92, 104 | `getByText('その他の管理機能').click()` | StaffHome.tsx:163 `<details className="staff-secondary-links"><summary>その他の管理機能</summary>` | B/P, **high risk**. The test *clicks to expand*. If the redesign makes the links always visible, or renders `<details open>`, the click collapses them and the l.93/l.106 `toBeVisible` checks fail. The text must also be unique on the page (getByText is strict). |
| 93 | for `name` of `['道具の台帳','棚卸・CSV投入','店舗間移動','見積','期間在庫・HOLD','サイズ推薦','ウェアの数量貸出・返却']`: `getByRole('link',{name})` toBeVisible | StaffHome.tsx:163 (`<a href>` list) | B. **Substring** names: `'見積'` and `'店舗間移動'` match any link that contains them. Adding e.g. a "見積を作成" link or "店舗間移動の履歴" causes a strict-mode failure. |
| 100 | narrow: for `['予約QR・検索','本日の業務','運用の注意事項']` region toHaveCount(0) | StaffHome.tsx:142 (`effectivePickup&&<BookingSearchInput>`), l.143 (`showManifest`), l.162 (`canOperationsView`) | B (permission gating) |
| 101 | narrow: `locator('.staff-card',{hasText:'SYNTHETIC UX5D Confirmed'}).getByRole('button')` toHaveCount(0) | StaffHome.tsx:159 (`<article className="staff-card">`; button only if `effectivePickup`) | **P (class `.staff-card`)** plus B (no buttons on read-only cards). Renaming `.staff-card` breaks the locator, and the test then passes vacuously (count 0 also holds when nothing matches). Any new button inside the card, such as "詳細", fails it. |
| 105 | narrow: for `['道具の台帳',…,'ウェアの数量貸出・返却','スタッフ管理']` link toHaveCount(0) | StaffHome.tsx:163 | B. Substring: a narrow-visible link whose name contains e.g. `見積` fails the test. |
| 106 | narrow: `['変更・返金依頼','パスワード変更']` link toBeVisible (after summary click) | StaffHome.tsx:163 | B |
| 111 | inverse: `['予約QR・検索','本日の予約','本日の業務']` regions toHaveCount(0) | StaffHome.tsx:142/150/143 (`canBookingView` gate) | B |
| 116-118 | checkout-only: region 本日の業務 visible; `section.locator('.staff-card',{hasText:'SYNTHETIC UX5D Confirmed'})` visible; card `not.toContainText` each of `'返却受付'`, `'検品待ち'`, `'ウェア整備中'` | StaffHome.tsx:118-124, ACTION_LABEL l.27 | P (`.staff-card`) + B (label mapping) |
| 123 | `todayBooking().locator('.staff-card',{hasText:'SYNTHETIC UX5D Confirmed'})` visible | StaffHome.tsx:159 | P (`.staff-card`) |
| 124 | card toContainText `'確定済み'` | StaffHome.tsx:24 STATE_LABEL `CONFIRMED_DEV:'確定済み'`, chip l.159 | B (state label) |
| 127 | pending card toContainText `'決済照合待ち'` | StaffHome.tsx:24 `PAYMENT_PENDING:'決済照合待ち'` | B |
| 128 | `pendingCard.getByRole('button',{name:'貸出・受付で状態を確認'})` visible | StaffHome.tsx:159 | B |
| 132-133 | `dailyBusiness().locator('.staff-card',{hasText:'SYNTHETIC UX5D Confirmed'})` toContainText `'準備'` | StaffHome.tsx:27 `PREPARE_EQUIPMENT:'準備'`, l.122 | P/B. Substring `'準備'` would also match other copy in the card. |
| 134 | `manifestCard.getByRole('button',{name:'準備へ進む'}).click()` | StaffHome.tsx:124 `{label}へ進む` (computed: label + `へ進む`) | B. The button name is built from the label. Changing the template (e.g. `準備を開始`) breaks it. |
| 135, 143 | `waitForURL(/\/staff\/rentals\?booking=<id>/)` | StaffHome.tsx:83 `router.push('/staff/rentals?booking='+id)` | B (URL) |
| 136, 144, 202, 444 | `getByRole('region',{name:'貸出用品'})` toContainText bookingId | CustodyWorkspace.tsx:40 `<section aria-label="貸出用品"><p>予約 {view.bookingId}</p>`. Preset via app/staff/rentals/page.tsx:5 `presetBooking` | B |
| 141 | `getByLabel('予約番号または予約QR').fill('zao-rental:reservation:'+id)` | BookingSearchInput.tsx:24 `<label>予約番号または予約QR<input>` | B (accepts the QR payload prefix, via packages/contracts/src/reservation-qr) |
| 142 | `getByRole('button',{name:'この予約を開く',exact:true})` | BookingSearchInput.tsx:24 | B |
| 145, 203 | `getByLabel('準備・最終適合の作業記録').fill` | CustodyWorkspace.tsx:41 | B |
| 146, 204 | `getByLabel('表示された個体と数量を照合した').check()` | CustodyWorkspace.tsx:41 (checkbox inside label) | B |
| 147, 205 | `getByRole('button',{name:'照合した用品を準備固定'})` | CustodyWorkspace.tsx:41 | B |
| 148, 206 | `getByRole('button',{name:'道具の貸出を記録'})` | CustodyWorkspace.tsx:42 | B |
| 149, 207 | region 貸出用品 toContainText `'OUT'` | CustodyWorkspace.tsx:43 (`{l.requirement_key} · {l.state} · 貸出明細 …`, raw state) | B. The raw enum `OUT` must appear. Humanizing it (e.g. `貸出中`) breaks the test. |
| 164 | 本日の業務 card toContainText `'返却受付'` | StaffHome.tsx:27 `RECEIVE_RETURN:'返却受付'` | B |
| 167, 172, 176 | card toContainText `'検品待ち'` | StaffHome.tsx:27 `INSPECTION_PENDING:'検品待ち'` | B |
| 172, 176 | card `not.toContainText('要注意')`, then toContainText `'要注意'` | StaffHome.tsx:123 `<p className="staff-card-attention">要注意…` | B |
| 185, 190, 276, 305, 332 | `storeContext().getByLabel('対象店舗').selectOption('ONSEN_BASE'/'MOUNTAIN_BASE')` | StaffHome.tsx:139 (`<label>対象店舗<select aria-label="対象店舗">`, option values = StoreId) | B. Option **values** must stay the raw StoreId. The control must stay a native `<select>` (selectOption), never disabled while busy (comment at home-ui.ts:274), and **inside** the 店舗・営業日 region. |
| 188, 281, 310-311 | `.staff-card` with hasText … toHaveCount(0) | StaffHome.tsx:118 | P. A class rename makes these count-0 checks pass vacuously (silent loss of coverage). |
| 189, 422 | dailyBusiness() toContainText `'現在対応が必要な項目はありません'` | StaffHome.tsx:146 `<p className="staff-empty">現在対応が必要な項目はありません。</p>` | B (empty-state copy) |
| 398, 420, 428 | dailyBusiness() `not.toContainText('現在対応が必要な項目はありません')` | same | B |
| 216 | onsen: `region 本日の業務 .locator('.staff-card',{hasText:/^スキー(?!ブーツ)/})` | StaffHome.tsx:128-129 (`<article className="staff-card"><div className="staff-card-head"><strong>{FAMILY_LABEL[row.family]}…`). FAMILY_LABEL l.34 `SKI:'スキー'` | **P, very high risk.** The regex is anchored to the **start of the card's textContent**. Any icon text, badge, or chip rendered before the family name, or any reordering of the card head, breaks it. |
| 218 | custodyCard toContainText `'Mountain Station'` and `'Central Station'`; `not.toContainText` `'MOUNTAIN_BASE'`/`'ONSEN_BASE'` | StaffHome.tsx:130 `storeName(sourceStore) → storeName(actualStore)`; STORE_LABEL in components/guest-format.ts:6 = packages/contracts/src/store-display.ts:3 | B |
| 221 | custodyCard toContainText `'検品'` | StaffHome.tsx:28 TASK_ACTION_LABEL `INSPECT:'検品'` | B |
| 222 | custodyCard `not.toContainText` each of `'SYNTHETIC UX5D Cross Store Secret'`, crossStoreId, `'確定済み'`, `'決済照合待ち'`, `'決済要確認'`, `'利用完了'`, businessDate | StaffHome.tsx:127-132 (CUSTODY_ONLY card shows no name, state or date) | B (privacy). A redesign must not add the date or booking info to custody cards. |
| 229-233 | mocked row with `nextAction:'FUTURE_ACTION_NOT_YET_INVENTED'` → card toContainText `'詳細確認'` | StaffHome.tsx:42 `ACTION_LABEL[action]??'詳細確認'` | B |
| 250-254 | `section.locator('.staff-card',{hasText:'Page Row A'})` toHaveCount(1); `section.getByRole('button',{name:'さらに読み込む'}).click()`; Row B count 1; Row A still 1 (dedupe by key) | StaffHome.tsx:147 `<button className="staff-more">さらに読み込む</button>` | B (button), P (`.staff-card`) |
| 277, 306, 333 | `expect.poll(()=>bRequested)` (new-store manifest request issued while the old one is held) | StaffHome.tsx:111-113 (effect on activeStore) | B |
| 278-282, 303-312 | race checks: visible / count(0) of `.staff-card` with `'SYNTHETIC UX5D Race …'` | StaffHome.tsx manifest state | B/P |
| 304, 393, 407, 419, 426 | `dailyBusiness().getByRole('button',{name:'更新',exact:true})` | StaffHome.tsx:143 | B. Exactly one 更新 button inside 本日の業務. |
| 338 | todayBooking() `not.toContainText('2035-01-01')` | — | B |
| 351, 354 | narrow 本日の予約 toContainText businessDate, then `'2035-07-01'` after refresh | StaffHome.tsx:158 | B |
| 352, 355, 378, 381 | narrow region 本日の業務 toHaveCount(0) | StaffHome.tsx:143 | B |
| 353 | `narrowPage.getByRole('button',{name:'更新',exact:true})` (**page-wide**) | StaffHome.tsx:156 | B. Page-wide strict match: the narrow principal must see exactly one button named `更新`. |
| 370, 394 | `today.getByRole('status')` / `dailyBusiness().getByRole('status')` `not.toHaveText('')` | StaffHome.tsx:157 and l.145 (`<p role="status">`) | B. Exactly one `role=status` per region. |
| 371 | today `not.toContainText('予約はありません')` | StaffHome.tsx:159 (`本日が利用期間に含まれる予約はありません。`) | B (empty copy must contain that substring for the guard to be meaningful) |
| 375-377 | `today.getByRole('button',{name:'更新',exact:true})` visible and **enabled** while the date read failed | StaffHome.tsx:156 (`disabled={bookingsReq.busy\|\|manifestBusy}` only) | B |
| 380 | today toContainText businessDate after the click | — | B |
| 387, 397 | dailyBusiness() `.staff-card` 'SYNTHETIC UX5D Confirmed' stays visible after a failed refresh (409/503/network) | StaffHome.tsx manifest state | B |
| 408 | heading `'セッションを確認してください'` after a manifest 403 | StaffSessionBoundary.tsx:21 (via invalidateStaffView) | B |
| 416, 431 | `dailyBusiness().locator('.staff-card').first()` visible | StaffHome.tsx:118 | P |
| 420 | `dailyBusiness().getByRole('status')` toContainText `'読み込んでいます'` | StaffHome.tsx:136 (`本日の業務を読み込んでいます…` / `最新の状態を読み込んでいます…`) | B (loading copy) |
| 422 | status `toHaveText('')` once loaded empty | StaffHome.tsx:136 (empty string when settled) | B. The status must be **empty** in the ready/empty states, so a redesign cannot put permanent text such as "最終更新…" in this status element. |
| 427 | status toContainText `'読み込めませんでした'`; region `not.toContainText('OPERATIONS_UNCONNECTED')` | StaffHome.tsx:41 loadErrorText | B |
| 428, 431 | `dailyBusiness().getByRole('button',{name:'もう一度読み込む',exact:true})` | StaffHome.tsx:145 (only when manifestKind==='error') | B |
| 437 | `page.getByRole('button',{name:'更新',exact:true}).first().click()` | StaffHome.tsx:143/156 (first in DOM order = 本日の業務) | B/P (DOM order) |

**Screenshots (evidence only, no baseline):**
- l.421: `dailyBusiness().screenshot` → `.local/screenshots/staff-manifest-loading-390.png`
- l.423: `staff-manifest-empty-390.png`
- l.429: `staff-manifest-error-390.png`. Viewport for l.421-429 is set at l.415 to 390×900.
- l.439: `staff-home-${width}.png` fullPage at 390×1000 and 1440×1000.
- l.443: `staff-home-custody-only-390.png` (onsen context 390×844).
- l.445: `staff-rentals-preselected-390.png`. **Note:** this is actually taken at 1440×1000, the last loop width, despite the file name.

**DOM/computed checks:**
- l.438: `page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)` at widths 390 and 1440.
- l.442: the same check on the CUSTODY_ONLY page at 390. B (no horizontal overflow).
- No getComputedStyle, bounding-box, or focus/keyboard checks.

---

## 2. tests/custody/normal-ui.ts (`npm run test:custody-ui`, tests/flow-app)

**Context:** 1280×960 (l.35), timeout 15 s, `addInitScript('window.__name = (fn) => fn')`.

**Routes:**
- `/staff/login`, then `waitForURL(origin+'/staff/ledger')` (l.36)
- `/staff/logout` → `/staff/login` (l.40)
- `/staff/quotes` (l.43)
- `/preview/integrated` (l.46)
- link-click to `/preview/rental?quote=…` (l.50)
- `/staff/rental` (**fixture route**, l.56/64)
- `/staff/wear` (l.60)

**Direct API calls:**
- POST `/api/staff-users` → 201 (l.38)
- POST `/api/auth/sign-in/email` → 200 (l.39)
- GET `/api/custody/booking/<id>` → 200 (l.54); later 401 (l.78, l.81)
- POST `/api/custody/prepare` (wrong equipment) → 409 (l.55)
- POST `/api/holds/availability` → 200 and `result!=='FEASIBLE'` (l.74)
- POST `/api/custody/batch` without origin → 403; with an `actor` field → 422 (l.79)
- PATCH `/api/staff-users/<id>` → 200 (l.80)

**Response-waits:**
- l.21: POST `/^\/api\/bookings\/[0-9a-f-]{36}\/payment$/`, status 200, body `.id === bookingId`.
- l.65: POST `/api/custody/scan` → 200.

**Route mocks:**
- l.71: `**/api/custody/confirm` fetch-then-abort (lost response).

| Test line | Locator / assertion | Producer | Class / risk |
|---|---|---|---|
| 22 | `getByRole('button',{name:'テストアダプタへ照合要求'})` | components/BookingWorkspace.tsx:27 | B |
| 28, 50 | `getByRole('region',{name:'開発予約詳細'})` toContainText `'CONFIRMED_DEV'` / `'DRAFT'` | BookingWorkspace.tsx:26 (`aria-label` `開発予約詳細` in ISOLATED_TEST mode; `状態 <strong>{view.state}</strong>` raw) | B (raw state enums) |
| 36, 40 | H-LOGIN, H-LOGOUT-PAGE | §0.2 | B |
| 43 | H-PRICE-INIT | §0.2 | B |
| 46 | `getByLabel('利用開始日',{exact:true}).fill('2035-01-05')`, `('利用終了日',{exact:true})` | RecommendationWorkspace.tsx:42 (`<label>利用開始日<input type="date">`) | B (native date input `fill`) |
| 46 | `getByLabel('競技 1',{exact:true}).selectOption('SKI')` | RecommendationWorkspace.tsx:43 (`aria-label={'競技 '+(i+1)}`) | B (label = text + space + index; option values) |
| 46 | `getByLabel('利用開始時の年齢区分 1',{exact:true}).selectOption('ADULT')` | RecommendationWorkspace.tsx:43 | B |
| 46 | `getByLabel('身長cm 1',{exact:true}).fill('170')`, `('足サイズcm 1',{exact:true}).fill('25.5')` | RecommendationWorkspace.tsx:43 (wrapping label, no aria-label; label text `身長cm {i+1}`) | B. The label text must remain exactly `身長cm 1`; an added unit hint or icon text inside the label breaks the exact match. |
| 46 | `getByLabel('体重kg 1',{exact:true})`, `('利用開始時の年齢 1',{exact:true})`, `getByLabel('レベル 1',{exact:true}).selectOption('BEGINNER')` | RecommendationWorkspace.tsx:46 | B |
| 47 | `getByLabel('クラス 1',{exact:true}).selectOption('PREMIUM')`; `getByLabel('ポールのサイズ 1',{exact:true}).selectOption(<variantId>)` | RecommendationWorkspace.tsx:43, :46 | B (option value = variant UUID) |
| 48 | `getByLabel('指定モデル・シーズン 1',{exact:true}).selectOption(modelId+'\|2026/27')` | RecommendationWorkspace.tsx:66 (value `model_id\|catalog_season`) | B |
| 49 | `getByLabel('ウェア上下セットを追加 1',{exact:true}).check()`; `getByLabel('上サイズ 1',{exact:true})`, `('下サイズ 1',{exact:true}).selectOption(variantId)` | RecommendationWorkspace.tsx:63 (checkbox `aria-label`), :65 | B |
| 50 | `getByRole('button',{name:'推薦候補を確認',exact:true})` | RecommendationWorkspace.tsx:48 | B |
| 50 | `getByRole('button',{name:'おすすめを選ぶ 1',exact:true})` | RecommendationWorkspace.tsx:50 (`{labels[d]}を選ぶ {i+1}`, labels l.15 `RECOMMENDED:'おすすめ'`) | B (computed name) |
| 50 | `getByRole('checkbox',{name:'表示したモデル契約・サイズ・ウェア構成を選択条件とすることを確認'}).check()` | RecommendationWorkspace.tsx:51 | B |
| 50 | `getByRole('button',{name:'全員分をHOLDして見積を保存',exact:true})` | RecommendationWorkspace.tsx:51 | B |
| 50 | `getByRole('region',{name:'見積詳細',exact:true})` visible | RecommendationWorkspace.tsx:54 | B |
| 50 | `getByRole('link',{name:'予約情報・決済結果へ'}).click()` | RecommendationWorkspace.tsx:54 (`<a href="/preview/rental?quote=…">`) | B (must stay a link) |
| 50 | `getByLabel('合成氏名').fill`, `getByLabel('架空メール宛先').fill`, `getByLabel('開発用の合成予約であり、営業規約・請求の確定ではないことを確認').check()`, `getByRole('button',{name:'合成予約情報を保存',exact:true})` | BookingWorkspace.tsx:25 | B |
| 51 | DB: `price_snapshot.totalJpy===13000`, `chargeReady===false` | API/DB | B |
| 56 | `goto('/staff/rental')`; `getByLabel('予約IDまたは予約QR').fill('zao-rental:reservation:'+id)` | CustodyWorkspace.tsx:39 (strips the prefix, l.39) | B |
| 56 | `getByRole('button',{name:'予約と仮割当を照合'})` | CustodyWorkspace.tsx:39 | B |
| 56 | region `'貸出用品'` toContainText bookingId; then toContainText `'OUT'` | CustodyWorkspace.tsx:40, :43 | B (raw `OUT`) |
| 56 | `'準備・最終適合の作業記録'`, `'表示された個体と数量を照合した'`, `'照合した用品を準備固定'`, `'道具の貸出を記録'` | CustodyWorkspace.tsx:41-42 | B |
| 60 | `/staff/wear`: `getByLabel('予約番号',{exact:true}).fill`; button `'貸出を読込'` exact; button `'ウェア数量を貸出記録'` exact; button `'1着を受領：person-1:WEAR_JACKET'` exact visible | WearWorkspace.tsx:38, :40 (`1着を受領：{l.requirement_key}`) | B (computed name contains the requirement key) |
| 61 | `getByLabel('実際の受領・表示店舗').selectOption('ONSEN_BASE')` | WearWorkspace.tsx:36 (wrapping label, native select, values = StoreId) | B |
| 61 | `getByRole('article',{name:'ウェア貸出 person-1:WEAR_JACKET',exact:true})` toContainText `'返却済み 1'`; `…WEAR_PANTS` toContainText `'未返却 1'` | WearWorkspace.tsx:40 (`<article aria-label={'ウェア貸出 '+key}>`, `返却済み {n} / 未返却 {n}`) | B (count copy format `返却済み 1`) |
| 64 | `getByLabel('受領店舗',{exact:true}).selectOption('ONSEN_BASE')` | CustodyWorkspace.tsx:45 (`aria-label="受領店舗"`) | B |
| 64 | button `'この店舗で返却バッチを開始'`; region `'連続返却バッチ'` visible; `getByLabel('保存済み返却バッチID').inputValue()` | CustodyWorkspace.tsx:45-46 | B |
| 65 | `getByLabel('用品の個体ID',{exact:true}).fill`; button `'入力したIDを照合へ送る'`; `getByRole('status').filter({hasText:'返却候補をサーバーに保存'})` visible | AssetQrInput.tsx:26; message CustodyWorkspace.tsx:31 (`返却候補をサーバーに保存しました。受領は未確定です。`) | B. There are 2 status nodes on the page (AssetQrInput.tsx:26 and CustodyWorkspace.tsx:50); the `filter` is what keeps the locator unique. |
| 66-68 | `evaluate` overrides `navigator.mediaDevices.getUserMedia` with a canvas captureStream; button `'カメラを開く'`; draws a QR; region 連続返却バッチ toContainText `'person-1:SKI'`, then `'UNKNOWN_OR_ALREADY_RECEIVED'`; asserts `syntheticCamera.requests===1`; button `'カメラを止める'`; asserts the track readyState is `['ended']` | AssetQrInput.tsx:20-26 (getUserMedia, `<video>`, `<canvas>`, jsQR); CustodyWorkspace.tsx:48 (`{c.requirement_key} / {c.state}`, `{c.outcome}`) | B. The camera must call getUserMedia exactly once per open and stop the tracks on 止める. A `<video>` element must stay in the DOM (hidden is fine). Raw outcome enum `UNKNOWN_OR_ALREADY_RECEIVED`. |
| 69 | `reload()`; `getByLabel('保存済み返却バッチID').fill`; button `'返却バッチを再開'`; region toContainText `'CANDIDATE'` | CustodyWorkspace.tsx:45, :48 | B (raw state) |
| 70 | `getByLabel('ポールの貸出明細ID').fill`; button `'この貸出のポール1ペアを候補に追加'`; region toContainText `'person-1:POLE'` | CustodyWorkspace.tsx:47 | B |
| 71 | button `'正常な候補をまとめて受領確定'`; after the lost response, button `'同じ保存済み要求を照合'` visible, then reload and click it; region toContainText `'RECEIVED'` | CustodyWorkspace.tsx:48, :50 (pending persisted in sessionStorage key `zao-custody-pending-v1`, l.15) | B |
| 73 | `expect(getByLabel('受領店舗',{exact:true})).toHaveValue('ONSEN_BASE')` (after reload) | CustodyWorkspace.tsx:45 | B (store state survives reload) |
| 73 | button `'保存済み返却作業を読込'` | CustodyWorkspace.tsx:45 | B |
| 73 | `getByText('person-1:SKI / 受領済み・検品待ち',{exact:true})` visible | CustodyWorkspace.tsx:49 (`<p>{r.requirement_key} / {…'受領済み・検品待ち'}</p>`) | **B/P, high risk.** The exact full text of a single element is required. Splitting it into spans or a badge, or changing the separator ` / `, breaks it. |
| 73 | `getByLabel('実際に行った検品記録').fill`; button `'検品完了 '+loanItemId` exact | CustodyWorkspace.tsx:49 (name contains the raw UUID) | B |
| 73 | `getByText('person-1:SKI / 検品済み（契約日・当日ブロックは維持）',{exact:true})` | CustodyWorkspace.tsx:49 | B/P (same risk) |
| 75 | `screenshot('.local/screenshots/custody-desktop.png', fullPage)`; `setViewportSize(390×844)`; `evaluate(scrollWidth<=innerWidth)` (no +1 tolerance); `screenshot('custody-mobile-width.png')` | `/staff/rental` | P (evidence) / B (no overflow at 390) |
| 81 | after revocation, button `'保存済み返却作業を読込'` → heading `'セッションを確認してください'` | StaffSessionBoundary.tsx:21 | B |
| 84 (catch) | `page.getByRole('alert').allTextContents()` (diagnostic only) | — | — |

---

## 3. tests/wear/normal-ui.ts (`npm run test:wear-ui`, tests/flow-app)

**Context:** 1280×960 (l.18), timeout 15 s.

**Routes:** `/staff/login`, `/staff/ledger`, `/staff/logout`, `/staff/quotes`, `/preview/integrated` (l.26, 51, 74), `/preview/rental` via link, `/staff/wear` (l.32, 59).

**Route mocks:** `**/api/wear/receive` (l.33) and `**/api/wear/return-batch-confirm` (l.41), both fetch-then-abort.

**Response-waits:** POST `/api/wear/transfer-ready` → 200 (l.44); POST `/api/wear/receive` → 200 (l.62).

**Direct API calls:**
- POST `/api/holds` → 201 with `result:'CREATED'` (l.70)
- POST `/api/quotes` → 201 with `items[0].productKey==='SKI_POLES_ONLY_ADULT_STANDARD'`, `totalJpy 6500`, `bundleDiscountJpy 0` (l.70)
- GET `/api/wear/pools` anonymous → 401; POST `/api/wear/unresolved` without origin → 403, with actor → 422, after revoke → 403 (l.81)

| Test line | Locator / assertion | Producer | Class / risk |
|---|---|---|---|
| 19, 21, 23 | H-LOGIN, H-LOGOUT-PAGE, H-PRICE-INIT | §0.2 | B |
| 26 | `'利用開始日'`/`'利用終了日'` exact fill; `'競技 1'` selectOption `'WEAR'`; `'利用開始時の年齢区分 1'`; `'上サイズ 1'`/`'下サイズ 1'` selectOption | RecommendationWorkspace.tsx:42-43, :65 (`WEAR` option exists only when `integrated`) | B |
| 26 | `assert.equal(await getByLabel('身長cm 1',{exact:true}).count(),0)` | RecommendationWorkspace.tsx:43 (`m.sport!=='WEAR'&&…`) | B (WEAR hides body fields) |
| 27 | `'推薦候補を確認'` | :48 | B |
| 27 | `getByText('選択期間の参考総額',{exact:false})` visible | RecommendationWorkspace.tsx:72 (`<p>選択期間の参考総額 <strong>…</strong></p>`) | P/B. getByText is strict: if the copy appears in more than one element (e.g. one card per direction), the locator fails. |
| 27 | `getByText('小物は含みません。',{exact:false})` visible | RecommendationWorkspace.tsx:72 | **P (decorative copy) with strict-mode risk** |
| 27 | `'おすすめを選ぶ 1'`, model-policy checkbox, `'全員分をHOLDして見積を保存'`, region `'見積詳細'` exact | :50, :51, :54 | B |
| 27 | `setViewportSize(390×844)`; `evaluate(scrollWidth<=innerWidth)`; `screenshot('.local/screenshots/wear-selection-mobile-width.png', fullPage)` | /preview/integrated | B (overflow) / P |
| 28 | link `'予約情報・決済結果へ'`; `'合成氏名'`, `'架空メール宛先'`, terms checkbox, button `'合成予約情報を保存'` exact; region `'開発予約詳細'` contains `'DRAFT'`; button `'テストアダプタへ照合要求'`; region contains `'CONFIRMED_DEV'` | BookingWorkspace.tsx:25-27 | B |
| 28 | `getByLabel('開発予約QR')` visible | BookingWorkspace.tsx:12 (`<canvas aria-label="開発予約QR">`) | B (QR canvas aria-label) |
| 29 | DB: `totalJpy 5000`, product `WEAR_SET`, `chargeReady false`, 0 inventory claims | — | B |
| 32 | `/staff/wear`; `'予約番号'` exact fill; `'貸出を読込'` exact; `getByText('照合済み予約 '+bookingId,{exact:false})` visible | WearWorkspace.tsx:38 (`<p>照合済み予約 {id} / {state} / 版 …</p>`) | B/P (copy prefix) |
| 32 | `'ウェア数量を貸出記録'` exact; `'1着を受領：person-1:WEAR_JACKET'` exact; `getByLabel('実際の受領・表示店舗').selectOption('ONSEN_BASE')` | WearWorkspace.tsx:38, :40, :36 | B |
| 33 | lost-response flow → button `'同じ保存要求を照合'` exact visible → reload → click; `getByRole('status')` (**page-wide**) toContainText `'保存済み'` | WearWorkspace.tsx:43 (pending button + `<p role="status">`), message l.33 `保存済み。返却と再貸出可能性は別の状態です。`; sessionStorage key `zao-wear-quantity-pending-v1` (l.15) | B. There must be exactly one `role=status` on `/staff/wear`. |
| 33 | article `'ウェア貸出 person-1:WEAR_JACKET'` exact contains `'返却済み 1'`; `…WEAR_PANTS` contains `'未返却 1'` | WearWorkspace.tsx:40 | B |
| 37 | `getByRole('button',{name:/^洗浄開始：/})`; `{name:/^実際の乾燥・検品完了を記録：/}` | WearWorkspace.tsx:42 (`{label}：{r.id.slice(-6)}`) | B (prefix anchored; strict, one receipt) |
| 37 | `getByText(/Central Station \/ 1着 \/ TODAY_BLOCKED/)` | WearWorkspace.tsx:42 (`{store} / {q}着 / {r.state} / 同日保護の解除日 …`) | **B/P, high risk.** The exact separator format and raw enum `TODAY_BLOCKED` are required in one element. |
| 37 | `getByText(/同日保護の解除日 2035-01-06/)` | WearWorkspace.tsx:42 (same `<p>`) | B/P |
| 37 | button `/^翌日以降のREADY反映：/`; status toContainText `'SAME_DAY_REHIRE_BLOCKED'` | WearWorkspace.tsx:42; error message `'拒否：'+code` l.33 | B (raw error code shown) |
| 37 | `setViewportSize(1280×960)` + `screenshot('wear-return-desktop.png')`; `390×844` + `evaluate(scrollWidth<=innerWidth)` + `screenshot('wear-return-mobile-width.png')` | `/staff/wear` | P / B |
| 40 | button `'返却候補へ追加：person-1:WEAR_PANTS'` exact; region `'保存した返却候補'` contains `'CANDIDATE'`; `getByLabel('返却バッチ番号').inputValue()` | WearWorkspace.tsx:40-41 | B |
| 40 | reload; store select; button `'前回のバッチ番号を復元'` exact; `'保存した候補を再読込'` exact; region contains `'CANDIDATE'` | WearWorkspace.tsx:41 | B |
| 41 | button `'候補の数量をまとめて返却確定'` exact; lost response → `'同じ保存要求を照合'`; region contains `'RECEIVED'` | WearWorkspace.tsx:41, :43 | B |
| 44 | `'対象サイズの数量プール'` selectOption(pool id); `'数量操作の理由'` fill; `'17時便の予定日'` fill; button `'もう一方の店舗への移動を計画'` exact; status contains `'保存済み'`; button `'この店舗の数量移動を再読込'` exact | WearWorkspace.tsx:43 | B |
| 44 | button `/^実際に発送：/`; status contains `'DEPARTURE_NOT_READY'`; `getByRole('article',{name:/^数量移動 /})` contains `'IN_TRANSIT'`; button `/^実際に受領：/`; button `'受領分の実READY確認：1着'` exact | WearWorkspace.tsx:43 (`aria-label={'数量移動 '+t.id}`, raw `{t.state}`) | B (raw enums) |
| 51 | `'利用区分'` exact selectOption `'MULTIDAY'` | RecommendationWorkspace.tsx:42 | B |
| 52 | loop n=1..20: `'利用者を追加'` exact; `'利用開始時の年齢区分 n'`, `'クラス n'`, `'指定モデル・シーズン n'`, `'身長cm n'`, `'足サイズcm n'`, `'体重kg n'`, `'利用開始時の年齢 n'`, `'レベル n'`, `'ポールのサイズ n'`, `'ウェア上下セットを追加 n'`, `'上サイズ n'`, `'下サイズ n'` | RecommendationWorkspace.tsx:43-47, :63-66 | B (index-suffixed labels for each of 20 members) |
| 53 | `'利用者を追加'` toBeDisabled at 20 | RecommendationWorkspace.tsx:47 (`disabled={members.length>=20}`) | B |
| 53 | `getByRole('article',{name:'利用者 20 の候補',exact:true})` visible, contains `'2026/27'` and `'写真は準備中'` | RecommendationWorkspace.tsx:50 (aria-label), :72 (`モデル写真は準備中。…`, season) | B / P (`写真は準備中` is copy) |
| 53 | `'おすすめを選ぶ n'` exact ×20 | :50 | B |
| 54 | button `'保存結果を再読込'` exact; region 見積詳細 visible; `evaluate(scrollWidth<=innerWidth)` (viewport still 390) | RecommendationWorkspace.tsx:55 | B |
| 58 | booking form plus payment (as l.28) | BookingWorkspace | B |
| 59 | `getByRole('article',{name:/^ウェア貸出 /})` toHaveCount(40) | WearWorkspace.tsx:40 | B |
| 60 | button `'この店舗の返却作業を読込'` exact; `getByLabel('予約不明ウェアのサイズ').selectOption`; `'数量操作の理由'`; button `'予約不明として受領記録（READYへ加算しない）'` exact; region `'予約不明の隔離記録'` contains the reason text | WearWorkspace.tsx:43 | B |
| 62 | button `'この貸出との数量一致を確認：person-1 / person-1:WEAR_JACKET'` exact; region `not.toContainText('unidentified M garment')` | WearWorkspace.tsx:43 (`…：{l.member_key} / {l.requirement_key}`) | B |
| 64 | button `/^バッチを選択：/` (strict, exactly one) | WearWorkspace.tsx:43 | B |
| 74-77 | `'競技 2'` `'SNOWBOARD'`; `expect(getByLabel('ウェア上下セットを追加 2',{exact:true})).not.toBeChecked()`; `getByLabel('体重kg 2').count()===0`; member 3 `'WEAR'`, `getByLabel('身長cm 3').count()===0` | RecommendationWorkspace.tsx:43, :46, :63 | B |
| 78 | DB: 4 quote items, `totalJpy 24000`, items per member `[5,2,2]`, `bundleDiscountJpy 1000`; `evaluate(scrollWidth<=innerWidth)`; `getByRole('region',{name:'見積詳細',exact:true}).screenshot('.local/screenshots/wear-mixed-quote-mobile-width.png')` | RecommendationWorkspace.tsx:54 | B / P |
| 84 (catch) | `getByRole('status').textContent()` (diagnostic) | — | — |

---

## 4. tests/transfer/normal-ui.ts (`npm run test:transfers-ui`, apps/web built)

**Contexts:** 1280×960 (l.15), timeout 10 s.

**Routes:** `/staff/login` → `/staff/ledger`, `/staff/users` (l.20), `/staff/transfers` (l.24, l.45), then logout to `/staff/login` (l.45).

**Route mocks:** `origin+'/api/transfers'` POST fetch-then-abort (l.25). It reads `postDataJSON().requestKey`, `batch.id` and `batch.pieces[0].id`.

**Direct API calls:**
- GET `/api/transfers`: anonymous → 401, default admin → 403 (l.19), after logout → 401 (l.45)
- POST `/api/transfers/<id>/receive` with no origin or a bad origin → 403 (l.43)
- POST `/<id>/ready` with a `role` field → 422 (l.44)

| Test line | Locator / assertion | Producer | Class / risk |
|---|---|---|---|
| 16, 45 | H-LOGIN; H-LOGOUT-LINK (`link 'ログアウト'` exact) + `'ログアウトする'` | TransferWorkspace.tsx:29; StaffLogout.tsx:6 | B |
| 20 | H-STAFF-CREATE: labels `'表示名'`, `'メールアドレス'`, `'初期パスワード（15〜128文字）'`, store checkboxes `'Mountain Station'`/`'Central Station'`, permissions `'店舗間移動の閲覧'`, `'移動計画の確保・取消'`, `'元店舗からの発送'`, `'移動先での受領・準備完了'` → `'allow'`; heading `'合成移動担当'` exact | StaffManagement.tsx:13-18 | B |
| 24 | `getByRole('heading',{name:'店舗間の移動',exact:true})` | TransferWorkspace.tsx:29 `<h1>店舗間の移動</h1>` | B/P (page title exact) |
| 24 | `getByLabel('元店舗',{exact:true}).selectOption('MOUNTAIN_BASE')`; `getByLabel('移動先',{exact:true}).selectOption('ONSEN_BASE')` | TransferWorkspace.tsx:31 (`aria-label`) | B |
| 24, 36 | `getByLabel('17時便の日付').fill`; `getByLabel('準備完了の見込み（日本時間）').fill('2033-01-01T19:00')`; `getByLabel('必要期限（日本時間）').fill(...)`; `getByLabel('計画根拠・運搬と準備の確認').fill` | TransferWorkspace.tsx:31 (native `date` / `datetime-local`) | B. The input types must stay native, because `fill` uses ISO strings. |
| 24, 36 | `getByLabel('対象用品',{exact:true}).selectOption(fid(1201)/fid(1301))` | TransferWorkspace.tsx:31 (option value = asset/pole id) | B |
| 26, 36, 40 | `getByRole('button',{name:'計画を確保する',exact:true})` | TransferWorkspace.tsx:32 | B |
| 26 | `getByRole('button',{name:'同じ要求を照合・再送'})` visible → reload → `'計画を確保する'` toBeDisabled → click 照合・再送 | TransferWorkspace.tsx:33; disabled via fieldset `blocked` l.31; sessionStorage `zao-rental-transfer-pending-v1` l.12 | B. The disabled state must come from the fieldset (or equivalent) while a pending request exists. |
| 26, 29, 30 | `getByRole('region',{name:'移動詳細'})` toContainText id / `'IN_TRANSIT'` / `'RECEIVED'` / `'CLOSED'` | TransferWorkspace.tsx:35 (`<section aria-label="移動詳細">`, `{selected.id} / {selected.state}`, piece label `CLOSED（準備完了・移動保護終了）`) | B (raw enums) |
| 29 | button `'計画の全品を実発送'` exact | TransferWorkspace.tsx:37 | B |
| 29, 30 | `getByRole('button',{name:new RegExp(id.slice(0,8))})` (list item) | TransferWorkspace.tsx:34 (`… · {b.state} · {b.id.slice(0,8)}`) | B. The button name must contain the first 8 chars of the UUID, and only one button may contain it. |
| 30 | `getByLabel('移動明細 '+pieceId,{exact:true}).check()`; buttons `'選択分を実受領'`, `'選択分の準備完了'` exact | TransferWorkspace.tsx:35 (`aria-label={'移動明細 '+p.id}`), :37 | B |
| 32 | `screenshot('.local/screenshots/e07-transfer-desktop.png')`; 390×844 + `evaluate(scrollWidth<=innerWidth)` + `screenshot('e07-transfer-mobile-width.png')` | — | P / B |
| 36 | `getByLabel('ポール数量（ペア）',{exact:true}).fill('3')` | TransferWorkspace.tsx:31 (shown only when family POLE) | B |
| 36 | `getByRole('region',{name:'ポール数量明細'})` toContainText `'計画 3 ペア'`, `'運搬中 3'`, `'運搬中 2 / 検品待ち 1'`, `'準備完了 1'` | TransferWorkspace.tsx:36 (`計画 {n} ペア / 運搬中 {n} / 検品待ち {n} / 準備完了 {n}`) | **B/P, high risk.** The exact counter copy and ` / ` separators are asserted. Splitting the counts into separate cells or chips breaks `'運搬中 2 / 検品待ち 1'`. |
| 36 | `getByLabel('今回のポールペア数').fill('1')`; buttons `'ポール数量を実受領'`, `'ポール数量の準備完了'` exact | TransferWorkspace.tsx:36 | B |
| 37 | `screenshot('e07-pole-partial-mobile-width.png')` (390) | — | P |
| 40 | `evaluate` stubs `Storage.prototype.setItem` to throw; click `'計画を確保する'`; `getByRole('status')` (**page-wide**) toContainText `'変更停止'`; 0 POSTs | TransferWorkspace.tsx:23 (setStorageBlocked), :33 (`保存領域を確認できないため変更停止。`) | B. Exactly one status element on the page. |
| 45 | after logout, goto `/staff/transfers` → `getByRole('heading',{name:'店舗間移動の利用権限が必要です'})` | app/staff/transfers/page.tsx:5 | B |
| 48 (catch) | `getByRole('status').textContent()`, `screenshot('e07-failure.png')` (diagnostic) | — | — |

---

## 5. tests/inventory/normal-ui.ts (`npm run test:holds-ui`, apps/web built)

**Contexts:** 1280×960 (l.15), timeout 10 s.

**Routes:** `/staff/login` → `/staff/ledger`, `/staff/users`, `/staff/holds` (l.26, 35, 67), logout.

**Route mocks:** `origin+'/api/holds'` and `origin+'/api/holds/<id>/amend'` POST, fetch-then-abort (l.44-49).

**Direct API calls:**
- `/api/holds`: anonymous → 401, admin → 403 (l.21)
- reserve payload: anonymous → 401, editor → 403 (l.66); after grant, empty reason → 422 and other store → 403 (l.70-71); after revoke → 403 (l.76)
- PATCH `/api/staff-users/<id>` → 200 (l.68, l.84)
- CSRF → 403; forged `role`/`owner_id`/`expiresAt` → 422; foreign store → 403; `x-role` header spoof → 403 (l.80-85)

| Test line | Locator / assertion | Producer | Class / risk |
|---|---|---|---|
| 16, 35 | H-LOGIN; H-LOGOUT-LINK (`link 'ログアウト'` exact) + `'ログアウトする'` | HoldWorkspace.tsx:56; StaffLogout.tsx:6 | B |
| 22 | H-STAFF-CREATE: `'表示名'`, `'メールアドレス'`, `'初期パスワード（15〜128文字）'`, `'Mountain Station'`, `'期間在庫・自分のHOLD閲覧'`, `'自分のHOLD取得・変更'` → allow; heading `'合成HOLDスタッフ'` exact | StaffManagement.tsx | B |
| 26, 85 | `getByRole('heading',{name:'期間在庫と仮押さえ',exact:true})` visible (l.26) / toHaveCount(0) after the session ends (l.85) | HoldWorkspace.tsx:56 `<h1>` | B/P |
| 26, 33, 38, 43, 72 | `getByLabel('開始日',{exact:true}).fill`, `getByLabel('最終日',{exact:true}).fill` | HoldWorkspace.tsx:58 (`<label>開始日<input type="date">`) | B. These are exact short labels; renaming to `利用開始日` breaks them. |
| 27, 39, 72 | `getByLabel('1人目 スキー（1ペア）',{exact:true}).selectOption(variantId)`; `'1人目 スキーブーツ（1足）'`; `'1人目 ポール（1ペア）'` | HoldWorkspace.tsx:61 (`<select multiple aria-label={\`${i+1}人目 ${names[family]}\`}>`), names l.23 | B. Native `<select multiple>`; selectOption of one value. |
| 28, 33 | button `'在庫を照会'` exact; `getByRole('status')` (page-wide) toContainText `'確保できる見込み'` | HoldWorkspace.tsx:65; messages l.24 `FEASIBLE:'全員・全構成品を確保できる見込みです（参考値）'`; status l.69 | B. One status on the page. |
| 28, 50, 62, 73 | button `'グループを仮押さえ'` exact; status contains `'グループ全体の仮押さえを取得'` | HoldWorkspace.tsx:65 (`{selected?'条件を一括変更':'グループを仮押さえ'}`), messages l.24 `CREATED` | B |
| 30 | `screenshot('.local/screenshots/e06-hold-desktop.png')`; 390×844 + `evaluate(scrollWidth<=innerWidth)` + `screenshot('e06-hold-mobile-width.png')` | — | P / B |
| 33, 35 | `getByRole('button',{name:new RegExp(holdId.slice(0,8))})` click; toContainText `'RELEASED'` (l.35) | HoldWorkspace.tsx:70 (`{start} · {slot} · {state} · {id.slice(0,8)}`) | B (id prefix and raw state in the list button) |
| 33, 34, 52, 58, 73 | `getByRole('region',{name:'HOLD詳細'})` toContainText `'ACTIVE'`, `'RELEASED'`, recoveredId, `'予備在庫利用'` | HoldWorkspace.tsx:69 (`<section aria-label="HOLD詳細">`, `在庫枠：{…'予備在庫利用'} / 状態：{state}`, `記録ID：{id}`) | B (raw enums) |
| 33 | button `'条件を一括変更'` exact; status contains `'一括変更'` | HoldWorkspace.tsx:65, messages `AMENDED:'仮押さえ条件を一括変更しました'` | B |
| 34, 58, 76 | button `'仮押さえを取り消す'` exact | HoldWorkspace.tsx:65 | B |
| 38, 61, 72 | button `'新しい要求'` exact; toBeDisabled (l.51, l.62) | HoldWorkspace.tsx:65 (`disabled={blocked}`) | B |
| 50-52 | `'同じ要求を照合・再送'` visible; after reload still visible; `'グループを仮押さえ'` and `'新しい要求'` disabled; click; then `toHaveCount(0)` | HoldWorkspace.tsx:68 | B |
| 56 | `evaluate(()=>sessionStorage.getItem('zao-rental-hold-pending-v1'))===null` | HoldWorkspace.tsx:13 | B (storage key contract) |
| 62 | Storage.setItem throws → status contains `'変更を停止'`; 0 POSTs | HoldWorkspace.tsx:36 `要求の保存を確認できないため変更を停止しました。` | B |
| 67, 69, 73, 76 | `getByLabel('予備在庫を使用する / Use reserve inventory')` toHaveCount(0) / visible / `.check()` | HoldWorkspace.tsx:64 (`canOverride&&…`, checkbox inside label) | B. Exact bilingual label text. |
| 73 | `'グループを仮押さえ'` disabled until a reason is given; `getByLabel('予備在庫の利用・解除理由').fill` | HoldWorkspace.tsx:64-65 | B |
| 75 | button `'施設全体の在庫枠を表示'`; `getByRole('region',{name:'施設全体の在庫枠'})`; for `['稼働在庫','一般販売枠','一般確保','予備利用','一般残数','稼働残数']`: `summary.getByRole('columnheader',{name,exact:true})` visible; `summary.locator('input')` toHaveCount(0) | HoldWorkspace.tsx:66-67 (`<table><thead><th>…`) | **B/P.** Must remain a real `<table>` with `<th>` column headers (columnheader role). A card or grid redesign breaks it. It must contain no `<input>` elements (read-only). |
| 85 | `evaluate(dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})))` → heading `'セッションを確認してください'` | StaffSessionBoundary.tsx:15-21 | B |

---

## 6. tests/pricing/normal-ui.ts (`npm run test:quotes-ui`, apps/web built)

**Contexts:** 1280×960 (l.15), timeout 10 s.

**Routes:** `/staff/login` → `/staff/ledger`, `/staff/users` (l.19), `/staff/quotes` (l.23, 26, 42), logout.

**Route mocks:** `origin+'/api/quotes'` POST fetch-then-abort (l.27).

**Direct API calls:**
- `/api/quotes/catalog` anonymous → 401; `/api/quotes` bootstrap → 403 (l.19)
- POST `/api/holds` → 201 (l.36)
- GET `/api/holds/<id>` `expiresAt` unchanged (l.36)
- `/api/quotes` with no origin → 403; with `totalJpy` → 422; other store → 403; another user's quote → 403 (l.39)
- after logout → 401 (l.42); admin GET `/api/quotes` → 200 with length 0 (l.42); after deny → 403 (l.43)

| Test line | Locator / assertion | Producer | Class / risk |
|---|---|---|---|
| 16, 42 | H-LOGIN; H-LOGOUT-LINK + `'ログアウトする'` | QuoteWorkspace.tsx:39 | B |
| 20 | H-STAFF-CREATE with `getByLabel('Role',{exact:true})`, `getByLabel('店舗範囲',{exact:true})`, permissions `'自分の非公開見積閲覧'`, `'自分の非公開見積作成'`, `'期間在庫・自分のHOLD閲覧'`, `'自分のHOLD取得・変更'`, `'料金版の設定（全店ADMINのみ）'`; headings `'合成料金管理'`, `'合成見積担当'` exact | StaffManagement.tsx:14-18 | B |
| 23 | H-PRICE-INIT (`料金版` contains `PRIVATE_AVAILABLE`) | QuoteWorkspace.tsx:40-41 | B |
| 26 | heading `'非公開の料金・見積'` exact | QuoteWorkspace.tsx:39 `<h1>` | B/P |
| 26, 32, 36 | `getByLabel('利用開始日',{exact:true})`, `('利用終了日',{exact:true})` fill; `getByLabel('利用区分',{exact:true}).selectOption('AM'/'MULTIDAY')` | QuoteWorkspace.tsx:42 | B |
| 26, 32 | `getByLabel('スキーのサイズ 1',{exact:true})`, `('スキーブーツのサイズ 1')`, `('ポールのサイズ 1')` selectOption(variantId); `('スキーのサイズ 2')` | QuoteWorkspace.tsx:43 (`aria-label={names[family]+'のサイズ '+(index+1)}`; names l.17 `SKI:'スキー'`, `SKI_BOOT:'スキーブーツ'`, `POLE:'ポール'`) | B |
| 26 | `getByLabel('早割5％の適用見込みを確認').check()` | QuoteWorkspace.tsx:44 | B |
| 28, 32, 36 | button `'見積を作成して保存'` exact | QuoteWorkspace.tsx:44 | B |
| 28 | `'同じ要求を照合・再送'` → reload → click | QuoteWorkspace.tsx:46; sessionStorage `zao-rental-quote-pending-v1` l.16 | B |
| 28, 32, 33, 36, 42 | `getByRole('region',{name:'見積詳細'})` toContainText `'5,320 円'`, quoteId, `'24,800 円'`, `'5,320 円'`, `'7,500 円'` | QuoteWorkspace.tsx:48 (`{n.toLocaleString()} 円`, with a space before 円) | **B (price format).** Exactly `5,320 円` (ja-JP grouping + half-width space + 円). Switching to `¥5,320` or `5,320円` breaks the test. |
| 29 | `screenshot('e08-quote-desktop.png')`; 390×844 + `evaluate(scrollWidth<=innerWidth)` + `screenshot('e08-quote-mobile-width.png')` | — | P / B |
| 32 | button `'利用者を追加'` (non-exact); `getByLabel('商品 2',{exact:true}).selectOption('SKI_EQUIPMENT_ONLY_ADULT_REGULAR')` | QuoteWorkspace.tsx:43 (option value = product key) | B |
| 33, 42 | `getByRole('button',{name:new RegExp(quoteId.slice(0,8))})` | QuoteWorkspace.tsx:47 (`{id.slice(0,8)} · {total} 円 · {validity}`) | B |
| 36 | `getByRole('button',{name:'HOLD '+h.id,exact:true})` | QuoteWorkspace.tsx:45 | B (exact `HOLD <uuid>`) |
| 36 | `getByRole('status')` (page-wide) toContainText `'HOLD_CONDITIONS_MISMATCH'` | QuoteWorkspace.tsx:46 (raw error code in the message) | B. The raw error code must stay visible. Humanized errors break this check. |
| 43 | `bp.getByRole('button',{name:'スタッフを編集：合成見積担当'})`; `getByRole('form',{name:'スタッフ更新'})`; `form.getByLabel('自分の非公開見積閲覧',{exact:true}).selectOption('deny')`; save; `expect(form).toHaveCount(0)` | StaffManagement.tsx:12, :14, :17, :18 | B |
| 43 | `next.reload()` → heading `'見積の利用権限が必要です'` | app/staff/quotes/page.tsx:5 | B |
| 46 (catch) | `getByRole('status').textContent()`, `screenshot('e08-failure.png')` (diagnostic) | — | — |

---

## 7. tests/notification/normal-ui.ts (`npm run test:notification-ui`, apps/web built)

**Contexts:** `viewport {390,900}` (l.28), timeout 15 s.

**External-request guard (l.28, l.40):** every context routes `**/*` and **aborts and counts** any request that is not to `origin+'/'` and not a `data:` URL. l.40 asserts `external===0`. B, **critical for the redesign:** any external font (Google Fonts `<link>`), CDN script, image, analytics or icon CDN loaded on `/staff/login`, `/staff/ledger` or `/admin/notifications` fails this suite. `next/font` self-hosting is fine.

**Routes:** `/staff/login` → `waitForURL(origin+'/staff/ledger')` (l.29, l.38); `/admin/notifications` (l.34, 37, 38); `/staff/ledger` (l.40).

**Route mocks:** `**/api/operations/notification-resend` fetch(200)-then-abort (l.35).

**Direct API calls:**
- `/api/operations/notifications?store=MOUNTAIN_BASE`: anonymous → 401 (l.37), viewer → 403 (l.38), after logout → 401 via `expect.poll` (l.40)
- resend without origin → 403 (l.37); viewer to another store → 403 (l.38)

| Test line | Locator / assertion | Producer | Class / risk |
|---|---|---|---|
| 29, 38 | H-LOGIN (inline) | StaffLogin.tsx:12 | B |
| 34, 37 | button `'通知状態を読み込む'` | components/NotificationWorkspace.tsx:11 | B |
| 34, 37 | `getByRole('region',{name:'通知一覧'})` toContainText `'SENT'` (l.34) / `'PENDING'` (l.37) | NotificationWorkspace.tsx:11 (`<section aria-label="通知一覧">`, `状態: {d.status}`) | B (raw status enums) |
| 34 | `!(await page.content()).includes('synthetic-ui@example.invalid')` | — (NotificationWorkspace shows no recipient email) | B (privacy). The redesign must never render the guest email, including in hidden DOM, `title` attributes or data attributes. |
| 35 | `getByRole('button',{name:'再送を依頼',exact:true})` click ×2 (strict: exactly one row button) | NotificationWorkspace.tsx:11 | B |
| 35 | `getByRole('status')` (page-wide) toContainText `'未確認'`, then `'保存しました'` | NotificationWorkspace.tsx:10 (`受付結果は未確認です…` / `再送要求を保存しました…`), status l.11 (`{message&&<p role="status">}`) | B. One status element only; the StaffSessionBoundary checking status disappears once the session is ready. |
| 37 | for widths `[390,768,1440]`: `setViewportSize({width,height:900})`, goto, load, region contains `'PENDING'`, `evaluate(scrollWidth<=innerWidth)` | /admin/notifications | B (overflow at 3 widths) |
| 38 | viewer: `getByRole('button',{name:'再送を依頼',exact:true})` toHaveCount(0) | NotificationWorkspace.tsx:11 (`canResend&&…`) | B |
| 40 | on `/staff/ledger`: `getByRole('button',{name:'ログアウト',exact:true}).click()` | StaffLedger.tsx:9 (`<button>ログアウト</button>`) | B. This must stay a **button** with exact name ログアウト on the ledger toolbar. |
| — | No screenshots in this file. | | |

---

## 8. Cross-cutting notes for the redesign

1. **Raw enum/state strings rendered in the UI are asserted verbatim:**
   - `CONFIRMED_DEV`, `DRAFT`, `OUT`, `CANDIDATE`, `RECEIVED`, `UNKNOWN_OR_ALREADY_RECEIVED`
   - `IN_TRANSIT`, `CLOSED`, `ACTIVE`, `RELEASED`
   - `PRIVATE_AVAILABLE`, `TODAY_BLOCKED`, `SENT`, `PENDING`
   - error codes `SAME_DAY_REHIRE_BLOCKED`, `DEPARTURE_NOT_READY`, `HOLD_CONDITIONS_MISMATCH`

   Translating them into friendly Japanese labels is a copy change that breaks custody, wear, transfer, inventory, pricing and notification. Staff Home is the exception: it already maps enums to labels, and its tests assert the Japanese labels (`確定済み`, `決済照合待ち`, `準備`, `返却受付`, `検品待ち`, `検品`, `詳細確認`, `要注意`).
2. **Page-wide `getByRole('status')` strictness** applies on:
   - `/staff/wear` (wear:33, 37, 44)
   - `/staff/transfers` (transfer:40)
   - `/staff/holds` (inventory:28, 33, 62)
   - `/staff/quotes` (pricing:36)
   - `/admin/notifications` (notification:35)

   Adding a second `role="status"` (e.g. a toast region or a global "saving" indicator) on these pages causes strict-mode failures. Staff Home (`/staff`) and `/staff/rental` scope status by region or filter.
3. **Accessible-name construction templates** must be preserved:
   - `'{label}へ進む'`
   - `'{dir}を選ぶ {n}'`
   - `'1着を受領：{requirementKey}'`
   - `'返却候補へ追加：…'`
   - `'検品完了 {loanItemId}'`
   - `'移動明細 {pieceId}'`
   - `'ウェア貸出 {key}'`
   - `'数量移動 {id}'`
   - `'利用者 {n} の候補'`
   - `'HOLD {id}'`
   - `'スタッフを編集：{name}'`
   - `'{n}人目 {family}'`
   - `'{family}のサイズ {n}'`
   - `'競技 {n}'` etc.
   - list buttons that contain `id.slice(0,8)`
4. **Native controls are assumed:**
   - `selectOption` on `<select>`, including `<select multiple>` in HoldWorkspace, with raw values: StoreId, variant UUID, `SKI`/`WEAR`/`SNOWBOARD`, `ADULT`, `PREMIUM`, `BEGINNER`, `MULTIDAY`/`AM`, `allow`/`deny`, `ADMIN`/`STAFF`, `ALL`/`ASSIGNED`, `modelId|season`, product keys.
   - `fill` on `type=date` / `datetime-local`.
   - `check` on native checkboxes.

   Custom comboboxes or date pickers break these calls.
5. **Pending-request recovery depends on sessionStorage keys:**
   - `zao-rental-hold-pending-v1` (asserted directly)
   - `zao-rental-transfer-pending-v1`, `zao-rental-quote-pending-v1`, `zao-custody-pending-v1`, `zao-wear-quantity-pending-v1`, plus `-batch` (all exercised through reload)
   - `Storage.prototype.setItem` throwing must block writes before any POST
6. **Horizontal-overflow checks** (`document.documentElement.scrollWidth <= innerWidth`, with `+1` tolerance only in home-ui):
   - `/staff` at 390 and 1440, plus the CUSTODY_ONLY view at 390
   - `/staff/rental` at 390
   - `/preview/integrated` at 390 (after HOLD, and with 20 members)
   - `/staff/wear` at 390
   - `/staff/transfers` at 390
   - `/staff/holds` at 390
   - `/staff/quotes` at 390
   - `/admin/notifications` at 390, 768 and 1440

   Wide tables or nowrap UUIDs at 390 are a real failure mode. Today, UUID-bearing buttons and `<p>` elements rely on wrapping; `.staff-home{overflow-wrap:anywhere}` is at components/staff-home.css:1.
7. **Screenshots** (≈20 paths under `.local/screenshots/`) are evidence only and never compared with a baseline, so a redesign does not break them.
8. **No keyboard or focus assertions** exist in these seven files, and no getComputedStyle or bounding-box checks.

---

## Riskiest for redesign (top ~10)

1. **`.staff-card` class name** (home-ui.ts:101, 117, 123, 127, 132, 164, 167, 171, 175, 184, 188, 191, 216, 232, 250-254, 278-282, 303-312, 387, 397, 416, 431). It is the only CSS-class locator, and it is used about 30 times. If it is renamed, several `toHaveCount(0)` checks keep **passing vacuously** while positive checks fail.
2. **CUSTODY_ONLY card regex `/^スキー(?!ブーツ)/`** (home-ui.ts:216). The card's textContent must *begin* with the family label (StaffHome.tsx:129). Any leading icon text, chip or reordered card head breaks it.
3. **`<details><summary>その他の管理機能</summary>` click-to-expand** (home-ui.ts:92, 104; StaffHome.tsx:163). Making the links always visible or `open` by default inverts the click and fails the visibility checks. The secondary link names are also matched as **substrings** (`'見積'`, `'店舗間移動'`), so new links containing those words cause strict-mode errors.
4. **Raw enum strings rendered verbatim** in custody, wear, transfer, holds, quotes and notifications (see §8.1). A "friendly label" pass on states or errors breaks most non-home suites.
5. **Exact multi-part text nodes:**
   - `getByText('person-1:SKI / 受領済み・検品待ち',{exact:true})` and `…/ 検品済み（契約日・当日ブロックは維持）` (custody.ts:73; CustodyWorkspace.tsx:49)
   - `/Central Station \/ 1着 \/ TODAY_BLOCKED/` (wear.ts:37; WearWorkspace.tsx:42)
   - `'運搬中 2 / 検品待ち 1'` and `'計画 3 ペア'` (transfer.ts:36; TransferWorkspace.tsx:36)

   Splitting these into badges or columns breaks them.
6. **Price formatting `'5,320 円'` / `'24,800 円'` / `'7,500 円'`** (pricing.ts:28-42; QuoteWorkspace.tsx:48) and StaffHome's `Intl` JPY. The redesign must keep `toLocaleString()+' 円'` in the 見積詳細 region.
7. **Region `aria-label`s on `<section>`:**
   - Staff Home: 本日の業務, 本日の予約, 店舗・営業日, 予約QR・検索, 運用の注意事項
   - Custody: 貸出用品, 連続返却バッチ
   - Quotes and recommendation: 見積詳細, 料金版, 開発予約詳細
   - Holds: HOLD詳細, 施設全体の在庫枠
   - Transfers: 移動詳細, ポール数量明細
   - Wear: 保存した返却候補, 予約不明の隔離記録
   - Notifications: 通知一覧

   Many use substring names, so new similarly named sections cause strict-mode errors.
8. **Single `role="status"` per page or region** (§8.2), and Staff Home's status must be **empty** (`toHaveText('')`) when loaded or empty (home-ui.ts:422; StaffHome.tsx:136). Persistent status copy is not allowed.
9. **Logout control role split:** the ledger uses `<button>ログアウト</button>` (notification.ts:40; StaffLedger.tsx:9), while the Transfer, Hold and Quote headers use `<a>ログアウト</a>` (transfer.ts:45, inventory.ts:35, pricing.ts:42). A unified header component must preserve both roles, or the tests must be updated together.
10. **The 施設全体の在庫枠 table** must stay a `<table>` with `<th>` columnheaders `稼働在庫…稼働残数` and no `<input>` (inventory.ts:75; HoldWorkspace.tsx:67). Separately, the **notification external-request guard** (notification.ts:28/40) fails on any third-party font, CDN or asset added to the login, ledger or notifications pages.
11. (Bonus) **Exact label texts used for `fill`/`selectOption`:**
    - Short labels such as `'開始日'`/`'最終日'` (holds) vs `'利用開始日'` (quotes/recommendation)
    - `'身長cm 1'`
    - `'予約番号'`
    - `'予備在庫を使用する / Use reserve inventory'`
    - `'初期パスワード（15〜128文字）'`

    Adding helper text inside a `<label>` element changes its accessible name and breaks `exact:true` lookups.
12. (Process) `startDevelopmentApp({built:true})` runs `next start apps/web` against the existing `.next`. Staff-home, transfer, inventory, pricing and notification **must be re-run after `npm run build`**, or they silently test the pre-redesign bundle. Custody and wear use `next dev tests/flow-app` and always pick up source changes.
