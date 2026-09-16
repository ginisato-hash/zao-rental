【ZAO Rental｜AVATAR PHASE 6
Protected Hosted Preview + Neon 0031/0032 + Private R2 Media + Hosted Guest Acceptance】

私はOwnerとして、この本文を正式なPhase6 execution authorityとして採用する。

目的:

Phase5でローカル完成した:

- GuestBooking Avatar integration
- real approved derivative artwork 3点
- 0031 / 0032
- guest authorization
- physical scale renderer

を、

既存のHosted Neon
+
private media provider
+
Vercel protected Preview

へ接続し、
非Production環境で実際にE2E成立させる。

今回は安全境界内を一気通関する。

不要な中間Owner確認は禁止。

Ownerへ戻ってよいのは原則:

- 実際のpassword/MFA
- provider terms acceptance
- billing/paid-plan consent
- 法的attestationをprovider自身が明示要求
- このauthorityを超えるProduction操作

のみ。

それ以外の:

build failure
test failure
migration compatibility
local bug
Preview bug
safe permission defect

はCodexが自律修正して続行する。

━━━━━━━━━━━━━━━━━━
0. SOURCE OF TRUTH
━━━━━━━━━━━━━━━━━━

repo:

ginisato-hash/zao-rental

current completed branch:

codex/avatar-phase5-artwork-activation

expected final HEAD:

ec420cbd166af0749caecfa654c0a1e362628891

Phase5 reviewed implementation HEAD:

e6b97d66598a81c0e26f329e2fd773b954dc746c

previous Phase5 code terminal:

01c225eaed80eb5ee95e22d1ece9eef666aa22e3

R15 Hosted Sandbox terminal:

efb73933a6d3816958882205cfa3623447194625

開始時:

git fetch origin --prune
git rev-parse HEAD
git rev-parse origin/codex/avatar-phase5-artwork-activation
git status --short --branch
git worktree list --porcelain

remote advance時:
古いSHAへresetしない。

最新GitHubを正本としてreconcile。

force push禁止。
reset --hard禁止。
unknown work削除禁止。

single writer維持。

━━━━━━━━━━━━━━━━━━
1. NEW BRANCH
━━━━━━━━━━━━━━━━━━

新branch:

codex/avatar-phase6-hosted-preview

base:

remote codex/avatar-phase5-artwork-activation

Phase5 branchはfreeze。

main変更:
0

Production deploy:
0

main merge:
0

━━━━━━━━━━━━━━━━━━
2. PHASE6 PASS TARGET
━━━━━━━━━━━━━━━━━━

最終目標:

PHASE6_PROTECTED_HOSTED_PREVIEW_PASS

PASS条件:

1.
existing Neon dev DBへ0031/0032適用

2.
Hosted least-privilege Avatar/Guest runtime成立

3.
guest Avatar rate limit成立

4.
real artwork 3点をprivate providerへ配置

5.
Vercel protected Preview成立

6.
actual hosted GuestBooking
→ recommendation
→ Avatar
→ real media
までE2E

7.
cross-guest / logout / rights revoke fail closed

8.
Production/Square/payment/main merge 0

9.
最終Claude independent review PASS
またはLOW only

━━━━━━━━━━━━━━━━━━
3. EXISTING NEON ONLY
━━━━━━━━━━━━━━━━━━

既存Neon resourceのみ使用:

store_i5vh0ZEKo2ikcVo9

既存development DB:

zr_852b20c4d4b0

new Neon resource:
0

new database:
0

database recreation:
0

paid upgrade:
0

R15で既に0001–0030がHosted適用済み。

Phase6では:

0031_avatar_visuals.sql
0032_avatar_delivery_boundary.sql

のみ追加適用する。

historical0001–0030を
再作成・改変・再適用しない。

━━━━━━━━━━━━━━━━━━
4. DO NOT MODIFY THE FROZEN R15 HOSTED VERIFIER
━━━━━━━━━━━━━━━━━━

重要。

R15のhosted migration verifierは
exact 0001–0030を守るため
31+ migrationを拒否する設計。

これは正常。

Phase6のために
R15 verifierを緩めたり
「32まで許可」へ書き換えない。

新しく:

Avatar Phase6 hosted migration runner

を作る。

役割:

existing DBが
exact 0001–0030 history

であることを検証し、

current sourceの:

0031
0032

のhashを固定確認して
その2件だけを適用する。

R15 historyはimmutable。

━━━━━━━━━━━━━━━━━━
5. HOSTED MIGRATION SAFETY
━━━━━━━━━━━━━━━━━━

migration前にread-only確認:

current_database

current_user

foundation_migrations count

0001–0030 checksums

0031 absent

0032 absent

avatar_visuals absent or expected state

unexpected partial state

を検証。

partial 0031/0032 stateなら
blind execution禁止。

transaction + advisory lock。

migration invocation:
最大1 logical run

blind retry:
0

failure時:

failed migration ID
SQLSTATE
safe operation category

のみ保存。

secret/URI:
保存0。

━━━━━━━━━━━━━━━━━━
6. PHASE5 ARTWORK-1 LOW — FIX BEFORE HOSTED IMPORT
━━━━━━━━━━━━━━━━━━

Phase5 independent reviewの:

ARTWORK-1 LOW

を今回修正する。

local artwork importer transactionへ:

SET LOCAL lock_timeout
SET LOCAL statement_timeout

を追加。

repo existing transaction conventionへ合わせる。

値は既存Content/Guest等の
合理的なbounded timeoutを参考に決定。

real PostgreSQL test:

別connectionで対象table lock保持
↓
import開始
↓
bounded time内でfailure

を証明。

indefinite hang:
0

既存正常import:
PASS

atomicity:
維持。

━━━━━━━━━━━━━━━━━━
7. PHASE5-1 — RATE LIMIT BEFORE NON-LOCAL EXPOSURE
━━━━━━━━━━━━━━━━━━

現在:

guest-avatar-http

はguest ownership/authを持つが、
GuestSecurity.guard()を通していない。

Protected Previewでも
non-local exposureになるため、
Phase6で解消する。

既存GuestSecurityを再利用。

新rate-limit SaaS:
0

Redis:
0

Upstash:
0

新外部service:
0

trusted peer identityは、
既存guest securityの原則:

「arbitrary client headerを信用しない」

を維持。

Vercel Previewで
platform-verified ingressからのみ
peer keyを構成する。

Codexは現repoと
Vercel official runtime semanticsを確認し、
最小実装する。

client任意入力を
peer identityに使わない。

━━━━━━━━━━━━━━━━━━
8. RATE LIMIT BEHAVIOR
━━━━━━━━━━━━━━━━━━

Avatar metadata GETと
Avatar media GETの双方を
boundedにする。

ただし通常1ページロードで:

body
ski
optional layers

の複数GETが発生する。

したがって:

既存guest policyを
無思考で厳しく消費し
正常ページを429にしない。

既存policyを実測し、

通常navigation:
PASS

通常appearance/direction切替:
PASS

bounded abuse:
429

global budget:
機能

peer budget:
機能

を検証。

既存guest business rate-limitを
弱めることは禁止。

必要なら同一
guest_rate_buckets infrastructure上で
purpose-separated Avatar bucketを設計してよい。

新テーブルは、
本当に必要な場合だけadditive migration。

可能ならschema追加なしを優先。

━━━━━━━━━━━━━━━━━━
9. AV-3 — HOSTED LEAST PRIVILEGE PROOF
━━━━━━━━━━━━━━━━━━

AV-3はlocal proofまで。

Phase6でHosted proofを行う。

Hosted runtimeは
setup owner credentialを使用しない。

Avatar専用read roleを
canonical Phase5 policyで構成。

最低:

LOGIN runtime role
NOSUPERUSER
NOCREATEDB
NOCREATEROLE
NOINHERIT
NOREPLICATION
NOBYPASSRLS
membershipなし

allowed:

required eligible visual projection/function
必要なcurrent eligibility read

denied:

content_workspace full JSON SELECT

content_media_objects raw byte SELECT

content_revision_records raw SELECT

avatar_visuals direct broad SELECT if unnecessary

guest_contexts arbitrary SELECT

recommendation_previews arbitrary SELECT

business writes

DDL

role management

PUBLIC EXECUTE

