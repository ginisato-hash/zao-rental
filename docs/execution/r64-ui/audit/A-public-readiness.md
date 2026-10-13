> Historical pre-redesign/WIP audit recovered from Claude. Findings describe that checkpoint, not the final candidate. See TAKEOVER_RECONCILIATION.md and VALIDATION.md for final dispositions and receipts.

# A. Public + readiness browser tests: what they depend on in the UI (read-only audit)

Repo: `/Users/ginisato/Documents/Codex/2026-10-03/files-pasted-by-the-user-zao/work/f2`. No files were edited and nothing was run.
Line refs: `T:` = the test file under audit. `W:` = `apps/web/src/...`. `C:` = `config/content/...`, `P:` = `packages/...`.

Classification:
- **B** = BEHAVIOURAL. Covers accessible names of controls and actions, form labels the test fills, status/alert semantics, URLs, API/DB results, legal and price numbers, and keyboard/focus contracts. The redesign must keep these exactly.
- **P** = PRESENTATIONAL. Covers class names, CSS selectors, layout coordinates, decorative copy, screenshots and computed style. The redesign may change these only if the test changes with them.
- **B/P** = copy that is visible text, but the test uses it as a semantic hook (role + name, `getByText`, or region contents).

## 0. Common facts (all files except normal-production-ui and worker-continuity)

- **Served app.** `startFlowApp()` (`tests/flow/launcher.ts:59-121`) spawns `next dev tests/flow-app --webpack` on 127.0.0.1 (`launcher.ts:89`).
  - `tests/flow-app/src/app/**` are one-line re-exports of `apps/web/src/app/**` pages, for example `[locale]/book/page.tsx`, `[locale]/reservation/page.tsx`, `[locale]/[[...page]]/page.tsx`, `legal/[doc]`, `rental/premium/[slug]`, `staff/login`, `staff/users`, `staff/content`, `staff/ledger`, `layout.tsx`, `robots.ts`, `sitemap.ts` and `proxy.ts`.
  - Markup and CSS therefore come from apps/web.
- **Exceptions in the flow-app wrapper:**
  - `tests/flow-app/src/app/staff/rental/page.tsx` is a test-only page with its own denial markup. It renders `W:components/CustodyWorkspace.tsx`. apps/web itself serves that component at `/staff/rentals` (plural).
  - `tests/flow-app/src/app/api/guest/[[...record]]/route.ts` wires the **synthetic payment adapter** (`testFlowService`). That is why the "この内容で支払う（開発用決済）" button exists in these tests.
  - `tests/flow-app/next.config.ts` adds `X-Robots-Tag` / `Cache-Control` for `/api/*`.
- **Context defaults:** Chromium, `baseURL=app.origin`, default timeout 15 s. Most contexts use viewport **390×844**; several readiness tests add `hasTouch:true`.
- **Screenshots** are plain `page.screenshot({path:'.local/screenshots/...', fullPage:true})`. They are **evidence only**: there is no `toHaveScreenshot` and no baseline compare. CI uploads `.local/screenshots/` as an artifact (`.github/workflows/ci.yml:36-47`), so the redesign cannot break a pixel diff.
- **Invocation.** All are plain `node --import tsx <file>` scripts (not the Playwright test runner), run from `npm run verify` (`scripts/verify.mjs:10` lists `test:public-ui`, `test:readiness-ui`, `test:activation-p4`, `test:booking-recovery-ui`, `test:production-runtime-ui`), which CI runs (`ci.yml` "Verify implemented foundation").
- **Shared guest-booking happy path.** It is repeated verbatim in guest-ui, booking-access-ui, booking-recovery-ui, cancellation-ui and normal-production-ui. Its labels and buttons are listed once in §1 and referenced afterwards:
  1. `getByLabel('利用開始日',{exact:true})` toBeEnabled / fill
  2. `getByLabel('利用終了日',{exact:true})`
  3. button `'用品を選ぶ'` exact
  4. `getByLabel('ポールのサイズ 1',{exact:true}).selectOption('pole-'+variants.pole)`. The option **value** is the variant key, from `tests/inventory/fixture.ts:7`.
  5. button `'候補と参考料金を確認'` exact
  6. `getByRole('radio',{name:/おすすめ/})`
  7. checkbox `'全員のサイズ・モデル条件・ウェア構成を確認した'`
  8. button `'全員分の最終確認へ'`
  9. checkbox `'合成データによる開発確認であることを確認'`
  10. button `'この内容で支払う（開発用決済）'`
  11. heading `'予約が確認されました'` exact

---

## 1. tests/public/normal-ui.ts (576 lines)

- **Runner:** `npm run test:public-ui` (`package.json:59`, first half; then content-ui.ts). App: flow-app wrapper → apps/web (`startFlowApp({publicP0:true})`, T:19). Main context viewport is 390×844 (T:24).
- **Routes visited:**
  - **Request-only (`context.request.get`):**
    - Status 200: `/staff/login`, `/staff/ledger`, `/staff/users`.
    - `/api/auth/sign-in/email` returns 405; `/api/session`, `/api/staff-users`, `/api/ledger/assets` return 401 (T:27-29).
    - Every `/{ja,en}{'',/rental,/rental/ski,/rental/snowboard,/rental/premium,/rental/wear,/rental/kids-family,/prices,/stores/mountain-base,/stores/onsen-base,/pickup-return,/faq}` (T:31).
    - `/sitemap.xml`, `/robots.txt`, `/ja/book`, `/api/guest/draft`, `/staff/login`, `/ja/rental?date=…&people=20`, and `/en/not-a-page` (404) (T:32-34).
    - `/{locale}/legal/{commercial-disclosure,terms,privacy,cancellation}`, `/ja/legal/not-a-doc` (404), `/ja/faq` (T:38-45).
  - **Browser (`page.goto` / `waitForURL`):**
    - `/ja/rental` (T:35); `/ja` at touch 390×844 and 375×812 (T:49-50), with `waitForURL(/\/ja\/rental\/ski$/)` (T:82); `/ja` at 1440×900 (T:86).
    - `/ja/book` many times; `/en/book` (T:222,342,380,400…).
    - Expected URLs: `toHaveURL(/\/ja\/book$/)` (T:128,243,249,274); `waitForURL(/\/ja\/rental$/)` (T:139); `waitForURL(origin+'/ja')` (T:559).
    - Staff: `/staff/login`, then `waitForURL(origin+'/staff/ledger')` (T:14-16); `/staff/users` (T:568); `/staff/rental` (T:573, flow-app wrapper page).
