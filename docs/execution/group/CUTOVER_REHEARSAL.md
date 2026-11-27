# 0065 の外部依頼なし前進：新DB構築＋データ切替の合成リハーサル（Issue #47 / TD #7214138953 §A）

> 外部への連絡・問い合わせ・依頼は一切しない。本書は設計と**隔離PG・合成データ**での実証であり、本番では何も実行していない。実本番の作り直し・切替は **Owner の明示承認が前提**。

## 結論
`tests/operations/production-cutover.ts`（`npm run test:production-cutover`、15ケース）が PASS。Neon 形状の 0001–0064 DB（source）から、正規ブートストラップで作った 0001–0065 DB（target）へ、データを欠落・変形なしで移し、停止窓・照合・rollback・二重 worker 防止・監査を実証した。0065 は target に**ネイティブ**で入る（owner の 42501 問題は発生しない）。

## 実証した内容（§5.2 の 1〜4）
1. **取り込み順序と整合**（`scripts/production-cutover.ts`）
   - 全テーブルを `to_jsonb → jsonb_populate_recordset` で逐語コピー。ALWAYS identity は `OVERRIDING SYSTEM VALUE`、sequence 位置は source の `last_value` と一致（欠番も保持）。
   - 追記専用・監査トリガは表ごとに `DISABLE TRIGGER USER`（owner 権限のみ・スーパーユーザー不要）→ 取込 → `ENABLE`。終了後に全トリガが `O` であることを再確認。
   - 団体表の FK 循環（`group_orders↔group_quotes`）と自己参照（`group_payments.reverses_id`）は、コピー**トランザクション内だけ** `DEFERRABLE` にし、`SET CONSTRAINTS ALL IMMEDIATE` で検査してから元の定義へ戻す。コミット後のスキーマは不変（`schemaState` 同値で証明）。
   - 取込対象外：`foundation_migrations`（各DBの bootstrap が書く）と、executor 所有の取引内一時テーブル3つ（`rental_internal.effects` ほか。1トランザクション内で INSERT/DELETE されるため静止時は空。owner は読めないので統計で0を確認し、設計上は runtime セッション0で保証）。
   - 0065 で増える `rental_loan_items.group_part_id/hold_id`（NULL）と `group_part_preparations`（空）は許可リスト方式。それ以外の差異は拒否。
2. **同一性検証**：全テーブルの件数と内容ダイジェスト（fixture = source = target）、全FKを anti-join で再証明、sequence 位置、registry（source=0064／target=0065 の正本checksum）、schema/ACL/owner/関数/トリガ状態が取込前後で不変、ephemeral 作成者ロール残存0、executor メンバー0、追記専用ガードが生きている（更新拒否 `23514`）、予約と団体の同一資産日の競合が拒否される。
3. **切替設計**（`runCutover`）：preflight → fence → copy → reconcile → enable-writes → switch → post-switch。
   - **停止窓＝コピー時間**（CDC なし）。fence は runtime ロールを NOLOGIN（manager 経由）＋セッション終了＋DB 既定を read-only。「runtime セッション0」を証明できなければ中止（`CUTOVER_FENCE_SESSIONS_REMAIN`）。
   - target は検証完了まで `default_transaction_read_only=on`。この間は rollback で何も失わない（fence 解除のみ）。**enable-writes 以降は前進修正のみ**で、source は fenced のまま（二重 writer を作らない）。
   - 二重 worker 防止：fence 後に reconciliation lease・送信中通知0を確認、source は read-only 固定、target の runtime ロールは Owner が資格情報を出すまで NOLOGIN。
   - 失敗注入：preflight/fence/copy/reconcile は rollback、switch は forward-fix-only、copy 中の失敗はトランザクションごと元の状態、改ざんは digest で検出し再実行で置換。
   - 監査は `{seq,step,at,detail,prev,hash}` のハッシュチェーン（件数・digest・名前のみ。行内容なし）。改ざん検出をテスト。
4. **migration 専用管理権限の限定・失効・監査**：
   - 現行の bootstrap は ephemeral 作成者ロールを最後に DROP するため、**新DBでも将来 executor 所有関数に触れる migration は再び 42501** になる。
   - 案B（推奨・要Owner判断）：executor を作ったロールを `NOLOGIN NOINHERIT CREATEROLE` の**休眠管理ロール**として残す。owner は `SET ROLE` でのみ到達でき、窓を開く（`GRANT executor TO owner WITH SET, INHERIT`）→ migration → 窓を閉じる（REVOKE）。窓の間以外は owner に executor 権限なし（窓なしで `CREATE OR REPLACE` は `42501`）。テストで実証済み（PG の非スーパーユーザー CREATEROLE owner）。bootstrap 本体への組込みは**未実装**（manifest/provenance の再承認が必要）。

## 実装した周辺
- `installGroupRoleOnFoundation65`（`scripts/production-group-delta.ts`）：bootstrap(0065) の DB に団体ロールと custody-link の operations 権限を入れる。既存 installer は registry 0064 専用で 65 では拒否されるため。
- `installDeltaGrantsOnFoundation65`（`scripts/production-cutover.ts`）：0059–0063 delta installer が本番に入れていた runtime 権限（staff/customer/sales-stop/coupon）を、各 installer の生成関数・proof で入れる。**これが無いと target は source より権限が少ない**（実測：customer_profiles 等の ACL が空）。

## 切替が前提とする事実（実測）
- target DB 名は新しい名前にする。executor 名が `<db>_custody_executor` で guard に埋め込まれるため **DB のリネームは使えない**。切替は接続先の変更。
- target の runtime ロール名は `<target>_*` で source と別。Owner がパスワードと LOGIN を発行し、Vercel の環境変数を切り替える（Owner 手順）。

## 未実証（NOT_RUN）
- Neon 実環境で owner が runtime セッションを終了できるか（`pg_signal_backend`）。テストは「権限なし→中止→rollback」と「権限あり→成功」の両方を実証。実環境が前者なら、Owner がアプリを止める運用が必要。
- 本番相当の実データ量・所要時間（秒単位の見込みだが未測定）。
- Vercel の資格情報切替、target runtime ロールの資格情報発行、Neon pooler 経由セッションの扱い。
- 案B の bootstrap 組込み。0057–0063 以外の将来 delta の grants。
- 本番の復元証拠（登録64本・24時間以内）と切替直前の最終バックアップ。

## 境界
実本番の新DB作成・データ移行・切替、新規有料環境、破壊的変更は Owner の明示承認が前提。age 鍵の再要求や本番データの隔離環境への移送はしない。
