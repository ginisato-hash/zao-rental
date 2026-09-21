【ZAO Rental｜P6 R9 / S2
Synthetic Square Sandbox payment exactly1 — autonomous execution authority】

Owner判断:

P6 R8完了を確認した。

canonical branch:
codex/external-acceptance-p6

expected starting remote HEAD:
0331fb623613e5fb4dce2d0766e70d58d1b90f0b

main:
3061dbbbe00294e5baebba2405028c907d6e6e85

S1:
OWNER_ACCEPTED_FROM_R7_PASS

merchant:
MLKDVEDH1ME21
ACTIVE / JP / JPY

location:
S1 verified
ACTIVE / JP / JPY

CREDIT_CARD_PROCESSING:
true

Preview merchant metadata:
REGISTERED_PREVIEW_ONLY

R7 security incident:
preserved separately

S1 rerun:
FORBIDDEN

S2 gate:
docs/execution/PRODUCTION_P6_S2_GATE.md

今回OwnerはS2 synthetic Sandbox payment exactly1を明示承認する。

不要な中間Owner確認を挟まず、
Codex parentが設計・実装・検証・Preview・実行・証跡・cleanupまで
一気通関する。

────────────────────
1. 最初のGit確認
────────────────────

必ず:

git fetch origin --prune
git rev-parse HEAD
git rev-parse origin/codex/external-acceptance-p6
git rev-parse origin/main
git status --short --branch

を確認。

expected remote:

0331fb623613e5fb4dce2d0766e70d58d1b90f0b

他writerによってremoteが進んでいた場合は
force/resetせず最新GitHub状態をreconcileする。

本体Macの未知local変更を破壊しない。

────────────────────
2. Authorityを先に保存
────────────────────

以下を作成:

docs/execution/PRODUCTION_P6_S2_AUTHORITY.md

current headers/statusも必要最小限更新:

AGENTS.md
CLAUDE.md
docs/execution/SCOPE.md
docs/execution/PRODUCTION_P6_STATUS.json

R4/R6/R7/R8 historyは変更しない。

commit/push/readback:

docs(p6): authorize autonomous S2 synthetic payment acceptance

その後は中間Owner承認なしで継続。

────────────────────
3. S2の目的
────────────────────

Square Sandboxへ、

synthetic payment:
exactly one logical payment

を実行し、

Square provider responseと
既存PaymentRequest契約を突合する。

これは通常予約・本番決済・売上ではない。

amount:

100 JPY

source:

cnon:card-nonce-ok

Squareが提供するSandbox専用test sourceとして固定。

autocomplete:

true

merchant:

MLKDVEDH1ME21

location:

既存S1 verified
SQUARE_SANDBOX_LOCATION_ID

Square-Version:

2026-08-19

Production Square:
0

実カード:
0

実顧客:
0

────────────────────
4. Durable one-shot境界についてのOwner決定
────────────────────

PRODUCTION_P6_S2_GATE.mdは
durable one-shot境界を未解決としている。

既存:

SandboxActivationJournal

はPostgreSQL依存であり、
既存migrationは:

activation id:
P4-SANDBOX-OWNER-R1

payment_limit:
20

refund_limit:
5

に固定されている。

Ownerは今回のS2 acceptanceだけについて、
このP4 journalを流用しないことを決定する。

新しいexternal DBも作らない。

今回のS2限定で以下を
equivalent controlled one-shot boundaryとして採用する。

A.
immutable operation manifestを
provider dispatch前にGitHubへcommitする。

B.
manifestに固定する:

operationId
bookingId/referenceId
attemptId
idempotencyKey
amount = 100
currency = JPY
merchant = MLKDVEDH1ME21
source = cnon:card-nonce-ok
Square-Version = 2026-08-19

IDsはcrypto.randomUUID相当で一度だけ生成。

すべてnon-secret。

C.
client/browserから:

amount
source
merchant
location
IDs
idempotency key

を入力・変更させない。

request bodyは空。

D.
local durable guardを
actual invocation前にexclusive create + fsyncし、
dispatch前に確定する。

E.
route側にもin-instance attempted latchを置く。

これはdistributed guaranteeとは主張しない。
defense in depthのみ。

F.
Square CreatePaymentの
固定idempotencyKeyをprovider-side duplicate-payment protectionとして使う。

同じkeyに別payloadを絶対に送らない。

G.
自動retry 0。
手動retry 0。

このS2では
「任意並行攻撃下でHTTP requestが世界全体で必ず1回」
とは主張しない。

保証対象は:

- Owner controlled invocationは1回
- client payload変更不可
- same logical payment identity固定
- accidental identical duplicateがSquareへ到達しても
  provider idempotencyで二重payment creationを防止
- unknown後の新規POST禁止

である。

これはSandbox S2 acceptance限定のOwner例外。

Production payment architectureについては
shared durable journal要件を緩和しない。

────────────────────
5. S2 implementation
────────────────────

既存を最大限再利用:

packages/contracts/src/rental-flow.ts
packages/core/src/payment/square-boundary.ts
packages/core/src/payment/square-sandbox.ts
packages/core/src/payment/square-transport.ts