- **Viewports:** 390×844 (default); 390×844 and 375×812 touch/isMobile (T:48-49); 1440×900 (T:86, T:528-529); visual matrix ja/en × 390/1440 (T:528).

### 1a. SEO / initial HTML (T:30-36). Regexes run on raw SSR HTML.
| T line | dependency (verbatim) | producer | class / redesign risk |
|---|---|---|---|
| 31 | `assert.match(html,/<h1>/)` for all 24 public pages | home: `W:components/PublicChrome.tsx:42` (`<h1><Link…>` + `.pc-sr`); others: `W:components/PublicPage.tsx:27` `<h1>{page.heading}</h1>` | **P but HIGH risk.** The regex needs a **bare `<h1>` with no attributes**. Adding `className`/`id` to any public h1 breaks it, and so does dropping the h1 from home. |
| 31 | `/rel="canonical"/`, `/hrefLang="x-default"/i`, `/application\/ld\+json/`, `/BreadcrumbList/` | canonical/hreflang: `W:lib/public-seo.ts:4` + `P:core/src/content/public-pages.ts:14`; JSON-LD `<script type="application/ld+json">`: `W:components/PublicPage.tsx:20-21,34` (data `public-pages.ts:18`) | B. Keep `generateMetadata` and the JSON-LD `<script>` rendered inside PublicPage. Removing the `{schema}` nodes from home/main breaks it. |
| 31 | unique `<title>` per page | `W:lib/public-seo.ts:4` (`title+' | ZAO Rental'`), titles from `C:public-p0-pages.json` | B (metadata). |
| 31, 33 | header `x-robots-tag` matches `/noindex/` | `W:proxy.ts:3` | B. |
| 32 | `sitemap.xml` has no `<loc>`; `robots.txt` matches `/Disallow: \//` | `W:app/sitemap.ts`, `W:app/robots.ts` | B. |
| 34 | `/en/not-a-page` returns 404 | `W:app/[locale]/[[...page]]/page.tsx:9` | B. |
| 35 | `/ja/rental`: `getByRole('heading',{level:1})` visible | `W:components/PublicPage.tsx:27` | B/P. Exactly one h1 is needed (strict mode). A second h1 (for example in the header pill) on a non-home page breaks it. |
| 35 | `evaluate(()=>document.documentElement.scrollWidth<=innerWidth)` at 390 | layout `W:components/public.css` (`.public-shell{overflow-x:clip}` line 6) | P. No horizontal overflow at 390. |
| 35 | screenshot `.local/screenshots/public-ja-mobile.png` | – | evidence only |

### 1b. Legal pages (T:37-46)
| T line | dependency | producer | class / risk |
|---|---|---|---|
| 38-39 | HTML includes `'株式会社Yuge'`, `'〒990-2301 山形県山形市蔵王温泉973-7'`, `'070-4440-4813'`, `'rentalstation@yuge-zao.com'`, `'利用規約'`, `'Terms of use'`, `'Square'`, `'Resend'`, `'48時間'`, `'48 hours'` | text: `C:public-legal.json` via `P:core/src/content/public-legal.ts:1`; rendered by `W:app/[locale]/legal/[doc]/page.tsx:12-14`. `株式会社Yuge` also appears in the footer `W:PublicChrome.tsx:76`. | B (legal text). The page must keep rendering every section paragraph as text. |
| 41 | `/ja/legal/not-a-doc` returns 404 | `legal/[doc]/page.tsx:11` | B |
| 43 | FAQ HTML includes `href="/ja/legal/{terms,privacy,commercial-disclosure,cancellation}"` | footer legal column `W:PublicChrome.tsx:70,74` from `W:PublicPage.tsx:10` `legalLinks` | B/P. Footer must keep plain `<a href>` legal links on every public page. |
| 44 | FAQ must NOT include `'公開文言・利用規約は公開前確認中です'` | `W:PublicPage.tsx:30` (conditional on `!legalPublicationComplete`) | B |
| 45 | legal HTML matches `/<meta name="robots" content="noindex/` | `W:lib/public-seo.ts:4` | B |

### 1c. P85 home carousel + modal menu (T:47-89). Heaviest CSS and class coupling.
| T line | dependency | producer | class / risk |
|---|---|---|---|
| 49 | touch contexts 390×844 and 375×812, `hasTouch`, `isMobile` | – | – |
| 51 | `document.querySelector('.pc-title-m').textContent`, `.pc-view` `href`, `.pc-slide.is-active` `href` | `W:components/HomeCampaigns.tsx:38` (`p.pc-title-m`), `:40` (`Link.pc-view`), `:30` (`Link.pc-slide` + `is-active`) | **P, HIGH.** Class names are used as state probes. The VIEW link href must equal the active slide href. |
| 52-54 | CDP `Input.dispatchTouchEvent` at **x=width/2, y=420** (swipes of −20/0, −30/160, −140/8, +140/−6 over 150-300 ms) | handlers on `section.pc-hero` `HomeCampaigns.tsx:24-28`; thresholds `:14` (48 px, ratio 1.5, 800 ms) | **P/B, HIGH.** The point (195|187, 420) must lie inside the hero at 390×844 and 375×812. The 48 px / axis-ratio rules are behavioural. |
| 55 | `locator('.pc-title-m')` visible; `locator('.pc-hero').dispatchEvent('mouseenter')` | `HomeCampaigns.tsx:27-28` (`onMouseEnter` → pause) | P (class). Pausing autoplay keeps the state stable during asserts. |
| 57-60 | short or vertical swipe leaves state unchanged; left swipe changes title (and view==slide); right swipe restores | `HomeCampaigns.tsx:24-26` | B |
| 61 | no horizontal scroll | css | P |
| 63 | button `'メニューを開く'` → `getByRole('dialog',{name:'メニュー'})` visible | `W:PublicChrome.tsx:48` (`aria-label`), `:51` (`role="dialog" aria-modal="true" aria-label="メニュー"`) | B |
| 64 | `document.body.style.overflow==='hidden'` while open | `PublicChrome.tsx:28` | B/P. Scroll lock must be an inline body style; a class-based lock fails. |
| 66-68 | `getComputedStyle(.pc-menu).backgroundColor` alpha parsed, contrast of white over a pure-white backdrop ≥ 4.5 (needs alpha ≳ 0.54); `.pc-menu-cats a` color = `rgb(255, 255, 255)`; `.pc-menu-small a` color = `rgb(255, 255, 255)`; `.pc-view` `visibility==='hidden'` | `W:components/public.css:24` (`rgba(0,0,0,.6)`, `color:var(--pc-white)`), `:27`, `:30`, `:136` (`.public-shell:has(.pc-menu) .pc-view{visibility:hidden}`); markup `PublicChrome.tsx:53,55` | **P, HIGHEST.** Exact class names, computed colors, an rgba background and a `visibility` property. Changing the menu palette or hiding the CTA another way (display/opacity) breaks it. |
| 69-72 | `[role="dialog"][aria-modal="true"]` contains `document.activeElement` initially and after 30× Tab and 30× Shift+Tab; `dialog.getByRole('button',{name:'メニューを閉じる'})` visible | focus trap `PublicChrome.tsx:31-35`, close button `:52` | B (keyboard/focus contract). |
| 73 | focusing `.pc-footer a` while open must fail (inert) | `PublicChrome.tsx:29-30`. This inerts the siblings of the panel inside `.public-shell`, so the dialog must be a **direct child of `.public-shell`**. Footer class `:73`. | B + P (class + DOM structure). |
| 74 | `Escape` closes the dialog (count 0) | `PublicChrome.tsx:33` | B |
| 75 | `.pc-view` visibility back to `'visible'` | css `:136` | P |
| 76, 80 | `document.activeElement.getAttribute('aria-label')==='メニューを開く'` | `PublicChrome.tsx:27,48` | **B.** The toggle must carry `aria-label` (visible text alone fails). |
| 77, 80, 82 | `body.style.overflow===''` after close / CLOSE / navigation | `PublicChrome.tsx:37` | B |
| 78 | `.pc-footer a` exists and `.pc-footer.inert===false` | `PublicChrome.tsx:73` | P (class) |
| 79 | open, then dialog button `'メニューを閉じる'` click | `:52` | B |
| 81-82 | dialog `getByRole('link',{name:'SKI',exact:true})` → URL `/ja/rental/ski` | `PublicChrome.tsx:15,53` | B (exact name `SKI`) |
| 86 | 1440×900: `.pc-wheel li[aria-hidden="false"] button` visible | `HomeCampaigns.tsx:34-36` | **P, HIGH.** Needs the literal attribute `aria-hidden="false"`. |
| 87-88 | `.pc-wheel li button` texts: exactly 3, all distinct; exactly 1 `li[aria-hidden="false"]` | `HomeCampaigns.tsx:35` (ROWS filter); 3 campaigns from `W:components/brand/index.ts:23` | P + data (campaign count = 3). |

