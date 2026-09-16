【ZAO Rental｜P6 Square Sandbox 実接続準備・受入指示 R2】

対象repo：
ginisato-hash/zao-rental

current main：
3061dbbbe00294e5baebba2405028c907d6e6e85

PR #16 / P5 はRuleset経由でSquash merge済み。
P5ではbooking recovery、production preflight、Square/R2 fixture、
local production rehearsal等をmainへ統合済み。

既存Ruleset 23161641は変更禁止。


━━━━━━━━━━━━━━━━━━
0. Square 現在地
━━━━━━━━━━━━━━━━━━

Owner操作によりSquare Developer側は以下まで完了しています。

Square Developer account：
作成済み／既存Square加盟店アカウントでログイン済み

Application：
ZAO Rental

用途：
Accept payments

Audience：
A company
（特定事業者向け）

Environment：
Sandbox

Sandbox Application：
CONFIRMED / CREATED

Sandbox Application ID：
発行済み
※非secretだが、chat/repoへ無意味に転記しない

Sandbox Access Token：
発行済み
※SECRET
※現在chat/repoには未投入
※値をOwnerへチャット送信させない

Sandbox Test Account：
Default Test Account

Sandbox Location：
Default Test Account (Main)

Sandbox Location ID：
Square Developer Consoleで確認済み

Production credentials：
未使用

Production Square：
絶対に触らない


━━━━━━━━━━━━━━━━━━
1. これまでのP4/P5 Square実装
━━━━━━━━━━━━━━━━━━

既に以下はfixture / loopback / synthetic PostgreSQLで検証済み。

・Square transport boundary
・Bearer auth contract
・API version handling
・idempotency
・response loss
・UNKNOWN reconciliation
・provider lookup
・duplicate webhook
・out-of-order webhook
・wrong amount
・wrong currency
・wrong merchant
・wrong location
・same-idempotency replay
・timeout
・socket abort
・persistent activation journal
・process restart後のbudget保持
・最大20 payment
・最大5 refund
・auth/quota stop
・webhook signature contract

P5時点までのActual external counts：

Square requests = 0
payments = 0
refunds = 0

したがって、
fixture成功をSquare Sandbox E2E成功と扱わない。


━━━━━━━━━━━━━━━━━━
2. Ownerが今回承認するSquare範囲
━━━━━━━━━━━━━━━━━━

Squareについて以下は承認済み範囲とする。

許可：

・Square Sandboxのみ
・Sandbox application ZAO Rental
・Sandbox merchant/locationのread-only確認
・Sandbox access tokenを承認済みsecret storeへ投入
・Sandbox Web Payments tokenization
・Sandbox CreatePayment
・Sandbox GetPayment / provider reconciliation
・Sandbox webhook subscription
・Sandbox webhook signature verification
・最大20件のsynthetic Sandbox payment
・最大5件のSandbox refund
・idempotency検証
・UNKNOWN/response-loss検証
・署名webhook→DB reconciliation
・restart後のjournal継続確認

禁止：

・Production Square credential
・Production payment
・Production refund
・実顧客カード
・実顧客データ
・Production merchant/location
・未知の別idempotency keyによる再請求
・secretのchat/repo/PR/log保存
・実金銭を伴う操作


━━━━━━━━━━━━━━━━━━
3. Vercel現在地
━━━━━━━━━━━━━━━━━━

ZAO Rental用Vercel Projectはまだ存在しない。

Owner方針：

TASTE OF ZAŌと同じVercelアカウント／Team内に
別Project

zao-rental

を作成する。

CodexにProject作成・local linkまでは許可する。

まだ許可しない：

・Production deployment
・custom domain公開
・Production secrets
・本番traffic


━━━━━━━━━━━━━━━━━━
4. まずVercel Projectを作成
━━━━━━━━━━━━━━━━━━

~/Projects/zao-rental で実施。

CLI状態を確認。

TASTE OF ZAŌが所属するVercel Teamをread-onlyで特定する。

推測しない。

必要なら：

npx vercel teams list --format json

およびTeamごとのproject一覧を確認する。

TASTE OF ZAŌと同じTeamを確定後：

npx vercel teams switch <team-slug>

既にzao-rental projectが存在するか確認。

存在しない場合のみ：

npx vercel project add zao-rental

注意：
正しいCLI構文は

vercel project add <name>

であり、
`vercel project add`だけでは
Invalid number of argumentsになる。

作成後local repoをexisting projectへlink。

deployはしない。


━━━━━━━━━━━━━━━━━━
5. Vercel Project設定
━━━━━━━━━━━━━━━━━━

現repo構成を必ず実物確認すること。

現在：

root package.jsonに
dependencies / npm version / Node version / build script
がある。

build script：

npm run build

実体は：

next build apps/web --webpack

apps/webには独立package.jsonがない。

したがって初期設定は：

Framework：
Next.js

Root Directory：
./
(repo root)

