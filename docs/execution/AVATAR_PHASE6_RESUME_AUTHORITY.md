【ZAO Rental｜AVATAR PHASE 6 RESUME AUTHORITY
Browser Tool-History Incident Contained
+ Dedicated Isolated Preview Project】

私はOwnerとしてPhase6の再開を承認する。

Phase6を最初からやり直さない。
checkpoint HEADから継続する。

current branch:
codex/avatar-phase6-hosted-preview

expected remote HEAD:
71ae7a5bc3d83beecae61d9d35de128dc5018a9c

このHEADを正本として継続する。

━━━━━━━━━━━━━━━━━━
0. INCIDENT ASSESSMENT
━━━━━━━━━━━━━━━━━━

STOP_RECORD.mdのhistorical incidentを
永久保持する。

classification:

HISTORICAL_POTENTIAL_TOOL_METADATA_EXPOSURE
CONTAINED_NO_REUSE

今回:

secretExposureZero:
NOT_CLAIMED

confirmedProviderCredentialCompromise:
false / not established

authenticationReplay:
0

credentialExtraction:
0

sessionReuse:
0

externalWriteAtIncident:
0

過去のtab-list出力を
再度開く・検索する・復元する・分類することは禁止。

query parameterやtoken値を
再表示しない。

incidentを消去・downgradeしない。

━━━━━━━━━━━━━━━━━━
1. NO BLANKET ROTATION
━━━━━━━━━━━━━━━━━━

今回のincidentだけを理由として:

Neon credential rotation
Vercel credential rotation
Square key rotation
Cloudflare credential rotation
Google session rotation

等を一括実行しない。

具体的なdurable credential compromiseが
新たに確認された場合のみ停止して報告。

現時点ではPhase6 resumeを許可する。

━━━━━━━━━━━━━━━━━━
2. BROWSER SAFETY MODEL — REPLACE GLOBAL TAB ENUMERATION
━━━━━━━━━━━━━━━━━━

今後Phase6では:

cua.listTabs
全tab一覧
global browser inventory

を使用禁止。

無関係な既存user tabを
列挙・inspect・captureしない。

使用可能なのは:

- Phase6開始後に自分で開いたtask-owned tab
- そのtabのsafe opaque handle
- allowlisted origin

のみ。

保存可能:

taskTabId
provider category
origin only

例:
https://vercel.com
https://console.neon.tech
https://dash.cloudflare.com

保存禁止:

full URL
query string
fragment
callback URL
page title if secret-bearing可能性あり
cookies
localStorage
sessionStorage
auth headers
token values
browser history

task-owned tab判定不能なら
そのbrowser operationは実行しない。

━━━━━━━━━━━━━━━━━━
3. USE PROVIDER API/CLI BEFORE BROWSER
━━━━━━━━━━━━━━━━━━

可能な操作は優先して:

provider API
existing authenticated CLI
official connector

を使う。

browserは:

human login
MFA
provider consoleでしか出来ない設定

だけに限定。

Cloudflare loginは
現時点では不要。

R2 stepへ到達し、
かつAPI/CLIで認可が得られず、
実際にhuman login/MFAが必要になった時だけ
Ownerへ一度依頼。

それまではCloudflare login画面を開かない。

━━━━━━━━━━━━━━━━━━
4. CHECKPOINT WORK IS RETAINED
━━━━━━━━━━━━━━━━━━

checkpointで既にPASSした:

61 targeted tests
PG lock proof
lint
typecheck
build
migration hash preservation

をhistorical evidenceとして保持。

sourceを変更しない限り
無意味に全再実行しない。

checkpoint partial implementation:

hosted preview config
rate-limit foundation
hosted migration runner
hosted role provisioner
import timeout correction

を捨てない。

必要な差分だけ修正して継続。

━━━━━━━━━━━━━━━━━━
5. EXTERNAL BUDGET REMAINS UNCONSUMED
━━━━━━━━━━━━━━━━━━

STOP時点:

Hosted migration:
0 / max1

new Neon resource:
0

new DB:
0

R2 bucket:
0 / max1

R2 objects:
0 / max3

Vercel Preview deploy:
0 / max2

Claude:
initial0 / max1
correction0 / max1

Square:
0

payment:
0

Production:
0

main merge:
0

したがってbudgetは
checkpoint前と同じ残量でresumeする。