### 1d. Guest booking wizard (`/ja/book`, `/en/book`). Producer is `W:components/GuestBooking.tsx` unless noted.

Field-label contract (`GuestBooking.tsx:321-323`): "the field name is the label's whole text". The required/optional flag sits outside `<label>`, and selects also carry `aria-label`.

| T line(s) | dependency (verbatim) | producer line | class / risk |
|---|---|---|---|
| 91,102,… | label `'利用開始日'` exact; `toBeEnabled` (waits for fieldset not disabled) / `toHaveValue('')` / `'2035-03-20'` | 332 (`<fieldset disabled={busy\|\|locked}>` 330) | B |
| 91 | label `'利用終了日'` exact | 333 | B |
| 91,425 | label `'利用枠'` exact `.selectOption('MULTIDAY')` (option value) | 334; options 100 (`DAY/AM/PM/MULTIDAY`) | B (values are protocol) |
| 91 | button `'用品を選ぶ'` exact | 336 | B |
| 91,110 | label `'ポールのサイズ 1'` exact, select value `'pole-'+variants.pole`; `toHaveValue` (T:435) | 348 | B |
| 92 | button `'候補と参考料金を確認'` exact | 353 | B |
| 92 | `getByRole('radio',{name:/おすすめ/})` `.check()`; T:155 count **2** | radio inside `label.guest-candidate` 354, label text 268 (`directionLabel`) | B. The radio must be labelled by text containing おすすめ. |
| 92 | `getByLabel('全員のサイズ・モデル条件・ウェア構成を確認した')` check | 355 | B |
| 92 | button `'全員分の最終確認へ'` | 356 | B |
| 92 | `getByRole('region',{name:'全員分の確認'})` toContainText `'全員分の参考総額'` | `section aria-label` 359; dt 367 | B |
| 92 | DB: `inventory_holds` count 0 after review | server | B |
| 92,217,228 | no horizontal overflow at 390 (JA/EN) | `W:components/guest.css` | P |
| 95,214,225 | `locator('dl.guest-price dt')` **toHaveText exact ordered** `['小計','全員分の参考総額']` / `['小計','事前決済調整（見込み）','全員分の参考総額']` / `['Subtotal','Group estimate']` | 367 | **P (element+class) + B (row semantics), HIGH.** A `dl` with class `guest-price` must remain, and its `dt` set must be exactly these labels, in this order. |
| 96-97,215,226-227 | `dl.guest-price` not contains `'ウェア調整'`, `'事前決済調整'`, `'Wear adjustment'`, `'Estimated advance adjustment'` | 367 | B (zero rows hidden) |
| 216 | `dl.guest-price dd` nth(1) non-empty and not `¥0` | 367 | P/B |
| 491,501 | `dl.guest-price dd` `.last()` innerText = old total; later contains `'7,600'` | 367 (`<strong>`) | P/B. The last dd must be the group total. |
| 98 | screenshot `guest-review-mobile.png` | – | evidence |
| 103,109,111,122,133,135 | `getByText('保存されていない変更があります')` count 0 / visible | 327 (`<p role="status">`) | B/P (copy as hook) |
| 108,129 | label `'用品 1'` exact visible | 340 | B |
| 124 | `dialog.message()` matches `/保存されていない入力/` (window.confirm) | 261 `guardNav` | B (native confirm, not custom modal) |
| 125,138 | `getByRole('link',{name:'プランを見る',exact:true})` click → stays `/ja/book` on dismiss, `/ja/rental` on accept | **GuestBooking's own header** 324 (`header.public-header nav`) | **B, HIGH.** If the redesign moves /book onto PublicHeader (whose links read レンタル/店舗/…), the guarded link disappears. The link must keep `onClick={guardNav}`. |
| 134,465 | button `'日程に戻る'` exact | 353 | B |
| 149 | label `'利用人数'` exact fill `'2'` | 338 | B |
| 150-152 | `'ポールのサイズ 2'` **not visible** until `getByText('利用者 2').first().click()` | `<details className="guest-person-toggle">` / `<summary>` 352 | **B/P, HIGH.** The second person must start collapsed and expand by clicking text containing "利用者 2". |
| 159,285,476,494 | checkbox label `'合成データによる開発確認であることを確認'` | 371 | B |
| 167-168 | `getByRole('button',{name:'処理しています…',exact:true})` `toHaveAttribute('aria-busy','true')` and disabled | 372 | B (busy contract: label swap + aria-busy + disabled) |
| 169 | `getByRole('status').filter({hasText:'処理中です'})` visible | 372 | B |
| 172 | button `'この内容で支払う（開発用決済）'` | 372 | B |
| 172 | button `'保存済みの結果を再読込'` enabled/click | 377 | B |
| 172 | `getByRole('main').getByRole('alert')` contains `'処理でエラーが発生しました'` | `<main className="guest-main">` 324; `<p role="alert">` 328; copy 268 | **B, HIGH.** Exactly one `main` and exactly one `alert` inside it (strict mode). The recovery `<details>` is deliberately **outside** main (378). |
| 172,504,553 | heading `'予約が確認されました'` / `'Booking confirmed'` exact | h3 360, copy 93 | B |
| 172 | `getByRole('img',{name:'開発予約QR',exact:true})` | 360 | B |
| 179-202 | sessionStorage keys: `zao-guest-draft-input` purged; `zao-booking-access-request:*` untouched | 28-29,36; `W:BookingAccess.tsx:15` | B (storage contract) |
| 188,197,424,437,451 | `fetch('/api/guest/draft')` JSON `.id/.revision/.input`; POST `/api/guest/logout` 200 | API | B |
| 204-205 | after reload the radio おすすめ is still visible (server-saved step restored) | `computeMaxStep` 80-91 | B |
| 213 | label `'事前決済5％調整の見込みを確認する'` | 355 | B |
| 222-224 | EN: `'Start date'`, `'End date'`, button `'Choose equipment'`, `'Pole size 1'`, `'Review sizes and estimates'`, radio `/RECOMMENDED/i`, label `'I confirm each person’s size, model promise and wear selections'` (typographic ’), button `'Review the whole group'`, region `'Group review'` | 332-356,359; radio label 268 | B |
| 248,253 | `getByLabel('利用開始日').or(getByRole('button','候補と参考料金を確認'))` | – | B |
| 265,271,284,313 | region `'全員分の確認'` contains `'スキーセット'` / `'スノーボードセット'` | 366 (`sportLabel` 268) | B/P |
| 272-276 | `'条件を編集して再計算'` click → URL `/ja/book$`, **`history.length` +1** | 363; `backToStep` 247 (`history.pushState({step:n},'')`) | B (history contract) |
| 280,316,323 | `'用品 1'` selectOption/`toHaveValue('SNOWBOARD')` | 340 option values `SKI/SNOWBOARD/WEAR` | B |
| 286 | button `'この内容で支払う（開発用決済）'` exact enabled | 372 | B |
| 287 | `getByText('内容が変更されています')` count 0 | 372 | B/P |
| 317,322,353,358,434 | `getByRole('status').filter({hasText:'保存されていない変更があります' / '未保存の入力を復元しました' / 'unsaved changes' / 'Unsaved entries restored'})` | 326-327 | B |
| 318,354 | `dispatchEvent(new PopStateEvent('popstate',{state:{...history.state,step:3}}))` | popstate 201-202, `history.state.step` shape 246-247 | B (internal state shape) |
| 324-325,360-361,438,479,520 | region `'全員分の確認'`/`'Group review'` count 0; `getByRole('button',{name:/支払う/})` / `{name:/Pay/}` count 0 | 359,372 | **B, HIGH.** No other button anywhere on the page may contain 支払う, or the case-sensitive `Pay` (e.g. "Payment", "PayPay"). |
| 342-352 | EN `'Equipment 1'`, `'Edit and recalculate'`, region `'Group review'` contains `'Ski set'` | 340,363,268 | B |
| 377 (`noRawCode`) | `getByRole('main').innerText()` must not match `/\b[A-Z]{2,}_[A-Z_]{2,}\b/` | whole main | **B, HIGH.** No ALL_CAPS_UNDERSCORE token in main (applies to decorative or brand text too). |
| 381-394 | labels `'利用開始日'/'Start date'`, `'利用終了日'/'End date'`, `'利用枠'/'Rental slot'`; `locator('#guest-err-endDate')` / `#guest-err-slot` contain `'開始日以降'` / `'on or after'`, `'最大10日'` / `'no more than 10 days'`, `'複数日'` / `'Multiple days'`, `'午前・午後・1日'` / `'Morning, Afternoon or Full day'`; end/slot `aria-invalid="true"`; **no POST** sent | ids 303-304; copy 276-279; validation `attempt` 307 | **B + P(id), HIGH.** The error element ids `guest-err-<key>` and `aria-invalid` are hard-coded. |
| 402-404, 538 | labels `'身長cm 1'/'Height cm 1'`, `'足サイズcm 1'/'Foot size cm 1'`, `'体重kg 1'/'Weight kg 1'`, `'開始日の年齢 1'/'Age at start 1'`. Attributes exact: height `min=50 max=250 step=1 inputmode=numeric`; foot `5/50/0.1 decimal`; weight `5/300/any numeric`; age `0/120/1 numeric` | 343-346 | B (server-bound mirror) |
| 412-418 | `#guest-err-m0-height`, `-foot`, `-weight`, `-age`, `-pole` visible/count; `aria-invalid` on blur; `'13歳以上は大人'` / `'Adult for 13 or older'`; `'年齢区分 1'/'Age category 1'` selectOption(`'KIDS'`) | ids 303 (`'m'+j+'-'+f` 281); copy 289; select 341 | B + P(id) |
| 427-431 | sessionStorage key `zao-guest-draft-input:v2:<draftId>`; envelope keys exactly `baseRevision, baseServerInputFingerprint, draftId, input, schemaVersion`; **`localStorage.length===0`**; `history.state` must not contain `'172'` | 36-60 | **B.** The redesign must not write localStorage on /book (theme, consent, etc.). |
| 436 | during the restore reload, no POST other than `/api/guest/context` | – | B. No analytics or other POSTs from the page. |
| 439,481,499,522 | screenshots `guest-restored-ja-390.png`, `guest-insufficient-stock-ja-390.png`, `guest-price-changed-ja-390.png`, `guest-hold-expired-ja-390.png` | – | evidence |
| 477-478 | main alert contains `'在庫を確保できませんでした'`; region `'予約を続けられません'` contains the same | alert copy 92 (`HOLD_OR_QUOTE_RECONCILIATION_REQUIRED`); section `aria-label` 370 | B |
| 495-503 | alert `'料金が更新されました'`; region `'料金の更新'` contains old total and `'7,600'`; button `/支払う/` disabled (exactly one); panel button `'新しい料金を確認して続ける'` exact; then button `'この内容でもう一度支払う（開発用決済）'` exact | 92, 369, 372 | B (price numbers) |
| 518-520 | button `'保存済みの結果を再読込'` exact; region `'予約を続けられません'` contains `'在庫の確保期限が切れました'`; region `'料金の更新'` count 0 | 370,377 | B |
| 526-557 | **visual acceptance at ja/en × 390×844 and 1440×900** (`newPage(width,…)` T:529): | | |
| 533 | `getByText('利用開始日を選択してください。' / 'Choose a start date.')` visible; start `aria-invalid="true"` | 274 | B |
| 540-541 | `getByText('ポールのサイズを選択してください。' / 'Choose a pole size.')` visible/count 0 | 290 | B |
| 542 | radio `/おすすめ/` or `/Recommended/` (case-sensitive EN) | 268 | B |
| 543 | main must not contain `'SHORTER'`, `'RECOMMENDED'`, `'LONGER'` | 268,354 | B |
| 547 | region contains `'日程','受取店舗','返却店舗','利用者 1','Regular','小計','全員分の参考総額'` / `'Dates','Pickup store','Return store','Person 1','Regular','Subtotal','Group estimate'` | 365-367 | B/P |
| 548 | label `'メール（架空）'/'Email (synthetic)'` `inputmode="email"` | 371 | B |
| 549-552 | button `'Pay with these details (test payment)'`; `'内容に同意したらチェックを入れてください。'/'Tick this box to accept.'`; checkbox `'I understand this is a synthetic development preview'` | 296,371,372 | B |
| 554 | after confirmation no `zao-guest-draft-input:v2:` keys | – | B |
| 529 | screenshots `guest-{dates-invalid,dates,equipment-invalid,equipment,candidate,review,confirmed}-{ja,en}-{390,1440}.png` | – | evidence |
| 559 | button `'この予約画面を閉じる'` → `waitForURL(origin+'/ja')` | 377, `closeContext` 319 | B |