既存:

squareCreateBody
squareObservation
matchPayment

の契約を利用する。

ただし既存transport compositionが
S2で必要なcredential metadataを
推測・捏造しなければ使えない場合は、

S2専用のstrict narrow transportを作ってよい。

その場合のallowlist:

POST
https://connect.squareupsandbox.com/v2/payments

および後述条件を満たす場合のみ:

GET
https://connect.squareupsandbox.com/v2/payments/{providerId}

以外は拒否。

Production origin拒否。

redirect:
error

cache:
no-store

credentials:
omit

Authorization:
server-side Preview access tokenのみ。

token値をresponse/log/Git/clientへ出さない。

────────────────────
6. Temporary Preview-only S2 route
────────────────────

一時的なprotected Preview routeを作成してよい。

POST only。

UI linkなし。
sitemapなし。
GET invocationなし。
prefetchなし。

要求:

VERCEL_ENV === preview

SQUARE_ENVIRONMENT === SANDBOX

SQUARE_API_VERSION === 2026-08-19

merchant env:
MLKDVEDH1ME21 と完全一致

application ID:
configured

location ID:
configured

access token:
configured + accepted format

NEXT_PUBLIC Square credential:
0

non-secret intent headerを要求する。

body:
empty only。

browserからのparameter:
0。

────────────────────
7. Runtime preflight
────────────────────

Square通信前に
provider request 0のruntime preflightを実行。

最低限:

deployment preview
environment SANDBOX
api version match
merchant configured and exact match
application configured
location configured
token configured
token format valid
public credential exposure false
operation manifest exact
production false
one-shot guard not previously consumed

をsafe boolean/enumだけで返す。

preflight BLOCKEDなら
CreatePayment 0で終了。

長時間forensicへ進まない。

scope内のコード問題なら自律修正してよいが、
第2Previewは作らない。

────────────────────
8. Local validation
────────────────────

deploy前に最低限:

S2 narrow tests
existing Square payment boundary tests
idempotency/fingerprint tests
same-key/different-payload rejection
client-input rejection
Production rejection
secret redaction
UNKNOWN no-retry
preflight tests
secret scan
lint
typecheck
build

をgreenにする。

特に証明:

browser requestを2回生成しても
operator guardが2回目をdispatchしない。

同一route instance内の2回目も拒否。

異なるamount/source/keyをclientから注入不可。

Productionではprovider dispatch 0。

Claude:
0

Spark:
原則0。
isolated fixture testで明確な節約になる場合だけ最大1。

────────────────────
9. S2 Preview
────────────────────

新しいprotected Preview:

最大1件

をOwner承認する。

必須:

target Preview
Ready
build SUCCESS
Require Log In / Standard Protection
custom domain 0
production alias 0
Production Square env 0

merchant metadataを含む
最新Preview envが適用されること。

accepted R3 Previewは保持。

第2Previewは禁止。

────────────────────
10. Browser security
────────────────────

R7 incident対策を厳守。

Owner loginが必要な場合:

通常UIでOwnerがlogin
↓
callback/login画面を完全に離れる
↓
target Previewへ到達
↓
その後にautomation observation開始

login中は:

raw URL取得禁止
page title出力禁止
accessibility snapshot禁止
query/fragment取得禁止

Cookie/token/storage/auth header:
読まない
出さない
保存しない。

loginだけOwnerが必要ならそこでのみ停止可。

ログイン完了後は自律再開。

────────────────────
11. Immutable operation manifest
────────────────────

actual provider dispatchより前に

docs/execution/p6/s2-evidence/operation-manifest.json

をsecret-freeで保存し、
commit/push/readbackする。

最低限:

operationId
bookingId
attemptId
idempotencyKey
amountJpy = 100
currency = JPY
merchantId = MLKDVEDH1ME21
sourceKind = SQUARE_SANDBOX_FIXED_TEST_SOURCE
sourceId = cnon:card-nonce-ok
apiVersion = 2026-08-19
providerOrigin = Sandbox
maxCreatePaymentDispatch = 1
maxConditionalLookup = 1
retry = 0
production = false

location ID実値をGitへ保存する必要がない場合は
env bindingとして記録する。

manifest commit後、
request identityを変更しない。

────────────────────
12. Actual S2 invocation
────────────────────

以下が全てPASS後のみ:

local validation
Preview metadata
protection
runtime preflight
manifest remote readback

R9/S2 local durable guardを
dispatch前に確定。

その後、
同じauthenticated Playwright contextから
明示POSTを1回だけ実行。

POST dispatch:
1 max

CreatePayment:
1 max

retry:
0

body:
none

server constructs exact fixed request。

────────────────────
13. CreatePayment PASS条件
────────────────────

HTTP成功だけでPASSにしない。

provider Paymentをsafe parserへ通し、

providerId:
valid nonempty

referenceId:
exact bookingId

locationId:
configured S1 location

amount:
100

currency:
JPY

status:
COMPLETED

updatedAt:
valid

completedAt:
valid

を確認。

