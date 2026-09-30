# M3-A infrastructure plan — not executed

Read-only inventory on 2026-09-30 against the fixed Production Neon identity and
the existing Square application. This plan does not reopen M2 or authorize writes.

## Observed state

- Main `c103ed31e39b4863fc29db36f4d1e15e22d3283d`; clean worktree; open PRs 0 at inventory.
- Main project `prj_ehUMOzM77em9DVnHJBJffncD5hg7` remains All Deployments protected;
  `PRODUCTION_PUBLICATION_APPROVAL` absent.
- MOUNTAIN_BASE `L7DTZS1NQNXVM` and ONSEN_BASE `L92QF5DCVN0B8` both ACTIVE, exact
  merchant, both `CREDIT_CARD_PROCESSING` and `AUTOMATIC_TRANSFERS`. The earlier
  Onsen capability uncertainty is resolved by this new readback. First payment
  still uses Mountain pickup and return only.
- Square webhook subscriptions: 0. No equivalent subscription to reuse currently.
- No Production dedicated ingress project. The separate historical Sandbox
  project is `prj_whzxwR1vj0CBBnm1UD6dz5ALPMbA`, `zao-rental-webhook-sandbox`, root
  `apps/webhook-ingress`, hostname `zao-rental-webhook-sandbox.vercel.app`, protection
  `all_except_custom_domains`, no env entries and no Production deployments. Do
  not repurpose it or the main app.
- Five `neondb_pay_*` roles exist; all NOLOGIN, password absent, VALID UNTIL null.
  No superuser, create DB/role, inherit, replication, bypass RLS, or outbound role
  membership. `neondb_role_admin` has inbound admin-option membership in each.
- Canonical direct grants match `productionPaymentActivationGrants('neondb')`:
  82 normalized database/schema/function/table/column privilege entries; no
  missing or unexpected entries. All 35 generic-function effective EXECUTE checks
  deny access. No PUBLIC leakage on inspected payment tables/functions.

## A. Payment roles and secure credentials

Roles: `neondb_pay_receipt`, `neondb_pay_dispatch`, `neondb_pay_truth`,
`neondb_pay_projection`, `neondb_pay_diagnostic`.

1. Under later explicit approval, re-read exact host/database, role flags,
   password-presence metadata, grants, and memberships. Drift or a newly present
   unknown credential stops activation; never drop/recreate or blindly rotate.
2. Current required role creates: 0. Current grant corrections: 0. Preserve the
   canonical plan, including Production-scoped functions only. If state changed,
   show the exact new delta before authorizing a different mutation set.
3. Through the established role-admin provisioning authority, set one fresh
   independent random credential for each currently passwordless role and enable
   LOGIN with an explicit two-hour UTC expiry. Five initial credential/LOGIN
   activations; no R3 credential changes. Secrets travel directly from generation
   to approved secure sinks; no values in evidence, command arguments or SQL logs.
4. Receiver URL goes only to the dedicated ingress Production Sensitive
   `PRODUCTION_RECEIVER_DATABASE_URL`. The four operator-role URLs and a receiver
   preflight copy go to an owner-only 0600 operator input outside Git. If the
   existing operations credential is needed for CancellationRefundWorker, obtain
   it from its approved source without rotation or substituting it for a pay role.
5. Probe each as itself with authenticated TLS/verify-full, exact current_user and
   current_database, role flags/ownership/membership checks, positive required
   EXECUTE metadata, and negative generic EXECUTE/table/DDL privileges. Run the
   finite CLI preflight. No owner connection is used for payment processing.
6. On partial failure: stop provider work, disable LOGIN for only newly activated
   pay roles and revoke/remove their task credentials/sinks. Do not touch R3,
   delete durable payment evidence, or weaken grants. After acceptance, retain
   receiver access only for the explicitly approved delivery/reconciliation window;
   disable the five LOGINs and remove task secret copies when that window ends.
   Pending/UNKNOWN beyond expiry requires manual assessment, never an automatic
   credential extension, new payment, or new refund.

## B. Dedicated ingress project and deployment

Planned project name: `zao-rental-webhook-production`, existing team
`team_PVka5z4T6OMKBmUcqrK09yJz`, root `apps/webhook-ingress`, Node 24, canonical
`apps/webhook-ingress/vercel.json`, classification `PRODUCTION_WEBHOOK_INGRESS_ONLY`.

Frozen planned notification URL:

`https://zao-rental-webhook-production.vercel.app/api/webhooks/square`

