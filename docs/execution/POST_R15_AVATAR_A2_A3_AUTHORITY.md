【ZAO Rental｜Post-R15 Product Development
Avatar 2D/2.5D Foundation — Rebase/Consolidation + A2/A3 Implementation】

目的:

R15 terminal PASSを製品開発の新しい基点として固定し、
以前A0/A1で設計だけ採用して停止していた
2D/2.5D Avatar visualizationのA2/A3を実装する。

今回はProduction activationではない。

実装対象:

A2:
DB / visual metadata foundation

A3:
contract / query / resolver / pure mapper foundation

UI renderer・予約画面への表示は次phase。
今回まだProduction deployしない。

━━━━━━━━━━━━━━━━━━
0. SOURCE OF TRUTH
━━━━━━━━━━━━━━━━━━

repo:

ginisato-hash/zao-rental

R15 terminal branch:

codex/external-acceptance-p6

expected terminal HEAD:

efb73933a6d3816958882205cfa3623447194625

historical Avatar branch:

codex/avatar-2d-foundation

expected Avatar HEAD:

9783373612440acef4c077b0ae23925aa467743d

main historical protected HEAD:

3061dbbbe00294e5baebba2405028c907d6e6e85

開始時に必ず:

git fetch origin --prune

各branch/headをremoteで確認。

GitHub remoteが進んでいた場合は
古いexpected SHAへ戻さず、
最新を正本としてreconcile。

working tree / worktreesも確認。

single writer維持。

━━━━━━━━━━━━━━━━━━
1. DO NOT CONTINUE ON THE STALE AVATAR BRANCH
━━━━━━━━━━━━━━━━━━

historical Avatar branchは:

R15 finalに対して大きくbehindしており、
R15がまだblockedだった時点の運用文言を含む。

したがって:

codex/avatar-2d-foundation

へそのままproduct codeを書かない。

また、

Avatar branchへR15 branchを雑にmergeして
過去のgate/status文書を衝突解決する方式も避ける。

R15 terminal HEADから新しいbranchを作る。

推奨:

codex/post-r15-avatar-a2-a3

base:

efb73933a6d3816958882205cfa3623447194625

━━━━━━━━━━━━━━━━━━
2. ADOPT ONLY THE AVATAR DESIGN INTENT
━━━━━━━━━━━━━━━━━━

historical Avatar commit:

9783373612440acef4c077b0ae23925aa467743d

から必要なのは主に:

docs/architecture/avatar-2d-repo-inspection.md

docs/adr/0033-avatar-2d-foundation.md

AVATAR_FOUNDATION_STATUS相当

で定義した設計判断。

古い:

R15 BLOCKED
Neon terms gate
A2/A3 blocked
old base SHA

等の運用状態をそのまま移植しない。

現在の事実:

R15_PASS
SANDBOX E2E VALIDATED

へ更新する。

AGENTS.md
CLAUDE.md
SCOPE.md

についても、
旧Avatar branchの古いR15 gateを丸ごとcherry-pickしない。

現在のpermanent governanceを維持する。

━━━━━━━━━━━━━━━━━━
3. ADOPTED PRODUCT BOUNDARY
━━━━━━━━━━━━━━━━━━

Avatar visualizationはoptional presentation。

絶対に以下のauthorityを持たせない:

推薦再計算
在庫判定
HOLD
価格
決済
予約成立
QR
custody
refund
安全適合判定

データ方向は一方向:

existing authorized recommendation
↓
visual resolver
↓
optional visualization payload

visual
↓
business decision

は禁止。

visualが壊れても、
既存予約フローがそのまま成立すること。

━━━━━━━━━━━━━━━━━━
4. AVATAR DESIGN
━━━━━━━━━━━━━━━━━━

2D / 2.5D layered composition。

初期設計:

body visual:
2 appearance variants

avatarTypeはpresentation preferenceのみ。

業務上の:

sex
gender
身体分類
推薦
価格
商品利用可否

には使わない。

選択必須にしない。

未選択でも予約可能。

optional layers:

ski
boots
jacket
pants

対象外:

3D/WebGL必須化
AR
camera
selfie
pose estimation
body scan
AI virtual try-on
cloth simulation

━━━━━━━━━━━━━━━━━━
5. PHYSICAL SCALE RULE
━━━━━━━━━━━━━━━━━━

可視化では、
既存推薦結果に含まれる実際のski lengthを使用。

正本:

customerHeightCm
Candidate.lengthCm

表示比率:

skiToBodyRatio =
skiLengthCm / customerHeightCm

renderer将来式:

skiDisplayHeightPx =
avatarBodyHeightPx * skiToBodyRatio

ただし今回A3では
表示情報を提供するまで。

renderer UIはまだ作らない。

positive finite valuesでない場合:

visualization null / omitted

とする。

別サイズへ補正しない。

