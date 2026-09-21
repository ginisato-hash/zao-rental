【ZAO Rental｜本体Macへの実装復帰 handoff
P6 R8 — Adopt completed S1 identity evidence / merchant metadata / S2 gate】

このMacを以後の主作業端末に戻す。

GitHubを唯一の正本として扱う。
他Mac側の zao-rental / codex/external-acceptance-p6 への書込みは停止済みとして扱い、
このMacをsingle writerにする。

不要な中間Owner確認は挟まない。
明示された安全境界内ではCodex parentが自律実行し、
R8完了まで一気通関する。

────────────────────
0. 最重要：まずGitHubから状態を復元
────────────────────

repo:
ginisato-hash/zao-rental

canonical remote branch:
codex/external-acceptance-p6

expected remote HEAD:
fb237f7f1698a718c5430da130ddd3530816744d

main:
3061dbbbe00294e5baebba2405028c907d6e6e85

最初に必ず:

git fetch origin --prune
git rev-parse origin/codex/external-acceptance-p6
git rev-parse origin/main
git status --short --branch

を確認する。

expected:

origin/codex/external-acceptance-p6
=
fb237f7f1698a718c5430da130ddd3530816744d

origin/main
=
3061dbbbe00294e5baebba2405028c907d6e6e85

remoteが進んでいた場合は、このhandoffのSHAを強制適用せず、
最新GitHub記録を再読して新しいremoteを正本にする。

────────────────────
1. 本体Macの既存local stateの扱い
────────────────────

このMacに古い作業treeが残っている可能性がある。

絶対に:

git reset --hard
git clean -fd
未知のstash/drop
未知ファイル削除

をしない。

既存working treeがcleanかつ安全なら、
canonical branchへswitchしてff-onlyで同期してよい。

例:

git switch codex/external-acceptance-p6
git pull --ff-only origin codex/external-acceptance-p6

既存treeがdirty、
branchが別作業中、
または何らかのlocal progressが存在する場合は
その内容を壊さず、GitHub正本から新しいisolated worktreeを作る。

推奨:

git fetch origin --prune
git worktree add -b codex/p6-r8-main-mac \
  ../zao-rental-p6-r8 \
  origin/codex/external-acceptance-p6

cd ../zao-rental-p6-r8

この場合も最終push先は:

origin/codex/external-acceptance-p6

とする。

push直前に必ずremote HEADが開始時から他writerで進んでいないことを確認する。
進んでいた場合はforce pushせずreconcileする。

────────────────────
2. ここまでの経緯
────────────────────

P5まではmainへmerge済み。

main:
3061dbbbe00294e5baebba2405028c907d6e6e85

P6ではSquare Sandboxの実接続acceptanceを段階的に進めた。

R3:
protected Vercel Preview acceptance成功。

accepted R3 Preview:
dpl_2tskZombWNMhwEKB6NG96FxkzmhL

これは現在もReadyとして保持。

R4:
最初のSquare S1 routeを構築。
Owner browser one-shotでHTTP503となり、

UNKNOWN_DO_NOT_RETRY

で終了。
R4 S1は再実行禁止。
R4 Previewは削除済み。

R5:
HTTP503 forensicを開始したが、
Owner判断で「次工程の必須gateではなく無駄が大きい」として打ち切り。
R5のforensicを再開しない。

R6:
S1 Acceptance v2を構築。
Square通信前のruntime preflightを導入。

R6 preflight:
API_VERSION_MISMATCH

でBLOCK。

他項目は:

environment SANDBOX
deployment preview
applicationIdConfigured true
locationIdConfigured true
accessTokenConfigured true
accessTokenFormatValid true
publicCredentialExposure false

だった。

S1 POST0
Square GET0

R6 Preview削除済み。

R7:
Preview SQUARE_API_VERSIONを
exact:

2026-08-19

へ修正。

新Preview:

dpl_J8Dpxh5mogQR4Mo6xvqNUDMSwv8m

origin:
https://zao-rental-p7g3j78c0-zao-food-map.vercel.app

でruntime preflight PASS。

その後、one-shot S1を1回実行。

────────────────────
3. R7で確定したSquare provider evidence
────────────────────

R7 safe evidence:

docs/execution/p6/r7-evidence/safe-result.json

結果:

S1_PASS

S1 HTTP:
200

POST:
1

retry:
0

Square GET:
2 total

merchant GET:
1 / HTTP200

locations GET:
1 / HTTP200

merchant:

id:
MLKDVEDH1ME21

status:
ACTIVE

country:
JP

currency:
JPY

locationCount:
1

mainLocationMatch:
true

configuredLocationMatch:
true

locationStatus:
ACTIVE

locationCountry:
JP

locationCurrency:
JPY

merchantMatch:
true

CREDIT_CARD_PROCESSING:
true

Square-Version:
2026-08-19

providerDispatched:
true

つまり、

Square Sandbox merchant/location identity acceptance自体は
技術的に完全PASSしている。

R7 S1はterminal。
絶対に再実行しない。

────────────────────
4. R7 security incident
────────────────────

R7では通常のVercel/Google login中に、
認証callbackに関する一時的な情報が
browser tool outputへ混入した。

