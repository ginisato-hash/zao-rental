> Historical pre-redesign/WIP audit recovered from Claude. Findings describe that checkpoint, not the final candidate. See TAKEOVER_RECONCILIATION.md and VALIDATION.md for final dispositions and receipts.

# D — Static guards on apps/web (redesign impact audit)

Repo: `/Users/ginisato/Documents/Codex/2026-10-03/files-pasted-by-the-user-zao/work/f2` (READ-ONLY audit, 2026-10-13). Nothing was run except read-only greps and one in-memory regex replay (store-display, which currently finds 0 matches).

Classification key:
- **PRESENTATIONAL**: the guard pins copy, markup, class/attribute names, file layout or CSS. A redesign can break it while business behaviour stays the same.
- **BEHAVIOURAL**: the guard pins server or authority behaviour. A redesign breaks it only by changing behaviour, or by moving or renaming the module it imports.
- **STRUCTURAL**: the guard pins a file path, an export name or an import, so a move or rename breaks it.

Runner scope: `test:unit` = `node --import tsx --test tests/unit/*.test.ts tests/automation/*.test.ts tests/catalog/*.test.ts` (package.json). `tests/readiness/*.test.ts` (square-s1/s2/s3, toolchain-runtime) is **not** in that glob or in verify.mjs. Those files import only `apps/web/src/lib/square-s*-*` and no UI.

---

## 1. Unit guards that read apps/web source or render components (run in `test:unit`)

### 1.1 tests/unit/store-display.test.ts
| file:line | exact assertion | target read | UI change that breaks it | class |
|---|---|---|---|---|
| store-display.test.ts:9 | `assert.deepEqual({...STORE_DISPLAY_NAMES},{MOUNTAIN_BASE:'Mountain Station',ONSEN_BASE:'Central Station'})` | packages/contracts/src/store-display.ts:3 | Renaming the display names in the dictionary | PRESENTATIONAL (Owner-decided copy) |
| :10 | `storeDisplayName('MOUNTAIN_BASE')==='Mountain Station'`, `('ONSEN_BASE')==='Central Station'`, `('SYSTEM')==='SYSTEM'` | store-display.ts:5 | Same as above; also changing the pass-through behaviour | PRESENTATIONAL |
| :11 | `assert.deepEqual(STORE_LABEL,{...STORE_DISPLAY_NAMES})`; `storeName(true,'ONSEN_BASE')==='Central Station'` | apps/web/src/components/guest-format.ts:6-7 (imported) | Moving or renaming `guest-format.ts`, or the `STORE_LABEL`/`storeName` exports; making STORE_LABEL differ from the dictionary | STRUCTURAL + PRESENTATIONAL |
| :16-20 | Walks **only** `apps/web/src/components/*.tsx` and `apps/web/src/components/ledger/*.tsx` (not `brand/`, not `app/`). Fails if any file's first match of these regexes lacks `storeDisplayName\|storeName`: `/(?<![=\w])\{[\w.?!]*(?:\.\|_)(?:pickupStore\|returnStore\|store_id\|store\|[a-z]+_store)\}/`, `/\{s\}<\/option>\)\}/`, `/\{s\}<\/label>/`, `/[\w.?!]*(?:storeIds\|stores)\.join\(/`. Allowlist: `/PriceAdminWorkspace\|StaffManagement.tsx: \{r\}/` | all .tsx in components/ and components/ledger/ | New JSX that renders `{x.store}`, `{b.pickupStore}`, `{row.store_id}`, `{s}</option>)}`, `{s}</label>` or `stores.join(` directly. **Renaming variables** can also trip it, e.g. a loop var `s` rendered inside `<option>`. New components outside these two dirs are **not** scanned, so the guard silently loses coverage there. | BEHAVIOURAL intent (no raw IDs) enforced by source shape: PRESENTATIONAL risk |

### 1.2 tests/unit/tax-display.test.ts
| file:line | exact assertion | target read | breaks if | class |
|---|---|---|---|---|
| tax-display.test.ts:14-15 | `guest.includes('表示料金はすべて税込です。') && guest.includes('All prices include Japanese consumption tax.')` | apps/web/src/components/GuestBooking.tsx (literals at :368) | The JA/EN tax sentence is reworded (punctuation `。` included), moved to another component or dictionary file, or **GuestBooking.tsx is renamed or split** | PRESENTATIONAL (Owner decision Issue 47) |
| :16-17 | `access.includes('予約金額（税込）') && access.includes('Booking total (tax included)')` | apps/web/src/components/BookingAccess.tsx (:40) | The label is reworded (full-width brackets `（）`), or the file is renamed or split | PRESENTATIONAL |
| :18-21 | `publicPages.filter(p=>p.path==='prices')` locales == `['en','ja']`; ja summary includes `表示料金はすべて税込です。`; en summary includes `All prices include Japanese consumption tax.` | config/content/public-p0-pages.json:187,:200 via packages/core/src/content/public-pages.ts:2,5 | Rewriting the `prices` page summaries or removing or renaming the `prices` path | PRESENTATIONAL |
| :25-37 | Walks `apps/web/src` and `config/content` for `*.ts/*.tsx/*.json` (CSS not scanned). Requires `files.length > 50` (currently 153). Forbidden: `/税区分未確認/`, `/税区分は未確認/`, `/税区分・利用規約/`, `/税込・税別の表示基準/`, `/tax display basis remains/i`, `/Tax display and terms/`, `/Price, tax and public approval/` | every ts/tsx/json under apps/web/src and config/content | New copy containing any of those phrases (e.g. a pending-state banner); heavy file consolidation below 51 files (unlikely) | PRESENTATIONAL (forbidden-string guard) |
| :41-43 | `PUBLICATION_ORIGIN==='https://salomon-rental.yuge-zao.com'`; `publication-authority.ts` must not include `salomonzao` | packages/auth/src/publication-authority.ts | Not UI. (Memory: editing the public origin constant is refused by approval review.) | BEHAVIOURAL |

