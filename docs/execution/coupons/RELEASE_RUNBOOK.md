# クーポン管理（一覧・新規作成・有効/無効・利用状況）と予約での適用 — 仕様と本番公開手順

作成：2026-11-25 JST（実装担当A：DB移行と周辺。Owner最優先指示「管理者向けにクーポン一覧・新規作成・有効/無効・利用状況を実装し、顧客予約フォームとスタッフ予約で適用できるようにする」）。
本書は DB 変更（0063）と本番導入の手順を定める。管理画面・予約画面の細部は各担当の実装とそのテストが正本。実クーポンの発行・実決済・実メールは行わない。

## 1. 仕様
| 項目 | 内容 |
|---|---|
| 既存の土台 | `coupon_versions`（条件は不変・追記のみ）、`coupon_reservations`、`QuoteService.createCoupon / reserveCoupon`、`packages/contracts/src/pricing.ts` の `calculate`（割引計算）。これらの意味は変えない |
| 追加するもの | 有効/無効の状態、利用状況（予約数）、管理画面 `/staff/coupons`、顧客予約フォームとスタッフ予約での適用 |
| 有効/無効 | クーポン条件そのものは変更できない（不変）。状態は「有効/無効」のイベントを**追記**して表す。最新のイベントが現在の状態。イベントが無いクーポンは**有効**（0063より前に発行された既存クーポンは従来どおり使える） |
| 利用状況 | 「そのクーポンで見積もられた予約」の数。取消済み、および期限切れ・未払いのまま保留が解放された予約は数えない（§2） |
| 権限 | 状態の変更は価格編集権限（PRICE_EDIT）を持つスタッフのみ（既存の `QuoteService.createCoupon` と同じ）。操作者は監査（`pricing_history`）に残る |

## 2. DB変更 0063（`packages/db/migrations/0063_coupon_admin.sql`）
追加のみ。0001〜0062は変更せず、既存の行も変更しない。
- 表 `coupon_status_events(id, coupon_id, active, actor, reason, created_at)`：追記専用。UPDATE/DELETEは所有者も含め拒否（`pricing_immutable`、SQLSTATE 23514）。INSERTは `pricing_lock`（advisory lock 71820800）で直列化し、`pricing_audit` が `pricing_history` に操作者付きで記録する。`actor` は `booking_actors(id)` を参照（`coupon_reservations.actor` と同じ。スタッフは登録時に自動で `booking_actors` に入る）。`reason` は160文字まで。
- `coupon_is_active(uuid)`：最新イベント（`created_at`、`id` の降順）の `active`。イベントが無ければ true。STABLE、SECURITY DEFINER、search_path固定、PUBLICの実行権なし。
- `coupon_booking_count(uuid)`：`rental_bookings` と `price_quotes` を結び、`price_quotes.coupon_id` が一致する予約の数（integer）。SECURITY DEFINER、search_path固定、PUBLICの実行権なし。数以外は返さない。
  - 数えない予約：`state='CANCELLED'`（予約状態は DRAFT / PAYMENT_PENDING / PAYMENT_REVIEW / CONFIRMED(_DEV) / COMPLETED(_DEV) / CANCELLED のいずれかで、終端の否定状態は取消のみ。0045 `booking_state_valid`）。
  - 期限切れ・失敗：予約行は DRAFT / PAYMENT_PENDING のまま保留（`inventory_holds`）だけが EXPIRED / RELEASED になる（0049・0053）。そのため「未払い（DRAFT・PAYMENT_PENDING）で保留が EXPIRED または RELEASED」も数えない。
  - 数える予約：確定・完了（保留は0017により RELEASED になるが数える）、PAYMENT_REVIEW（金銭が動いた可能性があるため保留の状態を問わず数える）、保留が有効な DRAFT / PAYMENT_PENDING。
- 権限（最小権限）：
  - 価格ロール（`<db>_pricing`、QuoteServiceが使う）：`coupon_status_events` の SELECT/INSERT、2関数のEXECUTE。UPDATE/DELETEなし。
  - 予約ロール（開発DBの `<ns>_flow`、本番の `<db>_operations`）：2関数のEXECUTEのみ。表へのアクセスなし。
  - 他のロール（hold、recommendation、guest 等）と PUBLIC：何もなし。
  - 付与の場所：開発 `scripts/application-roles.ts`・`scripts/flow-roles.ts`・`scripts/operations-roles.ts`、本番導入（0062以降の移行の付与は本番ロール計画に入れず、既存の流儀どおり導入スクリプトで行う） `scripts/production-coupon-admin-delta.ts`（`grants`）。
