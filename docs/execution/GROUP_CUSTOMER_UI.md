# 団体予約 顧客側（永続入口・5ステップ・安全）実装記録 / runbook

正本: Issue #47 コメント 7197143646（B1 顧客5ステップ・B3 入口/認可/安全）を、Owner最新訂正 7197417902（永続リンク・無期限仮押さえ・現地精算のみ）で上書きした内容。
土台: `GROUP_INVITE_CORE.md`（サービス層・DB 0064）、`GROUP_CSV_V1.md`、`SIZE_EDGE_IMPLEMENTATION.md`。ここではそれらを**呼び出すだけ**で再実装しない。
管理画面(C2)・通知/メール(C3)・貸出準備(C4)は別担当で、本書の範囲外。

## 1. 仕様対応表
| 仕様 | 実装 |
|---|---|
| 永続の団体入口URL | `/{ja\|en}/group/{token}`（256-bitの永続token、`group_entrance` に hash のみ）。page: `apps/web/src/app/[locale]/group/[token]/[[...rest]]/page.tsx`。tokenはURLパス、APIへは `x-group-entrance` ヘッダ（API URLにtokenを載せない） |
| 申請ごとに独立した所有者セッション | 申請開始時にサーバが所有者secretを導出（HMAC(サーバ鍵, 入口token, requestKey)）。HttpOnly / SameSite=Strict / Secure(https) cookie `zao_grp_<groupId>`、Path は `/api/group/g/<groupId>` のみ。サービス層 `OwnerActor{groupId,secret}` へ接続（`apps/web/src/lib/group-http.ts`） |
| 同一URLから複数団体が独立申請・他団体は見えない | 他団体のid/cookieは常に 404（401/403にしない＝存在オラクルなし）。入口だけでは既存団体を開けない。試験で証明 |
| GETは状態を変更しない | GET は catalog / template / 自団体の読取のみ。試験で `group_events` 件数が不変であることを確認 |
| POST: CSRF/Origin/サイズ/rate limit/idempotency | 設定origin完全一致＋`sec-fetch-site: cross-site` 拒否、`application/json` 必須、本文96KiB上限、query拒否、`GuestSecurity.guard`（guest側と同じ共有rate limiter）。start は requestKey で冪等（同key=同団体・同secret）、submit は requestKey 冪等（サービス層 `group_requests`）、他は expectedRevision の楽観ロック |
| 復旧（所有者の回復） | 申請開始時に1度だけ「再開リンク」(`…/{groupId}#k={secret}`)を表示。secretは**URLフラグメント**（サーバに送られずログに残らない）。開くと `POST /api/group/session` でcookieへ交換しフラグメントを消す。入口URLでは既存団体を開けない。メールでの再開リンク送信は C3（通知）の範囲で**未実装**（実メール禁止） |
| 入口閲覧/CSV DL/下書きで在庫0 | catalog・templates・start・advise・save・quote は在庫を書かない（試験: GROUP_RESERVED hold 数が不変）。確保は `submit` のみ |
| 通常ナビ・LP・sitemap・robots に入口を出さない | 公開側のコードは未変更。試験で `/ja` `/en` `/ja/book` 等のHTML・sitemap・robots に token も `/group` リンクも無いことを確認。入口ページは noindex,nofollow（meta＋`X-Robots-Tag`）、`Cache-Control: private, no-store`、`Referrer-Policy: no-referrer`（meta＋ヘッダ）。robots.txtには頼らない |
| ステップ1 団体情報 | 団体名・代表者名・メール・電話(任意)・言語・店舗・日程・貸出/返却時刻・おおよその人数。`startApplication` を呼ぶ。アクセシブルな検証（`role=alert`、最初の不正欄へフォーカス） |
| ステップ2 参加者 | CSV雛形DL（`buildGroupCsvTemplates`: 空/記入例/列説明）、CSV import（`parseGroupCsv`、行・列付きエラー、`diffGroupCsv` の差分プレビュー、**置換/追加の明示**、競合時は反映不可）、画面での行追加/個別変更/コピー/削除（二段階）/複数行一括変更、現在の一覧のCSV書出し（`serializeGroupCsvRows`: 式注入対策）、フィルタ「要確認」「在庫不足」。画面の行検証は `serializeGroupCsvRows`→`parseGroupCsv` の往復（契約の単一正本） |
| ステップ3 推薦・在庫照合 | `packages/core/src/group/group-customer.ts`。`buildMembers`/`rankCandidates`/SIZE-EDGE経路（`RecommendationService.preview` と同じ規則）を使い、可否はアロケータの読取専用 `planMixedAllocation`（1名単位）。全員分の joint plan（物理＋暫定の `planMixedAllocation`＝確約と同じ判定）で不足を検出し、不足なら物理在庫のみの安価な判定で二分探索＋逐次に不足行を特定、個別には可能な隣のサイズ（短め/長め）で全員分に収まる行は初期選択をそちらへ替える（画面に注記）。edge / NEAREST / MANUAL_FIT_REQUIRED は `fit-copy` の共通文言で表示。参加者ごとに 短め/推奨/長め を変更。**サーバが保存時に再導出**し、クライアントのvariant idは一切信用しない。未解決行があれば保存不可（`ROWS_UNRESOLVED`）。行IDは `saveMembers` が保持し不変 |
| ステップ4 見積・同意・送信 | 見積明細（参加者別/用品別/日数/通常割引(bundle)/個別・団体割引/暫定総額）、現地精算の明示、規約・取消条件リンク、同意チェック、規格外サイズがある場合の店舗fit確認チェック（サーバでも `FIT_ACKNOWLEDGEMENT_REQUIRED` を強制）。「確認依頼を送信（仮押さえ）」＝ `consent` → `submit`（全員分を1取引で原子的に確保。失敗・一部不足は何も成立させず行を修正可能なまま）。二重クリックは同一requestKey（sessionStorageに保持）で冪等・UIも排他 |
| ステップ5 受付状況 | 団体予約番号、確認待ち/仮押さえ中・**まだ予約確定ではない**、日程/人数/暫定税込額、確約後は最終見積。変更・辞退は管理者への依頼（`requestFromCustomer`）として記録のみ。**期限・延長の表示は一切無い**。カード入力・決済リンク無し |
| 同意の保存 | 規約版・sha256 は**サーバが** `currentRentalTerms()` から付与（クライアント値を使わない）。`group_consents` にサービス層が保存 |

