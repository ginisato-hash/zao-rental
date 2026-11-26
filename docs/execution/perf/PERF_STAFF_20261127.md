# スタッフ/管理画面 性能計測と改善（2026-11-27）

隔離環境のみで計測（本番へのアクセス・書込なし）。ローカルのビルド済みアプリ（`next start`）＋隔離PostgreSQL＋合成データ（予約24件）＋ローカルChromium。
ハーネス: `scripts/perf/staff-perf.ts`（`--mode full|cold|trace|dims`）、集計: `scripts/perf/summarize.mjs`、比較: `scripts/perf/compare.mjs`。出力JSONは `.local/perf/`（コミットしない）。

## 結論（実測）
1. **サイドバー遷移の約300msの空白を除去**（最大の改善）。`/staff`・`orders`・`customers`・`inventory`・`calendar`・`reports`・`documents`・`sales-stops`・`coupons` の `page.tsx` が子を `<Suspense>`（fallbackなし）で包んでおり、クライアント遷移時に「main が空→300ms後に内容」になっていた（React の Suspense 再表示スロットル約300ms。CPUプロファイルは遷移中ほぼアイドル、DOM タイムラインで URL変更19ms→空のmain→321msで「セッションを確認中…」→340msで内容を確認）。ラッパーを外すと「セッション確認中…」が25msで出て、内容は76msで描画。**StaffSessionBoundary の初回「セッション確認中」表示は維持**（変更していない・ファイル未編集）。
2. **CLS を改善**: /staff/today 0.143→0.0001、/staff/sales-stops 0.064→0.0008、/staff/settings 0.083→0、/staff/coupons 0.043→0（desktop・JA/EN、合成データ）。
3. **orders/users の初回約4秒は再現せず**。原因は断定しない（下記）。
4. **manifest ×2 / inbox ×2 は変更せず**（重複ではないことを確認、下記）。

## 変更内容（最小差分）
- `app/staff/{page,orders,customers,inventory,calendar,reports,documents,sales-stops,coupons}/page.tsx`: 子を包む fallback なし `<Suspense>` を削除（これらのページは `force-dynamic` でビルド・全ルート試験に影響なし）。
- CLS: 最初のAPI回答まで場所を確保。`StaffSalesStops`/`StaffCoupons`（編集カードの有無がAPI回答で決まるため、`aria-hidden` の空カード `sx-reserve`）、`StaffSettings`（メール設定カードに `sx-reserve--email`）、`StaffHome`/`TomorrowPreparation`（読み込み中セクションに `data-pending` と min-height）。高さは実測した読込後の高さ（desktop / 390px）。認可・取得・キャッシュは一切変更していない。
- 追加: `scripts/perf/*`（計測ハーネス）。

## 計測条件
- desktop: 1440x900、CPU等倍。mobile: 390x844、`isMobile`/touch、**CDP `Emulation.setCPUThrottlingRate` 4x**（ネットワークは無制限のローカル）。JA/EN。
- ページ読込: 各ルート/設定でウォームアップ1回＋ desktop-ja 5回・desktop-en 3回・mobile-ja 5回・mobile-en 3回。LCP/CLS は PerformanceObserver（buffered）。Lighthouse の navigation 単独は INP と主張しない。INPそのものは未計測（下記）。
- API p95: 各ページが呼ぶGET APIをそのページ自身の `x-zao-session` ヘッダで **各35回**直列実行（Playwright request、localhost、ウォーム）。
- 操作時間: Node側で「クリック/送信→目的要素が可視」を測定（Playwright往復数msを含む）。**各30回**、desktop CPU等倍と mobile 390px+CPU4x。API完了時刻（最後の `/api/` 完了）は生JSONに記録。
- before = origin/main（0779053）のビルド、after = 本PRのビルド。同一マシン・同一ハーネス・同一手順。

## 主要結果（before → after、p95）
- 画面遷移（サイドバー）desktop: orders 866→186ms、customers 817→103ms、calendar 815→102ms、dashboard 823→99ms（p50 約810→50〜120ms）。mobile 390px+CPU4x: 約1.2s→0.4〜0.6s。
- 検索（inventory、desktop）310→27ms（同じ300ms空白が原因だった）。orders/customers 検索・絞込・詳細表示・手入力スキャンは変化なし（もともと p95 ≤ 270ms）。
- 目標: 画面遷移/検索 p95 ≤1s → desktop/mobile とも達成（最大 mobile 603ms）。read API warm p95 ≤500ms → 全API 25ms以下で達成。
- 変更前は mobile+4x の遷移が p95 約1.2〜1.27s で目標超過だった。


