# Square Sandbox — 1画面ずつ進める

初期状態: application UNCONFIRMED / secret store UNSELECTED・UNCONFIGURED / HTTPS receiver NOT_CREATED。
今はStep 1だけ。Ownerによる情報確認後も、自動的にtoken取得・API Explorer実行・決済へ進まない。

## Step 1 — 今お願いする操作

1. [Square Developer Console](https://developer.squareup.com/apps) をOwner自身のブラウザで開き、ログインする。password/MFAは画面内だけで入力する。
2. `Applications` の一覧を見る。ZAO Rental用として既に作ったアプリがあるかだけ確認する。
3. ある場合はそのアプリを開き、上部に `Sandbox` 切替があることを確認する。`Credentials` でsecretを表示・コピーする操作はしない。
4. 回答は「ZAO Rental用あり／なし／判断できない」だけでよい。スクリーンショットやIDやtokenは不要。

Squareでは登録したapplicationにSandbox環境が用意されるため、別種の「Sandbox専用アプリ」が一覧に必ずあるという前提では探さない。[公式Console説明](https://developer.squareup.com/docs/devtools/developer-dashboard)、[Sandbox説明](https://developer.squareup.com/docs/devtools/sandbox/overview)。UI表記が違えば推測クリックせず、その非秘密のラベルだけ確認する。

## Step 2 — なかった場合に次に提示する手順

Ownerの新規作成判断後、Applicationsのアプリ追加から用途をZAO Rental開発用とする名前を入力し、作成後Sandboxを選択する。アカウント作成・規約同意が必要ならOwner本人が行う。名称候補は `ZAO Rental Sandbox`、既存アプリをrename/流用しない。[公式作成手順](https://developer.squareup.com/docs/get-started/create-account-and-application)。Production account activationは行わない。ボタン名は実画面で照合する。

完了条件は「アプリを作成しSandbox画面にいる」のみ。token取得をまだ依頼しない。

## Step 3 — Sandbox seller / locationを確認

アプリ上部Sandbox、左側LocationsでSandbox店舗を確認する。必要ならConsoleのSandbox test accountsから対象のSquare Dashboardを開く。実店舗Dashboardとの混同を止める。
国/通貨が日本/JPYの合成試験用か、対象merchant、MOUNTAIN_BASE/ONSEN_BASEへ対応させる異なる2 locationがあるかを確認する。表示名だけでmerchant IDを推測しない。足りなければ不足として記録し、実店舗を流用しない。
IDの機械照合は承認済みstoreと専用実行環境ができた後のread-only provider照合までNOT_RUN。全appへの自動認可・権限拡大は選ばない。

## Step 4 — Secret storeを選ぶ

[比較表](SECRETS_AND_RECEIVER.md) の2案からOwnerが選ぶ。未選択ならSTOP。
接続担当・書込担当・読取実行係・失効担当を決める。Sandbox token / webhook signature keyは選定された安全な画面へOwnerが直接投入し、ここへ貼らない。
repo/PR/chat/.env貼付/CLI引数/スクリーンショットへsecretを渡さない。値を表示・export・ローカル複製して確認しない。記録するのはkey ID・設定有無・version・対象環境のみ。

## Step 5 — HTTPS receiverを準備

先に[receiver方式の判断](SECRETS_AND_RECEIVER.md#sandbox-https-receiver)と[受入計画](VERCEL_ACCEPTANCE.md)を確認する。
実deployはOwner承認後。TLS URL確定、署名検証、body上限、durable inbox、readiness、ログ抑制を実環境で確認してから登録する。
登録時はSandbox → Webhooks → Subscriptions → Add subscription → URL/API version/必要イベントを確認 → Save。[公式手順](https://developer.squareup.com/docs/webhooks/step2subscribe)。これは今実行する操作ではない。
現在parserが扱うイベントはpayment.created/payment.updated。refund Webhookを受けられると偽らず、refundは既存照合境界の受入を別にする。固定Square-Versionはrepo上2026-08-19、実Consoleで利用可能か未確認。相違時は自動upgrade/downgradeせずBLOCK。
署名鍵は承認済みstoreへ直接投入。URLのqueryにsecretやVercel bypass tokenを含めない。通知URL+original raw bytesをHMAC検証してからparse、merchant/location/currency/amount/bookingを照合。[署名仕様](https://developer.squareup.com/docs/webhooks/step3validate)。

## その後の実試験 — 今は全てNOT_RUN

実接続開始の承認、metadata、実行SHA、専用DB、secret resolver、HTTPS受信経路、20 payment/5 refundのdurable共有journalが揃って初めて実行する。Night枠やfixtureを理由に実試験枠をリセットしない。
Sandbox以外のorigin、merchant/location不一致、secret期限切れ、認証/利用枠/予算異常は停止。UNKNOWNは同じ保存キーでprovider照合し、別キー再請求しない。refund ID不明は成功/返金済とせず停止する。

| 実受入 | 保存する結果（秘密値なし） |
|---|---|
| Web Payments tokenization / synthetic payment | Sandbox確認、承認origin/TLS、合成カードのみ、金額JPY/予約/価格snapshot照合 |
| 同一キー再送 / response loss / restart | provider/payment1件、同じ保存結果へ復帰、journal消費が重複しない |
| duplicate/out-of-order webhook | 原イベント署名を保持して受信、inbox重複処理なし、古い状態へ退行なし |
| timeout/UNKNOWN | 結果不明のまま保持、lookupでのみ確定、HOLD失効後の在庫再検証 |
| wrong amount/currency/merchant/location | 正常確定不可。安全に作れない実反例はfixture-onlyと明示 |
| refund（最大5件） | Sandboxのみ、既存元決済参照、ID不明時の停止。生カード/応答を保存しない |

ブラウザredirect/paid=trueに支払権威を持たせない。通常のchargeReady=falseやpublic activation gateを解除しない。Sandbox試験用compositionは別レビュー/実行許可で接続し、fixtureフラグを通常本番へ配線しない。
