【ZAO Rental｜正式Owner Authority
P6 R14 DEVELOPMENT ACTIVATION E2E
Real PostgreSQL + Live Sandbox Webhook + Reconciliation + Business Projection Acceptance】

私はOwnerとして、このチャット本文のR14 authorityを正式に採用し、以下に明記した限定範囲の外部操作・実装・検証・GitHub保存を承認する。

これはDraft・提案ではなく正式な実行authorityである。

安全境界内ではCodex parentが不要な中間Owner確認をせず、自立実行する。

━━━━━━━━━━━━━━━━━━
0. SOURCE OF TRUTH
━━━━━━━━━━━━━━━━━━

repo:
ginisato-hash/zao-rental

canonical branch:
codex/external-acceptance-p6

expected starting remote HEAD:
d0a1f66b8cfa97ad1b5e5bd06f409e056604cf0a

main:
3061dbbbe00294e5baebba2405028c907d6e6e85

GitHubを正本とする。

開始時:

git fetch origin --prune
git rev-parse HEAD
git rev-parse origin/codex/external-acceptance-p6
git rev-parse origin/main
git status --short --branch

を確認。

remoteが進んでいた場合はforce/resetせずreconcileする。

unknown local changeを破壊しない。

━━━━━━━━━━━━━━━━━━
1. CURRENT VERIFIED STATE
━━━━━━━━━━━━━━━━━━

R11:
Webhook Receiver + Durable Inbox
LOCAL_IMPLEMENTED

migration:
0025_square_webhook_inbox.sql
未実DB適用

R12:
Durable Reconciliation Job
Claim / Lease
Provider Truth Port
Decision Engine
LOCAL_IMPLEMENTED

migration:
0026
未実DB適用

R13:
Transactional Payment Projection
Projection idempotency
HOLD / inventory / transfer safety
LOCAL_IMPLEMENTED

migration:
0027_payment_projection.sql
未実DB適用

R13 validated local suite:
491 PASS
0 fail
0 skip

main:
unchanged

R10 historical refund:

LAST_OBSERVED_PENDING
S3_NONTERMINAL_DO_NOT_RETRY

これはnon-gating historical stateとして維持する。

R14ではR10 refundを一切再照合しない。

━━━━━━━━━━━━━━━━━━
2. R14 OBJECTIVE
━━━━━━━━━━━━━━━━━━

R14の目的は、

R11
Webhook durable receipt

↓

R12
Reconciliation / Provider Truth

↓

R13
Transactional Business Projection

を、isolated development environmentで実際に接続し、
Productionへ進む前のE2E acceptanceを行うこと。

Production activationではない。

実顧客データは使用しない。

synthetic dataだけ使用する。

━━━━━━━━━━━━━━━━━━
3. AUTHORITY RECORD FIRST
━━━━━━━━━━━━━━━━━━

最初に作成:

docs/execution/PRODUCTION_P6_R14_ACTIVATION_AUTHORITY.md

必要最小限更新:

AGENTS.md
CLAUDE.md
docs/execution/SCOPE.md
docs/execution/PRODUCTION_P6_STATUS.json

R4〜R13のhistorical evidenceは変更しない。

authority commit:

docs(p6): authorize bounded development activation E2E

をcanonical branchへ通常pushし、
remote readbackする。

私はOwnerとして、
R14で生成されるコード・テスト・文書・safe evidenceを
ginisato-hash/zao-rental の
codex/external-acceptance-p6
へ通常pushすることも明示承認する。

force pushは禁止。

━━━━━━━━━━━━━━━━━━
4. EXECUTION PHASES
━━━━━━━━━━━━━━━━━━

順序:

A.
Real PostgreSQL acceptance

B.
least-privilege runtime roles

C.
runtime composition

D.
bounded Preview / ingress preparation

E.
live Sandbox webhook acceptance

F.
provider reconciliation acceptance

G.
R13 synthetic business projection acceptance

H.
evidence + cleanup / retention

