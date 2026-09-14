【ZAO Rental｜P6 Square Sandbox S1 実read-only受入 R4
Astra Lead / Spark bounded tests】

現在のP6 Preview受入成功を確認しました。

repo:
ginisato-hash/zao-rental

main:
3061dbbbe00294e5baebba2405028c907d6e6e85

P6 branch:
codex/external-acceptance-p6

expected current head:
f5a2eed3bd6e6da7b940f25e56b581ee22a30888

actual accepted Preview source SHA:
d0bfe551dd6f7fa63ccf0bba97da03292e89cc4e

accepted Preview:
https://zao-rental-cfswundgr-zao-food-map.vercel.app/

Preview acceptance:

target = preview
build = SUCCESS
startup = SUCCESS
Deployment Protection = enabled
health = 200
guest / booking access = 503 fail-closed
staff API = 401 unauthenticated
custom domain = 0
production alias = 0

runtime:

Node = 24.19.0
npm = 11.12.1

Square actual requests:
0

payments:
0

refunds:
0

webhooks:
0

external DB:
0

R2:
0

secret exposure:
0


━━━━━━━━━━━━━━━━━━
1. 今回Ownerが承認する範囲
━━━━━━━━━━━━━━━━━━

Square Sandbox S1
merchant / location read-only acceptance

のみ承認します。

許可するSquare実通信は最大2 GET。

1.
GET /v2/merchants/me

2.
GET /v2/locations

Sandbox originのみ：

https://connect.squareupsandbox.com

Square-Version：

2026-08-19

Authorization：

既にVercel Preview Secretへ登録済みの
SQUARE_SANDBOX_ACCESS_TOKEN
をserver-sideで使用。

Access Tokenの値は：

・表示禁止
・取得禁止
・ローカル保存禁止
・ログ禁止
・prompt禁止
・Git禁止


━━━━━━━━━━━━━━━━━━
2. 今回まだ禁止
━━━━━━━━━━━━━━━━━━

絶対に実行しない：

・CreatePayment
・GetPayment
・refund
・Orders API
・Customers API
・Catalog API
・Location作成/更新
・Merchant更新
・Webhook subscription作成
・Webhook delivery
・Web Payments tokenization
・Production Square
・Production credential
・実顧客データ
・実カード
・外部DB
・R2
・email
・SMS

S1成功後も自動的にS2へ進まない。


━━━━━━━━━━━━━━━━━━
3. Astraが所有する
━━━━━━━━━━━━━━━━━━

今回以下はRED領域なのでAstra自身が設計・統合する。

・Square transport allowlist
・Sandbox origin
・Authorization境界
・merchant/location validation
・Preview-only acceptance route
・secret handling
・actual provider invocation
・evidence interpretation
・S1 PASS/FAIL判断

Sparkへ実credentialや実provider callを渡さない。


━━━━━━━━━━━━━━━━━━
4. 既存Square transportを優先利用
━━━━━━━━━━━━━━━━━━

現P6監査では既存：

packages/core/src/payment/square-transport.ts

は、

・Bearer server-side
・redirect拒否
・request allowlist
・timeout/abort
・response size上限

を持つ一方、

merchant/location S1 GETは
allowlist未対応。

Astraが既存transportを再利用できるなら、
最小変更で以下2pathだけ追加。

GET /v2/merchants/me
GET /v2/locations

その他の任意GETを許可しない。

generic URL fetchへ緩めない。

Production Square originを許可しない。


━━━━━━━━━━━━━━━━━━
5. S1専用service
━━━━━━━━━━━━━━━━━━

Astraが専用のread-only S1 serviceを作る。

名前/pathは現構成に合わせるが、
責務は以下だけ。

Input：

・Sandbox env metadata
・server-only access token
・configured Sandbox Location ID

Request：

1. merchant
2. locations

Output：

secret-free acceptance summary

DB書込みなし。
booking変更なし。
payment変更なし。
inventory変更なし。
custody変更なし。


━━━━━━━━━━━━━━━━━━
6. Merchant API受入条件
━━━━━━━━━━━━━━━━━━

