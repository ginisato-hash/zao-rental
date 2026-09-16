【ZAO Rental｜LAUNCH CRITICAL M1.5
PRODUCTION COMPOSITION + FAIL-CLOSED RUNTIME WIRING】

前提:

LAUNCH_CRITICAL_M1_COMPLETE_MAIN_MERGE_READY
または
codex/launch-critical-ops-m1 の実装/検証が完了していること。

M1をmainへmergeするOwner操作を待たなくてよい。

M1 remote HEADからstacked branch:

codex/launch-critical-prod-composition

を作る。

mainへmerge:
0

Production deploy:
0

provider credential:
0

外部provider mutation:
0

目的:

現在各所に存在するproduction-ready boundaryを、
「Production credential/configを後から入れれば起動できる」
一つのnormal production compositionへ統合する。

Productionを実際に起動するのではない。

━━━━━━━━━━━━━━━━━━
1. EXISTING CODE FIRST
━━━━━━━━━━━━━━━━━━

最初に現コードを調査。

最低:

- guest production-composition
- booking access/recovery
- trusted ingress
- payment/Square gateway
- R2 media abstraction
- content/media rights
- Avatar
- staff auth
- DB role separation
- readiness/preflight
- production config contracts

を読む。

既存境界を再利用。

parallel production frameworkを新設しない。

━━━━━━━━━━━━━━━━━━
2. NORMAL PRODUCTION COMPOSITION
━━━━━━━━━━━━━━━━━━

現在development / rehearsal / previewに分散している
compositionを整理し、

明示的な:

ProductionRuntime

または同等のserver-only compositionを作る。

Production runtimeは:

- NODE_ENVだけでは起動しない
- explicit production capability/config必須
- config schema validation必須
- exact expected provider/environment identity必須
- missing config = fail closed
- Preview credential/config =拒否
- development/local credential =拒否
- owner/admin DB role =拒否

正常起動前に全boundaryを検証。

━━━━━━━━━━━━━━━━━━
3. FEATURE FLAGS
━━━━━━━━━━━━━━━━━━

featureは明示的に分離。

最低:

booking
guest recovery
payment
media
avatar
staff operations

Avatar:
default OFF。

Avatar OFFでも:

booking
quote
HOLD
payment
booking access

が正常に成立する構成にする。

「Avatar capabilityを抜いたらGuest runtime全体が死ぬ」
構造は禁止。

これがProduction rollbackの正本になる。

━━━━━━━━━━━━━━━━━━
4. BOOKING ACCESS / RECOVERY
━━━━━━━━━━━━━━━━━━

現在Productionでnullになる
bookingAccessRuntime等を調査し、

ProductionRuntime経由なら
least-privilege roleで起動できるようにする。

ただし:

real DB credential:
0

実接続:
0

テストではephemeral PostgreSQLのみ。

access/recovery keyは
既存domain separationを維持。

同じroot/keyを再統合しない。

━━━━━━━━━━━━━━━━━━
5. TRUSTED INGRESS
━━━━━━━━━━━━━━━━━━

既存trusted-ingress boundaryを利用。

arbitrary:

x-forwarded-for
x-real-ip
host
custom peer header

をそのまま信用しない。

Production ingress adapterは
provider-specific verified metadataを
injectできるinterfaceとして完成させる。

このphaseでは
Vercel actual Production metadataを
外部確認しに行かない。

fixtureで:

valid verified ingress
spoofed header
missing proof
wrong project/environment

を検証。

━━━━━━━━━━━━━━━━━━
6. PAYMENT COMPOSITION
━━━━━━━━━━━━━━━━━━

existing payment state machineを変更しない。

ProductionRuntimeから:

Square provider adapter

を注入可能にする。

credential absent:
fail closed。

Sandbox credential:
Production compositionで拒否できること。

real Square call:
0

payment:
0

refund:
0

webhook:
0

provider transportはfixture。

━━━━━━━━━━━━━━━━━━
7. PRIVATE MEDIA
━━━━━━━━━━━━━━━━━━

R2/private mediaも
ProductionRuntimeへ明示的にcomposition。

public bucket:
拒否。

r2.dev/public custom domain:
production configで許可しない。

Avatar OFF:
Avatar media requestは404等で安全に不在。

booking/media以外のbusiness処理:
継続。

actual R2 request:
0

━━━━━━━━━━━━━━━━━━
8. STARTUP PREFLIGHT
━━━━━━━━━━━━━━━━━━

本番起動前preflightを実装。

safe result例:

DB_CONFIG
INGRESS
PAYMENT
MEDIA
GUEST_SECURITY
BOOKING_ACCESS
FEATURE_FLAGS
READY

固定enumのみ。

出力禁止:

secret
URI
password
token
cookie
raw provider error
guest ID
email
phone

preflight failure:
server起動/route exposure前にfail closed可能にする。

━━━━━━━━━━━━━━━━━━
9. READINESS / HEALTH
━━━━━━━━━━━━━━━━━━

safe health/readiness endpointを作る。

health:
process alive。

readiness:
必要componentのbootstrap完了。

外部へ:

DB host
provider IDs
secret metadata

を漏らさない。

anonymous public responseは
単純なstatusのみ。

詳細診断はstaff/admin-onlyまたはserver logのsafe enum。

━━━━━━━━━━━━━━━━━━
10. PRODUCTION ROLLBACK TEST
━━━━━━━━━━━━━━━━━━

重要。

Avatar/media featureをOFFにしても:

guest draft
recommendation
HOLD
quote
payment state
booking access

が壊れないことを
real PostgreSQL + browserで証明。

Avatar failure:
business continuity PASS。

━━━━━━━━━━━━━━━━━━
11. CONFIG TEST MATRIX
━━━━━━━━━━━━━━━━━━

最低:

valid synthetic Production config
missing capability
Preview target
Sandbox Square marker
owner DB role
wrong database
wrong ingress
public media config
expired media credential metadata
Avatar OFF
Avatar ON with missing media
unknown extra secret/config key

をfail closed確認。

━━━━━━━━━━━━━━━━━━
12. MIGRATION
━━━━━━━━━━━━━━━━━━

schemaが不要ならmigration0を優先。

必要なら
M1の最新migration番号を取得し、
次の番号を1件ずつ使う。

番号を事前固定しない。

historical migration変更禁止。

━━━━━━━━━━━━━━━━━━
13. VALIDATION
━━━━━━━━━━━━━━━━━━

full unit
real PostgreSQL
production composition tests
rollback tests
browser
auth
booking
HOLD
pricing
payment state
guest/recovery
Avatar OFF regression
lint
typecheck
build
secret scan
git diff --check

PASS。

━━━━━━━━━━━━━━━━━━
14. REVIEW
━━━━━━━━━━━━━━━━━━

Claude static review max1。

対象:

- Production fail-closed
- role/credential separation
- ingress
- feature isolation
- rollback
- booking continuity
- secret handling

B/H/M:
自律修正。

必要な場合のみcorrection1。

個別payload送信のOwner再承認要求禁止。

━━━━━━━━━━━━━━━━━━
15. OUTPUT
━━━━━━━━━━━━━━━━━━

branchをpush。

stacked Draft PRを作ってよい。

base:
M1 branch
またはM1の最新remote headを含む適切なbranch。

mainへmergeしない。

terminal:

PRODUCTION_COMPOSITION_CODE_READY_EXTERNAL_CONNECTION_PENDING

次へ自動継続可:
LAUNCH CRITICAL M1.6

ただしexternal provider接続は禁止。

Ownerへ戻る条件:

human MFA/login
billing/terms
secret exposure
Production actual operation

だけ。