### 1e. Staff flows inside normal-ui
| T line | dependency | producer | class / risk |
|---|---|---|---|
| 14 | `getByLabel('メールアドレス',{exact:true})`, `getByLabel('パスワード',{exact:true})`, button `'ログイン'` exact; POST `/api/auth/sign-in/email` 200; `waitForURL(origin+'/staff/ledger')` | `W:components/StaffLogin.tsx:12` (label-wrapped inputs; button text swaps to `'確認中…'` while busy), redirect `:9` | B |
| 568 | button `'スタッフを作成'` exact | `W:components/StaffManagement.tsx:13` | B |
| 569 | `getByRole('form',{name:'スタッフ作成'})`; within it labels `'表示名'` exact, `'メールアドレス'` exact, `'初期パスワード（15〜128文字）'`, checkbox `'Mountain Station'` exact | `StaffManagement.tsx:14` (`<form aria-label>`), store name `P:contracts/src/store-display.ts:3` | B. The form needs an accessible name to keep its form role. |
| 570 | `form.getByLabel('台帳の閲覧' / '予約の閲覧' / '受付・貸出',{exact:true}).selectOption('allow')` | `StaffManagement.tsx:17` (select `aria-label`, option value `allow`) | B |
| 571 | form button `'スタッフ設定を保存'`; POST `/api/staff-users` 201; heading `'SYNTHETIC Handoff'` exact | `:17` and h2 in staff-cards `:18` | B |
| 573 | `/staff/rental`: `getByRole('button',{name:'予約と仮割当を照合'}).evaluate(b=>typeof b.onclick)` polled to equal `'function'` | `W:components/CustodyWorkspace.tsx:39`. React sets `onclick` on elements that have an `onClick` prop. | **B/P, HIGH.** The button must keep a React `onClick` (moving it to `<form onSubmit>` breaks the hydration probe). |
| 573 | `getByLabel('予約IDまたは予約QR')` fill/`toHaveValue` after a synthetic `pageshow`; GET `/api/custody/booking/*` | `CustodyWorkspace.tsx:39` | B |
| 573 | `getByRole('region',{name:'貸出用品'})` contains **`'LATE_PICKUP_ELIGIBLE'`** then **`'OUT'`** | `CustodyWorkspace.tsx:40` (raw `view.pickupTiming`), `:43` (raw `l.state`) | **B, HIGH.** Raw staff enums are shown. Localizing them breaks the test. |
| 573 | labels `'準備・最終適合の作業記録'`, `'表示された個体と数量を照合した'`; buttons `'照合した用品を準備固定'`, `'道具の貸出を記録'` | `CustodyWorkspace.tsx:41-42` | B |
| 573 | screenshot `late-pickup-staff-mobile.png` (390×844) | – | evidence |
| 576 (catch) | failure screenshot `public-failure.png`; logs `[role=alert],[role=status]` texts and elements wider than viewport | – | diagnostics only |

