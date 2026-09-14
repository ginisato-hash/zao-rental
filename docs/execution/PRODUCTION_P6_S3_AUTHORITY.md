【ZAO Rental｜正式Owner Authority
P6 R10 / S3 — Existing Sandbox Payment Lookup + Exact 100 JPY Full Refund】

私はZAO RentalのOwnerとして、このチャット本文を正式なOwner指示として採用する。

私は、これまで提示されたR10の内容を正式に採用し、その限定範囲における、

- 必要な実装
- ローカル検証
- protected Preview 1件の作成
- 既存Sandbox paymentのGetPayment照合
- 照合成功時の100 JPY全額Sandbox refund 1件
- 必要条件を満たした場合だけのGetRefund最大1件
- safe evidence保存
- temporary routeおよびR10 Previewのcleanup
- GitHubへのcommit / push / readback
- S4 Owner gateの準備

を明示的に承認する。

これは正式なOwner authorityである。

単なる調査依頼・提案・Draftではない。

以下に定義する安全境界内では、Codex parentは不要な中間承認を求めず、自立してR10/S3を最後まで実行してよい。

この本文と古い指示が競合する場合、この本文のR10/S3限定authorityを優先する。

ただし過去のhistorical evidence・guard・budget・security incidentを改変またはリセットする権限を与えるものではない。

━━━━━━━━━━━━━━━━━━
0. PROJECT / SOURCE OF TRUTH
━━━━━━━━━━━━━━━━━━

repo:

ginisato-hash/zao-rental

GitHubを唯一の正本とする。

canonical branch:

codex/external-acceptance-p6

expected starting remote HEAD:

9cae73c16e92844a824c79a74ccea100f94a4f1f

main:

3061dbbbe00294e5baebba2405028c907d6e6e85

mainは変更しない。

本体Macを現在のsingle writerとして扱う。

端末変更を理由に、

- authority
- request budget
- provider request count
- one-shot guard
- UNKNOWN履歴
- evidence
- Preview消費履歴

をリセットしない。

━━━━━━━━━━━━━━━━━━
1. CURRENT VERIFIED STATE
━━━━━━━━━━━━━━━━━━

R7:

Square Sandbox identity provider evidenceはS1_PASS。

merchant:

MLKDVEDH1ME21

merchant:

ACTIVE
JP
JPY

location:

ACTIVE
JP
JPY

configured location match:
true

main location match:
true

merchant/location match:
true

CREDIT_CARD_PROCESSING:
true

Square-Version:

2026-08-19

ただしR7全体にはoperator authentication-output incidentがあり、

FAIL_SECURITY_BOUNDARY

というhistorical記録を保持する。

これを書き換えない。

R7のSquare credential exposureは0。
Gitへのcredential保存0。
cookie/token extraction0。

R8:

R7 S1 provider identity evidenceをOwnerが正式採用済み。

SQUARE_SANDBOX_MERCHANT_ID:

MLKDVEDH1ME21

をPreview-only non-secret metadataとして登録済み。

R9 / S2:

S2_PASS。

既存Sandbox payment:

paymentId:

pezzekG1LQRt4MVKF0X4sgRCx1FZY

amount:

100 JPY

status:

COMPLETED

reference:
immutable S2 manifestと一致

location:
S1/S2 verified locationと一致

CreatePayment:

1

conditional GetPayment:

0

automatic retry:

0

manual retry:

0

S2 fixed idempotency key:

1fc46b8b-ce24-49f6-b809-c1594c2788b5

S2 request fingerprint:

19ad7d88b5c1f0bce8e209195e1ee4c84b76e89bf6e14ac306dfc9cc2a84a9d2

S2 Paymentを再作成しない。

CreatePayment再実行は禁止。

S1再実行も禁止。

━━━━━━━━━━━━━━━━━━
2. R10 / S3 PURPOSE
━━━━━━━━━━━━━━━━━━

今回の目的は以下の2段階のみ。

1.

既存Sandbox Payment:

pezzekG1LQRt4MVKF0X4sgRCx1FZY

