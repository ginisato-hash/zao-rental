【ZAO Rental｜正式Owner Authority
P6 R15 COMPLETION — Simplified One-Pass Execution
Hosted DB → Webhook → Sandbox 100 JPY E2E → Final Independent Review】

私はOwnerとして、この本文を正式な実行authorityとして採用する。

目的は、R15を安全境界内で最後まで完了させること。

これまでR15途中で増えた、

- credential parserごとのOwner gate
- F3だけの中間review gate
- DB proofだけを目的化した細分化
- parser自体の過剰なhardening

をここで終了する。

Permanent AI Role Model自体は維持するが、
R15内のexecution sequencingはこのOwner指示で簡素化する。

R15の残工程は:

A. Hosted Neon DB完成
B. Dedicated webhook ingress完成
C. Square Sandbox signed webhook
D. 100 JPY synthetic payment E2E
E. cleanup
F. 最終Claude independent review

のみ。

安全境界内ではCodex parentが自立実行し、
不要な中間Owner確認をしない。

人間が必要なのは原則:

- password
- MFA
- email verification
- secretの手動入力
- billing/terms consent

だけ。

━━━━━━━━━━━━━━━━━━
0. SOURCE OF TRUTH
━━━━━━━━━━━━━━━━━━

repo:

ginisato-hash/zao-rental

branch:

codex/external-acceptance-p6

expected current remote HEAD:

2544261efafdc98741dd55cab278b859bc4c7f2b

main:

3061dbbbe00294e5baebba2405028c907d6e6e85

開始時:

git fetch origin --prune
git rev-parse HEAD
git rev-parse origin/codex/external-acceptance-p6
git rev-parse origin/main
git status --short --branch
git worktree list --porcelain

remote advance時は古いSHAへ戻さない。
最新GitHubを正本としてreconcile。

force push禁止。
reset --hard禁止。
unknown work削除禁止。

single writer維持。

━━━━━━━━━━━━━━━━━━
1. THIS AUTHORITY SUPERSEDES INTERMEDIATE R15 GATES
━━━━━━━━━━━━━━━━━━

以下のhistorical結果は保持する:

R7 security incident
R10 nonterminal refund history
R14 PARTIAL
R15 initial review
R15 correction review
F3 HIGH history
42501 migration failure
local credential handoff failure

歴史を書き換えない。

ただし今後のR15 executionについて、

F3 hosted proofを
「独立したpre-live review gate」

として扱うことを終了する。

F3は:

Hosted DBを実際に完成させ、
その証拠を最終R15 reviewへ含める

ことで解決する。

F3専用Claude slot:

廃止 / 未使用のまま終了。

post-live final Claude review:

1回だけ残す。

今回、途中Claude reviewは禁止。

━━━━━━━━━━━━━━━━━━
2. CORE SAFETY BOUNDARIES
━━━━━━━━━━━━━━━━━━

絶対に維持する境界は以下。

Production Square:
0

real customer:
0

real card:
0

real booking:
0

real inventory/custody:
0

main Production deploy:
0

main merge:
0

secret in Git:
0

secret in logs:
0

secret in chat:
0

CreatePayment:
exactly max 1 logical Sandbox payment

automatic retry:
0

UNKNOWN CreatePayment:
DO_NOT_RETRY

GetPayment:
max 1 for the accepted R15 payment

refund:
0

GetRefund:
0

new Neon resource:
0

paid Neon:
0

billing upgrade:
0

━━━━━━━━━━━━━━━━━━
3. EXISTING NEON — REUSE ONLY
━━━━━━━━━━━━━━━━━━

existing resource:

store_i5vh0ZEKo2ikcVo9

plan:

free_v3 / Free

retained development DB:

zr_852b20c4d4b0

前回状態:

empty
migration applied 0
runtime roles 0

このDBをそのまま使用。

new resource:
0

new database:
0

database recreation:
0

━━━━━━━━━━━━━━━━━━
4. STOP BUILDING CUSTOM CREDENTIAL PARSERS
━━━━━━━━━━━━━━━━━━

重要。

Neon credential取得のために
新しいbrowser DOM parser、
snippet parser、
custom handoff frameworkを
これ以上作らない。

前回のBLOCKED_LOCAL_CREDENTIAL_HANDOFFは
ローカルtooling失敗であり、
Neon provider failureではない。

もっと単純な方法を採用する。

