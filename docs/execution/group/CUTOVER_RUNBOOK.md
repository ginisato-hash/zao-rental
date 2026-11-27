# 本番切替手順：新しい DB（0001〜0065）への移行（Issue #47 / TD #7214138953 §A、#7219973419、#7221047349）

> **外部への連絡・問い合わせ・依頼は一切しない。age 鍵も要求しない。** 実行は Claude（H）が連続して行う。窓（停止〜有効化）の**中に人の操作はない**。Owner が窓の前に行うのは、Neon の画面でしか発行できないロールの秘密だけ（無ければ何もない）。
> 実装：`scripts/production-cutover-run.ts`（合成 PG：`npm run test:production-cutover`）。所要時間の数値は**実測ではない**（未実証）。束縛（env キー・ロール・プロジェクト）の正本は `CUTOVER_BINDINGS.md` / `cutover-bindings.json`。

## 0. 仕組み
- 既存の `neondb`（登録 0001–0064）は**そのまま残す**。削除・切り詰め・書き換えはしない。切替で変わるのは (a) 実行時ロールの LOGIN を止める（fence）、(b) DB の既定を読取専用にする、の 2 点だけ。
- 新しい DB `neondb_v65` を、実証済みの正規ブートストラップで 0001〜0065 まで構築する（0065 は最初から入る。owner の 42501 は起きない）。将来の migration 用に、休眠の NOLOGIN 管理ロールを残す（通常時 owner に executor 権限はなく、窓を開けたときだけ使える）。
- データを全行コピー（サーバー側テキストのまま。精度の欠落なし）し、全表の件数・内容ダイジェスト・sequence（`last_value` と `is_called`）・外部キーを照合して、一致したときだけ先へ進む。

## 1. 復旧の土台（混同しない）
| 項目 | 内容 | 独立バックアップか |
|---|---|---|
| **RETAINED_SOURCE_COPY** | 残してある `neondb` 自体。fence と読取専用の既定だけが変わる同一クラスタ内の複製。preflight が件数・ダイジェストを `retained-source-copy.json` に記録（24時間有効） | **いいえ** |
| 独立の復旧点 | Neon の復元ポイント、または復元ドリルの PASS（`pre-0065-recovery.json`、種別 `NEON_RESTORE_POINT` / `RESTORE_DRILL`） | はい（あれば `independentBackupEvidence: PRESENT` と別項目で表示。既定では窓の必須条件にしない） |

「retained source だけ」を独立した復元証拠と呼ばない。出力は `recovery: RETAINED_SOURCE_COPY` と `independentBackupEvidence: PRESENT|ABSENT` を別々に返す。

## 2. 戻れる範囲を決める「不可逆境界」
**境界＝ target の最初の有効化の直前**（`beforeEnableWrites`）。次の順で記録し、それ以降は**自動の rollback / recover は一切しない（前進修正のみ）**。
1. state に `activation: STARTED` を永続記録。
2. **target DB 自身**にマーカーを書き、読み戻す（DB コメント `zao-cutover-activation:STARTED:<時刻>`。owner が書け、誰でも読める）。
3. target の読取専用の既定を外す → 実行時ロールを LOGIN にする → （窓の外で）候補を promote する。

判定は常に**実 DB を読み戻して**行う。「データが source と同値」「LOGIN が 0」「接続が 0」は境界の代わりにならない（LOGIN→NOLOGIN に戻してデータが同値でも、境界後は拒否）。次はすべて「境界を越えた」と扱い、rollback も recover も拒否する（fail closed）：
- state の `activation` が無い（過去が不明）／`NONE` 以外
- state が `NONE` なのに DB にマーカーがある（不整合）
- マーカーを読めない
- state ファイルが無い・壊れている（`PHASE_REFUSED_NONE` / `STATE_INVALID` で停止）

境界の前なら、窓の失敗は自動で戻る（fence 解除を**読み戻して**確認できたときだけ「戻した」と報告。確認できなければ `RECOVERY_REQUIRED`）。クラッシュ後は `recover` が実 DB から安全に戻す。