### 1.3 tests/unit/avatar-renderer.test.ts (SSR render of a UI component)
Setup :12-13 registers a loader hook. `.css` imports become an **empty module**, `next/image` is shimmed, and then it imports `apps/web/src/components/AvatarFitPreview`. Line :15 renders with `renderToStaticMarkup(createElement(AvatarFitPreview,{visualization,direction:'RECOMMENDED',locale}))`.

| file:line | exact assertion | breaks if | class |
|---|---|---|---|
| :12-13 | Component import with the CSS hook | AvatarFitPreview is renamed or moved; the named export changes; it switches to a **CSS Module** (`import s from './x.module.css'`: the hook returns `source:''`, so there is no default export and the test crashes); it gains imports that fail outside Next (next/font, server-only) | STRUCTURAL |
| :17, :24, :25, :31 | `assert.equal(dom(v),'')` for null, invalid, zero artwork, SNOWBOARD, invalid numbers, invalid scope | The component starts rendering a wrapper or placeholder (e.g. an empty-state card) when layout is null | BEHAVIOURAL (fail-closed), sensitive to markup |
| :20 | `!dom(p).includes('data-layer="SKI"')`; `dom(p).includes('159')` | The `data-layer` attribute is renamed or removed; the height/length number is no longer rendered as text | PRESENTATIONAL (attribute contract) |
| :21 | `dom(p).includes('data-layer="AVATAR"')`; `!dom(p).includes('male')` | Attribute renamed; **any copy containing the substring "male"** (e.g. "female", "Male model") | PRESENTATIONAL |
| :22 | `assert.match(dom(p),new RegExp('data-match="'+match+'"'))`; `assert.match(dom(p),/alt=""/)` | `data-match` removed; alt text added to layer images | PRESENTATIONAL |
| :23 | `dom(p).includes('ウェア')` (WEAR-only branch, AvatarFitPreview.tsx:27 `ウェアの重なりを確認`) | The WEAR fallback copy no longer contains `ウェア` | PRESENTATIONAL |
| :26 | Render is deterministic and the input is not mutated; `!/<form\|onClick\|\/api\/\|_next\/image/.test(first)`; `assert.match(first,/loading="lazy"/)` | A `<form>` or a literal `/api/` string in the markup; switching to an optimised `next/image` (the `_next/image` URL); removing `loading="lazy"` | PRESENTATIONAL + BEHAVIOURAL |
| :27 | `assert.match(dom(payload()),/身長/)`; EN markup must include each of `'Your height','Recommended','fit','safety','stock','model','booking','payment'`; `assert.match(en,/aria-hidden="true"/)` | Rewording the label `身長`/`Your height`, the direction label `Recommended` (avatarDirectionLabels :10) or the EN disclaimer (:11) so that any of those words disappears; removing `aria-hidden="true"` on layers | PRESENTATIONAL (legal-ish disclaimer meaning) |
| :28 | `!text.includes('data-layer="AVATAR"')`, `'data-layer="SKI"'`, `'../secret'` | Attribute rename | BEHAVIOURAL |
| :30 | Exactly 5 matches of `/src="\/guest-avatar-media\/31000000-0000-4000-8000-000000000500\/2\/person-1\//g`; `assert.doesNotMatch(text,/src="\/avatar-media\/\|src="https?:\|_next\/image/)` | Changing the image count (e.g. adding a decorative `<img>` with a src) or the image URL building | BEHAVIOURAL (scoped media), markup-sensitive |

### 1.4 tests/unit/payment-activation.test.ts
| :20-22 | `files('apps/web/src')` recursive `*.ts(x)`; each `assert.doesNotMatch(src,/developmentPaymentComposition\|development-payment-composition\|payment-activation-roles/)` | Any UI file mentioning these identifiers (even in comments) | BEHAVIOURAL (forbidden import) |
|---|---|---|---|