をGetPaymentで最大1回read-only照合する。

2.

GetPayment結果が完全一致した場合だけ、

同じpaymentに対して

100 JPY

の全額Sandbox refundを1件だけ実行する。

Webhookは今回扱わない。

Productionは扱わない。

実顧客・実カード・通常予約は扱わない。

━━━━━━━━━━━━━━━━━━
3. FORMAL PROVIDER CALL BUDGET
━━━━━━━━━━━━━━━━━━

今回Ownerが承認するSquare provider request上限は:

GetPayment:

最大1

Refund POST:

最大1

GetRefund:

条件付き最大1

通常成功経路:

GetPayment 1
Refund POST 1
GetRefund 0

provider request最大:

3

CreatePayment:

0

S1:

0

Webhook:

0

Production Square:

0

automatic retry:

0

manual retry:

0

このbudgetはリセットしない。

未使用枠を他操作へ転用しない。

━━━━━━━━━━━━━━━━━━
4. GIT SAFETY
━━━━━━━━━━━━━━━━━━

最初に必ず:

git fetch origin --prune
git rev-parse HEAD
git rev-parse origin/codex/external-acceptance-p6
git rev-parse origin/main
git status --short --branch

を確認。

expected canonical remote:

9cae73c16e92844a824c79a74ccea100f94a4f1f

remoteが他writerにより進んでいた場合:

force push禁止。

git reset --hard禁止。

未知変更の削除禁止。

安全にreconcileする。

本体Macのunknown local workを壊さない。

git clean -fd等を無条件実行しない。

━━━━━━━━━━━━━━━━━━
5. AUTHORITY MUST BE RECORDED FIRST
━━━━━━━━━━━━━━━━━━

provider call・Preview作成より前に、

このOwner authorityを:

docs/execution/PRODUCTION_P6_S3_AUTHORITY.md

へ保存する。

current stateも必要最小限更新:

AGENTS.md
CLAUDE.md
docs/execution/SCOPE.md
docs/execution/PRODUCTION_P6_STATUS.json

historical:

R4
R6
R7
R8
R9/S2

の証拠・guard・結果は変更しない。

特に:

R7 FAIL_SECURITY_BOUNDARY

を消去・PASS化しない。

authority commitを作成しcanonical branchへpush。

remote readbackを確認後、自律的にR10/S3を続行する。

推奨commit:

docs(p6): authorize S3 payment lookup and exact Sandbox refund

━━━━━━━━━━━━━━━━━━
6. IMMUTABLE S3 MANIFEST
━━━━━━━━━━━━━━━━━━

provider dispatch前に:

docs/execution/p6/s3-evidence/operation-manifest.json

を作成する。

secret-freeで以下を固定:

operationId

refundIdempotencyKey

paymentId:
pezzekG1LQRt4MVKF0X4sgRCx1FZY

refundAmountJpy:
100

currency:
JPY

merchantId:
MLKDVEDH1ME21

apiVersion:
2026-08-19

providerOrigin:
SANDBOX

maxPaymentLookup:
1

maxRefundPost:
1

maxRefundLookup:
1

retry:
0

production:
false

refundIdempotencyKeyはUUIDを1つだけ生成して固定。

manifest commit後は変更しない。

location IDの実値をGitへ保存する必要はない。

server-sideの既存:

SQUARE_SANDBOX_LOCATION_ID

bindingを利用する。

manifestをcommit / push / remote readbackしてからprovider executionへ進む。

━━━━━━━━━━━━━━━━━━
7. DURABLE ONE-SHOT BOUNDARY
━━━━━━━━━━━━━━━━━━

既存P4:

SandboxActivationJournal

は今回のauthorityとして使用しない。

理由:

P4-SANDBOX-OWNER-R1
payment_limit 20
refund_limit 5

という別authorityだからである。

R10/S3のためにP4 budgetを流用・リセットしない。

今回のcontrolled Sandbox acceptanceに限り:

- immutable manifest
- exclusive local guard
- fsync
- route in-instance latch
- Square refund idempotency

