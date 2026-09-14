【ZAO Rental｜P6 R6
S1 Acceptance v2 — autonomous one-pass execution authority】

Owner方針:
今回から、明示された安全境界内の作業について
不要な中間承認・逐次Owner handoff・長時間の原因調査を行わない。

Codex parentが設計・判断・実装・検証・実行・cleanup・GitHub記録まで
自立して一気通関する。

「念のため」「追加確認のため」だけで停止しない。
recoverableな技術問題はscope内で自律的に修正して続行する。

Owner操作が本当に必要な
login / password / MFA / 規約同意
だけは停止してOwnerへ依頼してよい。

scope外の不可逆操作が必要になった場合のみ停止する。

━━━━━━━━━━━━━━━━━━
0. Starting state
━━━━━━━━━━━━━━━━━━

repo:
ginisato-hash/zao-rental

branch:
codex/external-acceptance-p6

expected starting remote HEAD:
70cc14921c07ca0513c0b6e17624f69899803517

main:
3061dbbbe00294e5baebba2405028c907d6e6e85

current historical result:
R4 S1 = UNKNOWN_DO_NOT_RETRY

historical POST:
1

historical S1 Preview:
DELETED

temporary R4 S1 route:
REMOVED

accepted R3 Preview:
dpl_2tskZombWNMhwEKB6NG96FxkzmhL
RETAINED / READY

R4 retry authority:
0

重要:
R6はR4の「retry」ではない。

Ownerがここで新たに明示承認する
独立した S1 Acceptance v2 scope である。

R4のguard・UNKNOWN・request budget・evidenceは
歴史として変更しない。

━━━━━━━━━━━━━━━━━━
1. R5終了
━━━━━━━━━━━━━━━━━━

R5 forensicはOwner判断で終了。

これ以上:

- Vercel historical log調査
- Square API Logs追加調査
- 旧503 root cause究明
- forensic artifact拡充

をしない。

R5で作成した未commit forensic-only draftがある場合:

- product/runtime code変更がないことを確認
- unrelated user workを絶対に消さない
- このR5だけで生成した不要なdraft/evidenceなら破棄してよい

R5を独立した大きなcommitにはしない。

R6 authority記録内に
「R5 was terminated by Owner as non-gating investigation」
と最小限記録すれば十分。

━━━━━━━━━━━━━━━━━━
2. R6 authorityを最初にGitHubへ保存
━━━━━━━━━━━━━━━━━━

実装・deploy前にこのOwner authorityを

docs/execution/PRODUCTION_P6_R6_AUTHORITY.md

として保存する。

AGENTS.md
CLAUDE.md
docs/execution/SCOPE.md
docs/execution/PRODUCTION_P6_STATUS.json

のcurrent header/stateもR6へ必要最小限更新。

historical R4記録は書き換えない。

commit/push:

docs(p6): authorize autonomous R6 S1 acceptance v2

push後remote readbackを確認。

以後のR6は中間Owner承認なしで続行する。

━━━━━━━━━━━━━━━━━━
3. R6の目的
━━━━━━━━━━━━━━━━━━

S1 merchant/location read-only acceptanceを
新しいPreview上で確実に完了する。

前回の問題を再発させないため、
Square通信前にruntime preflightを設ける。

順序:

A. local implementation
B. local validation
C. protected Preview 1件
D. runtime preflight（Square通信0）
E. preflight PASS時のみS1 POST 1回
F. merchant/location 最大2 GET
G. result classification
H. evidence
I. cleanup
J. PASSならmerchant metadata登録
K. S2 Owner gate作成
L. STOP

A〜Lを不要に止めず一気通関する。

━━━━━━━━━━━━━━━━━━
4. 新Preview budget
━━━━━━━━━━━━━━━━━━

R6で新しいprotected Previewを
1件だけ承認する。

target:
preview

必須:

Deployment Protection enabled
Vercel Authentication / Require Log In維持
custom domain 0
production alias 0
Production Square env 0
external DB 0
R2 0

通常のVercel-generated Preview URLは許可。

Production deployは禁止。

deploy前にlocal buildを完全に通し、
preventableなbuild failureを潰してから1回だけdeployする。

一度deployment IDが生成された後は
Owner承認なしで第2Previewを作らない。

