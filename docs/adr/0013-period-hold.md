# ADR 0013 — Supervised period allocation and atomic group HOLD

Owner authority: E06 request and mutable-allocation amendment, 2026-09-11. PR #5 was
squash-merged at 1dbf07d9934472ccb6f29b93cd9014b87f417fb7 after exact head/review/CI
verification. PR #3 remains Draft; UNATTENDED_HOLD and its policy are unchanged.
E03 scope here is time/state/API contracts only; money, recommendation, payment and
other operational contracts are not marked complete. No auth/ORM/framework reselection.

Canonical business rules remain in OPERATIONS, INVENTORY_RULES, DOMAIN_MODEL and
STATE_MACHINES. The original source files/configuration and migrations 0001–0003
are immutable. Additive 0004 is applied only to disposable worktree databases.
The owner explicitly selected **600 seconds** for development HOLD TTL. Server DB time
sets it; replacement never extends it. This is not production policy activation.

`hold-input.schema.json` defines exact requirements: explicit accepted variant IDs
already identify model, family, exact size, age and tier. An alternative model/size is
allowed only if its variant was explicitly included; there is no implicit equivalent
class. The server verifies every candidate against the declared family/age/tier.
Group members are opaque keys, without personal information. `inventory_reservations`
is an owner-bound, opaque development reservation target, not a paid booking/customer.
Bundles expand to their required equipment families, never additional physical stock.

Normalize contract time with explicit Asia/Tokyo offsets, inclusive 1–10 dates and
half-open occupation timestamps. WHOLE_TOKYO_DATE_V1 is persisted separately from
customer start/due and HOLD expiry. Reuse cannot be enabled by a browser field/flag.
No previous-day collection or invented fitting/DIN decision is added.

Promises (`inventory_holds.conditions`) are distinct from provisional witnesses
(`inventory_claims`). `allocation_stage` is a dimension of the planned claim, not Asset
physical status or commercial reservation state: PROVISIONAL, PREPARATION_FIXED,
RENTAL_FIXED. The last two are contract states only, supplied by test-owned fixtures;
there is no preparation/dispatch/checkout endpoint in E06. Pending/unknown/success
payment also pins a witness for reconciliation. Expiry does not unpin fixed work.

The solver considers all live provisional plans plus the new/replacement request,
and leaves fixed plans unchanged. Backtracking with fewest-candidates-first and
interval capacity checks can rearrange another owner's provisional witness without
changing their explicit conditions, group components or TTL. Assets require the same
ID for every day. Pole pairs consume capacity per date, with internal accounting
positions (not physical pole identities/QRs) materialized to enforce DB uniqueness.
Each asset has capacity one; ski labels never create an additional asset. A future
same-store booking does not occupy unrelated dates. All witness changes commit or
roll back together and append before/after replan evidence. Failed amendments keep
the prior valid claim. The scanner/handoff remains a future revalidation boundary:
open reservation -> scan immutable Asset ID -> validate full period -> verify assignment
and required checks -> record checkout. Labels never embed mutable reservation data.

A database transaction advisory lock (71820600) serializes allocation writers across
processes. Statement triggers make stock/claim/constraint writes participate; ledger
updates first check scoped existence, acquire this lock, then take row locks. READ
COMMITTED reads after the lock see prior committed work. Unique active asset/day and
pole/pair-position/day indexes are an additional DB boundary; quantity/status changes
cannot invalidate active claims. Bounded 1.5s lock/5s statement/10s idle-transaction
limits and a 4-connection, 2s acquisition pool fail as INDETERMINATE, not sold-out.
References: [PostgreSQL 18 locking](https://www.postgresql.org/docs/18/explicit-locking.html)
and [transaction isolation](https://www.postgresql.org/docs/18/transaction-iso.html).

The solver is deliberately bounded: 80 existing live HOLDs, 240 component requirements,
3000 candidate resources, 100000 fixed day claims, 10000 external constraints and
100000 search visits. Exhaustion returns INDETERMINATE and commits no candidate plan.
This is a supervised development implementation, not an unbounded production solver.

Same-store physical custody is source truth. A cross-store return remains allowed and
records a future source-store capacity fence. It does not materialize stock at the
receiving store. E07's protected transfer/actual receipt/inspection is not implemented.
`inventory_constraints` is trusted operational input (MAINTENANCE / OUT /
TRANSFER_UNVERIFIED), with no application writer or public import. It blocks capacity;
it is not proof of a committed arrival. Unverified transfer capacity yields
TRANSFER_PLAN_REQUIRED. The 17:00 contract never creates a 17:10 receipt or adds to a
sealed/departed batch. Existing commitments must be reconciled before future E07 writes.

Payment is a contract seam only: NONE/FAILURE can expire; PENDING/UNKNOWN/SUCCESS require
reconciliation and cannot mutate/release via the ordinary HOLD path. Late success after
expiry needs an inventory reacquisition transaction plus separately verified payment;
there is no confirmation/payment endpoint, Square call, retry charge or automatic refund.

Reuse Better Auth and E05 staff authorization. HOLD_VIEW and HOLD_EDIT are explicit
individual grants, with **no new default for any role**. Both pickup/return stores must
be in the server-read scope. Only owners can read/amend/cancel their HOLD; automatic
internal replanning preserves other owners' promises without exposing their records.
Use fresh session and DB permissions before access/locking, exact Origin for mutations,
strict bounded input, no-store responses and the existing browser session boundary.
The dedicated HOLD DB role reads only required staff authorization metadata and stock,
mutates HOLD records, and cannot read credentials or change staff, ledger, DDL or audit.

Evidence and remaining gates are recorded per exact head in E06_PROGRESS and the private
Draft PR. Static review is not independent test execution or production approval.

Owner return-mode amendment: `docs/RETURN_RULES.md` is canonical. One scan on either side
of a ski/boot pair identifies one whole Asset, no side-level state. Loan-cycle-bound,
server-persisted batch candidates and fact-preserving cross-store receipt are E12 work;
E06 does not implement or claim those operations. E06 blocks invalidating master edits,
which must not be reused as a reason to reject future factual receipt.
