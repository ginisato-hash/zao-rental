【ZAO Rental｜AVATAR PHASE 5 RESUME
Source-package-derived artwork completion + local activation + final review】

私はOwnerとして、この本文を正式な execution authority として採用する。

前提:
- Phase5 code milestone は完了済み
- current classification は:
  PHASE5_CODE_PASS_ARTWORK_INPUT_REQUIRED
- 今回はその先の
  artwork completion / local activation
  を一気通関で進める
- 不要な中間確認で停止しない

━━━━━━━━━━━━━━━━━━
0. SOURCE OF TRUTH
━━━━━━━━━━━━━━━━━━

repo:
ginisato-hash/zao-rental

current branch:
codex/avatar-phase5-guest-integration

expected current final HEAD:
01c225eaed80eb5ee95e22d1ece9eef666aa22e3

Phase4 final:
4485966d87d55aa010766e5f45820541c989fa54

A2/A3 final:
96a34aee8dccb66dca11199af29c33aaf1127546

R15 final:
efb73933a6d3816958882205cfa3623447194625

開始時:
git fetch origin --prune
git rev-parse HEAD
git rev-parse origin/codex/avatar-phase5-guest-integration
git status --short --branch
git worktree list --porcelain

remote advance時は最新GitHubを正本としてreconcile。
force push禁止。
reset --hard禁止。
unknown work削除禁止。
single writer維持。

━━━━━━━━━━━━━━━━━━
1. NEW WORK BRANCH
━━━━━━━━━━━━━━━━━━

新branch:
codex/avatar-phase5-artwork-activation

base:
remote codex/avatar-phase5-guest-integration

以後の変更はこのbranchのみ。

main変更0
hosted Neon 0
Vercel 0
R2 0
Production 0
main merge 0

━━━━━━━━━━━━━━━━━━
2. OWNER AUTHORITY — SOURCE PACKAGE ACCEPTED
━━━━━━━━━━━━━━━━━━

Owner-supplied source package として
以下を正式採用する。

uploaded zip:
サロモン商品.zip

included files:
1.png
2.png
3.png
4.png
5.png
6.png

このpackageは
Owner-supplied source material である。

さらに今回、
以下をOwnerが追加承認する。

- Codexはこのsource packageを基に
  final derivative artwork を作成してよい
- そのfinal derivativeが
  AVATAR_ARTWORK_SPEC.md を満たす場合、
  追加のOwner確認なしで
  local activation用 approved artwork として扱ってよい
- local activation / local E2E / final review まで
  続行してよい

つまり、
今回のauthorityでは
「source package → finished derivative → approved local artwork」
まで一気通関で進める。

途中で approval 確認に戻さない。

━━━━━━━━━━━━━━━━━━
3. PHASE5 REQUIRED CORE ARTWORK
━━━━━━━━━━━━━━━━━━

今回必須は3点のみ。

A.
appearance-1.webp

B.
appearance-2.webp

C.
generic-ski.webp

初期source対応:
- 1.png → appearance-1 source
- 2.png → appearance-2 source
- 3.png → generic-ski primary source
- 4.png → generic-ski backup reference
- 5.png / 6.png → optional future snowboard source
  今回必須外

━━━━━━━━━━━━━━━━━━
4. ARTWORK GOAL
━━━━━━━━━━━━━━━━━━

今必要なのは
「spec適合した完成derivative」である。

単なる source 写真の切り抜きではない。

最終成果物は:

appearance-1.webp
appearance-2.webp
generic-ski.webp

であり、
AVATAR_ARTWORK_SPEC.md 準拠とする。

━━━━━━━━━━━━━━━━━━
5. APPEARANCE DERIVATIVE POLICY
━━━━━━━━━━━━━━━━━━

1.png / 2.png は衣服商品写真であり、
そのままでは body full-height 素材にならない。

したがって Codex は、
これらを見た目参照として使い、
final derivative では以下を満たす
全身アート素材を完成させてよい。

appearance-1:
- 1.png の配色・衣服印象・アウトドア雰囲気を参照
- 頭頂〜足底まで存在
- 正面
- ニュートラル姿勢
- 性別分類に寄せすぎない
- 背景完全透過

appearance-2:
- 2.png の配色・衣服印象・アウトドア雰囲気を参照
- 同上

appearance差は見た目のみ。

身長/体格/推薦ロジック/価格/適格性に
意味を持たせない。

━━━━━━━━━━━━━━━━━━
6. GENERIC SKI DERIVATIVE POLICY
━━━━━━━━━━━━━━━━━━

3.png / 4.png を参照に、
generic-ski.webp を完成させる。