---

## 2. tests/public/content-ui.ts (27 lines)

- **Runner:** `npm run test:public-ui` (second half, `package.json:59`). App: flow-app wrapper (`publicP0:true`). Context 390×844 (T:19), plus an anonymous context `anon` with no viewport set.
- **Routes:**
  - `/staff/login` → `waitForURL(origin+'/staff/ledger')` (T:19); `/staff/content` (T:21,24).
  - `/en/rental/premium/synthetic-ski` (browser T:23, and request).
  - Request-only: `/api/content` (401/403), `/ja/rental/premium/synthetic-ski` (404), media `seed.media.variants[0].src` (200, then 404), `/media/<hash>/800.webp` (404), `/sitemap.xml`, `/ja/ski-rental` (308 → `/ja/rental/ski`), `/api/session`, `/api/content/bulk-prepare` (403).

| T line | dependency | producer | class / risk |
|---|---|---|---|
| 19 | login labels/button as §1e | `StaffLogin.tsx:12` | B |
| 21 | `getByRole('region',{name:'現在の下書き'})` contains `'合成スキー'` | `W:components/ContentWorkspace.tsx:21` (`<section aria-label>`); data `tests/public/content-seed.ts:13` | B |
| 22 | `getByLabel('CSVファイル').setInputFiles(...)` | `ContentWorkspace.tsx:20` (file input inside label) | B |
| 22 | button `'差分を検証して保存'`; button `/^有効な下書きを反映/` | `:20`, `:21` (`'有効な下書きを反映'：planId`) | B. The regex is anchored at the start, so no icon or prefix text is allowed before it. |
| 22 | `getByRole('status',{name:'説明処理状態'})` contains `'一部の下書きを保存済み'`, later `'保存済み'` | `:21` (`<p role="status" aria-label>`), copy `:18` | B |
| 22 | buttons `'下書き全体のreleaseを検証'`, `/^非公開releaseへ反映/` | `:21` | B |
| 23 | SSR HTML: `/Synthetic English description updated/`, `/150 cm/`, not `/155 CM/`, `/srcSet=/i`, `/width="800"/`, `/hrefLang="ja"/i`; media response content-type | `W:app/[locale]/rental/premium/[slug]/page.tsx:12` (`<source srcSet>`, `<img width={media.width}>`, lengths `dd`), metadata `W:lib/public-seo.ts:4` | B (SSR content) / P (`srcSet` + `width` attrs). Replacing `<picture>/<img>` with CSS backgrounds or `next/image` (which changes attributes) is risky. |
| 23 | browser `/en/rental/premium/synthetic-ski` no horizontal overflow; screenshot `public-model-en-mobile.png` | css | P / evidence |
| 24 | `getByLabel('写真ファイル').setInputFiles`; button `'選択した写真を送信・再開'`; `getByRole('status',{name:'写真処理状態'})` contains `'未確認'`; button `'保存済み写真jobを照合'`; `getByRole('region',{name:'写真一括fixture'})` contains `'変換済み 1'` | `W:components/ContentPhotoWorkspace.tsx:19` (status copy `:17`) | B |
| 24 | screenshot `content-pg-mobile.png` | – | evidence |
| 25 | 404/410/308 statuses; redirect location `/ja/rental/ski` | `W:proxy.ts:3`, `W:app/[locale]/retired/[slug]/route.ts:3`, premium page `:12` | B |

