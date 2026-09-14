【ZAO Rental｜正式Owner Authority
P6 R12 LOCAL IMPLEMENTATION
Durable Payment Reconciliation Worker + Provider Truth Engine】

私はOwnerとして、R11/S4 local webhook implementationが
local validationまで完了した後、
以下のR12 local implementationを自動的に開始することを正式に承認する。

R11完了後にOwnerへ「次へ進めてよいか」と確認しない。

Ownerは就寝中のため、
Vercel / Square / browser / MFA / external DBを必要としない範囲で
Codex parentがR12を最後まで自律実行する。

R11のremote pushが成功していればその最新remote HEADをR12 starting pointとする。

GitHub push認証のみ失効している場合でも、
R11 local commitがgreenであることを確認できれば、
そのlocal HEAD上でR12を続行してよい。

その場合は最終的にPUSH_PENDING_AUTHとして
全commit SHAとpush手順を保存する。

━━━━━━━━━━━━━━━━━━
0. R12 PURPOSE
━━━━━━━━━━━━━━━━━━

R11で実装する:

Square Webhook Receiver
+
Durable Webhook Inbox

の次段として、

Durable Payment Reconciliation Worker
+
Provider Truth Decision Engine

を実装する。

目的:

Webhook receipt
↓
durable inbox
↓
claim / lease
↓
payment reconciliation job
↓
provider truth observation
↓
evidence validation
↓
safe decision
↓
terminal / retryable state

を明確に分離すること。

今夜は実Square lookupを行わない。

実provider transportはinjectable portとして切り離し、
fixture/fakeのみで全state machineを検証する。

━━━━━━━━━━━━━━━━━━
1. EXTERNAL ACTIONS — ALL ZERO
━━━━━━━━━━━━━━━━━━

今回禁止:

Vercel login
Vercel deploy
Vercel env
Vercel Preview

Square API
Square Dashboard
Square Developer Console
Webhook subscription
real webhook delivery

external PostgreSQL connection
external migration apply

browser
Playwright
MFA

Production

provider calls:
0

Vercel calls requiring auth:
0

browser:
0

external DB:
0

━━━━━━━━━━━━━━━━━━
2. GIT CONTINUITY
━━━━━━━━━━━━━━━━━━

R12開始時に:

git fetch origin --prune

が非対話で可能なら実行。

R11がremote push済みなら:

origin/codex/external-acceptance-p6

の最新HEADを正本とする。

R11がPUSH_PENDING_AUTHなら:

R11 final local HEAD

をR12 parentとする。

force push禁止。

reset --hard禁止。

git cleanによるunknown work削除禁止。

別writerによるremote advanceを確認した場合のみ
安全にreconcileする。

━━━━━━━━━━━━━━━━━━
3. AUTHORITY RECORD
━━━━━━━━━━━━━━━━━━

作成:

docs/execution/PRODUCTION_P6_R12_LOCAL_AUTHORITY.md

current stateも必要最小限更新:

AGENTS.md
CLAUDE.md
docs/execution/SCOPE.md
docs/execution/PRODUCTION_P6_STATUS.json

R4〜R10 historical evidenceを変更しない。

R10 refundは:

LAST_OBSERVED_PENDING
S3_NONTERMINAL_DO_NOT_RETRY
DEFERRED_NON_GATING

のまま。

R12でrefund lookupしない。

━━━━━━━━━━━━━━━━━━
4. EXISTING PAYMENT FLOW MUST BE STUDIED FIRST
━━━━━━━━━━━━━━━━━━

実装前に以下を正本として読む:

packages/contracts/src/rental-flow.ts

packages/core/src/payment/booking-service.ts

packages/core/src/payment/square-boundary.ts

packages/core/src/payment/square-sandbox.ts

R11で新規作成された:

webhook receiver
webhook inbox repository
webhook migration
tests

も全て読む。

特に既存:

PaymentRequest
PaymentObservation
matchPayment
BookingService.reconcile
BookingService.reconcileVerifiedWebhook
recordObservation

の意味を壊さない。

既存business/payment state transitionを
推測で再定義しない。