### 1.5 tests/unit/public-legal.test.ts
| file:line | exact assertion | target | breaks if | class |
|---|---|---|---|---|
| :12-18 | The legal JSON has every `LEGAL_DOCS` doc in en and ja; each has `state==='OWNER_APPROVED'`, `approvedBy==='佐藤慎太郎'`, `approvedAt==='2026-10-09T22:53:05Z'` and sections.length>0; `note` matches `/6090629658/` and `/668d895c…e2d6/` | config/content/public-legal.json; LEGAL_DOCS at packages/core/src/content/public-legal.ts:6 | Any edit to the legal text JSON's provenance fields; re-approval workflow | BEHAVIOURAL (Owner-approved legal content), copy-adjacent |
| :24-26 | The ja `commercial-disclosure` sections JSON includes `'株式会社Yuge','佐藤慎太郎','070-4440-4813','rentalstation@yuge-zao.com','〒990-2301 山形県山形市蔵王温泉973-7'` | public-legal.json | Rewriting or reformatting tokusho facts (e.g. a different address format) | PRESENTATIONAL + legal |
| :83-88 | production-runtime.ts matches `/locations:c\.payment!\.locations\}:undefined,legalCheckoutReady\)/`; **apps/web/src/lib/guest-http.ts** matches `/'\/prepare-payment'/` and `/'\/checkout'/`; service.ts has exactly 2 `this.assertLegalForCommercialCharge()` | apps/web/src/lib/guest-http.ts | Only if guest-http route strings change, which is not a redesign item | BEHAVIOURAL |

Note: the legal **page** rendering (`app/[locale]/legal/[doc]/page.tsx`) is not statically asserted here. Only its exports are pinned, via flow-app (section 2).

### 1.6 tests/unit/publication-indexing.test.ts and publication-isolate-consumers.test.ts (SEO)
| file:line | exact assertion | target | breaks if | class |
|---|---|---|---|---|
| publication-indexing.test.ts:4-6 | imports `apps/web/next.config`, `apps/web/src/proxy` (`proxy`), `apps/web/src/app/robots` (default) | | Moving these files or renaming the exports | STRUCTURAL |
| :52-55 | `rules.find(r=>r.source==='/:path*')` has **no** `x-robots-tag` and has `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`; `rules.find(r=>r.source==='/api/:path*')` has `{key:'X-Robots-Tag',value:'noindex, nofollow'}` | apps/web/next.config.ts:10-14 | Changing the header source strings (`/:path*` → `/(.*)` gives undefined and a crash); adding a page-wide robots header; dropping the security headers (e.g. to allow iframe embeds or a CDN) | BEHAVIOURAL |
| :58-66 | `indexablePage` allowlist: indexable `'/ja','/en/','/ja/rental/ski','/en/prices','/ja/stores/onsen-base','/en/faq','/ja/legal/terms','/en/legal/privacy','/ja/legal/commercial-disclosure','/en/legal/cancellation'`; non-indexable `/ja/legal`, `/ja/book`, `/ja/reservation`, `/preview/avatar`, `/staff/login`, … | packages/auth/src/publication-authority.ts | Not a redesign break. Note that **new public URLs** (e.g. `/ja/about`) stay noindex unless the allowlist is changed | BEHAVIOURAL |
| :67-72 | proxy returns `X-Robots-Tag: noindex, nofollow` for all URLs; `/staff/login` has `Cache-Control: private, no-store` | apps/web/src/proxy.ts | Proxy rewrite logic | BEHAVIOURAL |
| :74-79 | `robotsRules(false)` = `{disallow:'/'}`; open allow `['/ja','/en']`, disallow includes `/api/`,`/staff/`,`/admin/`,`/ja/booking/`,`/*?*`; `robots().rules` = `{userAgent:'*',disallow:'/'}` | packages/core/src/content/public-pages.ts, app/robots.ts | | BEHAVIOURAL |
| publication-isolate-consumers.test.ts:25-31 | child process mocks `apps/web/src/lib/public-content.ts` (`publicModels`) and imports `apps/web/src/proxy.ts`, `apps/web/src/lib/public-seo.ts` (`publicMetadata`), `apps/web/src/app/robots.ts`, `apps/web/src/app/sitemap.ts` | | Moving or renaming any of these, or renaming `publicModels`/`publicMetadata` | STRUCTURAL |
| :34-37 | `publicMetadata('ja','prices','Synthetic','Synthetic')`: `metadataBase.origin`, `alternates.canonical==='/ja/prices'`, `alternates.languages` = `{ja,en,'x-default'}` absolute, `openGraph.url===origin+'/ja/prices'`, `robots` = `{index,follow}` | apps/web/src/lib/public-seo.ts:4 | Changing the metadata shape (e.g. dropping `openGraph.url` or x-default) during an SEO or OG redesign | BEHAVIOURAL (SEO), redesign-adjacent |
| :38-44 | robots sitemap URL; sitemap entries and alternates all start with PUBLICATION_ORIGIN; proxy noindex matrix | robots.ts, sitemap.ts, proxy.ts | | BEHAVIOURAL |

Not asserted: the title suffix `' | ZAO Rental'` (public-seo.ts:4) is not checked by any unit test.

