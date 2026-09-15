【ZAO Rental｜正式Owner Authority
P6 R15 CONTINUATION + POST-R15 AVATAR FOUNDATION
Sequential Autonomous Execution Authority】

私はOwnerとして、このチャット本文そのものを正式なOwner指示として採用する。

これは添付文書内だけの承認ではない。
Draft・提案・調査依頼ではなく、以下の限定範囲に対する正式な実行authorityである。

目的は2つ。

A.
現在途中のR15を可能な限り最後まで完了させる。

B.
R15がterminal checkpointへ到達した後、
ZAO Rental 2D/2.5D Avatar Visualization の
「設計・schema・API foundation」だけを
別branchで開始する。

アバターUI本体はまだ実装しない。

不要な中間Owner確認は禁止。
明記した安全境界内ではCodex parentが自律判断して最後まで進める。

━━━━━━━━━━━━━━━━━━
0. CURRENT SOURCE OF TRUTH
━━━━━━━━━━━━━━━━━━

repo:

ginisato-hash/zao-rental

current canonical branch:

codex/external-acceptance-p6

expected starting remote HEAD:

2a41c96b220f7a9c68f5982d6cb104f880f6616b

main:

3061dbbbe00294e5baebba2405028c907d6e6e85

開始時に必ず:

git fetch origin --prune
git rev-parse HEAD
git rev-parse origin/codex/external-acceptance-p6
git rev-parse origin/main
git status --short --branch
git worktree list --porcelain

を確認する。

remoteが進んでいればGitHub最新を正本としてreconcileする。

force push禁止。
reset --hard禁止。
git cleanでunknown workを消さない。

他chat/agent/worktreeの未保存変更を発見した場合は破壊しない。

━━━━━━━━━━━━━━━━━━
1. SINGLE WRITER RULE
━━━━━━━━━━━━━━━━━━

このrepoへのwriterは同時に1つだけ。

別チャットのAvatar作業と
R15作業を同じbranchへ並列書込みしてはいけない。

R15実行中:

codex/external-acceptance-p6

だけをcurrent writer branchとする。

Avatar foundation開始前に:

remote branch
local worktree
uncommitted changes
active writer

を再確認。

avatar関連の既存branch/worktreeが既に存在する場合、
duplicate branchを作らず内容を照合する。

unknown concurrent writerが本当に存在する場合のみ停止可。

━━━━━━━━━━━━━━━━━━
2. CURRENT R15 CHECKPOINT
━━━━━━━━━━━━━━━━━━

R15はまだPASSではない。

保持する事実:

Dedicated Vercel Project:

zao-rental-webhook-sandbox

Project ID:

prj_whzxwR1vj0CBBnm1UD6dz5ALPMbA

Standard Protection:
configured

Git autodeploy:
disabled

Dedicated deployment #1:

dpl_G7dFJ6e6bNk9i3VKeGBpfskvA26V

はbuild後にruntime500を確認し、
証拠保存後に削除済み。

原因:

Node production runtimeで
TypeScript extensionless importを解決できなかった。

修正:

dedicated ingress runtimeを
runtime.cjs artifactへbundleする方式。

current correction:

510 tests green
secret scan green
lint green
typecheck green
ingress typecheck green
main build green

R14/R15 real local PostgreSQL:

31 checks green

Hosted Neon:

0

Square subscription:

0

CreatePayment:

0

GetPayment:

0

Webhook live delivery:

0

Refund:

0

R10 lookup:

0

main Production:

0

current historical R10:

LAST_OBSERVED_PENDING
S3_NONTERMINAL_DO_NOT_RETRY

R10 refundは永久にこのR15/Avatar作業のgateにしない。

━━━━━━━━━━━━━━━━━━
3. NEON OWNER STATE
━━━━━━━━━━━━━━━━━━

Ownerは既に
Vercel経由のNeon利用規約同意操作を1回完了したと報告済み。

ただし前回のteam-scoped readbackでは:

Neon installations:
0

Neon resources:
0

CLI:
terms-required

だった。

したがって、最初に行うのはcreate retryではなく
read-only state reconciliation。

zao-food-map Teamに対して:

Marketplace integration state
accepted terms state
Neon installations
Neon resources
available free plan

をsecret-free metadataだけで確認する。

