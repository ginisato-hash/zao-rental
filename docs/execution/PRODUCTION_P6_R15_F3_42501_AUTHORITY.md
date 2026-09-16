【ZAO Rental｜正式Owner Authority
P6 R15 F3 — PostgreSQL 42501 Diagnosis + Minimal Migration Privilege Repair
Existing Neon only / DB-only / Resume Hosted Proof】

私はOwnerとして、この本文を正式な実行authorityとして採用する。

目的:

前回F3 hosted DB proofで発生した

SQLSTATE 42501
insufficient_privilege

の原因を、既存Neon development DB上で安全に特定し、
原因がmigration ownerのpublic schema CREATE不足であることが
実証された場合だけ最小権限修正を行い、
hosted migration / role / permission proofを再開する。

新resource作成は禁止。

Vercel/Square/webhook/paymentへは進まない。

━━━━━━━━━━━━━━━━━━
0. SOURCE OF TRUTH
━━━━━━━━━━━━━━━━━━

repo:
ginisato-hash/zao-rental

branch:
codex/external-acceptance-p6

expected remote HEAD:

be1520b7acd7ad58e64d47022e3a82842af02b29

main:

3061dbbbe00294e5baebba2405028c907d6e6e85

開始時:

git fetch origin --prune
git rev-parse HEAD
git rev-parse origin/codex/external-acceptance-p6
git rev-parse origin/main
git status --short --branch
git worktree list --porcelain

remoteが進んでいた場合は
expected SHAへ戻さずGitHub最新を正本としてreconcile。

force push禁止。
reset --hard禁止。
unknown work削除禁止。

single writer維持。

━━━━━━━━━━━━━━━━━━
1. HISTORICAL FAILURE — PRESERVE
━━━━━━━━━━━━━━━━━━

前回結果:

HOSTED_DB_PROOF_FAIL

existing Neon resource:

store_i5vh0ZEKo2ikcVo9

development DB:

zr_852b20c4d4b0

credential acquisition:

1/1 PASS

migration invocation:

1

result:

SQLSTATE 42501
insufficient_privilege

applied migrations:

0

rollback:

confirmed

runtime roles:

0

secret exposure:

0

この履歴を書き換えない。

前回migration invocationを
「無かったこと」にしない。

今回許可するmigration executionは、
原因確認・必要な最小修正後の
新しいbounded reattempt最大1回。

累計migration invocationは
成功時でもhistorical1 + new1 = 2。

━━━━━━━━━━━━━━━━━━
2. FIRST RECORD NEW AUTHORITY
━━━━━━━━━━━━━━━━━━

最初に:

docs/execution/PRODUCTION_P6_R15_F3_42501_AUTHORITY.md

へこのauthorityを保存。

current statusも必要最小限更新。

commit:

docs(r15): authorize bounded 42501 diagnosis and hosted DB proof resume

push / remote readback後にDBへ進む。

━━━━━━━━━━━━━━━━━━
3. EXTERNAL BUDGET
━━━━━━━━━━━━━━━━━━

今回許可:

existing resource credential reacquisition:
max 1 logical acquisition

read-only PostgreSQL metadata queries:
finite

rollback-only DDL privilege probe:
max 1

public schema privilege repair:
max 1
conditional only

migration reattempt:
max 1

role provisioning:
max 1 set
migration PASSの場合のみ

hosted positive/negative tests:
finite
migration/role PASSの場合のみ

F3 Claude review:
existing authorized slot max1
hosted proof PASS後のみ

禁止:

new Neon resource:
0

new development DB:
0

database recreation:
0

plan/billing mutation:
0

terms acceptance:
0

Vercel env mutation:
0

Vercel deploy:
0

Square calls:
0

subscription:
0

webhook:
0

CreatePayment:
0

GetPayment:
0

refund:
0

Production:
0

main merge:
0

Avatar:
0

━━━━━━━━━━━━━━━━━━
4. CREDENTIAL REACQUISITION
━━━━━━━━━━━━━━━━━━

