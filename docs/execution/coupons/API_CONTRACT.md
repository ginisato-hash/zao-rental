# クーポン機能 サービス層インターフェース（担当B → C・D 向け）

対象: `QuoteService`（packages/core/src/pricing/quote-service.ts）、`GuestBookingService`、`RecommendationService`、`BookingService`。
DB は 0063（`coupon_status_events` / `coupon_is_active` / `coupon_booking_count`）に依存する。

## 1. QuoteService（管理者／スタッフ）

| メソッド | 権限 | 入力 | 出力 |
|---|---|---|---|
| `createCoupon(couponId, input)` | PRICE_EDIT（ADMIN・全店舗） | `couponId`: uuid、`input`: `parseCoupon` の全13キー（code, validFrom, validUntil, storeBasis, stores, products, kind, value, minimumJpy, minimumBasis, maximumDiscountJpy, advanceCombination, maxActiveReservations）。未指定キーは拒否（既定値は入れない） | `CouponView`（下記）。作成と同時に有効イベントを追記。同一 id・同一内容の再送は冪等 |
| `listCoupons()` | 非ゲストの QUOTE_VIEW 以上 | なし | `{coupons: CouponView[]}`（新しい順） |
| `setCouponActive(couponId, {active, reason?}, requestKey?)` | PRICE_EDIT | `active`: boolean、`reason`: 160文字以内（省略可）。他のキーは `INVALID_INPUT`。`requestKey`: uuid（任意、冪等キー） | `CouponView`。現状と同じ状態への変更は新イベントを作らず現状を返す |

```ts
type CouponView = {
  id: string; code: string; terms: CouponTerms; active: boolean;
  createdAt: string;               // ISO
  statusChangedAt: string|null;    // 最新の状態イベント時刻
  statusReason: string;            // 最新イベントの理由（作成時は 'CREATED'）
  usage: { bookings: number;       // 取消・期限切れ・失敗でない予約数（coupon_booking_count）
           activeReservations: number }; // 期限内の coupon_reservations 数
};
```

- 見積 `create`／`preview` はクーポン付き入力で次の順に検証する：コード未登録は `COUPON_NOT_FOUND`(422、既存契約を維持)、無効は `COUPON_INACTIVE`(409)、期間・店舗・商品・最低金額は `COUPON_NOT_APPLICABLE`(422、既存)、早割併用は `PROMOTION_POLICY_UNRESOLVED`／`DISCOUNTS_NOT_COMBINABLE`(422、既存)、上限は `COUPON_LIMIT_REACHED`(409)。
- `preview(input)`: `couponCode` を `string|null` で受理（`code()` で trim・大文字化）。`holdId` は null のみ。戻りに `subtotalJpy`, `couponDiscountJpy`, `advanceDiscountJpy`, `totalJpy`, `coupon:{status:'ESTIMATED_NOT_RESERVED'|'NONE',code}` を含む。予約・reservation は作らない。
- 見積スナップショットに `couponVersionId` と `couponMaxActiveReservations`（上限なしは null）が入る。

## 2. ゲスト／スタッフ予約（GuestBookingService.choose）

- 入力 `couponCode: string|null`。空文字は不正（`INVALID_COUPON` 422）なので **UI は空欄のとき null を送ること**。形式は英数字とハイフン、1〜32文字。
- 検証は `choose` 時の見積（advisory）で行われ、エラーはそのまま `HoldError` のコード／ステータスで返る（上記コード一覧）。
- 選択済みドラフトの再 `choose` は、同一内容なら冪等、異なる `couponCode` なら `DRAFT_ALREADY_SELECTED`(409)。クーポンを変えるには入力を保存し直す（`save`）。
- `selection.couponCode` と `estimate`（`subtotalJpy`, `couponDiscountJpy`, `advanceDiscountJpy`, `totalJpy`）が `view` に載る。
- 予約準備（`preparePayment`／`checkout`）で、`choose` 後に無効化・上限到達したクーポンは `COUPON_INACTIVE`／`COUPON_LIMIT_REACHED`(409) になる。サーバ保存の selection の金額が正で、クライアントが送る金額・couponCode は信用しない（`reviewHash` 不一致は `PRICE_REVIEW_REQUIRED`）。

## 3. 予約作成（BookingService.create）

- クーポン付き見積から予約を作る同一トランザクションで、有効性と上限（取消等を除く予約数）を再検証。
- 失敗時は予約を作らず `COUPON_INACTIVE`／`COUPON_LIMIT_REACHED`(409)。
- 決済要求額は見積スナップショットの `totalJpy`（割引込み）。割引を二重に引かない。
- 予約の取消・期限切れで `coupon_booking_count` が減り、枠が戻る。

## 4. エラーコード一覧（クーポン関連）

`COUPON_CODE_EXISTS`(409) / `COUPON_NOT_FOUND`(見積経路422・setCouponActive 404) / `COUPON_INACTIVE`(409) / `COUPON_NOT_APPLICABLE`(422) / `COUPON_LIMIT_REACHED`(409) / `INVALID_COUPON`(422) / `PROMOTION_POLICY_UNRESOLVED`(422) / `DISCOUNTS_NOT_COMBINABLE`(422) / `WEAR_COUPON_COMBINATION_UNAPPROVED`(既存の status) / `IDEMPOTENCY_MISMATCH`(409) / `FORBIDDEN`(403) / `INVALID_INPUT`。