- 0063未適用のDBでは、新しい版はクーポンの状態・利用数を使えない。**本番は必ず先に0063を適用してから新しい版を配信する**（§3の順序）。
- 復元の分類：`coupon_status_events` は事業状態（`scripts/local-restore.ts` の RESTORE_REQUIRED）。

## 3. 本番公開の順序（売り止め 0062 と同じ安全手順）
本書の作業は本番・Neon・Vercel・GitHubに接続しない（実行はOwner判断の後）。
1. PRの自然CI SUCCESS と独立レビュー（B/H/M 0）→ 通常のsquash merge。
2. **Owner**：merge後の最新バックアップで復元試験（**62本の登録**、`expectedMigrations: 62`）。age秘密鍵は**人が非表示入力**のみ。実装担当は鍵を扱わない。
3. 実装担当：`npm run production:restore-evidence-finalize-pre-0063`（記録 `restore-pass-pre-0063.json`、24時間有効。53/55/58/61本の記録では開かない）。
4. `npm run production:install-coupon-admin-migration` → `npm run production:install-coupon-admin-grants`（どちらも pre-0063 の復元記録・accepted main・verify-full TLS が前提。再実行は拒否、COMMIT後は読み戻しのみ）。
5. `npm run production:verify-coupon-admin`（READ ONLY）：0001〜0063の登録、`coupon_status_events` と2関数の存在・所有者（owner）、SECURITY DEFINER・search_path固定、3つのトリガー（`tgenabled` が O か A のみ）、権限の完全一致（価格：SELECT/INSERT＋関数、予約：関数のみ、PUBLIC：なし）を確認し、イベント数・無効クーポン数・クーポン数（件数のみ）を返す。書き込み0。
6. 公開許可（`PRODUCTION_RELEASE_ID`/`PRODUCTION_PUBLICATION_APPROVAL`）を、受け入れ済みの新しいmainに結び直す（sales-stop RELEASE_RUNBOOK §3-5 と同じ。通常の公開GOを取り直さない）→ 同一artifactを公開ドメインに付けずに配信 → 2回の確認 → promote。
7. 公開後：実クーポンの発行は行わない。確認はOwnerの指示がある場合だけ、合成のコードで管理画面の一覧・有効/無効の表示を見る。

## 4. 戻し方
- **DBは戻さない。** 0063は追加のみ。`coupon_status_events` は追記専用で、削除・上書きできない（誤って無効にした場合は「有効」のイベントを追記して戻す）。
- アプリを旧版へ戻す場合：旧版は有効/無効を知らないため、**無効にしたクーポンが再び使える**。戻す前に `production:verify-coupon-admin` で現在の無効クーポン数を控え、無効のクーポンが使えてよいかをOwnerが判断する（必要なら新しい版のまま修正して再公開）。
- 戻す先は、正式domainに過去に付いていた既存のimmutable deploymentに限る（`vercel promote`）。env変更だけで反映されたとは見なさない。戻した後も `verify-coupon-admin` と `/api/readiness` を確認する。
- 0063そのものの取消し（表・関数の削除）は行わない。必要な場合はOwnerと新しい前進移行を作る。

## 5. 証拠の層
| 層 | 内容 | 状態 |
|---|---|---|
| SOURCE_IMPL | `0063_coupon_admin.sql`、`migration-plan.ts`、`bootstrap-source-manifest.json`（sha256固定）、ロール付与（開発3）、`production-coupon-admin-delta.ts`・`production-install-coupon-admin.ts`・`production-restore-evidence-pre0063.ts` | 実装済み |
| LOCAL_TEST（実PG・合成データ） | `tests/operations/coupon-admin-migration.ts`（`npm run test:coupon-admin-migration`）：イベント追記・最新優先・イベント無し=有効・監査・UPDATE/DELETE拒否・不正な操作者/クーポン/長い理由の拒否・予約ロールは関数のみ・hold/recommendationは不可・利用数（取消/期限切れ未払い/他クーポン/クーポン無しを数えない） | 6/6 PASS（検証ログは作業報告） |
| LOCAL_TEST（本番トポロジ） | `tests/operations/production-0057-owner-apply.ts` の0063区間（neondb_ownerで62→63、ロール/メンバー不変、所有者、再実行拒否、トリガー無効/replica専用でverify拒否、権限の完全一致）、`production-bootstrap*`・`production-foundation`（63本）、`production-role-plans`、`production-restore-drill`（pre-0063の62本の復元と検証器の相互拒否）、unit（pre-0063復元証拠・インストーラーの入場順序） | 結果は作業報告 |
| LIVE | Owner本人の復元試験（手順2）、本番への導入（手順4〜5）、公開後の確認 | **未実施。このPRでは行わない** |

fake・合成の結果は LIVE の合格を意味しない。本番導入と公開はOwnerの別の指示が必要。
