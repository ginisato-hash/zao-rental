【重要仕様上書き：ウェアを個体Asset管理せず、サイズ別数量在庫＋貸出返却履歴で管理する】

これは、先に渡した
「ZAO_Rental_Integrated_Wear_Catalog_v1_2.zip」
に対する正式な追加仕様です。

既存作業を破棄・巻き戻さず、現在のhead・未commit差分・進行中の実装を照合し、
次の安全な区切りで最小差分として反映してください。

今回の変更で上書きするのは、主に
「ウェア上着・パンツを個別Assetとして管理する」
という在庫表現です。

料金、ウェア事前予約、セット割、顧客UX、Premiumモデル指定、
Salomon商品カタログ、既存の貸出返却設計など、
この変更と矛盾しない既承認事項は維持してください。


━━━━━━━━━━━━━━━━━━
1．ウェアは個別番号管理しない
━━━━━━━━━━━━━━━━━━

ウェアには以下を行いません。

・1着ごとのAsset ID発行
・1着ごとのQRコード
・シリアル番号相当の内部ID
・数量分の疑似Asset row生成
・「このジャケットそのもの」を予約へ固定する処理

ウェアは完全に「サイズ別の数量在庫」として扱います。

一方で、

・どの店舗で貸し出したか
・どの店舗へ返す予定だったか
・実際にはどの店舗へ返却されたか
・何着返却済みか
・何着未返却か

は必ず追跡します。

つまり、

物理品の個体識別
≠
貸出返却履歴の追跡

として設計してください。


━━━━━━━━━━━━━━━━━━
2．物理在庫の基本単位
━━━━━━━━━━━━━━━━━━

最低限、

store
× age/category
× component
× size

の数量poolとして管理します。

例：

MOUNTAIN_BASE
ADULT
JACKET
M
READY = 12

MOUNTAIN_BASE
ADULT
PANTS
L
READY = 8

ONSEN_BASE
KIDS
JACKET
130
READY = 4

など。

componentは少なくとも

JACKET
PANTS

を分けます。

上下セットは販売上のvirtual bundleであり、
物理在庫の単位ではありません。

価格は「ウェア上下セット1組」で既存の承認済み価格表を使います。

在庫確保時は、

JACKET × 1
AND
PANTS × 1

が両方成立した場合だけ
ウェア上下セット1組を確保成功としてください。

片方しか確保できない場合は失敗です。

同一利用者の道具類も含め、
既存のgroup HOLDと同様に必要構成品をall-or-nothingで確保してください。


━━━━━━━━━━━━━━━━━━
3．上下サイズをDBで固定しない
━━━━━━━━━━━━━━━━━━

「上Mなら必ず下M」のような暗黙制約はDBへ入れないでください。

内部契約では、

jacketSize
pantsSize

を独立して表現可能にします。

UIで同じサイズを初期選択することは構いません。

将来、
上M／下L
のような貸出を許可してもmigration不要な構造にしてください。

ただし、現在の営業ルールとして上下別サイズ利用を公開するかは
別途UI・運用判断です。

今回の変更だけを根拠に新しい営業ルールを勝手に作らないでください。


━━━━━━━━━━━━━━━━━━
4．予約・貸出単位では数量行を残す
━━━━━━━━━━━━━━━━━━

物理個体IDは持ちませんが、
予約／貸出サイクルにはウェアの数量明細を保存してください。

最低限、以下を追跡可能にします。

booking_id / reservation_id
loan_cycle_id
member_key
component
size
quantity

planned_pickup_store
actual_pickup_store

planned_return_store
actual_return_store

checked_out_at
return_received_at
ready_at

state

request_id / idempotency information
actor / staff
revision

必要に応じて状態を正規化してください。

重要なのは、

「Mサイズジャケットという個体」
を追うのではなく、

「予約Aの利用者1にMジャケット1着をMountain Baseから貸した」
「その1着相当がOnsen Baseへ返却された」

という業務事実を追跡することです。


━━━━━━━━━━━━━━━━━━
5．同じ予約でも返却先を分割可能にする
━━━━━━━━━━━━━━━━━━

