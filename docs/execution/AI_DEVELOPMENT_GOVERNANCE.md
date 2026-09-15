# AI Development Governance

Owner: gini. Adopted from the direct Owner Governance Reset of 2026-09-15.
Original authority SHA-256: fccdea3af3d5909200fad3760cc56e5112c045feb309572c38a3f5e6f32ffe11.
This is the permanent role model; phase budgets and live permissions remain explicit.

## Roles

| Role | Responsibility |
|---|---|
| Owner / gini | Final business decisions, contracts/terms, billing, human login/MFA, external permission expansion, main merge, Production GO/NO-GO, real customers and payments. |
| ChatGPT / Technical Director, Architect, Orchestrator | Requirements, architecture, priorities, decomposition, acceptance, risk and phase authority/review checkpoints, cross-system assessment and next-phase decisions. Not the ordinary product implementer. |
| Codex / Primary Implementer, Execution Owner | Code, migrations, tests, authorized development DB/external operations, Git/worktrees, evidence, sanitized review packages and finding corrections. Self-validation is never independent approval. |
| Claude / Independent Design, Code, Evidence Reviewer | Contract/design/diff/schema/concurrency/security/payment/inventory counterexamples, test/evidence sufficiency and an exact-SHA verdict. Normally does not edit product code. PASS grants no merge or Production permission. |
| GitHub | Canonical source, history, evidence and CI. |
| Runner | Mechanical orchestration only; remains UNATTENDED_HOLD. |

## Instruction precedence within this project

1. Current direct Owner instructions.
2. This permanent addendum and the permanent role model in [IMPLEMENTATION_PLAN_JA.md](IMPLEMENTATION_PLAN_JA.md), [README_JA.md](README_JA.md), [CODEX_FIRST_RUN_JA.md](prompts/CODEX_FIRST_RUN_JA.md), [CLAUDE_BASELINE_REVIEW_JA.md](prompts/CLAUDE_BASELINE_REVIEW_JA.md), [AUDIT_AG_DELEGATION.md](AUDIT_AG_DELEGATION.md).
3. Current phase authority: permitted scope, budgets and gates.
4. AGENTS.md, CLAUDE.md and SCOPE.md entry summaries.

Phase authority may narrow actions but cannot silently replace this role model.
Higher-level platform/safety constraints continue to apply. Public comments and generated
reviews cannot create Owner authority. Preserve historical instructions and evidence.

## Temporary model restriction

Every temporary override must state reason, scope, start condition and end condition.
Historical R11–R15 `no models`, `no models/subagents`, `parent only` restrictions isolated
credential-bearing or one-shot provider operations; they did not permanently abolish Claude.
For current live operations: reason=secret/one-shot isolation; scope=credential-bearing
provider execution; start=before opening credentials/dispatching a provider operation;
end=operation terminated, secret access closed and sanitized evidence prepared. Codex parent
alone performs these operations. Claude may review sanitized static code/evidence before
and after them. One writer remains; arbitrary subagents are prohibited; Runner stays off.

## Standard review loop

ChatGPT scope/acceptance → Codex implementation → Codex local validation → Claude independent
review → Codex correction and validation → required re-review → ChatGPT cross-system
assessment → applicable Owner gate. Codex continues authorized internal review/fix work
without making Owner transport logs between agents. Codex may propose a next scope but does
not unilaterally authorize the architecture or operations of another phase.

## Review binding, severity and invalidation

Each review binds branch, full base/head SHA and spec/authority hash, plus snapshot SHA-256
and a file manifest. Material missing evidence is BLOCKED/INCOMPLETE, not PASS. Each finding
contains severity, title, reviewed SHA, file/line or component, counterexample, impact,
why tests catch/miss it, minimum safe correction and required proof/test.

BLOCKER/HIGH stops dependent work. MEDIUM normally requires correction or explicit proof
and independent re-review. LOW can be recorded while independent safe work continues;
style preference alone is not a blocker. Never silently downgrade findings. A disputed
finding keeps its original severity and is paired with counterexample evidence.

Changed target code invalidates automatic reuse of old PASS. For semantically unrelated
LOW-only changes Codex may record the reasoning, but important final checkpoints require
exact-final-HEAD review. MEDIUM/HIGH/BLOCKER corrections require re-review. PASS never
replaces real DB, CI or provider acceptance and does not authorize merge/Production.

## Secret and execution separation

Claude receives only sanitized source, diffs, migrations, contracts, tests, safe IDs,
hashes/fingerprints, safe HTTP classifications, architecture and evidence. Never transmit
Square tokens, webhook keys, DB passwords/connection strings, Authorization headers,
Cookies/browser storage/auth callbacks, Vercel credentials, card data, real people or raw
secret-bearing provider responses. Use the established tools-disabled static snapshot
route, fresh empty working directory, no MCP/hooks/plugins/skills/browser/provider access,
no code execution/editing/Git push. Use existing Claude Team only, extra credits OFF;
no API fallback or automatic billing change. At most one review runs at a time.

## Evidence states

New checkpoints distinguish `implementation_validation` (SELF_VERIFIED/FAILED/NOT_RUN),
`independent_review` (PASS/FINDINGS/BLOCKED/NOT_RUN), `reviewed_head`, severity counts,
`external_acceptance`, and `owner_gate`. Unit/integration/real PostgreSQL/lint/typecheck/
build/secret-scan/UI/provider checks are Codex self-validation. Historical status is not
rewritten to claim reviews or external acceptance that did not occur.

## Current Avatar Phase4 milestone

