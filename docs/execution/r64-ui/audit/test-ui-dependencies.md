> Historical pre-redesign/WIP audit recovered from Claude. Findings describe that checkpoint, not the final candidate. See TAKEOVER_RECONCILIATION.md and VALIDATION.md for final dispositions and receipts.

# Test → UI dependency matrix (R64 redesign pre-flight)

Repo: `work/f2` @ HEAD `e1abb2e` + **uncommitted WIP** (`apps/web/src/app/globals.css`, `components/PublicChrome.tsx` modified; `HomeHero.tsx`, `PriceExplorer.tsx`, `price-rows.ts`, `brand/*` untracked). Read-only audit, 2026-10-14. Nothing was run.

## Legend / method
- Locators were extracted mechanically from every listed test (`getBy*`, `locator`, `querySelector*`, `toHave*`, `evaluate`, `assert.match/doesNotMatch`, `includes`, `screenshot`) and de-duplicated per file. **L** = first line, **n** = occurrences in that file. Lines are physical lines; these files have very long lines, so one line can hold a whole `check(...)`.
- **kind**: `role:<r>` (landmark roles are tagged) · `label` (getByLabel → `<label>` text or `aria-label`) · `text` (getByText/toContainText/toHaveText/filter hasText) · `css:css-class|id|tag|attr` · `computed-style` (getComputedStyle / getBoundingClientRect / `scrollWidth` = no horizontal overflow) · `regex-on-html` (assert on raw server HTML or SSR markup) · `url` · `attribute` · `screenshot-path`.
- **B/P**: BEHAVIOURAL = it depends on accessible semantics, URL or state (roles, label names, aria-*, count, value). PRESENTATIONAL = it depends on markup, classes, ids, tag names, CSS or exact copy. **Every `+name`/label entry also depends on the exact copy.** Most role and label names use `exact:true`, so changing the copy of a button, label or region name breaks the test, even though the row says BEHAVIOURAL.
- **producing component**: the files under `apps/web/src` that contain the literal, looked up in the *current working tree* (this includes the WIP). `pkg:` means the literal lives in `packages/*`. "not literal" means the string comes from seeded or DB data, from a template (`'利用者 '+n`) or from an attribute composed at runtime.
- No test uses `getByTestId`, `toHaveScreenshot` (visual diff), `toHaveClass`, `toHaveCSS`, or any `details`/`summary` selector. Screenshots are only written to `.local/screenshots/*.png` as evidence and are never compared.

## ALREADY BROKEN by the in-progress WIP (fix before anything else)
| test:line | dependency | HEAD producer | WIP state |
|---|---|---|---|
| tests/public/normal-ui.ts:66 | `document.querySelector('.pc-menu')` bg alpha → contrast ≥4.5; `.pc-menu-cats a` and `.pc-menu-small a` color === `'rgb(255, 255, 255)'` | HEAD `PublicChrome.tsx` className `pc-menu`, `pc-menu-cats`, `pc-menu-small` | WIP renamed these to `st-mnu`, `st-mnu-cats`, `st-mnu-small`. `querySelector(...)!` returns null and `getComputedStyle(null)` throws. **FAIL** |
| tests/public/normal-ui.ts:78 | `!!document.querySelector('.pc-footer a') && !.pc-footer.inert` must be `true` | HEAD `pc-footer` | WIP uses `st-ft`, so the result is false. **FAIL** |
| tests/public/normal-ui.ts:73 | `.pc-footer a` must NOT take focus while the menu is open | HEAD `pc-footer` | The selector now matches nothing, so the check passes **vacuously** and focus-trap coverage is silently lost |
| tests/public/normal-ui.ts:31 | `/<h1>/` (exactly `<h1>` with no attributes) on `/ja` and `/en` (path `''`) | HEAD `PublicHeader` rendered `<h1><Link className="pc-logo">…<span className="pc-sr">{homeHeading}</span></h1>` | WIP `PublicHeader` renders `<span className="st-hd-left">`, so the home page has no `<h1>` unless `HomeHero` adds one. **FAIL** for the home page |
| (compile) | WIP `PublicHeader({locale,page,homeHeading,guard})` and `PublicFooter({locale,page,legal})` changed their props (`alternate` and `campaigns` were removed) | `PublicPage.tsx` still calls `HomeCampaigns` | Check the callers. `HomeHero` is not wired yet, so the `.pc-hero`/`.pc-title-m`/`.pc-view`/`.pc-slide`/`.pc-wheel` tests still pass only while `HomeCampaigns` remains |

## Cross-cutting dependencies (apply to many files)
1. **No horizontal overflow**: `document.documentElement.scrollWidth<=innerWidth` (some use `+1`) is checked in 24 places at widths 320/360/375/390/430/768/1024/1440. See `for(const width of [...])` in readiness/guest-ui:15, booking-access-ui:108, booking-recovery-ui:64, flow/asset-reader-ui:27, staff/home-ui:435, operations/{normal-ui:50,console-ui:97,launch-ui:84}, notification:37, avatar/phase4:58, phase5:73, public/normal-ui:48 (375/390). Every redesigned surface must hold at 320px.
2. **Accessible-name contract**: about 330 `getByLabel` and about 310 `getByRole('button',{name, exact:true})` use Japanese (and some English) copy. Regions need `<section aria-label=…>` (role=region exists only when the section has a name). `complementary` needs `<aside aria-label>`. `form` landmarks need `<form aria-label>`. `article` names come from `aria-label` on `<article>`.
3. **Status/alert live regions**: `getByRole('status')`, `getByRole('alert')` and `[role=alert],[role=status]` are scoped inside named regions (for example region '予約画面の回復' → status). Keep one status per region.
4. **Tag-qualified CSS selectors** (these break if the element type changes): `dl.guest-price dt/dd`, `ul.staff-cards > li`, `section[aria-label="例外一覧"] article`, `section[aria-label="稼働状況"]`, `aside[aria-label="台帳詳細"]`, `table tbody tr`, `footer.ledger-footer`, `canvas[aria-label="用品QR …"]`, `locator('section',{has:.asset-label})`, `locator('main').getByRole('img')`, `locator('h1').first()`, `locator('..')` (parent of a button).
5. **Raw HTML / SSR regexes**: public pages (`<h1>`, `rel="canonical"`, `hrefLang="x-default"`, `application/ld+json`, `BreadcrumbList`, unique `<title>`, `<meta name="robots" content="noindex`, footer `href="/ja/legal/<doc>"`), content pages (`srcSet=`, `width="800"`, `hrefLang="ja"`), staff preview (`/Staff sign-in/`), and AvatarFitPreview SSR (unit test).
6. **Fixture coupling**: `tests/content/Workspace.tsx` renders `className="holds"` and imports `apps/web/src/components/holds.css`. `tests/flow/AssetReaderFixture.tsx` imports `AssetQrInput`. `tests/ui-app` imports `apps/web/src/app/globals.css` and `components/ledger/LedgerWorkspace` (+ `ledger/client`). `tests/flow-app/src/app/**` re-exports every `apps/web/src/app` page and layout, so all flow tests run the real components. ESLint `@next/next/no-html-link-for-pages` is disabled only for `app/staff/**`, `app/preview/**`, `components/*Workspace.tsx`, `components/Staff*.tsx` and two test paths, so a raw `<a href="/…">` in public components fails `npm run lint`.

---
# Per-file tables

### `tests/public/normal-ui.ts`

| L | n | locator / assertion (verbatim) | kind | B/P | producing component |
|---|---|---|---|---|---|
| 14 | 2 | `getByLabel('メールアドレス',{exact:true})` | label | BEHAVIOURAL | GuestRecovery.tsx, StaffManagement.tsx, StaffLogin.tsx +2 |
| 14 | 1 | `getByLabel('パスワード',{exact:true})` | label | BEHAVIOURAL | page.tsx, StaffHome.tsx, StaffManagement.tsx +3 |
| 15 | 1 | `getByRole('button',{name:'ログイン',exact:true})` | role:button +name | BEHAVIOURAL | page.tsx, page.tsx, page.tsx +21 |
| 16 | 1 | `waitForURL(app!.origin+'/staff/ledger',{timeout:60000})` | url | BEHAVIOURAL | page.tsx, page.tsx, OpsWorkspace.tsx +9 |
| 31 | 1 | `assert.match(html,/<h1>/)` | regex-on-html | PRESENTATIONAL | page.tsx, page.tsx, page.tsx +44 |
| 31 | 1 | `assert.match(html,/rel="canonical"/)` | regex-on-html | PRESENTATIONAL | sitemap.ts, page.tsx, page.tsx +8 |
| 31 | 1 | `assert.match(html,/hrefLang="x-default"/i)` | regex-on-html | PRESENTATIONAL | pkg:core/public-pages.ts |
| 31 | 1 | `assert.match(html,/application\/ld\+json/)` | regex-on-html | PRESENTATIONAL | page.tsx, BookingCancellation.tsx, useOperationsRequest.ts +29 |
| 31 | 1 | `assert.match(html,/BreadcrumbList/)` | regex-on-html | PRESENTATIONAL | page.tsx |
| 31 | 1 | `assert.match(response.headers()['x-robots-tag']??'',/noindex/)` | regex | PRESENTATIONAL | proxy.ts, route.ts, route.ts +10 |
| 32 | 1 | `assert.doesNotMatch(await (await context.request.get('/sitemap.xml')).text(),/<loc>/)` | regex-on-html | PRESENTATIONAL | robots.ts |
| 32 | 1 | `assert.doesNotMatch(await (await context.request.get('/sitemap.xml')).text(),/<loc>[^<]*(?:\/book\|\/staff\|\?)/)` | regex-on-html | PRESENTATIONAL | robots.ts |
| 32 | 1 | `assert.match(await (await context.request.get('/robots.txt')).text(),/Disallow: \//)` | regex-on-html | PRESENTATIONAL | pkg:core/public-pages.ts |
| 33 | 1 | `assert.match((await context.request.get(path)).headers()['x-robots-tag']??'',/noindex/)` | regex | PRESENTATIONAL | proxy.ts, route.ts, route.ts +10 |
| 35 | 1 | `getByRole('heading',{level:1})` | role:heading | BEHAVIOURAL | — |
| 35 | 6 | `evaluate(()=>document.documentElement.scrollWidth<=innerWidth)` | computed-style (no h-overflow) | PRESENTATIONAL | — |
| 35 | 1 | `screenshot({path:'.local/screenshots/public-ja-mobile.png',fullPage:true})` | screenshot-path | PRESENTATIONAL | — (artifact path) |
| 39 | 1 | `` assert.ok((await response.text()).includes(fact),`${locale}/${doc}: ${fact}`) `` | assert | PRESENTATIONAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 43 | 1 | `` assert.ok(faq.includes(`href="/ja/legal/${doc}"`),`footer link ${doc}`) `` | assert | PRESENTATIONAL | proxy.ts, sitemap.ts, layout.tsx +38 |
| 43 | 1 | `` includes(`href="/ja/legal/${doc}"`) `` | substring | PRESENTATIONAL | proxy.ts, sitemap.ts, layout.tsx +38 |
| 44 | 1 | `assert.ok(!faq.includes('公開文言・利用規約は公開前確認中です'),'the under-review notice disappears once every document is approved')` | assert | PRESENTATIONAL | PublicPage.tsx |
| 44 | 1 | `includes('公開文言・利用規約は公開前確認中です')` | substring | PRESENTATIONAL | PublicPage.tsx |
| 45 | 1 | `assert.match(legalHtml,/<meta name="robots" content="noindex/,'not indexable without publication authority')` | regex-on-html | PRESENTATIONAL | robots.ts, layout.tsx, page.tsx +6 |
| 51 | 1 | `evaluate(()=>({title:document.querySelector('.pc-title-m')?.textContent,view:document.querySelector('.pc-view')?.getAttribute('href'),slide:document.querySelector('.pc-slide.is-active')?.getAttribute('href')}))` | dom-evaluate | PRESENTATIONAL | HomeCampaigns.tsx |
| 51 | 1 | `querySelector('.pc-title-m')` | css:css-class | PRESENTATIONAL | HomeCampaigns.tsx |
| 51 | 3 | `querySelector('.pc-view')` | css:css-class | PRESENTATIONAL | HomeCampaigns.tsx |
| 51 | 2 | `getAttribute('href')` | attribute | BEHAVIOURAL | page.tsx, page.tsx, page.tsx +45 |
| 51 | 1 | `querySelector('.pc-slide.is-active')` | css:css-class | PRESENTATIONAL | HomeCampaigns.tsx |
| 55 | 1 | `locator('.pc-title-m')` | css:css-class | PRESENTATIONAL | HomeCampaigns.tsx |
| 55 | 1 | `locator('.pc-hero')` | css:css-class | PRESENTATIONAL | HomeCampaigns.tsx |
| 63 | 3 | `getByRole('button',{name:'メニューを開く'})` | role:button +name | BEHAVIOURAL | PublicChrome.tsx |
| 63 | 3 | `getByRole('dialog',{name:'メニュー'})` | role:dialog (landmark) +name | BEHAVIOURAL | PublicChrome.tsx |
| 64 | 4 | `evaluate(()=>document.body.style.overflow)` | dom-evaluate | PRESENTATIONAL | — |
| 66 | 1 | `evaluate(()=>{const p=document.querySelector('.pc-menu')!,bg=getComputedStyle(p).backgroundColor,a=Number(/rgba?\([^)]*,\s*([\d.]+)\)/.exec(bg)?.[1]??1),link=getComputedStyle(document.querySelector('.pc-menu-cats a')!).color,small=getComputedStyle(document.querySelector('.pc-menu-small a')!).color;return {a,link,small,cta:getComputedStyle(document.querySelector('.pc-view')!).visibility};})` | computed-style | PRESENTATIONAL | HomeCampaigns.tsx |
| 66 | 1 | `querySelector('.pc-menu')` | css:css-class | PRESENTATIONAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 66 | 1 | `querySelector('.pc-menu-cats a')` | css:css-class | PRESENTATIONAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 66 | 1 | `querySelector('.pc-menu-small a')` | css:css-class | PRESENTATIONAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 69 | 1 | `evaluate(()=>{const a=document.activeElement,d=document.querySelector('[role="dialog"][aria-modal="true"]');return !!a&&!!d&&d.contains(a);})` | dom-evaluate | PRESENTATIONAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 69 | 1 | `querySelector('[role="dialog"][aria-modal="true"]')` | css:attr | BEHAVIOURAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 70 | 2 | `getByRole('button',{name:'メニューを閉じる'})` | role:button +name | BEHAVIOURAL | PublicChrome.tsx |
| 73 | 1 | `evaluate(()=>{const f=document.querySelector<HTMLElement>('.pc-footer a');f?.focus();return document.activeElement===f;})` | dom-evaluate | PRESENTATIONAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 74 | 23 | `toHaveCount(0)` | count | BEHAVIOURAL | — |
| 75 | 1 | `evaluate(()=>getComputedStyle(document.querySelector('.pc-view')!).visibility)` | computed-style | PRESENTATIONAL | HomeCampaigns.tsx |
| 76 | 2 | `evaluate(()=>document.activeElement?.getAttribute('aria-label'))` | dom-evaluate | PRESENTATIONAL | BookingCancellation.tsx, PublicChrome.tsx, HomeHero.tsx +29 |
| 76 | 2 | `getAttribute('aria-label')` | attribute | BEHAVIOURAL | BookingCancellation.tsx, PublicChrome.tsx, HomeHero.tsx +29 |
| 78 | 1 | `evaluate(()=>!!document.querySelector('.pc-footer a')&&!(document.querySelector('.pc-footer') as HTMLElement).inert)` | dom-evaluate | PRESENTATIONAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 78 | 1 | `querySelector('.pc-footer a')` | css:css-class | PRESENTATIONAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 78 | 1 | `querySelector('.pc-footer')` | css:css-class | PRESENTATIONAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 79 | 1 | `getByRole('dialog')` | role:dialog (landmark) | BEHAVIOURAL | — |
| 81 | 1 | `getByRole('link',{name:'SKI',exact:true})` | role:link +name | BEHAVIOURAL | PublicChrome.tsx, RecommendationWorkspace.tsx, PriceExplorer.tsx +11 |
| 82 | 1 | `waitForURL(/\/ja\/rental\/ski$/)` | url | BEHAVIOURAL | proxy.ts, sitemap.ts, page.tsx +36 |
| 86 | 1 | `locator('.pc-wheel li[aria-hidden="false"] button')` | css:css-class+attr | PRESENTATIONAL | HomeCampaigns.tsx |
| 87 | 1 | `locator('.pc-wheel li button')` | css:css-class | PRESENTATIONAL | HomeCampaigns.tsx |
| 88 | 1 | `locator('.pc-wheel li[aria-hidden="false"]')` | css:css-class+attr | PRESENTATIONAL | HomeCampaigns.tsx |
| 91 | 32 | `getByLabel('利用開始日',{exact:true})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx, QuoteWorkspace.tsx, GuestBooking.tsx |
| 91 | 13 | `getByLabel('利用終了日',{exact:true})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx, QuoteWorkspace.tsx, GuestBooking.tsx |
| 91 | 2 | `getByLabel('利用枠',{exact:true})` | label | BEHAVIOURAL | GuestBooking.tsx |
| 91 | 11 | `getByRole('button',{name:'用品を選ぶ',exact:true})` | role:button +name | BEHAVIOURAL | GuestBooking.tsx |
| 91 | 11 | `getByLabel('ポールのサイズ 1',{exact:true})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx, GuestBooking.tsx |
| 92 | 15 | `getByRole('button',{name:'候補と参考料金を確認',exact:true})` | role:button +name | BEHAVIOURAL | GuestBooking.tsx |
| 92 | 9 | `getByRole('radio',{name:/おすすめ/})` | role:radio +name | BEHAVIOURAL | RecommendationWorkspace.tsx, AvatarFitPreview.tsx, GuestBooking.tsx |
| 92 | 5 | `getByLabel('全員のサイズ・モデル条件・ウェア構成を確認した')` | label | BEHAVIOURAL | GuestBooking.tsx |
| 92 | 5 | `getByRole('button',{name:'全員分の最終確認へ'})` | role:button +name | BEHAVIOURAL | GuestBooking.tsx |
| 92 | 8 | `getByRole('region',{name:'全員分の確認'})` | role:region (landmark) +name | BEHAVIOURAL | GuestBooking.tsx |
| 92 | 1 | `toContainText('全員分の参考総額')` | text | PRESENTATIONAL | GuestBooking.tsx |
| 95 | 3 | `locator('dl.guest-price dt')` | css:css-class+tag | PRESENTATIONAL | guest.css, GuestBooking.tsx |
| 95 | 1 | `toHaveText(['小計','全員分の参考総額'])` | text | PRESENTATIONAL | GuestBooking.tsx |
| 96 | 5 | `locator('dl.guest-price')` | css:css-class+tag | PRESENTATIONAL | guest.css, GuestBooking.tsx |
| 96 | 2 | `toContainText('ウェア調整')` | text | PRESENTATIONAL | RecommendationWorkspace.tsx, GuestBooking.tsx |
| 97 | 1 | `toContainText('事前決済調整')` | text | PRESENTATIONAL | GuestBooking.tsx |
| 98 | 1 | `screenshot({path:'.local/screenshots/guest-review-mobile.png',fullPage:true})` | screenshot-path | PRESENTATIONAL | — (artifact path) |
| 103 | 6 | `getByText('保存されていない変更があります')` | text | PRESENTATIONAL | GuestBooking.tsx |
| 108 | 5 | `getByLabel('用品 1',{exact:true})` | label | BEHAVIOURAL | PublicChrome.tsx, AssetLabelSheet.tsx, StaffHome.tsx +8 |
| 124 | 1 | `assert.match(d.message(),/保存されていない入力/)` | regex | PRESENTATIONAL | GuestBooking.tsx |
| 125 | 2 | `getByRole('link',{name:'プランを見る',exact:true})` | role:link +name | BEHAVIOURAL | GuestBooking.tsx |
| 128 | 4 | `toHaveURL(/\/ja\/book$/)` | url | BEHAVIOURAL | globals.css, page.tsx, route.ts +39 |
| 134 | 2 | `getByRole('button',{name:'日程に戻る',exact:true})` | role:button +name | BEHAVIOURAL | GuestBooking.tsx |
| 139 | 1 | `waitForURL(/\/ja\/rental$/)` | url | BEHAVIOURAL | proxy.ts, sitemap.ts, page.tsx +36 |
| 149 | 1 | `getByLabel('利用人数',{exact:true})` | label | BEHAVIOURAL | GuestBooking.tsx |
| 150 | 3 | `getByLabel('ポールのサイズ 2',{exact:true})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx, GuestBooking.tsx |
| 151 | 1 | `getByText('利用者 2')` | text | PRESENTATIONAL | page.tsx, RecommendationWorkspace.tsx, QuoteWorkspace.tsx +3 |
| 155 | 1 | `toHaveCount(2)` | count | BEHAVIOURAL | — |
| 159 | 5 | `getByLabel('合成データによる開発確認であることを確認')` | label | BEHAVIOURAL | GuestBooking.tsx |
| 167 | 2 | `getByRole('button',{name:'処理しています…',exact:true})` | role:button +name | BEHAVIOURAL | GuestBooking.tsx |
| 167 | 1 | `toHaveAttribute('aria-busy','true')` | attribute | BEHAVIOURAL | StaffHome.tsx, SquareCardPayment.tsx, GuestBooking.tsx |
| 169 | 6 | `getByRole('status')` | role:status | BEHAVIOURAL | — |
| 169 | 1 | `filter({hasText:'処理中です'})` | text (filter hasText) | PRESENTATIONAL | GuestBooking.tsx |
| 172 | 1 | `getByRole('button',{name:'この内容で支払う（開発用決済）'})` | role:button +name | BEHAVIOURAL | GuestBooking.tsx |
| 172 | 2 | `getByRole('button',{name:'保存済みの結果を再読込'})` | role:button +name | BEHAVIOURAL | GuestBooking.tsx |
| 172 | 5 | `getByRole('main')` | role:main (landmark) | BEHAVIOURAL | — |
| 172 | 3 | `getByRole('alert')` | role:alert | BEHAVIOURAL | — |
| 172 | 1 | `toContainText('処理でエラーが発生しました')` | text | PRESENTATIONAL | GuestBooking.tsx |
| 172 | 2 | `getByRole('heading',{name:'予約が確認されました',exact:true})` | role:heading +name | BEHAVIOURAL | BookingAccess.tsx, GuestBooking.tsx |
| 172 | 1 | `getByRole('img',{name:'開発予約QR',exact:true})` | role:img +name | BEHAVIOURAL | GuestBooking.tsx, BookingWorkspace.tsx |
| 172 | 1 | `screenshot({path:'.local/screenshots/guest-confirmed-mobile.png',fullPage:true})` | screenshot-path | PRESENTATIONAL | — (artifact path) |
| 194 | 3 | `toHaveValue('')` | value | BEHAVIOURAL | — |
| 213 | 1 | `getByLabel('事前決済5％調整の見込みを確認する')` | label | BEHAVIOURAL | GuestBooking.tsx |
| 214 | 1 | `toHaveText(['小計','事前決済調整（見込み）','全員分の参考総額'])` | text | PRESENTATIONAL | GuestBooking.tsx |
| 216 | 3 | `locator('dl.guest-price dd')` | css:css-class+tag | PRESENTATIONAL | guest.css, GuestBooking.tsx |
| 216 | 3 | `innerText()` | text | PRESENTATIONAL | — |
| 216 | 1 | `assert.doesNotMatch(advanceRowValue,/¥0(?:[^0-9]\|$)/)` | regex | PRESENTATIONAL | route.ts, page.tsx, page.tsx +17 |
| 222 | 4 | `getByLabel('Start date',{exact:true})` | label | BEHAVIOURAL | GuestBooking.tsx |
| 222 | 2 | `getByLabel('End date',{exact:true})` | label | BEHAVIOURAL | GuestBooking.tsx |
| 222 | 2 | `getByRole('button',{name:'Choose equipment',exact:true})` | role:button +name | BEHAVIOURAL | GuestBooking.tsx |
| 222 | 2 | `getByLabel('Pole size 1',{exact:true})` | label | BEHAVIOURAL | GuestBooking.tsx |
| 222 | 3 | `getByRole('button',{name:'Review sizes and estimates',exact:true})` | role:button +name | BEHAVIOURAL | GuestBooking.tsx |
| 224 | 2 | `getByRole('radio',{name:/RECOMMENDED/i})` | role:radio +name | BEHAVIOURAL | AvatarCustomerPreview.tsx, RecommendationWorkspace.tsx, AvatarFitPreview.tsx +1 |
| 224 | 2 | `getByLabel('I confirm each person’s size, model promise and wear selections')` | label | BEHAVIOURAL | GuestBooking.tsx |
| 224 | 2 | `getByRole('button',{name:'Review the whole group',exact:true})` | role:button +name | BEHAVIOURAL | GuestBooking.tsx |
| 224 | 3 | `getByRole('region',{name:'Group review'})` | role:region (landmark) +name | BEHAVIOURAL | GuestBooking.tsx |
| 225 | 1 | `toHaveText(['Subtotal','Group estimate'])` | text | PRESENTATIONAL | GuestBooking.tsx |
| 226 | 1 | `toContainText('Wear adjustment')` | text | PRESENTATIONAL | GuestBooking.tsx |
| 227 | 1 | `toContainText('Estimated advance adjustment')` | text | PRESENTATIONAL | GuestBooking.tsx |
| 265 | 3 | `toContainText('スキーセット')` | text | PRESENTATIONAL | QuoteWorkspace.tsx, AmendmentWorkspace.tsx, GuestBooking.tsx +2 |
| 273 | 2 | `getByRole('button',{name:'条件を編集して再計算'})` | role:button +name | BEHAVIOURAL | GuestBooking.tsx |
| 284 | 1 | `toContainText('スノーボードセット')` | text | PRESENTATIONAL | GuestBooking.tsx |
| 286 | 4 | `getByRole('button',{name:'この内容で支払う（開発用決済）',exact:true})` | role:button +name | BEHAVIOURAL | GuestBooking.tsx |
| 287 | 1 | `getByText('内容が変更されています')` | text | PRESENTATIONAL | GuestBooking.tsx |
| 317 | 1 | `filter({hasText:'保存されていない変更があります'})` | text (filter hasText) | PRESENTATIONAL | GuestBooking.tsx |
| 322 | 2 | `filter({hasText:'未保存の入力を復元しました'})` | text (filter hasText) | PRESENTATIONAL | GuestBooking.tsx |
| 323 | 2 | `toHaveValue('SNOWBOARD')` | value | BEHAVIOURAL | PublicChrome.tsx, RecommendationWorkspace.tsx, PriceExplorer.tsx +9 |
| 325 | 5 | `getByRole('button',{name:/支払う/})` | role:button +name | BEHAVIOURAL | SquareCardPayment.tsx, GuestBooking.tsx |
| 349 | 1 | `toContainText('Ski set')` | text | PRESENTATIONAL | GuestBooking.tsx, PublicPage.tsx |
| 350 | 1 | `getByRole('button',{name:'Edit and recalculate'})` | role:button +name | BEHAVIOURAL | GuestBooking.tsx |
| 352 | 2 | `getByLabel('Equipment 1',{exact:true})` | label | BEHAVIOURAL | PublicChrome.tsx, AmendmentWorkspace.tsx, GuestBooking.tsx +1 |
| 353 | 1 | `filter({hasText:'unsaved changes'})` | text (filter hasText) | PRESENTATIONAL | GuestBooking.tsx |
| 358 | 1 | `filter({hasText:'Unsaved entries restored'})` | text (filter hasText) | PRESENTATIONAL | GuestBooking.tsx |
| 361 | 1 | `getByRole('button',{name:/Pay/})` | role:button +name | BEHAVIOURAL | BookingCancellation.tsx, AvatarCustomerPreview.tsx, GuestAvatarPreview.tsx +8 |
| 368 | 8 | `getByLabel(ja?'利用開始日':'Start date',{exact:true})` | label | BEHAVIOURAL | GuestBooking.tsx |
| 369 | 3 | `getByLabel(ja?'利用終了日':'End date',{exact:true})` | label | BEHAVIOURAL | GuestBooking.tsx |
| 370 | 6 | `getByRole('button',{name:ja?'用品を選ぶ':'Choose equipment',exact:true})` | role:button +name | BEHAVIOURAL | GuestBooking.tsx |
| 370 | 2 | `getByLabel((ja?'ポールのサイズ':'Pole size')+' 1',{exact:true})` | label | BEHAVIOURAL | GuestBooking.tsx |
| 371 | 4 | `getByRole('button',{name:ja?'候補と参考料金を確認':'Review sizes and estimates',exact:true})` | role:button +name | BEHAVIOURAL | GuestBooking.tsx |
| 371 | 3 | `getByRole('radio',{name:ja?/おすすめ/:/Recommended/})` | role:radio +name | BEHAVIOURAL | AvatarFitPreview.tsx, GuestBooking.tsx |
| 372 | 2 | `getByLabel(ja?'全員のサイズ・モデル条件・ウェア構成を確認した':'I confirm each person’s size, model promise and wear selections')` | label | BEHAVIOURAL | GuestBooking.tsx |
| 373 | 2 | `getByRole('button',{name:ja?'全員分の最終確認へ':'Review the whole group',exact:true})` | role:button +name | BEHAVIOURAL | GuestBooking.tsx |
| 373 | 2 | `getByRole('region',{name:ja?'全員分の確認':'Group review'})` | role:region (landmark) +name | BEHAVIOURAL | GuestBooking.tsx |
| 377 | 1 | `assert.doesNotMatch(await p.getByRole('main').innerText(),/\b[A-Z]{2,}_[A-Z_]{2,}\b/,'no internal enum or error code is customer-visible')` | regex | PRESENTATIONAL | pkg:core/contracts.ts |
| 381 | 1 | `getByLabel(ja?'利用枠':'Rental slot',{exact:true})` | label | BEHAVIOURAL | GuestBooking.tsx |
| 391 | 1 | `locator('#guest-err-'+key)` | css:id | PRESENTATIONAL | GuestBooking.tsx |
| 391 | 1 | `toContainText(copy!)` | text | PRESENTATIONAL | — |
| 391 | 5 | `toHaveAttribute('aria-invalid','true')` | attribute | BEHAVIOURAL | guest.css, GuestBooking.tsx |
| 394 | 1 | `getByLabel(ja?'用品 1':'Equipment 1',{exact:true})` | label | BEHAVIOURAL | PublicChrome.tsx, AmendmentWorkspace.tsx, GuestBooking.tsx +1 |
| 402 | 1 | `getByLabel(ja?'身長cm 1':'Height cm 1',{exact:true})` | label | BEHAVIOURAL | GuestBooking.tsx |
| 402 | 1 | `getByLabel(ja?'足サイズcm 1':'Foot size cm 1',{exact:true})` | label | BEHAVIOURAL | GuestBooking.tsx |
| 402 | 1 | `getByLabel(ja?'体重kg 1':'Weight kg 1',{exact:true})` | label | BEHAVIOURAL | GuestBooking.tsx |
| 402 | 1 | `getByLabel(ja?'開始日の年齢 1':'Age at start 1',{exact:true})` | label | BEHAVIOURAL | GuestBooking.tsx |
| 403 | 1 | `toHaveAttribute('min',min)` | attribute | PRESENTATIONAL | globals.css, page.tsx, page.tsx +33 |
| 403 | 1 | `toHaveAttribute('max',max)` | attribute | PRESENTATIONAL | globals.css, page.tsx, route.ts +46 |
| 403 | 1 | `toHaveAttribute('step',step)` | attribute | PRESENTATIONAL | HomeHero.tsx, guest.css, OpsWorkspace.tsx +4 |
| 404 | 2 | `toHaveAttribute('inputmode','numeric')` | attribute | PRESENTATIONAL | globals.css, public.css, GuestBooking.tsx +1 |
| 404 | 1 | `toHaveAttribute('inputmode','decimal')` | attribute | PRESENTATIONAL | GuestBooking.tsx |
| 412 | 1 | `locator('#guest-err-m0-'+key)` | css:id | PRESENTATIONAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 415 | 2 | `locator('#guest-err-m0-age')` | css:id | PRESENTATIONAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 415 | 1 | `toContainText(ja?'13歳以上は大人':'Adult for 13 or older')` | text | PRESENTATIONAL | GuestBooking.tsx |
| 416 | 1 | `getByLabel(ja?'年齢区分 1':'Age category 1',{exact:true})` | label | BEHAVIOURAL | GuestBooking.tsx |
| 418 | 1 | `locator('#guest-err-m0-pole')` | css:id | PRESENTATIONAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 426 | 2 | `getByLabel('身長cm 1',{exact:true})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx, GuestBooking.tsx |
| 430 | 1 | `assert.doesNotMatch(JSON.stringify(envelope),/@\|displayName\|email\|contact\|token\|paymentSource\|recovery\|qr/i,'only Input is stored')` | regex | PRESENTATIONAL | GuestBooking.tsx |
| 431 | 1 | `includes('172')` | substring | PRESENTATIONAL | avatar.css |
| 435 | 1 | `toHaveValue('172')` | value | BEHAVIOURAL | avatar.css |
| 435 | 1 | `toHaveValue('pole-'+variants.pole)` | value | BEHAVIOURAL | pkg:core/inventory-service.ts |
| 439 | 1 | `screenshot({path:'.local/screenshots/guest-restored-ja-390.png',fullPage:true})` | screenshot-path | PRESENTATIONAL | — (artifact path) |
| 452 | 2 | `getByText('未保存の入力を復元しました')` | text | PRESENTATIONAL | GuestBooking.tsx |
| 466 | 1 | `toHaveValue('2035-03-20')` | value | BEHAVIOURAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 477 | 2 | `toContainText('在庫を確保できませんでした')` | text | PRESENTATIONAL | GuestBooking.tsx |
| 478 | 2 | `getByRole('region',{name:'予約を続けられません'})` | role:region (landmark) +name | BEHAVIOURAL | GuestBooking.tsx |
| 481 | 1 | `screenshot({path:'.local/screenshots/guest-insufficient-stock-ja-390.png',fullPage:true})` | screenshot-path | PRESENTATIONAL | — (artifact path) |
| 495 | 1 | `toContainText('料金が更新されました')` | text | PRESENTATIONAL | GuestBooking.tsx |
| 496 | 3 | `getByRole('region',{name:'料金の更新'})` | role:region (landmark) +name | BEHAVIOURAL | GuestBooking.tsx |
| 496 | 1 | `toContainText(oldTotal)` | text | PRESENTATIONAL | — |
| 496 | 2 | `toContainText('7,600')` | text | PRESENTATIONAL | HomeHero.tsx |
| 499 | 1 | `screenshot({path:'.local/screenshots/guest-price-changed-ja-390.png',fullPage:true})` | screenshot-path | PRESENTATIONAL | — (artifact path) |
| 500 | 1 | `getByRole('button',{name:'新しい料金を確認して続ける',exact:true})` | role:button +name | BEHAVIOURAL | GuestBooking.tsx |
| 503 | 1 | `getByRole('button',{name:'この内容でもう一度支払う（開発用決済）',exact:true})` | role:button +name | BEHAVIOURAL | GuestBooking.tsx |
| 518 | 1 | `getByRole('button',{name:'保存済みの結果を再読込',exact:true})` | role:button +name | BEHAVIOURAL | GuestBooking.tsx |
| 519 | 1 | `toContainText('在庫の確保期限が切れました')` | text | PRESENTATIONAL | GuestBooking.tsx |
| 522 | 1 | `screenshot({path:'.local/screenshots/guest-hold-expired-ja-390.png',fullPage:true})` | screenshot-path | PRESENTATIONAL | — (artifact path) |
| 529 | 1 | `` screenshot({path:`.local/screenshots/guest-${n}-${locale}-${width}.png`,fullPage:true}) `` | screenshot-path | PRESENTATIONAL | — (artifact path) |
| 533 | 2 | `getByText(ja?'利用開始日を選択してください。':'Choose a start date.')` | text | PRESENTATIONAL | GuestBooking.tsx |
| 538 | 2 | `getByLabel(label,{exact:true})` | label | BEHAVIOURAL | — |
| 538 | 1 | `toHaveAttribute('inputmode',mode)` | attribute | PRESENTATIONAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 540 | 2 | `getByText(ja?'ポールのサイズを選択してください。':'Choose a pole size.')` | text | PRESENTATIONAL | GuestBooking.tsx |
| 543 | 1 | `toContainText(raw)` | text | PRESENTATIONAL | — |
| 547 | 1 | `toContainText(text)` | text | PRESENTATIONAL | — |
| 548 | 1 | `getByLabel(ja?'メール（架空）':'Email (synthetic)',{exact:true})` | label | BEHAVIOURAL | GuestBooking.tsx |
| 548 | 1 | `toHaveAttribute('inputmode','email')` | attribute | PRESENTATIONAL | BookingAccess.tsx, SquareCardPayment.tsx, StaffManagement.tsx +6 |
| 549 | 2 | `getByRole('button',{name:ja?'この内容で支払う（開発用決済）':'Pay with these details (test payment)',exact:true})` | role:button +name | BEHAVIOURAL | GuestBooking.tsx |
| 550 | 2 | `getByText(ja?'内容に同意したらチェックを入れてください。':'Tick this box to accept.')` | text | PRESENTATIONAL | GuestBooking.tsx |
| 551 | 1 | `getByLabel(ja?'合成データによる開発確認であることを確認':'I understand this is a synthetic development preview')` | label | BEHAVIOURAL | GuestBooking.tsx |
| 553 | 1 | `getByRole('heading',{name:ja?'予約が確認されました':'Booking confirmed',exact:true})` | role:heading +name | BEHAVIOURAL | BookingAccess.tsx, GuestBooking.tsx |
| 559 | 1 | `getByRole('button',{name:'この予約画面を閉じる'})` | role:button +name | BEHAVIOURAL | GuestBooking.tsx |
| 559 | 1 | `waitForURL(app!.origin+'/ja')` | url | BEHAVIOURAL | page.tsx, page.tsx |
| 568 | 1 | `getByRole('button',{name:'スタッフを作成',exact:true})` | role:button +name | BEHAVIOURAL | StaffManagement.tsx |
| 569 | 1 | `getByRole('form',{name:'スタッフ作成'})` | role:form (landmark) +name | BEHAVIOURAL | StaffManagement.tsx |
| 569 | 1 | `getByLabel('表示名',{exact:true})` | label | BEHAVIOURAL | StaffManagement.tsx |
| 569 | 1 | `getByLabel('初期パスワード（15〜128文字）')` | label | BEHAVIOURAL | StaffManagement.tsx |
| 569 | 1 | `getByLabel('Mountain Station',{exact:true})` | label | BEHAVIOURAL | pkg:contracts/store-display.ts |
| 571 | 1 | `getByRole('button',{name:'スタッフ設定を保存'})` | role:button +name | BEHAVIOURAL | StaffManagement.tsx |
| 571 | 1 | `includes('application/json')` | substring | PRESENTATIONAL | BookingCancellation.tsx, useOperationsRequest.ts, OpsWorkspace.tsx +24 |
| 571 | 1 | `getByRole('heading',{name:'SYNTHETIC Handoff',exact:true})` | role:heading +name | BEHAVIOURAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 573 | 2 | `getByRole('button',{name:'予約と仮割当を照合'})` | role:button +name | BEHAVIOURAL | CustodyWorkspace.tsx |
| 573 | 3 | `getByLabel('予約IDまたは予約QR')` | label | BEHAVIOURAL | CustodyWorkspace.tsx, BookingSearchInput.tsx |
| 573 | 2 | `toHaveValue('zao-rental:reservation:'+booking.id)` | value | BEHAVIOURAL | CustodyWorkspace.tsx |
| 573 | 1 | `includes('/api/custody/booking/')` | substring | PRESENTATIONAL | globals.css, page.tsx, route.ts +34 |
| 573 | 2 | `getByRole('region',{name:'貸出用品'})` | role:region (landmark) +name | BEHAVIOURAL | CustodyWorkspace.tsx |
| 573 | 1 | `toContainText('LATE_PICKUP_ELIGIBLE')` | text | PRESENTATIONAL | pkg:core/manifest-service.ts, contracts/pickup.ts |
| 573 | 1 | `getByLabel('準備・最終適合の作業記録')` | label | BEHAVIOURAL | CustodyWorkspace.tsx |
| 573 | 1 | `getByLabel('表示された個体と数量を照合した')` | label | BEHAVIOURAL | CustodyWorkspace.tsx |
| 573 | 1 | `getByRole('button',{name:'照合した用品を準備固定'})` | role:button +name | BEHAVIOURAL | CustodyWorkspace.tsx |
| 573 | 1 | `getByRole('button',{name:'道具の貸出を記録'})` | role:button +name | BEHAVIOURAL | CustodyWorkspace.tsx |
| 573 | 1 | `toContainText('OUT')` | text | PRESENTATIONAL | page.tsx, page.tsx, OpsWorkspace.tsx +5 |
| 573 | 1 | `screenshot({path:'.local/screenshots/late-pickup-staff-mobile.png',fullPage:true})` | screenshot-path | PRESENTATIONAL | — (artifact path) |
| 576 | 1 | `screenshot({path:'.local/screenshots/public-failure.png',fullPage:true})` | screenshot-path | PRESENTATIONAL | — (artifact path) |
| 576 | 1 | `evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,wide:[...document.querySelectorAll('*')].filter(e=>e.getBoundingClientRect().right>innerWidth+1).map(e=>({tag:e.tagName,cls:e.className,width:e.getBoundingClientRect().width})).slice(0,10)}))` | computed-style | PRESENTATIONAL | — |
| 576 | 1 | `querySelectorAll('*')` | css:other | BEHAVIOURAL | — |
| 576 | 1 | `locator('[role=alert],[role=status]')` | css:attr | BEHAVIOURAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |

### `tests/public/content-ui.ts`

| L | n | locator / assertion (verbatim) | kind | B/P | producing component |
|---|---|---|---|---|---|
| 19 | 1 | `getByLabel('メールアドレス',{exact:true})` | label | BEHAVIOURAL | GuestRecovery.tsx, StaffManagement.tsx, StaffLogin.tsx +2 |
| 19 | 1 | `getByLabel('パスワード',{exact:true})` | label | BEHAVIOURAL | page.tsx, StaffHome.tsx, StaffManagement.tsx +3 |
| 19 | 1 | `getByRole('button',{name:'ログイン',exact:true})` | role:button +name | BEHAVIOURAL | page.tsx, page.tsx, page.tsx +21 |
| 19 | 1 | `waitForURL(origin+'/staff/ledger')` | url | BEHAVIOURAL | page.tsx, page.tsx, OpsWorkspace.tsx +9 |
| 21 | 1 | `getByRole('region',{name:'現在の下書き'})` | role:region (landmark) +name | BEHAVIOURAL | ContentWorkspace.tsx |
| 21 | 1 | `toContainText('合成スキー')` | text | PRESENTATIONAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 22 | 1 | `getByLabel('CSVファイル')` | label | BEHAVIOURAL | InventoryOperationsWorkspace.tsx, ContentWorkspace.tsx |
| 22 | 1 | `getByRole('button',{name:'差分を検証して保存'})` | role:button +name | BEHAVIOURAL | ContentWorkspace.tsx |
| 22 | 1 | `getByRole('button',{name:/^有効な下書きを反映/})` | role:button +name | BEHAVIOURAL | ContentWorkspace.tsx |
| 22 | 2 | `getByRole('status',{name:'説明処理状態'})` | role:status +name | BEHAVIOURAL | ContentWorkspace.tsx |
| 22 | 1 | `toContainText('一部の下書きを保存済み')` | text | PRESENTATIONAL | ContentWorkspace.tsx |
| 22 | 1 | `getByRole('button',{name:'下書き全体のreleaseを検証'})` | role:button +name | BEHAVIOURAL | ContentWorkspace.tsx |
| 22 | 1 | `getByRole('button',{name:/^非公開releaseへ反映/})` | role:button +name | BEHAVIOURAL | ContentWorkspace.tsx |
| 22 | 1 | `toContainText('保存済み')` | text | PRESENTATIONAL | page.tsx, useOperationsRequest.ts, RecommendationWorkspace.tsx +14 |
| 23 | 1 | `assert.match(html,/Synthetic English description updated/)` | regex-on-html | PRESENTATIONAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 23 | 1 | `assert.match(html,/150 cm/)` | regex-on-html | PRESENTATIONAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 23 | 1 | `assert.doesNotMatch(html,/155 CM/)` | regex-on-html | PRESENTATIONAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 23 | 1 | `assert.match(html,/srcSet=/i)` | regex-on-html | PRESENTATIONAL | page.tsx, HomeCampaigns.tsx, PublicPage.tsx |
| 23 | 1 | `assert.match(html,/width="800"/)` | regex-on-html | PRESENTATIONAL | LaunchGateView.tsx, HomeCampaigns.tsx, salomon-s-path.ts +2 |
| 23 | 1 | `assert.match(html,/hrefLang="ja"/i)` | regex-on-html | PRESENTATIONAL | proxy.ts, sitemap.ts, layout.tsx +38 |
| 23 | 1 | `evaluate(()=>document.documentElement.scrollWidth<=innerWidth)` | computed-style (no h-overflow) | PRESENTATIONAL | — |
| 23 | 1 | `screenshot({path:'.local/screenshots/public-model-en-mobile.png',fullPage:true})` | screenshot-path | PRESENTATIONAL | — (artifact path) |
| 23 | 1 | `assert.doesNotMatch(await (await anon.request.get('/sitemap.xml')).text(),/<loc>/)` | regex-on-html | PRESENTATIONAL | robots.ts |
| 24 | 1 | `getByLabel('写真ファイル')` | label | BEHAVIOURAL | ContentPhotoWorkspace.tsx |
| 24 | 1 | `getByRole('button',{name:'選択した写真を送信・再開'})` | role:button +name | BEHAVIOURAL | ContentPhotoWorkspace.tsx |
| 24 | 1 | `getByRole('status',{name:'写真処理状態'})` | role:status +name | BEHAVIOURAL | ContentPhotoWorkspace.tsx |
| 24 | 1 | `toContainText('未確認')` | text | PRESENTATIONAL | useOperationsRequest.ts, OpsWorkspace.tsx, RecommendationWorkspace.tsx +15 |
| 24 | 1 | `getByRole('button',{name:'保存済み写真jobを照合'})` | role:button +name | BEHAVIOURAL | ContentPhotoWorkspace.tsx |
| 24 | 1 | `getByRole('region',{name:'写真一括fixture'})` | role:region (landmark) +name | BEHAVIOURAL | ContentPhotoWorkspace.tsx |
| 24 | 1 | `toContainText('変換済み 1')` | text | PRESENTATIONAL | ContentPhotoWorkspace.tsx |
| 24 | 1 | `screenshot({path:'.local/screenshots/content-pg-mobile.png',fullPage:true})` | screenshot-path | PRESENTATIONAL | — (artifact path) |
| 25 | 1 | `assert.doesNotMatch(await (await anon.request.get('/sitemap.xml')).text(),/synthetic-ski/)` | regex-on-html | PRESENTATIONAL | robots.ts |

### `tests/readiness/guest-ui.ts`

| L | n | locator / assertion (verbatim) | kind | B/P | producing component |
|---|---|---|---|---|---|
| 12 | 4 | `getByLabel('利用開始日',{exact:true})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx, QuoteWorkspace.tsx, GuestBooking.tsx |
| 12 | 1 | `getByLabel('利用終了日',{exact:true})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx, QuoteWorkspace.tsx, GuestBooking.tsx |
| 12 | 1 | `getByRole('button',{name:'用品を選ぶ',exact:true})` | role:button +name | BEHAVIOURAL | GuestBooking.tsx |
| 12 | 1 | `getByLabel('ポールのサイズ 1',{exact:true})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx, GuestBooking.tsx |
| 12 | 1 | `getByRole('button',{name:'候補と参考料金を確認',exact:true})` | role:button +name | BEHAVIOURAL | GuestBooking.tsx |
| 12 | 2 | `getByRole('radio',{name:/おすすめ/})` | role:radio +name | BEHAVIOURAL | RecommendationWorkspace.tsx, AvatarFitPreview.tsx, GuestBooking.tsx |
| 13 | 3 | `getByText('予約をお持ちの方はこちら',{exact:true})` | text | PRESENTATIONAL | GuestBooking.tsx |
| 13 | 1 | `getByRole('button',{name:'回復コードを作成',exact:true})` | role:button +name | BEHAVIOURAL | GuestRecovery.tsx |
| 13 | 2 | `getByRole('region',{name:'予約画面の回復'})` | role:region (landmark) +name | BEHAVIOURAL | GuestRecovery.tsx |
| 13 | 2 | `getByRole('status')` | role:status | BEHAVIOURAL | — |
| 13 | 1 | `toContainText('安全な場所')` | text | PRESENTATIONAL | GuestRecovery.tsx |
| 13 | 1 | `getByLabel('保存する回復コード')` | label | BEHAVIOURAL | GuestRecovery.tsx |
| 14 | 2 | `getByLabel('控えた回復コード')` | label | BEHAVIOURAL | GuestRecovery.tsx |
| 14 | 2 | `getByRole('button',{name:'保存済み予約画面を回復'})` | role:button +name | BEHAVIOURAL | GuestRecovery.tsx |
| 14 | 1 | `toContainText('未確認')` | text | PRESENTATIONAL | useOperationsRequest.ts, OpsWorkspace.tsx, RecommendationWorkspace.tsx +15 |
| 15 | 1 | `evaluate(()=>document.documentElement.scrollWidth<=innerWidth)` | computed-style (no h-overflow) | PRESENTATIONAL | — |
| 15 | 1 | `screenshot({path:'.local/screenshots/p1-recovered-guest.png',fullPage:true})` | screenshot-path | PRESENTATIONAL | — (artifact path) |

