# Issue #47 / PR #73 要件マトリクス（2026-11-20 JST、新担当C作成）

各行は、要件 → 実装の所在 → 検証 → 状態（層別）。状態の凡例：**PASS** / **FAIL** / **NOT_RUN** / **PENDING**（未判定）/ **BLOCKED**（本人操作待ち）。
- `SOURCE_IMPL`：実装済み
- `LOCAL_TEST`：この端末での合成PG・ブラウザ試験
- `NATURAL_CI`：GitHub Foundation（push後の最新exact SHA）
- `INDEPENDENT_TD`：ChatGPT TDの独立レビュー
- `PRODUCTION`：本番適用・公開
- `REAL_PROVIDER`：実Square・実メール

「LOCAL_TEST PASS」は、この端末の合成データでの結果に限る。

**NATURAL_CI の現在値（2026-11-21 後任D更新）**：`c7d4fed`（tree `ea02b8e`）の自然Foundation [#44764308823](https://github.com/ginisato-hash/zao-rental/actions/runs/44764308823) は **FAILURE**。実行された72件のうち71件がexit 0で、失敗は `test:avatar` の1件だけ。`verify.mjs` のLinux側91件のうち、`test:avatar` より後の19件（`test:m2b-bootstrap`、`test:notification`、operations系、m2a/m2b、production-runtime、e2e等）は **NOT_RUN**。下表の「exit0（c7d4fed）」は、そのコマンドがこのrunでexit 0だったことだけを示し、required CI全体の成功ではない。最終候補SHAの自然CIで改めて更新する。

| ID | 要件 | 実装の所在 | 主な検証 | SOURCE_IMPL | LOCAL_TEST | NATURAL_CI | INDEPENDENT_TD | PRODUCTION | REAL_PROVIDER |
|---|---|---|---|---|---|---|---|---|---|
| R1 | SKI/SNOWBOARD Regularは「モデル指定なし」 | `PublicPage.tsx` lineup | `test:public-ui`, public all-routes | PASS | PASS | exit0（c7d4fed：public-ui） | PENDING | NOT_RUN | — |
| R2 | 税込表示（全公開価格の直後に注記） | `PublicPage.tsx`（TAX-01）, `PriceExplorer.tsx` | `tests/public/all-routes-ui.ts`（64頁で全¥価格を検査） | PASS | PASS | exit0（c7d4fed：public-all-routes-ui） | PENDING | NOT_RUN | — |
| R3 | 店舗地図の操作 | `station-map/StationMap.tsx`（MAP-01：画像のnative drag抑止） | `tests/public/map-ui.ts` 8件（ボタン/ホイール/ドラッグ/キー/上限/hash/1本指スクロール/2本指ピンチ） | PASS | PASS | exit0（c7d4fed：public-map-ui） | PENDING | NOT_RUN | — |
| R4 | 規約V2・購入前同意・版hash・acceptedAt | 0059/0061, `GuestBooking`, `booking-service.ts` | `test:staff-order`（再同意を含む）, `test:public-guest` | PASS | PASS | exit0（c7d4fed：staff-order、public-guest） | PENDING | NOT_RUN（delta未適用） | NOT_RUN |
| R5 | 規約V2と2025/26原本の差分 | `TERMS_V2_VS_2025_26.md` | 文書（原本はOwnerのDriveから読取） | PASS | — | — | PENDING | — | — |
| R6 | 新規予約の管理者通知（永続受信箱・opt-inメール） | 0060, `staff-inbox.ts`, `StaffInboxBell` | `test:notification`, BROWSER-01/BELL-RACE | PASS | PASS | 一部（acceptance-ui exit0／`test:notification` NOT_RUN） | PENDING | NOT_RUN | NOT_RUN（実メール未送信） |
| R7 | 管理画面のJA/EN | `staff-i18n`, 全staff画面 | `tests/staff/all-routes-ui.ts`（132頁）, `console-unity-ui.ts`（310表示） | PASS | PASS | exit0（c7d4fed：staff-all-routes-ui、staff-console-unity-ui） | PENDING | NOT_RUN | — |
| R8 | Booqable型の業務導線 | Dashboard/Orders/New order/Customers/Inventory/Calendar/Documents/Reports/Scan/Settings | `BOOQABLE_APPLE_REFERENCE.md`, `test:staff-shell-ui`, `test:staff-acceptance-ui` | PASS | PASS | exit0（c7d4fed：staff-shell-ui、staff-acceptance-ui） | PENDING | NOT_RUN | — |
| R9 | 全staff/admin UIの抜本統一（Apple系の視覚言語） | `staff-console.css`（旧画面＋台帳＋New order）, `staff-login.css` | `tests/staff/console-unity-ui.ts`：31ルート×JA/EN×1440/800/720/390＋ダーク（JA・2幅）＝310表示。720pxは200%相当のレイアウト試験であり、実ブラウザでの200%操作の証拠ではない。見出しサイズ、2px以上の濃色罫、ボタン形状、入力枠、WCAGコントラスト、ポスター文字、主ボタン青、横スクロール、コンソールエラー、外部通信 | PASS | PASS（310/310） | exit0（c7d4fed：staff-console-unity-ui） | PENDING | NOT_RUN | — |
| R10 | 公式SALOMONロゴ（staff/adminシェル、ログイン、印刷） | `StaffShell.tsx`, `app/staff/login/page.tsx`, `StaffDocuments.tsx`。素材は既存の承認済み派生 `brand/logo-stacked-black.webp`（sha256 `d5b7dad0…dd4ac`）のみ。ダーク時は同ファイルを反転表示 | console-unity-ui のスクリーンショット | PASS | PASS | exit0（c7d4fed：staff-console-unity-ui） | PENDING | NOT_RUN | — |
| R11 | 管理者によるスタッフアカウント作成 | `StaffManagement.tsx`（確認欄、詳細権限の折りたたみ、強い権限・ADMIN・全店舗の付与確認、二重送信防止）。API/Argon2id/認可は既存のまま | `tests/staff/accounts-ui.ts`、既存のフォーム試験7本。失敗系（2026-11-21追加）：重複メールは409で画面にエラー・保存0・入力保持、500で保存0、遅い保存の連打で要求1件、別の管理者による更新（`STALE_STAFF_REVISION`）で再読込を促し保存0 | PASS | PASS | exit0（c7d4fed：staff-accounts-ui） | PENDING | NOT_RUN | — |
| R12 | 各スタッフの本人パスワード変更 | `PasswordChange.tsx`（確認欄、文言の区別、入力保持、エラーへのフォーカス、規則表示 `pw-rule`）。APIは既存。**長さの規則はOwner決定（2026-11-21）で6〜128文字**：`packages/auth/src/password-policy.ts` を better-auth（`minPasswordLength`）・`validPassword`・作成画面・変更画面・スタッフQAが共有。作成時の入力スキーマ `staff-input.schema.json` に残っていた15文字の規則も6に修正（試験が画面とサーバの食い違いを検出）し、単体試験でスキーマと共通規則の一致を保証。本人のパスワード変更は500・通信断でも入力を保持し、変更されない | `tests/staff/accounts-ui.ts`（旧セッション失効、旧パスワード拒否、新パスワードでログイン、閲覧担当もEN/390/キーボードで変更可）、6文字で変更でき5文字は送信前に拒否、宙に浮いた `aria-describedby` 0、単体 `staff-security.test.ts`（6文字可・5文字不可・128文字可・129文字不可） | PASS | PASS | exit0（c7d4fed：staff-accounts-ui） | PENDING | NOT_RUN | — |
| R13 | ログイン後の入口（Dashboard、権限別） | `app/staff/page.tsx`, `StaffLogin`（UX-01） | 33試験のログイン待機を更新、`test:auth` | PASS | PASS | exit0（c7d4fed：auth） | PENDING | NOT_RUN | — |
| R14 | Orders/Customers/Inventory/Reports CSV | Reports CSV（REP-02/CSV-SAFE/CSV-UX）、他画面のCSV（旧B実装） | `test:staff-acceptance-ui`, `test:reports` | PASS | PASS（前回実行） | exit0（c7d4fed：staff-acceptance-ui、reports） | PENDING | NOT_RUN | — |
| R15 | Dashboardの印刷は全件の作業リストのみ | `workList()`, `StaffDocuments`（DASH-PRINT-01） | `test:orders`, `test:staff-acceptance-ui` | PASS | PASS | exit0（c7d4fed：orders、staff-acceptance-ui） | PENDING | NOT_RUN | — |
| R16 | 認可の縮小・失効に対するfail-closed | CAL-01/SNAP-01（`OperationsContext.snapshot` + `confirmScope`） | calendar/orders/customers/reports の実PG競合試験（mutationで旧コードの漏えいを確認済み） | PASS | PASS | exit0（c7d4fed：calendar、orders、customers、reports） | PENDING | NOT_RUN | — |
| R17 | ゲスト終了／スタッフ再開の確実な離脱 | `GuestBooking`（AVATAR-EXIT-01：受理後のみ離脱、警告抑止、旧draft再表示なし、停止時は同じ行き先へ再遷移しPOSTは再送しない） | `test:avatar`×3、`guest-exit-ui` 5件、TEST-TRACE-01のlistener登録 | PASS | PASS（avatar 3/3、guest-exit-ui 5/5）。CI失敗の根本原因は2026-11-21に確定（AVATAR-CI-02）：試験用 `next dev` のHMRソケット（Next 16は `/_next/hmr`）がフルreloadを送り、logout中・遷移中のページを読み直していた。CDPの記録で起点が `web-socket.js:handleMessage` と判明。以前の遮断は `/_next/webpack-hmr` だけに一致し無効だった。`tests/flow/dev-hmr.ts` で正しく遮断し、開発モード試験21ファイルに適用。本番にはHMRが無く、製品の不具合ではない | **FAIL**（c7d4fed：`test:avatar`） | PENDING | NOT_RUN | — |
| R18 | 本番delta 0059〜0061とgrants | `production-staff-delta.ts`（DELTA-01）, `production-install-staff-delta.ts`。復元の前提は58本専用の `production-restore-evidence-pre0059.ts`（PR73-RESTORE-01：旧53本用のゲートに結ばれていた不整合を是正） | `test:m2b-bootstrap`（0059〜0061適用）、`test:production-restore-drill`（58本の実復元結果は新検証のみ受理）、`production-restore-evidence-pre0059.test.ts`（migrate/grantsの両方が正しい記録でのみowner接続の手前へ到達） | PASS | PASS | 一部（restore-drill・role-plans exit0／`test:m2b-bootstrap` NOT_RUN） | PENDING | NOT_RUN（Neon本人認証とCLI配置は完了。復元試験・merge・最終レビュー待ち） | — |
| R19 | New orderのSquare決済（顧客本人がiframeに入力） | `SquareCardPayment`, staff-orders API | `test:staff-order`（gatewayは合成のtest double） | PASS | PASS | exit0（c7d4fed：staff-order） | PENDING | NOT_RUN | BLOCKED（実Squareは本番gate） |
| R20 | 画面に謳い文句・説明文を散らさない／説明はスタッフQAに集約 | 全staff/admin画面から説明文を撤去（ブラウザで94件を棚卸し）、`/staff/help`（日英のQ&A、画面別） | `console-unity-ui.ts` が文章状の説明・謳い文句・脚注を検出すると失敗（31ルート・310表示） | PASS | PASS（31ルート・310表示） | exit0（c7d4fed：staff-console-unity-ui） | PENDING | NOT_RUN | — |
| R21 | 本番公開の手順（Owner操作の区別つき） | `RELEASE_RUNBOOK_PR73.md` | 文書 | PASS | — | — | PENDING | 前提整備済み（Neon認証完了・Vercel認証済み）。復元試験の復号はOwnerの工程 | — |
| R22 | macOS専用 `test:controller:macos` | `scripts/verify.mjs`（darwinの場合だけ追加。CIはubuntu-24.04のため対象外） | 同一Macでの実行（`codex` CLIの配置が前提） | — | NOT_RUN（`codex` CLI不在） | 対象外（Linux CIでは実行されない。Linuxの成功をMacのPASSに転記しない） | PENDING（今回の変更への必要性を独立reviewで判定） | — | — |
