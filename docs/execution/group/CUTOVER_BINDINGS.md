# 本番DB切替の束縛対応表（Issue #47 / TD #7219973419 §2-B）

> 外部への連絡は一切しない。本書と `scripts/production-cutover-bindings.ts` は**メタデータだけ**を扱い、秘密の値を受け取らず・出さない。機械可読の正本は `cutover-bindings.json`（`buildBindingTable('neondb','neondb_v65')`、sha256 `fddc3710…9fd60`）。

## 1. 切替対象は 3 つのプロジェクト＋ロール
| 場所 | 対象 | 切替内容 |
|---|---|---|
| メイン Vercel `prj_ehUMOz…` | `PRODUCTION_DB_NAME`(encrypted) | `neondb_v65` に変更（値の変更・非秘密） |
| 同上 | `PRODUCTION_DB_HOST`(sensitive) | **変更なし**（同じ Neon endpoint。fingerprint で確認） |
| 同上 | `PRODUCTION_DB_ROLE_<AUTH/LEDGER/HOLD/TRANSFER/PRICING/RECOMMENDATION/OPERATIONS/GUEST/CONTENT_READ/AVATAR_READ/BOOKING_ACCESS>`(encrypted、11個) | `neondb_v65_<service>` |
| 同上 | `PRODUCTION_DB_ROLE_GROUP` | **無いのが正**（`<DB名>_group` を導出。上書きがあると古いロールに固定されるため、あれば検出） |
| 同上 | `PRODUCTION_DB_PASSWORD_<上の11個＋GROUP>`(sensitive、12個) | 新規発行 |
| 同上 | `PRODUCTION_WORKER_DB_PASSWORD_{DISPATCHER,WORKER,PROJECTOR}`(sensitive、3個) | 新規発行。ロール名は `productionPaymentRoleNames(DB名)` から導出（ROLE 変数なし）→ `neondb_v65_pay_{dispatch,truth,projection}` |
| Webhook 専用 Vercel `prj_lQD8NC…` | `PRODUCTION_RECEIVER_DATABASE_URL`(sensitive、1個) | 新規：`postgresql の接続URI（ロール・パスワードは秘密）@<同じ直結host>/neondb_v65?sslmode=verify-full`。**このプロジェクトに DB 系キーは他に置かない** |
| GitHub Environment `production-backup` | secret `PGDATABASE` / `PGUSER` / `PGPASSWORD` | `neondb_v65` / `neondb_v65_backup` / 新規発行 |
| 同上 | `PGHOST` / `PGPORT` / `PRODUCTION_BACKUP_ACTIVATION` | 変更なし |
| DB ロール | `neondb_v65_*`（サービス12、worker3、receiver、diagnostic、backup） | 切替前 NOLOGIN。切替後に LOGIN（diagnostic を除く）。backup は `pg_read_all_data` のみのメンバー |

**変更しないもの**：Square の Webhook URL・購読・署名鍵・merchant/location、顧客の認証/アクセス/復旧鍵、Resend、R2、`AGE_BACKUP_RECIPIENT`、`CRON_SECRET`、公開許可、Neon の project/branch/endpoint。
**旧DB**：`neondb` は削除しない。切替後は全ロールを NOLOGIN（fence）にして、復旧用の参照として残す（`retainedOld`）。

## 2. 機械照合（`verifyBindings`）
値は見ない。key・type・target・`updatedAt`、およびロールの姿勢（存在、LOGIN、superuser/createdb/createrole、メンバーシップ）だけを照合する。検出する不整合：`MISSING` / `WRONG_TYPE` / `WRONG_TARGET` / `WRONG_PROJECT` / `STALE_CREDENTIAL`（発行時刻より前の資格情報）/ `OVERRIDE_PRESENT`（GROUP ロールの上書き）/ `FOREIGN_KEY_IN_WEBHOOK` / `FOREIGN_KEY_IN_MAIN` / `UNKNOWN_DB_KEY` / `ROLE_MISSING` / `ROLE_EXCESS_PRIVILEGE` / `ROLE_MEMBERSHIP_DRIFT` / `ROLE_LOGIN_STATE`（切替前は全て NOLOGIN、切替後は LOGIN 必須ロールのみ LOGIN）/ `OLD_ROLE_STILL_LOGIN`（切替後に旧ロールが LOGIN のまま）。

