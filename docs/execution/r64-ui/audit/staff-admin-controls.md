> Historical pre-redesign/WIP audit recovered from Claude. Findings describe that checkpoint, not the final candidate. See TAKEOVER_RECONCILIATION.md and VALIDATION.md for final dispositions and receipts.

# Staff / Admin Functional Control Matrix (pre-redesign baseline)

Baseline: worktree `f2`, git HEAD `e1abb2e`. All line numbers refer to HEAD content. Audit was read-only.

> **Concurrent-change warning.** While this audit ran (2026-10-13 23:55–23:57 JST), someone changed `apps/web/src/app/globals.css` (now 6113 B, "SALOMON STATION design system (R64)") and `PublicChrome.tsx`, and added files under `components/brand/`. None of these changes are committed. The new `globals.css` **drops every staff selector** that HEAD had: `.staff-toolbar`, `.staff-login`, `.staff-management*`, `.staff-cards`, `.staff-page-head`, `.staff-account`. It also drops the global element rules for `main`, `section`, `nav`, `a`, `h1`, `h2` and `p`. Section 4 records the HEAD rules. Every other audited file matches HEAD.

Conventions: `OR` = `||`. "page" = server component in `app/**/page.tsx`. "SSB" = `StaffSessionBoundary`. A permission named in the "permission" column is the server-side `principal.permissions.includes(...)` evaluated in the page, then passed down as a prop. Every API handler re-checks permissions (not audited here).

## 1. Route table

All staff pages call `staffState(new Headers(await headers()))` (`lib/staff-runtime.ts:23`). Exception: `/staff/content` passes `await headers()` directly. Every page sets `dynamic='force-dynamic'`. `stamp` = `publicStamp(s.stamp)` (sha256 hex). Client code sends it as the `x-zao-session` header, and SSB compares it to GET `/api/session`. `canManage(p)` = `role==='ADMIN' && scope==='ALL' && permissions.includes('STAFF_MANAGE')` (`packages/auth/src/staff-auth.ts:45`). Root layout `app/layout.tsx` imports `./globals.css` and sets `<html lang>` from header `x-zao-page-locale` (en or ja). There is no staff- or admin-specific layout.tsx.

| route | page file | component (wrapping) | server-side gate (else fallback) | CSS imported (via component) |
|---|---|---|---|---|
| /staff | app/staff/page.tsx | `<StaffHome key={stamp} …>` → SSB → Home | `status==='authorized'` (else h1 "認証が必要です" + link /staff/login). Props: canBookingView=BOOKING_VIEW, canCheckout=RENTAL_CHECKOUT, canReturn=RENTAL_RETURN, canOperationsView=OPERATIONS_VIEW, canInventoryView=INVENTORY_VIEW, canTransferView=TRANSFER_VIEW, canQuoteView=QUOTE_VIEW, canHoldView=HOLD_VIEW, canManageStaff=canManage | holds.css, staff-home.css (+globals) |
| /staff/login | app/staff/login/page.tsx | `<main className="staff-account"><h1>スタッフログイン</h1><StaffLogin configured={Boolean(getRuntime()?.auth)}/>…<a href="/staff/ledger">台帳へ</a>` | none (public) | globals only |
| /staff/logout | app/staff/logout/page.tsx | `<StaffLogout/>` (not dynamic, no SSB) | none | globals only |
| /staff/password | app/staff/password/page.tsx | `<main><h1>パスワード変更</h1><PasswordChange/></main>` (no SSB) | authorized (else "認証が必要です") | globals only |
| /staff/ledger | app/staff/ledger/page.tsx | `<StaffLedger key={stamp} canEdit=INVENTORY_EDIT canEditGlobal={scope==='ALL'} canManageStaff=canManage>` → SSB → toolbar + LedgerWorkspace | authorized && INVENTORY_VIEW && `storeIds.length>0` (else "認証が必要です" for anonymous, otherwise "台帳の利用権限がありません") | ledger/ledger.css, operations.css (via AssetLabelSheet) |
| /admin/assets | app/admin/assets/page.tsx | re-exports `default,dynamic` from staff/ledger/page | same as /staff/ledger | same |
| /staff/rentals | app/staff/rentals/page.tsx | `<><nav>…</nav><CustodyWorkspace presetBooking={?booking}…/></>` → SSB | authorized && BOOKING_VIEW; canCheckout=RENTAL_CHECKOUT, canReturn=RENTAL_RETURN | holds.css |
| /staff/wear | app/staff/wear/page.tsx | `<WearWorkspace stamp stores/>` → SSB | authorized && INVENTORY_VIEW. No action props; the server `/api/wear/booking` returns canCheckout/canReturn | holds.css |
| /staff/amendments | app/staff/amendments/page.tsx | `<AmendmentWorkspace canAmend=RENTAL_AMEND canOverride=INVENTORY_BUFFER_OVERRIDE canRefund=REFUND_OVERRIDE>` → SSB | authorized && BOOKING_VIEW | holds.css, operations.css |
| /staff/holds | app/staff/holds/page.tsx | `<HoldWorkspace key={stamp} canEdit=HOLD_EDIT canOverride=INVENTORY_BUFFER_OVERRIDE>` → SSB | authorized && HOLD_VIEW | holds.css |
| /staff/quotes | app/staff/quotes/page.tsx | `<QuoteWorkspace canCreate=QUOTE_CREATE canConfigure={role==='ADMIN'&&scope==='ALL'&&PRICE_EDIT}>` → SSB | authorized && QUOTE_VIEW | holds.css |
| /staff/transfers | app/staff/transfers/page.tsx | `<TransferWorkspace permissions={principal.permissions}>` → SSB | authorized && TRANSFER_VIEW | holds.css |
| /staff/recommendations | app/staff/recommendations/page.tsx | `<RecommendationWorkspace canSelect={HOLD_EDIT&&QUOTE_CREATE}>` → SSB | authorized && HOLD_VIEW && QUOTE_VIEW | holds.css, recommendation.css |
| /staff/users | app/staff/users/page.tsx | `<StaffSessionBoundary><StaffManagement stamp/></StaffSessionBoundary>` (SSB is applied in the page) | authorized && canManage (else "スタッフ管理の権限がありません") | globals only |
| /staff/content | app/staff/content/page.tsx | `<ContentWorkspace stamp/>` → SSB (includes PhotoWorkspace) | authorized only, else `redirect('/staff/login')`. **No permission check in the page** | holds.css |
| /admin | app/admin/page.tsx | placeholder `<main><h1>準備中</h1></main>` | `authorize(await getPrincipal(),["ADMIN"])` from `@rental/core` (different auth path) | globals only |
| /admin/inventory | app/admin/inventory/page.tsx | `<InventoryOperationsWorkspace canEdit=INVENTORY_EDIT canReconcile=INVENTORY_RECONCILE>` → SSB | authorized && INVENTORY_VIEW (fallback uses next/link `<Link>`) | holds.css, operations.css |
| /admin/prices | app/admin/prices/page.tsx | `<PriceAdminWorkspace/>` → SSB | authorized && PRICE_EDIT && role==='ADMIN' && scope==='ALL' | holds.css, operations.css |
| /admin/notifications | app/admin/notifications/page.tsx | `<NotificationWorkspace canResend=NOTIFICATION_RESEND>` (SSB inside) | authorized && BOOKING_VIEW | globals only |
| /admin/ops | app/admin/ops/page.tsx | `<OpsWorkspace systemScope={scope==='ALL'} canAcknowledge=OPERATIONS_ACKNOWLEDGE>` (SSB inside) | authorized && OPERATIONS_VIEW | globals only |
| /admin/launch | app/admin/launch/page.tsx | `<LaunchGateView/>` (SSB inside) | authorized && OPERATIONS_VIEW | globals only |
| (adjacent) /preview/rental | app/preview/rental/page.tsx | `<BookingWorkspace quoteId canCreate=BOOKING_CREATE>` → SSB | authorized && BOOKING_VIEW; `?quote` accepted only if it matches `/^[a-f0-9-]{36}$/` | holds.css |
| (adjacent) /preview/integrated | app/preview/integrated/page.tsx | `<RecommendationWorkspace integrated …>` | authorized && HOLD_VIEW && QUOTE_VIEW | holds.css, recommendation.css |

CSS loading caveat: Next bundles component CSS per route, and on client-side navigation the stylesheets already loaded stay applied. `operations.css` contains a global print rule (Section 4), so a page imported only for its label sheet still affects printing on that route.

## 2. Interactive controls
### 2.1 Session / auth surfaces

| route | component:line | control (element + exact label) | action/handler | API | permission dependency | states | business semantics | must-preserve |
|---|---|---|---|---|---|---|---|---|
| /staff/login | StaffLogin:12 | `<form method="post">` → `<fieldset disabled={!ready OR !configured OR busy}>` | `onSubmit`→`login()` L7 (preventDefault; guard `busy OR !ready OR !configured`) | POST `/api/auth/sign-in/email` JSON `{email,password}` | none (page: none; `configured=Boolean(getRuntime()?.auth)` login/page.tsx:4) | fieldset disabled until hydrated (`useSyncExternalStore` ready); `form.reset()` after response regardless of result L9; error → `<p role="alert">` "ログインできませんでした。入力とアカウントの状態を確認してください。連続失敗時は時間をおいてお試しください。"; success → BroadcastChannel `zao-rental-session` post `'login-changed'` then `window.location.replace('/staff/ledger')` | email+password sign-in; landing is /staff/ledger (not /staff) | form `method="post"` (no-JS safety: no GET leak of password); field `name="email"` type=email `autoComplete="username"` required maxLength 254; `name="password"` type=password `autoComplete="current-password"` required maxLength 128 |
| /staff/login | StaffLogin:12 | `<button>` "ログイン" / busy "確認中…" | submit | (above) | — | `disabled={!configured OR busy}` | | implicit type=submit |
| /staff/login | StaffLogin:12 | static texts | — | — | — | `!configured` → "スタッフ認証に接続できません。管理者に接続状態の確認を依頼してください。" | no self sign-up; reset mail not wired | "自由な新規登録はできません。パスワード再設定のメール送信は未接続です。" |
| /staff/login | login/page.tsx:4 | `<a href="/staff/ledger">` "台帳へ" | nav | — | — | — | | page `<main className="staff-account">` |
| /staff/logout | StaffLogout:6 | `<button>` "ログアウトする" | `logout()` L3: BroadcastChannel post `'logout'` FIRST, then fetch | POST `/api/auth/sign-out` body `'{}'` | none (route ungated) | error `<p role="alert">` "ログアウトを確認できませんでした。もう一度実行してください。"; success `location.replace('/staff/login')`; no busy/disable (double-click possible) | sign-out all tabs | broadcast-before-fetch order |
| /staff/password | PasswordChange:6 | `<form className="staff-login">` | `onSubmit`→`submit()` L4 | POST `/api/auth/change-password` `{currentPassword,newPassword}` | page: `status==='authorized'` only (password/page.tsx:5) | `busy` disables button; `form.reset()` always; error `<p role="alert">` "変更できませんでした。現在のパスワードと入力長を確認してください。"; success → broadcast `'password-changed'` → `location.replace('/staff/login')` (all sessions end) | changes password; forces re-login on all devices ("変更後はすべての端末で再ログインが必要です。") | `name="currentPassword"` type=password autoComplete current-password required maxLength 128; `name="newPassword"` autoComplete new-password required minLength 15 maxLength 128; label "新しいパスワード（15〜128文字）" |
| /staff/password | PasswordChange:6 | `<button>` "パスワードを変更" | submit | — | — | `disabled={busy}` (no busy label) | | |
| (all wrapped) | StaffSessionBoundary:21 | `<a href="/staff/login">` "ログイン画面へ" · `<a href="/staff/logout">` "ログアウトを確認" | nav | GET `/api/session` (cache no-store) on mount, every 15000 ms, on `visibilitychange`→visible, `pageshow`, any channel msg | compares `body.stamp!==stamp` → ended | states `checking` → `<main><p role="status">セッションを確認中…</p></main>` (children unmounted!); `ended` → h1 "セッションを確認してください" + "ログアウト、期限切れ、または権限の変更により画面を閉じました。"; `ready` → children | hides staff data on logout/expiry/permission change/BFCache restore/tab hidden | channel name `zao-rental-session`; messages `logout`,`signing-out`,`password-changed` end; others trigger re-check; posts `session-opened`; window event `zao-auth-ended` (`invalidateStaffView()`); hidden tab → `checking` (data hidden) |
| /staff/ledger, /admin/assets | StaffLedger:9 | toolbar `<a>` links: "棚卸・CSV投入"(/admin/inventory) "貸出・返却"(/staff/rentals) "変更・返金依頼"(/staff/amendments) "料金版"(/admin/prices) "予約通知"(/admin/notifications) "店舗間移動"(/staff/transfers) "サイズ推薦"(/staff/recommendations) " · " "見積へ"(/staff/quotes) "期間在庫・HOLD"(/staff/holds) "パスワード変更"(/staff/password) "スタッフ管理"(/staff/users) | nav | — | only "スタッフ管理" gated (`canManageStaff` = `canManage(principal)`); all others shown regardless of permission (destination page gates) | — | | toolbar label `ZAO Rental · {canEdit?'台帳の閲覧・編集':'台帳の閲覧のみ'}` |
| /staff/ledger | StaffLedger:9 | `<button>` "ログアウト" | `logout()` L8: `invalidateStaffView()` first, broadcast `'signing-out'`, then fetch | POST `/api/auth/sign-out` | — | on non-ok/throw: view stays closed (no message); ok → `location.replace('/staff/login')` | | invalidate-before-network order |

### 2.2 Staff Home (/staff)

