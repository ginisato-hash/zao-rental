【R3 Alias Gate明確化／Preview継続承認】

R3 §28のalias停止条件についてOwner判断を更新します。

現在のbootstrap：

deployment:
dpl_C44zbkSu1uu4WbPNj9uCLA8zDJWP

target:
production metadata

content:
static placeholder only

Deployment Protection:
enabled

custom domain:
0

current alias:
0

external provider calls:
0

Square requests/payments/refunds/webhooks:
0

はそのまま保持してよいです。

現在のP6 head：
de1d530ec65d0a73d23938b4b4fd9f88e178b74f

から継続してください。


━━━━━━━━━━━━━━━━━━
1. alias停止条件を明確化
━━━━━━━━━━━━━━━━━━

R3 §28の

「placeholderにdomain/aliasが付く → 停止」

は以下へ置き換えます。

【許可】

Vercelが自動生成する：

・deployment URL
・Preview用 *.vercel.app URL
・Vercel管理のgenerated preview alias

は、

target=preview
かつ
Deployment Protection有効
かつ
custom domainではない
かつ
production trafficを受けない

場合は許可します。

これらを理由に停止しないでください。


【引き続き禁止／停止】

・custom domain
・Owner所有domain
・Production domain
・Production alias
・project production promotion
・custom domain assignment
・Production traffic routing
・Deployment Protection無効化
・Production Square secrets
・Production環境へのSquare設定

が発生した場合は即停止。


━━━━━━━━━━━━━━━━━━
2. bootstrapの扱い
━━━━━━━━━━━━━━━━━━

現在のbootstrap placeholderは保持。

aliasは既に除去済みなので
再作成する必要はありません。

bootstrapを削除して
zero-deployment状態へ戻してはいけません。

Actual Preview成功確認までは保持してください。


━━━━━━━━━━━━━━━━━━
3. まずローカル統合検証
━━━━━━━━━━━━━━━━━━

Preview deploymentの前に、
Astraが現在headで以下を実行。

確認：

git status
git rev-parse HEAD

期待head：
de1d530ec65d0a73d23938b4b4fd9f88e178b74f
または、その後の明示的なP6修正commit。

次に：

node --version
npm --version
npm ci
npm run lint
npm run typecheck
npm run build

P6 runtime regression test

を実行。

Astraがintegration boundaryで必要と判断する場合のみ：

npm run verify

まで実施。


━━━━━━━━━━━━━━━━━━
4. runtime契約
━━━━━━━━━━━━━━━━━━

今回確定した方針を維持。

Vercel runtime：

Node 24.x

local / CI：

.nvmrc
24.15.0

npm：

11.12.1

packageManager：

npm@11.12.1

engine-strict：

維持

無関係dependency version：
変更禁止。

package-lock：
必要のない再生成禁止。


━━━━━━━━━━━━━━━━━━
5. Spark使用方法
━━━━━━━━━━━━━━━━━━

Spark #1/#2の成果は既に取得済み。

以後、このPreview acceptanceの

・Vercel target判断
・runtime判断
・infra設定
・secret
・provider activation

はAstra自身が所有する。

追加Sparkを起動する場合は、

・既存仕様のtest
・fixture
・read-only evidence整理

だけ。

SparkにVercel deploy判断や
root config判断を委譲しない。


━━━━━━━━━━━━━━━━━━
6. local green後のactual Preview
━━━━━━━━━━━━━━━━━━

ローカル統合検証が全て成功した場合のみ、

ZAO Rental本体のPreview deploymentを
残る承認枠1回で実行してください。

Preview deploymentを作る前に、

実行command / API payloadについて、

production flagなし
production targetなし
production promotionなし

を確認すること。


━━━━━━━━━━━━━━━━━━
7. deploy前manifest
━━━━━━━━━━━━━━━━━━

実deploy前に送信対象をdry-run確認。

以下の混入をBLOCK：

.env
.env.*
.local DB
PostgreSQL data
credential file
token
secret
auth cache
untracked worktree evidence
他repo
他project
Mac user files

追跡済みZAO Rentalコードと
必要なdeployment設定のみ。


━━━━━━━━━━━━━━━━━━
8. Preview作成直後に最優先確認
━━━━━━━━━━━━━━━━━━

アプリへのHTTPアクセスより先に
deployment metadataを取得。

必須：

target = preview

environment = preview

Deployment Protection = enabled

Production alias = none

custom domain = none


