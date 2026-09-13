【ZAO Rental｜夜間自律継続指示 R1】

Ownerは就寝します。

この指示以降、承認済み範囲の作業については細かな確認をOwnerへ返さず、
現在のPR #15の完了
→ 条件を満たした場合のRuleset経由merge
→ 次のP5内部作業
まで自律的に進めてください。

外部接続・実credential・本番・実データ等の既存禁止事項は維持します。

この指示は、
「何でも自動実行してよい」
という承認ではありません。

━━━━━━━━━━━━━━━━━━
0. 現在の正本
━━━━━━━━━━━━━━━━━━

repo:
ginisato-hash/zao-rental

current main:
370de54fb12fcb3b036f886acfb60747b55d9bd7

PR #15:
P4: confirmed booking access and Sandbox activation preparation

base:
370de54fb12fcb3b036f886acfb60747b55d9bd7

current head:
71a58316cb7f552337e569bf8d039f9557da7a59

current CI:
34768506147
attempt 1
in progress at Owner handoff

PR #15 is:
Draft
open
mergeable

Ruleset:
23161641 / Protect main

Rulesetは維持：
・PR必須
・foundation必須
・最新base必須
・conversation resolution必須
・Squash only
・force push禁止
・bypassなし

Rulesetを変更・緩和・削除してはいけません。


━━━━━━━━━━━━━━━━━━
1. 夜間作業時間
━━━━━━━━━━━━━━━━━━

この無人継続枠は、

2026-09-14 08:00 JST
または
この指示受領から最大6時間30分

の早い方までとします。

その時点で進行中の安全な検証がある場合は、
結果保存・process終了・進捗記録まで行って停止してください。

新しい有料枠、
追加クレジット、
overage、
別Team購入

は使用しません。


━━━━━━━━━━━━━━━━━━
2. PR #15の現在CIをそのまま待つ
━━━━━━━━━━━━━━━━━━

CI 34768506147の結果が出るまで、
現在headの製品コードを不用意に変更しないでください。

成功した場合：

・run id
・attempt
・head SHA
・base SHA
・PR integration commit
・tree
・actual job result

を取得し、
current head 71a58316... と対応することを確認してください。

単にGitHub UIがgreenだからPASSとはしないでください。


━━━━━━━━━━━━━━━━━━
3. 現headの最終Claudeレビュー
━━━━━━━━━━━━━━━━━━

現在headは、
reload中のconfirmed-booking access revoke/save race修正後です。

過去レビュー：

・初回：same-tab revoke後再保存問題
・次回：reload中revoke残存ケース CHANGES_REQUIRED

は履歴として残します。

過去のPASSやCHANGES_REQUIREDを、
現在headの最終判定へ流用しないでください。

CI成功後に、
current exact head 71a58316... へ
独立静的レビューを1回実行してください。

対象重点：

・confirmed-booking read capability
・revoke
・再発行
・response loss
・reload中race
・別booking混線
・expiry
・guest contextとの分離
・payment/booking/inventory/custody mutation不可
・server-side hash only
・raw capability漏洩
・DB role / permission
・既存HOLD/payment/custody/wearとの相互作用

Claudeは既存Team。
追加利用OFF。
外部取得・コード実行なしの静的レビュー。

ここからP4用Claude新規起動は最大2回だけ許可します。

1回目：
current exact-head final review

2回目：
1回目で実質的findingが出て、
修正後に再確認が必要な場合のみ。

2回使用後も実質的findingが残る場合は停止してください。


━━━━━━━━━━━━━━━━━━
4. review findingが出た場合
━━━━━━━━━━━━━━━━━━

findingを勝手に無視してPASS扱いしないでください。

まず、

・実際のコード
・反例
・実DB/API/UI
・該当race
・既存security boundary

と照合してください。

誤検知の可能性があっても、
実装担当だけで却下しません。

反証できる場合：
反証source＋実DB/実UI証拠を保存し、
許可された再レビュー1回で独立再判定。

実 defect の場合：
最小修正
→ 修正前反例
→ 修正後同一反例
→ 全体verify
→ commit/push
→ exact-head CI
→ 再レビュー

まで行います。

期待値を弱める、
timeoutを伸ばす、
retryを増やす、
負荷を減らす

ことでPASSさせるのは禁止です。


━━━━━━━━━━━━━━━━━━
5. CI failure時
━━━━━━━━━━━━━━━━━━

CI失敗を無条件rerunしないでください。