グループ予約などで、

Mジャケット2着をMountain Baseから貸出
↓
1着はMountain Baseへ返却
1着はOnsen Baseへ返却

というケースを表現できる必要があります。

したがってreturn情報を
loan rowの単一actualReturnStoreだけで潰さず、

return receipt / return event

として複数回記録できる設計にしてください。

例：

loan item
JACKET M qty=2

return event A
MOUNTAIN_BASE qty=1

return event B
ONSEN_BASE qty=1

remaining qty=0

のように数量保存則が成立するようにしてください。


━━━━━━━━━━━━━━━━━━
6．クロスストア返却
━━━━━━━━━━━━━━━━━━

既存どおり、

Mountain → Onsen
Onsen → Mountain

の両方向返却を許可します。

実際にOnsen Baseへ返却されたウェアは、
その時点から物理的にはOnsen Baseに存在します。

Mountain Baseに自動で戻ったことにはしないでください。

返却時：

actual return store
↓
RETURNED / INSPECTION / CLEANING 等の非販売数量pool
↓
実際の確認・処理完了
↓
READY

とします。

元店舗や別店舗で将来必要なら、
既存の店舗間移動の考え方を数量品にも適用してください。

plan
dispatch
in transit
actual receipt
ready

を分離します。

「17時便だから17:10に自動でOnsen到着」
のような処理は禁止です。

depart済み便への遡及追加も禁止です。


━━━━━━━━━━━━━━━━━━
7．数量の保存則を必須にする
━━━━━━━━━━━━━━━━━━

サイズpoolごとに、

READY
ON_LOAN
RETURNED_PENDING
CLEANING / INSPECTION
IN_TRANSIT
MAINTENANCE / UNAVAILABLE
その他必要な物理状態

と棚卸調整の合計が、
管理上の総数量と矛盾しないことを検証してください。

HOLD / reservation claimは
物理数量そのものとして二重計上しないでください。

例：

総数20

READY 8
ON_LOAN 7
CLEANING 2
IN_TRANSIT 2
UNAVAILABLE 1

=20

HOLD 3

だから23着存在する、
という扱いにはしません。

HOLDはREADY等に対する論理的な予約保護です。


━━━━━━━━━━━━━━━━━━
8．同日再貸出禁止を数量在庫でも維持
━━━━━━━━━━━━━━━━━━

ZAO Rentalの既存ルール：

同じ用品を、
同じカレンダー日に再貸出しない。

これはウェアでも維持します。

ウェアは個体IDがないため、
早期返却された数量を即READYへ戻すだけでは
同日再貸出禁止を守れません。

したがって、

RETURNED_TODAY_BLOCKED

等の状態または同等の数量保護を設け、

早く返ってきた
↓
洗浄も終わった
↓
しかし同じ営業日は販売可能数量に戻さない

を保証してください。

翌日以降、
実際にreadyであり、
店舗・移動等の条件も満たす場合だけ
予約可能数量へ戻します。


━━━━━━━━━━━━━━━━━━
9．返却モード
━━━━━━━━━━━━━━━━━━

serialized equipment：

SKI
SNOWBOARD
SKI_BOOT
SNOWBOARD_BOOT

等は、従来どおりAsset IDスキャンでloan cycleを解決できます。

そのloan cycleにウェアが含まれている場合は、

「この予約には
JACKET M ×1
PANTS L ×1
があります」

のように表示し、

スタッフがウェア返却数量を確認できるようにしてください。

個体QRを要求してはいけません。


━━━━━━━━━━━━━━━━━━
10．ウェアのみ返却の場合
━━━━━━━━━━━━━━━━━━

wear-only予約や、
ウェアだけ先に／後から返されたケースでは、
ウェア自体に固有IDがないため、

衣類だけを見て
どのloan cycleのものか自動特定できる

とは設計しないでください。

次のどれかで貸出を解決します。

・予約QR
・予約番号
・顧客/予約検索
・スタッフが認可されたactive loan一覧から選択