━━━━━━━━━━━━━━━━━━
5. Runtime preflight
━━━━━━━━━━━━━━━━━━

S1 provider callとは別に
Preview runtime内部だけで完結する
secret-safe preflightを実装する。

目的:

Squareへ一切通信せず、
S1を実行可能なruntime configurationであることを確認する。

確認項目:

VERCEL_ENV === preview

SQUARE_ENVIRONMENT === SANDBOX

SQUARE_API_VERSION === 2026-08-19

SQUARE_SANDBOX_APPLICATION_ID:
present + valid identifier format

SQUARE_SANDBOX_LOCATION_ID:
present + valid identifier format

SQUARE_SANDBOX_ACCESS_TOKEN:
present + accepted format

NEXT_PUBLIC系へSquare credentialが露出していない

必要ならその他、
現S1 implementationがprovider call前に必須とする条件。

preflight responseへ出してよいもの:

{
  environment: "SANDBOX",
  deployment: "preview",
  apiVersionMatch: true/false,
  applicationIdConfigured: true/false,
  locationIdConfigured: true/false,
  accessTokenConfigured: true/false,
  accessTokenFormatValid: true/false,
  publicCredentialExposure: false,
  readyForS1: true/false,
  result: "PASS" | "BLOCKED",
  reason: safe enum|null
}

絶対に出さない:

application IDの実値
location IDの実値
access token
token prefix
token length
Authorization
Cookie
env dump
raw secrets

preflight endpointは
UIへlinkしない。
sitemapへ出さない。
Productionでは404/fail closed。

非secret intent headerを要求してよい。

preflightはSquare API request count = 0を構造的に保証する。

━━━━━━━━━━━━━━━━━━
6. Preflight失敗時
━━━━━━━━━━━━━━━━━━

structured preflightがBLOCKEDなら
Square APIを絶対に呼ばない。

Codexがsecret値を読まずにscope内で直せる
コード/config compositionの問題なら
自律修正 → local validation → 同じR6 Previewで再確認してよい。

ただし既存Vercel secretの
値を読む・コピーする・exportする・promptへ出すことは禁止。

Ownerのsecret再入力が必須な場合だけ停止し、
必要なkey名と非secretな理由だけOwnerへ返す。

単なるブラウザ/login transport問題の場合は
通常loginを完了後、preflightを再読してよい。

これはSquare retryではない。

━━━━━━━━━━━━━━━━━━
7. S1 v2 implementation
━━━━━━━━━━━━━━━━━━

既存の:

packages/core/src/payment/square-s1.ts
packages/core/src/payment/square-transport.ts
apps/web/src/lib/square-s1-acceptance.ts

を最大限再利用する。

既存business/payment contractsを変更しない。

S1 v2 routeは
preflight PASSでなければprovider callを開始しない。

POST only。

explicit non-secret intent required。

bodyなし。

same-origin authenticated Preview only。

重要:
前回のような
「HTTP503だけ返ってsafe resultが無い」
状態を可能な限り排除する。

provider dispatch前の失敗は必ず
secret-free structured resultを返す。

例:

stage:
RUNTIME_PREFLIGHT
CONFIGURATION
CREDENTIAL_PRESENCE
MERCHANT
LOCATION

providerDispatched:
true/false

requestCount:
0/1/2/unknown

result:
S1_PASS
S1_WARNING
S1_FAIL
S1_BLOCKED
UNKNOWN_DO_NOT_RETRY

reason:
安全なenum

Square raw responseは返さない。

unexpected internal exceptionでも
秘密値を出さず、
どのstageまで進んだかを可能な範囲で返す。

━━━━━━━━━━━━━━━━━━
8. Square実通信
━━━━━━━━━━━━━━━━━━

runtime preflight PASS後のみ実行。

新しいR6 one-shot guardを
dispatch前にdurableに確定する。

R4 guardとは別。
R4 guardを削除・上書きしない。

R6 actual S1 POST:
最大1回。

retry:
0

Square Sandbox external request:

1.
GET /v2/merchants/me

merchant成功時のみ

2.
GET /v2/locations

最大2 GET。

origin:
https://connect.squareupsandbox.com

Square-Version:
2026-08-19

server-side existing Preview secretのみ使用。

Production Square:
0

━━━━━━━━━━━━━━━━━━
9. S1_PASS条件
━━━━━━━━━━━━━━━━━━