前回credentialはcleanup済みなので、
既存resourceへのcredential reacquisitionを
今回最大1 logical attemptだけ承認する。

同じresource:

store_i5vh0ZEKo2ikcVo9

のみ。

既存browser/sessionが安全に利用可能なら使用してよい。

login/MFAが本当に必要な場合のみOwnerへ依頼。

login callback中は:

raw URL取得禁止
page title dump禁止
accessibility snapshot禁止
cookie/storage/token取得禁止

credential valueを:

terminal
stdout
stderr
chat
Git
evidence
argv
shell history

へ出さない。

可能ならRAM内だけでPostgres clientへ渡す。

━━━━━━━━━━━━━━━━━━
5. READ-ONLY OWNERSHIP DIAGNOSIS
━━━━━━━━━━━━━━━━━━

migrationを実行する前に、
保持済み空DB:

zr_852b20c4d4b0

へ接続して以下をread-only確認。

秘密値は保存しない。

最低限:

current_user

database owner

public schema owner

current_user is database owner:
boolean

current_user membership / effective relationship to pg_database_owner:
boolean

has_schema_privilege(
  current_user,
  'public',
  'USAGE'
)

has_schema_privilege(
  current_user,
  'public',
  'CREATE'
)

has_database_privilege(
  current_user,
  current_database(),
  'CREATE'
)

rolcreatedb

rolcreaterole

rolsuper

search_path

public schema ACL classification

保存はsafe metadataのみ。

role名は必要最小限。
password/connection stringは0。

━━━━━━━━━━━━━━━━━━
6. INTERPRETATION
━━━━━━━━━━━━━━━━━━

CASE A:

has_schema_privilege(current_user,'public','CREATE') = false

かつ

current credentialが
今回のmigration/setup ownerとして取得された
正当なtrusted setup roleであることが確認できる

→
PUBLIC schema CREATE不足を
42501 primary cause candidateとして扱う。

CASE B:

public CREATE = true

→
schema CREATE不足と断定しない。

後述のrollback-only diagnosticへ進む。

CASE C:

database/schema ownershipが想定外、
current roleがmigration ownerとして不整合、
unknown membership/driftがある

→
BLOCKED_NEON_OWNER_ROLE_MISMATCH

permission変更0
migration再実行0
Claude0
stop。

━━━━━━━━━━━━━━━━━━
7. ROLLBACK-ONLY DDL PROBE
━━━━━━━━━━━━━━━━━━

migration再実行前に
最大1回だけ以下と同等のprobeを許可する。

BEGIN;

CREATE TABLE public.<unique_safe_probe_name> (
  id integer
);

ROLLBACK;

目的:

public schemaへのCREATE capabilityだけを確認。

probe tableは永続化0。

probe名以外のbusiness object作成禁止。

CASE:

CREATE TABLEが42501

→
public schema CREATE不足を実証。

CASE:

CREATE TABLE成功

→
ROLLBACK確認後、
public CREATE不足ではない。

次のmigration diagnosticへ進む。

━━━━━━━━━━━━━━━━━━
8. ONLY ALLOWED PRIVILEGE REPAIR
━━━━━━━━━━━━━━━━━━

public CREATE不足が
catalog + rollback probeの両方で実証された場合だけ、

exact migration/setup owner roleへ

CREATE ON SCHEMA public

を付与してよい。

意図は以下と同等:

GRANT CREATE ON SCHEMA public
TO <exact migration owner role>;

重要:

GRANT ALL禁止。

PUBLICへのCREATE grant禁止。

runtime roleへのCREATE grant禁止。

SUPERUSER付与禁止。

ALTER ROLE ... SUPERUSER禁止。

CREATEDB/CREATEROLEの追加変更禁止。

role membership追加禁止。

ALTER DATABASE OWNER禁止。

ALTER SCHEMA OWNER禁止。

SET ROLEによる権限迂回禁止。

Neon管理roleの改変禁止。

