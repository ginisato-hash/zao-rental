【次工程：PR #12 exact-head merge → Production Integration P2】

対象repo：
ginisato-hash/zao-rental

まずGitHubの現在状態を再取得し、

PR #12

base:
0a639cb46e58721f0b52a5095674aae4e76c325b

head:
b1911b3b3c3ac1f731bc200f34a89521a466ec28

CI:
34746098762
attempt 1
SUCCESS

最終Claude review:
issuecomment-5652138681
REVIEW_PASS
findings = 0

がすべて一致する場合だけ、
PR #12をmainへマージしてください。

head変更、
base変更、
review後の製品コード変更、
新しいCI failure、
未知の差分

があればマージを停止してください。

PR #12のmergeはProduction Readiness P1基盤の統合であり、
本番公開・実Square接続・実データ投入の承認ではありません。


━━━━━━━━━━━━━━━━━━
P2：Production Integration
━━━━━━━━━━━━━━━━━━

PR #12をマージ後、
最新mainから新branch/worktreeを作成してください。

P2では「外部サービスへ本当に接続する前に必要な実装」と
「Owner承認がないと実行できない実接続」を明確に分離します。


■ 1. Production guest configuration

P1で用意したguest securityを、
本番設定がない場合fail closedのまま正式composition可能にしてください。

対象：

contextSeconds
absoluteSeconds
recoverySeconds
replaySeconds
retentionSeconds
windowSeconds
peerRequests
globalRequests

値をコードへ勝手にハードコードしないでください。

・schema
・validation
・versioning
・startup validation
・audit
・missing/invalid時fail closed

まで実装してください。

Ownerが実値を承認するまでは
production guest trafficを有効化しません。


■ 2. Trusted ingress boundary

ブラウザから届く

X-Forwarded-For
X-Real-IP
その他IP系header

をそのままguest rate-limit identityとして信用しないでください。

reverse proxy / hosting platformから
信頼できるpeer identityを受け取るadapter interfaceを完成させます。

実provider固有設定はOwner承認待ち。

fixtureで、

・spoof header拒否
・trusted ingressだけ採用
・missing identity fail closed
・複数instanceで同じDB rate limit共有

を検証してください。


■ 3. Square Sandbox transport

既存SquareSandboxGatewayを変更せず、
実transportを差し込めるadapterを完成させてください。

credentialなしのfixtureで最低限：

・request signing / API version
・merchant/location binding
・idempotency
・timeout
・AbortSignal
・response loss
・UNKNOWN
・webhook signature contract
・duplicate webhook
・out-of-order webhook
・provider lookup reconciliation
・amount/currency mismatch
・no automatic retry with new key

を確認してください。

実Square credential、
実Sandbox API request、
実webhook URL登録は別Owner承認です。

credentialをrepo、fixture、logへ入れないでください。


■ 4. Storage / media provider boundary

PrivateImmutableObjectStoreの実provider接続に備え、

・private original
・public derivative
・immutable key
・content hash
・rights/revision gate
・signed/private retrieval
・delete/revoke policy
・CDN cache invalidation contract

をprovider-neutralに完成させてください。

実provider契約・credential投入は行いません。


■ 5. Real catalog/import readiness

実Salomon資料・入荷一覧・写真が投入された際に、

source
→ staging
→ normalize
→ match
→ unresolved queue
→ validated model/variant
→ quantity / Asset expansion plan
→ explicit commit

までdry-runできるようにします。

実資料が未着でもfixtureで完成させてください。

数量減少や欠落行を
既存Asset削除として解釈しないこと。

メーカーcatalog上の商品を
当店在庫として自動生成しないこと。


■ 6. Backup / restore

本番DBを想定した、

・backup contract
・restore drill
・migration前backup
・restore verification
・RPO/RTO記録欄
・失敗時stop

を用意してください。

実本番DBは使用しません。
isolated PostgreSQLでrestore drillを行ってください。


■ 7. Observability / alerts

最低限、

payment UNKNOWN
webhook failure
inventory invariant failure
guest recovery abuse
rate-limit saturation
failed migration
failed backup
return/custody inconsistency
storage failure

を構造化eventとして出せるようにします。

個人情報・password・token・recovery code・body dataを
logへ出さないでください。

外部alert provider接続はまだ行いません。


■ 8. Secret lifecycle

Square
DB
storage
guest recovery

等のsecretについて、

・env/schema
・rotation
・revocation
・startup validation
・log redaction
・old-secret graceが必要なもの／不要なもの

をrunbook化してください。

実secret投入は禁止です。


■ 9. Device / field readiness

実スマホを使わずに進められる範囲で、

・camera permission denied
・camera unavailable
・network offline
・network reconnect
・page reload
・duplicate scan
・slow response
・390px以下〜tablet
・touch操作

を回帰対象にします。

実iPhone/Android・現場Wi-Fi・field CWVは
Owner側実地確認項目として残してください。


■ 10. SEO / launch gate

既存P0の

canonical
hreflang
robots
sitemap
initial HTML
structured data
noindex boundary

を回帰させてください。

Search Console
Google Business Profile
蔵王公式レンタル一覧

への実登録・申請は行いません。


■ 11. main branch protection

現在GitHub mainはbranch protectionが無効です。

これはコード変更ではないため、
勝手にGitHub管理設定を変更しないでください。

ただし本番前Owner checklistへ、

・PR required
・CI required
・direct main push禁止
・必要ならreview requirement

を明示的なlaunch blockerとして追加してください。


■ 12. Owner gateとして残すもの

以下は推測して確定しないでください。

・guest security本番数値
・trusted ingress provider
・Square credential / merchant / location
・storage/CDN provider
・税区分
・販売期間
・実coupon
・清掃所要時間
・正式NAP
・法的最終文言
・画像/素材権利
・実Salomon入荷資料
・実在庫
・本番domain/deploy先
・backup RPO/RTO最終値


━━━━━━━━━━━━━━━━━━
既存業務仕様を維持
━━━━━━━━━━━━━━━━━━

2店舗
08:30–17:00
AM 12:00返却
PM 13:00開始
半日〜10日
同日再貸出禁止
HOLD 600秒・変更で延長なし

SKI / SNOWBOARD / boots：
1組1 Asset

POLE：
PAIR数量

WEAR：
個体IDなし
store×category×component×size数量

Premium：
exact model/version/length/spec promise

Regular：
model非確約

MULTIDAY遅延受取：
2日目以降可
元end/due/price/discount不変
未使用日返金なし
期間延長なし。


━━━━━━━━━━━━━━━━━━
停止境界
━━━━━━━━━━━━━━━━━━

以下は別Owner承認：

・PR #12以降のmain merge
・実Square Sandbox接続
・実credential投入
・実storage provider接続
・実データimport
・GitHub branch protection変更
・外部有料サービス契約
・本番deploy
・公開
・PR #3 / Runner有効化

独立して進められるP2内部実装は、
これらの未承認を理由に止めないでください。

新しいDraft PRへ保存し、
exact-head CI、
独立レビュー、
未解決Owner gates、
終了確認
を揃えて停止してください。