【ZAO Rental｜P6 Vercel Acceptance Recovery R3
Astra Lead + Codex 5.3 Spark bounded subagents】

MODEL / ROLE

親：
GPT-6 Astra / Extra High

Astraは
Lead Engineer / Architect / Integrator
として動く。

今回から以下の運用を正式適用：

・Astra：
  architecture
  infrastructure
  production boundary
  provider activation
  secrets
  payment/security
  root config decision
  integration
  final acceptance

・Codex 5.3 Spark：
  bounded read-only調査
  tests
  fixtures
  mechanical validation
  non-authority docs

へ分離する。

節約のためにAstraがleaf作業を抱え込まない。
一方、Vercel target、runtime contract、Square、secret、
production/preview境界をSparkへ判断させない。


━━━━━━━━━━━━━━━━━━
0. 現在地を最初に再取得
━━━━━━━━━━━━━━━━━━

repo:
ginisato-hash/zao-rental

main expected:
3061dbbbe00294e5baebba2405028c907d6e6e85

P6 branch:
codex/external-acceptance-p6

last known P6 head:
31cd6006197198404c0f64fdc66a7db1a6bdd592

ただし固定起点にしない。

開始時に必ず：

git status
git rev-parse HEAD
git log --oneline -15

GitHub remote branch
current main
P6 docs/status
Owner authority

を再照合する。

添付済みの
「Astra親 / Codex 5.3 Spark サブエージェント運用指示」
をこの作業方式の正本として扱う。

authority競合判断はAstra自身が行う。


━━━━━━━━━━━━━━━━━━
1. 直前の失敗を正確に維持
━━━━━━━━━━━━━━━━━━

直前のVercel受入：

requested:
Preview deployment 1回

actual:
first deploymentがproduction targetとして作成された

deployment:
dpl_93LKqdiYs68WSWjfDPCG5YdpyiBs

commit:
763caec75f3257abad6ad6d691637ae138c84cdb

result:
BUILD FAILED

application startup:
NOT RUN

health/readiness:
NOT RUN

Square requests:
0

payments:
0

refunds:
0

webhooks:
0

DB external connections:
0

そのdeploymentは撤去済み。

残存deployment:
0

残存alias:
0

Deployment Protection:
維持

これを
「Preview成功」
「Production公開」
「Square acceptance済み」
とは絶対に扱わない。


━━━━━━━━━━━━━━━━━━
2. 今回Ownerが追加承認する範囲
━━━━━━━━━━━━━━━━━━

以下を承認する。

A.
Vercel build失敗のroot cause調査

B.
VercelとrepoのNode/npm互換性を取るための
最小runtime/toolchain修正

C.
first-deployment特殊挙動を安全に越える
bootstrap手順の実行

D.
bootstrap後の
実Preview deployment 1回

E.
Previewでの
build / startup / protection / health /
fail-closed確認

ただし、

Square S1実通信
Square payment
Webhook subscription
外部DB
R2
Production公開

へはまだ進まない。


━━━━━━━━━━━━━━━━━━
3. Astra専属：2つのroot causeを分離
━━━━━━━━━━━━━━━━━━

Astraがまず以下を別々に解く。

ROOT CAUSE A：
Vercel new project first-deployment target semantics

ROOT CAUSE B：
Node/npm install incompatibility

一つの問題として雑に修正しない。


━━━━━━━━━━━━━━━━━━
4. ROOT CAUSE A
first deployment / Preview target
━━━━━━━━━━━━━━━━━━

公式Vercel仕様を現在時点で再確認する。

確認対象：

・new projectのfirst deployment挙動
・Preview / Production target semantics
・`vercel deploy`
・`--target=preview`
・`--prod`
・`--skip-domain`
・Deployment Protection
・generated deployment URL
・alias assignment
・custom domain assignment

過去の試行で、

zero deployments
↓
明示Preview
↓
production target

になった事実を優先する。

同じzero-deployment状態で
`--target=preview` をもう一度盲目的に試さない。


━━━━━━━━━━━━━━━━━━
5. bootstrap方式
━━━━━━━━━━━━━━━━━━

Astraは公式仕様確認後、
以下の安全方式を第一候補として評価する。

【staged bootstrap placeholder】

新Projectのfirst deploymentを
実アプリではなく無害なbootstrap placeholderとして
一度だけ作る。

許可条件：

・production target扱いになってもよい
・ただし `--skip-domain` 相当でdomain assignmentしない
・custom domainなし
・Production Square envなし
・Production secretなし
・外部DBなし
・外部provider callなし
・静的な無害placeholderのみ
・Deployment Protection有効
・実顧客trafficなし
・予約機能なし
・決済機能なし