| route | component:line | control | action/handler | API | permission dependency | states | business semantics | must-preserve |
|---|---|---|---|---|---|---|---|---|
| /staff | StaffHome:137 | `<a href="/staff/logout">` "ログアウト" | nav | — | — | — | | |
| /staff | StaffHome:139 | `<select aria-label="対象店舗">` inside `<label>対象店舗` options = `stores` (label `storeName(s)`) | `setActiveStore` → effect L111 `loadManifest(activeStore,null,false)` | GET `/api/operations/manifest?store=&section=all&pageSize=50` header `x-zao-session` | rendered only if `showManifest` (=`canBookingView&&(canCheckout OR canReturn)`) inside `canBookingView` section | rows hidden immediately when store changes (`forActiveStore` null) until fresh response | store context for manifest | generation counter: stale responses dropped (L79,93); section `aria-label="店舗・営業日"` |
| /staff | StaffHome:140 | display 営業日 | — | business date = manifest `data.date` (server clock), never browser | — | "確認しています…" until loaded; `{date}（JST）` | business date authority | |
| /staff | StaffHome:142 | `<BookingSearchInput onBooking={openBooking}>` (see 2.3) | `openBooking(id)` L83 → `router.push('/staff/rentals?booking='+id)` | — | `effectivePickup` = `canBookingView&&canCheckout` | `opening` guard 4000 ms | | |
| /staff | StaffHome:143 | `<button>` "更新" (本日の業務) | `loadManifest(activeStore,null,false)` | GET manifest | `showManifest` | `disabled={manifestBusy}`; section `aria-busy={manifestBusy}` | | section `aria-label="本日の業務"` |
| /staff | StaffHome:145 | status `<p role="status">` + `<button>` "もう一度読み込む" | `loadManifest` | GET manifest | `showManifest` | wrapper class `staff-state staff-state--{error,loading,ready,empty}`; button only when kind=error; texts "本日の業務を読み込んでいます…" / "最新の状態を読み込んでいます…"; error via `loadErrorText` (raw ENUM-like code or fetch/network → "本日の業務を読み込めませんでした。通信状況を確認し、もう一度読み込んでください。", else raw message) | | 401/403/`SESSION_CHANGED` → `invalidateStaffView()` |
| /staff | StaffHome:124 | per BOOKING_SCOPED card `<button className="staff-card-primary">` "{label}へ進む" (label = ACTION_LABEL[nextAction] or "詳細確認") | `openBooking(row.bookingId)` | — | only if `ACTIONABLE.has(nextAction)&&showManifest` (never COMPLETE/NO_ACTION) | `disabled={opening}` (4 s self-lifting) | open custody workflow for booking | no client recomputation of action — mapping only; unknown enum → 詳細確認 |
| /staff | StaffHome:147 | `<button className="staff-more">` "さらに読み込む" | `loadManifest(activeStore,manifestCursor,true)` (append, dedupe by `key`) | GET manifest `&cursor=` | `manifestHasMore` | `aria-busy`,`disabled={manifestBusy}` | pagination | |
| /staff | StaffHome:148 | `<Link href="/staff/rentals">` "貸出・返却の画面を開く" | nav | — | `showManifest` | | | |
| /staff | StaffHome:156 | `<button>` "更新" (本日の予約) | `refreshToday()` L107: bookings load + manifest reload | GET `/api/bookings` (via useOperationsRequest, header `x-zao-session`) + GET manifest | `canBookingView` | `disabled={bookingsReq.busy OR manifestBusy}`; MUST NOT be gated on manifestDate (UX-5E comment L151-155: only retry for BOOKING_VIEW-only principal) | today = bookings whose period contains manifestDate | status `<p role="status">` L157; "業務日付を確認しています…" |
| /staff | StaffHome:159 | per today booking card `<button className="staff-card-primary">` "貸出・受付で状態を確認" | `openBooking(b.id)` | — | `effectivePickup` | `disabled={opening}` | | |
| /staff | StaffHome:162 | `<Link href="/admin/ops">` "運用例外の画面を開く" | nav | — | `canOperationsView` | | | section aria-label "運用の注意事項" |
| /staff | StaffHome:163 | `<details className="staff-secondary-links"><summary>` "その他の管理機能" + links: "道具の台帳"(/staff/ledger, INVENTORY_VIEW) "棚卸・CSV投入"(/admin/inventory, INVENTORY_VIEW) "変更・返金依頼"(/staff/amendments, BOOKING_VIEW) "店舗間移動"(/staff/transfers, TRANSFER_VIEW) "見積"(/staff/quotes, QUOTE_VIEW) "期間在庫・HOLD"(/staff/holds, HOLD_VIEW) "サイズ推薦"(/staff/recommendations, HOLD_VIEW&&QUOTE_VIEW) "ウェアの数量貸出・返却"(/staff/wear, INVENTORY_VIEW) "パスワード変更"(always) "スタッフ管理"(/staff/users, canManageStaff) | nav | — | per-link flags from page.tsx:9 | | | link visibility mirrors destination page gates |

### 2.3 Scanner inputs

| route | component:line | control | action/handler | API | permission dependency | states | business semantics | must-preserve |
|---|---|---|---|---|---|---|---|---|
| /staff | BookingSearchInput:23 | `<button type="button">` "カメラで読み取る" | `start()` L16: getUserMedia `{video:{facingMode:{ideal:'environment'}},audio:false}`, rAF loop every ≥150 ms, jsQR, scale ≤640 px | none | parent gate effectivePickup | `disabled={starting OR running}`; status "カメラの許可を待っています。"; NotAllowedError → "カメラの許可がありません。予約IDを手入力できます。" else "カメラを開始できませんでした。予約IDを手入力できます。" | read reservation QR → `bookingIdFromInput` → onBooking | `<video muted playsInline aria-label="予約QRカメラ" hidden={!running}>`, hidden `<canvas>`; duplicate suppression `last` |
| /staff | BookingSearchInput:23 | `<button type="button">` "カメラを止める" | `stop()` | — | | `disabled={!starting&&!running}` | | |
| /staff | BookingSearchInput:24 | `<label>予約番号または予約QR<input>` | `setManual` | — | | maxLength 120 | | no name attr |
| /staff | BookingSearchInput:24 | `<button type="button">` "この予約を開く" | `resolve(manual)` | — | | `disabled={!manual.trim()}`; invalid → "予約IDまたは予約QRの内容を確認してください。" | | section `aria-label="予約QR・検索"` className `staff-search` (no CSS rule found) |
| /staff/rentals | AssetQrInput:25 | `<button type="button">` "カメラを開く" | `start()` L19 | none (component never fetches) | parent | `disabled={!ready OR disabled OR !online OR starting OR running}`; NotAllowedError "カメラの許可がありません。設定を確認するか個体IDを手入力してください。"; NotFoundError "カメラが見つかりません。個体IDを手入力できます。"; other "カメラを開始できませんでした。個体IDを手入力できます。" | read asset QR → `assetIdFromQr` → `onAsset(id)` (Promise) | inline styles L25; `aria-label="用品QRカメラ"`; while `busy` no frame decoding |
| /staff/rentals | AssetQrInput:25 | `<button type="button">` "カメラを止める" | `stop()` | — | | `disabled={!starting&&!running}` | | |
| /staff/rentals | AssetQrInput:26 | `<label>用品の個体ID<input>` | setManual | — | | maxLength 80; `disabled={!ready OR disabled OR !online OR pending}` | | |
| /staff/rentals | AssetQrInput:26 | `<button type="button">` "入力したIDを照合へ送る" | `emit(manual)` L18 | via parent onAsset | | `disabled={!ready OR disabled OR !online OR pending OR !manual}`; messages: offline "通信未確認のため送信していません。", invalid "用品の個体IDを読み取ってください。", pending "照合結果を待っています。保存済みかどうかはまだ確認できません。", ok "コードを読み取りました。保存・受領の結果は照合画面で確認してください。", fail "照合できませんでした。未確認の要求を確認してから再開してください。" (+stop camera), offline event "通信が切れました。保存済みと未確認の結果を照合してから再開してください。" | | section `aria-label="用品QR入力"` |

### 2.4 Custody (/staff/rentals) — CustodyWorkspace

Page wrapper nav (rentals/page.tsx:5): `<a href="/staff">` "スタッフホーム" · "変更・返金依頼"(/staff/amendments) · "棚卸"(/admin/inventory). Component header nav L38: "予約情報"(/preview/rental) · "ウェアの数量貸出・返却"(/staff/wear) · "ログアウト"(/staff/logout). All mutations: POST `/api/custody{path}` body `{requestKey:crypto.randomUUID(),input}` header `x-zao-session`; pending persisted in sessionStorage `zao-custody-pending-v1` (stamp-bound). `disabled = busy OR !!pending OR blocked` (L37).

| route | component:line | control | action/handler | API | permission dependency | states | business semantics | must-preserve |
|---|---|---|---|---|---|---|---|---|
| /staff/rentals | Custody:39 | `<fieldset disabled={disabled}><legend>予約を照合して道具を貸出` | — | — | `canCheckout` (RENTAL_CHECKOUT) | | | |
| /staff/rentals | Custody:39 | `<label>予約IDまたは予約QR<input>` (preset from `?booking=` only if `canCheckout&&bookingIdFromInput(presetBooking)` L21) | setBooking | — | canCheckout | maxLength 80 | | preset auto-loads L23 |
| /staff/rentals | Custody:39 | `<button>` "予約と仮割当を照合" | strips prefix `zao-rental:reservation:` then `load('/booking/'+id,setView)` | GET `/api/custody/booking/{id}` | canCheckout | load ignored while busy or pending; error → raw `e.message` in status | look up booking + provisional allocation | prefix string `zao-rental:reservation:` |
| /staff/rentals | Custody:40 | `<button>` "未受取のまま契約終了を照合" | `mutate('/complete-no-pickup',{bookingId})` | POST `/api/custody/complete-no-pickup` | canCheckout; shown only if `pickupTiming==='RETURN_DUE_PASSED'&&!loans.length&&!noPickup` | fieldset disabled | IRREVERSIBLE: closes contract as no-pickup (no auto refund) | no confirm dialog |
| /staff/rentals | Custody:41 | `<label>準備・最終適合の作業記録<input>` | setFit | — | shown if `!preparation&&!noPickup` | maxLength 160 | fit evidence | |
| /staff/rentals | Custody:41 | `<input type="checkbox">` "表示された個体と数量を照合した" | setVerified | — | | | manual verification attestation | |
| /staff/rentals | Custody:41 | `<button>` "照合した用品を準備固定" | `mutate('/prepare',{bookingId,expectedBookingVersion,expectedHoldVersion,selections:[{requirementKey,assetId,poleId}],fitEvidence})` | POST `/api/custody/prepare` | canCheckout | `disabled={!verified OR !fit.trim()}` + fieldset | locks prepared assets (optimistic versions) | checkbox acts as confirm |
| /staff/rentals | Custody:42 | `<button>` "道具の貸出を記録" | `mutate('/checkout',{bookingId,expectedPreparationVersion})` | POST `/api/custody/checkout` | canCheckout; shown if `preparation&&!loans.length&&!noPickup` | fieldset | records equipment checkout (loan items) | no confirm |
| /staff/rentals | Custody:43 | `<button>` "貸出結果を再読込" | `load('/booking/'+bookingId)` | GET booking | | | | |
| /staff/rentals | Custody:45 | `<select aria-label="受領店舗">` in `<legend>実際の返却受領店舗` | onChange: `generation++`, setStore, clears batch/work/batchId | — | `canReturn` (RENTAL_RETURN) | | actual receiving store | generation bump discards in-flight responses |
| /staff/rentals | Custody:45 | `<button>` "この店舗で返却バッチを開始" | `mutate('/batch',{store})` | POST `/api/custody/batch` | canReturn | | opens return batch | |
| /staff/rentals | Custody:45 | `<button>` "保存済み返却作業を読込" | `load('/returns?store='+store,setWork)` | GET `/api/custody/returns?store=` | canReturn | | | |
| /staff/rentals | Custody:45 | `<label>保存済み返却バッチID<input>` + `<button>` "返却バッチを再開" | `load('/batch/'+batchId,openBatch)` | GET `/api/custody/batch/{id}` | canReturn | maxLength 36 | | |
| /staff/rentals | Custody:45 | per work batch `<button>` "バッチを開く {id}" | load batch | GET batch | canReturn | | | |
| /staff/rentals | Custody:46 | `<AssetQrInput disabled={blocked OR !!pending&&!busy}>` | `onAsset=id=>mutate('/scan',{batchId,expectedVersion,assetId:id,poleLoanId:null})` | POST `/api/custody/scan` | canReturn, batch open | success msg "返却候補をサーバーに保存しました。受領は未確定です。" | scan adds return CANDIDATE (not receipt) | section `aria-label="連続返却バッチ"` |
| /staff/rentals | Custody:47 | `<fieldset><legend>ポールは貸出明細に対応するペア数量`; `<label>ポールの貸出明細ID<input>` + `<button>` "この貸出のポール1ペアを候補に追加" | `mutate('/scan',{...,assetId:null,poleLoanId})` | POST scan | canReturn | `disabled={!poleLoan}`; maxLength 36 | pole pair candidate | |
| /staff/rentals | Custody:48 | `<button>` "正常な候補をまとめて受領確定" | `mutate('/confirm',{batchId,expectedVersion})` | POST `/api/custody/confirm` | canReturn | `disabled={disabled OR !candidates.some(state==='CANDIDATE')}`; msg "正常な明細を受領しました。要確認の明細と検品待ちは残っています。" | IRREVERSIBLE bulk return receipt | no confirm dialog |
| /staff/rentals | Custody:49 | `<label>実際に行った検品記録<input>` + per received item `<button>` "検品完了 {loan_item_id}" | `mutate('/inspection',{loanItemId,expectedVersion,store,evidence})` | POST `/api/custody/inspection` | canReturn; shown if `!r.inspection_id` | `disabled={!inspection.trim()}` | completes inspection (contract-day/same-day block kept) | |
| /staff/rentals | Custody:50 | `<button>` "同じ保存済み要求を照合" | `send(pending)` (same requestKey) | replays pending path | shown when `pending&&!busy` | `disabled={blocked}` | idempotent retry after unknown response | status `<p role="status">` "保存領域未確認のため操作停止" when blocked; errors "拒否：{code}" / "応答未確認です。同じ保存済み要求を照合してください。"; after any successful mutation with canReturn → GET `/returns?store=` |

### 2.5 Booking preview (/preview/rental — staff-gated, not under /staff) — BookingWorkspace

Gate (preview/rental/page.tsx:5): authorized && BOOKING_VIEW; `canCreate`=BOOKING_CREATE; `quoteId` only if `/^[a-f0-9-]{36}$/`. Mode from GET `/api/bookings/capabilities` (`ISOLATED_TEST`/`LOCAL_OPERATIONS`/`UNCONNECTED`/initial `CHECKING`). Pending sessionStorage `zao-flow-preview-pending-v1`, path whitelist regex L11. `disabled = busy OR pending OR storageFailed OR mode!=='ISOLATED_TEST' OR !canCreate` (L22).

| route | component:line | control | action/handler | API | permission | states | semantics | must-preserve |
|---|---|---|---|---|---|---|---|---|
| /preview/rental | Booking:23 | nav "推薦・HOLD・見積"(/staff/recommendations) · "台帳"(/staff/ledger) · "ログアウト"(/staff/logout) | nav | | | | | |
| /preview/rental | Booking:25 | `<fieldset disabled={disabled}><legend>合成予約情報`: inputs "保存済み見積ID"(max36) "合成氏名"(placeholder "SYNTHETIC Guest", max70) "架空メール宛先"(placeholder "synthetic-guest@example.invalid", max100); checkbox "開発用の合成予約であり、営業規約・請求の確定ではないことを確認" | state | — | mode ISOLATED_TEST + BOOKING_CREATE | | synthetic test booking only | |
| /preview/rental | Booking:25 | `<button>` "合成予約情報を保存" | `send({path:'',body:{requestKey,quoteId,contact:{displayName,email,termsAccepted}}})` | POST `/api/bookings` | as above | `disabled={!accept}` | creates DRAFT dev booking | checkbox = confirmation |
| /preview/rental | Booking:27 | `<button>` "テストアダプタへ照合要求" | send `/{id}/payment` `{requestKey}` | POST `/api/bookings/{id}/payment` | disabled unless ISOLATED_TEST&&canCreate; shown if `state==='DRAFT'` | | simulated payment | |
| /preview/rental | Booking:27 | `<button>` "既存の決済結果を照合" | send `/{id}/reconcile` `{}` | POST `/api/bookings/{id}/reconcile` | same disabled; shown if payments>0 and state not in CONFIRMED_DEV/COMPLETED_DEV/CONFIRMED/COMPLETED/CANCELLED | | reconcile payment result | |
| /preview/rental | Booking:27 | `<button>` "予約結果を再読込" | `open(view.id)` | GET `/api/bookings/{id}` | | `disabled={busy OR pending}` | | |
| /preview/rental | Booking:27 | `<a>` "権限を確認して道具の受付・貸出・返却へ" → `/staff/rental` (ISOLATED_TEST; NOTE singular path, no such route found) or `/staff/rentals` (LOCAL_OPERATIONS) | nav | | | else text "貸出返却の接続状態を確認してください。" | | |
| /preview/rental | Booking:28 | `<button>` "同じ保存済み要求を照合" | `send(pending)` | replay | `pending&&!busy` | `disabled={storageFailed}`; status "要求の保存領域を確認できないため更新停止。" | | |
| /preview/rental | Booking:28 | list `<button>` "{display_name} · {startDate} · {state}" | `open(b.id)` | GET `/api/bookings/{id}`; list GET `/api/bookings` only if simulated or LOCAL_OPERATIONS | | `disabled={busy OR pending}` | | |

### 2.6 Launch gate (/admin/launch) — LaunchGateView

