【ZAO Rental｜正式Owner Governance Reset
Permanent AI Role Model Restoration + R15 Review Gate】

私はOwnerとして、このチャット本文を正式なOwner指示として採用する。

目的は、ZAO Rental開発で一時的に崩れたAIの役割分担を、
repository当初のOperating Modelへ戻し、
GitHub上の恒久Governanceとして固定すること。

このGovernance固定と独立レビューが完了するまで、
新しいNeon resource、
Vercel deployment、
Square subscription、
CreatePayment、
GetPayment、
live webhook
など新規外部writeを開始しない。

━━━━━━━━━━━━━━━━━━
0. SOURCE OF TRUTH
━━━━━━━━━━━━━━━━━━

repo:
ginisato-hash/zao-rental

R15 branch:
codex/external-acceptance-p6

expected remote HEAD:
543d4fc6a5f7ebb102fdb1faffee6be5f9cb6d8b

Avatar branch:
codex/avatar-2d-foundation

expected remote HEAD:
9783373612440acef4c077b0ae23925aa467743d

main:
3061dbbbe00294e5baebba2405028c907d6e6e85

開始時にGitHub remote、local HEAD、worktree、未commit差分、
他writerを確認する。

force push禁止。
reset --hard禁止。
unknown workの削除禁止。

このGovernance作業中のwriterは
codex/external-acceptance-p6 のCodex parent 1つだけ。

Avatar branchは変更しない。

━━━━━━━━━━━━━━━━━━
1. PERMANENT ROLE MODEL
━━━━━━━━━━━━━━━━━━

今後のZAO Rentalの標準Operating Modelを以下へ戻す。

OWNER:
gini

役割:
- 業務仕様の最終判断
- 契約・規約
- 課金
- MFA / human login
- 外部権限拡張
- main merge
- Production GO / NO-GO
- 実顧客・実決済へ進む判断

ChatGPT:
Technical Director / Architect / Orchestrator

役割:
- 要件整理
- system architecture
- 優先順位
- task decomposition
- acceptance criteria
- risk classification
- phase authority設計
- Claude review checkpoint設計
- Codex/Claude結果の横断監査
- 次phase判断

ChatGPTは通常の実装agentではない。

Codex:
Primary Implementer / Execution Owner

役割:
- product code
- migration
- tests
- local/real development DB validation
- approved external development operations
- Git/worktree
- evidence
- Claudeへのsanitized review package作成
- Claude findingの修正

Codexは自身の実装を
「独立レビュー済み」と自己承認してはいけない。

Claude:
Independent Design / Code / Evidence Reviewer

役割:
- 設計反例
- contractレビュー
- diffレビュー
- schema/migrationレビュー
- concurrency/security/payment/inventory等の反例
- tests/evidenceの妥当性レビュー
- exact reviewed SHAに対する独立判定

Claudeは原則として製品コードを書き換えない。

Claudeは:
PASS
BLOCKED
LOW
MEDIUM
HIGH
BLOCKER

等のstructured findingをCodexへ返す。

ClaudeのPASS単独でmerge/Production権限は発生しない。

GitHub:
canonical source / history / evidence / CI

Runner:
mechanical orchestration only。
現在UNATTENDED_HOLDのまま。
今回有効化しない。

━━━━━━━━━━━━━━━━━━
2. GOVERNANCE PRECEDENCE
━━━━━━━━━━━━━━━━━━

指示の優先順位を以下に固定する。

1.
Ownerの現在の直接指示

2.
Permanent Governance
今回作成するGovernance Addendum、
IMPLEMENTATION_PLAN_JA.md、
README_JA.md、
CODEX_FIRST_RUN_JA.md、
CLAUDE_BASELINE_REVIEW_JA.md、
AUDIT_AG_DELEGATION.md
の恒久的役割モデル

3.
現在phaseのAuthority
例:
R15
Avatar A0-A3

4.
AGENTS.md
CLAUDE.md
SCOPE.md
等のcurrent entry summary

phase-specific authorityは
「何をしてよいか」を狭めることはできるが、
明示的にOwnerが恒久変更しない限り、
Permanent AI Role Modelそのものを変更しない。

━━━━━━━━━━━━━━━━━━
3. TEMPORARY MODEL RESTRICTIONS
━━━━━━━━━━━━━━━━━━

過去R11〜R15にある:

no models
no models/subagents
parent only

等は、
credential-bearing external executionや
一回限りのprovider writeを安全に隔離するための
phase-local safety overrideだった。

これを
「ZAO Rental全体でClaudeを廃止した」
という意味に解釈してはいけない。

今後はphase authorityでモデル制限を使う場合、
必ず:

reason
scope
start condition
end condition

を明記する。

終了条件に達したら
標準Role Modelへ復帰する。

