# 本番切替手順：新しい DB（0001〜0065）への移行（Issue #47 / TD #7214138953 §A）

> **外部への連絡・問い合わせ・依頼は一切しない。age 鍵も要求しない。** 実行は Claude 側。Owner だけが行うのは「資格情報（LOGIN とパスワード）」「Vercel の環境変数」「再公開の承認」だけ。
> 実装：`scripts/production-cutover-run.ts`（合成 PG で 12 ケース PASS：`npm run test:production-cutover`）。本書の数値の見込みは**実測ではない**（未実証）。

## 0. 仕組み（1 分で）
- 既存の `neondb`（登録 0001–0064）は**そのまま残す**。削除・切り詰め・書き換えはしない。切替で変わるのは、(a) 実行時ロールの LOGIN を止める（fence）、(b) DB の既定を読取専用にする、の 2 点だけで、どちらも戻せる。
- 新しい DB `neondb_v65` を、実証済みの正規ブートストラップで 0001〜0065 まで構築する（0065 は最初から入る。owner の 42501 は起きない）。
- データを全行コピーし、全表の件数と内容ダイジェスト・sequence・外部キーを照合して、一致したときだけ書込み可にする。
- **復旧の土台＝残してある `neondb` 自体**（age 鍵も Neon 側の操作も不要）。preflight が件数・ダイジェストを記録し、`RETAINED_SOURCE_DATABASE` の復旧記録（24 時間有効）を書く。理由：切替はソースを一切変更しないので、論理コピーが「元の DB のまま同じクラスタに残る」ことで、追加の取得物なしに最も確実なコピーが得られる。必要なら Owner が Neon で復元ポイントを作ってもよい（任意）。

## 1. コマンド（すべて引数なし・固定コードで停止・再実行は拒否）
| コマンド | 内容 | 本番への影響 |
|---|---|---|
| `production:cutover-preflight` | 読取専用で測定（登録 64 本、権限、セッション数、処理中の仕事、全表ダイジェスト）。復旧記録を書く | なし |
| `production:cutover-bootstrap-target` | 新 DB を作成し 0001〜0065＋団体ロール＋0059〜0063 の権限を入れる。読取専用のまま | なし（新 DB が増えるだけ） |
| `production:cutover-copy-and-switch` | **停止窓**：fence → コピー → 照合 → 書込み可。新 DB の実行時ロールは NOLOGIN のまま止まる | **アプリの DB 接続が止まる（窓の間）** |
| `production:cutover-verify-target` | 読取専用の検証。結果は **`CUTOVER_TARGET_FULLY_VERIFIED`（全行・全権限一致）／`CUTOVER_TARGET_STRUCTURE_ONLY_PASS`（構造と権限のみ。行の一致は言わない。新 DB が使われ始めた後）／`CUTOVER_TARGET_VERIFY_FAILED`** を区別する。権限は両 DB の全 ACL（表・列・関数・スキーマ・DB・既定）を正規化して比較し、0065 が導入する対象以外の差があれば失敗 | なし |
| `production:cutover-rollback` | 窓を完了した直後（COPIED_AWAITING_OWNER）に元へ戻す。**新 DB の実行時ロールが LOGIN 0・接続 0、かつ全表・全シーケンスがソースと完全一致（＝業務書込みが一度も入っていない）ときだけ**可能 | 元の状態に戻る |
| `production:cutover-recover` | 窓の途中でプロセスが落ちた・失敗した後に、**実 DB の状態から**復旧する。安全と証明できるときだけソースの fence を解除し、読み戻して確認する。証明できなければ RECOVERY_REQUIRED／FORWARD_FIX_ONLY を返し、成功を主張しない | 復旧（または何もしない） |

共通の保護：すべての変更コマンドは**排他ロック**（この Mac のロックファイル＋ソース/ターゲット DB の advisory lock）を取り、二重実行は `LOCKED` / `LOCKED_DB` で拒否される。fence の前に、変えるもの全部（実行時ロールの LOGIN 状態、DB の既定 `default_transaction_read_only`）を**永続状態に記録してから**変更する。復元は記録どおりの値へ（単なる RESET ではない）戻し、**DB を読み戻して**一致を確認する。