| route | component:line | control | action/handler | API | permission | states | semantics | must-preserve |
|---|---|---|---|---|---|---|---|---|
| /admin/launch | Launch:15 | `<Link href="/admin/ops">` "運用例外" | nav | | | | | |
| /admin/launch | Launch:17 | `<label>現場確認ID（任意）<input aria-label="現場確認ID" placeholder="00000000-0000-4000-8000-000000000000">` | `setRunId(value.trim())` | — | OPERATIONS_VIEW (page) | `disabled={busy}` | optional field-run id | |
| /admin/launch | Launch:18 | `<button>` "読み込む" | `load()` (ref lock) | GET `/api/admin/launch[?runId=]` header `x-zao-session` | OPERATIONS_VIEW | `disabled={busy}`; error clears rows + `<p role="status">` "公開準備状況を取得できません。権限と接続を確認してください。" | READ-ONLY ("ここから本番接続・デプロイ・決済・秘密情報の入力はできません。") | table `<caption>各項目の状態`, `th scope="col"`/`scope="row"`; NOTE: no auto-load on mount; 401/403 not routed to invalidateStaffView (generic error) |

### 2.7 Ledger (/staff/ledger, /admin/assets) — LedgerWorkspace (ledger/LedgerWorkspace.tsx) via StaffLedger

Client: `createHttpLedgerClient(stamp,invalidateStaffView)` (client.ts:8) → `/api/ledger/{resource}[/{id}][?filters]`, header `x-zao-session`; 401/403 → `invalidateStaffView()`; 409 not invalidated; body `error==='SESSION_CHANGED'` → invalidate. `editable = canEdit && (canEditGlobal OR resource in {assets,poles})` (L17). canEdit=INVENTORY_EDIT; canEditGlobal = `scope==='ALL'`. Errors mapped via `errors` table (L11) → `<p role="alert" className="ledger-error">`. Selection token `selection.current` discards stale responses.

| route | component:line | control | action/handler | API | permission | states | semantics | must-preserve |
|---|---|---|---|---|---|---|---|---|
| /staff/ledger | Ledger:37 | `<nav aria-label="台帳の種類">` tab `<button>`s "個体台帳"(assets) "ポール数量"(poles) "商品モデル"(models) "サイズ・区分"(variants) "セット構成"(bundles) | `changeTab(key)` resets filters/detail/form/page | GET `/api/ledger/{resource}?` | INVENTORY_VIEW (page) | `aria-current="page"` on active (CSS `.ledger-tabs button[aria-current]` depends on it) | | aria-current |
| /staff/ledger | Ledger:40 | `<button className="ledger-primary">` "＋ 登録" | `setForm('create')` | — | `editable` | | open create form | |
| /staff/ledger | Ledger:42 | `<label>検索<input placeholder="モデル名・ID">` | `filter('q',v)` (resets offset 0, refetch per keystroke) | GET list `?q=` | | | | |
| /staff/ledger | Ledger:43 | `<label>店舗<select>` "担当店舗すべて" / MOUNTAIN_BASE / ONSEN_BASE (labels via STORE_DISPLAY_NAMES) | `filter('storeId')` | GET `?storeId=` | assets/poles tabs only | | | option values |
| /staff/ledger | Ledger:44 | `<label>競技<select>` "すべて"/SKI/SNOWBOARD/WEAR | `filter('sport')` | GET `?sport=` | | | | |
| /staff/ledger | Ledger:45 | `<label>年齢区分<select>` "すべて"/"大人"(ADULT)/"子供"(KIDS); `<label>クラス<select>` "すべて"/REGULAR/PREMIUM (raw text) | `filter('age')`,`filter('tier')` | GET | not models | | | option values |
| /staff/ledger | Ledger:46 | `<label>サイズ<input placeholder="例：160 cm">` | `filter('size')` | GET | not models/bundles | | | |
| /staff/ledger | Ledger:47 | `<label>状態<select>` "すべて"/UNVERIFIED/AVAILABLE/MAINTENANCE/RETIRED | `filter('status')` | GET | assets/poles | | | |
| /staff/ledger | Ledger:51 | per row `<button aria-label="詳細：{name} {size??code}">` "見る ↗" | `open(row)` | GET `/api/ledger/{resource}/{id}` | | | open detail aside | aria-label |
| /staff/ledger | Ledger:53 | `<button>` "前の100件" / "次の100件" | offset ∓100 | GET `?offset=` | | prev `disabled={!offset}`; next `disabled={offset+100>=total}` | pagination 100 | |
| /staff/ledger | Ledger:55 | `<button className="ledger-primary">` "基本情報を更新" (in `<aside className="ledger-detail" aria-label="台帳詳細">`) | `setForm('update')` | — | `editable` | | | |
| /staff/ledger | Ledger:55 → AssetLabelSheet:6 | `<label><input type="checkbox">両側に同じIDを印刷` (boots only); `<button>` "ラベルを印刷" | `window.print()` | none | detail.resource==='assets' and family in SKI/SNOWBOARD/SKI_BOOT/SNOWBOARD_BOOT | copies: SKI=2, BOOT=2 if checkbox else 1, SNOWBOARD=1 | prints QR labels (QR encodes asset id, width 160, margin 2, ECC M) | print CSS in operations.css `@media print{body>*{visibility:hidden}.asset-labels,.asset-labels *{visibility:visible}…}`; canvas `aria-label="用品QR {id}"`; classes `asset-labels`/`asset-label` are print-load-bearing |
| /staff/ledger | Ledger:74 | LedgerForm `<section className="ledger-form" aria-label="更新フォーム" or "登録フォーム">` `<button>` "閉じる" | `onClose` | — | | `disabled={saving}` | | |
| /staff/ledger | Ledger:76-92 | form fields (FormData by `name` — names are API keys): create: `code` "商品コード", `name` "名称" (models/bundles); `brand` "ブランド / 製造元"(opt), `catalogSeason` "シーズン（例2026/27・登録後固定）"(opt) (models); `family` select "種別" (models: SKI,SNOWBOARD,SKI_BOOT,SNOWBOARD_BOOT,POLE,WEAR_JACKET,WEAR_PANTS; bundles: SKI_SET,SNOWBOARD_SET); `modelId` select "商品モデル" required (variants; excludes WEAR), `size` "サイズ（単位込み）"; `variantId` select "サイズ・区分" required (assets/poles; sets family & bsl); `storeId` "初期所属店舗"; `age` "年齢区分" (ADULT "大人（13歳以上）"/KIDS "子供（13歳未満）"), `tier` "クラス" (STANDARD for WEAR_ else REGULAR/PREMIUM) (variants/bundles); `compatibleSports` "ウェア用途" ("SKI,SNOWBOARD"/"SKI"/"SNOWBOARD"); update: `name`,`brand`; both: `status` "台帳状態" (AVAILABLE suffix "（予約可否未判定）"), `quantity` "数量（ペア / 1ペア＝2本）" number step1 min0 (poles), BSL select (no name; state) "BSL確認状況" UNVERIFIED "要確認・未記録"/RECORDED "実物の値を記録" (SKI_BOOT assets), `bslMm` "実物のBSL（mm）" number, `bslEvidence` "BSL確認の出典"; create: `sourceKind` "データ区分" (UNVERIFIED "未確認の登録資料"/SYNTHETIC "合成サンプル"), `sourceDocument` "出典文書", `sourceLocator` "出典の行・セル・記録キー"; `notes` "備考"(opt); update: `reason` "更新理由" (required) | `submit()` L65 transforms values (version, quantity Number, bsl fields, delete empty catalogSeason, family, WEAR tier/compatibleSports split) | create POST `/api/ledger/{resource}`; update PATCH `/api/ledger/{resource}/{id}` (+`version` optimistic) then re-list + reload models/variants | `editable` | submit `<button className="ledger-primary" type="submit">` "登録を保存"/"変更を保存"/busy "保存中…" `disabled={saving}`; error `<p role="alert" className="ledger-error">` (STALE_VERSION → "他の更新がありました。詳細を開き直してから更新してください。") | register/update tool master data; ID/区分/サイズ/所属店舗/出典 immutable after create | ALL `name` attributes; `required`; number `step=1 min=0`; footnote "ID・区分・サイズ・所属店舗・出典は登録後に基本編集できません。BSLは実物の値を記録し、靴サイズから推測しません。"; `key` on LedgerForm resets form per resource/form/id |

### 2.8 Wear (/staff/wear) — WearWorkspace

Gate: INVENTORY_VIEW only (wear/page.tsx:5); NO client permission props — action visibility comes from server `/booking` response `canCheckout`/`canReturn` (L30,38) and server rejects. All mutations POST `/api/wear/{action}` body `{requestKey,input}` header `x-zao-session`; pending sessionStorage `zao-wear-quantity-pending-v1`; last batch `zao-wear-quantity-pending-v1-batch` `{stamp,id,store}`. Hard-coded `reason` strings sent to API (preserve verbatim). After each success → `refresh()` (transfers if loaded, pools, return-workspace if loaded, booking/loans/receipts if booking set). Header nav L35: "統合予約"(/preview/integrated) · "決済照合・予約QR"(/preview/rental) · "ログアウト"(/staff/logout).

| route | component:line | control | action/handler | API | permission | states | semantics | must-preserve |
|---|---|---|---|---|---|---|---|---|
| /staff/wear | Wear:36 | `<fieldset disabled={busy OR !!pending}>` `<label>実際の受領・表示店舗<select>` | onChange: generation++, reset ALL state | GET `/api/wear/pools?store=` (effect L32) | INVENTORY_VIEW | | actual store context | full reset on change |
| /staff/wear | Wear:37 | (display) pools; `<p role="alert">` "将来の約束に対する実準備・所在地の確認が必要です。確保は消していません。" when `reserved_peak+transfer_reserved>ready` | — | — | | | | |
| /staff/wear | Wear:38 | `<fieldset disabled={busy OR !!pending OR storageBlocked}><legend>予約・貸出サイクルを確認`; `<label>予約番号<input>` | setBooking + clear booking data | — | | no maxLength | | |
| /staff/wear | Wear:38 | `<button>` "貸出を読込" | `refresh(token)` | GET `/api/wear/booking?bookingId=&store=`; if `info.canReturn` GET `/loans?…` + `/receipts?…` | | errors → raw message | | |
| /staff/wear | Wear:38 | `<button>` "ウェア数量を貸出記録" | `mutate('checkout',{bookingId,expectedBookingVersion,store,reason:'SYNTHETIC development wear checkout'})` | POST `/api/wear/checkout` | shown if server `bookingInfo.canCheckout` | | wear quantity checkout | reason literal |
| /staff/wear | Wear:40 | per loan (`<article aria-label="ウェア貸出 {requirement_key}">`) `<button>` "1着を受領：{requirement_key}" | `mutate('receive',{loanId,expectedRevision,store,quantity:1,reason:'SYNTHETIC actual quantity receipt',unresolvedId:null})` | POST `/api/wear/receive` | `returned<quantity` | | IRREVERSIBLE receipt of 1 garment | no confirm |
| /staff/wear | Wear:40 | `<button>` "返却候補へ追加：{requirement_key}" | `mutate('return-candidate',{batchId,expectedRevision,loanId,expectedLoanRevision,quantity:1,store,reason:'SYNTHETIC saved quantity return candidate'})` | POST `/api/wear/return-candidate` | `returned<quantity` | success sets batch + stores `-batch` key | candidate only | |
| /staff/wear | Wear:41 | `<section aria-label="保存した返却候補">` `<label>返却バッチ番号<input>` | setBatchId, clear batch | — | | | | |
| /staff/wear | Wear:41 | `<button>` "保存した候補を再読込" | GET | GET `/api/wear/return-batch?batchId=&store=` | | | | |
| /staff/wear | Wear:41 | `<button>` "前回のバッチ番号を復元" | read sessionStorage `-batch` (stamp & store must match) | — | | msgs "バッチ番号を復元しました。再読込して最新状態を確認してください。" / "この本人・店舗の保存候補はありません。" / "保存候補の復元に失敗しました。" | | |
| /staff/wear | Wear:41 | `<button>` "候補の数量をまとめて返却確定" | `mutate('return-batch-confirm',{batchId,expectedRevision,store,reason:'SYNTHETIC confirmed physical quantities'})` | POST `/api/wear/return-batch-confirm` | | `disabled={!items.some(state==='CANDIDATE')}` | IRREVERSIBLE bulk return | no confirm |
| /staff/wear | Wear:42 | per receipt (`<article aria-label="返却受領 {id}">`) `<button>` "洗浄開始" / "実際の乾燥・検品完了を記録" / "翌日以降のREADY反映" + "：{id last6}" | `mutate('cleaning',{receiptId,expectedRevision,operation:'START' or 'COMPLETE' or 'RELEASE_NEXT_DAY',confirmedReady:state!=='RETURNED_PENDING',reason:'SYNTHETIC explicit care confirmation'})` | POST `/api/wear/cleaning` | `actual_store===store&&state!=='READY'` | | care lifecycle → READY | label by state |
| /staff/wear | Wear:43 | `<fieldset><legend>数量移動・予約不明の受領`: `<label>対象サイズの数量プール<select>` ("選択してください"), `<label>操作数量<input type="number" min="1" max="1000">`, `<label>数量操作の理由<input maxLength={160}>`, `<label>17時便の予定日<input type="date">` | state | — | | | | |
| /staff/wear | Wear:43 | `<button>` "もう一方の店舗への移動を計画" | `mutate('transfer-plan',{poolId,expectedRevision,destinationStore:(MOUNTAIN_BASE↔ONSEN_BASE),quantity,scheduledDate,reason})` | POST `/api/wear/transfer-plan` | | `disabled={!selectedPool OR !reason.trim() OR !transferDate}` | plan inter-store wear move | destination hard-coded opposite store |
| /staff/wear | Wear:43 | `<button>` "この店舗の数量移動を再読込" | GET | GET `/api/wear/transfers?store=` | | | | |
| /staff/wear | Wear:43 | per transfer (`aria-label="数量移動 {id}"`) `<button>` "実際に発送：{id6}" | `mutate('transfer',{transferId,expectedRevision,operation:'DISPATCH',quantity:null,reason})` | POST `/api/wear/transfer` | `state==='PLANNED'&&source_store===store` | `disabled={!reason.trim()}` | IRREVERSIBLE dispatch | |
| /staff/wear | Wear:43 | `<button>` "実際に受領：{id6}" | `mutate('transfer',{…,operation:'RECEIVE',quantity:transferQuantity,reason})` | POST `/api/wear/transfer` | `IN_TRANSIT&&destination_store===store` | `disabled={!reason.trim()}` | receive | |
| /staff/wear | Wear:43 | `<button>` "受領分の実READY確認：{qty}着" | `mutate('transfer-ready',{receiptId,expectedRevision,confirmedReady:true,reason})` | POST `/api/wear/transfer-ready` | receipts RETURNED_PENDING at destination | `disabled={!reason.trim()}` | | |
| /staff/wear | Wear:43 | `<fieldset><legend>予約不明のウェア・返却作業の引継ぎ` `<button>` "この店舗の返却作業を読込" | GET | GET `/api/wear/return-workspace?store=` | | | | |
| /staff/wear | Wear:43 | `<label>予約不明ウェアのサイズ<select>` + `<button>` "予約不明として受領記録（READYへ加算しない）" | `mutate('unresolved',{variantId,store,quantity:transferQuantity,reason})` | POST `/api/wear/unresolved` | | `disabled={!unknownVariant OR !reason.trim()}` | quarantine receipt | |
| /staff/wear | Wear:43 | per unresolved (`aria-label="隔離受領 {id}"`, section `aria-label="予約不明の隔離記録"`) `<button>` "この貸出との数量一致を確認：{member_key} / {requirement_key}" | `mutate('receive',{loanId,expectedRevision,store,quantity:u.quantity,reason,unresolvedId})` | POST `/api/wear/receive` | loans with same variant and enough outstanding | `disabled={!reason.trim()}` | link quarantine to loan | |
| /staff/wear | Wear:43 | `<button>` "バッチを選択：{id} / 未確定{n}件・全{m}件" | setBatchId | — | | | | |
| /staff/wear | Wear:43 | `<button>` "同じ保存要求を照合" | `send(pending)` | replay | `pending&&!busy` | NOT disabled when storageBlocked (differs from Custody) | | status `<p role="status">` "保存領域未確認のため操作停止" / "保存済み。返却と再貸出可能性は別の状態です。" / "拒否：{code}" / "結果未確認。同じ要求を照合してください。" |

