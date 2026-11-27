# 団体予約（DB 0064 コア）の本番導入 — 手順・接続点・Ownerへのお願い・戻し方

作成：2026-11-27 JST（Owner決定・選択肢A を反映して改訂）。雛形は `docs/execution/coupons/RELEASE_RUNBOOK.md`（0063）。団体予約の仕様と実装は `GROUP_INVITE_CORE.md`・`GROUP_CUSTODY.md`・`GROUP_NOTIFICATIONS.md`・`GROUP_CUSTOMER_UI.md`・`GROUP_ADMIN_UI.md` が正本。
本書は本番導入の道具（復元記録・インストーラ・読取専用の検証）と、その手順・限界を定める。**本書の作業は本番・Neon・Vercel・GitHubに接続しない（実行はOwnerの別の指示の後）。** 実際の団体の受付・メール送信・現地精算・貸出は行わない。

## 0. 決定と現状

### 0-1. 【解決済み】0064 を「団体コア（0064）」と「貸出接続（0065）」に分けた。0065 は保留
元の 0064 は、本番では `neondb_custody_executor` が所有する関数を触るため `neondb_owner` では適用できなかった（通常の貸出トリガ `rental_validate_loan` の作り直し、`rental_apply_receipt` / `rental_stage_guard` の置換、`rental_validate_group_loan` の所有者変更が `42501` で拒否され、全体が戻る。分割前に実測済み）。Ownerは2026-11-27に **選択肢A（団体コアだけ先に出す）** を決定した。

| 移行 | 内容 | 本番での扱い |
|---|---|---|
| **0064** `0064_group_order_core.sql`（団体コア） | 団体の13テーブル、`GROUP_RESERVED`（期限なし）、団体の関数・トリガ、`GROUP_*` 権限（ADMINのみ）、通知outbox。executor所有オブジェクトに一切触れない | **今回導入する**。`neondb_owner` だけで適用できる |
| **0065** `0065_group_custody_link.sql`（貸出接続） | 貸出の列（`group_part_id`/`hold_id`）、`group_part_preparations`、団体の貸出検証、団体対応の `rental_apply_receipt`/`rental_stage_guard`/`rental_inventory_blocks`、完全な `group_custody_stage_ok`/`group_custody_hold_update`/`group_order_guard`/`group_consistency` | **特権経路が決まるまで本番に適用しない（保留）**。0065 未適用で本番を動かす状態を正式に許す |

実測（隔離PostgreSQL・本番と同形のトポロジ。`tests/operations/production-0057-owner-apply.ts`）：
- 0064 は `neondb_owner` で適用でき（登録 63 → 64）、`rental_apply_receipt` / `rental_stage_guard` / `rental_validate_loan`、通常の貸出トリガ、`rental_inventory_blocks` は**バイト単位で不変**、ロール・メンバーシップ・LOGIN・パスワードの変更0、新規13テーブルは owner 所有で空。
- 0065 を `neondb_owner` で適用すると `42501` で拒否され、何も変わらず未登録のまま（保留の理由）。

**0065 未適用でも安全に動く設計**：団体の貸出・準備・返却の画面/API（`GroupCustodyPanel`、`CustodyService` の団体メソッド）は、DB の実体（貸出の列・準備表・団体の貸出検証関数・有効なトリガがすべて在るか。`packages/core/src/group/custody-link.ts`）から 0065 未適用を検知し、**`GROUP_CUSTODY_NOT_ACTIVATED`（409）で閉じる**（スタッフ画面には「まだ有効になっていません。通常の個別貸出には影響しません」と出る）。環境変数での推測はしない。0065 が後から入れば再起動なしで有効になる。通常の個別貸出・返却・カレンダー・割当は団体の列を読まないので影響を受けない（`ZAO_TEST_CUSTODY_LINK=0` の両状態で通常の貸出試験が通る）。

