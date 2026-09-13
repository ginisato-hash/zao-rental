# P5 acceptance and remaining launch gates

Night deadline remains 2026-09-14 08:00 JST / 2026-09-13 23:00 UTC. P5 starts0/2 at
implementation; final exact-head review records supersede that count. No P5 merge.

| Area | Executable evidence | What this does not prove |
|---|---|---|
| A recovery | `test:booking-recovery`, `test:booking-recovery-ui`; real PostgreSQL, normal Next POST/cookie/read UI; in-memory delivery enrollment | Real email ownership/delivery, support recovery, production secret/ingress |
| B rehearsal | `test:production-rehearsal`; real production-mode process, owned PG, restart and cold restore; built Next fail closed | Vercel, real TLS ingress, hot backup, off-host/PITR |
| C preflight | `production:preflight`, unit contract, exact GitHub read-only gate evidence | Production authorization or provider acceptance |
| D ingress | `p5-ingress.test.ts`, existing `test:integration-p2` same-NAT quota | Real Vercel header/peer provenance |
| E Square | `sandbox-preflight.test.ts`, activation harness + `test:activation-p4` durable20/5 process restart | Actual Square/tokenization/webhook registration/refund reconciliation |
| F storage | R2 SDK handler, rotation, provider-media and backup port tests | Actual R2/CDN credentials/purge/backup |
| G hygiene | `test-hygiene.test.ts`, each verified-command/full verify cleanup receipt | Permission boundary, deletion authority for failed/unknown resources |
| H observations | Existing staff diagnostic, wear mixed full regression | Root-cause resolution from later success alone |

`npm run verify` executes all existing unit/reference/auth/ledger/HOLD/transfer/pricing/
recommendation/A-G/payment/custody/late-pickup/wear/public/20-person/SEO regressions plus
P5 recovery/rehearsal. No skipped future feature is counted complete. Tests use synthetic
contacts ending example.invalid, no real inventory or people. Viewport320/390/430/768 is
browser emulation, not a physical iPhone/Android result. Code/test result histories,
failures and final CI/review are linked in the final status/PR comment.

## Reproduce without external services

1. In this dedicated checkout run `npm run setup` once, then `npm run verify` with at
   least4GiB free. It binds only loopback owned ports and stops its processes.
2. For a focused check, run `node scripts/verified-command.mjs test:booking-recovery`.
   UI/rehearsal require the current `npm run build`; no manual credentials are needed.
3. `npm run --silent production:preflight -- --offline` emits machine JSON/human summary
   and expected exit2. Omit offline for existing read-only GitHub verification.
4. Do not connect real email/Square/R2 or set production guest/access secrets from these
   fixture instructions. The normal runtime remains503 until approved composition exists.

## Activation sequence after separate Owner decisions

- Sandbox application still UNCONFIRMED, secret store UNSELECTED/UNCONFIGURED, receiver
  NOT_CREATED. Prepare metadata with actual verified merchant and two locations; resolve
  secrets exclusively in an approved server store. Freeze the durable real20/5 journal
  before any future real request. Rotation: stage active+retiring metadata with explicit
  grace, validate both signatures in Sandbox, retire old key after observed safe cutoff;
  unknown/auth/quota/budget mismatch stops. No fixtures reset real trial limits.
- Select/validate real email delivery idempotency+lookup and lost-proof support policy;
  no email-address-only route is an authentication factor. Review original due-based
  access expiry against final privacy policy before launch.
- Verify Vercel direct peer provenance/strip-overwrite behavior at actual deployed ingress;
  any missing identity stays fail closed. No reverse proxy is silently allowed.
- R2 credentials/rights ownership/purge receipts, actual encrypted off-host backup+PITR,
  RPO<=5min/RTO<=4h/retention30days remain external acceptance, not achieved SLA.
- Still Owner pending: tax, sales period, cleaning time, formal NAP, final legal/delayed
  pickup wording, media rights, real Salomon/inventory, domain/deploy. Independent coupon
  remainsOFF; existing early-payment5% rule unchanged. Real phones/CWV and external
  Search Console/GBP/ZAO listing are not performed.

## Historical observations retained

CI34749426170 staff-create HTTP500 and CI34756544102 wear mixed transport remain
historical unresolved observations. No root cause is claimed from later passing runs.
P5 development encountered test-only initdb marker placement, restart-navigation timing
and Next requested-SIGTERM143 assertion issues; exact failed logs/resources are retained.
The navigation failures' detailed browser transport cause is unproven; the existing
close-tab/restart/new-tab same-context control pattern now explicitly tests restart.
R2 credential-rotation counterexample is a distinct confirmed code defect: the original
SDK client reused FIRST credential for the second operation; the operation-scoped fix
passes the same FIRST/SECOND expectation. It is not an actual R2 observation.