---

## 3. tests/readiness/guest-ui.ts (16 lines)

- **Runner:** `npm run test:readiness-ui` (`package.json:62`). App: flow-app (`publicP0+publicP1`). Context 390×844 with `hasTouch` (T:12).
- **Routes:** `/ja/book` (T:12,14). `app.restartWeb(['/ja/book'])` then `goto(app.origin+'/ja/book')` (T:14). Request-only `/api/guest/draft` (200).

| T line | dependency | producer | class / risk |
|---|---|---|---|
| 12 | shared happy path steps 1-6 (labels/buttons from §0) | GuestBooking.tsx 332-354 | B |
| 13,14 | `getByText('予約をお持ちの方はこちら',{exact:true}).click()` | `W:GuestBooking.tsx:378` (`<details><summary>` outside main) | **B/P, HIGH.** The summary text must be exactly this string, and it must toggle a details/disclosure that reveals the recovery form. |
| 13 | button `'回復コードを作成'` exact | `W:components/GuestRecovery.tsx:8` | B |
| 13 | `getByRole('region',{name:'予約画面の回復'}).getByRole('status')` contains `'安全な場所'` | section aria-label `:8`, status `<p role="status">` `:8`, copy `:6` | B. There must be exactly one status inside the region. |
| 13 | `getByLabel('保存する回復コード').inputValue()` length 43 | `:8` (readonly input inside label) | B. The code must stay in an input value (not plain text). |
| 14 | `getByLabel('控えた回復コード').fill(code)`; button `'保存済み予約画面を回復'` | `:8` | B |
| 14 | route `**/api/guest/recover` aborted after 200 → region status contains `'未確認'` | `:7` | B |
| 14 | after restart: radio `/おすすめ/` visible (step 2 restored) | GuestBooking 268/354 | B |
| 15 | **width matrix** `setViewportSize` 320, 360, 390, 430, 768, 1024 (height 844): `scrollWidth<=innerWidth` on /ja/book at the candidate step | css | **P, HIGH.** 320 px is the narrowest width tested anywhere. |
| 15 | screenshot `p1-recovered-guest.png` | – | evidence |

---

## 4. tests/readiness/booking-access-ui.ts (110 lines)

- **Runner:** `npm run test:activation-p4` (3rd of 4 scripts, `package.json:86`). App: flow-app (`publicP0,P1,P4`). Context 390×844 `hasTouch`.
- **Routes:** `/ja/book` (T:16,76). Link click → `page.url()===app.origin+'/ja/reservation'` (T:18). Reloads of `/ja/reservation`. Request-only `/api/booking-access` (200/401), `/api/guest/draft` (401).

| T line | dependency | producer | class / risk |
|---|---|---|---|
| 16 | shared happy path. Uses `getByRole('checkbox',{name:'全員のサイズ…'})` and `getByRole('checkbox',{name:'合成データ…'})` (checkbox role, not label) | GuestBooking 355,371 | B. Must stay native checkboxes, or keep `role=checkbox` with that name. |
| 18,76-77 | button `'予約閲覧をこの端末へ保存'`; route `**/api/booking-access/issue` lost → `getByRole('region',{name:'予約閲覧の保存'}).getByRole('status')` contains `'未確認'` | `W:components/BookingAccess.tsx:18` (section aria-label + `<p role="status">` + button), copy `:17` | B. One status per region. |
| 18,78 | `getByRole('link',{name:'保存した予約とQRを開く'})` → `/ja/reservation` | `BookingAccess.tsx:18` | B |
| 18,45,78,87,108 | `getByRole('img',{name:'保存済み予約QR'})` visible / count 0 | `BookingAccess.tsx:40` | B |
| 18 | cookie `zao_booking_access` HttpOnly, SameSite Strict, path `/api/booking-access`; page HTML must not contain the cookie value | API | B |
| 25-35 | `addInitScript` wraps `window.fetch` to gate GET `/api/booking-access` | – | B (the page must read via `fetch` to that same-origin path) |
| 40,86,92,100,102 | button `'予約を再読込'` exact (click; disabled while reading; enabled after) | `BookingAccess.tsx:40` (`disabled={busy\|\|reading}`) | B |
| 42,45,68,73,88,91,108 | button `'この端末の予約閲覧権を失効'` disabled while the read is pending, enabled after; click | `:40-57` | B |
| 49-50,72-75,79 | sessionStorage `zao-booking-access-request:<bookingId>` kept on lost revoke, cleared on ack; other keys untouched | `:15,53` | B |
| 69,73,108 | **unscoped** `page.getByRole('status')` toContainText `'未確認'` / `'失効しました'` | ConfirmedBooking `<p role="status">` `:40` (copy `:55-56`) | **B, HIGHEST.** Strict mode needs **exactly one** `role=status` on the whole /ja/reservation page at that moment. Any new live region, toast, header status or footer status breaks it. |
| 97-102 | synthetic `pagehide`/`focus` window events toggle reload disabled/enabled | `:34-35` | B |
| 105 | `/api/booking-access` JSON `readOnly:true, chargeReady:false`, no `contact`/`members`, `cache-control` no-store | API | B |
| 108 | widths 320/390/430/768 no overflow on /ja/reservation; screenshot `p4-confirmed-booking.png` | `W:app/[locale]/reservation/page.tsx:7` (`PublicFrame` + `main.guest-main`), css | P |