**0065 は別途（特権経路の設計後）**：Neon側の特権操作、または空のDBへ全移行を新規ブートストラップして復元する構成のどちらかを、Ownerと別に設計する。そのときに 0065 用の復元証拠・導入・権限付与（custody/operations の団体表 SELECT と準備表、executor の SELECT）を作る。**本書の道具は 0065 の導入も権限付与も行わない。** 0065 が何かの経路で入った後は、`verify-group` がそれを別枠（`custodyLink: APPLIED`）で、構造と必要な権限の完全一致を確認する。

### 0-2. 本番の接続点（本PRで実装した。資格情報・Owner制御の値が無ければ閉じたまま）
| 接続点 | 実装 | 閉じている条件 |
|---|---|---|
| 顧客の団体API `/api/group` | `packages/core/src/guest/production-runtime.ts` が、本番設定の `group` サービス（DBロール `<db>_group`）で団体プールを開き、`GroupOrderService`/`GroupCustomerService` と顧客向けレート制限（予約と同じ `GuestSecurity`）を組み立てる。`apps/web/src/lib/group-runtime.ts` の `groupBoundary()` はこの接続を返す | 資格情報 `PRODUCTION_DB_PASSWORD_GROUP` が無い、接続できない、ロールの検査に落ちる、または DB が未準備（0064 未適用・ロールの権限不足）の間は `GROUP_UNCONNECTED`（503）。**団体の接続の失敗が予約・スタッフ業務の起動を止めることはない** |
| スタッフの団体API `/api/staff/groups` | 本番のスタッフruntimeに `groupPool` を追加（同じプール） | 同上。`GROUP_NOT_CONNECTED`（503） |
| 団体の通知 | `GroupNotificationWorker` を cron の `/api/internal/worker-tick`（毎分、既存の finite な tick）から1回だけ起動。実メールは予約通知と同じ承認済み Resend 経路のみ | `PRODUCTION_WORKER_GROUP_NOTIFICATION_LIMIT`（0〜20）が未設定または 0 の間は outbox を見もしない。団体プールかメール結線が無ければ `UNCONNECTED` で何も送らない。配信は行ごとの lease・冪等キー・UNKNOWN は lookup のみ（再送しない）・古い状態の通知は SUPPRESSED |
| 団体の入口 | 0064 は入口行を作らない | **Owner が管理画面（`/staff/groups`）で有効化するまで閉じたまま**（入口なし＝`ENTRANCE_UNAVAILABLE` 404。`tests/readiness/production-group-connection.ts` で確認） |

接続に使う DB ロールは `<db>_group`（本番は `neondb_group`）。NOLOGIN の作成は grants インストーラ、LOGIN と資格情報の設定は Owner が別途行う（秘密は人が入力し、実装担当は扱わない）。ロール名は既定で `<db>_group`（`PRODUCTION_DB_ROLE_GROUP` で上書き可）。承認済みの本番構成（`productionServices` のロール表）に `group` を加えたので、構成の digest はこの版で更新される。

## 1. 仕様
| 項目 | 内容 |
|---|---|
| 追加するもの（0064） | 13テーブル、関数（新規18、トリガ関数を含む）、トリガ、`group_number_seq`、`inventory_holds` の `GROUP_RESERVED`（期限なし）、ADMINの `GROUP_*` 権限7種。通常予約の意味は変えない（通常の仮押さえは従来どおり期限必須） |
| 本番ロール | 団体用 `<db>_group`（アプリの団体操作。0064のDBガードは `session_user=<db>_group` だけを許す）。通知ワーカーは同じロールの**配信列だけの UPDATE**（通知の中身は更新不可）。custody/operations には 0064 では何も付与しない |
| 非機能 | 団体は `rental_bookings`・決済・provider行を作らない（現地精算のみ）。承認根拠は `GROUP_ADMIN_APPROVED`。時間で何も解放されない |

## 2. DB変更 0064 と権限（最小権限・PUBLICに何も付けない）
`packages/db/migrations/0064_group_order_core.sql`。導入の道具は `scripts/production-group-delta.ts`。復元証拠は **63本のまま**（`scripts/production-restore-evidence-pre0064.ts`。0065用は作らない）。

