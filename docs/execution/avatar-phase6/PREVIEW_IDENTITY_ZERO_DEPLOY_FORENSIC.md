> Historical zero-deploy checkpoint. The later FINAL_HOSTED_REPAIR.md supersedes its local-only next gate; its observations and counts remain historical.

# Phase6 PREVIEW_IDENTITY zero-deploy forensic

## A–H 結果

| 項目 | 結果 |
|---|---|
| A. exactPredicateEstablished | **NO** |
| B. predicate | **UNKNOWN** |
| C. evidence | Provider metadataは期待どおり。runtime process.envは未観測。sensitive値は公式CLIから取得不可。既存local buildではruntime評価を確認。 |
| D. proposedMinimalFix | 8つの固定identity enumへの診断分割のみ、ローカル実装済み。推測による条件変更なし。 |
| E. securityBoundaryChange | **NONE** |
| F. localValidation | **PASS** — unit638/638、lint、typecheck、build、secret scan、git diff --check |
| G. deploymentUsed | **0**（今回） |
| H. providerMutations | **0**（今回） |

## 結論と根拠の区別

attempt4の既存GETはHTTP503 / PREVIEW_IDENTITYでした。この既存応答は8条件のどれが失敗したかを区別しません。今回、アプリへの再GET、Hosted E2E、deployは行っていません。今回許可されたzero-deploy調査だけでは、実際に失敗したpredicateを確定できませんでした。診断を配備せずに得られた証拠から、特定条件の緩和やenv修正は正当化できません。

**OBSERVED_PROVIDER_METADATA**: exact deployment `dpl_2HAREDuFGBcRNXyKNbiaU4qkMuZZ`、project `prj_EonVxKra8p9txdZ7O2Ko6t1A8biW`、hostname `zao-rental-avatar-preview-dkbmsa00j-zao-food-map.vercel.app`、canonical target `preview`。deployment詳細のraw targetはnullであり、providerのtarget=preview一覧にexact IDが存在することと合わせて分類しました。metadataのrefは `codex/avatar-phase6-hosted-preview`、SHAは `0122451a4d2e2910bb3219912df922babd5a2cdb`。Authentication設定は `all_except_custom_domains`、System Environment Variablesの自動公開設定はtrue、Git integrationは未接続です。これらはruntime process.envの等値証明ではありません。

Preview envは `ZAO_AVATAR_PHASE6` / `ZAO_HOSTED_PREVIEW_RUNTIME` の2件だけで、両方ともtype=sensitive、target=preview、gitBranch=nullでした。SQUARE_*、PAYMENT_*、REFUND_*、WEBHOOK_*、DATABASE_URL、POSTGRES_URL、PGPASSWORD、unexpected ZAO_* の設定名件数は各0です。これも設定metadataであり、runtime全キーの直接観測ではありません。

## Configured env の安全な検証

公式CLI59.9.1の `vercel env run -e preview --project <exact project>` を、空の作業ディレクトリ、ZAO_*を継承しない最小限の環境で実行しました。子プロセスは指定されたbooleanのみを返し、providerのraw応答・stdout/stderrはメモリ内で処理しました。envファイルは作成していません。

```json
{
  "ZAO_AVATAR_PHASE6": {"exists": true, "exactExpectedValue": false},
  "ZAO_HOSTED_PREVIEW_RUNTIME": {"exists": true, "jsonParseable": false, "expectedTopLevelShape": false}
}
```

**このfalseは、実際に保存されたmarkerの不一致やruntime JSONの破損を示しません。** CLIはsecret値が取得不可である旨を返しました。上記はローカルへ取得できた環境の検査結果であり、実際のsensitive値の等値・構造はともにUNKNOWNです。公式のdeployment ID指定download経路も利用可能なenv payloadを返さず、runtime値の追加証明は得られませんでした。取得不可の結果を繰り返し試していません。