unexpected SECURITY DEFINER access

SECURITY DEFINER:

fixed search_path

dynamic SQLなし

PUBLIC revoke

intended roleのみ。

Hosted negative testを保存。

これがPASSした場合のみ
AV-3 closure candidateとして
最終Claudeへ渡す。

Codex自身でCLOSED宣言しない。

━━━━━━━━━━━━━━━━━━
10. HOSTED GUEST RUNTIME
━━━━━━━━━━━━━━━━━━

現在の:

DevelopmentRuntime
parseRuntime()
avatarRuntime()

は意図的に
127.0.0.1 / local-only。

Phase6のために
これを雑にremote host許可へ変更しない。

local security contractを保持する。

別の明示的な:

HostedPreviewRuntime

または同等のstrict compositionを追加。

Hosted Preview runtime条件:

VERCEL_ENV == preview

explicit Phase6 preview mode

Production environment:
絶対拒否

Production branch/domain:
拒否

Neon expected resource/database:
一致

TLS required

loopback:
拒否

unexpected database:
拒否

unexpected role:
拒否

missing config:
fail closed

━━━━━━━━━━━━━━━━━━
11. DO NOT REUSE OWNER DB CREDENTIAL AT RUNTIME
━━━━━━━━━━━━━━━━━━

migration/setup credentialは
migration/import時のみ。

Vercel Preview envへ:
置かない。

Hosted GuestBookingに必要な
canonical least-privilege runtime rolesだけ使う。

logical servicesごとに
既存role modelを再利用。

複数serviceを
neondb_ownerへ束ねる禁止。

Production credential:
0

━━━━━━━━━━━━━━━━━━
12. REAL ARTWORK RIGHTS SCOPE FOR PHASE6
━━━━━━━━━━━━━━━━━━

Phase5で承認されたexact derivative 3点:

appearance-1.webp
appearance-2.webp
generic-ski.webp

のみ使用。

source photosそのもの:
upload禁止。

Phase5 rights basis:

OWNER_SUPPLIED_SOURCE_DERIVATIVE_LOCAL_USE_ONLY

を、
このauthority採用により:

OWNER_SUPPLIED_SOURCE_DERIVATIVE_PROTECTED_PREVIEW_ONLY

へPhase6 operational scopeとして拡張してよい。

これは:

- protected non-public Preview
- technical/customer acceptance
- internal development

だけ。

Production licensing approvalではない。

productionApproved:
false

publicApproved:
false

を維持。

このauthorityは
第三者著作権所有を法的に証明するものではない。

provider自身が
追加の法的attestationを要求した場合のみ
human gate。

━━━━━━━━━━━━━━━━━━
13. PRIVATE MEDIA PROVIDER
━━━━━━━━━━━━━━━━━━

Phase6ではreal artwork bytesを
private external object storageへ配置し、
実provider pathを確認する。

優先:

existing compatible private R2 bucket

が存在すれば再利用。

無ければ、

exactly max1
private Preview-only R2 bucket

の作成を許可。

推奨名:

zao-rental-avatar-preview

ただし:

billing upgrade
paid plan
contract change

が必要なら勝手に承諾しない。

public bucket:
禁止

public R2.dev:
禁止

custom public domain:
禁止

CDN public cache:
禁止

bucket listing public:
禁止

━━━━━━━━━━━━━━━━━━
14. R2 OBJECT SCOPE
━━━━━━━━━━━━━━━━━━

upload対象はexactly3 derivativesのみ。

key:

private/derivative/sha256/<sha256>

既存ProviderMediaStore /
R2MediaProvider contractを再利用。

original source photo:
0

source PNG:
0

only derivative WebP:
3

Put:
max3 logical new objects

provider retry:
SDK maxAttempts1思想維持

hash mismatch:
stop/fail

metadata sha:
一致必須。

━━━━━━━━━━━━━━━━━━
15. R2 CREDENTIAL SEPARATION
━━━━━━━━━━━━━━━━━━

import/write credentialと
Preview runtime read credentialを分離できるなら分離。

推奨:

Phase6 importer:
temporary write credential

Vercel Preview:
bucket read-only credential

Previewには:

PutObject権限不要

DeleteObject権限不要

