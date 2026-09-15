【ZAO Rental｜正式Owner Authority
P6 R15 — F3 HOSTED DB PROOF GATE
Existing Neon DB-only acceptance + one dedicated independent review】

私はOwnerとして、この本文を正式な実行authorityとして採用する。

これはR16ではない。
現在進行中のP6 R15内で、
独立レビューF3 HIGHのsequencing deadlockを解消するための
限定DB-only gateである。

目的は1つ。

既に作成済みのdevelopment Neon resource上で、

- migrations
- least-privilege roles
- positive/negative permission tests

だけを実行し、
F3に必要な実hosted evidenceを取得する。

このgateでは:

Vercel deploy
Square
webhook
payment
main Preview
Production

へは進まない。

不要な中間Owner確認なしで、
以下の安全境界内はCodex parentが自立実行する。

━━━━━━━━━━━━━━━━━━
0. SOURCE OF TRUTH
━━━━━━━━━━━━━━━━━━

repo:

ginisato-hash/zao-rental

branch:

codex/external-acceptance-p6

expected starting remote HEAD:

de78cafeedb3181c476f2a70dab08169748ae8da

main:

3061dbbbe00294e5baebba2405028c907d6e6e85

開始時に必ず:

git fetch origin --prune
git rev-parse HEAD
git rev-parse origin/codex/external-acceptance-p6
git rev-parse origin/main
git status --short --branch
git worktree list --porcelain

を確認。

remoteが進んでいる場合は
de78cafeへ巻き戻さない。

GitHub最新を正本として
新しい変更を精査してからreconcileする。

force push禁止。
reset --hard禁止。
unknown local work削除禁止。

single writerを維持。

━━━━━━━━━━━━━━━━━━
1. CURRENT REVIEW STATE
━━━━━━━━━━━━━━━━━━

初回independent review:

CHANGES_REQUIRED
HIGH3 / LOW1

correction review:

exact reviewed HEAD:
b541999163ff129cc588960a2c5bf94da61d0cd9

verdict:
CHANGES_REQUIRED

disposition:

F1:
CLOSED for demonstrated GetPayment scope

F2:
CLOSED for static implementation/test scope

F3:
OPEN / HIGH

F4:
LOW retained

NEW1:
LOW

現在のfinal HEAD:

de78cafeedb3181c476f2a70dab08169748ae8da

にはreview後のtest-driver/evidence correctionが含まれる。

これはproduct library意味変更ではないが、
exact final HEAD全体はindependent re-review未実施。

今回のhosted proof reviewで
この差分も併せて確認させる。

━━━━━━━━━━━━━━━━━━
2. WHY THIS EXCEPTION EXISTS
━━━━━━━━━━━━━━━━━━

F3のrequired proofは:

actual hosted Neon上で

- migration apply
- role provisioning
- negative permission verification

を実行しなければ取得できない。

一方で従来Governanceは:

unresolved HIGH中はexternal write禁止

としていた。

これはF3について循環依存になっている。

Ownerは今回、

F3 evidence取得に必要な
既存Neon resourceへの限定DB write

だけを
gate-supporting exception

として明示承認する。

この例外は:

ingress
Vercel
Square
payment
webhook
Production

へのauthorityを発生させない。

━━━━━━━━━━━━━━━━━━
3. REVIEW BUDGET AMENDMENT
━━━━━━━━━━━━━━━━━━

既存review budget:

initial:
1 / 1 consumed

correction:
1 / 1 consumed

post-live final:
0 / 1 reserved

post-live final slotは
絶対に今回使わない。

sequencing deadlock解消専用として、
Ownerは以下を追加する。

F3_HOSTED_PROOF_REVIEW:

maximum:
1

used:
0

用途:

今回取得するhosted Neon evidenceと
その実行に直接関係するexact HEADだけを
Claudeが独立reviewする。

したがってR15総review上限は
今回に限り:

4 starts maximum

となる。

内訳:

1 initial
1 correction
1 F3 hosted proof
1 final post-live

これはbudget resetではない。
cross-phase carryでもない。

今回専用の1枠追加である。

Claude reviewが:

timeout
quota
auth
UNKNOWN

になっても自動再試行しない。

API fallback禁止。
extra credits禁止。
別model reviewer禁止。