以下を分類：

A. 製品コード defect
B. test defect
C. test infrastructure defect
D. disk/resource exhaustion
E. GitHub transient
F. model/provider capacity
G. 原因不明

原因と証拠を保存してください。

GitHub transient等が明確で、
コード変更不要である証拠がある場合のみ、
同一headのrerunを最大1回許可します。

原因不明なら
「再実行でgreenになったから解決」
とはしません。

historical observationとして保持します。


━━━━━━━━━━━━━━━━━━
6. Macディスク容量
━━━━━━━━━━━━━━━━━━

P4で使い捨てPostgreSQL cluster累積による
disk exhaustionが複数回発生しています。

重い全体verify前に必ず空き容量を確認してください。

削除可能なのは、

・このZAO Rentalテストが作成
・所有が明確
・停止済み
・そのrunが成功済み
・必要証拠を保存済み

のdisposable clusterだけです。

削除禁止：

・failed runの原因調査に必要な証拠
・live DB
・既存プロジェクトDB
・他repo
・ユーザーファイル
・由来不明の大容量データ

安全なcleanup後も容量不足なら、
重いテストを無理に開始せず
DISK_BLOCKEDとして記録してください。

軽量な独立作業は続行可。


━━━━━━━━━━━━━━━━━━
7. PR #15 merge条件
━━━━━━━━━━━━━━━━━━

以下を全て満たした場合、
PR #15のmergeをOwnerとして事前承認します。

・latest mainが想定baseのまま、または安全に再base検証済み
・PR #15 exact headが固定
・foundation CI SUCCESS
・exact-head Claude REVIEW_PASS
・findings 0
・review後の製品コード変更なし
・未解決conversationなし
・Ruleset 23161641 Active
・bypassなし
・required check変更なし

条件を満たしたら：

1. PRをReady for reviewへ変更
2. Ready変更で新CIが発火した場合は必ず待つ
3. Ruleset required foundation成功確認
4. 最新baseとの統合内容確認
5. Squash merge
6. merge commitとmain treeを再取得

Rulesetを迂回してはいけません。

merge後、
PR #15の最終記録とmerge commitを保存してください。


━━━━━━━━━━━━━━━━━━
8. PR #15 merge後はP5へ進む
━━━━━━━━━━━━━━━━━━

PR #15が安全にmergeできた場合、
Ownerの追加返答を待たず、
最新mainから

codex/production-preflight-p5

相当の新branch/worktreeを作成してください。

P5は、
「実外部接続なしで残っているproduction activation gapを
できる限り閉じる」
工程です。

P5では本番を有効化しません。


━━━━━━━━━━━━━━━━━━
9. P5-A：confirmed booking recoveryの完成
━━━━━━━━━━━━━━━━━━

P4では、
入力guest contextとは別に、

confirmed booking summary
＋ QR閲覧

用のread-only capabilityを作っています。

P5では、
「元ブラウザ/cookieを失った顧客がどう戻るか」
をprovider-neutralに完成してください。

ただし実email送信はしません。

要件：

・booking mutation不可
・payment mutation不可
・inventory mutation不可
・custody mutation不可
・read-only
・high entropy
・server側hash保存
・rotation/revoke
・response-loss idempotency
・one-time recovery exchange
・expiryは元booking contractを尊重
・HOLD TTL延長で代用しない
・guest input TTL延長で代用しない
・cancelled/expired bookingの扱いを明示
・ログ/analyticsへraw secretを出さない

実メールproviderはinterfaceだけ。

email送信、
SMS送信、
外部notification

は禁止。


━━━━━━━━━━━━━━━━━━
10. P5-B：production-like local rehearsal
━━━━━━━━━━━━━━━━━━

外部networkなしで、
本番起動に近いrehearsalを作ってください。

対象：

・NODE_ENV=production build
・startup config validation
・missing config fail closed
・synthetic approved config fixture
・isolated PostgreSQL
・migration
・health/readiness
・graceful shutdown
・restart
・response-loss
・backup restore後startup
・external transport disabled
・chargeReady false維持
・public activation gate false維持

実Vercel deployは禁止。


━━━━━━━━━━━━━━━━━━
11. P5-C：production preflight command
━━━━━━━━━━━━━━━━━━

本番公開前に一発で状態確認できる
read-only preflight入口を作ってください。

例：

npm run production:preflight

相当。

出力：

・human readable summary
・machine readable JSON

最低限のgate：

