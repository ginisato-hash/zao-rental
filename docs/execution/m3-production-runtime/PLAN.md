# Production HOLD and payment projection admission

The canonical Production HOLD role could not execute the read-only provisional quantity function. The attended projector also called the development-only source reader, which rejects the real database. The restricted-role regression reproduces both failures.

The change grants only the existing quantity reader to HOLD, adds the exact Production job/merchant/payment reader in0051, and replaces the projector's development reader grant. Stream then job locking preserves reconciliation ordering. Startup and attended preflight invoke their actual readers with a null target, without business writes. Historical0001–0050 and Sandbox functions remain unchanged.

## Attended deployment order

1. Freeze one candidate; targeted and full local verification, secret scan and Foundation CI must pass. Reconcile main and squash merge under current Owner authority.
2. Prepare the exact clean main release before the short protected migration/deploy window. Current readiness requires exactly the source migration count, so applying0051 makes an older50-migration deployment unready until the51-migration release is deployed.
3. Run `production:repair-payment-runtime` once, with the existing pinned owner URL supplied through `PRODUCTION_PAYMENT_MIGRATION_DATABASE_URL` in process memory. No URL/credential in argv, logs, evidence or repository. The CLI requires fresh main, verified TLS and exact database/current user/session user/database owner identity.
4. The fixed transaction admits the exact50 registry checksums, absent0051, existing inert payment roles and previous narrow grants. It applies0051, adds the Production-reader/HOLD-reader grants, revokes the development-reader grant, and records the canonical checksum. No role/password/business-row change occurs.
5. Read back the51 registry entries and exact function/grant delta. Any `COMMIT_UNKNOWN_READBACK_REQUIRED` result permits read-only reconciliation only; never blindly rerun. No destructive down migration is supplied.
6. Perform the one authorized exact-main deployment, preserving main All Deployments protection and publication OFF. Accept health/readiness/identity and normal commercial guest preparation before activating the finite payment-role window.

No payment, refund, external email, real inventory import, DNS or publication authority is introduced.