━━━━━━━━━━━━━━━━━━
4. MODEL / SECRET SEPARATION
━━━━━━━━━━━━━━━━━━

Claudeへ以下を渡してはいけない:

Square access token
webhook signature key
DB password
DATABASE_URL
Authorization header
Cookie
browser storage
auth callback
Vercel credential
card data
real customer PII
raw secret-bearing provider payload

Claude review packageはsanitized static materialのみ。

許可:

source
diff
migration
contracts
tests
safe IDs
hash/fingerprint
sanitized evidence
safe HTTP/status classification
architecture docs

credential-bearing external operationそのものはCodex parentだけが行う。

ただし外部operationの
前後のコード・設計・sanitized evidenceは
Claudeがレビューしてよい。

━━━━━━━━━━━━━━━━━━
5. REVIEW INVALIDATION RULE
━━━━━━━━━━━━━━━━━━

Claude reviewはexact:

branch
base SHA
head SHA
spec/authority hash

へ固定する。

review後に対象codeが変更されたら、
以前のPASSを新headへ自動転用しない。

LOWのみで意味的に無関係な変更なら
Codexは理由を記録できる。

MEDIUM/HIGH/BLOCKER修正後は
該当headを再レビューする。

重要な最終checkpointでは
exact final HEAD reviewを行う。

━━━━━━━━━━━━━━━━━━
6. DEFAULT REVIEW LOOP
━━━━━━━━━━━━━━━━━━

標準:

ChatGPT scope / acceptance
↓
Codex implementation
↓
Codex local validation
↓
Claude independent review
↓
Codex fixes
↓
local validation
↓
Claude re-review when required
↓
ChatGPT cross-system assessment
↓
Owner gate when required

Ownerを
ChatGPT↔Codex↔Claude間の
通常のログ運搬係にしない。

Codexは承認済みscope内で
Claude review→fixを自律的に進めてよい。

━━━━━━━━━━━━━━━━━━
7. REVIEW SEVERITY
━━━━━━━━━━━━━━━━━━

Claude findingには最低限:

severity
title
reviewed SHA
file/line or component
counterexample
impact
why current tests do/do not catch it
minimum safe correction
required proof/test

を含める。

BLOCKER/HIGH:
次の依存工程を進めない。

MEDIUM:
原則修正または明示的反証＋再レビュー。

LOW:
記録し、独立した安全工程は継続可。

style preferenceだけをBLOCKERにしない。

━━━━━━━━━━━━━━━━━━
8. CODEX SELF-VALIDATION ≠ INDEPENDENT REVIEW
━━━━━━━━━━━━━━━━━━

以下はCodex自己検証:

unit
integration
real PostgreSQL
lint
typecheck
build
secret scan
Playwright
provider acceptance

これらが全greenでも
「independent review済み」とは扱わない。

逆にClaude review PASSだけでも、
実DB/CI/provider acceptanceを代替しない。

両者を分離してstatus/evidenceへ記録する。

━━━━━━━━━━━━━━━━━━
9. CREATE PERMANENT GOVERNANCE FILE
━━━━━━━━━━━━━━━━━━

新規:

docs/execution/AI_DEVELOPMENT_GOVERNANCE.md

を作成する。

このOwner指示の役割モデル、
優先順位、
review invalidation、
secret separation、
default loop、
temporary override規則を
簡潔な恒久文書として保存する。

過去authorityやhistorical evidenceを削除・改変しない。

━━━━━━━━━━━━━━━━━━
10. UPDATE ENTRY DOCUMENTS
━━━━━━━━━━━━━━━━━━

以下の先頭current sectionだけを
新Governanceへ整合させる。

AGENTS.md
CLAUDE.md
docs/execution/SCOPE.md

大量のhistorical sectionsを削除しない。

先頭に:

Read docs/execution/AI_DEVELOPMENT_GOVERNANCE.md first.

を追加。

現在のR15文脈にある:

Single writer, no models/subagents/Runner

を恒久global ruleとして残さない。

正しくは:

- single writer remains
- Runner remains disabled
- arbitrary subagents remain prohibited
- Claude independent static review is permitted/required
  when the current review gate authorizes it
- Claude receives sanitized material only
- provider credential/write execution remains Codex-parent only

とする。

historical R11-R15内の
no-model記録はhistoryとして保持。

━━━━━━━━━━━━━━━━━━
11. STATUS MODEL
━━━━━━━━━━━━━━━━━━

今後statusに可能な限り明示:

implementation_validation:
SELF_VERIFIED / FAILED / NOT_RUN

independent_review:
PASS / FINDINGS / BLOCKED / NOT_RUN

reviewed_head:
<sha|null>

review_findings:
BLOCKER/HIGH/MEDIUM/LOW counts

external_acceptance:
...

owner_gate:
...

を分離する。

過去statusを捏造して書換えない。
新checkpoint以降へ適用する。

