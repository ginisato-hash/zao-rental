# 団体予約 管理画面（B1「管理画面」/B4 管理操作/B5 割引UI/現地入金記録/永続入口管理）実装記録

正本: Issue #47 コメント 7197143646（B1/B4/B5/C）を、Owner最新訂正 7197417902 で上書きした内容。
土台: `docs/execution/GROUP_INVITE_CORE.md`（`GroupOrderService`・DB 0064・`StaffActor`・`GROUP_*` 権限はADMINのみ）。
このPRは土台のサービス層を**再実装せず呼び出す**。追加したのは薄い読取APIだけ。顧客の入口/5ステップ（C1）、通知worker/テンプレート/staff inbox/カレンダー・帳票集計（C3）、貸出準備/custody（C4）は別担当で、このPRでは触れない。

## 1. 画面と操作（/staff/groups）
| 要件 | 実装 |
|---|---|
| 一覧（B1） | `/staff/groups`（`StaffGroups.tsx`）。状態（受付済み/仮押さえ中/確認待ち/差戻し中/確約済み/解除/取消/申請中）・店舗の絞込、団体番号/団体名検索、並べ替え（受信順・利用日・人数・金額）。列: 団体番号、団体名、状態、受信日時(JST)、経過日数、利用日（**接近/経過は要対応表示のみ**）、人数、金額（暫定/確定）、精算、要確認数、在庫占有、店舗。自動解放は一切しない |
| 詳細（Booqable Order Detail構成） | `/staff/groups/[id]`（`StaffGroupDetail.tsx`）。左=参加者/用品/サイズ表（プロフィール、選択size、FIT flag EDGE/NEAREST/MANUAL_FIT_REQUIRED/管理者選択、在庫、行ごとの価格・割引、個別編集と差分）+割引。右=代表者/期間/店舗/見積・精算/確約/差戻し/解除/入金/取消/メール配送状態/履歴 |
| 割引（B5） | 参加者ごと（定額円/割合%→bps）→団体全体。理由必須。**送信前プレビュー**（前後の金額・合計）後でなければ保存不可（入力を変えるとプレビュー無効）。全額0円は保存後の確約時にADMINが明示確認。サーバーの `computeGroupTotals` を使用（クライアントで金額計算しない） |
| 確約 | 「予約を確約してメール送信」。メッセージ（任意・plain text・2000文字）。店舗確認(MANUAL_FIT_REQUIRED)の参加者は個別に確認、0円は明示確認、お客様の現在見積への承諾が無ければボタン無効。確約の再照合・在庫保護の再検査は `GroupOrderService.confirm` の同一tx |
| 仮押さえ解除 | 「仮押さえを解除…」→確認ボックスに**対象団体・人数・日程・用品・解除結果**を表示→理由必須（+お客様へのメッセージ任意）→「解除を実行」。確認前の書込み0。解除は `release`（親・全part・全claims・イベント・通知outboxを同一tx、ADMIN+GROUP_RELEASE+店舗scopeを同一txで再認可）。期限・延長の画面/文言は存在しない |
| 差戻し/辞退/変更要求 | 差戻し（CHANGES_REQUESTED、メッセージ必須、仮押さえは維持）。お客様の変更/辞退依頼は一覧・詳細に表示されるだけで何も解放しない。サイズ変更の適用は `applyChange`（全員分を1取引で再確保、不足なら旧確保維持、適用後はお客様の再承諾が必要）。辞退は管理者が「仮押さえ解除」を選ぶ |
| 確約済みの取消 | 詳細の「確約を取り消す…」→ `cancelConfirmed`（正式取消経路。在庫解放、受領済み額は手動返金として表示、返金は作らない） |
| 現地入金記録 | 確約済みの団体にのみ表示。金額・支払手段（現金/店頭カード/その他）・日時(JST)・メモ → `recordReceipt`。訂正は理由必須の全額reversal（`reverseReceipt`、append-only）。**確定額（売上見込み）と受領額・未収を別表示**。オンライン決済UIは無い |
| 永続入口の管理 | 一覧上部の「団体の入口」。発行/再発行（確認ダイアログ・理由必須）、停止、再開。入口URLは**発行直後にだけ**表示/コピー（DBはhashのみ。通常利用の承認gateではない）。履歴10件 |
| メニュー | StaffShell の「団体予約」はADMIN+`GROUP_VIEW`のみ（補助。サーバーが正）。Staff QA（`/staff/help`）に「団体予約（管理者）」を追加。通常画面に説明を足さない |

## 2. HTTP API（/api/staff/groups/...、`staff-group-http.ts`）
すべてADMIN専用（早期ゲート+サービスがtx内で再認可）。POSTは同一Origin必須・`x-zao-session`（セッションstamp）一致必須・`requestKey`（UUID）によるidempotency・`exact`相当のフィールド検査・JSON 40KB上限。ブラウザはactorを送れない。

