// F5 (TD correction): PgPaymentReconciliation must never decide Production vs Sandbox routing
// from a raw `environment` string already sitting in caller-supplied/persisted data — that is the
// same duck-typed mistake F2 closed for the projection permit (production-projection-authority.ts).
// This is the equivalent gate for the reconciliation worker: only an F2 ExactProductionIdentity
// (already proven to be the real pinned Neon/Vercel Production target — production-identity.ts)
// can mint it, and only for the exact merchant already bound to that identity's own validated
// Square payment configuration, never a caller-supplied merchant string.
import {exactProductionIdentityConfiguration, type ExactProductionIdentity} from '../../../auth/src/production-identity';
import type {ProductionConfiguration} from '../../../auth/src/production-config';

export type ProductionReconciliationTarget = Readonly<{merchantId: string; database: string}>;
export type ProductionReconciliationAuthority = Readonly<{kind: 'PRODUCTION_RECONCILIATION_AUTHORITY'}>;
const issued = new WeakMap<ProductionReconciliationAuthority, ProductionReconciliationTarget>();

/** V4 (TD correction): pure — operates on a plain ProductionConfiguration directly, no
 * ExactProductionIdentity capability needed. Proves the validation rule itself without needing a
 * real, capability-minted identity (impossible to construct in a test with no test-only issuer
 * anywhere). Returns the target fields it would bind, or null if the config doesn't qualify. */
export function deriveProductionReconciliationTarget(config: Readonly<ProductionConfiguration>): ProductionReconciliationTarget | null {
  if (!config.payment || config.payment.provider !== 'SQUARE' || config.payment.environment !== 'PRODUCTION' || !config.payment.merchantId || !config.database?.name) return null;
  return {merchantId: config.payment.merchantId, database: config.database.name};
}

/** The only way to obtain this capability: a genuine ExactProductionIdentity whose bound
 * configuration carries a validated Square PRODUCTION payment binding. Without it,
 * PgPaymentReconciliation's existing Sandbox path is untouched; holding it requires every
 * operation to use the *_production SQL surface (migration 0040) — exactly what a Production
 * payment role (scripts/production-payment-roles.ts) is granted EXECUTE on and nothing else. */
export function issueProductionReconciliationAuthority(identity: ExactProductionIdentity): ProductionReconciliationAuthority {
  const config = exactProductionIdentityConfiguration(identity);
  const derived = config && deriveProductionReconciliationTarget(config);
  if (!derived) throw new Error('PRODUCTION_RECONCILIATION_AUTHORITY_REQUIRED');
  const authority: ProductionReconciliationAuthority = Object.freeze({kind: 'PRODUCTION_RECONCILIATION_AUTHORITY'});
  issued.set(authority, Object.freeze(derived));
  return authority;
}
export function productionReconciliationTarget(authority?: ProductionReconciliationAuthority): ProductionReconciliationTarget | null {
  return authority ? issued.get(authority) ?? null : null;
}
