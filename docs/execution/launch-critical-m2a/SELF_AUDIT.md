# M2A implementation self-audit

Claude is the Primary Implementer, so nothing here is an independent review and no
self-authored change is recorded as `INDEPENDENT_REVIEW_PASS`.

```
role:                     PRIMARY_IMPLEMENTER
m2aIndependentReview:     INDEPENDENT_REVIEW_PENDING
pr21IndependentReview:    INDEPENDENT_REVIEW_PENDING
```

## Scope actually delivered

The import path is the one built in M1; no second importer exists. The template was
completed to V3 by adding `manufacturer`, `model_name` and an optional internal `note`,
all matched exactly against the authoritative catalogue or refused. V2 files still import.

Provider work is harness only: Square, webhook, notification and backup are exercised
entirely through fixtures against the existing adapters and state machines. No provider
request, credential read, external mail or restore happened.

## Findings

**1. Import template extended — deliberate, reviewer attention requested.**
`STOCK_IMPORT_HEADER_V3` adds three columns and the commit path now writes the note into
`ledger_assets.notes`, which previously was always empty. This touches the M1-reviewed
import contract. The note is length-capped, refuses control characters, and is documented as
equipment-only; manufacturer and model name are exact catalogue matches, never fuzzy.

**2. `note` is free text — the only free-text field added anywhere in M1.7/M2A.**
Field acceptance deliberately has no free-text field. The import note does, because a
receipt legitimately carries an equipment remark. It is staff-entered and bounded, but it is
the one place where a careless operator could type customer information. Documented in
`STOCK_IMPORT.md`; a stricter charset or a fixed vocabulary is the obvious follow-up if that
risk is not acceptable.

**3. Readiness authorization was already widened in M1.7** for `OPERATIONS_VIEW`; the launch
gate reuses that same safe component set and adds no new exposure.

**4. Operations role gained read access to `foundation_migrations`.**
The launch gate compares the applied registry against the code's plan. The table holds
migration ids and checksums only — no secret — and the grant is read-only.

**5. `REAL_DATA` uses a documented heuristic.**
Fixture rows keep `source_kind='SYNTHETIC'`; a committed receipt import writes `UNVERIFIED`.
The gate treats a source document still named `SYNTHETIC…` as a rehearsal. A real import
whose receipt is literally named "SYNTHETIC…" would therefore be missed. Acceptable while
real imports are absent; worth an explicit flag in M2B.

**6. `CI` is always `NOT_RUN` on the launch gate.**
CI evidence lives in GitHub, not in this database, so the gate refuses to claim it rather
than guessing. It must be read from the PR.

**7. `migrationPlan` moved to its own pure-data module.**
`packages/db/src/migration-plan.ts` exists because the fs-based db index cannot be bundled
into the web build. `packages/db/src/index.ts` re-exports it, so there is still one source of
truth and no migration content changed.

## Security checklist

Each line is asserted by a test in the suites listed, not by inspection alone.

| check | result | evidence |
| --- | --- | --- |
| secret or PII leakage | 0 | `check:secrets`; manifest refuses credential-shaped keys and values; field acceptance has no free-text column; import report carries no cell value |
| provider network calls | 0 | no `fetch`, URL client or socket exists in any new server module; harnesses are fixtures |
| Production mutation | 0 | no Production credential is read; preflight validates declared config shape only |
| authentication bypass | 0 | anonymous 401 and unprivileged 403 on `/api/admin/launch` and `/api/operations/*`; field acceptance and the console are default deny |
| arbitrary URL / SSRF | 0 | the only `new URL(...)` parses the webhook address to validate it and never requests it; https, no credentials, no query, no loopback |
| store mapping | explicit | Square acceptance requires both stores, rejects an incomplete or ambiguous mapping |
| field acceptance mutates business state | never | records write only their own table plus one audit row; business fingerprint unchanged |
| launch gate is read-only | yes | no form, no password input and no control beyond reload; `canActivateProduction: false` |
| import idempotency | held | replaying the same file creates nothing and reports every row as a no-op |
| migration safety | held | fresh apply, populated upgrade, concurrent apply once, replay inert, failed-DDL rollback, historical checksums preserved |
| rollback and feature isolation | held | media, notification and operations failures leave booking, HOLD, quote, payment and custody intact |

## Deliberate limits

- Physical iPhone/Android testing is `NOT_RUN`; M2A builds the tooling and the record only.
- The Square, webhook, notification and backup harnesses validate identity, shape and
  outcome contracts. They prove nothing about a real provider until credentials are injected.
- The launch gate is read-only. It cannot deploy, activate Production, take a payment or
  accept a secret, and the browser test asserts the page has no such control and no password
  input.

## Operation counts

Production deploys 0. Square requests 0. Real payments or refunds 0. Real inventory imports 0.
External e-mail or SMS 0. Production database mutations 0. Domain switches 0. Provider
credentials read 0. Actual restores 0. Migrations added 1 (`0036`); `0001`–`0035` byte-identical.