公式資料はlegacy sensitive値をSecretとして扱い、deployment時のみ復号可能としています。この制約と検査結果は整合します。[Vercel sensitive environment variables](https://vercel.com/docs/environment-variables/sensitive-environment-variables)、[Vercel env CLI](https://vercel.com/docs/cli/env)。

## 公式semanticsとruntimeの未確認範囲

| 項目 | DOCUMENTED_GUARANTEE（文書上の契約） | 今回のruntime観測 |
|---|---|---|
| VERCEL | system env公開設定のもと、build/runtimeのVercel実行識別値 | UNKNOWN |
| VERCEL_ENV | build/runtimeのstandard environment識別 | UNKNOWN |
| VERCEL_TARGET_ENV | build/runtimeのstandard/custom environment識別 | UNKNOWN |
| VERCEL_PROJECT_ID | build/runtimeのproject識別子 | UNKNOWN |
| VERCEL_URL | build/runtimeのschemeなしdeployment hostname | UNKNOWN |
| VERCEL_GIT_COMMIT_REF | build/runtimeのdeploymentを起動したGit refとして説明 | Git-unlinked CLI経由での注入の厳密な保証は確定できず |

これは公式文書の記述であり、この実行環境が各値を返したという意味ではありません。[Vercel system environment variables](https://vercel.com/docs/environment-variables/system-environment-variables)。

installed CLIの `createGitMeta()` はproject linkが無い場合もlocal Gitのoriginへfallbackし、commitRef/SHAを作成してdeploymentへ渡します。ただし、クライアントがmetadataを送信することはVercelサーバーが同じ値をruntimeへ注入する証明ではありません。`VERCEL_GIT_COMMIT_REF` の今回の厳密な注入規則を、この文書とclient sourceから断定できませんでした。既存の「ref absentは許可、presentならexact branch必須」は変更していません。

**LOCAL_ASSUMPTIONとして退けたもの**: metadataのtarget/project/ref/hostnameが正しいからprocess.envも一致する、取得できないsecretのboolean比較がfalseだから設定誤りである、Git-unlinkedだから必ずrefが欠落する、という推論はいずれも採用していません。各8predicateのruntime上の真偽はすべてUNKNOWNです。少なくとも1つが失敗したことのみ、既存coarse stageが示しています。

VERCEL_URLの文書にはStandard Deployment Protectionとの併用に関する注意もありますが、それだけでは変数が欠落するという証明になりません。これを理由にURL境界を緩めていません。

## 既存local buildとexact sourceの検査

変更前に、identity/config/runtime/diagnostics/guest route/Next config/Vercel config/package-lockの計7ファイルがdeployed source commit `0122451a4d2e2910bb3219912df922babd5a2cdb` と一致することを確認しました。

既存 `.next/server/chunks/9916.js` を上書き前に退避し、SHA256 `f020354d40dbf123e399a97df665b8f9a6fb670b8bbbd4ef7bca9fac4d5c8395` を記録しました。compiled functionは引数の各env propertyを参照し、呼出側にも `process.env` が残っています。同じcompiled functionにsynthetic環境を渡し、妥当な入力の成功後、引数のVERCELを変更すると拒否されることを検証しました。検査したlocal artifactではidentity判定のbuild-time foldingはありません。

Next configにenv overrideはなく、installed Next16.3.4のstatic-env/define-env処理も確認しました。ただしVercel上で生成されたfunction bytesとの比較は行っていません。したがって、remote artifactやremote runtimeで変換・注入の問題が無いとまでは断言できません。今回のbuild検証は、保存済みの旧artifactの検査を終えてから、準備した修正に対して実行しました。

## D. ローカルに準備した変更

- `packages/auth/src/hosted-preview-config.ts`: 既存のcompound identity検査を同じ順序・同じ条件の8検査へ分け、固定stageだけを持つ `PreviewIdentityError` を投げる。
- `apps/web/src/lib/hosted-preview-runtime.ts`: identity errorの固定stageをstartup catchで保持する。他の初期化失敗は既存の固定startup stageのまま扱う。
- `apps/web/src/lib/hosted-preview-diagnostics.ts`: allowlistされた固定stageのみをHTTP503へシリアライズする。不正stage/任意例外はUNCLASSIFIED。raw値、cause、stackは出力しない。
- `tests/unit/hosted-preview-diagnostics.test.ts`: 8predicate、必須値欠落、absent-ref許可、forbiddenキーの値に依存しない拒否、偽stage、cause/stack非出力を検証する。

固定stageは `IDENTITY_VERCEL`、`IDENTITY_ENV`、`IDENTITY_TARGET_ENV`、`IDENTITY_MARKER`、`IDENTITY_PROJECT`、`IDENTITY_GIT_REF`、`IDENTITY_URL`、`IDENTITY_FORBIDDEN_ENV` の8件です。認証・origin・ref・project・禁止envの判定条件は変わっていません。確定したprovider semantic mismatchがないため、挙動を変えるfixは追加していません。

## F. ローカル検証

| 検証 | 結果 |
|---|---|
| Node / npm | 24.15.0 / 11.12.1 |
| full unit suite | PASS 638、FAIL 0、skip 0 |
| lint | PASS |
| typecheck | PASS |
| build | PASS |
| secret scan | PASS（repository pattern scanには検出範囲の限界あり） |
| git diff --check | PASS |

秘密値をchat、証跡、repoへ保存せず、provider応答から許可されたmetadata/booleanだけを保持しました。過去のmetadata incidentをゼロへ書き換えるものではありません。

## 状態と残るgate

canonical branchは `codex/avatar-phase6-hosted-preview`。local HEADと取得済みorigin refはともに `2290e66db551d2ce2a961abbd836c9464b1e97a6` です。working treeには今回の4つのsource/test変更と2つのforensic記録があります。**未commit・未push・未deployのローカル準備**であり、既存status/stop recordは変更していません。

今回のdeploy、provider mutation、readiness再probe、Hosted E2E、Claude、Neon/R2操作、Production変更、main mergeはすべて0です。deploy履歴4/4 consumedは維持します。過去のProduction deployment/aliasは2/2、直前のreadbackにおけるcurrentは1/1のstatic bootstrap、Production env0です。今回はProduction readbackもcleanupも実施していません。Hosted PASS前にbootstrapを削除する条件は満たされていません。

現在の分類は `STOPPED_CORRECTIVE_PREVIEW_READINESS_503_PREVIEW_IDENTITY` のままです。root causeおよびHosted acceptanceは未確定であり、Phase6 PASSとは判定しません。このforensicの結果とlocal diagnosticsをOwnerが評価する段階で停止します。attempt5の依頼・実行、Phase7への継続は行いません。