---

## 5. tests/readiness/booking-recovery-ui.ts (67 lines)

- **Runner:** `npm run test:booking-recovery-ui` (`package.json:88`). App: flow-app (`publicP0,P1,P4,P5,warmRoutes`). Contexts 390×844 `hasTouch`.
- **Routes:** `/ja/book` (T:16); fresh context `/ja/reservation` (T:29,48,61); `/en/reservation` (T:61). `url()===origin+'/ja/reservation'` (T:45). `restartWeb(['/ja/reservation','/api/booking-access'])`.

| T line | dependency | producer | class / risk |
|---|---|---|---|
| 16 | shared happy path (checkbox roles as §4) | GuestBooking | B |
| 29,59,63 | img `'保存済み予約QR'` count 0 / visible | `BookingAccess.tsx:40` | B |
| 32,42 | hydration probe: `getByLabel('予約復旧コード',{exact:true}).evaluate(el=>Object.keys(el).some(k=>k.startsWith('__reactProps$')))` | `W:components/BookingRecovery.tsx:21` (input inside `<label>`) | **B/P, HIGH.** The labelled element must be the React-rendered `<input>` itself (no custom wrapper that receives the label). |
| 36,42,63 | `getByLabel('予約復旧コード',{exact:true}).fill(code)` | `:21` | B |
| 39,43 | button `'復旧コードで予約を開く'` exact (form submit) | `:21` | B |
| 41,63 | `getByRole('region',{name:'予約閲覧の復旧'}).getByRole('status')` contains `'未確認'` / `'失効しました'` | `:21` (section aria-label; status only while a message is shown), copy `:17,19` | B. Exactly one status inside the region; `RequestBookingRecovery` inside it must not show its own status at the same time. |
| 46,54 | DOM, localStorage and sessionStorage must not contain the code or cookie values | – | B |
| 53 | cookie `zao_booking_cancel` HttpOnly/Strict | API | B |
| 56 | button `'予約をキャンセル'` exact → heading `'キャンセル内容の最終確認'` | `W:components/BookingCancellation.tsx:17` | B |
| 58 | button `'この返金額でキャンセルを確定'`; route `**/api/booking-access/cancel` lost → reload | `:17` | B |
| 59 | heading `'予約をキャンセルしました'`; region `'キャンセル状況'` contains `'返金処理待ち'` | `:16`, labels `:15` | B |
| 61 | `/en/reservation` region `'Cancellation status'` contains `'Refund pending'` | `:15-16` | B |
| 63 | button `'この復旧コードを失効'` exact | `BookingRecovery.tsx:21` | B |
| 64-65 | widths 320/390/430/768 no overflow; screenshot `p5-recovery-after-revoke.png` | css | P |

---

## 6. tests/readiness/cancellation-ui.ts (29 lines)

- **Runner:** `npm run test:activation-p4` (4th script, `package.json:86`). App: flow-app (`publicP0,P1,P4`). Context 390×844 `hasTouch`.
- **Routes:** `/ja/book` (T:16) → reload; `/en/book` (T:26); `/en/reservation` (T:27).

| T line | dependency | producer | class / risk |
|---|---|---|---|
| 16 | shared happy path | GuestBooking | B |
| 20 | button `'予約閲覧をこの端末へ保存'`; link `'保存した予約とQRを開く'` visible | `BookingAccess.tsx:18` | B |
| 21,23 | button `'予約をキャンセル'` exact; `getByRole('region',{name:'予約のキャンセル',exact:true})` contains `Intl.NumberFormat('ja-JP',{style:'currency',currency:'JPY',maximumFractionDigits:0}).format(totalJpy)` (e.g. `￥7,000`) | `BookingCancellation.tsx:17` (section aria-label; amount formatting `:9`) | **B (price format).** The amount must be rendered with that exact Intl JPY formatter (full-width ￥ in ja-JP). |
| 22 | button `'予約を維持する'` → `'この返金額でキャンセルを確定'` count 0 | `:17` | B |
| 24 | route `**/api/guest/cancel` committed then aborted → reload | `:11` | B |
| 25 | heading `'予約をキャンセルしました'`; region `'キャンセル状況'` contains `'返金処理待ち'` | `:15-16`, rendered in GuestBooking 361 | B |
| 26 | `/en/book`: region `'Cancellation status'` contains `'Refund pending'`; **`page.locator('main').getByRole('img')` count 0** | GuestBooking main 324; QR img 360 shown only when `qrImage` | **B/P, HIGH.** No `<img>` with non-empty alt (and no `role=img` SVG) may sit in `<main>` of a cancelled /book view. Decorative icons need `alt=""` / `aria-hidden`. |
| 26 | `scrollWidth<=innerWidth` at 390; screenshot `cancellation-en-mobile.png` | css | P |
| 27 | `/en/reservation`: region `'Saved booking'` contains `'Booking cancelled'`; img `'Saved booking QR'` count 0 | `BookingAccess.tsx:40` | B |

---

## 7. tests/readiness/normal-production-ui.ts (48 lines)

- **Runner:** `npm run test:production-runtime-ui` (`package.json:114`). This is the **only file here that serves apps/web directly**: `next({dev:false,dir:resolve('apps/web')})` with `NODE_ENV=production` behind a local HTTPS server (T:36-39). It needs the prior `npm run build` (verify step `build`).
- **Browser setup:**
  - Chromium with host-resolver rules; origin `https://production-fixture.invalid:<port>` (T:21,40).
  - Viewport 390×844, `ignoreHTTPSErrors` (T:40).
  - The guest cookie `zao_guest` is injected (T:42); the booking is created by service calls, not UI (T:31-33).
- **Network guard:** `ctx.route('**/*')` aborts and **counts any request whose origin differs from the app origin** (T:41,46). T:45 asserts `external===0`.
- **Routes:** `/ja/book` (T:43,46); in-page fetches to `/api/guest/draft`, `/api/booking-access/issue`, `/api/booking-access`, `/api/readiness`, `/api/admin/readiness`, `/api/guest/avatar/...`, `/guest-avatar-media/...`, `/api/guest/checkout`.