### 2.9 Amendments / refunds (/staff/amendments) — AmendmentWorkspace

Gate: BOOKING_VIEW (amendments/page.tsx:5). Props: canAmend=RENTAL_AMEND, canOverride=INVENTORY_BUFFER_OVERRIDE, canRefund=REFUND_OVERRIDE. Uses `useOperationsRequest(stamp,'amendment')` → sessionStorage `zao-operations-amendment`; `op.disabled = busy OR !ready OR !!pending`. Status `<p role="status">{op.message}</p>` L19 (messages: "保存しました。" / "操作を拒否しました：{CODE}" / "応答未確認です。保存済みの同じ要求を照合してください。" / "要求を保存できないため送信していません。" / "要求記録を開けません。端末の保存設定を確認してください。" / load errors raw code). Header nav: "貸出・返却"(/staff/rentals) · "用品台帳"(/admin/assets).

| route | component:line | control | action/handler | API | permission | states | semantics | must-preserve |
|---|---|---|---|---|---|---|---|---|
| /staff/amendments | Amend:20 | `<button>` "保存済みの同じ要求を照合" | `op.send(pending.path,null,…,true)` replays same requestKey | replay | shown if `op.pending` | `disabled={op.busy}` | idempotent retry | |
| /staff/amendments | Amend:21 | `<fieldset disabled={op.disabled}><legend>予約照合`; `<label>予約ID<input maxLength={36}>` | setBooking + clears view/financial/quote | — | | | | |
| /staff/amendments | Amend:21 | `<button>` "変更対象を読み込む" | `op.load('/api/operations/amendment?id='+booking,open)` | GET `/api/operations/amendment?id=` | `disabled={!canAmend}` | | | |
| /staff/amendments | Amend:21 | `<button>` "商品候補を読み込む" | load options | GET `/api/operations/amendment-options` | `disabled={!canAmend}` | | | |
| /staff/amendments | Amend:21 | `<label>操作店舗<select>` | setStore, clear financial | — | | | acting store | |
| /staff/amendments | Amend:21 | `<button>` "入金・返金残額を照合" | load financial | GET `/api/operations/financial?id=&store=` | NO client gate (BOOKING_VIEW only) | | | |
| /staff/amendments | Amend:22 | `<label>操作理由（詳細な個人情報は記入しない）<input maxLength={160}>` (outside fieldset) | setReason | — | | required by quote/accept/refund buttons | audit reason | |
| /staff/amendments | Amend:23 | `<fieldset disabled={op.disabled OR !canAmend}>` `<label>返却日<input type="date" min={startDate}>` | sets endDate; slot = DAY if end==start else MULTIDAY; clears quote | — | canAmend | | | slot derivation |
| /staff/amendments | Amend:24 | per member `<fieldset><legend>利用者 {key}`; `<label>商品<select>` (SKI_SET "スキーセット"/SNOWBOARD_SET "ボードセット" or raw `{m.product}`) | `member()` rebuilds items: SKI_SET→SKI,SKI_BOOT,POLE; SNOWBOARD_SET→SNOWBOARD,SNOWBOARD_BOOT; keeps WEAR_ | — | canAmend | | | family composition logic |
| /staff/amendments | Amend:25 | per item `<label>{item.family}<select>` "現在の候補群を維持／交換先を選択" + variants filtered by family/age/tier (WEAR_→STANDARD) "{name} · {size}" | set variantIds; adds `modelPromise` if contractVersion `INTEGRATED_V1_2`&&tier PREMIUM&&SKI/SNOWBOARD&&catalog_season | — | canAmend | | | raw family label |
| /staff/amendments | Amend:26 | `<input type="checkbox">` "この予約で予備在庫を使用する（一般販売の予備枠を消費します。上の操作理由が利用・解除理由として記録されます）" | setUseReserve, clear quote | — | rendered only if `canOverride` | initial = `view.bufferOverride` | consumes reserve buffer | |
| /staff/amendments | Amend:27 | `<button>` "変更見積を固定" | `op.send('/api/operations/amendment-quote',{bookingId,expectedHoldVersion,conditions,reason,[bufferOverride:{useReserve,reason}]},setQuote)` | POST `/api/operations/amendment-quote` | canAmend (fieldset); `disabled={!reason.trim() OR ((useReserve OR view.bufferOverride)&&!canOverride)}` | | fixes amendment quote (has expiresAt) | |
| /staff/amendments | Amend:28 | `<label>交換時のフィット・現品確認<input maxLength={160}>` | setFit | — | | | | |
| /staff/amendments | Amend:28 | `<button>` "この見積で変更を確定" | `op.send('/api/operations/amendment-accept',{quoteId,fitEvidence,reason},…)` clears quote/view/financial | POST `/api/operations/amendment-accept` | (outside canAmend fieldset!) `disabled={op.disabled OR !reason.trim()}` | | IRREVERSIBLE amendment commit; "自動返金 0円" | no confirm dialog |
| /staff/amendments | Amend:30 | `<p role="alert">` "要照合: {a.code}。新しい返金依頼を止めています。" per alert | — | — | | blocks refund fieldset | | |
| /staff/amendments | Amend:30 | `<fieldset disabled={op.disabled OR !canRefund OR alerts.length>0}><legend>明示権限による例外返金`; `<label>元の入金<select>` ("選択", "{id} · 残額 {remainingJpy}円"); `<label>理由区分<select>` CUSTOMER_EXCEPTION "個別例外" / SERVICE_ISSUE "サービス上の事情" / DUPLICATE_COLLECTION "重複入金" / OTHER_APPROVED "その他の承認済み例外" (default CUSTOMER_EXCEPTION); `<label>返金依頼額（円）<input type="number" min="1" max="100000000">` | state | — | REFUND_OVERRIDE | | | option values are API enums |
| /staff/amendments | Amend:30 | `<button>` "例外返金を依頼する" | `op.send('/api/operations/refund',{bookingId:booking,paymentId,actingStore:store,category,reason,amountJpy:Number(amount)},()=>setFinancial(null))` | POST `/api/operations/refund` | REFUND_OVERRIDE; `disabled={!payment OR !reason.trim() OR !amount}` | | IRREVERSIBLE refund request (sent once by scheduled job, no auto resend) | NO confirm dialog |

### 2.10 Holds (/staff/holds) — HoldWorkspace

Gate: HOLD_VIEW (holds/page.tsx:6); canEdit=HOLD_EDIT, canOverride=INVENTORY_BUFFER_OVERRIDE; `key={stamp}`. API base `/api/holds`, header `x-zao-session`. Pending sessionStorage `zao-rental-hold-pending-v1` (path whitelist `^$|^/{uuid}/(amend|cancel|expire|reassign)$`, requires `body.requestKey`). `blocked = busy OR uncertain OR storageBlocked` (L54). Mount: GET `/api/holds/options` + GET `/api/holds`; ANY non-ok → `invalidateStaffView()` (L39). Messages via `messages` map L24, unknown → raw `result.result`. Header nav: "台帳へ"(/staff/ledger) · "ログアウト"(/staff/logout).

| route | component:line | control | action/handler | API | permission | states | semantics | must-preserve |
|---|---|---|---|---|---|---|---|---|
| /staff/holds | Hold:58 | `<fieldset disabled={blocked}><legend>利用条件（日本時間）`: `<label>受取店舗<select>`, `<label>返却予定店舗<select>`, `<label>開始日<input type="date">` (non-MULTIDAY also sets endDate), `<label>最終日<input type="date">`, `<label>利用区分<select>` AM "AM 08:30–12:00" / PM "PM 13:00–17:00" / DAY "1日 08:30–17:00" / MULTIDAY "複数日（最大10日）" | state | — | HOLD_VIEW | | hold conditions | option values |
| /staff/holds | Hold:59 | per member `<fieldset><legend>{n}人目（個人情報不要）`: `<label>商品<select>` options raw SKI_SET/SNOWBOARD_SET/SINGLE (resets items); `<label>年齢区分<select>` ADULT/KIDS; `<label>クラス<select>` REGULAR/PREMIUM (age/tier change clears variantIds) | updateMember | — | | | | raw enum option text |
| /staff/holds | Hold:60 | `<label>単品種別<select>` options from `names` (SKI "スキー（1ペア）" …) | | — | product SINGLE | | | |
| /staff/holds | Hold:61 | per item `<select multiple aria-label="{n}人目 {names[family]}">` options "{size} · {name}" | selectedOptions → variantIds | — | | CSS `.holds select[multiple]{min-height:100px}` | multiple = acceptable alternates | aria-label; `multiple` |
| /staff/holds | Hold:61 | `<button>` "この人を削除" | filter member | — | members>1 | | | |
| /staff/holds | Hold:62 | `<button>` "人数を追加" | add `member(uuid.slice(0,8))` | — | | `disabled={members.length>=20}` | max 20 | |
| /staff/holds | Hold:64 | `<fieldset disabled={blocked}><legend>予備在庫の利用`… checkbox "予備在庫を使用する / Use reserve inventory"; `<label>予備在庫の利用・解除理由<input maxLength={250}>` | state | — | rendered only if canOverride | | reserve buffer | |
| /staff/holds | Hold:65 | `<button>` "在庫を照会" | `perform(selected?'/{id}/availability':'/availability', (useReserve OR selected.bufferOverride)?{conditions,bufferOverride:useReserve}:conditions, false)` | POST `/api/holds/availability` or `/api/holds/{id}/availability` | HOLD_VIEW | `disabled={blocked}` | reference availability | read POST, not persisted |
| /staff/holds | Hold:65 | `<button>` "グループを仮押さえ" / (selected) "条件を一括変更" | `perform(selected?'/{id}/amend':'',{requestKey,conditions,[expectedVersion],[bufferOverride:{reason,useReserve}]},true)` | POST `/api/holds` or `/api/holds/{id}/amend` | `disabled={blocked OR !canEdit OR ((useReserve OR selected.bufferOverride)&&(!canOverride OR !reserveReason.trim()))}` | | create/amend 10-min group HOLD (no extension on amend) | reservationId persisted via ref |
| /staff/holds | Hold:65 | `<button>` "仮押さえを取り消す" | `perform('/{id}/cancel',{requestKey},true)` | POST `/api/holds/{id}/cancel` | HOLD_EDIT; selected | `disabled={blocked OR !canEdit}` | IRREVERSIBLE release of HOLD | NO confirm |
| /staff/holds | Hold:65 | `<button>` "新しい要求" | reset selection; message "新しい要求" | — | | `disabled={blocked}` | | |
| /staff/holds | Hold:66 | `<button>` "施設全体の在庫枠を表示" | `perform('/capacity',conditions(),false)` | POST `/api/holds/capacity` | | `disabled={blocked}` | capacity table (inline style `overflowX:'auto'` L67) | |
| /staff/holds | Hold:68 | `<button>` "同じ要求を照合・再送" | `perform(pending.path,pending.body,true)` | replay | `uncertain&&!busy` | `disabled={storageBlocked}` | | |
| /staff/holds | Hold:69 | `<button>` "期限を確認" (in `<section aria-label="HOLD詳細">`) | `perform('/{id}/expire',{requestKey},true)` | POST `/api/holds/{id}/expire` | HOLD_EDIT | `disabled={blocked OR !canEdit}` | may EXPIRE hold | `<p role="alert">` "移動の再確認が必要です。確保を自動解除していません。" when transferAttention |
| /staff/holds | Hold:70 | list `<button>` "{startDate} · {slot} · {state} · {id8}" ("自分のHOLD（最新100件）") | `choose(h)` | — | | `disabled={blocked}` | | |

### 2.11 Quotes (/staff/quotes) — QuoteWorkspace

Gate: QUOTE_VIEW (quotes/page.tsx:5); canCreate=QUOTE_CREATE; canConfigure = `role==='ADMIN' && scope==='ALL' && PRICE_EDIT`. API base `/api/quotes`, mount GET `/catalog`,`/options`,`` (list). Pending sessionStorage `zao-rental-quote-pending-v1` (path whitelist `''`,`/private-initialize`). `blocked = busy OR pending OR storageBlocked` (L26). Header nav: "台帳へ" · "期間在庫へ"(/staff/holds) · "スタッフ管理"(/staff/users, ungated link) · "ログアウト".

| route | component:line | control | action/handler | API | permission | states | semantics | must-preserve |
|---|---|---|---|---|---|---|---|---|
| /staff/quotes | Quote:41 | `<fieldset disabled={blocked OR !catalog}><legend>初期料金を開発用に設定`; `<label>料金の対象開始日<input type="date">`, `<label>料金の対象終了日<input type="date">` | state | — | `canConfigure && !catalog.books.length` | "料金情報の読込が完了してから入力できます。" | | |
| /staff/quotes | Quote:41 | `<button>` "開発用の初期料金を設定" | `send({path:'/private-initialize',body:{operation:'initializePrivate',input:{requestKey,rentalFrom,rentalUntil}}})` | POST `/api/quotes/private-initialize` | canConfigure | no field validation client-side | creates first price book (copies canonical prices) | |
| /staff/quotes | Quote:42 | `<fieldset disabled={blocked OR !canCreate OR !catalog?.active}><legend>見積条件`: `<select aria-label="受取店舗">`, `<select aria-label="返却店舗">`, `<label>利用開始日<input type="date">`, `<label>利用終了日<input type="date">`, `<select aria-label="利用区分">` DAY "1日"/MULTIDAY "連日（1〜10日）"/AM "午前半日"/PM "午後半日" | state; each change → `changed()` (clear selected) | — | QUOTE_CREATE | | | aria-labels |
| /staff/quotes | Quote:43 | per member `<fieldset><legend>利用者 {n}（個人情報なし）`; `<select aria-label="商品 {n}">` (catalog products, label `productLabel`); per item `<select aria-label="{names[family]}のサイズ {n}">` "選択" + "{name} / {size} / {id8}" | `selectProduct`, `replaceMember` | — | | | product key composition `keyFor` L34 | |
| /staff/quotes | Quote:43 | `<button>` "利用者 {n} を除く"; `<button>` "利用者を追加" | members ± | — | | add `disabled={members.length>=20}` | | |
| /staff/quotes | Quote:44 | `<label>クーポンコード<input maxLength={32}>`; checkbox "早割5％の適用見込みを確認" | state | — | | | coupon not consumed; advance discount estimate | |
| /staff/quotes | Quote:44 | `<button>` "HOLD連携を外して別見積にする" | clears holdId & reservation ref | — | holdId set | | | |
| /staff/quotes | Quote:44 | `<button>` "見積を作成して保存" | `create()` → send `{path:'',body:{requestKey,input:{conditions:{reservationId,…},holdId,couponCode:coupon OR null,wantAdvance}}}` | POST `/api/quotes` | QUOTE_CREATE + active book (fieldset) | messages "保存しました。請求・決済は行っていません。" / "元の要求を照合しました" / "処理を拒否しました：{CODE}" / "結果未確認です。同じ要求を照合してください。" | saves frozen quote (no charge, no hold extension) | |
| /staff/quotes | Quote:45 | `<button>` "HOLD {id}" per own hold | `copyHold(h)` | — | | `disabled={blocked}` | | |
| /staff/quotes | Quote:46 | `<button>` "同じ要求を照合・再送" | `send(pending)` | replay | `pending&&!busy` | `disabled={storageBlocked}`; status "保存領域を確認できないため変更停止。" | | |
| /staff/quotes | Quote:47 | `<button>` "{id8} · {total} 円 · {validity}" | `choose(id)` | GET `/api/quotes/{id}` | | `disabled={blocked}` | | detail `<section aria-label="見積詳細">` |