目的は
「first deploymentを初期化する」
ことだけ。

ZAO Rentalアプリ本体を
このbootstrap production targetで動かさない。


━━━━━━━━━━━━━━━━━━
6. placeholderの作り方
━━━━━━━━━━━━━━━━━━

repo本体へplaceholderコードをcommitしない。

専用temporary directoryを作り、
同じVercel Project ID / Team IDへ
安全にlinkできる方式を使う。

内容は最小static responseのみ。

例：

ZAO Rental deployment bootstrap
No application
No customer traffic

程度。

禁止：

・repo rootのアプリを書き換える
・package-lock変更
・Vercel Project設定を別frameworkへ恒久変更
・Preview secretsをproductionへコピー
・Production Square envを作成
・domainを割り当てる

bootstrap生成物はGitへ入れない。


━━━━━━━━━━━━━━━━━━
7. bootstrap実行前gate
━━━━━━━━━━━━━━━━━━

実アップロード前に必ず：

vercel deploy --dry --format=json

相当のdry-runを使い、

・送信ファイル
・framework
・secretファイル混入
・DBファイル混入
・認証ファイル混入
・worktree外ファイル
・local cache

を確認する。

想定外ファイルが1つでもあれば実行しない。


━━━━━━━━━━━━━━━━━━
8. bootstrap owner approval
━━━━━━━━━━━━━━━━━━

このR3指示をもって、

以下のbootstrap 1件はOwner承認済みとする。

・protected
・no-domain
・no-secret
・no-provider
・static placeholder
・first-deployment initialization only

production targetというmetadataになっても、
公開Production activationとは扱わない。

ただしdomain/alias/public trafficを伴うなら
この承認範囲外なので停止。


━━━━━━━━━━━━━━━━━━
9. bootstrap成功後
━━━━━━━━━━━━━━━━━━

bootstrap deploymentは
実PreviewがPreview targetとして生成されるまで
削除しない。

理由：
zero deploymentへ戻して
再びfirst deployment扱いになる可能性を避ける。

bootstrapについて記録：

deployment ID
target
protection
domain assignment
alias
files
external calls=0
secret reads=0

のみ。

secret値は記録しない。


━━━━━━━━━━━━━━━━━━
10. ROOT CAUSE B
Node/npm compatibility
━━━━━━━━━━━━━━━━━━

Astra専属。

まず失敗deploymentのbuild logを取得し、
実際に使用された：

node --version
npm --version

および失敗行を確定する。

推測だけでpackage.jsonを変更しない。


━━━━━━━━━━━━━━━━━━
11. 現在のtoolchain契約
━━━━━━━━━━━━━━━━━━

現在repoには：

package.json:

engines.node = 24.15.x
engines.npm = 11.12.x
packageManager = npm@11.12.1

.nvmrc:

24.15.0

.npmrc:

engine-strict=true

がある。

これを全削除したり、
engine-strictを雑にOFFにして通すことは禁止。


━━━━━━━━━━━━━━━━━━
12. Vercel runtimeとの整合方針
━━━━━━━━━━━━━━━━━━

Astraが公式Vercel仕様とbuild logから
最小変更を決定する。

設計原則：

・Vercel側が保証するNode単位に合わせる
・local/CIの再現性は維持
・npm version pinの意図は維持
・lockfile semanticsを壊さない
・npm majorを勝手に上げない
・依存package versionを今回ついでに更新しない

Nodeについて、

Vercelが24.x majorのみ保証するなら、

engines.node:
24.x

を候補とする。

.nvmrcの24.15.0は
local/CI pinとして残すことを優先検討する。

ただし最終判断はAstraが
公式仕様＋実build logで決める。


━━━━━━━━━━━━━━━━━━
13. npmについて
━━━━━━━━━━━━━━━━━━

packageManager:

npm@11.12.1

の意味を維持する。

まずVercel公式の

・packageManager pin
・Corepack
・Install Command
・npm version selection

を確認。

優先順位：

1.
Vercel公式方式でnpm@11.12.1を使用

2.
それが無理なら
既存contractを最小限に調整する案を比較

禁止：

・engine-strict=falseで隠す
・npm version checkだけ削除
・CIだけ別npmへする
・Vercelだけ未管理npmへする

変更理由を証拠付きで残す。


━━━━━━━━━━━━━━━━━━
14. Spark #1
read-only version compatibility investigation
━━━━━━━━━━━━━━━━━━

AstraはSparkを1つ起動してよい。

TASK_ID:
P6-SPARK-RUNTIME-01

ROLE:
Codex 5.3 Spark
bounded read-only investigation

GOAL:
現在repoのNode/npm pinが
どのファイル・CI・scriptsへ依存しているかを列挙する。