### `tests/readiness/booking-access-ui.ts`

| L | n | locator / assertion (verbatim) | kind | B/P | producing component |
|---|---|---|---|---|---|
| 13 | 1 | `assert.match(t,/^[0-9:T+-]+$/)` | regex | PRESENTATIONAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 16 | 2 | `getByLabel('利用開始日',{exact:true})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx, QuoteWorkspace.tsx, GuestBooking.tsx |
| 16 | 1 | `getByLabel('利用終了日',{exact:true})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx, QuoteWorkspace.tsx, GuestBooking.tsx |
| 16 | 1 | `getByRole('button',{name:'用品を選ぶ',exact:true})` | role:button +name | BEHAVIOURAL | GuestBooking.tsx |
| 16 | 1 | `getByLabel('ポールのサイズ 1',{exact:true})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx, GuestBooking.tsx |
| 16 | 1 | `getByRole('button',{name:'候補と参考料金を確認',exact:true})` | role:button +name | BEHAVIOURAL | GuestBooking.tsx |
| 16 | 1 | `getByRole('radio',{name:/おすすめ/})` | role:radio +name | BEHAVIOURAL | RecommendationWorkspace.tsx, AvatarFitPreview.tsx, GuestBooking.tsx |
| 16 | 1 | `getByRole('checkbox',{name:'全員のサイズ・モデル条件・ウェア構成を確認した'})` | role:checkbox +name | BEHAVIOURAL | GuestBooking.tsx |
| 16 | 1 | `getByRole('button',{name:'全員分の最終確認へ'})` | role:button +name | BEHAVIOURAL | GuestBooking.tsx |
| 16 | 1 | `getByRole('checkbox',{name:'合成データによる開発確認であることを確認'})` | role:checkbox +name | BEHAVIOURAL | GuestBooking.tsx |
| 16 | 1 | `getByRole('button',{name:'この内容で支払う（開発用決済）'})` | role:button +name | BEHAVIOURAL | GuestBooking.tsx |
| 16 | 1 | `getByRole('heading',{name:'予約が確認されました',exact:true})` | role:heading +name | BEHAVIOURAL | BookingAccess.tsx, GuestBooking.tsx |
| 18 | 5 | `getByRole('button',{name:'予約閲覧をこの端末へ保存'})` | role:button +name | BEHAVIOURAL | BookingAccess.tsx |
| 18 | 1 | `getByRole('region',{name:'予約閲覧の保存'})` | role:region (landmark) +name | BEHAVIOURAL | BookingAccess.tsx |
| 18 | 4 | `getByRole('status')` | role:status | BEHAVIOURAL | — |
| 18 | 2 | `toContainText('未確認')` | text | PRESENTATIONAL | useOperationsRequest.ts, OpsWorkspace.tsx, RecommendationWorkspace.tsx +15 |
| 18 | 2 | `getByRole('link',{name:'保存した予約とQRを開く'})` | role:link +name | BEHAVIOURAL | BookingAccess.tsx |
| 18 | 6 | `getByRole('img',{name:'保存済み予約QR'})` | role:img +name | BEHAVIOURAL | BookingAccess.tsx |
| 40 | 4 | `getByRole('button',{name:'予約を再読込',exact:true})` | role:button +name | BEHAVIOURAL | BookingAccess.tsx |
| 41 | 2 | `toHaveCount(0)` | count | BEHAVIOURAL | — |
| 42 | 5 | `getByRole('button',{name:'この端末の予約閲覧権を失効'})` | role:button +name | BEHAVIOURAL | BookingAccess.tsx |
| 73 | 2 | `toContainText('失効しました')` | text | PRESENTATIONAL | BookingAccess.tsx, BookingRecovery.tsx |
| 105 | 1 | `assert.match(response.headers()['cache-control']!,/no-store/)` | regex | PRESENTATIONAL | proxy.ts, route.ts, route.ts +55 |
| 108 | 1 | `evaluate(()=>document.documentElement.scrollWidth<=innerWidth)` | computed-style (no h-overflow) | PRESENTATIONAL | — |
| 108 | 1 | `screenshot({path:'.local/screenshots/p4-confirmed-booking.png',fullPage:true})` | screenshot-path | PRESENTATIONAL | — (artifact path) |

### `tests/readiness/booking-recovery-ui.ts`

| L | n | locator / assertion (verbatim) | kind | B/P | producing component |
|---|---|---|---|---|---|
| 13 | 1 | `assert.match(t,/^[0-9:T+-]+$/)` | regex | PRESENTATIONAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 16 | 2 | `getByLabel('利用開始日',{exact:true})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx, QuoteWorkspace.tsx, GuestBooking.tsx |
| 16 | 1 | `getByLabel('利用終了日',{exact:true})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx, QuoteWorkspace.tsx, GuestBooking.tsx |
| 16 | 1 | `getByRole('button',{name:'用品を選ぶ',exact:true})` | role:button +name | BEHAVIOURAL | GuestBooking.tsx |
| 16 | 1 | `getByLabel('ポールのサイズ 1',{exact:true})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx, GuestBooking.tsx |
| 16 | 1 | `getByRole('button',{name:'候補と参考料金を確認',exact:true})` | role:button +name | BEHAVIOURAL | GuestBooking.tsx |
| 16 | 1 | `getByRole('radio',{name:/おすすめ/})` | role:radio +name | BEHAVIOURAL | RecommendationWorkspace.tsx, AvatarFitPreview.tsx, GuestBooking.tsx |
| 16 | 1 | `getByRole('checkbox',{name:'全員のサイズ・モデル条件・ウェア構成を確認した'})` | role:checkbox +name | BEHAVIOURAL | GuestBooking.tsx |
| 16 | 1 | `getByRole('button',{name:'全員分の最終確認へ'})` | role:button +name | BEHAVIOURAL | GuestBooking.tsx |
| 16 | 1 | `getByRole('checkbox',{name:'合成データによる開発確認であることを確認'})` | role:checkbox +name | BEHAVIOURAL | GuestBooking.tsx |
| 16 | 1 | `getByRole('button',{name:'この内容で支払う（開発用決済）'})` | role:button +name | BEHAVIOURAL | GuestBooking.tsx |
| 16 | 1 | `getByRole('heading',{name:'予約が確認されました',exact:true})` | role:heading +name | BEHAVIOURAL | BookingAccess.tsx, GuestBooking.tsx |
| 29 | 5 | `getByRole('img',{name:'保存済み予約QR'})` | role:img +name | BEHAVIOURAL | BookingAccess.tsx |
| 29 | 3 | `toHaveCount(0)` | count | BEHAVIOURAL | — |
| 32 | 5 | `getByLabel('予約復旧コード',{exact:true})` | label | BEHAVIOURAL | BookingRecovery.tsx |
| 39 | 3 | `getByRole('button',{name:'復旧コードで予約を開く',exact:true})` | role:button +name | BEHAVIOURAL | BookingRecovery.tsx |
| 41 | 2 | `getByRole('region',{name:'予約閲覧の復旧'})` | role:region (landmark) +name | BEHAVIOURAL | BookingRecovery.tsx |
| 41 | 2 | `getByRole('status')` | role:status | BEHAVIOURAL | — |
| 41 | 1 | `toContainText('未確認')` | text | PRESENTATIONAL | useOperationsRequest.ts, OpsWorkspace.tsx, RecommendationWorkspace.tsx +15 |
| 56 | 1 | `getByRole('button',{name:'予約をキャンセル',exact:true})` | role:button +name | BEHAVIOURAL | BookingCancellation.tsx |
| 56 | 1 | `getByRole('heading',{name:'キャンセル内容の最終確認'})` | role:heading +name | BEHAVIOURAL | BookingCancellation.tsx |
| 58 | 1 | `getByRole('button',{name:'この返金額でキャンセルを確定'})` | role:button +name | BEHAVIOURAL | BookingCancellation.tsx |
| 59 | 1 | `getByRole('heading',{name:'予約をキャンセルしました'})` | role:heading +name | BEHAVIOURAL | BookingCancellation.tsx |
| 59 | 1 | `getByRole('region',{name:'キャンセル状況'})` | role:region (landmark) +name | BEHAVIOURAL | BookingCancellation.tsx |
| 59 | 1 | `toContainText('返金処理待ち')` | text | PRESENTATIONAL | BookingCancellation.tsx |
| 61 | 1 | `getByRole('region',{name:'Cancellation status'})` | role:region (landmark) +name | BEHAVIOURAL | BookingCancellation.tsx |
| 61 | 1 | `toContainText('Refund pending')` | text | PRESENTATIONAL | BookingCancellation.tsx |
| 63 | 1 | `getByRole('button',{name:'この復旧コードを失効',exact:true})` | role:button +name | BEHAVIOURAL | BookingRecovery.tsx |
| 63 | 1 | `toContainText('失効しました')` | text | PRESENTATIONAL | BookingAccess.tsx, BookingRecovery.tsx |
| 64 | 1 | `evaluate(()=>document.documentElement.scrollWidth<=innerWidth)` | computed-style (no h-overflow) | PRESENTATIONAL | — |
| 65 | 1 | `screenshot({path:'.local/screenshots/p5-recovery-after-revoke.png',fullPage:true})` | screenshot-path | PRESENTATIONAL | — (artifact path) |
| 67 | 1 | `includes('interrupted by another navigation')` | substring | PRESENTATIONAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 67 | 1 | `includes('Timeout')` | substring | PRESENTATIONAL | StaffHome.tsx, staff-runtime.ts, square-s2-acceptance.ts +4 |

### `tests/readiness/cancellation-ui.ts`

| L | n | locator / assertion (verbatim) | kind | B/P | producing component |
|---|---|---|---|---|---|
| 13 | 1 | `assert.match(t,/^[0-9:T+-]+$/)` | regex | PRESENTATIONAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 16 | 2 | `getByLabel('利用開始日',{exact:true})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx, QuoteWorkspace.tsx, GuestBooking.tsx |
| 16 | 1 | `getByLabel('利用終了日',{exact:true})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx, QuoteWorkspace.tsx, GuestBooking.tsx |
| 16 | 1 | `getByRole('button',{name:'用品を選ぶ',exact:true})` | role:button +name | BEHAVIOURAL | GuestBooking.tsx |
| 16 | 1 | `getByLabel('ポールのサイズ 1',{exact:true})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx, GuestBooking.tsx |
| 16 | 1 | `getByRole('button',{name:'候補と参考料金を確認',exact:true})` | role:button +name | BEHAVIOURAL | GuestBooking.tsx |
| 16 | 1 | `getByRole('radio',{name:/おすすめ/})` | role:radio +name | BEHAVIOURAL | RecommendationWorkspace.tsx, AvatarFitPreview.tsx, GuestBooking.tsx |
| 16 | 1 | `getByRole('checkbox',{name:'全員のサイズ・モデル条件・ウェア構成を確認した'})` | role:checkbox +name | BEHAVIOURAL | GuestBooking.tsx |
| 16 | 1 | `getByRole('button',{name:'全員分の最終確認へ'})` | role:button +name | BEHAVIOURAL | GuestBooking.tsx |
| 16 | 1 | `getByRole('checkbox',{name:'合成データによる開発確認であることを確認'})` | role:checkbox +name | BEHAVIOURAL | GuestBooking.tsx |
| 16 | 1 | `getByRole('button',{name:'この内容で支払う（開発用決済）'})` | role:button +name | BEHAVIOURAL | GuestBooking.tsx |
| 16 | 1 | `getByRole('heading',{name:'予約が確認されました',exact:true})` | role:heading +name | BEHAVIOURAL | BookingAccess.tsx, GuestBooking.tsx |
| 20 | 1 | `getByRole('button',{name:'予約閲覧をこの端末へ保存'})` | role:button +name | BEHAVIOURAL | BookingAccess.tsx |
| 20 | 1 | `getByRole('link',{name:'保存した予約とQRを開く'})` | role:link +name | BEHAVIOURAL | BookingAccess.tsx |
| 21 | 2 | `getByRole('button',{name:'予約をキャンセル',exact:true})` | role:button +name | BEHAVIOURAL | BookingCancellation.tsx |
| 21 | 1 | `getByRole('region',{name:'予約のキャンセル',exact:true})` | role:region (landmark) +name | BEHAVIOURAL | BookingCancellation.tsx, BookingRecovery.tsx |
| 21 | 1 | `toContainText(new Intl.NumberFormat('ja-JP',{style:'currency',currency:'JPY',maximumFractionDigits:0}).format(before.price_snapshot.totalJpy))` | text | PRESENTATIONAL | BookingCancellation.tsx, StaffHome.tsx, SquareCardPayment.tsx +1 |
| 22 | 1 | `getByRole('button',{name:'予約を維持する'})` | role:button +name | BEHAVIOURAL | BookingCancellation.tsx |
| 22 | 3 | `getByRole('button',{name:'この返金額でキャンセルを確定'})` | role:button +name | BEHAVIOURAL | BookingCancellation.tsx |
| 22 | 3 | `toHaveCount(0)` | count | BEHAVIOURAL | — |
| 25 | 1 | `getByRole('heading',{name:'予約をキャンセルしました'})` | role:heading +name | BEHAVIOURAL | BookingCancellation.tsx |
| 25 | 1 | `getByRole('region',{name:'キャンセル状況'})` | role:region (landmark) +name | BEHAVIOURAL | BookingCancellation.tsx |
| 25 | 1 | `toContainText('返金処理待ち')` | text | PRESENTATIONAL | BookingCancellation.tsx |
| 26 | 1 | `getByRole('region',{name:'Cancellation status'})` | role:region (landmark) +name | BEHAVIOURAL | BookingCancellation.tsx |
| 26 | 1 | `toContainText('Refund pending')` | text | PRESENTATIONAL | BookingCancellation.tsx |
| 26 | 1 | `locator('main')` | css:tag | PRESENTATIONAL | — |
| 26 | 1 | `getByRole('img')` | role:img | BEHAVIOURAL | — |
| 26 | 1 | `evaluate(()=>document.documentElement.scrollWidth<=innerWidth)` | computed-style (no h-overflow) | PRESENTATIONAL | — |
| 26 | 1 | `screenshot({path:'.local/screenshots/cancellation-en-mobile.png',fullPage:true})` | screenshot-path | PRESENTATIONAL | — (artifact path) |
| 27 | 1 | `getByRole('region',{name:'Saved booking'})` | role:region (landmark) +name | BEHAVIOURAL | BookingAccess.tsx |
| 27 | 1 | `toContainText('Booking cancelled')` | text | PRESENTATIONAL | BookingCancellation.tsx, BookingAccess.tsx |
| 27 | 1 | `getByRole('img',{name:'Saved booking QR'})` | role:img +name | BEHAVIOURAL | BookingAccess.tsx |

### `tests/readiness/normal-production-ui.ts`

| L | n | locator / assertion (verbatim) | kind | B/P | producing component |
|---|---|---|---|---|---|
| 43 | 2 | `getByRole('heading',{name:'予約が確認されました',exact:true})` | role:heading +name | BEHAVIOURAL | BookingAccess.tsx, GuestBooking.tsx |
| 43 | 1 | `assert.ok((await page.textContent('body'))?.includes(draft.booking!.id))` | assert | PRESENTATIONAL | layout.tsx, globals.css, route.ts +48 |
| 43 | 1 | `textContent('body')` | text | PRESENTATIONAL | layout.tsx, globals.css, route.ts +48 |
| 43 | 2 | `locator('[data-avatar-stage]')` | css:attr | BEHAVIOURAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 45 | 1 | `evaluate(()=>document.documentElement.scrollWidth<=innerWidth)` | computed-style (no h-overflow) | PRESENTATIONAL | — |
| 46 | 2 | `getByLabel('利用開始日',{exact:true})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx, QuoteWorkspace.tsx, GuestBooking.tsx |
| 46 | 1 | `getByLabel('利用終了日',{exact:true})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx, QuoteWorkspace.tsx, GuestBooking.tsx |
| 46 | 1 | `getByRole('button',{name:'用品を選ぶ',exact:true})` | role:button +name | BEHAVIOURAL | GuestBooking.tsx |
| 46 | 1 | `getByLabel('ポールのサイズ 1',{exact:true})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx, GuestBooking.tsx |
| 46 | 1 | `getByRole('button',{name:'候補と参考料金を確認',exact:true})` | role:button +name | BEHAVIOURAL | GuestBooking.tsx |
| 46 | 1 | `getByRole('radio',{name:/おすすめ/})` | role:radio +name | BEHAVIOURAL | RecommendationWorkspace.tsx, AvatarFitPreview.tsx, GuestBooking.tsx |

