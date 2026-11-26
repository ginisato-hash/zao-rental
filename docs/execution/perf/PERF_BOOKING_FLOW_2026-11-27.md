# 顧客予約フロー 隔離計測（2026-11-27）

結論: 隔離環境の計測では、予約フローの各主要遷移は p95 が目標（1秒以下）を満たしており、**製品コードは変更していない**（「良好」と記録）。
本PRは (1) 計測スクリプトの是正、(2) 予約フロー計測ハーネス、(3) 実測記録のみ。本番へのアクセス・書込は一切行っていない。

## 条件（限界を含む）
- 対象: `tests/flow-app`（`next dev --webpack`）+ 隔離 PostgreSQL（`startFlowApp`）。commit 0779053（origin/main）。合成データ、決済は開発スタブ。
- このfixtureは本番ビルドできない（`next build tests/flow-app` は `TEST_COMPOSITION_FORBIDDEN` で失敗＝意図的設計）。したがってクライアントJSは非minifyの開発版で、**ハイドレーション/描画時間は本番より遅い側の上限**。API/DB時間は同一コア実装・同一スキーマだが loopback のため**ネットワーク遅延・サーバレス cold start・リモートDB往復は含まない**（本番値ではない）。
- ブラウザ: Playwright + Chromium 153。CDP `Emulation.setCPUThrottlingRate`: 390px mobile は 4x、1280px desktop は 1x。ネットワークスロットリングなし。各反復で新規 browser context（新規 guest cookie）、各20回（先頭プロファイルに破棄ウォームアップ1回）。日付は反復ごとに別日。
- 時間は全てページ内 `performance.now()`。「操作→描画完了」= 合成クリックから目的DOM出現＋2フレーム後。「API」= 最初のfetch開始から最後のfetchのbody読了まで。Lighthouse の TBT/INP/LCP とは別物。long task は PerformanceObserver の推定値（JSONの longTaskMsP95）で TBT/INP ではない。
- 計測マシンは他作業と共有（load average 約5〜11）。1回目（`booking-flow-bench-before.json`）は競合で外れ値が大きく（例: JA 390px の load p95 7.4s、preview p95 4.9s）参考外。2回目（`booking-flow-bench-run2.json`）を主データとする。反復間のばらつきは大きい点に注意。

## 結果（2回目、p50 / p95 ms、操作→描画完了）
| ステップ | JA 390px/CPU4x | EN 390px/CPU4x | JA 1280 | EN 1280 |
|---|---|---|---|---|
| 0 ページ読込→日程フォーム操作可 | 1325 / 1598 | 1314 / 1580 | 546 / 649 | 554 / 597 |
| 1 日程→用品（クライアントのみ） | 115 / 130 | 102 / 125 | 56 / 56 | 54 / 57 |
| 2 用品→サイズ候補・参考料金（draft保存+preview） | 272 / 373 | 275 / 571 | 200 / 409 | 229 / 313 |
| 3 サイズ→最終確認（selection） | 129 / 175 | 110 / 131 | 58 / 74 | 58 / 74 |
| 4 クーポン適用（draft+preview+selection） | 228 / 277 | 249 / 298 | 204 / 251 | 221 / 254 |
| 5 開発スタブ決済（checkout）→確認画面 | 188 / 311 | 160 / 191 | 136 / 186 | 137 / 194 |

全プロファイル 失敗0/各20。API単体（Node直、cookie付き、warm、55回）: GET /api/guest/draft p50 24.5 / p95 33.4 ms、GET /api/guest/options p50 6.6 / p95 14.3 ms（目標 read API warm p95 ≤ 500ms を満たす）。
ステップ0の1.3〜1.6s（mobile）はNext開発版JSのハイドレーション＋CPU4xが主因（long task推定 p95 約0.9〜1.2s）。本番ビルドでの再測定は **NOT_RUN**（fixtureが本番ビルド不可）。

