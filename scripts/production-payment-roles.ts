// PROD-R7 (integration-corrected) / PROD-R6-A/F4: Production variant of the EXISTING canonical
// payment role architecture (scripts/payment-activation-grants.ts's _pay_receipt/_pay_dispatch/
// _pay_truth/_pay_projection/_pay_diagnostic/_pay_public), never a new role family. Pure SQL-plan
// generation only — no DB access, no password, no CREATE ROLE. Operational provisioning (like
// PROD-R4's backup role), not a schema migration: these roles are real-credential identities,
// created once against the real Production database by an operator, out of band, never in git.
//
// F4 (TD correction): unlike the local-only R14/R15 dev roles (which intentionally keep the
// generic dispatch()/claim()/load_context()/load_contexts()/receive()/diagnostics() grants
// alongside the targeted ones, since local disposable clusters need both for different test
// scenarios), a real Production credential is granted EXECUTE only on the *_production
// (migration 0040) functions. The generic Sandbox-capable functions are structurally
// unreachable from any Production role — not by convention, but because no GRANT exists.
const IDENTIFIER = /^[a-z][a-z0-9_]{2,62}$/;
const ZR_PATTERN = /^zr_[a-f0-9]{12}$/;
// F10 (TD correction): a PostgreSQL identifier is 63 bytes; beyond that Postgres silently
// truncates rather than erroring, which could make two intended-distinct role names collide
// without any visible failure. Every generated name — not just the caller-supplied database
// name — is validated against this exact 63-byte contract before it is ever used in SQL.
const MAX_IDENTIFIER_BYTES = 63;

export function assertProductionDatabaseName(databaseName: string): void {
  if (!IDENTIFIER.test(databaseName) || ZR_PATTERN.test(databaseName)) throw new Error('PRODUCTION_DATABASE_NAME_INVALID');
}
function assertIdentifierLength(name: string): void {
  if (Buffer.byteLength(name, 'utf8') > MAX_IDENTIFIER_BYTES) throw new Error('PRODUCTION_ROLE_NAME_TOO_LONG');
}

export function productionPaymentRoleNames(databaseName: string) {
  assertProductionDatabaseName(databaseName);
  const names = {
    receiver: databaseName + '_pay_receipt',
    dispatcher: databaseName + '_pay_dispatch',
    worker: databaseName + '_pay_truth',
    projector: databaseName + '_pay_projection',
    diagnostic: databaseName + '_pay_diagnostic',
  } as const;
  for (const name of Object.values(names)) assertIdentifierLength(name);
  return names;
}

/** CREATE ROLE statements only — NOLOGIN, no password, no privilege beyond what a later GRANT
 * statement adds explicitly. An operator flips exactly one of these to LOGIN with a real
 * password, out of band, when that specific credential is actually provisioned.
 *
 * F11 (TD correction): NOINHERIT, matching this project's existing canonical local role design
 * (scripts/payment-activation-grants.ts's own local provisioning uses NOINHERIT) — none of these
 * roles are ever granted membership in another role, so INHERIT vs NOINHERIT makes no functional
 * difference to their own direct GRANTs today, but NOINHERIT is the safer default: it fails
 * closed against any future accidental membership grant silently taking effect. (The one role in
 * this codebase that legitimately needs INHERIT — the R4 backup role, which relies on
 * pg_read_all_data membership being active on connection alone — is deliberately NOT this
 * pattern; see scripts/production-backup-role.ts's own comment for why.) */
export function productionPaymentRoleCreateSql(databaseName: string): string[] {
  const names = productionPaymentRoleNames(databaseName);
  return Object.values(names).map(
    (role) => `CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS`,
  );
}

/** Grant plan: each role gets EXECUTE only on the Production-scoped (migration 0040) function it
 * needs, never the generic Sandbox-capable equivalent. No direct table access beyond what
 * _pay_projection already required (unchanged from before — the projection role's grants were
 * never Sandbox-specific to begin with, since business-table privileges don't carry an
 * environment). */
export function productionPaymentActivationGrants(databaseName: string): string[] {
  const names = productionPaymentRoleNames(databaseName);
  return [
    `GRANT CONNECT ON DATABASE ${databaseName} TO ${names.receiver},${names.dispatcher},${names.worker},${names.projector},${names.diagnostic}`,
    `GRANT USAGE ON SCHEMA square_webhook TO ${names.receiver}`,
    `GRANT EXECUTE ON FUNCTION square_webhook.receive_production(text,text,text,text,text) TO ${names.receiver}`,
    `GRANT USAGE ON SCHEMA payment_reconciliation TO ${names.dispatcher},${names.worker},${names.diagnostic}`,
    `GRANT EXECUTE ON FUNCTION payment_reconciliation.dispatch_production(text,integer) TO ${names.dispatcher}`,
    `GRANT EXECUTE ON FUNCTION payment_reconciliation.claim_production(text,integer,text),payment_reconciliation.finalize_production(uuid,uuid,bigint,text,text,integer,jsonb),payment_reconciliation.load_context_production(text,text,text),payment_reconciliation.load_contexts_production(text,uuid[]) TO ${names.worker}`,
    `GRANT EXECUTE ON FUNCTION payment_reconciliation.diagnostics_production(integer) TO ${names.diagnostic}`,
    `GRANT USAGE ON SCHEMA public,payment_projection,payment_reconciliation TO ${names.projector}`,
    `GRANT SELECT(id,owner_id,hold_id,quote_id,conditions,price_snapshot,price_sha256,mode,state,confirmed_at,version) ON rental_bookings TO ${names.projector}`,
    `GRANT SELECT ON rental_payment_attempts,inventory_holds,inventory_claims,wear_claims,wear_pools,ledger_assets,ledger_poles,ledger_variants,ledger_models,transfer_pieces,transfer_batches TO ${names.projector}`,
    `GRANT SELECT(id,actor,hold_id,conditions,snapshot,snapshot_sha256,coupon_id,book_id) ON price_quotes TO ${names.projector}`,
    `GRANT SELECT(id,revision,source_sha256,table_jpy,state) ON price_books TO ${names.projector}`,
    `GRANT SELECT ON provisional_capacity_claims,provisional_capacity_buckets TO ${names.projector}`,
    `GRANT UPDATE(state,confirmed_at,version) ON rental_bookings TO ${names.projector}`,
    `GRANT UPDATE(state,provider_id,provider_state,provider_updated_at,completed_at,updated_at) ON rental_payment_attempts TO ${names.projector}`,
    `GRANT UPDATE(payment_state,confirmed_at,version) ON inventory_holds TO ${names.projector}`,
    `GRANT SELECT,INSERT ON payment_projection.heads,payment_projection.events,payment_projection.job_receipts TO ${names.projector}`,
    `GRANT UPDATE(revision,last_observation) ON payment_projection.heads TO ${names.projector}`,
    `GRANT USAGE ON SEQUENCE payment_projection.events_id_seq TO ${names.projector}`,
    `GRANT EXECUTE ON FUNCTION inventory_clock(),payment_projection.lock_source(uuid),payment_reconciliation.valid_observation(jsonb) TO ${names.projector}`,
  ];
}