━━━━━━━━━━━━━━━━━━
5. ARCHITECTURAL CHANGE
━━━━━━━━━━━━━━━━━━

R11以降、

Webhook HTTP ACK path

と

provider reconciliation/business reconciliation

を完全に分離する。

HTTP webhook receiver内では:

signature verify
payload minimum validation
durable inbox insert
ACK

まで。

provider lookupを実行しない。

booking stateを変更しない。

inventoryを変更しない。

custodyを変更しない。

R12 workerが後段処理を担当する。

━━━━━━━━━━━━━━━━━━
6. PROVIDER LOOKUP PORT
━━━━━━━━━━━━━━━━━━

provider-neutralなinterfaceを定義する。

例:

interface PaymentTruthProvider {
  lookupPayment(input: {
    paymentId: string
    merchantId: string
  }): Promise<PaymentObservation | null>
}

最終命名はrepo conventionsに合わせる。

重要:

core decision engineはSquare HTTP transportを直接知らない。

Square implementationはadapter boundary。

R12では実adapterを外部通信へ接続しない。

fixture/fake adapterのみで検証。

━━━━━━━━━━━━━━━━━━
7. DURABLE RECONCILIATION JOB
━━━━━━━━━━━━━━━━━━

R11 inboxとは別に
payment reconciliation job/stateをdurableに持つ。

R11 migrationが0025なら
R12は次の番号を使う。

migration番号を推測せず、
R11完了後のlatest migrationを確認する。

例:

0026_payment_reconciliation.sql

schema設計は既存DB conventionsへ合わせる。

最低限保持:

job id

source webhook event id

payment id

merchant id

body / event fingerprint reference

state

attempt count

next attempt at

lease owner/token

lease expires at

last error code

provider status

provider updated_at

decision

decision fingerprint

created_at

updated_at

terminal_at

raw webhook body:
保存禁止

provider raw response:
保存禁止

credential:
保存禁止

━━━━━━━━━━━━━━━━━━
8. JOB DEDUPE / COALESCING
━━━━━━━━━━━━━━━━━━

同一paymentに:

payment.created
payment.updated
payment.updated

が複数来ても、
無制限にprovider lookup jobを増殖させない。

最低限:

event_id dedupe

payment_id coalescing

を実装する。

新しいeventが来た場合でも、
既存の同payment jobが:

READY
CLAIMED
RETRY_WAIT

等なら
必要に応じてwake/coalesceする。

terminal jobへ新しいprovider-relevant eventが来た場合の
re-open policyは明示的に設計する。

arrival orderをtruthにしない。

━━━━━━━━━━━━━━━━━━
9. JOB STATE MACHINE
━━━━━━━━━━━━━━━━━━

推奨state:

READY

CLAIMED

RETRY_WAIT

RECONCILED

BLOCKED

DEAD

最終名称はCodexが決定可。

state transitionはDB制約またはrepository contractで固定する。

不正な逆行を禁止。

例:

RECONCILED
→ READY

を勝手に許可しない。

ただし新しいeventによる
新job / generation方式は可。

━━━━━━━━━━━━━━━━━━
10. CLAIM / LEASE SEMANTICS
━━━━━━━━━━━━━━━━━━

複数workerを前提とする。

claimはatomic。

PostgreSQL実装では可能なら:

FOR UPDATE SKIP LOCKED

または同等の安全なclaim pattern。

claim時に:

lease token
lease expiry

を設定。

worker crash時:

lease expiry後に再claim可能。

永久lock禁止。

同じjobを2 workerが同時にfinalizeしない。

stale lease tokenによるcomplete/fail更新を拒否。

testsで:

worker A claim

worker B cannot claim

lease expiry

worker B recovery

stale A finalize rejected

を証明する。

━━━━━━━━━━━━━━━━━━
11. RETRY POLICY
━━━━━━━━━━━━━━━━━━

provider lookup失敗を全て同じ扱いにしない。

分類例:

AUTH_BLOCKED

RATE_LIMITED

NETWORK_RETRYABLE

PROVIDER_5XX_RETRYABLE

NOT_FOUND_BLOCKED

INVALID_RESPONSE_BLOCKED