━━━━━━━━━━━━━━━━━━
6. PRODUCT SEMANTICS MUST REMAIN UNCHANGED
━━━━━━━━━━━━━━━━━━

Direction:

RECOMMENDED
SHORTER
LONGER

をrenameしない。

visual payload側で:

recommended
short
long

等にpresentation mappingしてもよいが、
business enumは変更しない。

既存:

height - 20 ±15
boot sizing
age/class
availability
ranking
quote
premium promise
regular model non-guarantee

をvisual側で再計算しない。

Snowboardへski visual logicを流用しない。

WEAR-onlyの:

height=null
lengthCm=0

から比率を生成しない。

━━━━━━━━━━━━━━━━━━
7. A2 — DATABASE FOUNDATION
━━━━━━━━━━━━━━━━━━

まずcurrent R15 terminal repoを再調査して:

latest migration number
current media/content tables
ledger_models
ledger_variants
rights/release structures

を確認。

現在想定latestは0030だが、
必ずremote実体を確認してから次migration番号を決定。

過去migrationは絶対に変更しない。

A2はadditive migrationのみ。

設計要件:

visual metadataは
physical inventoryとは独立。

visual row数を:

asset数
在庫数
wear quantity
pole quantity

として扱わない。

画像bytesを新visual tableへ保存しない。

既存immutable media/digest/object-key思想を再利用。

persistent fieldへ:

signed URL
temporary URL
credential

を保存しない。

Visual metadataは最低限:

stable UUID

visual kind / layer

appearance/avatar type where applicable

optional ledger model reference

optional ledger variant reference where semantically valid

media/digest reference

active / disabled

stable sort

normalized anchor/position metadata where needed

fallback classification

rights/release linkage or equivalent eligibility reference

created_at
updated_at

を表現できる構造とする。

具体的なDDLは既存content/media schemaを再調査して
重複masterを作らないよう決定。

━━━━━━━━━━━━━━━━━━
8. FALLBACK RULES
━━━━━━━━━━━━━━━━━━

resolver順:

1.
candidate promiseにexact matchする
active + rights-valid visual

2.
同じ表示用途として許可された
generic fallback

3.
null

禁止:

missing product candidateを
visual fallbackで生成

違うmodel/season/variant/lengthを
同じ商品であるかのように表示

rights revoked
expired
internal-only

をfallback利用

複数defaultをランダム選択

DB/queryで曖昧defaultを排除する。

━━━━━━━━━━━━━━━━━━
9. A2 RIGHTS / MEDIA
━━━━━━━━━━━━━━━━━━

既存content/mediaの:

immutable digest
private original
derivative
revision
rights
release

思想を維持。

既存model photoが存在しても、
それをgeneric avatar/wear assetの
利用許可済み素材だと勝手に扱わない。

今回:

R2 live access 0
new storage provider 0
new CMS 0
image upload 0

synthetic metadata/fixtureで検証する。

━━━━━━━━━━━━━━━━━━
10. A3 — CONTRACT FOUNDATION
━━━━━━━━━━━━━━━━━━

A2完了後、
optional visualization payload v1を追加。

既存recommendation responseを破壊しない。

新fieldはoptional。

feature absent / visual missing時は
既存payloadと既存flowが成立する。

概念例:

visualization?: {
  version: 1

  avatarType?: ...

  customerHeightCm?: number

  avatar?: VisualRef | null

  candidates: {
    RECOMMENDED?: {
      skiLengthCm
      visual
      fallback
      skiToBodyRatio
    } | null

    SHORTER?: ...
    LONGER?: ...
  }

  boot?: VisualRef | null
  jacket?: VisualRef | null
  pants?: VisualRef | null

  disclaimer
}

これはconceptual shape。

repoの既存contract naming/styleを調査して
正式型を決定。

━━━━━━━━━━━━━━━━━━
11. PURE VISUAL MAPPER
━━━━━━━━━━━━━━━━━━

pure mapperを実装。

入力:

既に認可済み・計算済みの
MemberRecommendation / Profile / visual metadata

出力:

optional visual payload

mapper内禁止:

DB query
provider call
RecommendationService.preview()
HOLD
Quote
inventory
payment
write
session/auth bypass

deterministicであること。

visual missing:
null

business error:
business errorのまま

visual失敗を使って
business errorをsuccessへ変換しない。

━━━━━━━━━━━━━━━━━━
12. QUERY / RESOLVER
━━━━━━━━━━━━━━━━━━

visual resolverはread-only。

既存:

staff auth
guest actor
store ownership
session
content rights

を緩めない。

必要なら新しいrepository/query interfaceを作るが、
visual用に既存business serviceを再実行しない。

N+1を避け、
候補3方向 + optional layersを
有限queryで解決。

fallback順位はdeterministic。

