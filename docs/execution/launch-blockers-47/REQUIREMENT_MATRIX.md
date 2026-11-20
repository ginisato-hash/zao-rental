# Issue #47 / PR #73 要件マトリクス（2026-11-20 JST、新担当C作成）

各行は、要件 → 実装の所在 → 検証 → 状態（層別）。状態の凡例：**PASS** / **FAIL** / **NOT_RUN** / **PENDING**（未判定）/ **BLOCKED**（本人操作待ち）。
- `SOURCE_IMPL`：実装済み
- `LOCAL_TEST`：この端末での合成PG・ブラウザ試験
- `NATURAL_CI`：GitHub Foundation（push後の最新exact SHA）
- `INDEPENDENT_TD`：ChatGPT TDの独立レビュー
- `PRODUCTION`：本番適用・公開
- `REAL_PROVIDER`：実Square・実メール

「LOCAL_TEST PASS」は、この端末の合成データでの結果に限る。NATURAL_CI 以降は、最終候補SHAの結果で更新する（本書作成時点で未push分があるため PENDING）。

| ID | 要件 | 実装の所在 | 主な検証 | SOURCE_IMPL | LOCAL_TEST | NATURAL_CI | INDEPENDENT_TD | PRODUCTION | REAL_PROVIDER |
|---|---|---|---|---|---|---|---|---|---|
| R1 | SKI/SNOWBOARD Regularは「モデル指定なし」 | `PublicPage.tsx` lineup | `test:public-ui`, public all-routes | PASS | PASS | PENDING | PENDING | NOT_RUN | — |
| R2 | 税込表示（全公開価格の直後に注記） | `PublicPage.tsx`（TAX-01）, `PriceExplorer.tsx` | `tests/public/all-routes-ui.ts`（64頁で全¥価格を検査） | PASS | PASS | PENDING | PENDING | NOT_RUN | — |
| R3 | 店舗地図の操作 | `station-map/StationMap.tsx`（MAP-01：画像のnative drag抑止） | `tests/public/map-ui.ts` 8件（ボタン/ホイール/ドラッグ/キー/上限/hash/1本指スクロール/2本指ピンチ） | PASS | PASS | PENDING | PENDING | NOT_RUN | — |
| R4 | 規約V2・購入前同意・版hash・acceptedAt | 0059/0061, `GuestBooking`, `booking-service.ts` | `test:staff-order`（再同意を含む）, `test:public-guest` | PASS | PASS | PENDING | PENDING | NOT_RUN（delta未適用） | NOT_RUN |
| R5 | 規約V2と2025/26原本の差分 | `TERMS_V2_VS_2025_26.md` | 文書（原本はOwnerのDriveから読取） | PASS | — | — | PENDING | — | — |
| R6 | 新規予約の管理者通知（永続受信箱・opt-inメール） | 0060, `staff-inbox.ts`, `StaffInboxBell` | `test:notification`, BROWSER-01/BELL-RACE | PASS | PASS | PENDING | PENDING | NOT_RUN | NOT_RUN（実メール未送信） |
| R7 | 管理画面のJA/EN | `staff-i18n`, 全staff画面 | `tests/staff/all-routes-ui.ts`（132頁）, `console-unity-ui.ts`（300頁） | PASS | PASS | PENDING | PENDING | NOT_RUN | — |
| R8 | Booqable型の業務導線 | Dashboard/Orders/New order/Customers/Inventory/Calendar/Documents/Reports/Scan/Settings | `BOOQABLE_APPLE_REFERENCE.md`, `test:staff-shell-ui`, `test:staff-acceptance-ui` | PASS | PASS | PENDING | PENDING | NOT_RUN | — |
| R9 | 全staff/admin UIの抜本統一（Apple系の視覚言語） | `staff-console.css`（旧画面＋台帳＋New order）, `staff-login.css` | `tests/staff/console-unity-ui.ts`：30ルート×JA/EN×1440/800/720(200%)/390、ダーク(1440/390)で300頁。見出しサイズ、2px以上の濃色罫、ボタン形状、入力枠、WCAGコントラスト、ポスター文字、主ボタン青、横スクロール、コンソールエラー、外部通信 | PASS | PASS（300/300） | PENDING | PENDING | NOT_RUN | — |
| R10 | 公式SALOMONロゴ（staff/adminシェル、ログイン、印刷） | `StaffShell.tsx`, `app/staff/login/page.tsx`, `StaffDocuments.tsx`。素材は既存の承認済み派生 `brand/logo-stacked-black.webp`（sha256 `d5b7dad0…dd4ac`）のみ。ダーク時は同ファイルを反転表示 | console-unity-ui のスクリーンショット | PASS | PASS | PENDING | PENDING | NOT_RUN | — |
| R11 | 管理者によるスタッフアカウント作成 | `StaffManagement.tsx`（確認欄、詳細権限の折りたたみ、強い権限・ADMIN・全店舗の付与確認、二重送信防止）。API/Argon2id/認可は既存のまま | `tests/staff/accounts-ui.ts`、既存のフォーム試験7本 | PASS | 実行中 | PENDING | PENDING | NOT_RUN | — |
| R12 | 各スタッフの本人パスワード変更 | `PasswordChange.tsx`（確認欄、文言の区別、入力保持、エラーへのフォーカス）。APIは既存 | `tests/staff/accounts-ui.ts`（旧セッション失効、旧パスワード拒否、新パスワードでログイン、閲覧担当もEN/390/キーボードで変更可） | PASS | 実行中 | PENDING | PENDING | NOT_RUN | — |
| R13 | ログイン後の入口（Dashboard、権限別） | `app/staff/page.tsx`, `StaffLogin`（UX-01） | 33試験のログイン待機を更新、`test:auth` | PASS | 実行中 | PENDING | PENDING | NOT_RUN | — |
| R14 | Orders/Customers/Inventory/Reports CSV | Reports CSV（REP-02/CSV-SAFE/CSV-UX）、他画面のCSV（旧B実装） | `test:staff-acceptance-ui`, `test:reports` | PASS | PASS（前回実行） | PENDING | PENDING | NOT_RUN | — |
| R15 | Dashboardの印刷は全件の作業リストのみ | `workList()`, `StaffDocuments`（DASH-PRINT-01） | `test:orders`, `test:staff-acceptance-ui` | PASS | PASS | PENDING | PENDING | NOT_RUN | — |
| R16 | 認可の縮小・失効に対するfail-closed | CAL-01/SNAP-01（`OperationsContext.snapshot` + `confirmScope`） | calendar/orders/customers/reports の実PG競合試験（mutationで旧コードの漏えいを確認済み） | PASS | PASS | PENDING | PENDING | NOT_RUN | — |
| R17 | ゲスト終了／スタッフ再開の確実な離脱 | `GuestBooking`（AVATAR-EXIT-01：受理後のみ離脱、警告抑止、旧draft再表示なし、停止時は同じ行き先へ再遷移しPOSTは再送しない） | `test:avatar`×3、`guest-exit-ui` 5件、TEST-TRACE-01のlistener登録 | PASS | PASS（avatar 3/3、flow-ui、public-ui） | PENDING（`8fe8888`はFAIL） | PENDING | NOT_RUN | — |
| R18 | 本番delta 0059〜0061とgrants | `production-staff-delta.ts`（DELTA-01）, operator | `production-0057-owner-apply`、restore drill、role plans | PASS | PASS | PENDING | PENDING | BLOCKED（Owner本人のNeonログイン/MFAが必要） | — |
| R19 | New orderのSquare決済（顧客本人がiframeに入力） | `SquareCardPayment`, staff-orders API | `test:staff-order`（gatewayは合成のtest double） | PASS | PASS | PENDING | PENDING | NOT_RUN | BLOCKED（実Squareは本番gate） |

## 未実施（NOT_RUN）
- `test:controller:macos`：このMacに `codex` CLIが無い。Linux CIでは対象外。
- 本番：backup → delta/grants → readback → 同一artifactでstage → promote。Owner本人の認証・MFAが必要。
- 実Square決済、実メール送信：既存の承認範囲と本番gateに従う。