MAIN_PROTECTION
FOUNDATION_CI
GUEST_POLICY
TRUSTED_INGRESS
BOOKING_RECOVERY
SQUARE_SANDBOX
SQUARE_WEBHOOK
SECRET_STORE
STORAGE_PROVIDER
CATALOG_IMPORT
REAL_DEVICE
FIELD_CWV
BACKUP_PITR
BACKUP_RESTORE
RPO_RTO
TAX
SALES_PERIOD
COUPON
CLEANING
NAP
LEGAL_COPY
MEDIA_RIGHTS
DOMAIN
DEPLOYMENT
SEARCH_CONSOLE
GBP
ZAO_OFFICIAL_LISTING

未確認をPASSにしない。

docが存在するだけでPASSにしない。

外部証拠が必要なgateは
OWNER_PENDING / EXTERNAL_PENDING / NOT_RUN
として残す。

本番未準備ならexit non-zero。


━━━━━━━━━━━━━━━━━━
12. P5-D：Vercel trusted ingress準備
━━━━━━━━━━━━━━━━━━

初回hosting候補はVercel direct。

ただし実Vercel環境未検証なので、
headerを今の段階でproduction truthとして信用しない。

実装可能範囲：

・adapter interface
・canonicalization
・spoofed-header fixture
・missing peer fail closed
・Request clone/binding regression
・multiple IP representation tests
・IPv4/mapped IPv6 normalization
・same-NAT rate-limit simulation

禁止：

・実deploy
・Vercel project作成
・domain設定
・secret投入
・任意XFF trust


━━━━━━━━━━━━━━━━━━
13. P5-E：Square activation preflight
━━━━━━━━━━━━━━━━━━

現在未準備：

Sandbox application:
UNCONFIRMED

approved secret store:
UNSELECTED / UNCONFIGURED

Sandbox HTTPS webhook receiver:
NOT_CREATED

この3点を理由にP5全体を止めない。

外部接続なしで、

・required metadata schema
・secret resolver interface
・merchant/location mapping schema
・webhook receiver contract
・rotation plan
・dual-key webhook migration設計
・activation stop conditions
・20 payment / 5 refund journal persistence
・UNKNOWN recovery
・idempotency
・restart persistence

を完成させる。

実Square requestは0件維持。


━━━━━━━━━━━━━━━━━━
14. P5-F：R2/storage activation preflight
━━━━━━━━━━━━━━━━━━

R2第一候補は維持。

外部requestなしで：

・private original
・public derivative
・immutable content hash
・same-key different-bytes拒否
・signed private ticket
・expiry
・rights revoke
・purge receipt
・revision consistency
・cache invalidation contract
・backup interface
・credential rotation interface

をfixtureで完成。

実R2 requestは0件維持。


━━━━━━━━━━━━━━━━━━
15. P5-G：disk/test hygiene
━━━━━━━━━━━━━━━━━━

今回のdisk exhaustionを、
単なる手動掃除で終わらせない。

テストframeworkについて：

・成功済みowned clusterは自動dispose
・failed clusterは証拠として保持
・live/unknown clusterは触らない
・runごとの所有ID
・開始前disk preflight
・停止時の残存process確認
・cleanup結果記録

を整える。

failed clusterが大量に蓄積した場合も、
勝手に削除しない。

容量が安全基準を下回る場合は、
明確にBLOCKする。


━━━━━━━━━━━━━━━━━━
16. P5-H：historical CI observation
━━━━━━━━━━━━━━━━━━

以下は原因未解明のまま：

・staff-create HTTP500
・wear mixed transport failure

再発しない限り、
夜通し原因探索へ時間を使わないでください。

再発した場合のみ、
現在追加済みの安全診断から
原因範囲を狭める。

再発なしなら、

historical unresolved observation

として保持。


━━━━━━━━━━━━━━━━━━
17. P5で変更禁止の業務仕様
━━━━━━━━━━━━━━━━━━

2店舗

営業時間：
08:30–17:00

半日：
AM 08:30–12:00
PM 13:00–17:00

レンタル：
半日〜10日

同一返却品：
同日再貸出禁止

HOLD：
600秒
変更で延長なし

serialized：
SKI / SNOWBOARD / BOOTS
1組=1 Asset

POLE：
PAIR数量

WEAR：
個別Assetなし
store×category×component×size数量

Premium：
exact model/version/length/spec

Regular：
model非確約