既にUSAGEがある場合はUSAGEを触らない。

grant実行後:

has_schema_privilege(...,'CREATE') = true

だけを確認。

このmigration ownerはruntime credentialではなく、
migration専用trusted roleとして扱う。

━━━━━━━━━━━━━━━━━━
9. IF PUBLIC CREATE PROBE SUCCEEDS
━━━━━━━━━━━━━━━━━━

public CREATE capabilityが既にtrueの場合、
migrationをいきなり再実行しない。

rollback-only diagnostic harnessを使用して
42501の発生phaseを特定する。

product migration sourceは変更しない。

診断では:

BEGIN
foundation_migrations prelude
migration 0001
migration 0002
...
latest

を順に評価し、

必ず最終ROLLBACK。

failure時に保存してよいのは:

phase
migration ID
SQLSTATE
safe operation class

例:

CREATE_TABLE
CREATE_SCHEMA
CREATE_FUNCTION
ALTER
GRANT
REVOKE

だけ。

raw SQL全文保存は不要。

secret0。

persistent migration0。

42501となるexact phase/migrationを取得したら停止。

このauthorityでは
public CREATE以外の新しいpermission escalationは
自動修正しない。

結果:

BLOCKED_42501_OTHER_PRIVILEGE

としてGitHubへ保存し、
ChatGPTへ返す。

━━━━━━━━━━━━━━━━━━
10. MIGRATION REATTEMPT
━━━━━━━━━━━━━━━━━━

public CREATE不足が実証され、
Section 8の限定grantが成功した場合のみ、

canonical:

migrateHostedDevelopment

を最大1回再実行してよい。

source:

0001 through current exact latest

現時点想定0030。

実行前にmigration hashes再確認。

過去migrationを編集しない。

migration runnerを迂回しない。

migrationが再度失敗した場合:

retry0

追加grant0

ad-hoc修正0

resource/database recreation0

safeに:

migration ID
SQLSTATE
operation classification

を今回は必ず保持して停止。

━━━━━━━━━━━━━━━━━━
11. MIGRATION SUCCESS PATH
━━━━━━━━━━━━━━━━━━

migration PASS時だけ、
元F3 hosted-proof authorityの残りを再開。

six-role model:

migration/setup owner
receiver
dispatcher
reconciliation worker
projection worker
diagnostic read-only

をcurrent canonical implementationで1 set作成。

GRANT ALL禁止。
PUBLIC expansion禁止。

その後:

hosted positive tests
hosted negative permission tests
R15 operation guard hosted tests

を実行。

Square/provider callは0。

━━━━━━━━━━━━━━━━━━
12. REQUIRED HOSTED TESTS
━━━━━━━━━━━━━━━━━━

最低限:

receiver intended insert:
PASS

receiver booking mutation:
DENIED

receiver inventory mutation:
DENIED

dispatcher arbitrary business mutation:
DENIED

worker approved interface:
PASS

worker arbitrary booking/inventory:
DENIED

projector approved interface:
PASS

projector R12 internals arbitrary mutation:
DENIED

diagnostic read:
PASS

diagnostic write:
DENIED

PUBLIC internal tables:
DENIED

PUBLIC privileged function EXECUTE:
DENIED

SECURITY DEFINER:
fixed search_path

manifest direct access:
DENIED from runtime roles

reservation table direct mutation:
DENIED

approved reserve function:
intended role only

duplicate reservation:
blocked

concurrent reservation:
one winner

new connection/process:
reservation persists

━━━━━━━━━━━━━━━━━━
13. TEST CREDENTIAL CLEANUP
━━━━━━━━━━━━━━━━━━

hosted role tests終了後:

test-only login credentialsはfuture runtime credentialとして
再利用しない。

可能ならNOLOGIN化またはrotate/invalidate。

migration owner credential:
Vercelへ置かない。

runtime credential:
Vercelへまだ置かない。

今回Vercel mutation:
0。

━━━━━━━━━━━━━━━━━━
14. EVIDENCE
━━━━━━━━━━━━━━━━━━