## 呼び出し元の調査結果（変更なし）
- `/staff/today` の `operations/manifest` 2回は **重複ではない**: `section=all`（StaffHome、本日）と `section=preparation`（TomorrowPreparation、明日・RENTAL_CHECKOUT権限・準備プロフィール付き）で、日付・内容・権限が異なる。並列に発行され、warm p50 約5ms。1リクエストへ集約するにはサーバー応答形状と権限分岐の変更が必要で、利得（数ms）に対しリスクが大きいため **変更しない**。共有/長TTLキャッシュも追加していない。
- `/api/operations/inbox`: 全画面で1回（StaffInboxBell、limit=10、30秒ポーリング）。2回になるのは `/staff/notifications` のみ（ページ本体 limit=25＋ベル limit=10 で別クエリ）。ack時の整合を保つため **変更しない**。
- `/api/session` は各画面で1回（StaffSessionBoundary）。#87で親が対応中のため未編集。

## orders/users 初回約4秒の切り分け
- 条件: (1) サーバー起動直後の最初の訪問（その画面を一度も配信していない）、(2) 各回新規 browser context（HTTPキャッシュ空）、(3) 隔離DBでプール未確立の状態＝起動直後。ビルド済みアプリ、CPU等倍、ログイン直後。サーバー+DB再起動を伴う試行を3回（run1〜3）、各回で orders/users ほか5画面を「起動直後の初回1回＋新規context 10回」。
- 結果: orders 初回 responseEnd 7〜14ms、LCP 112〜164ms、新規context10回の LCP 最大160ms。users 初回 responseEnd 8〜10ms、LCP 64〜84ms（最大116ms）。TTFB と responseEnd の差はほぼ0〜6ms。**約4.3秒は再現しなかった**。
- 限界: 本番は Vercel のサーバーレス関数＋リモートDBで、コールドスタート・DB接続確立・ネットワーク経路がローカルと異なる。ローカルでは原因（ネットワーク/SSRストリーミング/JS取得/API連鎖/ブラウザスケジューリング）のどれとも断定できない。ただし今回の局所計測では文書取得（~10ms）、JS、APIはいずれも短く、本番固有（コールドスタート・接続確立）の可能性が高いという推定にとどまる（未検証）。本番での追加計測は禁止のため実施していない。再現した場合はレスポンス `Server-Timing` とリージョン間レイテンシの確認を推奨。

## 画面別 before/after（生データから自動生成）

### 操作時間 desktop-cpu1x（クリック→目的要素の描画完了, ms）

| 操作 | before p50 | before p95 | after p50 | after p95 | p95変化 |
|---|---|---|---|---|---|
| nav: dashboard->orders (sidebar) | 839 | 865.6 | 122.6 | 186.1 | -79% |
| search: orders | 24.8 | 45.3 | 19.9 | 27.5 | -39% |
| filter: orders status checkbox | 40.3 | 55 | 38.4 | 52.1 | -5% |
| open: order detail from list | 59.7 | 69.8 | 58.8 | 74.8 | +7% |
| nav: order detail->customers (sidebar) | 809.8 | 817.1 | 94.3 | 102.8 | -87% |
| search: customers | 18.2 | 25.3 | 13.6 | 18.5 | -27% |
| open: customer detail | 67.4 | 84.2 | 60.5 | 77.7 | -8% |
| nav: ->inventory (sidebar) | 22.5 | 36.6 | 23 | 27.5 | -25% |
| search: inventory | 303.6 | 310.2 | 23.8 | 26.9 | -91% |
| open: inventory detail | 170.2 | 236.8 | 169.2 | 181.5 | -23% |
| nav: ->calendar (sidebar) | 805.2 | 814.9 | 94.1 | 102.3 | -87% |
| nav: ->dashboard (sidebar) | 813 | 823.1 | 48.8 | 98.6 | -88% |
| scan: manual order id -> order | 124.7 | 186.8 | 108.1 | 130.7 | -30% |

### 操作時間 mobile390-cpu4x（クリック→目的要素の描画完了, ms）

