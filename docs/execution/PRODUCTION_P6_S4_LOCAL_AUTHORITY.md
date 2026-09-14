【ZAO Rental｜正式Owner Authority
P6 R11 / S4 LOCAL IMPLEMENTATION
Webhook Receiver + Durable Inbox — overnight autonomous scope】

Ownerとして、このチャット本文のR11/S4を正式に承認する。

今夜はOwnerが不在となるため、
人間のlogin / MFA / UI操作を必要としない範囲だけで
最大限自律的に実装を進める。

不要な中間確認は禁止。
Codex parentが設計・実装・テスト・GitHub保存まで完遂する。

━━━━━━━━━━━━━━━━━━
0. STARTING STATE
━━━━━━━━━━━━━━━━━━

repo:
ginisato-hash/zao-rental

canonical branch:
codex/external-acceptance-p6

expected remote HEAD:
72cee5817da22cd474773c978f9ae95396edea29

main:
3061dbbbe00294e5baebba2405028c907d6e6e85

R10 historical result:

S3_NONTERMINAL_DO_NOT_RETRY

existing payment:
pezzekG1LQRt4MVKF0X4sgRCx1FZY

refund:
PENDING

R10 GetPayment:
1 consumed

R10 Refund POST:
1 consumed

R10 GetRefund:
1 consumed

retry:
0

━━━━━━━━━━━━━━━━━━
1. REFUND FINALIZATION IS NOW NON-GATING
━━━━━━━━━━━━━━━━━━

Owner判断:

既存refundの最終COMPLETED確認は
今後のローカル実装を止めるgateにしない。

ただしhistorical resultを改竄しない。

R10は:

S3_NONTERMINAL_DO_NOT_RETRY

のまま保持する。

以下を実行しない:

- GetRefund追加
- Refund POST追加
- 別refund key
- 別Previewによるrefund再確認
- Square Consoleでの手動確認
- refundをCOMPLETEDと推定
- S3_PASSへの書換え

current interpretation:

refund finalization:
DEFERRED_NON_GATING_FOR_LOCAL_IMPLEMENTATION

provider refund state:
LAST_OBSERVED_PENDING

refund provider calls this R11:
0

━━━━━━━━━━━━━━━━━━
2. MOST IMPORTANT OVERNIGHT RULE
━━━━━━━━━━━━━━━━━━

今夜は以下を一切実行しない:

Vercel deploy
Vercel login
vercel login
Vercel browser UI
Vercel env mutation
Vercel Preview作成
Vercel authentication確認

Square Developer Console login
Square Dashboard login
Webhook subscription作成
Webhook subscription更新
Square provider API call

外部Postgres接続
外部DB migration実行
Production操作

つまり、

Vercel認証切れ
Square認証切れ
browser login
MFA

を理由に作業を停止する状況自体を作らない。

既存credentialが偶然利用可能でも、
今夜のscopeではVercel/Square external activationに使用しない。

ブラウザ:
0

Playwright:
0

external provider requests:
0

━━━━━━━━━━━━━━━━━━
3. GIT SOURCE OF TRUTH
━━━━━━━━━━━━━━━━━━

最初に:

git fetch origin --prune
git rev-parse HEAD
git rev-parse origin/codex/external-acceptance-p6
git rev-parse origin/main
git status --short --branch

を確認。

remoteがexpectedから進んでいれば、
GitHub最新状態を正本としてreconcileする。

force push禁止。

reset --hard禁止。

git cleanによるunknown file削除禁止。

unknown local changesを破壊しない。

GitHub push認証が通常どおり使える限りpushする。

もしGitHub pushだけが認証切れで不可能になった場合:

- browser loginを開始しない
- local実装を止めない
- 全実装・テストを最後まで完了
- local commitまで作る
- exact SHAを記録
- PUSH_PENDING_AUTHとして最終記録を残す

GitHub auth問題を理由に途中で実装を放棄しない。

━━━━━━━━━━━━━━━━━━
4. AUTHORITY RECORD
━━━━━━━━━━━━━━━━━━

最初に作成:

docs/execution/PRODUCTION_P6_S4_LOCAL_AUTHORITY.md

current headers/status:

AGENTS.md
CLAUDE.md
docs/execution/SCOPE.md
docs/execution/PRODUCTION_P6_STATUS.json

を必要最小限更新。

R4〜R10 historical evidenceは変更禁止。

authority commitを先にpushできる場合はpush/readback。

push auth unavailableならlocal commitで継続。

━━━━━━━━━━━━━━━━━━
5. R11 PURPOSE
━━━━━━━━━━━━━━━━━━