### 2.12 Transfers (/staff/transfers) — TransferWorkspace

Gate: TRANSFER_VIEW (transfers/page.tsx:5); full `permissions` array passed; client `can(p)` checks TRANSFER_PLAN / TRANSFER_DISPATCH / TRANSFER_RECEIVE plus store-membership (`stores.includes(source/destination)`). API base `/api/transfers` (POST iff body truthy). Mount GET `` + `/options`. Pending sessionStorage `zao-rental-transfer-pending-v1` (whitelist `^$|^/{uuid}/(add|dispatch|receive|ready|cancel|issue)$`). `blocked = busy OR pending OR storageBlocked`. Errors mapped via `errors` table L13; else "処理を拒否しました。入力と最新の記録を確認してください。"; SESSION_CHANGED → "セッションを再確認してください". `operation(op,input)` → POST `/api/transfers/{selectedId}/{op}` `{requestKey,input}`. Header nav: "台帳へ" · "期間在庫へ" · "ログアウト".

| route | component:line | control | action/handler | API | permission | states | semantics | must-preserve |
|---|---|---|---|---|---|---|---|---|
| /staff/transfers | Transfer:31 | `<fieldset disabled={blocked OR !can('TRANSFER_PLAN')}><legend>移動計画`: `<select aria-label="元店舗">` (resets stock), `<select aria-label="移動先">`, `<label>17時便の日付<input type="date">`, `<label>準備完了の見込み（日本時間）<input type="datetime-local">`, `<label>必要期限（日本時間）<input type="datetime-local">`, `<label>計画根拠・運搬と準備の確認<input maxLength={160}>`, `<select aria-label="対象用品">` ("選択", "{name} · {size} · {id} · 台帳 {quantity}", filtered by source), POLE → `<label>ポール数量（ペア）<input type="number" min=1 max=100>` | state | — | TRANSFER_PLAN | | | `:00+09:00` suffix appended to datetime-local values (L32) |
| /staff/transfers | Transfer:32 | `<button>` "計画を確保する" | send `{path:'',body:{requestKey,input:{sourceStore,destinationStore,scheduledDate,plannedReadyAt:ready+':00+09:00',neededBy:needed+':00+09:00',basis,lines:[line]}}}` (line = POLE? `{poleId,quantity}` : `{assetId}`) | POST `/api/transfers` | TRANSFER_PLAN (fieldset) | no client field validation | creates transfer plan (protects stock) | JST offset string |
| /staff/transfers | Transfer:32 | `<button>` "選択した便に用品を追加" | `operation('add',{lines:[line]})` | POST `/{id}/add` | TRANSFER_PLAN; selected | `disabled={selected.state!=='PLANNED'}` | | |
| /staff/transfers | Transfer:33 | `<button>` "同じ要求を照合・再送" | send(pending) | replay | | `disabled={storageBlocked}` | | |
| /staff/transfers | Transfer:34 | list `<button>` "{date} · {src} → {dst} · {state} · {id8}" | `choose(id)` | GET `/api/transfers/{id}` | | `disabled={blocked}` | | |
| /staff/transfers | Transfer:35 | `<section aria-label="移動詳細">` `<p role="alert">` "要対応：{issue or '準備見込み時刻を超過'}"; `<fieldset disabled={blocked}><legend>受領・準備完了の対象`; per asset piece `<input type="checkbox" aria-label="移動明細 {id}">` label "Asset {asset_id} — {state}" (CLOSED → "CLOSED（準備完了・移動保護終了）") | toggle selection | — | | | | aria-label |
| /staff/transfers | Transfer:36 | per pole line `<section aria-label="ポール数量明細">` `<label>今回のポールペア数<input type="number" min=1 max=100>`; `<button>` "ポール数量を実受領" / "ポール数量の準備完了" | `operation('receive'/'ready',{pieceIds:transit/received.slice(0,pairCount)})` | POST `/{id}/receive`, `/{id}/ready` | TRANSFER_RECEIVE && destination in stores; `pairCount` integer 1..available | | | |
| /staff/transfers | Transfer:37 | `<button>` "計画の全品を実発送" | `operation('dispatch')` | POST `/{id}/dispatch` | TRANSFER_DISPATCH && source in stores; `disabled` unless state PLANNED and no issue | | IRREVERSIBLE dispatch (≥17:00 server rule) | NO confirm |
| /staff/transfers | Transfer:37 | `<button>` "選択分を実受領" | `operation('receive',{pieceIds:selection})` | POST `/{id}/receive` | TRANSFER_RECEIVE && destination; `selection.length` | | receipt as fact | |
| /staff/transfers | Transfer:37 | `<button>` "選択分の準備完了" | `operation('ready',{pieceIds:selection})` | POST `/{id}/ready` | same | | | |
| /staff/transfers | Transfer:37 | `<button>` "発送前計画を取り消す" | `operation('cancel')` | POST `/{id}/cancel` | TRANSFER_PLAN; state PLANNED | | IRREVERSIBLE cancel | NO confirm |
| /staff/transfers | Transfer:37 | `<label>要対応の理由<input maxLength={160}>` + `<button>` "要対応を記録" | `operation('issue',{reason})` | POST `/{id}/issue` | NO client permission check (server only); fieldset blocked | reason may be empty client-side | flags issue (blocks dispatch) | |

### 2.13 Staff management (/staff/users) — StaffManagement

Gate: authorized && `canManage(principal)` (users/page.tsx:7); wrapped in `StaffSessionBoundary`. List GET `/api/staff-users` (NO `x-zao-session` header, L7,L9); save POST `/api/staff-users` or PATCH `/api/staff-users/{id}` WITH `x-zao-session`. Form fields read via FormData by `name` (names = API keys). 409 + `STALE_STAFF_REVISION` → conflict mode. Not using invalidateStaffView on 401/403.

| route | component:line | control | action/handler | API | permission | states | semantics | must-preserve |
|---|---|---|---|---|---|---|---|---|
| /staff/users | StaffMgmt:13 | `<a href="/staff/ledger">` "台帳へ" | nav | | | | | in `.staff-page-head` |
| /staff/users | StaffMgmt:13 | `<button>` "スタッフを作成" | `setEditing(null)` (create form) | — | canManage | | | |
| /staff/users | StaffMgmt:13 | `<p role="alert">` error; `<button>` "最新設定を再読込" | `reloadConflict()` → GET list, re-select editing by id | GET `/api/staff-users` | | shown if `conflict`; errors "最新設定を取得できませんでした。" / "スタッフ一覧を取得できませんでした。" / "別の管理者が更新したため再読込が必要です。最新設定から編集し直してください。" / "保存できませんでした。権限・店舗・入力内容・重複メールを確認してください。自分自身の権限はここでは変更できません。" | optimistic concurrency | |
| /staff/users | StaffMgmt:14 | `<form className="staff-management-form" aria-label="スタッフ更新" or "スタッフ作成" key={id:revision or 'new'}>` | `save()` L10 | POST/PATCH (above) body `{displayName,active,role,scope,storeIds,permissions,(create: email,password) or (update: expectedRevision)}` | canManage | | create/update staff accounts | form key remount |
| /staff/users | StaffMgmt:14 | `<label>表示名<input name="displayName" required maxLength={80}>` | | | | | | name |
| /staff/users | StaffMgmt:14 | create only: `<label>メールアドレス<input name="email" type="email" required maxLength={254} autoComplete="off">`; `<label>初期パスワード（15〜128文字）<input name="password" type="password" required minLength={15} maxLength={128} autoComplete="new-password">` | | | | | password never re-shown | autoComplete values |
| /staff/users | StaffMgmt:15 | `<select aria-label="Role" name="role">` options ADMIN/MANAGER/STAFF/VIEWER (raw text; default STAFF) | | | | | role | |
| /staff/users | StaffMgmt:15 | `<input type="checkbox" name="active">` "有効" (default true) | `active = d.get('active')==='on'` | | | | UNCHECK = deactivate (revocation) | value 'on' semantics |
| /staff/users | StaffMgmt:16 | `<select aria-label="店舗範囲" name="scope">` ASSIGNED "選択した店舗のみ" / ALL "全店舗（明示的な付与）" | | | | | scope ALL gates price admin etc. | |
| /staff/users | StaffMgmt:16 | `<fieldset><legend>店舗アクセス` checkboxes `name="store" value="MOUNTAIN_BASE" / "ONSEN_BASE"` label storeDisplayName | `d.getAll('store')` | | | | | name="store" (multi) |
| /staff/users | StaffMgmt:17 | `<fieldset><legend>個別Permission` 20 × `<select name={PERMISSION} aria-label={label}>` options `default` "Roleの標準" / `allow` "付与" / `deny` "剥奪" | entries with value≠'default' → `{P: value==='allow'}` | | | defaultValue from existing override | per-permission override (grant/revoke) | 20 names: INVENTORY_VIEW, INVENTORY_EDIT, STAFF_MANAGE, HOLD_VIEW, HOLD_EDIT, TRANSFER_VIEW, TRANSFER_PLAN, TRANSFER_DISPATCH, TRANSFER_RECEIVE, QUOTE_VIEW, QUOTE_CREATE, PRICE_EDIT, BOOKING_VIEW, BOOKING_CREATE, RENTAL_CHECKOUT, RENTAL_RETURN, RENTAL_AMEND, REFUND_OVERRIDE, INVENTORY_RECONCILE, NOTIFICATION_RESEND. NOTE REFUND_OVERRIDE visible label "返金（STAFF以上は標準で可）" ≠ aria-label "例外返金依頼（明示付与）" (pre-existing mismatch) |
| /staff/users | StaffMgmt:17 | `<button type="submit">` "スタッフ設定を保存" | submit | (above) | | `disabled={conflict OR saving}`; success → `form.reset()`, close, reload list | | |
| /staff/users | StaffMgmt:17 | `<button type="button">` "閉じる" | `setEditing(undefined)` | | | | | type=button (inside form) |
| /staff/users | StaffMgmt:18 | per card `<button aria-label="スタッフを編集：{displayName}">` "設定を編集" | `setEditing(s)` | | | | | aria-label; list `<ul className="staff-cards">` |

### 2.14 Content (/staff/content) — ContentWorkspace + PhotoWorkspace (ContentPhotoWorkspace.tsx)

Gate: `status==='authorized'` ONLY, else `redirect('/staff/login')` (content/page.tsx:6) — no permission check in page; server API must enforce. API `/api/content{action}` (POST iff body). Pending sessionStorage `zao-content-pg-pending`. Fieldsets `disabled={busy OR !!pending OR initial.blocked}`. Status `<p role="status" aria-label="説明処理状態">`. Messages: "処理中…", "一部の下書きを保存済み。失敗行は反映していません。" (state PARTIAL), "保存済み。本番へは公開していません。", "拒否：{CODE}", "結果未確認。同じ保存要求を照合してください。", "保存領域未確認。処理を開始しません。".

| route | component:line | control | action/handler | API | permission | states | semantics | must-preserve |
|---|---|---|---|---|---|---|---|---|
| /staff/content | Content:20 | `<a href="/staff/logout">` "ログアウト" | nav | | | | | |
| /staff/content | Content:20 | `<fieldset><legend>一括下書き` `<label>CSV本文<textarea rows={7}>` default header `schema_version,offer_code,locale,expected_revision,field,operation,value\n` | setCsv | — | authorized | | CSV draft import | default CSV header literal |
| /staff/content | Content:20 | `<label>CSVファイル<input type="file" accept=".csv,text/csv">` | reads text into textarea; >5 MiB → "CSVは5MiBまでです。"; read fail "ファイルを読めません。" | — | | | | accept, 5 MiB limit |
| /staff/content | Content:20 | `<button>` "差分を検証して保存" | `act('/bulk-prepare',{csv})` | POST `/api/content/bulk-prepare` | | | prepare BULK plan | |
| /staff/content | Content:21 | per plan (not completed) `<button>` "有効な下書きを反映：{planId}" (BULK) / "非公開releaseへ反映：{planId}" (RELEASE) | `act('/bulk-commit' or '/release-commit',{planId,hash})` | POST `/api/content/bulk-commit` / `/release-commit` | | RELEASE `disabled` if issues>0 | COMMIT (release = private release switch; "本番へは公開していません") | hash echo |
| /staff/content | Content:21 | `<button>` "下書き全体のreleaseを検証" | `act('/release-prepare',{entries:drafts.ids,expectedCurrent,restoreOf:null})` | POST `/api/content/release-prepare` | | `disabled={!data}` | | |
| /staff/content | Content:21 | per release `<button>` "このreleaseから復元案を検証：{id}" | `act('/release-prepare',{entries:[],expectedCurrent,restoreOf:id})` | POST release-prepare | | | restore (rollback) plan | |
| /staff/content | Content:21 | `<button>` "同じ保存要求を照合" | `send(pending)` | replay | `pending&&!busy` | | | |
| /staff/content | Content:21 | `<button>` "下書きを再読込" | refresh | GET `/api/content` | | `disabled={busy}`; "取得できません。" | | |
| /staff/content | Content:21 | `<section aria-label="メーカー資料fixture">` `<label>資料のJSONファイル<input type="file" accept="application/json,.json">` | parse array; >2 MiB "資料は2MiBまでです。"; else "資料を読み込めません。" | — | | | | |
| /staff/content | Content:21 | `<button>` "資料の行を照合して保存" | `act('/catalog-prepare',{rows})` | POST `/api/content/catalog-prepare` | | `disabled={!sourceRows}` | | |
| /staff/content | Photo:19 | `<section aria-label="写真一括fixture">` `<fieldset disabled={busy}>` `<label>写真ファイル<input type="file" multiple accept="image/jpeg,image/png,image/webp">` | `choose(list)` validation: ≤200 files, each ≤10 MiB, ext jpe?g/png/webp, total ≤500 MiB → else "JPEG/PNG/WebP、各10MiB、200枚・合計500MiBまで。HEICは未対応です。" | — | | "選択済み。送信・変換はまだ行っていません。" | | limits |
| /staff/content | Photo:19 | drop zone `<div onDragOver onDrop>` "ここへ写真をまとめてドロップできます" (inline style `border:'1px dashed',padding:16`) | `choose(dataTransfer.files)` | — | | | drag-and-drop | preventDefault on dragover/drop |
| /staff/content | Photo:19 | `<button>` "選択した写真を送信・再開" | `start()`: SHA-256 each file → POST `/prepare {jobId,files}` (jobId reused from sessionStorage `zao-pg-private-photo-job` if same stamp) → per PENDING item POST `/upload {jobId,index,base64}` then GET `?jobId=` | POST `/api/content-photos/prepare`, POST `/api/content-photos/upload`, GET `/api/content-photos?jobId=` | | `disabled={!files.length}`; "処理中…"; ok "処理結果を保存しました。商品への正式紐付け・権利承認・公開はしていません。"; FIXTURE_LOCKED msg; else "未確認または拒否。同じファイルを再選択し、保存済みjobを照合してください。" | resumable upload | AbortController signal |
| /staff/content | Photo:19 | `<button>` "保存済み写真jobを照合" | `recover()` | GET `?jobId=` | | | | |
| /staff/content | Photo:19 | `<button>` "別の写真jobを開始" | removes sessionStorage key, resets | — | | "別jobの準備。過去の保存画像は削除していません。" | | |
| /staff/content | Photo:19 | `<button>` "写真処理を中断" (outside fieldset) | `controller.abort()` | — | | `disabled={!busy}` | pause | |
| /staff/content | Photo:21 | Thumb `<Image unoptimized alt="合成fixture確認用 {filename}" width={240} height={180} style={{maxWidth:'100%',objectFit:'contain'}}>` | blob URL fetch | GET `/api/content-photos/derivative?jobId=&index=` | | "画像未確認" fallback | | revokeObjectURL cleanup |