## 2. Owner の作業（番号付き・最小）
**A. 窓の前（ダウンタイムなし。いつでも）**
1. 「切替を始めて」と指示する。利用が少ない時間帯を指定する（夜間推奨）。Claude が preflight → bootstrap-target → verify-target を実行し、結果（`CUTOVER_PREFLIGHT_OK` など）を報告する。
2. **新ロールのパスワードを先に発行する（LOGIN にはしない）。** Neon の Roles 画面で、新 DB `neondb_v65` の実行時ロール（copy-and-switch の結果の `switchManifest.targetRuntimeRoles`、`neondb_v65_*`。backup ロールは除く）それぞれのパスワードを新規発行し、**その場で** Vercel の Production 環境変数 `PRODUCTION_DB_PASSWORD_<サービス>`（Sensitive）へ貼る。値は端末・チャット・ログに残さない。
3. 同じく Vercel の Production 環境変数を切り替える：`PRODUCTION_DB_NAME=neondb_v65`、`PRODUCTION_DB_ROLE_<サービス>` は現在の値の先頭 `neondb_` を `neondb_v65_` に置き換える（`switchManifest.rolePrefixFrom → rolePrefixTo`）。**環境変数を変えるだけで再デプロイはしない。** 変更は次のデプロイからしか効かないので、本番は動き続ける。※ 切替が終わるまで他のデプロイをしない。

**B. 窓（ダウンタイムあり。見込み：数分〜十数分、未実測）**
4. 「窓を開けて」と指示する。Claude が `copy-and-switch` を実行する。アプリが DB に接続できない間、予約・スタッフ画面は一時的にエラーになる。**Owner の操作は不要。** 失敗した場合は、**元の状態へ復元して読み戻せたときだけ**「戻した」と報告する（読み戻せなければ RECOVERY_REQUIRED。§3 の段階別の表）。窓の途中でプロセスが落ちた場合も、Claude が `recover` を実行して実 DB から復旧する（Owner の再承認は不要）。ランタイムのセッションが残って終了できない場合（`FENCE_SESSIONS_REMAIN`）は窓を中止して元へ戻す。
5. 成功（`CUTOVER_COPIED_AWAITING_OWNER`）の報告を受けたら、`neondb_role_admin` ではなく新 DB の管理ロール `neondb_v65_role_admin` に切り替えて、実行時ロールを LOGIN にする（1 トランザクション・LOGIN のみ変更）。
```sql
BEGIN; SET LOCAL ROLE neondb_v65_role_admin;
ALTER ROLE neondb_v65_operations LOGIN;  -- switchManifest.targetRuntimeRoles の全ロールについて同様に1文ずつ
COMMIT;
```
6. 「再公開を承認」と伝える。Claude が公開許可を結び直し、同じ artifact を公開ドメインに付けずに配信 → 2 回の確認 → promote → post attestation を実行する。ここでアプリが新 DB に接続する。

**C. 窓の後**
7. Claude が `verify-target` と、公開後の読取確認（readiness、ログイン、団体の読取）を行う。通常予約・スタッフ業務・団体を確認して報告する。
8. 新規の団体入口は、通知・既存団体の回復の準備が整うまで開けない（本書の範囲外。開けるのは Owner の操作）。

## 3. 失敗・中断したときの扱い（段階別。「自動で戻る」は全ケースには成立しない）
各段階で**何が起き得て、誰が何をするか**。復旧に Owner の再承認待ちは入らない（`recover` は Claude が実 DB を読んで実行する）。

| 段階 | 実 DB の状態 | 結果 | 復旧 |
|---|---|---|---|
| ① fence の前（preflight・窓前の再確認で失敗：処理中の送信/lease あり、ターゲット未準備など） | ソースは何も変えていない | 何も fence しない。`rolledBack:true` | 原因を直して再実行 |
| ② fence の途中（例：2 ロール中 1 ロールだけ NOLOGIN にして失敗・接続断・プロセス死亡） | ソースが部分的に fence されている。**変更前の状態は fence の前に永続記録済み** | 実行中の失敗は、記録どおりに復元し**読み戻して**確認できたときだけ `rolledBack:true`。確認できなければ `RECOVERY_REQUIRED`（成功を主張しない） | プロセスが落ちた／RECOVERY_REQUIRED のときは `recover`：実 DB を読み、安全なら記録へ復元して読み戻す |
| ③ 停止中（fence 済み・コピー中・照合中） | ソースは fence 済み。ターゲットは**読取専用のまま**（コピーのコミット応答を失っても読取専用） | 失敗は②と同じ復元。コピーは再実行で置き換わる（ターゲットは検証完了まで業務に使われない） | 再実行、または `recover` |
| ④ コピー完了・未公開（COPIED_AWAITING_OWNER。書込み可にしたがアプリは接続できない） | ターゲットは書込み可だが実行時ロールは NOLOGIN | 成功終了 | 戻すなら `rollback`：LOGIN 0・接続 0 かつ全表・全シーケンスがソースと完全一致のときだけ。一致しなければ `ROLLBACK_REFUSED_TARGET_WRITTEN` |
| ⑤ 書込み可能化の瞬間（`RESET default_transaction_read_only` の応答を失う等） | ターゲットが書込み可か不明 | **実 DB を読み戻して判定**する。書込み可なら前進修正のみ（`rolledBack:false`、ソースは fence のまま＝二重 writer なし）。意図は fence 解除より**前**に永続記録 | `recover`：誰も接続せず全データ・全シーケンスがソースと一致していると**証明できるときだけ**戻す。書込みがあり得るなら `CUTOVER_FORWARD_FIX_ONLY` |
| ⑥ 書込み開始後（Owner が実行時ロールを LOGIN にした後） | ターゲットに業務書込みが入り得る | **戻さない（前進修正のみ）**。ソースは fence のまま。`rollback`/`recover` は拒否 | 問題はターゲット上で直す。旧へ戻す場合はターゲットの差分をソースへ移す別設計と Owner の判断が要る |