前段がBLOCKしても、
独立して実行可能な後続local/DB検証は可能な限り続ける。

不要にOwner待ちで全体停止しない。

━━━━━━━━━━━━━━━━━━
5. DEVELOPMENT DATABASE — OWNER AUTHORITY
━━━━━━━━━━━━━━━━━━

R14では、
ZAO Rental専用のisolated development PostgreSQLを
1つだけ使用することを承認する。

優先順位:

1.
既に存在する明確にdevelopment専用と確認できるZAO Rental DB

2.
既存の承認済みprovider/account内で、
billing/permission expansionなしに作成できる
isolated development PostgreSQL

3.
上記が存在しない場合、
local ephemeral PostgreSQLで実DB acceptanceを完了する

新しい有料provider契約、
billing増額、
organization permission拡張、
Production DB利用は承認しない。

新provider選定や課金同意が必要なら、
そのcloud provisioningだけ
BLOCKED_EXTERNAL_DB_PROVISIONING
として止める。

ただしlocal real PostgreSQL acceptanceは続行する。

━━━━━━━━━━━━━━━━━━
6. DATABASE ISOLATION
━━━━━━━━━━━━━━━━━━

development DBは:

Production data:
0

real customer:
0

real employee:
0

real booking:
0

real inventory:
0

synthetic data only

とする。

DB名/schema/roleには
development/sandboxであることが分かる命名を使う。

Production DB URLを推測・探索しない。

Production credentialを使用しない。

━━━━━━━━━━━━━━━━━━
7. MIGRATION APPLICATION
━━━━━━━━━━━━━━━━━━

実DBの現在schema versionを確認。

DBがemptyなら:

0001
↓
...
↓
0027

を正規migration順で全適用。

既にverified 0024まで適用済みなら:

0025
0026
0027

のみ追加。

migrationをskipしない。

既存migrationを編集しない。

適用前にhashを記録。

適用後に:

tables
constraints
indexes
functions
triggers
privileges

をsafe metadataでreadback。

DROPやdestructive rollbackは禁止。

━━━━━━━━━━━━━━━━━━
8. ACTUAL POSTGRESQL ACCEPTANCE
━━━━━━━━━━━━━━━━━━

fixtureだけではなく、
実PostgreSQLで最低限以下を検証する。

R11:

duplicate same event/hash

same event/different hash conflict

DB write failure

ACK durability prerequisite

dispatcher link durability

R12:

2 concurrent dispatchers

2 concurrent workers

single valid lease

lease expiry

stale lease finalization rejection

process/connection interruption

retry state

attempt ceiling

24h cutoff

auth/quota stop semantics

new event while job active

terminal/new generation semantics

R13:

2 concurrent projectors

projection duplicate

COMMIT response-loss replay

stale revision rejection

expired HOLD

due_at exact boundary

missing inventory claim

missing wear claim

transfer_attention

transfer cancellation/problem

price snapshot mismatch

payment identity mismatch

transaction rollback

history/audit exactly-once behavior

実DB結果をfixture結果と明確に分離して記録。

━━━━━━━━━━━━━━━━━━
9. LEAST PRIVILEGE
━━━━━━━━━━━━━━━━━━

migration owner credentialを
runtimeへ渡さない。

実schemaを確認後、
必要最小限のruntime rolesを作成してよい。

役割は実装に合わせて最小化する。

概念的には:

webhook receiver:
receive/insert only

dispatcher:
undispatched receipt → job signal only

reconciliation worker:
claim / context read / finalize only

projection worker:
approved projection transactionに必要な最小権限のみ

diagnostic:
read-only

とする。

GRANT ALL禁止。

PUBLIC権限を増やさない。

guest/public runtimeから内部payment identifiersを
読める権限を与えない。

SECURITY DEFINER functionのowner/search_path/EXECUTEを検証する。

━━━━━━━━━━━━━━━━━━
10. PRIVILEGE NEGATIVE TESTS
━━━━━━━━━━━━━━━━━━

各runtime roleについて、

