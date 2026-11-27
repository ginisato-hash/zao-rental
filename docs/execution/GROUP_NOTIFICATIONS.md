# 団体予約の通知・配送・親単位の集計（B6 / B4集計 / C通知試験）

正本: Issue #47 コメント 7197143646（B6, B4集計）を Owner 最新訂正 7197417902 で上書きした内容。土台は `GROUP_INVITE_CORE.md`（outbox生成・dedupe・古い通知のSUPPRESSEDは土台側で実装済み。本書はそれを再実装せず、worker/テンプレート/配送/表示側を足す）。
migration は追加していない（0064 のまま）。必要なのは group 役割への列限定 UPDATE 権限1文のみ（§6）。

## 1. 仕様（確定）
- 顧客通知は5種だけ: `GROUP_REVIEW_HELD` / `GROUP_CONFIRMED` / `GROUP_CHANGES_REQUESTED` / `GROUP_RELEASED` / `GROUP_CANCELLED`。期限切れ・延長・part別の通知は存在しない（イベント名・文言・テンプレに期限/延長の語なし。試験で検査）。
- 仮押さえ受付メール: 「現在仮押さえ中／管理者確認待ち／まだ予約確定ではありません」、暫定税込額。解除時に解除通知1通、確約時に最終額＋管理者メッセージ付きの確約通知1通。旧状態は遅延配信しない。
- 宛先は代表者1名（`group_orders.contact_email`）。内部メモ・調整理由・解除理由・身体情報・全員CSVは本文にも添付にも含めない。

## 2. 実装マッピング
| 要件 | 実装 |
|---|---|
| テンプレ（JA/EN, 5種） | `packages/core/src/group/notification-template.ts`（純関数。HTML/text。subjectは確認待ちと確約で明確に別。管理者メッセージはplain text・署名と区別した枠・HTML escape・2000文字・制御文字拒否・subject/ヘッダに入らない。確約額は割引前/割引額/確定総額が一致しなければ描画しない） |
| 配送worker | `packages/core/src/group/notification-worker.ts` `GroupNotificationWorker`（`due/dispatch/reconcile/runBatch`。既存 `BookingNotificationDelivery` アダプタ・UNKNOWN/lookup・再送guard・`safeDeliveryResult` を再利用。アダプタ未接続なら何も claim/送信しない） |
| 同一TX・配送障害で巻戻さない | 行は状態commitと同一TXで土台が作成済み。workerは別TXで lease/settle するだけで、予約状態は触らない |
| dedupe | `dedupe_key=group+event+revision`（UNIQUE）。provider冪等キーは `sha256(dedupe_key)` |
| 順序・古い状態の抑止 | (1)新しい通知行の挿入時にトリガが未配送の古い行を SUPPRESSED（土台）。(2) claim時に新しい行が有れば SUPPRESSED。(3) lease後・provider呼出し直前の `material` で「新しい行が有る／群の現在状態がイベントと不一致」なら送らず SUPPRESSED。(4) 古い通知が SENDING（飛行中）の間は新しい通知を claim しない（古い文面が新しい文面の後に届かない） |
| provider不明 | 結果不明/timeout/例外 → `UNKNOWN`。以後は lookup のみ。lookup 無し、または未発見なら UNKNOWN のまま（二重送信しない）。lease失効（worker死亡）も lookup のみの UNKNOWN |
| 再試行 | 権威ある `NOT_ACCEPTED`（RATE_LIMITED/PROVIDER_UNAVAILABLE）のみ。指数backoff、3回で `RETRY_EXHAUSTED`。`REJECTED` は PERMANENT_FAILURE |
| 配送状態の表示API（読み取り） | `GroupNotificationStatus.forGroup(staff, groupId)`（親の履歴）, `needingAttention(staff, stores)`（UNKNOWN/再試行中/恒久失敗/テンプレ・宛先不可の親一覧）。ADMIN + GROUP_VIEW + 店舗scopeを同一read TXで再検査。宛先・本文・provider payloadは返さない。`superseded=true` は新状態に上書きされた正常な未送信、`needsReconcile=true` は照合待ち |
| staff inbox（親単位） | `GroupReadModel.inbox(staff,{stores})` 親1件=1項目（part数に依存しない）。`kind`: `GROUP_REVIEW_REQUEST` / `GROUP_CHANGE_REQUEST`。確約・変更依頼・解除で状態が変われば一覧から消える（別途の既読テーブルは作らない） |
| カレンダー・用品詳細 | `calendar(staff,{store,from,to})` 親1件=1エントリ（HOLD/確約）、`itemBars` 用品ごとの「どの親団体が何日保持」、`holdParents` 既存のhold単位バー/行を親へ対応付け |
| 予約一覧・帳票・CSV・売上/未収 | `report(staff,{stores,from,to})` 親1行。売上側=CONFIRMED親の確定額のみ（解除・取消は0）。入金=`group_payments` の実績のみ。確約済み未払い=`outstandingJpy`（未収）。partsの確定行合計を再計算し `partsMatchParent` で親確定額と一致を報告。`groupReportCsv` は csvCell（式注入対策）、メール・身体情報を含まない |

