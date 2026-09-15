【ZAO Rental｜正式Owner Authority
P6 R15 F3 — Credential Handoff V2 + 42501 Diagnosis Resume
Local parser hardening first / Existing Neon only】

私はOwnerとして、この本文を正式な実行authorityとして採用する。

今回の目的は:

1.
前回失敗したローカルNeon credential handoffを
providerへ再アクセスする前に完全localで修正・検証する。

2.
local handoff V2がPASSした場合のみ、
既存Neon resourceに対して
新しいcredential acquisitionをexactly 1回許可する。

3.
credential取得・DB接続成功後、
未診断のPostgreSQL 42501を
既存authorityの最小権限方針で診断する。

4.
条件を満たせばF3 hosted DB proofまで再開する。

新resource/new DB/Vercel/Square/payment/webhookは許可しない。

安全境界内ではCodex parentが自立実行し、
password/MFA等の人間認証以外で不要にOwnerを止めない。

━━━━━━━━━━━━━━━━━━
0. SOURCE OF TRUTH
━━━━━━━━━━━━━━━━━━

repo:

ginisato-hash/zao-rental

branch:

codex/external-acceptance-p6

expected starting remote HEAD:

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

を確認。

remote advance時は最新GitHubを正本としてreconcile。

force push禁止。
reset --hard禁止。
unknown work削除禁止。

single writer維持。

━━━━━━━━━━━━━━━━━━
1. HISTORICAL STATE — DO NOT REWRITE
━━━━━━━━━━━━━━━━━━

existing Neon:

store_i5vh0ZEKo2ikcVo9

plan:

free_v3 / Free

retained development DB:

zr_852b20c4d4b0

historical migration:

canonical invocation 1
FAIL SQLSTATE 42501
rollback confirmed
applied migrations 0

first hosted proof credential acquisition:

PASS

second 42501-resume credential acquisition:

HTTP200
but
BLOCKED_LOCAL_CREDENTIAL_HANDOFF

今回までのcredential logical attemptsは
歴史として保持。

F3:

OPEN / HIGH

review budget:

initial 1/1
correction 1/1
F3 hosted proof 0/1
post-live final 0/1

今回Claudeはhosted proof PASS後だけ使用可能。

━━━━━━━━━━━━━━━━━━
2. NEW AUTHORITY RECORD
━━━━━━━━━━━━━━━━━━

最初に:

docs/execution/PRODUCTION_P6_R15_F3_HANDOFF_V2_AUTHORITY.md

へこのauthorityを保存。

commit/push/remote readbackしてから続行。

例:

docs(r15): authorize credential handoff v2 and bounded F3 resume

━━━━━━━━━━━━━━━━━━
3. PHASE A — LOCAL HANDOFF V2 ONLY
━━━━━━━━━━━━━━━━━━

provider/browser/DBへ触る前に、
credential handoff実装だけをlocalで修正する。

前回の失敗原因:

UI snippet parser / validationが
HTTP200 responseからusable connection URIを構成できなかった。

前回の具体parse failure conditionは未保存。

したがって推測で1行だけ直さない。

まず既存operator/sourceを特定する。

既存実装がrepo外temporary codeなら、
再現可能なbounded toolとしてrepo内へ昇格してよい。

推奨:

tools/acceptance/r15-neon-credential-handoff.ts

または既存命名規則に沿う同等path。

このtoolだけは今回変更可。

product business code:
変更禁止

migration:
変更禁止

role/grant policy:
変更禁止

R11/R12/R13:
変更禁止

━━━━━━━━━━━━━━━━━━
4. DO NOT PARSE RENDERED UI SNIPPETS
━━━━━━━━━━━━━━━━━━

V2では、人間向けに表示された:

psql "..."
export DATABASE_URL=...
shell code block
copy example
複数行snippet

をregexで解析しない。

取得対象は:

Neon Connect UIの
raw connection-string input / textarea

または
同等のstructured credential fields

だけ。

raw URIのexpected scheme:

postgres://

または

postgresql://

パースは:

new URL(...)

等の標準URL parserを使用。

手書きregexで:

username
password
host
database

を切り出さない。

━━━━━━━━━━━━━━━━━━
5. CONNECTION VALIDATION
━━━━━━━━━━━━━━━━━━

V2 parserはメモリ内で最低限確認:

scheme:
postgres / postgresql only

username:
present

password:
present

hostname:
present

hostname classification:
Neon hosted
non-loopback

host must not be:

localhost
127.0.0.1
::1

Neon host classification:

*.neon.tech
またはその時点のofficial Neon endpoint equivalent

port:

explicit portまたはPostgreSQL defaultを許可

query:

sslmode
channel_binding
その他provider supplied safe params