| 操作 | before p50 | before p95 | after p50 | after p95 | p95変化 |
|---|---|---|---|---|---|
| nav: dashboard->orders (sidebar) | 1240.9 | 1267 | 554.2 | 602.5 | -52% |
| search: orders | 48.4 | 66.7 | 46.8 | 65 | -3% |
| filter: orders status checkbox | 40.7 | 68.7 | 46.2 | 60.5 | -12% |
| open: order detail from list | 85.4 | 119.9 | 87.1 | 106.7 | -11% |
| nav: order detail->customers (sidebar) | 1183.7 | 1203.4 | 478.1 | 495.1 | -59% |
| search: customers | 32.1 | 40.5 | 31.7 | 39.7 | -2% |
| open: customer detail | 73.5 | 81.8 | 74.5 | 88.9 | +9% |
| nav: ->inventory (sidebar) | 390.5 | 428.1 | 401.6 | 427.2 | -0% |
| search: inventory | 305.3 | 322.1 | 29.8 | 56 | -83% |
| open: inventory detail | 271.3 | 357.2 | 273.1 | 372.4 | +4% |
| nav: ->calendar (sidebar) | 1186.6 | 1206.6 | 480.6 | 509.1 | -58% |
| nav: ->dashboard (sidebar) | 1219.7 | 1273 | 387.2 | 445.8 | -65% |
| scan: manual order id -> order | 201.2 | 268.1 | 198.3 | 228.3 | -15% |

### ページ読込 desktop-ja（LCP ms / CLS最大）

| 画面 | before LCP p50 | after LCP p50 | before CLS max | after CLS max |
|---|---|---|---|---|
| dashboard | 132 | 92 | 0.0028 | 0.0028 |
| today | 184 | 124 | 0.1429 | 0.0001 |
| orders | 232 | 120 | 0.0049 | 0.0049 |
| order-detail | 196 | 96 | 0.0007 | 0.0058 |
| order-new | 104 | 96 | 0.0026 | 0.0026 |
| customers | 140 | 92 | 0.0011 | 0.0011 |
| inventory | 100 | 104 | 0.0011 | 0.0011 |
| inventory-detail | 168 | 132 | 0.0007 | 0.007 |
| sales-stops | 124 | 108 | 0.0639 | 0.0008 |
| users | 88 | 64 | 0 | 0 |
| calendar | 136 | 88 | 0 | 0 |
| reports | 108 | 92 | 0 | 0 |
| scan | 124 | 88 | 0 | 0 |
| notifications | 108 | 92 | 0.0001 | 0.0001 |
| settings | 92 | 88 | 0.0832 | 0 |
| documents | 92 | 92 | 0 | 0 |
| coupons | 96 | 100 | 0.0431 | 0 |
| customer-detail | 112 | 100 | 0.0003 | 0.0021 |

### ページ読込 desktop-en（LCP ms / CLS最大）

| 画面 | before LCP p50 | after LCP p50 | before CLS max | after CLS max |
|---|---|---|---|---|
| dashboard | 88 | 68 | 0.0043 | 0.0043 |
| today | 120 | 96 | 0.1421 | 0.0002 |
| orders | 160 | 112 | 0.0062 | 0.0062 |
| order-detail | 152 | 108 | 0.0007 | 0.0058 |
| order-new | 116 | 96 | 0.0026 | 0.0026 |
| customers | 96 | 64 | 0.0014 | 0.0014 |
| inventory | 124 | 88 | 0.0014 | 0.0014 |
| inventory-detail | 96 | 96 | 0.007 | 0.007 |
| sales-stops | 92 | 96 | 0.0639 | 0.0008 |
| users | 88 | 88 | 0 | 0 |
| calendar | 88 | 64 | 0 | 0 |
| reports | 104 | 88 | 0 | 0 |
| scan | 100 | 88 | 0 | 0 |
| notifications | 116 | 80 | 0 | 0 |
| settings | 92 | 92 | 0.0832 | 0 |
| documents | 84 | 72 | 0 | 0 |
| coupons | 88 | 76 | 0.0426 | 0 |
| customer-detail | 100 | 92 | 0.0021 | 0.0021 |

### ページ読込 mobile390-ja-cpu4x（LCP ms / CLS最大）

| 画面 | before LCP p50 | after LCP p50 | before CLS max | after CLS max |
|---|---|---|---|---|
| dashboard | 324 | 264 | 0 | 0 |
| today | 460 | 420 | 0 | 0 |
| orders | 340 | 272 | 0 | 0 |
| order-detail | 428 | 296 | 0 | 0 |
| order-new | 360 | 288 | 0 | 0 |
| customers | 352 | 300 | 0 | 0 |
| inventory | 296 | 268 | 0 | 0 |
| inventory-detail | 292 | 280 | 0 | 0 |
| sales-stops | 364 | 300 | 0 | 0 |
| users | 268 | 244 | 0 | 0 |
| calendar | 308 | 260 | 0 | 0 |
| reports | 440 | 292 | 0 | 0 |
| scan | 348 | 280 | 0 | 0 |
| notifications | 368 | 300 | 0 | 0 |
| settings | 304 | 264 | 0 | 0 |
| documents | 296 | 260 | 0 | 0 |
| coupons | 364 | 284 | 0 | 0 |
| customer-detail | 316 | 296 | 0 | 0 |

