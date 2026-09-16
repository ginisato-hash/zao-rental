【ZAO Rental｜AVATAR PHASE 4
Customer Visual Renderer + Rights-Safe Media Delivery + Staff-only Customer Preview】

目的:

Post-R15 Avatar A2/A3 PASSを固定基点として、
顧客向けに使用できる品質の2D/2.5D Avatar rendererを実装する。

このphaseで完成させるもの:

1. AvatarFitPreview renderer
2. 身長に対するスキー実寸比の描画
3. AVATAR / SKI / BOOT / JACKET / PANTS layered composition
4. Avatar専用・rights-safeな画像配信境界
5. Desktop / mobile responsive
6. staff-only customer-style preview
7. local real PostgreSQL + local browser E2E
8. independent review

このphaseではまだ一般ゲスト予約画面へ公開しない。
Production deployもしない。

次phaseでGuestBookingへ接続する。

━━━━━━━━━━━━━━━━━━
0. SOURCE OF TRUTH
━━━━━━━━━━━━━━━━━━

repo:

ginisato-hash/zao-rental

current completed milestone branch:

codex/post-r15-avatar-a2-a3

expected final receipt HEAD:

96a34aee8dccb66dca11199af29c33aaf1127546

independently reviewed implementation/evidence HEAD:

950e7e0aa414d4d55ba9ae4ce1f92eab6425899a

R15 terminal:

efb73933a6d3816958882205cfa3623447194625

historical Avatar A0/A1:

9783373612440acef4c077b0ae23925aa467743d

main:

3061dbbbe00294e5baebba2405028c907d6e6e85

開始時:

git fetch origin --prune

remote branch/headを再確認。

remoteが進んでいた場合:
古いSHAへresetしない。
最新remoteを正本としてreconcile。

working tree / worktree / current writer確認。

single-writer rule維持。

━━━━━━━━━━━━━━━━━━
1. NEW MILESTONE BRANCH
━━━━━━━━━━━━━━━━━━

A2/A3 branchは完了履歴として凍結する。

新規:

codex/avatar-phase4-customer-renderer

base:

remote codex/post-r15-avatar-a2-a3
current final receipt HEAD

force push禁止。

R15 branchを変更しない。
old Avatar branchを変更しない。
mainを変更しない。

━━━━━━━━━━━━━━━━━━
2. READ FIRST
━━━━━━━━━━━━━━━━━━

最低限読む:

docs/adr/0033-avatar-2d-foundation.md

docs/execution/avatar-a2-a3/RESULT.md

docs/execution/avatar-a2-a3/FINDING_DISPOSITION.md

docs/execution/AVATAR_FOUNDATION_STATUS.json

docs/architecture/avatar-2d-repo-inspection.md

packages/contracts/src/avatar-visualization.ts