━━━━━━━━━━━━━━━━━━
6. CRITICAL VERCEL ISOLATION AMENDMENT
━━━━━━━━━━━━━━━━━━

既存Vercel project:

zao-rental
project id:
prj_ehUMOzM77em9DVnHJBJffncD5hg7

のcommon Preview env metadataには
historical Square関連envが存在する。

値を読むことは禁止。

このprojectを
Avatar Phase6 Preview deploymentに使用しない。

理由:
Avatar Phase6にSquare access token等は不要であり、
deployment secret minimizationに反する。

Phase6専用の新projectを
exactly max1作成してよい。

name:

zao-rental-avatar-preview

目的:

Phase6 protected Preview only

これはProduction application projectではない。

━━━━━━━━━━━━━━━━━━
7. DEDICATED VERCEL PROJECT BOUNDARY
━━━━━━━━━━━━━━━━━━

new dedicated project:

zao-rental-avatar-preview

条件:

Git/source:
current Phase6 branchのみ

custom domain:
0

Production deploy:
0

Production alias:
0

Square env:
0

payment env:
0

refund env:
0

webhook env:
0

main Production secrets:
0

Deployment Protection:
Vercel Authentication ON

anonymous access:
deny

public share bypass:
0

billing upgrade:
0

paid add-on:
0

もしproject creation自体に
paid upgrade/terms acceptanceが必要なら停止。

通常無料範囲なら自律継続。

━━━━━━━━━━━━━━━━━━
8. ENV ALLOWLIST — NAMES ONLY
━━━━━━━━━━━━━━━━━━

Phase6 dedicated projectへ設定してよいenvは
明示allowlist方式。

必要最小限:

Hosted Preview runtime config
Guest security key/config
Neon least-privilege runtime roles
Avatar read runtime
R2 read-only runtime credential
Preview origin / Phase6 mode

のみ。

deny by default。

特に:

SQUARE_
PAYMENT_
REFUND_
WEBHOOK_

prefixは
Avatar Phase6 dedicated projectで0件であること。

env値の一覧表示は禁止。

検証は:

key names
target environment
sensitivity classification

まで。

secret valueをevidenceへ書かない。

━━━━━━━━━━━━━━━━━━
9. RESUME HOSTED EXECUTION
━━━━━━━━━━━━━━━━━━

browser incident containmentと
dedicated Preview project方針を
新しいresume authority/evidenceへ保存し、
commit/push/readback後にHosted作業再開。

順序:

A.
Existing Neon preflight

B.
0031 / 0032 migration
max1 logical run

C.
Hosted least-privilege Avatar role proof

D.
AV-3 hosted negative proof

E.
Guest Avatar rate limit hosted proof

F.
Private R2 bucket/object setup

G.
exact3 approved derivative upload

H.
dedicated Vercel project Preview env setup

I.
protected Preview deploy

J.
Hosted GuestBooking E2E

K.
cross-guest/logout/rights-revoke/rate-limit

L.
Claude final independent review

中間Owner確認不要。

━━━━━━━━━━━━━━━━━━
10. NEON
━━━━━━━━━━━━━━━━━━

existing resourceのみ:

store_i5vh0ZEKo2ikcVo9

existing DB:

zr_852b20c4d4b0

new resource:
0

new DB:
0

R15 hosted verifier:
変更禁止。

Phase6 runnerで
existing0001–0030 hash確認後:

0031
0032

のみ適用。

unexpected partial state:
stop。

migration owner credentialは
runtime/Vercelへ置かない。

━━━━━━━━━━━━━━━━━━
11. R2
━━━━━━━━━━━━━━━━━━

Cloudflare loginを
先回りして要求しない。

まずavailable official API/CLI pathを使用。

existing compatible private bucketがあれば再利用。

無ければauthority内で:

max1 private bucket

作成可。

public access:
0

r2.dev public:
0

custom public domain:
0

upload:
exact3 derivative only

source photo:
0

object key:

private/derivative/sha256/<digest>

write credentialは
upload後revoke/remove。

Preview runtime:
read-only。

━━━━━━━━━━━━━━━━━━
12. RATE LIMIT
━━━━━━━━━━━━━━━━━━

checkpointで実装した
GuestSecurity-based rate foundationを完成させる。