**本番の非復号 metadata との実照合（2026-11-27、読み取りのみ）**：期待キー37行のうち、メイン 15+12+3+1 ほか全てが期待どおりの key/type/target で存在。不足・型違い・誤プロジェクト・上書き・外来キー **0**。`STALE_CREDENTIAL` 19件は「まだ新DBの資格情報を発行していない」ことの確認（NEW_SECRET の 12+3+1+3 と一致）。ロールの姿勢は新DB作成後に `verifyBindings` へ読み取り結果を渡して照合する。

## 3. 切替の前に直す必要があった固定名（本PRで対処）
1. **`packages/auth/src/production-identity.ts`**：`EXPECTED_PRODUCTION_DATABASE_NAME='neondb'` の一致必須。これのままだと新DBでは**メインアプリの起動（hosting/commercial 構成）が `PRODUCTION_IDENTITY_WRONG_DATABASE_NAME` で停止**し、Webhook 受信も `parseProductionIngress` が拒否する。→ 許可リスト `PRODUCTION_DATABASE_NAMES = [neondb, neondb_v65, neondb_v65b]`（パターンではなく3つの名前のみ）に変更。host fingerprint と Vercel project fingerprint の固定は不変。Webhook の `PRODUCTION_RECEIVER_DATABASE_URL` も同じ許可リスト＋`<db>_pay_receipt` の一致を要求。
2. **`scripts/production-backup-credential.ts`**：`BACKUP_CREDENTIAL_TARGET`（database/role/manager が `neondb` 固定、凍結）。→ `selectProductionCredentialDatabase(db)`（許可リスト、role と manager は導出）と、CLI の `--database=neondb_v65` 引数。one-shot guard は DB ごとのファイル（`reset-attempt-<db>.json`。旧DBは従来のファイル名）。
3. **`scripts/production-worker-credential.ts`**：worker 3ロール名がモジュール読込時に確定していた。→ アクセスのたびに選択中のDBから導出。
4. **Backup workflow 自体は固定していない**（`PGDATABASE/PGUSER/PGPASSWORD` は secret から読む）ため、secret の更新だけで新DBへ移る。R2 の資格情報とバケットは変更なし。

**未対処（別担当・次の移行で必要）**：migration/installer 系の `scripts/lib/first-admin-bootstrap.ts`（`firstAdminDatabaseConfig` が DB `neondb` / owner を固定）、`scripts/lib/production-owner-session.ts`、`production-install-*.ts` の `'neondb'` 直書き、`scripts/production-activation-plan.ts`（初回導入の歴史的計画で `neondb` 固定）。新DBへ切り替えた**後の**将来の migration/grants にはこれらの DB 名の選択が必要。切替そのものには不要。

## 4. 資格情報の発行（値はチャット/ログ/ファイル/CLI引数に出さない）
既存の実証済みの流れを新ロールに適用する（`production-backup-credential` / `production-worker-credential` と同じ規律）。ロールごとに直列、**reset_password は1ロール1回・耐久ガード付き**：
1. 新ロールが NOLOGIN・無権限であることを確認。
2. manager（`neondb_v65_role_admin`）に `SET LOCAL ROLE` して、メモリ上の一時パスワードを `ALTER ROLE … NOLOGIN PASSWORD '<temp>'` で設定。**これが「NOLOGIN のロールでは Neon の Reset password が初回失敗する」既知事例の回避**（先に Neon 側が認識できるパスワード状態にしてから reset する）。
3. Neon API `reset_password` を1回。応答のパスワードはメモリのみ。
4. DB 時計から期限付き LOGIN、直結 verify-full＋channel binding で自ロールの姿勢確認。
5. Vercel は `vercel env add <KEY> production --sensitive` に **stdin** で渡す（`--value` 引数は使わない）。Webhook の URL はメモリ内で組み立てて同じく stdin。GitHub は `gh secret set` を stdin。
6. 書き戻し後に metadata（`updatedAt`）で確認し、`VALID UNTIL infinity`。失敗したらロールを封じ込め（NOLOGIN、PASSWORD NULL）、sink を除去。旧ロールのパスワード再発行や環境変数の一括 pull はしない。