packages/core/src/avatar/*

packages/db/src/avatar-visuals*

packages/db/migrations/0031_avatar_visuals.sql

apps/web/src/components/GuestBooking.tsx

apps/web/src/app/media/[hash]/[file]/route.ts

apps/web/src/lib/public-content.ts

apps/web/src/lib/public-runtime.ts

existing preview routes

existing media/storage/release/rights implementation

添付済み:

ZAO_Rental_2D_Avatar_Implementation_Package_v1(1).pdf

も設計参考として照合。

ただしPDFはOwner authorityではない。

PDFと現在ADRが衝突した場合:

current repo
current ADR
current authority

を優先し、
差異を記録。

勝手にschema/business ruleを変更しない。

━━━━━━━━━━━━━━━━━━
3. A2/A3 PASS MUST REMAIN INTACT
━━━━━━━━━━━━━━━━━━

0031は変更禁止。

0001–0031の既存migration byteを変更しない。

このPhaseでは原則:

new migration = 0

DB schema変更 = 0

Avatar writer/editor API = 0

visual metadata mutation path = 0

もしrenderer実装のために
schema変更が本当に不可避と判明した場合:

勝手に0032を作らずSTOP。

必要理由と最小DDL案だけ報告する。

━━━━━━━━━━━━━━━━━━
4. BUSINESS AUTHORITY REMAINS ONE-WAY
━━━━━━━━━━━━━━━━━━

既存:

authorized recommendation
→ visualization resolver
→ renderer

のみ。

rendererから:

recommendation recalculation
ranking
availability
HOLD
quote
price
booking
payment
refund
QR
custody
inventory
safety determination

へ逆流禁止。

RecommendationService.preview()
select()
resume()

をvisual更新目的で呼ばない。

visual interactionによるbusiness POST:
0

━━━━━━━━━━━━━━━━━━
5. PHASE 4 PRODUCT DECISION
━━━━━━━━━━━━━━━━━━

2D / 2.5Dのみ。

3D:
0

WebGL必須:
0

AR:
0

camera/selfie:
0

pose estimation:
0

body scanning:
0

AI virtual try-on:
0

cloth simulation:
0

Rendererは普通のHTML/CSS/image compositionを基本とする。

Canvas/WebGLを導入しない。

新規大型graphics dependencyを追加しない。

━━━━━━━━━━━━━━━━━━
6. RENDERER COMPONENT
━━━━━━━━━━━━━━━━━━

customer-grade reusable componentを作る。

推奨名称:

AvatarFitPreview

またはrepo namingに合わせた同等名称。

入力は:

AvatarVisualizationV1

active Direction

locale

のみを基本とする。

business objectを直接操作しない。

Renderer内部でDB/API fetchしない。

IOをcomponentへ埋め込まない。

presentation-only。

━━━━━━━━━━━━━━━━━━
7. PHYSICAL SCALE — MOST IMPORTANT
━━━━━━━━━━━━━━━━━━

スキーの表示長は
A3で既に計算された:

skiToBodyRatio

および:

skiLengthCm
customerHeightCm

を使用。

再計算する場合でも:

skiLengthCm / customerHeightCm

以外の補正は禁止。

表示上:

avatarBodyPhysicalHeightPx = H

skiPhysicalHeightPx =
H × skiToBodyRatio

とする。

例:

customer 170cm
ski 153cm

なら:

ski height / body height
= 153 / 170
= 0.9

視覚上もこの比率になること。

実際のDOM layout boxを使った
browser testで比率を検証する。

許容誤差:

±1px
または
±0.5%

程度の合理的な範囲。

CSS都合で
「大体同じ」にしない。

━━━━━━━━━━━━━━━━━━
8. COMMON BASELINE
━━━━━━━━━━━━━━━━━━

人とスキーは同じfloor baselineへ置く。

body:
頭頂→足底

ski:
tip→tail

の物理長を比較する。

画像内transparent paddingのせいで
比率が狂わないasset contractを定義する。

Avatar artwork:

body physical boundsが
canonical artboard上で固定。

JACKET/PANTS/BOOT:

同じcanonical body coordinate systemへ重ねられる素材。

SKI:

tip-tailを基準にtight physical bounds。

実素材がまだないので、
このphaseではsynthetic test artworkで
contractを実証する。

実顧客向け素材として偽装しない。

━━━━━━━━━━━━━━━━━━
9. LAYER COMPOSITION
━━━━━━━━━━━━━━━━━━

最低対応:

AVATAR
SKI
BOOT
JACKET
PANTS

推奨stack:

base avatar body
pants
jacket
boots

skiはbody横へ独立配置。

skiをbody上へ重ねて
身体寸法が見えなくなる構成は避ける。

A2 metadata:

anchor
position

を尊重。

random offset禁止。

renderはdeterministic。

同一payload:
同一layout。

━━━━━━━━━━━━━━━━━━
10. APPEARANCE
━━━━━━━━━━━━━━━━━━

APPEARANCE_1
APPEARANCE_2

は見た目のみ。

絶対に:

male/female business classification
gender inference
size recommendation
price
eligibility

へ使わない。

Phase4 staff previewでは
両appearanceを確認できること。

ただしGuestBookingへの
永続selection保存はまだ作らない。

Phase5でpresentation-only selectorとして接続する。

━━━━━━━━━━━━━━━━━━
11. CANDIDATE DIRECTIONS
━━━━━━━━━━━━━━━━━━

Rendererは:

RECOMMENDED
SHORTER
LONGER

すべて描画可能。

方向切替はvisual previewだけ。

切替時:

recommendation service再実行0
DB write0
HOLD0
quote0

既に取得済みpayloadを切り替える。

candidateがnullなら
存在するように作らない。

━━━━━━━━━━━━━━━━━━
12. ZERO / PARTIAL ARTWORK DECISION
━━━━━━━━━━━━━━━━━━

A2/A3 LOW AV-2をここで明確化する。

原則:

visualization自体がない
→ rendererを表示しない。

avatar visualがない
→ fake human silhouetteを生成しない。

ski visualがない
→ fake product skiを生成しない。

layer visualがない
→ そのlayerのみ省略。

数値情報:

customerHeightCm
skiLengthCm

が既存業務UIに存在する場合は
通常テキストとして残してよい。

ただし画像がないのに
「このスキーです」と見せる
generic fake artは禁止。

synthetic fixtureは
test / staff previewのみ。

顧客素材として表示しない。

AV-2はこの仕様決定を記録する。

historical LOW自体を
勝手に「independently closed」と書かない。

━━━━━━━━━━━━━━━━━━
13. MEDIA DELIVERY — DO NOT BROADEN EXISTING /media
━━━━━━━━━━━━━━━━━━

既存:

/media/[hash]/[file]

はcurrent public model mediaの
既存権限モデルを持つ。

Avatar対応のために
このrouteを雑にOR条件で広げない。

Avatar専用delivery boundaryを作る。

例:

/avatar-media/[visualId]/[hash]

またはrepo conventionに合う同等route。

GET only。

routeからbusiness write:
0

━━━━━━━━━━━━━━━━━━
14. AVATAR MEDIA AUTHORIZATION
━━━━━━━━━━━━━━━━━━

browserから受け取る:

visualId
hash

は完全にuntrusted。

client supplied:

revisionId
releaseId
rights flag
mediaId

をauthorization sourceにしない。

server側でcurrent DBを再確認。

画像を返す条件:

visual row ACTIVE

visualId一致

derivative digest一致

current release

immutable revision一致

AVATAR_VISUALIZATION_V1 purpose grant一致

mediaId一致

digest binding一致

processed

rightsConfirmed

not internalOnly

rightsUntil有効

current timeでeligible

であること。

一つでも不一致:

404

403で存在を教えるより
existing protected media behaviorに合わせて
fail closed / non-enumerableにする。

━━━━━━━━━━━━━━━━━━
15. RIGHTS REVOCATION
━━━━━━━━━━━━━━━━━━

metadataを一度取得したあとでも:

rights revoked
release replaced
visual disabled
digest retarget
purpose grant removed
rights expired

になった場合、

次のmedia GETで画像を返さないこと。

A3 metadata eligibilityを
永久delivery grantとして扱わない。

これはADR 0033の要求。

━━━━━━━━━━━━━━━━━━
16. PRIVATE MEDIA SAFETY
━━━━━━━━━━━━━━━━━━

Avatar routeから:

content workspace JSON
private original
credential
object key
signed URL
other media bytes

を漏らさない。

authorized derivative bytesのみ。

directory traversal不可。

query stringなど
不要な自由入力は拒否。

visual UUID形式厳格。

sha256形式厳格。

responseは画像以外を返さない。

SVGはこのphaseでは配信しない。

script-bearing vector formatを避ける。

透明layerは:

WebP alpha

を基本とする。

既存media pipelineで対応可能な形式を再確認。

新dependency不要。

MIMEはextensionを盲信せず、
既存media metadataまたは
safe byte validationを使う。

━━━━━━━━━━━━━━━━━━
17. CACHE POLICY
━━━━━━━━━━━━━━━━━━

rights/releaseが後から失効しうる。

したがってPhase4では
Avatar protected derivativeを

immutable public forever

として配信しない。

安全側:

Cache-Control:
private, no-store

または
既存rights-sensitive media policyに準拠。

性能最適化は
Customer Activation前に別途評価可。

権利取消よりcache hitを優先しない。

━━━━━━━━━━━━━━━━━━
18. SYNTHETIC ARTWORK ONLY
━━━━━━━━━━━━━━━━━━

このPhaseでは本物の:

人物画像
スキー商品画像
ウェア写真

をwebから取得しない。

外部素材:
0

R2:
0

provider upload:
0

本番画像:
0

tests / local preview用にのみ
synthetic transparent raster fixtureを生成。

既存画像processing dependencyを再利用。

新image library追加禁止。

fixtureには視覚的にも:

SYNTHETIC
TEST ONLY

と判別できる設計を採用してよい。

Gitへ大量binaryを入れない。

必要ならtest generation scriptで再現。

━━━━━━━━━━━━━━━━━━
19. ARTWORK AUTHORING SPEC
━━━━━━━━━━━━━━━━━━

docsへ:

AVATAR_ARTWORK_SPEC.md

等を作成。

最低定義:

canonical body artboard

body top/bottom physical bounds

common floor baseline

transparent background

appearance layers alignment

JACKET/PANTS/BOOT common coordinate system

SKI tip-tail crop rule

safe margin

aspect ratio rule

anchor/position semantics

WebP alpha

recommended source resolution

derivative sizes

no embedded text requirement

rights/purpose-grant requirement

実素材作成担当が
その文書だけで素材を作れる精度にする。

PDF v1に既存値があれば
current repoと整合する範囲で採用。

━━━━━━━━━━━━━━━━━━
20. RESPONSIVE DESIGN
━━━━━━━━━━━━━━━━━━

最低viewport:

320px mobile

390px mobile

768px tablet

1440px desktop

横overflow:
0

stageが画面外へ切れない。

skiが110%程度など
bodyより長くても切れない。

body + ski全体をstage bounds内へ
uniform scalingする。

重要:

stage全体を縮小してよいが、

body:ski ratio

は変えない。

mobileでskiを短く見せる禁止。

━━━━━━━━━━━━━━━━━━
21. ACCESSIBILITY
━━━━━━━━━━━━━━━━━━

visualだけでサイズ情報を伝えない。

必ずtextも残す。

例:

Your height 170 cm
Recommended ski 153 cm

日本語:

身長 170cm
おすすめ 153cm

画像layer自体がdecorativeなら:

aria-hidden

または適切なalt。

product promiseではない
generic imageへ
model名altを付けない。

disclaimerを表示。

A3 disclaimer意味を保持:

fit
safety
stock
model promise
booking
payment

を保証しない。

━━━━━━━━━━━━━━━━━━
22. LOCALIZATION
━━━━━━━━━━━━━━━━━━

最低:

ja
en

既存locale patternを利用。

新i18n library導入禁止。

hard-coded Japanese onlyにしない。

表示文言は
customer-facingとして自然にする。

ただし法的/安全意味を弱めない。

━━━━━━━━━━━━━━━━━━
23. CUSTOMER-STYLE STAFF PREVIEW
━━━━━━━━━━━━━━━━━━

一般guestにはまだ公開しない。

staff-only previewを作る。

推奨:

/preview/avatar

既存preview security patternを使用。

最低権限:

BOOKING_VIEW
または現repoで最小の既存read permission。

未ログイン:
表示不可。

権限なし:
表示不可。

preview用に
新staff permissionを作らない。

previewは
最終customer componentをそのまま使う。

「別の簡易デモUI」ではなく、
同一AvatarFitPreview component。

━━━━━━━━━━━━━━━━━━
24. DO NOT INSERT INTO GuestBooking YET
━━━━━━━━━━━━━━━━━━

apps/web/src/components/GuestBooking.tsx

を調査はする。

しかしこのPhaseでは
一般guest flowへrendererを表示しない。

理由:

本物のartwork
customer asset grants
activation gate

がまだ無い。

GuestBooking business behaviorを
このmilestoneで変えない。

Customer insertionは次Phase。

━━━━━━━━━━━━━━━━━━
25. NO FEATURE FLAG SAAS
━━━━━━━━━━━━━━━━━━

LaunchDarkly等:
0

new external feature service:
0

Production env flag:
0

このPhaseのcustomer-visible status:

false

一般navigation link:
0

public landing link:
0

GuestBooking insertion:
0

Production route activation:
0

━━━━━━━━━━━━━━━━━━
26. UNIT TESTS
━━━━━━━━━━━━━━━━━━

最低:

ratio 150/170

ratio 170/170

ski longer than body

invalid/absent visualization

null RECOMMENDED

null SHORTER

null LONGER

missing avatar

missing ski visual

missing boot

missing jacket

missing pants

APPEARANCE_1

APPEARANCE_2

REGULAR generic

PREMIUM exact

WEAR no ski

SNOWBOARD no ski

same payload deterministic DOM/layout props

renderer triggers no business callbacks

━━━━━━━━━━━━━━━━━━
27. MEDIA SECURITY TESTS
━━━━━━━━━━━━━━━━━━

real local PostgreSQLで:

valid current release
→ image 200

wrong visualId
→ 404

wrong digest
→ 404

inactive visual
→ 404

expired rights
→ 404

revoked rights
→ 404

internal-only
→ 404

stale release
→ 404

purpose grant removed
→ 404

revision changed
→ 404

media digest retarget
→ 404

unrelated private digest
→ 404

malformed UUID
→ 404

malformed hash
→ 404

POST
→ 405 or framework equivalent

business writes:
0

private original disclosure:
0

workspace JSON disclosure:
0

━━━━━━━━━━━━━━━━━━
28. BROWSER E2E
━━━━━━━━━━━━━━━━━━

local Next serverのみ。

external browser/network:
0

Playwrightで最低:

Desktop Chromium

iPhone-sized Chromium viewport

を実施。

Safari実機PASSとは主張しない。

Browser testで実際のDOM bounding boxを取得。

例:

bodyBox.height = H

skiBox.height = S

abs(
 S/H - skiToBodyRatio
)

が許容差以内。

viewport変更後も成立。

appearance switch preview成立。

direction switch成立。

layer positioning成立。

rights revoke後refresh:
media fail closed。

horizontal overflow:
0。

console fatal:
0。

hydration error:
0。

━━━━━━━━━━━━━━━━━━
29. VISUAL REGRESSION EVIDENCE
━━━━━━━━━━━━━━━━━━

local synthetic fixtureで
screenshotsを証拠として保存してよい。

最低:

mobile

desktop

shorter ski

recommended ski

longer ski

full layers

missing optional layers

ただし
「デザイン完成素材」とは扱わない。

synthetic fixtureであると記録。

画像snapshotは
security secretを含まないこと。

━━━━━━━━━━━━━━━━━━
30. PERFORMANCE
━━━━━━━━━━━━━━━━━━

renderer起動時:

provider call 0

business write 0

extra recommendation calculation 0

image request数は
実際に表示するlayer分だけ。

hidden direction全部の
画像を無条件preloadしない。

layout shiftを抑える。

明示stage dimensionsを持つ。

新規巨大JS dependency:
0

WebGL bundle:
0

━━━━━━━━━━━━━━━━━━
31. EXISTING LOW FINDINGS
━━━━━━━━━━━━━━━━━━

AV-1:
visual binding fields update可能

今回writer/editorを作らない。
historical LOW OPEN維持。

AV-2:
zero artworkでvisualization全体なし

今回仕様:

zero artwork
→ rendererなし
→ fake imageなし

と明記。

historical LOWを
勝手にindependently closedにしない。

AV-3:
test reader roleがcontent_workspace full JSON SELECT可能

今回hosted/runtime roleを新規作らない。

broad roleをproductionに流用しない。

media routeのresponseから
workspace内容を一切露出しない。

historical LOW OPEN維持。

━━━━━━━━━━━━━━━━━━
32. REGRESSION
━━━━━━━━━━━━━━━━━━

最低関連回帰:

Avatar A2/A3

recommendation

guest auth

staff auth

content rights/release

media delivery

booking preview relevant tests

GuestBooking existing behavior

payment logicを変更していないこと

HOLD logicを変更していないこと

R15 external acceptance:
再実行禁止。

━━━━━━━━━━━━━━━━━━
33. VALIDATION
━━━━━━━━━━━━━━━━━━

最低:

targeted unit

real local PostgreSQL media/security tests

local browser E2E

responsive browser measurements

lint

typecheck

build

secret scan

git diff --check

existing migration hash check
0001–0031 unchanged

migrationAdded:
0

━━━━━━━━━━━━━━━━━━
34. EXTERNAL OPERATION BUDGET
━━━━━━━━━━━━━━━━━━

このPhase:

Square 0

hosted Neon 0

Vercel deploy 0

Vercel env 0

R2 0

external media provider 0

external browser 0

Production 0

real payment 0

real customer 0

email/SMS 0

new external service 0

main merge 0

PR 0

GitHub branch pushのみ可。

local PostgreSQL:
可。

local Next:
可。

local Playwright:
可。

Claude static review:
可。

━━━━━━━━━━━━━━━━━━
35. CLAUDE INDEPENDENT REVIEW
━━━━━━━━━━━━━━━━━━

Codex self-validation後のみ。

sanitized static review。

Claude:

tools off
MCP off
browser off
provider off
hooks off
code edit off
push off

Review重点:

physical ratio correctness

layer composition

rights reauthorization

private media isolation

current release semantics

no business authority

GuestBooking unchanged

staff-only preview boundary

responsive correctness evidence

A2/A3 LOW handling

media route enumeration/leak risk

migration unchanged

review budget:

initial max1

correction review max1 only if
BLOCKER/HIGH/MEDIUM found and
Codex makes a local correction.

LOW-only / PASS:
不要な再review禁止。

━━━━━━━━━━━━━━━━━━
36. REVIEW OUTCOMES
━━━━━━━━━━━━━━━━━━

PASS
BLOCKER0
HIGH0
MEDIUM0

なら:

resultを保存
commit
push
remote readback
clean確認
STOP。

LOWはそのまま記録可。

BLOCKER/HIGH/MEDIUM:

local correction可能。

correction後:

targeted self-validation

correction independent re-review最大1

それでもBLOCKER/HIGH/MEDIUM残存:
STOPしてChatGPTへ返す。

安全findingsを
Codex自己判断でclosedにしない。

━━━━━━━━━━━━━━━━━━
37. GIT / EVIDENCE
━━━━━━━━━━━━━━━━━━

保存:

Phase4 authority/status

implementation summary

artwork spec

ratio test evidence

media authorization test evidence

browser test evidence

responsive measurements

screenshots manifest

validation results

review manifest

review result

finding disposition

secret scan

final receipt

コードレビュー対象SHAと
review receipt commit SHAを区別。

A2/A3のように
review後のdocs-only commitを
reviewed codeと誤記しない。

━━━━━━━━━━━━━━━━━━
38. STOP BOUNDARY
━━━━━━━━━━━━━━━━━━

Phase4 PASS後に停止。

まだ行わない:

real artwork creation/upload

GuestBooking customer insertion

customer appearance preference persistence

customer-facing toggle

public activation

visual admin editor

visual authoring API

bulk asset registration

R2 upload

Vercel Preview/Production deploy

hosted DB migration

main merge

Production activation

━━━━━━━━━━━━━━━━━━
39. NEXT EXACT GATE
━━━━━━━━━━━━━━━━━━

Phase4 PASS後:

AVATAR PHASE 5 —
GUEST BOOKING INTEGRATION + REAL ARTWORK ACTIVATION

想定内容:

real approved artwork

purpose grants

GuestBooking candidate step insertion

appearance selector

RECOMMENDED/SHORTER/LONGER customer UI

wear/boots overlays

actual authorized media delivery

customer E2E

activation review

ただしPhase4から自動継続しない。

━━━━━━━━━━━━━━━━━━
40. FINAL REPORT
━━━━━━━━━━━━━━━━━━

最後にのみ報告:

starting HEAD

new branch

implementation HEAD

final receipt HEAD

migration changes
(expected 0)

AvatarFitPreview result

physical ratio test result

media delivery result

rights revoke result

staff preview auth result

responsive result

desktop browser result

mobile viewport result

unit count

local PG count

browser E2E count

lint/typecheck/build

old migration hashes unchanged

business writes from renderer
0

external operations
all0

Claude verdict

BLOCKER/HIGH/MEDIUM/LOW counts

prior AV-1/2/3 dispositions

working tree clean

remote readback

customer-visible
false

next exact gate:

AVATAR PHASE 5 —
GUEST BOOKING INTEGRATION + REAL ARTWORK ACTIVATION