# PAYMENT_PROJECTION_PRODUCTION_BLOCKER

Recorded, not fixed. Fixing it is out of the current bootstrap scope and is carried into the
next pre-payment implementation and review gate.

## What is constrained

Four things are deliberately development/Sandbox constrained at different layers:

| layer | where | constraint |
| --- | --- | --- |
| TypeScript | `PgPaymentProjection` in `packages/db/src/payment-projection.ts` | refuses unless `current_database()` matches `^zr_[a-f0-9]{12}$` **and** the connected role equals `<database>_pay_projection` |
| SQL runtime | `payment_projection.lock_source` (`0028`) | raises `DEVELOPMENT_DATABASE_REQUIRED` (`42501`) on a non-`zr_` database |
| SQL runtime | `payment_reconciliation.dispatch_target` (`0029`) | same identity test, plus `SANDBOX`-only environment, limit 1 and a pinned merchant/payment shape |
| SQL runtime | `payment_reconciliation.claim_target` (`0029`) | same |

These are the three runtime guards the bootstrap transformer is pinned never to rewrite
(`RUNTIME_GUARDS = {'0028': 1, '0029': 2}`), so they survive into Production intact and keep
failing closed there. That is the intended behaviour, not a defect in the bootstrap.

## What this does NOT block

- Production schema bootstrap
- Dark Vercel deployment
- Square Production identity verification
- Webhook configuration

None of these reach payment projection or reconciliation.

## What this DOES block

- Real Production payment projection
- Real Production payment reconciliation
- The controlled real payment gate

## Why it is not fixed here

Clearing it means changing reviewed payment code — the admission rules of a state machine that
has already been through independent review and a finite Sandbox acceptance. That is a payment
change, not a schema change, and it needs its own implementation and review gate with its own
evidence. Bundling it into a schema bootstrap would put a payment-admission change inside a
change whose reviewers are looking at DDL equivalence.

## Carried forward

Next pre-payment implementation/review gate must decide, with evidence, how Production payment
projection and reconciliation are admitted — including which role Production connects as, and
what replaces the `SANDBOX`-only and limit-1 admission in `0029` — before any real payment gate
is opened.