**migrate**（`production:install-group-migration`）：登録が正確に0001〜0063・checksum一致、`group_orders` なし、貸出接続（0065）が全く無いこと、を確認し、0064を1トランザクションで適用して読み戻す。全13テーブルが owner 所有・空、20トリガが `tgenabled` O/A、新規関数の SECURITY DEFINER・search_path固定・所有者、**executor所有の `rental_apply_receipt`・`rental_stage_guard`・`rental_validate_loan` と通常の貸出トリガが定義・ACL・設定まで不変**、ロール数・メンバーシップ不変、を確認してからCOMMIT。COMMIT後は構造だけを読み戻す（その間に本番が書いても正常）。再実行は拒否。

**grants**（`production:install-group-grants`、登録0001〜0064が前提）：
- `<db>_group` を **NOLOGIN・無権限・メンバーシップなし** で作る。作成は既存の NOLOGIN ロール管理者 `<db>_role_admin` に `SET LOCAL ROLE` して行う（owner自身が作ると取り消せないADMINが残るため。17個の運用ロールと同じ流儀）。変化は「ロール+1、管理者のメンバーシップ+1」のみ。LOGINと資格情報はこの手順では設定しない。
- `<db>_group` の権限 = `<db>_hold` の権限（表・列・シーケンス・関数・スキーマUSAGE、カタログから読み取って複写）＋ `price_books`/`price_activations`/`booking_actors`/`provisional_capacity_buckets` のSELECT（holdに無い場合のみ）＋団体表のDML（`group_entrance`/`group_orders`/`group_order_parts`/`group_change_requests` は SELECT/INSERT/UPDATE、`group_members` は DELETE も、追記専用の8表は SELECT/INSERT のみ）＋ `group_number_seq` の USAGE ＋ `group_register_actor(uuid)` の EXECUTE ＋ `group_notification_outbox` の配送列のみUPDATE（status, attempt_count, next_attempt_at, claim_id, claim_until, provider_message_id, sent_at, last_safe_failure_code。通知の中身 admin_message/event_type/dedupe_key 等は更新不可）。**貸出接続のための付与（custody/operations/executor の団体表 SELECT、準備表）は 0065 側のものなのでここでは付けない。**
- 他のロール（pricing・hold・guest・recommendation・transfer・operations 等）とPUBLIC：団体表に何もなし。`group_register_actor` ほか0064がREVOKEした関数にPUBLICの実行権なし。
- 付与後、団体関連の全ACLを**完全一致**で証明する（余分・不足の両方で失敗。operations に団体表の権限が1つでもあれば失敗）。再実行は拒否（`<db>_group` が既にあれば停止）。

**verify**（`production:verify-group`、READ ONLY）：0001〜0064の登録（0065が登録されていればそれも別枠で読む）、全13テーブル・関数・トリガ（有効状態）、所有者、SECURITY DEFINER・search_path固定、権限の完全一致、貸出接続の不在（または 0065 登録時はその正確な形と必要権限）を確認し、件数（団体数・進行中の団体数・入口行数・イベント数・未配送の通知数・団体の仮押さえ数）と `custodyLink`（`NOT_APPLIED`/`APPLIED`）・`groupRoleLogin` だけを返す。書き込み0。**本番の正は「0064のみ・`custodyLink: NOT_APPLIED`」。**