━━━━━━━━━━━━━━━━━━
4. NEON RETRY RULE
━━━━━━━━━━━━━━━━━━

readbackが:

terms accepted / provisioning available

へ変化した場合のみ、

Neon development resourceを最大1件作成してよい。

plan:

free_v3
またはその時点で明確に追加課金0のfree equivalent

用途:

ZAO Rental Sandbox/development only

Production:
false

real data:
0

paid upgrade:
禁止

card/billing consent:
禁止

新しい利用規約をagent自身でaccept:
禁止

同じcreate/addを状態変化なしに連打しない。

もし再度:

terms-required

なら、

BLOCKED_NEON_TERMS_PROPAGATION

として確定する。

その場合、同一provision requestを再送しない。

R15の独立作業を全て保存してから、
後述のAvatar PHASE A0-A1だけへ進んでよい。

━━━━━━━━━━━━━━━━━━
5. HOSTED NEON PROVISIONING
━━━━━━━━━━━━━━━━━━

Neon作成可能になった場合:

resource最大1。

明確なdevelopment/sandbox命名。

real customer:
0

Production:
0

migration owner credentialとruntime credentialsを分離。

DB secretを:

terminal stdout
chat
Git
logs
evidence

へ表示禁止。

Vercel Marketplace integrationによる
non-disclosing env handoffを優先する。

━━━━━━━━━━━━━━━━━━
6. HOSTED MIGRATION
━━━━━━━━━━━━━━━━━━

Hosted development DBへ
repo正本のmigrationを正規順で適用する。

現在は少なくとも:

0001〜0029

が存在する。

実行時にlatest migrationを再確認し、
番号を推測しない。

R14以前のmigrationを編集しない。

migration hashesを開始時sourceと照合。

適用後:

tables
constraints
indexes
functions
owners
search_path
grants

をsecret-free metadataで検証。

━━━━━━━━━━━━━━━━━━
7. HOSTED DB LEAST PRIVILEGE
━━━━━━━━━━━━━━━━━━

R14で検証済みの6-role modelを
Hosted DBでも再現する。

migration owner

receiver

dispatcher

reconciliation worker

projection worker

diagnostic read-only

GRANT ALL禁止。

PUBLIC privilege expansion禁止。

receiverはbooking/inventory/payment projectionを変更できない。

dispatcherはbusiness stateを変更できない。

workerはarbitrary booking write不可。

projectorはR13 interface以外のR12 internalsを変更不可。

diagnosticはread-only。

negative permission testsを実行。

━━━━━━━━━━━━━━━━━━
8. R15 DEPLOYMENT BUDGET AMENDMENT
━━━━━━━━━━━━━━━━━━

重要。

historical dedicated deploy #1は、
R15 runtime packaging defectの発見に使われ、
証拠保存後削除された。

元authorityではdedicated deploy total2だったが、
このチャット本文により
そのbudgetを限定的に改定する。

今このcheckpointから、

zao-rental-webhook-sandbox

への追加dedicated deploymentを

最大2件

承認する。

したがってR15全期間の
dedicated deployment creation累計上限は最大3件。

historical #1:
consumed / deleted

new #2:
最大1

new #3:
技術的に必要な場合のみ最大1

不要なら#3は作らない。

このamendmentは
main `zao-rental` Production deploy allowanceを増やさない。

main Production deploy:
0

━━━━━━━━━━━━━━━━━━
9. WHY TWO ADDITIONAL INGRESS DEPLOYS ARE ALLOWED
━━━━━━━━━━━━━━━━━━

Square webhook subscriptionには
reachable HTTPS notification URLが必要。

signature keyはsubscription作成後に確定する。

Vercel secret/env変更は
新deploymentへの反映が必要になる。

そのため安全な順序として:

deploy corrected receiver
↓
verify stable URL / fail-closed boundary
↓
create Square subscription
↓
obtain signature key without displaying it
↓
set secret
↓
redeploy exact corrected receiver
↓
live webhook acceptance

を許容する。

securityを弱めて
1 deployに無理やり収めてはいけない。

━━━━━━━━━━━━━━━━━━
10. CORRECTED INGRESS DEPLOY #2
━━━━━━━━━━━━━━━━━━