が存在してもparse失敗にしない。

percent-encoded:

username
password
database

を正しくURL semanticsで扱う。

━━━━━━━━━━━━━━━━━━
6. TARGET DATABASE OVERRIDE
━━━━━━━━━━━━━━━━━━

provider connection stringが:

neondb

等のdefault databaseを指していても、
credential自体が正当なexisting resource roleである限り、
parser failure扱いしない。

接続対象databaseは固定:

zr_852b20c4d4b0

とする。

raw credential URIを文字列置換して保存するのではなく、

parsed config:
host
port
user
password
ssl

をメモリ内に持ち、

databaseのみ:

zr_852b20c4d4b0

へ明示設定してPool/clientへ渡す。

raw modified URIを生成・保存しない。

━━━━━━━━━━━━━━━━━━
7. SECRET-SAFE API
━━━━━━━━━━━━━━━━━━

handoff toolの外部return/outputに
以下を含めてはいけない:

password
connection URI
username if unnecessary
raw snippet
query secret
browser DOM
provider response

success outputは固定safe metadataだけ。

例:

{
  "status": "READY",
  "hostClassification": "NEON_HOSTED",
  "database": "zr_852b20c4d4b0",
  "ssl": true
}

exceptionも固定classificationのみ。

underlying error causeを
そのままthrowしない。

secretを含む可能性のある:

Error.message
stack
cause
stdout
stderr

を外へ流さない。

━━━━━━━━━━━━━━━━━━
8. SAME-PROCESS HANDOFF
━━━━━━━━━━━━━━━━━━

重要。

credential値を:

browser
↓
terminal output
↓
parser
↓
DB

という複数tool経路へ出さない。

単一local Node process内で:

browser automation
↓
DOM raw input value取得
↓
URL parse
↓
validation
↓
pg connection config
↓
PostgreSQL client

まで繋ぐ。

credentialをagent/tool outputへ返さない。

generic browser text dumpを使わない。

credential fieldの値を
Playwright/Codex tool responseへ返さない。

console.log禁止。

trace/HAR/video/screenshot禁止。

debug mode禁止。

clipboard使用禁止。

shell environmentへのexport禁止。

argv禁止。

temp file原則禁止。

━━━━━━━━━━━━━━━━━━
9. SOURCE LIFETIME
━━━━━━━━━━━━━━━━━━

前回の失敗ではparse失敗後にbrowser contextが閉じ、
credentialを再利用できなくなった。

V2では:

credential response received
↓
DOM raw field取得
↓
parse
↓
validation
↓
pg config constructed successfully

まで、
credential source/browser contextを閉じない。

parse failure時だけ:

safe error classification
↓
credential references clear
↓
browser close
↓
STOP

とする。

provider requestを再度行わない。

━━━━━━━━━━━━━━━━━━
10. OFFLINE FIXTURE TESTS — REQUIRED BEFORE LIVE
━━━━━━━━━━━━━━━━━━

実providerへ触る前に
synthetic secretだけでtestsをPASSさせる。

最低限:

1.
postgres://user:password@ep-example.neon.tech/db?sslmode=require

PASS

2.
postgresql://user:password@ep-example.neon.tech/db?sslmode=require

PASS

3.
channel_binding=require等のadditional query

PASS

4.
percent-encoded password

PASS

5.
explicit :5432

PASS

6.
default DBがneondbでも
target override zr_852b20c4d4b0

PASS

7.
localhost

REJECT

8.
non-Neon host

REJECT

9.
missing username

REJECT

10.
missing password

REJECT

11.
malformed URI

REJECT

12.
synthetic passwordが
success outputに含まれない

PASS

13.
synthetic passwordが
failure Error.message/stack/causeに含まれない

PASS

14.
synthetic passwordが
stdout/stderrへ出ない

PASS

15.
parse failure後に
DB client creation count 0

PASS

fixture secretは明確なfake値だけ。

real credentialは使わない。

━━━━━━━━━━━━━━━━━━
11. LOCAL V2 VALIDATION
━━━━━━━━━━━━━━━━━━

最低限:

targeted unit tests
secret scan
lint/typecheck if tool source requires
git diff --check

PASS必須。

全523 tests等を理由なく再実行しない。

handoff source + testsをcommit。

例:

fix(r15): harden Neon credential handoff parser

push/readback。

このcommit後のみlive credential acquisition可。

━━━━━━━━━━━━━━━━━━
12. PHASE B — NEW BOUNDED CREDENTIAL AUTHORITY
━━━━━━━━━━━━━━━━━━

Phase A PASS後だけ、
Ownerは新しく:

existing Neon credential acquisition:
maximum 1 logical attempt

を承認する。