EVIDENCE_MISMATCH_BLOCKED

SUCCESS

actual namingはrepoに合わせる。

retryableのみ:

RETRY_WAIT

へ。

bounded exponential backoff + jitterを
pure functionとして実装してよい。

ただし:

最大attempt
最大backoff
terminal cutoff

を明示。

無限retry禁止。

R12ではtimer/cronを実稼働させない。

━━━━━━━━━━━━━━━━━━
12. PROVIDER OBSERVATION ORDERING
━━━━━━━━━━━━━━━━━━

Webhook arrival timestampをprovider truthにしない。

PaymentObservationの:

providerId
status
updatedAt
completedAt
amount
currency
merchant
location
reference
idempotency

を既存contractで照合。

provider updatedAtが既存観測より古い場合:

business stateを後退させない。

stale provider observation:

NOOP_STALE

等として明示分類。

COMPLETED後に
古いPENDING observationが来ても
state downgrade禁止。

━━━━━━━━━━━━━━━━━━
13. PURE DECISION ENGINE
━━━━━━━━━━━━━━━━━━

DB writeとは別に、
provider truthから何をすべきかを返す
pure decision functionを作る。

入力:

expected PaymentRequest

current persisted payment state

latest accepted provider observation

candidate provider observation

出力例:

ACCEPT_PENDING

ACCEPT_COMPLETED

ACCEPT_FAILED

ACCEPT_CANCELED

NOOP_DUPLICATE

NOOP_STALE

BLOCKED_EVIDENCE_MISMATCH

BLOCKED_INVALID_TRANSITION

最終enumはrepo conventionsに合わせる。

pure functionを高密度fixture testする。

━━━━━━━━━━━━━━━━━━
14. BUSINESS MUTATION BOUNDARY
━━━━━━━━━━━━━━━━━━

重要:

R12では実際の通常booking business mutationを
external runtimeへ接続しない。

ただし既存BookingService.recordObservation相当の
state transition semanticsを分析し、

将来workerから呼べる形へ
安全に分離/refactorしてよい。

例えば:

applyPaymentObservation(...)

のようなtransactional boundary。

ただし既存挙動を変更しない。

変更する場合は回帰testで
旧BookingService behaviorと一致を証明する。

chargeReady=false

Production disabled

通常booking未接続

を維持。

━━━━━━━━━━━━━━━━━━
15. PAYMENT CONFIRMATION SAFETY
━━━━━━━━━━━━━━━━━━

Webhook embedded payloadだけで
booking paid/confirmedにしない。

必ずfuture provider lookupから得た
PaymentObservationがauthority。

さらに:

matchPayment

を通らないprovider observationは
business apply禁止。

必須match:

providerId

referenceId

idempotencyKey

merchantId

locationId

amountJpy

currency

timestamps

status semantics

━━━━━━━━━━━━━━━━━━
16. TERMINAL PAYMENT STATES
━━━━━━━━━━━━━━━━━━

少なくとも:

COMPLETED
FAILED
CANCELED

について明示的なterminal semanticsを持つ。

PENDINGはterminalではない。

UNKNOWNはprovider truthではなく
local knowledge stateとして扱う。

COMPLETEDからFAILED等へ
古いeventで戻さない。

providerが後から真にstate変更可能な場合は
Square contractを既存仕様から確認し、
fixture contractに反映。

推測でstatus transitionを追加しない。

━━━━━━━━━━━━━━━━━━
17. WEBHOOK EVENT -> JOB LINKAGE
━━━━━━━━━━━━━━━━━━

R11 inbox rowからjob作成/更新するrepositoryを作る。

event receiver自身で重い処理をしない。

方式候補:

A.
inbox insert transaction内でjob upsert

または

B.
別local dispatcherがinbox→job

Codexがtransaction safetyを比較して決定。

ただし:

ACK前に最低限
durable future-work signal

が存在することを保証。

「inboxだけ入り、永遠にjob化されない」
silent dropを避ける。

━━━━━━━━━━━━━━━━━━
18. EXACTLY-ONCE CLAIMを主張しない
━━━━━━━━━━━━━━━━━━