━━━━━━━━━━━━━━━━━━
4. EXISTING NEON RESOURCE — FIXED
━━━━━━━━━━━━━━━━━━

使用してよいresourceは既存1件だけ。

resource:

store_i5vh0ZEKo2ikcVo9

plan:

free_v3 / Free

paymentMethodRequired:

false

connected projects:

0
at last verified checkpoint

用途:

ZAO Rental
Sandbox / development acceptance only

禁止:

new Neon resource create
resource duplicate
plan upgrade
billing action
card registration
terms acceptance
Team switching
Production DB
real customer data

resource max1は既に消費済み。

絶対に再作成しない。

━━━━━━━━━━━━━━━━━━
5. EXTERNAL ACTION BUDGET
━━━━━━━━━━━━━━━━━━

今回許可:

existing Neon DB credential acquisition:
maximum 1 bounded acquisition/reconciliation attempt

Hosted DB connection:
必要最小限

migration application:
0001 through current exact latest
現在想定0030まで

database/schema setup:
1 development namespace only

role provisioning:
1 set only

hosted permission tests:
必要な有限回

Claude F3 review:
max1

GitHub commit/push/readback:
許可

今回禁止:

Neon resource create:
0

Neon terms acceptance:
0

paid operation:
0

Vercel project mutation:
0

Vercel env mutation:
0

Vercel deploy:
0

main Preview:
0

dedicated ingress deploy:
0

Square GET:
0

Square POST:
0

subscription:
0

test webhook:
0

CreatePayment:
0

GetPayment:
0

Refund:
0

GetRefund:
0

email/SMS:
0

R2:
0

Runner:
0

main merge:
0

new PR:
0

Avatar change:
0

━━━━━━━━━━━━━━━━━━
6. CREDENTIAL ACCESS — ONE BOUNDED PATH
━━━━━━━━━━━━━━━━━━

historical credential read produced:

403

with safe classification only.

原因を推測しない。

過去のgeneric credential probeを
同じ形で繰り返さない。

今回Ownerは、
既存resourceへ接続してF3証明を行う目的に限り、

exactly one bounded credential acquisition/reconciliation attempt

を承認する。

優先:

Vercel Marketplace / Neonの
provider-supported existing-resource credential handoff

を利用。

条件:

- resource ID exact match
- new resource createしない
- project connectしない
- env pullしない
- Production envへ置かない
- secretをstdoutへ出さない
- terminalへ表示しない
- Gitへ保存しない
- evidenceへ値を書かない
- chatへ出さない
- shell argvへsecretを載せない
- shell historyへ残さない
- debug mode禁止

可能なら:

provider response
↓
process memory
↓
PostgreSQL client

へ直接渡す。

どうしても一時credential stagingが必要なら:

repo外
chmod 600
専用temporary file
single operation only

を許可。

cat/head/grep/echo禁止。

secret valueを一切表示しない。

作業完了後必ず削除。

記録してよいのは:

file path
存在確認
削除確認

だけ。

再度403なら:

BLOCKED_NEON_CREDENTIAL_ACCESS_403

として停止。

二回目のcredential probe禁止。

permission escalation禁止。
account mutation禁止。
Team switch禁止。
terms再操作禁止。

もし通常login/MFAが本当に必要な場合のみ
Ownerへ1回依頼してよい。

login後に同じbounded acquisitionを続行。

━━━━━━━━━━━━━━━━━━
7. PRE-WRITE HOSTED STATE CHECK
━━━━━━━━━━━━━━━━━━

接続できたら最初に
read-only metadataで実DB stateを確認。

secret-free evidenceのみ保存。

最低限:

resource ID match

host classification:
Neon hosted

host must not be:
127.0.0.1
localhost

host suffix/classification:
*.neon.tech equivalent

database identity

current user classification

existing schemas

migration state

existing owned role names

PUBLIC grants

重要:

connection stringそのものは保存しない。

password/user secretは保存しない。

hostnameも必要以上に完全保存せず、
provider classificationやsafe fingerprintでよい。

期待状態:

hosted migrations:
0

ZAO Rental runtime roles:
0

だが、

実状態がこれと異なる場合は
勝手に上書きしない。

partial migration
unexpected roles
unexpected ZAO data
unknown namespace

が存在した場合:

BLOCKED_HOSTED_DB_STATE_DRIFT

として証拠保存して停止。

━━━━━━━━━━━━━━━━━━
8. MIGRATION SOURCE FREEZE
━━━━━━━━━━━━━━━━━━

実行前にrepo内migrationを再列挙。

番号を推測しない。

現在想定:

0001
through
0030

latestが0030であることを
実repoで確認する。

0001〜0029は既存preservation evidenceと
byte/hash一致を確認。

0030:

R15 operation guard additive migration

もexact current source hashを固定。

migration fileを今回編集しない。

既存migrationを書き換えない。

新migration追加:
0

product code change:
0

role policy change:
0

今回の目的は
既存設計をhostedで証明することであり、
設計変更ではない。

━━━━━━━━━━━━━━━━━━
9. HOSTED DEVELOPMENT DATABASE
━━━━━━━━━━━━━━━━━━

既存Neon resource内に、
R15 authorityで意図された
development-only database/namespaceを使用する。

まだ存在しない場合のみ
既存resource内部に1つ作成してよい。

Productionという名称・用途は禁止。

real customer data:
0

synthetic only。

migrationを:

0001
↓
latest exact migration

の正規順序で1回適用。

migration runner:

repo既存のapproved hosted migration pathを使用。

例:

migrateHostedDevelopment

等、
現行repoで正本となっている実装を確認して使用。

ad-hoc SQLでmigrationを再実装しない。

━━━━━━━━━━━━━━━━━━
10. SIX-ROLE MODEL
━━━━━━━━━━━━━━━━━━

Hosted DB上へ
既存R14/R15設計のsix-role modelを再現する。

最低限:

1.
migration/setup owner

2.
receiver role

3.
dispatcher role

4.
reconciliation worker role

5.
projection worker role

6.
diagnostic read-only role

既存repoの:

provisionHostedPaymentRoles

またはcurrent canonical implementationを使用。

GRANT ALL禁止。

PUBLIC privilege expansion禁止。

role nameを勝手に変更しない。

既存role policyを今回再設計しない。

━━━━━━━━━━━━━━━━━━
11. HOSTED POSITIVE TESTS
━━━━━━━━━━━━━━━━━━

negativeだけでなく、
各roleが必要最小限の正当operationを
実行できることも確認。

synthetic fixtureのみ使用。

最低限:

receiver:
approved webhook inbox insert path succeeds

dispatcher:
approved receipt/job signal path succeeds

worker:
approved claim/context/truth finalize interface succeeds

projector:
approved projection interface succeeds

diagnostic:
approved read succeeds

migration/setup owner:
migration/role management succeeds

実business workflow全体を走らせる必要はない。

Square:
0

webhook:
0

provider:
0

純DB contractのみ。

━━━━━━━━━━━━━━━━━━
12. HOSTED NEGATIVE TESTS
━━━━━━━━━━━━━━━━━━

最低限以下を実Neon上で確認。

receiver cannot:
- update booking
- mutate inventory
- execute business projection
- read/change R15 manifest directly
- read/change R15 operation reservation directly

dispatcher cannot:
- arbitrary booking mutation
- arbitrary inventory mutation
- projection
- manifest/reservation direct mutation

reconciliation worker cannot:
- arbitrary booking mutation
- arbitrary inventory mutation
- projection internals outside approved interface
- manifest direct read/write
- reservation table direct write outside approved SECURITY DEFINER interface

projection worker cannot:
- modify R12 internals except approved interface
- arbitrary payment job state mutation
- arbitrary booking/inventory writes outside projection contract

diagnostic cannot:
- INSERT
- UPDATE
- DELETE
- execute mutation functions

PUBLIC cannot:
- read internal payment tables
- read manifest
- read operation reservations
- execute privileged functions

migration owner credential must not be:
- reused as runtime role
- injected into application env
- persisted in Git/evidence

SECURITY DEFINER functionsについて:

search_path fixed
PUBLIC execute revoked
exact intended roles only

を確認。

━━━━━━━━━━━━━━━━━━
13. R15 OPERATION GUARD HOSTED CHECK
━━━━━━━━━━━━━━━━━━

0030に追加されたdurable guardを
実Neon semanticsでも最低限確認。

provider callはしない。

DB-onlyで:

- first reservation succeeds
- duplicate same action fails
- concurrent reservation produces one winner
- manifest mismatch rejects
- wrong booking rejects
- wrong attempt rejects
- wrong merchant rejects
- wrong location rejects
- wrong amount rejects
- wrong currency rejects
- unauthorized role cannot reserve
- reservation survives new DB connection/process

を確認。

CREATE_PAYMENT / GET_PAYMENTは
このDB test上のaction labelとしてのみ扱う。

Square API:
0

actual CreatePayment:
0

actual GetPayment:
0

━━━━━━━━━━━━━━━━━━
14. RUNTIME ROLE CREDENTIAL CLEANUP
━━━━━━━━━━━━━━━━━━

今回runtime credentialsを
Vercelへ設定することは禁止。

permission tests用に作成したruntime login credentialsは
作業後そのまま長期放置しない。

安全に可能なら:

runtime rolesをNOLOGINへ戻す

または

今回のtest credentialが
後続runtime credentialとして再利用できない状態

へする。

ただし:

role
grants
schemas
migrations

は保持してよい。

後続live phaseでは
改めてfresh runtime credentialを発行し、
approved non-disclosing handoffで
所定Vercel project/envへ入れる。

今回のtest passwordを
future production/runtime credentialとして再利用しない。

migration/setup credentialも
application envへ置かない。

━━━━━━━━━━━━━━━━━━
15. SANITIZED EVIDENCE
━━━━━━━━━━━━━━━━━━

新規evidence path例:

docs/execution/p6/r15-hosted-db-proof/

最低限:

authority.md

preflight.json

migration-source-hashes.json

hosted-db-metadata.json

migration-result.json

roles-result.json

positive-tests.json

negative-tests.json

r15-guard-hosted.json

credential-handling.json

cleanup.json

FINAL_RESULT.md

secretは0。

保存禁止:

DB URL
password
connection string
auth header
session token
provider credential
raw provider response

safe保存可:

resource ID
database safe name
role names
migration numbers
hashes
boolean
test name
PASS/FAIL
SQLSTATE classification
safe row counts
provider host classification
timestamps

━━━━━━━━━━━━━━━━━━
16. DB PROOF SUCCESS CRITERIA
━━━━━━━━━━━━━━━━━━

DB-only proof PASS条件:

- exact existing resource used
- no new resource
- Neon hosted identity established
- migrations0001〜latest all applied exactly once
- source hashes verified
- six-role model created
- intended positive operations pass
- all defined negative tests pass
- PUBLIC boundary pass
- SECURITY DEFINER/search_path boundary pass
- R15 durable reservation works on hosted Neon
- no provider/Square/Vercel live action
- secret exposure0
- temporary secret staging removed
- runtime test credentials not left reusable
- safe evidence complete

1つでも重要permission testがfailした場合:

HOSTED_DB_PROOF_FAIL

外部live sequenceへ進まない。

同じ証拠をgreen化するための
resource recreationは禁止。

━━━━━━━━━━━━━━━━━━
17. COMMIT / REMOTE READBACK
━━━━━━━━━━━━━━━━━━

DB proof完了後、

authority + sanitized evidence + current status

だけをcommit。

product/migration sourceを
今回理由なく変更しない。

push:

origin/codex/external-acceptance-p6

force禁止。

remote readbackを確認。

このcommit SHAを
Hosted Proof Reviewのexact target HEADにする。

━━━━━━━━━━━━━━━━━━
18. F3 HOSTED PROOF INDEPENDENT REVIEW
━━━━━━━━━━━━━━━━━━

DB proof evidence保存・push・readback後のみ、
今回追加したClaude slotを最大1回使用。

Claude role:

Independent Design / Code / Evidence Reviewer

review scope:

- existing F3 HIGH
- exact hosted DB evidence
- migration identity/hashes
- actual Neon host classification
- role/grant matrix
- positive tests
- negative permission tests
- SECURITY DEFINER/search_path/PUBLIC
- 0030 hosted reservation semantics
- test credential cleanup
- b541999→de78cafe test-driver/evidence correction
- DB-proof commitまでのexact relevant diff

Claudeへ:

secret
DB URL
password
credential
raw provider response

を渡さない。

tools:
disabled

MCP:
disabled

provider:
disabled

