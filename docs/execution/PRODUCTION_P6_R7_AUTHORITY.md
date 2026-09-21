【ZAO Rental｜P6 R7
S1 Acceptance v2 continuation — exact API version correction + autonomous execution】

Owner方針:
R6で確認された唯一のruntime preflight blocker
`SQUARE_API_VERSION` mismatchを修正し、
新しいR7 PreviewでS1まで一気通関する。

不要な中間Owner承認は挟まない。
安全境界内ではCodex parentが自立実行する。

━━━━━━━━━━━━━━━━━━
0. Starting state
━━━━━━━━━━━━━━━━━━

repo:
ginisato-hash/zao-rental

branch:
codex/external-acceptance-p6

expected starting HEAD:
69a2716eda1953fcd147b90f135e4fdd963ef974

main:
3061dbbbe00294e5baebba2405028c907d6e6e85

R6 result:
S1_BLOCKED / API_VERSION_MISMATCH

R6 POST:
0

R6 Square requests:
0

R6 Preview:
deleted

accepted R3 Preview:
dpl_2tskZombWNMhwEKB6NG96FxkzmhL
retained / Ready

R4 historical:
UNKNOWN_DO_NOT_RETRY
unchanged

━━━━━━━━━━━━━━━━━━
1. R7 authority record
━━━━━━━━━━━━━━━━━━

最初にこのOwner authorityを

docs/execution/PRODUCTION_P6_R7_AUTHORITY.md

として記録し、

AGENTS.md
CLAUDE.md
docs/execution/SCOPE.md
docs/execution/PRODUCTION_P6_STATUS.json

のcurrent header/statusをR7へ更新する。

historical R4/R6 evidenceは変更しない。

commit/push:

docs(p6): authorize R7 exact API version correction and S1 acceptance

push/readback後、自律継続する。

━━━━━━━━━━━━━━━━━━
2. 今回Ownerが明示承認するenv mutation
━━━━━━━━━━━━━━━━━━

Vercel project:
zao-rental

Team:
zao-food-map / Yuge

Preview environmentのみ。

以下のexact keyだけ変更してよい:

SQUARE_API_VERSION

final value:
2026-08-19

Production targetへ設定しない。

他のenv keyは変更しない。

現在値を読取・表示・保存・promptへ出す必要はない。
既知の正しいliteral `2026-08-19` で上書きする。

Vercel UI上でupdateができず
delete/recreateが必要な場合のみ、
同じkeyをPreview targetに同じSensitive/Secret扱いで
再作成してよい。

変更対象はこの1 keyだけ。

禁止:
- access token変更
- application ID変更
- location ID変更
- merchant ID変更
- Production env変更
- env export
- env dump
- secret読取
- CLIで他のenvをpull

通常Vercel UIを優先。

━━━━━━━━━━━━━━━━━━
3. env変更後の確認
━━━━━━━━━━━━━━━━━━

値を再表示せず、

- key存在
- target = preview
- type/visibilityが従来どおり
- Production entry 0

だけをmetadataで確認。

env change count:
1

この変更は新deploymentにのみ適用される前提で、
既存R3 Previewは触らない。

━━━━━━━━━━━━━━━━━━
4. R7 Preview
━━━━━━━━━━━━━━━━━━

R7で新しいprotected Previewを
1件だけ承認する。

preview allowance:
1

必須:

target = preview
state = Ready
build = success
Deployment Protection enabled
Require Log In
custom domain 0
production alias 0
Production Square env 0

Production deployment禁止。

この1件が失敗・BLOCKEDでも
第2Previewを勝手に作らない。

━━━━━━━━━━━━━━━━━━
5. local implementation
━━━━━━━━━━━━━━━━━━

R6で完成した

- secret-safe runtime preflight
- S1 v2 structured result
- Square S1 service/transport
- tests

を再利用する。

cleanupで削除したtemporary routesだけ、
R7 execution用に再導入してよい。

product/business/payment contractは変更しない。

必要以上のrefactorは禁止。
R6でgreenだった実装を優先する。

━━━━━━━━━━━━━━━━━━
6. local validation
━━━━━━━━━━━━━━━━━━

deploy前に:

R7/R6 preflight tests
Square S1 tests
secret redaction
Production rejection
secret scan
lint
typecheck
build

を通す。

R6で69 testsだった基準を下回らない。

Claude:
0

Spark:
原則0。
本当にisolated testだけで明確に節約になる場合でも最大1。
provider/env/deploy/route本体はSpark禁止。

━━━━━━━━━━━━━━━━━━
7. Runtime preflight
━━━━━━━━━━━━━━━━━━

新R7 Preview上で、
Square通信0のruntime preflightを先に実行。

期待:

environment = SANDBOX
deployment = preview
apiVersionMatch = true
applicationIdConfigured = true
locationIdConfigured = true
accessTokenConfigured = true
accessTokenFormatValid = true
publicCredentialExposure = false
readyForS1 = true
result = PASS

ここでBLOCKEDなら、
Square APIへ進まない。

ただしR7で追加の長時間forensicは行わない。

structured reasonを保存しcleanupして終了する。

━━━━━━━━━━━━━━━━━━
8. S1 actual invocation
━━━━━━━━━━━━━━━━━━

preflight PASS時のみ実行。

通常認証済みPlaywright same-origin経路。

