# 日にち単位の売り止め（臨時休業）と予約一覧の受付日時 — 仕様と本番公開手順

作成：2026-11-22 JST（実装担当D、Owner依頼「日にち単位で売り止めをかけられる機能。主に臨時休業用で一括で売り止め」「予約ページで、いつ入った予約か見られるように」）。

## 1. 仕様（Ownerの選択どおり）
| 項目 | 内容 |
|---|---|
| 設定画面 | スタッフメニュー「売り止め（臨時休業）」`/staff/sales-stops`。開始日〜終了日（最長366日）と店舗（両店舗を一度に選択可）を選び、理由を入れて「売り止めにする／売り止めを解除」で一括変更。確認ダイアログあり |
| 権限 | 閲覧：在庫閲覧（INVENTORY_VIEW）。変更：在庫編集（INVENTORY_EDIT、既定でADMIN・MANAGER）。担当店舗の外は変更不可 |
| 止める範囲 | 受取〜返却の期間に、受取店舗または返却店舗の売り止め日が**1日でも含まれる**予約 |
| お客様のWeb予約 | 受け付けない。日付を選んだ時点で「次の日は受付を停止しています」と表示し先へ進めない。サーバー側（HoldServiceの事前確認と確定の両方）でも `SALES_STOPPED` で拒否 |
| スタッフの新規予約 | 警告を表示し、「売り止め日と承知のうえで予約を作成する」にチェックした場合だけ進める（サーバーは拒否しない） |
| 既存の予約 | 変更・取消しない。設定画面に「売り止め日にかかっている既存の予約」として一覧表示（下書き・取消・完了・返却済・不受取は除く） |
| 記録 | すべての設定・解除を変更履歴に残す（追記のみ、変更・削除不可）。売り止め行も更新不可（解除＝削除＋履歴） |
| 公開側に出す情報 | 店舗と日付のみ（理由・担当者は出さない） |
| 予約一覧 | 「受付日時」（JST）列を追加。予約詳細にも表示。CSVに「受付日時（JST）」列（`YYYY-MM-DD HH:mm`） |

## 2. DB変更 0062（`packages/db/migrations/0062_store_sales_stops.sql`）
- 新しい表2つ（`store_sales_stops`、`store_sales_stop_history`）と関数2つ。既存の表・行は変更しない。
- 書き込みは `store_sales_stop_set()`（SECURITY DEFINER、操作者は認証済みの `zao.actor`）だけ。アプリは先に INVENTORY_EDIT と店舗を `ops_assert_actor` で確認する。
- `store_sales_stopped_days()` だけを PUBLIC 実行可（店舗＋日付のみ返す）。予約画面と予約受付判定が使う。
- 0062未適用のDBでは売り止め判定は「なし」として動く（新しい版を先に配信しても従来どおり）。

## 3. 本番公開の順序（PR #73 と同じ安全手順）
1. PRの自然CI SUCCESS と ChatGPT TD の独立レビュー（B/H/M 0）→ 通常のsquash merge。
2. **Owner**：merge後の最新バックアップで復元試験（**61本の登録**、`expectedMigrations: 61`）。age秘密鍵は非表示入力のみ。
3. 実装担当：`npm run production:restore-evidence-finalize-pre-0062`（記録 `restore-pass-pre-0062.json`、24時間有効）。
4. `npm run production:install-sales-stop-migration` → `npm run production:install-sales-stop-grants`（どちらも pre-0062 の復元記録・accepted main・verify-full TLS が前提。再実行は拒否、COMMIT後は読み戻しのみ）。
5. 公開許可（`PRODUCTION_RELEASE_ID`/`PRODUCTION_PUBLICATION_APPROVAL`）を新しいmainへ付け替え（**Ownerの明示確認**）→ 同一artifactを公開ドメインに付けずに配信 → 2回の確認 → promote。
6. 公開後：売り止め画面の表示（本番では試験用の売り止めを1日入れて解除するかはOwner判断）、予約一覧の受付日時、公開予約画面。

## 4. 戻し方
- 配信：直前の正常なdeploymentへ戻す。旧版は0062を使わないため、売り止めは効かなくなる（予約は従来どおり受け付ける）。
- DB：0062は追加のみ。既存の予約・在庫に影響しない。表は残す。

## 5. 証拠（ローカル、合成データのみ）
| 試験 | 内容 | 結果 |
|---|---|---|
| `test:sales-stop`（実PG） | 一括設定・冪等・履歴、ゲストの事前確認／確定の拒否、片方の店舗だけの売り止め、スタッフは作成可、既存予約の一覧、解除、入力検証、権限（VIEWER不可・MANAGER可・担当外店舗不可）、表の更新禁止とロール権限、予約一覧/CSVの受付日時 | 10/10 PASS |
| `test:sales-stop-ui`（ブラウザ） | メニュー→設定（確認ダイアログ）→一覧、英語・390px横スクロールなし、スタッフ新規予約の警告とチェック、予約一覧の受付日時列、公開予約画面の案内と先へ進めないこと／別の日は進めること | 5/5 PASS |
| `tests/operations/production-0057-owner-apply.ts` | 本番相当トポロジで 0062 を neondb_owner が適用：61→62、ロール/メンバー不変、所有者、COMMIT後の書込みを許容、再実行拒否、operationsはSELECT＋set実行のみ、PUBLICは読取関数のみ | PASS |
| unit | pre-0062復元証拠（53/55/58本の記録では開かない）、インストーラーの入場順序 | PASS |