そのためR7全体のacceptance decisionは:

FAIL_SECURITY_BOUNDARY

として保存されている。

これは変更しない。
security PASSへ書き換えない。

重要な事実:

Square access token exposure:
0

Square raw credential exposure:
0

credential value saved to Git:
false

cookie/token extraction:
0

browser auth-state export:
0

ただし、
operator tool outputに認証callback情報が一度出たため、

overall secret exposure = 0

とはR7について主張しない。

incident evidence:

docs/execution/p6/r7-evidence/security-observation.json

このincidentについて:

- callback値を探さない
- 再表示しない
- forensicしない
- rotationを自動実行しない
- R7履歴を書き換えない

今後のbrowser automationでは:

- login callback中のraw URLを取得しない
- callback中のpage title/accessibility dumpを出力しない
- login完了後にtarget originへ到達してから観測開始
- allowlisted metadataのみ出力

とする。

────────────────────
5. Ownerによる現在の判断
────────────────────

Ownerは以下を明示決定する。

R7全体:
FAIL_SECURITY_BOUNDARY
のまま保持。

ただしR7で取得済みのSquare provider evidence:

S1_PASS

はSquare identity acceptanceとして有効と採用する。

current interpretation:

S1 provider identity evidence:
OWNER_ACCEPTED_FROM_R7_PASS

operator security incident:
RECORDED_SEPARATELY

S1 rerun:
FORBIDDEN

S1 provider callを再実行してはならない。

────────────────────
6. 今回実行するR8
────────────────────

R8の目的は3つだけ。

1.
OwnerのS1 evidence adoptionをGitHubへ記録

2.
Preview-only non-secret merchant metadata:

SQUARE_SANDBOX_MERCHANT_ID

へ

MLKDVEDH1ME21

を登録

3.
S2 synthetic payment exactly1のOwner gateを完成させる

今回provider callは一切行わない。

────────────────────
7. R8 authorityを最初に記録
────────────────────

まず以下を作成:

docs/execution/PRODUCTION_P6_R8_AUTHORITY.md

内容はこのOwner判断を忠実に記録。

同時にcurrent stateを最小限更新:

AGENTS.md
CLAUDE.md
docs/execution/SCOPE.md
docs/execution/PRODUCTION_P6_STATUS.json

historical:

R4
R6
R7
r4-evidence
r6-evidence
r7-evidence

は変更禁止。

特にR7:

FAIL_SECURITY_BOUNDARY

を変更しない。

authorityをcommit:

docs(p6): adopt R7 S1 evidence and authorize R8 metadata gate

canonical branchへpushし、
remote readbackを確認。

その後は中間Owner承認なしで継続。

────────────────────
8. R8 external-action budget
────────────────────

今回:

Square GET:
0

Square POST:
0

S1:
0

CreatePayment:
0

GetPayment:
0

refund:
0

webhook:
0

deploy:
0

new Preview:
0

external DB:
0

R2:
0

email:
0

SMS:
0

S2 execution:
0

Claude:
0

Spark:
0

new PR:
0

main merge:
0

Runner:
0

Production Square:
0

────────────────────
9. Merchant metadata registration
────────────────────

Vercel project:

zao-rental

Preview environmentのみ。

以下のkeyを登録:

SQUARE_SANDBOX_MERCHANT_ID

value:

MLKDVEDH1ME21

これはSquare provider responseから既に取得・GitHubへsafe evidenceとして保存済みの
non-secret identifier。

Secretとして隠す必要はない。

ただしログへ無意味に大量表示しない。

target:
Preview only

Production:
0

既存:

SQUARE_SANDBOX_LOCATION_ID

は変更しない。

以下も変更禁止:

SQUARE_SANDBOX_ACCESS_TOKEN
SQUARE_SANDBOX_APPLICATION_ID
SQUARE_API_VERSION
SQUARE_ENVIRONMENT
その他env

merchant metadata登録後:

redeployしない。

新Previewを作らない。

metadata-only readbackで:

- key exists
- target includes Preview
- Production entryなし

を確認する。

通常Vercel loginが必要ならOwner loginのみ依頼してよい。

password/MFA以外の中間承認は不要。

────────────────────
10. S2 gateを完成
────────────────────

以下を作成:

docs/execution/PRODUCTION_P6_S2_GATE.md

これはS2を実行するauthorityではない。

次のOwnerが、
S2 synthetic payment exactly1を
一度の承認で開始できる状態まで仕様を完成させる。

記録するS1 evidence:

merchant ID:
MLKDVEDH1ME21

merchant:
ACTIVE / JP / JPY

location:
ACTIVE / JP / JPY

configured location:
verified

main location:
matched

merchant/location:
matched

CREDIT_CARD_PROCESSING:
true

Square-Version:
2026-08-19

R7 safe result:
S1_PASS

merchant metadata:
Preview registered

accepted R3 Preview:
retained

Production:
disabled

────────────────────
11. S2 proposed contract
────────────────────

S2はまだ実行しない。

gateには次回scopeとして以下を提案する。

Environment:
Square Sandbox only

synthetic payment:
exactly 1

currency:
JPY