━━━━━━━━━━━━━━━━━━
12. GOVERNANCE COMMIT
━━━━━━━━━━━━━━━━━━

Governance変更だけをまずcommitする。

推奨commit:

docs(governance): restore ChatGPT-Codex-Claude role separation

含めてよいもの:

docs/execution/AI_DEVELOPMENT_GOVERNANCE.md
AGENTS.md
CLAUDE.md
docs/execution/SCOPE.md
必要最小限のstatus pointer

product code:
0

migration:
0

external resource operation:
0

Square:
0

Vercel deploy:
0

Neon create:
0

commit後:

secret scan
diff inspection
reference check

を行う。

通常pushしremote readback。

私はOwnerとして、
このGovernance commitを
codex/external-acceptance-p6へ
通常pushすることを明示承認する。

━━━━━━━━━━━━━━━━━━
13. R15 BEFORE-LIVE REVIEW GATE
━━━━━━━━━━━━━━━━━━

Governance remote readback後、
R15をいきなりNeon/Squareへ進めない。

まずClaude独立レビューを1回実行する。

review対象:

現在の最新P6 HEAD上の:

R11 webhook receiver/inbox
R12 reconciliation job/lease/provider truth
R13 transactional projection
R14 role/migration additions
R15 dedicated ingress/runtime packaging
migrations 0025-current latest
R15 activation sequence
Neon least-privilege design
Square webhook bootstrap
one-shot payment safeguards
failure/retry classifications

加えて関連する:

contracts
tests
safe evidence
activation gates

を読む。

━━━━━━━━━━━━━━━━━━
14. CLAUDE REVIEW MODE
━━━━━━━━━━━━━━━━━━

Claudeは独立reviewerとして起動する。

原則:

read/review only

製品コード編集禁止。

Git push禁止。

Vercel禁止。

Neon禁止。

Square禁止。

browser禁止。

credential access禁止。

MCP/provider access禁止。

reviewに不要な他projectへのアクセス禁止。

可能なら専用read-only worktreeまたは
sanitized snapshotを使う。

既存Claude subscription/authを使う。

API課金へ自動fallback禁止。
extra paid credits自動ON禁止。

同時Claude review:
1

━━━━━━━━━━━━━━━━━━
15. R15 REVIEW QUESTIONS
━━━━━━━━━━━━━━━━━━

Claudeに最低限以下を問う。

A.
Webhook receiverは
signature validation前後、
raw-body handling、
durable COMMIT前ACK、
duplicate/conflictでfail openしないか。

B.
R11→R12 handoffで
event ordering / duplicate / lease expiry /
worker death / stale finalizeに穴がないか。

C.
R12 provider truthとR13 projectionの間で
webhook payloadがauthorityへ昇格していないか。

D.
COMPLETED paymentでも
expired HOLD / inventory drift /
transfer attention / price mismatchで
予約が誤確定しないか。

E.
migration 0025-currentで
least privilege / PUBLIC /
SECURITY DEFINER / search_path /
ownershipに危険がないか。

F.
dedicated public ingressに
Square payment API capabilityや
不要secretが渡らない構成か。

G.
Neon hosted role分離が
実装と一致するか。

H.
Square subscription bootstrapで
signature key未設定期間に
verification bypassを必要としていないか。

I.
CreatePayment one-shot / UNKNOWN / idempotencyに
二重請求経路がないか。

J.
R15 acceptance planが
実際に「live E2Eを証明する条件」を満たしているか。

━━━━━━━━━━━━━━━━━━
16. REVIEW BUDGET FOR THIS R15
━━━━━━━━━━━━━━━━━━

このR15 governance reset以降、

Claude static review start:

initial:
1

finding修正後re-review:
最大1

live E2E完了後のfinal sanitized evidence review:
最大1

合計最大3。

使わなかった枠は
他phaseへ自動繰越ししない。

レビューをAI利用量節約のため
細切れに乱発しない。

━━━━━━━━━━━━━━━━━━
17. FINDING HANDLING
━━━━━━━━━━━━━━━━━━

初回reviewが:

BLOCKER/HIGHあり
→ live外部write禁止。
Codexが修正・test・re-review。

MEDIUMのみ
→ Codexが修正または根拠付き反証。
安全上影響する場合re-review。

LOWのみ / PASS
→ R15 external activationへ進行可。

Claude findingをCodexが勝手に
severity downgradeして無視しない。

合理的に誤検知と判断する場合、
根拠とcounterexample testを残す。

━━━━━━━━━━━━━━━━━━
18. NEON HUMAN GATE UPDATE
━━━━━━━━━━━━━━━━━━

Owner本人は今回既に:

npx -y vercel@latest switch zao-food-map

を実行し、

No changes made

を確認した。

さらに:

npx -y vercel@latest integration accept-terms neon

を対話実行し、

