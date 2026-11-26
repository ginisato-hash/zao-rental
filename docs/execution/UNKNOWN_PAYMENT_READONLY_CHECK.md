# UNKNOWN 決済の読取専用確認手順

対象: `rental_payment_attempts.state='UNKNOWN'` かつ `provider_id IS NULL` の試行（決済 API の応答を受け取れなかった可能性があるもの）。

## 原則（変更しない）

- 状態を `FAILED` / `COMPLETED` に手動変更しない。UNKNOWN のまま維持する。確定は正規の突合経路（reconciliation worker）だけが行う。
- 同じ idempotency key での `CreatePayment` 再送は読取専用ではない（Square 側に決済が無ければ新規に課金し得る）。確認目的で再送しない。
- 返金・再決済・通知送信・worker 設定変更を、この確認の一部として行わない。

## 当方 DB で確認する項目（読取専用）

`scripts/production-webhook-diagnose.ts` と同じ owner session（`BEGIN READ ONLY`、クエリごとに SAVEPOINT）で、次を件数・日時・固定 enum だけ確認する。ID・金額・氏名・ハッシュは出力に残さない。

1. 該当試行の `state`、作成日時、`provider_id` の有無、紐づく予約の状態（例: PAYMENT_PENDING）。
2. `reference_id` に使われた値は予約 ID（`squareCreateBody` が `reference_id=bookingId` を送る）。
3. 同じ予約・同じ時間帯に、別の COMPLETED 試行が無いか（二重決済の有無の当方側根拠）。
4. `square_webhook.inbox` にその時間帯以降の該当決済のイベントが届いていないか（受け口が 503 だった期間は届いていない可能性がある。届いていないことは「決済が無い」証拠にならない）。

## Square 側で確認する項目（Owner/TD が正規の参照手段で実施）

- Square ダッシュボードの取引一覧、または `ListPayments`（GET、`begin_time` / `end_time` / `location_id`）で、当該時刻の前後（例: 前後 30 分）に絞って検索する。
- `ListPayments` は `reference_id` で絞れないため、取得結果の `reference_id` が予約 ID と一致し、金額・場所が一致するものがあるかを人が照合する。
- 一致する決済が **ある** 場合: その `payment_id` と状態を TD に連絡する。当方の確定は reconciliation worker 経由で行う（手動更新しない）。
- 一致する決済が **無い** 場合: 「確認時刻の範囲で見つからない」までを記録する。UNKNOWN の確定・FAILED への変更は別途 Owner/TD の判断で、手動 SQL では行わない。

## 記録

確認日時、確認者、確認範囲（時刻・場所）、結果（あり/なし/不明）だけを残す。秘密値・ID は残さない。