merchant:
MLKDVEDH1ME21

location:
existing S1-verified location

real customer:
0

real card:
0

Production Square:
0

CreatePayment:
max 1

automatic retry:
0

manual retry:
0 unless future Owner authority explicitly defines recovery

idempotency:
existing approved idempotency contractを使用

response UNKNOWN時:

同じ結果をgreen化するための
新しいCreatePaymentを送らない。

provider payment IDが安全に取得済みの場合のみ、
future S2 authorityで明示された
approved lookup pathを使用可能。

provider payment ID不明なら:
STOP / UNKNOWN

勝手に再請求しない。

Web Payments tokenization:
実際に使うsource生成方法を
S2 authorityで明示する。

実カード:
禁止

Webhook:
S2では勝手にsubscription作成しない。

Refund:
S2では実行しない。

S2 success後も:
自動的にWebhook/refund/S3へ進まない。

────────────────────
12. security rules for S2 gate
────────────────────

R7 auth-output incidentを踏まえ、
gateへ以下を明記。

browser login中:

raw callback URL取得禁止
page title dump禁止
accessibility snapshot禁止
auth query/fragment保存禁止

Owner loginが必要な場合:

Ownerが通常UIでlogin
↓
target Preview/application pageへ到達
↓
callback/login画面を離脱
↓
その後にautomation observation開始

automation outputは
allowlisted metadataだけ。

Cookie/token/storage/auth headerを:
読まない
表示しない
保存しない
Gitへ入れない

Square token rotation:
行わない

Vercel/Google credential rotation:
新しい証拠なしでは行わない

────────────────────
13. R8 validation
────────────────────

product/runtime code変更は原則0。

docs + Vercel metadata registrationだけなら:

node scripts/check-secrets.mjs
JSON parse validation
git diff --check

のみでよい。

69 tests
full test
build

を理由なく繰り返さない。

時間/tokenを節約する。

ただし実際にproduct/runtime sourceへ変更が発生した場合は
その変更に必要なvalidationだけ追加する。

────────────────────
14. status normalization
────────────────────

PRODUCTION_P6_STATUS.json current stateは最終的に:

phase:
R8_S1_EVIDENCE_ADOPTED_S2_GATE_READY

S1 provider acceptance:
OWNER_ACCEPTED_FROM_R7_PASS

R7 security incident:
PRESERVED_SEPARATELY

merchant metadata:
REGISTERED_PREVIEW_ONLY

S1 rerun:
FORBIDDEN

new Square requests in R8:
0

deployment:
0

S2:
READY_FOR_OWNER_AUTHORITY
NOT_EXECUTED

と同等の意味になるよう整合。

historical R4/R6/R7内部のstateは書き換えない。

────────────────────
15. R8 final commit
────────────────────

R8結果を必要なら:

docs/execution/p6/R8_RESULT.md

または既存status/S2 gateに集約してよい。

不要なartifactを大量生成しない。

final commit例:

docs(p6): register merchant metadata and prepare S2 gate

push先:

origin/codex/external-acceptance-p6

push前にremote HEADが自分のauthority commitから
第三者に進んでいないことを確認。

force push禁止。

push後remote SHA readback。

working tree cleanまで確認。

────────────────────
16. 自律実行ルール
────────────────────

以下でOwnerへ逐次聞かない:

- docs構成
- metadata readback方法
- Vercel UI内の通常navigation
- evidence formatting
- status normalization
- commit構成
- push
- S2 gate設計
- validation選択

scope内のrecoverable issueは自分で処理する。

停止してOwnerへ依頼してよいのは:

A.
password / MFA / account login

B.
unexpected permission/billing expansion

C.
merchant metadata以外のenv変更が必要になる

D.
remote branchが別writerによって進み、
安全なreconcileが必要

E.
scope外の不可逆操作が必要

のみ。

────────────────────
17. 最終報告
────────────────────

R8完了時のみ報告。

必須:

Starting remote HEAD
Authority commit
Final HEAD
working tree clean

S1 evidence:
adopted yes

merchant:
MLKDVEDH1ME21

merchant metadata:
registered
Preview only

other env mutations:
0

R7 security incident:
preserved
not rewritten

new Square requests:
0

deploy:
0

payment:
0

refund:
0

webhook:
0

DB:
0

R2:
0

S2 execution:
0

S2 gate:
docs/execution/PRODUCTION_P6_S2_GATE.md

S2 readiness:
READY_FOR_OWNER_AUTHORITY

Owner next action:
S2 synthetic payment exactly1 authority approval

────────────────────
18. 最重要
────────────────────

これは「別Macでやった内容を再現する作業」ではない。

GitHubにはR7までの全成果が既にpush済み。

このMacでは:

R7を再実行しない。
Previewを再作成しない。
Square S1を再送しない。
69 testsを再現目的だけで回さない。

GitHub正本
fb237f7f1698a718c5430da130ddd3530816744d

から、その続きのR8だけを実行する。

端末変更を理由に予算・guard・authority・provider request countを
リセットしない。

このMacへの移行は作業場所の変更だけであり、
P6の履歴は連続している。

R8を最後まで自立実行して停止する。