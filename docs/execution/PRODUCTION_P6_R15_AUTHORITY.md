【ZAO Rental｜正式Owner Authority
P6 R15 — Dedicated Sandbox Webhook Ingress + Hosted Dev Postgres + Live E2E Continuation】

私はOwnerとして、このR15 authorityを正式に採用する。

これは提案・Draftではなく実行指示である。

R14_PARTIALの残ブロッカーを解消するため、
以下の限定範囲で、

- 専用Sandbox webhook ingress projectの実装・作成・deploy
- development専用Hosted PostgreSQLのprovision/configuration
- 0001〜0029のmigration適用
- least-privilege role構成
- Square Sandbox webhook subscription
- live webhook delivery
- 条件付きsynthetic Sandbox payment 1件
- R11 → R12 → R13 E2E acceptance
- safe evidence保存
- cleanup
- GitHub commit/push/readback

を明示承認する。

安全境界内ではCodex parentが不要な中間Owner確認をせず、自立実行する。

━━━━━━━━━━━━━━━━━━
0. SOURCE OF TRUTH
━━━━━━━━━━━━━━━━━━

repo:

ginisato-hash/zao-rental

canonical branch:

codex/external-acceptance-p6

expected starting remote HEAD:

dffa78c10825fdb44bd7cb123c2b8b2b4e2113c9

main:

3061dbbbe00294e5baebba2405028c907d6e6e85

開始時:

git fetch origin --prune
git rev-parse HEAD
git rev-parse origin/codex/external-acceptance-p6
git rev-parse origin/main
git status --short --branch

を確認。

remote advance時はforce/reset禁止。
unknown local workを破壊しない。

━━━━━━━━━━━━━━━━━━
1. R14 RESULT IS HISTORICAL
━━━━━━━━━━━━━━━━━━

R14:

R14_PARTIAL

を保持。

R14で成立済み:

local isolated PostgreSQL

0001〜0029 migration success

28 real DB checks

495 regression tests

least privilege fixture/real DB checks

R11 receiver

R12 worker/truth engine

R13 projection

R14のblocker:

BLOCKED_PROTECTED_WEBHOOK_INGRESS

BLOCKED_VERCEL_LOGIN

BLOCKED_EXTERNAL_DB_PROVISIONING

をR15で解消する。

R10 refund:

LAST_OBSERVED_PENDING
S3_NONTERMINAL_DO_NOT_RETRY

は完全にnon-gating historical state。

R15では:

GetRefund 0
Refund POST 0

━━━━━━━━━━━━━━━━━━
2. ARCHITECTURE DECISION — FIXED BY OWNER
━━━━━━━━━━━━━━━━━━

main ZAO Rental project:

zao-rental

のDeployment Protectionは変更しない。

Webhook machine ingressは別projectへ分離する。

新Vercel project:

zao-rental-webhook-sandbox

を作成してよい。

これは:

Square Sandbox専用
development acceptance専用
non-customer-facing
non-production-business

のmachine ingress project。

main appではない。

━━━━━━━━━━━━━━━━━━
3. DEDICATED INGRESS APP
━━━━━━━━━━━━━━━━━━

repo内に専用deployable appを追加してよい。

推奨:

apps/webhook-ingress

責務は極小化する。

許可route:

POST /api/webhooks/square

任意で:

GET /health

のみ。

その他:

404 / 405

UI:
0

customer page:
0

admin page:
0

booking route:
0

Square CreatePayment:
0

Square GetPayment:
0

refund:
0

worker:
0

business projection:
0

━━━━━━━━━━━━━━━━━━
4. PUBLICNESS / PROTECTION MODEL
━━━━━━━━━━━━━━━━━━

専用project:

zao-rental-webhook-sandbox

はStandard Protectionを使用する。

Preview/deployment URLsは保護。

Webhookの安定公開URLとして、
この専用projectのproduction domainのみ使用してよい。

例:

https://zao-rental-webhook-sandbox.vercel.app/api/webhooks/square

ここでいうVercel target=productionは、

ZAO Rental本番稼働

を意味しない。

明確に:

SANDBOX_WEBHOOK_INGRESS_ONLY

として扱う。

このproduction targetに:

Square Production credential
real customer
real booking
real inventory
main application UI

を置くことは禁止。

main `zao-rental` projectのProduction deployは0。

━━━━━━━━━━━━━━━━━━
5. INGRESS PROJECT SECRETS
━━━━━━━━━━━━━━━━━━

専用ingress projectへ置いてよいsecretは必要最小限。

許可:

SQUARE_SANDBOX_WEBHOOK_SIGNATURE_KEY

