// PROD-R7 (integration-corrected) / PROD-R6-A: Production variant of the EXISTING canonical
// payment role architecture (scripts/payment-activation-grants.ts's _pay_receipt/_pay_dispatch/
// _pay_truth/_pay_projection/_pay_diagnostic/_pay_public), never a new role family. Pure SQL-plan
// generation only — no DB access, no password, no CREATE ROLE. Operational provisioning (like
// PROD-R4's backup role), not a schema migration: these roles are real-credential identities,
// created once against the real Production database by an operator, out of band, never in git.
const IDENTIFIER = /^[a-z][a-z0-9_]{2,62}$/;
const ZR_PATTERN = /^zr_[a-f0-9]{12}$/;

export function assertProductionDatabaseName(databaseName: string): void {
  if (!IDENTIFIER.test(databaseName) || ZR_PATTERN.test(databaseName)) throw new Error('PRODUCTION_DATABASE_NAME_INVALID');
}

export function productionPaymentRoleNames(databaseName: string) {
  assertProductionDatabaseName(databaseName);
  return {
    receiver: databaseName + '_pay_receipt',
    dispatcher: databaseName + '_pay_dispatch',
    worker: databaseName + '_pay_truth',
    projector: databaseName + '_pay_projection',
    diagnostic: databaseName + '_pay_diagnostic',
  } as const;
}

/** CREATE ROLE statements only — NOLOGIN, no password, no privilege beyond what a later
 * GRANT statement adds explicitly. An operator flips exactly one of these to LOGIN with a
 * real password, out of band, when that specific credential is actually provisioned. */
export function productionPaymentRoleCreateSql(databaseName: string): string[] {
  const names = productionPaymentRoleNames(databaseName);
  return Object.values(names).map(
    (role) => `CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOREPLICATION NOBYPASSRLS`,
  );
}

/** Grant plan: each role gets exactly the EXECUTE/table access the R6/R7 correction assigned it,
 * generalizing scripts/payment-activation-grants.ts's local-dev grant list to a real Production
 * database name and adding the two Production-only functions this integration introduced
 * (load_context_production/load_contexts_production -> _pay_truth only; dispatch_production/
 * claim_production -> _pay_dispatch/_pay_truth respectively, mirroring the existing
 * dispatch/claim split). No direct table access beyond what _pay_projection already required. */
export function productionPaymentActivationGrants(databaseName: string): string[] {
  const names = productionPaymentRoleNames(databaseName);
  return [
    `GRANT CONNECT ON DATABASE ${databaseName} TO ${names.receiver},${names.dispatcher},${names.worker},${names.projector},${names.diagnostic}`,
    `GRANT USAGE ON SCHEMA square_webhook TO ${names.receiver}`,
    `GRANT EXECUTE ON FUNCTION square_webhook.receive(text,text,text,text,text,text) TO ${names.receiver}`,
    `GRANT USAGE ON SCHEMA payment_reconciliation TO ${names.dispatcher},${names.worker},${names.diagnostic}`,
    `GRANT EXECUTE ON FUNCTION payment_reconciliation.dispatch(text,integer),payment_reconciliation.dispatch_production(text,integer) TO ${names.dispatcher}`,
    `GRANT EXECUTE ON FUNCTION payment_reconciliation.claim(text,text,integer),payment_reconciliation.claim_production(text,integer,text),payment_reconciliation.finalize(uuid,uuid,bigint,text,text,integer,jsonb),payment_reconciliation.load_context(text,text,text),payment_reconciliation.load_contexts(text,uuid[]),payment_reconciliation.load_context_production(text,text,text),payment_reconciliation.load_contexts_production(text,uuid[]) TO ${names.worker}`,
    `GRANT EXECUTE ON FUNCTION payment_reconciliation.diagnostics(text,integer) TO ${names.diagnostic}`,
    `GRANT USAGE ON SCHEMA public,payment_projection,payment_reconciliation TO ${names.projector}`,
    `GRANT SELECT(id,owner_id,hold_id,quote_id,conditions,price_snapshot,price_sha256,mode,state,confirmed_at,version) ON rental_bookings TO ${names.projector}`,
    `GRANT SELECT ON rental_payment_attempts,inventory_holds,inventory_claims,wear_claims,wear_pools,ledger_assets,ledger_poles,ledger_variants,ledger_models,transfer_pieces,transfer_batches TO ${names.projector}`,
    `GRANT SELECT(id,actor,hold_id,conditions,snapshot,snapshot_sha256,coupon_id) ON price_quotes TO ${names.projector}`,
    `GRANT UPDATE(state,confirmed_at,version) ON rental_bookings TO ${names.projector}`,
    `GRANT UPDATE(state,provider_id,provider_state,provider_updated_at,completed_at,updated_at) ON rental_payment_attempts TO ${names.projector}`,
    `GRANT UPDATE(payment_state,confirmed_at,version) ON inventory_holds TO ${names.projector}`,
    `GRANT SELECT,INSERT ON payment_projection.heads,payment_projection.events,payment_projection.job_receipts TO ${names.projector}`,
    `GRANT UPDATE(revision,last_observation) ON payment_projection.heads TO ${names.projector}`,
    `GRANT USAGE ON SEQUENCE payment_projection.events_id_seq TO ${names.projector}`,
    `GRANT EXECUTE ON FUNCTION inventory_clock(),payment_projection.lock_source(uuid),payment_reconciliation.valid_observation(jsonb) TO ${names.projector}`,
  ];
}