最初に：

GET
https://connect.squareupsandbox.com/v2/merchants/me

を1回だけ実行。

Header：

Square-Version: 2026-08-19
Authorization: Bearer <server-side secret>
Content-Type: application/json

自動retryなし。


成功条件：

HTTP 2xx

merchant.id:
non-empty

merchant.status:
ACTIVE

merchant.country:
JP

merchant.currency:
JPY

merchant.main_location_id:
non-empty


認証失敗、
429、
5xx、
network timeout、
schema mismatch

の場合：

2本目を呼ばず停止。

request count = 1

として記録。


━━━━━━━━━━━━━━━━━━
7. Location API受入条件
━━━━━━━━━━━━━━━━━━

Merchant成功時のみ：

GET
https://connect.squareupsandbox.com/v2/locations

を1回実行。

成功条件：

HTTP 2xx

configured
SQUARE_SANDBOX_LOCATION_ID
と一致するLocationが存在。

対象Location：

status = ACTIVE
country = JP
currency = JPY

location.merchant_id
=
merchant.id

merchant.main_location_id
=
configured Sandbox Location ID

を確認。


可能なら：

capabilitiesに
CREDIT_CARD_PROCESSING

が含まれることも確認。

capability欠落時は
即paymentへ進まず、
S1_WARNINGまたはBLOCKEDとしてAstraが評価。


━━━━━━━━━━━━━━━━━━
8. JP / JPY mismatch
━━━━━━━━━━━━━━━━━━

merchantまたはlocationが：

country != JP
または
currency != JPY

の場合はS1 FAIL。

勝手に：

・新Sandbox account作成
・Location作成
・Location更新
・token差替え
・別country利用

へ進まない。

OWNER_ACTION_REQUIRED:

「JapanのSandbox test accountを作成／選択する必要あり」

として停止。


━━━━━━━━━━━━━━━━━━
9. Location ID mismatch
━━━━━━━━━━━━━━━━━━

Square APIで返ったLocationと
OwnerがConsoleからVercelへ登録した

SQUARE_SANDBOX_LOCATION_ID

が一致しない場合：

設定を勝手に上書きしない。

S1_LOCATION_MISMATCH

として停止。

Console表示、
API response、
Vercel設定のどれが正しいか
Owner確認待ち。


━━━━━━━━━━━━━━━━━━
10. Preview-only acceptance endpoint
━━━━━━━━━━━━━━━━━━

Vercel SecretはPreviewにしか存在しないため、
実Square callはPreview runtime内から行う。

既存のsafeなremote execution pathが無い場合のみ、
一時的なPreview-only acceptance routeを作ってよい。

推奨性質：

POST only

例：
/api/internal/acceptance/square-s1

ただし最終pathは現repo構成からAstraが決定。


routeは必ず：

VERCEL_ENV === "preview"

SQUARE_ENVIRONMENT === "SANDBOX"

を要求。

それ以外は404またはfail closed。

Productionでは絶対に動作しない。


━━━━━━━━━━━━━━━━━━
11. accidental invocation対策
━━━━━━━━━━━━━━━━━━

acceptance routeは：

・UIへlinkしない
・sitemapへ出さない
・GET不可
・browser prefetch不可
・public docsへURL掲載しない

さらに非secretの明示ヘッダー等で
acceptance intentを要求してよい。

例：

X-ZAO-Acceptance: SQUARE_S1_V1

これはcredentialではない。
security authorityとして扱わず、
誤操作防止目的だけ。


━━━━━━━━━━━━━━━━━━
12. Deployment Protection
━━━━━━━━━━━━━━━━━━

acceptance routeは
Deployment Protectionの背後でのみ実行。

ProtectionをOFFにしない。

bypass secretをURLへ付けない。

Owner/Team認証済みのVercel経路からのみ実行。


━━━━━━━━━━━━━━━━━━
13. route response
━━━━━━━━━━━━━━━━━━

responseへ出してよい：