これは前回attemptのretryではなく、
修正済みoperator V2に対する
新しいbounded acceptance attempt。

resource:

store_i5vh0ZEKo2ikcVo9

だけ。

new resource:
0

new DB:
0

connection target:

zr_852b20c4d4b0

だけ。

━━━━━━━━━━━━━━━━━━
13. BROWSER LOGIN
━━━━━━━━━━━━━━━━━━

既存sessionで入れるならそのまま利用。

human login/MFA/email verificationが
本当に必要な場合だけOwnerへ依頼。

login中:

raw URL取得禁止
callback取得禁止
page title dump禁止
accessibility snapshot禁止
cookie/storage/token取得禁止

Owner login後、
resource pageへ到達してから自律再開。

━━━━━━━━━━━━━━━━━━
14. CREDENTIAL ACQUISITION V2
━━━━━━━━━━━━━━━━━━

exact resource:

store_i5vh0ZEKo2ikcVo9

Open in Neon
↓
Connect
↓
raw connection-string field

のみ。

credential HTTP request:

max1

retry:

0

同一取得済みcredentialを
同一process内でparse/consume。

成功条件:

raw field found
URI parsed
Neon host classification PASS
required fields present
target DB override constructed
secret never emitted

ここまでPASSしたら
同じprocessからDBへ接続。

失敗したら:

BLOCKED_CREDENTIAL_HANDOFF_V2

provider request retry0
alternate acquisition0
DB connection0

で停止。

━━━━━━━━━━━━━━━━━━
15. PHASE C — 42501 DIAGNOSIS
━━━━━━━━━━━━━━━━━━

DB接続成功後だけ、
前authorityのownership diagnosisを実行。

read-onlyで:

current_user

database owner

public schema owner

current_user_is_database_owner

effective pg_database_owner relationship

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

を確認。

secret保存0。

━━━━━━━━━━━━━━━━━━
16. OWNER CONSISTENCY GATE
━━━━━━━━━━━━━━━━━━

current credentialが:

expected setup/migration role

かつ

retained DBとのownership relationshipが
migration authorityに整合

していることを確認。

unexpected owner
unknown role
unexpected Neon role change

なら:

BLOCKED_NEON_OWNER_ROLE_MISMATCH

write0
停止。

SET ROLEで回避しない。
role membership追加しない。
owner変更しない。

━━━━━━━━━━━━━━━━━━
17. ROLLBACK-ONLY CREATE PROBE
━━━━━━━━━━━━━━━━━━

最大1回:

BEGIN;

CREATE TABLE public.<unique_probe> (
 id integer
);

ROLLBACK;

永続table:
0

CASE A:

42501

かつ
catalogでもpublic CREATE=false

→
public CREATE不足を実証。

CASE B:

success

→
rollback確認。

public CREATE不足ではないため、
permission変更しない。

rollback-only migration diagnosticへ進む。

━━━━━━━━━━━━━━━━━━
18. ONLY ALLOWED PRIVILEGE REPAIR
━━━━━━━━━━━━━━━━━━

以下が両方成立した場合だけ:

catalog:
public CREATE=false

DDL probe:
42501

exact trusted migration/setup roleにだけ:

GRANT CREATE ON SCHEMA public TO <exact role>;

を最大1回許可。

PUBLICへgrant:
0

runtime roleへgrant:
0

GRANT ALL:
0

SUPERUSER:
0

membership変更:
0

database owner変更:
0

schema owner変更:
0

CREATEDB/CREATEROLE変更:
0

grant後:

public CREATE=true

だけ確認。

━━━━━━━━━━━━━━━━━━
19. IF CREATE ALREADY WORKS
━━━━━━━━━━━━━━━━━━

DDL probeが成功した場合は
migrationを即retryしない。

rollback-only diagnostic harnessで:

foundation_migrations prelude
0001
0002
...
0030

を順に評価。

transaction全体は最終ROLLBACK。

42501が出たら:

migration ID
SQLSTATE
operation class

のみsafe保存。

raw credential:
0

秘密を含むSQL:
0

結果:

BLOCKED_42501_OTHER_PRIVILEGE

として停止。

このauthorityで
別permissionを自動grantしない。

━━━━━━━━━━━━━━━━━━
20. MIGRATION REATTEMPT
━━━━━━━━━━━━━━━━━━

public CREATE不足が
Section17/18で実証・修正された場合だけ、

canonical:

migrateHostedDevelopment

を新規最大1回実行可。

historical:
1 FAIL

new:
max1

migration hashes:

0001〜0030 exact

を直前に再確認。

成功:
continue

失敗:
retry0
追加grant0
recreate0

今回は必ず:

failed migration ID
SQLSTATE
safe operation class

を保持して停止。

