# Production bootstrap: what actually blocks it

> **Superseded in part.** This is the original investigation record, kept as written. Three
> things were resolved differently once the bootstrap was built, and the resolutions below win:
>
> 1. **Terminology.** The canonical classification is
>    [LOCAL_COUPLING_CLASSIFICATION.md](LOCAL_COUPLING_CLASSIFICATION.md), which splits what this
>    document calls "Category 2" into **A1 development foundation artifacts**
>    (`foundation_metadata`, `telemetry_events`) and **A2 historical sandbox activation
>    artifacts** (`r15_activation.manifest`, `r15_activation.operations`).
>    `0030_r15_operation_guard` is **not** a foundation artifact: it belongs to the finite R15
>    Square Sandbox acceptance and must never be used as a Production activation mechanism.
> 2. **A1/A2 need no migration.** The proposal below to widen the two persisted checks was
>    dropped. Nothing in the application writes those tables, so Production creates them and
>    leaves them empty and inactive, asserted at 0 rows. No `0040` is needed for this, and no
>    fake `zr_` namespace is inserted.
> 3. **Not a dump.** `pg_dump` is not shipped with the embedded-postgres distribution, and a
>    dump would lose the guard semantics anyway. The bootstrap applies the canonical migrations
>    with only the migration-time identity predicate rewritten; see
>    [PRODUCTION_BOOTSTRAP_PROVENANCE.md](PRODUCTION_BOOTSTRAP_PROVENANCE.md).
>
> The payment finding in "Category 3" stands, and is now recorded as
> [PAYMENT_PROJECTION_PRODUCTION_BLOCKER.md](PAYMENT_PROJECTION_PRODUCTION_BLOCKER.md).

The directive is right that canonical `migrate()` cannot be run against a Production database.
It is blocked in more ways than migration-time guards, and the difference matters: a
schema-only bootstrap would carry two of the three categories straight into Production and
produce a database that looks migrated but cannot do its job.

Findings below are enumerated mechanically from the migration files.

## Category 1 — migration-time guards (11 files)

`0015`, `0016`, `0017`, `0018`, `0019`, `0033`, `0034`, `0035`, `0036`, `0037`, `0038`, `0039`
each raise at DDL time unless `current_database()` matches `^zr_[a-f0-9]{12}$`.

This is what stops `migrate()` on a Production database, and it is the part a schema-only
bootstrap genuinely does solve: the guards run during migration and leave no trace in the
resulting schema.

## Category 2 — constraints that persist into the schema (2)

These survive any dump-and-restore, because they are part of the schema itself:

- `0001_foundation`: `foundation_metadata.namespace text PRIMARY KEY CHECK (namespace ~ '^zr_[a-f0-9]{12}$')`,
  and `telemetry_events.namespace` is a foreign key to it.
- `0030_r15_operation_guard`: a `database_name` column with the same `^zr_` check.

In a Production database called `zao_rental_production`, neither column can ever hold that
name. `migrate()` does not populate `foundation_metadata` — `seed()` does, and it takes the
namespace from its caller — so this does not block the bootstrap itself. It does mean
telemetry cannot be recorded against a Production namespace, because the row it must reference
cannot exist.

## Category 3 — guards inside runtime functions (3 functions)

These are checked when the application calls them, not when the schema is built, so a dump
carries them into Production intact:

- `payment_projection.lock_source` (`0028`)
- `payment_reconciliation.claim_target` (`0029`)
- `payment_reconciliation.dispatch_target` (`0029`)

Each refuses unless `current_database()` matches `^zr_`. In a Production database, payment
projection and reconciliation would fail at the moment they are used.

## What this means for the bootstrap

A local-dump-to-Production bootstrap is still the right shape, and it clears Category 1. It
does **not** clear Categories 2 and 3. If we stop there, Production would come up with a
correct-looking schema and a correct migration registry, while telemetry and payment
reconciliation are quietly inoperable — exactly the false-ready outcome the launch gate is
meant to prevent.

Renaming the Production database to `zr_<12hex>` would satisfy all three, and is explicitly
forbidden, correctly: the same pattern is the ownership test used by the local restore tooling
and the isolated-cluster hygiene, which refuse to act on anything that is not an owned local
database. Making Production answer to that name would make Production indistinguishable from a
disposable test database to the very tools designed to protect it.

So the boundary has to move off the database name, as the directive anticipates for `0040` and
later. Categories 2 and 3 need an additive migration that:

- widens the two persisted checks to accept a Production identifier as well as `zr_<12hex>`
- replaces the three runtime functions so their environment test is an explicit configured
  identity rather than the database's name

That is a real product change to reviewed payment code, so it is proposed here rather than
carried out quietly, and it is the reason this round stops for independent review before any
Production DDL.

## Bootstrap sequence, once that is settled

1. local canonical database `zr_<random>` → `migrate()` `0001`–`0039`
2. schema-only export, normalised (no owner, no privileges)
3. canonical schema fingerprint
4. empty Production database, **not** named `zr_*`
5. single controlled schema bootstrap
6. `foundation_migrations` populated with the exact canonical ids and checksums
7. fingerprint compared again
8. least-privilege roles provisioned; no owner or superuser at runtime
9. `migrate()` against the Production-shaped database proves inert, because the registry is
   already complete

Step 9 is the check that the bootstrap and the canonical path agree.

## Not done in this round

No Production DDL, no Production database, and no historical migration edited. `0001`–`0039`
are byte-identical.