### 1.7 Other unit tests that import or read apps/web modules (non-UI, low redesign risk)
| file:line | assertion | target | class |
|---|---|---|---|
| web-diagnostics.test.ts:4-24 | Safe diagnostic schema | apps/web/src/lib/staff-operation-diagnostic | BEHAVIOURAL |
| staff-operation-diagnostic.test.ts:3-9 | keys `['code','correlationId','phase','category']`, SQLSTATE allowlist | same | BEHAVIOURAL |
| hosted-preview-diagnostics.test.ts:3-22 | `{error:'GUEST_PREVIEW_UNAVAILABLE',stage}`, 503, `private, no-store` | apps/web/src/lib/hosted-preview-diagnostics | BEHAVIOURAL |
| hosted-preview-runtime.test.ts:11-15 | spawns a child that imports `apps/web/src/lib/hosted-preview-runtime.ts`, `app/api/guest/[[...record]]/route.ts`, `app/api/guest/avatar/[draftId]/[revision]/[memberKey]/route.ts`, `app/guest-avatar-media/.../[hash]/route.ts`, `lib/guest-avatar-runtime.ts` | route paths | STRUCTURAL (route moves only) |
| guest-avatar.test.ts:6-7 | `guestAvatarHandler`, `assertLocalAvatarOrigin`, `avatarMediaHandler` | apps/web/src/lib/guest-avatar-http, avatar-media-http | BEHAVIOURAL |
| square-webhook-receiver.test.ts:114 | child imports `./apps/web/src/app/api/webhooks/square/route.ts`; GET/HEAD/… → 405, POST → 503 | route | BEHAVIOURAL |
| worker-tick.test.ts:181-183 | `apps/web/src/app/api/internal/worker-tick/route.ts` matches `/export const maxDuration = 60;/`, `/export async function GET\(/`, no POST/PUT/PATCH/DELETE export | route | BEHAVIOURAL |
| payment-projection-db.test.ts:12 | `apps/web/src/lib/square-webhook-runtime.ts` doesNotMatch `/payment-projection\|TransactionalPaymentProjection/` | lib | BEHAVIOURAL |
| group-body.test.ts:7 / catalog/contracts.test.ts:5 | `ledger-http` handler status codes | apps/web/src/lib/ledger-http | BEHAVIOURAL |
| production-webhook-ingress.test.ts:7 | `square-webhook-config` | lib | BEHAVIOURAL |
| automation/controller.test.ts:23 | `allowedPaths:['apps/web/src/app/staff/page.tsx']` is fixture data only and does not read the file | none | n/a |

Checked and found **not** coupled to UI source: foundation.test.ts (authorize, worktree), test-hygiene.test.ts (scripts/test-hygiene disk/cleanup), p4-decisions.test.ts (config/production JSON only), booking-state.test.ts (packages/contracts), content-bulk/release/workflow.test.ts (packages/core with synthetic JP fixtures), notification.test.ts (packages/core/src/notification/contracts; mail copy asserts canonical store name `Mountain Station` at :6, which depends on the store dictionary, not on apps/web).

---

## 2. Non-unit tests that statically read or import UI source (outside `test:unit`)

| file:line | assertion / coupling | target | breaks if | class | run by verify? |
|---|---|---|---|---|---|
| tests/avatar/phase4-e2e.ts:73 | `readFile('apps/web/src/components/GuestBooking.tsx')` then `!source.includes('AvatarFitPreview')`; also `/ja` HTML must not include `'/preview/avatar'` | GuestBooking.tsx | GuestBooking imports or mentions AvatarFitPreview; a nav link to `/preview/avatar` | BEHAVIOURAL (feature isolation) | **No** (phase4-e2e has no npm script) |
| tests/content/normal-ui.ts:127 | `readFile('apps/web/src/lib/staff-runtime.ts')` and `!normal.includes('content-fixture')` | lib | n/a | BEHAVIOURAL | yes (`test:content-fixture`) |
| tests/content/Workspace.tsx:4-5 | `import {StaffSessionBoundary,invalidateStaffView} from '../../apps/web/src/components/StaffSessionBoundary'`; `import '../../apps/web/src/components/holds.css'`; renders `<main className="holds">` | StaffSessionBoundary.tsx, **holds.css** | Renaming or deleting **holds.css** or the `.holds` root class; renaming StaffSessionBoundary or its exports | STRUCTURAL / PRESENTATIONAL | yes (`test:content-fixture`) |
| tests/content/PhotoWorkspace.tsx:5 | imports `invalidateStaffView` from StaffSessionBoundary | | Export rename | STRUCTURAL | yes |
| tests/flow/AssetReaderFixture.tsx:3 | imports `AssetQrInput` from apps/web/src/components/AssetQrInput (props used) | | Rename or prop change | STRUCTURAL | yes (`test:asset-reader`) |
| tests/ui-app/src/app/layout.tsx:2 | `import '../../../../apps/web/src/app/globals.css'` | globals.css | Renaming or moving **globals.css** | STRUCTURAL | yes (`test:e2e` 2nd webServer) |
| tests/ui-app/src/app/page.tsx:2-5, race/page.tsx:3 | `<LedgerWorkspace client={fixtureClient} canEdit testNotice/>` | components/ledger/LedgerWorkspace.tsx:14 (props `client,canEdit,canEditGlobal,testNotice`), ledger/client.ts (`LedgerClient` type, fixture-client.ts:1) | Renaming LedgerWorkspace or its props, or the `LedgerClient` interface | STRUCTURAL | yes (`test:e2e`) |
| tests/flow-app/src/app/**/page.tsx (≈45 one-line files) | Re-exports **named exports** from each apps/web route, e.g. `export {default,generateMetadata} from …/[locale]/[[...page]]/page`; `{default,metadata}` book; `{default,generateMetadata,dynamic}` legal/[doc]; `{default,generateMetadata}` rental/premium/[slug]; `{default,dynamic,metadata}` reservation and preview/avatar; `{default,dynamic}` admin/inventory, launch, notifications, ops, prices, staff/amendments, content, rentals; `{proxy}` proxy.ts; robots, sitemap, layout, page | every apps/web/src/app route file | **Moving, renaming or adding a page route** (the mirror must be updated by hand; a new apps/web page is not reachable in flow tests). **Dropping or renaming `metadata`, `generateMetadata` or `dynamic` exports** fails root `tsc` (tsconfig includes `tests/**/*.tsx`) and the flow-app dev compile | STRUCTURAL | yes (typecheck + all flow/public/readiness UI suites) |
| tests/flow-app/src/app/staff/rental/page.tsx:3-5 | imports `CustodyWorkspace` from components; own fallback copy `貸出返却の利用権限が必要です` | CustodyWorkspace.tsx | Rename or prop change | STRUCTURAL | yes |
| tests/flow/launcher.ts:5-17 | `fixtureRoutes()` walks `tests/flow-app/src/app` (not apps/web) to warm routes | flow-app | Indirect: only what is mirrored is warmed | STRUCTURAL | yes |

