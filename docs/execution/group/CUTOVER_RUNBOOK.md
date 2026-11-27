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
