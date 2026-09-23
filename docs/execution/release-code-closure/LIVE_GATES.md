# Future attended activation — not executed, not RC approved

This is a code/API invocation plan. Existing dark hosting is retained. This document does
not authorize any credential, schema, provider, deploy, DNS, worker or indexing action.

## Approved code bindings, after all local gates and separate live authorization

Use the existing exact-identity issuer on a validated ProductionConfiguration. Never pass
raw config to readiness I/O, substitute a fake issuer, or log the underlying host/credentials.
Readiness entrypoint: `probeProductionDatabaseReadiness(identity, credential, transport?)`.
Production migration source set is now 0001–0050, not the older runbook's count of 40.
The existing empty-target bootstrap and role plans remain the actual mechanisms:

- `bootstrapProductionSchema(ownerPool, databaseName)` from scripts/production-bootstrap.ts.
- `productionAppRoleCreateSql` / `productionAppRoleGrantSql` and the existing payment-role
  plans. Review SQL and current exact identity before executing; credentials are separate.
- Original operational commands and rollback are in
  ../production-runbooks/PHASE_D_NEON_BOOTSTRAP_RUNBOOK.md and
  ../production-runbooks/PHASE_E_DARK_VERCEL_DEPLOY_RUNBOOK.md. Their old migration counts and
  pre-V5 identity prose are historical; use current migrationPlan and exact identity checks.

Trusted server composition (bindings are provided in memory, never by an HTTP request):

```ts
const runtime = await composeProductionRuntime({
  ...approvedRuntimeInput,
  identity,
  payment: {
    provider: 'SQUARE', environment: 'PRODUCTION',
    merchantId: approvedConfiguration.payment.merchantId,
    applicationId: verifiedPublicSquareApplicationId,
    credentials: resolveProductionSquareCredential,
    gateway: squareProductionGateway,
  },
  refunds: squareRefundGateway,
  notification: {
    environment: 'PRODUCTION', providerId: 'RESEND',
    credentials: resolveResendCredential, fetch: approvedProviderFetch,
  },
  // Omit publication until its separately authorized release approval exists.
});
```

Both Square gateways use the same explicitly bound Production transport. Web card tokens
arrive only in the transient checkout request. The runtime's configuration digest, exact
identity, merchant/location, price pins and DB-role verification still apply. The existing
dark hosting profile does not populate this commercial input; a reviewed server installation
and attended identity acceptance are required. Do not add a request-controlled or env-only
charging bypass to make that installation easier.

Only AFTER cancellation commit, an authorized operator may call:

```ts
await runtime.refundWorker!.dispatch(persistedRefundId);
await runtime.refundWorker!.reconcile(persistedRefundId); // known provider ID only
await runtime.notifications!.dispatch(persistedOutboxId);
await runtime.notifications!.reconcile(persistedOutboxId);
```

These calls perform live provider actions and were NOT executed. Unknown refund without ID
requires verified provider reconciliation; UNKNOWN Resend cannot be looked up by its key and
must not be blindly requeued. Do not activate batch processing, cron or backups here.

Future publication additionally supplies the exact per-release owner approval to runtime:
`{state:'PUBLICATION_APPROVED', origin:'https://salomonzao.rent', releaseId, approvedBy,
approvedAt}`. Verify indexing behavior in each deployed request isolate and roll back to
no approval on any mismatch. A token-shaped object, environment flag, other hostname,
private path or query must not enable indexing. Domain purchase/binding/DNS is a separate
Owner action and remains unperformed.

## Still required before treating this plan as executable release approval

Final release checkpoint and separately authorized live approval; authoritative tax-display wording;
real role/credential identity readback; real stock registration/reconciliation; provider
merchant/application/location/sender verification; deployment protection; separately
approved real charge/refund/mail acceptance; scheduling/backup activation; publication GO.
Provisional materialization remains NOT_ACTIVATED.

## Official provider references used during code work

- https://developer.squareup.com/docs/web-payments/quickstart/add-sdk-to-web-client
- https://developer.squareup.com/reference/square/refunds/refund-payment
- https://developer.squareup.com/docs/refunds-api/retrieve-refunds
- https://resend.com/changelog/idempotency-keys
- https://github.com/resend/resend-openapi/blob/main/resend.yaml
