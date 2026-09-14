# P6 R3 — bootstrap alias stop, prepared runtime change preserved

## Actual stop condition

Owner R3 allowed one static protected bootstrap with production metadata but **no
alias/domain assignment**, then one actual application Preview. A static Build Output
API payload of2files/370bytes passed dry-run; no app/package/installer/function/secret
or DB/provider code was uploaded. `--prod --skip-domain` was used exactly once.

Bootstrap `dpl_C44zbkSu1uu4WbPNj9uCLA8zDJWP` became READY with target production,
`autoAssignCustomDomains=false`, **but Vercel assigned its generated standard alias**
`zao-rental-zao-food-map.vercel.app`. This fails R3 §8/28, even though the files are
harmless and protection stayed enabled. Parent stopped; no application Preview attempt.

The exact newly assigned alias mapping was removed (exit0); live alias list readback
is now empty, custom domains0, Project framework/root/build settings unchanged.
The deployment object still carries historical alias/aliasAssigned metadata; that is
not used as proof of a live mapping. Both object and live-list evidence are preserved.
The placeholder remains at `https://zao-rental-el6qaeh49-zao-food-map.vercel.app`.
It is protected; unauthenticated GET returned302. Body/Cookie/authorization were not
collected. No protection bypass, domain assignment, promote or permanent framework
change was performed. Do not delete the bootstrap or proceed without the next decision.

## Parent / Spark work

- Parent owns both root causes, source/docs verification, root metadata/config change,
  bootstrap execution, alias quarantine and final decision. See R3_RUNTIME_DECISION.md.
- Spark `P6-SPARK-RUNTIME-01`: read-only pin inventory, no edits.
- Spark `P6-SPARK-RUNTIME-TEST-02`: only tests/readiness/toolchain-runtime.test.ts.
  Initial fabricated two-version matcher rejected by parent. One allowed correction
  now evaluates actual manifest24.x with bundled semver. Spark reported4PASS/0FAIL,
  command exit0. No further correction/model launch. No authority was delegated.

Prepared changes (not cloud verified): engines.node24.x; matching one root lockfile
metadata field. Dependencies/resolutions/integrities unchanged. Local/CI24.15.0,
packageManager npm11.12.1, npm engine11.12.x, engine-strict remain. Root vercel.json
pins install/build npm and maps existing apps/web/.next output, per deployment only.
No applied Vercel app setting changes yet; no business/security/provider code edits.

## Verification classification

| Check | Result |
|---|---|
| Local tool versions | Node24.15.0 / npm11.12.1 observed |
| Pure toolchain contract | Spark4PASS after1correction |
| npm ci / lint / typecheck / build / full verify | NOT_RUN after explicit stop gate |
| CI / independent Claude | NOT_RUN; old results not reused |
| Static bootstrap | READY, target production, unexpected alias -> removed |
| Bootstrap unauthenticated request |302; protection metadata enabled |
| Actual application Preview / build / startup / health / readiness | NOT_RUN |
| Square / payments / refunds / webhooks / externalDB / R2 / emailSMS | all0 |
| Secret values read/exposed; Production env entries |0;0(metadata-only) |

Bootstrap has no Node/npm/application runtime. Its READY does not verify application
toolchain or business readiness. Existing failed Attempt1 (unexpected production,
EBADENGINE, removed) remains unchanged. R3 bootstrap allowance1used, actual Preview
allowance0used; the explicit stop condition prevents spending that remaining attempt.
No real customer traffic was initiated. A single unauthenticated protection probe
is recorded separately; platform-wide historical traffic was not queried or asserted.

## Next Owner decision

Whether to continue using this protected static bootstrap **after its automatic
standard alias was immediately removed**, despite the R3 no-alias creation gate.
If explicitly approved, first complete local integration tests, then fixed-head dry-run
and the remaining single actual Preview. No new Square values or S1 authority needed
or requested now. Square S1 approval is premature until application Preview acceptance.

No owned DB/Web/browser/Claude started. Spark tasks and finite CLI processes completed.
Only the protected static placeholder remains intentionally; temporary generated files
are local only, not committed. Evidence: r3-evidence/.