MULTIDAY delayed pickup：
2日目以降可
元due/end/price/discount不変
未使用日返金なし
延長なし。


━━━━━━━━━━━━━━━━━━
18. 外部操作の禁止
━━━━━━━━━━━━━━━━━━

Owner就寝中は以下を絶対に実行しない：

・実Square Sandbox request
・実Square production request
・実payment/refund
・Square application作成
・Square token取得/投入
・webhook登録
・実R2接続
・AWS/Vercel/Cloudflare credential投入
・Vercel deploy
・domain設定
・メール送信
・SMS送信
・実Salomon資料import commit
・実在庫投入
・実顧客データ
・Search Console登録
・GBP登録
・蔵王公式サイト申請
・新規有料サービス契約
・GitHub Ruleset変更
・PR #3 / Runner有効化
・本番deploy
・公開


━━━━━━━━━━━━━━━━━━
19. Owner質問の扱い
━━━━━━━━━━━━━━━━━━

Ownerが寝ている間、
未決事項ごとに質問を出して停止しないでください。

Owner判断が必要な事項は、

OWNER_PENDING

として記録し、
独立して進められる作業を続けてください。

本当に他に安全に進める作業がなくなった時だけ停止。


━━━━━━━━━━━━━━━━━━
20. P5検証
━━━━━━━━━━━━━━━━━━

最低限：

・unit
・typecheck
・lint
・build
・実PostgreSQL
・通常guest UI
・staff UI
・confirmed booking read/recovery
・revoke/race/response loss
・20人group
・Premium
・wear
・payment fixture
・custody
・late pickup
・SEO
・production fail-closed
・disk cleanup ownership

を回帰。

外部接続なしの結果を、
Sandbox E2Eやproduction acceptanceと呼ばない。


━━━━━━━━━━━━━━━━━━
21. P5 PR / CI / review
━━━━━━━━━━━━━━━━━━

P5変更を1つの新しいDraft PRへまとめる。

P5ではmain mergeしない。

Draft PR作成後：

・exact head固定
・full local verify
・GitHub CI
・integration tree照合
・secret scan
・manifest
・Claude independent static review

まで進める。

P5用Claude新規起動は最大2回：

1回目：
full exact-head review

2回目：
finding修正後のre-reviewが必要な場合だけ。

2回後もfindingが残る場合は停止。


━━━━━━━━━━━━━━━━━━
22. モデルcapacity / GitHub一時障害
━━━━━━━━━━━━━━━━━━

Selected model is at capacity
等の場合：

・同じsession
・同じworktree
・同じbudget
・同じreview count

を維持。

別モデルへ勝手に変更しない。
作業を最初から作り直さない。

GitHub 500等も、
重複PRや重複commitを作る前に実状態を照合。


━━━━━━━━━━━━━━━━━━
23. 朝までの最終停止条件
━━━━━━━━━━━━━━━━━━

次のいずれかで停止：

A.
P4安全merge完了
＋
P5 Draft PR
＋
P5 CI
＋
P5 review
まで完了

B.
2026-09-14 08:00 JST到達

C.
ディスク/Team利用枠/GitHub等の真のblocker

D.
外部credential/Owner判断なしでは
安全に進める作業が完全になくなった

E.
P4またはP5 reviewで
許可回数内に解消できない実質finding


━━━━━━━━━━━━━━━━━━
24. 最終報告
━━━━━━━━━━━━━━━━━━

停止時はOwnerが朝すぐ判断できるよう、

・current main SHA
・merged PR
・open Draft PR
・head SHA
・CI run / attempt / conclusion
・review verdict
・findings
・ローカル検証数
・実外部通信件数
・実payment/refund件数
・実provider接続件数
・disk cleanup内容
・historical unresolved observations
・OWNER_PENDING
・次のOwner操作

を1つの最終コメント／進捗記録へまとめてください。

「全機能完成」
「production ready」
「Square接続済み」
等の過大表現は禁止。

━━━━━━━━━━━━━━━━━━
25. 最重要
━━━━━━━━━━━━━━━━━━

夜間の目的は、
作業量を最大化することではありません。

安全に証拠を積み上げ、
Ownerが起きた時に

「次は実Square/Vercel/R2等の現実接続だけ」

という状態へ近づけることです。

不明な営業条件や外部接続を推測で埋めない。
Rulesetを迂回しない。
秘密値を残さない。
実データを使わない。
成功済みの仕事を作り直さない。

以上の範囲で自律継続してください。