## fetch・直列依存・重複の切り分け
- 読込: `POST /context` → `GET /draft` ‖ `GET /options`（直列2段、cookie発行が必要なため削減不可）。開発版では React StrictMode の二重 effect により draft/options が各2回（計5fetch）。本番ビルドでは StrictMode の二重実行はないため**重複ではなく開発版の副産物**と判断し、修正していない（本番での確認は NOT_RUN）。
- ステップ2: `POST /draft` → `POST /preview` 直列（previewは保存後の revision に依存）。支配項は preview（p50 約100〜200ms）。
- ステップ4（クーポン適用）: `draft`→`preview`→`selection` の3直列。サーバが「1つのpreviewに保存selectionは1つ」（DRAFT_ALREADY_SELECTED）という制約を持つための再保存・再previewで、クライアントだけでは削れない。
- preview の内訳: `RecommendationService.preview` が候補長ごとに `HoldService.availability` を**逐次await**（各回が BEGIN〜COMMIT のトランザクション）。ローカルでは約100〜200ms。リモートDBでは「候補数 × クエリ往復」に比例して伸びる可能性があり、**本番で最も効く改善候補**。ただし並列化は `holdPool`（max:4、connectionTimeout 2s）を同時ゲストが奪い合い、プール枯渇・タイムアウトのリスクがあるため、本PRでは**変更していない**。実施する場合は本番プールサイズ確認＋負荷試験（隔離）が前提。
- 40連続予約（JA desktop）で preview が約100ms→約150msへ緩やかに増加（`booking-flow-bench-trend-ja1280-40runs.json`）。蓄積データ量依存の傾向。1予約あたり約1ms程度で、現状は許容内と判断。

## 変更しなかった点とその理由
- GuestBooking.tsx / guest API は無変更。目標（主要遷移 p95 ≤ 1s）を隔離環境で満たしており、正本性（transaction/lock/idempotency）を速度と引き換えにする根拠がないため。クーポン確認フローの挙動も無変更。
- 比較用の after は「変更なし」のため同値（再測定の別表は設けない）。

## 計測スクリプト（scripts/perf/lighthouse-public.mjs の是正）
- 「2回目以降=warm」ラベルを廃止。各runは別Chromeプロセス・空プロファイルのため全件 `browserCache:'cold'` / `serverCache:'unknown'`。サーバ/CDNキャッシュ系ヘッダ（x-vercel-cache, age, cache-control）はプローブGET1回の証拠として記録のみ。
- 各runで runtimeError、最終URL一致（redirect拒否）、メイン文書HTTP 200、追加Documentリダイレクト、必須指標（FCP/LCP/CLS/TBT/SI/TTFB/bytes）の有限値・範囲、scoreを検証。不合格はreason付き failure として統計から除外し、1件でもあれば exit code 2。`--selftest` で検証関数をオフライン確認（9ケース PASS）。
- 記録: 成功/失敗数、Lighthouse要求/実報告版、Chrome UA、throttling設定（configSettings）、`--deployment`/GITHUB_SHA、メトリクスのみのraw JSON（HTML・screenshot・trace・cookie 非保存）。TBT≠INP、Navigation Timing/longtask推定≠TBT/INP を冒頭に明記。
- 実Lighthouseの実行は **NOT_RUN**（本作業では本番を含め実行せず。検証関数のselftestのみ）。BASELINE_2026-11-26.md（PR #86）には触れていない。

## NOT_RUN / 限界
- 本番ビルド・実ネットワーク・サーバレス cold start・リモートDB往復込みの予約フロー計測、本番ドメインでの予約フロー計測（書込を伴うため禁止）。
- 実Square決済、メール送信、実クーポンの運用データ量。
- Lighthouse の実行（スクリプトは是正のみ）、INP の実測。
- マシン共有による揺らぎ（1回目に顕著）。

## 再現
`node --import tsx scripts/perf/booking-flow-bench.ts --runs=20 --tag=x --out=<json>`（`--profiles=ja-1280-cpu1` で絞込）