### `tests/staff/home-ui.ts`

| L | n | locator / assertion (verbatim) | kind | B/P | producing component |
|---|---|---|---|---|---|
| 56 | 1 | `getByLabel('メールアドレス',{exact:true})` | label | BEHAVIOURAL | GuestRecovery.tsx, StaffManagement.tsx, StaffLogin.tsx +2 |
| 56 | 1 | `getByLabel('パスワード',{exact:true})` | label | BEHAVIOURAL | page.tsx, StaffHome.tsx, StaffManagement.tsx +3 |
| 56 | 1 | `getByRole('button',{name:'ログイン',exact:true})` | role:button +name | BEHAVIOURAL | page.tsx, page.tsx, page.tsx +21 |
| 56 | 1 | `waitForURL('**/staff/ledger')` | url | BEHAVIOURAL | page.tsx, globals.css, route.ts +78 |
| 78 | 7 | `getByRole('region',{name:'本日の業務'})` | role:region (landmark) +name | BEHAVIOURAL | StaffHome.tsx |
| 79 | 5 | `getByRole('region',{name:'本日の予約'})` | role:region (landmark) +name | BEHAVIOURAL | StaffHome.tsx |
| 81 | 1 | `getByRole('region',{name:'店舗・営業日'})` | role:region (landmark) +name | BEHAVIOURAL | StaffHome.tsx |
| 84 | 4 | `getByRole('heading',{name:'スタッフホーム'})` | role:heading +name | BEHAVIOURAL | page.tsx, StaffHome.tsx |
| 85 | 1 | `getByRole('region',{name:'予約QR・検索'})` | role:region (landmark) +name | BEHAVIOURAL | BookingSearchInput.tsx |
| 89 | 5 | `toContainText(businessDate)` | text | PRESENTATIONAL | — |
| 91 | 1 | `getByRole('region',{name:'運用の注意事項'})` | role:region (landmark) +name | BEHAVIOURAL | StaffHome.tsx |
| 92 | 2 | `getByText('その他の管理機能')` | text | PRESENTATIONAL | StaffHome.tsx |
| 93 | 3 | `getByRole('link',{name})` | role:link +name | BEHAVIOURAL | — |
| 100 | 2 | `getByRole('region',{name:label})` | role:region (landmark) +name | BEHAVIOURAL | — |
| 100 | 12 | `toHaveCount(0)` | count | BEHAVIOURAL | — |
| 101 | 13 | `locator('.staff-card',{hasText:'SYNTHETIC UX5D Confirmed'})` | css:css-class | PRESENTATIONAL | StaffHome.tsx, staff-home.css, StaffManagement.tsx |
| 101 | 1 | `getByRole('button')` | role:button | BEHAVIOURAL | — |
| 118 | 2 | `toContainText(forbidden)` | text | PRESENTATIONAL | — |
| 124 | 1 | `toContainText('確定済み')` | text | PRESENTATIONAL | StaffHome.tsx, GuestBooking.tsx |
| 127 | 1 | `locator('.staff-card',{hasText:'SYNTHETIC UX5D Pending'})` | css:css-class | PRESENTATIONAL | StaffHome.tsx, staff-home.css, StaffManagement.tsx |
| 127 | 1 | `toContainText('決済照合待ち')` | text | PRESENTATIONAL | StaffHome.tsx, GuestBooking.tsx |
| 128 | 1 | `getByRole('button',{name:'貸出・受付で状態を確認'})` | role:button +name | BEHAVIOURAL | StaffHome.tsx |
| 133 | 1 | `toContainText('準備')` | text | PRESENTATIONAL | page.tsx, page.tsx, RecommendationWorkspace.tsx +11 |
| 134 | 1 | `getByRole('button',{name:'準備へ進む'})` | role:button +name | BEHAVIOURAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 135 | 2 | `waitForURL(new RegExp('/staff/rentals\\?booking='+confirmedId))` | url | BEHAVIOURAL | page.tsx, globals.css, route.ts +78 |
| 136 | 6 | `getByRole('region',{name:'貸出用品'})` | role:region (landmark) +name | BEHAVIOURAL | CustodyWorkspace.tsx |
| 136 | 3 | `toContainText(confirmedId)` | text | PRESENTATIONAL | — |
| 141 | 1 | `getByLabel('予約番号または予約QR')` | label | BEHAVIOURAL | BookingSearchInput.tsx |
| 142 | 1 | `getByRole('button',{name:'この予約を開く',exact:true})` | role:button +name | BEHAVIOURAL | BookingSearchInput.tsx |
| 145 | 2 | `getByLabel('準備・最終適合の作業記録')` | label | BEHAVIOURAL | CustodyWorkspace.tsx |
| 146 | 2 | `getByLabel('表示された個体と数量を照合した')` | label | BEHAVIOURAL | CustodyWorkspace.tsx |
| 147 | 2 | `getByRole('button',{name:'照合した用品を準備固定'})` | role:button +name | BEHAVIOURAL | CustodyWorkspace.tsx |
| 148 | 2 | `getByRole('button',{name:'道具の貸出を記録'})` | role:button +name | BEHAVIOURAL | CustodyWorkspace.tsx |
| 149 | 2 | `toContainText('OUT')` | text | PRESENTATIONAL | page.tsx, page.tsx, OpsWorkspace.tsx +5 |
| 164 | 1 | `toContainText('返却受付')` | text | PRESENTATIONAL | StaffHome.tsx |
| 167 | 3 | `toContainText('検品待ち')` | text | PRESENTATIONAL | StaffHome.tsx, TransferWorkspace.tsx, CustodyWorkspace.tsx +1 |
| 172 | 2 | `toContainText('要注意')` | text | PRESENTATIONAL | StaffHome.tsx |
| 185 | 5 | `getByLabel('対象店舗')` | label | BEHAVIOURAL | StaffHome.tsx, InventoryOperationsWorkspace.tsx |
| 189 | 5 | `toContainText('現在対応が必要な項目はありません')` | text | PRESENTATIONAL | StaffHome.tsx |
| 202 | 1 | `toContainText(crossStoreId)` | text | PRESENTATIONAL | — |
| 216 | 1 | `locator('.staff-card',{hasText:/^スキー(?!ブーツ)/})` | css:css-class | PRESENTATIONAL | StaffHome.tsx, staff-home.css, StaffManagement.tsx |
| 218 | 1 | `toContainText('Mountain Station')` | text | PRESENTATIONAL | pkg:contracts/store-display.ts |
| 218 | 1 | `toContainText('Central Station')` | text | PRESENTATIONAL | pkg:contracts/store-display.ts |
| 218 | 1 | `toContainText(raw)` | text | PRESENTATIONAL | — |
| 221 | 1 | `toContainText('検品')` | text | PRESENTATIONAL | StaffHome.tsx, TransferWorkspace.tsx, CustodyWorkspace.tsx +4 |
| 232 | 1 | `locator('.staff-card',{hasText:'SYNTHETIC UX5D Unknown Action'})` | css:css-class | PRESENTATIONAL | StaffHome.tsx, staff-home.css, StaffManagement.tsx |
| 233 | 1 | `toContainText('詳細確認')` | text | PRESENTATIONAL | StaffHome.tsx |
| 250 | 2 | `locator('.staff-card',{hasText:'Page Row A'})` | css:css-class | PRESENTATIONAL | StaffHome.tsx, staff-home.css, StaffManagement.tsx |
| 250 | 3 | `toHaveCount(1)` | count | BEHAVIOURAL | — |
| 251 | 2 | `getByRole('button',{name:'さらに読み込む'})` | role:button +name | BEHAVIOURAL | OpsWorkspace.tsx, StaffHome.tsx |
| 252 | 1 | `locator('.staff-card',{hasText:'Page Row B'})` | css:css-class | PRESENTATIONAL | StaffHome.tsx, staff-home.css, StaffManagement.tsx |
| 278 | 2 | `locator('.staff-card',{hasText:'SYNTHETIC UX5D Race ONSEN'})` | css:css-class | PRESENTATIONAL | StaffHome.tsx, staff-home.css, StaffManagement.tsx |
| 281 | 1 | `locator('.staff-card',{hasText:'SYNTHETIC UX5D Race MOUNTAIN'})` | css:css-class | PRESENTATIONAL | StaffHome.tsx, staff-home.css, StaffManagement.tsx |
| 303 | 2 | `locator('.staff-card',{hasText:'SYNTHETIC UX5D Race Page1'})` | css:css-class | PRESENTATIONAL | StaffHome.tsx, staff-home.css, StaffManagement.tsx |
| 307 | 2 | `locator('.staff-card',{hasText:'SYNTHETIC UX5D Race ONSEN Fresh'})` | css:css-class | PRESENTATIONAL | StaffHome.tsx, staff-home.css, StaffManagement.tsx |
| 310 | 1 | `locator('.staff-card',{hasText:'SYNTHETIC UX5D Race Page2 Late'})` | css:css-class | PRESENTATIONAL | StaffHome.tsx, staff-home.css, StaffManagement.tsx |
| 338 | 1 | `toContainText(staleDate)` | text | PRESENTATIONAL | — |
| 353 | 7 | `getByRole('button',{name:'更新',exact:true})` | role:button +name | BEHAVIOURAL | BookingCancellation.tsx, StaffHome.tsx, StaffManagement.tsx +5 |
| 354 | 1 | `toContainText(laterDate)` | text | PRESENTATIONAL | — |
| 370 | 5 | `getByRole('status')` | role:status | BEHAVIOURAL | — |
| 370 | 3 | `toHaveText('')` | text | PRESENTATIONAL | — |
| 371 | 1 | `toContainText('予約はありません')` | text | PRESENTATIONAL | StaffHome.tsx |
| 408 | 1 | `getByRole('heading',{name:'セッションを確認してください'})` | role:heading +name | BEHAVIOURAL | StaffSessionBoundary.tsx |
| 416 | 2 | `locator('.staff-card')` | css:css-class | PRESENTATIONAL | StaffHome.tsx, staff-home.css, StaffManagement.tsx |
| 420 | 1 | `toContainText('読み込んでいます')` | text | PRESENTATIONAL | StaffHome.tsx |
| 421 | 1 | `screenshot({path:'.local/screenshots/staff-manifest-loading-390.png'})` | screenshot-path | PRESENTATIONAL | — (artifact path) |
| 423 | 1 | `screenshot({path:'.local/screenshots/staff-manifest-empty-390.png'})` | screenshot-path | PRESENTATIONAL | — (artifact path) |
| 427 | 1 | `toContainText('読み込めませんでした')` | text | PRESENTATIONAL | StaffHome.tsx, QuoteWorkspace.tsx, GuestBooking.tsx |
| 427 | 1 | `toContainText('OPERATIONS_UNCONNECTED')` | text | PRESENTATIONAL | route.ts, operations-http.ts |
| 428 | 2 | `getByRole('button',{name:'もう一度読み込む',exact:true})` | role:button +name | BEHAVIOURAL | StaffHome.tsx |
| 429 | 1 | `screenshot({path:'.local/screenshots/staff-manifest-error-390.png'})` | screenshot-path | PRESENTATIONAL | — (artifact path) |
| 438 | 2 | `evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)` | computed-style (no h-overflow) | PRESENTATIONAL | — |
| 439 | 1 | `` screenshot({path:`.local/screenshots/staff-home-${width}.png`,fullPage:true}) `` | screenshot-path | PRESENTATIONAL | — (artifact path) |
| 443 | 1 | `screenshot({path:'.local/screenshots/staff-home-custody-only-390.png',fullPage:true})` | screenshot-path | PRESENTATIONAL | — (artifact path) |
| 445 | 1 | `screenshot({path:'.local/screenshots/staff-rentals-preselected-390.png',fullPage:true})` | screenshot-path | PRESENTATIONAL | — (artifact path) |

### `tests/custody/normal-ui.ts`

| L | n | locator / assertion (verbatim) | kind | B/P | producing component |
|---|---|---|---|---|---|
| 22 | 1 | `getByRole('button',{name:'テストアダプタへ照合要求'})` | role:button +name | BEHAVIOURAL | BookingWorkspace.tsx |
| 28 | 2 | `getByRole('region',{name:'開発予約詳細'})` | role:region (landmark) +name | BEHAVIOURAL | BookingWorkspace.tsx |
| 28 | 1 | `toContainText('CONFIRMED_DEV')` | text | PRESENTATIONAL | StaffHome.tsx, GuestBooking.tsx, BookingWorkspace.tsx |
| 36 | 1 | `getByLabel('メールアドレス',{exact:true})` | label | BEHAVIOURAL | GuestRecovery.tsx, StaffManagement.tsx, StaffLogin.tsx +2 |
| 36 | 1 | `getByLabel('パスワード',{exact:true})` | label | BEHAVIOURAL | page.tsx, StaffHome.tsx, StaffManagement.tsx +3 |
| 36 | 1 | `getByRole('button',{name:'ログイン',exact:true})` | role:button +name | BEHAVIOURAL | page.tsx, page.tsx, page.tsx +21 |
| 36 | 1 | `waitForURL(origin+'/staff/ledger')` | url | BEHAVIOURAL | page.tsx, page.tsx, OpsWorkspace.tsx +9 |
| 40 | 1 | `getByRole('button',{name:'ログアウトする',exact:true})` | role:button +name | BEHAVIOURAL | StaffLogout.tsx |
| 40 | 1 | `waitForURL(origin+'/staff/login')` | url | BEHAVIOURAL | page.tsx, page.tsx, page.tsx +23 |
| 43 | 1 | `getByLabel('料金の対象開始日')` | label | BEHAVIOURAL | QuoteWorkspace.tsx |
| 43 | 1 | `getByLabel('料金の対象終了日')` | label | BEHAVIOURAL | QuoteWorkspace.tsx |
| 43 | 1 | `getByRole('button',{name:'開発用の初期料金を設定'})` | role:button +name | BEHAVIOURAL | QuoteWorkspace.tsx |
| 43 | 1 | `getByRole('region',{name:'料金版',exact:true})` | role:region (landmark) +name | BEHAVIOURAL | RecommendationWorkspace.tsx, QuoteWorkspace.tsx, StaffManagement.tsx +3 |
| 43 | 1 | `toContainText('PRIVATE_AVAILABLE')` | text | PRESENTATIONAL | pkg:core/commercial-price-authority.ts, core/quote-service.ts |
| 46 | 1 | `getByLabel('利用開始日',{exact:true})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx, QuoteWorkspace.tsx, GuestBooking.tsx |
| 46 | 1 | `getByLabel('利用終了日',{exact:true})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx, QuoteWorkspace.tsx, GuestBooking.tsx |
| 46 | 1 | `getByLabel('競技 1',{exact:true})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx, LedgerWorkspace.tsx |
| 46 | 1 | `getByLabel('利用開始時の年齢区分 1',{exact:true})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx |
| 46 | 1 | `getByLabel('身長cm 1',{exact:true})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx, GuestBooking.tsx |
| 46 | 1 | `getByLabel('足サイズcm 1',{exact:true})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx, GuestBooking.tsx |
| 46 | 1 | `getByLabel('体重kg 1',{exact:true})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx, GuestBooking.tsx |
| 46 | 1 | `getByLabel('利用開始時の年齢 1',{exact:true})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx |
| 46 | 1 | `getByLabel('レベル 1',{exact:true})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx, GuestBooking.tsx |
| 47 | 1 | `getByLabel('クラス 1',{exact:true})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx, GuestBooking.tsx, HoldWorkspace.tsx +2 |
| 47 | 1 | `getByLabel('ポールのサイズ 1',{exact:true})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx, GuestBooking.tsx |
| 48 | 1 | `getByLabel('指定モデル・シーズン 1',{exact:true})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx |
| 49 | 1 | `getByLabel('ウェア上下セットを追加 1',{exact:true})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx |
| 49 | 1 | `getByLabel('上サイズ 1',{exact:true})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx |
| 49 | 1 | `getByLabel('下サイズ 1',{exact:true})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx, GuestBooking.tsx |
| 50 | 1 | `getByRole('button',{name:'推薦候補を確認',exact:true})` | role:button +name | BEHAVIOURAL | RecommendationWorkspace.tsx |
| 50 | 1 | `getByRole('button',{name:'おすすめを選ぶ 1',exact:true})` | role:button +name | BEHAVIOURAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 50 | 1 | `getByRole('checkbox',{name:'表示したモデル契約・サイズ・ウェア構成を選択条件とすることを確認'})` | role:checkbox +name | BEHAVIOURAL | RecommendationWorkspace.tsx |
| 50 | 1 | `getByRole('button',{name:'全員分をHOLDして見積を保存',exact:true})` | role:button +name | BEHAVIOURAL | RecommendationWorkspace.tsx |
| 50 | 1 | `getByRole('region',{name:'見積詳細',exact:true})` | role:region (landmark) +name | BEHAVIOURAL | RecommendationWorkspace.tsx, QuoteWorkspace.tsx |
| 50 | 1 | `getByRole('link',{name:'予約情報・決済結果へ'})` | role:link +name | BEHAVIOURAL | RecommendationWorkspace.tsx |
| 50 | 1 | `getByLabel('合成氏名')` | label | BEHAVIOURAL | BookingWorkspace.tsx |
| 50 | 1 | `getByLabel('架空メール宛先')` | label | BEHAVIOURAL | BookingWorkspace.tsx |
| 50 | 1 | `getByLabel('開発用の合成予約であり、営業規約・請求の確定ではないことを確認')` | label | BEHAVIOURAL | BookingWorkspace.tsx |
| 50 | 1 | `getByRole('button',{name:'合成予約情報を保存',exact:true})` | role:button +name | BEHAVIOURAL | BookingWorkspace.tsx |
| 50 | 1 | `toContainText('DRAFT')` | text | PRESENTATIONAL | StaffHome.tsx, GuestBooking.tsx, BookingWorkspace.tsx +2 |
| 56 | 1 | `getByLabel('予約IDまたは予約QR')` | label | BEHAVIOURAL | CustodyWorkspace.tsx, BookingSearchInput.tsx |
| 56 | 1 | `getByRole('button',{name:'予約と仮割当を照合'})` | role:button +name | BEHAVIOURAL | CustodyWorkspace.tsx |
| 56 | 2 | `getByRole('region',{name:'貸出用品'})` | role:region (landmark) +name | BEHAVIOURAL | CustodyWorkspace.tsx |
| 56 | 1 | `toContainText(bookingId)` | text | PRESENTATIONAL | — |
| 56 | 1 | `getByLabel('準備・最終適合の作業記録')` | label | BEHAVIOURAL | CustodyWorkspace.tsx |
| 56 | 1 | `getByLabel('表示された個体と数量を照合した')` | label | BEHAVIOURAL | CustodyWorkspace.tsx |
| 56 | 1 | `getByRole('button',{name:'照合した用品を準備固定'})` | role:button +name | BEHAVIOURAL | CustodyWorkspace.tsx |
| 56 | 1 | `getByRole('button',{name:'道具の貸出を記録'})` | role:button +name | BEHAVIOURAL | CustodyWorkspace.tsx |
| 56 | 1 | `toContainText('OUT')` | text | PRESENTATIONAL | page.tsx, page.tsx, OpsWorkspace.tsx +5 |
| 60 | 1 | `getByLabel('予約番号',{exact:true})` | label | BEHAVIOURAL | GuestRecovery.tsx, RequestBookingRecovery.tsx, GuestBooking.tsx +2 |
| 60 | 2 | `getByRole('button',{name:'貸出を読込',exact:true})` | role:button +name | BEHAVIOURAL | WearWorkspace.tsx |
| 60 | 1 | `getByRole('button',{name:'ウェア数量を貸出記録',exact:true})` | role:button +name | BEHAVIOURAL | WearWorkspace.tsx |
| 60 | 2 | `getByRole('button',{name:'1着を受領：person-1:WEAR_JACKET',exact:true})` | role:button +name | BEHAVIOURAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 61 | 1 | `getByLabel('実際の受領・表示店舗')` | label | BEHAVIOURAL | WearWorkspace.tsx |
| 61 | 1 | `getByRole('article',{name:'ウェア貸出 person-1:WEAR_JACKET',exact:true})` | role:article +name | BEHAVIOURAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 61 | 1 | `toContainText('返却済み 1')` | text | PRESENTATIONAL | WearWorkspace.tsx |
| 61 | 1 | `getByRole('article',{name:'ウェア貸出 person-1:WEAR_PANTS',exact:true})` | role:article +name | BEHAVIOURAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 61 | 1 | `toContainText('未返却 1')` | text | PRESENTATIONAL | TransferWorkspace.tsx, WearWorkspace.tsx |
| 64 | 2 | `getByLabel('受領店舗',{exact:true})` | label | BEHAVIOURAL | CustodyWorkspace.tsx, WearWorkspace.tsx |
| 64 | 1 | `getByRole('button',{name:'この店舗で返却バッチを開始'})` | role:button +name | BEHAVIOURAL | CustodyWorkspace.tsx |
| 64 | 6 | `getByRole('region',{name:'連続返却バッチ'})` | role:region (landmark) +name | BEHAVIOURAL | CustodyWorkspace.tsx |
| 64 | 2 | `getByLabel('保存済み返却バッチID')` | label | BEHAVIOURAL | CustodyWorkspace.tsx |
| 65 | 1 | `getByLabel('用品の個体ID',{exact:true})` | label | BEHAVIOURAL | AssetQrInput.tsx |
| 65 | 1 | `getByRole('button',{name:'入力したIDを照合へ送る'})` | role:button +name | BEHAVIOURAL | AssetQrInput.tsx |
| 65 | 1 | `getByRole('status')` | role:status | BEHAVIOURAL | — |
| 65 | 1 | `filter({hasText:'返却候補をサーバーに保存'})` | text (filter hasText) | PRESENTATIONAL | CustodyWorkspace.tsx |
| 66 | 1 | `evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=360;canvas.height=360;canvas.getContext('2d')!.fillRect(0,0,360,360);const media=canvas.captureStream(0),state={canvas,media,requests:0};(window as unknown as {syntheticCamera:typeof state}).syntheticCamera=state;Object.defineProperty(navigator.mediaDevices,'getUserMedia',{configurable:true,value:async()=>{state.requests++;return media;}});})` | dom-evaluate | PRESENTATIONAL | BookingSearchInput.tsx, AssetQrInput.tsx |
| 68 | 1 | `getByRole('button',{name:'カメラを開く'})` | role:button +name | BEHAVIOURAL | AssetQrInput.tsx |
| 68 | 1 | `toContainText('person-1:SKI')` | text | PRESENTATIONAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 68 | 1 | `toContainText('UNKNOWN_OR_ALREADY_RECEIVED')` | text | PRESENTATIONAL | pkg:core/custody-service.ts |
| 68 | 1 | `getByRole('button',{name:'カメラを止める'})` | role:button +name | BEHAVIOURAL | BookingSearchInput.tsx, AssetQrInput.tsx |
| 69 | 1 | `getByRole('button',{name:'返却バッチを再開'})` | role:button +name | BEHAVIOURAL | CustodyWorkspace.tsx |
| 69 | 1 | `toContainText('CANDIDATE')` | text | PRESENTATIONAL | CustodyWorkspace.tsx, GuestBooking.tsx, WearWorkspace.tsx |
| 70 | 1 | `getByLabel('ポールの貸出明細ID')` | label | BEHAVIOURAL | CustodyWorkspace.tsx |
| 70 | 1 | `getByRole('button',{name:'この貸出のポール1ペアを候補に追加'})` | role:button +name | BEHAVIOURAL | CustodyWorkspace.tsx |
| 70 | 1 | `toContainText('person-1:POLE')` | text | PRESENTATIONAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 71 | 1 | `getByRole('button',{name:'正常な候補をまとめて受領確定'})` | role:button +name | BEHAVIOURAL | CustodyWorkspace.tsx |
| 71 | 2 | `getByRole('button',{name:'同じ保存済み要求を照合'})` | role:button +name | BEHAVIOURAL | CustodyWorkspace.tsx, BookingWorkspace.tsx |
| 71 | 1 | `toContainText('RECEIVED')` | text | PRESENTATIONAL | TransferWorkspace.tsx, LedgerWorkspace.tsx |
| 73 | 1 | `toHaveValue('ONSEN_BASE')` | value | BEHAVIOURAL | PublicChrome.tsx, TransferWorkspace.tsx, StaffManagement.tsx +5 |
| 73 | 2 | `getByRole('button',{name:'保存済み返却作業を読込'})` | role:button +name | BEHAVIOURAL | CustodyWorkspace.tsx |
| 73 | 1 | `getByText('person-1:SKI / 受領済み・検品待ち',{exact:true})` | text | PRESENTATIONAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 73 | 1 | `getByLabel('実際に行った検品記録')` | label | BEHAVIOURAL | CustodyWorkspace.tsx |
| 73 | 1 | `getByRole('button',{name:'検品完了 '+skiLoan,exact:true})` | role:button +name | BEHAVIOURAL | CustodyWorkspace.tsx |
| 73 | 1 | `getByText('person-1:SKI / 検品済み（契約日・当日ブロックは維持）',{exact:true})` | text | PRESENTATIONAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 75 | 1 | `screenshot({path:'.local/screenshots/custody-desktop.png',fullPage:true})` | screenshot-path | PRESENTATIONAL | — (artifact path) |
| 75 | 1 | `evaluate(()=>document.documentElement.scrollWidth<=innerWidth)` | computed-style (no h-overflow) | PRESENTATIONAL | — |
| 75 | 1 | `screenshot({path:'.local/screenshots/custody-mobile-width.png',fullPage:true})` | screenshot-path | PRESENTATIONAL | — (artifact path) |
| 81 | 1 | `getByRole('heading',{name:'セッションを確認してください'})` | role:heading +name | BEHAVIOURAL | StaffSessionBoundary.tsx |
| 84 | 1 | `getByRole('alert')` | role:alert | BEHAVIOURAL | — |

### `tests/wear/normal-ui.ts`

| L | n | locator / assertion (verbatim) | kind | B/P | producing component |
|---|---|---|---|---|---|
| 19 | 1 | `getByLabel('メールアドレス',{exact:true})` | label | BEHAVIOURAL | GuestRecovery.tsx, StaffManagement.tsx, StaffLogin.tsx +2 |
| 19 | 1 | `getByLabel('パスワード',{exact:true})` | label | BEHAVIOURAL | page.tsx, StaffHome.tsx, StaffManagement.tsx +3 |
| 19 | 1 | `getByRole('button',{name:'ログイン',exact:true})` | role:button +name | BEHAVIOURAL | page.tsx, page.tsx, page.tsx +21 |
| 19 | 1 | `waitForURL(origin+'/staff/ledger')` | url | BEHAVIOURAL | page.tsx, page.tsx, OpsWorkspace.tsx +9 |
| 21 | 1 | `getByRole('button',{name:'ログアウトする',exact:true})` | role:button +name | BEHAVIOURAL | StaffLogout.tsx |
| 21 | 1 | `waitForURL(origin+'/staff/login')` | url | BEHAVIOURAL | page.tsx, page.tsx, page.tsx +23 |
| 23 | 1 | `getByLabel('料金の対象開始日')` | label | BEHAVIOURAL | QuoteWorkspace.tsx |
| 23 | 1 | `getByLabel('料金の対象終了日')` | label | BEHAVIOURAL | QuoteWorkspace.tsx |
| 23 | 1 | `getByRole('button',{name:'開発用の初期料金を設定'})` | role:button +name | BEHAVIOURAL | QuoteWorkspace.tsx |
| 23 | 1 | `getByRole('region',{name:'料金版',exact:true})` | role:region (landmark) +name | BEHAVIOURAL | RecommendationWorkspace.tsx, QuoteWorkspace.tsx, StaffManagement.tsx +3 |
| 23 | 1 | `toContainText('PRIVATE_AVAILABLE')` | text | PRESENTATIONAL | pkg:core/commercial-price-authority.ts, core/quote-service.ts |
| 26 | 3 | `getByLabel('利用開始日',{exact:true})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx, QuoteWorkspace.tsx, GuestBooking.tsx |
| 26 | 3 | `getByLabel('利用終了日',{exact:true})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx, QuoteWorkspace.tsx, GuestBooking.tsx |
| 26 | 1 | `getByLabel('競技 1',{exact:true})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx, LedgerWorkspace.tsx |
| 26 | 1 | `getByLabel('利用開始時の年齢区分 1',{exact:true})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx |
| 26 | 2 | `getByLabel('上サイズ 1',{exact:true})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx |
| 26 | 2 | `getByLabel('下サイズ 1',{exact:true})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx, GuestBooking.tsx |
| 26 | 1 | `getByLabel('身長cm 1',{exact:true})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx, GuestBooking.tsx |
| 27 | 3 | `getByRole('button',{name:'推薦候補を確認',exact:true})` | role:button +name | BEHAVIOURAL | RecommendationWorkspace.tsx |
| 27 | 1 | `getByText('選択期間の参考総額',{exact:false})` | text | PRESENTATIONAL | RecommendationWorkspace.tsx |
| 27 | 1 | `getByText('小物は含みません。',{exact:false})` | text | PRESENTATIONAL | RecommendationWorkspace.tsx |
| 27 | 1 | `getByRole('button',{name:'おすすめを選ぶ 1',exact:true})` | role:button +name | BEHAVIOURAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 27 | 3 | `getByRole('checkbox',{name:'表示したモデル契約・サイズ・ウェア構成を選択条件とすることを確認'})` | role:checkbox +name | BEHAVIOURAL | RecommendationWorkspace.tsx |
| 27 | 3 | `getByRole('button',{name:'全員分をHOLDして見積を保存',exact:true})` | role:button +name | BEHAVIOURAL | RecommendationWorkspace.tsx |
| 27 | 5 | `getByRole('region',{name:'見積詳細',exact:true})` | role:region (landmark) +name | BEHAVIOURAL | RecommendationWorkspace.tsx, QuoteWorkspace.tsx |
| 27 | 4 | `evaluate(()=>document.documentElement.scrollWidth<=innerWidth)` | computed-style (no h-overflow) | PRESENTATIONAL | — |
| 27 | 1 | `screenshot({path:'.local/screenshots/wear-selection-mobile-width.png',fullPage:true})` | screenshot-path | PRESENTATIONAL | — (artifact path) |
| 28 | 2 | `getByRole('link',{name:'予約情報・決済結果へ'})` | role:link +name | BEHAVIOURAL | RecommendationWorkspace.tsx |
| 28 | 2 | `getByLabel('合成氏名')` | label | BEHAVIOURAL | BookingWorkspace.tsx |
| 28 | 2 | `getByLabel('架空メール宛先')` | label | BEHAVIOURAL | BookingWorkspace.tsx |
| 28 | 2 | `getByLabel('開発用の合成予約であり、営業規約・請求の確定ではないことを確認')` | label | BEHAVIOURAL | BookingWorkspace.tsx |
| 28 | 2 | `getByRole('button',{name:'合成予約情報を保存',exact:true})` | role:button +name | BEHAVIOURAL | BookingWorkspace.tsx |
| 28 | 4 | `getByRole('region',{name:'開発予約詳細'})` | role:region (landmark) +name | BEHAVIOURAL | BookingWorkspace.tsx |
| 28 | 2 | `toContainText('DRAFT')` | text | PRESENTATIONAL | StaffHome.tsx, GuestBooking.tsx, BookingWorkspace.tsx +2 |
| 28 | 2 | `getByRole('button',{name:'テストアダプタへ照合要求'})` | role:button +name | BEHAVIOURAL | BookingWorkspace.tsx |
| 28 | 2 | `toContainText('CONFIRMED_DEV')` | text | PRESENTATIONAL | StaffHome.tsx, GuestBooking.tsx, BookingWorkspace.tsx |
| 28 | 1 | `getByLabel('開発予約QR')` | label | BEHAVIOURAL | GuestBooking.tsx, BookingWorkspace.tsx |
| 32 | 4 | `getByLabel('予約番号',{exact:true})` | label | BEHAVIOURAL | GuestRecovery.tsx, RequestBookingRecovery.tsx, GuestBooking.tsx +2 |
| 32 | 6 | `getByRole('button',{name:'貸出を読込',exact:true})` | role:button +name | BEHAVIOURAL | WearWorkspace.tsx |
| 32 | 1 | `getByText('照合済み予約 '+bookingId,{exact:false})` | text | PRESENTATIONAL | WearWorkspace.tsx |
| 32 | 2 | `getByRole('button',{name:'ウェア数量を貸出記録',exact:true})` | role:button +name | BEHAVIOURAL | WearWorkspace.tsx |
| 32 | 3 | `getByRole('button',{name:'1着を受領：person-1:WEAR_JACKET',exact:true})` | role:button +name | BEHAVIOURAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 32 | 7 | `getByLabel('実際の受領・表示店舗')` | label | BEHAVIOURAL | WearWorkspace.tsx |
| 33 | 4 | `getByRole('button',{name:'同じ保存要求を照合',exact:true})` | role:button +name | BEHAVIOURAL | ContentWorkspace.tsx, WearWorkspace.tsx |
| 33 | 6 | `getByRole('status')` | role:status | BEHAVIOURAL | — |
| 33 | 3 | `toContainText('保存済み')` | text | PRESENTATIONAL | page.tsx, useOperationsRequest.ts, RecommendationWorkspace.tsx +14 |
| 33 | 1 | `getByRole('article',{name:'ウェア貸出 person-1:WEAR_JACKET',exact:true})` | role:article +name | BEHAVIOURAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 33 | 1 | `toContainText('返却済み 1')` | text | PRESENTATIONAL | WearWorkspace.tsx |
| 33 | 1 | `getByRole('article',{name:'ウェア貸出 person-1:WEAR_PANTS',exact:true})` | role:article +name | BEHAVIOURAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 33 | 1 | `toContainText('未返却 1')` | text | PRESENTATIONAL | TransferWorkspace.tsx, WearWorkspace.tsx |
| 37 | 1 | `getByRole('button',{name:/^洗浄開始：/})` | role:button +name | BEHAVIOURAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 37 | 1 | `getByRole('button',{name:/^実際の乾燥・検品完了を記録：/})` | role:button +name | BEHAVIOURAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 37 | 1 | `getByText(/Central Station \/ 1着 \/ TODAY_BLOCKED/)` | text | PRESENTATIONAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 37 | 1 | `getByText(/同日保護の解除日 2035-01-06/)` | text | PRESENTATIONAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 37 | 2 | `getByRole('button',{name:/^翌日以降のREADY反映：/})` | role:button +name | BEHAVIOURAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 37 | 1 | `toContainText('SAME_DAY_REHIRE_BLOCKED')` | text | PRESENTATIONAL | pkg:core/service.ts |
| 37 | 1 | `screenshot({path:'.local/screenshots/wear-return-desktop.png',fullPage:true})` | screenshot-path | PRESENTATIONAL | — (artifact path) |
| 37 | 1 | `screenshot({path:'.local/screenshots/wear-return-mobile-width.png',fullPage:true})` | screenshot-path | PRESENTATIONAL | — (artifact path) |
| 40 | 1 | `getByRole('button',{name:'返却候補へ追加：person-1:WEAR_PANTS',exact:true})` | role:button +name | BEHAVIOURAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 40 | 4 | `getByRole('region',{name:'保存した返却候補'})` | role:region (landmark) +name | BEHAVIOURAL | WearWorkspace.tsx |
| 40 | 2 | `toContainText('CANDIDATE')` | text | PRESENTATIONAL | CustodyWorkspace.tsx, GuestBooking.tsx, WearWorkspace.tsx |
| 40 | 1 | `getByLabel('返却バッチ番号')` | label | BEHAVIOURAL | WearWorkspace.tsx |
| 40 | 1 | `getByRole('button',{name:'前回のバッチ番号を復元',exact:true})` | role:button +name | BEHAVIOURAL | WearWorkspace.tsx |
| 40 | 2 | `getByRole('button',{name:'保存した候補を再読込',exact:true})` | role:button +name | BEHAVIOURAL | WearWorkspace.tsx |
| 41 | 1 | `getByRole('button',{name:'候補の数量をまとめて返却確定',exact:true})` | role:button +name | BEHAVIOURAL | WearWorkspace.tsx |
| 41 | 2 | `toContainText('RECEIVED')` | text | PRESENTATIONAL | TransferWorkspace.tsx, LedgerWorkspace.tsx |
| 44 | 1 | `getByLabel('対象サイズの数量プール')` | label | BEHAVIOURAL | WearWorkspace.tsx |
| 44 | 3 | `getByLabel('数量操作の理由')` | label | BEHAVIOURAL | WearWorkspace.tsx |
| 44 | 1 | `getByLabel('17時便の予定日')` | label | BEHAVIOURAL | WearWorkspace.tsx |
| 44 | 1 | `getByRole('button',{name:'もう一方の店舗への移動を計画',exact:true})` | role:button +name | BEHAVIOURAL | WearWorkspace.tsx |
| 44 | 2 | `getByRole('button',{name:'この店舗の数量移動を再読込',exact:true})` | role:button +name | BEHAVIOURAL | WearWorkspace.tsx |
| 44 | 3 | `getByRole('button',{name:/^実際に発送：/})` | role:button +name | BEHAVIOURAL | WearWorkspace.tsx |
| 44 | 1 | `toContainText('DEPARTURE_NOT_READY')` | text | PRESENTATIONAL | pkg:core/service.ts |
| 44 | 2 | `getByRole('article',{name:/^数量移動 /})` | role:article +name | BEHAVIOURAL | WearWorkspace.tsx |
| 44 | 2 | `toContainText('IN_TRANSIT')` | text | PRESENTATIONAL | TransferWorkspace.tsx, WearWorkspace.tsx, LedgerWorkspace.tsx |
| 44 | 1 | `getByRole('button',{name:/^実際に受領：/})` | role:button +name | BEHAVIOURAL | WearWorkspace.tsx |
| 44 | 1 | `getByRole('button',{name:'受領分の実READY確認：1着',exact:true})` | role:button +name | BEHAVIOURAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 51 | 1 | `getByLabel('利用区分',{exact:true})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx, QuoteWorkspace.tsx, HoldWorkspace.tsx |
| 52 | 4 | `getByRole('button',{name:'利用者を追加',exact:true})` | role:button +name | BEHAVIOURAL | RecommendationWorkspace.tsx, QuoteWorkspace.tsx |
| 52 | 2 | `getByLabel('利用開始時の年齢区分 '+n,{exact:true})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx |
| 52 | 1 | `getByLabel('クラス '+n,{exact:true})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx |
| 52 | 1 | `getByLabel('指定モデル・シーズン '+n,{exact:true})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx |
| 52 | 2 | `getByLabel('身長cm '+n,{exact:true})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx |
| 52 | 2 | `getByLabel('足サイズcm '+n,{exact:true})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx |
| 52 | 1 | `getByLabel('体重kg '+n,{exact:true})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx |
| 52 | 1 | `getByLabel('利用開始時の年齢 '+n,{exact:true})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx |
| 52 | 1 | `getByLabel('レベル '+n,{exact:true})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx |
| 52 | 1 | `getByLabel('ポールのサイズ '+n,{exact:true})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx |
| 52 | 1 | `getByLabel('ウェア上下セットを追加 '+n,{exact:true})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx |
| 52 | 1 | `getByLabel('上サイズ '+n,{exact:true})` | label | BEHAVIOURAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 52 | 1 | `getByLabel('下サイズ '+n,{exact:true})` | label | BEHAVIOURAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 53 | 3 | `getByRole('article',{name:'利用者 20 の候補',exact:true})` | role:article +name | BEHAVIOURAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 53 | 1 | `toContainText('2026/27')` | text | PRESENTATIONAL | LedgerWorkspace.tsx |
| 53 | 1 | `toContainText('写真は準備中')` | text | PRESENTATIONAL | RecommendationWorkspace.tsx |
| 53 | 2 | `getByRole('button',{name:'おすすめを選ぶ '+n,exact:true})` | role:button +name | BEHAVIOURAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 54 | 1 | `getByRole('button',{name:'保存結果を再読込',exact:true})` | role:button +name | BEHAVIOURAL | RecommendationWorkspace.tsx |
| 59 | 1 | `getByRole('article',{name:/^ウェア貸出 /})` | role:article +name | BEHAVIOURAL | WearWorkspace.tsx |
| 59 | 1 | `toHaveCount(40)` | count | BEHAVIOURAL | — |
| 60 | 2 | `getByRole('button',{name:'この店舗の返却作業を読込',exact:true})` | role:button +name | BEHAVIOURAL | WearWorkspace.tsx |
| 60 | 2 | `getByLabel('予約不明ウェアのサイズ')` | label | BEHAVIOURAL | WearWorkspace.tsx |
| 60 | 2 | `getByRole('button',{name:'予約不明として受領記録（READYへ加算しない）',exact:true})` | role:button +name | BEHAVIOURAL | WearWorkspace.tsx |
| 60 | 3 | `getByRole('region',{name:'予約不明の隔離記録'})` | role:region (landmark) +name | BEHAVIOURAL | WearWorkspace.tsx |
| 60 | 1 | `toContainText('no known local pool')` | text | PRESENTATIONAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 61 | 2 | `toContainText('unidentified M garment')` | text | PRESENTATIONAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 62 | 1 | `getByRole('button',{name:'この貸出との数量一致を確認：person-1 / person-1:WEAR_JACKET',exact:true})` | role:button +name | BEHAVIOURAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 64 | 2 | `getByRole('button',{name:/^バッチを選択：/})` | role:button +name | BEHAVIOURAL | WearWorkspace.tsx |
| 75 | 1 | `getByLabel('競技 '+n,{exact:true})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx |
| 76 | 1 | `getByLabel('体重kg 1',{exact:true})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx, GuestBooking.tsx |
| 76 | 1 | `getByLabel('利用開始時の年齢 1',{exact:true})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx |
| 76 | 1 | `getByLabel('レベル 1',{exact:true})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx, GuestBooking.tsx |
| 76 | 1 | `getByLabel('ポールのサイズ 1',{exact:true})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx, GuestBooking.tsx |
| 76 | 1 | `getByLabel('ウェア上下セットを追加 1',{exact:true})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx |
| 76 | 1 | `getByLabel('ウェア上下セットを追加 2',{exact:true})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx |
| 76 | 1 | `getByLabel('体重kg 2',{exact:true})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx, GuestBooking.tsx |
| 77 | 1 | `getByLabel('競技 3',{exact:true})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx, LedgerWorkspace.tsx |
| 77 | 1 | `getByLabel('利用開始時の年齢区分 3',{exact:true})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx |
| 77 | 1 | `getByLabel('上サイズ 3',{exact:true})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx |
| 77 | 1 | `getByLabel('下サイズ 3',{exact:true})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx, GuestBooking.tsx |
| 77 | 1 | `getByLabel('身長cm 3',{exact:true})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx, GuestBooking.tsx |
| 78 | 1 | `screenshot({path:'.local/screenshots/wear-mixed-quote-mobile-width.png'})` | screenshot-path | PRESENTATIONAL | — (artifact path) |
| 84 | 1 | `textContent()` | text | PRESENTATIONAL | — |

