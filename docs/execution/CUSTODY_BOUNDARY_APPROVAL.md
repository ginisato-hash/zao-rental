【ZAO Rental｜道具貸出返却の具体的DB境界・限定承認】

PR #10 / docs/execution/FLOW_DEV_EXACT_BOUNDARY.md の具体案を確認しました。

オーナーとして、以下の正確な範囲に限り実装・検証を承認します。

対象：
ginisato-hash/zao-rental
Draft PR #10
現在確認head：
6b146f7e84c77e8626d7c15c454c25f01ac6559e

承認ID：
ZAO-FLOW-CUSTODY-DB-BOUNDARY-R1

これは以前のZAO-RENTAL-FLOW-DEV-R1を無制限に延長するものではなく、
未完了だった「serialized道具の実貸出・返却・所在地反映」に限定した
新しい継続承認です。

新しい実行枠は最大6時間。
Claude新規起動は、この境界の最終exact-head静的レビュー用に最大1回。
追加クレジットOFF。
この承認でmain merge、本番、実データ、実Square、OS/GitHub権限を許可しません。

━━━━━━━━━━━━━━━━━━
1．承認するDB変更
━━━━━━━━━━━━━━━━━━

docs/execution/FLOW_DEV_EXACT_BOUNDARY.md に記録された以下を承認します。

・新規追加migrationによるRETURN_RECEIPT等の貸出返却用状態／履歴対応
・既存適用済みmigration 0001〜0011は不変
・新規貸出／返却／inspection／candidate等の専用テーブル
・貸出返却処理専用の限定DB role
・必要最小限の列単位UPDATE／INSERT／SELECT
・RETURN_RECEIPTに必要なledger所在地変更
・実受領後のcustody history
・返却完了した対象だけのclaim整理
・影響を受ける他のpromiseのreconciliation要求
・明示的なRENTAL_CHECKOUT / RENTAL_RETURN権限
・既存スタッフ認証、店舗scope、session revocationとの接続

対象DBは今回worktree専用の合成データPostgreSQLのみです。

既存DB、実アカウント、本番データ、他プロジェクトへ適用しないでください。

━━━━━━━━━━━━━━━━━━
2．SECURITY DEFINERの追加条件
━━━━━━━━━━━━━━━━━━

SECURITY DEFINER関数は許可しますが、以下を必須条件とします。

A.
search_pathを関数定義で明示固定してください。

信頼済みschemaのみ
→ pg_tempを最後

の順序にし、利用者が書込み可能なschemaをsearch_pathに含めないでください。

B.
CREATE FUNCTION
→ REVOKE ALL ... FROM PUBLIC
→ 必要な専用roleだけGRANT EXECUTE

を同じmigration transaction内で実行し、
一時的にもPUBLICから実行可能な状態を作らないでください。

C.
application roleが、
関数所有者／table owner／migration ownerへ
SET ROLE、membership、inherit等で昇格できないことを検証してください。

D.
関数の入力は既存案どおり、

receipt UUID
inspection UUID

等の不変参照だけに限定してください。

任意の
asset id
store
quantity
actor
SQL
column名
table名
expiry
owner
等を呼出側が直接指定して書換えられる汎用関数にしないでください。

━━━━━━━━━━━━━━━━━━
3．権限取消との競合を再発させない
━━━━━━━━━━━━━━━━━━

A〜Gで修正した
「DB lock待機中にstaff権限を剥奪しても古い権限で書ける」
問題を、貸出返却経路で再発させてはいけません。

rental_assert_actor等では、

session
active staff
permission
store scope
対象receipt / loan cycle
version

をmutation直前の同じ整合性境界で再確認してください。

必要なrow/advisory lockの順序を固定し、

request開始時には権限あり
→ lock待機
→ 待機中にRENTAL_RETURN剥奪
→ lock取得

のケースでは、
剥奪後の書込みを拒否してください。

認可済みprincipalをrequest開始時に取得しただけで
最後まで信用しないでください。

━━━━━━━━━━━━━━━━━━
4．ledgerを汎用書込み可能にしない
━━━━━━━━━━━━━━━━━━

通常application roleへ、

ledger_locations
ledger history
asset custody

の任意UPDATE権限を渡さないでください。

所在地変更は、
検証済みloan cycleとreceiptに対応する
限定SECURITY DEFINER関数を通した場合だけ許可します。

既存のledger guardを
「table ownerなら何でも通す」
という一般的なbypassにしてはいけません。

許可されるのは、

・対象loanがOUT
・対象item/Assetが一致
・receiptが未適用
・actual receiving storeが一致
・現在staffが有効
・RENTAL_RETURN権限あり
・receiving store scopeあり
・versionが一致

等、今回の具体的なreceipt処理が成立した場合だけです。

他のowner実行関数やmigrationから
意図せずこの例外を利用できないこともテストしてください。

━━━━━━━━━━━━━━━━━━
5．claimを解放しすぎない
━━━━━━━━━━━━━━━━━━

返却時に整理できるclaimは、
そのreceiptで完全に履行された対象だけです。

別利用者
別Asset
別pole pair
将来予約
準備固定
発送固定
未確定決済
他のactive HOLD

の保護を解放してはいけません。

対象外claimをDELETEして簡単に整合させる方法は禁止です。

影響があるが確実に解除できないpromiseは、
reconciliation対象として保護側に残してください。

━━━━━━━━━━━━━━━━━━
6．ポール数量の保存則
━━━━━━━━━━━━━━━━━━

ポールは個体Assetではなく既存どおりPAIR数量です。

Mountain貸出
→ Onsen実返却

の場合、

元店舗へ返ったことにはせず、
実受領店舗に物理数量が存在する状態へ移してください。

