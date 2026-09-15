# ADR 0033 — Optional 2D/2.5D avatar visualization, independent of rental authority

Status: **Ownerが設計方針を採用。A0/A1のみ記録済み。A2/A3未実装・条件付き保留。**
Date: 2026-09-15 JST.
Base: R15 remote terminal `543d4fc6a5f7ebb102fdb1faffee6be5f9cb6d8b`.
Authority: [R15 continuation + Avatar foundation](../execution/PRODUCTION_P6_R15_CONTINUATION_AUTHORITY.md) §23–41.
Inspection: [A0実測](../architecture/avatar-2d-repo-inspection.md).

## Context and decision

予約・決済・QR・貸出返却が優先。今回の可視化は顧客身長と既存候補の物理スキー長の相対関係を
理解する補助で、適合保証、安全判断、在庫保証、価格/支払成功、予約可能性の判断ではない。
2D/2.5Dのlayered compositionを採用し、初期素材はmale visual1/female visual1を計画する。
これは素材数の計画で、制作・登録・権利確認済みという意味ではない。
`avatarType` は見た目の選択だけ。業務の性別分類・身体推定・推薦・価格・商品利用可否に使わない。
選択を必須入力にせず、未選択でも既存フローが成立すること。

JACKET/PANTS/bootsは任意layer。3D/WebGL必須/AR/カメラ/写真upload/pose estimation/
body scanning/AI試着/cloth simulationは対象外。将来3D化には別ADRとOwner範囲承認が必要。

## Authority separation

データフローは既存認可・推薦結果→任意visual表示情報の一方向。
逆向きのvisual→推薦再計算・選択変更・HOLD・在庫割当・金額・決済・QR・custody・refund・安全判定を禁止する。
既存RecommendationService.previewはDB保存を伴うため、visualを更新するために再呼出ししない。
候補や対象利用者の認可・セッション・店舗/所有者検査を緩めない。
visual障害は任意情報の欠落に留めるが、元の推薦/auth/businessエラーを成功へ変換しない。

`Candidate.lengthCm`、`MemberRecommendation`、`Profile`が正本。
RECOMMENDED→recommended、SHORTER→short、LONGER→longは概念上の対応のみで既存enumは維持。
身長−20±15、足+1、cm/CM/Cm、年齢/クラス制限や全期間成立性をvisual側で再判定しない。
null候補を画像で補完して候補があるようにしない。
WEAR-onlyの内部lengthCm=0/身長nullから比率を生成しない。Snowboardへスキーの見え方を代用しない。
PREMIUMのexact model/season/variant/length/specとREGULARのモデル非確約を保持する。
汎用参考画像は実貸出個体・モデル確約と表示しない。

将来renderer用の表示式だけを定める:

- skiToBodyRatio = 既存candidateのskiLengthCm / customerHeightCm
- skiDisplayHeightPx = avatarBodyHeightPx × skiToBodyRatio

正の有限値が得られない場合は可視化を省略する。これはpresentation-onlyであり、
サイズ推薦、DIN、BSL推測、最終安全適合の計算には使用しない。

## Data and media direction (not a migration)

既存PostgreSQL/pg/Drizzle・明示SQL migration方式を維持。新ORM/Prisma/CMS/storage/3D依存を追加しない。
将来のavatar/ski/boot/wear/fallback visual metadataは物理台帳から独立させ、必要なら既存
ledger_models.id / ledger_variants.idへnullable参照する。業務modelを作って画像を登録する方式は採らない。
SKI/bootsの1組Asset、POLE PAIR、wearサイズ別数量を変えず、visual rowsから数量を生成しない。

画像bytesを新visualテーブルへ保存せず既存immutable digest/object key方式に合わせる。
短期signed URL、原本URL、秘密値は永続visual fieldにしない。
現在の開発用content_media_objects byteaやpayment migrationsを作り替えない。
UUID/created_at/updated_at、active/disabled、安定sort、normalized anchor ratios、soft-disableを設計方針とする。
具体的DDL/制約はA2時に実測した次migrationで定義し、今回番号やSQLを予約しない。

current rights/revision/releaseで使用が許可されたderivativeのみ返す。
現在のモデル写真bindingを汎用avatarの完成済み素材契約と見なさず、後続で別用途の権利境界を確認する。
rights revoked/expired/internal-onlyはどのfallbackでも公開しない。
外部storage accessやsigned URL生成をpure mapperへ入れない。

## Fallback and default OFF

全visual rows0・inactive・素材欠落・rights失効・任意読取失敗でも元の予約フローはそのまま使用できる設計とする。
将来の解決順は、候補promiseと一致するactiveかつ許可済みの素材→同じ表示用途のactive/許可済み
汎用fallback→null。fallbackも見つからなければ画像を省略し、候補数値と説明を残す。
missing候補をfallbackで作り出さず、異なる商品・model/season/lengthを黙って代用しない。
複数defaultや同順位候補の曖昧性をDB/queryで拒否または明示解決する方針とし、ランダムに選ばない。

feature defaultはOFF。現時点はrenderer・route・flag自体を追加しないため、ONになる経路はない。
A3の将来payloadもoptional、version1、元の推薦レスポンスと意味を保持する。
新しいflag SaaSや環境変数の万能ONを作らない。将来のUI ONは別authority。

A3で表現すべき要素はversion、avatarType（appearance）、customerHeightCm、avatar ref、
既存Directionごとのcandidate visual ref/元skiLengthCm、任意boot/jacket/pants、fallback marker、
空でないdisclaimer。これは設計項目であり今回API型/handler/serializerは追加しない。
説明は「相対的な見た目の参考であり、適合・安全・在庫・モデル/予約/決済確定を保証しない」意味を保つ。
最終公開文言・翻訳は公開前レビュー事項。

## Validation and sequential gates

R15は `BLOCKED_NEON_TERMS_PROPAGATION`。従ってこのbranchの成果はA0/A1文書だけ。
A2 schema/API/query/pure mapper/test実装、A3適用、local DB起動は今回0。
[進捗](../execution/AVATAR_FOUNDATION_STATUS.json) にR15 base/readback、調査根拠、文書検査を保存する。
文書しか変わらないため既存製品コード・29migration・推薦値は差分不変で確認し、
過去510 tests /31 local DB checksを新しいAvatarテスト結果へ読み替えない。

R15人間gate解消後にA2/A3へ進む際は以下を検証する（**未実施**）:

- additive migration: 空DB/current schemaからの適用、過去hash不変、nullable参照、inactive/default一意性。
- zero visuals / inactive / fallback不足 / nullable modelで既存推薦と予約・在庫・payment・QR/custodyが不変。
- mapperのdeterminism、全Directionの長さ/候補一致、auth維持、missing visualで任意情報のみnull。
- business write/POST/provider呼出0、featureOFF、secret scan・lint・typecheck・buildと関連回帰。

A0/A1だけでこれらが証明されたとは扱わない。A2/A3が将来合格しても、Phase4以降の
AvatarFitPreview、画面切替、overlay、booking UI insertion、admin編集、visual E2E、画像本番投入へ
自動移行しない。新PR/main merge/production deploymentも今回0。