bucket admin不要

account admin不要

Production env:
0

secret in Git/chat/log:
0

raw credential evidence:
0

write credentialは
upload終了後revoke/delete。

read credentialのみ
Preview lifecycle中保持可。

━━━━━━━━━━━━━━━━━━
16. AVATAR MEDIA DELIVERY MUST USE PROVIDER IN HOSTED PREVIEW
━━━━━━━━━━━━━━━━━━

Hosted Previewでは
Avatar derivative byte pathを
Postgres byteaだけで完結させず、
actual private provider readを通す。

既存:

findForDelivery()
rights/release reauthorization

はDBがauthoritative。

byte retrievalのみ:

private provider

へ切替。

concept:

eligible before
↓
R2 private read by digest-derived key
↓
hash + raster validation
↓
eligible after
↓
guest ownership/session recheck
↓
response

を維持。

DB rights:
authority

R2:
byte storage

という責務分離。

local modeは
既存Postgres byte fixture pathを保持してよい。

━━━━━━━━━━━━━━━━━━
17. VERCEL PREVIEW ONLY
━━━━━━━━━━━━━━━━━━

existing Vercel projectを使用。

new production project:
0

Production deploy:
0

Preview deployment:
max2

Preview branch:

codex/avatar-phase6-hosted-preview

Vercel env mutations:
Preview scopeのみ。

Production env:
0

Square token:
0

payment write credential:
0

refund credential:
0

━━━━━━━━━━━━━━━━━━
18. DEPLOYMENT PROTECTION
━━━━━━━━━━━━━━━━━━

Previewは必ず
Vercel Authentication等の
platform protection下に置く。

anonymous internetから
GuestBooking Previewが直接開けないこと。

public share URL:
作らない。

SEO:
noindex

robots:
Previewで公開導線なし。

Production domain:
変更0。

有料Automation Bypassを
このPhaseのために購入しない。

CLI/API smokeが必要なら
認証済みVercel toolingを使用。

visual browser acceptanceは
Vercel-authenticated browser sessionを使用。

human login/MFAが実際に表示された場合だけ
Ownerへ1回依頼し、
完了後そのまま続行。

━━━━━━━━━━━━━━━━━━
19. PREVIEW ENV SECRETS
━━━━━━━━━━━━━━━━━━

Preview-only environmentへ
必要最小限だけ設定。

allowed:

Hosted preview runtime config

guest security secret

Neon runtime role credentials

Avatar read role credential

R2 read credential

explicit preview origin/config

禁止:

migration owner

R2 write credential

Square write token

Production secrets

refund credentials

real customer data secrets

main Production auth secrets
（既存と別用途なら持ち込まない）

━━━━━━━━━━━━━━━━━━
20. HOSTED ARTWORK IMPORT
━━━━━━━━━━━━━━━━━━

setup credentialを使った
bounded one-shot importerを用意。

既存Phase5 approved manifest/hashを正本にする。

hosted importは:

exact derivative hashes

exact three artwork identities

AVATAR_VISUALIZATION_V1

PROTECTED_PREVIEW_ONLY rights basis

current release

preview-scoped rights window

を使う。

既存contentを
truncate/delete/resetしない。

既存rowがある場合:
blind overwrite禁止。

同一exact import:
idempotent判定または明示safe refusal。

binding retarget:
0

━━━━━━━━━━━━━━━━━━
21. SYNTHETIC HOSTED DATA ONLY
━━━━━━━━━━━━━━━━━━

Guest acceptance用は
完全synthetic。

real customer:
0

real email:
0

real booking:
0

real payment:
0

real card:
0

inventory real custody:
0

example.invalid可。

R15 synthetic dataを
歴史として壊さない。

Phase6 fixtureは
明示markerを付ける。

━━━━━━━━━━━━━━━━━━
22. HOSTED GUEST FLOW
━━━━━━━━━━━━━━━━━━

Protected Previewで最低:

context create

draft save

preview

candidate display

RECOMMENDED

SHORTER

LONGER

appearance1

appearance2

Avatar image GET

guest selection

まで。

checkout/payment:
実行しない。

checkoutに進んだ場合は
payment disabled/fail closed
であることを確認するだけ。

