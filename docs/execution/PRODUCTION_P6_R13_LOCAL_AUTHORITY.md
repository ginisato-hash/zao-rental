【ZAO Rental｜正式Owner Authority
P6 R13 LOCAL IMPLEMENTATION
Transactional Payment Projection Boundary — autonomous local scope】

Ownerとして、このR13 local implementationを正式に承認する。

R11:
Webhook Receiver + Durable Inbox

R12:
Durable Payment Reconciliation Worker + Provider Truth Engine

はLOCAL_IMPLEMENTED済み。

次に、
verified/reconciled provider truthを
booking / payment-attempt / HOLDへ安全に投影する

Transactional Payment Projection Boundary

をローカル実装する。

今夜/今回も:

Vercel
Square
browser
external DB
Production

を一切使わない。

不要な中間Owner確認なしで
Codex parentが設計・実装・テスト・GitHub保存まで完遂する。

━━━━━━━━━━━━━━━━━━
0. STARTING STATE
━━━━━━━━━━━━━━━━━━

repo:
ginisato-hash/zao-rental

canonical branch:
codex/external-acceptance-p6

expected starting remote HEAD:
49f0a50e79b7b53d9a13fd66c334bc168b5beea7

main:
3061dbbbe00294e5baebba2405028c907d6e6e85

R10:
S3_NONTERMINAL_DO_NOT_RETRY
LAST_OBSERVED_PENDING
historical only

R11:
webhook receiver / durable inbox
LOCAL_IMPLEMENTED

R12:
reconciliation jobs / worker / truth engine
LOCAL_IMPLEMENTED

actual Square calls this R13:
0

external DB:
0

Vercel:
0

browser:
0

Production:
0

━━━━━━━━━━━━━━━━━━
1. PURPOSE
━━━━━━━━━━━━━━━━━━

R12までで得られる:

accepted/reconciled PaymentObservation

を、

booking state
rental_payment_attempts
inventory_holds
history/audit

へ安全に反映する
transactional boundaryを実装する。

重要:

Webhook payload自体をauthorityにしない。

R12 provider truth engineが受理した
validated PaymentObservationだけを入力とする。

実external runtimeへの接続はまだしない。

━━━━━━━━━━━━━━━━━━
2. EXISTING CONTRACTS FIRST
━━━━━━━━━━━━━━━━━━

実装前に必ず読む:

packages/contracts/src/rental-flow.ts

packages/core/src/payment/booking-service.ts

packages/core/src/payment/square-boundary.ts

R11/R12で追加した:

webhook inbox
reconciliation repository
worker
truth decision engine
migrations 0025 / 0026
tests

特に既存:

matchPayment

recordObservation

startPayment

reconcile

markUnknown

BookingServiceのbooking/HOLD state transitions

を精査する。

既存business ruleを推測で変更しない。

R13は既存semanticsを
明示的で再利用可能なtransaction boundaryへ分離する作業。

━━━━━━━━━━━━━━━━━━
3. PRIMARY DESIGN GOAL
━━━━━━━━━━━━━━━━━━

以下を分離する:

A.
provider truth acquisition

B.
provider observation validation

C.
business projection decision

D.
transactional business state mutation

R13ではC/Dを実装する。

provider HTTP:
0

webhook HTTP:
0

━━━━━━━━━━━━━━━━━━
4. PURE PROJECTION DECISION
━━━━━━━━━━━━━━━━━━

pure functionを作る。

例:

decidePaymentProjection(...)

入力:

booking current state

payment attempt current state

HOLD current state

quote/snapshot integrity

inventory protection state

transfer attention

accepted provider observation

previous accepted provider observation

projection history

出力例:

NOOP_DUPLICATE

NOOP_STALE

KEEP_PENDING

APPLY_COMPLETED

APPLY_FAILED

APPLY_CANCELED

BLOCK_EXPIRED_HOLD

BLOCK_INVENTORY_DRIFT

BLOCK_TRANSFER_ATTENTION

BLOCK_PRICE_INTEGRITY

BLOCK_IDENTITY_MISMATCH

BLOCK_INVALID_TRANSITION

REQUIRES_OPERATOR_RECONCILIATION

最終enumはrepo conventionsに合わせる。

pure decisionにはDB accessを入れない。

高密度fixture testする。

━━━━━━━━━━━━━━━━━━
5. PROVIDER COMPLETED IS NOT AUTOMATIC BOOKING CONFIRMATION
━━━━━━━━━━━━━━━━━━

特に重要。

PaymentObservation.status === COMPLETED