許可操作が通る

かつ

禁止操作が拒否される

ことを実DBで証明。

最低限:

receiver cannot mutate booking

receiver cannot mutate inventory

receiver cannot execute projection

dispatcher cannot alter business state

reconciliation worker cannot arbitrary-write booking

diagnostic cannot write

public cannot access internal inbox/job/projection tables/functions

migration owner secret is not exposed to runtime

を確認する。

━━━━━━━━━━━━━━━━━━
11. RUNTIME COMPOSITION
━━━━━━━━━━━━━━━━━━

R11 receiver
R12 dispatcher/worker
R13 projection

をdevelopment-only compositionとして接続する。

ただし:

Production composition:
0

Production env:
0

Production route activation:
0

R12 RECONCILEDだけでbooking confirmationしない。

R13 projectionが成功した場合だけ
synthetic booking stateが変わる。

━━━━━━━━━━━━━━━━━━
12. SYNTHETIC BUSINESS FIXTURE
━━━━━━━━━━━━━━━━━━

development DBへ
完全synthetic booking flowを1件作ってよい。

実在customer情報禁止。

contact:

example.invalid等のsynthetic値。

synthetic fixtureには:

quote

HOLD

required gear/wear claims

booking

payment attempt

merchant/location binding

price snapshot

idempotency identity

を整合させる。

amountは:

100 JPY

を使用してよい。

R13 projectionを通せるvalid pathと、
expired HOLD / inventory driftのcounterexampleを
別synthetic transactionで検証してよい。

━━━━━━━━━━━━━━━━━━
13. NEW SANDBOX PAYMENT — CONDITIONAL AUTHORITY
━━━━━━━━━━━━━━━━━━

full live E2E webhook acceptanceのために必要な場合のみ、
Square Sandboxへ新しいsynthetic paymentを
exactly 1 logical payment作成することを承認する。

これは実カード・実売上ではない。

amount:

100 JPY

currency:

JPY

source:

Square公式Sandbox fixed test source
cnon:card-nonce-ok

merchant:

MLKDVEDH1ME21

location:

既存verified Sandbox location

Production:
0

real card:
0

real customer:
0

CreatePayment:
最大1

automatic retry:
0

manual retry:
0

新しいidempotency keyを1つ生成し、
manifestへ固定する。

dispatch前にdurable/local one-shot guardを確定。

UNKNOWN時は再POST禁止。

既存S2 paymentを再送しない。

R10 refundには触らない。

公式Square webhook test deliveryだけで
必要なlive acceptanceを満たせる場合は、
新CreatePaymentは0のままでよい。

不要なpaymentは作成しない。

━━━━━━━━━━━━━━━━━━
14. NEW PAYMENT MANIFEST
━━━━━━━━━━━━━━━━━━

CreatePaymentが必要な場合は、
provider dispatch前に:

docs/execution/p6/r14-evidence/payment-operation-manifest.json

をcommit/push/readback。

固定:

operationId

booking/reference ID

payment attempt ID

idempotency key

100 JPY

JPY

merchant

location env binding

Sandbox source kind

Square-Version 2026-08-19

CreatePayment max1

retry0

Production false

manifest commit後identity変更禁止。

━━━━━━━━━━━━━━━━━━
15. VERCEL AUTH / LOGIN POLICY
━━━━━━━━━━━━━━━━━━

まず現在の非対話Vercel sessionを利用できるか
secret-free metadata操作だけで確認。

認証が有効ならそのまま使用。

vercel loginを先に開始しない。

browser loginが本当に必要になった場合のみ
Ownerへ1回だけ依頼してよい。

login中は:

raw URL取得禁止

page title取得禁止

accessibility snapshot禁止

query/fragment取得禁止

Cookie/token/storage/auth header取得禁止

Ownerがtarget applicationへ到達した後のみ
automation observationを開始。

R7 incidentを再発させない。

━━━━━━━━━━━━━━━━━━
16. VERCEL PREVIEW BUDGET
━━━━━━━━━━━━━━━━━━