Ownerが必要な場合のみ一度だけ
Neon ConnectからDirect connection stringを取得する。

値をchatへ貼らせない。

repo外に一時secret fileを使う。

推奨:

~/.secrets/zao-rental-r15.pguri

Codex側で:

mkdir -p ~/.secrets
chmod 700 ~/.secrets

を準備してよい。

Ownerへ必要な場合だけ:

「Neon ConnectのDirect connection stringを
~/.secrets/zao-rental-r15.pguri
へ貼り付けて保存してください」

と依頼。

secret値をCodex出力へ貼らせない。

file permission:

chmod 600

Codexは:

cat
head
grep
echo
print
console.log

等で値を表示しない。

Node process内でのみreadFileし、

new URL(...)

でparseしてpg configを構成。

shell argv:
secret 0

shell env export:
原則0

Git:
0

evidence:
0

終了時file削除。

━━━━━━━━━━━━━━━━━━
5. NEON CONNECTION RULE
━━━━━━━━━━━━━━━━━━

secret URIからメモリ内で:

host
port
username
password
ssl parameters

を使用。

provider URIがneondbを向いていても
target DBは明示的に:

zr_852b20c4d4b0

へ差し替える。

raw URIを書き換えた新ファイルは作らない。

TLS:
rejectUnauthorized true相当

non-loopback Neon hostのみ許可。

接続できなければ、
原因分類を安全に出して停止。

同じsecret acquisitionを
何度もやり直さない。

━━━━━━━━━━━━━━━━━━
6. FIRST GOAL — MAKE HOSTED DB WORK
━━━━━━━━━━━━━━━━━━

ここからはF3のためではなく、
R15 E2Eに必要なDB infrastructure完成が目的。

まずread-only確認:

current_user
current_database
database owner
public schema owner
has_schema_privilege current_user/public USAGE
has_schema_privilege current_user/public CREATE
rolcreatedb
rolcreaterole
rolsuper
search_path
current migrations
existing runtime roles

secretは保存しない。

unexpected partial stateがあれば停止。

期待:

migration0
runtime roles0

━━━━━━━━━━━━━━━━━━
7. DIAGNOSE THE HISTORICAL 42501 ONCE
━━━━━━━━━━━━━━━━━━

前回42501はexact migrationが保存されなかった。

今回は必ずmigration runner側でsafe diagnosticを残す。

migration source自体は変更しない。

0001〜0030:

byte/hash確認。

migration開始前に:

current migration ID

だけを内部でtracking。

failure時に保存:

migrationId
SQLSTATE
safe operation category

のみ。

例:

CREATE_TABLE
CREATE_SCHEMA
CREATE_FUNCTION
ALTER
GRANT
REVOKE

raw secret:
0

不要ならraw SQL全文も保存しない。

━━━━━━━━━━━━━━━━━━
8. MIGRATION OWNER IS ADMINISTRATIVE
━━━━━━━━━━━━━━━━━━

migration/setup credentialを
runtime least-privilege roleと混同しない。

migration ownerは:

schema
table
function
role
grant

をセットアップする管理role。

アプリが常時使うcredentialではない。

重要なのは:

runtime rolesがleast privilege

であること。

migration ownerを必要以上に弱くして
migration自体を不可能にする必要はない。

ただし:

SUPERUSER追加禁止
Neon system role改変禁止
PUBLICへ広範grant禁止
GRANT ALL禁止

━━━━━━━━━━━━━━━━━━
9. PUBLIC SCHEMA CREATE
━━━━━━━━━━━━━━━━━━

もし:

has_schema_privilege(current_user,'public','CREATE') = false

かつrollback-only:

BEGIN
CREATE TABLE public.<probe>(id integer);
ROLLBACK

が42501なら、

exact migration/setup ownerにのみ:

GRANT CREATE ON SCHEMA public TO <setup role>;

を許可。

PUBLIC:
grant 0

runtime role:
grant 0

GRANT ALL:
0

owner変更:
0

role membership拡張:
0

この最小grant後、
canonical migrationを実行。

━━━━━━━━━━━━━━━━━━
10. OTHER 42501
━━━━━━━━━━━━━━━━━━

public CREATEが既に可能なら、
migrationをblind retryしない。

transaction rollback diagnosticで
42501のexact migration IDを特定。

もし別権限が原因なら、
Codexはその場で以下を判断。