を組み合わせる。

これはdistributed exactly-once HTTP保証とは主張しない。

Production決済のdurable shared journal要件を緩和しない。

━━━━━━━━━━━━━━━━━━
8. GET PAYMENT TARGET
━━━━━━━━━━━━━━━━━━

対象payment IDは完全固定:

pezzekG1LQRt4MVKF0X4sgRCx1FZY

endpoint:

GET
https://connect.squareupsandbox.com/v2/payments/pezzekG1LQRt4MVKF0X4sgRCx1FZY

Square-Version:

2026-08-19

query:

なし

別payment ID:

禁止

client/browserからpayment IDを入力させない。

Production origin:

禁止

━━━━━━━━━━━━━━━━━━
9. GET PAYMENT PASS CONDITIONS
━━━━━━━━━━━━━━━━━━

GetPayment最大1回。

必須条件:

HTTP 2xx

payment.id =
pezzekG1LQRt4MVKF0X4sgRCx1FZY

status =
COMPLETED

amount =
100

currency =
JPY

reference =
R9/S2 immutable manifestと一致

location =
既存S1/S2 verified location

updatedAt:
valid

completedAt:
valid

provider evidenceに矛盾なし。

可能な限り既存:

PaymentObservation
squareObservation
matchPayment

の契約を再利用する。

Square Payment responseに存在しないmerchant fieldを捏造しない。

merchant authorityは:

Owner-adopted S1 evidence
+
server-side fixed binding

とする。

1つでも一致しない場合:

Refund POST = 0

で停止。

分類:

BLOCKED_PAYMENT_LOOKUP_MISMATCH
または対応する明示的failure。

━━━━━━━━━━━━━━━━━━
10. REFUND AUTHORIZATION
━━━━━━━━━━━━━━━━━━

GetPaymentが完全PASSした場合だけrefundを許可する。

対象payment:

pezzekG1LQRt4MVKF0X4sgRCx1FZY

refund amount:

100 JPY

全額refund。

部分refund:

禁止

追加refund:

禁止

別payment refund:

禁止

endpoint:

POST
https://connect.squareupsandbox.com/v2/refunds

requestはserver-side固定。

browser/clientからrefund payloadを受け取らない。

operator側request body:

empty only。

bodyとして固定する:

idempotency_key:
manifest固定refundIdempotencyKey

payment_id:
pezzekG1LQRt4MVKF0X4sgRCx1FZY

amount_money.amount:
100

amount_money.currency:
JPY

reason:
R10/S3 synthetic Sandbox acceptance専用の明示的reason

既存P4 reason/budgetを新authorityとして誤用しない。

━━━━━━━━━━━━━━━━━━
11. TRANSPORT BOUNDARY
━━━━━━━━━━━━━━━━━━

shared transportのallowlistを緩めない。

必要ならR10/S3専用strict composition / transportを作成してよい。

許可endpointは今回:

GET
/v2/payments/{exact S2 payment ID}

POST
/v2/refunds

条件付き:

GET
/v2/refunds/{exact safe refund ID}

のみ。

任意URL fetchは禁止。

Production Square origin禁止。

redirect:

error

cache:

no-store

credentials:

omit

Authorization:

既存Preview server-side Square Sandbox access tokenのみ。

Access Token:

表示禁止
取得禁止
client送信禁止
ログ禁止
Git禁止
prompt禁止

raw Authorization headerも禁止。

━━━━━━━━━━━━━━━━━━
12. TEMPORARY S3 PREVIEW ROUTES
━━━━━━━━━━━━━━━━━━

今回だけprotected Preview用temporary routeを作成してよい。

GETによるprovider invocationは禁止。

operatorの明示POSTだけでS3 workflowを開始する構成にする。

UI link:
なし

sitemap:
なし

prefetch:
なし

public docs:
なし

Production:
404/fail-closed

要求:

VERCEL_ENV === preview

SQUARE_ENVIRONMENT === SANDBOX

SQUARE_API_VERSION === 2026-08-19

