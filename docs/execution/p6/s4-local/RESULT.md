# R11 S4 local result — activation pending

- Starting HEAD: `72cee5817da22cd474773c978f9ae95396edea29`
- Authority commit: `57a2ac366be2e881314d387d04a4adb0618e89ac` (pushed and exact content read back)
- Implementation / validated source: `0aac863e909ec243d9842cff74d2d077dbeb9f82`
- Main remains `3061dbbbe00294e5baebba2405028c907d6e6e85`.
- Final evidence commit is the commit containing this result; it changes documentation/status only.
  Resolve its exact SHA with `git log -1 --format=%H -- docs/execution/p6/s4-local/RESULT.md`.
  Source-file hashes in `source-manifest.json` bind all 12 implementation files independently of later docs.

## Implemented

POST `/api/webhooks/square`, payment.created/payment.updated only. Existing raw-body HMAC verifier
and parser reused. Invalid signature403, malformed verified payload422, wrong merchant403,
65,536-byte limit413; unsupported signed correct-merchant non-payment envelope deliberately200/ignored.
Payment ACK waits for committed inbox result. Exact duplicate200; changed hash409 with preserved
original and bounded conflict metadata. Persistence failure503; no local retry on uncertain commit.
Signature, raw body, credentials and card/PII are neither persisted nor logged by the receiver.

Additive0025 migration + repository implement environment/event unique receipt, metadata only,
transaction/COMMIT with synchronous durability, revocations, lease/fencing claim/settle and bounded
retries. Actual role grants, DB apply/concurrency/crash/durability are **not validated** in R11.
Migration-plan assertions in two existing integration scripts include0025; those scripts were not run.
No worker/provider/business mutation is connected. Production composition is disabled; missing
activation/configuration returns503 without creating a pool. Build does not need secrets. The final isolated build inherited only PATH/HOME/TMPDIR/LANG plus
NODE_ENV and NEXT_TELEMETRY_DISABLED; no actual production dotenv files exist.

## Validation

304/304 tests (51 new R11 cases), skipped0. Secret scan, lint, typecheck and build all exit0.
`validation.json` records command arguments, times, exit codes and log hashes. Initial Node
server-only alias test failure is retained in narrow-01.log; fixed with official Next server-only
alias only in the isolated unit-test harness. No product guard was disabled.
Full relevant **unit/readiness fixtures**, static migration checks, and secretless Next build passed.
This is neither full `verify` nor live PostgreSQL/Preview/Square acceptance nor independent review.
The route export test imports the real route with the official Next alias in Node; it is not an HTTP
server/Preview request. No browser or DB is started. Remote CI was not manually triggered.

## Preserved history / resources

R3/R4/R6/R7/R8/R9/R10 JSON history objects and all24 earlier migrations are byte/value unchanged
against the starting commit. R10 remains `S3_NONTERMINAL_DO_NOT_RETRY`, refund
`LAST_OBSERVED_PENDING`. Finalization is `DEFERRED_NON_GATING_FOR_LOCAL_IMPLEMENTATION`.
No added GetRefund, refund POST, new refund key or provider-state inference.

R11 actual counts: Vercel authenticated0 / deploy0 / Square0 / refund0 / subscription0 /
real delivery0 / PostgreSQL0 / Production0 / browser0 / Playwright0 / Claude0 / Spark0.
All finite validation children have exited. No owned DB/Web/browser/Claude resource was started;
no unrelated process or accepted Preview was touched. No new PR or main merge.

## Next authority

Read `../../PRODUCTION_P6_S4_ACTIVATION_GATE.md`: live Sandbox webhook activation authority is
needed for isolated DB/migration/minimal role, Preview configuration/deployment, protected machine
ingress, subscription and budgeted real delivery. Credentials stay out of chat/repo/logs.
Protection-compatible Square delivery remains unresolved; never solve by blanket bypass/disable.
No further R10/refund action is included.