Neon DBとreceiver roleが準備できた後、

既存修正済みR15 sourceから
dedicated ingress deployを最大1件作る。

必ず:

npm run build:ingress

から exact runtime.cjs を生成。

generated artifact hashをmanifestへ保存。

generated runtimeをGit tracked sourceにしない。

deployment target:

dedicated project production target only

classification:

SANDBOX_WEBHOOK_INGRESS_ONLY

これはmain application Productionではない。

main application:
deploy 0

━━━━━━━━━━━━━━━━━━
11. BOOTSTRAP INGRESS BEHAVIOR
━━━━━━━━━━━━━━━━━━

signature key未設定時:

POST /api/webhooks/square

は必ずfail closed。

2xxを返してはいけない。

raw bodyを保存しない。

任意で:

HEAD /api/webhooks/square

をstateless 204にしてよい。

ただし:

GET/HEADはDB write 0
business action 0
secret 0

とする。

POST securityを弱めない。

/health:

200

を許可。

━━━━━━━━━━━━━━━━━━
12. SQUARE SUBSCRIPTION BOOTSTRAP
━━━━━━━━━━━━━━━━━━

corrected ingressが
stable HTTPS URLでreachableになった後のみ、

Square Sandbox webhook subscriptionを最大1件作成してよい。

merchant/application:
既存ZAO Rental Sandbox

API version:

2026-08-19

event types:

payment.created
payment.updated

notification URL:

exact dedicated stable URL
/api/webhooks/square

Production subscription:
0

subscription create:
最大1

retry:
0

UNKNOWN時はcreateを繰り返さない。

read-only subscription metadataで照合する。

━━━━━━━━━━━━━━━━━━
13. DO NOT WEAKEN POST TO SATISFY SQUARE
━━━━━━━━━━━━━━━━━━

Square subscription作成時の
reachability validationが、

signature key未設定のため
secured POSTを受理できないことを理由に失敗した場合、

unauthenticated webhook POSTへ
一時的な2xx bypassを追加してはいけない。

public bypass token
query secret
disable verification
blank signature acceptance

は禁止。

その場合は:

BLOCKED_SUBSCRIPTION_BOOTSTRAP_CYCLE

として証拠保存する。

セキュリティを緩めて通過させない。

━━━━━━━━━━━━━━━━━━
14. SIGNATURE KEY HANDOFF
━━━━━━━━━━━━━━━━━━

subscription作成成功後の
Square-generated signature keyは秘密値。

既存R15で準備した
non-disclosing signature-key handoffを使用する。

値を:

stdout
Git
chat
JSON evidence
shell history

へ出さない。

専用projectの:

SQUARE_SANDBOX_WEBHOOK_SIGNATURE_KEY

へ直接保存。

同時にexact:

SQUARE_SANDBOX_NOTIFICATION_URL

を設定。

dedicated ingress projectには:

Square access tokenを置かない。

━━━━━━━━━━━━━━━━━━
15. CORRECTED FINAL DEPLOY #3
━━━━━━━━━━━━━━━━━━

signature key/env設定にredeployが必要な場合のみ、
追加dedicated deployment最大1件を使用してよい。

このdeploymentがR15 live acceptance candidate。

確認:

build success

stable domain exact

/health 200

unsigned POST rejected

bad signature rejected

no DB write on failed signature

correct signature path can reach receiver role

main project protection unchanged

━━━━━━━━━━━━━━━━━━
16. LIVE WEBHOOK ACCEPTANCE
━━━━━━━━━━━━━━━━━━

Square official Sandbox test webhook:
最大1。

目的:

real HTTPS delivery

real HMAC

exact notification URL

merchant validation

durable inbox COMMIT

COMMIT後ACK 2xx

raw body non-persistence

signature non-persistence

duplicate protection

を検証。

test eventがactual payment lookupに使えない場合、
receiver acceptanceにだけ使用。

━━━━━━━━━━━━━━━━━━
17. CONDITIONAL SYNTHETIC PAYMENT
━━━━━━━━━━━━━━━━━━

full R11→R12→R13 hosted E2Eに必要な場合のみ、

new Square Sandbox payment:
最大1 logical payment

amount:
100 JPY

currency:
JPY

source:
cnon:card-nonce-ok

