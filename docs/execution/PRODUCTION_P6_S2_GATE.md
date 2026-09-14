# P6 S2 — 合成Sandbox payment 1件のOwner承認ゲート

状態: **BLOCKED_METADATA_AUTH。S2はNOT_EXECUTED。実行authorityではない。**
R8のmerchant metadata登録結果は [P6 status](PRODUCTION_P6_STATUS.json) の `r8` を正本とする。登録完了前は本ゲートも `BLOCKED_METADATA_AUTH`、完了後に `READY_FOR_OWNER_AUTHORITY`。後者もdeploy・provider呼出しの許可ではない。

## 1. 採用済みidentityと保持する事故記録

Owner R8 authority: [原本](PRODUCTION_P6_R8_AUTHORITY.md)。GitHub復帰基点 `fb237f7f1698a718c5430da130ddd3530816744d`。

| 項目 | 採用する証拠 |
|---|---|
| S1 | [R7 safe result](p6/r7-evidence/safe-result.json): S1_PASS、HTTP200、POST1、Square GET2、retry0 |
| merchant | `MLKDVEDH1ME21`、ACTIVE / JP / JPY |
| location | ACTIVE / JP / JPY、configured location verified、main location matched、merchant matched、locationCount1 |
| capability | CREDIT_CARD_PROCESSING=true |
| Square-Version | `2026-08-19`、変更・自動追従なし |
| interpretation | `OWNER_ACCEPTED_FROM_R7_PASS`。S1再実行禁止 |
| merchant metadata | `SQUARE_SANDBOX_MERCHANT_ID`、Preview限定。R8 metadata readbackを参照。現存R3へredeployして反映したという意味ではない |
| retained Preview | accepted R3 `dpl_2tskZombWNMhwEKB6NG96FxkzmhL`。R4/R6/R7の一時PreviewとrouteはGitHub履歴どおり削除済み |
| Production | activation disabled。Square Production値・通信・公開を許可しない |

location IDは再取得せず、既存のS1確認済み `SQUARE_SANDBOX_LOCATION_ID` をサーバー内で使用する。Sandboxの1 locationを2店舗の本番mappingと解釈しない。S1証拠が採用されても、R7全体の `FAIL_SECURITY_BOUNDARY` は変更しない。[事故記録](p6/r7-evidence/security-observation.json) を別途保持し、R7のoverall secret exposure=0とは主張しない。callback値の捜索・再表示・forensic・自動rotationをしない。

## 2. 次の1回の承認に含める具体案

これはOwnerへ提示する**提案値**。承認されるまで設定・実行に使わない。合成通信試験金額であり、レンタル価格・税・couponの決定ではない。

| 境界 | 推奨するS2 authorityの内容 |
|---|---|
| 目的 | server→Square Sandboxの合成payment 1件と安全な応答突合。通常予約確定・実請求・貸出ではない |
| 金額 | **100 JPY × 1件**、サーバー固定、autocomplete=true。ブラウザ金額を採用しない |
| account | 上記merchantと既存S1確認済みlocationのみ |
| source生成方式 | **Square公式のSandbox専用固定test source `cnon:card-nonce-ok`** をサーバーの隔離されたS2試験で使う案。実カード入力0、独自カード情報0。Web Payments SDK/tokenizationはこの案では実行0・未検証のまま |
| 通信 | CreatePayment `POST https://connect.squareupsandbox.com/v2/payments` 最大1。Square-Version固定、redirect禁止、任意URL/別API禁止 |
| retry | automatic0、manual0。失敗・応答喪失・UNKNOWNでも別key/同keyのPOSTを追加しない |
| lookup案 | provider payment IDが安全に取得・保存済みの場合に限り、future authorityで明示して **GetPayment最大1**。ID不明はSTOP/UNKNOWN。idempotency keyによる架空のlookup APIを作らない |
| 呼出し上限 | CreatePayment1 + 条件付きGetPayment1。S1 GET0、refund0、Webhook0、Orders/Customers/Catalog0、Production0 |
| 実行環境 | 新authorityで承認されたprotected Sandbox専用Preview。必要な最小実装・fixture検証後にcommit/treeを固定し、Preview最大1を別途そのauthorityに含める案。R8にはdeploy枠なし |
| secret | 既存Preview access tokenをサーバー内だけで読む。新secret、cookie export、認証header出力、env pullなし |
| 実データ | 実顧客・実スタッフ・実カード・実在庫0。合成booking/reference/attemptだけ |
| 終了 | 一回の結果・request count・safe evidenceをGitHub保存して停止。Webhook/refund/S3へ自動進行しない |