SQUARE_SANDBOX_NOTIFICATION_URL

merchant ID metadata

development DB receiver role connection credential

禁止:

SQUARE_SANDBOX_ACCESS_TOKEN

Square Production access token

main app auth secrets

customer auth secrets

staff auth secrets

refund/payment write credential

つまりpublic ingressが侵害されても
Square payment APIを呼べない構成にする。

━━━━━━━━━━━━━━━━━━
6. HOSTED DEVELOPMENT POSTGRES — FIXED CHOICE
━━━━━━━━━━━━━━━━━━

Hosted development PostgreSQLは:

Neon

を第一選択とする。

Vercel Marketplace native Neon integrationを
優先して使用してよい。

用途:

ZAO Rental development / Sandbox E2E only。

resource namingには:

zao-rental
sandbox
development

の意味を入れる。

Production DB:
禁止。

real data:
禁止。

━━━━━━━━━━━━━━━━━━
7. COST BOUNDARY
━━━━━━━━━━━━━━━━━━

Neonの$0/free planまたは、
追加課金を伴わない既存Vercel plan範囲のみ承認する。

paid upgrade:

禁止。

billing consent:

禁止。

有料プランしか選べない、
または請求確定操作が必要なら:

BLOCKED_BILLING_APPROVAL

としてその工程のみ停止。

他local作業を止めない。

━━━━━━━━━━━━━━━━━━
8. LOGIN POLICY
━━━━━━━━━━━━━━━━━━

まず既存の非対話認証を確認。

Vercel/Marketplaceが既存sessionで利用可能ならそのまま続行。

loginが必要な場合のみ
Ownerへ1回だけ通常loginを依頼してよい。

password/MFA以外の確認は不要。

login中:

raw URL取得禁止

callback URL取得禁止

page title取得禁止

accessibility snapshot禁止

query/fragment取得禁止

Cookie/token/storage/auth header取得禁止

OwnerがVercel application dashboardへ到達後に自律再開。

Neonが別loginを要求する場合も同様。

━━━━━━━━━━━━━━━━━━
9. HOSTED DB PROVISIONING
━━━━━━━━━━━━━━━━━━

Hosted Neon development DBを最大1resource作成してよい。

migration owner credentialを
runtime credentialとして使わない。

Hosted DBへ:

0001
↓
...
↓
0029

を正規順序で適用。

R14開始前migrationを編集しない。

R14で追加済み0028/0029も含める。

migration hashをGitHub evidenceと照合。

━━━━━━━━━━━━━━━━━━
10. SECRET HANDLING FOR DB SETUP
━━━━━━━━━━━━━━━━━━

DB credentialを:

chat
Git
terminal output
logs
evidence

へ表示しない。

provider/CLIからsecretを利用する際は、
stdoutへ出さずprocess内で消費する。

どうしてもlocal temporary secret stagingが必要な場合のみ:

repo外

chmod 600

git対象外

専用temporary path

へ短時間保存してよい。

cat/head/grep等で値を表示しない。

作業完了後削除。

secret file pathだけは記録可。

secret valueは記録不可。

━━━━━━━━━━━━━━━━━━
11. HOSTED DB ROLES
━━━━━━━━━━━━━━━━━━

R14で検証したleast-privilege modelをHosted DBへ再現する。

最低限役割:

migration owner

receiver role

dispatcher role

reconciliation worker role

projection role

diagnostic read-only role

各credential分離。

receiver:

Webhook inbox insertに必要な最小権限だけ。

dispatcher:

receipt → job signalのみ。

worker:

claim / context read / truth finalizeのみ。

projector:

projection transactionの必要最小権限。

diagnostic:

read-only。

GRANT ALL禁止。

PUBLIC権限を増やさない。

━━━━━━━━━━━━━━━━━━
12. ROLE NEGATIVE TEST
━━━━━━━━━━━━━━━━━━

Hosted DB上でも最低限確認:

receiver cannot update booking

receiver cannot mutate inventory

receiver cannot projection

dispatcher cannot mutate booking

worker cannot arbitrary mutate booking/inventory

projector cannot mutate R12 job internals except approved interface

diagnostic cannot write

PUBLIC cannot read internal payment tables

migration owner credential not used at runtime

━━━━━━━━━━━━━━━━━━
13. INGRESS APP DB CONFIG
━━━━━━━━━━━━━━━━━━

ingress projectには:

receiver role DB URL

だけ設定。

migration owner:
禁止。

worker role:
禁止。

projection role:
禁止。

DB credentialはdedicated ingress projectの
Vercel secret envにのみ置く。

target:

production
on zao-rental-webhook-sandbox only

━━━━━━━━━━━━━━━━━━
14. MAIN ZAO-RENTAL DB CONFIG
━━━━━━━━━━━━━━━━━━

existing main project:

zao-rental

にはPreview-onlyで必要な:

dispatcher DB role

worker DB role

projection DB role

diagnostic role

を設定してよい。

Production env:
0。

既存Square Sandbox Preview secretを
抽出・表示しない。

existing valuesを維持。

main projectのDeployment Protectionも維持。

━━━━━━━━━━━━━━━━━━
15. INGRESS DEPLOY SEQUENCE
━━━━━━━━━━━━━━━━━━

dedicated ingress project deploy最大:

2

1st deploy:

signature key未設定でも
fail-closedできるreceiverをdeployment。

stable production domainをverify。

notification URLをexact固定。

この時点では有効Webhook受信をPASS扱いしない。

Square subscription作成後にsignature keyを設定。

2nd deploy:

signature keyがruntimeに反映された
exact final ingress source。

stable production domainは同じURLを維持。

main application production deploy:
0

━━━━━━━━━━━━━━━━━━
16. SQUARE SUBSCRIPTION
━━━━━━━━━━━━━━━━━━

stable HTTPS ingress URL確認後のみ、

Square Sandbox webhook subscriptionを最大1件作成してよい。

environment:

SANDBOX

events:

payment.created
payment.updated

API version:

2026-08-19

notification URL:

exact dedicated ingress stable URL

Production subscription:
0。

subscription create resultから得た
signature keyをingress project secretへ設定。

値は表示・保存しない。

subscription duplicate:
0。

━━━━━━━━━━━━━━━━━━
17. SUBSCRIPTION UPDATE
━━━━━━━━━━━━━━━━━━

stable URL方式を採用するため、
通常subscription updateは0を期待。

技術的に必要な場合のみ:

update最大1

を許可。

delete/recreate loop禁止。

result unknown時に
createを繰り返さない。

read-only metadataで状態確認してから判断。

━━━━━━━━━━━━━━━━━━
18. LIVE TEST WEBHOOK
━━━━━━━━━━━━━━━━━━

Squareのofficial Sandbox test deliveryが利用可能なら、
最大1 deliveryを実行してよい。

目的:

HTTPS reachability

HMAC validation

merchant validation

durable DB insert

2xx ACK after COMMIT

raw body non-persistence

signature non-persistence

を確認。

test deliveryのevent/payment IDが
実Payment APIでlookup不能なsynthetic値なら、
R12 provider truth E2Eには使わない。

receiver acceptanceだけに使う。

━━━━━━━━━━━━━━━━━━
19. SYNTHETIC HOSTED BOOKING FIXTURE
━━━━━━━━━━━━━━━━━━

Hosted DB上に完全synthetic booking flowを1件作成してよい。

実顧客情報:
0

example.invalid使用可。

100 JPY

valid quote

valid HOLD

valid inventory/wear claims

safe transfer state

booking

payment attempt

merchant/location binding

を整合させる。

booking/reference IDは
new payment manifestへ固定。

━━━━━━━━━━━━━━━━━━
20. NEW PAYMENT AUTHORITY
━━━━━━━━━━━━━━━━━━

full live E2Eに必要な場合のみ、
Square Sandbox CreatePaymentを
exactly 1 logical payment承認する。

amount:

100 JPY

currency:

JPY

source:

cnon:card-nonce-ok

merchant:

MLKDVEDH1ME21

location:

existing verified Sandbox location

autocomplete:

true

CreatePayment max:
1

retry:
0

real card:
0

real customer:
0

Production:
0

R9 paymentを再利用しない。

R10 refund対象paymentを再利用しない。

━━━━━━━━━━━━━━━━━━
21. PAYMENT MANIFEST
━━━━━━━━━━━━━━━━━━

dispatch前に:

docs/execution/p6/r15-evidence/payment-operation-manifest.json

へ固定。

最低限:

operationId

bookingId

attemptId

idempotencyKey

100 JPY

JPY

merchantId

location env binding

source kind

apiVersion

CreatePayment max1

retry0

Production false

commit/push/readback後のみdispatch。

━━━━━━━━━━━━━━━━━━
22. PAYMENT ONE-SHOT
━━━━━━━━━━━━━━━━━━

CreatePayment dispatch前に
exclusive/fsynced local guardを確定。

automatic retry:
0

manual retry:
0

別key:
0

別payment:
0

UNKNOWN:
DO_NOT_RETRY

同一logical paymentをgreen確認目的で再送しない。

