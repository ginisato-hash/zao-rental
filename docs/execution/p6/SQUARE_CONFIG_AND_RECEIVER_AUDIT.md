# Square config / receiver audit — P6 R2

調査base/main3061dbbbe00294e5baebba2405028c907d6e6e85、P6前head9e0616fc7cab125e15cbdcb36dcb317c65fbed2b。2026-09-14。製品code静的照合であり実Sandbox成功ではない。

## 既存の接続契約

- `packages/core/src/payment/square-sandbox.ts`: SQUARE_VERSION=2026-08-19、Sandbox origin固定。呼出しtransport/sourceは注入。
- `square-transport.ts`: server内Bearer、redirect拒否、request allowlist、timeout/abort/response上限。defaultfetch/ambientcredentialなし。GETはpayment/refund IDのlookupのみ、merchant/location S1には未対応。
- `sandbox-preflight.ts`: injected SandboxSecretResolver + lifecycle metadata + exact通知URL、active/retiring鍵の検証。旧2店舗mapping型は異なる2Location必須で、今回の1Location acceptanceにはそのまま使えない。旧契約は変更しない。
- `sandbox-activation.ts`: 永続journal、最大20payment/5refund、同一キー再開/既知結果照合、auth/quota stop。environmentだけで実行可能にはならない。
- `BookingService`: DB本人/店舗権限、attempt/見積の突合、lookup→観測保存。通常production環境は停止。Next PreviewもNODE_ENV=productionなので、通常guardを削除せずSandbox専用compositionを後続で閉じる必要がある。
- `apps/web/src/app/api/bookings/[[...record]]/route.ts`: normal composition UNCONNECTED、保護された503。Webhook routeではない。

`apps/packages/config/scripts`のSquare env参照を調べたが、既存Square値用env名/readerは存在しなかった。類似名のaliasを増やさず、今回以下を一度だけ定義。

## 確定した設定名（値は記録しない）

コード正本: `packages/core/src/payment/sandbox-environment.ts`。

| env名 | 分類 / 入力段階 |
|---|---|
| `SQUARE_ENVIRONMENT` | server設定、厳密にSANDBOX。設定上の識別でありcredential環境の実証ではない |
| `SQUARE_API_VERSION` | 非secret、2026-08-19のみ。default/自動upgradeなし |
| `SQUARE_SANDBOX_APPLICATION_ID` | 非secret識別子、Owner確認値。無意味に公開しない |
| `SQUARE_SANDBOX_LOCATION_ID` | 非secret識別子、1件のacceptance用。内部店舗mappingではない |
| `SQUARE_SANDBOX_MERCHANT_ID` | 非secret、S1照合後に固定。未照合時はnull、guessなし |
| `SQUARE_SANDBOX_NOTIFICATION_URL` | 正確なHTTPS URL。実route/deploy確定までnull。query/bypass/資格情報を含めない |
| `SQUARE_SANDBOX_ACCESS_TOKEN` | **server-only Secret、Previewだけ**。今回Ownerが最初に直接登録する名前 |
| `SQUARE_SANDBOX_WEBHOOK_SIGNATURE_KEY` | **server-only Secret、Previewだけ**。実subscription作成後に別段階でOwnerが直接登録 |
| `VERCEL_ENV` | Vercel提供metadata、preview以外を拒否。browser送信header/flagから作らない |

全てNEXT_PUBLIC化禁止。App ID/Locationは非secretだが今のブラウザ設定境界へ無断exportしない。将来Web Paymentsへ渡す公開可能値は必要な対象だけの専用server応答で扱い、Token/署名鍵と分離する。

新parserは**metadata準備のみ**。Token/署名鍵の値は読まず、設定名を既存resolverへ渡すために返す。Secretの有無・正当性・有効期間の判定ではない。process.env自動読込、fetch、provider call、secret store取得、DB更新、receiver公開はない。結果は常にactivationDISABLED / merchantLocationVerified=false / internalStoreMappingOWNER_PENDING。VERCEL_ENVを設定しただけではauthorizationにならない。
secretLifecycleのキー有効期間/rotation metadata、実resolver、durablejournal、許可済deploymentを後続で合わせる。tokenの期限・merchant・本番mappingを仮定して捏造しない。

## Webhook監査表

| 条件 | 既存で確認できたこと | 未接続・必要な受入 |
|---|---|---|
| raw body保持 | `verifySquareWebhook` が元Uint8ArrayをHMAC-SHA256へ入力。64KiB上限 | HTTP requestからarrayBufferを上限付きで読む実routeなし |
| exact notification URL | 配置設定URL + rawbytes、constant-time比較、改変拒否unit | deploymentの実URL固定/署名一致NOT_RUN |
| server secret | injectedresolver、active/datedretiringkey。鍵はログへ出さない | Vercel env resolver未接続、実key rotation未検証 |
| duplicate | `rental_provider_events.event_id` PK、digest/attempt衝突拒否、観測とDB状態変更が同transaction | HTTP再配達のack/復旧未検証。単なる受信直後の耐久inboxではない |
| out-of-order | BookingService.recordObservationのprovider_updated_at/terminal判定。成功の巻戻しを拒否 | 実通知の順序逆転NOT_RUN |
| durable receipt | lookup成功後に観測digest/outcomeを永続化。既存migration0009は変更なし | lookup前のdurable受信記録はない。障害時のretry/2xxpolicyを実routeで定義する必要 |
| provider lookup | 署名検証済みeventのpaymentIDでlookup、予約/金額/JPY/merchant/location/attempt突合 | 実keyでS1/S2・providerlookupNOT_RUN、Webhook用本人/DB権限composition未接続 |
| DB reconciliation | 固定attempt/キー、保護/期限/価格再確認、相違はREVIEW | HTTP入口の認可/worker actor/専用DBが未接続。staff sessionを偽装しない |
| 2xx response | **未実装**。現bookings HTTP handlerをWebhookとして再利用しない | 有効な通知のdurable処理後ack、失敗/重複/無関係eventの方針と試験が必要 |
| 非ログ | 既存関数は秘密値/rawbody/cardのloggerを呼ばず、イベント保存はdigest+ID | Vercel provider logs/HTTPerror経路は未検証。署名/Authorizationを記録しない |
| subscription対象 | payment.created / payment.updated parserのみ | refund通知対応とは呼ばない。refundは既存lookupで別受入 |

コード部品の検証と通常HTTPS routeの完成を混同しない。今回新しいURL/公開routeは作っていない。環境変数だけを登録してWebhook subscriptionを先に作らない。

## 変更・検証の限界

追加はmetadata parserと4unit casesのみ。1Locationの準備、秘密値getterを読まないこと、production/無設定/alias/public変数拒否、exactHTTPS URLを検証する。既存P5の2店舗制約は維持。P6の全unit/lint/typecheck/build結果はstatus/実行ログに対応付ける。
実Postgres・通常UI・外部Webhook/Square/Vercelの結合確認を今回再実行したとは記載しない。APIversion、価格、payment/custody/在庫/guest/RBAC、DBmigration、Runnerpolicyを変更していない。