Build Command：
npm run build

Output：
Next.js default

Node：
repo package.json enginesに従う

Root Directoryをapps/webへ変更しない。


━━━━━━━━━━━━━━━━━━
6. secret store方針
━━━━━━━━━━━━━━━━━━

初期Sandbox acceptanceでは、
zao-rental Vercel Projectの
Environment Variablesをsecret store候補として使用する方向。

ただし、

実secret値をCodexの入力、
GitHub、
commit、
PR comment、
ログ

へ渡さない。

まず現コードを調査して、
既存Square config contract / env名を列挙する。

既存名があれば必ず再利用。

勝手に類似env名を増やさない。

不足する場合だけ、
新規config schemaを提案・実装する。

最低限必要になる概念：

・Sandbox Application ID
・Sandbox Access Token
・Sandbox Location ID
・Sandbox webhook signature key
・Square API version
・Sandbox mode indicator

公開可能値とsecret値を区別。

Access TokenとWebhook signature keyは
必ずserver-only secret。


━━━━━━━━━━━━━━━━━━
7. Owner secret入力ポイント
━━━━━━━━━━━━━━━━━━

Vercel Projectが作成・linkされ、
必要env名がコードから確定した時点で、

そこで一度Ownerへ停止して質問する。

質問内容は：

「Square Developer ConsoleのSandbox Access Tokenを、
このチャットには貼らず、
Vercelのzao-rental ProjectのPreview用Environment Variableへ
直接登録してください」

というUI操作だけにする。

token値そのものを要求しない。

可能ならVercel Dashboard上でOwner本人が入力する。

CLIを使う場合も値をcommand引数へ入れず、
interactive secret inputを利用する。


━━━━━━━━━━━━━━━━━━
8. Locationの扱い
━━━━━━━━━━━━━━━━━━

Sandboxには現在1件：

Default Test Account (Main)

が存在する。

P6 Sandbox接続確認では、
これをSandbox acceptance locationとして使用してよい。

ただし、

Mountain Base
Onsen Base

の2店舗をSquare Locationへどう対応させるかは
Production設計としてまだ確定しない。

現在の1件Locationを理由に
内部2店舗を統合・変更しない。

Sandbox Locationを2店舗分追加する必要も、
今の時点ではない。

P6では：

SANDBOX_ACCEPTANCE_LOCATION = Default Test Account (Main)

相当の一時的意味として扱う。

Production store↔Square Location mappingは
OWNER_PENDINGとして残す。


━━━━━━━━━━━━━━━━━━
9. Webhook receiver
━━━━━━━━━━━━━━━━━━

Square Webhookの実受信には
公開HTTPS URLが必要。

現時点では：

Sandbox HTTPS receiver = NOT_CREATED

まず既存コードを確認し、
webhook routeが

・raw bodyを保持
・exact notification URLで署名検証
・signature keyをserver-only secretから取得
・duplicate safe
・out-of-order safe
・durable receipt
・provider lookup
・DB reconciliation
・2xx response policy
・secret/body/card data非ログ

を満たすことを確認。

route pathを勝手に増やさず、
既存契約があれば再利用。


━━━━━━━━━━━━━━━━━━
10. Preview deploy
━━━━━━━━━━━━━━━━━━

Vercel Project作成・linkは進めてよい。

ただし、
Preview deploymentを実際に開始する直前に
Ownerへ一度停止。

理由：
Preview deployは初の実hosting acceptanceになるため。

Owner承認後にのみPreview deploy。

Production deployは禁止。


━━━━━━━━━━━━━━━━━━
11. Preview承認後のSquare Sandbox手順
━━━━━━━━━━━━━━━━━━

OwnerがPreview deployを承認した場合：

1.
zao-rental Previewをdeploy

2.
HTTPS preview URL取得

3.
health/readiness確認

4.
trusted ingress実環境確認

5.
Square Developer Console / Sandbox / Webhooksに
Sandbox subscriptionを作成

6.
Webhook notification URLを
ZAO Rentalの実webhook routeへ設定

7.
Squareが発行するWebhook signature keyを
chat/repoへ貼らず、
Vercel Preview secretへOwnerが直接登録

8.
Preview redeploy / config refresh

9.
署名検証を実Square Sandbox webhookで確認


━━━━━━━━━━━━━━━━━━
12. 最初のSquare実通信
━━━━━━━━━━━━━━━━━━

最初からpaymentを送らない。

順序：

Phase S1：
authentication / merchant/location read-only

・Access Tokenが有効
・Sandbox環境
・Default Test Account
・Location一致

のみ確認。

Production endpointへ接続していないことを確認。

Phase S1成功後のみS2へ。


━━━━━━━━━━━━━━━━━━
13. Sandbox payment acceptance
━━━━━━━━━━━━━━━━━━

S2ではsynthetic bookingのみ使用。

実顧客データ禁止。