merchant:
MLKDVEDH1ME21

existing verified Sandbox location

CreatePayment:
max1

retry:
0

alternate key:
0

real card:
0

real customer:
0

R9/R10 payment:
再利用しない。

R10 refund:
触らない。

━━━━━━━━━━━━━━━━━━
18. PAYMENT MANIFEST + GUARD
━━━━━━━━━━━━━━━━━━

CreatePayment前に:

immutable operation manifest

new UUID operation ID

new fixed idempotency key

exact synthetic booking/reference

100 JPY

merchant/location binding

API version

retry0

Production false

をcommit/push/readback。

exclusive local guardを
dispatch前にfsync。

UNKNOWN:
DO_NOT_RETRY。

━━━━━━━━━━━━━━━━━━
19. NATURAL WEBHOOK + R12
━━━━━━━━━━━━━━━━━━

synthetic payment後:

自然deliveryをbounded wait。

duplicate eventは正常にdedupe。

Webhook bodyだけでpayment truthを確定しない。

R12 finite worker:

batch 1

target:
R15 synthetic payment only

GetPayment:
max1

retry:
0

cron:
0

daemon:
0

Runner:
0

provider truthは既存match contractで照合。

━━━━━━━━━━━━━━━━━━
20. R13 HOSTED PROJECTION
━━━━━━━━━━━━━━━━━━

R12 accepted truthのみを
R13へ渡す。

再検証:

payment identity

100 JPY

merchant/location

price snapshot

HOLD validity

due_at

inventory/wear claims

transfer safety

revision

projection dedupe

PASS時のみsynthetic booking projection。

history/audit/projection receipt exactly once。

real customer:
0

real inventory:
0

real custody:
0

auto refund:
0

━━━━━━━━━━━━━━━━━━
21. R15 PASS / PARTIAL
━━━━━━━━━━━━━━━━━━

R15_PASSには:

Hosted free Neon ready

migrations accepted

least privilege accepted

correct dedicated ingress deployed

Square live signed webhook accepted

durable ACK accepted

R12 real provider truth accepted

R13 synthetic hosted projection accepted

secret exposure0

main Production0

real data0

が必要。

満たさない場合は
exact blockerでPARTIALにする。

無理にPASS化しない。

━━━━━━━━━━━━━━━━━━
22. R15 RESULT MUST BE REMOTELY SAVED FIRST
━━━━━━━━━━━━━━━━━━

Avatar作業へ移る前に必ず:

R15 result
safe evidence
external counters
resource retention/cleanup
final validation

をcommit。

ginisato-hash/zao-rental

codex/external-acceptance-p6

へ通常push。

remote readback。

working tree clean。

R15 historical sourceを固定する。

私はOwnerとして、
このR15 continuationで生成される
code/tests/docs/safe evidenceを
上記branchへ通常pushすることを明示承認する。

━━━━━━━━━━━━━━━━━━
23. IF R15 HITS A HUMAN-ONLY BLOCKER
━━━━━━━━━━━━━━━━━━

次の場合:

Neon terms propagation

paid plan consent

new provider contract

password/MFA

organization permission expansion

等の真のhuman-only blockerが残ったら、

同じ外部操作をループしない。

できるR15 workを全て終える。

checkpointをcommit/push/readback。

その後、
Avatar Foundationの

PHASE A0
PHASE A1

だけを進めてよい。

この場合は
Avatar DB migration/API implementationへは進まない。

━━━━━━━━━━━━━━━━━━
24. AVATAR PRODUCT AUTHORITY
━━━━━━━━━━━━━━━━━━

ZAO Rental 2D / 2.5D Avatar Visualization
Implementation Package v1.0

の以下のproduct decisionsを採用する。

方式:

2D / 2.5D layered composition only

initial avatar:

male visual 1
female visual 1

目的:

customer body heightに対する
ski lengthの相対可視化

+
wear / boots visual overlay

非スコープ:

3D

mandatory WebGL

AR

camera

customer photo upload

pose estimation

body scanning

AI virtual try-on

cloth simulation

この機能は:

fit guaranteeではない

safety determinationではない

inventory guaranteeではない

payment authorityではない

booking availability authorityではない

━━━━━━━━━━━━━━━━━━
25. AVATAR PRIORITY RULE
━━━━━━━━━━━━━━━━━━