| メソッド/パス | 内容 |
|---|---|
| GET `/` `?status=&store=&number=` | 一覧（`list`） |
| GET `/{id}` | 詳細（`staffDetail`: 土台の`detail`＋入金/依頼/割引行(前後)/メール配送状態/行ごとの価格/承諾上限） |
| GET `/{id}/variants` | サイズ候補（`variantOptions`） |
| GET `/entrance` | 入口の状態（`entranceStatus`。トークンは返さない） |
| POST `/{id}/release` `/cancel` `/confirm` `/request-changes` `/receipt` `/reverse-receipt` | 土台の同名サービス |
| POST `/{id}/adjustments` `/preview-adjustments` | `setAdjustments`（revisionで保護）/ `previewAdjustments`（書込み0） |
| POST `/{id}/members` | サイズ変更。ブラウザは変更分（memberId+family+variantId）だけ送り、サーバーが保存済みの行にマージして `applyChange`。revision不一致は409 |
| POST `/entrance/rotate` `/enable` `/disable` | 入口の発行・再発行/再開/停止（理由必須） |

エラーは `{error: code, detail?}`。画面は `groupError()` で日本語/英語の文言に変換する。

## 3. 土台への追加（最小）
- `GroupOrderService.staffDetail / previewAdjustments / variantOptions / entranceStatus`（読取専用、ADMIN+該当権限+店舗scope）。`list` に確定額・精算状態を追加。
- 開発ランチャー: `DevelopmentRuntime.groupDb`（任意）と `startDevelopmentApp({group:true})`。グループ用roleが無い環境（本番を含む）では API は 503 `GROUP_NOT_CONNECTED`。本番への接続（role delta・runtime合成）は土台の限界どおり未実施。

## 4. 仕様と異なる/未対応の判断
- **入口URLの再表示**: DBがhashしか保持しないため、URLは発行直後にだけ表示する（再表示は再発行）。顧客入口の実URL形式は C1 が決める。このPRは `apps/web/src/lib/group-entrance-url.ts` の1関数に集約（`/{ja|en}/group/{token}` を仮定。C1側と合わせること）。
- **担当（担当者）列**: 土台のDBに担当者列が無いため未実装（確約者は確約後の `confirmed_by` のみ）。
- **割引の全解除**: `setAdjustments` は「新しい集合」を書く方式で、空集合では前の集合が有効のまま残る（土台の仕様）。一部の対象を外す/金額を変えることはできるが、全割引を0件に戻す操作は未対応（必要なら土台に取消マーカーを追加）。
- 通知の配送状態は表示のみ（再照合の操作はC3の通知worker側）。
- 新規確認依頼のstaff inbox表示は C3 担当。接続点はこのAPIの `list`（REVIEW_HELD）。

## 5. 試験表
| 区分 | 試験 | 内容 |
|---|---|---|
| 実PG（HTTP層） | `tests/group/admin-api.ts`（`npm run test:group-admin-api`） | 認可（匿名401/非ADMIN403/ADMIN）、CSRF/Origin/stamp、未知フィールド拒否、解除でclaimsだけが解放され同日の通常HOLDが成立（解除前は不成立）・応答喪失replay・異なるpayload 409・通知1通、確約対解除の競合（管理者2名）で結果が1つ・claimsと通知が一貫、割引（定額/割合/0/端数合計一致/過大/不正/重複/未知対象/revision古い/全額0円は明示確認）、サイズ変更（stale/未知member/不正variant/在庫不足で旧確保維持/成功で再承諾要）、入金（部分/超過拒否/reversal一回/replay）、権限剥奪・店舗scope変更・古いprincipal、入口の発行/停止/再開 |
| 実PG＋実ブラウザ | `tests/group/admin-ui.ts`（`npm run test:group-admin-ui`） | ADMINの通し（一覧→詳細→1名変更→割引（行/全体・定額/割合・プレビュー・過大拒否）→確約→入金→訂正）、解除（確認内容・理由必須・確認前書込み0・全claims解放・通知1）、差戻し、入口、利用日経過の表示のみ、非ADMIN/店舗scope外/権限途中失効、CSRF、JA/EN×390/1440/200%zoom、横スクロールなし、axe（serious/critical 0）、キーボード、予約/決済/provider痕跡0 |
| unit | `tests/unit/group-admin-ui.test.ts` | UIの文言に期限/延長/決済の語が無いこと、HTTP層の入力検査 |

NOT_RUN: 本番相当でのbuild後ブラウザ測定の一部（結果は PR 本文）、実メール・実決済・実機、本番DB/本番runtime、C1/C3/C4との結合。