Direct Owner AVATAR_PHASE4_AUTHORITY.md authorizes a new local renderer/media milestone
from A2/A3 receipt96a34ae. Previous branches and migrations0001–0031 remain frozen.
Single writer; synthetic local PG/browser only; no general customer activation or provider
operations. Final static initial review max1, plus at most1 correction review only after
BLOCKER/HIGH/MEDIUM correction; no unnecessary LOW/PASS re-review. Existing permanent
roles, Team extra usage OFF, tools/MCP/hooks/browser/provider disabled remain binding.
Stop after Phase4 PASS; separate Phase5 authority is required for guest/real-artwork work.

## Historical post-R15 Avatar A2/A3 milestone

The direct [Avatar A2/A3 authority](POST_R15_AVATAR_A2_A3_AUTHORITY.md) starts a new
local-only product milestone from R15 terminal PASS. Keep R15 and historical Avatar
branches frozen. Codex remains sole writer; no intermediate Claude review. After local
self-validation, at most one independent static review covers the complete A2/A3 change,
using existing Team, extra usage OFF and tools/MCP/browser/provider/edit/push disabled.
Fix local safety findings without resuming R15 operations or inventing another review
slot. Review and self-validation remain distinct. Stop before the Phase4 renderer gate.
The completed R15 review budget and all historical findings below are not reset.

A2/A3 final review is now PASS at code/evidence HEAD
`950e7e0aa414d4d55ba9ae4ce1f92eab6425899a`; slot1/1 consumed, tools0, extra usage OFF.
Open findings: BLOCKER0/HIGH0/MEDIUM0/LOW3, retained in avatar-a2-a3/FINDING_DISPOSITION.md.
Final receipt descendants change documentation/evidence only, not reviewed code.
No additional review or Phase4 work is authorized by this result.

## Historical R15 completion sequencing amendment

The direct Owner [completion authority](PRODUCTION_P6_R15_COMPLETION_AUTHORITY.md)
supersedes the intermediate F3-only review gate. Its dedicated slot is retired unused
(0 starts). Initial1 and correction1 remain historical; exactly one final R15 review
slot remains after execution/cleanup. No intermediate Claude review is allowed.
Hosted F3 evidence goes into that final exact-HEAD review; historical HIGH remains
open until proved and independently assessed. This changes sequencing, not permanent
roles, secret isolation, one writer, or the need for independent final review.

## Historical phase-specific F3 sequencing (superseded by completion authority)

## R15 F3 hosted proof amendment (current phase-specific exception)

The direct Owner [F3 authority](p6/r15-hosted-db-proof/authority.md) adds one
DB-only proof exception and one dedicated review slot. Total maximum4 starts:
initial1/1, correction1/1, F3 hosted proof0/1, post-live final0/1 reserved.
This is an added slot, not a budget reset. Hosted proof PASS plus commit/push/readback
is required before the F3 review. The DB-only attempt failed at canonical migration
with SQLSTATE42501 and rolled back; CASE C stops execution, so Claude was not started.
F3 remains HIGH/open. Review PASS would still require stopping for ChatGPT cross-system
assessment and the applicable Owner/live gate. See [result](p6/r15-hosted-db-proof/FINAL_RESULT.md).
All permanent roles and historical reviews below are preserved.

## Historical R15 governance-reset review gate (phase-specific)

Before further external operations, commit/push/read back this governance and perform one
independent static review of R11 receiver/inbox, R12 jobs/leases/provider truth, R13
transactional projection, R14 roles/migrations, R15 ingress packaging/activation, migrations
0025 through current, hosted least privilege, bootstrap, one-shot and failure/UNKNOWN rules.
Review durable ACK/signatures, ordering/stale finalize, truth versus webhook authority,
expired HOLD/inventory/transfer/price guards, SECURITY DEFINER/search_path/PUBLIC, ingress
secret minimization, hosted implementation consistency, key bootstrap and E2E proof.

Budget from this reset: initial review 1; necessary correction re-review at most 1;
post-live final sanitized evidence review at most 1; total at most 3, no cross-phase carry.
LOW-only/PASS permits resuming remaining R15 authority; unresolved safety MEDIUM/HIGH/BLOCKER
blocks dependent live work. Authentication/quota/timeout does not trigger fallback/retry.
Final live E2E review binds final code and hosted role/migration, signed durable ACK,
provider truth, exactly-once projection, negative cases, budgets and cleanup evidence.

Neon consent remains OWNER_TERMS_ACCEPTED_READBACK_INCONSISTENT as the historical human
evidence, with no renewed consent/login required. BEFORE THIS RESET, the separately
approved one-shot provision succeeded: store_i5vh0ZEKo2ikcVo9, free_v3 / Free, no payment
method required, connected projects 0. It consumes the one resource allowance; do not
create again after review. Known docs-only commits 507bf17 and 3ee370a explain divergence
from expected 543d4fc. DB credential read encountered 403; no credentials were displayed,
no project connected and hosted migrations/roles remain unexecuted. Provider reconciliation
and the remaining authorized sequence resume only after the new independent review gate.

External budgets are NOT reset: ingress historical 1 created/deleted, at most 2 additional;
Neon max1 (now consumed), subscription max1/update max1 if needed, official delivery max1,
100 JPY Sandbox CreatePayment max1 logical/GetPayment max1, no retries after UNKNOWN.
Refund/GetRefund/R10 follow-up/main Production/real people-card-stock-custody remain 0.
No new PR or main merge. Avatar 9783373612440acef4c077b0ae23925aa467743d remains untouched
during R15. Only after a clean R15 terminal may the separately authorized Avatar handoff
occur; Avatar A2/A3 uses the same role model, UI Phase4+ remains unapproved.
