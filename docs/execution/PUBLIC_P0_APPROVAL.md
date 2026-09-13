【次工程承認：PR #10限定マージ → Public UX / SEO / Guest Booking P0】

対象repo：
ginisato-hash/zao-rental

■ 1. PR #10を限定マージ

対象：
PR #10

承認head：
0347ed621d293a79cc02e9751da0b81709e4b538

base：
137352fcaa7b28f88aef5100479297f74e64b4aa

確認済みCI：
34727240097 / attempt 1 / SUCCESS

確認済み独立レビュー：
PR #10 issuecomment-5649705981
REVIEW_PASS / code findings 0

GitHub上の現在head、base、CI、review、treeを再取得し、
上記と一致する場合だけPR #10をmainへマージしてよいです。

未知のcommit、
新しいCI failure、
review後の製品コード変更、
baseとの未検証差分

があればマージを停止してください。

今回のマージは開発基盤への統合です。

E10〜E13全完了、
Square接続完了、
本番ready、
公開ready

という意味にはしないでください。


■ 2. マージ後の新工程

最新mainから新しい専用branch/worktreeを作成してください。

次工程の中心は、

PUBLIC CUSTOMER EXPERIENCE
+
GUEST BOOKING BFF
+
SEO P0
+
PUBLIC CATALOG / CONTENT

です。

既存の内部予約・HOLD・price・payment boundary・custody・wearを
作り直さず再利用してください。


■ 3. UI仕様

以前承認済みの

ZAO_Rental_Public_UX_CMS_Spec_v1

を正式なUI設計基準として採用してください。

主要導線：

日程・店舗
→ Regular / Premium比較
→ 利用者別用品選択
→ 身体情報・サイズ
→ Premiumならモデル選択
→ ウェア選択
→ 全員明細
→ 総額
→ 最終確認
→ 支払い直前HOLD
→ payment state
→ booking result / QR

とします。

長い入力開始時点から10分HOLDを開始せず、
支払い直前にHOLDを開始する既存設計を維持してください。

PCだけでなくモバイルを主対象にしてください。


■ 4. Public actorをstaffから分離

匿名顧客用にguest booking contextを実装します。

staff principalを偽装したり、
staff owner checkを削除してpublic化しないでください。

推測困難なguest context / tokenと、
そのcontextが所有する予約draftだけを操作可能にします。

clientから以下を権威ある値として受け付けないでください。

・価格
・内部Asset ID
・staff role
・store authority
・Premium model/variantの不正な組合せ
・HOLD expiry
・payment success

すべてserverで再導出・再検証してください。


■ 5. SEOを後付けにしない

public customer UIと同時にSEO基盤を実装してください。

client-only予約アプリにkeywordを詰める設計は禁止です。

indexable public content layer
と
transaction booking context

を分離してください。

主要SEO本文、title、description、canonical、
structured dataは初期HTMLで取得可能にします。


■ 6. P0 indexable pages

日本語・英語を最低対象とします。

例：

/ja/
/en/

/ja/rental
/en/rental

ski
snowboard
premium
wear
kids-family
prices
Mountain Base
Onsen Base
pickup-return
FAQ

および、
公開承認済みPremium model detail。

実URL構造はNext.js構成とSEOを見て合理的に整理して構いません。

ただし、

「蔵王 スキー レンタル」
「蔵王温泉 スキーレンタル」

等の語順だけを変えたdoorway pageを量産しないでください。


■ 7. 狙う主要検索意図

最低限、

蔵王 スキー レンタル
蔵王温泉 スキーレンタル
蔵王 スノーボード レンタル
蔵王 レンタル ウェア
蔵王 スキー レンタル 予約

Zao ski rental
Zao Onsen ski rental
Zao snowboard rental
Zao ski wear rental

をページ構造・title/H1・本文・内部リンクの設計対象にします。

keyword stuffingは禁止です。


■ 8. Technical SEO

P0で最低限：

・unique title / description
・canonical
・robots.txt
・XML sitemap
・ja/en hreflang
・x-default方針
・BreadcrumbList
・Organization
・条件成立時のLocalBusiness
・商品ページで妥当な場合のみProduct / Offer
・semantic HTML
・404 / 410 / redirect
・画像width/height/srcset
・WebP/JPEG等の最適配信
・mobile CWVを意識したSSR/SSG
・内部リンク

を実装してください。

予約context、
session、
payment状態、
staff/admin、
API、
日付/人数/filter/query parameterの組合せURL