以下を全て満たす:

merchant HTTP success
merchant.id non-empty
merchant.status ACTIVE
merchant.country JP
merchant.currency JPY

locations HTTP success

configured location found exactly
location.status ACTIVE
location.country JP
location.currency JPY

location.merchant_id = merchant.id

merchant.main_location_id = configured location

CREDIT_CARD_PROCESSING present

secret exposure 0

Production Square requests 0

requestCount = 2

すべて満たした場合のみ:

S1_PASS

capability欠落等はPASSにしない。

━━━━━━━━━━━━━━━━━━
10. FAIL / WARNING / UNKNOWN
━━━━━━━━━━━━━━━━━━

S1_FAIL / WARNING / UNKNOWNでも
R6内で再実行しない。

旧R5のような
長時間forensicを自動開始しない。

resultを保存し、
具体的reason/stageが得られている範囲だけ記録し、
cleanupしてR6を終了する。

「原因を完全解明するため」だけの調査を追加しない。

Ownerへ返すのは
次に必要な具体的action 1件だけ。

━━━━━━━━━━━━━━━━━━
11. local validation
━━━━━━━━━━━━━━━━━━

deploy前:

R6/S1 narrow tests
existing Square S1 tests
runtime preflight tests
secret redaction tests
Production rejection tests
secret scan
lint
typecheck
build

すべてgreenにする。

最低限 fixture:

preflight PASS
wrong VERCEL_ENV
wrong Square env
wrong API version
missing app ID
missing location ID
missing token
invalid token format
NEXT_PUBLIC exposure
merchant success
merchant auth fail
merchant JP mismatch
merchant JPY mismatch
location missing
location mismatch
merchant mismatch
inactive location
capability missing
raw secret redaction
unexpected exception structured output
Production rejection
one-shot behavior

必要なテスト実装はCodex parentが所有する。

Sparkは、
本当に親のtoken/時間節約になる場合だけ
exact test fileへ最大1 bounded taskを使用可。

実provider call / route / transport / env / deployは
Spark禁止。

Claude起動:
0

━━━━━━━━━━━━━━━━━━
12. Preview execution
━━━━━━━━━━━━━━━━━━

local green後に新Preview 1件deploy。

deploy後、
Square requestを送る前に必ず確認:

exact deployment ID
exact origin
target preview
state READY
build SUCCESS
Deployment Protection enabled
Require Log In
custom domain 0
production alias 0

この確認はread-only。

通常Vercel loginが必要なら
Ownerへloginだけ依頼。

login後は自律再開。

━━━━━━━━━━━━━━━━━━
13. authenticated browser path
━━━━━━━━━━━━━━━━━━

実行は通常認証済みPlaywright browserを使う。

credential/token/cookieを
読み取らない・表示しない・保存しない。

ブラウザがsame-originへ通常添付する
認証状態のみ利用する。

禁止:

DevTools Console paste
allow pasting
bypass secret
Vercel credential抽出
Cookie export
CLI secret argv
Protection OFF

まずruntime preflight。

PASSを確認後だけ、
同じ認証済みcontextからS1 POSTを1回。

━━━━━━━━━━━━━━━━━━
14. PASS後
━━━━━━━━━━━━━━━━━━

S1_PASSなら、
returned merchant.idを
Sandbox merchant identityの正本として採用。

以下をVercel Preview-onlyの
非secret metadataとして登録してよい:

SQUARE_SANDBOX_MERCHANT_ID

existing:
SQUARE_SANDBOX_LOCATION_ID

は変更しない。

merchant metadata登録による
redeployは禁止。

その場でS2 provider callへ進まない。

代わりに、
次のOwner gateを完成させる。

docs/execution/PRODUCTION_P6_S2_GATE.md

内容:

- S1 PASS evidence
- merchant/location identity
- CREDIT_CARD_PROCESSING=true
- current safe HEAD
- Preview merchant metadata registration
- S2 synthetic payment exactly1の提案scope
- payment/refund/webhook boundaries
- idempotency/UNKNOWN recovery
- required Owner authority

つまりR6の最後に
S2へすぐ進める状態まで準備する。

━━━━━━━━━━━━━━━━━━
15. cleanup
━━━━━━━━━━━━━━━━━━

