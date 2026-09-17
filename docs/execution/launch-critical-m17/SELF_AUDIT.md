# M1.7 implementation self-audit

Claude is the Primary Implementer for this milestone, so nothing here is an independent
review. No self-authored change is recorded as `INDEPENDENT_REVIEW_PASS`. The evidence for
M1.7 is this self-audit, the targeted security tests, the full local CI-equivalent
regression and GitHub CI. A genuinely independent review of M1.7 remains outstanding.

```
role:                       PRIMARY_IMPLEMENTER
newHeadIndependentReview:   INDEPENDENT_REVIEW_DEFERRED_DURING_CLAUDE_IMPLEMENTER_PERIOD
productReviewedHead (M1.6): efa71955333c9f6a531a54b844f8c6b28083a41b
postReviewChange (M1.6):    TEST_FIXTURE_ONLY
```

## What the console is, and is not

`ops_exceptions` is an observation of state that already exists elsewhere. Acknowledging an
exception writes only `status`, `resolved_at`, `resolution_actor` and an enum
`resolution_reason`, plus one `ops_history` row carrying `businessStateChanged: false`. It
touches no payment, refund, booking, inventory, HOLD, custody, transfer or delivery row.
`tests/operations/console.ts` and `tests/operations/failure-injection.ts` prove this by
comparing a full-row fingerprint of the business tables either side of every acknowledgement.

The console never reports a business outcome. `sourceConditionActive` is derived read-only
from `ops_exception_sources`, so an acknowledged exception whose underlying condition is still
true keeps reporting that it is active, and a condition that later resolves does not rewrite
the acknowledgement.

## Findings

**1. Readiness authorization widened — deliberate, reviewer attention requested.**
`apps/web/src/lib/readiness-http.ts` previously allowed only `canManage` (STAFF_MANAGE) to read
`/api/admin/readiness`. It now also allows `OPERATIONS_VIEW`. This touches a boundary reviewed
in M1.5. The response body is unchanged: six fixed component enums copied through an
allowlist, with no component identity, credential state, host or error text, and public
readiness is untouched. Required by the M1.7 direction to show safe status in the console.

**2. The exception list writes on a GET path — LOW.**
`ops_collect_exceptions` runs inside the list transaction, so a read collects new observations.
It needs an authenticated staff session, `OPERATIONS_VIEW` and store scope, and inserts with
`ON CONFLICT DO NOTHING`. This matches the existing operations GET handlers, which already run
transactions, and a cross-origin GET cannot read the response. Accepted as consistent with the
existing design rather than introduced by this change.

**3. `ops_observe_signal` performs no actor check — accepted by design.**
Runtime transport, media and database failures have no user context, so the port takes a fixed
code, a uuid and a fixed store enum only. It is `REVOKE ALL ... FROM PUBLIC`, granted to the
operations role alone, and no HTTP route reaches it. Failing to observe returns `false` and
never rolls back the business work that failed.

**4. The restore drill suppresses triggers — accepted, locally bounded.**
`restoreIntoFreshDatabase` sets `session_replication_role='replica'` inside one transaction so
immutable and audit rows are restored exactly as captured. It runs only against a freshly
created `zr_<12hex>` database in the same owned loopback cluster, refuses any identity that is
not owned, never writes to the source, and re-proves every foreign key afterwards by explicit
anti-join rather than trusting `VALIDATE CONSTRAINT`.

**5. The envelope is authoritative inside restore scope — documented.**
Migration-seeded rows in restore scope are deleted and replaced by the captured rows, so the
restored database matches the envelope exactly. The function always creates its own new
database, so this cannot overwrite an existing one.

**6. `auth_user` rows are restored — flagged.**
Display names and e-mail addresses are restored because staff and audit foreign keys need
them. Credentials, sessions and verification rows are excluded, so no restored row authorizes
anything. In this drill every value is synthetic; with real data this is personal data inside a
backup file and needs a retention decision before any non-local use.

**7. `sourceConditionActive` is evaluated per listed row — performance note, not a defect.**
It is a correlated `EXISTS` against the union view for at most 51 rows inside one statement, so
the application issues a constant number of queries regardless of row count
(`tests/operations/baseline.ts` asserts this). At the synthetic 500-set scale the list measured
p50 1.1 ms / p95 2.78 ms. A much larger exception table would be worth re-measuring.

## Deliberate limits

- `test:controller:macos` is macOS-only, needs the `codex` binary, and is not run by CI
  (`ubuntu-24.04`). Recorded as `NOT_RUN_CODEX_CLI_UNAVAILABLE`, `ciRelevant: false`.
- The restore drill proves a local logical export and restore only. It proves no provider
  backup, point-in-time recovery, RPO or RTO, and claims none.
- The synthetic baseline describes this machine and this fixture. `productionGuarantee: false`,
  no service level objective is defined, and no performance threshold gates the build.

## Operation counts

Production deploys 0. Provider operations 0. Real customers 0. Real payments 0. Real refunds 0.
External e-mail or SMS 0. Production database connections 0. Hosted database connections 0.
Migrations added 1 (`0035`); migrations `0001`–`0034` are byte-identical.
