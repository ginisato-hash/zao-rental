# P6 R2 — 接続前の現在地

正本は [Owner R2原文](../PRODUCTION_P6_R2_ORIGINAL.md)。2026-09-14確認。
開始10:04:11 JST / 01:04:11 UTC。既存P6 branchを継続し、P5 merge・レビューをやり直さない。

## Square: Owner報告と実API確認を分離

| 項目 | 現在 |
|---|---|
| Developer account / application | Owner確認済み。ZAO Rental、Accept payments / A company、Sandbox |
| Application ID | 発行済み。値は取得・転記していない |
| Access Token | 発行済み／未登録。値はCodexへ渡さない |
| Test account | Default Test Account、Owner確認済み |
| Location | Default Test Account (Main)、IDはOwner確認済み |
| 対応店舗 | 1件のSandbox acceptance locationだけ。内部2店舗の統合・本番mapping確定はしない |
| 実Square request / payment / refund | **0 / 0 / 0**。公式文書調査はprovider API試験ではない |
| Production | 禁止。Sandboxの識別子も実API照合前は未検証 |

Square-Versionは既存コード2026-08-19を維持。[公式release](https://developer.squareup.com/docs/changelog/connect-logs/2026-08-19) に同版の公開を確認した。別バージョンへの変更なし。実transport/Sandboxでの互換性成功ではない。

## Vercel: Project作成・link・設定readback完了

OwnerのCLI再ログイン後、Team `ZAO FOOD MAP` (`zao-food-map`) に `zao-food-map-pilot` / `https://tasteofzao.app` が所属するとProject一覧で確認。同Team全2件・次pageなしでzao-rentalがないことを確認し、専用Projectを新規作成した。

- 新Project: [zao-rental](https://vercel.com/zao-food-map/zao-rental)。IDは証拠JSON参照。
- Framework Next.js、Root `./`（API null）、Build `npm run build`、Output Next.js default（API null）、Node24.x。
- repo rootのengines24.15.x/npm11.12.x・固定lockfileを維持。Vercelはmajor24.x設定のため、実patch/npm/native依存適合はPreview実機受入で確認する。
- root `/Users/gini/Projects/zao-rental` とP6worktreeをmetadata-onlyで同Projectへlink。
- rootは既存の保留branchのままclean。そこでdeployしない。将来のdeployはレビュー済みP6worktree/commitを明示する。
- Git integration未接続、deployment0をVercel APIで確認。pushでhosting deployは始まらない。
- 初期のCLI認証失敗と自動login待ちの終了記録はstatusへ保持。Ownerの明示的な再ログイン後に回復し、権限追加はしていない。

現repoのbuild出力はapps/web/.next。Owner指定どおりrepo root/Next defaultを維持し、Vercelの成果物検出・runtime/node/native依存・production startup/health/ingressの成立は初回Previewで未検証として扱う。ローカルbuild成功をVercelbuild成功とはしない。

### local linkの秘密値回避

導入CLI59.9.1の `link` は `refreshOidcTokenAfterLink` を無条件に呼び、OIDCtokenを`.env.local`へ取得する。`pullEnv:false`でも後段のこの動作は止まらない。R2は秘密値の抽出・複製を認めていないため、この起動経路は使わない。
確認済みVercel API応答の `projectId / orgId / projectName` だけを `.vercel/project.json` へ保存するmetadata linkを作成・読み戻し確認した。secret取得API・env pull・OIDC発行は行わない。`.vercel`はGit対象外、既存linkがあれば一致を確認し不一致は上書きしない。PR3ブランチの製品コードは変更しない。
参考: [link](https://vercel.com/docs/cli/link)、[project](https://vercel.com/docs/cli/project)、[teams](https://vercel.com/docs/cli/teams)。実装根拠は導入済みCLIの`dist/commands/link/index.js`および`linkFolderToProject`。CLI自体は改造しない。

## OwnerのSecret入力地点（ここで停止）

[zao-rental Environment Variables](https://vercel.com/zao-food-map/zao-rental/settings/environment-variables) をOwnerが開く。Project作成・所属・設定・linkのreadbackは完了した。

- 対象は専用 **zao-rental** Project → Settings → Environment Variables。
- 名称 **`SQUARE_SANDBOX_ACCESS_TOKEN`**、種類Secret／Sensitive、対象 **Previewのみ**。
- OwnerがSquare Developer ConsoleのSandbox Tokenをこの画面へ直接貼り付けて保存。Production / Development / team共有には登録しない。
- chat・PR・repo・スクリーンショット・CLI引数へ値を出さない。Codexは取得・pullしない。
- 保存後もdeploymentや実Square呼出しは始めない。次にOwnerがPreview deploymentを別途承認。
- Application / Location等の非secret設定とWebhook署名鍵は段階に応じて入力し、複数secretを一度に求めない。

[設定名・監査](SQUARE_CONFIG_AND_RECEIVER_AUDIT.md) が対応するコード。env保存はcredentialの検証やreadiness成功ではない。
[公式Vercel Secret](https://vercel.com/docs/environment-variables/sensitive-environment-variables)、[rotation](https://vercel.com/docs/environment-variables/rotating-secrets)。設定変更は既存deploymentへ自動反映されない。

## 次の実通信の順序（未実施）

Preview承認・受入と専用DB/接続compositionが整った後、S1でSandbox authentication/merchant/locationをread-only照合。merchant ID・location ID・JPY/国・環境を確認してからS2。
S2はsynthetic予約/保存見積を使うpayment1件。quote/snapshot/chargeReady gateを迂回しない。Webhook原文署名→lookup→durable DB照合を確認してから追加ケース、payment受入成功後のみrefund1件。上限20payment/5refundは既存durable journalで全体共有し、restartでも増枠しない。
UNKNOWN: provider IDありはGetPayment、ID不明はSTOP/manual investigation。同一attempt/keyを保持し、別キー再請求をしない。ブラウザredirectやpaid自己申告は支払権威ではない。

## 残る接続前の不足

Project設定だけで初回PreviewをSquare受信先にできるわけではない。通常Next本番runtimeのpaymentは現在503で閉じている。単一location S1 transport、独立したSandbox runtime/DB接続、署名receiverのHTTP入口と2xx/durable inbox方針、deployment protection下のSquare到達、実ingress、tokenizationが未接続。
これらの実装・review/受入を段階化し、最初のPreviewは必要なhealth/build確認の範囲だけにできるかも承認前に示す。既存保護をOFFにして接続しない。