### `tests/transfer/normal-ui.ts`

| L | n | locator / assertion (verbatim) | kind | B/P | producing component |
|---|---|---|---|---|---|
| 13 | 1 | `assert.match(value,/^2033-01-0[1-9]T\d\d:\d\d:\d\dZ$/)` | regex | PRESENTATIONAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 16 | 2 | `getByLabel('メールアドレス',{exact:true})` | label | BEHAVIOURAL | GuestRecovery.tsx, StaffManagement.tsx, StaffLogin.tsx +2 |
| 16 | 1 | `getByLabel('パスワード',{exact:true})` | label | BEHAVIOURAL | page.tsx, StaffHome.tsx, StaffManagement.tsx +3 |
| 16 | 1 | `getByRole('button',{name:'ログイン',exact:true})` | role:button +name | BEHAVIOURAL | page.tsx, page.tsx, page.tsx +21 |
| 16 | 1 | `waitForURL(origin+'/staff/ledger')` | url | BEHAVIOURAL | page.tsx, page.tsx, OpsWorkspace.tsx +9 |
| 20 | 1 | `getByRole('button',{name:'スタッフを作成',exact:true})` | role:button +name | BEHAVIOURAL | StaffManagement.tsx |
| 20 | 1 | `getByRole('form',{name:'スタッフ作成'})` | role:form (landmark) +name | BEHAVIOURAL | StaffManagement.tsx |
| 20 | 1 | `getByLabel('表示名',{exact:true})` | label | BEHAVIOURAL | StaffManagement.tsx |
| 20 | 1 | `getByLabel('初期パスワード（15〜128文字）')` | label | BEHAVIOURAL | StaffManagement.tsx |
| 20 | 1 | `getByLabel(store,{exact:true})` | label | BEHAVIOURAL | — |
| 20 | 1 | `getByLabel(label,{exact:true})` | label | BEHAVIOURAL | — |
| 20 | 1 | `getByRole('button',{name:'スタッフ設定を保存'})` | role:button +name | BEHAVIOURAL | StaffManagement.tsx |
| 20 | 1 | `getByRole('heading',{name:'合成移動担当',exact:true})` | role:heading +name | BEHAVIOURAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 24 | 1 | `getByRole('heading',{name:'店舗間の移動',exact:true})` | role:heading +name | BEHAVIOURAL | TransferWorkspace.tsx, GuestBooking.tsx |
| 24 | 1 | `getByLabel('元店舗',{exact:true})` | label | BEHAVIOURAL | TransferWorkspace.tsx, StaffManagement.tsx |
| 24 | 1 | `getByLabel('移動先',{exact:true})` | label | BEHAVIOURAL | TransferWorkspace.tsx, StaffManagement.tsx |
| 24 | 2 | `getByLabel('17時便の日付')` | label | BEHAVIOURAL | TransferWorkspace.tsx |
| 24 | 2 | `getByLabel('準備完了の見込み（日本時間）')` | label | BEHAVIOURAL | TransferWorkspace.tsx |
| 24 | 2 | `getByLabel('必要期限（日本時間）')` | label | BEHAVIOURAL | TransferWorkspace.tsx |
| 24 | 2 | `getByLabel('計画根拠・運搬と準備の確認')` | label | BEHAVIOURAL | TransferWorkspace.tsx |
| 24 | 2 | `getByLabel('対象用品',{exact:true})` | label | BEHAVIOURAL | TransferWorkspace.tsx |
| 26 | 4 | `getByRole('button',{name:'計画を確保する',exact:true})` | role:button +name | BEHAVIOURAL | TransferWorkspace.tsx |
| 26 | 2 | `getByRole('button',{name:'同じ要求を照合・再送'})` | role:button +name | BEHAVIOURAL | RecommendationWorkspace.tsx, TransferWorkspace.tsx, QuoteWorkspace.tsx +1 |
| 26 | 6 | `getByRole('region',{name:'移動詳細'})` | role:region (landmark) +name | BEHAVIOURAL | TransferWorkspace.tsx |
| 26 | 1 | `toContainText(id)` | text | PRESENTATIONAL | — |
| 29 | 2 | `getByRole('button',{name:'計画の全品を実発送',exact:true})` | role:button +name | BEHAVIOURAL | TransferWorkspace.tsx |
| 29 | 2 | `toContainText('IN_TRANSIT')` | text | PRESENTATIONAL | TransferWorkspace.tsx, WearWorkspace.tsx, LedgerWorkspace.tsx |
| 29 | 2 | `getByRole('button',{name:new RegExp(id.slice(0,8))})` | role:button +name | BEHAVIOURAL | — |
| 30 | 2 | `getByLabel('移動明細 '+pieceId,{exact:true})` | label | BEHAVIOURAL | TransferWorkspace.tsx |
| 30 | 1 | `getByRole('button',{name:'選択分を実受領',exact:true})` | role:button +name | BEHAVIOURAL | TransferWorkspace.tsx |
| 30 | 1 | `toContainText('RECEIVED')` | text | PRESENTATIONAL | TransferWorkspace.tsx, LedgerWorkspace.tsx |
| 30 | 1 | `getByRole('button',{name:'選択分の準備完了',exact:true})` | role:button +name | BEHAVIOURAL | TransferWorkspace.tsx |
| 30 | 2 | `toContainText('CLOSED')` | text | PRESENTATIONAL | TransferWorkspace.tsx |
| 32 | 1 | `screenshot({path:'.local/screenshots/e07-transfer-desktop.png',fullPage:true})` | screenshot-path | PRESENTATIONAL | — (artifact path) |
| 32 | 1 | `evaluate(()=>document.documentElement.scrollWidth<=innerWidth)` | computed-style (no h-overflow) | PRESENTATIONAL | — |
| 32 | 1 | `screenshot({path:'.local/screenshots/e07-transfer-mobile-width.png',fullPage:true})` | screenshot-path | PRESENTATIONAL | — (artifact path) |
| 36 | 1 | `getByLabel('ポール数量（ペア）',{exact:true})` | label | BEHAVIOURAL | TransferWorkspace.tsx |
| 36 | 4 | `getByRole('region',{name:'ポール数量明細'})` | role:region (landmark) +name | BEHAVIOURAL | TransferWorkspace.tsx |
| 36 | 1 | `toContainText('計画 3 ペア')` | text | PRESENTATIONAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 36 | 1 | `toContainText('運搬中 3')` | text | PRESENTATIONAL | TransferWorkspace.tsx, WearWorkspace.tsx, LedgerWorkspace.tsx |
| 36 | 1 | `getByLabel('今回のポールペア数')` | label | BEHAVIOURAL | TransferWorkspace.tsx |
| 36 | 1 | `getByRole('button',{name:'ポール数量を実受領',exact:true})` | role:button +name | BEHAVIOURAL | TransferWorkspace.tsx |
| 36 | 1 | `toContainText('運搬中 2 / 検品待ち 1')` | text | PRESENTATIONAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 36 | 1 | `getByRole('button',{name:'ポール数量の準備完了',exact:true})` | role:button +name | BEHAVIOURAL | TransferWorkspace.tsx |
| 36 | 1 | `toContainText('準備完了 1')` | text | PRESENTATIONAL | GuestRecovery.tsx, TransferWorkspace.tsx, StaffManagement.tsx |
| 37 | 1 | `screenshot({path:'.local/screenshots/e07-pole-partial-mobile-width.png',fullPage:true})` | screenshot-path | PRESENTATIONAL | — (artifact path) |
| 40 | 1 | `includes('/api/transfers')` | substring | PRESENTATIONAL | TransferWorkspace.tsx, transfer-http.ts |
| 40 | 2 | `getByRole('status')` | role:status | BEHAVIOURAL | — |
| 40 | 1 | `toContainText('変更停止')` | text | PRESENTATIONAL | RecommendationWorkspace.tsx, TransferWorkspace.tsx, QuoteWorkspace.tsx |
| 45 | 1 | `getByRole('link',{name:'ログアウト',exact:true})` | role:link +name | BEHAVIOURAL | RecommendationWorkspace.tsx, StaffSessionBoundary.tsx, StaffHome.tsx +9 |
| 45 | 1 | `getByRole('button',{name:'ログアウトする',exact:true})` | role:button +name | BEHAVIOURAL | StaffLogout.tsx |
| 45 | 1 | `waitForURL(origin+'/staff/login')` | url | BEHAVIOURAL | page.tsx, page.tsx, page.tsx +23 |
| 45 | 1 | `getByRole('heading',{name:'店舗間移動の利用権限が必要です'})` | role:heading +name | BEHAVIOURAL | page.tsx |
| 48 | 1 | `textContent()` | text | PRESENTATIONAL | — |
| 48 | 1 | `screenshot({path:'.local/screenshots/e07-failure.png',fullPage:true})` | screenshot-path | PRESENTATIONAL | — (artifact path) |

### `tests/inventory/normal-ui.ts`