### 2.1 Adjacent risk: browser suites bound to CSS classes or computed style (not static, listed for hand-off)
- `tests/public/normal-ui.ts`: selectors `.pc-hero`, `.pc-title-m`, `.pc-wheel li button`, `.pc-wheel li[aria-hidden=…]`, `.pc-footer a`, `.pc-menu`, `.pc-menu-cats a`, `.pc-menu-small a`, `.pc-slide.is-active`, `.pc-view` (×3), `dl.guest-price dt/dd` (×11). At :66 it uses `getComputedStyle(p).backgroundColor` alpha, the `.pc-menu-small a` colour and `.pc-view` visibility; at :75 `'.pc-view'` visibility is `'visible'`. **These are PublicChrome classes.** The file also has 7 `scrollWidth` overflow checks.
- `tests/staff/home-ui.ts`: `.staff-card` ×29.
- `tests/auth/staff-flow.ts`: `ul.staff-cards`.
- `tests/operations/launch-ui.ts`: `.asset-label` ×6, `.ledger-id`, `footer.ledger-footer`. At :58-62 it checks `getComputedStyle(el).breakInside` and print `visibility` `visible`/`hidden`.
- `tests/operations/normal-ui.ts`: `.asset-label`, `.asset-label code`.
- avatar suites: `.avatar-disclaimer`, `.guest-person`, `[data-avatar-stage] img`.
- `tests/flow/asset-reader-ui.ts:27`: `boundingBox().height>=44` (touch target).
- 27 browser files assert `document.documentElement.scrollWidth<=window.innerWidth` (no horizontal overflow).
- `tests/e2e/ledger-ui.spec.ts` and `foundation.spec.ts` assert exact JA copy and roles, e.g. `'6 件の台帳記録'`, `'合成サンプルを使った画面テストです。実スタッフのログイン・実在庫ではありません。'` (LedgerWorkspace.tsx:36), headings `'認証が必要です'`, button `'＋ 登録'`, `getByText('この画面は開発用の基盤です')` count 0.

---

## 3. Scripts and config

