# 団体予約の貸出準備・貸出・返却への接続（custody 接続）

正本: Issue #47 コメント 7197143646（B4「承認で正式予約へ昇格」「貸出は既存の物理割当・適合確認と既存正規の精算方針」「既存予約・カレンダー・用品詳細・貸出/返却・帳票に連携」、C の「確約未払い・現物未検品/fit不成立・正常貸出/取消・実入金なしrefund0」）を、Owner最新訂正 7197417902（現地精算のみ・確約=CONFIRMED・未精算 PAY_ON_SITE/UNPAID）で上書きした内容。
土台は `GROUP_INVITE_CORE.md`。土台の「既知の限界: custody は booking と payment_state=SUCCESS を要求するため団体の貸出はまだできない」を、この変更で解消する。

## 1. 設計の要点
- **通常予約の gate は不変**。通常の貸出検証（`rental_validate_loan`・0049）は一文字も変えていない。変更は「そのトリガが団体の行を見なくなる」だけ（`WHEN (NEW.group_part_id IS NULL)`）。通常予約は従来どおり booking + `payment_state=SUCCESS` が必要。
- 団体専用の経路を **別の型・別のDB検証関数・別のservice** で用意した。
  - 型: `rental_loan_items.group_part_id`（団体 part 由来）。`booking_id` と `group_part_id` は **どちらか一方のみ**（`rental_loan_subject` CHECK）。`hold_id` は part の hold を複写（既存の読み手が団体テーブルなしで約束を引ける）。
  - DB guard: `rental_validate_group_loan`（団体の貸出行専用トリガ）、`group_custody_stage_ok`（hold の段階遷移の唯一の判定）、`group_custody_hold_update`（団体 hold に対する custody の狭い例外）。
  - service: `CustodyService.groupOverview / groupByNumber / groupCheckoutView / groupPrepare / groupCheckout`。
- 団体の貸出許可条件（限定的・通常予約と分離）: 団体が `CONFIRMED` かつ `confirmation_basis=GROUP_ADMIN_APPROVED`、part が有効（`active`）、hold が `ACTIVE`・`payment_state=NONE`（**SUCCESS を偽造しない**）・`transfer_attention` なし。そのうえで、通常予約と **同じ物理規則** をDBで再検査する: 提示された完全期間の資産証人、準備済み fit 証跡（`ZAO_PREP_V2`）、約束（variant/model）一致、店舗境界（貸出店舗＝hold 店舗）、PAIR 保存、在庫ブロック・移動・制約、貸出時間帯。
- 精算は貸出条件ではない（現地で精算する）。画面と概況には「現地精算 / 未精算 / 確定税込額」を団体番号つきで一貫表示する。
- **架空の Square attempt / receipt / provider event / payment SUCCESS / booking は一切作らない**（単体試験とPG試験で、貸出・返却・取消の前後で件数が不変なことを検査）。

## 2. 状態と遷移（貸出段階）
```
GROUP_RESERVED --(groupPrepare: 現物確認の準備記録)--> PREPARATION_FIXED --(groupCheckout: 全品目を貸出)--> RENTAL_FIXED
```
- 団体が確約（CONFIRMED）される前（REVIEW_HELD / CHANGES_REQUESTED）、および解除（RELEASED）・取消（CANCELLED）後は、準備も貸出も拒否される（service は `GROUP_CUSTODY_NOT_ALLOWED` / `CHECKOUT_NOT_ALLOWED`、DBは `CUSTODY_CHECKOUT_INVALID` / `GROUP_HOLD_PROTECTED`）。
- 段階が進んでも hold は期限を持たず（`expires_at` NULL のまま）、`payment_state=NONE` のまま。`group_consistency` は確約済み団体に限り 3 段階を許す。
- 貸出済み（`state='OUT'` の品目が1つでもある）団体は **正式取消できない**（通常予約と同じ規則。service が `GROUP_LOANS_OUT`、DBも `group_order_guard` で拒否）。先に返却する。
- 返却は既存の返却受付（バッチ→スキャン→確認→検品）をそのまま使う。団体の品目は候補・受領一覧で団体番号つきに表示される。受領時の claim 解除・実位置更新・transfer_attention 付与・PAIR の検品プール移動は既存関数（`rental_apply_receipt`）が行い、団体 part の hold で動くよう 1 点だけ拡張した（booking が無い場合は `group_order_parts.hold_id`）。