merchant identityについては
R8採用済みS1 evidence +
server-side fixed merchant/location binding
をauthorityとし、

Square responseに存在しないmerchant fieldを
捏造しない。

既存:

squareObservation
matchPayment

で突合可能な契約は必ず使う。

全条件成立:

S2_PASS

────────────────────
14. Conditional GetPayment
────────────────────

通常のCreatePaymentが
完全なS2_PASSを返した場合:

GetPayment:
0

追加確認しない。

CreatePayment後に:

安全なproviderIdは取得済み
かつ
結果がPENDING/UNKNOWN等でterminal判定できない

場合のみ、

GET /v2/payments/{providerId}

を最大1回許可。

これは追加paymentではない。

GetPayment retry:
0

providerId不明:
lookup 0
UNKNOWN_DO_NOT_RETRY

timeout / parse failure / network unknown:
再POSTしない。

同じidempotency keyを使って
green確認目的のCreatePayment再送もしない。

────────────────────
15. Explicit failure handling
────────────────────

401 / 403:
S2_FAIL_AUTH

429:
S2_FAIL_RATE_LIMIT

known provider 4xx:
S2_FAIL_PROVIDER

identity/money/reference mismatch:
S2_FAIL_EVIDENCE

network/timeout where dispatch outcome uncertain:
UNKNOWN_DO_NOT_RETRY

providerId unknown:
STOP

どの場合でも:

new POST 0
alternate key 0
alternate Preview 0
alternate browser invocation 0

────────────────────
16. Evidence
────────────────────

raw provider bodyをGitへ保存しない。

保存可:

operation IDs
provider payment ID
HTTP status
payment status
amount
currency
reference match
location match
request fingerprint
request count
timestamps
classification

保存禁止:

Square access token
Authorization
Cookie
card data
raw response
auth callback
session/storage

resultはまずGitHubへcommit/push/readbackする。

────────────────────
17. PASS後
────────────────────

S2_PASSでも自動的に:

Webhook
refund
Web Payments SDK
booking payment state update
real DB integration
Production
S3 provider action

へ進まない。

代わりに:

docs/execution/PRODUCTION_P6_S3_GATE.md

を作成する。

最低限:

S2 PASS evidence
provider payment ID
100 JPY
Sandbox
merchant/location binding
request counts
idempotency evidence
remaining unverified boundaries

を記録。

次工程候補:

payment lookup/recovery
Webhook
refund

を分離してOwner gate化する。

────────────────────
18. Cleanup
────────────────────

結果evidenceのGitHub保存後:

temporary S2 route削除
temporary preflight route削除

narrow tests
secret scan
lint
typecheck
build

を実行。

exact S2 Preview削除。

accepted R3保持。

operation manifest保持。

local durable guard保持。

Square Sandboxの作成済みsynthetic payment自体は
削除・refundしない。
refundは別authority。

────────────────────
19. Current status
────────────────────

最終的に:

S2_PASS

または

S2_FAIL_*
UNKNOWN_DO_NOT_RETRY
BLOCKED_NOT_DISPATCHED

のいずれかへ明示分類。

PRODUCTION_P6_STATUS.json
AGENTS.md
CLAUDE.md
SCOPE.md

をcurrent resultへ更新。

historical R4/R6/R7/R8は変更しない。

────────────────────
20. 絶対禁止
────────────────────

S1 rerun
Production deploy
Production Square
real card
real customer
customer API
orders API
catalog API
refund
Webhook subscription
Webhook delivery
external operational DB
production booking update
inventory update
custody update
email
SMS
main merge
Runner
Ruleset変更
billing/permission expansion
credential rotation
secret extraction

すべて禁止。

────────────────────
21. Autonomy
────────────────────

以下でOwnerへ逐次確認しない:

implementation details
test追加
route naming
safe schema
operation IDs生成
manifest作成
Preview deploy
preflight
S2 one-shot execution
evidence
cleanup
commit/push
S3 gate作成

scope内recoverable issueはCodex parentが処理。

停止してよいのは:

password/MFA/login
unexpected billing/permission requirement
Preview protectionを証明不能
merchant/location/env mismatch
remote concurrent writer conflict
scope外不可逆操作が必要

のみ。

それ以外はR9/S2完了まで一気通関する。

────────────────────
22. 最終報告
────────────────────

完了時のみまとめて報告:

Starting HEAD
Authority commit
operation manifest commit
execution/result commit
cleanup/final HEAD
working tree

Preview:
ID
origin
protection
deleted/retained

Preflight:
PASS/BLOCKED

S2:
POST count
CreatePayment count
conditional GetPayment count
HTTP result
provider payment ID
payment status
100 JPY
reference match
location match
classification

Financial uniqueness:
fixed idempotency key
fixed fingerprint
manual retry0
automatic retry0

Security:
Square secret exposure0
auth callback exposure0 for S2

External:
refund0
webhook0
Production0
DB0
S1 rerun0

Validation:
tests
secret scan
lint
typecheck
build

PASS時:
S3 gate path

Owner next action:
S3 authority approval

不要な中間報告で止まらず、
R9/S2を最後まで自立実行する。