# Avatar 2D/2.5D — A0 repository inspection

検査日: 2026-09-15。基点はリモート照合済みR15終端
`543d4fc6a5f7ebb102fdb1faffee6be5f9cb6d8b`（main起点ではない）。
作業ブランチ: `codex/avatar-2d-foundation`。
[正式継続指示](../execution/PRODUCTION_P6_R15_CONTINUATION_AUTHORITY.md) §23/29により、
R15が `BLOCKED_NEON_TERMS_PROPAGATION` の現在は **A0調査・A1 ADRのみ**。
この文書は実DB・API・rendererの実装完了を示さない。

## 実測した構成

値は基点のpackage.json・lockfile・実装から取得。最新製品版の推奨表ではない。

| 項目 | 現repoの根拠と結果 | Avatarへの適用 |
|---|---|---|
| Web | [package.json](../../package.json): Next.js16.3.4 / React19.3.0、[apps/web](../../apps/web)、App Router | 既存アプリを維持。新Webアプリ・UIなし |
| Runtime/package | Node24.x、npm11.12.x、packageManager npm@11.12.1、単一root package-lock | 別package manager・依存追加なし |
| TypeScript | 5.9.3、[tsconfig](../../tsconfig.json): strict/noUncheckedIndexedAccess/exactOptionalPropertyTypes、contracts/core/dbのpath alias | 既存型境界を再利用 |
| DB/query | PostgreSQL、pg8.23.0、drizzle-orm0.45.2 | Prisma・ORM変更なし |
| Queryの実態 | [db/src/index.ts](../../packages/db/src/index.ts)・[schema.ts](../../packages/db/src/schema.ts) はDrizzleによる基盤metadata/telemetry。業務サービスはpg Pool/PoolClientの明示SQL・transaction中心 | 全テーブルがDrizzleモデルであると誤認しない。drizzle.config.tsは存在せず、Drizzle Kit生成を仮定しない |
| Migration | 同index.tsの明示migrationPlan、SQL、SHA256、履歴prefix照合、単一transaction/advisory lock、rollback/finally release | additive SQLと計画への明示登録を後続で使用。適用済みファイル改変なし |
| 現最新migration | [0029_development_payment_scope.sql](../../packages/db/migrations/0029_development_payment_scope.sql)。0001–0029の29件が明示計画と一致 | 今回追加0。A2開始時に再確認して次番号を決める。0030予約なし |
| local DB | [scripts/worktree.ts](../../scripts/worktree.ts) のcanonical path→namespace/DB/role/port。既存embedded-postgres18.4.0-beta.17起動系。ambient DB拒否、ポート衝突で停止 | 今回DB起動0。A2許可後のみ別worktree固有の実PG、既存停止手順 |
| 認証 | better-auth1.7.4 / @node-rs/argon2 2.2.1。既存staff/session/permission/store scope | visualのための認証免除や権限追加なし |
| テスト | Node --test + tsx4.23.13、AJV8.20.0、既存実PGと通常UI結合、[verify](../../scripts/verify.mjs) | 今回は文書・差分・正本検査だけ。将来検証をskip/PASSにしない |
| Playwright | 1.63.0、[playwright.config.ts](../../playwright.config.ts): workers1/retries0、loopback、Desktop ChromeとiPhone13寸法のChromium | 実iPhone Safari検証ではない。Avatar UI/E2E起動なし |
| ADR | [docs/adr](../adr) の連番Markdown、Status/authority/境界/検証・制約を記載。最新0032 | [0033](../adr/0033-avatar-2d-foundation.md) は設計採用、実装は条件付き保留 |

## 推薦の正本・候補名・保存境界

[contracts/recommendation.ts](../../packages/contracts/src/recommendation.ts) と
[入力Schema](../../packages/contracts/src/recommendation-input.schema.json) が正本。
`Direction = RECOMMENDED | SHORTER | LONGER`。概念上のrecommended/short/longはそれぞれの写像であり、enumのrenameや候補再計算ではない。
`MemberRecommendation` はkey、targetCm/minCm/maxCm/bootCm、initialLengthCm、
`Record<Direction, Candidate|null>`、checks/reason/price/priceErrorを持つ。
`Candidate.lengthCm` と `Candidate.member`（確保条件）を分け、visualはlengthCmのコピーだけを使う。

`Profile` はSKI/SNOWBOARD/WEARを区別。WEARのみはheightCm/footCmがnullで、
現候補lengthCm=0は用品選択の内部表現。これを0cmスキーの画像へ写像しない。
SKI/SNOWBOARDの現height−20±15・foot+1、cm/CM/Cm解析、年齢/クラス、明示選択は不変。
今回の相対**スキー**長可視化をSnowboardやWear-onlyへ勝手に適用しない。

[RecommendationService](../../packages/core/src/recommendation/recommendation-service.ts):
options/list/get/preview/advisory/select/resume。preview自体は既存推薦レコードを保存する。
候補ごとに全構成品のHoldService.availability→rankCandidates、価格参考表示はQuoteService。
selectは保存済み候補を明示選択し、HOLD/見積用の固定キーをdurable intentへ保存、resumeが既存ドメイン処理を再開する。
**visual mapperを「推薦previewはread-only」と誤解して呼出し直してはいけない。**
Mapperは既に認可・計算された結果の表示用コピーだけを入力にする。