予約を特定できた後で、

JACKET M ×1
PANTS M ×1

等をreturn receiptとして登録します。


━━━━━━━━━━━━━━━━━━
11．予約不明の返却
━━━━━━━━━━━━━━━━━━

現場では、

「誰のかわからないMジャケットが返却台に置かれている」

ケースもあり得ます。

これをREADYへ直接加算しないでください。

UNRESOLVED_RETURN

等の一時状態を用意し、

store
component
size
quantity
received_at
staff
reason

を記録します。

予約との照合が完了するまで、
sellable inventoryには入りません。

後で正しいloanへ照合したときに、
重複加算が起きないようにしてください。


━━━━━━━━━━━━━━━━━━
12．冪等性・2端末競合
━━━━━━━━━━━━━━━━━━

同じ貸出・返却・移動操作の再送で
数量を二重増減しないでください。

例：

スタッフAがReturnを押す
通信応答が消える
もう一度押す

→ 1着返却のまま。

また、

Mountain端末A
Mountain端末B

が同じloanを同時に返却確定しても、
成功するのは論理的に1回だけです。

request id / idempotency key
expected revision
DB lock

等の既存設計を利用してください。


━━━━━━━━━━━━━━━━━━
13．部分返却
━━━━━━━━━━━━━━━━━━

ウェアは数量単位なので、

グループ5人中3人だけ返却
上着だけ返却
下だけ返却
同サイズ5着中4着返却

を表現できる必要があります。

未返却数量はactive loanとして残します。

早期返却による自動返金は行いません。

破損・紛失も返却済みと混ぜず、
数量と業務状態を分けてください。


━━━━━━━━━━━━━━━━━━
14．棚卸・数量訂正
━━━━━━━━━━━━━━━━━━

数量管理では棚卸訂正が重要になります。

数量の追加・減算は必ず、

actor
store
component
size
before
after
delta
reason
occurred_at
revision

等を監査記録してください。

active HOLD
予約
loan
transfer

で既に保護されている数量を破壊する減算は拒否してください。

台帳在庫を減らすことで既存予約が突然成立不能になる処理を、
通常の単純編集として許可しないでください。


━━━━━━━━━━━━━━━━━━
15．HOLDはAsset matchingではなくquantity claim
━━━━━━━━━━━━━━━━━━

ウェアはserialized Asset matchingへ入れないでください。

期間
店舗
component
size
quantity

に対するcapacity claimとして扱います。

ポールのquantity在庫設計を参考にして構いませんが、

・上下component
・返却後cleaning
・クロスストア返却
・同日再貸出禁止

の違いを維持してください。

Premiumモデル指定の板などserialized inventoryと
quantity wearが同じグループに混在しても、

全員
×
全構成品

が成立した場合だけgroup HOLDを成功させてください。


━━━━━━━━━━━━━━━━━━
16．既存Schema／HTTP上限を再計算
━━━━━━━━━━━━━━━━━━

現在のHOLDが、
1利用者あたり最大3用品等の前提で作られている場合、

ウェア追加後の最大要求サイズから
Schema・body limit・探索量を再導出してください。

スキー利用者なら、

SKI
SKI_BOOT
POLE
JACKET
PANTS

等になる可能性があります。

単に上限を3→無制限へ変更しないでください。

最大20人を含む対応可能な正規要求について、

Schema
HTTP parser
HOLD planner
DB処理
Quote
UI

が同じ契約を持つことを確認してください。


━━━━━━━━━━━━━━━━━━
17．価格は数量在庫方式と分離
━━━━━━━━━━━━━━━━━━

先に承認したWEAR_SET料金は維持します。

ウェア価格：
大人／子供
半日〜10日

道具SETとのウェア20％調整
＋
条件成立時の既存5％事前決済割引

の価格設計は、
今回の個体管理廃止によって変更しません。

price snapshotには、

WEAR_SET
通常価格
セット調整
coupon
advance discount
最終金額

を不変の明細として保存してください。

在庫上では
JACKET/PANTSという2componentを確保していても、