重要:
- REGULAR候補向け generic reference
- 特定の実商品・実モデル・実variantを
  確約する見せ方は禁止
- exact product promise 禁止
- 完全な tip-to-tail を artboard 上で持つ
- 背景透過
- length ratio 表示用の物理 bounds を厳守

ブランド固有ロゴや商品固有マーキングを
exact copy する必要はない。
むしろ generic reference として扱う。

━━━━━━━━━━━━━━━━━━
7. ALLOWED ARTWORK COMPLETION METHOD
━━━━━━━━━━━━━━━━━━

今回、Codexは
source package から finished derivative を作るために
ローカルで利用可能な手段を使ってよい。

許可:
- 形式検査
- background removal
- alpha 化
- canonical crop
- canvas normalization
- deterministic raster preprocessing
- local illustration / derivative generation
- local script / tool / image pipeline
- manifest generation
- hash generation

禁止:
- 外部webから素材追加取得
- Google Images
- manufacturer scraping
- rights不明画像の混入
- Production asset upload
- R2 upload
- hosted deploy
- Ownerへ都度確認して停止

原則:
外部素材0で、
このsource packageだけを元に
ローカルで完成させる。

━━━━━━━━━━━━━━━━━━
8. SPEC REQUIREMENTS
━━━━━━━━━━━━━━━━━━

final derivative は最低限:

appearance:
- 800 x 2000
- WebP alpha
- transparent background
- head at physical top bound
- sole at physical bottom bound
- canonical body coordinate system

generic-ski:
- 160 x 2000
- WebP alpha
- transparent background
- tip at physical top bound
- tail at physical bottom bound

共通:
- no floor
- no stone wall
- no shadow plate
- no background remnants
- no XMP dependence
- no text
- no watermark

必要ならpadding最小化・bounds正規化を行う。

━━━━━━━━━━━━━━━━━━
9. OWNER APPROVAL RULE
━━━━━━━━━━━━━━━━━━

今回のauthorityでは、
Codexが生成/完成させた derivative が:

- source package由来
- spec準拠
- intended purposeが
  AVATAR_VISUALIZATION_V1
- manifestが整備
- local validation PASS

であれば、
その derivative は
Owner-approved local artwork として扱ってよい。

追加のOwner確認は不要。

ただしこれは
local activation の承認であり、
Production承認ではない。

━━━━━━━━━━━━━━━━━━
10. MANIFEST
━━━━━━━━━━━━━━━━━━

Codexは final artwork package manifest を作成すること。

最低記録:
- file name
- layer
- appearance if applicable
- generic/exact classification
- source files used
- source package = サロモン商品.zip
- intended purpose = AVATAR_VISUALIZATION_V1
- approvedByOwner = true
- approvalBasis = OWNER_AUTHORITY_THIS_DOCUMENT
- localActivationApproved = true
- productionApproved = false
- rights basis classification
- createdAt
- content hash

Phase5 core は
generic classification でよい。

━━━━━━━━━━━━━━━━━━
11. RIGHTS CLASSIFICATION
━━━━━━━━━━━━━━━━━━

今回の local activation では
rights basis を少なくとも以下で明示する。

推奨:
OWNER_SUPPLIED_SOURCE_DERIVATIVE_LOCAL_USE_ONLY

つまり:
- Ownerがsourceを投入
- derivativeはこのauthorityに基づき作成
- local development / acceptance 用
- Production利用は別gate

rights不明扱いのまま進めない。

━━━━━━━━━━━━━━━━━━
12. IMPORT TOOL / LOCAL IMPORT
━━━━━━━━━━━━━━━━━━

既存 Phase5 実装済み import path を利用してよい。
必要なら最小のローカル import 補助を追加してよい。

目的:
final artwork
↓
validation
↓
digest
↓
existing content/media model
↓
release
↓
AVATAR_VISUALIZATION_V1 purpose grant
↓
avatar_visuals binding
↓
GuestBooking local real-art E2E

overwrite禁止。
binding retarget禁止。
Production変更禁止。

━━━━━━━━━━━━━━━━━━
13. 0032 STATUS
━━━━━━━━━━━━━━━━━━

Phase5 code milestone で
0032 immutability/narrowing が実装済みなら
そのまま使う。

未実装なら今回必要最小限で実装可。
ただし latest remote を正本として確認し、
既存 status を壊さないこと。

0001–0032 の historical hash 保全を記録。

━━━━━━━━━━━━━━━━━━
14. LOCAL VALIDATION — ARTWORK
━━━━━━━━━━━━━━━━━━