## 3. 既存consumer棚卸し（GROUP_INVITE_CORE §4 の一覧を実装で埋める）
| consumer | 団体の見え方 | 接続点 |
|---|---|---|
| booking通知worker / `booking_notification_outbox` / staff新規予約メール | 見ない（bookingを作らない）。**変更なし** | 団体は `GroupNotificationWorker` 側 |
| StaffInbox / StaffInboxBell（booking起点） | 見ない | C2が `GroupReadModel.inbox` を同じベルに合流（kind別アイコン、リンクは団体詳細） |
| カレンダー（`CalendarService`、ops役割） | 既存は在庫claimのhold棒を出す（部品ごと）。ops役割は団体表を読めない | C2が `holdParents`/`itemBars`/`calendar` で親ラベル・親1件に置換/重畳 |
| 用品詳細（在庫ledger） | 同上 | `itemBars` |
| 予約一覧/オーダー一覧（booking起点） | 見ない | `report` の行を団体行として別枠表示 |
| `ReportsService` bookings/money（booking・Square入金） | 見ない。団体の売上/入金は混ざらない | `report.totals` を別セクション。「支払不明」「売上入金」へは入らない |
| 返金・キャンセル（booking起点） | 見ない。団体の取消は `cancelConfirmed`（返金は作らない、受領額は手動対応を通知文で店舗案内） | 土台 |
| custody/貸出 | 次の波（C4） | — |
| 在庫capacity/availability/provisional/wear/transfer/売止 | `allocation_stage<>'PROVISIONAL'` で団体の保護を既に見る | 変更なし |

## 4. 確認リンクと所有者アクセス（C1との接合）
- メールのリンクは `{origin}/{locale}/group/{groupId}`。**groupId は秘密ではなく**、トークン・クエリ・fragment を一切含めない（試験: `[?#]` 不在、owner secret 不在。テンプレは origin 不一致/query付きリンクを拒否）。
- 所有者secretは申込時にブラウザが生成しhashのみ保存されるため、メールには載せられない。そのページの閲覧・編集権は C1 の所有者セッション（申込端末のcookie、または回復手順）が与える。別端末は回復（団体番号＋代表者メールに基づく本人確認）で入る。C1が別URL形にする場合は `GroupNotificationWorker` の第5引数 `GroupLinkBuilder` を差し替える（同一originのパスのみ許可・query不可）。
- URL/トークンはログ・analyticsに出さない: workerは宛先・本文・リンクをログしない（設計上ログ出力なし）。