販売上の価格を
ジャケット価格＋パンツ価格
へ勝手に分割しないでください。

サイズ変更だけで価格が変わらない場合でも、
在庫HOLDは必ず再評価してください。

追加／削除や年齢区分等で金額が変わる場合は
明示的に再見積してください。

既存quote snapshotを後から書換えないでください。


━━━━━━━━━━━━━━━━━━
18．UI
━━━━━━━━━━━━━━━━━━

顧客側：

ウェア上下セット
上サイズ
下サイズ

を選択。

利用日
受取店舗
返却店舗
期間総額

を既存予約contextと共用。

物理在庫数そのものを顧客へ公開する必要はありません。
根拠のない「残り1着」は表示しないでください。

スタッフ側：

サイズ別に

READY
HOLD/RESERVED
ON_LOAN
RETURNED
CLEANING
IN_TRANSIT
UNAVAILABLE

等の数量を確認できるようにします。

さらに、

「どの予約がどこから借りているか」
「どこへ返却予定か」
「実際どこに返ってきたか」

をloan/return履歴から追えるようにしてください。


━━━━━━━━━━━━━━━━━━
19．最低限必要な回帰テスト
━━━━━━━━━━━━━━━━━━

少なくとも以下を追加してください。

1.
Mountain Mジャケット残1へ
2並列HOLD
→ 成功1件のみ。

2.
Mountain M残1
Onsen M残1
→ 店舗別数量を混ぜない。

3.
Mountain貸出
→ Onsen返却
→ Onsen RETURNED_PENDINGへ入る。
Mountain READYへ戻らない。

4.
planned Mountain return
→ actual Onsen return
→ actualを保持しplannedを上書きしない。

5.
同一予約のM×2を
Mountain qty1
Onsen qty1
へ部分返却できる。

6.
wear-only予約を
予約QR／検索から返却できる。

7.
予約不明ウェアをUNRESOLVED_RETURNへ登録
→ READYに加算されない。

8.
同じreturn request再送
→ 数量二重加算なし。

9.
2端末同時return
→ 論理成功1回。

10.
早期返却・clean完了
→ 同日再貸出不可。

11.
翌日、実ready後
→ 予約可能。

12.
return received
→ cleaning未完了
→ 予約不可。

13.
数量transfer
plan
dispatch
receive
ready
が分離される。

14.
棚卸減算がactive HOLD/loanを侵害する場合拒否。

15.
最大20人のserialized gear＋wear混在group HOLD。

16.
Premium model指定板＋quantity wear＋boot＋poleの
all-or-nothing成立性。

17.
HOLD変更でTTLが延びない。

18.
cross-store returnから将来transferへの整合。

19.
部分返却後の未返却数量がloanに残る。

20.
返却しても自動refundしない。


━━━━━━━━━━━━━━━━━━
20．旧v1.2との優先関係
━━━━━━━━━━━━━━━━━━

旧v1.2のうち、

「ウェア上1着・下1着をそれぞれserialized Assetにする」

という部分は廃止します。

今回の指示を優先してください。

一方、

・ウェア料金
・道具とのセット調整
・事前予約
・UI研究
・Premiumモデル指定
・Salomonカタログ
・商品/価格/content/inventoryの分離
・下書き／release
・本番公開ゲート

等は維持します。

資料全体を破棄して作り直さないでください。


━━━━━━━━━━━━━━━━━━
21．停止条件
━━━━━━━━━━━━━━━━━━

この追加仕様は、
現在の承認済み開発範囲へ統合してください。

内部実装・Schema修正・migration・テスト・Claudeレビュー対応について、
小項目ごとに私やChatGPTへ次の指示を求めないでください。

ただし次は別承認です。

・mainへの新しいmerge
・本番公開
・実Square要求
・実在庫投入
・追加課金
・権限拡大
・税や新料金の本番承認
・PR #3 / Runner有効化
・新しい営業条件

実装開始前に現在のhead・worktree・進行中作業を照合し、
成功済みの実装を捨てたり重複起動したりせず、
最小差分で統合してください。