| L | n | locator / assertion (verbatim) | kind | B/P | producing component |
|---|---|---|---|---|---|
| 16 | 2 | `getByLabel('メールアドレス',{exact:true})` | label | BEHAVIOURAL | GuestRecovery.tsx, StaffManagement.tsx, StaffLogin.tsx +2 |
| 16 | 1 | `getByLabel('パスワード',{exact:true})` | label | BEHAVIOURAL | page.tsx, StaffHome.tsx, StaffManagement.tsx +3 |
| 16 | 1 | `getByRole('button',{name:'ログイン',exact:true})` | role:button +name | BEHAVIOURAL | page.tsx, page.tsx, page.tsx +21 |
| 16 | 1 | `waitForURL(origin+'/staff/ledger')` | url | BEHAVIOURAL | page.tsx, page.tsx, OpsWorkspace.tsx +9 |
| 22 | 1 | `getByRole('button',{name:'スタッフを作成',exact:true})` | role:button +name | BEHAVIOURAL | StaffManagement.tsx |
| 22 | 1 | `getByRole('form',{name:'スタッフ作成'})` | role:form (landmark) +name | BEHAVIOURAL | StaffManagement.tsx |
| 22 | 1 | `getByLabel('表示名',{exact:true})` | label | BEHAVIOURAL | StaffManagement.tsx |
| 22 | 1 | `getByLabel('初期パスワード（15〜128文字）')` | label | BEHAVIOURAL | StaffManagement.tsx |
| 22 | 1 | `getByLabel('Mountain Station',{exact:true})` | label | BEHAVIOURAL | pkg:contracts/store-display.ts |
| 22 | 1 | `getByLabel('期間在庫・自分のHOLD閲覧',{exact:true})` | label | BEHAVIOURAL | StaffManagement.tsx |
| 22 | 1 | `getByLabel('自分のHOLD取得・変更',{exact:true})` | label | BEHAVIOURAL | StaffManagement.tsx |
| 22 | 1 | `getByRole('button',{name:'スタッフ設定を保存'})` | role:button +name | BEHAVIOURAL | StaffManagement.tsx |
| 22 | 1 | `getByRole('heading',{name:settings.displayName,exact:true})` | role:heading +name | BEHAVIOURAL | — |
| 26 | 2 | `getByRole('heading',{name:'期間在庫と仮押さえ',exact:true})` | role:heading +name | BEHAVIOURAL | HoldWorkspace.tsx |
| 26 | 5 | `getByLabel('開始日',{exact:true})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx, QuoteWorkspace.tsx, GuestBooking.tsx +2 |
| 26 | 5 | `getByLabel('最終日',{exact:true})` | label | BEHAVIOURAL | HoldWorkspace.tsx |
| 27 | 3 | `getByLabel('1人目 スキー（1ペア）',{exact:true})` | label | BEHAVIOURAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 27 | 3 | `getByLabel('1人目 スキーブーツ（1足）',{exact:true})` | label | BEHAVIOURAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 27 | 3 | `getByLabel('1人目 ポール（1ペア）',{exact:true})` | label | BEHAVIOURAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 28 | 2 | `getByRole('button',{name:'在庫を照会',exact:true})` | role:button +name | BEHAVIOURAL | HoldWorkspace.tsx |
| 28 | 5 | `getByRole('status')` | role:status | BEHAVIOURAL | — |
| 28 | 2 | `toContainText('確保できる見込み')` | text | PRESENTATIONAL | HoldWorkspace.tsx |
| 28 | 5 | `getByRole('button',{name:'グループを仮押さえ',exact:true})` | role:button +name | BEHAVIOURAL | HoldWorkspace.tsx |
| 28 | 1 | `toContainText('グループ全体の仮押さえを取得')` | text | PRESENTATIONAL | HoldWorkspace.tsx |
| 30 | 1 | `screenshot({path:'.local/screenshots/e06-hold-desktop.png',fullPage:true})` | screenshot-path | PRESENTATIONAL | — (artifact path) |
| 30 | 1 | `evaluate(()=>document.documentElement.scrollWidth<=innerWidth)` | computed-style (no h-overflow) | PRESENTATIONAL | — |
| 30 | 1 | `screenshot({path:'.local/screenshots/e06-hold-mobile-width.png',fullPage:true})` | screenshot-path | PRESENTATIONAL | — (artifact path) |
| 33 | 2 | `getByRole('button',{name:new RegExp(holdId.slice(0,8))})` | role:button +name | BEHAVIOURAL | — |
| 33 | 5 | `getByRole('region',{name:'HOLD詳細'})` | role:region (landmark) +name | BEHAVIOURAL | HoldWorkspace.tsx |
| 33 | 1 | `toContainText('ACTIVE')` | text | PRESENTATIONAL | GuestBooking.tsx, HoldWorkspace.tsx |
| 33 | 1 | `getByRole('button',{name:'条件を一括変更',exact:true})` | role:button +name | BEHAVIOURAL | HoldWorkspace.tsx |
| 33 | 1 | `toContainText('一括変更')` | text | PRESENTATIONAL | HoldWorkspace.tsx |
| 34 | 3 | `getByRole('button',{name:'仮押さえを取り消す',exact:true})` | role:button +name | BEHAVIOURAL | HoldWorkspace.tsx |
| 34 | 3 | `toContainText('RELEASED')` | text | PRESENTATIONAL | GuestBooking.tsx, HoldWorkspace.tsx |
| 35 | 1 | `getByRole('link',{name:'ログアウト',exact:true})` | role:link +name | BEHAVIOURAL | RecommendationWorkspace.tsx, StaffSessionBoundary.tsx, StaffHome.tsx +9 |
| 35 | 1 | `getByRole('button',{name:'ログアウトする',exact:true})` | role:button +name | BEHAVIOURAL | StaffLogout.tsx |
| 35 | 1 | `waitForURL(origin+'/staff/login')` | url | BEHAVIOURAL | page.tsx, page.tsx, page.tsx +23 |
| 38 | 5 | `getByRole('button',{name:'新しい要求',exact:true})` | role:button +name | BEHAVIOURAL | HoldWorkspace.tsx |
| 50 | 1 | `getByRole('button',{name:op==='create'?'グループを仮押さえ':'条件を一括変更',exact:true})` | role:button +name | BEHAVIOURAL | HoldWorkspace.tsx |
| 50 | 4 | `getByRole('button',{name:'同じ要求を照合・再送'})` | role:button +name | BEHAVIOURAL | RecommendationWorkspace.tsx, TransferWorkspace.tsx, QuoteWorkspace.tsx +1 |
| 52 | 1 | `toContainText(recoveredId)` | text | PRESENTATIONAL | — |
| 52 | 5 | `toHaveCount(0)` | count | BEHAVIOURAL | — |
| 61 | 1 | `includes('/api/holds')` | substring | PRESENTATIONAL | HoldWorkspace.tsx, hold-runtime.ts |
| 62 | 1 | `toContainText('変更を停止')` | text | PRESENTATIONAL | TransferWorkspace.tsx, HoldWorkspace.tsx |
| 67 | 4 | `getByLabel('予備在庫を使用する / Use reserve inventory')` | label | BEHAVIOURAL | HoldWorkspace.tsx |
| 73 | 1 | `getByLabel('予備在庫の利用・解除理由')` | label | BEHAVIOURAL | HoldWorkspace.tsx |
| 73 | 1 | `toContainText('予備在庫利用')` | text | PRESENTATIONAL | AmendmentWorkspace.tsx, HoldWorkspace.tsx |
| 75 | 1 | `getByRole('button',{name:'施設全体の在庫枠を表示'})` | role:button +name | BEHAVIOURAL | HoldWorkspace.tsx |
| 75 | 1 | `getByRole('region',{name:'施設全体の在庫枠'})` | role:region (landmark) +name | BEHAVIOURAL | HoldWorkspace.tsx |
| 75 | 1 | `getByRole('columnheader',{name,exact:true})` | role:columnheader +name | BEHAVIOURAL | — |
| 75 | 1 | `locator('input')` | css:tag | PRESENTATIONAL | globals.css, route.ts, guest.css +43 |
| 85 | 1 | `getByRole('heading',{name:'セッションを確認してください'})` | role:heading +name | BEHAVIOURAL | StaffSessionBoundary.tsx |

### `tests/pricing/normal-ui.ts`

| L | n | locator / assertion (verbatim) | kind | B/P | producing component |
|---|---|---|---|---|---|
| 16 | 2 | `getByLabel('メールアドレス',{exact:true})` | label | BEHAVIOURAL | GuestRecovery.tsx, StaffManagement.tsx, StaffLogin.tsx +2 |
| 16 | 1 | `getByLabel('パスワード',{exact:true})` | label | BEHAVIOURAL | page.tsx, StaffHome.tsx, StaffManagement.tsx +3 |
| 16 | 1 | `getByRole('button',{name:'ログイン',exact:true})` | role:button +name | BEHAVIOURAL | page.tsx, page.tsx, page.tsx +21 |
| 16 | 1 | `waitForURL(origin+'/staff/ledger')` | url | BEHAVIOURAL | page.tsx, page.tsx, OpsWorkspace.tsx +9 |
| 20 | 1 | `getByRole('button',{name:'スタッフを作成',exact:true})` | role:button +name | BEHAVIOURAL | StaffManagement.tsx |
| 20 | 1 | `getByRole('form',{name:'スタッフ作成'})` | role:form (landmark) +name | BEHAVIOURAL | StaffManagement.tsx |
| 20 | 1 | `getByLabel('表示名',{exact:true})` | label | BEHAVIOURAL | StaffManagement.tsx |
| 20 | 1 | `getByLabel('初期パスワード（15〜128文字）')` | label | BEHAVIOURAL | StaffManagement.tsx |
| 20 | 1 | `getByLabel('Role',{exact:true})` | label | BEHAVIOURAL | StaffManagement.tsx, hosted-preview-runtime.ts |
| 20 | 1 | `getByLabel('店舗範囲',{exact:true})` | label | BEHAVIOURAL | OpsWorkspace.tsx, StaffManagement.tsx |
| 20 | 1 | `getByLabel('Mountain Station',{exact:true})` | label | BEHAVIOURAL | pkg:contracts/store-display.ts |
| 20 | 1 | `getByLabel(label,{exact:true})` | label | BEHAVIOURAL | — |
| 20 | 2 | `getByRole('button',{name:'スタッフ設定を保存'})` | role:button +name | BEHAVIOURAL | StaffManagement.tsx |
| 20 | 1 | `getByRole('heading',{name,exact:true})` | role:heading +name | BEHAVIOURAL | — |
| 23 | 1 | `getByLabel('料金の対象開始日')` | label | BEHAVIOURAL | QuoteWorkspace.tsx |
| 23 | 1 | `getByLabel('料金の対象終了日')` | label | BEHAVIOURAL | QuoteWorkspace.tsx |
| 23 | 1 | `getByRole('button',{name:'開発用の初期料金を設定'})` | role:button +name | BEHAVIOURAL | QuoteWorkspace.tsx |
| 23 | 1 | `getByRole('region',{name:'料金版',exact:true})` | role:region (landmark) +name | BEHAVIOURAL | RecommendationWorkspace.tsx, QuoteWorkspace.tsx, StaffManagement.tsx +3 |
| 23 | 1 | `toContainText('PRIVATE_AVAILABLE')` | text | PRESENTATIONAL | pkg:core/commercial-price-authority.ts, core/quote-service.ts |
| 26 | 1 | `getByRole('heading',{name:'非公開の料金・見積',exact:true})` | role:heading +name | BEHAVIOURAL | QuoteWorkspace.tsx |
| 26 | 3 | `getByLabel('利用開始日',{exact:true})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx, QuoteWorkspace.tsx, GuestBooking.tsx |
| 26 | 3 | `getByLabel('利用終了日',{exact:true})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx, QuoteWorkspace.tsx, GuestBooking.tsx |
| 26 | 2 | `getByLabel('利用区分',{exact:true})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx, QuoteWorkspace.tsx, HoldWorkspace.tsx |
| 26 | 2 | `getByLabel('スキーのサイズ 1',{exact:true})` | label | BEHAVIOURAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 26 | 2 | `getByLabel('スキーブーツのサイズ 1',{exact:true})` | label | BEHAVIOURAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 26 | 2 | `getByLabel('ポールのサイズ 1',{exact:true})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx, GuestBooking.tsx |
| 26 | 1 | `getByLabel('早割5％の適用見込みを確認')` | label | BEHAVIOURAL | RecommendationWorkspace.tsx, QuoteWorkspace.tsx |
| 28 | 4 | `getByRole('button',{name:'見積を作成して保存',exact:true})` | role:button +name | BEHAVIOURAL | QuoteWorkspace.tsx |
| 28 | 2 | `getByRole('button',{name:'同じ要求を照合・再送'})` | role:button +name | BEHAVIOURAL | RecommendationWorkspace.tsx, TransferWorkspace.tsx, QuoteWorkspace.tsx +1 |
| 28 | 6 | `getByRole('region',{name:'見積詳細'})` | role:region (landmark) +name | BEHAVIOURAL | RecommendationWorkspace.tsx, QuoteWorkspace.tsx |
| 28 | 3 | `toContainText('5,320 円')` | text | PRESENTATIONAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 28 | 1 | `toContainText(quoteId)` | text | PRESENTATIONAL | — |
| 29 | 1 | `screenshot({path:'.local/screenshots/e08-quote-desktop.png',fullPage:true})` | screenshot-path | PRESENTATIONAL | — (artifact path) |
| 29 | 1 | `evaluate(()=>document.documentElement.scrollWidth<=innerWidth)` | computed-style (no h-overflow) | PRESENTATIONAL | — |
| 29 | 1 | `screenshot({path:'.local/screenshots/e08-quote-mobile-width.png',fullPage:true})` | screenshot-path | PRESENTATIONAL | — (artifact path) |
| 32 | 1 | `getByRole('button',{name:'利用者を追加'})` | role:button +name | BEHAVIOURAL | RecommendationWorkspace.tsx, QuoteWorkspace.tsx |
| 32 | 1 | `getByLabel('商品 2',{exact:true})` | label | BEHAVIOURAL | AvatarCustomerPreview.tsx, ContentPhotoWorkspace.tsx, QuoteWorkspace.tsx +6 |
| 32 | 1 | `getByLabel('スキーのサイズ 2',{exact:true})` | label | BEHAVIOURAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 32 | 1 | `toContainText('24,800 円')` | text | PRESENTATIONAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 33 | 2 | `getByRole('button',{name:new RegExp(quoteId.slice(0,8))})` | role:button +name | BEHAVIOURAL | — |
| 36 | 1 | `getByRole('button',{name:'HOLD '+h.id,exact:true})` | role:button +name | BEHAVIOURAL | RecommendationWorkspace.tsx, GuestRecovery.tsx, QuoteWorkspace.tsx +1 |
| 36 | 1 | `toContainText('7,500 円')` | text | PRESENTATIONAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 36 | 2 | `getByRole('status')` | role:status | BEHAVIOURAL | — |
| 36 | 1 | `toContainText('HOLD_CONDITIONS_MISMATCH')` | text | PRESENTATIONAL | GuestBooking.tsx |
| 42 | 1 | `getByRole('link',{name:'ログアウト',exact:true})` | role:link +name | BEHAVIOURAL | RecommendationWorkspace.tsx, StaffSessionBoundary.tsx, StaffHome.tsx +9 |
| 42 | 1 | `getByRole('button',{name:'ログアウトする',exact:true})` | role:button +name | BEHAVIOURAL | StaffLogout.tsx |
| 42 | 1 | `waitForURL(origin+'/staff/login')` | url | BEHAVIOURAL | page.tsx, page.tsx, page.tsx +23 |
| 43 | 1 | `getByRole('button',{name:'スタッフを編集：合成見積担当'})` | role:button +name | BEHAVIOURAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 43 | 1 | `getByRole('form',{name:'スタッフ更新'})` | role:form (landmark) +name | BEHAVIOURAL | StaffManagement.tsx |
| 43 | 1 | `getByLabel('自分の非公開見積閲覧',{exact:true})` | label | BEHAVIOURAL | StaffManagement.tsx |
| 43 | 1 | `toHaveCount(0)` | count | BEHAVIOURAL | — |
| 43 | 1 | `getByRole('heading',{name:'見積の利用権限が必要です'})` | role:heading +name | BEHAVIOURAL | page.tsx |
| 46 | 1 | `textContent()` | text | PRESENTATIONAL | — |
| 46 | 1 | `screenshot({path:'.local/screenshots/e08-failure.png',fullPage:true})` | screenshot-path | PRESENTATIONAL | — (artifact path) |

### `tests/recommendation/normal-ui.ts`

| L | n | locator / assertion (verbatim) | kind | B/P | producing component |
|---|---|---|---|---|---|
| 24 | 2 | `getByLabel('メールアドレス',{exact:true})` | label | BEHAVIOURAL | GuestRecovery.tsx, StaffManagement.tsx, StaffLogin.tsx +2 |
| 24 | 1 | `getByLabel('パスワード',{exact:true})` | label | BEHAVIOURAL | page.tsx, StaffHome.tsx, StaffManagement.tsx +3 |
| 24 | 1 | `getByRole('button',{name:'ログイン',exact:true})` | role:button +name | BEHAVIOURAL | page.tsx, page.tsx, page.tsx +21 |
| 24 | 1 | `waitForURL(origin+'/staff/ledger')` | url | BEHAVIOURAL | page.tsx, page.tsx, OpsWorkspace.tsx +9 |
| 28 | 1 | `getByRole('button',{name:'スタッフを作成',exact:true})` | role:button +name | BEHAVIOURAL | StaffManagement.tsx |
| 28 | 1 | `getByRole('form',{name:'スタッフ作成'})` | role:form (landmark) +name | BEHAVIOURAL | StaffManagement.tsx |
| 28 | 1 | `getByLabel('表示名',{exact:true})` | label | BEHAVIOURAL | StaffManagement.tsx |
| 28 | 1 | `getByLabel('初期パスワード（15〜128文字）')` | label | BEHAVIOURAL | StaffManagement.tsx |
| 28 | 1 | `getByLabel('Role',{exact:true})` | label | BEHAVIOURAL | StaffManagement.tsx, hosted-preview-runtime.ts |
| 28 | 1 | `getByLabel('店舗範囲',{exact:true})` | label | BEHAVIOURAL | OpsWorkspace.tsx, StaffManagement.tsx |
| 28 | 1 | `getByLabel('Mountain Station',{exact:true})` | label | BEHAVIOURAL | pkg:contracts/store-display.ts |
| 28 | 1 | `getByLabel(label,{exact:true})` | label | BEHAVIOURAL | — |
| 28 | 2 | `getByRole('button',{name:'スタッフ設定を保存'})` | role:button +name | BEHAVIOURAL | StaffManagement.tsx |
| 28 | 1 | `getByRole('heading',{name,exact:true})` | role:heading +name | BEHAVIOURAL | — |
| 31 | 1 | `getByLabel('料金の対象開始日')` | label | BEHAVIOURAL | QuoteWorkspace.tsx |
| 31 | 1 | `getByLabel('料金の対象終了日')` | label | BEHAVIOURAL | QuoteWorkspace.tsx |
| 31 | 1 | `getByRole('button',{name:'開発用の初期料金を設定'})` | role:button +name | BEHAVIOURAL | QuoteWorkspace.tsx |
| 31 | 1 | `getByRole('region',{name:'料金版',exact:true})` | role:region (landmark) +name | BEHAVIOURAL | RecommendationWorkspace.tsx, QuoteWorkspace.tsx, StaffManagement.tsx +3 |
| 31 | 1 | `toContainText('PRIVATE_AVAILABLE')` | text | PRESENTATIONAL | pkg:core/commercial-price-authority.ts, core/quote-service.ts |
| 32 | 1 | `getByLabel('競技 '+i,{exact:true})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx |
| 32 | 1 | `getByLabel('利用開始時の年齢区分 '+i,{exact:true})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx |
| 32 | 1 | `getByLabel('身長cm '+i,{exact:true})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx |
| 32 | 1 | `getByLabel('足サイズcm '+i,{exact:true})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx |
| 32 | 1 | `getByLabel('体重kg '+i,{exact:true})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx |
| 32 | 1 | `getByLabel('利用開始時の年齢 '+i,{exact:true})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx |
| 32 | 1 | `getByLabel('レベル '+i,{exact:true})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx |
| 32 | 1 | `getByLabel('ポールのサイズ '+i,{exact:true})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx |
| 33 | 1 | `getByLabel('モデル指定なし・表示したサイズとクラスを選択条件とすることを確認')` | label | BEHAVIOURAL | RecommendationWorkspace.tsx |
| 35 | 1 | `getByRole('heading',{name:'サイズ選択からHOLD・見積へ'})` | role:heading +name | BEHAVIOURAL | RecommendationWorkspace.tsx |
| 35 | 2 | `getByLabel('利用開始日',{exact:true})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx, QuoteWorkspace.tsx, GuestBooking.tsx |
| 35 | 2 | `getByLabel('利用終了日',{exact:true})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx, QuoteWorkspace.tsx, GuestBooking.tsx |
| 35 | 1 | `getByLabel('利用区分',{exact:true})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx, QuoteWorkspace.tsx, HoldWorkspace.tsx |
| 35 | 2 | `getByRole('button',{name:'利用者を追加',exact:true})` | role:button +name | BEHAVIOURAL | RecommendationWorkspace.tsx, QuoteWorkspace.tsx |
| 35 | 2 | `getByLabel('競技 2',{exact:true})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx, LedgerWorkspace.tsx |
| 35 | 1 | `getByLabel('体重kg 2',{exact:true})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx, GuestBooking.tsx |
| 35 | 9 | `toHaveCount(0)` | count | BEHAVIOURAL | — |
| 35 | 1 | `getByLabel('利用開始時の年齢 2',{exact:true})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx |
| 35 | 1 | `getByLabel('レベル 2',{exact:true})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx, GuestBooking.tsx |
| 35 | 5 | `getByRole('button',{name:'推薦候補を確認',exact:true})` | role:button +name | BEHAVIOURAL | RecommendationWorkspace.tsx |
| 35 | 3 | `getByRole('region',{name:'推薦候補',exact:true})` | role:region (landmark) +name | BEHAVIOURAL | RecommendationWorkspace.tsx |
| 35 | 1 | `toContainText('大きめ推奨')` | text | PRESENTATIONAL | RecommendationWorkspace.tsx |
| 35 | 1 | `getByRole('article',{name:'利用者 '+n+' の候補'})` | role:article +name | BEHAVIOURAL | RecommendationWorkspace.tsx, QuoteWorkspace.tsx, AmendmentWorkspace.tsx |
| 35 | 1 | `toContainText('基準 150cm')` | text | PRESENTATIONAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 35 | 1 | `toContainText('145 cm')` | text | PRESENTATIONAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 35 | 1 | `toContainText('155 cm')` | text | PRESENTATIONAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 35 | 1 | `toContainText('ブーツ 26.5cm')` | text | PRESENTATIONAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 36 | 1 | `getByRole('button',{name:'おすすめを選ぶ '+i,exact:true})` | role:button +name | BEHAVIOURAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 36 | 1 | `getByLabel('早割5％の適用見込みを確認')` | label | BEHAVIOURAL | RecommendationWorkspace.tsx, QuoteWorkspace.tsx |
| 36 | 3 | `getByRole('button',{name:'全員分をHOLDして見積を保存',exact:true})` | role:button +name | BEHAVIOURAL | RecommendationWorkspace.tsx |
| 36 | 2 | `getByRole('button',{name:'同じ要求を照合・再送'})` | role:button +name | BEHAVIOURAL | RecommendationWorkspace.tsx, TransferWorkspace.tsx, QuoteWorkspace.tsx +1 |
| 36 | 4 | `getByRole('region',{name:'見積詳細',exact:true})` | role:region (landmark) +name | BEHAVIOURAL | RecommendationWorkspace.tsx, QuoteWorkspace.tsx |
| 36 | 1 | `toContainText('10,640 円')` | text | PRESENTATIONAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 36 | 6 | `getByRole('region',{name:'保存結果',exact:true})` | role:region (landmark) +name | BEHAVIOURAL | RecommendationWorkspace.tsx |
| 36 | 2 | `toContainText(holdId)` | text | PRESENTATIONAL | — |
| 36 | 1 | `screenshot({path:'.local/screenshots/e09-recommendation-desktop.png',fullPage:true})` | screenshot-path | PRESENTATIONAL | — (artifact path) |
| 36 | 1 | `evaluate(()=>document.documentElement.scrollWidth<=innerWidth)` | computed-style (no h-overflow) | PRESENTATIONAL | — |
| 36 | 1 | `screenshot({path:'.local/screenshots/e09-recommendation-mobile-width.png',fullPage:true})` | screenshot-path | PRESENTATIONAL | — (artifact path) |
| 37 | 1 | `getByRole('button',{name:'短めを選ぶ 1',exact:true})` | role:button +name | BEHAVIOURAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 37 | 1 | `getByRole('button',{name:'長めを選ぶ 2',exact:true})` | role:button +name | BEHAVIOURAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 37 | 1 | `toContainText('COMPLETE')` | text | PRESENTATIONAL | BookingCancellation.tsx, RecommendationWorkspace.tsx, BookingAccess.tsx +4 |
| 38 | 1 | `getByRole('article',{name:'利用者 3 の候補'})` | role:article +name | BEHAVIOURAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 38 | 1 | `getByRole('button',{name:'短めを選ぶ '+i,exact:true})` | role:button +name | BEHAVIOURAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 38 | 1 | `getByRole('button',{name:'おすすめを選ぶ 2',exact:true})` | role:button +name | BEHAVIOURAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 38 | 1 | `toContainText('HOLD_FAILED')` | text | PRESENTATIONAL | RecommendationWorkspace.tsx |
| 38 | 1 | `toContainText('INSUFFICIENT')` | text | PRESENTATIONAL | GuestBooking.tsx, HoldWorkspace.tsx |
| 39 | 1 | `getByRole('button',{name:'利用者 3 を除く',exact:true})` | role:button +name | BEHAVIOURAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 39 | 3 | `getByLabel('身長cm 1',{exact:true})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx, GuestBooking.tsx |
| 39 | 1 | `getByRole('button',{name:'利用者 2 を除く',exact:true})` | role:button +name | BEHAVIOURAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 39 | 1 | `toHaveValue('180')` | value | BEHAVIOURAL | public.css, ContentPhotoWorkspace.tsx, avatar.css |
| 40 | 1 | `getByRole('article',{name:'利用者 1 の候補'})` | role:article +name | BEHAVIOURAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 40 | 1 | `toContainText('基準 '+test.target+'cm')` | text | PRESENTATIONAL | RecommendationWorkspace.tsx |
| 40 | 1 | `getByRole('button',{name:'おすすめを選ぶ 1',exact:true})` | role:button +name | BEHAVIOURAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 40 | 3 | `locator('..')` | css:xpath | PRESENTATIONAL | proxy.ts, instrumentation.ts, robots.ts +133 |
| 40 | 1 | `toContainText(test.length+' cm')` | text | PRESENTATIONAL | AvatarCustomerPreview.tsx, RecommendationWorkspace.tsx, AvatarFitPreview.tsx +2 |
| 40 | 2 | `toContainText('割引前の参考額')` | text | PRESENTATIONAL | RecommendationWorkspace.tsx |
| 40 | 1 | `getByRole('button',{name:test.direction+'を選ぶ 1',exact:true})` | role:button +name | BEHAVIOURAL | RecommendationWorkspace.tsx, GuestBooking.tsx |
| 40 | 1 | `toContainText('該当する在庫候補なし／選択不可')` | text | PRESENTATIONAL | RecommendationWorkspace.tsx |
| 40 | 2 | `textContent()` | text | PRESENTATIONAL | — |
| 40 | 1 | `includes('割引前の参考額')` | substring | PRESENTATIONAL | RecommendationWorkspace.tsx |
| 40 | 1 | `toContainText('料金未確認')` | text | PRESENTATIONAL | RecommendationWorkspace.tsx |
| 41 | 1 | `filter(x=>['SKI','SNOWBOARD'].includes(x.family))` | filter | BEHAVIOURAL | PublicChrome.tsx, RecommendationWorkspace.tsx, PriceExplorer.tsx +9 |
| 43 | 1 | `getByRole('link',{name:'ログアウト',exact:true})` | role:link +name | BEHAVIOURAL | RecommendationWorkspace.tsx, StaffSessionBoundary.tsx, StaffHome.tsx +9 |
| 43 | 1 | `getByRole('button',{name:'ログアウトする',exact:true})` | role:button +name | BEHAVIOURAL | StaffLogout.tsx |
| 43 | 1 | `waitForURL(origin+'/staff/login')` | url | BEHAVIOURAL | page.tsx, page.tsx, page.tsx +23 |
| 43 | 1 | `getByRole('button',{name:new RegExp('推薦 '+previewId.slice(0,8))})` | role:button +name | BEHAVIOURAL | RecommendationWorkspace.tsx |
| 43 | 1 | `toContainText('一致しません')` | text | PRESENTATIONAL | RecommendationWorkspace.tsx, GuestBooking.tsx |
| 43 | 1 | `getByRole('button',{name:'スタッフを編集：合成推薦担当'})` | role:button +name | BEHAVIOURAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 43 | 1 | `getByRole('form',{name:'スタッフ更新'})` | role:form (landmark) +name | BEHAVIOURAL | StaffManagement.tsx |
| 43 | 1 | `getByLabel('期間在庫・自分のHOLD閲覧',{exact:true})` | label | BEHAVIOURAL | StaffManagement.tsx |
| 43 | 1 | `getByRole('heading',{name:'推薦プレビューの利用権限が必要です'})` | role:heading +name | BEHAVIOURAL | page.tsx, page.tsx |
| 45 | 1 | `getByRole('status')` | role:status | BEHAVIOURAL | — |
| 45 | 1 | `screenshot({path:'.local/screenshots/e09-failure.png',fullPage:true})` | screenshot-path | PRESENTATIONAL | — (artifact path) |

### `tests/recommendation/audit-followup-ui.ts`

| L | n | locator / assertion (verbatim) | kind | B/P | producing component |
|---|---|---|---|---|---|
| 22 | 1 | `getByLabel('メールアドレス',{exact:true})` | label | BEHAVIOURAL | GuestRecovery.tsx, StaffManagement.tsx, StaffLogin.tsx +2 |
| 22 | 1 | `getByLabel('パスワード',{exact:true})` | label | BEHAVIOURAL | page.tsx, StaffHome.tsx, StaffManagement.tsx +3 |
| 22 | 1 | `getByRole('button',{name:'ログイン',exact:true})` | role:button +name | BEHAVIOURAL | page.tsx, page.tsx, page.tsx +21 |
| 22 | 1 | `waitForURL(origin+'/staff/ledger')` | url | BEHAVIOURAL | page.tsx, page.tsx, OpsWorkspace.tsx +9 |
| 27 | 1 | `getByLabel('競技 '+i,{exact:true})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx |
| 27 | 1 | `getByLabel('利用開始時の年齢区分 '+i,{exact:true})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx |
| 27 | 1 | `getByLabel('身長cm '+i,{exact:true})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx |
| 27 | 1 | `getByLabel('足サイズcm '+i,{exact:true})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx |
| 27 | 1 | `getByLabel('体重kg '+i,{exact:true})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx |
| 27 | 1 | `getByLabel('利用開始時の年齢 '+i,{exact:true})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx |
| 27 | 1 | `getByLabel('レベル '+i,{exact:true})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx |
| 27 | 1 | `getByLabel('ポールのサイズ '+i,{exact:true})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx |
| 29 | 1 | `getByLabel('利用開始日',{exact:true})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx, QuoteWorkspace.tsx, GuestBooking.tsx |
| 29 | 1 | `getByLabel('利用終了日',{exact:true})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx, QuoteWorkspace.tsx, GuestBooking.tsx |
| 29 | 1 | `getByLabel('利用区分',{exact:true})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx, QuoteWorkspace.tsx, HoldWorkspace.tsx |
| 29 | 1 | `getByRole('button',{name:'利用者を追加',exact:true})` | role:button +name | BEHAVIOURAL | RecommendationWorkspace.tsx, QuoteWorkspace.tsx |
| 30 | 1 | `getByRole('button',{name:'推薦候補を確認',exact:true})` | role:button +name | BEHAVIOURAL | RecommendationWorkspace.tsx |
| 31 | 1 | `getByRole('button',{name:'おすすめを選ぶ '+i,exact:true})` | role:button +name | BEHAVIOURAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 31 | 1 | `getByLabel('モデル指定なし・表示したサイズとクラスを選択条件とすることを確認')` | label | BEHAVIOURAL | RecommendationWorkspace.tsx |
| 35 | 2 | `getByRole('button',{name:'全員分をHOLDして見積を保存',exact:true})` | role:button +name | BEHAVIOURAL | RecommendationWorkspace.tsx |
| 37 | 1 | `assert.ok(Date.parse(String(v.quote.snapshot.expiresAt))<=Date.parse(date+'T'+due+':00+09:00'))` | assert | PRESENTATIONAL | TransferWorkspace.tsx |
| 40 | 1 | `getByRole('button',{name:new RegExp('推薦 '+v.preview.id.slice(0,8))})` | role:button +name | BEHAVIOURAL | RecommendationWorkspace.tsx |
| 40 | 2 | `getByRole('region',{name:'見積詳細',exact:true})` | role:region (landmark) +name | BEHAVIOURAL | RecommendationWorkspace.tsx, QuoteWorkspace.tsx |
| 40 | 1 | `toContainText(total.toLocaleString()+' 円')` | text | PRESENTATIONAL | RecommendationWorkspace.tsx, QuoteWorkspace.tsx, BookingWorkspace.tsx |
| 46 | 2 | `getByRole('button',{name:'同じ要求を照合・再送'})` | role:button +name | BEHAVIOURAL | RecommendationWorkspace.tsx, TransferWorkspace.tsx, QuoteWorkspace.tsx +1 |
| 47 | 1 | `toContainText('15,000 円')` | text | PRESENTATIONAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 49 | 1 | `screenshot({path:'.local/screenshots/e09-audit-same-day.png',fullPage:true})` | screenshot-path | PRESENTATIONAL | — (artifact path) |
| 53 | 1 | `assert.ok([409,422].includes(h.status()))` | assert | PRESENTATIONAL | — |
| 53 | 1 | `assert.ok([409,422].includes(q.status()))` | assert | PRESENTATIONAL | — |

### `tests/recommendation/continuation-ui.ts`

| L | n | locator / assertion (verbatim) | kind | B/P | producing component |
|---|---|---|---|---|---|
| 26 | 1 | `getByLabel('メールアドレス',{exact:true})` | label | BEHAVIOURAL | GuestRecovery.tsx, StaffManagement.tsx, StaffLogin.tsx +2 |
| 26 | 1 | `getByLabel('パスワード',{exact:true})` | label | BEHAVIOURAL | page.tsx, StaffHome.tsx, StaffManagement.tsx +3 |
| 26 | 1 | `getByRole('button',{name:'ログイン',exact:true})` | role:button +name | BEHAVIOURAL | page.tsx, page.tsx, page.tsx +21 |
| 26 | 1 | `waitForURL(origin+'/staff/ledger')` | url | BEHAVIOURAL | page.tsx, page.tsx, OpsWorkspace.tsx +9 |
| 40 | 1 | `assert.ok([403,409,422].includes(r.status()),'must reject, status '+r.status())` | assert | PRESENTATIONAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 43 | 1 | `getByRole('button',{name:new RegExp('推薦 '+first.preview.id.slice(0,8))})` | role:button +name | BEHAVIOURAL | RecommendationWorkspace.tsx |
| 43 | 1 | `getByRole('region',{name:'保存結果',exact:true})` | role:region (landmark) +name | BEHAVIOURAL | RecommendationWorkspace.tsx |
| 44 | 2 | `getByRole('button',{name:'推薦候補を確認',exact:true})` | role:button +name | BEHAVIOURAL | RecommendationWorkspace.tsx |
| 45 | 1 | `getByRole('article',{name:'利用者 1 の候補'})` | role:article +name | BEHAVIOURAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 45 | 1 | `toContainText('割引前の参考額')` | text | PRESENTATIONAL | RecommendationWorkspace.tsx |
| 45 | 1 | `getByRole('button',{name:'長めを選ぶ 1',exact:true})` | role:button +name | BEHAVIOURAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 45 | 2 | `getByRole('button',{name:'おすすめを選ぶ 2',exact:true})` | role:button +name | BEHAVIOURAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 45 | 2 | `getByLabel('モデル指定なし・表示したサイズとクラスを選択条件とすることを確認')` | label | BEHAVIOURAL | RecommendationWorkspace.tsx |
| 45 | 2 | `getByRole('button',{name:'全員分をHOLDして見積を保存',exact:true})` | role:button +name | BEHAVIOURAL | RecommendationWorkspace.tsx |
| 46 | 2 | `getByRole('button',{name:new RegExp('推薦 '+v.preview.id.slice(0,8))})` | role:button +name | BEHAVIOURAL | RecommendationWorkspace.tsx |
| 46 | 2 | `getByRole('region',{name:'見積詳細',exact:true})` | role:region (landmark) +name | BEHAVIOURAL | RecommendationWorkspace.tsx, QuoteWorkspace.tsx |
| 46 | 1 | `toContainText('VALID_PRIVATE_ESTIMATE')` | text | PRESENTATIONAL | GuestBooking.tsx |
| 46 | 1 | `screenshot({path:'.local/screenshots/e09-continuation.png',fullPage:true})` | screenshot-path | PRESENTATIONAL | — (artifact path) |
| 57 | 1 | `getByRole('button',{name:'短めを選ぶ 1',exact:true})` | role:button +name | BEHAVIOURAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 57 | 2 | `getByRole('button',{name:'同じ要求を照合・再送'})` | role:button +name | BEHAVIOURAL | RecommendationWorkspace.tsx, TransferWorkspace.tsx, QuoteWorkspace.tsx +1 |
| 57 | 1 | `toContainText('EXPIRED')` | text | PRESENTATIONAL | OpsWorkspace.tsx, GuestBooking.tsx, HoldWorkspace.tsx |
| 65 | 1 | `assert.ok(Date.now()-start<1000)` | assert | PRESENTATIONAL | — |

### `tests/operations/normal-ui.ts`