S1 resultをGitHubへ保存してからcleanup。

temporary runtime-preflight route削除。

temporary S1 route削除。

narrow tests
secret scan
lint
typecheck
build

を再実行。

R6専用Previewは
evidence保存完了後に削除。

accepted R3 Previewは保持。

R6 durable guardは保持。

reusableな:

Square S1 service
transport
validation
safe preflight pure function

は将来利用価値があるものだけ残してよい。

public/runtime invocation routeは残さない。

━━━━━━━━━━━━━━━━━━
16. GitHub evidence
━━━━━━━━━━━━━━━━━━

secret-freeで最低限:

docs/execution/p6/R6_S1_V2_RESULT.md

docs/execution/p6/r6-evidence/

へ保存。

記録:

authority commit
implementation SHA
Preview deployment ID
origin
target
protection
runtime preflight result
POST count
Square GET count
merchant HTTP result
location HTTP result
merchant status
country
currency
merchant ID
main-location match
location match
merchant match
card capability
S1 result
secret exposure
cleanup
final tests

raw secret/raw provider responseは保存しない。

current status:

AGENTS.md
CLAUDE.md
SCOPE.md
PRODUCTION_P6_STATUS.json

を最終結果へ整合。

historical R4は変更しない。

━━━━━━━━━━━━━━━━━━
17. Commit strategy
━━━━━━━━━━━━━━━━━━

推奨:

1.
docs(p6): authorize autonomous R6 S1 acceptance v2

2.
feat(p6): add preflighted Square S1 v2 acceptance

3.
docs/chore(p6): record R6 S1 result and cleanup

必要なら実際の変更構造に合わせて
commitを統合してよい。

常にbranchへpushしreadback。

main merge:
禁止。

新PR:
R6中は不要。

━━━━━━━━━━━━━━━━━━
18. 自律実行ルール
━━━━━━━━━━━━━━━━━━

以下についてOwnerへ逐次確認しない:

- file設計
- naming
- test追加
- refactor
- route構成
- safe response schema
- local fixes
- lint/type fixes
- Vercel read-only metadata確認
- evidence formatting
- cleanup
- commit/push

Codex parent自身が判断する。

途中経過をOwnerへ投げて
「続けていいですか」と聞かない。

scope内で継続可能なら最後まで続行。

停止してよいのは:

A.
Ownerのpassword/MFA/通常loginが必要

B.
secret再入力が必要
（値をCodexへ渡さずOwner UI操作のみ）

C.
Previewがpreview/protectedであることを証明できない

D.
既存user変更とのconflictで安全に進められない

E.
scope外の不可逆操作が本当に必要

のみ。

それ以外は自律解決する。

━━━━━━━━━━━━━━━━━━
19. R6の絶対禁止
━━━━━━━━━━━━━━━━━━

Production deploy
Production Square
実顧客
実カード
CreatePayment
GetPayment
refund
Webhook creation/delivery
S2実行
external DB
R2
email
SMS
main merge
Runner
Ruleset変更
permission/billing拡大
secret extraction
secret logging

すべて0。

━━━━━━━━━━━━━━━━━━
20. 最終報告
━━━━━━━━━━━━━━━━━━

R6完了時のみまとめて報告:

Starting HEAD
Authority commit
Implementation commit
Result/cleanup commit
Final HEAD
Working tree

Preview:
deployment ID
origin
target
protection
cleanup

Runtime preflight:
PASS/BLOCKED
各boolean

Square S1:
POST count
merchant GET
location GET
request count
HTTP results
JP/JPY
merchant/location match
CREDIT_CARD_PROCESSING
PASS/FAIL/WARNING/UNKNOWN

Security:
secret exposure 0
Production Square 0

External:
payment 0
refund 0
webhook 0
DB 0
R2 0
S2 0

Validation:
tests
secret scan
lint
typecheck
build

PASS時:
merchant metadata登録結果
S2 gate path

Owner next action:
S2 authorityを承認するかどうか
のみ。

R6完了まで不要に停止しない。

---

Adoption note: R5 was terminated by Owner as non-gating investigation.
Only the three uncommitted forensic-only draft/evidence files created by this
agent were discarded after confirming no tracked product/runtime changes.
Historical R4 evidence, UNKNOWN result, guard and budgets remain unchanged.