## 2. 構成
- `packages/core/src/group/group-customer.ts` … `GroupCustomerService`（catalog/templates/行正規化/advise/saveRows/ownerView）。DBは `GroupOrderService` とグループ用role、カタログは既存の guest catalog（公開可能モデルのみ）。
- `apps/web/src/lib/group-http.ts` … HTTP境界（`groupHandler`）。`apps/web/src/lib/group-runtime.ts` … 開発/試験用の接続（`ZAO_GROUP_RUNTIME`、`<db>_group` role）。**本番は未接続で 503 `GROUP_UNCONNECTED`**（グループrole delta と本番composition は別の承認手順。GROUP_INVITE_CORE.md §6）。
- `apps/web/src/components/GroupApplication.tsx` / `group-copy.ts` / `group.css` … UI（JA/EN）。既存 `guest.css` の SALOMON 承認デザイン（2px罫線・四角いコントロール・黒=選択/主要操作）と `PublicFrame` を踏襲。
- サービス層に追加したメソッドは**無し**（`group-service.ts` 未変更）。所有者向けの追加読取（行のprofile・最新見積・同意有無・依頼）は、サービスの `get`（認可）通過後に同一団体のSELECTのみを `group-customer.ts` で行う。

### 個人データの扱い（身長・体重・足長・年齢＝本人に紐づく身体データ、未成年を含み得る）
- 顧客CSVの原本は保存・ログしない（ブラウザ内で解析、サーバへは解析後の行のJSONのみ）。サーバは行を受けるたびに契約で再検証し、保存するのは `group_members.profile/selection/fit`。
- 所有者ビューは staff 専用項目（連絡先・hold id・調整理由）を含まない。エラー応答は `{error:code}` のみ（`ROWS_*` は行番号と固定コードのみ）で、セル文字列を返さない。未知のエラーは不透明な 500。
- 未保存の編集中リストは**このタブの sessionStorage のみ**（送信成功で破棄）。本人情報を localStorage や URL に置かない。
- 行ラベルは自由文として原文保持（`=`始まりも式として解釈しない・React が常にエスケープ）。CSV書出し時のみ `'` を付与する（CSV契約どおり、取込側は `'` を剥がさない）。