READ_FIRST:

package.json
package-lock.json
.nvmrc
.npmrc
.github/workflows/**
scripts/verify.mjs
scripts/setup.mjs

ALLOWED_EDIT_FILES:
なし

READ_ONLYのみ。

FORBIDDEN:

・package.json変更
・lockfile変更
・Vercel操作
・env変更
・deploy
・secret access
・business logic
・payment
・DB
・authority docs変更

RETURN:

1. version pin参照箇所
2. exact versionを必要としているtest/CI
3. Nodeを24.xへ広げた場合の影響候補
4. npm pin変更時の影響候補
5. Astraが確認すべき点

Sparkに修正案の最終判断をさせない。


━━━━━━━━━━━━━━━━━━
15. Astraがruntime修正を実装
━━━━━━━━━━━━━━━━━━

Spark調査＋公式資料＋Vercel実logを統合し、
Astraがroot config修正を所有する。

変更可能候補：

package.json
.nvmrc
.npmrc
Vercel Build設定

ただし必要最小限だけ。

package-lockを再生成する必要がある場合は
理由を明示。

無関係dependency update禁止。


━━━━━━━━━━━━━━━━━━
16. Spark #2
bounded regression tests
━━━━━━━━━━━━━━━━━━

Astraがruntime契約を確定した後のみ
Spark #2を起動してよい。

TASK_ID:
P6-SPARK-RUNTIME-TEST-02

GOAL:
Astraが確定したruntime/toolchain契約を
機械的に検証するregression test追加。

WHY_SAFE:
business/domain/payment/inventory/security semanticsを
変更しないため。

Astraがexact allowed filesを指定する。

原則：

tests/readiness/**
または
scripts内のpure verification

のみ。

FORBIDDEN:

package.json
.npmrc
.nvmrc
package-lock
payment
guest
inventory
auth
Vercel Project設定
secret
deploy

TEST EXPECTATIONを弱めない。

Sparkは最大1回修正まで。


━━━━━━━━━━━━━━━━━━
17. local integration verification
━━━━━━━━━━━━━━━━━━

runtime修正後、Astraが統合確認。

最低限：

node --version
npm --version
npm ci
npm run lint
npm run typecheck
npm run build

影響したreadiness unit

その後必要なら：

npm run verify

ただし毎Sparkごとにfull suiteを回さず、
最後のintegration boundaryでのみfull verify。


━━━━━━━━━━━━━━━━━━
18. 実Preview deployment前dry-run
━━━━━━━━━━━━━━━━━━

bootstrap deploymentが残存し、
zero-deployment状態ではないことを確認。

ZAO Rental P6 headを固定。

その後：

vercel deploy --dry --format=json

で実送信manifestを確認。

以下をBLOCK：

.env
.env.*
.local DB
PostgreSQL data
token
credentials
worktree metadata
untracked evidence
他project files

問題なければ実Previewへ。


━━━━━━━━━━━━━━━━━━
19. Actual Preview retry approval
━━━━━━━━━━━━━━━━━━

このR3指示により、
runtime修正後の

ZAO Rental本体 Preview deployment

を追加で1回だけOwner承認する。

条件：

・bootstrapが安全に存在
・target=previewを事前確認
・Production envを使用しない
・Preview envのみ
・Deployment Protection有効
・custom domainなし
・Square通信コードをactivation DISABLEDのまま維持
・外部DBなし
・R2なし

1回失敗したら自動で3回目を試さない。


━━━━━━━━━━━━━━━━━━
20. Preview deployment verification
━━━━━━━━━━━━━━━━━━

実行後、まずmetadataを確認。

必須：

target = preview

であること。

もしproductionなら、
runtime確認へ進まず即停止。

previewなら：

・deployment ID
・URL
・commit SHA
・target
・environment
・protection
・aliases
・build runtime
・Node version
・npm version

を記録。


━━━━━━━━━━━━━━━━━━
21. Previewで許可する実確認
━━━━━━━━━━━━━━━━━━

許可：

・build success
・Next.js startup
・protected URL到達
・health
・readiness
・static/public routeの最低限確認
・未接続dependencyのfail closed
・Preview system metadata確認
・秘密値非ログ確認

Squareへのnetwork requestは0を維持。


━━━━━━━━━━━━━━━━━━
22. Previewでまだ禁止
━━━━━━━━━━━━━━━━━━

Square S1
Square merchant lookup
Square location API
CreatePayment
refund
Webhook subscription
Webhook delivery
external production DB
R2
email
SMS
Production domain
Production traffic

は禁止。


━━━━━━━━━━━━━━━━━━
23. bootstrap cleanup
━━━━━━━━━━━━━━━━━━

実Previewが：

target=preview
build成功
protection確認

まで完了した後にのみ、
最初のbootstrap placeholderを削除してよい。

削除後、

・Preview deploymentが残る
・production alias 0
・custom domain 0
・Production traffic 0

を再確認。


━━━━━━━━━━━━━━━━━━
24. P6 docs
━━━━━━━━━━━━━━━━━━

今回の結果は既存P6 statusへ追加。

過去の失敗を上書きしない。

記録：

Attempt 1:
unexpected production target
build failure
removed

Bootstrap:
staged/no-domain/protected
external calls 0

Attempt 2:
actual Preview result

のように分離。

Owner approval文書そのものはSparkに変更させない。

実行証拠の機械的整理はSparkへ委譲可。


━━━━━━━━━━━━━━━━━━
25. Square進捗は止めたまま
━━━━━━━━━━━━━━━━━━

現在Square：

Developer account:
CONFIRMED

Application:
ZAO Rental

Environment:
Sandbox

Test Account:
Default Test Account

Location:
Default Test Account (Main)

Preview env設定：
5件登録済み

SQUARE_ENVIRONMENT
SQUARE_API_VERSION
SQUARE_SANDBOX_APPLICATION_ID
SQUARE_SANDBOX_LOCATION_ID
SQUARE_SANDBOX_ACCESS_TOKEN

Access Token：
Vercel Preview SecretへOwner直接登録済み
値は取得禁止。

まだ未設定：

SQUARE_SANDBOX_MERCHANT_ID
SQUARE_SANDBOX_NOTIFICATION_URL
SQUARE_SANDBOX_WEBHOOK_SIGNATURE_KEY

Actual Square requests:
0

payments:
0

refunds:
0

webhooks:
0

Preview acceptance完了までは
この状態を維持。


━━━━━━━━━━━━━━━━━━
26. security
━━━━━━━━━━━━━━━━━━

禁止：

process.env dump
vercel env pullでsecret値取得
Access Token表示
token prefix表示
Authorization header表示
Webhook key表示
.secretのローカル保存
Git commit
PR comment
Claude/Spark promptへのsecret転記

Sparkへ実credentialを渡さない。


━━━━━━━━━━━━━━━━━━
27. 既存業務contractを触らない
━━━━━━━━━━━━━━━━━━

今回変更対象はVercel/toolchain acceptanceのみ。

以下不変：

600秒HOLD
non-extending TTL
all-or-nothing group
Premium exact model
Regular model non-guarantee
wear quantity pool
serialized pair Asset
price/quote snapshot
payment idempotency
UNKNOWN
late success
refund semantics
booking access/recovery
RBAC
custody
transfer

この作業を理由にcoreを変更しない。


━━━━━━━━━━━━━━━━━━
28. 停止条件
━━━━━━━━━━━━━━━━━━

以下で即停止：

・placeholderにdomain/aliasが付く
・Deployment Protection無効
・Production env secretが必要
・runtime修正がdependency upgradeへ拡大
・lockfile大量変更が必要
・Preview retryがproduction targetになる
・Preview retry失敗
・Square request発生
・secret露出
・SparkがRED変更を要求
・business/domain変更が必要
・未知のmain更新
・予期しないuncommitted work


━━━━━━━━━━━━━━━━━━
29. 終点
━━━━━━━━━━━━━━━━━━

今回のゴールは：

A.
first-deployment問題を安全に越える

B.
Node/npm互換性を正しく直す

C.
ZAO Rental本体の
実Preview deploymentを1回成功

D.
build/start/health/fail-closedを確認

まで。

成功しても
Square S1へ進まない。

そこで停止してOwnerへ報告。


━━━━━━━━━━━━━━━━━━
30. 最終報告形式
━━━━━━━━━━━━━━━━━━

Astra実施:
- root cause A
- root cause B
- runtime/config decision
- Vercel bootstrap/integration

Spark委譲:
- P6-SPARK-RUNTIME-01
- P6-SPARK-RUNTIME-TEST-02
  （使用した場合のみ）

Spark→Astra昇格:
- ...

Business invariants:
- maintained / changed

Verification:
- local
- build
- Preview
- health/readiness
- CI status if applicable

Vercel:
- bootstrap deployment
- preview deployment
- target
- protection
- alias/domain
- Node
- npm

External counts:
- Square requests
- payments
- refunds
- webhooks
- DB external
- R2

Security:
- secret exposure 0/?
- Production secret 0/?

Current HEAD:
- ...

Owner next action:
- Square S1承認が可能か
- blockerがあればその1点

「production ready」
「Square接続済み」
等の過大表現は禁止。