SQUARE_SANDBOX_MERCHANT_ID === MLKDVEDH1ME21

application configured

location configured

access token configured

public credential exposure 0

body empty

non-secret explicit intent required

client-controlled:

paymentId
refund amount
refund key
merchant
location

すべて禁止。

━━━━━━━━━━━━━━━━━━
13. ZERO-PROVIDER RUNTIME PREFLIGHT
━━━━━━━━━━━━━━━━━━

Square provider通信前にpreflightを実行。

preflight中のSquare request:

0

確認:

Preview deployment

SANDBOX

API version exact

merchant exact

application configured

location configured

token configured

token format valid

NEXT_PUBLIC Square credentialなし

Production false

immutable manifest exact

payment ID exact

refund amount 100

S3 guard unused

safe boolean / enumだけ返す。

secret値を返さない。

preflight BLOCKEDの場合:

GetPayment 0
Refund 0

で終了する。

長時間forensicへ進まない。

━━━━━━━━━━━━━━━━━━
14. LOCAL VALIDATION
━━━━━━━━━━━━━━━━━━

deploy前に必要な限定検証を実施。

最低限:

S3 lookup tests

refund fixture tests

existing payment/refund regression

fixed payment ID enforcement

fixed amount enforcement

fixed refund key enforcement

client-input rejection

same-key altered-payload rejection

Production rejection

secret redaction

UNKNOWN no-retry

conditional GetRefund rules

preflight tests

secret scan

lint

typecheck

build

をgreenにする。

既存testを理由なく大量に増殖させない。

ただし安全境界の回帰に必要な既存関連testは実行する。

Claude:

0

Spark:

0

今回のauthorityでは新規model delegationを行わない。

━━━━━━━━━━━━━━━━━━
15. PREVIEW AUTHORITY
━━━━━━━━━━━━━━━━━━

R10/S3用protected Previewを最大1件承認する。

必須:

target Preview

Ready

build success

Require Log In / Standard Protection

custom domain 0

production alias 0

Production Square env 0

最新Preview metadata:

merchant登録済み

accepted R3 Preview:

保持

R10 Preview:

最大1

第2Preview:

Ownerの新authorityなしでは禁止。

━━━━━━━━━━━━━━━━━━
16. LOGIN / BROWSER SECURITY
━━━━━━━━━━━━━━━━━━

R7 incident対策を厳守。

loginが必要な場合のみOwner操作を求めてよい。

Ownerは通常UIでlogin。

automationはlogin callback中:

raw URLを読まない

page titleを読まない

accessibility snapshotを取らない

query/fragmentを読まない

Cookieを読まない

tokenを読まない

storageを読まない

auth headerを読まない

Ownerがloginを完了し、
callback/login画面を離れて
target ZAO Rental Previewへ到達した後のみ
automation observationを開始する。

その後の出力もallowlisted metadataのみ。

Self-XSS解除禁止。

Console paste禁止。

allow pasting禁止。

Protection bypass禁止。

認証credential export禁止。

━━━━━━━━━━━━━━━━━━
17. ACTUAL EXECUTION ORDER
━━━━━━━━━━━━━━━━━━

以下が全てPASSした場合のみ実通信:

authority remote readback

manifest remote readback

local validation green

Preview Ready/protected

runtime preflight PASS

local S3 guard unused

順番は固定:

1.
GetPayment 最大1

2.
Payment evidence完全一致時のみRefund POST最大1

3.
Refund responseがCOMPLETEDなら終了

4.
Refund responseがPENDINGかつsafe refund ID取得済みの場合のみ
GetRefund最大1

その他のprovider callは禁止。

━━━━━━━━━━━━━━━━━━
18. REFUND ONE-SHOT GUARD
━━━━━━━━━━━━━━━━━━

actual refund dispatchより前に
exclusive local guardを作成しfsync。

最低限固定:

manifest hash

payment ID

refund idempotency key

100 JPY

Preview deployment ID

authority commit

guard確定後のみrefund dispatch。

automatic retry:

0

manual retry:

0

別key:

0