━━━━━━━━━━━━━━━━━━
23. WEBHOOK NATURAL DELIVERY
━━━━━━━━━━━━━━━━━━

CreatePayment後は
Squareからの自然Webhook deliveryを待つ。

Square event deliveryを
provider truthとして扱わない。

確認:

payment.created / payment.updated

signature valid

merchant valid

event persisted

job signal created

ACK 2xx

同じpaymentに複数eventが来ても
R12 coalescing contractを維持。

━━━━━━━━━━━━━━━━━━
24. HOSTED DB POLLING
━━━━━━━━━━━━━━━━━━

Webhook到着確認は
diagnostic read-only roleで行ってよい。

provider callではない。

bounded polling:

最大60秒

2〜3秒間隔

程度。

raw webhook body:
取得禁止。

event ID / payment ID / stateだけ確認。

到着しなければ:

BLOCKED_WEBHOOK_DELIVERY

としてprovider paymentを再作成しない。

━━━━━━━━━━━━━━━━━━
25. MAIN PROTECTED PREVIEW
━━━━━━━━━━━━━━━━━━

existing main project `zao-rental` に
R15 worker acceptance用protected Previewを最大1件作成してよい。

Standard Protection維持。

target:

Preview

Square Sandbox only。

temporary internal acceptance routesだけ追加可。

public webhook routeはmain projectでは使用しない。

Owner browser loginが必要な場合のみ依頼。

━━━━━━━━━━━━━━━━━━
26. WORKER INVOCATION
━━━━━━━━━━━━━━━━━━

Webhook receiptがHosted DBに確認できた後のみ、

protected main Previewから
finite R12 workerを1回実行。

対象:

R15 synthetic payment jobのみ。

worker batch:

1

provider GetPayment max:

1

通常成功時:
1

retry:
0

cron:
0

daemon:
0

background Runner:
0

━━━━━━━━━━━━━━━━━━
27. PROVIDER TRUTH
━━━━━━━━━━━━━━━━━━

GetPayment結果は必ず既存safe contractで検証。

必須:

provider ID exact

booking/reference exact

merchant exact authority

location exact

amount 100

JPY

status

updatedAt

completedAt if COMPLETED

matchPayment equivalent PASS。

raw provider response:
Git保存禁止。

━━━━━━━━━━━━━━━━━━
28. R13 BUSINESS PROJECTION
━━━━━━━━━━━━━━━━━━

R12 accepted truth取得後、
R13 transactional projectionを
Hosted DBのR15 synthetic bookingだけに実行。

projection前に再検証:

HOLD valid

due_at future

claims intact

transfer safe

price snapshot valid

identity exact

revision current

duplicate not already projected

PASS時のみexisting business state transition。

history/audit/projection receipt:
exactly once。

━━━━━━━━━━━━━━━━━━
29. HOSTED NEGATIVE TESTS
━━━━━━━━━━━━━━━━━━

provider HTTPを増やさず、
Hosted DB上のsynthetic dataで最低限:

expired HOLD

missing claim

transfer attention/problem

bad price snapshot

duplicate observation

COMMIT-response-loss replay

を再検証。

confirmation禁止ケースで:

new HOLD 0

inventory resurrection 0

auto refund 0

duplicate history 0

━━━━━━━━━━━━━━━━━━
30. SUCCESS DEFINITION
━━━━━━━━━━━━━━━━━━

R15_PASSは最低限:

Hosted Neon dev DB active

0001〜0029 applied

least privilege verified

dedicated ingress stable HTTPS public

main project protection unchanged

Sandbox webhook subscription active during test

live valid signed webhook persisted

ACK after durable COMMIT

R12 finite worker accepted real GetPayment truth

R13 synthetic business projection applied exactly once

negative business cases pass

secret exposure0

Production Square0

real customer0

を全て満たすこと。

━━━━━━━━━━━━━━━━━━
31. CLEANUP
━━━━━━━━━━━━━━━━━━

safe evidenceをGitHubへ
commit/push/readback後のみcleanup。

Square Sandbox webhook subscription:

acceptance-onlyならdelete最大1。

dedicated ingress deployment:

acceptance-onlyなら削除してよい。

dedicated project:

今後devで使うなら保持可。

保持時はStandard Protection維持。

main acceptance Preview:

削除。

Hosted Neon DB:

development environmentとして保持してよい。

synthetic dataだけ。

runtime roles保持可。

migration owner secretはruntimeから除外。

━━━━━━━━━━━━━━━━━━
32. PUBLIC SURFACE AFTER CLEANUP
━━━━━━━━━━━━━━━━━━

