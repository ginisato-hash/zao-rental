# 団体予約（DB 0064）の本番導入 — 手順・接続点の現状・戻し方

作成：2026-11-27 JST。雛形は `docs/execution/coupons/RELEASE_RUNBOOK.md`（0063）。団体予約の仕様と実装は `GROUP_INVITE_CORE.md`・`GROUP_CUSTODY.md`・`GROUP_NOTIFICATIONS.md`・`GROUP_CUSTOMER_UI.md`・`GROUP_ADMIN_UI.md` が正本。
本書は本番導入の道具（復元記録・インストーラ・読取専用の検証）と、その手順・限界を定める。**本書の作業は本番・Neon・Vercel・GitHubに接続しない（実行はOwnerの別の指示の後）。** 実際の団体の受付・メール送信・現地精算・貸出は行わない。

## 0. 先に読む：このPRで分かった2つの未解決点（導入前にOwnerの判断が要る）

### 0-1. 【ブロッカー・実測】0064 は `neondb_owner` では適用できない
0064 は次の3点で、本番では `neondb_custody_executor` が所有する関数を触る。
- 通常の貸出トリガ `rental_validate_loan` を作り直す（`CREATE TRIGGER` には対象関数の EXECUTE が要る。この関数は executor 所有で PUBLIC の実行権なし）。
- `rental_apply_receipt(uuid)` と `rental_stage_guard()` を `CREATE OR REPLACE` する（所有者でないと不可）。
- `rental_validate_group_loan()` の所有者を executor に変える（executor へのメンバーシップが要る）。

本番のトポロジ（owner も role admin も custody ロールのメンバーではない。0057 の `R65_0057_OWNER_PATH_BLOCKER` と同じ型）では、これらは PostgreSQL が `42501` で拒否し、トランザクション全体が戻る。`tests/operations/production-0057-owner-apply.ts` の0064区間が、Neon型の隔離PostgreSQLで次を再現・検査している。
- インストーラ `migrate` は固定コード `PRODUCTION_GROUP_EXECUTOR_OWNED_OBJECTS_BLOCKED` で停止する。
- 0001〜0063の登録、ロール、メンバーシップ、既存関数、ガード関数は一切変わらない（部分適用なし）。

0057 のときは「executor所有関数の置換を移行から外す」ことで解決した。0064 では、貸出（団体の貸出トリガと受領）の仕様そのものがこれらの関数に依存するため、同じ方法では解決できない。**導入前にOwnerが方針を決める必要がある。** 選択肢（このPRでは実装しない）：
1. 0064 を「団体コア（owner適用可能）」と「団体の貸出接続（executor所有関数に触れる部分）」に分け、前者だけ先に導入する。団体の貸出・返却は後者が入るまで本番で使えない（現状の本番は団体の入口が未接続なので影響は小さい）。
2. executor 所有関数を変更できる特権経路（Neon側の特権操作、または空のDBに全移行を新規ブートストラップして復元する構成）を別途設計する。

このPRの `grants`・`verify`・pre-0064復元記録・試験は、0064がどの経路でDBに入っても使える。試験では「0064が何らかの特権経路で入った後」の状態を、隔離クラスタの特権ユーザーで再現して `grants`・`verify` を証明している（`PRIVILEGED-PATH SIMULATION`と明記。本番の手順ではない）。

### 0-2. 団体の入口は本番にまだ接続されていない（未実装）
コードを読んだ結果、本番では次の3か所が**環境変数や構成では接続できない**（固定で未接続）。DBに0064が入り、権限が揃っても、団体の画面は動かない。