## 3. 試験
| 区分 | 試験 | 結果 |
|---|---|---|
| unit | `tests/unit/group-customer.test.ts`（10）: 所有者secret導出、期間、短縮行ID、行の往復検証/ラベル原文/偽ID破棄/101行拒否、wear解決、文言（期限・延長・カード・前払・クーポン語の不在、JA/EN同形）、HTTP境界（503/query/メソッド/Origin/入口ヘッダ/不透明500/存在オラクルなし）、cookie属性 | 全通過 |
| 実PG＋実Next(dev)＋HTTP | `npm run test:group-customer-api`（13）: 入口、start冪等、隔離、再開リンク、CSRF/転送、5ステップ、状況、行の再導出、**100名**（advise 約0.2s / 保存 0.1s / 見積 0.02s / submit 0.1s）、不足局所化（約3s）と管理者解除後の再送信、公開面に入口0、入口停止/再開、rate limit(429)、ログにPII無し | 全通過 |
| 実PG＋実ブラウザ(Chromium)＋dev server | `npm run test:group-customer-ui`（13）: JA/EN×390/1440 の全5ステップ（CSV DL→**編集ファイルimport**→行追加/削除/コピー→1名変更→照合→見積→submit→実hold、DBで `GROUP_RESERVED` ・`expires_at` NULL・予約/決済行0・決済関連リクエスト0）、リロード/第2タブ、回復/隔離、CSVエラー（行・列）/式注入/PII列拒否、SIZE-EDGE（edge表示・MANUAL_FIT_REQUIRED は進行不可・短め選択・fit確認必須・行ID不変）、在庫不足（照合で指摘、送信直前に他団体が確保→失敗で何も確保されず修正可）、100名UI、320/720px リフロー、キーボード | 全通過 |
| 既存回帰 | `test:unit`(1281)、`test:group`(15)、`test:flow-ui`、`test:size-edge-ui`、`lint`、`tsc`、`npm run build` | 全通過 |

100名のUI計測（dev server、本番相当ではない）: 取込+描画 約0.2s、1行編集 約30ms、照合 約0.4s、保存+見積 約0.5s、送信 約0.2s。照合・送信は1クリック=1リクエスト（二重クリックでも重複呼出なし）。

## 4. 運用 runbook（顧客側）
- 入口の発行/停止/再発行は管理側（`rotateEntrance` / `setEntranceEnabled`）の任意操作のみ。通常のrelease・年度変更では変更しない。停止しても既存の申請は影響を受けない。
- 顧客が所有者cookieを失った場合: 再開リンク（申請開始時に1度だけ表示）を持っていればそれで復旧。無い場合は新規申請（既存の仮押さえは管理側の操作で解除/引継ぎ）。入口URLを知っていても既存団体は開けない。
- 顧客の変更/辞退は管理者への依頼として記録されるだけで、仮押さえは管理者の明示操作まで保持される。
- 秘密/PII: ログに行内容・メール・secretを出さない。再開リンクは共有しない旨を画面に表示。

## 5. 仕様と異なる判断 / 限界 / NOT_RUN
- **本番未接続**: 本番では `/api/group` は 503。グループ用DB roleと本番compositionの正規手順、`GuestSecurity` の本番peer接続（trusted ingress）後に有効化する。開発/試験の rate limit は loopback 単一peerのため、**複数peerでの実トラフィックのrate limit挙動は未検証**。
- **本番相当build/実環境の性能は NOT_RUN**（`next build` は通るが、グループ境界が本番で未接続のため `next start` では動かせない）。上の性能は dev server・隔離PG・合成データ。
- **ウェア（WEAR/ウェア追加）の実PG/ブラウザ試験は NOT_RUN**: 試験フィクスチャにウェア在庫登録（ledger/wear service の署名済みidentity）が無く、サイズ→variant解決のunit試験（`group-customer.test.ts`）のみ。プレミアムモデル行も同様に実PG未検証（試験データに複数台のモデル無し）。
- 子供サイズ（KIDS）の在庫を持つ実PG試験データは無い（照合で SHORT になることは確認）。
- ステップ1の内容（団体名・日程等）は申請開始後に変更する公開メソッドがサービス層に無いため、変更は「新しく申し込む」となる（サービス層へ追加しなかった）。人数はヒント表示のみ（保存しない）。
- 再開リンクのメール送信・員数の変更依頼の管理画面表示・確約通知は C2/C3。顧客側は依頼を `requestFromCustomer` に記録するまで。
- joint plan の不足行特定は「入力順で先に入る行を優先」する近似。不足行の局所化は物理在庫のみの判定（不足時の `planMixedAllocation` は用品ごとに再計画し、100名では数秒〜数十秒かかるため行ごとの探索に使えない）。そのため**暫定在庫でのみ賄える行が不足と表示され得る**（保守側）。全体の可否判定と確保の正本は `submit` / `planMixedAllocation` の原子的確保。不足が出る100名の照合は約3〜5秒（隔離PG・dev）。
- `GuestSecurity` の共有rate limiterを使うため、guest側と予算を共有する（本番では専用policyを検討）。
- 見積の「税込」表記は既存の guest 画面に倣った表記（価格表側の `taxDisplayBasis` は Owner確認待ちのまま）。
- 未検証: 実メール、実決済（団体は決済しない）、実機のスクリーンリーダー、200%ズームの実ブラウザ操作（320/720px 幅での無横スクロールのみ自動検証）。