acceptance後にWebhook subscriptionを削除する場合、
dedicated ingress production domainが残っていても:

HMAC validation必須

signature key secret

body size limit

merchant validation

DB receiver-role only

Square access tokenなし

を維持。

不要ならdeploymentを削除しpublic surfaceを閉じる。

main `zao-rental` protectionは
最初から最後まで変更0。

━━━━━━━━━━━━━━━━━━
33. SECURITY ABSOLUTES
━━━━━━━━━━━━━━━━━━

保存禁止:

Square access token

Webhook signature key

Neon DB password

full DATABASE_URL

Authorization

Cookie

auth callback

raw webhook body

raw provider response

card data

customer PII

秘密値をGit/chat/logへ出さない。

━━━━━━━━━━━━━━━━━━
34. COST / PERMISSION STOP
━━━━━━━━━━━━━━━━━━

以下の場合だけOwner停止:

Vercel login/MFA

Neon/Vercel Marketplace login

paid plan consent

billing increase

organization permission expansion

new provider契約

unexpected production/main resource requirement

それ以外は自律継続。

━━━━━━━━━━━━━━━━━━
35. VALIDATION
━━━━━━━━━━━━━━━━━━

外部activation前:

existing full relevant suite

R11

R12

R13

R14 DB tests

R15 ingress tests

secret scan

lint

typecheck

build

green必須。

activation後も再実行。

既存testを削減しない。

━━━━━━━━━━━━━━━━━━
36. GITHUB
━━━━━━━━━━━━━━━━━━

R15で生成した:

code

tests

migrations if any

docs

safe evidence

を、

ginisato-hash/zao-rental

codex/external-acceptance-p6

へ通常pushすることを明示承認する。

force push:
禁止

main merge:
0

new PR:
0

━━━━━━━━━━━━━━━━━━
37. CLASSIFICATION
━━━━━━━━━━━━━━━━━━

最終分類:

R15_PASS

または具体的に:

BLOCKED_BILLING_APPROVAL

BLOCKED_VERCEL_LOGIN

BLOCKED_NEON_PROVISIONING

BLOCKED_HOSTED_DB_MIGRATION

BLOCKED_INGRESS_DEPLOY

BLOCKED_SQUARE_SUBSCRIPTION

BLOCKED_WEBHOOK_DELIVERY

BLOCKED_PROVIDER_TRUTH

BLOCKED_BUSINESS_PROJECTION

UNKNOWN_DO_NOT_RETRY

部分成功は正確に記録。

無理にPASS化しない。

━━━━━━━━━━━━━━━━━━
38. FINAL REPORT
━━━━━━━━━━━━━━━━━━

完了時のみ報告:

Starting HEAD

Authority commit

implementation commits

final HEAD

working tree clean

Hosted DB:

provider
resource classification
migration range
role count
least privilege

Ingress:

project name
Vercel target
stable URL
protection
deploy count
retained/deleted

Main app:

protection unchanged
Preview count
deleted

Square:

subscription create/update/delete counts

test webhook count

CreatePayment count

GetPayment count

payment ID

amount/status

retry0

R11:

live receipt
signature
ACK
durability

R12:

job
lease
provider truth
decision

R13:

projection
booking result
history/audit
negative tests

Security:

secret exposure
auth callback exposure

External:

refund0
R10 lookup0
Production Square0
real customer0
real inventory0
real custody0

Validation:

test count
secret scan
lint
typecheck
build

classification

next gate

のみ。

━━━━━━━━━━━━━━━━━━
39. FINAL OWNER CONFIRMATION
━━━━━━━━━━━━━━━━━━

私はOwnerとして、
starting HEAD

dffa78c10825fdb44bd7cb123c2b8b2b4e2113c9

から開始するこのR15を正式に承認する。

特に:

Vercel Marketplace上の$0/free Neon development DB最大1件、

dedicated Vercel project
`zao-rental-webhook-sandbox` の作成、

この専用projectに限った
Vercel production target deploy最大2件、

Standard Protection維持、

Square Sandbox webhook subscription最大1件、

subscription update最大1件、

official test webhook最大1件、

条件付きCreatePayment最大1件、

GetPayment最大1件、

main zao-rental protected Preview最大1件、

finite R12 worker、

R13 synthetic projection、

safe evidence保存、

cleanup、

およびR15成果一式の既存branchへの通常push

を明示承認する。

main `zao-rental` Production deploy、
Square Production、
real card/customer、
refund、
R10 refund follow-up、
real inventory/custody、
main mergeは承認しない。

安全境界内では不要に停止せず、
R15を最後まで自立実行すること。