金額は新しい適当な価格をハードコードせず、
既存synthetic quote/payment fixtureまたは
Sandbox acceptance専用の明示的synthetic bookingを使用。

既存：

price snapshot
currency
merchant
location
idempotency
chargeReady gate

を崩さない。

最初のpaymentは1件だけ。

確認：

・source/tokenization
・CreatePayment
・provider payment ID
・amount
・JPY
・merchant
・location
・idempotency
・DB attempt
・booking snapshot
・payment reconciliation

成功後にのみ追加ケースへ進む。


━━━━━━━━━━━━━━━━━━
14. Webhook acceptance
━━━━━━━━━━━━━━━━━━

Sandbox実Webhookで：

・SquareからHTTPS到達
・raw body署名
・notification URL一致
・signature verification
・durable receipt
・payment lookup
・DB reconciliation
・duplicate safety
・state regression拒否

を確認。

Webhook受信だけで
ブラウザのpaid表示を真実としない。

server reconciliationを正本とする。


━━━━━━━━━━━━━━━━━━
15. UNKNOWN / response loss
━━━━━━━━━━━━━━━━━━

結果不明時：

・別idempotency keyで再請求しない
・同じattempt/keyを維持
・provider IDが分かるならGetPayment
・provider ID不明ならSTOP / manual investigation

「GetPayment by idempotency key」
のような存在しないAPIを捏造しない。

fixtureで検証済みでも、
実Sandbox結果は別証拠として保存。


━━━━━━━━━━━━━━━━━━
16. Refund
━━━━━━━━━━━━━━━━━━

Payment acceptanceが完全に通る前に
refundを始めない。

Owner承認済み上限：

Sandbox payment <= 20
Sandbox refund <= 5

最初のrefundは
成功済みsynthetic Sandbox payment 1件に限定。

本番返金機能へ拡張しない。


━━━━━━━━━━━━━━━━━━
17. API Version
━━━━━━━━━━━━━━━━━━

現コードで採用しているSquare API versionを確認。

過去P3資料では
2026-08-19
を起点としていた。

ただし、
現在mainの実コードを正本として再確認する。

公式Square docsで現在サポート状況を確認し、
勝手にversion upgradeしない。

変更が必要なら別diff・別review。


━━━━━━━━━━━━━━━━━━
18. 証拠
━━━━━━━━━━━━━━━━━━

Square実Sandboxを開始した後は
fixture証拠と実外部証拠を完全に分離。

記録してよい：

・application name
・Sandbox環境
・merchant metadata
・location metadata
・HTTP status
・Square request ID
・provider object ID
・amount/currency
・timing
・webhook event ID
・result
・hash / redacted metadata

記録禁止：

・Access Token
・Webhook signature key
・card details
・payment source token
・Cookie
・recovery code
・raw secret
・Authorization header


━━━━━━━━━━━━━━━━━━
19. P6進捗更新
━━━━━━━━━━━━━━━━━━

P6 docs/statusを現在事実へ更新：

Square Developer account：
CONFIRMED

Square Sandbox Application：
CONFIRMED

Application name：
ZAO Rental

Sandbox Test Account：
CONFIRMED
Default Test Account

Sandbox Location：
CONFIRMED
Default Test Account (Main)

Sandbox Application ID：
ISSUED

Sandbox Access Token：
ISSUED / NOT_YET_INSTALLED

Secret store：
PENDING_VERCEL_PROJECT

Sandbox HTTPS Webhook receiver：
NOT_CREATED

Actual Square requests：
0
（実通信開始前時点）

Actual payments：
0

Actual refunds：
0

Production Square：
PROHIBITED


━━━━━━━━━━━━━━━━━━
20. 今回Codexが自律的に進めてよい終点
━━━━━━━━━━━━━━━━━━

Ownerの追加操作なしで進めてよいのは：

・Square current-state docs更新
・既存config/env contract調査
・既存webhook implementation監査
・Vercel Team特定
・zao-rental Vercel Project作成
・local project link
・build/root settings確認
・secret env名確定
・Preview deploy直前までの準備

まで。

そこで停止。

Ownerへ次に要求するのは
secretそのものではなく、

1.
Vercel Preview Environment Variableへの
Sandbox Access Token直接登録

2.
Preview deploy実行承認

だけ。

一度に複数のsecretをチャットで要求しない。


━━━━━━━━━━━━━━━━━━
21. 絶対禁止
━━━━━━━━━━━━━━━━━━

・Square Production
・Production Access Token
・実顧客カード
・実顧客予約
・本番payment/refund
・secretのGit保存
・secretのPRコメント保存
・secretのログ出力
・Production deploy
・domain公開
・Ruleset変更
・PR #3 / Runner有効化

以上。

まずSquare進捗をP6へ正式反映し、
Vercel `zao-rental` Project作成・link、
Square config/env contract確認まで自律で進め、
OwnerがVercelへSandbox secretを直接入れる地点で停止してください。