## 5. 試験
| 区分 | 試験 | 結果 |
|---|---|---|
| unit | `tests/unit/group-notification.test.ts`（8）: 5種×ja/en描画・期限語不在、subject区別、管理者メッセージ（escape/2000/制御文字/ヘッダ注入）、金額不一致で描画拒否、origin/リンク検査、0円・取消、列限定grant、CSV | 通過 |
| 実PG＋メール捕捉 | `tests/group/notify.ts`（`npm run test:group-notify`）15項目: 未接続、受付メール1通と内容・安全リンク・commit後送信、確約（45名=3part）1通・割引内訳・管理者メッセージ実レンダリング・part別メール0、解除でHELD抑止・解除1通、飛行中/lease後の解除競合と順序、変更依頼、EN、失敗/再試行/枯渇/reject、UNKNOWN（lookup成功・lookup無し・timeout・lease死亡）で再送0、並行lease=送信1回、worker役割の列限定、rollback時outbox/メール0、親単位のinbox/カレンダー/用品/報告/CSV/未収/二重計上0/取消、期限語の全面検査、通常予約表の不変 | 15項目通過（隔離PG、捕捉アダプタ。実メール送信なし） |
| 回帰 | 下記PR本文参照（lint/tsc/unit/group/notification） | PR本文 |

## 6. 運用・runbook
- **役割**: 配送workerは group 役割（`<db>_group`）で動かす。`outbox` への列限定 UPDATE（status, attempt_count, next_attempt_at, claim_id, claim_until, provider_message_id, sent_at, last_safe_failure_code のみ。通知の中身 admin_message/event_type/dedupe_key 等は更新不可）を、正規のrole delta手順で適用: `scripts/group-notification-role.ts` の `groupNotificationRoleDelta(role)` が出す1文。本番DBへは適用していない。
- **tick接続（2026-11-27 実装済み）**: 本番の `worker-tick`（毎分・finite・同時実行の排他は既存のまま）が、団体プールと承認済み Resend 結線がある場合に限り、`packages/core/src/group/notification-lane.ts` の `runGroupNotificationLane` で `GroupNotificationWorker.runBatch` を1回だけ実行する。Owner 制御の `PRODUCTION_WORKER_GROUP_NOTIFICATION_LIMIT`（0〜20、未設定=0）が 0 の間は outbox を見もしない。配信の契約（行ごとの lease・冪等キー・UNKNOWN は lookup のみ・古い状態の通知は SUPPRESSED）は不変。手順は `docs/execution/group/RELEASE_RUNBOOK.md`。
- （以前の記述）**tick接続**: 本PRは本番tickを変更しない（booking worker不変）。接続する場合は `GroupNotificationWorker(groupPool, origin, deliveryAdapter).runBatch(limit, deadline)` を、groupプールが構成された環境の tick に1行追加する（アダプタは booking と同じ `ResendDelivery`）。アダプタ未接続の間は何も送られず行は PENDING のまま（誤送信しない）。
- **UNKNOWN の扱い**: 管理画面は `needingAttention` で一覧、`reconcile(id)` が lookup のみ実行。Resend は lookup 非対応のため UNKNOWN のままになり得る。その場合は人が受信側/provider画面で確認する（自動再送はしない）。
- **古い通知**: `superseded` は正常。配送が遅れても、解除/確約後に「仮押さえ中」が届くことはない。

## 7. 限界・NOT_RUN
- 実メール送信・実Resend・本番tick接続・本番role適用は未実施（NOT_RUN）。送信前後の競合のうち「provider呼出し完了〜settle」の間に解除が確定する窓は原理的に残る（古い通知は1通送られ得るが、順序は保たれ直後に解除通知が届く）。
- staff inbox の既読（acknowledge）テーブルは作っていない（状態遷移で消える）。必要なら次の波でmigration。
- 既存 `CalendarService` 等（ops役割）は団体表を読めないため改修していない。親単位表示のデータ側は group 役割のread modelで提供し、結線はC2。