R14で新規Previewは最大2件まで承認する。

理由:

webhook notification URL
+
signature key/env
のsequencingでredeployが必要になる可能性があるため。

通常は1件を優先。

第2Previewは、
signature/env反映のため技術的に必要な場合のみ。

Production deployment:
0

Production alias:
0

Production domain:
0

Production env mutation:
0

accepted R3 historical Previewは
不要に削除しない。

━━━━━━━━━━━━━━━━━━
17. PREVIEW ENV MUTATION AUTHORITY
━━━━━━━━━━━━━━━━━━

Preview environmentだけに、
R14 runtimeで必要なkeyを追加・更新してよい。

既存Square Sandbox keysは値を読まない。

許可対象は必要最小限:

SQUARE_SANDBOX_NOTIFICATION_URL

SQUARE_SANDBOX_WEBHOOK_SIGNATURE_KEY

development DB runtime credentials / role-specific connection metadata

および実装が既に要求している
明確なdevelopment-only key。

Production target:
0

env pull:
禁止

secret dump:
禁止

secret値Git保存:
禁止

secret値chat/log:
禁止

metadata readbackのみ保存。

━━━━━━━━━━━━━━━━━━
18. MACHINE WEBHOOK INGRESS — CRITICAL
━━━━━━━━━━━━━━━━━━

Square webhookはmachine-to-machine ingressなので、
Owner browser loginを要求するURLでは受信できない。

CodexはVercelの現在の公式機能と
project protection設定を確認し、

一般ユーザー向けPreview protectionを維持しながら
/webhooks/square だけを安全にmachine ingressできる
documented方式が存在する場合のみ使用する。

禁止:

Deployment Protectionの全面解除

secretをnotification URL queryへ埋め込む

公開bypass token URL

Productionへ逃がす

custom domainを勝手に本番routing

非公式hack

認証Cookieの抽出

もし現在のVercel構成で
安全なroute-level/machine ingressが実現できない場合:

BLOCKED_PROTECTED_WEBHOOK_INGRESS

と分類。

Square subscriptionは作らない。

ただしDB acceptance・runtime composition・provider adapter acceptance等、
独立して進められる工程は続行する。

新relay providerを勝手に契約しない。

━━━━━━━━━━━━━━━━━━
19. SQUARE WEBHOOK SUBSCRIPTION BUDGET
━━━━━━━━━━━━━━━━━━

safe machine ingressが成立した場合のみ:

Square Sandbox webhook subscription:
最大1 create

event scope:

payment.created
payment.updated

notification URL:
exact approved Sandbox receiver URL

Production subscription:
0

必要な場合のみ:

subscription update:
最大1

duplicate subscription:
0

delete/recreate loop:
禁止

signature keyはPreview secretへ保存。

値を表示・Git保存しない。

━━━━━━━━━━━━━━━━━━
20. LIVE WEBHOOK ACCEPTANCE
━━━━━━━━━━━━━━━━━━

実Webhook deliveryを最大2件まで承認する。

目的:

1.
valid signed delivery

2.
必要であればduplicate/re-deliveryまたはpayment.updated

provider側のofficial test deliveryまたは
上記exactly-one Sandbox paymentによる自然deliveryを使用。

受信側で確認:

signature PASS

merchant exact

supported event

durable inbox insert

ACK 2xx only after durable insert

raw body not persisted

signature not persisted

duplicate safety

job/link durability

SquareへのACK後に
同期provider lookupをreceiver内で実行しない。

━━━━━━━━━━━━━━━━━━
21. REAL RECONCILIATION PROVIDER CALL BUDGET
━━━━━━━━━━━━━━━━━━

live E2E対象paymentについて:

GetPayment:
最大2 total

原則1回。

2回目は、

R12のretryable provider truth pathを
意図的に検証するためではなく、

明確なnonterminal状態で
authority内で安全にterminal確認が必要な場合のみ。

green確認目的の重複GETは禁止。