既存:

docs/execution/p6/r15-hosted-db-proof/

はhistorical failureとして保持。

今回新規:

docs/execution/p6/r15-hosted-db-proof-42501-resume/

等へ分離。

最低限:

AUTHORITY.md
ownership-diagnosis.json
ddl-probe.json
privilege-repair.json
migration-reattempt.json
roles-result.json
positive-tests.json
negative-tests.json
guard-tests.json
credential-handling.json
cleanup.json
FINAL_RESULT.md

secret0。

━━━━━━━━━━━━━━━━━━
15. F3 CLAUDE REVIEW
━━━━━━━━━━━━━━━━━━

以下が全てPASSした場合のみ:

migration
roles
positive tests
negative tests
hosted guard tests
secret handling
cleanup

証拠をcommit/push/readback。

そのexact proof HEADに対して、
既に承認済みの

F3_HOSTED_PROOF_REVIEW

slotを1回だけ使用。

現在:

initial 1/1
correction 1/1
F3 hosted proof 0/1
post-live final 0/1

F3 reviewを実行した場合:

F3 hosted proof 1/1

post-live finalは0/1のまま維持。

追加review budgetは作らない。

Claudeにはsanitized evidenceのみ。

secret/provider/browser access禁止。

━━━━━━━━━━━━━━━━━━
16. REVIEW RESULT
━━━━━━━━━━━━━━━━━━

Claude review:

REVIEW_PASS
CHANGES_REQUIRED
INCOMPLETE

を誘導せず保存。

F3が解消された場合でも:

R15 live PASS

とはしない。

許される分類は:

F3_HOSTED_DB_PROOF_ACCEPTED

相当まで。

Vercel/Square/webhook/payment acceptanceは
別gate。

━━━━━━━━━━━━━━━━━━
17. STOP CONDITIONS
━━━━━━━━━━━━━━━━━━

以下では即停止:

credential reacquisition failure

owner/schema mismatch

public CREATE以外の42501

privilege grant失敗

migration reattempt失敗

unexpected migration partial state

role provisioning failure

negative permission test failure

secret exposure疑い

unexpected paid/billing/terms flow

この場合Claude reviewは起動しない。

━━━━━━━━━━━━━━━━━━
18. SUCCESS STOP
━━━━━━━━━━━━━━━━━━

Hosted proof + F3 independent review完了後も
必ず停止。

Vercel deploy:
0

Square:
0

webhook:
0

payment:
0

次はChatGPT Technical Directorが
R15 live continuationを設計する。

━━━━━━━━━━━━━━━━━━
19. FINAL REPORT
━━━━━━━━━━━━━━━━━━

最後にのみ報告:

Starting HEAD
Authority commit
Proof commit
Final HEAD
working tree
remote readback

credential reacquisition:
count/result

database owner relationship

public CREATE before:
true/false

DDL probe:
PASS/42501

privilege repair:
NOT_NEEDED
or
CREATE_ON_PUBLIC_TO_MIGRATION_OWNER_ONLY

other privilege mutation:
0

migration historical invocation:
1 FAIL

new migration invocation:
0 or 1

migration result/range

roles result

positive test count

negative test count

guard test count

secret exposure:
0

new Neon resource:
0

new DB:
0

Vercel:
0

Square:
0

payment:
0

webhook:
0

F3 Claude review:
0/1 or 1/1

F3 disposition

next exact gate

━━━━━━━━━━━━━━━━━━
20. CRITICAL
━━━━━━━━━━━━━━━━━━

42501をgreenにするために
権限を広げるのではない。

まず原因を証明する。

public CREATE不足なら:

migration ownerだけに
CREATE ON SCHEMA public

という最小修正だけ許可。

PUBLIC
runtime roles
SUPERUSER
role memberships
database ownership

は触らない。

別原因ならその場で停止する。

保持済み空DBを使い、
resource/databaseを作り直さず、
R15 F3 proofを継続する。