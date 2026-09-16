# P6 — Preview環境変数のmetadata確認とdeploy前停止

2026-09-14。Ownerが5件のPreview変数を登録済みと報告し、値を取得・表示せずmetadataだけを確認するよう承認した。Preview deploy・Square通信は未承認のまま。この追記はR2の継続で、予算や権限の追加ではない。

## 確認済み

Project ID `prj_ehUMOzM77em9DVnHJBJffncD5hg7`、Team ID `team_PVka5z4T6OMKBmUcqrK09yJz`、slug `zao-food-map` が一致。Team表示名は以前のZAO FOOD MAPから今回Yugeになっているが、ID/slugは同一。CodexはTeam設定を変更していない。

| key | 存在 | target | type / visibility |
|---|---|---|---|
| SQUARE_ENVIRONMENT | あり | Previewのみ | sensitive / secret |
| SQUARE_API_VERSION | あり | Previewのみ | sensitive / secret |
| SQUARE_SANDBOX_APPLICATION_ID | あり | Previewのみ | sensitive / secret |
| SQUARE_SANDBOX_LOCATION_ID | あり | Previewのみ | sensitive / secret |
| SQUARE_SANDBOX_ACCESS_TOKEN | あり | Previewのみ | sensitive / secret |

branch限定override・custom environment設定はなし。MERCHANT_ID / NOTIFICATION_URL / WEBHOOK_SIGNATURE_KEYの3件は未設定。Production対象のSquare変数0件。

導入CLI59.9.1の`env ls`はConfig値を出力する実装なので使用せず、既存CLI認証による`GET /v10/projects/{id}/env?decrypt=false`の非復号取得からkey/target/type/visibility/branch/custom targetだけを保存した。`env pull`、`env run`、個別value/decrypt API、実値の検査・表示・保存は行っていない。応答原文やvalue/legacyValue/comment等も保存しない。[Vercel一覧API](https://vercel.com/docs/rest-api/projects/retrieve-the-environment-variables-of-a-project-by-id-or-name)。

**metadata PASSは、値・空値・API版の正しさ、Tokenの有効性、Sandbox資格情報であることの実証ではない。** 実配置されたSQUARE_ENVIRONMENT/SQUARE_API_VERSIONの内容も未確認。コードの要求は引き続きSANDBOX / 2026-08-19。Ownerから値を再送させない。

Root `./`、Next.js、`npm run build`、Next default output、Node24.xはread-onlyのProject inspectで再確認。deployment件数0。Git integrationは未接続。Preview保護はall_except_custom_domainsで有効（変更なし）。local root/P6 linkは同じProject。P6の製品コード・migration・価格・決済・guest・Runnerの変更なし。

## config / preflight

- `sandboxAcceptanceEnvironment` は値を注入して検証するmetadata parserで、remote envを自動取得しない。今回の模擬入力テストでは未設定3項目を維持し、activationDISABLED・merchantLocationVerified=false。
- Sandbox設定、既存署名鍵preflight、production preflightの対象9テストPASS / skip0。全suiteの再実行や実DB再構築はしていない。
- 既存production preflightは読み取り専用で実行し **NOT READY / exit2**。Ruleset23161641はPASS、対象P6 headのFoundation CIはNOT_RUN。外部接続・税等のOwner gateも未解消。
- Secret storeのproduction gateはEXTERNAL_PENDINGのまま。Previewに5つの設定が存在することと、runtimeでの限定読取り・rotation・失効・復旧の実受入は別。
- P6 R2追加コードの独立レビューは未実施。旧P5のREVIEW_PASSを新しいP6全体へ流用しない。

証拠は `env-check-evidence/`。preflight対象headは`f5e6c2ef7efd413fd9e3e1248bb785eebb142344`、mainは`3061dbbbe00294e5baebba2405028c907d6e6e85`。この追記以後は文書/証拠のみの差分として記録する。

## 次に承認するPreviewの範囲案

対象Projectはzao-food-map/zao-rental。対象code/commitはP6の保存済みheadを実行直前に固定・照合し、既存local rootの保留PR3 branchをdeployしない。P6追加部のCI/独立レビューの未実施を残したまま、Square E2E済みや本番readinessを宣言しない。

最初のPreviewの目的は **Vercel build・Node起動・liveness・既存の拒否動作** の確認のみ。

1. 開始承認を受けてからdeployする。最初は1回、失敗/応答不明時は照合して停止し、無断の連続deployを行わない。Production targetやcustom domainは使わない。
2. `.local`、`.env*`、`.git`、他worktree、DB、ブラウザtrace、認証ファイルをuploadしない。対象commitのGit追跡ファイルから必要なapp/build入力だけを精査して送る。`.vercel/project.json`はlink metadataのみ。秘密値pullなし。
3. 現ProjectのRoot/Build/Outputを勝手に変えない。ローカル出力はapps/web/.nextなのでVercelのNext adapterによる検出は未実証。失敗時はbuild errorの安全な分類を保存し、設定差分を別途確認する。
4. deployment protectionを維持し、保護されたPreviewへOwnerがアクセスする。認証bypassや全体公開、secret付きURLは使わない。到達できなければOwner操作待ち。
5. `/api/health`はlivenessのみ。200をDB/Square/business readinessに読み替えない。noindex、private/no-store、未接続APIの拒否を確認する。実DB・staff/guestログインの結合成功はこの段階の目的外。
6. Secretの値をログ/環境dump/レスポンスへ出さない。今回の5件は通常appのSquare runtimeへ配線されていない。S1/PAYMENT/REFUND/Webhook/tokenization/外部lookupは一切起動しない。
7. deployment ID・commit/tree・結果・URL・失敗分類だけを保存。失敗/想定外公開は停止し、対象Previewだけの後片付けを行う。

今回はこの計画の保存まで。**Preview開始承認待ち**。まだ未設定の3項目や追加secretをOwnerへ要求しない。

## 継続して残る事項

最初のPreviewが成功しても、S1 merchant/location read-only composition、専用Sandbox DB/roleとruntime、署名HTTPS receiver/ack方針、trusted ingress、Web Payments tokenization、durable journal実受入は未接続。後続の実装/レビュー/実受入を省略しない。実Square要求0、payments0、refunds0、deploy0。