### 2.15 Recommendations (/staff/recommendations; also /preview/integrated with `integrated`) — RecommendationWorkspace

Gate: HOLD_VIEW && QUOTE_VIEW (recommendations/page.tsx:5); `canSelect` = HOLD_EDIT && QUOTE_CREATE. `/preview/integrated` uses same gate with `integrated` prop (adds `contractVersion:'INTEGRATED_V1_2'`, WEAR sport, IntegratedFields). API base `/api/recommendations`; mount GET `/options` + ``. Pending sessionStorage `zao-rental-recommendation-pending-v1` (whitelist `^$|^/{uuid}/(select|resume)$`). `blocked = storageBlocked OR Boolean(pending?.path) OR busy&&pending?.path!==''` (L23) — preview (path '') does NOT block the condition fieldset; any condition change `changed()` cancels a pending preview (L27). `definite` excludes `OPERATION_IN_PROGRESS` (L24). Header nav: "台帳" · "期間在庫" · "店舗間移動" · "料金・見積" · "ログアウト".

| route | component:line | control | action/handler | API | permission | states | semantics | must-preserve |
|---|---|---|---|---|---|---|---|---|
| /staff/recommendations | Rec:42 | `<fieldset disabled={blocked}><legend>利用条件`: `<select aria-label="受取店舗">`, `<select aria-label="返却予定店舗">`, `<label>利用開始日<input type="date">`, `<label>利用終了日<input type="date">`, `<select aria-label="利用区分">` DAY "1日"/AM "午前半日"/PM "午後半日"/MULTIDAY "連日（1〜10日）" | `changed()` → clears view/directions/accept; msg "条件を変更しました。推薦を再取得してください。" | — | HOLD_VIEW&QUOTE_VIEW | | | aria-labels |
| /staff/recommendations | Rec:43 | per member `<fieldset><legend>利用者 {n}`: `<select aria-label="競技 {n}">` SKI "スキー"/SNOWBOARD "スノーボード"/(integrated) WEAR "ウェアのみ"; `<select aria-label="利用開始時の年齢区分 {n}">` "" "確認して選択"/ADULT "13歳以上（大人）"/KIDS "12歳以下（子供）"; (non-WEAR) `<select aria-label="クラス {n}">` REGULAR/PREMIUM; `<label>身長cm {n}<input type="number">`; `<label>足サイズcm {n}<input type="number" step="0.1">` | sportChange / changeMember | — | | | sizing inputs | no aria-label on number inputs (label text includes index) |
| /staff/recommendations | Rec:46 | SKI only: `<label>体重kg {n}<input type="number">`, `<label>利用開始時の年齢 {n}<input type="number">`, `<select aria-label="レベル {n}">` "" "申告を選択"/BEGINNER "初級"/INTERMEDIATE "中級"/ADVANCED "上級", `<select aria-label="ポールのサイズ {n}">` "" "明示的に選択（自動推薦なし）" + "{size} / ペア単位 / {id last8}" | changeMember | — | | | pole explicit only | |
| /preview/integrated | Rec:63-66 | IntegratedFields: checkbox `aria-label="ウェア上下セットを追加 {n}"` "ウェア上下セットを追加（道具セットと同じ利用者のウェア部分20％調整）"; `<label>ウェア用途 {n}<select>` SKI/SNOWBOARD (WEAR sport); `<select aria-label="上サイズ {n}">`/`"下サイズ {n}"` ("サイズを選択"); PREMIUM: `<select aria-label="指定モデル・シーズン {n}">` value `modelId\|season` ("モデルを選択") | setWear/onMember/changeModel | — | | | | `modelId\|season` value encoding |
| /staff/recommendations | Rec:47 | `<button>` "利用者 {n} を除く"; `<button>` "利用者を追加" | changed | — | | add `disabled={members>=20}` | | |
| /staff/recommendations | Rec:48 | `<button>` "推薦候補を確認" | `send({path:'',body:{requestKey,input,replaceHoldId}})` | POST `/api/recommendations` | | `disabled={busy}`; msg "処理中…" then "推薦候補を保存しました。在庫は未確保です。" | preview (no stock) | |
| /staff/recommendations | Rec:50 | per member per direction (RECOMMENDED "おすすめ"/SHORTER "短め"/LONGER "長め") `<button aria-pressed={selected}>` "{label}を選ぶ {n}" (in `<article aria-label="利用者 {n} の候補">`, `.candidate-grid`) | setDirections; msg "選択しました。在庫はまだ確保していません。" | — | | `disabled={blocked OR busy OR view.selection OR !candidate}` | choose size direction | `aria-pressed` drives CSS `.candidate-grid button[aria-pressed=true]` |
| /staff/recommendations | Rec:51 | `<fieldset disabled={blocked OR busy OR !canSelect}><legend>全員分の選択を確保`: checkbox "表示したモデル契約・サイズ・ウェア構成を選択条件とすることを確認" (integrated) / "モデル指定なし・表示したサイズとクラスを選択条件とすることを確認"; `<label>クーポンコード<input maxLength={32}>`; checkbox "早割5％の適用見込みを確認" | state | — | canSelect | | policy acceptance | |
| /staff/recommendations | Rec:51 | `<button>` "全員分をHOLDして見積を保存" | `send({path:'/{previewId}/select',body:{requestKey,selection:{directions,acceptedModelPolicy:accept,couponCode:coupon OR null,wantAdvance}}})` | POST `/api/recommendations/{id}/select` | canSelect | `disabled={!selectable}` (all members chosen && accept) | creates group HOLD + quote | checkbox acts as confirmation |
| /staff/recommendations | Rec:53 | `<button>` "保存済みHOLD・見積処理を照合する" | `send({path:'/{id}/resume',body:{}})` | POST `/api/recommendations/{id}/resume` | canSelect; stage INTENT or HOLD_SAVED | `disabled={blocked OR busy OR !canSelect}` | resume saga | |
| /staff/recommendations | Rec:54 | `<a href="/preview/rental?quote={id}">` "予約情報・決済結果へ" | nav | | quote && selectionMatchesHold | | | |
| /staff/recommendations | Rec:55 | `<button>` "保存結果を再読込" | `open(previewId)` | GET `/api/recommendations/{id}` | | `disabled={blocked OR busy}` | | |
| /staff/recommendations | Rec:57 | `<button>` "同じ要求を照合・再送" | send(pending) | replay | `pending&&!busy` | `disabled={storageBlocked}`; status "保存領域が確認できないため変更停止。" | | |
| /staff/recommendations | Rec:57 | list `<button>` "推薦 {id8} · {startDate}" | `open(id)` | GET | | `disabled={blocked OR busy}` | | |

### 2.16 Inventory / stocktake / CSV import (/admin/inventory) — InventoryOperationsWorkspace

Gate: INVENTORY_VIEW (admin/inventory/page.tsx:6); canEdit=INVENTORY_EDIT; canReconcile=INVENTORY_RECONCILE. `useOperationsRequest(stamp,'inventory')` → sessionStorage `zao-operations-inventory`; `op.disabled = busy OR !ready OR !!pending`. Status `<p role="status">{op.message}</p>` L20. Header nav: "用品台帳・ラベル"(/admin/assets) · "店舗間移動" · "ウェア"(/staff/wear) · "貸出・返却"(/staff/rentals).

| route | component:line | control | action/handler | API | permission | states | semantics | must-preserve |
|---|---|---|---|---|---|---|---|---|
| /admin/inventory | Inv:21 | `<button>` "保存済みの同じ要求を照合" | `op.send(pending.path,null,…,true)` | replay | `op.pending` | `disabled={op.busy}` | | |
| /admin/inventory | Inv:22 | `<fieldset disabled={op.disabled}><legend>店舗` `<label>対象店舗<select>` | setStore, clear stocktake/workspace | — | | | | |
| /admin/inventory | Inv:22 | `<button>` "店舗在庫を読み込む" | load | GET `/api/operations/inventory?store=` | INVENTORY_VIEW | | | |
| /admin/inventory | Inv:22 | `<button>` "棚卸を開始" | `op.send('/api/operations/stocktake-create',{store},r=>setLastId(r.id))` | POST `/api/operations/stocktake-create` | `disabled={!canEdit}` | | opens stocktake | |
| /admin/inventory | Inv:23 | `<button>` "棚卸を読み込む" (after "棚卸ID: {id}") | `refresh()` | GET `/api/operations/stocktake?id=` | | `disabled={op.busy}` | | |
| /admin/inventory | Inv:24 | per saved stocktake `<button>` "{id} · {state}" | load stocktake | GET stocktake | | `disabled={op.disabled}` | | |
| /admin/inventory | Inv:25 | `<AssetQrInput disabled={op.disabled OR !canEdit} onAsset={id=>setAssets(dedupe)}>` | local list only (not saved) | none | canEdit | "今回の読取: {n}件（まだ保存されていません）" | stocktake scan | onAsset is local (async) |
| /admin/inventory | Inv:25 | per scanned id `<button>` "読取を取り消す" | remove from list | — | | `disabled={op.disabled}` | | |
| /admin/inventory | Inv:26 | `<fieldset disabled={op.disabled OR !canEdit}><legend>数量プールの実数` per pool `<label>{'ポール（PAIR）' or 'ウェア（枚）'} {id} · 台帳の店内数 {physical}<input type="number" min="0" max="1000000">` | setCounts | — | canEdit | | | |
| /admin/inventory | Inv:26 | `<button>` "読取・数量を保存して差異確認へ" | `op.send('/api/operations/stocktake-observe',{id,expectedRevision,assets,quantities:counts},…)` | POST `/api/operations/stocktake-observe` | canEdit | | save observations | |
| /admin/inventory | Inv:28 | `<fieldset disabled={op.disabled OR !canReconcile OR state!=='REVIEW_REQUIRED'}><legend>権限による差異確定`; `<label>理由（病歴等の詳細は記入しない）<input maxLength={160}>` | setReason | — | INVENTORY_RECONCILE | | | reason state SHARED with import reason (same `reason` state L16) |
| /admin/inventory | Inv:28 | `<button>` "差異を確定する" | `op.send('/api/operations/stocktake-reconcile',{id,expectedRevision,reason},…)` | POST `/api/operations/stocktake-reconcile` | canReconcile | `disabled={!reason.trim()}` | IRREVERSIBLE: missing assets → unavailable; quantity diffs applied | NO confirm dialog |
| /admin/inventory | Inv:29 | `<button>` "CSVテンプレートを保存" | creates Blob from `STOCK_IMPORT_HEADER_V2`, anchor download `zao-stock-template.csv` | none | | `disabled={op.disabled}` | template download | filename |
| /admin/inventory | Inv:30 | `<fieldset disabled={op.disabled OR !canEdit}><legend>入力ファイル`: `<label>暫定在庫の受入元ID（該当する受領のみ）<input>`; `<label>CSVファイル<input type="file" accept=".csv,text/csv">` (≤2 MiB else silently cleared) | setProvisionalSourceId / setCsv; both clear stage | — | canEdit | | | 2 MiB limit |
| /admin/inventory | Inv:30 | `<button>` "dry-runを保存" | `op.send('/api/operations/import-stage',{csv,sheet:'stock',[provisionalSourceId]},setStage)` | POST `/api/operations/import-stage` | canEdit | `disabled={!csv}` | dry-run stage | `sheet:'stock'` literal |
| /admin/inventory | Inv:31 | `<fieldset disabled={op.disabled OR !canEdit OR !stage.ready}>` `<label>投入理由<input maxLength={160}>` + `<button>` "検証済みの在庫を投入" | `op.send('/api/operations/import-commit',{id,stageSha256,reason},…)` | POST `/api/operations/import-commit` | canEdit; stage.ready | `disabled={!reason.trim()}` | IRREVERSIBLE stock import | NO confirm; stageSha256 binding |

### 2.17 Price books (/admin/prices) — PriceAdminWorkspace

Gate: authorized && PRICE_EDIT && `role==='ADMIN'` && `scope==='ALL'` (admin/prices/page.tsx:6). `useOperationsRequest(stamp,'price')` → sessionStorage `zao-operations-price`. Nav: "予約見積"(/staff/quotes) · "用品台帳"(/admin/assets). Every successful send → `after()` clears draft & catalog (must reload).

| route | component:line | control | action/handler | API | permission | states | semantics | must-preserve |
|---|---|---|---|---|---|---|---|---|
| /admin/prices | Price:12 | `<button>` "保存済みの同じ要求を照合" | replay | replay | op.pending | `disabled={op.busy}` | | |
| /admin/prices | Price:13 | `<button>` "料金版を読み込む" | load | GET `/api/quotes/catalog` | | `disabled={op.disabled}` | | |
| /admin/prices | Price:14 | `<fieldset disabled={op.disabled}><legend>既存料金版` `<label>料金版<select>` "選択" / "{id} · {state}" | setBook, clear draft | — | | | | |
| /admin/prices | Price:14 | `<button>` "料金表と差分を表示" | load | GET `/api/quotes/draft/{book}` | | `disabled={!book}` | | |
| /admin/prices | Price:14 | `<label>理由<input maxLength={160}>`, `<label>対象開始日<input type="date">`, `<label>対象終了日<input type="date">` | state | — | | | | |
| /admin/prices | Price:14 | `<button>` "選択した料金版からdraftを作る" | `op.send('/api/quotes/manage',{operation:'createDraft',input:{bookId:crypto.randomUUID(),sourceId:book,rentalFrom,rentalUntil,reason}},after)` | POST `/api/quotes/manage` | | `disabled={!book OR !from OR !until OR !reason.trim()}` | clone to new DRAFT | |
| /admin/prices | Price:16 | `<fieldset disabled={op.disabled OR draft.book.state!=='DRAFT'}><legend>draftの編集` `<label>商品<select>` (raw product keys), `<label>期間<select>` (raw duration keys, default DAY_1), `<label>金額（円）<input type="number" min="0">` | state | — | | | | |
| /admin/prices | Price:16 | `<button>` "draftを更新する" | `op.send('/api/quotes/manage',{operation:'editDraft',input:{bookId:book,revision,product,duration,amount:Number(amount),reason}},after)` | POST `/api/quotes/manage` | | `disabled={!product OR !amount OR !reason.trim()}` | edit draft cell | |
| /admin/prices | Price:16 | `<label>適用日時（この端末の時間帯）<input type="datetime-local">` | setEffective | — | | | converted with `new Date(effective).toISOString()` (DEVICE timezone) | |
| /admin/prices | Price:16 | `<button>` "表示した料金版を確定・適用する" | `op.send('/api/quotes/manage',{operation:'activate',input:{bookId:book,revision,effectiveAt,predecessorId:catalog?.active?.id ?? null,reason}},after)` | POST `/api/quotes/manage` | | `disabled={!effective OR !reason.trim()}` | IRREVERSIBLE: activates/publishes price book | NO confirm dialog |

### 2.18 Notifications (/admin/notifications) — NotificationWorkspace

Gate: BOOKING_VIEW (admin/notifications/page.tsx:6); canResend=NOTIFICATION_RESEND. Ref lock `active`; resend `requestKey` memoized per intent `deliveryId:store:reason` in `requests` Map (same click intent ⇒ same key; idempotent). No 401/403 → invalidateStaffView (generic message). No auto-load. Nav: `<Link href="/staff/ledger">` "スタッフ台帳".