Avatar UI本体は
core reservation/payment/QR/custody flowより優先しない。

今回のauthorityで許可するのは原則:

A0 repo inspection

A1 ADR

A2 visual data/schema foundation

A3 backward-compatible visual API contract

まで。

禁止:

AvatarFitPreview customer UI本体

booking UI integration

admin asset UI

full E2E UI

Production deploy

つまりImplementation Packageの
Phase 4以降はまだ実装しない。

━━━━━━━━━━━━━━━━━━
26. AVATAR BRANCH CREATION
━━━━━━━━━━━━━━━━━━

R15がremote terminal checkpointへ到達した後、
current remote R15 final HEADをbaseにする。

branch:

codex/avatar-2d-foundation

を使用。

branchが存在しなければ作成。

既に存在する場合:

内容をfetch/readしてreconcile。

force update禁止。

別chatのworkを破壊しない。

mainから古いbaseを作らない。

R15 final remote HEADをbaseにする。

専用worktreeを作ってよい。

━━━━━━━━━━━━━━━━━━
27. AVATAR PHASE A0 — REPO INSPECTION
━━━━━━━━━━━━━━━━━━

最初にrepoを実測する。

記録:

framework

package manager

DB

ORM/query layer

migration mechanism

recommendation contracts/service/API

existing Direction/candidate naming

inventory/product model

existing visual/image/object storage pattern

admin pattern

feature flag pattern

test stack

Playwright

ADR/docs convention

current latest migration

重要:

現repoでは少なくとも:

Next.js
React
npm
PostgreSQL
pg
drizzle-orm

が存在する。

Prismaは導入しない。

Implementation PackageのPrisma mappingは
semantic referenceにすぎない。

new ORM:
禁止。

new CMS:
禁止。

new storage provider:
禁止。

3D dependency:
禁止。

A0結果を:

docs/architecture/avatar-2d-repo-inspection.md
またはrepo既存convention相当

へ保存。

Ownerへの中間報告待ちは不要。

architecture contradictionがなければ続行。

━━━━━━━━━━━━━━━━━━
28. AVATAR PHASE A1 — ADR
━━━━━━━━━━━━━━━━━━

repo既存ADR conventionに従いADRを追加。

固定:

2D/2.5D only

male/female appearance visuals

relative physical ski length visualization

optional jacket/pants/boots layers

visual failure must never block booking

visual state must never mutate:

recommendation truth
HOLD
inventory allocation
payment
QR
custody
refund
safety logic

avatarTypeはvisual appearance choice。

業務上の性別判定に使わない。

feature default:
OFF

fallback policyを定義。

将来3D化は
別ADR/Owner scope必須。

━━━━━━━━━━━━━━━━━━
29. IF R15 IS STILL HUMAN-BLOCKED
━━━━━━━━━━━━━━━━━━

R15がhuman-only blockerのままなら、
ここでAvatar作業を停止。

A0 + A1のみcommit/push可。

schema migration:

0

API code change:

0

UI:

0

R15解消後にA2/A3へ進む。

━━━━━━━━━━━━━━━━━━
30. AVATAR PHASE A2 — DATA FOUNDATION
━━━━━━━━━━━━━━━━━━

R15がPASSまたは
external acceptanceがclean terminalになっている場合のみA2へ進む。

Implementation PackageのDDLを
semantic referenceとして使う。

既存migration frameworkへ適応。

latest migration numberを実測し、
次番号を使用。

0030と決め打ちしない。

equivalent model:

avatar visuals

ski visuals

boot visuals

wear visuals

visual fallback assets

要件:

visual recordsとphysical inventoryを分離。

existing inventory/product/model referenceはnullable。

現repoに安定したmodel masterが存在しないなら、
visual機能のためだけに新product masterを作らない。

最適な既存identifierへnullable linkするか、
linkを後続phaseへ延期する。

image bytesをDBへ保存しない。

existing asset-key / URL conventionを使う。

short-lived signed URLをpersistent DB valueにしない。

active/disabled

sort order

normalized anchor ratios

timestamps/IDs:
existing convention

soft disable優先。

━━━━━━━━━━━━━━━━━━
31. AVATAR DATA SAFETY
━━━━━━━━━━━━━━━━━━