をindexさせないでください。

crawl trapを作らないでください。


■ 9. Local SEO

Mountain Base / Onsen Baseは、
正式な住所・電話・営業時間等が未確定なら
schemaへ捏造しないでください。

情報が確定した後に利用できる
location content/schema契約まで実装してください。

Google Business Profileの実登録、
Search Consoleの実所有確認、
蔵王公式サイトへの実掲載申請

は外部操作なので今回実行しません。

launch checklistとして残してください。


■ 10. Premium model SEO

Salomon資料を丸写ししないでください。

内部で検証済みの

model
season/version
実際の当店取扱length
用途・仕様
予約条件
ユーザー提供実写真

から独自ページを構成します。

メーカーサイトに存在する全model/lengthを
当店在庫として公開しないでください。

未照合・未入荷・権利未確認はpublic release不可です。


■ 11. CMS / Catalog

現在の開発fixtureで確認した

content revision
CSV bulk
photo manifest
draft
preview
release

の考え方を、
将来の正式PostgreSQL content境界へ接続してください。

価格と物理在庫をCMSから直接変更させないでください。

catalog model
commercial offer
physical inventory
content
media
price

を分離してください。

本番storage契約等が必要なら、
外部provider接続だけをBLOCKEDとして
独立実装を続けてください。


■ 12. Search Console向け計測設計

本番接続はまだしませんが、

organic landing
query-compatible landing page
view_offer
compare_plan
profile_complete
hold_request/result
payment_attempt/result
booking_confirmed

をつなげられる分析契約を用意してください。

氏名、email、身体情報、
coupon生コード、
内部秘密値

をSEO/analytics eventへ送らないでください。

最終的には

organic landing
→ booking start
→ payment confirmed

を計測できる設計にします。


■ 13. Square

今回のPublic P0で、
実SquareやSandboxへ勝手に接続しないでください。

既存のpayment boundaryを利用し、
開発用providerで

PENDING
UNKNOWN
CONFIRMED
REVIEW

等のUIを完成させます。

実Square Sandbox資格情報と外部Webhookは、
別の明示承認までBLOCKEDです。

client redirectだけで予約成功にしない既存契約を維持してください。


■ 14. 既存仕様維持

以下を壊さないでください。

・2店舗
・08:30–17:00
・AM12:00返却
・PM13:00開始
・半日〜10日
・同日再貸出禁止
・HOLD 600秒、変更で延長なし
・締切前HOLDの限定継続
・板/bootsは1組1 Asset
・ポールはPAIR数量
・ウェアはサイズ別数量、個体IDなし
・異店舗返却
・予定と実受領の分離
・Premium exact model/version/length
・Regular model非確約
・価格snapshot不変
・後からcontent/price変更で既予約を書換えない


■ 15. 未決事項

以下は勝手に決定しません。

・税区分
・本番販売期間
・実Coupon規則
・実清掃時間
・本番HOLD/quote TTL
・実店舗の正式住所/電話
・実素材権利
・後日受取
・受領時刻訂正
・例外inspection
・DIN/fit安全確定

後日受取について、
現行custodyは初回利用日の17:00以前のみcheckout可能です。

この仕様を初期リリースの正式制約にするか、
day2以降の遅延受取を許可するかはOwner判断待ちとして残してください。


■ 16. テスト

最低限：

・public guestとstaff境界
・他guestの予約アクセス拒否
・price/model/Asset改ざん拒否
・ja/en
・canonical
・hreflang
・sitemap
・robots
・private route noindex
・parameter crawl trapなし
・初期HTMLに主要SEO本文/title
・JSON-LDと可視内容一致
・Premium model実在条件
・ウェア
・20人group
・response loss/reload
・mobile layout
・既存HOLD/payment/custody regression

を検証してください。

SEOテストは
「Googleで1位になる」
を合格条件にしません。

技術的indexability、
重複排除、
情報整合性、
performance、
検索→予約導線

を合格条件にしてください。


■ 17. 作業方式

内部の小項目ごとにOwner/ChatGPTへ再承認を求めず、
承認範囲内を連続して進めてください。

未知の営業条件、
新規有料provider、
外部資格情報、
本番公開、
実データ、
main merge

のみOwnerへ戻してください。

新しいDraft PRへ保存し、
CI・独立レビュー・残件をそろえて停止してください。

PR #3 / unattended Runnerは引き続き保留です。