| file:line | what it guards | UI coupling | class |
|---|---|---|---|
| scripts/check-reference.mjs:3-9 | sha256 of every file in `docs/execution/evidence/source-manifest.json`, except AGENTS/CLAUDE/README. 35 entries: config/operations + pricing drafts, docs/*.md, docs/adr/*, prompts/*, tests/test_*.py | **None**: no apps/web, CSS or tsx file is listed | n/a |
| scripts/check-secrets.mjs:3-11 | all `git ls-files --cached --others`: regexes for private keys, `gh[pousr]_`/`github_pat_`, `sk-proj-`/`sk-ant-`, `postgres(ql)://user:pass@`; any `.env*` except `.env.example`; **any tracked path that is not a regular file (symlink) fails** | Only content patterns; new font or image assets are fine; a **symlinked asset** would fail | BEHAVIOURAL |
| scripts/test-hygiene.ts | Disk preflight and owned-PG cleanup (used by verify.mjs:4-6,17) | none | n/a |
| eslint.config.mjs:5-6 | `next/core-web-vitals` + `next/typescript`, `@typescript-eslint/no-explicit-any: error`; `npm run lint` uses `--max-warnings=0`, so **every warning fails** (e.g. `@next/next/no-img-element`, `react-hooks/exhaustive-deps`, `jsx-a11y/alt-text`) | Redesign markup is linted strictly | PRESENTATIONAL-adjacent |
| eslint.config.mjs:9 | `@next/next/no-html-link-for-pages` is **off only** for `apps/web/src/app/staff/**/*.tsx`, `apps/web/src/app/preview/**/*.tsx`, `apps/web/src/components/*Workspace.tsx`, `apps/web/src/components/Staff*.tsx`, `tests/content/Workspace.tsx`, `tests/flow-app/src/app/staff/**/*.tsx` | Filename globs: renaming a `*Workspace.tsx` or `Staff*.tsx`, or moving staff UI into a new file name (e.g. `components/staff/Home.tsx`), turns raw `<a href="/staff/…">` into lint errors. The comment says these intentionally do full reloads | STRUCTURAL |
| playwright.config.ts:5-9 | testDir `tests/e2e`, projects desktop (Desktop Chrome) and mobile (iPhone 13 on chromium), `screenshot:'only-on-failure'`; webServers `next start apps/web` (needs `build`) and `next dev tests/ui-app` | No snapshot comparison configured | n/a |
| tsconfig.json:33-43 | root `tsc --noEmit` includes `apps/web/src/**`, `tests/**/*.ts(x)` | Re-export and prop mismatches in flow-app, ui-app and tests/content fail typecheck | STRUCTURAL |

Producers of strings that tests assert on:
- Store names: `packages/contracts/src/store-display.ts:3` (`STORE_DISPLAY_NAMES`), re-exported at `apps/web/src/components/guest-format.ts:6-7` (`STORE_LABEL`, `storeName`, fallback `'店舗'`/`'Store'`).
- Tax copy: `GuestBooking.tsx:368`, `BookingAccess.tsx:40`, `config/content/public-p0-pages.json:187,200` (via `packages/core/src/content/public-pages.ts:2,5`).
- Legal: `config/content/public-legal.json`, loaded at `packages/core/src/content/public-legal.ts:1`, with `LEGAL_DOCS` at :6.
- Avatar copy: `apps/web/src/components/AvatarFitPreview.tsx:10` (direction labels), `:11` (disclaimer), `:26-29`.
- SEO: `apps/web/src/lib/public-seo.ts:4`, `apps/web/src/app/robots.ts`, `apps/web/src/app/sitemap.ts`, `apps/web/next.config.ts:10-14`, `apps/web/src/proxy.ts:3-4`.
- Ledger test notice: `components/ledger/LedgerWorkspace.tsx:36`.

---

## 4. Snapshot and screenshot baselines

- **No snapshot or visual-diff baselines exist.** There are no matches for `toMatchSnapshot`, `toHaveScreenshot`, `toMatchInlineSnapshot`, `toMatchAriaSnapshot`, `__snapshots__`, `*-snapshots` dirs or `.snap` files (excluding node_modules and .next). There is no pixelmatch, odiff or png hash comparison in tests, scripts or tools.
- `playwright.config.ts:7`: `screenshot:'only-on-failure'` is a failure artifact only.
- `.local/screenshots/` (82 PNGs present) is **evidence only, written and never read back or compared**. CI uploads it (`.github/workflows/ci.yml`, upload-artifact paths `.local/screenshots/`, `playwright-report/`, `test-results/`). Writers are fixed-path `page.screenshot({path:'.local/screenshots/…'})` calls in:
  - auth/staff-flow.ts (e05-staff-management[-mobile-width])
  - content/normal-ui.ts (content-fixture-, photo-fixture-mobile-width)
  - custody/normal-ui.ts
  - e2e/ledger-ui.spec.ts:7,13,28 (`ledger-${project}-list|detail|registration.png`)
  - flow/normal-ui.ts
  - inventory/normal-ui.ts
  - pricing/normal-ui.ts
  - public/content-ui.ts
  - public/normal-ui.ts (public-ja-mobile, guest-review-mobile)
  - readiness/booking-access-ui.ts
  - readiness/booking-recovery-ui.ts
  - readiness/cancellation-ui.ts
  - readiness/guest-ui.ts
  - recommendation/normal-ui.ts, audit-followup-ui.ts, continuation-ui.ts
  - stabilization/mixed.ts
  - staff/home-ui.ts (staff-manifest-loading-390, -empty-390)
  - transfer/normal-ui.ts
  - wear/normal-ui.ts
- Avatar suites write to their own evidence dir: avatar/phase4-e2e.ts:56 and phase5-e2e.ts:69 use `shot()` → `evidence+'/screenshots/'+name+'.png'` plus `screenshots.json`; artwork-activation.ts does the same. These are evidence only.
- Consequence: a redesign cannot fail on pixels. Only DOM, role, text, class and computed-style assertions (section 2.1) can fail.

---

## 5. scripts/verify.mjs step list (verify.mjs:10, sequential, stops on the first non-zero exit)

Legend: **SG** = static guard (no app or DB); **U** = unit (node:test, includes the static source scans of section 1); **DB** = isolated Postgres or integration without a browser; **B** = Next server + Chromium browser UI; **BUILD**.

| # | npm script | command (package.json) | kind |
|---|---|---|---|
| 1 | check:reference | node scripts/check-reference.mjs | SG |
| 2 | check:secrets | node scripts/check-secrets.mjs | SG |
| 3 | test:reference | python3 -m unittest discover -s tests -p test_*.py -v | SG/U (seed data) |
| 4 | lint | eslint . --max-warnings=0 | SG (**UI markup**) |
| 5 | typecheck | next typegen apps/web && tsc --noEmit | SG (**flow-app/ui-app re-exports, props**) |
| 6 | test:unit | node --import tsx --test tests/unit/*.test.ts tests/automation/*.test.ts tests/catalog/*.test.ts | U (**store-display, tax-display, avatar-renderer, public-legal, publication-***) |
| 7 | test:controller:macos (darwin only) | node --import tsx scripts/test-controller-macos.ts | U |
| 8 | test:integration | scripts/integration.ts && scripts/ledger-integration.ts | DB |
| 9 | test:inventory | tests/inventory/real-postgres.ts | DB |
| 10 | test:provisional-booking-capacity | readiness/provisional-booking-capacity, inventory-truth, capacity-policy, operations/provisional-source-http | DB |
| 11 | test:transfer | tests/transfer/real-postgres.ts | DB |
| 12 | test:pricing | pricing/real-postgres, commercial-postgres, season-boundaries | DB |
| 13 | test:recommendation | tests/recommendation/real-postgres.ts | DB |
| 14 | build | next build apps/web --webpack | BUILD |
| 15 | test:auth | auth/first-admin-bootstrap, **staff-flow (B)**, first-admin-commercial | DB+B |
| 16 | test:holds-ui | tests/inventory/normal-ui.ts | B |
| 17 | test:transfers-ui | tests/transfer/normal-ui.ts | B |
| 18 | test:quotes-ui | tests/pricing/normal-ui.ts | B |
| 19 | test:recommendations-ui | tests/recommendation/normal-ui.ts | B |
| 20 | test:recommendation-audit | tests/recommendation/audit-followup-ui.ts | B |
| 21 | test:recommendation-continuation | tests/recommendation/continuation-ui.ts | B |
| 22 | test:stabilization-s01 | tests/stabilization/s01.ts | B |
| 23 | test:stabilization-upgrade | tests/stabilization/upgrade.ts | DB |
| 24 | test:stabilization-cd | tests/stabilization/cd.ts | B |
| 25 | test:stabilization-eg | tests/stabilization/eg.ts | DB |
| 26 | test:stabilization-mixed | tests/stabilization/mixed.ts | B |
| 27 | test:square-activation | node scripts/square-activation.mjs | SG/U |
| 28 | test:flow-payment | flow/payment, readiness/cancellation, cancellation-action | DB (flow-app) |
| 29 | test:flow-ui | tests/flow/normal-ui.ts | B |
| 30 | test:asset-reader | tests/flow/asset-reader-ui.ts | B |
| 31 | test:flow-restart | tests/flow/web-restart.ts | B |
| 32 | test:flow-scope-race | tests/flow/scope-race.ts | DB |
| 33 | test:custody | custody/boundary-counterexample, real-postgres, scenarios | DB |
| 34 | test:custody-ui | tests/custody/normal-ui.ts | B |
| 35 | test:late-pickup | tests/custody/late-pickup.ts | DB |
| 36 | test:staff-home-ui | tests/staff/home-ui.ts | B (`.staff-card`) |
| 37 | test:wear | wear/real-postgres, group-capacity | DB |
| 38 | test:wear-ui | tests/wear/normal-ui.ts | B |
| 39 | test:wear-mixed | tests/wear/mixed.ts | B |
| 40 | test:content-fixture | tests/content/normal-ui.ts | B (imports holds.css) |
| 41 | test:public-guest | public/guest-postgres, guest-integrated, prepare-payment | DB |
| 42 | test:public-content | tests/public/content-postgres.ts | DB |
| 43 | test:public-ui | public/normal-ui && public/content-ui | B (**PublicChrome `.pc-*` classes, computed colour**) |
| 44 | test:staff-diagnostic | tests/readiness/staff-diagnostic.ts | DB/app |
| 45 | test:readiness-guest | tests/readiness/guest-security.ts | DB |
| 46 | test:readiness-ui | tests/readiness/guest-ui.ts | B |
| 47 | test:integration-p2 | readiness/production-composition, backup-restore | DB |
| 48 | test:production-backup | tests/readiness/production-backup.ts | DB |
| 49 | test:production-restore-drill | tests/readiness/production-restore-drill.ts | DB |
| 50 | test:production-role-plans | readiness/production-role-plans, production-refund-owner | DB |
| 51 | test:activation-p4 | readiness/booking-access, sandbox-booking, **booking-access-ui (B)**, **cancellation-ui (B)** | DB+B |
| 52 | test:booking-recovery | tests/readiness/booking-recovery.ts | DB |
| 53 | test:booking-recovery-ui | tests/readiness/booking-recovery-ui.ts | B |
| 54 | test:production-rehearsal | tests/readiness/production-rehearsal.ts | DB/app (uses apps/web/.next BUILD_ID) |
| 55 | test:r15-regression | npm run test:r15 (scripts/test-r15-ingress.ts) && readiness/r15-guard-postgres && r15-preview-local | DB |
| 56 | test:avatar | avatar/phase5-upgrade, **phase5-e2e (B)**, **artwork-activation (B)**, phase6-migrations, phase6-roles, phase6-guest, phase6-import, phase6-lock, tier2-rate | DB+B |
| 57 | test:operations | operations/upgrade, migration, amendment, exchange, inventory | DB |
| 58 | test:operations-ui | tests/operations/normal-ui.ts | B (`.asset-label`) |
| 59 | test:operations-console | operations/console, failure-injection | DB |
| 60 | test:operations-console-ui | tests/operations/console-ui.ts | B |
| 61 | test:operations-manifest | operations/manifest, manifest-http | DB |
| 62 | test:operations-restore | tests/operations/restore.ts | DB |
| 63 | test:operations-baseline | tests/operations/baseline.ts | DB |
| 64 | test:m2a-import | tests/operations/import-rehearsal.ts | DB |
| 65 | test:m2a-connection | tests/operations/connection-harness.ts | DB |
| 66 | test:m2a-rehearsal | tests/operations/two-store-rehearsal.ts | DB |
| 67 | test:m2a-launch | tests/operations/launch-gate.ts | DB |
| 68 | test:m2a-launch-ui | tests/operations/launch-ui.ts | B (print CSS: breakInside/visibility) |
| 69 | test:m2b-security | tests/operations/production-security.ts | DB |
| 70 | test:m2b-bootstrap | operations/production-bootstrap, -delta, -owner-compat, production-foundation | DB |
| 71 | test:production-runtime | readiness/normal-production, commercial-payment | DB/app |
| 72 | test:production-runtime-ui | tests/readiness/normal-production-ui.ts | B |
| 73 | test:notification | tests/notification/postgres.ts | DB |
| 74 | test:notification-ui | tests/notification/normal-ui.ts | B |
| 75 | test:e2e | playwright test (tests/e2e; apps/web `next start` + tests/ui-app `next dev`) | B |

Not in verify: `tests/avatar/phase4-e2e.ts` (has the GuestBooking/AvatarFitPreview static check), `tests/readiness/*.test.ts`, `demo:public`. CI (`.github/workflows/ci.yml`) runs `npm run verify` then `runner:dry-run`.

---

## Riskiest for redesign

1. **tax-display.test.ts:14-17**: hard `includes` on exact JA/EN tax sentences inside `GuestBooking.tsx` and `BookingAccess.tsx`, including the file names and the punctuation `。` and `（）`. Moving copy to a dictionary, splitting either component or rewording fails it. This is Owner-decided wording, so keep it verbatim in those files or update the test with Owner sign-off.
2. **tests/flow-app re-export mirror** (~45 files): any page or route move or rename, or dropping or renaming `metadata`/`generateMetadata`/`dynamic`, breaks `typecheck` (step 5) and every flow-app browser suite. New apps/web pages are invisible to flow tests until they are mirrored.
3. **store-display.test.ts:16-20**: a regex scan of `components/*.tsx` and `components/ledger/*.tsx` for raw `{x.store}`, `{s}</option>)}`, `{s}</label>` and `stores.join(`. Innocent JSX or variable naming can trip it, and components moved into new subfolders silently escape it.
4. **avatar-renderer.test.ts:12-30**: SSR of `AvatarFitPreview`. It breaks with CSS Modules (the hook stubs `.css` to an empty module), with renaming `data-layer`/`data-match`/`aria-hidden`/`loading="lazy"`/`alt=""`, with extra `<img src>` (the exact count of 5), with a non-empty render on invalid input, with rewording the disclaimer or labels (words `fit,safety,stock,model,booking,payment,Recommended,Your height`, `身長`, `ウェア`), and with any "male" substring.
5. **public/normal-ui.ts** (`test:public-ui`, browser): binds to PublicChrome class names `.pc-*`, `dl.guest-price` and computed `backgroundColor` alpha, link colour and `.pc-view` visibility. A class rename is a guaranteed failure (not static, but the highest-volume coupling).
6. **lint `--max-warnings=0` + eslint.config.mjs:9 filename globs**: new `<img>`, hook-deps or a11y warnings fail. Renaming `*Workspace.tsx`/`Staff*.tsx` re-enables `no-html-link-for-pages` on intentional `<a href>` reloads.
7. **tax-display.test.ts:25-37** forbidden phrases across all apps/web/src ts/tsx/json and config/content: new "pending tax/terms" banners (e.g. `Tax display and terms`, `税区分未確認`) fail.
8. **holds.css / globals.css / LedgerWorkspace / StaffSessionBoundary / AssetQrInput / CustodyWorkspace imports from tests** (tests/content/Workspace.tsx:4-5, ui-app layout.tsx:2, ui-app page.tsx and race/page.tsx, AssetReaderFixture.tsx:3, flow-app staff/rental/page.tsx:3). Renaming or deleting these files, exports or props (`client, canEdit, testNotice`) breaks typecheck or test-app compiles. tests/content/Workspace.tsx also relies on the `.holds` class.
9. **e2e ledger-ui/foundation specs**: exact JA strings (`6 件の台帳記録`, the LedgerWorkspace.tsx:36 test notice, `＋ 登録`, `認証が必要です`, form labels and region names `登録フォーム`/`更新フォーム`/`台帳詳細`).
10. **publication-indexing.test.ts:52-55 / publication-isolate-consumers.test.ts:34-37**: if the redesign touches `next.config.ts` headers (source strings, security headers) or `publicMetadata` output shape (canonical, alternates incl. `x-default`, `openGraph.url`, robots), these SEO guards fail. New public URLs stay noindex unless `indexablePage`'s allowlist is changed (a behaviour decision, not a test edit).

Low or no risk: check-reference (no UI files in the manifest); check-secrets (patterns only, but symlinked assets fail); screenshots are evidence only, with no pixel baselines anywhere.