| L | n | locator / assertion (verbatim) | kind | B/P | producing component |
|---|---|---|---|---|---|
| 28 | 1 | `getByLabel('メールアドレス',{exact:true})` | label | BEHAVIOURAL | GuestRecovery.tsx, StaffManagement.tsx, StaffLogin.tsx +2 |
| 28 | 1 | `getByLabel('パスワード',{exact:true})` | label | BEHAVIOURAL | page.tsx, StaffHome.tsx, StaffManagement.tsx +3 |
| 28 | 1 | `getByRole('button',{name:'ログイン',exact:true})` | role:button +name | BEHAVIOURAL | page.tsx, page.tsx, page.tsx +21 |
| 28 | 1 | `waitForURL(origin+'/staff/ledger')` | url | BEHAVIOURAL | page.tsx, page.tsx, OpsWorkspace.tsx +9 |
| 33 | 1 | `getByLabel('予約ID',{exact:true})` | label | BEHAVIOURAL | CustodyWorkspace.tsx, AmendmentWorkspace.tsx, BookingSearchInput.tsx +1 |
| 33 | 1 | `getByRole('button',{name:'変更対象を読み込む'})` | role:button +name | BEHAVIOURAL | AmendmentWorkspace.tsx |
| 33 | 1 | `getByRole('heading',{name:'変更内容',exact:true})` | role:heading +name | BEHAVIOURAL | AmendmentWorkspace.tsx |
| 33 | 1 | `getByLabel('返却日',{exact:true})` | label | BEHAVIOURAL | AmendmentWorkspace.tsx |
| 33 | 1 | `getByLabel('操作理由（詳細な個人情報は記入しない）')` | label | BEHAVIOURAL | AmendmentWorkspace.tsx |
| 33 | 1 | `getByRole('button',{name:'変更見積を固定'})` | role:button +name | BEHAVIOURAL | AmendmentWorkspace.tsx |
| 33 | 2 | `getByRole('heading',{name:'変更見積',exact:true})` | role:heading +name | BEHAVIOURAL | AmendmentWorkspace.tsx |
| 33 | 1 | `getByRole('button',{name:'この見積で変更を確定'})` | role:button +name | BEHAVIOURAL | AmendmentWorkspace.tsx |
| 33 | 1 | `toHaveCount(0)` | count | BEHAVIOURAL | — |
| 34 | 1 | `getByRole('button',{name:'入金・返金残額を照合'})` | role:button +name | BEHAVIOURAL | AmendmentWorkspace.tsx |
| 34 | 1 | `getByRole('heading',{name:'入金と返金残額'})` | role:heading +name | BEHAVIOURAL | AmendmentWorkspace.tsx |
| 34 | 1 | `getByLabel('元の入金')` | label | BEHAVIOURAL | AmendmentWorkspace.tsx |
| 34 | 1 | `getByLabel('返金依頼額（円）')` | label | BEHAVIOURAL | AmendmentWorkspace.tsx |
| 34 | 1 | `getByRole('button',{name:'例外返金を依頼する'})` | role:button +name | BEHAVIOURAL | AmendmentWorkspace.tsx |
| 35 | 1 | `getByRole('button',{name:'棚卸を開始',exact:true})` | role:button +name | BEHAVIOURAL | InventoryOperationsWorkspace.tsx |
| 35 | 1 | `getByRole('button',{name:'棚卸を読み込む',exact:true})` | role:button +name | BEHAVIOURAL | InventoryOperationsWorkspace.tsx |
| 35 | 1 | `getByRole('heading',{name:'棚卸の照合',exact:true})` | role:heading +name | BEHAVIOURAL | InventoryOperationsWorkspace.tsx |
| 35 | 1 | `getByLabel('用品の個体ID',{exact:true})` | label | BEHAVIOURAL | AssetQrInput.tsx |
| 35 | 1 | `getByRole('button',{name:'入力したIDを照合へ送る'})` | role:button +name | BEHAVIOURAL | AssetQrInput.tsx |
| 35 | 1 | `getByText('今回の読取: 1件', {exact:false})` | text | PRESENTATIONAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 35 | 1 | `getByRole('button',{name:'読取・数量を保存して差異確認へ'})` | role:button +name | BEHAVIOURAL | InventoryOperationsWorkspace.tsx |
| 36 | 1 | `getByRole('button',{name:'個体台帳',exact:true})` | role:button +name | BEHAVIOURAL | LedgerWorkspace.tsx |
| 36 | 1 | `getByPlaceholder('モデル名・ID')` | placeholder | PRESENTATIONAL | LedgerWorkspace.tsx |
| 36 | 1 | `getByRole('button',{name:/^詳細：/})` | role:button +name | BEHAVIOURAL | LedgerWorkspace.tsx |
| 36 | 1 | `getByRole('heading',{name:'用品ラベル',exact:true})` | role:heading +name | BEHAVIOURAL | AssetLabelSheet.tsx |
| 36 | 1 | `locator('.asset-label')` | css:css-class | PRESENTATIONAL | AssetLabelSheet.tsx, operations.css |
| 36 | 1 | `toHaveCount(2)` | count | BEHAVIOURAL | — |
| 36 | 1 | `locator('.asset-label code')` | css:css-class | PRESENTATIONAL | AssetLabelSheet.tsx, operations.css |
| 41 | 1 | `getByLabel('CSVファイル')` | label | BEHAVIOURAL | InventoryOperationsWorkspace.tsx, ContentWorkspace.tsx |
| 41 | 1 | `getByRole('button',{name:'dry-runを保存',exact:true})` | role:button +name | BEHAVIOURAL | InventoryOperationsWorkspace.tsx |
| 41 | 1 | `getByText('dry-run: 確定可能', {exact:false})` | text | PRESENTATIONAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 41 | 1 | `getByLabel('投入理由')` | label | BEHAVIOURAL | InventoryOperationsWorkspace.tsx |
| 41 | 1 | `getByRole('button',{name:'検証済みの在庫を投入',exact:true})` | role:button +name | BEHAVIOURAL | InventoryOperationsWorkspace.tsx |
| 45 | 3 | `getByRole('button',{name:'料金版を読み込む',exact:true})` | role:button +name | BEHAVIOURAL | PriceAdminWorkspace.tsx |
| 45 | 2 | `getByLabel('料金版',{exact:false})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx, QuoteWorkspace.tsx, StaffManagement.tsx +3 |
| 45 | 1 | `getByLabel('理由',{exact:true})` | label | BEHAVIOURAL | OpsWorkspace.tsx, TransferWorkspace.tsx, InventoryOperationsWorkspace.tsx +6 |
| 45 | 1 | `getByLabel('対象開始日')` | label | BEHAVIOURAL | QuoteWorkspace.tsx, PriceAdminWorkspace.tsx |
| 45 | 1 | `getByLabel('対象終了日')` | label | BEHAVIOURAL | QuoteWorkspace.tsx, PriceAdminWorkspace.tsx |
| 45 | 1 | `getByRole('button',{name:'選択した料金版からdraftを作る'})` | role:button +name | BEHAVIOURAL | PriceAdminWorkspace.tsx |
| 46 | 2 | `getByRole('button',{name:'料金表と差分を表示'})` | role:button +name | BEHAVIOURAL | PriceAdminWorkspace.tsx |
| 46 | 1 | `getByRole('heading',{name:/DRAFT · revision/})` | role:heading +name | BEHAVIOURAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 46 | 1 | `getByLabel('商品',{exact:false})` | label | BEHAVIOURAL | AvatarCustomerPreview.tsx, ContentPhotoWorkspace.tsx, QuoteWorkspace.tsx +6 |
| 46 | 1 | `getByLabel('金額（円）')` | label | BEHAVIOURAL | PriceAdminWorkspace.tsx |
| 46 | 1 | `getByRole('button',{name:'draftを更新する'})` | role:button +name | BEHAVIOURAL | PriceAdminWorkspace.tsx |
| 47 | 1 | `getByRole('heading',{name:'複製元との差分'})` | role:heading +name | BEHAVIOURAL | PriceAdminWorkspace.tsx |
| 47 | 1 | `getByLabel('適用日時')` | label | BEHAVIOURAL | PriceAdminWorkspace.tsx |
| 47 | 1 | `getByRole('button',{name:'表示した料金版を確定・適用する'})` | role:button +name | BEHAVIOURAL | PriceAdminWorkspace.tsx |
| 50 | 1 | `locator('h1')` | css:tag | PRESENTATIONAL | globals.css, page.tsx, page.tsx +50 |
| 50 | 1 | `evaluate(()=>document.documentElement.scrollWidth<=innerWidth)` | computed-style (no h-overflow) | PRESENTATIONAL | — |

### `tests/operations/console-ui.ts`

| L | n | locator / assertion (verbatim) | kind | B/P | producing component |
|---|---|---|---|---|---|
| 28 | 1 | `getByLabel('メールアドレス',{exact:true})` | label | BEHAVIOURAL | GuestRecovery.tsx, StaffManagement.tsx, StaffLogin.tsx +2 |
| 28 | 1 | `getByLabel('パスワード',{exact:true})` | label | BEHAVIOURAL | page.tsx, StaffHome.tsx, StaffManagement.tsx +3 |
| 28 | 1 | `getByRole('button',{name:'ログイン',exact:true})` | role:button +name | BEHAVIOURAL | page.tsx, page.tsx, page.tsx +21 |
| 28 | 1 | `waitForURL('**/staff/ledger')` | url | BEHAVIOURAL | page.tsx, globals.css, route.ts +78 |
| 41 | 2 | `getByRole('heading',{name:'運用状況の閲覧権限が必要です'})` | role:heading +name | BEHAVIOURAL | page.tsx |
| 42 | 2 | `getByRole('heading',{name:'運用例外'})` | role:heading +name | BEHAVIOURAL | OpsWorkspace.tsx, StaffHome.tsx, LaunchGateView.tsx +1 |
| 42 | 3 | `toHaveCount(0)` | count | BEHAVIOURAL | — |
| 49 | 5 | `getByRole('button',{name:'読み込む',exact:true})` | role:button +name | BEHAVIOURAL | OpsWorkspace.tsx, StaffHome.tsx, InventoryOperationsWorkspace.tsx +5 |
| 50 | 2 | `getByRole('heading',{name:'PAYMENT_PENDING'})` | role:heading +name | BEHAVIOURAL | OpsWorkspace.tsx, StaffHome.tsx, GuestBooking.tsx |
| 51 | 2 | `locator('section[aria-label="例外一覧"]')` | css:attr+tag | PRESENTATIONAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 51 | 3 | `innerText()` | text | PRESENTATIONAL | — |
| 52 | 1 | `assert.ok(!body.includes(secret),secret)` | assert | PRESENTATIONAL | — |
| 53 | 1 | `assert.ok(body.includes('現在も継続中'))` | assert | PRESENTATIONAL | OpsWorkspace.tsx |
| 53 | 1 | `includes('現在も継続中')` | substring | PRESENTATIONAL | OpsWorkspace.tsx |
| 63 | 1 | `getByLabel('状態')` | label | BEHAVIOURAL | BookingCancellation.tsx, OpsWorkspace.tsx, RecommendationWorkspace.tsx +13 |
| 64 | 1 | `getByText('オンライン返金',{exact:false})` | text | PRESENTATIONAL | OpsWorkspace.tsx |
| 66 | 1 | `assert.ok(text.includes(want),want)` | assert | PRESENTATIONAL | — |
| 67 | 1 | `getByRole('button',{name:/再送\|返金/})` | role:button +name | BEHAVIOURAL | OpsWorkspace.tsx, RecommendationWorkspace.tsx, GuestRecovery.tsx +6 |
| 77 | 1 | `getByRole('button',{name:'稼働状況',exact:true})` | role:button +name | BEHAVIOURAL | OpsWorkspace.tsx |
| 78 | 1 | `locator('section[aria-label="稼働状況"]')` | css:attr+tag | PRESENTATIONAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 79 | 1 | `assert.ok(text.includes(c),c)` | assert | PRESENTATIONAL | — |
| 80 | 1 | `assert.ok(!text.includes(leak),leak)` | assert | PRESENTATIONAL | — |
| 85 | 2 | `getByRole('button',{name:'確認済みにする'})` | role:button +name | BEHAVIOURAL | OpsWorkspace.tsx |
| 90 | 1 | `getByRole('status')` | role:status | BEHAVIOURAL | — |
| 90 | 1 | `toContainText('入金・返金・在庫・予約の状態は変わりません')` | text | PRESENTATIONAL | OpsWorkspace.tsx |
| 99 | 1 | `getByLabel('状態',{exact:true})` | label | BEHAVIOURAL | BookingCancellation.tsx, OpsWorkspace.tsx, RecommendationWorkspace.tsx +13 |
| 102 | 1 | `locator('section[aria-label="例外一覧"] article')` | css:attr+tag | PRESENTATIONAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 103 | 1 | `evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)` | computed-style (no h-overflow) | PRESENTATIONAL | — |

### `tests/operations/launch-ui.ts`

| L | n | locator / assertion (verbatim) | kind | B/P | producing component |
|---|---|---|---|---|---|
| 20 | 1 | `getByLabel('メールアドレス',{exact:true})` | label | BEHAVIOURAL | GuestRecovery.tsx, StaffManagement.tsx, StaffLogin.tsx +2 |
| 20 | 1 | `getByLabel('パスワード',{exact:true})` | label | BEHAVIOURAL | page.tsx, StaffHome.tsx, StaffManagement.tsx +3 |
| 20 | 1 | `getByRole('button',{name:'ログイン',exact:true})` | role:button +name | BEHAVIOURAL | page.tsx, page.tsx, page.tsx +21 |
| 20 | 1 | `waitForURL('**/staff/ledger')` | url | BEHAVIOURAL | page.tsx, globals.css, route.ts +78 |
| 26 | 1 | `getByRole('button',{name:'個体台帳',exact:true})` | role:button +name | BEHAVIOURAL | LedgerWorkspace.tsx |
| 27 | 1 | `getByLabel('競技',{exact:true})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx, LedgerWorkspace.tsx |
| 28 | 2 | `locator('table tbody tr')` | css:tag | PRESENTATIONAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 28 | 1 | `filter({hasText:family})` | text (filter hasText) | PRESENTATIONAL | — |
| 29 | 2 | `getByRole('button',{name:/^詳細：/})` | role:button +name | BEHAVIOURAL | LedgerWorkspace.tsx |
| 30 | 1 | `locator('aside[aria-label="台帳詳細"]')` | css:attr | BEHAVIOURAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 35 | 1 | `locator('.ledger-id')` | css:css-class | PRESENTATIONAL | LedgerWorkspace.tsx, ledger.css |
| 35 | 3 | `innerText()` | text | PRESENTATIONAL | — |
| 36 | 1 | `assert.ok(/^[0-9a-f-]{36}$/.test(id),id)` | assert | PRESENTATIONAL | pkg:core/media-plan.ts, core/photo-job.ts |
| 37 | 6 | `locator('.asset-label')` | css:css-class | PRESENTATIONAL | AssetLabelSheet.tsx, operations.css |
| 38 | 1 | `toHaveCount(2)` | count | BEHAVIOURAL | — |
| 39 | 1 | `locator('code')` | css:other | BEHAVIOURAL | — |
| 40 | 1 | `locator('canvas[aria-label="用品QR '+id+'"]')` | css:attr | BEHAVIOURAL | page.tsx, route.ts, route.ts +1 |
| 41 | 1 | `locator('section',{has:page.locator('.asset-label')})` | css:css-class+tag | PRESENTATIONAL | AssetLabelSheet.tsx, operations.css |
| 42 | 1 | `assert.ok(!text.includes(leak),leak)` | assert | PRESENTATIONAL | — |
| 47 | 1 | `toHaveCount(1)` | count | BEHAVIOURAL | — |
| 49 | 1 | `getByRole('button',{name:'ポール数量',exact:true})` | role:button +name | BEHAVIOURAL | TransferWorkspace.tsx, CustodyWorkspace.tsx, LedgerWorkspace.tsx |
| 51 | 1 | `locator('aside[aria-label="台帳詳細"] .asset-label')` | css:css-class+attr | PRESENTATIONAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 51 | 2 | `toHaveCount(0)` | count | BEHAVIOURAL | — |
| 56 | 1 | `evaluate(el=>el.getBoundingClientRect().width)` | computed-style | PRESENTATIONAL | — |
| 57 | 1 | `assert.ok(width>0&&width<=280,'label width '+width)` | assert | PRESENTATIONAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 58 | 1 | `evaluate(el=>getComputedStyle(el).breakInside)` | computed-style | PRESENTATIONAL | — |
| 61 | 2 | `evaluate(el=>getComputedStyle(el).visibility)` | computed-style | PRESENTATIONAL | — |
| 62 | 1 | `locator('footer.ledger-footer')` | css:css-class+tag | PRESENTATIONAL | LedgerWorkspace.tsx, ledger.css |
| 68 | 2 | `getByRole('heading',{name:'公開準備状況の閲覧権限が必要です'})` | role:heading +name | BEHAVIOURAL | page.tsx |
| 73 | 2 | `getByRole('button',{name:'読み込む',exact:true})` | role:button +name | BEHAVIOURAL | OpsWorkspace.tsx, StaffHome.tsx, InventoryOperationsWorkspace.tsx +5 |
| 74 | 2 | `getByRole('row',{name:/DBスキーマ/})` | role:row +name | BEHAVIOURAL | LaunchGateView.tsx |
| 75 | 1 | `getByRole('row',{name:/実在庫データ/})` | role:row +name | BEHAVIOURAL | LaunchGateView.tsx |
| 75 | 1 | `toContainText('未実施')` | text | PRESENTATIONAL | LaunchGateView.tsx |
| 77 | 1 | `locator('input[type="password"]')` | css:attr+tag | PRESENTATIONAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 78 | 1 | `locator('form')` | css:tag | PRESENTATIONAL | — |
| 79 | 1 | `getByRole('button',{name:new RegExp(forbidden)})` | role:button +name | BEHAVIOURAL | — |
| 80 | 1 | `getByRole('button')` | role:button | BEHAVIOURAL | — |
| 80 | 1 | `filter(t=>t.trim()&&t.trim()!=='読み込む'&&!t.includes('ログアウト'))` | filter | BEHAVIOURAL | RecommendationWorkspace.tsx, StaffSessionBoundary.tsx, StaffHome.tsx +9 |
| 80 | 1 | `includes('ログアウト')` | substring | PRESENTATIONAL | RecommendationWorkspace.tsx, StaffSessionBoundary.tsx, StaffHome.tsx +9 |
| 87 | 1 | `getByRole('heading',{name:'公開準備状況'})` | role:heading +name | BEHAVIOURAL | page.tsx, LaunchGateView.tsx |
| 89 | 1 | `evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)` | computed-style (no h-overflow) | PRESENTATIONAL | — |

### `tests/notification/normal-ui.ts`

| L | n | locator / assertion (verbatim) | kind | B/P | producing component |
|---|---|---|---|---|---|
| 29 | 2 | `getByLabel('メールアドレス',{exact:true})` | label | BEHAVIOURAL | GuestRecovery.tsx, StaffManagement.tsx, StaffLogin.tsx +2 |
| 29 | 2 | `getByLabel('パスワード',{exact:true})` | label | BEHAVIOURAL | page.tsx, StaffHome.tsx, StaffManagement.tsx +3 |
| 29 | 2 | `getByRole('button',{name:'ログイン',exact:true})` | role:button +name | BEHAVIOURAL | page.tsx, page.tsx, page.tsx +21 |
| 29 | 2 | `waitForURL(origin+'/staff/ledger')` | url | BEHAVIOURAL | page.tsx, page.tsx, OpsWorkspace.tsx +9 |
| 34 | 2 | `getByRole('button',{name:'通知状態を読み込む'})` | role:button +name | BEHAVIOURAL | NotificationWorkspace.tsx |
| 34 | 2 | `getByRole('region',{name:'通知一覧'})` | role:region (landmark) +name | BEHAVIOURAL | NotificationWorkspace.tsx |
| 34 | 1 | `toContainText('SENT')` | text | PRESENTATIONAL | NotificationWorkspace.tsx |
| 34 | 1 | `assert.ok(!(await page.content()).includes('synthetic-ui@example.invalid'))` | assert | PRESENTATIONAL | guest.css, useOperationsRequest.ts, RecommendationWorkspace.tsx +13 |
| 34 | 1 | `includes('synthetic-ui@example.invalid')` | substring | PRESENTATIONAL | guest.css, useOperationsRequest.ts, RecommendationWorkspace.tsx +13 |
| 35 | 3 | `getByRole('button',{name:'再送を依頼',exact:true})` | role:button +name | BEHAVIOURAL | NotificationWorkspace.tsx |
| 35 | 2 | `getByRole('status')` | role:status | BEHAVIOURAL | — |
| 35 | 1 | `toContainText('未確認')` | text | PRESENTATIONAL | useOperationsRequest.ts, OpsWorkspace.tsx, RecommendationWorkspace.tsx +15 |
| 35 | 1 | `toContainText('保存しました')` | text | PRESENTATIONAL | useOperationsRequest.ts, RecommendationWorkspace.tsx, ContentPhotoWorkspace.tsx +6 |
| 37 | 1 | `toContainText('PENDING')` | text | PRESENTATIONAL | BookingCancellation.tsx, OpsWorkspace.tsx, ContentPhotoWorkspace.tsx +7 |
| 37 | 1 | `evaluate(()=>document.documentElement.scrollWidth<=innerWidth)` | computed-style (no h-overflow) | PRESENTATIONAL | — |
| 38 | 1 | `toHaveCount(0)` | count | BEHAVIOURAL | — |
| 40 | 1 | `getByRole('button',{name:'ログアウト',exact:true})` | role:button +name | BEHAVIOURAL | RecommendationWorkspace.tsx, StaffSessionBoundary.tsx, StaffHome.tsx +9 |

### `tests/flow/normal-ui.ts`

| L | n | locator / assertion (verbatim) | kind | B/P | producing component |
|---|---|---|---|---|---|
| 14 | 1 | `getByLabel('メールアドレス',{exact:true})` | label | BEHAVIOURAL | GuestRecovery.tsx, StaffManagement.tsx, StaffLogin.tsx +2 |
| 14 | 1 | `getByLabel('パスワード',{exact:true})` | label | BEHAVIOURAL | page.tsx, StaffHome.tsx, StaffManagement.tsx +3 |
| 14 | 1 | `getByRole('button',{name:'ログイン',exact:true})` | role:button +name | BEHAVIOURAL | page.tsx, page.tsx, page.tsx +21 |
| 14 | 1 | `waitForURL(origin+'/staff/ledger')` | url | BEHAVIOURAL | page.tsx, page.tsx, OpsWorkspace.tsx +9 |
| 18 | 2 | `getByRole('button',{name:'スタッフを編集：SYNTHETIC Creator'})` | role:button +name | BEHAVIOURAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 18 | 1 | `getByLabel('予約の閲覧')` | label | BEHAVIOURAL | BookingAccess.tsx, StaffManagement.tsx |
| 18 | 3 | `toHaveValue('allow')` | value | BEHAVIOURAL | globals.css, page.tsx, route.ts +11 |
| 18 | 2 | `getByLabel('受付・貸出')` | label | BEHAVIOURAL | CustodyWorkspace.tsx, StaffManagement.tsx, BookingWorkspace.tsx |
| 18 | 1 | `toHaveValue('default')` | value | BEHAVIOURAL | robots.ts, sitemap.ts, layout.tsx +43 |
| 19 | 3 | `getByLabel('返却・検品')` | label | BEHAVIOURAL | StaffHome.tsx, StaffManagement.tsx |
| 19 | 2 | `getByRole('button',{name:'スタッフ設定を保存'})` | role:button +name | BEHAVIOURAL | StaffManagement.tsx |
| 19 | 2 | `getByRole('form',{name:'スタッフ更新'})` | role:form (landmark) +name | BEHAVIOURAL | StaffManagement.tsx |
| 19 | 6 | `toHaveCount(0)` | count | BEHAVIOURAL | — |
| 20 | 1 | `getByLabel('予約の作成')` | label | BEHAVIOURAL | StaffManagement.tsx |
| 23 | 1 | `includes('sign-out')` | substring | PRESENTATIONAL | StaffLogout.tsx, StaffLedger.tsx, auth-http.ts |
| 24 | 2 | `getByRole('status')` | role:status | BEHAVIOURAL | — |
| 24 | 1 | `toContainText('セッションを確認中')` | text | PRESENTATIONAL | StaffSessionBoundary.tsx |
| 24 | 5 | `getByLabel('料金の対象開始日')` | label | BEHAVIOURAL | QuoteWorkspace.tsx |
| 26 | 2 | `getByRole('button',{name:'開発用の初期料金を設定'})` | role:button +name | BEHAVIOURAL | QuoteWorkspace.tsx |
| 29 | 1 | `getByLabel('料金の対象終了日')` | label | BEHAVIOURAL | QuoteWorkspace.tsx |
| 29 | 1 | `getByRole('region',{name:'料金版',exact:true})` | role:region (landmark) +name | BEHAVIOURAL | RecommendationWorkspace.tsx, QuoteWorkspace.tsx, StaffManagement.tsx +3 |
| 29 | 1 | `toContainText('PRIVATE_AVAILABLE')` | text | PRESENTATIONAL | pkg:core/commercial-price-authority.ts, core/quote-service.ts |
| 31 | 1 | `getByLabel('競技 '+i,{exact:true})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx |
| 31 | 1 | `getByLabel('利用開始時の年齢区分 '+i,{exact:true})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx |
| 31 | 1 | `getByLabel('身長cm '+i,{exact:true})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx |
| 31 | 1 | `getByLabel('足サイズcm '+i,{exact:true})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx |
| 31 | 1 | `getByLabel('体重kg '+i,{exact:true})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx |
| 31 | 1 | `getByLabel('利用開始時の年齢 '+i,{exact:true})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx |
| 31 | 1 | `getByLabel('レベル '+i,{exact:true})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx |
| 31 | 1 | `getByLabel('ポールのサイズ '+i,{exact:true})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx |
| 33 | 1 | `getByLabel('利用開始日',{exact:true})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx, QuoteWorkspace.tsx, GuestBooking.tsx |
| 33 | 1 | `getByLabel('利用終了日',{exact:true})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx, QuoteWorkspace.tsx, GuestBooking.tsx |
| 33 | 1 | `getByRole('button',{name:'利用者を追加',exact:true})` | role:button +name | BEHAVIOURAL | RecommendationWorkspace.tsx, QuoteWorkspace.tsx |
| 33 | 1 | `getByRole('button',{name:'推薦候補を確認',exact:true})` | role:button +name | BEHAVIOURAL | RecommendationWorkspace.tsx |
| 33 | 1 | `getByRole('button',{name:'おすすめを選ぶ '+i,exact:true})` | role:button +name | BEHAVIOURAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 33 | 1 | `getByLabel('モデル指定なし・表示したサイズとクラスを選択条件とすることを確認')` | label | BEHAVIOURAL | RecommendationWorkspace.tsx |
| 33 | 1 | `getByRole('button',{name:'全員分をHOLDして見積を保存',exact:true})` | role:button +name | BEHAVIOURAL | RecommendationWorkspace.tsx |
| 33 | 1 | `getByRole('region',{name:'見積詳細',exact:true})` | role:region (landmark) +name | BEHAVIOURAL | RecommendationWorkspace.tsx, QuoteWorkspace.tsx |
| 33 | 1 | `getByRole('link',{name:'予約情報・決済結果へ'})` | role:link +name | BEHAVIOURAL | RecommendationWorkspace.tsx |
| 33 | 1 | `getByRole('heading',{name:'予約情報と決済照合'})` | role:heading +name | BEHAVIOURAL | BookingWorkspace.tsx |
| 33 | 1 | `getByLabel('保存済み見積ID')` | label | BEHAVIOURAL | BookingWorkspace.tsx |
| 33 | 1 | `getByLabel('合成氏名')` | label | BEHAVIOURAL | BookingWorkspace.tsx |
| 33 | 1 | `getByLabel('架空メール宛先')` | label | BEHAVIOURAL | BookingWorkspace.tsx |
| 33 | 1 | `getByLabel('開発用の合成予約であり、営業規約・請求の確定ではないことを確認')` | label | BEHAVIOURAL | BookingWorkspace.tsx |
| 33 | 1 | `getByRole('button',{name:'合成予約情報を保存',exact:true})` | role:button +name | BEHAVIOURAL | BookingWorkspace.tsx |
| 33 | 3 | `getByRole('region',{name:'開発予約詳細'})` | role:region (landmark) +name | BEHAVIOURAL | BookingWorkspace.tsx |
| 33 | 1 | `toContainText('DRAFT')` | text | PRESENTATIONAL | StaffHome.tsx, GuestBooking.tsx, BookingWorkspace.tsx +2 |
| 34 | 1 | `getByRole('button',{name:'テストアダプタへ照合要求'})` | role:button +name | BEHAVIOURAL | BookingWorkspace.tsx |
| 34 | 2 | `getByRole('button',{name:'同じ保存済み要求を照合'})` | role:button +name | BEHAVIOURAL | CustodyWorkspace.tsx, BookingWorkspace.tsx |
| 34 | 1 | `toContainText('CONFIRMED_DEV')` | text | PRESENTATIONAL | StaffHome.tsx, GuestBooking.tsx, BookingWorkspace.tsx |
| 34 | 2 | `getByLabel('開発予約QR')` | label | BEHAVIOURAL | GuestBooking.tsx, BookingWorkspace.tsx |
| 34 | 1 | `screenshot({path:'.local/screenshots/flow-booking-desktop.png',fullPage:true})` | screenshot-path | PRESENTATIONAL | — (artifact path) |
| 34 | 1 | `evaluate(()=>document.documentElement.scrollWidth<=innerWidth)` | computed-style (no h-overflow) | PRESENTATIONAL | — |
| 34 | 1 | `screenshot({path:'.local/screenshots/flow-booking-mobile-width.png',fullPage:true})` | screenshot-path | PRESENTATIONAL | — (artifact path) |
| 37 | 2 | `getByRole('button',{name:/SYNTHETIC Mixed Group.*CONFIRMED_DEV/})` | role:button +name | BEHAVIOURAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 37 | 1 | `getByRole('region',{name:'予約詳細'})` | role:region (landmark) +name | BEHAVIOURAL | BookingWorkspace.tsx |
| 37 | 1 | `toContainText('決済状況 COMPLETED')` | text | PRESENTATIONAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 37 | 1 | `getByText('合成データ専用のテスト環境です。実予約・実決済ではありません。')` | text | PRESENTATIONAL | BookingWorkspace.tsx |
| 37 | 1 | `getByRole('button',{name:'合成予約情報を保存'})` | role:button +name | BEHAVIOURAL | BookingWorkspace.tsx |
| 37 | 1 | `getByRole('link',{name:'権限を確認して道具の受付・貸出・返却へ'})` | role:link +name | BEHAVIOURAL | BookingWorkspace.tsx |
| 37 | 1 | `toHaveAttribute('href','/staff/rentals')` | attribute | BEHAVIOURAL | StaffHome.tsx, InventoryOperationsWorkspace.tsx, AmendmentWorkspace.tsx +2 |
| 41 | 2 | `getByRole('link',{name:'ログアウト',exact:true})` | role:link +name | BEHAVIOURAL | RecommendationWorkspace.tsx, StaffSessionBoundary.tsx, StaffHome.tsx +9 |
| 41 | 4 | `getByRole('button',{name:'ログアウトする',exact:true})` | role:button +name | BEHAVIOURAL | StaffLogout.tsx |
| 41 | 2 | `waitForURL(origin+'/staff/login')` | url | BEHAVIOURAL | page.tsx, page.tsx, page.tsx +23 |
| 41 | 1 | `toContainText(bookingId)` | text | PRESENTATIONAL | — |
| 42 | 1 | `getByRole('heading',{name:'非公開の予約プレビュー'})` | role:heading +name | BEHAVIOURAL | page.tsx |
| 42 | 1 | `getByText('SYNTHETIC Mixed Group',{exact:true})` | text | PRESENTATIONAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 44 | 1 | `getByRole('alert')` | role:alert | BEHAVIOURAL | — |
| 44 | 2 | `textContent()` | text | PRESENTATIONAL | — |
| 44 | 1 | `locator('select')` | css:tag | PRESENTATIONAL | globals.css, page.tsx, guest.css +25 |
| 44 | 1 | `getAttribute('aria-label')` | attribute | BEHAVIOURAL | BookingCancellation.tsx, PublicChrome.tsx, HomeHero.tsx +29 |

### `tests/flow/asset-reader-ui.ts`