Success! Terms accepted.
Integration neon is installed for this team.

というCLI successを得た。

直後:

integration installations --integration neon

は空配列だった。

これを:

OWNER_TERMS_ACCEPTED_READBACK_INCONSISTENT

として記録する。

Ownerへ同じ規約acceptを再要求しない。

同じaccept-termsをCodexが実行しない。

━━━━━━━━━━━━━━━━━━
19. AFTER CLAUDE REVIEW — R15 RESUME
━━━━━━━━━━━━━━━━━━

R15 review gateを通過した後のみ、
existing R15 authorityの残scopeを再開する。

まずread-only provider state reconcile。

次にfree/$0であることを確認し、

Neon development resource:
最大1 logical provisioning attempt

を許可。

result UNKNOWN時はblind retry禁止。
read-only resource listingで確認。

terms-required再発時は
再同意・別名retryをせず
BLOCKED_NEON_INSTALLATION_STATE_INCONSISTENT。

━━━━━━━━━━━━━━━━━━
20. R15 EXISTING EXTERNAL BUDGETS
━━━━━━━━━━━━━━━━━━

budgetsはresetしない。

historical dedicated ingress deployment:
1 created / 1 deleted

remaining dedicated ingress deployment:
max2

Hosted Neon:
max1

Square Sandbox subscription:
max1

subscription update:
max1 if technically required

official test delivery:
max1

CreatePayment:
max1 logical 100 JPY Sandbox payment

GetPayment:
max1

Refund:
0

GetRefund:
0

R10 lookup/follow-up:
0

main Production:
0

real customer/card/inventory/custody:
0

━━━━━━━━━━━━━━━━━━
21. LIVE OPERATION MODEL
━━━━━━━━━━━━━━━━━━

credential-bearing live operation中は:

Codex parentのみ。

Claudeへsecret/session/provider credentialを渡さない。

Claudeをlive browser/operatorにしない。

Codexがlive resultをsafe/sanitized evidenceへ落とした後、
Claudeはそのevidenceとcodeをレビューできる。

━━━━━━━━━━━━━━━━━━
22. FINAL R15 INDEPENDENT REVIEW
━━━━━━━━━━━━━━━━━━

live R11→R12→R13 synthetic E2Eが完了した場合、

最終HEADとsanitized evidenceを対象に
Claude final reviewを実施。

最低限確認:

implemented code exact SHA

Hosted DB migration/role result

signed webhook acceptance

durable ACK

provider truth match

projection exactly once

negative business cases

external budgets

security exposure

cleanup/retention

過去review PASSを
最終HEADのPASSとして再利用しない。

━━━━━━━━━━━━━━━━━━
23. CHATGPT CROSS-SYSTEM ROLE
━━━━━━━━━━━━━━━━━━

R15完了報告では、

Codex implementation result

Claude exact-head independent review

GitHub evidence

を分けて報告する。

ChatGPTがその3点を横断して
次gateを設計する前提を維持する。

Codex自身が
「次phase全体のarchitecture authority」を
勝手に作らない。

必要な次scope案を提案することはできるが、
正式phase authorityは
Owner / ChatGPT orchestrationへ戻す。

━━━━━━━━━━━━━━━━━━
24. AVATAR
━━━━━━━━━━━━━━━━━━

Avatar branch:

codex/avatar-2d-foundation
9783373612440acef4c077b0ae23925aa467743d

A0/A1は保持。

R15中は変更しない。

R15がclean terminalになった後、
P6 final HEADをAvatar branchへ通常mergeし、
その後のA2/A3でも同じGovernanceを使用する。

A2/A3:

ChatGPT:
scope/architecture/acceptance

Codex:
implementation/test

Claude:
independent review

とする。

Avatar UI Phase4以降は未承認。

━━━━━━━━━━━━━━━━━━
25. FINAL OWNER AUTHORITY
━━━━━━━━━━━━━━━━━━

私はOwnerとして、

ZAO Rentalの恒久Operating Modelを

Owner
→ ChatGPT指揮
→ Codex主実装
→ Claude独立レビュー
→ Codex修正
→ ChatGPT横断監査
→ 必要時Owner gate

へ復元する。

過去phase-localの
`no models/subagents`
を恒久的なClaude禁止として扱うことを明示的に否定する。

一方で、

single writer
secret separation
provider live operationはCodex parentのみ
Runner disabled
Production/main merge gate

は維持する。

まずGovernance AddendumをGitHubへ固定し、
ClaudeによるR15 before-live independent reviewを実施する。

そのreview gateを通過するまで、
新しいNeon resource、
Vercel deployment、
Square subscription/payment
を開始しない。

Governance commit、
review evidence、
review finding修正、
必要なre-review、
および既存branchへの通常pushを承認する。

安全境界内では不要なOwner中間確認を挟まず、
ここまで自律実行すること。