別Preview:

0

別browserによる再実行:

0

━━━━━━━━━━━━━━━━━━
19. REFUND PASS CONDITIONS
━━━━━━━━━━━━━━━━━━

Refund POST responseのHTTP成功だけでPASSにしない。

safe parserで:

refund.id

payment_id

location_id

amount

currency

status

を検証。

必須:

payment_id =
pezzekG1LQRt4MVKF0X4sgRCx1FZY

location =
S1/S2 verified location

amount =
100

currency =
JPY

refund ID:
valid

status =
COMPLETED

この場合:

S3_PASS

GetRefund追加確認:

0

━━━━━━━━━━━━━━━━━━
20. CONDITIONAL GET REFUND
━━━━━━━━━━━━━━━━━━

Refund POSTで:

safe refund ID取得済み

かつ

status = PENDING

の場合のみ:

GET /v2/refunds/{refundId}

最大1回を承認する。

retry:

0

GetRefund結果が:

COMPLETED

かつpayment/location/100JPY/JPY一致

なら:

S3_PASS

1回のGetRefund後もPENDING:

S3_NONTERMINAL_DO_NOT_RETRY

REJECTED / FAILED:

S3_REFUND_FAILED

safe refund ID未取得のnetwork/timeout/response-loss:

UNKNOWN_DO_NOT_RETRY

この場合:

GetRefund 0

Refund POST再送 0

━━━━━━━━━━━━━━━━━━
21. FAILURE / UNKNOWN RULES
━━━━━━━━━━━━━━━━━━

GetPayment:

401/403
→ S3_FAIL_AUTH

429
→ S3_FAIL_RATE_LIMIT

404
→ S3_PAYMENT_NOT_FOUND

money/reference/location mismatch
→ S3_PAYMENT_EVIDENCE_MISMATCH

Refund:

known provider 4xx
→ S3_REFUND_PROVIDER_FAIL

identity/money mismatch
→ S3_REFUND_EVIDENCE_MISMATCH

network/timeout/dispatch outcome uncertain
→ UNKNOWN_DO_NOT_RETRY

UNKNOWN時:

別key禁止
別Preview禁止
別browser禁止
別process禁止
同じPOST再送禁止

green確認目的の再試行禁止。

━━━━━━━━━━━━━━━━━━
22. SAFE EVIDENCE
━━━━━━━━━━━━━━━━━━

cleanup前にsafe resultをGitHubへ保存。

保存可:

authority SHA

source/tree SHA

manifest hash

operation ID

payment ID

refund ID

refund idempotency key

HTTP status

payment status

refund status

100 JPY

currency

reference match

location match

dispatch count

timestamps

classification

保存禁止:

Square access token

Authorization

Cookie

session/storage

card data

raw provider body

raw request headers

auth callback

login URL/query/fragment

safe resultをcommit / push / remote readback後にだけcleanupする。

━━━━━━━━━━━━━━━━━━
23. CLEANUP
━━━━━━━━━━━━━━━━━━

evidence remote保存後:

temporary S3 execution route削除

temporary preflight route削除

narrow tests

secret scan

lint

typecheck

build

を実行。

exact R10/S3 Previewを削除。

accepted R3 Previewは保持。

operation manifest保持。

S3 local guard保持。

provider上のSandbox refundはそのまま保持。

追加refundをcleanup目的で送らない。

━━━━━━━━━━━━━━━━━━
24. S3 PASS AFTERMATH
━━━━━━━━━━━━━━━━━━

S3_PASSでも自動的にWebhookへ進まない。

作成:

docs/execution/PRODUCTION_P6_S4_GATE.md

S4はWebhook acceptance専用gateとする。

最低限記録:

S1 identity accepted

S2 synthetic payment PASS

S3 GetPayment PASS

S3 100 JPY full refund PASS

provider payment ID

provider refund ID

actual request counts

Sandbox only

Web Payments SDK未検証

Webhook receiver未接続

Production未接続

S4 gateは実行authorityではない。

Webhook provider operation:

0

のまま停止する。