自動生成されたVercel Preview URLや
generated preview aliasは許可。

targetがproductionなら：

・アプリへのrequestを行わない
・Squareへrequestしない
・追加deployしない
・状態を記録
・停止

してください。


━━━━━━━━━━━━━━━━━━
9. target=previewなら検証継続
━━━━━━━━━━━━━━━━━━

以下を確認：

・build SUCCESS
・Node runtime version
・npm version
・Next.js startup
・Deployment Protection
・protected Preview URLへの認証済みアクセス
・health
・readiness
・最低限のpublic/static route
・未接続dependencyがfail closed
・production activation gate false
・Square activation disabled


━━━━━━━━━━━━━━━━━━
10. 重要：今回Squareはまだ0件
━━━━━━━━━━━━━━━━━━

Preview上にSandbox Access Tokenが存在していても、
今回はSquare transportを実行しない。

必ず：

Actual Square requests = 0
payments = 0
refunds = 0
webhooks = 0

を維持。

禁止：

merchant lookup
location lookup
CreatePayment
GetPayment
refund
Webhook subscription
Square webhook delivery

Square S1はPreview acceptance後の
別Owner承認です。


━━━━━━━━━━━━━━━━━━
11. DB等も未接続維持
━━━━━━━━━━━━━━━━━━

今回：

external production DB = 0
R2 = 0
email = 0
SMS = 0

維持。

health/readinessでDB未接続が理由の
fail-closed応答になる場合、

コード契約どおりなら
「Preview失敗」とは即断しない。

build/start成功と
dependency readinessを別々に記録する。


━━━━━━━━━━━━━━━━━━
12. Preview URLの扱い
━━━━━━━━━━━━━━━━━━

Preview成功時の

*.vercel.app

generated URLは保持してよい。

ただし：

・custom domainへaliasしない
・tasteofzao.appを使わない
・本番domainを付けない
・Productionへpromoteしない

Deployment Protectionは維持。


━━━━━━━━━━━━━━━━━━
13. bootstrap cleanup
━━━━━━━━━━━━━━━━━━

Actual Previewが：

target=preview
build SUCCESS
protection enabled

まで確認できた場合だけ、
bootstrap placeholder deploymentを削除してよい。

削除後：

Actual Preview deploymentが残存
bootstrap削除済み
Production custom alias=0
custom domain=0

を確認。

Preview自体のgenerated Vercel URLは
削除不要。


━━━━━━━━━━━━━━━━━━
14. 今回の停止条件
━━━━━━━━━━━━━━━━━━

以下のみ停止：

・target=production
・custom domain付与
・production alias付与
・Deployment Protection無効
・Production envが必要
・Preview build failure
・Preview startup failureで原因がruntime/coreへ拡大
・secret露出
・Square request発生
・外部DBへ接続
・dependency upgradeが必要
・business/domain/payment変更が必要
・未知main変更
・unexpected uncommitted work

Vercelの通常generated Preview URLだけでは
停止しない。


━━━━━━━━━━━━━━━━━━
15. 成功時の終点
━━━━━━━━━━━━━━━━━━

今回のゴール：

1.
local integration green

2.
Actual Vercel deployment:
target=preview

3.
build SUCCESS

4.
Next.js startup確認

5.
Deployment Protection確認

6.
health/readiness結果確認

7.
fail-closed確認

8.
Square actual requests 0

まで。

成功してもSquare S1へ進まない。

そこで停止してください。


━━━━━━━━━━━━━━━━━━
16. 最終報告
━━━━━━━━━━━━━━━━━━

Astra実施:
- runtime integration
- Vercel Preview acceptance
- bootstrap cleanup判断

Spark委譲:
- 既存P6-SPARK-RUNTIME-01結果
- 既存P6-SPARK-RUNTIME-TEST-02結果
- 追加があれば明記

Verification:
- npm ci
- lint
- typecheck
- build
- runtime regression
- verify（実施した場合）

Vercel:
- bootstrap ID
- Preview ID
- Preview URL
- target
- protection
- generated alias
- custom domain count
- production alias count
- Node
- npm
- build
- startup
- health
- readiness

External:
- Square requests
- payments
- refunds
- webhooks
- external DB
- R2

Security:
- secret exposure
- Production Square env
- Production deploy

Current HEAD:
- ...

Owner next action:
Previewが成功した場合のみ
Square Sandbox S1 read-only acceptance承認待ち

以上の条件で、
ローカル統合検証と残るPreview 1回へ進めてください。