environment = SANDBOX
apiVersion
merchantId
merchantStatus
merchantCountry
merchantCurrency
mainLocationMatch
locationCount
configuredLocationMatch
locationStatus
locationCountry
locationCurrency
merchantMatch
cardProcessingCapability
requestCount
result

出してはいけない：

Access Token
Authorization header
token prefix
raw token length
Application Secret
Webhook key
Cookie
Vercel auth value
raw card data

Square raw response全文も保存しない。


━━━━━━━━━━━━━━━━━━
14. logging
━━━━━━━━━━━━━━━━━━

runtime logへ：

Authorization
token
request headers全文
process.env
raw response

を出さない。

保存するのはredacted metadataのみ。

Square側request IDが安全なresponse headerとして
取得できる場合のみ記録可。

存在しないrequest IDを捏造しない。


━━━━━━━━━━━━━━━━━━
15. Spark委譲
━━━━━━━━━━━━━━━━━━

必要ならSparkを最大1つ使用可。

TASK_ID:
P6-SPARK-SQUARE-S1-TEST-01

ROLE:
Codex 5.3 Spark
bounded tests / fixture only

GOAL:
Astraが確定したS1 contractに対する
unit / regression tests追加。

Sparkに実provider callをさせない。

CANONICAL_INVARIANTS:

・Sandbox origin固定
・GET merchants/meのみ
・GET locationsのみ
・最大2 request
・merchant失敗時location未実行
・JP/JPY必須
・configured Location一致必須
・merchant一致必須
・secret非出力
・Production不可


ALLOWED_EDIT_FILES:

Astraがexact test pathsを指定。