| L | n | locator / assertion (verbatim) | kind | B/P | producing component |
|---|---|---|---|---|---|
| 14 | 9 | `getByRole('button',{name:'カメラを開く'})` | role:button +name | BEHAVIOURAL | AssetQrInput.tsx |
| 15 | 4 | `getByLabel('用品の個体ID')` | label | BEHAVIOURAL | AssetQrInput.tsx |
| 15 | 4 | `getByRole('button',{name:'入力したIDを照合へ送る'})` | role:button +name | BEHAVIOURAL | AssetQrInput.tsx |
| 15 | 5 | `getByRole('region',{name:'用品QR入力'})` | role:region (landmark) +name | BEHAVIOURAL | AssetQrInput.tsx |
| 15 | 4 | `getByRole('status')` | role:status | BEHAVIOURAL | — |
| 15 | 1 | `toContainText('用品の個体ID')` | text | PRESENTATIONAL | AssetQrInput.tsx |
| 15 | 12 | `getByLabel('検出ID一覧')` | label | BEHAVIOURAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 15 | 5 | `toHaveText('')` | text | PRESENTATIONAL | — |
| 15 | 5 | `toHaveText(a)` | text | PRESENTATIONAL | — |
| 15 | 2 | `evaluate(()=>document.documentElement.scrollWidth<=innerWidth)` | computed-style (no h-overflow) | PRESENTATIONAL | — |
| 23 | 1 | `toHaveText(a+','+b)` | text | PRESENTATIONAL | — |
| 23 | 3 | `getByRole('button',{name:'カメラを止める'})` | role:button +name | BEHAVIOURAL | BookingSearchInput.tsx, AssetQrInput.tsx |
| 24 | 1 | `toContainText('許可を待っています')` | text | PRESENTATIONAL | BookingSearchInput.tsx, AssetQrInput.tsx |
| 24 | 2 | `getByRole('button',{name:'入力部品を閉じる'})` | role:button +name | BEHAVIOURAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 26 | 1 | `toContainText(name==='NotAllowedError'?'許可がありません':'見つかりません')` | text | PRESENTATIONAL | BookingSearchInput.tsx, AssetQrInput.tsx |
| 27 | 1 | `getByRole('button')` | role:button | BEHAVIOURAL | — |
| 28 | 2 | `getByLabel('合成照合応答を保留')` | label | BEHAVIOURAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 28 | 3 | `getByLabel('合成照合開始数')` | label | BEHAVIOURAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 28 | 2 | `toHaveText('1')` | text | PRESENTATIONAL | — |
| 28 | 1 | `toContainText('まだ確認できません')` | text | PRESENTATIONAL | AssetQrInput.tsx |
| 28 | 1 | `getByRole('button',{name:'合成応答を完了'})` | role:button +name | BEHAVIOURAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 28 | 1 | `toContainText(a)` | text | PRESENTATIONAL | — |
| 29 | 1 | `toHaveText('0')` | text | PRESENTATIONAL | — |
| 31 | 1 | `evaluate(()=>({video:Array.from(document.querySelectorAll('video')).map(v=>({ready:v.readyState,width:v.videoWidth,height:v.videoHeight,paused:v.paused,hidden:v.hidden,stream:(v.srcObject as MediaStream\|null)?.active})),status:document.querySelector('[role=status]')?.textContent}))` | dom-evaluate | PRESENTATIONAL | staff-home.css, holds.css |
| 31 | 1 | `querySelectorAll('video')` | css:other | BEHAVIOURAL | globals.css, BookingSearchInput.tsx, AssetQrInput.tsx |
| 31 | 1 | `querySelector('[role=status]')` | css:attr | BEHAVIOURAL | staff-home.css, holds.css |
| 31 | 1 | `evaluate(()=>{const v=document.querySelector('video');if(!v)return null;const c=document.createElement('canvas');c.width=v.videoWidth;c.height=v.videoHeight;if(!c.width)return null;const x=c.getContext('2d')!;x.drawImage(v,0,0);return {w:c.width,h:c.height,data:Array.from(x.getImageData(0,0,c.width,c.height).data)};})` | dom-evaluate | PRESENTATIONAL | globals.css, HomeHero.tsx, public.css +6 |
| 31 | 1 | `querySelector('video')` | css:other | BEHAVIOURAL | globals.css, BookingSearchInput.tsx, AssetQrInput.tsx |

### `tests/content/normal-ui.ts`

| L | n | locator / assertion (verbatim) | kind | B/P | producing component |
|---|---|---|---|---|---|
| 24 | 2 | `getByLabel('メールアドレス',{exact:true})` | label | BEHAVIOURAL | GuestRecovery.tsx, StaffManagement.tsx, StaffLogin.tsx +2 |
| 24 | 2 | `getByLabel('パスワード',{exact:true})` | label | BEHAVIOURAL | page.tsx, StaffHome.tsx, StaffManagement.tsx +3 |
| 24 | 2 | `getByRole('button',{name:'ログイン',exact:true})` | role:button +name | BEHAVIOURAL | page.tsx, page.tsx, page.tsx +21 |
| 24 | 2 | `waitForURL(origin+'/staff/ledger')` | url | BEHAVIOURAL | page.tsx, page.tsx, OpsWorkspace.tsx +9 |
| 28 | 1 | `getByRole('region',{name:'現在の下書き'})` | role:region (landmark) +name | BEHAVIOURAL | ContentWorkspace.tsx |
| 28 | 1 | `toContainText('合成 SKI')` | text | PRESENTATIONAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 36 | 2 | `getByLabel('CSVファイル')` | label | BEHAVIOURAL | InventoryOperationsWorkspace.tsx, ContentWorkspace.tsx |
| 37 | 1 | `getByRole('button',{name:'差分を検証して保存',exact:true})` | role:button +name | BEHAVIOURAL | ContentWorkspace.tsx |
| 37 | 3 | `getByRole('button',{name:/^有効な下書きを反映/})` | role:button +name | BEHAVIOURAL | ContentWorkspace.tsx |
| 37 | 2 | `toHaveCount(1)` | count | BEHAVIOURAL | — |
| 38 | 2 | `getByRole('button',{name:'同じ保存要求を照合'})` | role:button +name | BEHAVIOURAL | ContentWorkspace.tsx, WearWorkspace.tsx |
| 39 | 2 | `getByRole('status',{name:'説明処理状態'})` | role:status +name | BEHAVIOURAL | ContentWorkspace.tsx |
| 39 | 1 | `toContainText('一部の下書きを保存済み')` | text | PRESENTATIONAL | ContentWorkspace.tsx |
| 45 | 1 | `getByRole('button',{name:'下書き全体のreleaseを検証'})` | role:button +name | BEHAVIOURAL | ContentWorkspace.tsx |
| 45 | 1 | `getByRole('button',{name:/^非公開releaseへ反映/})` | role:button +name | BEHAVIOURAL | ContentWorkspace.tsx |
| 45 | 1 | `toContainText('保存済み')` | text | PRESENTATIONAL | page.tsx, useOperationsRequest.ts, RecommendationWorkspace.tsx +14 |
| 46 | 2 | `evaluate(()=>document.documentElement.scrollWidth<=innerWidth)` | computed-style (no h-overflow) | PRESENTATIONAL | — |
| 46 | 1 | `screenshot({path:'.local/screenshots/content-fixture-mobile-width.png',fullPage:true})` | screenshot-path | PRESENTATIONAL | — (artifact path) |
| 47 | 1 | `getByText('現在の非公開release '+firstRelease,{exact:true})` | text | PRESENTATIONAL | ContentWorkspace.tsx |
| 55 | 4 | `getByRole('region',{name:'写真一括fixture'})` | role:region (landmark) +name | BEHAVIOURAL | ContentPhotoWorkspace.tsx |
| 57 | 2 | `getByLabel('写真ファイル')` | label | BEHAVIOURAL | ContentPhotoWorkspace.tsx |
| 58 | 3 | `getByRole('button',{name:'選択した写真を送信・再開'})` | role:button +name | BEHAVIOURAL | ContentPhotoWorkspace.tsx |
| 58 | 1 | `getByRole('button',{name:'写真処理を中断',exact:true})` | role:button +name | BEHAVIOURAL | ContentPhotoWorkspace.tsx |
| 58 | 5 | `getByRole('status',{name:'写真処理状態'})` | role:status +name | BEHAVIOURAL | ContentPhotoWorkspace.tsx |
| 58 | 2 | `toContainText('未確認または拒否')` | text | PRESENTATIONAL | ContentPhotoWorkspace.tsx |
| 61 | 3 | `getByRole('button',{name:'保存済み写真jobを照合'})` | role:button +name | BEHAVIOURAL | ContentPhotoWorkspace.tsx |
| 61 | 1 | `toContainText('変換済み 3')` | text | PRESENTATIONAL | ContentPhotoWorkspace.tsx |
| 67 | 1 | `toContainText('処理結果を保存')` | text | PRESENTATIONAL | ContentPhotoWorkspace.tsx, CustodyWorkspace.tsx |
| 68 | 1 | `screenshot({path:'.local/screenshots/photo-fixture-mobile-width.png'})` | screenshot-path | PRESENTATIONAL | — (artifact path) |
| 81 | 1 | `assert.ok(photo.length<10*1024*1024)` | assert | PRESENTATIONAL | — |
| 93 | 1 | `toContainText('別の写真・説明処理が実行中')` | text | PRESENTATIONAL | ContentPhotoWorkspace.tsx |
| 96 | 1 | `toContainText('保存済み。未送信分は')` | text | PRESENTATIONAL | ContentPhotoWorkspace.tsx |
| 113 | 1 | `getByLabel('資料のJSONファイル')` | label | BEHAVIOURAL | ContentWorkspace.tsx |
| 113 | 1 | `getByRole('button',{name:'資料の行を照合して保存'})` | role:button +name | BEHAVIOURAL | ContentWorkspace.tsx |
| 113 | 1 | `getByRole('region',{name:'メーカー資料fixture'})` | role:region (landmark) +name | BEHAVIOURAL | ContentWorkspace.tsx |
| 113 | 1 | `toContainText('保存済み照合行 2件')` | text | PRESENTATIONAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 115 | 1 | `assert.ok(staged.some(r=>r.issues.includes('SOURCE_CHANGED_RECONFIRM')))` | assert | PRESENTATIONAL | content-http.ts |
| 115 | 1 | `includes('SOURCE_CHANGED_RECONFIRM')` | substring | PRESENTATIONAL | content-http.ts |
| 120 | 1 | `getByRole('button',{name:'差分を検証して保存'})` | role:button +name | BEHAVIOURAL | ContentWorkspace.tsx |
| 127 | 1 | `assert.ok(!normal.includes('content-fixture'))` | assert | PRESENTATIONAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 127 | 1 | `includes('content-fixture')` | substring | PRESENTATIONAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 127 | 1 | `assert.ok(source.includes("process.env.NODE_ENV!=='development'"))` | assert | PRESENTATIONAL | instrumentation.ts, robots.ts, sitemap.ts +28 |
| 127 | 1 | `includes("process.env.NODE_ENV!=='development'")` | substring | PRESENTATIONAL | instrumentation.ts, robots.ts, sitemap.ts +28 |

### `tests/avatar/phase5-e2e.ts`

| L | n | locator / assertion (verbatim) | kind | B/P | producing component |
|---|---|---|---|---|---|
| 42 | 2 | `getByLabel('利用開始日',{exact:true})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx, QuoteWorkspace.tsx, GuestBooking.tsx |
| 42 | 1 | `getByLabel('利用終了日',{exact:true})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx, QuoteWorkspace.tsx, GuestBooking.tsx |
| 42 | 1 | `getByRole('button',{name:'用品を選ぶ',exact:true})` | role:button +name | BEHAVIOURAL | GuestBooking.tsx |
| 42 | 1 | `getByLabel('ポールのサイズ 1',{exact:true})` | label | BEHAVIOURAL | RecommendationWorkspace.tsx, GuestBooking.tsx |
| 42 | 1 | `getByRole('button',{name:'候補と参考料金を確認',exact:true})` | role:button +name | BEHAVIOURAL | GuestBooking.tsx |
| 42 | 2 | `getByRole('radio',{name:/おすすめ/})` | role:radio +name | BEHAVIOURAL | RecommendationWorkspace.tsx, AvatarFitPreview.tsx, GuestBooking.tsx |
| 42 | 4 | `locator('[data-avatar-stage]')` | css:attr | BEHAVIOURAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 42 | 3 | `toHaveCount(0)` | count | BEHAVIOURAL | — |
| 54 | 1 | `assert.doesNotMatch(text,/owner_id\|token_sha256\|media_id\|workspace\|bytes\|email\|password/)` | regex | PRESENTATIONAL | pkg:core/context.ts, core/security.ts |
| 57 | 1 | `assert.ok(r.headers()['vary']?.split(',').map(x=>x.trim().toLowerCase()).includes('cookie'))` | assert | PRESENTATIONAL | GuestBooking.tsx, auth-http.ts |
| 57 | 1 | `includes('cookie')` | substring | PRESENTATIONAL | GuestBooking.tsx, auth-http.ts |
| 69 | 1 | `screenshot({path:file,fullPage:true})` | screenshot-path | PRESENTATIONAL | — (artifact path) |
| 71 | 1 | `toHaveCount(1)` | count | BEHAVIOURAL | — |
| 74 | 1 | `getByRole('radio',{name:new RegExp(label)})` | role:radio +name | BEHAVIOURAL | — |
| 76 | 1 | `evaluate(()=>{const b=document.querySelector('[data-layer="AVATAR"]')!.getBoundingClientRect(),s=document.querySelector('[data-layer="SKI"]')!.getBoundingClientRect();return {bodyHeight:b.height,skiHeight:s.height,bodyBottom:b.bottom,skiBottom:s.bottom,overflow:document.documentElement.scrollWidth>innerWidth};})` | computed-style | PRESENTATIONAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 76 | 1 | `querySelector('[data-layer="AVATAR"]')` | css:attr | BEHAVIOURAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 76 | 1 | `querySelector('[data-layer="SKI"]')` | css:attr | BEHAVIOURAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 77 | 1 | `assert.ok(Math.abs(m.skiHeight-m.bodyHeight*offered.lengthCm/170)<=1)` | assert | PRESENTATIONAL | — |
| 77 | 1 | `assert.ok(Math.abs(m.skiBottom-m.bodyBottom)<=1)` | assert | PRESENTATIONAL | — |
| 79 | 2 | `locator('[data-layer="AVATAR"] img')` | css:attr | BEHAVIOURAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 79 | 1 | `getAttribute('src')` | attribute | BEHAVIOURAL | proxy.ts, instrumentation.ts, robots.ts +90 |
| 79 | 1 | `getByRole('button',{name:'見た目 2',exact:true})` | role:button +name | BEHAVIOURAL | page.tsx, AvatarCustomerPreview.tsx, GuestAvatarPreview.tsx +1 |
| 79 | 1 | `toHaveAttribute('src',old!)` | attribute | BEHAVIOURAL | proxy.ts, instrumentation.ts, robots.ts +90 |
| 79 | 1 | `locator('img[src*="_next/image"]')` | css:attr+tag | PRESENTATIONAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 80 | 1 | `getByRole('button',{name:'Appearance 1',exact:true})` | role:button +name | BEHAVIOURAL | AvatarCustomerPreview.tsx, GuestAvatarPreview.tsx |
| 80 | 1 | `locator('.avatar-disclaimer')` | css:css-class | PRESENTATIONAL | AvatarFitPreview.tsx, avatar.css |
| 80 | 1 | `toContainText('completed payment')` | text | PRESENTATIONAL | AvatarFitPreview.tsx |
| 81 | 2 | `getByRole('radio',{name:/RECOMMENDED/i})` | role:radio +name | BEHAVIOURAL | AvatarCustomerPreview.tsx, RecommendationWorkspace.tsx, AvatarFitPreview.tsx +1 |
| 95 | 1 | `getByLabel('メールアドレス',{exact:true})` | label | BEHAVIOURAL | GuestRecovery.tsx, StaffManagement.tsx, StaffLogin.tsx +2 |
| 95 | 1 | `getByLabel('パスワード',{exact:true})` | label | BEHAVIOURAL | page.tsx, StaffHome.tsx, StaffManagement.tsx +3 |
| 96 | 1 | `getByRole('button',{name:'ログイン',exact:true})` | role:button +name | BEHAVIOURAL | page.tsx, page.tsx, page.tsx +21 |
| 96 | 1 | `waitForURL(origin+'/staff/ledger')` | url | BEHAVIOURAL | page.tsx, page.tsx, OpsWorkspace.tsx +9 |
| 99 | 1 | `assert.ok((await (await staff.request.get(staffPreview)).text()).includes(body.derivativeSha256))` | assert | PRESENTATIONAL | — |
| 100 | 2 | `assert.match(await (await staff.request.get(staffPreview)).text(),/Staff sign-in/)` | regex-on-html | PRESENTATIONAL | page.tsx |
| 104 | 1 | `getByLabel('全員のサイズ・モデル条件・ウェア構成を確認した')` | label | BEHAVIOURAL | GuestBooking.tsx |
| 104 | 1 | `getByRole('button',{name:'全員分の最終確認へ'})` | role:button +name | BEHAVIOURAL | GuestBooking.tsx |
| 104 | 1 | `getByRole('region',{name:'全員分の確認'})` | role:region (landmark) +name | BEHAVIOURAL | GuestBooking.tsx |
| 104 | 1 | `toContainText('全員分の参考総額')` | text | PRESENTATIONAL | GuestBooking.tsx |
| 105 | 1 | `getByRole('button',{name:'この予約画面を閉じる'})` | role:button +name | BEHAVIOURAL | GuestBooking.tsx |
| 105 | 1 | `waitForURL(origin+'/ja',{waitUntil:'domcontentloaded'})` | url | BEHAVIOURAL | page.tsx, page.tsx |

### `tests/avatar/phase4-e2e.ts`

| L | n | locator / assertion (verbatim) | kind | B/P | producing component |
|---|---|---|---|---|---|
| 21 | 1 | `assert.match(role,/^zr_[a-f0-9]{12}_content_read$/)` | regex | PRESENTATIONAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 27 | 1 | `includes('/api/auth/')` | substring | PRESENTATIONAL | StaffLogout.tsx, StaffLogin.tsx, StaffLedger.tsx +2 |
| 29 | 1 | `assert.match(html,/Staff sign-in/)` | regex-on-html | PRESENTATIONAL | page.tsx |
| 29 | 1 | `assert.ok(!html.includes(body.derivativeSha256))` | assert | PRESENTATIONAL | — |
| 30 | 1 | `getByLabel('メールアドレス',{exact:true})` | label | BEHAVIOURAL | GuestRecovery.tsx, StaffManagement.tsx, StaffLogin.tsx +2 |
| 30 | 1 | `getByLabel('パスワード',{exact:true})` | label | BEHAVIOURAL | page.tsx, StaffHome.tsx, StaffManagement.tsx +3 |
| 30 | 1 | `getByRole('button',{name:'ログイン',exact:true})` | role:button +name | BEHAVIOURAL | page.tsx, page.tsx, page.tsx +21 |
| 30 | 1 | `waitForURL(origin+'/staff/ledger')` | url | BEHAVIOURAL | page.tsx, page.tsx, OpsWorkspace.tsx +9 |
| 33 | 1 | `assert.ok(!(await r.text()).includes('catalog'))` | assert | PRESENTATIONAL | RecommendationWorkspace.tsx, QuoteWorkspace.tsx, ContentWorkspace.tsx +14 |
| 33 | 1 | `includes('catalog')` | substring | PRESENTATIONAL | RecommendationWorkspace.tsx, QuoteWorkspace.tsx, ContentWorkspace.tsx +14 |
| 53 | 1 | `assert.match(await r.text(),/Staff sign-in/)` | regex-on-html | PRESENTATIONAL | page.tsx |
| 56 | 1 | `screenshot({path:file,fullPage:true})` | screenshot-path | PRESENTATIONAL | — (artifact path) |
| 57 | 1 | `getByRole('heading',{name:'長さのバランスを見る'})` | role:heading +name | BEHAVIOURAL | AvatarFitPreview.tsx |
| 61 | 1 | `getByRole('button',{name:new RegExp('^'+name)})` | role:button +name | BEHAVIOURAL | — |
| 61 | 1 | `locator('[data-layer="SKI"] img')` | css:attr | BEHAVIOURAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 61 | 3 | `locator('[data-layer="AVATAR"] img')` | css:attr | BEHAVIOURAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 63 | 1 | `evaluate(()=>{const layers=Array.from(document.querySelectorAll('[data-layer]')).map(e=>{const b=e.getBoundingClientRect();return {layer:e.getAttribute('data-layer'),x:b.x,y:b.y,width:b.width,height:b.height,right:b.right,bottom:b.bottom};});const b=document.querySelector('[data-avatar-stage]')!.getBoundingClientRect();return {body:layers.find(e=>e.layer==='AVATAR')!,ski:layers.find(e=>e.layer==='SKI')!,stage:{x:b...` | computed-style | PRESENTATIONAL | AvatarFitPreview.tsx |
| 63 | 1 | `querySelectorAll('[data-layer]')` | css:attr | BEHAVIOURAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 63 | 1 | `getAttribute('data-layer')` | attribute | PRESENTATIONAL | AvatarFitPreview.tsx |
| 63 | 1 | `querySelector('[data-avatar-stage]')` | css:attr | BEHAVIOURAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 64 | 1 | `assert.ok(Math.abs(m.ski.height-m.body.height*length/170)<=1)` | assert | PRESENTATIONAL | — |
| 64 | 1 | `assert.ok(Math.abs(m.ski.bottom-m.body.bottom)<=1)` | assert | PRESENTATIONAL | — |
| 64 | 1 | `assert.ok(b.x>=m.stage.x-1&&b.right<=m.stage.right+1&&b.y>=m.stage.y-1&&b.bottom<=m.stage.bottom+1)` | assert | PRESENTATIONAL | — |
| 64 | 1 | `assert.ok(Math.abs(b.x-m.body.x)<1&&Math.abs(b.y-m.body.y)<1&&Math.abs(b.height-m.body.height)<1)` | assert | PRESENTATIONAL | — |
| 68 | 1 | `getAttribute('src')` | attribute | BEHAVIOURAL | proxy.ts, instrumentation.ts, robots.ts +90 |
| 68 | 1 | `getByRole('button',{name:'見た目 2',exact:true})` | role:button +name | BEHAVIOURAL | page.tsx, AvatarCustomerPreview.tsx, GuestAvatarPreview.tsx +1 |
| 68 | 1 | `toHaveAttribute('src',old!)` | attribute | BEHAVIOURAL | proxy.ts, instrumentation.ts, robots.ts +90 |
| 69 | 1 | `getByText('Your height',{exact:true})` | text | PRESENTATIONAL | AvatarFitPreview.tsx |
| 69 | 1 | `getByRole('button',{name:'Appearance 2',exact:true})` | role:button +name | BEHAVIOURAL | AvatarCustomerPreview.tsx, GuestAvatarPreview.tsx |
| 69 | 1 | `locator('.avatar-disclaimer')` | css:css-class | PRESENTATIONAL | AvatarFitPreview.tsx, avatar.css |
| 69 | 1 | `toContainText('completed payment')` | text | PRESENTATIONAL | AvatarFitPreview.tsx |
| 70 | 1 | `locator('[data-avatar-stage] img')` | css:attr | BEHAVIOURAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 70 | 1 | `toHaveCount(2)` | count | BEHAVIOURAL | — |
| 71 | 1 | `locator('[data-avatar-stage]')` | css:attr | BEHAVIOURAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 71 | 1 | `toHaveCount(0)` | count | BEHAVIOURAL | — |
| 71 | 1 | `getByRole('status')` | role:status | BEHAVIOURAL | — |
| 71 | 1 | `toContainText('表示できる素材がありません')` | text | PRESENTATIONAL | AvatarCustomerPreview.tsx |
| 72 | 1 | `locator('img[src*="_next/image"]')` | css:attr+tag | PRESENTATIONAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 73 | 1 | `assert.ok(!html.includes('/preview/avatar'))` | assert | PRESENTATIONAL | page.tsx, route.ts, page.tsx +26 |
| 73 | 1 | `includes('/preview/avatar')` | substring | PRESENTATIONAL | page.tsx, route.ts, page.tsx +26 |
| 73 | 1 | `assert.ok(!source.includes('AvatarFitPreview'))` | assert | PRESENTATIONAL | AvatarCustomerPreview.tsx, GuestAvatarPreview.tsx, AvatarFitPreview.tsx |
| 73 | 1 | `includes('AvatarFitPreview')` | substring | PRESENTATIONAL | AvatarCustomerPreview.tsx, GuestAvatarPreview.tsx, AvatarFitPreview.tsx |

### `tests/auth/staff-flow.ts`

| L | n | locator / assertion (verbatim) | kind | B/P | producing component |
|---|---|---|---|---|---|
| 25 | 2 | `getByLabel('メールアドレス',{exact:true})` | label | BEHAVIOURAL | GuestRecovery.tsx, StaffManagement.tsx, StaffLogin.tsx +2 |
| 25 | 1 | `getByLabel('パスワード',{exact:true})` | label | BEHAVIOURAL | page.tsx, StaffHome.tsx, StaffManagement.tsx +3 |
| 25 | 1 | `getByRole('button',{name:'ログイン',exact:true})` | role:button +name | BEHAVIOURAL | page.tsx, page.tsx, page.tsx +21 |
| 25 | 1 | `` waitForURL(`${origin}/staff/ledger`) `` | url | BEHAVIOURAL | page.tsx, globals.css, route.ts +78 |
| 34 | 1 | `getByRole('button',{name:'スタッフを作成',exact:true})` | role:button +name | BEHAVIOURAL | StaffManagement.tsx |
| 34 | 1 | `getByRole('form',{name:'スタッフ作成'})` | role:form (landmark) +name | BEHAVIOURAL | StaffManagement.tsx |
| 35 | 1 | `getByLabel('表示名',{exact:true})` | label | BEHAVIOURAL | StaffManagement.tsx |
| 35 | 1 | `getByLabel('初期パスワード（15〜128文字）')` | label | BEHAVIOURAL | StaffManagement.tsx |
| 35 | 1 | `getByLabel('Mountain Station',{exact:true})` | label | BEHAVIOURAL | pkg:contracts/store-display.ts |
| 35 | 1 | `getByLabel('台帳の登録・更新',{exact:true})` | label | BEHAVIOURAL | StaffManagement.tsx |
| 35 | 1 | `getByRole('button',{name:'スタッフ設定を保存'})` | role:button +name | BEHAVIOURAL | StaffManagement.tsx |
| 35 | 2 | `getByRole('heading',{name:settings.displayName,exact:true})` | role:heading +name | BEHAVIOURAL | — |
| 41 | 1 | `locator('ul.staff-cards')` | css:css-class+tag | PRESENTATIONAL | StaffManagement.tsx |
| 42 | 1 | `locator('li',{has:adminPage.getByRole('heading',{name:settings.displayName,exact:true})})` | css:css-class+tag | PRESENTATIONAL | proxy.ts, instrumentation.ts, robots.ts +150 |
| 42 | 1 | `toContainText('Mountain Station')` | text | PRESENTATIONAL | pkg:contracts/store-display.ts |
| 43 | 1 | `locator('li',{has:adminPage.getByRole('heading',{name:'合成VIEWER',exact:true})})` | css:css-class+tag | PRESENTATIONAL | proxy.ts, instrumentation.ts, robots.ts +150 |
| 43 | 1 | `getByRole('heading',{name:'合成VIEWER',exact:true})` | role:heading +name | BEHAVIOURAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 43 | 1 | `toContainText('Central Station')` | text | PRESENTATIONAL | pkg:contracts/store-display.ts |
| 44 | 1 | `toContainText(raw)` | text | PRESENTATIONAL | — |
| 45 | 1 | `screenshot({path:'.local/screenshots/e05-staff-management.png',fullPage:true})` | screenshot-path | PRESENTATIONAL | — (artifact path) |
| 45 | 2 | `evaluate(()=>document.documentElement.scrollWidth<=innerWidth)` | computed-style (no h-overflow) | PRESENTATIONAL | — |
| 45 | 1 | `screenshot({path:'.local/screenshots/e05-staff-management-mobile-width.png',fullPage:true})` | screenshot-path | PRESENTATIONAL | — (artifact path) |
| 49 | 5 | `getByRole('heading',{name:'道具の台帳'})` | role:heading +name | BEHAVIOURAL | StaffHome.tsx, LedgerWorkspace.tsx |
| 50 | 1 | `assert.ok(Number(ttl)<=28801&&Number(ttl)>=28790)` | assert | PRESENTATIONAL | — |
| 56 | 2 | `getByRole('button',{name:'＋ 登録',exact:true})` | role:button +name | BEHAVIOURAL | LedgerWorkspace.tsx |
| 56 | 1 | `getByRole('region',{name:'登録フォーム'})` | role:region (landmark) +name | BEHAVIOURAL | LedgerWorkspace.tsx |
| 57 | 1 | `getByRole('combobox',{name:'サイズ・区分',exact:true})` | role:combobox +name | BEHAVIOURAL | HoldWorkspace.tsx, LedgerWorkspace.tsx |
| 57 | 1 | `getByLabel('データ区分')` | label | BEHAVIOURAL | LedgerWorkspace.tsx |
| 57 | 1 | `getByLabel('出典文書')` | label | BEHAVIOURAL | LedgerWorkspace.tsx |
| 57 | 1 | `getByLabel('出典の行・セル・記録キー')` | label | BEHAVIOURAL | LedgerWorkspace.tsx |
| 57 | 2 | `getByLabel('備考',{exact:true})` | label | BEHAVIOURAL | LedgerWorkspace.tsx |
| 57 | 1 | `getByRole('button',{name:'登録を保存'})` | role:button +name | BEHAVIOURAL | LedgerWorkspace.tsx |
| 58 | 1 | `getByRole('complementary',{name:'台帳詳細'})` | role:complementary (landmark) +name | BEHAVIOURAL | LedgerWorkspace.tsx |
| 58 | 1 | `getByText('normal-ui-asset',{exact:true})` | text | PRESENTATIONAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 59 | 1 | `getByRole('button',{name:'基本情報を更新'})` | role:button +name | BEHAVIOURAL | LedgerWorkspace.tsx |
| 59 | 1 | `getByRole('region',{name:'更新フォーム'})` | role:region (landmark) +name | BEHAVIOURAL | LedgerWorkspace.tsx |
| 59 | 1 | `getByLabel('更新理由')` | label | BEHAVIOURAL | LedgerWorkspace.tsx |
| 59 | 1 | `getByRole('button',{name:'変更を保存'})` | role:button +name | BEHAVIOURAL | LedgerWorkspace.tsx |
| 59 | 1 | `getByText('E05 再読込確認',{exact:true})` | text | PRESENTATIONAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 62 | 1 | `screenshot({path:'.local/screenshots/e05-normal-desktop.png',fullPage:true})` | screenshot-path | PRESENTATIONAL | — (artifact path) |
| 62 | 1 | `screenshot({path:'.local/screenshots/e05-normal-mobile-width.png',fullPage:true})` | screenshot-path | PRESENTATIONAL | — (artifact path) |
| 82 | 1 | `getByRole('button',{name:'ログアウト',exact:true})` | role:button +name | BEHAVIOURAL | RecommendationWorkspace.tsx, StaffSessionBoundary.tsx, StaffHome.tsx +9 |
| 82 | 1 | `` waitForURL(`${origin}/staff/login`) `` | url | BEHAVIOURAL | page.tsx, globals.css, route.ts +78 |
| 88 | 1 | `getByRole('heading',{name:'セッションを確認してください'})` | role:heading +name | BEHAVIOURAL | StaffSessionBoundary.tsx |
| 88 | 2 | `toHaveCount(0)` | count | BEHAVIOURAL | — |
| 138 | 1 | `assert.ok(stored.every(r=>!JSON.stringify(r).includes(token)))` | assert | PRESENTATIONAL | — |
| 158 | 1 | `assert.ok(cookies.some(c=>c.startsWith('__Secure-zao-rental.session_token=')&&/; Secure/i.test(c)&&/; HttpOnly/i.test(c)&&/; SameSite=Lax/i.test(c)&&/; Path=\//i.test(c)))` | assert | PRESENTATIONAL | pkg:core/context.ts |
| 164 | 1 | `assert.ok(!JSON.stringify(audit).includes(password))` | assert | PRESENTATIONAL | — |
| 164 | 1 | `assert.ok(!JSON.stringify(audit).includes(newPassword))` | assert | PRESENTATIONAL | — |