This hostname is not allocated yet. The later project creation must read back this
exact hostname; a collision/different assignment is a stop, not an automatic URL
or signature change. Create one new project and make one Production ingress
deployment from the accepted merged source. Run `npm run build:ingress` first and
verify the canonical generated runtime.cjs is in the CLI upload (it is ignored by
Git, but not by the root .vercelignore). Do not use the main app as ingress.

The dedicated project must admit Square without interactive Authentication. Only
`GET /health` and `POST /api/webhooks/square` are application surfaces; other paths
404. Preserve no-store/noindex. Main All Deployments protection remains unchanged.

Dedicated env matrix (Production only):

| Name | Type |
| --- | --- |
| PRODUCTION_WEBHOOK_INGRESS_CLASSIFICATION | encrypted, fixed classification |
| PRODUCTION_SQUARE_MERCHANT_ID | encrypted, exact readback merchant |
| PRODUCTION_SQUARE_WEBHOOK_NOTIFICATION_URL | encrypted, frozen URL |
| PRODUCTION_SQUARE_WEBHOOK_SIGNATURE_KEY | Sensitive, returned subscription key |
| PRODUCTION_RECEIVER_DATABASE_URL | Sensitive, receipt role / verify-full |

Vercel's Production target/domain system values must match. No Square access token,
Sandbox credentials, R3 app keys, Resend key, or publication approval in ingress.
Read metadata only after installation. Validate classification, path restrictions,
signature rejection, unavailable storage behavior and one authorized signed test.

## C. Square subscription

Re-list immediately before a later write. Reuse an exact equivalent if it appeared;
otherwise create exactly one subscription using the application personal token:

```
name: ZAO Rental Production Payments
event_types: [payment.created, payment.updated]
api_version: 2026-08-19
notification_url: https://zao-rental-webhook-production.vercel.app/api/webhooks/square
enabled: true
```

Sequence: prepare project and DB credentials; create the subscription; transfer its
returned signature key directly to the ingress Sensitive sink; deploy once; verify
readiness and one signed test delivery before any real payment. No real payment is
allowed during this setup window. Never expose the key. Current planned subscription
mutation budget is one create, zero updates; test-delivery budget is one.

Existing receiver contract is retained: unmodified raw bytes, 64 KiB cap, HMAC over
exact URL + body, exact merchant, supported payment events only, signed unsupported
events ignored with 200, durable COMMIT before 200, duplicate 200, hash conflict 409,
storage unavailable 503, no provider lookup or booking mutation in the receiver.

## D/E. Live booking and refund — external data blocker

Observed in the exact Production database: price_books=0, price_activations=0,
ledger_models=0, ledger_variants=0, ledger_assets=0, ledger_poles=0, active
provisional_capacity_buckets=0. There is no currently available complete equipment
selection and no active approved commercial pricebook to quote.

Consequently `LIVE_TEST_CONFIGURATION` and `EXPECTED_LIVE_CHARGE_JPY` cannot be
frozen, and the expected full refund cannot be stated as an exact JPY amount.
Do not substitute the source table's arithmetic for an actual available Production
quote, fabricate inventory, edit prices, or create a 1-yen direct Square charge.

The pending scenario constraints remain: Mountain pickup/return, one adult,
Regular, smallest legitimate available complete equipment, future date comfortably
more than 48 hours away, no fake coupon. Select dates/products/amount only after
approved commercial pricebook/catalog/inventory activation is independently
authorized and confirmed. That activation is outside M3-A's live-write authority.

## F. Later live gate and containment

Only once the missing data makes D/E exact may the combined
`STOP_M3_LIVE_MUTATION_AND_MONEY_GATE` be presented. It must bind the reviewed
source merge/release identity, A–C mutations, exact one payment amount, exact full
refund, and the budgets: payment POST <=1, refund POST <=1, subscription create <=1,
test delivery <=1. A source PR is not merge/deploy or live-money authorization.

After the single payment: persisted reconciliation truth -> CONFIRMED -> guest
cancellation before the 48-hour boundary -> durable automatic cancellation refund
row -> one refund POST -> COMPLETED/PENDING; PENDING uses GET only. UNKNOWN never
permits a second POST. Emails, DNS, publication approval and indexing stay OFF.

M3-A cannot be called COMPLETE while D/E are unavailable. All work in this tranche
is source/local verification or read-only inventory; no Production DB writes,
provider configuration writes or real financial transactions are performed.