| T line | dependency | producer | class / risk |
|---|---|---|---|
| 41,45,46 | **zero cross-origin requests** from /ja/book (including fonts, images, analytics, CDNs) | whole page | **B, HIGHEST for redesign.** Google Fonts `<link>`, CDN scripts/CSS or remote images break it. `next/font` self-hosting or local assets are OK. |
| 43,45 | heading `'予約が確認されました'` exact visible (at 390 and 1440 after reload) | GuestBooking 360 / copy 93 | B |
| 43 | `page.textContent('body')` includes the booking id | GuestBooking 364 (`予約番号` inside `<details>`) | B. The booking id must remain in the DOM (it may be collapsed). |
| 43,46 | `locator('[data-avatar-stage]')` count 0 | `W:components/AvatarFitPreview.tsx:22` (rendered via GuestAvatarPreview, GuestBooking 354) | B (feature-off) / P (data attribute). Do not add `data-avatar-stage` elsewhere. |
| 43-44 | API JSON shapes (`booking.state`, `payments[0].state`, `quote.snapshot.totalJpy`, `hold`, `qrImage` starts `data:image/png`, readiness `{status:'READY'}`, 401/404 codes) | API | B |
| 45 | `setViewportSize` 390×900 and 1440×900 + reload; no horizontal overflow; avatar route forced 503 | css | P |
| 46 | fresh context: labels `'利用開始日'`, `'利用終了日'`, button `'用品を選ぶ'`, `'ポールのサイズ 1'`, `'候補と参考料金を確認'`, radio `/おすすめ/` | GuestBooking | B |
| – | no screenshots | – | – |

---

## 8. tests/readiness/normal-worker-continuity.ts (131 lines)

**No browser, no UI dependency.** It exports `normalWorkerContinuity(x)` and is called from `tests/readiness/commercial-payment.ts:12,17` (`npm run test:production-runtime`, `package.json:113`). It uses only PostgreSQL pools and payment-worker ports. The redesign cannot affect it. It is listed for completeness.

---

## 9. Helpers followed

- `tests/flow/launcher.ts`. Contains no locators. Defines the served app (flow-app `next dev`), env flags, `warmRoutes` (GET every page under `tests/flow-app/src/app`, T:5-38) and `restartWeb`. If the redesign adds a new `apps/web` page, it needs a flow-app re-export to be reachable in these tests.
- `tests/recommendation/fixture.ts` / `tests/inventory/fixture.ts:7` (`variants.pole` → option value `pole-<fid>`), `tests/public/content-seed.ts:13` (`合成スキー` title), `tests/flow/fixture.ts` (`simulation`), `tests/readiness/normal-production-fixture.ts`. These are data only and contain no locators.

---

## 10. Riskiest for redesign (top 12)

1. **Home menu computed-style asserts** (normal-ui T:66-68, 75):
   - `.pc-menu` rgba background alpha ≳ 0.54 (`public.css:24`);
   - `.pc-menu-cats a` / `.pc-menu-small a` computed color exactly `rgb(255, 255, 255)`;
   - `.pc-view` `visibility:hidden` while the menu is open (`public.css:136`).
   Any palette, class or hiding-technique change breaks these.
2. **Carousel class/attribute probes**:
   - `.pc-title-m`, `.pc-view[href]`, `.pc-slide.is-active[href]`, `.pc-hero` (T:51,55);
   - `.pc-wheel li[aria-hidden="false"] button` with exactly 3 distinct rows (T:86-88);
   - CDP swipe at fixed point (width/2, **y=420**) that must land on the hero at 390×844 and 375×812 (T:52).
3. **Modal menu DOM contract** (T:63-82):
   - `role=dialog aria-modal=true aria-label="メニュー"` must be a **direct child of `.public-shell`** (inert siblings), and `.pc-footer` must exist;
   - toggle `aria-label="メニューを開く"` receives focus back;
   - scroll lock via `document.body.style.overflow`;
   - Tab/Shift+Tab trap; Escape closes it; link `SKI` exact.
4. **Bare `<h1>` regex** on all 24 public pages (T:31): a class or attribute on h1 breaks it. One `heading level 1` on /ja/rental (T:35).
5. **Single `role=status` on /ja/reservation** (booking-access-ui T:69,73,108, unscoped `page.getByRole('status')`). Any added live region or toast breaks it. The same "one status/alert per region" rule applies in the recovery, guest-recovery and save-access regions, and `getByRole('main').getByRole('alert')` on /book requires exactly one main and one alert.
6. **Zero cross-origin requests on /ja/book** in the production build (normal-production-ui T:41,45). This rules out web fonts, CDN assets and remote images unless they are self-hosted.
7. **`dl.guest-price dt` exact ordered texts and `dd.last()` = total** (normal-ui T:95,214,225,216,491,501). The price summary must stay a `dl.guest-price`.
8. **GuestBooking's own header link `'プランを見る'`** with `guardNav` + native `window.confirm` (T:124-139). Unifying /book onto PublicHeader would remove it.
9. **Inline validation ids `#guest-err-<key>` / `#guest-err-m0-<field>` + `aria-invalid`**, numeric `min/max/step/inputmode` attributes, and blocked POSTs (T:378-421, 533-541).
10. **Person 2 collapsed `<details>` toggled via `getByText('利用者 2')`** and recovery disclosure `getByText('予約をお持ちの方はこちら',{exact:true})` (normal-ui T:150-152; guest-ui T:13-14).
11. **Global negative matchers**:
    - no button matching `/支払う/` or case-sensitive `/Pay/` except the checkout one;
    - main innerText free of `/\b[A-Z]{2,}_[A-Z_]{2,}\b/` and of `SHORTER/RECOMMENDED/LONGER`;
    - `main` img count 0 on cancelled /en/book;
    - `localStorage.length===0`; no non-`/api/guest/context` POST during restore;
    - no `[data-avatar-stage]`.
12. **Staff hooks**:
    - `typeof onclick==='function'` on `'予約と仮割当を照合'` (React `onClick` must stay on that button);
    - raw enums `LATE_PICKUP_ELIGIBLE` / `OUT` in region `貸出用品`;
    - `getByRole('form',{name:'スタッフ作成'})` + per-permission select `aria-label`s;
    - the hydration probe `__reactProps$` on the `予約復旧コード` input.

Lower risk:
- **Width matrix.** No horizontal overflow at 320/360/390/430/768/1024 (/book, /reservation), 375/390 (home) and 1440 (/book, home). These are layout-only but strict.
- **Screenshots.** All `page.screenshot` calls only save evidence PNGs; none are compared to a baseline.