| route | component:line | control | action/handler | API | permission | states | semantics | must-preserve |
|---|---|---|---|---|---|---|---|---|
| /admin/notifications | Notif:11 | `<label>店舗<select>` | setStore, clear rows | — | BOOKING_VIEW | `disabled={busy}` | | |
| /admin/notifications | Notif:11 | `<button>` "通知状態を読み込む" | `load()` | GET `/api/operations/notifications?store=` | | `disabled={busy OR !store}`; ok "通知一覧を更新しました。配送事業者は未接続です。"; err "通知状態を確認できません。権限と接続を確認してください。" | | |
| /admin/notifications | Notif:11 | `<label>再送理由<select>` CUSTOMER_REQUEST "お客様からの依頼" / DELIVERY_RECOVERY "配送障害からの復旧" | setReason | — | canResend | `disabled={busy}` | | option values |
| /admin/notifications | Notif:11 | per delivery (`<section aria-label="通知一覧">` article, inline style) `<button>` "再送を依頼" | `resend(d)` | POST `/api/operations/notification-resend` `{requestKey,input:{deliveryId,store,reason}}` | canResend; enabled only if `status==='SENT' OR (status==='PERMANENT_FAILURE'&&lastSafeFailureCode==='RETRY_EXHAUSTED')` | `disabled={busy OR !eligible}`; 429 "再送の受付上限です。時間をおいて状態を確認してください。"; other non-ok "再送を受け付けられません。結果不明・権限・期限を確認してください。"; ok "再送要求を保存しました。送信完了は通知一覧で確認してください。"; throw "受付結果は未確認です。もう一度操作した場合も同じ要求を照合します。" | sends customer notification again (external side effect) | eligibility rule; NO confirm dialog |

### 2.19 Ops exceptions (/admin/ops) — OpsWorkspace

Gate: OPERATIONS_VIEW (admin/ops/page.tsx:6); `systemScope = scope==='ALL'` adds `SYSTEM` scope option; canAcknowledge=OPERATIONS_ACKNOWLEDGE. Ref lock; acknowledge requestKey memoized per `id:store:reason`. No auto-load. Nav: "スタッフ台帳"(/staff/ledger).

| route | component:line | control | action/handler | API | permission | states | semantics | must-preserve |
|---|---|---|---|---|---|---|---|---|
| /admin/ops | Ops:38 | `<select aria-label="範囲">` (stores + SYSTEM if systemScope; label storeDisplayName) | setStore, clear rows/cursor | — | OPERATIONS_VIEW | `disabled={busy}` | | |
| /admin/ops | Ops:39 | `<select aria-label="種別">` "すべて" + 15 raw TYPES | setType | — | | `disabled={busy}` | | |
| /admin/ops | Ops:40 | `<select aria-label="重大度">` "すべて"/INFO/WARN/ERROR | setSeverity | — | | | | |
| /admin/ops | Ops:41 | `<select aria-label="状態">` UNACKNOWLEDGED "未確認" (default) / ACKNOWLEDGED "確認済み" / ALL "すべて" | setStatus | — | | | | |
| /admin/ops | Ops:42 | `<input aria-label="経過時間" type="number" min="0" max="8760" step="1">` label "経過時間(以上)" default "0" | setAgeHours | — | | | | |
| /admin/ops | Ops:43 | `<button>` "読み込む" | `load(null)` | GET `/api/operations/exceptions?store=&ageHours=&status=[&type][&severity]` | | `disabled={busy OR !store}`; empty "該当する例外はありません。"; error "運用状況を取得できません。権限と接続を確認してください。" | | |
| /admin/ops | Ops:44 | `<button>` "稼働状況" | `loadHealth()` | GET `/api/admin/readiness` | | `disabled={busy}`; err "稼働状況を取得できません。" | shows COMPONENTS APP/DB/GUEST/PAYMENT_ADAPTER/WEBHOOK/MEDIA/NOTIFICATION | |
| /admin/ops | Ops:45 | `<select aria-label="確認理由">` TRIAGED "内容を確認した" / ASSIGNED "担当者を割り当てた" / VERIFIED_WITH_CANONICAL_RECORD "正式な記録と突き合わせた" | setReason | — | canAcknowledge | | | |
| /admin/ops | Ops:58 | per exception `<button>` "確認済みにする" | `acknowledge(e)` | POST `/api/operations/exception-acknowledge` `{requestKey,input:{id,store,reason}}` | canAcknowledge && status!=='ACKNOWLEDGED' | `disabled={busy}`; ok "スタッフが確認したことのみ記録しました。入金・返金・在庫・予約の状態は変わりません。"; err "確認済みにできません。権限と店舗範囲を確認してください。"; throw "受付結果は未確認です。同じ操作を繰り返しても同じ要求として照合します。"; optimistic row update | observation acknowledgement only (no business state change) | Refund rows: NO resend control by design (comment L9-10) |
| /admin/ops | Ops:60 | `<button>` "さらに読み込む" | `load(cursor)` (append) | GET with `beforeTime`,`beforeId` | | `disabled={busy}` | keyset pagination | |

### 2.20 /admin (index)

| route | component:line | control | action | API | permission | states | semantics | must-preserve |
|---|---|---|---|---|---|---|---|---|
| /admin | admin/page.tsx:7 | `<Link href="/">` "戻る" (denied view) | nav | — | `authorize(await getPrincipal(),["ADMIN"])` (different auth path from staffState) | allowed → `<main><h1>準備中</h1></main>` | placeholder | |

### 2.21 Cross-cutting request semantics (must preserve)

- **Idempotent pending-request pattern**, used by Custody, Wear, Hold, Quote, Transfer, Recommendation, Content, BookingWorkspace and useOperationsRequest (Amend, Inventory, Price). Before the POST, the request `{stamp,pending:{path,body:{requestKey:UUID,input}}}` is written to sessionStorage, keyed by stamp. If that write fails, nothing is sent and the screen is blocked. A definite outcome (HTTP <500, or 401/403) clears the stored request. An indefinite outcome (≥500 or network error) keeps it and shows a "同じ…要求を照合" button that replays the same requestKey. While a request is pending, all mutations on the screen are disabled. There is never an automatic retry.
- **Session invalidation.** HTTP 401/403, or a body with `error==='SESSION_CHANGED'`, calls `invalidateStaffView()`, which fires the window event `zao-auth-ended`. SSB then shows "セッションを確認してください". Exceptions:
  - NotificationWorkspace, OpsWorkspace, LaunchGateView and StaffManagement show a generic error instead.
  - HoldWorkspace treats any non-ok response on its mount reads as a session invalidation.
- **Generation and ticket counters** drop stale responses: StaffHome manifest, Custody, Wear, Hold, Quote, Transfer, Recommendation, Content and Ledger `selection`.
- **Every mutating request carries the header `x-zao-session: <stamp>`.** StaffManagement's list GET does not send it.
- **Hard-coded API literals** (keep exactly): Wear `reason` strings `'SYNTHETIC …'`; Inventory `sheet:'stock'`; Quote `operation:'initializePrivate'`; Price `operation:'createDraft'|'editDraft'|'activate'`; Transfer datetime suffix `':00+09:00'`; Custody QR prefix `zao-rental:reservation:`.

## 3. Irreversible / dangerous actions and current confirmation

No control uses `window.confirm` or a modal dialog. Confirmation today comes only from the following, and the redesign must keep or strengthen these. Removing any of them changes behaviour.
- (a) disabled-until-precondition gates: a required reason, a required checkbox, or a required selection;
- (b) two-step prepare → commit flows bound by version or hash;
- (c) server state guards that show a button only in a specific state;
- (d) idempotent requestKey and replay;
- (e) permission gating.