Square calls:
0

━━━━━━━━━━━━━━━━━━
23. HOSTED BROWSER E2E
━━━━━━━━━━━━━━━━━━

実Vercel Preview URLで実施。

最低:

390px
1440px

2 synthetic members

両appearance

3 directions

actual image bytes from private provider

actual Hosted Neon metadata

実DOM:

skiHeight / bodyHeight

が
stored length/body height比と
Phase4 tolerance内。

horizontal overflow:
0

hydration error:
0

fatal console:
0

unexpected network:
0

━━━━━━━━━━━━━━━━━━
24. HOSTED SECURITY E2E
━━━━━━━━━━━━━━━━━━

最低:

valid guest:
200

anonymous:
deny

guest A:
own visual 200

guest B:
same media URL deny

logout:
old media URL deny

stale draft revision:
deny

wrong member:
deny

wrong visual:
deny

wrong digest:
deny

rights revoke:
deny

release replace:
deny

expired rights:
deny

inactive:
deny

rate-limit threshold:
429

global budget:
works

Preview outside Vercel protection:
deny before app

━━━━━━━━━━━━━━━━━━
25. RIGHTS REVOCATION WITH R2
━━━━━━━━━━━━━━━━━━

重要。

rights revoke時、
R2 object自体は存在しても
deliveryは即拒否すること。

DB authorizationが正本。

test:

successful media GET
↓
rights revoke
↓
same R2 object still exists
↓
next Guest GET 404

を確認。

R2 object存在
≠ delivery permission。

━━━━━━━━━━━━━━━━━━
26. PROVIDER FAILURE
━━━━━━━━━━━━━━━━━━

R2 read failure時:

Guest business response:
維持

Avatar image:
失敗/非表示

recommendation:
成功をfakeしない

business selection:
壊さない

secret:
漏らさない

raw provider error:
clientへ出さない。

━━━━━━━━━━━━━━━━━━
27. ARTWORK-1 RECHECK
━━━━━━━━━━━━━━━━━━

timeout修正後:

conflicting lock test

normal local import

hosted import

を確認。

Independent reviewへ
ARTWORK-1 closure candidateとして渡す。

Codex自己判断でCLOSEDにしない。

━━━━━━━━━━━━━━━━━━
28. AV-2
━━━━━━━━━━━━━━━━━━

仕様維持:

zero/ineligible artwork
→ rendererなし
→ fake artworkなし

これはproduct decision。

bugとして無理にcloseしない。

━━━━━━━━━━━━━━━━━━
29. AV-3
━━━━━━━━━━━━━━━━━━

Hosted Avatar least-privilege testが
実provider/Hosted DBでPASSした場合、

AV-3 closure candidateとして
Claudeへ渡す。

historical general content roleが
別用途で広いこと自体を
Avatarのために破壊しない。

Hosted Avatar runtimeが
それを使わなければよい。

━━━━━━━━━━━━━━━━━━
30. PHASE5-1
━━━━━━━━━━━━━━━━━━

rate limitが
actual protected hosted routeでPASSした場合、

PHASE5-1 closure candidate。

Codex自己判断でCLOSED禁止。

Independent reviewer判断。

━━━━━━━━━━━━━━━━━━
31. VALIDATION
━━━━━━━━━━━━━━━━━━

Phase6 minimum:

existing local targeted regression

migration hashes 0001–0032

ARTWORK-1 lock test

Hosted migration evidence

Hosted role positive/negative

R2 put/read/hash

R2 rights revoke behavior

Preview build

Preview runtime logs

Protected Preview access

Hosted Guest E2E

390px

1440px

rate-limit test

cross-guest

logout

rights revoke

lint

typecheck

build

secret scan

git diff --check

━━━━━━━━━━━━━━━━━━
32. NO R15 PAYMENT REPLAY
━━━━━━━━━━━━━━━━━━

R15 CreatePayment:
0

GetPayment:
0

Square API:
0

webhook:
0

subscription:
0

refund:
0

R10:
触らない。

Phase6はAvatar/Guest Previewのみ。

━━━━━━━━━━━━━━━━━━
33. EXTERNAL BUDGET
━━━━━━━━━━━━━━━━━━