distributed system上、
exactly-once side effectを誇張しない。

実装保証は:

at-least-once event receipt

durable dedupe

atomic claim

idempotent reconciliation decision

stale-write rejection

terminal-state protection

とする。

README/docsにも
exactly-onceという誤表現を使わない。

━━━━━━━━━━━━━━━━━━
19. OBSERVABILITY
━━━━━━━━━━━━━━━━━━

PII/secret-freeのstructured auditを設計する。

保存可:

job id

event id

payment id

state transition

attempt

error code

provider status

provider updated_at

decision

lease timestamps

fingerprints

保存禁止:

raw webhook body

auth headers

signature

access token

card details

customer PII

Cookie/session

━━━━━━━━━━━━━━━━━━
20. DEAD / BLOCKED OPERATIONS
━━━━━━━━━━━━━━━━━━

BLOCKED / DEADになったjobを
自動的に無限再開しない。

human/operator recoveryに必要な
safe summaryを返せるrepository/API boundaryを実装してよい。

ただし今夜:

admin UI不要

external operation不要

provider retry不要。

operator diagnosticはread-only。

━━━━━━━━━━━━━━━━━━
21. TEST MATRIX
━━━━━━━━━━━━━━━━━━

重めにテストする。

最低限:

event duplicate

event out-of-order

same payment multiple events

two workers concurrent claim

lease expiry

stale lease completion

worker crash after claim

worker crash after provider response before finalize

retryable network failure

429 classification

401/403 classification

provider 5xx

provider not found

invalid response

payment identity mismatch

amount mismatch

currency mismatch

merchant mismatch

location mismatch

reference mismatch

duplicate provider observation

stale provider updatedAt

PENDING -> COMPLETED

COMPLETED + stale PENDING

FAILED terminal handling

CANCELED terminal handling

max attempts reached

backoff calculation

job coalescing

reopened/new generation semantics

inbox insert + job linkage atomicity

raw data not persisted

secret redaction

no external provider call in tests

existing BookingService regression

━━━━━━━━━━━━━━━━━━
22. DB MIGRATION SAFETY
━━━━━━━━━━━━━━━━━━

migrationはadditive。

既存tableをdropしない。

既存column意味変更禁止。

PUBLIC privilege revoke。

必要indexを追加:

ready job claim

payment lookup

lease expiry

event linkage

等。

index数を無駄に増やさない。

migration rollbackはrepo conventionに従う。

external DB apply:
0

━━━━━━━━━━━━━━━━━━
23. PERFORMANCE
━━━━━━━━━━━━━━━━━━

500セット規模の初期運用を想定するが、
設計を1施設限定にハードコードしない。

worker claim batchを
将来複数件処理可能な形にしてよい。

ただし今夜は
実background runnerを起動しない。

N+1 queryを避ける。

unbounded scan禁止。

claim queryにはindexを効かせる。

━━━━━━━━━━━━━━━━━━
24. LOCAL WORKER / RUNNER
━━━━━━━━━━━━━━━━━━

worker class/serviceは実装してよい。

例:

PaymentReconciliationWorker

runOnce(limit)

claimBatch(limit)

reconcile(job)

finalize(...)

ただし:

launchd
cron
Vercel cron
GitHub Actions scheduler
background daemon

には接続しない。

Runner:
0

━━━━━━━━━━━━━━━━━━
25. TEST PROVIDER ADAPTER
━━━━━━━━━━━━━━━━━━

fixture adapterで:

PENDING
COMPLETED
FAILED
CANCELED
404
401
429
500
timeout
malformed response

を再現。

actual Square HTTP:
0

Square SDK:
不要

mockでtransport contractを壊さない。

━━━━━━━━━━━━━━━━━━
26. REFACTOR LIMIT
━━━━━━━━━━━━━━━━━━

重い実装だが、
無関係なpayment code全体をrewriteしない。

特に:

S1
S2
S3
Sandbox acceptance evidence

を変更しない。

historical acceptance code/resultsを
「きれいにする」目的で削除しない。

R12に必要な最小refactorのみ。