| 接続点 | 現状（根拠） | 必要な作業（未実装） |
|---|---|---|
| 顧客の団体API `/api/group` | `apps/web/src/lib/group-runtime.ts` の `groupBoundary()` が、`productionRequested()` が真、または `NODE_ENV==='production'` のとき**無条件で null** を返し、`group-http.ts` が `GROUP_UNCONNECTED`（503）を返す。読む環境変数は開発用の `ZAO_GROUP_RUNTIME` だけ（接続先は 127.0.0.1 かつ `<namespace>_group` に限定） | 本番用の `group` DBサービス（`packages/auth/src/production-config.ts` の `productionServices` は auth/ledger/hold/transfer/pricing/recommendation/operations/guest/content_read/avatar_read/booking_access のみ。承認済み構成の digest と各ロール表が変わる）、`<db>_group` の LOGIN と資格情報（Ownerが設定）、`production-runtime.ts` での `GroupOrderService`/`GroupCustomerService` の組み立て、顧客向けのレート制限（`GuestSecurity`）の本番ピア鍵の結線 |
| スタッフの団体API `/api/staff/groups`（入口の再発行・有効化、一覧、確約など） | `apps/web/src/app/api/staff/groups/[[...record]]/route.ts` は `getRuntime().groupPool` を読むが、本番のスタッフruntime（`production-runtime.ts` の `staff`）は `groupPool` を持たない。`GROUP_NOT_CONNECTED`（503） | 上の `group` サービスのプールを本番の `staff` に載せる |
| 通知の配送 | `GroupNotificationWorker`（`packages/core/src/group/notification-worker.ts`）は**アプリ側のどこからも生成されていない**（試験のみ）。本番の定期処理 `vercel.json` の cron `/api/internal/worker-tick`（毎分）→ `handleWorkerTick` は決済・返金・予約通知だけを処理する。団体の通知行（`group_notification_outbox`）は PENDING のまま残り、**何も送られない**（誤送信はしない） | `GroupNotificationWorker(groupプール, origin, 配送アダプタ).runBatch(limit, deadline)` を tick に1行追加（`GROUP_NOTIFICATIONS.md` §6）。配送アダプタは予約通知と同じ `ResendDelivery`。**本番で団体の受付を始める前に必要**（受付メール・確約メールが出ないため） |

最小実装はこのPRに含めていない。理由：承認済みの本番構成の digest・資格情報・ロール表・公開許可を変えるため、独立した設計判断とレビューが要る範囲であり、導入道具（本PR）と混ぜると戻しが難しくなる。**接続のPRを別に作る**。それまでは、0064を入れても本番の振る舞いは変わらない（入口 503、通知なし）。

## 1. 仕様
| 項目 | 内容 |
|---|---|
| 追加するもの | 14テーブル（団体用13＋貸出側の準備記録 `group_part_preparations`）、関数（新規21＋置換2）、トリガ、`group_number_seq`、`inventory_holds` の `GROUP_RESERVED`（期限なし）、ADMINの `GROUP_*` 権限7種。通常予約の意味は変えない（通常の仮押さえは従来どおり期限必須） |
| 本番ロール | 団体用 `<db>_group`（アプリの団体操作。0064のDBガードは `session_user=<db>_group` だけを許す）。通知ワーカーは同じロールの列限定UPDATE。貸出は既存の `<db>_operations` が団体表を読み、準備記録を書く |
| 非機能 | 団体は `rental_bookings`・決済・provider行を作らない（現地精算のみ）。承認根拠は `GROUP_ADMIN_APPROVED`。時間で何も解放されない |

## 2. DB変更 0064 と権限（最小権限・PUBLICに何も付けない）
`packages/db/migrations/0064_group_order_core.sql`（変更しない）。導入の道具は `scripts/production-group-delta.ts`。

**migrate**（`production:install-group-migration`）：登録が正確に0001〜0063・checksum一致、`group_orders` なし、を確認し、0064を1トランザクションで適用して読み戻す。全14テーブルが owner 所有・空、24トリガ（`rental_validate_loan` の作り直しを含む）が `tgenabled` O/A、新規関数21の SECURITY DEFINER・search_path固定・所有者、置換した2関数（`rental_apply_receipt`・`rental_stage_guard`）の所有者/ACL/設定が不変、ロール数・メンバーシップ不変、を確認してからCOMMIT。COMMIT後は構造だけを読み戻す（その間に本番が書いても正常）。再実行は拒否。§0-1 のとおり、現状の本番トポロジではここで固定コードで停止する。

