【Owner Direct Amendment｜
AVATAR PHASE 6 — Corrective Preview Deployment Attempt 4/4】

私はOwnerとして、現在のPhase6停止状態:

STOPPED_EXISTING_PREVIEW_RUNTIME_503

に対する corrective Preview deployment を
exactly 1回だけ追加許可する。

current canonical branch:
codex/avatar-phase6-hosted-preview

expected remote HEAD:
40a67153fcb203cecc8673cc3b50662c414648eb

━━━━━━━━━━━━━━━━━━
1. DEPLOYMENT BUDGET EXPANSION
━━━━━━━━━━━━━━━━━━

旧:
deployment attempts 3 / 3

新:
deployment attempts max 4

attempt 4:
corrective protected Preview only

これが最後の許可deployment。

attempt 4失敗後:
追加deploy禁止。
Ownerへ戻る。

Production deploy:
禁止。

new project:
禁止。

new alias:
provider自動Preview alias以外禁止。

━━━━━━━━━━━━━━━━━━
2. CURRENT HISTORICAL STATE
━━━━━━━━━━━━━━━━━━

historical Production deployments:
2

historical Production aliases:
2

current controlled static Production bootstrap:
deployment 1
alias 1

Production env:
0

既存bootstrapは、
corrective PreviewのHosted acceptance PASSまで保持。

履歴を0へ書き換えない。

━━━━━━━━━━━━━━━━━━
3. ROOT CAUSE CANDIDATE
━━━━━━━━━━━━━━━━━━

現在の専用Vercel projectはGit integrationなし。

一方 current Preview runtime は:

VERCEL_GIT_COMMIT_REF
===
codex/avatar-phase6-hosted-preview

を必須条件にしている。

Gitless deploymentでは
このsystem envが存在しない可能性があるため、
これは503の有力候補。

ただし原因確定と断定しない。

attempt 4前にlocalで安全に修正・検証する。

━━━━━━━━━━━━━━━━━━
4. PREVIEW IDENTITY FIX
━━━━━━━━━━━━━━━━━━

previewOrigin() の security boundary を次の形へ変更してよい。

引き続き必須:

- VERCEL == "1"
- VERCEL_ENV == "preview"
- VERCEL_TARGET_ENV == "preview"
- ZAO_AVATAR_PHASE6 == "PROTECTED_PREVIEW_V1"
- VERCEL_PROJECT_ID == exact Phase6 project
- immutable VERCEL_URL pattern exact
- forbidden env scan PASS

branch判定:

if VERCEL_GIT_COMMIT_REF exists:
    exact Phase6 branch match required

if VERCEL_GIT_COMMIT_REF absent:
    absence itselfはfail理由にしない

ただし:
wrong non-empty branchは必ずfail closed。

Production環境を許可する変更は禁止。

project ID / target / URL checksを弱めない。

━━━━━━━━━━━━━━━━━━
5. SAFE STARTUP DIAGNOSTICS
━━━━━━━━━━━━━━━━━━

current routeはstartup internal failureを
すべて:

GUEST_PREVIEW_UNAVAILABLE

へ潰している。

corrective buildでは、
secretを含まないstage classificationだけを
internal safe evidenceとして追加してよい。

例:

PREVIEW_IDENTITY
CONFIG_PARSE
DB_CONNECT_GUEST
DB_CONNECT_HOLD
DB_CONNECT_PRICING
DB_CONNECT_RECOMMENDATION
DB_CONNECT_CONTENT_READ
DB_CONNECT_AVATAR_READ
DB_IDENTITY
TLS
GUEST_SECURITY_INIT
AVATAR_SECURITY_INIT
R2_INIT
READY

禁止:

raw exception
DB URI
password
token
access key
secret key
guest key
full env dump
connection string
certificate raw data

HTTP clientへ返す情報も
固定safe categoryのみ。

━━━━━━━━━━━━━━━━━━
6. LOCAL VALIDATION BEFORE ATTEMPT 4
━━━━━━━━━━━━━━━━━━

最低限:

unit tests:
PASS

previewOrigin tests:
- correct Git ref PASS
- absent Git ref PASS
- wrong Git ref DENY
- Production env DENY
- wrong project DENY
- wrong target DENY
- forbidden env DENY

lint:
PASS

typecheck:
PASS

build:
PASS

secret scan:
PASS

git diff --check:
PASS

このvalidationがPASSするまでdeploy禁止。

━━━━━━━━━━━━━━━━━━
7. CORRECTIVE DEPLOYMENT
━━━━━━━━━━━━━━━━━━

local validation PASS後のみ、
attempt 4を1回実行。

target:
Preview

exact project:
zao-rental-avatar-preview

exact branch source:
codex/avatar-phase6-hosted-preview

Production:
0

Square:
0

payment:
0

main merge:
0

deploy後すぐprovider readback:

canonical target == preview

Authentication == ON

exact project match

env target Preview only

Square/payment/refund/webhook keys 0

を確認。

target mismatchなら:
即cleanup
Hosted E2Eしない
追加deployしない
STOP。

━━━━━━━━━━━━━━━━━━
8. HOSTED READINESS
━━━━━━━━━━━━━━━━━━

corrective Previewで最初に:

GET /api/guest/draft

を1回だけreadiness probe。

期待:
503以外の正常Guest flow response

もし再び503:

safe startup stage classificationだけ保存。

追加deploy禁止。

STOP。

━━━━━━━━━━━━━━━━━━
9. HOSTED E2E
━━━━━━━━━━━━━━━━━━

readiness PASS時のみ続行。

390px
1440px

2 synthetic members

APPEARANCE_1
APPEARANCE_2

RECOMMENDED
SHORTER
LONGER

actual Hosted Neon
actual private R2

physical ratio

cross-guest deny

anonymous deny

logout deny

stale revision deny

wrong member deny

wrong visual deny

wrong digest deny

rights revoke deny

rate limit 429

visual interactionによる:

recommendation extra call 0
HOLD 0
quote 0
payment 0
business write 0

━━━━━━━━━━━━━━━━━━
10. BOOTSTRAP CLEANUP
━━━━━━━━━━━━━━━━━━

Hosted E2E PASS後のみ:

controlled static Production bootstrap deployment
+
its Production alias

を削除。

確認:

current Production deployment = 0
current Production alias = 0
Production env = 0

historical countsは:

Production deployments = 2
Production aliases = 2

のまま保持。

━━━━━━━━━━━━━━━━━━
11. CLAUDE FINAL REVIEW
━━━━━━━━━━━━━━━━━━

Hosted E2E PASS
+
bootstrap cleanup PASS

後のみClaude review。

review対象:

- corrective Preview identity fix
- Git ref absent semantics
- Preview target proof
- Neon hosted state
- AV-3
- PHASE5-1
- R2 private/read-only
- rights revoke
- cross guest
- rate limit
- startup diagnostics no-secret property
- historical Production deviation
- final current Production zero
- Square/payment0

PASS / LOW only:
finish。

BLOCKER/HIGH/MEDIUM:
code correction可。

ただしcorrectionに新deployが必要なら:
deploy禁止
STOP。

━━━━━━━━━━━━━━━━━━
12. FINAL CLASSIFICATION
━━━━━━━━━━━━━━━━━━

Hosted acceptance PASS
+
Claude B/H/M = 0
+
current Production state zero

なら:

PHASE6_PROTECTED_HOSTED_PREVIEW_PASS_WITH_CONTAINED_VERCEL_PRODUCTION_DEVIATION

historical metadata incidentsと
historical Production deviationは永久保持。

通常のclean PASSとは呼ばない。

Phase7へ自動継続禁止。