CreatePayment:
条件付き最大1

Refund:
0

GetRefund:
0

S1:
0

Orders:
0

Customers:
0

Catalog:
0

Production:
0

━━━━━━━━━━━━━━━━━━
22. PROVIDER TRUTH PASS CONDITIONS
━━━━━━━━━━━━━━━━━━

actual GetPaymentでは
HTTP成功だけでPASSにしない。

必須:

providerId exact

reference exact synthetic booking

merchant authority exact

location exact

amount 100

currency JPY

status valid

updatedAt valid

COMPLETEDの場合completedAt valid

PaymentObservationへsafe parse。

matchPayment相当の既存contractを必ず通す。

raw provider bodyはGit保存しない。

━━━━━━━━━━━━━━━━━━
23. R12 LIVE WORKER ACCEPTANCE
━━━━━━━━━━━━━━━━━━

finite workerだけ実行。

cron:
0

daemon:
0

Runner:
0

batch size:
最小

対象:
R14 synthetic paymentのみ

worker claim:
bounded

attempt:
authority内のみ

provider truth取得後:

R12 decision

job finalize

を確認。

auth/quota stopが発生した場合は
別jobへ無制限に続けない。

background workerを残さない。

━━━━━━━━━━━━━━━━━━
24. R13 LIVE SYNTHETIC PROJECTION
━━━━━━━━━━━━━━━━━━

R13 business projectionは
R14 synthetic bookingだけを対象に
development DBで実行してよい。

必須:

accepted provider truth

identity exact

price snapshot valid

HOLD valid

claims valid

transfer safe

revision current

projection dedupe clear

の場合のみprojection。

成功時:

synthetic bookingの
既存contract上の正しいstate transitionを確認。

history/audit/projection receipt:
exactly once。

実顧客予約:
0

real inventory:
0

real custody:
0

━━━━━━━━━━━━━━━━━━
25. BUSINESS NEGATIVE ACCEPTANCE
━━━━━━━━━━━━━━━━━━

同じdevelopment DBで
provider HTTPを増やさず、
synthetic observations/fixturesを用いて
以下を実DB transactionで確認:

COMPLETED + expired HOLD
→ booking confirmation禁止

COMPLETED + missing claim
→ confirmation禁止

COMPLETED + transfer problem
→ confirmation禁止

COMPLETED + price mismatch
→ confirmation禁止

duplicate accepted observation
→ side effect exactly once

COMMIT response-loss replay
→ duplicate projectionなし

自動refund:
0

inventory resurrection:
0

new HOLD:
0

━━━━━━━━━━━━━━━━━━
26. WEBHOOK ↔ JOB ↔ PROJECTION E2E
━━━━━━━━━━━━━━━━━━

可能な場合、
1つのsynthetic acceptance chainとして:

Square event
↓
R11 inbox
↓
dispatcher/job
↓
R12 claim
↓
GetPayment
↓
truth decision
↓
R13 projection
↓
synthetic booking terminal state

までを証拠化する。

各段階のID/fingerprint/revisionをsafe evidenceで紐付ける。

raw secret/bodyを保存しない。

━━━━━━━━━━━━━━━━━━
27. FAILURE CLASSIFICATION
━━━━━━━━━━━━━━━━━━

明確なclassificationを使用。

例:

R14_PASS

BLOCKED_EXTERNAL_DB_PROVISIONING

BLOCKED_DB_MIGRATION

BLOCKED_DB_PRIVILEGE

BLOCKED_VERCEL_LOGIN

BLOCKED_PROTECTED_WEBHOOK_INGRESS

BLOCKED_SQUARE_SUBSCRIPTION

BLOCKED_WEBHOOK_DELIVERY

BLOCKED_PROVIDER_TRUTH

BLOCKED_BUSINESS_PROJECTION

UNKNOWN_DO_NOT_RETRY

名称は実装conventionに合わせてよい。

一つのsub-gateがBLOCKしても
独立して完了可能なacceptanceは続ける。