**grants**（`production:install-group-grants`、登録0001〜0064が前提）：
- `<db>_group` を **NOLOGIN・無権限・メンバーシップなし** で作る。作成は既存の NOLOGIN ロール管理者 `<db>_role_admin` に `SET LOCAL ROLE` して行う（owner自身が作ると取り消せないADMINが残るため。17個の運用ロールと同じ流儀）。変化は「ロール+1、管理者のメンバーシップ+1」のみ。LOGINと資格情報はこの手順では設定しない（接続の別PR、Ownerが人手で）。
- `<db>_group` の権限 = `<db>_hold` の権限（表・列・シーケンス・関数・スキーマUSAGE、カタログから読み取って複写）＋ `price_books`/`price_activations`/`booking_actors`/`provisional_capacity_buckets` のSELECT（holdに無い場合のみ）＋団体表のDML（`group_entrance`/`group_orders`/`group_order_parts`/`group_change_requests` は SELECT/INSERT/UPDATE、`group_members` は DELETE も、追記専用の8表は SELECT/INSERT のみ）＋ `group_number_seq` の USAGE ＋ `group_register_actor(uuid)` の EXECUTE ＋ `group_notification_outbox` の配送列のみUPDATE（status, attempt_count, next_attempt_at, claim_id, claim_until, provider_message_id, sent_at, last_safe_failure_code。通知の中身 admin_message/event_type/dedupe_key 等は更新不可）。
- `<db>_operations`（貸出）：`group_orders`/`group_order_parts`/`group_members`/`group_payments` のSELECT、`group_part_preparations` のSELECT/INSERT、同表の列 `prepared_at`/`prepared_by`/`fit_evidence`/`version` のUPDATEのみ。executor には0064自身が4表のSELECTを付ける。
- 他のロール（pricing・hold・guest・recommendation・transfer 等）とPUBLIC：団体表に何もなし。`group_register_actor` ほか0064がREVOKEした関数にPUBLICの実行権なし（`group_op_allowed` など0064が意図して既定のPUBLIC実行のままにした補助関数は、データ読取りを伴わないため変更しない。`group_staff_can` は権限の真偽だけを返す）。
- 付与後、団体関連の全ACLを**完全一致**で証明する（余分・不足の両方で失敗）。再実行は拒否（`<db>_group` が既にあれば停止）。

**verify**（`production:verify-group`、READ ONLY）：0001〜0064の登録、全14テーブル・関数・トリガ（有効状態）、所有者、SECURITY DEFINER・search_path固定、権限の完全一致を確認し、件数（団体数・進行中の団体数・入口行数・イベント数・未配送の通知数・団体の仮押さえ数）だけを返す。書き込み0。

## 3. 本番公開の順序
1. PRの自然CI SUCCESS と独立レビュー → 通常のsquash merge。
2. **Owner**：merge後の最新バックアップで復元試験（**63本の登録**。入力ファイルに `expectedMigrations: 63`）。age秘密鍵は人が非表示入力のみ。実装担当は鍵を扱わない。結果は `restore-drill-result-pre-0064.json`。
3. 実装担当：`npm run production:restore-evidence-finalize-pre-0064`（記録 `restore-pass-pre-0064.json`、24時間有効。0063までの世代（53/55/58/61/62本）の記録では開かない。逆に63本の記録は旧世代のゲートを開かない）。
4. `npm run production:install-group-migration` → `npm run production:install-group-grants`（どちらも pre-0064 の復元記録・accepted main・verify-full TLS が前提。再実行は拒否、COMMIT後は読み戻しのみ）。**§0-1 のブロッカーが解消するまで migrate は停止する。** Ownerの方針決定が先。
5. `npm run production:verify-group`（READ ONLY）：上記の完全一致と件数を確認。
6. 通知ワーカーの定期処理接続の要否：**要（未実装）**。§0-2 のとおり、接続PRが入るまで通知は一切送られない。団体の受付を開始する前に必須。
7. 公開許可（`PRODUCTION_RELEASE_ID`/`PRODUCTION_PUBLICATION_APPROVAL`）を、受け入れ済みの新しいmainに結び直す → 同一artifactを公開ドメインに付けずに配信 → 2回の確認 → promote。
8. 団体の入口の有効化：**Ownerが管理画面（`/staff/groups`）で実施**。ただし §0-2 の接続（`group` サービス・staff の `groupPool`）が入るまでは `GROUP_NOT_CONNECTED`（503）で実施できない。入口は再発行まで存在しない（0064は入口行を作らない）。
9. 公開後：実際の団体の受付・メール送信は、Ownerの指示がある場合だけ、合成の団体で行う。

