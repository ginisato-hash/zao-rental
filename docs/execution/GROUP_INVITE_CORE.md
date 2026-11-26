# 団体予約コア（土台）実装記録

正本: Issue #47 コメント 7197143646（B3 DBモデル・B4・B5・B6 サービス層）を、Owner最新訂正 7197417902 で上書きした内容。
範囲: DBスキーマ、状態機械、原子的在庫確保、確約の根拠型、見積/割引計算、event/outbox、サービス層。HTTPルート・顧客UI・管理画面・メール本文・CSVは次の波。

## 1. 仕様（確定）
- 入口: 永続の再利用可能な1本の入口（`group_entrance`、hashのみ保存）。団体ごとの発行・承認・期限・回数制限は無い。入口は「新規申請を開始する能力」だけで、既存団体のデータへの権限を持たない。申請ごとに独立した団体IDと所有者secret（hashのみ保存）を割り当てる。運営の任意操作は「入口の停止/再開/再発行」のみ。
- 仮押さえ: 期限なし。`inventory_holds.allocation_stage='GROUP_RESERVED'` かつ `expires_at IS NULL` という明示的な保護種別（将来日付による代用ではない）。承認確約への昇格か、ADMINの明示リリースまで保持する。
- 支払い: 現地精算のみ（`payment_method` は `PAY_ON_SITE` に固定）。団体の予約フローにオンライン決済・前払5%・クーポンは無い。
- 確約: `confirmation_basis='GROUP_ADMIN_APPROVED'`。`rental_bookings` / 決済attempt / provider event / `payment_state=SUCCESS` は一切作らない。受領は `group_payments`（現地受領のみ）。

## 2. 状態図
```
DRAFT --quote--> QUOTED --(編集)--> DRAFT
QUOTED --submit(全員分を1取引で確保)--> REVIEW_HELD
REVIEW_HELD --requestChanges--> CHANGES_REQUESTED --applyChange--> REVIEW_HELD
REVIEW_HELD / CHANGES_REQUESTED --release(ADMIN,理由)--> RELEASED   (終端)
REVIEW_HELD --confirm(ADMIN)--> CONFIRMED(現地精算・未精算) --cancelConfirmed(ADMIN)--> CANCELLED (終端)
```
- 時間による遷移は存在しない（cron・一般HOLD期限処理・見積有効期限・利用日経過は何も解放しない）。利用日経過は一覧で「要対応・経過日数」を示すだけ。
- 顧客の変更/辞退は `group_change_requests` に記録するだけ。顧客操作だけでは何も解放しない。

## 3. DB / サービス実装マッピング
| 要件 | 実装 |
|---|---|
| 永続入口 | `group_entrance`(1行), `group_entrance_history`, `GroupOrderService.rotateEntrance/setEntranceEnabled/entranceOpen/startApplication` |
| 団体/参加者/パート | `group_orders`, `group_members`(安定ID・ordinal), `group_order_parts`(既存20名以下holdへの一意FK、最大5) |
| 状態機械 | `group_order_guard`（合法edge・ADMIN権限をDBで再検査・終端不変・revision+1）, `group_order_event`（状態変更と同時にimmutable event） |
| 原子的在庫 | `reserveAll`: 全員を1つのjoint planにし(`planMixedAllocation`)、各partのhold/claimsを同一取引・同一allocator排他(`pg_advisory_xact_lock(71820600)`)で書く。`group_consistency`(遅延制約)がコミット時に「全員分確保/全解放」を検査 |
| 保護種別 | 0064: `GROUP_RESERVED`、`expires_at` NULL許容（通常holdは `inventory_hold_expiry_required` で期限必須のまま）、`group_hold_guard`/`group_claim_guard`で他roleの変更を拒否 |
| 確約の根拠 | `group_orders.confirmation_basis`、`group_booking_guard`（団体holdを通常bookingに結び付けない） |
| 見積/割引 | `group_quotes`(immutable, digest), `group_consents`(上限額), `group_adjustments`(set方式, before/after, 理由, actor), 計算は `computeGroupTotals`（既存`calculate`と`halfUpBps`を再利用） |
| 通知 | `group_notification_outbox`（`group_event_outbox`がevent挿入と同一txで作成、dedupe=group+event+revision）。確約通知1通・解除通知1通・仮押さえ通知1通。partごとの通常確約メールは構造的に無い（bookingを作らない） |
| 現地入金 | `group_payments`(RECEIPT/REVERSAL, append-only, 権限と金額上限をDB検査) |
| 認可 | ADMIN + `GROUP_*` 権限 + 店舗scope を同一txで再読込（`authStaff`）し、DBトリガ(`group_staff_can`)でも再検査。MANAGER/STAFFには付与しない |
| 冪等性 | `group_requests`（同key同fingerprintは保存結果をreadback、異なるpayloadは409） |

