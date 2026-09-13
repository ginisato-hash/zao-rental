# Square Sandbox activation — approval checklist and offline harness

**実Square要求、資格情報の作成・投入、webhook公開、試験請求／返金は未承認。** 本文は接続承認時の作業順であり、現行chargeReady=falseや未接続Gatewayを解除する権限ではない。

| 必要項目 | Owner／接続担当が確定すること | 証拠（秘密値は不可） |
|---|---|---|
| Sandbox application | 対象OwnerのSquare application、Sandbox環境を選択 | applicationの管理台帳ID／承認、productionとの分離 |
| access token | 既存承認されたsecret storeへ人が登録。repo/chat/browser traceには出さない | secretのmetadata ID、環境、有効期間、revocation手順だけ |
| merchant／location | 対象Sandbox sellerと2店舗への明示的mapping。location一覧を承認後read-only照合 | Sandboxの一致記録。店名からIDを推測しない |
| API version | 現コードSQUARE_VERSION=2026-08-19を起点に公式releaseと互換試験を確認 | code/config/console/webhook版の対応。P3では版を変更しない |
| tokenization | Sandbox Web Paymentsのclient sourceとserver amountの分離 | 正式カード／実口座データ禁止。既存source resolverは未接続 |
| webhook URL／signature key | 選択hostingのHTTPS exact URL、subscription、署名鍵を分離 | URL文字列・key metadata、raw bytes改変拒否、認証cookie不要の署名入口 |
| redirect／callback | 承認originと固定return path、任意URL禁止 | redirect／paid=true／ブラウザボタンでは成功にしない。状態はserver照合 |
| secret storage／rotation | DB/access/webhookを別用途、最小権限。失効・安全なoverlapを設計 | 現webhookはsingle-key。透過dual-key rotationは未実装。実施前に追加実装・検証 |
| test charge/refund policy | 件数・金額・対象合成予約・最大回数・責任者・停止条件を明示 | Sandboxでも本指示は実請求／返金試験を許可しない。E14返金機能へ広げない |
| idempotency | 既存attemptとkeyをDBで保存、再送前に結果照合 | keyを変えた再請求禁止、同一keyのpayload変更拒否 |
| UNKNOWN reconciliation | provider IDがあればGET照合、なければ調査停止 | GetPayment-by-idempotency APIを捏造しない。別POSTで解決しない |

接続承認後も最初は限定read-only環境／merchant/location確認、次に指定件数の合成Sandbox取引、最後に署名webhook→provider lookup→実DBを検証する。署名失敗／401/403/429／timeout／金額・通貨・店舗不一致／結果不明は停止し、再認証・課金・別keyへ自動切替しない。Webhookのdurable受領／dedup／2xx応答／lookup不可時の再照合を実環境で確認する。生body、token、署名、source、Cookieをログへ残さない。

## 一括再実行（現在許可される範囲）

`npm run test:square-activation`。注入fixture＋127.0.0.1の自分の一時HTTPサーバー＋合成PostgreSQLだけを使用。固定argvでtransport scenarioと既存test:flow-paymentを順に実行し、失敗した段階で終了する。既存verifyにも同じ入口を1回組み込む。実network transportは注入しない。

| 受入項目 | 証拠の境界 |
|---|---|
| timeout／socket abort | Gateway期限のfixture、native fetchのloopback socket切断を観測。TLS／実Square socketは未検証 |
| duplicate／out-of-order webhook | raw署名fixture→current lookup、既存実PG suiteのevent dedup／確定の後退拒否 |
| provider lookup／response loss／UNKNOWN | fixture受領後の応答喪失→同じIDのGET、ID不明は停止。DB suiteで新keyにも追加submitしない |
| wrong amount／currency／merchant／location | transport/Gatewayと既存実PG booking突合で拒否 |
| same idempotency replay | 同一key/bodyのfixture provider response、実PG suiteで同時／再送createが1回 |

fixture合格をSandbox E2Eや本物の決済成功と表示しない。

根拠（2026-09-13確認）：[Sandbox分離](https://developer.squareup.com/docs/devtools/sandbox/overview)、[版指定](https://developer.squareup.com/docs/build-basics/versioning-overview)、[冪等性](https://developer.squareup.com/docs/build-basics/common-api-patterns/idempotency)、[raw URL/body署名](https://developer.squareup.com/docs/webhooks/step3validate)、[Webhook順序不定・再送](https://developer.squareup.com/docs/webhooks/overview)。REST認証はBearerであり、独自request署名を追加しない。Webhookの再送期間と鍵overlapの最終条件は接続時に再確認する。