## 3. コマンド（引数なし・固定コードで停止・再実行は拒否）
| コマンド | 内容 | 本番への影響 |
|---|---|---|
| `production:cutover-preflight` | 読取専用の測定（登録 64 本、権限、セッション数、処理中の仕事、全表ダイジェスト）。RETAINED_SOURCE_COPY を記録 | なし |
| `production:cutover-bootstrap-target` | 新 DB を作成し 0001〜0065＋団体ロール＋0059〜0063 の権限＋休眠管理ロール。読取専用のまま | なし（新 DB が増えるだけ） |
| `production:cutover-bindings-check` | env/ロール/プロジェクトの**メタデータ照合**（値は扱わない）。証拠 `bindings-check.json` を書く | なし |
| `production:cutover-live-binding` | 新 DB への**実接続**の同一性（host・ロール・DB・TLS）。証拠 `live-bindings.json` を書く | なし |
| `production:cutover-prewindow-check` | **窓の前の総点検**（下記）。READY のときだけ `state.prewindow.ready` を記録 | なし |
| `production:cutover-copy-and-switch` | **窓**：fence → コピー → 照合 → 【境界】→ 書込み可 → 実行時ロール LOGIN → 構造確認。`prewindow` が READY（2時間以内）でなければ**何も止めずに拒否** | **アプリの DB 接続が止まる（窓の間）** |
| `production:cutover-verify-target` | 読取専用の検証。**全件一致 PASS**（`CUTOVER_TARGET_FULLY_VERIFIED`）と**構造のみ PASS**（`CUTOVER_TARGET_STRUCTURE_ONLY_PASS`）を別の結果で返す | なし |
| `production:cutover-rollback` / `-recover` | 境界の**前だけ**。境界後は `ROLLBACK_REFUSED_ACTIVATION_STARTED` / `CUTOVER_FORWARD_FIX_ONLY` | 境界の前なら元に戻る |

### prewindow-check の項目（別々に表示し、混ぜない）
`sourceLive` / `inFlightWorkZero`（決済・通知・lease が 0）/ `targetReady`（構造 OK・LOGIN 0・読取専用・マーカー無し）/ `retainedSourceCopy` / `independentBackupEvidence`（PRESENT|ABSENT）/ **`bindingsMetadata`**（CONSISTENT|FINDINGS|NOT_CHECKED）/ **`liveBindings`**（PASS|FAIL|NOT_CHECKED）/ `canTerminateRuntimeSessions`。
**メタデータが一致していても、実接続の PASS ではない。** 本番ではメタデータと実接続の両方が 2 時間以内の PASS でなければ READY にならない。1 つでも欠ければ `blockers` に理由が出て、**fence しない**。

## 4. 実行順序（H が連続して実行。窓の中に人待ちなし）
**窓の前（ダウンタイムなし）**
1. `preflight` → `bootstrap-target` → `verify-target`（構造）。
2. 資格情報の発行（`CUTOVER_BINDINGS.md` §4：Neon / Vercel / GitHub の既存認証、値は標準入力のメモリのみ）。**Owner の操作が要るのは「Neon の画面でしか発行できないロール」だけ。そのロールは失敗時にまとめて列挙し、窓の前に一度で依頼する**。それ以外は Owner の操作なし。
3. 両 Vercel プロジェクト（メイン・Webhook 専用）の env とバックアップ（GitHub 環境）を新 DB へ束縛。**環境変数は次のデプロイからしか効かない**ので本番は動き続ける。
4. `bindings-check`（メタデータ）と `live-binding`（実接続）。
5. 候補（stage）を公開ドメインに付けずに配信しておく（現行 alias に影響なし）。
6. `prewindow-check` が `CUTOVER_PREWINDOW_READY` になること。ならなければその項目だけを直す（他の作業は続ける）。

**窓（Claude が連続実行。Owner の操作なし）**
7. `copy-and-switch`：fence → 最終コピー → 照合 → 境界を記録 → 書込み可 → 新 DB の実行時ロールを LOGIN（`neondb_v65_role_admin` 経由・Claude が実行）→ 構造確認。
8. 候補の stage attestation＋ 2 回の確認 → promote → post attestation（アプリがここで新 DB に接続する）。
9. `bindings-check ... POST_SWITCH`、`verify-target`、公開後の読取確認（readiness、ログイン、予約、在庫、団体の読取、`custodyLink: APPLIED`）。

**窓の後**
10. 新規の団体入口は、貸出返却・通知・所有者復旧・在庫保護が揃ってから、正規の管理者操作で開く（本書の範囲外）。