━━━━━━━━━━━━━━━━━━
28. UNKNOWN / RETRY RULE
━━━━━━━━━━━━━━━━━━

金融write:

CreatePayment

はUNKNOWN時再送禁止。

新key禁止。

別Previewで再請求禁止。

Webhook subscription操作は
result unknown時に
無条件createを繰り返さない。

まずread-only metadataで既存状態を確認。

DB migration COMMIT outcome unknown時も
同migrationを盲目的に再実行せず、
schema metadataから適用状態を判定。

━━━━━━━━━━━━━━━━━━
29. SECURITY
━━━━━━━━━━━━━━━━━━

禁止保存:

Square access token

webhook signature key

Authorization

Cookie

Vercel auth data

DB passwords

raw webhook body

raw provider response

card data

real customer PII

保存可:

provider/payment/event/job IDs

hash/fingerprint

HTTP status

provider status

DB role names

migration hashes

state transitions

timestamps

safe classifications

━━━━━━━━━━━━━━━━━━
30. VALIDATION BEFORE EXTERNAL ACTIVATION
━━━━━━━━━━━━━━━━━━

外部操作前に:

existing 491+ regression

R11 tests

R12 tests

R13 tests

DB integration tests

secret scan

lint

typecheck

build

をgreenにする。

実装追加に伴いtest数が増えるのは可。

既存testを減らさない。

━━━━━━━━━━━━━━━━━━
31. VALIDATION AFTER E2E
━━━━━━━━━━━━━━━━━━

E2E後:

targeted regression

full relevant suite

secret scan

lint

typecheck

build

を再実行。

runtime/background child processを全終了。

DB connection leakなし。

browser close。

temporary local server終了。

━━━━━━━━━━━━━━━━━━
32. RESOURCE RETENTION / CLEANUP
━━━━━━━━━━━━━━━━━━

R14 acceptance専用temporary Previewは
evidence remote保存後に削除してよい。

temporary Square webhook subscriptionも
acceptance-onlyなら削除してよい。

ただし削除前に:

result commit
push
remote readback

を完了。

isolated development DBは、
今後のdevelopment activationに使えるよう
安全なら保持してよい。

保持条件:

development only

synthetic only

no production credential

least privilege

documented owner

もし完全temporary DBなら削除してもよいが、
audit/evidenceをGitHubに先に保存。

━━━━━━━━━━━━━━━━━━
33. DO NOT AUTO-CLEAN PROVIDER PAYMENT
━━━━━━━━━━━━━━━━━━

R14で新Sandbox paymentを作成した場合、
cleanup目的のrefundは送らない。

Refund:
0

R10 pending refund:
触らない。

Sandbox paymentはevidenceとして保持。

━━━━━━━━━━━━━━━━━━
34. GITHUB EVIDENCE
━━━━━━━━━━━━━━━━━━

作成:

docs/execution/p6/r14-evidence/

最低限:

authority/readback

source manifest

migration hashes

DB metadata summary

role/grant summary

real DB test result

Preview metadata

webhook subscription safe metadata

webhook delivery safe result

provider truth safe result

worker result

projection result

cleanup/retention

owned resource closure

FINAL_RESULT.md

raw secretsなし。

━━━━━━━━━━━━━━━━━━
35. ACTIVATION RESULT
━━━━━━━━━━━━━━━━━━

R14_PASS条件:

real PostgreSQL migrations accepted

least privilege accepted

receiver durable ACK accepted

live Sandbox webhook accepted

R12 real provider truth accepted

R13 synthetic development projection accepted

no prohibited external action

security exposure0

Production0

全て満たすこと。

部分成功の場合は
R14_PARTIAL / exact blocker
として正確に残す。

無理にPASS化しない。

━━━━━━━━━━━━━━━━━━
36. PRODUCTION STILL FORBIDDEN
━━━━━━━━━━━━━━━━━━

R14_PASSでも以下は未承認:

Production deploy

Production Square credentials

Production webhook

real card

real customer booking