次の本体実装:

Square Sandbox / future Production双方に再利用可能な

Webhook Receiver
+
Durable Webhook Inbox

を実装する。

ただし今夜はexternal activationしない。

実装対象:

A.
raw-body signature verification boundary

B.
payment.created / payment.updated receiver

C.
durable inbox schema

D.
duplicate event handling

E.
out-of-order safe design

F.
fast ACK semantics

G.
future reconciliation boundary

H.
tests

I.
activation gate documentation

━━━━━━━━━━━━━━━━━━
6. EXISTING CODE TO REUSE
━━━━━━━━━━━━━━━━━━

既存:

packages/core/src/payment/square-boundary.ts

の:

verifySquareWebhook

parseVerifiedSquareWebhook

を優先再利用する。

既存仕様:

HMAC-SHA256

notification URL
+
unmodified raw request body

signature header:

x-square-hmacsha256-signature

constant-time comparison

raw body size limit

を保持する。

generic crypto独自仕様へ置換しない。

Square SDK追加は不要。

新dependency追加を原則避ける。

━━━━━━━━━━━━━━━━━━
7. WEBHOOK RECEIVER CONTRACT
━━━━━━━━━━━━━━━━━━

Next.js routeを実装する。

final pathはrepo構造を見てCodexが決定。

推奨:

POST /api/webhooks/square

POST only。

GET:
405

UI link:
なし

sitemap:
なし

prefetch:
なし

browser依存:
なし

request.json()をsignature verification前に使わない。

必ずraw bytes/raw textを一度取得し、
その同一raw bodyをsignature検証へ渡す。

raw body全文をlogしない。

━━━━━━━━━━━━━━━━━━
8. REQUIRED ENV CONTRACT
━━━━━━━━━━━━━━━━━━

runtimeで将来必要:

SQUARE_SANDBOX_WEBHOOK_SIGNATURE_KEY

SQUARE_SANDBOX_NOTIFICATION_URL

または将来的なenvironment-specific同等key。

ただし今夜:

env作成:
0

Vercel env mutation:
0

secret取得:
0

secret表示:
0

.envへの実secret追加:
0

実装はenv未設定時:

fail closed

する。

buildはsecretなしでも成功する構成にする。

秘密値がbuild-time必須になる設計は禁止。

━━━━━━━━━━━━━━━━━━
9. SIGNATURE VALIDATION
━━━━━━━━━━━━━━━━━━

処理順序:

1.
raw request body取得

2.
body size limit

3.
signature header取得

4.
configured notification URL + signature keyで
HMAC-SHA256 verification

5.
verification PASS後のみJSON parse

6.
merchant/event/payment identity検証

7.
durable inbox insert

8.
insert成功後のみ2xx ACK

signature fail:

403

DB write:
0

raw body log:
0

signature value log:
0

━━━━━━━━━━━━━━━━━━
10. ACCEPTED EVENTS
━━━━━━━━━━━━━━━━━━

今回receiverが処理対象とするevent:

payment.created

payment.updated

のみ。

Square-Version:

現行採用:
2026-08-19

eventには最低限:

event_id
merchant_id
type
payment.id

を要求。

merchant:

MLKDVEDH1ME21

と一致必須。

別merchantのsigned eventを正常処理しない。

payment event以外については、
将来subscription scopeを限定する前提で
安全なignore contractを定義する。

無限retryを生む設計にしない。

具体的HTTP semanticsはtestsとdocsへ明文化する。

━━━━━━━━━━━━━━━━━━
11. DURABLE INBOX MIGRATION
━━━━━━━━━━━━━━━━━━

external DBへ接続せず、
repo migrationだけ追加してよい。

現branchのmigration順を確認し、
次のadditive migrationとして実装する。

想定名:

packages/db/migrations/0025_square_webhook_inbox.sql

ただし実repo上のlatest migration番号を確認してから決定。

schemaは少なくとも以下を満たす:

Square event_id:
unique / durable dedupe key

event_type

merchant_id

payment_id

body_sha256

received_at

processing/reconciliation state

retry metadata:
nullable / bounded

processed/reconciled timestamp:
nullable

raw body:
保存しない

signature:
保存しない

access token:
保存しない

card data:
保存しない

認証header:
保存しない

PUBLIC privileges:
revoked

application roleには必要最小限。

既存DB security conventionsへ合わせる。

━━━━━━━━━━━━━━━━━━
12. DUPLICATE SEMANTICS
━━━━━━━━━━━━━━━━━━

Square event_idをidempotency keyとして扱う。

初回:

event_id + body hash
をdurably insert

duplicate:

same event_id
+
same normalized/body hash

→ duplicate deliveryとして安全に2xx
→ business processingを重複させない

same event_id
+
different hash

→ security/data mismatch

→正常duplicateとして扱わない

→明示分類・監査可能にする

raw bodyそのものは保存しない。

━━━━━━━━━━━━━━━━━━
13. ACK SEMANTICS
━━━━━━━━━━━━━━━━━━

Squareへの2xx ACKは:

signature PASS
+
payload contract PASS
+
durable inbox insert成功

の後だけ。

DB/inbox persistence failure時:

2xxを返さない。

retry可能な5xxへする。

receiver内で以下をしない:

GetPayment
CreatePayment
Refund
booking mutation
inventory mutation
custody mutation
email
SMS

Webhook receiverは軽量に保つ。

provider reconciliationをACK pathへ入れない。

━━━━━━━━━━━━━━━━━━
14. OUT-OF-ORDER DESIGN
━━━━━━━━━━━━━━━━━━

Square webhook delivery orderを信用しない。

payment.created
payment.updated

の受信順をbusiness truthにしない。

event receiptはsignalとして扱う。

event受信だけで:

booking paid
booking confirmed
inventory確定
custody変更

を行わない。

future reconcilerが
provider Paymentをread-only取得し、
最新provider stateを照合してから
business stateへ反映する設計とする。

今夜provider lookup実装を接続しない。

━━━━━━━━━━━━━━━━━━
15. LOCAL RECONCILIATION BOUNDARY
━━━━━━━━━━━━━━━━━━

今夜、external provider callなしで
future reconciliation用のinterface/repository boundaryまで実装してよい。

目的:

durable inbox row
↓
claim
↓
paymentId取得
↓
future provider reconciliation
↓
terminal mark

を安全に表現すること。

必要なら:

RECEIVED
RECONCILING
RECONCILED
FAILED_RETRYABLE
BLOCKED

等のstate contractを設計してよい。

ただしprocess crashで永久lockになる設計を避ける。

可能ならDB transaction /
FOR UPDATE SKIP LOCKED等、
既存repo conventionsに適したclaim patternを実装・fixture化する。

ただし今夜:

actual PostgreSQL connection:
0

actual Square request:
0

business mutation:
0

━━━━━━━━━━━━━━━━━━
16. ROUTE RESPONSE / LOGGING
━━━━━━━━━━━━━━━━━━

responseへsecretやprovider raw dataを出さない。

ログへ出してよい:

event type
event ID
payment ID
merchant match boolean
duplicate boolean
classification
body hash
timestamp

ログ禁止:

raw request body
signature
signature key
Authorization
access token
Cookie
card data
customer PII

可能ならPIIを一切parse/storeしない。

━━━━━━━━━━━━━━━━━━
17. TESTS
━━━━━━━━━━━━━━━━━━

十分なfixture testsを追加。

最低限:

valid signature
invalid signature
missing signature
oversize raw body
malformed UTF-8/JSON
payment.created
payment.updated
wrong merchant
missing event_id
missing payment ID
unsupported event
duplicate same event/hash
duplicate event different hash
DB insert failure -> non-2xx
ACK only after durable insert
out-of-order delivery
retry header present/absent
raw body unchanged signature verification
secret redaction
raw body not logged
Production/Sandbox config separation
missing env fail closed
no provider HTTP during webhook handling
no booking mutation
no inventory mutation
no custody mutation

既存testsを壊さない。

━━━━━━━━━━━━━━━━━━
18. VALIDATION
━━━━━━━━━━━━━━━━━━

実装後:

relevant narrow tests

full relevant suite

secret scan

lint

typecheck

build

を実行。

DB migrationは
既存migration/static schema test方式に従って検証。

external DBへapplyしない。

失敗はscope内で自律修正。

不要なOwner確認を求めない。

━━━━━━━━━━━━━━━━━━
19. NO VERCEL / NO CLOUD TONIGHT
━━━━━━━━━━━━━━━━━━

特に重要。

以下は今夜実行禁止:

vercel deploy
vercel inspect requiring auth
vercel env
vercel pull
vercel link mutation
vercel login
browser Vercel login
Preview creation
Production deploy

Square Developer Console
Sandbox Dashboard
Webhook subscription create/update/delete
signature key取得
notification URL登録
provider test delivery

authが必要になったら止まるのではなく、
その工程を:

ACTIVATION_PENDING_OWNER_LOGIN

として飛ばし、
残りのlocal/GitHub実装を全部続行する。