visual tablesが0 rowsでも:

recommendation

booking

payment

inventory

QR

custody

が完全に動作すること。

visual migrationはadditive。

existing table drop:
0

existing business column semantic change:
0

payment migration modification:
0

R11-R15 migration rewrite:
0

Hosted NeonへAvatar migration:
まだ適用しない。

local isolated PostgreSQLでだけmigration testする。

━━━━━━━━━━━━━━━━━━
32. AVATAR PHASE A3 — API CONTRACT
━━━━━━━━━━━━━━━━━━

existing recommendation truthをそのまま使用。

visual layerは
ski lengthやeligibilityを再計算してはいけない。

現行:

RecommendationService

MemberRecommendation

candidate directions

existing short/recommended/long equivalent

を正本にする。

既存enum namingを変えない。

conceptual mappingだけ:

short
recommended
long

としてvisual payloadへ写像。

pure deterministic mapperを作る。

visual payloadはbackward-compatible optional addition。

最低限:

version: 1

avatarType

customerHeightCm

avatar visual ref

existing short/recommended/long candidate visual mapping

skiLengthCm

optional boot

optional jacket

optional pants

fallback marker

required non-empty disclaimer

を表現可能にする。

━━━━━━━━━━━━━━━━━━
33. ABSOLUTE VISUAL RULE
━━━━━━━━━━━━━━━━━━

visual mapper:

inventory allocation write 0

HOLD write 0

payment write 0

booking write 0

QR write 0

custody write 0

provider call 0

Square call 0

visual data missing:
no 5xx

inactive visual:
not returned

fallback missing:
null-safe

recommendation candidate values:
unchanged

━━━━━━━━━━━━━━━━━━
34. SKI LENGTH DISPLAY CONTRACT
━━━━━━━━━━━━━━━━━━

将来rendererが使用するvisual formulaは:

skiToBodyRatio =
skiLengthCm / customerHeightCm

skiDisplayHeightPx =
avatarBodyHeightPx * skiToBodyRatio

ただしA3では
business recommendationとしてこの式を使用しない。

これは将来のpresentation-only formula。

skiLengthCmは
existing recommendation candidateの値を使う。

visual layer独自推奨:
禁止。

━━━━━━━━━━━━━━━━━━
35. FEATURE FLAG
━━━━━━━━━━━━━━━━━━

既存feature flag mechanismが存在する場合は再利用。

無ければ、
新しいfeature flag SaaS/providerを導入しない。

foundation段階では:

visual contract optional
visual records optional
customer renderer absent

なのでbusiness behaviorは実質OFFを維持。

UI ONは別authority。

━━━━━━━━━━━━━━━━━━
36. AVATAR TESTS
━━━━━━━━━━━━━━━━━━

最低限:

visual data 0

inactive records

fallback resolution

nullable model references

duplicate/default fallback constraints

migration from empty local DB

migration from current-schema local DB

existing recommendation unchanged

visual mapper deterministic

short/recommended/long values exact existing candidates

missing visual no 5xx

visual code produces no business POST/write

existing:

recommendation tests

booking/payment tests

inventory tests

QR/custody relevant regression

を壊さない。

━━━━━━━━━━━━━━━━━━
37. NO AVATAR UI YET
━━━━━━━━━━━━━━━━━━

このauthorityでは以下を実装禁止:

AvatarFitPreview React component

male/female visual switch UI

ski image rendering

wear overlay UI

boots overlay UI

booking screen insertion

admin asset editor

customer feature flag ON

Playwright visual E2E

production asset upload

実画像の本番投入

これらはcore release gate後の
次authorityで行う。

━━━━━━━━━━━━━━━━━━
38. AVATAR EXTERNAL COUNTS
━━━━━━━━━━━━━━━━━━

Avatar phaseでは:

Vercel deploy:
0

Neon hosted migration:
0

Square:
0

provider:
0

Production:
0

browser login:
0

new external service:
0

local DBのみ許可。

━━━━━━━━━━━━━━━━━━
39. AVATAR GIT AUTHORITY
━━━━━━━━━━━━━━━━━━

私はOwnerとして、

codex/avatar-2d-foundation

branchの作成、

A0-A3の許可範囲内の:

docs
migration source
contracts
repository/query code
pure mapper
tests

のcommitと通常pushを承認する。

force push:
禁止

main merge:
0

new PR:
0
unless separate authority

Production deploy:
0

━━━━━━━━━━━━━━━━━━
40. AVATAR FOUNDATION COMPLETION
━━━━━━━━━━━━━━━━━━

A0-A3完了条件:

repo inspection recorded

ADR accepted by tests/docs checks

visual migration local real PostgreSQL PASS

visual rows0 regression PASS

optional backward-compatible contract PASS

pure mapper PASS

existing recommendation unchanged

payment/inventory/QR/custody regression green

secret scan green

lint green

typecheck green

build green

working tree clean

branch pushed/readback

まで。

━━━━━━━━━━━━━━━━━━
41. DO NOT START PHASE 4 AUTOMATICALLY
━━━━━━━━━━━━━━━━━━

A0-A3が全てgreenでも、

renderer/UI implementationへは進まない。

次Owner gate:

Avatar Phase4-7 implementation

とする。

その時点で:

R15/live payment core state

reservation/payment/QR/custody readiness

asset production plan

mobile UX

を再評価してから進む。

━━━━━━━━━━━━━━━━━━
42. STOP CONDITIONS
━━━━━━━━━━━━━━━━━━

Ownerへ停止してよいのは:

password/MFAが実際に必要

Neon termsがなおteamで未反映

paid plan / billing consent

new provider contract

organization permission expansion

real concurrent writer conflict

unexpected Production-only dependency

irreversible scope expansion

のみ。

recoverable code/test/build/migration issueでは
Ownerへ確認せず自律修正する。

━━━━━━━━━━━━━━━━━━
43. FINAL REPORT
━━━━━━━━━━━━━━━━━━

最終報告はまとめて行う。

まずR15:

starting HEAD

R15 continuation commits

final P6 HEAD

Neon:
created / blocker

Hosted DB:
migration + roles

dedicated ingress:
deploy count including historical consumed one

subscription:
counts

webhook:
delivery/signature/ACK

payment:
CreatePayment/GetPayment counts

R12:
truth result

R13:
projection result

R15 classification

external cleanup

security exposure

次にAvatar:

base R15 HEAD

avatar branch

A0 inspection

ADR path

migration number/path

schema summary

API contract

mapper

test counts

existing business regression

external calls0

final avatar HEAD

working tree

次Owner action:

R15 blocker resolution
または
Avatar Phase4-7 authority

のみ。

━━━━━━━━━━━━━━━━━━
44. FINAL DIRECT OWNER APPROVAL
━━━━━━━━━━━━━━━━━━

私はOwnerとして、このチャット本文の全内容を
正式な実行指示として承認する。

具体的に、

現在の
ginisato-hash/zao-rental
codex/external-acceptance-p6
HEAD
2a41c96b220f7a9c68f5982d6cb104f880f6616b

からR15 continuationを再開すること、

既存
zao-rental-webhook-sandbox
Projectを再利用すること、

Neonのteam状態をread-only照合し、
free/追加課金0が確認できる場合に
development DB最大1件を作成すること、

historical failed/deleted deploy1件とは別に
dedicated ingress deployを
今から最大2件追加すること
（R15累計最大3件）、

Square Sandbox webhook subscription最大1件、

official webhook test最大1件、

条件付きSandbox CreatePayment最大1件、

GetPayment最大1件、

R12 finite worker、

R13 synthetic projection、

R15 safe evidenceの既存branchへの通常push、

を明示承認する。

またR15がremote terminal checkpointに到達した後、
別branch

codex/avatar-2d-foundation

をR15 final HEADから作成し、

Avatar A0 repo inspection
Avatar A1 ADR
Avatar A2 local-only visual data foundation
Avatar A3 backward-compatible visual API foundation

までを自律実装・テスト・commit・通常pushすることを承認する。

ただし、

R15がhuman-only blockerのままの場合、
AvatarはA0+A1までに限定する。

Avatar renderer/UI/admin/E2E、
main merge、
main Production deploy、
Square Production、
real customer/card/inventory/custody、
refund/R10 follow-up

は承認しない。

安全境界内では不要に停止せず、
上記順序を守って最後まで自立実行すること。