原則：
tests/readiness/**
または
Square sandbox fixture testのみ。


READ_ONLY:

packages/core/src/payment/**
apps/web/src/app/api/**


FORBIDDEN:

・payment core編集
・route編集
・env編集
・Vercel操作
・actual Square request
・secret
・DB
・migration
・business contract
・main push/merge

最大1回修正。

それ以上ならAstraへ戻す。


━━━━━━━━━━━━━━━━━━
16. local validation
━━━━━━━━━━━━━━━━━━

実provider call前にAstraが：

narrow Square tests
secret scan
lint
typecheck
build

を実行。

acceptance routeのfixtureでは：

merchant success
merchant auth failure
merchant wrong country
merchant wrong currency
location missing
location ID mismatch
merchant mismatch
inactive location
wrong location currency
secret redaction

を確認。


━━━━━━━━━━━━━━━━━━
17. 新Preview deployment承認
━━━━━━━━━━━━━━━━━━

S1 routeを追加するため、

protected Preview deploymentを
今回1回追加でOwner承認する。

条件：

target = preview
Deployment Protection = enabled
custom domain = 0
production alias = 0
Production env = 0

Square Production secret = 0

external DB = 0

R2 = 0


metadataがpreviewでない場合：

Square requestを一切実行せず停止。


━━━━━━━━━━━━━━━━━━
18. Actual S1 invocation
━━━━━━━━━━━━━━━━━━

Preview build/start成功後のみ、
認証済みVercel経路から
S1 routeを1回だけPOST。

browser navigationではなく、
preload/retryされない明示的requestを使う。

必要ならVercel CLIの
deployment-targeted authenticated request機能を使う。

CLI syntaxは実行前にhelp/公式資料で確認。

secretをCLI引数へ入れない。


━━━━━━━━━━━━━━━━━━
19. request budget
━━━━━━━━━━━━━━━━━━

成功時：

Square external request count = 2

merchant = 1
locations = 1


Merchant call失敗時：

request count = 1


Location call失敗時：

request count = 2


自動retry = 0


同じS1をgreen確認目的で
もう一度呼ばない。


━━━━━━━━━━━━━━━━━━
20. S1成功条件
━━━━━━━━━━━━━━━━━━

S1_PASSは以下すべて。

merchant API success

merchant.status ACTIVE

merchant.country JP

merchant.currency JPY

location API success

configured Location found

location.status ACTIVE

location.country JP

location.currency JPY

location.merchant_id = merchant.id

merchant.main_location_id = configured location

secret exposure = 0

Production Square request = 0


CREDIT_CARD_PROCESSING capabilityも
payment前条件として確認。


━━━━━━━━━━━━━━━━━━
21. Merchant ID
━━━━━━━━━━━━━━━━━━

S1_PASS後のみ、

merchant.id

をSquare Sandbox merchant identityの正本として採用。

以下のPreview envを追加してよい：

SQUARE_SANDBOX_MERCHANT_ID

これは非secret metadata。

Previewのみ。

Productionには設定しない。


既存：

SQUARE_SANDBOX_LOCATION_ID

を変更しない。


━━━━━━━━━━━━━━━━━━
22. Merchant env追加後
━━━━━━━━━━━━━━━━━━

env追加による新deploymentは
今回実行しない。

Merchant IDは
次のS2 Preview deploymentから使用。

今回S1の成功結果は
取得済みmerchant/location evidenceで確定する。


━━━━━━━━━━━━━━━━━━
23. S1一時routeの後処理
━━━━━━━━━━━━━━━━━━

S1 evidence保存後：

一時的acceptance routeを
mainへ残す必要がない設計なら削除する。

transport / parser / reusable validation部分は
Astraが将来のpreflightに必要と判断したものだけ残す。

route削除後は：

lint
typecheck
narrow tests

を実行。

S1専用deploymentは、
evidence保存完了後に削除してよい。

既存の受入済みPreviewは保持してよい。


━━━━━━━━━━━━━━━━━━
24. evidence
━━━━━━━━━━━━━━━━━━

P6記録へ：

S1 execution SHA
Preview deployment ID
Preview target
API version
merchant status
merchant country
merchant currency
merchant ID
main location match
location count
configured location match
location status
location country
location currency
merchant match
CREDIT_CARD_PROCESSING
request count
HTTP results
external calls
secret exposure

を保存。

Access Token値は保存禁止。


━━━━━━━━━━━━━━━━━━
25. S1成功後の停止
━━━━━━━━━━━━━━━━━━

S1_PASSでも以下へ進まない：

Web Payments
CreatePayment
GetPayment
refund
Webhook
payment DB
booking confirmation

そこで停止。


次のOwner gate：

Square Sandbox S2
synthetic payment 1件

の承認待ち。


━━━━━━━━━━━━━━━━━━
26. S1失敗時
━━━━━━━━━━━━━━━━━━

失敗理由を分類：

AUTH_FAILED
SANDBOX_COUNTRY_MISMATCH
CURRENCY_MISMATCH
LOCATION_NOT_FOUND
LOCATION_ID_MISMATCH
MERCHANT_MISMATCH
LOCATION_INACTIVE
CAPABILITY_MISSING
NETWORK_FAILURE
SCHEMA_MISMATCH
UNKNOWN

勝手に設定変更して再試行しない。

request budgetをリセットしない。

Ownerへ1つの具体的な次操作を返す。


━━━━━━━━━━━━━━━━━━
27. 既存業務contract
━━━━━━━━━━━━━━━━━━

今回変更禁止：

HOLD 600秒
non-extending
group all-or-nothing
inventory
Premium
Regular
wear
pricing
quote snapshot
booking
recovery
custody
transfer
refund semantics
payment state machine

S1のためにこれらへ触れない。


━━━━━━━━━━━━━━━━━━
28. 最終報告
━━━━━━━━━━━━━━━━━━

Astra実施:
- Square transport S1 boundary
- Preview-only invocation
- provider evidence evaluation

Spark委譲:
- 使用した場合のみtask IDと結果

Verification:
- unit
- lint
- typecheck
- build
- Preview

Square S1:
- merchant GET result
- location GET result
- request count
- country/currency
- merchant/location match
- capability
- PASS/FAIL

External:
- payments 0
- refunds 0
- webhooks 0
- external DB 0
- R2 0

Security:
- secret exposure 0/?
- Production Square requests 0/?

Current HEAD:
- ...

Owner next action:
- S1 PASSならS2 synthetic payment 1件の承認待ち
- FAILなら具体的Owner action 1件

以上の範囲で
Square Sandbox S1 read-only acceptanceを進めてください。