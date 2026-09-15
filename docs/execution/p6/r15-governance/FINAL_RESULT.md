# R15 Governance Reset — terminal PARTIAL / CHANGES_REQUIRED

## Permanent governance and independent review

Governance commit902622767cb255685d80ea34da90bb21fc5fce73 was pushed/read back first.
Current permanent roles: Owner final authority; ChatGPT director/architect/orchestrator;
Codex implementation/execution; Claude independent static review; GitHub canonical evidence;
Runner UNATTENDED_HOLD. Main3061dbbbe00294e5baebba2405028c907d6e6e85 and
Avatar9783373612440acef4c077b0ae23925aa467743d unchanged. No new PR/merge.

- Initial review: head902622767cb255685d80ea34da90bb21fc5fce73, CHANGES_REQUIRED HIGH3/LOW1.
- Correction: headb541999163ff129cc588960a2c5bf94da61d0cd9, CHANGES_REQUIRED.
  [Original](review-02/review.json), [manifest](review-02/manifest.json),
  [execution/capability/usage](review-02/execution.json).
  SnapshotSHA256=a1d9e4f82cedb4f96dec16f14c235820c1bd5c684a517a6cfbaa33f0c7824917.
  68files /469370bytes; secret scan0. Tools only StructuredOutput, no MCP/hooks/plugins,
  existing Team, isUsingOverage=false, no API credential fallback. No reviewer test execution.
- Starts2 of3. Initial and correction used; remaining1 is ONLY final post-live evidence.
  No further pre-live model launch, no budget carry/reset.

F1 demonstrated GetPayment restart gap and F2 key handoff implementation were independently
accepted for their demonstrated scope. Original F1 Create-vs-Get mistake is retained with
counterevidence. F3 remains OPEN HIGH: actual Neon privilege/migration proof is missing,
and its required writes conflict with the current before-live no-write review gate.
F4 broad build dependency surface remains LOW. NEW1 manifest-source hash verification
before live wiring is LOW and remains a prerequisite. Overall unresolved: HIGH1 / LOW2,
not system-wide findings0 and not R15_PASS.

## Important correction to validation evidence after the review

During terminal evidence cross-check, the b541999 packet's existing31-R14/R15-test success
claim was found incorrect. r14-postgres.ts retained a count29 assertion after additive0030.
The test logged FAIL, but embedded-postgres's async-exit-hook registers beforeExit with
exitcode0 and overrode process.exitCode=1. The outer harness mistakenly accepted exit0;
old additional/boundary JSONs were stale. The originally transmitted files, review and
hash are preserved. Do not cite that packet as proof31 tests passed at b541999.

Corrected only finite local test drivers to exit1 explicitly AFTER owned pool/cluster
cleanup, and expected count to30. Same failing count reproduced: previous exit0, fixed
harness exit1, then corrected count gives31 actual successful local checks. Evidence is
[post-review-validation](post-review-validation/), not silently substituted into the
reviewed snapshot. Guard's seven new real-PG tests and523 unit/fixture tests were genuinely
passing before review; guard's seven cases were rerun after driver correction and pass.
Migration0001–0029 remain byte-identical,0030 additive. No product library change after
review b541999; this test-driver/expectation correction and new evidence are **NOT independently
re-reviewed**. Old PASS is not assigned to the final evidence commit. Remote CI NOT_RUN.

Final local validation:523 unit/fixture tests on unchanged product;31 R14/R15 +7 guard
real LOCAL PostgreSQL cases; foundation integration and21 ledger cases; lint/typecheck,
main+ingress builds, secret scan, original32 reference files. Zero skipped future features.
Main/ingress builds precede the test-only final correction. Generated runtime.cjs from our
build was hash-verified then removed during cleanup (source lint otherwise scans the
third-party generated bundle); no source/config rule was relaxed.

The re-review also says CREATE_PAYMENT has zero test coverage. This absolute statement
is contradicted at the reviewed head by r15-guard-postgres.ts:16,26–28 (actual local PG
CREATE reservation concurrency/response loss) and r15-operation-guard.test.ts:5–10
(CREATE BEGIN/reserve/COMMIT barriers). Full CREATE cross-process/commit-loss parity and
real provider wiring remain unperformed; GET has those real process checks. This factual
correction does not reject F3, NEW1 or claim real CreatePayment success. No extra review ran.

## Stop boundary and the next human/architecture decision

Do not repeat Neon terms, login, Team switching, resource create or credential probes.
One Free resource store_i5vh0ZEKo2ikcVo9 exists from BEFORE this reset; it consumes max1.
No new external operation after Governance reset: hosted migrations0, roles0, Verceldeploy0,
Square subscription0/CreatePayment0/GetPayment0/refund0. Prior credential read403 remains
unresolved (cause not inferred as expired login or missing consent).

Required sequencing decision: permit a narrowly isolated **hosted DB migration/role/negative
permission acceptance step on the existing resource** before dependent ingress/Square work,
with sanitized proof and an explicitly defined follow-up independent gate. The current
review budget has no remaining pre-live re-review; do not repurpose final post-live slot.
Alternatively keep R15 held. Deferring privilege proof until after payment is not proposed
as an operational shortcut. Codex has not issued or acted on either new authority.

After that decision, remaining approved-scope implementation still needs manifest-source
verification (NEW1), real target/committed manifest/owner installation, protected operator
wiring, CREATE guard parity, secure credential acquisition, hosted tests, corrected ingress,
subscription/key handoff, signed delivery, conditional100JPY/lookup/projection and final
review/cleanup. Avatar A2/A3 does not start at this blocked terminal.

[Closure](closure.json): all owned DBs and both Claude processes stopped; no Web/browser
started; no unrelated services/resources touched. Old historical statuses are not rewritten
as independent acceptance.
