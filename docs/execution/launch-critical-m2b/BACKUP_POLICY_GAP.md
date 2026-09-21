# Backup: what the Owner policy requires and what a provider alone gives

The Owner decision `OWNER-P4-R1` (`config/production/p4-owner-decisions.json`) already fixes
the targets, so this is not a fresh choice:

| target | value |
| --- | --- |
| RPO | 300 s |
| RTO | 14400 s (4 h) |
| retention | 30 days |
| drill | monthly, and before an important migration |
| off-host | required |
| encryption | required |
| PITR | required |

## Neon point-in-time recovery does not satisfy this on its own

Provider PITR gives recovery **inside the provider**. The policy asks for an **off-host,
encrypted** copy as well, because the risk it covers is different: PITR protects against a bad
write, whereas an off-host copy protects against losing access to the provider account itself.
One does not substitute for the other.

So `BACKUP` needs three things, and is not ready until all three hold:

- **A. Provider PITR** with at least 30-day history on the Production Neon project
- **B. An off-host encrypted copy**, on a provider that is not Neon
- **C. An isolated restore rehearsal**, into a separate identity, proving the copy restores

The M1.7 local logical drill already implements and proves the shape of C — classified export,
fresh migrated database, foreign keys re-proved by anti-join, critical fingerprints compared —
but against a local database. It is the rehearsal mechanism, not the Production evidence.

## The current sandbox is far below the target

`zao-rental-sandbox-development` on `free_v3` keeps **6 hours** of history. The policy asks for
**30 days** — 120 times longer. That is a plan characteristic, not a setting, so the Production
project's plan has to be checked against it before any real data is loaded.

If the available plan cannot reach 30-day history, that is `HUMAN_BILLING_GATE`. **No plan
change was made and none is proposed unilaterally.**

## Off-host destination — an open decision

No off-host backup provider is chosen, and one is not chosen here. Two constraints are worth
stating because they narrow the field:

- It must not be the Production media bucket. Backups and media must not share a bucket or a
  credential: a credential that can read media should not be able to read database backups, and
  the whole point of off-host is that losing one account does not lose both.
- The copy must be encrypted with a key that is not stored beside it.

Cloudflare R2 is already in the stack and is a reasonable candidate as a **separate** bucket
with its own credential, but that is a decision with cost and key-custody consequences, so it
belongs to the Owner.

## Consequence for the launch gate

`BACKUP` stays `NOT_RUN` or `BLOCKED` until A, B and C hold together. The gate already refuses
to call a backup ready on retention alone: it requires retention of at least 7 days, PITR
enabled, a successful backup no older than 26 hours, and an isolated restore target — and the
Owner policy is stricter still at 30 days.

**Real inventory must not be imported before this is settled.** Loading real business data into
a database whose backup story is unresolved is precisely the situation the policy exists to
prevent.

## What is needed from the Owner

1. Production Neon plan confirmed to provide 30-day history and PITR, or a billing decision.
2. An off-host backup destination and who holds the encryption key.
3. Confirmation of the monthly drill cadence and who is accountable for it.