権限: `GROUP_VIEW, GROUP_ENTRANCE_MANAGE, GROUP_APPROVE, GROUP_DISCOUNT, GROUP_RELEASE, GROUP_CANCEL, GROUP_PAYMENT_RECORD`（ADMIN roleのみ）。

## 4. 既存consumerの棚卸し（確約済み未払い）
団体は `rental_bookings` を作らないため、booking起点の consumer（Square決済・照合・返金・custody・booking通知・顧客ID・キャンセル/返金・booking一覧・売上/入金集計）は団体を一切見ない（fail-closed）。在庫起点の consumer（capacity/availability/provisional/wear/transfer/売止/カレンダーの在庫占有）は `allocation_stage<>'PROVISIONAL'` の既存述語で団体の保護を見る。
- 「支払不明」・売上入金: bookingもattemptも無いため発生しない。
- 親の二重計上: 親1行が確定額(`confirmed_total_jpy`)を持つ。partは金額を持たない。
- 貸出(custody)は `payment_state=SUCCESS` と booking を要求するため、団体の貸出は次の波（団体専用の貸出準備・入金確認経路）で接続する。**この土台だけでは団体の貸出はできない。**

## 5. 試験表
| 区分 | 試験 | 結果 |
|---|---|---|
| 実PG | `tests/group/core.ts`（`npm run test:group`）15項目: 入口/他団体隔離、submit原子性、1/20/21/50/100名・101拒否、part3失敗注入で全0、不足/競合/最後の1枠、期限処理後も保護継続（通常HOLDのみ期限切れ）、利用日経過、解除、確約（現地精算・未精算・provider痕跡0）、無償確約の明示確認、amend、確約対解除競合、権限の取消、DB guard、通常予約回帰、100名性能 | 15項目すべて通過。100名/5 part/300 claims の submit は 74 ms・74 statements（隔離PG、tsx実行、1取引=allocator排他の保持時間） |
| unit | `tests/unit/group-order.test.ts`: 割引計算（最大剰余法・過大・方式重複・0円）、状態遷移、旧仕様記述の不在検査 | 通過 |
| migration | fresh + 旧DBからのupgrade（`test:stabilization-upgrade`、`test:operations`(0032→0064)、`test:m2b-bootstrap`、`test:production-role-plans`、`test:production-restore-drill`、`test:production-foundation`） | 通過 |

## 6. 限界・次の波
- allocatorの1計画あたりの要求数上限(240)は20名holdを前提にした資源保護。団体のjoint planにだけ上限520を渡す（既存呼出は不変）。実測は試験出力の `PERF` 行。本番相当buildでの測定はNOT_RUN。
- joint planは全員を1問題として解くが、`planMixedAllocation` 自体が「物理優先→暫定容量のgreedy再投入」の既存近似を持つ（既存の開示済み簡略化）。
- 団体専用role `<db>_group` と新規権限の本番付与は、正規のrole delta手順（hold roleと同等権限＋group表のDML＋`group_register_actor`のEXECUTE）で適用する。本番DBへの適用は行っていない。
- 次の波: 入口URL/所有者cookie・回復・CSRF/rate limit、顧客5ステップUI、管理画面（一覧・解除・確約・割引・入金記録）、通知worker/テンプレート、CSV、貸出準備への接続、既存amend/cancel経路への接続。