R7専用durable one-shot guardを
dispatch前に確定する。

R4/R6 guardを変更しない。

S1 POST:
最大1回

retry:
0

Square requests:
最大2 GET

1.
GET /v2/merchants/me

merchant成功時のみ

2.
GET /v2/locations

origin:
https://connect.squareupsandbox.com

Square-Version:
2026-08-19

Production Square:
0

━━━━━━━━━━━━━━━━━━
9. S1 PASS条件
━━━━━━━━━━━━━━━━━━

全て必須:

merchant HTTP success
merchant.status ACTIVE
merchant.country JP
merchant.currency JPY

configured location found exactly

location.status ACTIVE
location.country JP
location.currency JPY

location.merchant_id = merchant.id
merchant.main_location_id = configured location

CREDIT_CARD_PROCESSING = true

secret exposure = 0
Production Square requests = 0
requestCount = 2

全て成立時のみS1_PASS。

━━━━━━━━━━━━━━━━━━
10. result handling
━━━━━━━━━━━━━━━━━━

PASS / FAIL / WARNING / UNKNOWNいずれでも
同じR7 S1は再実行しない。

長時間forensicへ逸れない。

structured resultを保存してcleanupする。

PASS以外なら:
具体的なreason/stageだけ記録し、
次Owner action 1件を返す。

━━━━━━━━━━━━━━━━━━
11. PASS後のmerchant metadata
━━━━━━━━━━━━━━━━━━

S1_PASSの場合のみ、

returned merchant.id

をPreview-only non-secret metadata:

SQUARE_SANDBOX_MERCHANT_ID

として登録してよい。

これはOwnerが今回明示承認する。

existing:
SQUARE_SANDBOX_LOCATION_ID

は変更しない。

merchant env登録後のredeployは禁止。

━━━━━━━━━━━━━━━━━━
12. S2 gate
━━━━━━━━━━━━━━━━━━

S1_PASSなら、その場でS2を実行しない。

代わりに:

docs/execution/PRODUCTION_P6_S2_GATE.md

を作成する。

内容:

- exact S1 PASS evidence
- merchant ID
- location identity
- JP/JPY
- CREDIT_CARD_PROCESSING=true
- current HEAD
- merchant metadata registration
- synthetic payment exactly1のscope案
- idempotency
- UNKNOWN recovery
- webhook/refund boundary
- Owner approval boundary

次のOwner操作は
「S2を承認するか」
だけになる状態まで準備する。

━━━━━━━━━━━━━━━━━━
13. cleanup
━━━━━━━━━━━━━━━━━━

result/evidenceをGitHubへ保存してから:

temporary preflight route削除
temporary S1 route削除

narrow tests
secret scan
lint
typecheck
build

再実行。

R7 Preview削除。

accepted R3 Preview保持。

R7 guard保持。

reusable pure logic/service/transport/testsは保持。

━━━━━━━━━━━━━━━━━━
14. evidence
━━━━━━━━━━━━━━━━━━

最低限:

docs/execution/p6/R7_S1_RESULT.md
docs/execution/p6/r7-evidence/

を作成。

secret-freeで記録:

starting HEAD
authority commit
implementation/execution SHA
env mutation:
  SQUARE_API_VERSION only
  Preview only
  value = 2026-08-19
  no other env mutation

Preview ID
origin
target
protection

preflight result

POST count

Square request count

merchant/location HTTP

JP/JPY

identity matches

CREDIT_CARD_PROCESSING

S1 result

merchant metadata registration

cleanup

final validation

━━━━━━━━━━━━━━━━━━
15. absolute prohibitions
━━━━━━━━━━━━━━━━━━

Production deploy
Production Square
real customer
real card
CreatePayment
GetPayment
refund
webhook creation
webhook delivery
S2 execution
external DB
R2
email
SMS
main merge
Runner
Ruleset changes
billing/permission expansion
secret extraction
secret logging

all 0.

━━━━━━━━━━━━━━━━━━
16. autonomy
━━━━━━━━━━━━━━━━━━

以下でOwnerへ止めない:

- exact env key update
- local code restoration
- test fixes
- route composition
- evidence
- deploy
- preflight
- S1
- cleanup
- Git commits/push
- merchant metadata登録（PASS時のみ）
- S2 gate作成

login/password/MFAが本当に必要な場合だけOwnerへ依頼。

recoverableなscope内問題は自律解決する。

━━━━━━━━━━━━━━━━━━
17. final report
━━━━━━━━━━━━━━━━━━

R7完了時だけまとめて報告:

Starting HEAD
Authority commit
Execution/result commits
Final HEAD
working tree

Env:
SQUARE_API_VERSION updated
target Preview
other env changes 0

Preview:
deployment ID
origin
Ready
Protection
deleted after evidence

Preflight:
all flags
PASS/BLOCKED

S1:
POST count
merchant GET
locations GET
request count
HTTP results
JP/JPY
merchant/location match
CREDIT_CARD_PROCESSING
PASS/FAIL/WARNING/UNKNOWN

PASS時:
merchant metadata registration
S2 gate path

Security:
secret exposure 0
Production Square 0

External:
payment 0
refund 0
webhook 0
DB 0
R2 0
S2 0

Validation:
tests
secret scan
lint
typecheck
build

不要な中間報告で停止せず、
R7を最後まで一気通関する。
