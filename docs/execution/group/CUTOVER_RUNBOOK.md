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
| `production:cutover-verify-target` | 読取専用の検証（構造、全行一致、ロール状態） | なし |
| `production:cutover-rollback` | 窓を元に戻す。**新 DB の実行時ロールが一つも LOGIN していない間だけ**可能 | 元の状態に戻る |

## 2. Owner の作業（番号付き・最小）
**A. 窓の前（ダウンタイムなし。いつでも）**
1. 「切替を始めて」と指示する。利用が少ない時間帯を指定する（夜間推奨）。Claude が preflight → bootstrap-target → verify-target を実行し、結果（`CUTOVER_PREFLIGHT_OK` など）を報告する。
2. **新ロールのパスワードを先に発行する（LOGIN にはしない）。** Neon の Roles 画面で、新 DB `neondb_v65` の実行時ロール（copy-and-switch の結果の `switchManifest.targetRuntimeRoles`、`neondb_v65_*`。backup ロールは除く）それぞれのパスワードを新規発行し、**その場で** Vercel の Production 環境変数 `PRODUCTION_DB_PASSWORD_<サービス>`（Sensitive）へ貼る。値は端末・チャット・ログに残さない。
3. 同じく Vercel の Production 環境変数を切り替える：`PRODUCTION_DB_NAME=neondb_v65`、`PRODUCTION_DB_ROLE_<サービス>` は現在の値の先頭 `neondb_` を `neondb_v65_` に置き換える（`switchManifest.rolePrefixFrom → rolePrefixTo`）。**環境変数を変えるだけで再デプロイはしない。** 変更は次のデプロイからしか効かないので、本番は動き続ける。※ 切替が終わるまで他のデプロイをしない。

**B. 窓（ダウンタイムあり。見込み：数分〜十数分、未実測）**
4. 「窓を開けて」と指示する。Claude が `copy-and-switch` を実行する。アプリが DB に接続できない間、予約・スタッフ画面は一時的にエラーになる。**Owner の操作は不要。** 失敗した場合は自動で元に戻り（ソースの fence 解除、新 DB は読取専用に戻る）、原因を報告する。ランタイムのセッションが残って終了できない場合（`FENCE_SESSIONS_REMAIN`）も自動で戻る。
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

## 3. 戻し方
| 状況 | 戻し方 |
|---|---|
| 手順 4 の途中で失敗 | 自動。ソースの fence 解除、新 DB は読取専用に戻る。再実行できる（コピーは新 DB の行を置き換える） |
| 手順 5 の前（新 DB を誰も使っていない） | `production:cutover-rollback`：ソースのロールを LOGIN に戻し、読取専用を解除する。Vercel の環境変数は変えていても未デプロイなので影響なし |
| 手順 6 より後（新 DB に書込みがあり得る） | **戻さない（前進修正のみ）。** 二つの DB に書込みが分かれるのを防ぐため、ソースは fence されたまま。問題は新 DB 上で直す。どうしても旧に戻す場合は、新 DB の差分をソースへ移す別の設計と Owner の判断が要る |
| ソース DB | 切替後も削除しない。保持期間と削除は別途 Owner が決める |

## 4. 未実証（実本番でのみ分かること）
- Neon 上で owner が実行時ロールのセッションを終了できるか（`pg_signal_backend`）。できなければ preflight が通知し、窓の fence は残セッションが自然に切れるのを待つ（最大 60 秒）。切れなければ自動で戻る。
- SQL の `CREATE DATABASE` で作った DB への Neon API の接続 URI（`connection_uri`）。取得できなければ `OWNER_SESSION_INVALID` で止まり、何も変更されない。
- 実データ量での所要時間、Vercel の資格情報切替と再公開の実機確認、将来の migration 用の管理権限（案 B）の組込み（別 PR・manifest の再承認が必要）。