## 3. 本番公開の順序
1. PRの自然CI SUCCESS と独立レビュー → 通常のsquash merge。
2. **Owner**：merge後の最新バックアップで復元試験（**63本の登録**。入力ファイルに `expectedMigrations: 63`）。age秘密鍵は人が非表示入力のみ。実装担当は鍵を扱わない。結果は `restore-drill-result-pre-0064.json`。
3. 実装担当：`npm run production:restore-evidence-finalize-pre-0064`（記録 `restore-pass-pre-0064.json`、24時間有効。0063までの世代（53/55/58/61/62本）の記録では開かない。逆に63本の記録は旧世代のゲートを開かない）。
4. `npm run production:install-group-migration`（**0064のみ**。pre-0064 の復元記録・accepted main・verify-full TLS が前提。再実行は拒否、COMMIT後は読み戻しのみ）。
5. `npm run production:install-group-grants`（`neondb_group` を **NOLOGIN で作成**し、最小権限を付与）。
6. **Owner**：`neondb_group` を LOGIN 可にし、資格情報を設定する（下の「Ownerにお願いする操作」の 3〜4。秘密は人が入力。実装担当は扱わない）。
7. `npm run production:verify-group`（READ ONLY）：完全一致・件数・`custodyLink: NOT_APPLIED`・`groupRoleLogin: true` を確認。
8. 公開許可（`PRODUCTION_RELEASE_ID`/`PRODUCTION_PUBLICATION_APPROVAL`）を、受け入れ済みの新しいmainに結び直す。
9. 同一artifactを公開ドメインに付けずに配信 → 2回の確認 → promote。
10. **Owner**：管理画面（`/staff/groups`）で団体の入口を有効化。入口は再発行まで存在しない（0064は入口行を作らない）。
11. 公開後：実際の団体の受付・メール送信は、Ownerの指示がある場合だけ、合成の団体で行う。団体の貸出・返却は 0065 の導入後（それまでスタッフ画面は「まだ有効になっていません」と表示）。

## 4. Ownerにお願いする操作（番号付き）
1. **復元試験（63本）**：merge後の最新バックアップで復元試験を行う。入力ファイルは `expectedMigrations: 63`。age秘密鍵は人が非表示で入力する（実装担当に渡さない）。
2. **実装担当への実行指示（3回に分けて、各回の結果を確認してから次へ）**：(a) pre-0064 の記録の確定、(b) `production:install-group-migration`、(c) `production:install-group-grants`。いずれも固定コードで止まり、再実行は拒否される。`PRODUCTION_GROUP_EXECUTOR_OWNED_OBJECTS_BLOCKED` で止まった場合は本番のロール構成が実測と変わっているので、実行を中断して知らせる。
3. **`neondb_group` を LOGIN 可にする**：NOLOGIN で作られたロールを、`neondb_role_admin` に切り替えて `ALTER ROLE neondb_group LOGIN;` の1文だけ実行する（他の属性は変えない）。※本番での実測は未実施。商用ロールの流儀（`scripts/production-credential-activation.ts`）に合わせた同等の手順を別途用意する場合は、その指示を待つ。
4. **`neondb_group` の資格情報を設定する**：Neon の Roles 画面で `neondb_group` のパスワードを新規発行し、表示された値を**その場で**Vercel の Production 環境変数 `PRODUCTION_DB_PASSWORD_GROUP`（Sensitive）へ貼る。端末・チャット・ログ・画面共有に残さない。これで資格情報が揃うまでは団体のAPIは `GROUP_UNCONNECTED`（503）で閉じたまま。
5. **実装担当に `verify-group` の実行を指示**し、結果（`custodyLink: NOT_APPLIED`、`groupRoleLogin: true`、件数0）を確認する。
6. **公開許可の結び直しと配信の承認**：新しいmainへ結び直し、同一artifactの配信（公開ドメインに付けない）→ 2回の確認 → promote を承認する。
7. **団体の入口を有効化**：管理画面 `/staff/groups` で入口を有効化する（`GROUP_ENTRANCE_MANAGE`。ADMINのみ）。有効化するまで顧客は団体の申込を始められない。
8. **（任意・入口の有効化より前に）団体通知の送信を開く**：Vercel の Production 環境変数 `PRODUCTION_WORKER_GROUP_NOTIFICATION_LIMIT` を 1〜20 に設定する（未設定または 0 の間は一通も送らない）。環境変数の変更は新しい配信から有効になる。メールは既存の承認済み Resend の設定でのみ送られる。
9. **（別途の判断）0065 の特権経路**：団体の貸出・返却を本番で使うには 0065 が要る。Neon側の特権操作で適用するか、空のDBへ全移行を新規ブートストラップして復元するかを、別に決める。決まるまで貸出・返却は無効のまま（通常の貸出は影響なし）。

