# R2更新

最初のSandboxは専用zao-rental ProjectのPreview Environment Variableを使用する方向とOwnerが指示。Project/link/設定名は確定・readback済み。Ownerが5件をPreview限定Sensitive/Secretとして直接登録済み。key/target/typeだけ照合し、値/実認証は未検証。次はPreview開始承認待ち。値をCodexへ渡さない。
実receiverは未作成。[監査結果](SQUARE_CONFIG_AND_RECEIVER_AUDIT.md) の不足を閉じずにWebhook成功とはしない。Vercel59.9.1 linkにはOIDC自動取得があるため、承認済みlocal linkは確認済みIDだけのmetadata方式で完了。

# Historical R1 comparison — external manager remains an alternative, not selected

# Secret storeとSandbox receiver — Owner選択前

Vercel directを初期hosting候補にする。次の比較は設計判断であり、サービス選択・契約・認証変更は未実行。

| 観点 | Vercel project Environment Secret | hostingから独立したmanager（具体候補AWS Secrets Manager） |
|---|---|---|
| 初期運用 | 設定箇所が少ない。対象project/Preview branchだけに分離しteam-wide共有を避ける | IAM/KMS/外部障害監視など初期設定が増える。Vercel以外からも同じportで利用できる |
| Rotation | 新version設定→対象deployment更新→検証→旧key失効。古いdeploymentは旧値を保持する | version/読取権限を分けてresolverが取得。Square側の鍵更新まで自動対応すると仮定しない |
| 権限分離 | 管理者とdeploy codeが実行時にsecretへアクセス可能。write-only UIは悪意あるコードの持出しを防がない | resource単位のread/write/rotate/KMS権限を分ける。Vercel OIDC連携は新規IAM設定の承認が必要 |
| 監査 | 環境変数の変更履歴・選択planの取得可能性を確認。runtimeの個別secret読取監査と同一視しない | CloudTrailのAPI/rotation/version履歴。保存期間、監視、ログ自体の権限/費用も設計 |
| 障害時復旧 | owner管理の再投入経路が必要。古いdeploymentへ戻すだけでは旧鍵失効を戻せない | manager/STS/KMS不調でfail closed。期限付きcacheや旧keygraceは承認値のみ。secretをrepoへ退避しない |
| 費用 | 現在plan、team権限/監査/保護機能の利用可否をOwner画面で確認 | secret/API利用、監査保管、鍵管理等の費用が加わる。未契約 |

提案: 最初のSandboxが専用Vercel Previewだけならproject単位Secretが最小。複数実行先・個別read監査・backup鍵分離を必須にするなら外部managerを優先比較。どちらもOwner未選択。AWSを使うことは新しいスタッフOIDCログインの導入ではない。

Vercelの現行UIはConfig/Secretを区別し、Secretは保存後write-only。buildログの自動redactionに条件があるため、それに頼って出力してはいけない。[Secret](https://vercel.com/docs/environment-variables/sensitive-environment-variables)。env更新は既存deploymentを変更しない。[Rotation](https://vercel.com/docs/environment-variables/rotating-secrets)。
AWSの管理境界は[概要](https://docs.aws.amazon.com/secretsmanager/latest/userguide/intro.html)、[CloudTrail](https://docs.aws.amazon.com/secretsmanager/latest/userguide/monitoring-cloudtrail.html)、[料金](https://aws.amazon.com/secrets-manager/pricing/)。Vercelからの短期認証は[OIDC参照](https://vercel.com/docs/oidc/reference)に従って別承認時に設計する。long-lived AWS keyを安易に複製しない。

選定時の記録: provider/project/環境、owner、writer/runtime-reader/rotator、許可されたsecret key ID、期限とrotation plan、監査保存、停止/復旧担当、月額上限。秘密値は記録しない。

## Sandbox HTTPS receiver

| 案 | 利点 / 制約 | 承認・受入条件 |
|---|---|---|
| 専用Sandbox Vercel環境に受信route | Next/pg実環境と近い。固定HTTPS URLが必要 | Preview全体を保護するとSquareはログインできない。Webhook routeだけの明示到達許可と署名認可を設計し、Ownerがdeploy範囲を承認する |
| 別の専用receiver | 顧客UIとsecret/DB権限を分離しやすい | 別service・durable inbox・認証済内部配送・監視が増える。契約/権限は別承認 |

初期提案は専用Sandbox Vercel環境。既存本番/他projectを流用しない。
Deployment Protectionを全体OFFにしたり、共有bypass secretをURLへ載せたりして解決しない。選択planで安全なroute限定到達が作れなければBLOCKとして別receiverを比較。[Vercel Deployment Protection](https://vercel.com/docs/deployment-protection)。
現在は受信port/検証関数だけで、production route/実deploy/公開URLは未接続。認証済スタッフ画面、guest、recoveryの入口を同時に公開しない。
必要証拠: TLS・正確URL・raw body不変・署名前DB副作用なし・durable inbox保存後ack・再送復旧・rate/body/time上限・秘密値なしerror・専用DB/ロール・停止方法。
