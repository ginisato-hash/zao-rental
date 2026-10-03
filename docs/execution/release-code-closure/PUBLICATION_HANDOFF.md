# Publication handoff — Issue 47

Authority and the only progress ledger: [Issue 47](https://github.com/ginisato-hash/zao-rental/issues/47),
adopted directly by the Owner on 2026-10-03. This is an execution checklist and input contract,
not a claim of PUBLICATION_READY. The final exact-source proof belongs in that Issue.

Baseline: main `e3c68733483c1180d69ced95c1620e36e9694897`, tree
`526c6828b1def266317a26f05a46bce7bbf96b64`; PR46 Foundation run `37097276464`, attempt1 SUCCESS
is PR-head CI, not main CI. Reuse completed F2 evidence; do not replay its migration, deploy,
projection, failed payment or reconciliation. Existing notification remains
`BLOCKED_RECIPIENT_UNVERIFIED`. Keep the five F2 payment-role expiries unchanged.

## Seven-step execution and release gate

1. Compare origin/main, working copy, active writer, open PRs, exact deployment source/alias,
   protection, source migration registry/checksums, role metadata and data to live readbacks.
2. Complete only missing connections using accepted role/lifecycle/sink plans. Preserve working
   credentials, exact host/merchant identity and least privilege. Prepare backup/restore and monitoring.
3. Reconcile approved price/source/catalog and received physical stock independently. Register
   approved provisional data without claiming it is received or available for physical handoff.
4. Exercise JA/EN and 390/1440px customer/staff paths; distinguish isolated providers and browser
   camera fixtures from genuine provider and device acceptance. Correct reproduced blockers only.
5. Freeze one candidate after targeted checks; run one final full verification, then one independent
   Claude static review on sanitized source/base/head/authority/manifest. Existing Team, extra usage OFF,
   tools/MCP/hooks off. Initial1; correction1 only for B/H/M. One ordinary PR, natural Foundation CI.
6. Merge only exact reviewed/validated head with SUCCESS CI and no conflict. Never rerun the same SHA
   to find green. Deploy an accepted merged candidate once in the existing protected project.
7. Record exact source, review, CI, deployment, runtime and remaining inputs in the Issue's release proof.
   Use TECHNICAL_READY_OWNER_ACTIONS_REQUIRED while mandatory inputs/acceptances remain unproved.

## Current accepted connections and data

The 2026-10-03 live readback confirms 53 migrations/checksums matching this source, ten commercial
roles LOGIN with infinity validity and no memberships, and ten Production Sensitive password sinks.
R3 activation/canary/reset/restart is already complete; do not repeat it. The current commercial
runtime uses the existing guest/staff/access/recovery bindings. Avatar/media remain disabled.

Both approved Square locations are ACTIVE with card processing. The dedicated Production ingress
and its existing enabled payment-created/payment-updated subscription already exist. Reuse the prior
signed durable-ACK proof; it is not an authorization to resend a test. The ingress currently uses the
F2 receipt role's finite lease. Durable normal-operation payment credentials and worker dispatch must
be ready before public GO; do not convert or extend the F2 window as a shortcut.

The main site is All Deployments protected, at `https://zao-rental.vercel.app`.
`PRODUCTION_PUBLICATION_APPROVAL` is absent. Baseline rollback deployment:
`dpl_CGWTi5YhkGhW797LFkHiFwSSLaUW`. The ingress source predates F2; unchanged ingress code may reuse
its accepted deployment without another deployment merely to equalize commit labels.

Approved provisional inputs are the existing `ACTIVATION_PAYLOAD_SOURCE_A.json` (63 buckets,
901 units) and `ACTIVATION_PAYLOAD_SOURCE_B.json` (88 buckets, 520 units). Counts are lower bounds,
not physical receipt/inspection or a number of complete bookable sets. Source B was already registered.
Issue47's Source A registration is one atomic existing-API call; its receipt and post-readback are in
the Issue proof. Never combine a shared boot size into two independent quantity pools.

The active commercial book is revision2, `ZAO_2026_27_V1`, accepted equipment source digest
`ffd9fb8b8022952a397dd15693fd23b28e2f063b84f83c6a053e208863c948f8`, tables digest
`12a7a493f33dc4ea46a12c7f0dc2f770938b81598721d78672985469fccd64d5` and the existing wear v1.2
authority. Its current rental period is **2027-01-15 only**, an acceptance date. Do not treat that as
the public season, silently enlarge it, apply a tax adjustment, or replace the immutable price snapshot.
The observed catalog initially has only two adult-M wear variants; physical assets/poles/wear pools and
approved public-policy rows are zero. Later receipts must distinguish added catalog from physical stock.

## Required Owner inputs — single answer contract

Preserve the approved sales range; omissions below cannot be turned into a narrower READY declaration.
Use the existing source/receipt/photo templates rather than duplicating inventories.

| Input | Minimum answer / prepared action | Acceptance condition |
|---|---|---|
| Public rental season | `rentalFrom`, `rentalUntil`, any store/date closures | Accepted commercial book/activation covers intended dates at both stores; fresh quote matches pinned arithmetic |
| Equipment catalog / sizes | Tier per source/model; one approved booking-size mapping for bare numbers, `cm`, and shared `N/N.5` | Exact variant/bucket matching and guest recommendation; no double capacity, premium/model-promise substitution or guessed tier |
| Physical equipment | Final received-source file, approved count per row, store allocation, existing label numbering if any | Independent source approval, dry-run/import receipt, inspection before AVAILABLE; BSL remains unverified until measured; no inferred DIN |
| Wear receipt | Confirm received jacket/pants counts by age/size/store using existing receipt template | Provisional pools and real wear pools reconciled separately; physical handoff gate remains enforced |
| Commercial wording | Approved JA/EN tax-display basis, terms/cancellation/privacy and business/store information | Reviewed content becomes approved policy; no unapproved tax arithmetic or legal statement |
| Photos / rights | Approved files, source/right holder, permitted public use, model binding | No synthetic/unknown image is presented as a real guaranteed product; use existing rights manifest |
| Staff operations | Named operators, store scopes and required explicit booking/checkout/return/operations permissions | Authorized administrator applies exact access delta; real login, session isolation, denied-permission and recovery cases checked |
| Live payment / refund | Explicit new owner/card, exact booking/quote/location, JPY ceiling and remaining POST counts | No F2 budget reuse. Prepare a fresh quote; perform only the separately approved one payment/refund chain; UNKNOWN means read-only reconciliation |
| Live mail / recovery | Confirm intended owned recipient and message count for the new scenario | Exact frozen outbox/payload, one send, provider acceptance and received email; unknown recipient remains blocked |
| Physical devices / two stores | Staff-operated phone/camera, printed reservation/asset labels, receipt and inspection participants | Scan/search → correct booking → physical assignment → checkout/return at both stores; fake camera and manual ID entry do not satisfy this |
| Backup custody / external sinks | Independently secured existing age identity, bucket-scoped R2 credential and approved workflow-dispatch credential delivery | Secrets enter protected sinks only; existing local age identity is not regenerated or published |
| Final publication | Exact accepted release, domain control and final GO | All preceding requirements proved before protection removal, DNS/indexing and sales activation |

For the former cancellation notification, keep the exact held outbox. Do not change its recipient,
booking contact, or regenerate it. Its unresolved recipient is independent of all other work.

## Backup, restore and monitoring payload

Reuse `scripts/production-backup.ts`, `.github/workflows/production-backup.yml` and
`apps/backup-scheduler-worker`; no new provider or paid plan. The existing private target is
`zao-rental-prod-backup`. Live lifecycle readback: `hourly/` expires after2 days and `daily/` after30 days.
The existing backup DB role is NOLOGIN/passwordless with the reviewed `pg_read_all_data` membership.
Do not mint its credential before its protected sink and custody are ready.

Prepared GitHub environment: `production-backup`. Required secret **names only**:
`PRODUCTION_BACKUP_PGHOST`, `PRODUCTION_BACKUP_PGPORT`, `PRODUCTION_BACKUP_PGDATABASE`,
`PRODUCTION_BACKUP_PGUSER`, `PRODUCTION_BACKUP_PGPASSWORD`, `PRODUCTION_BACKUP_R2_ACCOUNT_ID`,
`PRODUCTION_BACKUP_R2_ACCESS_KEY_ID`, `PRODUCTION_BACKUP_R2_SECRET_ACCESS_KEY`.
Variables: `PRODUCTION_BACKUP_BUCKET=zao-rental-prod-backup`, the existing public age recipient,
and `PRODUCTION_BACKUP_ACTIVATION=R4_APPROVED` only after sink/custody/role checks.
No plaintext secret belongs in the Issue, source, review snapshot, shell arguments or output.

First workflow payload after the gate is satisfied:

```json
{"ref":"main","inputs":{"scheduled_at":"<approved canonical UTC occurrence>"}}
```

Use exact accepted main and an authoritative scheduled occurrence. Dump through `neondb_backup`
with verify-full, channel binding and the pinned PostgreSQL18 container/CA bundle. Verify dump structure,
streaming age encryption, encrypted-only R2 upload, deterministic key and plaintext/ciphertext cleanup.
Download and decrypt into an owned disposable restore target, validate migration checksums and business
invariants, measure RPO/RTO, and remove only successful owned disposable resources. A local synthetic
round trip or CI PASS alone is not a Production restore acceptance. Never restore over Production.

The planned hourly scheduler does not itself prove the 300-second RPO target. Verify Neon PITR capability
and a recovery drill, or obtain an explicit revised operations target; do not claim the target from a plan.
After first backup/restore success, enable the existing scheduler and prove one scheduled run. Keep an
operator responsible for failed/missed backup, readiness failure, payment UNKNOWN/blocked, notification
UNKNOWN and overdue returns via the existing workflow/Vercel logs and operations console. Confirm who
receives and handles alerts; no unapproved third-party notification endpoint is added.

## Exact release, final activation and rollback

Before deploy: record main/head/tree, exact review/CI, full source migration registry, environment-name
delta, current alias/protection and accepted rollback ID. This display correction needs no migration,
role or provider configuration change. Set build/runtime `PRODUCTION_RELEASE_ID` and
`VERCEL_GIT_COMMIT_SHA` to exact merged main in the single deployment. Verify READY, source metadata,
alias, `/api/readiness`, normal staff/guest display and unchanged noindex/protection.

For final GO, after the input/acceptance gates above:

1. Verify domain ownership and the exact DNS records returned for `salomonzao.rent` by the existing
   Vercel project. Prepare the actual values immediately before approved DNS work; never guess an IP.
2. Bind/verify that domain and use `PRODUCTION_PUBLIC_ORIGIN=https://salomonzao.rent` for the accepted
   release, retaining protection until protected-host checks pass. No alternate merchant/DB/origin.
3. Install the final Owner record in the existing publication sink:

```json
{"state":"PUBLICATION_APPROVED","origin":"https://salomonzao.rent","releaseId":"<exact accepted source SHA>","approvedBy":"<Owner identifier>","approvedAt":"<Owner GO UTC>"}
```

4. Apply the approved release/alias and protection change once. Verify JA/EN public pages, customer
   checkout, private/API noindex, public robots/sitemap and actual per-isolate publication authority.
   A query, private route or alternate origin must not become indexable. Announce sales only after PASS.
5. On failure, restore protection/sales-off and the recorded accepted deployment; remove publication
   approval. Do not use destructive DB down migrations. For uncertain commits/provider outcomes, read
   durable state first and never repeat a non-idempotent mutation. Preserve F2 evidence and notification hold.

The final proof must enumerate real operations and owner actions still required. Neither reviewer PASS,
successful deployment, correct failure rejection nor synthetic UI success is a claim of public readiness.