### ページ読込 mobile390-en-cpu4x（LCP ms / CLS最大）

| 画面 | before LCP p50 | after LCP p50 | before CLS max | after CLS max |
|---|---|---|---|---|
| dashboard | 300 | 240 | 0 | 0 |
| today | 304 | 284 | 0 | 0 |
| orders | 288 | 248 | 0 | 0 |
| order-detail | 332 | 288 | 0 | 0 |
| order-new | 316 | 288 | 0 | 0 |
| customers | 328 | 300 | 0 | 0 |
| inventory | 316 | 268 | 0 | 0 |
| inventory-detail | 320 | 264 | 0 | 0 |
| sales-stops | 412 | 288 | 0 | 0 |
| users | 304 | 232 | 0 | 0 |
| calendar | 344 | 256 | 0 | 0 |
| reports | 336 | 240 | 0 | 0 |
| scan | 312 | 272 | 0 | 0 |
| notifications | 320 | 280 | 0 | 0 |
| settings | 280 | 252 | 0 | 0 |
| documents | 332 | 256 | 0 | 0 |
| coupons | 320 | 264 | 0 | 0 |
| customer-detail | 336 | 308 | 0 | 0 |

### API warm（ms, 各35回, 同一セッション・直列）

| API | before p50 | before p95 | after p50 | after p95 |
|---|---|---|---|---|
| /api/operations/inbox?limit&openOnly&stores | 3.2 | 4.3 | 2.9 | 3.3 |
| /api/session | 2 | 4.7 | 1.9 | 2 |
| /api/operations/dashboard?range&store | 18.1 | 24.9 | 19.9 | 24.8 |
| /api/operations/manifest?pageSize&section&store | 4.8 | 5.6 | 4.9 | 6 |
| /api/bookings | 2.7 | 3.1 | 2.7 | 4.2 |
| /api/operations/orders?page&pageSize&stores&tab | 16.4 | 18.5 | 16.9 | 23.9 |
| /api/operations/customers?page | 4.5 | 15.8 | 4.2 | 4.5 |
| /api/operations/products?store | 4.9 | 5.6 | 5 | 5.6 |
| /api/operations/products/:id?store | 6.7 | 9.6 | 5.5 | 7.6 |
| /api/operations/sales-stops | 9.7 | 13.1 | 8.7 | 9.7 |
| /api/staff-users | 2.2 | 3.2 | 2.2 | 2.4 |
| /api/operations/calendar?days&from&page&store | 6.5 | 9.2 | 6 | 7.6 |
| /api/operations/reports?stores&type | 4.2 | 5.7 | 3.5 | 5.4 |
| /api/operations/inbox/preference | 3.2 | 4.2 | 2.7 | 3.4 |
| /api/coupons | 2.7 | 4.5 | 2.6 | 4.2 |

## NOT_RUN と限界
- **本番**での計測・変更は一切していない。本番のコールド/4秒問題は未検証（上記）。
- **INP**（Interaction to Next Paint）は未計測。操作時間は「Node側でのクリック→描画」で、ブラウザのEvent Timingではない。実機のタッチ・ネットワーク遅延・CPU実機差は未評価（mobileは390px＋CDP CPU4xの擬似）。
- QR読取は**カメラ読取を未実行**（手入力ID経由の「予約を開く」のみ計測）。貸出/返却の書込操作は計測していない（読み取り操作のみ）。
- 合成データは予約24件・品目少数。本番規模（数千件）でのAPI p95は未評価。orders/users のDB側スケール問題は検出できない。
- 「mobile: nav ->inventory」は直前画面に同じ role=table が存在するため描画待ちが即時に満たされる計測上の癖があり、改善率の根拠にしていない。
- LCP/CLSの反復は5回（desktop-en/mobile-enは3回）。CLS は合成データ依存（読込後の高さが変わると placeholder の最適高も変わる）。placeholder 高は固定値で、データ件数が極端に違う場合は小さなシフトが残り得る（/staff/today の新着予約などは件数で高さが変わる）。
- 検証: `npm run lint`、`npx tsc --noEmit -p .`、`test:staff-shell-ui`・`test:staff-home-ui`・`test:staff-acceptance-ui`・`test:staff-all-routes-ui`・`test:staff-console-unity-ui`・`test:staff-accounts-ui`（role-sweep含む）・`test:flow-ui`（`normal-ui.ts` の StaffSessionBoundary 契約を含む）をビルド後に直列で実行し全PASS。