公式根拠（2026-09-14確認）: [Sandbox固定test source](https://developer.squareup.com/docs/devtools/sandbox/payments)、[CreatePayment](https://developer.squareup.com/reference/square/payments-api/create-payment)。このtest sourceを用いた成功を、Web Payments tokenizationの成功と呼ばない。OwnerがWeb Payments経由を選ぶ場合は、そのsource生成手順・Sandbox SDK通信・合成カード入力範囲をS2 authorityへ明記し、本案の固定sourceを無断で併用しない。

## 3. 実装済み境界と、S2実行前に必要な限定整備

R8では製品コードを変更しない。`READY_FOR_OWNER_AUTHORITY` は、承認資料の準備完了を意味し、S2が既に配備・実行可能という意味ではない。

再利用する契約:

- `packages/contracts/src/rental-flow.ts`: PaymentRequest / flowId / flowHash / matchPayment。合成bookingId、attemptId、idempotencyKey、amount、currency、merchant/locationをサーバーで固定する。
- `packages/core/src/payment/square-boundary.ts`: squareCreateBody / squareObservation。request reference、amount、currency、location、providerId、statusを照合する。
- `packages/core/src/payment/square-sandbox.ts`: 固定Sandbox origin/version、timeout、auth/quota stop、provider IDを必要とするlookup。環境名だけでは実行許可にしない。
- `packages/core/src/payment/square-transport.ts`: server credential、redirect拒否、abort、応答上限。既存transportにはrefund/lookupの能力もあるため、**S2 compositionのより狭いallowlist**で遮断する。
- `packages/core/src/payment/sandbox-activation.ts`: 永続reserve→SUBMITTING→OBSERVED/UNKNOWNと同一request照合。既存P4初期値20payment/5refundはS2 authorityではない。旧budgetをリセット・流用しない。

future S2の実装では、既存の冪等性契約を保持し、S2専用operation IDに **payment limit1、refund limit0、lookup limit最大1** を適用する。最初のdispatch前に、固定requestのfingerprintと予約済み予算を耐久記録する。再読込・同時POST・プロセス再起動でも追加dispatchしないことをfixtureで証明してから実通信する。

**未接続の必須依存**: 既存journalはPostgreSQL依存であり、現存Previewにdurable journal用DBは接続されていない。実行authorityで、既存の承認済み専用合成開発DBを使う安全な実行配置・接続範囲を明示するか、同等のdurable single-use境界を限定実装・検証する必要がある。R8はDB接続・新保管先・provider契約を承認しない。Vercel isolate内のboolean、ブラウザのsessionStorage、プロンプトだけで分散的な1回制限を「実証済み」としてはならない。強制境界が未確定ならCreatePayment0で停止する。

通常BookingServiceのproduction拒否、chargeReady=false、税未確定、通常APIの未接続制限は維持する。S2の合成provider paymentを用いて本物の予約・在庫保護・見積snapshot・custodyを更新しない。今回の試験だけの成功表示と通常予約の支払状態を分ける。

## 4. 実通信に進むためのチェック順

1. S2 authorityが上記金額・source・operation ID・journal境界・exact source/deployment・実行時間枠・Preview枠・lookup回数を明示していることを確認。上位P4の20件許可や過去の未使用枠を加算しない。
2. canonical remote/main/dirty stateを照合。R7 safe evidenceと事故記録のhashを保持。S1を再確認目的で呼ばない。
3. runtime preflightはSquare通信0。Sandbox/Preview/version、merchant/既存location binding、access token設定有無、server-only、production拒否、one-shot未消費を検証。秘密値を返さない。
4. 合成requestを固定し、browserがuser/role/store/source/金額を変更できないこと、同key異payloadを拒否すること、二重操作でdispatchしないことをfixture確認。長い実障害試験や意図的な本物の失敗の反復を行わない。
5. 認証済みOwnerの明示操作1回だけ。表示・GET・health・preflight・リロードではCreatePaymentを呼ばない。Console貼付、Self-XSS解除、保護bypassを実行方式にしない。
6. durable reserve後にCreatePayment最大1。送信前に停止したことを証明できない中断はUNKNOWN/possibly consumedとして保存。別key・別Preview・別プロセスへ移して再請求しない。
7. HTTP成功だけではPASSにしない。COMPLETED、100JPY、expected reference/merchant/location、providerId、fingerprintをサーバーで照合。SDK/redirect/paid=true/ボタンは決済証拠ではない。
8. 401/403/429、timeout、socket abort、非JSON、identity/金額不一致、結果不明は停止。ID不明ならlookupも0。取得済みIDがある場合だけauthority内の最大1 GETを利用できる。lookup自体のUNKNOWNも再試行しない。
9. safe結果とrequest ledgerを保存し読み戻す。成功/不合格/UNKNOWNのいずれでもterminal。新しい承認なしでWebhook/refund/S3へ進まない。

## 5. ログイン・秘密情報の境界

Ownerは通常UIでログインし、callback/login画面を離れてtarget application pageへ到達してからautomation観測を開始する。ログイン中のraw URL、page title、accessibility snapshot、query/fragmentを取得・表示・保存しない。出力はallowlisted metadataのみ。

Cookie/token/storage/auth headerを読まない・表示しない・保存しない・Gitへ入れない。Square access tokenは既存server secretとしてのみ使い、rotationしない。Vercel/Google credentialも新しい根拠なしでrotationしない。ブラウザ操作が保護で拒否されたら解除・別手段による回避をせず停止する。

## 6. S2で保存する証拠と未完了表示

記録: authority/source SHA/tree、Preview ID/protection、operation ID/fingerprint、時刻、CreatePayment/lookupの実dispatch件数・HTTP status、safe providerId、金額/JPY/identity/reference一致、分類、残予算、後片付け。token/source/署名/Cookie/card/生body/認証callbackは保存しない。

分類: `S2_PASS`（上記突合成立）、`S2_FAIL`（確定的不一致）、`UNKNOWN_DO_NOT_RETRY`、`BLOCKED_NOT_DISPATCHED`。実Sandboxとfixtureを分ける。S2が成功してもWeb Payments・Webhook・refund・予約確定との実DB結合・Productionは未実施のまま。

Ownerの次の操作は、上記具体案と未接続のdurable実行境界を含む **S2 synthetic payment exactly1 authorityの承認**。追加secretや新DB/provider権限が必要なら、その操作を承認内容へ明示し、推測で補わない。