━━━━━━━━━━━━━━━━━━
25. ABSOLUTE PROHIBITIONS
━━━━━━━━━━━━━━━━━━

今回絶対に実行しない:

CreatePayment

S1 rerun

別payment lookup

別payment refund

2回目refund POST

Production Square

Production deploy

実カード

実顧客

Webhook subscription

Webhook delivery

Orders API

Customers API

Catalog API

external operational DB

normal booking payment state更新

booking mutation

inventory mutation

custody mutation

email

SMS

main merge

Runner

ruleset変更

billing expansion

permission expansion

credential rotation

secret extraction

Claude start

Spark start

新規PR

━━━━━━━━━━━━━━━━━━
26. AUTONOMY — LATEST OWNER POLICY
━━━━━━━━━━━━━━━━━━

安全境界内ではCodex parentが自立実行する。

以下について逐次Owner確認を求めない:

file設計

route naming

strict transport設計

tests追加

safe response schema

manifest生成

operation ID生成

refund UUID生成

Preview deploy

preflight

GetPayment

Refund

条件付きGetRefund

evidence生成

cleanup

commit

push

S4 gate作成

「続けていいですか」
「この方法でいいですか」
という不要な中間停止は禁止。

scope内のrecoverableな技術問題は
Codex parentが自律解決して続行する。

ただし以下の場合のみ停止してよい:

A.
Ownerのpassword / MFA /通常loginが必要

B.
Preview protectionを証明できない

C.
payment evidence mismatch

D.
merchant / location / env mismatch

E.
remote concurrent writer conflict

F.
unexpected permission / billing expansionが必要

G.
このauthority外の不可逆操作が必要

これら以外はR10/S3完了まで自立実行する。

━━━━━━━━━━━━━━━━━━
27. FINAL REPORT
━━━━━━━━━━━━━━━━━━

R10/S3完了時だけまとめて報告。

必須:

Starting HEAD

Authority commit

Manifest / execution commit

Result commit

Cleanup / final HEAD

working tree clean

main unchanged

Preview:

deployment ID

origin

Ready

Protection

deleted

accepted R3 retained

Preflight:

PASS / BLOCKED

Payment lookup:

GetPayment count

HTTP status

payment status

100 JPY

reference match

location match

Refund:

POST count

HTTP status

refund ID

refund status

100 JPY

Conditional GetRefund:

count

HTTP/status
使用した場合のみ

classification:

S3_PASS
または
明示failure
または
UNKNOWN_DO_NOT_RETRY

retry:

automatic 0
manual 0

Security:

Square secret exposure 0/?

S3 auth callback exposure 0/?

External:

CreatePayment 0

S1 rerun 0

Webhook 0

Production 0

external DB 0

booking mutation 0

inventory mutation 0

custody mutation 0

Validation:

tests

secret scan

lint

typecheck

build

PASS時:

S4 gate path

Owner next action:

Webhook S4 authority approval

のみ。

━━━━━━━━━━━━━━━━━━
28. FINAL OWNER CONFIRMATION
━━━━━━━━━━━━━━━━━━

私はOwnerとして、上記R10/S3の限定範囲を正式に承認する。

特に以下を明示承認する:

- R10/S3に必要な限定実装
- protected Preview最大1件
- provider通信0のpreflight
- 既存payment `pezzekG1LQRt4MVKF0X4sgRCx1FZY` に対するGetPayment最大1件
- GetPayment完全一致時のみ100 JPY全額Sandbox refund最大1件
- PENDINGかつsafe refund ID取得済みの場合のみGetRefund最大1件
- immutable manifest
- local exclusive/fsynced guard
- provider idempotency
- safe evidence保存
- temporary route cleanup
- exact R10 Preview cleanup
- GitHub commit / push / remote readback
- S3_PASS時のS4 gate作成

この承認はWebhook、Production、CreatePayment再実行、実カード、実顧客、本番DB、通常予約更新その他のscope外操作を含まない。

R10/S3は上記境界内で不要に停止せず、自立して最後まで実行すること。