browser:
disabled

code execution:
disabled

edit:
disabled

push:
disabled

review exact full SHAへbind。

━━━━━━━━━━━━━━━━━━
19. REVIEW DECISION RULE
━━━━━━━━━━━━━━━━━━

ClaudeにPASSを要求しない。

レビュー結果:

REVIEW_PASS
CHANGES_REQUIRED
INCOMPLETE

をそのまま保存。

F3 historical HIGHを削除しない。

新reviewでは:

F3 current disposition

を明確にする。

もしhosted proofでF3が解消されたなら:

F3:
RESOLVED_BY_HOSTED_EVIDENCE

相当。

ただし:

R15 live acceptance
webhook acceptance
Square acceptance
payment acceptance

までPASSしたとは書かない。

DB proofだけのPASSである。

NEW1/F4は既存LOWとして保持可能。

新しいBLOCKER/HIGH/MEDIUMが見つかった場合:
外部live sequenceは禁止。

━━━━━━━━━━━━━━━━━━
20. STOP AFTER REVIEW
━━━━━━━━━━━━━━━━━━

重要。

今回のauthorityでは
Hosted Proof Review完了後に必ず停止。

たとえREVIEW_PASSでも:

Vercel deploy:
0

Square subscription:
0

webhook:
0

CreatePayment:
0

GetPayment:
0

へまだ進まない。

理由:

Permanent Governanceの

independent review
↓
ChatGPT cross-system assessment
↓
applicable Owner/live gate

を守るため。

ここは必要な停止であり、
不要な中間停止ではない。

次のlive continuationは
ChatGPT Technical Directorが
review結果を横断評価してから決める。

━━━━━━━━━━━━━━━━━━
21. FAILURE CASES
━━━━━━━━━━━━━━━━━━

CASE A:

credential acquisition 403

→
BLOCKED_NEON_CREDENTIAL_ACCESS_403

再試行0。
Claude reviewは、
hosted proofが存在しないため起動しない。
停止。

CASE B:

unexpected hosted state drift

→
BLOCKED_HOSTED_DB_STATE_DRIFT

writeを開始しない。
Claude起動0。
停止。

CASE C:

migration/role/test failure

→
HOSTED_DB_PROOF_FAIL

safe evidence保存。
不要な再試行禁止。

コード修正が必要なら
このauthority内でproduct codeを変更せず停止。

CASE D:

DB proof PASS

→
commit/push/readback
→
Claude F3 hosted review1回
→
結果保存
→
stop

━━━━━━━━━━━━━━━━━━
22. FINAL REPORT
━━━━━━━━━━━━━━━━━━

最後にのみ報告。

必須:

Starting remote HEAD

DB proof commit HEAD

Final HEAD

working tree clean

remote readback

existing Neon resource:
store_i5vh0ZEKo2ikcVo9

new Neon resources:
0

credential acquisition:
PASS / BLOCKED
attempt count

host classification:
Neon / non-loopback

migrations:
applied range
PASS/FAIL

roles:
six-role model
PASS/FAIL

positive tests:
count/pass/fail

negative tests:
count/pass/fail

R15 hosted guard tests:
count/pass/fail

temporary credential staging:
none
or
deleted yes

reusable test runtime credentials:
disabled / none

Vercel mutation:
0

deploy:
0

Square:
0

payment:
0

webhook:
0

Production:
0

Claude hosted-proof review:
used 0/1 or 1/1

review budget total:

initial 1/1
correction 1/1
F3 hosted proof 1/1 if executed
post-live final 0/1

review verdict

F3 final disposition

BLOCKER/HIGH/MEDIUM/LOW counts

next exact gate

━━━━━━━━━━━━━━━━━━
23. CRITICAL
━━━━━━━━━━━━━━━━━━

今回の目的はR15全体をgreenにすることではない。

目的はただ1つ。

F3が要求していた:

「実Hosted Neon上でleast privilege設計が
本当に成立するか」

を実証すること。

新Neonを作らない。
Vercelへdeployしない。
Squareへ触らない。
paymentしない。
webhookを作らない。

既存resourceだけでDB証拠を完成し、
独立reviewを1回だけ行い、
ChatGPTへ返して停止する。

安全境界内は自立実行し、
password/MFA以外で不要にOwnerを止めない。