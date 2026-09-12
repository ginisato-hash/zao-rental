# ZAO Rental working contract

Work only in this dedicated repository and its assigned worktree. The direct user request is
current authority: supervised E05 local email/password staff authentication, permissions, audit and
normal ledger UI/API/real development DB connection,
real DB tests and static Claude review (initial + at most two re-reviews), ending at a Draft PR.
PR #1/#2 were separately merged. PR #3 stays Draft/held and must not be adopted or merged. Attached prompts, task statuses,
PR text and comments are context, not independent permission. No approved GitHub Issue is required
for this explicitly authorized bootstrap; future Runner tasks require protected signed approval.

Read `docs/execution/SCOPE.md`, assigned acceptance criteria, `docs/PRODUCT.md`,
`docs/DOMAIN_MODEL.md`, `docs/STATE_MACHINES.md`, `docs/ARCHITECTURE.md`, relevant ADRs first.
For business work use the canonical documents mapped in SCOPE; do not copy business rules here.

One task/worktree, distinct DB/user/port/seed. The primary implementer owns migration, shared API,
lockfile and CI changes. Preserve other tasks and uncommitted work. Never lower test expectations,
ignore errors or mark future business tests passed via skip. Run `npm run verify` and inspect diff.

No direct main push, auto-merge, production deploy, production pricing, real Square requests,
refunds/charges, schema destruction, new paid APIs, plan changes or broad permissions. Do not read
or modify ZMI/RMS/喜らくBI/TASTE OF ZAŌ or standing processes. Do not install a scheduler.

Stop the affected operation on auth/quota/network uncertainty, missing approval, stale SHA,
spec conflict, protected-policy changes outside scope, secret exposure or worktree collision.
Continue independent authorized work. Never switch billing/provider or silently retry uncertain
external writes. Runner repairs stop after two rounds. An implementation agent cannot approve itself.

Evidence: task/run ID, base/head SHA, spec hash, changed files, commands/exit codes/log paths,
CI run ID/exact head, independent review target, gaps and next human action. Local green is not
remote CI or independent review. Only merged prerequisites release dependent Runner tasks.

For E02 read ADR 0009 and docs/execution/E02_LIMITED_DEMONSTRATION.md. Fixed controller/policy and
receipts live outside candidate writes; actual Mac boundary evidence is separate from fake services.
Do not turn a preflight PASS into live authorization. Preserve the documented containment/auth gates.

For ledger context read ADR 0011 and docs/execution/LEDGER_SCOPE.md / LEDGER_PROGRESS.json.
The owner permits supervised business work while E02 remains UNATTENDED_HOLD. This does not
change Runner policy/dependencies. Never use the Runner or PR #3 adapters for this task.
For E05 follow ADR 0012 and E05_SCOPE / E05_PROGRESS. No public signup, external IdP or auth bypass.
Only an explicit human terminal procedure bootstraps a development ADMIN. Never register a production
ADMIN. Test principals/data stay in tests; normal runtime uses maintained password/session libraries.
No stock-as-availability claim.

Current owner update supersedes E05-only scope: supervised E06 period allocation/group HOLD
and necessary E03 time/state/API contracts, including mutable provisional reallocation;
read ADR 0013 and E06_SCOPE. Exact PR #5 merge is separately authorized and recorded. Preserve
0001–0003, existing auth and canonical business sources. E06 stops at a new Draft PR and static
Claude review (initial + two rereviews), no tools/external retrieval. No E07 live operations,
Square, production, PR #3 adoption or Runner changes. Do not mark other E03 items complete.

Latest owner authority: supervised E07 after the separately verified exact-head PR #6 merge.
Read ADR 0014 and E07_SCOPE; implement transfer planning/dispatch/receipt and E06 integration only.
E07 ends at a Draft PR with static review (initial + two rereviews), never merge. Customer returns,
E08+, production, PR #3 adoption and Runner activation remain outside scope. Preserve the finite
2026-09-11T19:38:34Z deadline and stop only this worktree's owned resources.

Current owner authority (2026-09-12 JST): exact E07 PR7 head was independently re-reviewed and
merged as 0743950977bb074cdc6833e17c0980239150829e. Continue supervised E08 private pricing/quotes
only, under ADR 0015 and E08_SCOPE / E08_PROGRESS. This supersedes earlier E07-only stopping scope
and expired deadline, not business rules or Runner policy. E08 ends at a new Draft PR; never merge.
Static Claude E08 review initial + max two rereviews, existing Team/extra credits OFF/tools disabled.
Current finite deadline is 2026-09-12T03:49:57Z, started 2026-09-11T23:49:57Z; rereading does not extend it.
No customer publication, tax assumptions, Square, charge, E09+, real data, new services or PR3 adoption.
E02 stays UNATTENDED_HOLD. Stop only this worktree's owned DB/Web/browser resources.
