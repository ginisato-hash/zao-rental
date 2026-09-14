# Vercel direct — 実deploy前の受入計画

状態: 実hosting受入NOT_RUN。専用Project/linkは作成済み、5件のPreview envはOwner直接入力済み。deployは未承認。現在のmetadata証拠と最初の限定Preview案は[承認前チェック](PREVIEW_APPROVAL_CHECKPOINT.md)を参照。
提案する試験環境はproduction domainを持たない、ZAO専用の保護されたPreviewと合成DB。Previewも実deployなのでOwnerの明示承認が必要。

現コード: Next16.3.4 / Node24.15.x / npm11.12.x / pg8.23.0 / @node-rs/argon2 2.2.1 / sharp0.35.4。package-lockを正本とし、実platformのNode patchが違えば差異と互換試験を記録する。Edgeへ移植しない。[Vercel Node runtime](https://vercel.com/docs/functions/runtimes/node-js)。

| 受入対象 | 承認後の試験 | 合格 / 停止条件 |
|---|---|---|
| Build/runtime | repo rootのlock固定setup、Next apps/webのbuild、deployment SHAを照合 | native依存を含めcold/warm invocation成功。黙ってversion変更しない |
| Argon2 | 合成passwordのhash/verify/不一致・staff loginを実Node functionで検証 | 平文/hashをログへ出さず成功。native module ABI/memory/CPU不明はFAIL |
| sharp | 合成画像のderivative作成とdecode、サイズ/EXIF/rights経路確認 | private originalをpublicへ返さない。画像hash/dimensionsだけ証拠 |
| pg/DB | TLS/CA、PGmajor、migration/extension/SECURITY DEFINER/role/grants、rollbackを専用DBで照合 | 本番DBやmigration強権限をruntimeへ渡さない。providerが必要権限/拡張を許さなければBLOCK |
| 接続数 | 全roleのPool数×warm instance数、concurrency/cold burst、abort/restart/idle終了を実測 | max=4がDB全体4接続ではない。待ち上限と解放、transaction/advisory lock/session stateのpooler適合を検証 |
| trusted peer | Vercel直結経路と選択project/deploymentを確認し、検証済dispatcherでだけRequestへbind | browser header/hostname/VERCEL env値だけでは信頼証明にしない。現在の未接続guardはfail closed |
| XFF偽装 | 許可した実Preview宛に合成XFF/X-Real-IP/内部identity値を送る | client値でpeerを選べない。生IPをログへ出さずHMAC識別比較で証拠 |
| clone/binding | routeへ渡る実Request、clone、新規Request、許可dispatcherの再bindを確認 | bind喪失は拒否。同じRequestへの違うpeer再bindは拒否。headerで補完しない |
| IPv4/IPv6 | canonical IPv4/mappedIPv6等価、IPv6圧縮、zone/list/不正拒否 | fixtureと実回線結果を分離。IPv6実接続がなければNOT_RUN |
| 起動設定 | 未設定/誤環境/期限切れkey/違うpolicy hash/異なるinstance設定 | DB/guest/recoveryを503等で閉じ、secretをerrorへ出さない |
| health/readiness | health、依存DB停止、必要config欠落、復旧 | /api/health成功だけでreadyとしない。必要なprovider/readiness本番routeはまだ未接続 |
| UI/session | 個別staff、guest20人、read-only booking recovery、logout/revoke/reload | Cookie secure/no-store/CSRF/role/store拒否を維持。実機は別途Owner実施 |
| cleanup/rollback | 対象deployment/専用DB/試験credentialだけを停止・失効 | 他projectを変更せず、対象IDと停止証拠を保存 |

VercelのXFF仕様は外来値を上書きすると説明するが、現コードを無条件header読取りへ変える根拠にはしない。[request headers](https://vercel.com/docs/headers/request-headers)。実際の入口/Request再生成/複数instanceで由来を実証してからadapterを採用する。Cloudflare前段は今回対象外。
DB poolはmodule単位再利用と確実なreleaseを検証し、Fluid computeのidle接続管理も候補にする。`attachDatabasePool`は現依存に未導入で、この文書だけで導入済みとはしない。[公式pool指針](https://vercel.com/kb/guide/connection-pooling-with-functions)。

重要な残コード境界: `bookingAccessRuntime()` と `public-runtime.ts` はNODE_ENV=productionで接続しない。`composeProductionGuestSecurity`/`createRequestPeerBoundary`は注入可能な部品であり実Vercelの接続実装ではない。secret設定だけで通常appが利用可能になると案内しない。選定環境が確定したら、承認された小さなproduction composition差分と独立レビューが必要。
Preview保護をguest機能の代替認証にせず、Webhookの例外到達は[専用receiver案](SECRETS_AND_RECEIVER.md#sandbox-https-receiver)で別途承認する。public activation/chargeReady=falseを維持。
