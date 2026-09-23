# Production Identity V5

Owner authority: 2026-09-23 ZAO Rental Codex takeover directive, sections 5–7.
Base: `1a36ec36644d0408ae9891f1404e86b7872d353a`.

The exported raw-configuration readiness I/O path has been removed. The public module
exports only `probeProductionDatabaseReadiness(identity, credential, connect?)` and
`deriveProductionDbReadinessTarget(config)`. The latter returns frozen, non-secret target
facts and migration count, performs no I/O, and grants no capability.

The internal worker lives in `packages/db/src/internal/database-readiness.ts`; it is not
re-exported by a product module. It takes an explicitly supplied transport, with no default
connector or credentials. The public wrapper resolves the registered exact identity before
creating that transport. Raw configurations, forged identity objects, and derived target
facts all fail before connector invocation (observed call count zero).

There is no new issuer, fingerprint override, NODE_ENV bypass, or caller-supplied authority.
The real identity accept path remains an attended live gate; local tests do not claim it.

Validation on 2026-09-23:

- Production unit suites: 91 passed, including identity/readiness and admission boundaries.
- Disposable PostgreSQL production role plans: 29 cases passed. The internal readiness worker
  verifies least privilege, migration completeness, wrong database rejection, and an actual
  PostgreSQL wrong-password rejection. Incomplete schema reports `schemaComplete: false`.
- Disposable PostgreSQL normal production runtime: 12 cases passed.
- `npm run lint`, `npm run typecheck`, `npm run check:secrets`, and `git diff --check`: passed.
- Candidate/tracked file scan: no plaintext hostname hashing to the pinned Production host
  fingerprint; no `issueExactProductionIdentityForTesting` definition.
- Full verify: deliberately not run at this checkpoint.

The first sandboxed DB attempt failed at localhost port binding (`EPERM`), before cluster
creation. The unsandboxed local role test passed. Runtime preflight then stopped below the
protected 2 GiB disk floor. Removing only this checkout's regenerable `.next/cache` allowed
the runtime test to pass. Each successful owned cluster was disposed through unchanged
`cleanupSuccessfulClusters`, with persisted command log and matching owner IDs. Historical
inventory clusters without success receipts were preserved. Final verify's 4 GiB disk floor
remains unchanged.

No PR, workflow dispatch, main mutation, Production DB/provider request, live charge/refund,
mail, deployment, domain/DNS, backup activation, or indexing activation was performed.