client-controlled headerを
trusted peerとして使用禁止。

Hosted Vercel ingressで
検証可能なpeer sourceだけ使う。

正常GuestBooking:
PASS

normal Avatar images:
PASS

bounded abuse:
429

global limit:
PASS

peer limit:
PASS

business endpointsの既存rate policyを
弱めない。

PHASE5-1 closure判断は
最終Claudeへ委ねる。

━━━━━━━━━━━━━━━━━━
13. HOSTED ROLE / AV-3
━━━━━━━━━━━━━━━━━━

Hosted Avatar runtime roleで:

allowed:
narrow visual eligibility
approved derivative access

denied:

content_workspace raw JSON
content_media_objects direct raw SELECT
content_revision_records broad SELECT
avatar_visuals broad mutation
guest_contexts arbitrary SELECT
recommendation data arbitrary SELECT
business write
DDL
role management
PUBLIC function execution

を実Neonで証明。

AV-3 closure判断は
Claudeへ委ねる。

━━━━━━━━━━━━━━━━━━
14. ARTWORK-1
━━━━━━━━━━━━━━━━━━

checkpointで:

lock timeout proof
55P03 bounded failure
rollback rows0
normal exact3 import PASS

済み。

そのsourceが変わっていなければ
再度local proofを無意味に繰返さない。

Hosted importでもbounded timeoutが
有効であることだけ確認。

ARTWORK-1 closure candidateとして
Claudeへ渡す。

━━━━━━━━━━━━━━━━━━
15. HISTORICAL INCIDENT FINAL REPORTING
━━━━━━━━━━━━━━━━━━

Phase6が最終PASSしても:

secretExposure:
0

とは書かない。

必ず:

historicalToolMetadataIncident:
POTENTIAL_EXPOSURE_PRESERVED

historicalSecretExposureZeroClaim:
false

knownReplay:
0

knownExternalDisclosure:
0

knownCredentialUse:
0

newSecretExposureObservedAfterResume:
0

という形で区別する。

過去incidentを
Phase6成功によって消さない。

━━━━━━━━━━━━━━━━━━
16. NEW EXPOSURE STOP CONDITION
━━━━━━━━━━━━━━━━━━

resume後に新たに:

secret value
auth callback
token
cookie
full credential URI
unrelated tab URL query

がagent/tool outputへ出た疑いがある場合:

即停止。

再調査のために
その値を再表示しない。

classificationのみ保存。

━━━━━━━━━━━━━━━━━━
17. FINAL PASS
━━━━━━━━━━━━━━━━━━

Hosted acceptanceが全てPASSし、
Claudeも:

BLOCKER0
HIGH0
MEDIUM0

ならtechnical classification:

PHASE6_PROTECTED_HOSTED_PREVIEW_PASS

を許可。

ただしmandatory annotation:

WITH_HISTORICAL_TOOL_METADATA_INCIDENT

を付与。

例:

PHASE6_PROTECTED_HOSTED_PREVIEW_PASS
historicalIncident =
POTENTIAL_TOOL_METADATA_EXPOSURE_PRESERVED

Production:
0

main merge:
0

real customer:
0

Square:
0

を維持。

━━━━━━━━━━━━━━━━━━
18. FINAL STOP
━━━━━━━━━━━━━━━━━━

Phase6 PASS後:

Phase7へ自動継続禁止。

次:

AVATAR PHASE7
RELEASE CANDIDATE CONSOLIDATION
+ MAIN INTEGRATION
+ PRODUCTION READINESS

へChatGPT Technical Director assessmentを返す。

━━━━━━━━━━━━━━━━━━
19. FINAL REPORT
━━━━━━━━━━━━━━━━━━

最後のみ報告:

Starting HEAD
Final HEAD
working tree
remote readback

historical incident classification

new secret exposure after resume

Neon migration
0031
0032

Hosted roles
AV-3

rate limit
PHASE5-1

R2 bucket
objects3
credential cleanup

dedicated Vercel project
project id
protection
env allowlist result
Square env count=0

Preview deployments

Hosted Guest E2E

390px
1440px

physical ratio

cross-guest

logout

rights revoke

anonymous Vercel protection

ARTWORK-1 disposition

Claude verdict

BLOCKER/HIGH/MEDIUM/LOW

Square0
payment0
Production0
main merge0

final classification

next exact gate