A.
Neonでmigration/setup ownerに通常必要な
administrative privilegeであり、
runtime securityを弱めない最小修正

→
local source/docsを確認し、
必要最小限で修正してよい。

B.
SUPERUSER / provider system role / ownership takeover /
PUBLIC expansion等が必要

→
停止。

重要:

単純なNeon compatibility/setup問題で
Ownerへ細かく戻さない。

security boundaryを広げる必要がある時だけ停止。

━━━━━━━━━━━━━━━━━━
11. MIGRATIONS
━━━━━━━━━━━━━━━━━━

canonical:

migrateHostedDevelopment

を使用。

0001〜0030
exact current migration plan。

historical migration invocation1 FAILは保持。

今回のcompletion authorityでは、
診断後のmigration再実行を最大1 successful logical run許可。

同じ失敗をblind retryしない。

migration PASS後:

foundation_migrations
30 rows expected

schema/tables/functions/indexes
をsafe metadata確認。

━━━━━━━━━━━━━━━━━━
12. CREATE THE SIX RUNTIME ROLES
━━━━━━━━━━━━━━━━━━

migration PASS後、
既存canonical implementationで:

migration/setup owner
receiver
dispatcher
reconciliation worker
projection worker
diagnostic read-only

を構成。

runtime rolesはleast privilege。

PUBLIC privilege expansion禁止。

positive + negative tests実行。

重要negative:

receiver:
booking/inventory mutation不可

dispatcher:
arbitrary business mutation不可

worker:
arbitrary booking/inventory mutation不可

projector:
R12 internals arbitrary mutation不可

diagnostic:
write不可

PUBLIC:
internal payment tables不可
privileged functions不可

manifest/reservation tables:
direct runtime mutation不可

SECURITY DEFINER:
fixed search_path

━━━━━━━━━━━━━━━━━━
13. R15 OPERATION GUARD
━━━━━━━━━━━━━━━━━━

Hosted Neon上で0030 durable guard確認。

provider callなし。

最低限:

first reservation PASS

duplicate DENIED

concurrent:
one winner

manifest mismatch:
DENIED

wrong booking:
DENIED

wrong attempt:
DENIED

wrong merchant:
DENIED

wrong location:
DENIED

wrong amount/currency:
DENIED

new connection/process:
reservation persists

CREATE_PAYMENT labelについても
DB guard semanticsを確認。

この時点でSquare CreatePaymentはまだ0。

━━━━━━━━━━━━━━━━━━
14. DB CREDENTIAL HANDLING AFTER TEST
━━━━━━━━━━━━━━━━━━

migration/setup credential:
Vercelへ置かない。

test runtime credentials:
future long-lived runtime credentialとしてそのまま再利用しない。

live E2E用runtime credentialsは
必要時にfreshに生成。

secret valuesをGit/evidenceへ保存しない。

DB proofだけで停止せず、
問題なければ次へ進む。

━━━━━━━━━━━━━━━━━━
15. DEDICATED WEBHOOK INGRESS
━━━━━━━━━━━━━━━━━━

existing project:

zao-rental-webhook-sandbox

を使用。

new project:
0

historical dedicated deploy #1:
failed/deleted

remaining additional deployment budget:
max2

main zao-rental Production deploy:
0

corrected bundled runtime:

runtime.cjs

をexact committed sourceからbuild。

dedicated ingress production targetは:

SANDBOX_WEBHOOK_INGRESS_ONLY

であり、
ZAO Rental customer Productionではない。

━━━━━━━━━━━━━━━━━━
16. INGRESS SECRETS
━━━━━━━━━━━━━━━━━━

dedicated ingressへ置いてよい:

receiver DB credential
SQUARE_SANDBOX_WEBHOOK_SIGNATURE_KEY
SQUARE_SANDBOX_NOTIFICATION_URL
merchant metadata

禁止:

Square access token
main auth secret
customer auth secret
staff auth secret
payment/refund write credential

ingress侵害時にSquare Payment APIを
呼べない構成を維持。

━━━━━━━━━━━━━━━━━━
17. BOOTSTRAP DEPLOY
━━━━━━━━━━━━━━━━━━

corrected ingress deploymentを作成。

signature key未設定時:

/health:
200

POST /api/webhooks/square:
fail closed

2xx禁止。

stable dedicated URL確認。

main project protection:
変更0。