## 3. 現物未検品・fit 不成立
- 準備（`groupPrepare`）は通常と同じ構造化確認（`recordPreparation`）を要求する: 装備確認、BSL（実測）、ブーツ・ビンディング適合、DIN 参考値（スキーヤータイプ申告が必要）、ポール選択。1つでも欠ければ貸出不可（`PHYSICAL_CONFIRMATION_REQUIRED` 等）。
- 準備に使う資産・割当は hold の claim と完全一致が必要（`EXACT_FULL_PERIOD_ASSIGNMENT_REQUIRED`）。
- **MANUAL_FIT_REQUIRED**（`group_members.fit` の `status` / `kind` / `fit.kind`）の利用者は、準備時に店頭の現物試着の確認記録（`manualFit`: 利用者キー・確認済み・記録）が **ちょうどその利用者分** 必要。不足/過剰は `MANUAL_FIT_CONFIRMATION_REQUIRED`、「適合せず」（confirmed=false）は `FIT_NOT_CONFIRMED` で準備できない。記録は準備証跡に保存され、DB（`rental_validate_group_loan`）が貸出行ごとに再検査する（`CUSTODY_MANUAL_FIT_REQUIRED`）。管理者の確約（`fitAcknowledgedMemberIds`）は商業予約の確約であって貸出許可ではない。

## 4. consumer 棚卸し
| consumer | 団体 part の扱い | 対応 |
|---|---|---|
| `rental_validate_loan`（通常の貸出検証） | 団体の行は見ない | トリガを `WHEN group_part_id IS NULL` に限定（関数本体は不変）。団体は別トリガ。 |
| `rental_stage_guard`（段階遷移） | booking が無い | 団体分岐を追加（`group_custody_stage_ok`）。通常分岐は 0049 と同一。 |
| `group_hold_guard` | custody は GROUP_RESERVED を更新できない | custody / operations の狭い例外（`allocation_stage`・`version`・`transfer_attention` のみ、段階は `group_custody_stage_ok` を満たす場合のみ）。 |
| `rental_apply_receipt`（受領） | booking 取得が STRICT で失敗 | 団体は part の hold を使うよう分岐。他は不変。 |
| `rental_inventory_blocks`（受領後の検品待ち・期限超過のブロック） | booking 結合で団体が消える（**再利用を許す危険**） | 団体分岐を追加（hold から約束期間を取得）。 |
| 割当プランナの custody 制約（`allocation.ts`） | booking 結合で団体が消える（同上） | `LEFT JOIN` + `coalesce(b.hold_id,l.hold_id)`。通常予約の結果は同一。 |
| `rental_return_*` / 検品 / `returns()` | loan 単位で booking 非依存 | 変更なし。表示に団体番号を付与（団体の loan がある時だけ団体テーブルを引く）。 |
| カレンダー（`calendar-service`） | loan が booking 結合で出ない | `LEFT JOIN`。団体の予定・貸出・返却済みバーに団体番号（読取権限がある接続のみ）。店舗範囲外では団体名は出さない。 |
| 用品詳細（`inventory-read`） | loan 単位 | 変更なし（団体の貸出も OUT / 未検品として出る）。 |
| 通常の予約一覧・帳票（`orders-service` / `reports-service` / `manifest-service`） | booking 起点 | **変更なし（団体は出ない＝二重計上しない）**。団体の一覧・明細は団体番号から（C2 の管理画面と `/api/custody/group/:id`）。集計は C3 担当。 |
| 取消（`cancelConfirmed`） | 実入金0なら返金0 | 既存。OUT の品目があれば拒否を追加。返金・provider 行は作らない（試験で件数不変を検査）。 |
| `rental_complete_no_pickup`（未受取の契約終了） | booking 起点 | 団体は対象外（fail-closed、下記の限界）。 |