## 4. 戻し方
- **DBは戻さない。** 0064は追加のみ（既存の行は変えない）。団体のテーブルは追記専用の部分が多く、削除できない。
- アプリを旧版へ戻す場合：旧版は団体を知らないため、団体の仮押さえ（`GROUP_RESERVED`、期限なし）は**解放されないまま残り、その在庫は旧版からも占有として見える**（既存の在庫述語が `allocation_stage<>'PROVISIONAL'` を保護として読むため）。戻す前に `production:verify-group` で団体の仮押さえ数・進行中の団体数を控え、Ownerが判断する。
- 戻す先は、正式domainに過去に付いていた既存のimmutable deploymentに限る（`vercel promote`）。戻した後も `verify-group` と `/api/readiness` を確認する。
- 0064そのものの取消し（表・関数の削除）は行わない。必要な場合はOwnerと新しい前進移行を作る。試験用の巻き戻し（`tests/fixtures/rewind-0064.ts`）は隔離DB専用で、本番の手順ではない。

## 5. 証拠の層
| 層 | 内容 | 状態 |
|---|---|---|
| SOURCE_IMPL | `0064_group_order_core.sql`、`migration-plan.ts`、`bootstrap-source-manifest.json`（sha256固定）、開発のロール付与（`scripts/group-role.ts`・`group-notification-role.ts`・`custody-roles.ts`・`operations-roles.ts`）、`production-group-delta.ts`・`production-install-group.ts`・`production-restore-evidence-pre0064.ts` | 実装済み |
| LOCAL_TEST（実PG・合成データ） | `tests/operations/group-migration.ts`（`npm run test:group-migration`）：登録・14表・24トリガ（未登録の関数/トリガが無いこと）・開発の団体ロールの権限が本番のgrantsと一致・PUBLIC/他ロール無権限・直接書込み拒否・GROUP_*はADMINのみ。団体の業務挙動は既存の `test:group*` | 6/6 PASS（検証ログは作業報告） |
| LOCAL_TEST（本番トポロジ） | `tests/operations/production-0057-owner-apply.ts` の0064区間：ownerでの適用が固定コードで拒否され何も変わらないこと（§0-1の実測）、特権経路後の `grants`（ロール作成は管理者経由・メンバーシップ+1のみ・権限の完全一致、余分/不足/PUBLIC/他ロールで失敗）・`verify`（トリガ無効/replica専用で拒否）・再実行拒否。`production-foundation`・`production-bootstrap*`（64本）、`production-role-plans`、`production-restore-drill`（pre-0064の63本の復元と、他世代の検証器との相互拒否）、unit（pre-0064復元証拠・インストーラの入場順序・grantsの固定文） | 結果は作業報告 |
| LIVE | Owner本人の復元試験（手順2）、本番への導入（手順4〜5）、`group` サービスの接続、通知配送、入口の有効化、公開後の確認 | **未実施。このPRでは行わない** |

fake・合成の結果は LIVE の合格を意味しない。本番導入と公開はOwnerの別の指示が必要。