━━━━━━━━━━━━━━━━━━
18. SQUARE SANDBOX WEBHOOK SUBSCRIPTION
━━━━━━━━━━━━━━━━━━

stable URL確認後、

Square Sandbox webhook subscription:

max1

events:

payment.created
payment.updated

API version:

2026-08-19

notification URL:

exact dedicated stable URL
/api/webhooks/square

Production subscription:
0

UNKNOWN:
create再送禁止。

既存のnon-disclosing signature-key handoffを使用。

signature keyを:

stdout
Git
chat
evidence
shell history

へ出さない。

dedicated Vercel Sensitive envへ直接保存。

必要ならfinal ingress redeploy
残budget内max1。

━━━━━━━━━━━━━━━━━━
19. LIVE SIGNED WEBHOOK CHECK
━━━━━━━━━━━━━━━━━━

final ingressで:

/health 200

unsigned POST rejected

bad signature rejected

failed signature DB write0

official Square Sandbox test delivery:
max1

利用可能なら実行。

確認:

real HTTPS
real HMAC
merchant check
durable inbox COMMIT
COMMIT後2xx
raw body non-persistence
signature non-persistence
duplicate protection

official test eventが
GetPayment lookup不能ならreceiver proofだけに使う。

━━━━━━━━━━━━━━━━━━
20. PREPARE SYNTHETIC E2E
━━━━━━━━━━━━━━━━━━

Hosted DBへ完全synthetic fixtureを1件作成。

real customer:
0

example.invalid可。

amount:

100 JPY

valid quote
valid HOLD
gear/wear synthetic claims
booking
payment attempt
merchant/location binding

を整合。

NEW1 LOWをここで解消。

actual:

docs/execution/p6/r15-evidence/payment-operation-manifest.json

を作成。

manifestには:

operation ID
booking ID
attempt ID
merchant
location
100 JPY
Sandbox
branch/head
idempotency key
budgets

等を固定。

secret:
0

manifest source SHA-256を
実fileから計算してverifyするtoolを使用/追加。

DBへinstallされるmanifest hashと
git committed file hashを一致させる。

commit
push
remote readback

後にpaymentへ進む。

━━━━━━━━━━━━━━━━━━
21. MAIN PREVIEW — ONLY IF REQUIRED
━━━━━━━━━━━━━━━━━━

Square access tokenをローカルへ抽出しない。

既存main projectのPreview secretを使う必要がある場合のみ、

protected main Preview:
max1

を許可。

Production:
0

Preview-onlyへ必要なfresh DB runtime credentialsを設定してよい。

Production env mutation:
0

Previewは:

synthetic R15 operator専用
customer routeなし
public credential exposureなし

とする。

不要なら作らない。

━━━━━━━━━━━━━━━━━━
22. CREATEPAYMENT — ONE SHOT
━━━━━━━━━━━━━━━━━━

full E2E準備が全てPASSした後のみ、

Square Sandbox CreatePayment:

exactly max1 logical payment

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

real card:
0

real customer:
0

Production:
0

idempotency:
committed manifest固定

dispatch前:

durable CREATE_PAYMENT reservation

をHosted DBでCOMMIT。

その後だけprovider dispatch。

retry:
0

alternate idempotency key:
0

別paymentでやり直し:
0

UNKNOWN:
DO_NOT_RETRY

━━━━━━━━━━━━━━━━━━
23. WEBHOOK → R12 → R13
━━━━━━━━━━━━━━━━━━

CreatePayment後:

natural Square webhookを待つ。

bounded observationのみ。

追加payment禁止。

durable webhook receipt後:

dispatcher
↓
R12 reconciliation worker
↓
GetPayment max1
↓
provider truth
↓
R13 projection

を実行。

確認:

merchant/location
100 JPY
currency
payment status
booking binding
attempt binding

一致。

webhook payloadだけをbusiness truthとして扱わない。

Square provider truthをauthoritative sourceとして使用。

━━━━━━━━━━━━━━━━━━
24. E2E SUCCESS CRITERIA
━━━━━━━━━━━━━━━━━━

PASS条件:

Hosted Neon migrations PASS

runtime least privilege PASS

signed webhook durable receipt PASS

CreatePayment exactly1

retry0

GetPayment <=1

provider truth verified

R12 finalize PASS

R13 projection exactly once

duplicate/replay safe

booking/payment projected state correct

no real customer/card