誤った旧環境への再公開の防止：ソースの実行時ロールは NOLOGIN のままなので、旧 DB を指す旧デプロイは接続できずに閉じる（fail closed）。ソースの fence は、ターゲットが未使用であると証明できた `rollback`/`recover` だけが外す。ソース DB は切替後も削除しない。

| 状態 | 意味 |
|---|---|
| `TARGET_BOOTSTRAPPED` | 窓の前（または復旧済み）。再実行できる |
| `WINDOW_OPEN` | 窓の途中（プロセスが落ちるとここに残る）。`recover` |
| `COPIED_AWAITING_OWNER` | 窓の成功。Owner の資格情報・環境変数・再公開へ |
| `RECOVERY_REQUIRED` | ソースの復元を証明できていない。`recover`。他のコマンドは拒否 |
| `FORWARD_FIX_ONLY` | ターゲットに書込みがあり得る。ソースは fence のまま |

## 4. 未実証（実本番でのみ分かること）
- Neon 上で owner が実行時ロールのセッションを終了できるか（`pg_signal_backend`）。できなければ preflight が通知し、窓の fence は NOLOGIN 後に残セッションの終了を繰り返し試み（最大 60 秒）、0 を読み戻せなければ中止して元へ戻す。
- SQL の `CREATE DATABASE` で作った DB への Neon API の接続 URI（`connection_uri`）。取得できなければ `OWNER_SESSION_INVALID` で止まり、何も変更されない。
- 実データ量での所要時間、Vercel の資格情報切替と再公開の実機確認、将来の migration 用の管理権限（案 B）の組込み（別 PR・manifest の再承認が必要）。

## 5. コピーの正確性と上限（実装済み・合成 PG で実証）
- 行は**サーバーの jsonb テキストのまま**運ぶ（JavaScript で数値を解釈・再直列化しない）。2^53 を超える bigint、高精度の numeric、マイクロ秒の timestamp、bytea、jsonb、浮動小数点が1桁も欠けないことを試験で確認。照合ダイジェスト不一致は失敗。
- 読み取りは**サーバー側カーソル**でバッチ（既定 500 行）。1 表あたり `MAX_TABLE_ROWS`（500 万行）を超える表は**拒否**（黙って切り詰めない）。実測の本番は 163 表・約 11 MB で、上限の遥か下。
- シーケンスは `last_value` と `is_called` の両方を一致させる（未使用のまま、`setval(..,false)` の状態も保持）。照合も両方。
- executor 所有の取引内一時テーブル 3 つは対象外（1 取引内で INSERT/DELETE され静止時は空。owner は読めない）。窓の中では「実行時セッション 0」で保証し、統計は補助証拠にとどめる。

## 6. 将来の migration の保守経路（新 DB の bootstrap に統合済み・案 B）
- 新 DB の bootstrap は、executor を作成したロールを**削除せず休眠管理者として残す**（`production-owner-compat/3`。NOLOGIN・NOINHERIT・何も所有せず・権限 0・executor と custody への ADMIN のみ。owner は SET ROLE でのみ到達）。従来の標準経路（version/2）は変更なし。
- 実行時（runtime）ロールには到達不能。通常時に owner が持つ executor 権限は 0（`executorMembers: 0` の契約は「休眠管理者以外のメンバーが 0」）。
- executor 所有の関数を変える migration は、`scripts/production-migration-window.ts` の `runInMigrationWindow` で、窓（休眠管理者が owner へ executor を SET/INHERIT で付与＋一時的な public CREATE）を開き、migration を適用し、**必ず**閉じる（失敗時も）。開閉は hash-chain の監査に記録され、閉じた後に「owner の executor 権限 0・public CREATE 失効・休眠管理者の姿勢」を証明する。窓なしでは 42501（隔離 PG で実証）。
- 既存の本番 DB（`neondb`）には適用しない。汎用の SUPERUSER 化もしない。