最低:
- file presence
- format
- width/height
- alpha channel
- transparent background check
- physical crop/bounds check
- hash generation
- manifest validation
- purpose/release compatibility
- import success

不適合なら local correction してよい。
ただし外部素材追加は禁止。

━━━━━━━━━━━━━━━━━━
15. GUESTBOOKING LOCAL REAL-ART E2E
━━━━━━━━━━━━━━━━━━

完成derivative import後、
local PostgreSQL + local Next + local browser で
実GuestBooking画面の E2E を行う。

最低確認:
- APPEARANCE_1 表示
- APPEARANCE_2 表示
- generic ski 表示
- RECOMMENDED / SHORTER / LONGER
- 390px mobile
- 1440px desktop
- multi-member
- session ownership
- cross-guest denial
- logout後 media denial
- rights revoke denial
- zero extra recommendation call
- zero extra HOLD
- zero extra quote
- zero extra payment
- business write from visual interaction = 0

ratio correctness:
ski / body 比率が Phase4 tolerance を維持。

━━━━━━━━━━━━━━━━━━
16. IF OPTIONAL LAYERS ARE ABSENT
━━━━━━━━━━━━━━━━━━

BOOT / JACKET / PANTS が未整備でも
Phase5 failureにしない。

今回 core pass 条件は:
- appearance-1
- appearance-2
- generic-ski

の3点でよい。

optional layers は null 許容。

━━━━━━━━━━━━━━━━━━
17. CLAUDE REVIEW
━━━━━━━━━━━━━━━━━━

今回の resumed milestone 完了後、
Claude independent review を最大1回実行してよい。

review対象:
- artwork intake / derivation handling
- manifest / rights basis
- import safety
- 0032 immutability / privilege narrowing
- GuestBooking integration
- guest media auth
- local activation
- ratio correctness
- business invariants
- residual LOW handling

Claude:
tools off
MCP off
browser off
provider off
hooks off
edit off
push off

PASS または LOW only なら再review不要。
BLOCKER/HIGH/MEDIUM が出た場合のみ
ローカル修正後に correction review 最大1回。

━━━━━━━━━━━━━━━━━━
18. FINAL CLASSIFICATION
━━━━━━━━━━━━━━━━━━

CASE A:
core artwork 3点作成成功
+
import成功
+
local GuestBooking real-art E2E PASS
+
Claude PASS or LOW only

→
PHASE5_LOCAL_PASS_REAL_ARTWORK_ACTIVE

CASE B:
コードは問題ないが、
source package だけでは物理的に完成derivativeを作れない、
または local toolchain 的に完成不能

→
ARTWORK_DERIVATIVE_TOOLING_REQUIRED

この場合のみ停止可。
ただし理由を具体化すること。

CASE C:
BLOCKER/HIGH/MEDIUM unresolved

→
PHASE5_CHANGES_REQUIRED

原則目標は CASE A。

━━━━━━━━━━━━━━━━━━
19. EXTERNAL OPERATION BUDGET
━━━━━━━━━━━━━━━━━━

今回:
hosted Neon 0
Vercel 0
R2 0
Square 0
Production 0
main merge 0
public deploy 0
real payment 0
real booking 0
external browser 0
external image search 0

ローカルのみ。

GitHub push は可。

━━━━━━━━━━━━━━━━━━
20. STOP BOUNDARY
━━━━━━━━━━━━━━━━━━

CASE A/C/B のいずれでも
最後まで到達したら停止。

自動で Phase6 へ進まない。

Phase6 は別authority。

━━━━━━━━━━━━━━━━━━
21. FINAL REPORT
━━━━━━━━━━━━━━━━━━

最後にのみ報告:

- starting HEAD
- new branch
- implementation HEAD
- reviewed HEAD
- final receipt HEAD
- source package accepted
- final derivative files created
- manifest result
- rights basis classification
- import result
- GuestBooking real-art integration result
- ratio result
- cross-guest denial
- logout denial
- rights revoke denial
- AV-1 result
- AV-2 disposition
- AV-3 result
- PHASE4-1 result
- unit count
- local PG count
- browser count
- mobile result
- desktop result
- extra recommendation calls 0
- extra HOLD 0
- extra quote 0
- extra payment 0
- external operations all0
- Claude verdict
- severity counts
- working tree clean
- remote readback
- final classification

━━━━━━━━━━━━━━━━━━
22. OPERATING PRINCIPLE
━━━━━━━━━━━━━━━━━━

今回は
「素材が足りないのでOwner待ち」
という止まり方を終わらせる。

source package はもう受理済みであり、
このauthorityにより
final derivative completion まで委任する。

不要な中間停止をせず、
safe boundary内で一気通関で完了させること。