secret exposure0

Production0

━━━━━━━━━━━━━━━━━━
25. FAILURE RULES
━━━━━━━━━━━━━━━━━━

以下は止める:

billing/paid upgrade required

new provider contract required

login/MFA required
→ Ownerへ依頼可

CreatePayment UNKNOWN
→ stop, never resend

unexpected real/Production target

secret exposure疑い

DB privilege修正にSUPERUSER/provider system mutationが必要

Square identity mismatch

merchant/location mismatch

migration partial corruption

ただし通常の:

local test failure
build failure
type error
safe code defect
migration diagnostic

はCodexが自律修正して続行。

不要なOwner確認禁止。

━━━━━━━━━━━━━━━━━━
26. EVIDENCE — KEEP IT SMALL
━━━━━━━━━━━━━━━━━━

証拠は必要最小限。

既存historical evidenceを再生成しない。

R15 completion evidenceへ:

DB result
role tests
ingress deployment IDs
subscription safe ID
webhook safe classifications
payment safe ID
request counts
R12 result
R13 result
secret exposure count
cleanup

を保存。

raw provider responses:
保存禁止

credentials:
保存禁止

巨大forensic:
不要。

━━━━━━━━━━━━━━━━━━
27. CLEANUP
━━━━━━━━━━━━━━━━━━

E2E結果保存・push/readback後:

acceptance-only main Preview:
delete

Square Sandbox subscription:
acceptance-onlyならdelete

dedicated ingress:
authority/architecture上必要ならreceiver-onlyで保持可
またはacceptance-onlyならcleanup

temporary local Neon secret file:

~/.secrets/zao-rental-r15.pguri

削除。

DB pools/browser/process:
close

synthetic DB data:
evidenceに必要な最小限のみ保持可

refund:
しない

R10:
触らない。

━━━━━━━━━━━━━━━━━━
28. FINAL CLAUDE REVIEW — ONCE
━━━━━━━━━━━━━━━━━━

途中Claude:
0

F3専用review:
廃止

最後に1回だけClaude。

exact final code/evidence HEADへbind。

Claudeにsanitized packageを渡す。

review対象:

Hosted Neon migration
least privilege
0030 guard
credential handling
ingress isolation
HMAC
durable ACK
subscription
CreatePayment exactly-once
UNKNOWN rule
webhook vs provider truth
GetPayment
R12
R13
projection exactly-once
negative tests
budgets
cleanup
secret exposure

Claude:

tools disabled
MCP disabled
provider disabled
browser disabled
code execution disabled
edit disabled
push disabled

既存Teamのみ。
extra credits OFF。

review結果:

PASS
CHANGES_REQUIRED
INCOMPLETE

をそのまま保存。

追加Claude retry:
0

━━━━━━━━━━━━━━━━━━
29. FINAL STATE
━━━━━━━━━━━━━━━━━━

Claude PASSの場合でも:

main merge:
0

Production GO:
0

ここでR15 terminal checkpoint。

次はChatGPT Technical Directorへ返す。

━━━━━━━━━━━━━━━━━━
30. FINAL REPORT
━━━━━━━━━━━━━━━━━━

最後にのみOwnerへ報告。

必須:

Starting HEAD
Final HEAD
working tree clean
remote readback

Hosted DB:
migration range/result

roles:
positive/negative result

42501:
actual cause
repair if any

Neon resources created:
0

databases created:
0

ingress:
deployment count/result

subscription:
count/result

test webhook:
count/result

CreatePayment:
count
result
payment safe ID

GetPayment:
count/result

R12:
result

R13:
result

projection:
result/count

real customer:
0

real card:
0

Production:
0

secret exposure:
0

temporary secret file:
deleted

Claude final review:
result

BLOCKER/HIGH/MEDIUM/LOW

R15 final classification

next exact gate

━━━━━━━━━━━━━━━━━━
31. OPERATING PRINCIPLE
━━━━━━━━━━━━━━━━━━

これ以降、
安全装置そのものを開発の目的にしない。

安全境界は守るが、
Sandbox development作業を
細かいOwner gateで止めない。

R15の目的は:

「Neonへ安全に接続できること」

ではなく、

ZAO RentalのSandbox環境で:

payment
↓
webhook
↓
provider truth
↓
business projection

まで実際に通ること。

そのE2E完了を最優先にする。

安全境界内は一気通関で自立実行する。