Neon:
existing resource1
new resource0
new DB0
migration logical run max1

R2:
existing bucket reuse preferred
or new private Preview bucket max1
objects max3

R2 public exposure:
0

Vercel:
Preview deployment max2
Production deploy0

Square:
0

real customer:
0

real card:
0

real payment:
0

email/SMS:
0

main merge:
0

Production:
0

━━━━━━━━━━━━━━━━━━
34. CLEANUP / RETENTION
━━━━━━━━━━━━━━━━━━

Phase6 PASS後:

migration/setup DB credential:
remove

R2 write credential:
revoke/remove

temporary local secret files:
delete

temporary browser/process:
close

DB pools:
close

temporary failed deployments:
delete

final accepted protected Preview:

保持してよい。

ただし:

Vercel Authentication protection ON

Preview-only env

least privilege runtime credentials

R2 read-only

synthetic data only

Production0

の状態。

private R2 bucketと
exact3 derivative objectsも
Phase7用に保持可。

不要なduplicate objects:
0。

━━━━━━━━━━━━━━━━━━
35. CLAUDE FINAL REVIEW
━━━━━━━━━━━━━━━━━━

途中review:
0

Hosted technical acceptance完了後のみ
Claude independent review。

最大:

initial1

BLOCKER/HIGH/MEDIUM correctionが必要な場合のみ
correction1

PASS/LOW only:
再review0

review対象:

Hosted Preview runtime gate

Production fail-closed

Neon0031/0032

Hosted runtime roles

AV-3

Guest rate limiting

PHASE5-1

R2 credential separation

private media read

rights reauthorization

cross-guest isolation

ARTWORK-1 timeout

Vercel Preview protection

business invariants

external budgets

secret exposure

Claude:

tools0
MCP0
browser0
provider0
hooks0
edit0
push0

━━━━━━━━━━━━━━━━━━
36. PASS CLASSIFICATION
━━━━━━━━━━━━━━━━━━

PASS条件成立なら:

PHASE6_PROTECTED_HOSTED_PREVIEW_PASS

とする。

ただしこれは:

Production PASSではない。

public activationでもない。

main merge permissionでもない。

real customer permissionでもない。

━━━━━━━━━━━━━━━━━━
37. STOP CONDITIONS
━━━━━━━━━━━━━━━━━━

正常なlocal/hosted technical defectでは
Ownerへ戻らず修正。

停止が必要なのは:

paid upgrade required

provider legal/terms acceptance required

human login/MFA

new Neon resource required

Production secret required

Production deploy required

source rightsについて
providerが追加attestationを要求

secret exposure疑い

unexpected real customer/payment target

のみ。

━━━━━━━━━━━━━━━━━━
38. NEXT GATE
━━━━━━━━━━━━━━━━━━

Phase6 PASS後:

AVATAR PHASE 7 —
RELEASE CANDIDATE CONSOLIDATION
+ MAIN INTEGRATION
+ PRODUCTION READINESS

Phase7では:

branch history整理

Avatar + R15 integration

full regression

remote CI

production role design

production media rights

production env plan

rollback

observability

main merge candidate

を作る。

Phase6から
自動Production deployは禁止。

━━━━━━━━━━━━━━━━━━
39. FINAL REPORT
━━━━━━━━━━━━━━━━━━

最後にのみ報告:

Starting HEAD

New branch

Implementation HEAD

Reviewed HEAD

Final receipt HEAD

Neon resource
existing/new count

Hosted DB
0031 result
0032 result

migration hashes

ARTWORK-1 result

Hosted Avatar role result

AV-3 disposition

rate-limit result

PHASE5-1 disposition

R2 bucket
existing/new

R2 objects count

R2 write credential cleanup

R2 read credential scope

real artwork hashes

Vercel Preview deployment count

Deployment Protection result

Preview URL
safe protected URL only

anonymous protection result

Guest E2E result

mobile390 result

desktop1440 result

physical ratio max error

cross-guest result

logout result

rights revoke result

Square calls0

real customer0

real payment0

Production0

main merge0

secret exposure0

Claude verdict

BLOCKER/HIGH/MEDIUM/LOW

working tree clean

remote readback

final classification

next exact gate