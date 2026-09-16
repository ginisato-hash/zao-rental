# R14 development payment acceptance

Authority: [R14](PRODUCTION_P6_R14_ACTIVATION_AUTHORITY.md). Production and live external activation remain disabled. All data is synthetic. R10 is untouched.

## Composition and identity

`developmentPaymentComposition` is an injected development-only library, absent from ordinary Next.js runtime imports. It takes five distinct pool capabilities, a fixed booking/attempt/payment target, verified receiver configuration, and an explicit provider port. It does not construct an HTTP client or read ambient credentials. Receiver persistence rejects other payment IDs; dispatch/claim use merchant/payment filters before row locks and a batch of exactly one. Context rechecks the trusted booking/attempt; projection rechecks the target. The existing R12 state machine and R13 decisions are retained.

The existing receiver commits the safe inbox receipt before ACK. A finite dispatcher creates/link jobs separately. The worker commits a lease, calls the injected provider outside the transaction, and finalizes truth. R13 separately locks the inventory advisory lock, booking, attempt, HOLD, projection head and source stream/job. R12 RECONCILED alone never means booking confirmation. The role-specific source function gives the projector a locked, normalized R12 observation without UPDATE access to reconciliation tables.

## Migrations and least privilege

0001–0027 are unchanged. 0028 adds the development-only locked source reader. 0029 adds target-scoped versions of dispatch/claim; a parity regression confirms their state transitions and lock order match 0026 except for stricter admission and selection. All new functions revoke PUBLIC EXECUTE and fix search_path. Existing tables/triggers/constraints and journal immutability remain.

`scripts/payment-activation-roles.ts` accepts only the owned loopback `zr_<namespace>` database and refuses production. Migration setup uses a dedicated owner connection; runtime receives separate generated credentials in memory. No credential is written to env, argv, evidence or repository.

| Role | Allowed | Not allowed |
|---|---|---|
| receipt | inbox receive function | raw inbox/business/journal reads or business writes |
| dispatch | legacy/test and target-scoped dispatch functions | business writes |
| truth | claim/context/finalize functions | business writes |
| projection | selected contract/inventory reads; existing booking/attempt/HOLD state columns; append projection journal; locked source and pure validation | contacts, price edits, HOLD expiry, stock claims, notifications, R12 table writes |
| diagnostic | safe diagnostics function | dispatch/claim/business writes |
| public probe | connect only | private identifiers/inbox/journal access |

The projection role needs USAGE on reconciliation schema and EXECUTE on its pure `valid_observation(jsonb)` because the R13 journal CHECK constraints invoke it. The initial missing grant failed with 42501 on real PostgreSQL; the narrowed grant resolves it. No GRANT ALL or PUBLIC expansion.

## Reproduction

Use Node/npm pinned in package.json and the existing setup. `npm run test:payment-activation` creates one isolated synthetic PostgreSQL, applies ordered migrations, provisions six test roles, runs the R14 test module, closes role pools, then stops its owned cluster. It rejects ambient database configuration via the existing helper. It is a finite local command, not a worker service. It never sends Square HTTP.

The R14 execution used one finite interactive test session against the same database: initial 0001–0027, then additive 0028/0029; 21 core checks, 4 composition/durability checks and 3 additional boundaries. A finite child loaded revised modules through IPC with only newly generated synthetic database credentials in memory. The fresh one-command entrypoint was typechecked; a second database was not started merely to rerun the acceptance. Evidence distinguishes the real connection kill from an injected application failure and COMMIT response-loss simulation over real transactions.

Business time was a test-only database function override restored in finally. R12 leases/deadlines retained real PostgreSQL time. No OS clock change or long sleep. Negative fixture transactions rolled back; applied migration files and production runtime were not rewritten.

## Evidence interpretation and remaining gates

The initial real-DB chain confirms one synthetic booking through inbox, durable job/lease, fixture truth and actual R13 transaction; two projectors and response loss leave one journal event and two business audit updates. The composition test performs a fixture provider lookup against an already accepted observation, then confirms replay has no repeated business effect. This is not live Square or a hosted HTTP acceptance, and not a new-booking confirmation through the entire hosted composition.

No live webhook, provider lookup, new payment, refund or Preview was used. The cloud database and protected ingress gates prevent deployment. No one-shot financial manifest is created for an operation that will not be dispatched. See [ingress gate](R14_PROTECTED_INGRESS_GATE.md) and [final evidence](p6/r14-evidence/FINAL_RESULT.md).
