【Owner Direct Amendment｜
AVATAR PHASE 6 — Controlled Vercel Bootstrap Exception】

私はOwnerとして、Phase6のVercel first-deployment deviationを評価し、
限定的な継続を承認する。

current canonical HEAD:
d6736dc68176b8d5a091575ae802d85d2a4867cc

historical fact:
- unintended Production deployment: 1
- unintended Production alias: 1
- both deleted and confirmed 404
- current Production target: none
- Production env: 0
- Hosted E2E: not run

この履歴を0へ書き換えてはならない。

━━━━━━━━━━━━━━━━━━
1. PASS CRITERION AMENDMENT
━━━━━━━━━━━━━━━━━━

旧条件:
Production deployment = 0 historically

は既に事実上達成不能なので廃止する。

代わりに最終必須条件を:
- current Production deployment = 0
- current Production alias = 0
- Production env secrets = 0
- Production DB access = 0
- Production R2 access = 0
- Production application E2E = 0
- real customer/payment = 0

とする。

historical Production countsは実数を保持。

━━━━━━━━━━━━━━━━━━
2. CONTROLLED BOOTSTRAP EXCEPTION
━━━━━━━━━━━━━━━━━━

Vercel first-deployment semanticsへの対応として、
exactly 1 additional controlled Production bootstrap deployment
を許可する。

これはPhase6アプリ本体ではなく、
無害なstatic placeholderだけにする。

禁止:
- Neon credential
- R2 credential
- guest signing key
- Preview sensitive env
- DB connection
- API route
- Server Function
- user/customer data
- Square/payment
- external fetch

内容は静的HTMLのみ。

Vercel Authentication:
ON

custom domain:
0

Production env:
0

━━━━━━━━━━━━━━━━━━
3. DEPLOYMENT BUDGET AMENDMENT
━━━━━━━━━━━━━━━━━━

historical attempt1:
unintended Production — consumed

new attempt2:
controlled Production bootstrap — authorized

new attempt3:
actual protected Preview — authorized

total deployment attempt max:
3

これ以上は追加承認なしに実行禁止。

━━━━━━━━━━━━━━━━━━
4. BOOTSTRAP SAFETY
━━━━━━━━━━━━━━━━━━

bootstrap作成後、削除せず一時保持する。

確認:
- target = production
- application secrets absent
- Production env count = 0
- Deployment Protection active
- no custom domain
- no real application runtime

Production aliasがproviderにより作成された場合も
実数を記録する。

履歴を隠さない。

━━━━━━━━━━━━━━━━━━
5. ACTUAL PREVIEW
━━━━━━━━━━━━━━━━━━

bootstrapが存在する状態でのみ
actual application Previewを1回作成する。

request intent:
preview

deployment後ただちにprovider readback:
target == preview

を確認。

targetがpreviewでなければ:
- appへアクセスしない
- Hosted E2Eしない
- exact deployment/aliasをcleanup
- STOP

blind retry:
0

━━━━━━━━━━━━━━━━━━
6. PREVIEW SUCCESS
━━━━━━━━━━━━━━━━━━

actual Previewが:
target = preview
Vercel Authentication ON
exact Phase6 project
Preview-only sensitive env
Square/payment/refund/webhook env 0

を満たした場合のみHosted E2Eへ進む。

390px / 1440px
actual Neon
actual private R2
cross-guest
logout
rights revoke
rate limit
physical ratio

を実施。

━━━━━━━━━━━━━━━━━━
7. BOOTSTRAP CLEANUP
━━━━━━━━━━━━━━━━━━

Preview acceptance後、
controlled Production bootstrapを削除。

bootstrap aliasesも削除。

final provider readback:
current Production deployment = 0
current Production alias = 0

を必須とする。

historical countsは削除しない。

━━━━━━━━━━━━━━━━━━
8. CLAUDE REVIEW
━━━━━━━━━━━━━━━━━━

Claudeへ以下を明示してreviewさせる:
- unintended Production deployment incident
- controlled bootstrap Production deployment
- actual historical deployment/alias counts
- no Production secrets/runtime/data
- final current Production state zero
- Preview acceptance
- cleanup correctness

歴史上のProduction操作を隠して
normal PASSと判定してはならない。

━━━━━━━━━━━━━━━━━━
9. FINAL CLASSIFICATION
━━━━━━━━━━━━━━━━━━

BLOCKER/HIGH/MEDIUM 0
かつHosted acceptance PASSなら:

PHASE6_PROTECTED_HOSTED_PREVIEW_PASS_WITH_CONTAINED_VERCEL_PRODUCTION_DEVIATION

とする。

通常の
PHASE6_PROTECTED_HOSTED_PREVIEW_PASS
とは呼ばない。

final reportには:
historicalProductionDeployments
historicalProductionAliases
currentProductionDeployments
currentProductionAliases

を別々に記録する。

━━━━━━━━━━━━━━━━━━
10. PHASE7
━━━━━━━━━━━━━━━━━━

Phase7へ自動継続禁止。
