# M2A implementation self-audit

Claude is the Primary Implementer, so nothing here is an independent review and no
self-authored change is recorded as `INDEPENDENT_REVIEW_PASS`.

```
role:                     PRIMARY_IMPLEMENTER
m2aIndependentReview:     CORRECTION_IMPLEMENTED_AWAITING_INDEPENDENT_RECHECK
pr21IndependentReview:    INDEPENDENT_REVIEW_PENDING
```

## Independent review correction R1

An independent reviewer returned BLOCKER 0, HIGH 1, MEDIUM 4 against
`48827e79d602bc5a68f5da1e59aa17fc49ef37b0`. All five are corrected below in migration
`0037` and the surrounding services. Nothing else was changed and no feature was added.

**IR-01 (HIGH) — field acceptance crossed the store boundary.** The uniqueness key was
`(run_id, scenario, device_class)`, so a staff member scoped to one store could reach an
existing row recorded at another store through `ON CONFLICT` and rewrite its result, and
`field_acceptance_status` took no store at all. The key now includes `store_id`, conflict
resolution is scoped to the store, reading requires a store that the SQL boundary checks
against the maintained session, and the `SYSTEM` aggregate requires explicit `ALL` scope.
The launch gate is itself `ALL`-scope only. Across stores the **worst** result wins, so one
store's failure can never be hidden by another store's pass.

**IR-02 (MEDIUM) — scenario and device class were independent.** A physical-device scenario
could be recorded as `PASS` from a desktop. The two are now bound by an explicit matrix
enforced both in the service and as a database `CHECK`, so bypassing the service does not
help.

**IR-03 (MEDIUM) — Square acceptance checked shape, not identity.** `squareIdentityAcceptance`
now compares observed facts against Owner-approved expected metadata and requires an exact
match on merchant, both locations, currency, environment, idempotency scope and the webhook
origin **and** path. A different but perfectly well formed merchant, location, host or path
is a failure. No credential is read or stored on either side.

**IR-04 (MEDIUM) — preflight could report a false READY.** Exit status followed only the
original gates. Readiness is now the conjunction of the original gates, the staging
categories and the manifest, and a component that is merely `OFF` or `DISABLED` no longer
counts as satisfied when it is mandatory. Mandatory sets are stated explicitly; optional
components may still be disabled deliberately.

**IR-05 (MEDIUM) — webhook and real-data signals were derived unsafely.** Webhook readiness
was read from the payment adapter, so a ready adapter implied a ready webhook; it is now an
independent `WEBHOOK` safe status derived from its own declared notification address.
`REAL_DATA` was decided by a source-file naming heuristic; it now requires an explicit
`real_data_acceptance` receipt bound to a committed import, whose row and asset counts are
recomputed in SQL from what the commit actually applied and which must cover both stores.
A synthetic rehearsal has no receipt and therefore can never read as real stock, even when
its source document is named like a receipt.

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