━━━━━━━━━━━━━━━━━━
20. ACTIVATION GATE
━━━━━━━━━━━━━━━━━━

local implementationがgreenになったら:

docs/execution/PRODUCTION_P6_S4_ACTIVATION_GATE.md

を作る。

次回Ownerが起きた後、
1回のauthorityでlive Sandbox webhook acceptanceまで進められる状態にする。

gateには最低限:

implemented receiver path

required notification URL

required signature key

event scope:
payment.created
payment.updated

Preview env names

protected Preview requirement

Square Sandbox subscription creation steps

real webhook delivery acceptance

duplicate delivery test

out-of-order acceptance approach

durable inbox requirement

ACK timing

safe evidence

cleanup policy

Production still disabled

を明記。

このgateは実行authorityではない。

━━━━━━━━━━━━━━━━━━
21. CURRENT STATUS AFTER LOCAL IMPLEMENTATION
━━━━━━━━━━━━━━━━━━

最終statusは概ね:

phase:
R11_S4_LOCAL_WEBHOOK_IMPLEMENTED_ACTIVATION_PENDING

refund:
LAST_OBSERVED_PENDING
DEFERRED_NON_GATING

S1:
accepted historical

S2:
PASS historical

S3:
NONTERMINAL_DO_NOT_RETRY historical

Webhook receiver:
IMPLEMENTED_LOCAL

durable inbox:
IMPLEMENTED_LOCAL

live webhook subscription:
NOT_CREATED

live webhook delivery:
NOT_RUN

Vercel deploy:
0

Square provider request:
0

external DB:
0

Production:
0

となるよう整合。

━━━━━━━━━━━━━━━━━━
22. COMMITS
━━━━━━━━━━━━━━━━━━

推奨:

1.
docs(p6): authorize local S4 webhook implementation

2.
feat(payment): add durable Square webhook receiver inbox

3.
docs(p6): prepare webhook activation gate

実際の変更構造に合わせ統合可。

canonical branch:

codex/external-acceptance-p6

へpush。

push前remote確認。

force push禁止。

main merge禁止。

new PR禁止。

━━━━━━━━━━━━━━━━━━
23. IF GITHUB AUTH FAILS
━━━━━━━━━━━━━━━━━━

GitHub pushだけがloginを要求した場合:

Ownerを起こさない。

browser loginしない。

全local implementation/test/buildを完了。

local commitを作る。

以下を保存:

docs/execution/p6/R11_PUSH_PENDING.md

内容:

starting remote
local commits
final local HEAD
validation result
exact push command
working tree status

そこでのみ停止。

実装途中では止まらない。

━━━━━━━━━━━━━━━━━━
24. ABSOLUTE PROHIBITIONS
━━━━━━━━━━━━━━━━━━

Refund Get追加
Refund POST追加
CreatePayment
S1 rerun

Vercel deploy/login/env mutation

Square provider API calls

Square subscription mutation

real webhook delivery

external DB connection

Production Square

Production deploy

real customer

real card

booking mutation

inventory mutation

custody mutation

Runner

main merge

new PR

ruleset change

permission expansion

billing expansion

secret rotation

credential extraction

Claude start

Spark start

すべて禁止。

━━━━━━━━━━━━━━━━━━
25. AUTONOMOUS EXECUTION
━━━━━━━━━━━━━━━━━━

Ownerは就寝中。

次について確認を求めない:

file layout
class/function naming
migration details
repository implementation
route design
test design
error enums
status schema
documentation
commit split
lint/type fixes
build fixes

scope内ではCodex parentが自律判断する。

Vercel/Square loginが必要な工程は実行せず、
「Owner待ち」で作業全体を止めない。

local/GitHubで進められる作業を全て完了する。

━━━━━━━━━━━━━━━━━━
26. FINAL REPORT
━━━━━━━━━━━━━━━━━━

完了後にのみ報告。

必須:

Starting HEAD
Authority commit
Implementation commit
Final HEAD
working tree

Webhook:

route
accepted events
signature verification
raw-body behavior
duplicate semantics
ACK semantics

Durability:

migration
inbox schema
dedupe
claim/reconciliation boundary

Validation:

test count
secret scan
lint
typecheck
build

External counts:

Vercel calls requiring auth 0
Preview deploy 0
Square provider request 0
refund calls 0
webhook subscription 0
real webhook delivery 0
external DB 0
Production 0

S4 activation gate:

path

Owner next action:

live Sandbox webhook activation authority

のみ。

Ownerが起きるまで不要に停止せず、
R11/S4 local implementationを最後まで完遂すること。