だけでbooking CONFIRMEDにしない。

transaction apply直前に
全business prerequisitesを再検証する。

最低限:

booking exists

payment attempt exists

attempt belongs to booking

attempt identity exact

providerId exact

merchant exact

location exact

amount exact

currency JPY

reference exact

idempotency exact

price snapshot hash valid

quote / booking relation valid

HOLDがまだ有効

HOLD due_at > DB clock

required inventory/wear claims intact

transfer_attentionなし

forbidden transfer stateなし

bookingが既に矛盾状態でない

Production/real flowではない

既存business contract上必要な条件すべて。

1つでも成立しなければ
「決済は成功したがbookingは安全に確定できない」
状態として明示的にBLOCKする。

決済成功を消さない。

勝手にrefundしない。

在庫を再確保しない。

━━━━━━━━━━━━━━━━━━
6. EXPIRED HOLD SAFETY
━━━━━━━━━━━━━━━━━━

provider paymentがCOMPLETEDでも
HOLDがexpiredしている場合:

bookingを自動CONFIRMEDにしない。

inventoryを勝手に復活させない。

新しいHOLDを自動生成しない。

payment truthは保存。

business projectionは:

REQUIRES_OPERATOR_RECONCILIATION
または既存相当state

に止める。

既存state modelを確認し、
新state追加が本当に必要な場合のみ
additive migrationで追加する。

━━━━━━━━━━━━━━━━━━
7. INVENTORY DRIFT SAFETY
━━━━━━━━━━━━━━━━━━

payment開始後に:

claim欠落

wear claim欠落

transfer cancellation

transfer issue

stock protection不整合

が発生した場合、

COMPLETED paymentを理由に
bookingを強制成立させない。

payment accepted truth
と
booking fulfillment safety

を分ける。

このケースをfixtureで必ず検証。

━━━━━━━━━━━━━━━━━━
8. PAYMENT FAILURE / CANCELED
━━━━━━━━━━━━━━━━━━

FAILED / CANCELED observationの既存semanticsを
booking-serviceから抽出して維持する。

推測で:

HOLD release
booking delete
inventory release

を追加しない。

既存contractが
payment failure後に再試行可能な状態を持つなら
その意味を保持する。

既存挙動が曖昧なら
mutationせずBLOCK/REQUIRES_REVIEWを選ぶ。

business ruleの新規決定はしない。

━━━━━━━━━━━━━━━━━━
9. STALE / OUT-OF-ORDER
━━━━━━━━━━━━━━━━━━

古いprovider observationで
business stateを後退させない。

例:

accepted COMPLETED
↓
古いPENDING

NOOP_STALE

COMPLETED
↓
duplicate COMPLETED

NOOP_DUPLICATE

同一provider updatedAtで
内容が異なる場合:

BLOCK_CONFLICT

updatedAtだけを盲信せず
fingerprintも使う。

━━━━━━━━━━━━━━━━━━
10. TRANSACTIONAL APPLY
━━━━━━━━━━━━━━━━━━

DB transaction境界を実装する。

例:

applyReconciledPaymentProjection(...)

一transaction内で:

booking lock

payment attempt lock

HOLD lock

必要claim再検証

projection dedupe確認

decision再計算

payment attempt update

booking/HOLD update

history/audit insert

projection record insert

をatomicに行う。

external HTTPをtransaction内で呼ばない。

provider lookupはtransaction外で完了済み前提。

━━━━━━━━━━━━━━━━━━
11. LOCK ORDER
━━━━━━━━━━━━━━━━━━

deadlockを避けるため
lock orderを明示し固定する。

repo既存のtransaction/locking conventionsを優先。

例:

booking
→ payment attempt
→ HOLD
→ claims/transfer read

等。

既存BookingServiceと競合しないlock orderingを選ぶ。

advisory lockが既存で使われている場合は
意味を確認して整合する。

新しいglobal lockを雑に追加しない。

━━━━━━━━━━━━━━━━━━
12. IDEMPOTENT PROJECTION
━━━━━━━━━━━━━━━━━━

同じprovider observationを何度applyしても
business side effectは1回。

projection identityとして
少なくとも:

payment attempt
provider ID
provider updatedAt
observation fingerprint
decision fingerprint

を利用。

必要ならadditive table:

payment_projection_events
または既存命名規則に沿った同等table

を作る。

UNIQUE制約で重複applyを防ぐ。

history eventの二重挿入も防ぐ。

━━━━━━━━━━━━━━━━━━
13. CRASH SAFETY
━━━━━━━━━━━━━━━━━━