| # | action (label) | component:line | API | permission | current confirmation / guard |
|---|---|---|---|---|---|
| 1 | 例外返金を依頼する (refund request) | Amend:30 | POST /api/operations/refund | REFUND_OVERRIDE | Needs a payment selection, a reason (shared input L22), an amount (1–100000000) and a category. The fieldset is disabled while any financial alert exists ("要照合…新しい返金依頼を止めています"). The scheduled job sends the refund once and never resends automatically. No dialog. |
| 2 | この見積で変更を確定 (amendment commit) | Amend:28 | POST /api/operations/amendment-accept | (server; the button is outside the canAmend fieldset) | Needs a prior fixed quote (2-step via 変更見積を固定) and a reason. "自動返金 0円" is shown. No dialog. |
| 3 | 変更見積を固定 with reserve buffer | Amend:27 | POST /api/operations/amendment-quote | RENTAL_AMEND (+INVENTORY_BUFFER_OVERRIDE when reserve is used) | Reserve checkbox plus reason. |
| 4 | 仮押さえを取り消す (HOLD cancel) | Hold:65 | POST /api/holds/{id}/cancel | HOLD_EDIT | Shown only for a selected hold. No dialog. |
| 5 | 期限を確認 (may expire HOLD) | Hold:69 | POST /api/holds/{id}/expire | HOLD_EDIT | None. |
| 6 | グループを仮押さえ / 条件を一括変更 with reserve | Hold:65 | POST /api/holds, /api/holds/{id}/amend | HOLD_EDIT (+override, which needs a reason) | Reserve reason required. |
| 7 | 発送前計画を取り消す (transfer cancel) | Transfer:37 | POST /api/transfers/{id}/cancel | TRANSFER_PLAN | Enabled only in state PLANNED. No dialog. |
| 8 | 計画の全品を実発送 (dispatch) | Transfer:37 | POST /{id}/dispatch | TRANSFER_DISPATCH + source store | Requires PLANNED state and no open issue. No dialog. |
| 9 | 選択分を実受領 / 選択分の準備完了 / ポール数量を実受領 / ポール数量の準備完了 | Transfer:36-37 | POST /{id}/receive, /{id}/ready | TRANSFER_RECEIVE + destination store | Checkbox selection or a pair count. |
| 10 | 要対応を記録 (transfer issue; blocks dispatch) | Transfer:37 | POST /{id}/issue | no client check | None; the reason may be empty on the client. |
| 11 | 未受取のまま契約終了を照合 (no-pickup contract close) | Custody:40 | POST /api/custody/complete-no-pickup | RENTAL_CHECKOUT | Shown only when pickupTiming is RETURN_DUE_PASSED, there are no loans and noPickup is unset. No dialog. |
| 12 | 照合した用品を準備固定 / 道具の貸出を記録 (prepare / checkout) | Custody:41-42 | POST /prepare, /checkout | RENTAL_CHECKOUT | Prepare needs the verification checkbox "表示された個体と数量を照合した" and fit evidence. Checkout is shown only after preparation. Both carry optimistic version fields. |
| 13 | 正常な候補をまとめて受領確定 (return receipt) | Custody:48 | POST /api/custody/confirm | RENTAL_RETURN | 2-step: scan (candidate) → confirm. Requires ≥1 CANDIDATE. |
| 14 | 検品完了 {id} | Custody:49 | POST /inspection | RENTAL_RETURN | Inspection evidence text required. |
| 15 | Wear: 1着を受領 / 候補の数量をまとめて返却確定 / 洗浄開始 etc. / 実際に発送 / 実際に受領 / 受領分の実READY確認 / 予約不明として受領記録 / 数量一致を確認 / ウェア数量を貸出記録 | Wear:38-43 | POST /api/wear/* | server-decided (page gate is INVENTORY_VIEW only) | Transfer and unresolved operations need a reason. Batch confirm needs ≥1 CANDIDATE. Receive-1, cleaning and checkout have no extra gate. |
| 16 | 差異を確定する (stocktake reconcile) | Inv:28 | POST /api/operations/stocktake-reconcile | INVENTORY_RECONCILE | State must be REVIEW_REQUIRED, reason required, 2-step observe → reconcile. |
| 17 | 検証済みの在庫を投入 (CSV import commit) | Inv:31 | POST /api/operations/import-commit | INVENTORY_EDIT | 2-step dry-run (`stage.ready`) → commit bound by `stageSha256`. Reason required. |
| 18 | 表示した料金版を確定・適用する (price activate / publish) | Price:16 | POST /api/quotes/manage activate | ADMIN+ALL+PRICE_EDIT (page) | Needs a draft revision, an effective datetime (device timezone) and a reason. predecessorId comes from the catalog. No dialog. |
| 19 | 選択した料金版からdraftを作る / draftを更新する | Price:14,16 | POST /api/quotes/manage | same | Reason required. |
| 20 | 開発用の初期料金を設定 | Quote:41 | POST /api/quotes/private-initialize | canConfigure | Shown only when no price books exist. No client validation. |
| 21 | 有効な下書きを反映 / 非公開releaseへ反映 / このreleaseから復元案を検証 (content publish to private release / restore) | Content:21 | POST /api/content/bulk-commit, /release-commit, /release-prepare | page: authorized only | 2-step prepare → commit with `hash`. A RELEASE commit is disabled while issues exist. |
| 22 | 再送を依頼 (customer notification resend) | Notif:11 | POST /api/operations/notification-resend | NOTIFICATION_RESEND | Enabled only for SENT, or PERMANENT_FAILURE with RETRY_EXHAUSTED. The requestKey is memoized per intent. Server returns 429 at the rate limit. |
| 23 | 確認済みにする (exception acknowledge; record only) | Ops:58 | POST /api/operations/exception-acknowledge | OPERATIONS_ACKNOWLEDGE | Reason select; memoized key. |
| 24 | スタッフ設定を保存: create account / role change / scope ALL / per-permission 剥奪 (deny) / unchecking 有効 (deactivate = revocation) | StaffMgmt:12-17 | POST/PATCH /api/staff-users | canManage | Single save. Stale revision gives 409 and conflict mode. The server refuses changes to the user's own permissions. No dialog. |
| 25 | パスワードを変更 (revokes all sessions) | PasswordChange:6 | POST /api/auth/change-password | authorized | Requires the current password. |
| 26 | ログアウトする / ログアウト | StaffLogout:6, StaffLedger:8 | POST /api/auth/sign-out | — | Broadcasts to all tabs. |
| 27 | 全員分をHOLDして見積を保存 (group HOLD + quote) | Rec:51 | POST /api/recommendations/{id}/select | HOLD_EDIT && QUOTE_CREATE | Requires the acceptance checkbox and a direction for every member. |
| 28 | 合成予約情報を保存 / テストアダプタへ照合要求 / 既存の決済結果を照合 | Booking:25,27 | POST /api/bookings, /{id}/payment, /{id}/reconcile | BOOKING_CREATE and mode ISOLATED_TEST | Synthetic-data checkbox; mode gate. |
| 29 | 公開準備状況 (launch) | Launch | GET only | OPERATIONS_VIEW | Read-only by design ("ここから本番接続・デプロイ・決済・秘密情報の入力はできません。"). |

## 4. className usage and inline styles

**No component reads a className from JS.** There are no uses of `querySelector`, `classList`, `getElementById`, `closest`, `dataset` or `data-*` anywhere in the audited files, so every className is visual-only. The one exception is a functional CSS contract: the print rule in `operations.css`, `@media print{body>*{visibility:hidden}.asset-labels,.asset-labels *{visibility:visible}.asset-labels{position:absolute;left:0;top:0}.asset-label{margin:4mm}}`.
- Label printing depends on the `asset-labels` and `asset-label` classes.
- Because operations.css is imported by AmendmentWorkspace, InventoryOperationsWorkspace, PriceAdminWorkspace and AssetLabelSheet (Ledger), printing any of those routes outputs only `.asset-labels`, which means a blank page outside the ledger.

CSS selectors that depend on attributes (not on class) — keep the attributes:
- `.ledger-tabs button[aria-current]`
- `.candidate-grid button[aria-pressed=true]`
- `.holds select[multiple]`
- `.recommendation input[type=checkbox]`
- `.staff-state [role=status]`, `.staff-home [role=status]`, `.holds [role=status]`
- `.staff-management button:disabled`, `.staff-login button:disabled`, `.ledger-shell button:disabled`, `.staff-card .staff-card-primary:disabled`

**Global selectors.** HEAD `app/globals.css`:
- Element rules: `:root` (font, color #111, bg #fff), `*` (box-sizing), `body{margin:0}`, `main{max-width:960px;margin:0 auto;padding:80px 28px 32px}`, `h1` (clamp 32–60px), `section{border:1px solid #d9d9d9;padding:28px;margin:36px 0}`, `h2{font-size:20px}`, `p{line-height:1.8}`, `nav{display:flex;gap:12px;flex-wrap:wrap}`, `a{display:inline-block;padding:12px 18px;border:1px solid #000;…}` with `a:hover` and `a:focus-visible{outline:3px solid #af642c}`, `footer`, and `@media(max-width:480px)` for main and section.
- Class rules: `.eyebrow`, `.intro`, `.badge`, `.staff-toolbar` (+ button, a), `.staff-login` (+ label, input, form, button, button:disabled), `.staff-management-form` (+ label, input, select, fieldset, fieldset label), `.staff-cards` (+ li), `.staff-page-head`, `.staff-management`, `.staff-account` (+ h1), `.staff-management button`.
- The global `a{border;padding;display:inline-block}` makes every staff nav link look like a button. Inline text links inherit that too, for example "予約情報・決済結果へ" and the links in the SSB ended view.

Other CSS files:
- `public.css` has one unscoped selector, `details.public-secondary`, which does not match staff markup.
- `guest.css`, `avatar.css`, `holds.css`, `recommendation.css`, `staff-home.css` and `ledger.css` are entirely class-scoped.

classNames per component (V = visual-only; "no rule" = no CSS rule exists for the class in any CSS file):

| component | className (line) | notes |
|---|---|---|
| StaffHome | `holds staff-home` (137, main), `staff-home-header` 137, `staff-secondary` 137/144/158, `staff-context` 138, `staff-context-date` 140, `staff-manifest` 143 (no rule), `staff-section-head` 143/150, `staff-state staff-state--{error,loading,ready,empty}` 145 (computed; rules exist only for `--loading` and `--error`), `staff-card-grid` 146/159, `staff-empty` 146/159, `staff-more` 147, `staff-card` 118/128/159, `staff-card-head` 119/129/159, `staff-chip` 119/159, `staff-chip staff-chip--muted` 129, `staff-card-action` 122/131, `staff-card-attention` 123, `staff-card-primary` 124/159, `staff-secondary-links` 163 (details) | V; holds.css also applies through `.holds` |
| BookingSearchInput | `staff-search` 21 (no rule), `staff-actions` 23 (staff-home.css) | inline style L22 `<video style={{width:'100%',maxWidth:480,maxHeight:360}}>` |
| AssetQrInput | none | inline styles: L24 video `{width:'100%',maxWidth:480,maxHeight:360}`; L25 div `{display:'flex',flexWrap:'wrap',gap:8,minHeight:44}`; L25 two buttons `{minHeight:44,minWidth:44}`; L26 input `{display:'block',minHeight:44,maxWidth:'100%',boxSizing:'border-box'}`; L26 button `{minHeight:44,minWidth:44}` (44 px touch targets) |
| StaffLogin | `staff-login` 12 (section) | globals |
| PasswordChange | `staff-login` 6 (form) | globals |
| login page | `staff-account` (main) | globals |
| StaffLedger | `staff-toolbar` 9 | globals |
| LedgerWorkspace | `ledger-shell` 34, `ledger-header` 35, `ledger-kicker` 35/55, `ledger-lead` 35, `ledger-pill` 35/55, `ledger-notice` 36, `ledger-tabs` 37, `ledger-workspace` 38, `ledger-list` 39, `ledger-section-head` 40/74, `ledger-primary` 40/55/93, `ledger-filters` 41, `ledger-error` 49/93, `ledger-table-wrap` 51, `ledger-status` 51, `ledger-empty` 52, `ledger-page` 53, `ledger-detail` 55, `ledger-id` 55, `ledger-components` 55, `ledger-history` 55, `ledger-footnote` 55/93, `ledger-rule` 55, `ledger-footer` 56, `ledger-form` 74, `ledger-form-grid` 74 | V; ledger.css has the mobile table→card layout at ≤600px (`thead` visually hidden with clip-path) |
| AssetLabelSheet | `asset-label` 5, `asset-labels` 6 | **print-functional** |
| CustodyWorkspace | `holds` 38 | V |
| BookingWorkspace | `holds` 23 | V |
| WearWorkspace | `holds` 35 | V |
| AmendmentWorkspace | `holds operations` 19 | V |
| HoldWorkspace | `holds` 56, `hold-grid` 58/59, `hold-actions` 65 | inline L67 `<div style={{overflowX:'auto'}}>` (capacity table) |
| QuoteWorkspace | `holds` 39, `hold-grid` 42 | V |
| TransferWorkspace | `holds` 29, `hold-grid` 31, `hold-actions` 37 | V |
| StaffManagement | `staff-management` 13, `staff-page-head` 13, `staff-management-form` 14, `staff-cards` 18 | globals |
| ContentWorkspace | `holds` 20 | V |
| ContentPhotoWorkspace | none | inline L19 drop zone `{border:'1px dashed',padding:16}`; L21 `<Image style={{maxWidth:'100%',objectFit:'contain'}}>` |
| RecommendationWorkspace | `holds recommendation` 40, `hold-grid` 42/43, `candidate-grid` 50, `integrated-price` 72, `photo-pending` 72 | V (aria-pressed selector) |
| InventoryOperationsWorkspace | `holds operations` 19 | V |
| PriceAdminWorkspace | `holds operations` 12, `table-scroll` 15 | V |
| NotificationWorkspace | none (bare `<main>`, globals) | inline L11 article `{overflowWrap:'anywhere',borderBottom:'1px solid #bbb',padding:'1rem 0'}` |
| OpsWorkspace | none | inline L49 article (same as Notification) |
| LaunchGateView | none | — |
| StaffLogout, StaffSessionBoundary | none (bare `<main>`) | — |

## 5. Focus management, keyboard and scanner (QR) input

- **Focus.** No `autoFocus`, `tabIndex`, `.focus()`, `scrollIntoView` or `onKey*` handler exists anywhere. All focus behaviour is native. Focus rings come from globals `a:focus-visible` and ledger.css `.ledger-shell button/input/select:focus-visible{outline:3px solid #bc8347}`.
- **SSB unmounts content.** Children are rendered only when `state==='ready'`.
  - Tab hidden (`visibilitychange`), `pagehide` and BFCache restore all set `checking`, which unmounts the whole workspace. Focus and in-memory form state are lost; only sessionStorage pending requests survive.
  - This is a deliberate security property ("hide stale staff data"). Do not keep content rendered behind an overlay.
  - The checking text is `<p role="status">セッションを確認中…</p>`.
- **Enter key.** Only these submit on Enter: `<form>` in StaffLogin, PasswordChange, LedgerForm and StaffManagement. Every workspace input sits outside a `<form>`, so pressing Enter in it does nothing. That includes BookingSearchInput's manual input, AssetQrInput's manual ID, Custody's booking ID, Hold/Quote/etc.
  - A HID (keyboard-wedge) scanner that types into these fields followed by Enter will not trigger the action; the staff member must click the button.
  - If the redesign wraps these in `<form>`s, Enter would start submitting and, through `<button>`'s default `type=submit`, could fire the first button. Treat that as a behaviour change.
- **Native widgets.** `<details><summary>その他の管理機能` (StaffHome:163); `<select multiple>` (Hold:61) uses Ctrl/Cmd-click; date, datetime-local and file inputs. Ledger tabs are plain buttons with `aria-current="page"`, not the ARIA tabs pattern.
- **Camera QR (BookingSearchInput and AssetQrInput).**
  - `getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false})`. The `<video muted playsInline hidden={!running}>` uses aria-label "予約QRカメラ" (booking) or "用品QRカメラ" (asset). A hidden `<canvas>` is used for decoding.
  - Decoding runs in a rAF loop throttled to ≥150 ms, downscales frames to ≤640 px wide, uses `getContext('2d',{willReadFrequently:true})` and jsQR.
  - Duplicate suppression: the last decoded payload in `last` is not emitted twice. `last` is reset on start and stop.
  - A generation counter cancels stale streams. The stream is stopped and its tracks released on unmount, on `document.hidden`, on stop, and (AssetQr only) when `disabled` becomes true or the `offline` event fires.
  - AssetQr skips decoding while a callback is in flight (`busy` ref), refuses to start or emit when `navigator.onLine` is false, and validates with `assetIdFromQr`. Booking validates with `bookingIdFromInput`.
  - BookingSearch calls `onBooking`, which runs StaffHome `openBooking`, which does `router.push('/staff/rentals?booking=')` with a 4 s `opening` guard.
  - Custody accepts a preset `?booking` only when `canCheckout && bookingIdFromInput(preset)`. It auto-loads on mount and strips the manual prefix `zao-rental:reservation:`.
  - Camera pixels never leave the browser (comment AssetQr:5–6).
- **Live regions.**
  - `role="status"`: StaffHome 145/157 and others; Custody 50; Booking 24/28; AssetQr 26; BookingSearch 25; Wear 43; Amend 19; Hold 69; Quote 46; Transfer 33; Content 21 (aria-label "説明処理状態"); Photo 19 (aria-label "写真処理状態"); Rec 57; Inv 20; Price 12; Notif 11; Ops 47; Launch 19; SSB 22.
  - `role="alert"`: StaffLogin, StaffLogout, PasswordChange, StaffMgmt, Ledger errors 49/93, Wear 37, Amend 30, Hold 69, Transfer 35.
  - `aria-busy`: StaffHome manifest section 143 and the さらに読み込む button 147.
- **Accessible names to keep:**
  - aria-labels "対象店舗", "受領店舗", "予約QR・検索", "用品QR入力", "連続返却バッチ", "貸出用品", "台帳の種類", "台帳詳細", "詳細：…", "登録フォーム"/"更新フォーム", "スタッフ作成"/"スタッフ更新", "スタッフを編集：…", "Role", "店舗範囲".
  - The 20 permission-select aria-labels.
  - "{n}人目 {family}", "受取店舗", "返却店舗"/"返却予定店舗", "利用区分", "商品 {n}", "{family}のサイズ {n}", "競技 {n}" etc., "移動明細 {id}", "元店舗", "移動先", "対象用品", "範囲", "種別", "重大度", "状態", "経過時間", "確認理由", "現場確認ID", "通知一覧", "例外一覧", "稼働状況", "絞り込み", "HOLD詳細", "施設全体の在庫枠", "見積詳細", "移動詳細", "ポール数量明細", "推薦候補", "保存結果", "利用者 {n} の候補", "ウェア数量", "保存した返却候補", "ウェア貸出 …", "返却受領 …", "数量移動 …", "予約不明の隔離記録", "隔離受領 …", "現在の下書き", "メーカー資料fixture", "写真一括fixture", "本日の業務", "本日の予約", "店舗・営業日", "運用の注意事項".
  - Tests or E2E checks may use these as locators; the repo's tests were not checked.
- **Autocomplete attributes:** `username`, `current-password`, `new-password` and `off` (StaffLogin, PasswordChange, StaffManagement).

## 6. Raw internal strings displayed to staff (unmapped enums, codes and IDs)

- **StaffHome:** none by design. Everything goes through mapping tables with safe fallbacks (STATE_LABEL, ACTION_LABEL, TASK_ACTION_LABEL, SLOT_LABEL, FAMILY_LABEL, AGE_LABEL, SEVERITY_LABEL). Remaining raw values: `row.size`, the ISO business date, and `loadErrorText` passing through non-ENUM error messages.
- **Custody:** `view.noPickup.outcome` or `view.pickupTiming` (e.g. RETURN_DUE_PASSED); `requirement_key`; `bsl_status` (only via its text); loan `l.state`; candidate `c.state` / `c.outcome`; booking/batch/loan IDs; error codes in the status line ("拒否：{CODE}" and raw `e.message` on load).
- **BookingWorkspace:** `view.state` (DRAFT/CONFIRMED_DEV/…); `period.slot`; payment `p.state` / `p.provider_state`; `priceBookId`; `priceSha256`; `expiresAt` (raw); list `b.state`; "拒否：{CODE}".
- **Wear:** pool `p.age` and the "READY" text; pool option text `{family} {size} {age}`; `bookingInfo.state`; `member_key`; `requirement_key`; `l.age`; receipt `r.state` (RETURNED_PENDING/CLEANING/…); batch `i.state` / `i.error`; transfer `t.state`, `scheduled_at`; unresolved `family` / `age` / `reason` / `received_at`; `variants` option `{family} {size} {age}`; raw error messages (L32, 38, 41, 43); "拒否：{CODE}".
- **Amendment:** `item.family` used as the select label; `m.product` (non-SET); charge and refund `state`; alert `a.code`; payment IDs; `quote.expiresAt`; op messages "操作を拒否しました：{CODE}" or a raw load error code.
- **Hold:** options SKI_SET/SNOWBOARD_SET/SINGLE, ADULT/KIDS, REGULAR/PREMIUM; `selected.state`, `paymentState`, `period.slot`; history `h.event`; list `state` / `slot`; capacity `c.day` and `c.supply` (ID fallback); unknown `result.result` passes through raw.
- **Quote:** book `state`, `rental_from` / `rental_until`; `validity`; snapshot `period.slot`, `memberKey`, `productKey`, `duration`, `priceBookId`; `productLabel` falls back to the raw value; "処理を拒否しました：{CODE}".
- **Transfer:** batch `state`; piece `state` (CLOSED is annotated); `issue` (raw); `transfer_attention` (raw); IDs.
- **StaffManagement:** Role options ADMIN/MANAGER/STAFF/VIEWER; card `s.role`; email.
- **Content / Photo:** plan `kind` (BULK/RELEASE); issue `code`; draft `locale` / `offerCode`; source `sport` and issues; "拒否：{CODE}"; job `state`; item `state`; `candidate.role`; `issues`; `error`.
- **Recommendation:** `rule_version`; `o.reason` (except TRANSFER_PLAN_REQUIRED); `o.priceError`; member `tier` (REGULAR/PREMIUM, L50); `selection.stage` / `outcome`; `hold.state`; `hold.expiresAt`; `quote.validity`; `priceBookId`; `period.slot`; "拒否されました：{CODE}".
- **Inventory:** stocktake `state`, `revision`; `q.kind`; unresolved `codes`; op raw error codes.
- **PriceAdmin:** book `state`; product keys; duration keys (DAY_1, …); change `product` / `duration`.
- **Notification:** `eventType`, `status`, `lastSafeFailureCode`, `createdAt` / `nextAttemptAt` (ISO).
- **Ops:** `eventType`; `severity`; the TYPES and severity option text; health component names and values (incl. "UNAVAILABLE"); `resolutionReason` (TRIAGED/…); `correlationId`; ISO times; `storeDisplayName('SYSTEM')` output.
- **Launch:** `r.row` / `r.state` when not in the LABEL / STATE maps.
- **Ledger:** `label()` falls back to the raw value; the tier filter options REGULAR/PREMIUM are raw text; English kickers "ZAO RENTAL / INVENTORY REGISTER", "REGISTER DETAIL", "ONE RECORD, ONE TOOL"; history `h.reason`.

## 7. Findings noted in passing (do not "fix" during a visual redesign without a decision)

- BookingWorkspace:27 links to `/staff/rental` (singular) in ISOLATED_TEST mode. No such route exists; `/staff/rentals` does.
- StaffManagement:17: REFUND_OVERRIDE has visible label "返金（STAFF以上は標準で可）" but aria-label "例外返金依頼（明示付与）".
- `/staff/content` has no page-level permission gate. Only `authorized` is checked.
- StaffLedger toolbar and the Custody, Quote and Recommendation headers show links regardless of permission. Only "スタッフ管理" is gated in StaffLedger; Quote shows it ungated.
- StaffManagement's list GET omits `x-zao-session`.
- The operations.css print rule blanks printouts of Amendment, Inventory and Price pages.
- Wear's replay button is not disabled when `storageBlocked`, unlike the other workspaces.