## 5. API / 画面
- `GET /api/custody/group-number/G-000001`（団体番号）、`GET /api/custody/group/<groupId>`（親の内訳）、`GET /api/custody/group-part/<partId>`（1 part の貸出ビュー）、`POST /api/custody/group-prepare`、`POST /api/custody/group-checkout`。既存と同じ認可（`BOOKING_VIEW` + `RENTAL_CHECKOUT` + 貸出店舗の範囲、毎回DBで再確認）・Origin/冪等キー。連絡先（氏名・メール・電話）は返さない（団体名/番号・利用者ラベルのみ）。
- 画面: スタッフの貸出画面（`/staff/rentals`）に「団体予約の貸出準備・貸出（団体番号）」を追加（`GroupCustodyPanel`）。団体番号 → 内訳（パート・利用者・用品・fit フラグ・貸出状態、現地精算/未精算）→ パートを開く → 既存の準備ワークベンチ（＋店頭 fit 確認）→ 貸出。返却は既存の返却受付。

## 6. 試験表
| 区分 | 試験 | 内容 |
|---|---|---|
| 実PG | `npm run test:group-custody`（12項目、`tests/group/custody.ts`） | 団体番号つき内訳・精算表示、確約前/解除後の拒否（service と SQL 直叩き）、準備記録なし/誤割当/物理確認なしの貸出拒否、確約済み未払い団体の準備→貸出→同一キー再実行、貸出中の取消拒否（service/DB）、確約後 protection は custody 規則以外で解除不可、**通常予約は SUCCESS 無しで貸出不可のまま（回帰）**、booking と group の排他、返却（団体番号表示・PAIR 保存・未検品ブロック・allocator が団体 loan を見る・二重受領なし）、MANUAL_FIT（準備拒否・DB再検査）、取消（準備済み/未準備、返金0・artefact 件数不変）、権限/店舗境界/付与剥奪、他店受領 |
| unit | `tests/unit/group-custody.test.ts`（5） | fit 述語、団体検証関数の条件（SUCCESS を受け入れない）、通常検証の無変更、service に支払 artefact の書込みが無いこと |
| 回帰 | `test:group` `test:custody` `test:wear` `test:late-pickup` `test:preparation` ほか | 結果は PR 本文 |

## 7. 限界・NOT_RUN（推測で緩めず fail-closed）
- **ウェア（WEAR_JACKET/PANTS）の貸出・返却は団体では未接続**。ウェアは別の貸出系（`wear_loans`、booking FK）で、団体 part に対応する経路がない。通常と同じく段階遷移（RENTAL_FIXED）の判定は「ウェア以外の全品目が OUT」なので、ウェアを含む part も gear の貸出で RENTAL_FIXED に進むが、**ウェアの貸出・返却記録は団体では作られず、ウェアの在庫確保（wear_claims）は団体の取消まで残る**。準備ワークベンチのウェア確認（`wearPrepared`）は通常と同様に必須。団体のウェア貸出は wear 系の group 対応が別途必要。
- 未受取のまま契約終了（`rental_complete_no_pickup`）、貸出後の交換（amend/exchange）は団体では未対応（fail-closed）。団体の変更は承認 amend（確約前）のみ。
- 通常の予約一覧（`orders-service`）・帳票・マニフェスト（明日の準備表）は booking 起点のため団体は出ない。団体の内訳は団体番号の概況（API/画面）から。親の二重計上は発生しない（団体行は booking 集計に入らない）。
- 受領時の既存仕様: プール型（ポール）の受領は同じプールを使う他の約束に `transfer_attention` を付ける。団体の GROUP_RESERVED hold にも同じ付与が起きる（解放はされない）。付与された hold は再照合まで準備・貸出できない（`GROUP_CUSTODY_NOT_ALLOWED`）。
- 実ブラウザ試験（団体パネル）は **NOT_RUN**（型・lint・ビルドのみ）。
- 本番: custody 役割への団体テーブルの SELECT（`group_orders` `group_order_parts` `group_members` `group_payments`）と `group_part_preparations` の SELECT/INSERT/UPDATE(列)、operations 役割への同様の読取、および `rental_validate_group_loan` の所有者変更は、0064 適用時の正規 role delta 手順に含める必要がある（開発用 `scripts/custody-roles.ts` / `scripts/operations-roles.ts` には追加済み、本番DBへの適用は行っていない）。本番の custody 接続自体は従来どおり未接続（`DEVELOPMENT_CUSTODY_NOT_CONNECTED`）。
- 0064 を直接編集した（未適用・未merge のため）。`config/production/bootstrap-source-manifest.json` の 0064 の sha256 と `tests/fixtures/rewind-0064.ts`（0064 適用前の旧定義への巻き戻し）を更新した。