real inventory mutation

real custody mutation

live staff operations

email/SMS production delivery

main merge

Runner/cron permanent enable

Production DB

━━━━━━━━━━━━━━━━━━
37. NEXT GATE
━━━━━━━━━━━━━━━━━━

R14_PASS時に:

docs/execution/PRODUCTION_P7_GATE.md

または現行phase namingに沿う
次のproduction-readiness gateを作成。

内容:

development E2E evidence

remaining Web Payments SDK/tokenization

production database architecture

backup/PITR

secret lifecycle

production merchant/location mapping

observability/alerts

operational recovery

load/performance

security review

rollout/rollback

を整理。

ただしP7 executionはしない。

━━━━━━━━━━━━━━━━━━
38. AUTONOMY POLICY
━━━━━━━━━━━━━━━━━━

以下でOwnerへ逐次確認しない:

code changes

tests

migration test setup

local Postgres setup

role names

grant details

fixture data

Preview deploy

Preview env metadata

Square subscription create

subscription update

official test delivery

conditional one Sandbox payment

GetPayment

finite worker execution

synthetic projection

evidence

cleanup

Git commits

Git push

ただしこのauthorityで明示した上限を超えてはならない。

━━━━━━━━━━━━━━━━━━
39. OWNER STOP CONDITIONS
━━━━━━━━━━━━━━━━━━

Ownerへ停止・質問してよいのは:

password/MFA/loginが実際に必要

新しい有料provider契約が必要

billing増額が必要

organization permission expansionが必要

新provider選択というarchitecture decisionが必要

Production resourceしか利用できない

remote writer conflict

protection-compatible webhook ingressが
新しい外部relay/providerなしでは不可能

scope外不可逆操作が必要

のみ。

それ以外のrecoverable issueは自律解決。

━━━━━━━━━━━━━━━━━━
40. FINAL REPORT
━━━━━━━━━━━━━━━━━━

完了時のみまとめて報告。

必須:

Starting HEAD

Authority commit

Implementation/activation commits

Final HEAD

working tree

DB:
provider/local classification
migration range
real DB acceptance
roles
least privilege

Preview:
count
IDs
protection
deleted/retained

Webhook:
subscription count
delivery count
signature
ACK
durable inbox
dedupe

Payment:
CreatePayment count
GetPayment count
payment ID
100 JPY
status
retry

R12:
job
claim
provider truth
decision
finalize

R13:
projection
synthetic booking result
history/audit
negative cases

Security:
secret exposure
auth callback exposure

External counts:
refund0
R10 lookup0
Production0
real customer0
real inventory0
real custody0

Validation:
test count
secret scan
lint
typecheck
build

classification:
R14_PASS
またはexact partial/blocker

next gate:
path

Owner next action:
production-readiness authority
またはexact blocker resolution

のみ。

━━━━━━━━━━━━━━━━━━
41. FINAL OWNER CONFIRMATION
━━━━━━━━━━━━━━━━━━

私はOwnerとして、

ginisato-hash/zao-rental
codex/external-acceptance-p6

の starting HEAD
d0a1f66b8cfa97ad1b5e5bd06f409e056604cf0a

から開始する上記R14を正式に承認する。

特に、

isolated development PostgreSQLでの実migration/test、

development-only least-privilege role作成、

Preview最大2件、

Preview-only必要env設定、

安全なmachine webhook ingressが成立する場合の
Square Sandbox webhook subscription最大1件、

subscription update最大1件、

live webhook delivery最大2件、

条件付きSquare Sandbox synthetic CreatePayment最大1件、

GetPayment最大2件、

finite R12 worker、

synthetic R13 business projection、

safe evidence保存、

temporary resource cleanup、

およびR14成果一式の
codex/external-acceptance-p6への通常push

を明示承認する。

Refund、
R10 refund follow-up、
Production、
real customer/card/inventory/custody、
main mergeは承認しない。

安全境界内では不要に停止せず、
R14を可能な範囲で最後まで自立実行すること。