━━━━━━━━━━━━━━━━━━
13. FEATURE STATE
━━━━━━━━━━━━━━━━━━

今回renderer/booking UIは作らない。

したがってA2/A3完了時点でも:

feature:
OFF

customer-visible:
false

とする。

新しいSaaS feature flag導入禁止。

Production env変数追加禁止。

routeから自動的に公開しない。

A3 contract/resolverを
後続UIで使える状態まで作る。

━━━━━━━━━━━━━━━━━━
14. MIGRATION VALIDATION
━━━━━━━━━━━━━━━━━━

実PostgreSQL local environmentで:

fresh empty DB
↓
0001 through latest

PASS。

さらに:

R15 current schema
↓
new Avatar additive migration

PASS。

確認:

old migration hashes unchanged

new migration checksum tracked

nullable model relation

nullable variant relation

invalid reference rejected

active/disabled semantics

fallback/default uniqueness

stable ordering

rights-ineligible visual excluded

visual rows0でも正常

━━━━━━━━━━━━━━━━━━
15. REGRESSION TESTS
━━━━━━━━━━━━━━━━━━

最低限:

zero visuals
→ existing recommendation unchanged

all visuals inactive
→ existing recommendation unchanged

rights invalid
→ visualization null/fallback only

missing exact visual
→ valid generic fallback or null

nullable model
→ safe

REGULAR candidate
→ model guaranteeを作らない

PREMIUM
→ exact promiseを維持

RECOMMENDED/SHORTER/LONGER
→ original Candidate.lengthCm exact

WEAR-only
→ ski ratioなし

SNOWBOARD
→ ski visualizationなし

invalid height
→ ratioなし

mapper deterministic

visual DB failure
→ optional visualization unavailable
business response semantics unchanged

visual resolver:
write0

RecommendationService.preview再実行:
0

payment/HOLD/inventory mutation:
0

━━━━━━━━━━━━━━━━━━
16. BUSINESS REGRESSION
━━━━━━━━━━━━━━━━━━

Avatar A2/A3によって以下を変更しない:

reservation
recommendation selection
HOLD
quote
payment
webhook
R12
R13
QR
custody
returns
inventory

関連既存testsを選択して回す。

R15 live acceptanceを再実行しない。

Square:
0

Neon hosted:
0

Vercel:
0

browser external:
0

Production:
0

local PostgreSQLのみ可。

━━━━━━━━━━━━━━━━━━
17. VALIDATION
━━━━━━━━━━━━━━━━━━

minimum:

targeted unit tests

Avatar migration real local PostgreSQL tests

relevant recommendation regression

relevant guest/staff auth regression

lint

typecheck

build

secret scan

git diff --check

不要な全external acceptance再実行禁止。

━━━━━━━━━━━━━━━━━━
18. REVIEW
━━━━━━━━━━━━━━━━━━

A2/A3全体を1つのlogical milestoneとして扱う。

途中Claude review不要。

Codex self-validation PASS後、
sanitized static packageで
Claude independent review最大1回。

review対象:

schema
migration
rights boundary
fallback
contract compatibility
pure mapper
business-authority separation
auth
zero-visual behavior
regression evidence

Claude:

tools off
MCP off
provider off
browser off
edit off
push off

BLOCKER/HIGH/MEDIUMがあれば
local correction。

R15 branchには戻らない。

━━━━━━━━━━━━━━━━━━
19. GIT / EVIDENCE
━━━━━━━━━━━━━━━━━━

新branch:

codex/post-r15-avatar-a2-a3

R15 terminal branch:

codex/external-acceptance-p6

は凍結。

古Avatar branch:

codex/avatar-2d-foundation

もhistorical A0/A1 branchとして保持。

force push禁止。

Avatar A2/A3の進捗/statusを
新しいbranch上で更新。

historical docsの事実を
R15現在状態にreconcileする。

━━━━━━━━━━━━━━━━━━
20. STOP BOUNDARY
━━━━━━━━━━━━━━━━━━

A2/A3 PASS後に停止。

まだ作らない:

2D renderer UI
booking screen insertion
avatar toggle
wear dressing UI
ski graphical scaling UI
admin visual editor
production asset upload
Production deployment

これらは次:

AVATAR PHASE 4 — CUSTOMER VISUAL RENDERER

で実装する。

━━━━━━━━━━━━━━━━━━
21. FINAL REPORT
━━━━━━━━━━━━━━━━━━

最後にのみ報告:

starting R15 HEAD

historical Avatar HEAD

new branch

final HEAD

migration added

old migration hash preservation

A2 result

A3 result

local DB tests

unit/regression counts

lint/typecheck/build

business mutations from visual path:
0

external operations:
all0

Claude verdict

severity counts

working tree clean

remote readback

next exact gate:

AVATAR PHASE 4 — CUSTOMER VISUAL RENDERER