━━━━━━━━━━━━━━━━━━
27. VALIDATION
━━━━━━━━━━━━━━━━━━

最低限:

R11 tests

R12 reconciliation tests

existing payment tests

existing booking-flow regression

migration/static DB tests

secret scan

lint

typecheck

build

を実行。

可能ならfull relevant test suite。

external DB不要。

Vercel不要。

provider不要。

scope内failureは自律修正。

━━━━━━━━━━━━━━━━━━
28. DOCUMENTATION
━━━━━━━━━━━━━━━━━━

作成:

docs/execution/PAYMENT_RECONCILIATION_ARCHITECTURE.md

内容:

webhook ACK path

inbox

job creation

claim

lease

provider truth

decision engine

business apply boundary

retry

dead/block

out-of-order handling

crash recovery

security

observability

activation gaps

さらに:

docs/execution/PRODUCTION_P6_RECONCILIATION_ACTIVATION_GATE.md

を作成。

次回必要なauthority:

external dev DB migration apply

actual worker runtime

actual Square GetPayment lookup

webhook live delivery

business projection acceptance

を明確に分離する。

━━━━━━━━━━━━━━━━━━
29. NO AUTH BLOCKING
━━━━━━━━━━━━━━━━━━

特に重要。

R12で以下へ行かない:

Vercel
Square Console
external DB
browser

したがってlogin/MFAを理由に止まらない。

GitHub push authだけ切れた場合も:

実装
tests
docs
local commits

まで全て完了する。

その後:

R11_PUSH_PENDING.md

が既にあれば更新、
または:

docs/execution/p6/R12_PUSH_PENDING.md

を作成。

Ownerを起こさない。

━━━━━━━━━━━━━━━━━━
30. COMMITS
━━━━━━━━━━━━━━━━━━

推奨:

feat(payment): add durable reconciliation job model

feat(payment): add provider truth decision worker

test(payment): cover payment reconciliation recovery

docs(payment): document durable reconciliation architecture

構成に応じてまとめてよい。

canonical branchへpush可能ならpush。

main merge:
0

new PR:
0

━━━━━━━━━━━━━━━━━━
31. ABSOLUTE PROHIBITIONS
━━━━━━━━━━━━━━━━━━

Vercel deploy/login/env

Square provider call

refund lookup

refund POST

CreatePayment

S1

webhook subscription

real webhook delivery

external DB connection

production

real card/customer

email/SMS

booking production activation

inventory/custody real mutation

Runner enable

cron enable

main merge

new PR

ruleset change

permission/billing expansion

credential extraction/rotation

Claude

Spark

すべて禁止。

━━━━━━━━━━━━━━━━━━
32. COMPLETION STATE
━━━━━━━━━━━━━━━━━━

R12完了時の目標:

Webhook receiver:
LOCAL_IMPLEMENTED

Durable inbox:
LOCAL_IMPLEMENTED

Reconciliation jobs:
LOCAL_IMPLEMENTED

Claim/lease:
LOCAL_IMPLEMENTED

Provider truth port:
LOCAL_IMPLEMENTED

Decision engine:
LOCAL_IMPLEMENTED

Crash recovery:
FIXTURE_VERIFIED

Out-of-order:
FIXTURE_VERIFIED

Duplicate:
FIXTURE_VERIFIED

Business apply boundary:
LOCAL_ONLY / NOT_ACTIVATED

Actual provider lookup:
0

Actual external DB:
0

Vercel:
0

Production:
0

━━━━━━━━━━━━━━━━━━
33. FINAL REPORT
━━━━━━━━━━━━━━━━━━

R11に続いてR12も終わった時点で
まとめて最終報告。

R12:

Starting HEAD

authority commit

migration

implementation commits

final HEAD

working tree

reconciliation architecture

state machine

claim/lease semantics

retry semantics

decision enums

test count

secret scan

lint

typecheck

build

external counts:
all 0

activation gate paths

GitHub:
PUSHED
または
PUSH_PENDING_AUTH

Owner next action:

live webhook + reconciliation activation authority

のみ。

R11 local implementationがgreenになったら、
不要に停止せずそのままR12へ移行すること。