ただし、

return receipt
inspection
READY

は別です。

受領直後に自動でsellable数量へ戻さないでください。

同じreceipt再送、
2端末同時確定、
部分返却、
異店舗返却で
PAIR総数が増減しないことを確認してください。

━━━━━━━━━━━━━━━━━━
7．serialized用品の返却
━━━━━━━━━━━━━━━━━━

SKI
SNOWBOARD
SKI_BOOT
SNOWBOARD_BOOT

は従来どおり1組＝1 Assetです。

Asset QR
→ active loan item
→ loan cycle
→ reservation/member
→ receipt

を解決し、

同じAsset IDを同じloan cycleで複数回読んでも
二重返却にしないでください。

Premiumは、
予約snapshotで約束したmodel/version/lengthと
貸出Assetが一致することを確認してください。

Regularはmodel非確約の既存契約を維持します。

━━━━━━━━━━━━━━━━━━
8．既存ウェア仕様と混同しない
━━━━━━━━━━━━━━━━━━

ウェアは今回のserialized custody処理へ入れません。

ウェアは既に決定済みの

store
× category
× JACKET/PANTS
× size

数量管理を維持します。

ウェアへ個体Asset IDや個別QRを再導入しないでください。

serialized道具とquantity wearが同じ予約／貸出サイクルに含まれる場合は、
それぞれの在庫表現を保ったまま同じreservation/memberへ結合してください。

━━━━━━━━━━━━━━━━━━
9．同日再貸出禁止
━━━━━━━━━━━━━━━━━━

返却されたserialized道具についても、
返却受領しただけで同日再貸出可能にしないでください。

receive
inspection
ready

と、
同日再貸出禁止のcalendar-day契約を分離してください。

早期返却でも自動返金なし。

返却されたPremium Assetが同日別予約へ再割当されないことも確認してください。

━━━━━━━━━━━━━━━━━━
10．必須の反例テスト
━━━━━━━━━━━━━━━━━━

少なくとも以下を実PostgreSQLで確認してください。

1.
PUBLICがSECURITY DEFINER関数を実行
→ 拒否。

2.
通常app roleがtable ownerへSET ROLE
→ 拒否。

3.
一時schema / writable schemaへ
同名table/function/operatorを作成
→ SECURITY DEFINERの参照先を乗っ取れない。

4.
存在するreceipt UUIDだが別staff
→ 拒否。

5.
正しいstaffだがstore scopeなし
→ 拒否。

6.
lock待機中にRENTAL_RETURN剥奪
→ mutation拒否。

7.
lock待機中にstaff無効化
→ mutation拒否。

8.
古いversionのreceipt
→ 409相当で拒否。

9.
同一receiptを再送
→ 1回だけ適用。

10.
2端末同時return
→ 1回だけ適用。

11.
同じAsset QRを同じloan cycleで複数scan
→ 二重返却なし。

12.
Mountain checkout
→ Onsen return
→ actual locationはOnsen。
Mountainへ自動復帰なし。

13.
partial return
→ 未返却itemはOUTを維持。

14.
別予約のfuture HOLDが存在
→ 必要な保護を解放しない。

15.
prepared / dispatched / loaned固定
→ 無関係なallocationを動かさない。

16.
pole pair部分返却
→ quantity保存。

17.
receive済み・inspection未完了
→ sellableでない。

18.
inspection/ready済みでも同一営業日
→ 再貸出不可。

19.
Premium別model・別length
→ 自動代替不可。

20.
既存Regular、ウェア数量、店舗間移動、
当日受付、HOLD変更、見積、決済照合の回帰。

━━━━━━━━━━━━━━━━━━
11．レビュー
━━━━━━━━━━━━━━━━━━

この限定継続で使えるClaude新規レビューは最大1回です。

実装途中の細かなレビューに消費せず、

・migration
・SECURITY DEFINER
・GRANT/REVOKE
・ledger guard
・claim retirement
・serialized custody
・pole quantity
・revocation concurrency
・既存A〜Gとの相互作用

を実装・ローカル検証し、
最終headのCIが成功した後に、
このセキュリティ境界全体のexact-head静的レビューへ使用してください。

Claudeレビューで新しい実質的指摘が出て、
修正後にさらに独立レビューが必要な場合は、
レビュー枠を勝手に増やさず停止して報告してください。

過去のPASSを新headへ流用しないでください。

━━━━━━━━━━━━━━━━━━
12．完了条件
━━━━━━━━━━━━━━━━━━

完了には、

・修正前の必要反例
・修正後の同一反例成功
・通常スタッフログイン
・保護API
・実PostgreSQL
・serialized gear貸出
・異店舗返却
・数量pole
・混在wear
・権限剥奪競合
・全体回帰
・最終head CI
・最終head Claude review

を要求します。

合成データであることを明示してください。

実スマホ、実Square、実在庫、実顧客、本番を
検証済みと表現してはいけません。

━━━━━━━━━━━━━━━━━━
13．禁止事項
━━━━━━━━━━━━━━━━━━

今回も以下は禁止です。

・main merge
・本番deploy
・実Square要求
・実請求／返金
・実在庫／実顧客投入
・OS／GitHub権限拡大
・新規課金
・PR #3 / Runner有効化
・既存migration 0001〜0011改変
・他プロジェクト変更
・汎用table-owner bypass
・汎用SECURITY DEFINER管理API

PR #10はDraftのまま残してください。

現在の作業branch/worktreeを再利用し、
未知の変更があれば切り分け、
成功済みのウェア・決済・CMS fixture等を作り直さないでください。

最初に現在headとPR状態を再取得し、
6b146f7...から既知変更がある場合は照合してから実装を開始してください。