## 5. 戻し方
- **DBは戻さない。** 0064は追加のみ（既存の行は変えない）。団体のテーブルは追記専用の部分が多く、削除できない。
- アプリを旧版へ戻す場合：旧版は団体を知らないため、団体の仮押さえ（`GROUP_RESERVED`、期限なし）は**解放されないまま残り、その在庫は旧版からも占有として見える**（既存の在庫述語が `allocation_stage<>'PROVISIONAL'` を保護として読むため）。戻す前に `production:verify-group` で団体の仮押さえ数・進行中の団体数を控え、Ownerが判断する。
- 戻す先は、正式domainに過去に付いていた既存のimmutable deploymentに限る（`vercel promote`）。戻した後も `verify-group` と `/api/readiness` を確認する。
- 団体の接続だけを止めたい場合は、Vercel の `PRODUCTION_DB_PASSWORD_GROUP` を外して配信し直す（団体APIは 503 で閉じる。予約は影響なし）。通知だけを止めたい場合は `PRODUCTION_WORKER_GROUP_NOTIFICATION_LIMIT` を 0 にする。
- 0064そのものの取消し（表・関数の削除）は行わない。必要な場合はOwnerと新しい前進移行を作る。試験用の巻き戻し（`tests/fixtures/rewind-0064.ts`、`rewind-0065.ts`）は隔離DB専用で、本番の手順ではない。

## 6. 証拠の層
| 層 | 内容 | 状態 |
|---|---|---|
| SOURCE_IMPL | `0064_group_order_core.sql`（コア）、`0065_group_custody_link.sql`（貸出接続・本番未適用）、`migration-plan.ts`、`bootstrap-source-manifest.json`（sha256固定）、開発のロール付与（`scripts/group-role.ts`・`group-notification-role.ts`・`custody-roles.ts`・`operations-roles.ts`）、`production-group-delta.ts`・`production-install-group.ts`・`production-restore-evidence-pre0064.ts`、接続（`production-runtime.ts`・`group-runtime.ts`・`worker-tick.ts`・`notification-lane.ts`・`custody-link.ts`） | 実装済み |
| LOCAL_TEST（本番トポロジ） | `tests/operations/production-0057-owner-apply.ts` の0064/0065区間：**0064が `neondb_owner` で適用される**こと、executor所有オブジェクトのバイト同一、ロール・メンバーシップ不変、grants（ロール作成は管理者経由・メンバーシップ+1のみ・権限の完全一致、余分/不足/PUBLIC/他ロール/operations で失敗）、verify（トリガ無効/replica専用で拒否、`NOT_APPLIED`）、0065の owner 適用が 42501 で拒否・未登録、特権経路の模擬で 0065 登録時の verify が別枠で読むこと（`PRIVILEGED-PATH SIMULATION` と明記。本番の手順ではない） | 結果は作業報告 |
| LOCAL_TEST（実PG・合成データ） | `test:group-migration`（0064+0065 と 0064のみの両状態）、`test:group-core-only`（0064のみで `custody-not-activated`・団体コア・通知・管理API・顧客API）、`test:custody-core-only`（0064のみで通常の貸出・返却・遅延受取・注文・カレンダー・帳票・在庫・不足・スタッフ注文）、`test:production-group-connection`（本番runtimeの実組立：資格情報あり/なし/接続不可/権限不足、入口は有効化まで閉じる）、通知レーン・tick の単体試験、既存の `test:group*`（0065まで） | 結果は作業報告 |
| LIVE | Owner本人の復元試験（手順2）、本番への導入（手順4〜5）、`neondb_group` のLOGINと資格情報、団体の接続の実機確認、通知配送、入口の有効化、公開後の確認、0065 | **未実施。このPRでは行わない** |

fake・合成の結果は LIVE の合格を意味しない。本番導入と公開はOwnerの別の指示が必要。