スタッフ経路は [recommendation-http.ts](../../apps/web/src/lib/recommendation-http.ts)、
[route](../../apps/web/src/app/api/recommendations/[[...record]]/route.ts)。staff/session、
HOLD_VIEW/QUOTE_VIEW、変更時のHOLD_EDIT/QUOTE_CREATE、Origin、所有者・店舗検査を維持。
Guestは別actorと [guest-http.ts](../../apps/web/src/lib/guest-http.ts)、
[public-runtime.ts](../../apps/web/src/lib/public-runtime.ts) から同一推薦サービスを使用し、公開候補filterを通す。
候補表示はgroup HOLD成功保証ではなく、最終select/HOLDが全員分を原子的に再検証する。

## 商品・現物・画像の境界

[0002 ledger](../../packages/db/migrations/0002_ledger.sql)、
[0012 catalog](../../packages/db/migrations/0012_integrated_wear_catalog.sql)、
[0013 wear](../../packages/db/migrations/0013_wear_quantity.sql)、[ledger contract](../../packages/contracts/src/ledger.ts) を確認。

- 安定したモデルマスター `ledger_models.id` はUUID。variantはmodel_id、family、age、tier、size/size_keyを持つ。
  catalog_seasonはモデル側。既存のversionは編集競合用であり、visual画像revisionや別のメーカーeditionへ読み替えない。
- `ledger_assets` は物理用品のみ。スキー・両種ブーツは1組=1 Asset、Snowboardは1枚。ラベル枚数は資産数ではない。
- POLEはPAIR数量。JACKET/PANTSは `wear_pools` 等のサイズ別数量・履歴で、Assetなし。
  visualレコード・画像枚数は在庫・販売セット・数量へ一切加算しない。
- PREMIUMは既存modelPromiseのmodelId/season/variantIdと長さ/specを維持。
  REGULARの同長候補は複数variant/modelを含め得るため、無条件で先頭モデル写真を選んでモデル確約に見せない。
  汎用参考画像またはnullにし、予約条件は変更しない。
- 後続のnullable model/variant参照先は既存IDを候補とする。Avatar専用商品masterを増設しない。

## Media/CMSと管理画面

[storage-port.ts](../../packages/core/src/content/storage-port.ts) はprivate immutable digest storeと
release grantに基づく `/media/<sha256>/<width>.webp|jpg`。前後のgrant再確認とdigest検査がある。
[provider-media.ts](../../packages/core/src/content/provider-media.ts) の永続object keyは
`private/original/sha256/<hash>` / `private/derivative/sha256/<hash>`。
原本private、公開derivativeはCMS rights/revision/releaseが正本。署名URLは一時的で永続参照ではない。
[R2 adapter](../../packages/core/src/content/r2-media.ts) は既存依存を利用するが、実provider接続成功を意味しない。

現開発用 [PostgresPhotoStore](../../packages/core/src/content/postgres.ts) は
[0020](../../packages/db/migrations/0020_content_media.sql) のbytea保存を利用している。
これをAvatar新規テーブルへ複製しない。Avatarはdigest/key metadataだけという設計にし、現開発adapterは壊さない。
現 [photo pipeline](../../packages/core/src/content/media-plan.ts) のbindingはSKI/SNOWBOARDモデル写真を対象とする。
generic avatar/wear/boots素材が既に登録・権利確認済みとは扱わない。将来適応が必要で、今回は新CMS・storage・uploadなし。
権利取消/期限切れ/無効な素材はfallbackからも除外する。

通常管理パターンは `/staff/content` と `/api/content`、
[content-http.ts](../../apps/web/src/lib/content-http.ts)、[content-session.ts](../../apps/web/src/lib/content-session.ts)、
PostgreSQLの `content_staff_access`（CONTENT_EDIT/BULK/PUBLISH）とfresh staff/session照合。
`/admin` と `/api/admin` は基盤の拒否/準備中経路で、完成済み汎用adminではない。
Avatarの新しい管理UI・権限は今回作らない。

## Feature gateと後続確認

apps/web/src・packages・scriptsのfeature/Avatar名称、package依存を調査し、共通Avatar flag registryや
既存Avatar実装は見つからない。現接続はserver-only runtimeの明示configとproduction拒否、
[guest production composition](../../packages/core/src/guest/production-composition.ts) 等の注入境界で制御される。
一般SaaS flagを新設しない。今回renderer/route/flag追加0なので実質OFF。

A1に矛盾を起こす新ORM・新model masterの必要はない。一方、A2/A3実装着手はR15人間gate解消まで保留。
名前だけ参照された「Implementation Package v1.0」本体・DDL・画像は今回の入力に存在せず、閲覧済みとは扱わない。
本調査/ADRは正式継続指示に列挙されたproduct decisionsと実repoのみを根拠とする。
将来のA2/A3ではmigration最新番号、nullable参照、active/default fallback制約、権利連携を再確認し、
empty/current-schema upgrade・候補不変・missing visual・DB/業務回帰を実装して検証する。
そのテストは**今回未実施**。