### `tests/stabilization/mixed.ts`

| L | n | locator / assertion (verbatim) | kind | B/P | producing component |
|---|---|---|---|---|---|
| 17 | 1 | `getByLabel('メールアドレス',{exact:true})` | label | BEHAVIOURAL | GuestRecovery.tsx, StaffManagement.tsx, StaffLogin.tsx +2 |
| 17 | 1 | `getByLabel('パスワード',{exact:true})` | label | BEHAVIOURAL | page.tsx, StaffHome.tsx, StaffManagement.tsx +3 |
| 17 | 1 | `getByRole('button',{name:'ログイン',exact:true})` | role:button +name | BEHAVIOURAL | page.tsx, page.tsx, page.tsx +21 |
| 17 | 1 | `waitForURL(origin+'/staff/ledger')` | url | BEHAVIOURAL | page.tsx, page.tsx, OpsWorkspace.tsx +9 |
| 25 | 1 | `filter(x=>['SKI','SNOWBOARD'].includes(x.family))` | filter | BEHAVIOURAL | PublicChrome.tsx, RecommendationWorkspace.tsx, PriceExplorer.tsx +9 |
| 46 | 1 | `getByRole('heading',{name:'非公開の料金・見積',exact:true})` | role:heading +name | BEHAVIOURAL | QuoteWorkspace.tsx |
| 46 | 1 | `assert.ok((await page.textContent('body'))!.includes('請求'))` | assert | PRESENTATIONAL | layout.tsx, globals.css, route.ts +48 |
| 46 | 1 | `textContent('body')` | text | PRESENTATIONAL | layout.tsx, globals.css, route.ts +48 |
| 46 | 1 | `includes('請求')` | substring | PRESENTATIONAL | RecommendationWorkspace.tsx, BookingAccess.tsx, QuoteWorkspace.tsx +2 |
| 46 | 1 | `evaluate(()=>document.documentElement.scrollWidth<=innerWidth)` | computed-style (no h-overflow) | PRESENTATIONAL | — |
| 46 | 1 | `screenshot({path:'.local/screenshots/audit-ag-quotes-mobile-width.png',fullPage:true})` | screenshot-path | PRESENTATIONAL | — (artifact path) |
| 47 | 1 | `getByRole('heading',{name:'見積の利用権限が必要です'})` | role:heading +name | BEHAVIOURAL | page.tsx |

### `tests/e2e/booking-access.spec.ts`

| L | n | locator / assertion (verbatim) | kind | B/P | producing component |
|---|---|---|---|---|---|

### `tests/e2e/foundation.spec.ts`

| L | n | locator / assertion (verbatim) | kind | B/P | producing component |
|---|---|---|---|---|---|
| 5 | 1 | `toHaveURL(/\/ja$/)` | url | BEHAVIOURAL | proxy.ts, sitemap.ts, layout.tsx +38 |
| 5 | 1 | `getByRole('heading', { level: 1 })` | role:heading | BEHAVIOURAL | — |
| 6 | 1 | `getByText('この画面は開発用の基盤です')` | text | PRESENTATIONAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 6 | 1 | `toHaveCount(0)` | count | BEHAVIOURAL | — |
| 20 | 1 | `getByRole('heading')` | role:heading | BEHAVIOURAL | — |
| 20 | 1 | `toHaveText('認証が必要です')` | text | PRESENTATIONAL | page.tsx, page.tsx, page.tsx +2 |

### `tests/e2e/ledger-auth.spec.ts`

| L | n | locator / assertion (verbatim) | kind | B/P | producing component |
|---|---|---|---|---|---|
| 3 | 1 | `getByRole('heading',{name:'認証が必要です'})` | role:heading +name | BEHAVIOURAL | page.tsx, page.tsx, page.tsx +2 |
| 3 | 1 | `getByRole('button',{name:'＋ 登録'})` | role:button +name | BEHAVIOURAL | LedgerWorkspace.tsx |
| 3 | 1 | `toHaveCount(0)` | count | BEHAVIOURAL | — |

### `tests/e2e/ledger-ui.spec.ts`

| L | n | locator / assertion (verbatim) | kind | B/P | producing component |
|---|---|---|---|---|---|
| 5 | 5 | `getByText('6 件の台帳記録')` | text | PRESENTATIONAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 5 | 1 | `getByText('合成サンプルを使った画面テストです。実スタッフのログイン・実在庫ではありません。')` | text | PRESENTATIONAL | LedgerWorkspace.tsx |
| 6 | 1 | `evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)` | computed-style (no h-overflow) | PRESENTATIONAL | — |
| 7 | 1 | `` screenshot({path:`.local/screenshots/ledger-${info.project.name}-list.png`,fullPage:true}) `` | screenshot-path | PRESENTATIONAL | — (artifact path) |
| 8 | 2 | `getByRole('combobox',{name:'年齢区分',exact:true})` | role:combobox +name | BEHAVIOURAL | RecommendationWorkspace.tsx, GuestBooking.tsx, HoldWorkspace.tsx +2 |
| 8 | 2 | `getByText('1 件の台帳記録')` | text | PRESENTATIONAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 8 | 1 | `getByRole('cell',{name:'子供 / Regular 100 cm',exact:true})` | role:cell +name | BEHAVIOURAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 9 | 2 | `getByRole('combobox',{name:'クラス',exact:true})` | role:combobox +name | BEHAVIOURAL | RecommendationWorkspace.tsx, GuestBooking.tsx, HoldWorkspace.tsx +2 |
| 9 | 1 | `getByText('0 件の台帳記録')` | text | PRESENTATIONAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 11 | 2 | `getByLabel('サイズ',{exact:true})` | label | BEHAVIOURAL | AvatarCustomerPreview.tsx, GuestAvatarPreview.tsx, RecommendationWorkspace.tsx +10 |
| 11 | 1 | `getByRole('cell',{name:'大人 / Regular 160 cm',exact:true})` | role:cell +name | BEHAVIOURAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 12 | 1 | `getByRole('button',{name:'詳細：検証用スキーブーツ 26.5 cm'})` | role:button +name | BEHAVIOURAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 12 | 4 | `getByRole('complementary',{name:'台帳詳細'})` | role:complementary (landmark) +name | BEHAVIOURAL | LedgerWorkspace.tsx |
| 12 | 2 | `getByText('要確認・未記録',{exact:true})` | text | PRESENTATIONAL | LedgerWorkspace.tsx |
| 13 | 1 | `` screenshot({path:`.local/screenshots/ledger-${info.project.name}-detail.png`,fullPage:true}) `` | screenshot-path | PRESENTATIONAL | — (artifact path) |
| 14 | 2 | `getByRole('button',{name:'基本情報を更新'})` | role:button +name | BEHAVIOURAL | LedgerWorkspace.tsx |
| 14 | 2 | `getByRole('region',{name:'更新フォーム'})` | role:region (landmark) +name | BEHAVIOURAL | LedgerWorkspace.tsx |
| 14 | 1 | `getByLabel('備考',{exact:true})` | label | BEHAVIOURAL | LedgerWorkspace.tsx |
| 14 | 2 | `getByLabel('更新理由')` | label | BEHAVIOURAL | LedgerWorkspace.tsx |
| 14 | 2 | `getByRole('button',{name:'変更を保存'})` | role:button +name | BEHAVIOURAL | LedgerWorkspace.tsx |
| 14 | 1 | `getByText('合成サンプルの表示確認',{exact:true})` | text | PRESENTATIONAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 14 | 1 | `getByText('更新 · 画面テストで確認')` | text | PRESENTATIONAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 15 | 3 | `getByRole('button',{name:'ポール数量',exact:true})` | role:button +name | BEHAVIOURAL | TransferWorkspace.tsx, CustodyWorkspace.tsx, LedgerWorkspace.tsx |
| 15 | 1 | `getByRole('cell',{name:/6 ペア/})` | role:cell +name | BEHAVIOURAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 15 | 2 | `getByText('2 件の台帳記録 / 数量単位：ペア（2本）')` | text | PRESENTATIONAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 16 | 1 | `getByRole('button',{name:'セット構成',exact:true})` | role:button +name | BEHAVIOURAL | LedgerWorkspace.tsx |
| 16 | 1 | `getByRole('button',{name:/詳細：スキーセット/})` | role:button +name | BEHAVIOURAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 16 | 1 | `getByText('ポール × 1 ペア')` | text | PRESENTATIONAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 16 | 1 | `getByRole('cell',{name:'構成定義のみ 物理在庫を増やしません'})` | role:cell +name | BEHAVIOURAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 19 | 1 | `getByRole('button',{name:'商品モデル',exact:true})` | role:button +name | BEHAVIOURAL | LedgerWorkspace.tsx |
| 19 | 2 | `getByRole('button',{name:'＋ 登録',exact:true})` | role:button +name | BEHAVIOURAL | LedgerWorkspace.tsx |
| 19 | 2 | `getByRole('region',{name:'登録フォーム'})` | role:region (landmark) +name | BEHAVIOURAL | LedgerWorkspace.tsx |
| 20 | 1 | `getByLabel('商品コード')` | label | BEHAVIOURAL | LedgerWorkspace.tsx |
| 20 | 1 | `getByLabel('名称',{exact:true})` | label | BEHAVIOURAL | LedgerWorkspace.tsx |
| 20 | 2 | `getByLabel('データ区分')` | label | BEHAVIOURAL | LedgerWorkspace.tsx |
| 20 | 2 | `getByLabel('出典文書')` | label | BEHAVIOURAL | LedgerWorkspace.tsx |
| 20 | 2 | `getByLabel('出典の行・セル・記録キー')` | label | BEHAVIOURAL | LedgerWorkspace.tsx |
| 20 | 2 | `getByRole('button',{name:'登録を保存'})` | role:button +name | BEHAVIOURAL | LedgerWorkspace.tsx |
| 21 | 2 | `getByText('7 件の台帳記録')` | text | PRESENTATIONAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 21 | 1 | `getByRole('button',{name:'詳細：画面テスト追加モデル UI-DEMO-MODEL'})` | role:button +name | BEHAVIOURAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 21 | 1 | `getByText('model-create-case')` | text | PRESENTATIONAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 26 | 1 | `getByRole('combobox',{name:'サイズ・区分',exact:true})` | role:combobox +name | BEHAVIOURAL | HoldWorkspace.tsx, LedgerWorkspace.tsx |
| 27 | 1 | `getByRole('combobox',{name:'BSL確認状況',exact:true})` | role:combobox +name | BEHAVIOURAL | LedgerWorkspace.tsx |
| 28 | 1 | `` screenshot({path:`.local/screenshots/ledger-${info.project.name}-registration.png`,fullPage:true}) `` | screenshot-path | PRESENTATIONAL | — (artifact path) |
| 29 | 1 | `getByText('synthetic-boot-create')` | text | PRESENTATIONAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 30 | 1 | `getByRole('button',{name:'詳細：検証用ポール 110 cm'})` | role:button +name | BEHAVIOURAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 30 | 1 | `getByLabel('数量（ペア / 1ペア＝2本）')` | label | BEHAVIOURAL | LedgerWorkspace.tsx |
| 30 | 1 | `getByText('8 ペア（1ペア＝2本）')` | text | PRESENTATIONAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 30 | 1 | `getByText('更新 · 合成サンプルの数量訂正')` | text | PRESENTATIONAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 35 | 1 | `getByRole('region',{name:'応答順序テスト'})` | role:region (landmark) +name | BEHAVIOURAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 36 | 2 | `getByRole('button',{name:'詳細：検証用スキー 160 cm',exact:true})` | role:button +name | BEHAVIOURAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 36 | 1 | `getByText('保留応答：1 / 完了応答：0')` | text | PRESENTATIONAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 38 | 2 | `getByRole('button',{name:'最初の応答を返す'})` | role:button +name | BEHAVIOURAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 38 | 1 | `getByText('保留応答：0 / 完了応答：1')` | text | PRESENTATIONAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 38 | 2 | `getByRole('heading',{name:'検証用スキー',exact:true})` | role:heading +name | BEHAVIOURAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 38 | 2 | `toHaveCount(0)` | count | BEHAVIOURAL | — |
| 39 | 1 | `getByRole('button',{name:'個体台帳',exact:true})` | role:button +name | BEHAVIOURAL | LedgerWorkspace.tsx |
| 40 | 1 | `getByRole('button',{name:'詳細：検証用スキーブーツ 26.5 cm',exact:true})` | role:button +name | BEHAVIOURAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 40 | 1 | `getByText('保留応答：2 / 完了応答：1')` | text | PRESENTATIONAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 41 | 1 | `getByRole('button',{name:'最後の応答を返す'})` | role:button +name | BEHAVIOURAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 41 | 2 | `getByRole('heading',{name:'検証用スキーブーツ',exact:true})` | role:heading +name | BEHAVIOURAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |
| 42 | 1 | `getByText('保留応答：0 / 完了応答：3')` | text | PRESENTATIONAL | (not literal in apps/web/src — data/DB/i18n or dynamic) |

---
# Static guards (unit tests and scripts that read web source)

`grep -rln "apps/web" tests/unit scripts` → avatar-renderer, group-body, guest-avatar, hosted-preview-diagnostics, hosted-preview-runtime, payment-activation, payment-projection-db, production-webhook-ingress, public-legal, publication-indexing, publication-isolate-consumers, r15-artifact, r15-ingress, square-webhook-receiver, staff-operation-diagnostic, store-display, tax-display, web-diagnostics, worker-tick; scripts: build-ingress.mjs, development-app.ts, ledger-integration.ts, production-app-roles.ts, test-r15-ingress.ts. Of these, only the following read **UI source, markup or copy**. The rest import `lib/*` handlers or route modules, which are behavioural only.

### tests/unit/tax-display.test.ts (reads files as text) — HIGH redesign risk
- `apps/web/src/components/GuestBooking.tsx` must contain **`表示料金はすべて税込です。`** AND **`All prices include Japanese consumption tax.`** (L14-15)
- `apps/web/src/components/BookingAccess.tsx` must contain **`予約金額（税込）`** AND **`Booking total (tax included)`** (L16-17)
- `packages/core` publicPages `prices` summary (ja/en) must include the same two sentences (L18-21)
- Forbidden in **every `.ts/.tsx/.json` under `apps/web/src` and `config/content`** (more than 50 files must be scanned): `/税区分未確認/`, `/税区分は未確認/`, `/税区分・利用規約/`, `/税込・税別の表示基準/`, `/tax display basis remains/i`, `/Tax display and terms/`, `/Price, tax and public approval/` (L25-37)
- `PUBLICATION_ORIGIN === 'https://salomon-rental.yuge-zao.com'`; `publication-authority.ts` must not contain `salomonzao` (L40-43)
- Consequence: moving the tax sentence out of GuestBooking.tsx or BookingAccess.tsx (for example into a shared copy module or the new `price-rows.ts`/`PriceExplorer.tsx`) fails this test, even when the page still shows the sentence.

### tests/unit/store-display.test.ts (scans `apps/web/src/components/*.tsx` and `components/ledger/*.tsx`)
- Forbidden raw store rendering (any match not containing `storeDisplayName|storeName`): `/(?<![=\w])\{[\w.?!]*(?:\.|_)(?:pickupStore|returnStore|store_id|store|[a-z]+_store)\}/`, `/\{s\}<\/option>\)\}/`, `/\{s\}<\/label>/`, `/[\w.?!]*(?:storeIds|stores)\.join\(/`. Allowed exceptions: `PriceAdminWorkspace` and `StaffManagement.tsx: {r}` (L16-20)
- `STORE_LABEL` from `components/guest-format.ts` must deep-equal `{MOUNTAIN_BASE:'Mountain Station',ONSEN_BASE:'Central Station'}`; `storeName(true,'ONSEN_BASE')==='Central Station'` (L9-11)
- Only top-level `.tsx` in those two directories is scanned. New subdirectories such as `components/brand/` are not scanned, which is a coverage gap rather than a failure.

### tests/unit/avatar-renderer.test.ts (SSR `renderToStaticMarkup(AvatarFitPreview)`; CSS imports stubbed)
- Markup must contain `data-layer="AVATAR"` and `data-layer="SKI"`, must contain no `data-layer="SKI"` when the ski is absent, must contain `data-match="GENERIC_REFERENCE|EXACT_PROMISE"` and `alt=""`, and must contain `159` (L20-22)
- `'ウェア'` must be present for WEAR (L23). The markup must not match `/<form|onClick|\/api\/|_next\/image/` and must match `/loading="lazy"/` (L26)
- JA must match `/身長/`. EN must include `Your height`, `Recommended`, `fit`, `safety`, `stock`, `model`, `booking`, `payment` and must match `/aria-hidden="true"/` (L27)
- Guest scope must produce exactly 5 `src="/guest-avatar-media/<draft>/2/person-1/…"` and nothing matching `/src="\/avatar-media\/|src="https?:|_next\/image/` (L30). Invalid input must render `''` (L17, L25, L31)

### tests/avatar/phase4-e2e.ts:73 and tests/content/normal-ui.ts:127 (source reads inside e2e)
- `apps/web/src/components/GuestBooking.tsx` source must NOT include `AvatarFitPreview` (the guest uses GuestAvatarPreview). The `/ja` HTML must not include `/preview/avatar`.
- `apps/web/src/lib/staff-runtime.ts` must not include `content-fixture`.

### tests/unit/payment-activation.test.ts:20-22
- No file under `apps/web/src` may match `/developmentPaymentComposition|development-payment-composition|payment-activation-roles/`.

### tests/unit/publication-indexing.test.ts / publication-isolate-consumers.test.ts (import `apps/web/next.config`, `src/proxy`, `src/app/robots`, `src/app/sitemap`, `src/lib/public-seo`, mock `src/lib/public-content.ts` export `publicModels`)
- `proxy()` sets `X-Robots-Tag: 'noindex, nofollow'` unless the request is exactly on the approved origin for `/ja`, `/en`, `/ja/prices` or `/en/legal/terms`. `robots()` rules are `allow ['/ja','/en']` and disallow `/api/`,`/staff/`,`/admin/`,`/ja/book`,`/en/book`,`/*?*`(,`/ja/booking/`). `publicMetadata()` gives `alternates.canonical '/ja/prices'`, `openGraph.url`, `robots {index,follow}`. next.config `headers` must not set x-robots-tag on pages.
- These tests cover routing and SEO, not markup. They break only if the redesign renames or moves `lib/public-seo.ts`, `lib/public-content.ts` (`publicModels` export), `proxy.ts`, `app/robots.ts` or `app/sitemap.ts`.

### tests/unit/public-legal.test.ts
- Checks only data and logic (`config/content/public-legal.json`, packages/core) plus `apps/web/src/lib/guest-http.ts`, which must match `/'\/prepare-payment'/` and `/'\/checkout'/`. Markup is not covered.

### tests/unit/web-diagnostics.test.ts, guest-avatar.test.ts, p4-decisions.test.ts, test-hygiene.test.ts
- These have no UI dependency. They exercise `lib/staff-operation-diagnostic`, `lib/guest-avatar-http`, `lib/avatar-media-http`, `config/production/*.json` and `scripts/test-hygiene` only.

### tests/automation/controller.test.ts:23
- The literal `allowedPaths:['apps/web/src/app/staff/page.tsx']` is used as fixture data only. If that file is moved, the test still passes, but the path in the fixture becomes misleading.

---
# RISKIEST FOR REDESIGN (top ~40, ordered by likelihood × blast radius)
| # | file:line | dependency (verbatim / summary) | why it breaks |
|---|---|---|---|
| 1 | tests/public/normal-ui.ts:66 | `.pc-menu` bg alpha → contrast ≥4.5; `.pc-menu-cats a`/`.pc-menu-small a` color `rgb(255, 255, 255)`; `.pc-view` `visibility` | **Already broken by WIP** (classes are now `st-mnu*`), and the assertions are pinned to an exact color |
| 2 | tests/public/normal-ui.ts:78 | `document.querySelector('.pc-footer a')` exists and `.pc-footer` is not `inert` after closing | **Already broken by WIP** (`st-ft`) |
| 3 | tests/public/normal-ui.ts:73 | `.pc-footer a` cannot be focused while the dialog is open | Passes vacuously once the class is gone, so focus-trap coverage disappears unnoticed |
| 4 | tests/public/normal-ui.ts:31 | `assert.match(html,/<h1>/)` on 24 public URLs incl. `/ja`, `/en` | Requires an `<h1>` with **no attributes**. Adding `className` to the h1 breaks every page. The WIP home page has no h1 |
| 5 | tests/public/normal-ui.ts:31 | `rel="canonical"`, `hrefLang="x-default"`, `application/ld+json`, `BreadcrumbList`, unique `<title>` per page | Raw initial-HTML regexes. They must survive any layout or head refactor |
| 6 | tests/public/normal-ui.ts:51,55 | `.pc-title-m` text, `.pc-view` href, `.pc-slide.is-active` href, `.pc-hero` `mouseenter` | Swipe test bound to `HomeCampaigns` classes. Replacing it with `HomeHero` (`st-hero*`) breaks the test |
| 7 | tests/public/normal-ui.ts:86-88 | `.pc-wheel li[aria-hidden="false"] button` visible; `.pc-wheel li button` = 3 unique titles; exactly 1 `li[aria-hidden="false"]` @1440 | Desktop campaign wheel markup is pinned: `li` + `button` + `aria-hidden` |
| 8 | tests/public/normal-ui.ts:75 | `getComputedStyle('.pc-view').visibility` must be `'hidden'` with the dialog open and `'visible'` after it closes | The CTA-hiding mechanism must use `visibility`, not `display` or `opacity` |
| 9 | tests/public/normal-ui.ts:64,76,80 | `document.body.style.overflow` `'hidden'`/`''`; focused element `getAttribute('aria-label')==='メニューを開く'` | Scroll lock must be an inline body style. The toggle must carry that exact `aria-label`; visible text is not enough |
| 10 | tests/public/normal-ui.ts:63,69,79 | dialog `{name:'メニュー'}`, `[role="dialog"][aria-modal="true"]`, close button 'メニューを閉じる', link `{name:'SKI',exact:true}` → `/ja/rental/ski$` | Menu semantics and copy are pinned |
| 11 | tests/public/normal-ui.ts:43-45 | `faq.includes('href="/ja/legal/'+doc+'"')` ×4; no `公開文言・利用規約は公開前確認中です`; legal page `/<meta name="robots" content="noindex/` | Footer must render plain relative legal hrefs in SSR HTML. The meta regex depends on attribute order |
| 12 | tests/public/normal-ui.ts:95,96,216,491 | `dl.guest-price dt/dd`; `dd.nth(1)` = advance row (not `¥0`); `dd.last()` = total | Price summary must stay a `<dl class="guest-price">` with this row order |
| 13 | tests/public/normal-ui.ts:391,412-418 | `#guest-err-<key>`, `#guest-err-m0-age`, `#guest-err-m0-pole` + `aria-invalid="true"` | Field-error id scheme (GuestBooking.tsx:303-308 builds `'guest-err-'+key` and `aria-describedby`) |
| 14 | tests/public/normal-ui.ts:403-404,538,548 | `min`/`max`/`step` and `inputmode` = `numeric`/`decimal`/`email` | Input attributes are asserted |
| 15 | tests/public/normal-ui.ts:377 | `main` innerText must not match `/\b[A-Z]{2,}_[A-Z_]{2,}\b/` | Any new visible copy that contains an enum-like token (for example `MOUNTAIN_BASE`, `PAYMENT_PENDING`) on guest pages fails |
| 16 | tests/public/normal-ui.ts:124,169,317,322,353,358 | `/保存されていない入力/` (beforeunload), hasText `処理中です`, `保存されていない変更があります`, `未保存の入力を復元しました`, `unsaved changes`, `Unsaved entries restored` | Exact guest status copy, JA and EN |
| 17 | tests/public/normal-ui.ts:92,224,373,478,496 | regions `全員分の確認`/`Group review`, `予約を続けられません`, `料金の更新` (+ text `全員分の参考総額`) | Region names and copy |
| 18 | tests/readiness/guest-ui.ts:12-14 (+ booking-access/recovery/cancellation-ui) | labels `利用開始日`,`利用終了日`,`ポールのサイズ 1`; buttons `用品を選ぶ`,`候補と参考料金を確認`; text `予約をお持ちの方はこちら`; region `予約画面の回復` > status | Guest booking entry flow copy, used by 5 readiness suites |
| 19 | tests/readiness/booking-access-ui.ts:16-18; cancellation-ui.ts:21-27; booking-recovery-ui.ts:41-59 | heading `予約が確認されました`; regions `予約閲覧の保存`,`予約閲覧の復旧`,`予約のキャンセル`,`キャンセル状況`/`Cancellation status`,`Saved booking`; img `保存済み予約QR`/`Saved booking QR`; `locator('main').getByRole('img')` count 0 | Decorative images inside `main` on the cancelled page break the count. Any brand image must use `alt=""`/`aria-hidden` |
| 20 | tests/staff/home-ui.ts:101-416 | `.staff-card` with `hasText` (13+ uses), `.staff-card` count | StaffHome card class (StaffHome.tsx:118) |
| 21 | tests/staff/home-ui.ts:78-91,84 | regions `本日の業務`,`本日の予約`,`店舗・営業日`,`予約QR・検索`,`運用の注意事項`; heading `スタッフホーム` | Staff home landmark names |
| 22 | tests/auth/staff-flow.ts:41-43 | `ul.staff-cards` → `li` has heading displayName | StaffManagement.tsx:18 list markup (`ul`>`li`>`h2`) |
| 23 | tests/operations/console-ui.ts:51,78,102 | `section[aria-label="例外一覧"]`, `section[aria-label="稼働状況"]`, `section[aria-label="例外一覧"] article` | Tag plus attribute selector. OpsWorkspace.tsx:48-49 must keep `<section>` and `<article>` |
| 24 | tests/operations/console-ui.ts:66 | innerText includes `オンライン返金 / 金額: ¥7,500 / 経過: 3時間 / 要手動調査：結果不明・Provider IDなし（自動再送しません）` and the 店頭返金 variant | Exact composed string: separators, spacing and full-width colons are all pinned |
| 25 | tests/operations/console-ui.ts:53,79-80 | `現在も継続中`; health text includes `APP`,`DB`,`GUEST`,`PAYMENT_ADAPTER`,`MEDIA`,`NOTIFICATION` and excludes `Error` etc. | Ops copy. Note that adding the word "Error" anywhere in the health section fails |
| 26 | tests/operations/launch-ui.ts:28-30 | `table tbody tr` filter hasText family → button `/^詳細：/`; `aside[aria-label="台帳詳細"]` | Ledger list must stay a `<table>` with `<tbody>` rows. Detail must be an `<aside>` |
| 27 | tests/operations/launch-ui.ts:35-41; operations/normal-ui.ts:36 | `.ledger-id` = UUID; `.asset-label` ×2 with `code` text === id; `canvas[aria-label="用品QR <id>"]`; `section` has `.asset-label`; `.asset-label code` allTextContents | Label sheet markup (AssetLabelSheet.tsx:5, LedgerWorkspace.tsx:55) |
| 28 | tests/operations/launch-ui.ts:56-62 | `.asset-label` width ≤280px, `breakInside==='avoid'`, print `visibility` visible; `footer.ledger-footer` print `visibility` hidden | Computed print CSS (operations.css `.asset-label{width:260px;break-inside:avoid}`, print rules) |
| 29 | tests/operations/launch-ui.ts:77-80 | no `input[type="password"]`, no `form`, and **no button except `読み込む`/`ログアウト`** | Any new header, menu or nav button on /admin/launch fails the test |
| 30 | tests/operations/normal-ui.ts:50 | `locator('h1').first()` visible on staff/admin pages @390/768/1440 | Every staff page needs a real `<h1>` |
| 31 | tests/avatar/phase4-e2e.ts:63-64; phase5-e2e.ts:76-77 | bounding boxes of `[data-layer="AVATAR"]`/`[data-layer="SKI"]` give ski height = body×len/170 (±1px), bottoms aligned, inside `[data-avatar-stage]` | Pixel geometry. Any padding, transform or border on the stage or layers breaks it |
| 32 | tests/avatar/phase4-e2e.ts:69-72; phase5-e2e.ts:79-80 | `.avatar-disclaimer` visible; `[data-avatar-stage] img`; no `img[src*="_next/image"]` | Class plus a rule against next/image |
| 33 | tests/unit/tax-display.test.ts:14-17,25 | exact tax sentences inside GuestBooking.tsx and BookingAccess.tsx source; stale-tax regexes across apps/web/src | A source-location guard: moving copy to another module fails it |
| 34 | tests/unit/store-display.test.ts:17-20 | raw `{x.store}`/`{s}</option>)}`/`stores.join(` banned in components/*.tsx | New components must use `storeName`/`storeDisplayName` |
| 35 | tests/unit/avatar-renderer.test.ts:20-30 | SSR attrs `data-layer`, `data-match`, `alt=""`, `loading="lazy"`, `aria-hidden="true"`, EN words list, `/身長/` | AvatarFitPreview copy and attributes are pinned |
| 36 | tests/recommendation/normal-ui.ts:40 | `button{name:'おすすめを選ぶ 1'}.locator('..')` contains `<len> cm`, `割引前の参考額` | Parent-element traversal: wrapping the button in an extra element breaks it |
| 37 | tests/custody/normal-ui.ts:61; wear/normal-ui.ts:33,44,53,59 | articles `ウェア貸出 person-1:WEAR_JACKET`, `/^数量移動 /`, `利用者 20 の候補`, `/^ウェア貸出 /` | `aria-label` on `<article>` built from data keys (WearWorkspace.tsx:40) |
| 38 | tests/e2e/ledger-ui.spec.ts:5-41 | text `6 件の台帳記録`, the long notice `合成サンプルを使った画面テストです。…`, `2 件の台帳記録 / 数量単位：ペア（2本）`; complementary `台帳詳細`; regions `登録フォーム`/`更新フォーム`; cells `子供 / Regular 100 cm`; buttons `詳細：…` | Playwright ui-app imports LedgerWorkspace and globals.css directly |
| 39 | tests/flow/asset-reader-ui.ts:27 | every button in region `用品QR入力` has `boundingBox().height>=44` | The only touch-target size assertion. Compact button styles break it |
| 40 | all suites (24 sites) | `document.documentElement.scrollWidth<=innerWidth` at 320-1440 | Any wide hero, marquee, table or fixed-width element fails it |
| 41 | tests/public/content-ui.ts:23 | `/srcSet=/i`, `/width="800"/`, `/hrefLang="ja"/i`, `/150 cm/` on the public model page | Image markup must remain `<img srcSet width="800">`. Using CSS backgrounds or next/image breaks it |
| 42 | tests/content/Workspace.tsx (fixture) | `className="holds"` + `import '…/components/holds.css'` | Renaming or removing holds.css or its `.holds` scope breaks the content fixture (build) |

## Coverage notes
- Files listed in the brief that exist and were read: all 26 named suites + 4 `tests/e2e/*.spec.ts` + `tests/avatar/phase4-e2e.ts` (it also reads web source). `tests/ui-app` and `tests/flow-app` contain no assertions; they mount components, see the coupling list above.
- Not in the brief but relevant: `tests/avatar/artwork-activation.ts` (viewport loop at 390/1440) was not tabulated.