## 5. 失敗したとき（段階別）
| 段階 | 状態 | 結果 |
|---|---|---|
| prewindow が READY でない | 何も止めていない | `PREWINDOW_REQUIRED` で拒否。項目を直す |
| fence 〜 コピー〜照合（境界の前） | 失敗 | **自動で戻る**。fence 解除を読み戻して確認できたときだけ戻したと報告。確認できなければ `RECOVERY_REQUIRED`（成功を主張しない）→ `recover` |
| 窓の途中でプロセスが落ちた（境界の前） | `WINDOW_OPEN`・`activation: NONE` | `recover`（または `rollback`）が実 DB から戻す。fence 前に記録した各ロールの LOGIN と DB 既定を**そのまま**復元 |
| 境界の記録後（書込み可・LOGIN・promote の途中を含む） | `FORWARD_FIX_ONLY` | **自動では戻さない**。source は fence のまま（二重 writer を作らない）。問題は新 DB 上で前進修正。旧に戻す場合は新 DB の差分の保全・整合を示す別の設計が要る |
| 成功 | `ACTIVATED` | 窓を再実行できない |
| ソース DB | 切替後も削除しない | 保持期間と削除は別途決める |

## 6. 未実証（実本番でのみ分かること）
- Neon 上で owner が実行時ロールのセッションを終了できるか（`pg_signal_backend`）。できなくても fence は残セッションが切れるのを最大 60 秒待ち、切れなければ境界の前に安全に戻る。
- SQL の `CREATE DATABASE` で作った DB への Neon API の接続 URI（`live-binding` が窓の前に確認する。取得できなければ窓に入らず、その範囲で正規経路を直す）。
- 実データ量での所要時間、Vercel の資格情報切替と公開の実機確認。
- 候補の**配信側の束縛**（新 DB の資格情報でアプリが実際に接続できること）は、実行時ロールが LOGIN になる窓の中でしか証明できない。`live-binding` はそれの代わりではない。

## 付録A. 窓前に追加した確認の範囲と、証明しないこと（TD #7223305214 / #7223508730）

### A-1. 独立復旧点（`production:cutover-backup-evidence`、prewindow-check で毎回オンライン再検証）
- **証明すること:** 定期バックアップ（GitHub Actions `production-backup.yml`）の直近の成功 run の `Run production backup` ステップが、**移行 0064 のコミット後に開始**し（= そのダンプは registry 64 を含む）、2 時間以内に完了し、暗号化オブジェクトの命名が、過去に復元ドリルが PASS した `restore-pass-pre-0064` と同一のパイプライン・同一形式であること。
- **証明しないこと:** **この run のバックアップを実際に復元したことは証明しない。** 復元には Owner の age 鍵が要り、再要求しない。復元の裏付けは、過去の pre-0064 ドリル（同一パイプライン）だけである。証跡ファイルの `restoreTested:false` がそれを明示する。バックアップ job の成功時刻だけを「全件復元できる」証拠とは扱わない。
- 保存ファイルだけでは信用しない。手書きのファイル、別の run ID、失敗した run、0064 のコミット時刻が読めない場合は ABSENT で、prewindow は READY にならない。同一クラスタに残したソースの保持（RETAINED_SOURCE_COPY）は独立復旧点に数えない。

### A-2. 実接続の証明の範囲（prewindow の READY が意味すること）
- `production:cutover-live-binding` は **新 DB への owner 接続（host・role・DB・TLS）だけ**を証明する（`scope: TARGET_OWNER_CONNECTION_ONLY`）。
- 実行時ロール、receiver、worker、backup の資格情報での実接続は、ロールが NOLOGIN の間は確認できない（`runtimeCredentialsLiveBinding: NOT_VERIFIABLE_BEFORE_WINDOW(NOLOGIN)`）。候補 artifact の配信も窓前には確認できない。
- これらは**窓の中**で、LOGIN 付与の直後に stage attestation → 候補への 2 回の確認 → promote → post attestation で証明する。prewindow の READY は「窓前に確認できる項目が全部成立した」だけを意味し、全サービスの実接続 PASS を意味しない。