次をfixture/static DB contractで検証:

decision後・transaction前 crash
→ mutation0

transaction中 crash
→ rollback

COMMIT後response loss
→ replayでduplicate/noop

history insert後 crash
→ partial stateなし

job finalize前 crash
→ business projectionはidempotent

R12 job lease recoveryと
R13 projection idempotencyが組み合わさっても
二重confirmationを起こさない。

━━━━━━━━━━━━━━━━━━
14. R12 JOB INTEGRATION BOUNDARY
━━━━━━━━━━━━━━━━━━

R12 workerからR13へ渡す
明示interfaceを作る。

例:

PaymentProjectionPort

project(input)

ただし今夜は
実worker runtimeへactivateしない。

composition wiringは
local/test onlyまで。

R12 workerのprovider truth resultと
R13 projection decisionを
型で明確に分離する。

━━━━━━━━━━━━━━━━━━
15. RECONCILIATION JOB FINALIZATION
━━━━━━━━━━━━━━━━━━

将来live activation時、

business projection成功

と

reconciliation job terminal

の順序を曖昧にしない。

理想:

同一DB transactionで可能な範囲は
projection + job decision recordをatomic化。

ただしR11/R12 schemaを無理に破壊しない。

cross-repository atomicityが必要なら
shared PoolClient/transaction contextを導入してよい。

新しいnetwork transactionは作らない。

━━━━━━━━━━━━━━━━━━
16. AUDIT
━━━━━━━━━━━━━━━━━━

PII/secret-free auditを残す。

最低限:

booking id

payment attempt id

provider payment id

observation fingerprint

decision

previous state

new state

block reason

projection revision

occurred_at

保存禁止:

card data

raw Square response

webhook raw body

access token

contact PII

Cookie

━━━━━━━━━━━━━━━━━━
17. DB MIGRATION
━━━━━━━━━━━━━━━━━━

R11:
0025

R12:
0026

の次を確認。

必要なら:

0027_payment_projection.sql

等のadditive migrationを追加。

ただし既存schemaだけで安全に実装可能なら
無理にtableを増やさない。

migration rules:

drop禁止

existing column semantic change禁止

PUBLIC revoke

CHECK/UNIQUEでinvariant強制

必要indexだけ追加

external DB apply:
0

━━━━━━━━━━━━━━━━━━
18. BUSINESS STATE MODEL
━━━━━━━━━━━━━━━━━━

既存booking/payment/HOLD statesを正本とする。

新state追加は最小限。

特に:

PAYMENT_PENDING

UNKNOWN

CONFIRMED系

FAILURE系

の既存意味を精査。

state追加が必要な場合は:

なぜ既存stateで安全に表現できないか

docsへ明記。

名前だけ増やして複雑化しない。

━━━━━━━━━━━━━━━━━━
19. TEST MATRIX
━━━━━━━━━━━━━━━━━━

重く検証。

最低限:

PENDING keeps nonterminal

PENDING duplicate

COMPLETED valid path

COMPLETED duplicate

COMPLETED stale replay

COMPLETED with expired HOLD

COMPLETED with due_at exact boundary

COMPLETED with missing inventory claim

COMPLETED with missing wear claim

COMPLETED with transfer_attention

COMPLETED with canceled transfer

COMPLETED amount mismatch

currency mismatch

merchant mismatch

location mismatch

reference mismatch

idempotency mismatch

provider ID mismatch

price snapshot hash mismatch

quote/booking mismatch

FAILED valid existing semantics

CANCELED valid existing semantics

FAILED after COMPLETED stale/conflict

two workers project same observation

same observation replay after COMMIT response loss

concurrent startPayment vs projection

concurrent reconcile vs projection

lease recovery + duplicate projection

history exactly once

projection audit exactly once

transaction rollback

stale transaction revision

forbidden state regression

no provider HTTP

no webhook HTTP

no external DB

━━━━━━━━━━━━━━━━━━
20. EXISTING BOOKING SERVICE REGRESSION
━━━━━━━━━━━━━━━━━━

既存BookingService behaviorを壊さない。

特に:

create

startPayment

reconcile

get/list

synthetic flow

HOLD validation

inventory claims

transfer checks

price snapshot integrity

を回帰test。

既存recordObservationをrefactorする場合、
before/after semanticsの一致をfixtureで証明する。

━━━━━━━━━━━━━━━━━━
21. PAYMENT SUCCESS BUT FULFILLMENT BLOCKED
━━━━━━━━━━━━━━━━━━

重要なoperational state。

例:

Square:
COMPLETED

しかし:

HOLD expired
inventory protection invalid
transfer problem

この場合に必要なsafe read modelを
設計してよい。

例:

payment:
COMPLETED

booking:
RECONCILIATION_REQUIRED

operatorActionRequired:
true

reason:
...

ただし新しい外部UIは不要。

read-model/interfaceまで。

返金を自動発火しない。

━━━━━━━━━━━━━━━━━━
22. SECURITY
━━━━━━━━━━━━━━━━━━

provider observationは
trusted internal objectでも再検証する。

DBから読んだ値だから安全と仮定しない。

amount integer bounds

IDs format

timestamps

enum

merchant/location

fingerprint

をvalidation。

SQL dynamic string禁止。

PIIログ禁止。

━━━━━━━━━━━━━━━━━━
23. PERFORMANCE
━━━━━━━━━━━━━━━━━━

projection pathは1booking単位。

unbounded table scan禁止。

必要indexを使う。

N+1を避ける。

同時処理を想定。

500 rental sets規模で余裕がある設計。

ただし過剰なdistributed infrastructureは追加しない。

━━━━━━━━━━━━━━━━━━
24. DOCUMENTATION
━━━━━━━━━━━━━━━━━━

作成:

docs/execution/PAYMENT_PROJECTION_ARCHITECTURE.md

最低限:

provider truth
↓
decision
↓
transaction
↓
business state

の責務分離。

さらに:

docs/execution/PRODUCTION_P6_BUSINESS_PROJECTION_ACTIVATION_GATE.md

を作成。

次回live activationで必要:

actual dev DB migration

R12 worker → R13 projection wiring

actual provider observation

expired HOLD反例

stock drift反例

transaction concurrency

operator recovery

Production still disabled

を明記。

━━━━━━━━━━━━━━━━━━
25. VALIDATION
━━━━━━━━━━━━━━━━━━

最低限:

R11 tests

R12 tests

R13 projection tests

booking-service regression

payment regression

migration/static DB tests

secret scan

lint

typecheck

build

可能ならfull relevant suite。

external DB:
0

Square:
0

Vercel:
0

browser:
0

━━━━━━━━━━━━━━━━━━
26. NO CLOUD / NO LOGIN
━━━━━━━━━━━━━━━━━━

今回も:

Vercel deploy/login/env

Square API/Console

external DB

browser

を一切使わない。

認証で止まらない。

GitHub push認証だけ失敗した場合は
local implementation/validation/commitsまで全部完了し、

docs/execution/p6/R13_PUSH_PENDING.md

へ:

starting remote
commit SHAs
final local HEAD
validation
push commands

を保存。

Ownerを呼ばない。

━━━━━━━━━━━━━━━━━━
27. ABSOLUTE PROHIBITIONS
━━━━━━━━━━━━━━━━━━

actual Square call

refund lookup

refund POST

CreatePayment

Webhook subscription

real webhook delivery

Vercel

external DB

Production

real booking activation

real inventory mutation

real custody mutation

email/SMS

cron/Runner

main merge

new PR

ruleset change

permission/billing change

secret extraction

Claude

Spark

すべて0。

━━━━━━━━━━━━━━━━━━
28. FINAL STATE
━━━━━━━━━━━━━━━━━━

目標:

Webhook receiver:
LOCAL_IMPLEMENTED

Durable inbox:
LOCAL_IMPLEMENTED

Reconciliation worker:
LOCAL_IMPLEMENTED

Provider truth engine:
LOCAL_IMPLEMENTED

Transactional projection:
LOCAL_IMPLEMENTED

Projection idempotency:
FIXTURE_VERIFIED

Expired HOLD safety:
FIXTURE_VERIFIED

Inventory drift safety:
FIXTURE_VERIFIED

Crash recovery:
FIXTURE_VERIFIED

Business apply live wiring:
NOT_ACTIVATED

external DB:
0

provider:
0

Production:
0

━━━━━━━━━━━━━━━━━━
29. FINAL REPORT
━━━━━━━━━━━━━━━━━━

完了時のみ報告:

Starting HEAD

authority commit

migration

implementation commits

final HEAD

working tree

projection states/decisions

transaction boundary

lock ordering

idempotency mechanism

expired HOLD behavior

inventory drift behavior

failure/canceled behavior

test count

secret scan

lint

typecheck

build

external calls:
all0

activation gate path

GitHub:
PUSHED
または
PUSH_PENDING_AUTH

Owner next action:

live webhook + reconciliation + business projection activation authority

のみ。

不要な中間確認をせず、
R13を最後まで自立実行すること。