**切替前の接続検証**（新DB作成直後、読み取り専用）：`verifyNewDatabaseConnection('neondb_v65', ports)`。Neon API の `connection_uri` が、(a) endpoint が一意、(b) host の fingerprint が固定値と一致・pooler でない、(c) URI の host/DB/role が一致、(d) パスワード長、(e) verify-full＋channel binding で実接続でき、(f) `current_database()`/`current_user`/`session_user` が期待どおり・非 superuser、を満たすかを確認する。結果は固定理由コードのみ（`ENDPOINT_AMBIGUOUS` / `HOST_FINGERPRINT_MISMATCH` / `CONNECTION_URI_LOOKUP_FAILED` / `URI_*_MISMATCH` / `CONNECT_FAILED` / `TLS_NOT_VERIFIED` / `DATABASE_IDENTITY_MISMATCH` / `OWNER_ROLE_MISMATCH` …）。失敗したら**停止窓に入らず**、新DB準備の範囲で正規経路を直す。

## 5. Owner の手動操作（一括・停止窓の前）
通常は**ありません**（Neon/Vercel/GitHub の既存認証で §4 を実行する）。次の場合だけ、その一覧を一度に出す：
- 特定ロールで `reset_password` が §4-2 の回避でも失敗した場合：Neon Console でそのロールの Reset password を実行し、値を表示せずに該当の Vercel Sensitive 変数（§1 の表のキー名）へ貼る。**対象ロールは失敗時にまとめて列挙**し、1つずつ依頼しない。
- それ以外（Vercel の再公開承認、停止窓の開始等）は TD #7219973419 により再要求しない。

## 6. 二重稼働の防止と Webhook・UNKNOWN 決済
- **同時に動かない**：fence で旧DBの全 runtime ロールを NOLOGIN＋残セッション0＋DBを read-only にしてからコピーする（`production-cutover.ts`）。新DBの runtime ロールは書込み可能化の境界まで NOLOGIN。worker は Vercel のデプロイ単位で DB が決まり、切替後の新デプロイだけが新ロールの資格情報を持つ。旧デプロイの資格情報は旧ロール（NOLOGIN）のままなので接続できない。
- **Webhook**：受信は DB 接続不能の間 `5xx` を返す（Square は再送する）。成功を偽らず、取り込み後は inbox の dedupe と reconcile ジョブで再照合される。URL・購読・署名鍵は不変。新 receiver ロールの権限・関数・inbox は bootstrap 65 と delta grants が `neondb_v65_pay_receipt` に付与し、`verifyBindings` のロール姿勢＋既存の `verify-target` で確認する。
- **UNKNOWN 決済**：コピーは行を逐語で移すだけで、状態遷移は一切しない。UNKNOWN（本番に1件）を自動で FAILED/COMPLETED にしない。切替後も既存の reconcile のみが provider の真実で更新する。

## 7. 実行順序（束縛の観点）
1. 新DB作成（`production:cutover-bootstrap-target`）→ `verifyNewDatabaseConnection` → ロール姿勢の `verifyBindings(PRE_SWITCH)`。
2. §4 で全 NEW_SECRET を発行（メイン12+3、Webhook1、Backup3）。`verifyBindings` の `STALE_CREDENTIAL` が 0 になることを確認。`PRODUCTION_DB_NAME` と `PRODUCTION_DB_ROLE_*` を設定。**この時点では何も公開されない**（環境変数は次のデプロイで有効）。
3. 候補 stage をデプロイ（現行 alias に影響なし）→ stage attestation＋2窓確認（書込み・外部副作用なし）。
4. 停止窓：fence→最終コピー→照合→LOGIN 化→promote→post attestation。
5. `verifyBindings(POST_SWITCH)`（旧ロールが LOGIN でないこと、新ロールが LOGIN であること）。