### A-3. 権限（ACL）の差分と `install-target-grants`
- 新 DB の bootstrap（`production-app-roles` の現行計画）と実本番の権限には、3 種類の差がある。**合計 29 件（source のみ 25、target のみ 4）**。
  1. **Neon 基盤の 14 件（説明のみ、適用しない）:** neon_superuser の database 権限 CONNECT/CREATE/TEMPORARY の 3、cloud_admin の public 既定権限（sequence の SELECT/UPDATE/USAGE の 3、relation の DELETE/INSERT/MAINTAIN/REFERENCES/SELECT/TRIGGER/TRUNCATE/UPDATE の 8）。Neon 自身が作る DB にだけ付く権限で、SQL の `CREATE DATABASE` では付かず、owner は付与できず、実行時の経路が使わない。説明は **正確な（種別・対象・grantee・権限・grant option）の固定リスト**で行い、「neon_superuser の全件」「既定権限の全件」「PUBLIC」を許す規則は置かない。業務表への neon_superuser の権限は説明されない。
  2. **不足 11 件（付与する）:** operations に `notification_due_normal`・`ops_refund_claim`・`ops_refund_observe`・`ops_refund_row` の EXECUTE、pay_projection に `payment_projection.normal_candidates`、pay_truth に `payment_reconciliation.claim_normal`、pay_dispatch に `payment_reconciliation.dispatch_normal` の EXECUTE、`public.provisional_model_bindings` の SELECT を group/hold/operations/pay_projection の 4 ロールへ。実本番の hotfix/activation installer が入れた権限で、無いと worker・返金・通知が動かない。**対象・権限・ロールを固定した計画（`TARGET_GRANT_PLAN`）を target にだけ**付与する（grantor は owner、owner が所有しないオブジェクトは拒否）。source の権限全体のコピーはしない。
  3. **target のみの 4 件（撤去する）:** `public.rental_preparations` の prepared_at/prepared_by/fit_evidence/version に対する operations の列 UPDATE。現行の bootstrap 計画（`production-app-roles.ts`）が付けるが、実本番の operations には一度も無かった。準備の書込み（`rental_preparations` の upsert）は `CustodyService` が custody ロールで行い（custody ロールは自分の列 UPDATE を持つ）、operations ロールの経路は読取のみで、実本番はこの権限なしで動いている。よって不要と判断し **target から REVOKE する**。`group_part_preparations`（0065 固有）の権限とは別で、変更しない。
- コマンド `production:cutover-install-target-grants`：target だけに 1 つの owner トランザクションで上の 2 と 3 を適用し、**同じトランザクション内**で (a) 構造ダイジェストが不変、(b) ACL の差分が計画と**ちょうど**一致、を確認してから COMMIT する。ロール・メンバーシップ・資格情報は変更しない。再実行しても何も変わらない。その後、source/target の ACL 全体を再比較して unexpected が 0 であることも要求する。
- **0065 の許容は object 名だけで決めない:** 0065 のオブジェクトに対する差も、(i) その DB のアプリロールか owner の通常権限であり、(ii) PUBLIC でなく、(iii) grant option でなく、(iv) 基盤ロールや他 DB のロールでない場合だけ説明される。それ以外は unexpected。
- **prewindow-check と copy-and-switch の直前にも**同じ比較を行う。ACL に説明できない差があれば READY にならず、停止窓にも入らない。
- **schemaState ダイジェスト:** 計画の適用後の値へ更新するのは、構造ダイジェストが不変で、ACL の差分が計画と完全一致した場合だけ（上記の検査を通った場合のみ state を更新する）。基準値の単純な再登録で食い違いを隠すことはしない。
- **bootstrap 計画への反映:** `production-app-roles.ts` の 4 列 UPDATE の付与行と、11 件の欠落は、承認済みの bootstrap 計画（manifest/provenance）の中にある。計画そのものの改訂には manifest の再承認が要るため、この PR では**計画を変えず、installer で補正**している。次の新 DB でも同じ installer を `bootstrap-target` の後に実行すれば同じ結果になる（再発しない）。計画への恒久反映は別の承認つき変更として残る。
- **H の報告（12 + 17）と TD の実測（14 + 15）の違い:** 総数は同じ 29 件（source のみ 25、target のみ 4。または 基盤 14 + 業務 15）。H の内訳は、基盤の差を「source のみ」と「target のみ」の方向で数えた区分と、基盤か業務かの分類を混ぜていた誤りで、正しいのは **基盤 14（すべて source のみ）+ 業務 15（不足 11 = source のみ、追加 4 = target のみ）** である。