━━━━━━━━━━━━━━━━━━
21. HOSTED F3 PROOF SUCCESS PATH
━━━━━━━━━━━━━━━━━━

migration PASS時のみ:

six-role model provision max1 set

positive tests

negative permission tests

R15 hosted guard tests

を既存F3 authorityどおり実行。

Square:
0

Vercel:
0

provider payment:
0

webhook:
0

━━━━━━━━━━━━━━━━━━
22. HOSTED TESTS
━━━━━━━━━━━━━━━━━━

minimum:

receiver approved insert PASS
receiver booking/inventory mutation DENIED

dispatcher approved interface PASS
dispatcher arbitrary business mutation DENIED

worker approved interface PASS
worker arbitrary booking/inventory DENIED

projector approved interface PASS
projector unauthorized internals DENIED

diagnostic read PASS
diagnostic write DENIED

PUBLIC internal access DENIED

SECURITY DEFINER fixed search_path

manifest direct runtime access DENIED

reservation direct mutation DENIED

approved reserve intended role only

duplicate reservation blocked

concurrent reservation one winner

new connection/process reservation persists

━━━━━━━━━━━━━━━━━━
23. CREDENTIAL CLEANUP
━━━━━━━━━━━━━━━━━━

test runtime credentialsは
future runtime credentialとして再利用しない。

可能ならNOLOGIN/rotate/invalidate。

migration credential:
Vercelへ置かない。

Vercel env mutation:
0

temporary secret file:
原則0

RAM references:
clear

browser:
close

DB pools:
close

━━━━━━━━━━━━━━━━━━
24. EVIDENCE
━━━━━━━━━━━━━━━━━━

historical directoriesは変更しない。

new evidence:

docs/execution/p6/r15-hosted-db-proof-handoff-v2/

最低限:

AUTHORITY.md
handoff-v2-validation.json
credential-attempt.json
ownership-diagnosis.json
ddl-probe.json
privilege-repair.json
migration-result.json
roles-result.json
positive-tests.json
negative-tests.json
guard-tests.json
credential-cleanup.json
FINAL_RESULT.md

secret0。

━━━━━━━━━━━━━━━━━━
25. F3 INDEPENDENT REVIEW
━━━━━━━━━━━━━━━━━━

以下が全部PASSした場合だけ:

handoff V2
DB connection
migration
roles
positive tests
negative tests
guard tests
cleanup

safe evidenceをcommit/push/readback。

そのexact HEADへ、

existing:

F3_HOSTED_PROOF_REVIEW 0/1

を1回だけ使用。

review scopeには:

- handoff V2 source/tests
- b541999以降のtest-driver correction
- hosted migration proof
- ownership/privilege proof
- six-role proof
- negative tests
- guard semantics
- credential cleanup

を含める。

post-live final:
0/1維持。

Claudeへsecret0。

━━━━━━━━━━━━━━━━━━
26. ABSOLUTE EXTERNAL LIMITS
━━━━━━━━━━━━━━━━━━

new Neon resource:
0

new database:
0

Neon paid action:
0

terms:
0

Vercel mutation:
0

deploy:
0

Square GET:
0

Square POST:
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

Runner:
0

━━━━━━━━━━━━━━━━━━
27. FINAL STOP
━━━━━━━━━━━━━━━━━━

F3 proof/reviewがPASSしても
必ず停止。

R15 live ingress/Squareへ
自動的に進まない。

ChatGPT Technical Directorへ戻す。

━━━━━━━━━━━━━━━━━━
28. FINAL REPORT
━━━━━━━━━━━━━━━━━━

最後にのみ報告:

Starting HEAD

handoff V2 implementation commit

proof commit

review commit if any

Final HEAD

working tree clean
remote readback

offline handoff tests:
count/pass/fail

credential acquisition V2:
used/max
HTTP classification

DB connection:
PASS/NOT_RUN

database owner relationship

public CREATE:
true/false

DDL probe

privilege repair

historical migration:
1 FAIL42501

new migration:
0/1
result
range

roles

positive tests

negative tests

guard tests

secret exposure:
0

new resource:
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

F3 review:
0/1 or1/1

F3 disposition

next exact gate

━━━━━━━━━━━━━━━━━━
29. CRITICAL
━━━━━━━━━━━━━━━━━━

今回はprovider側を試行錯誤しない。

先にlocal handoffをsynthetic fixtureだけで
完全に検証する。

その後だけcredential requestを1回行う。

credential値をagent outputへ一度も出さず、
raw Neon connection fieldから
標準URL parserで同一process内処理する。

parse成功前にbrowserを閉じない。

parse失敗時に再取得しない。

42501も原因を実証してから
最小permissionだけ直す。

green化目的の権限拡張は禁止。