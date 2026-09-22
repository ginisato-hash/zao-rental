// F5 (TD correction): PgPaymentReconciliation must never decide Production vs Sandbox routing
// from a raw `environment` string already sitting in caller-supplied/persisted data — that is the
// same duck-typed mistake F2 closed for the projection permit (production-projection-authority.ts).
// This is the equivalent gate for the reconciliation worker: only an F2 ExactProductionIdentity
// (already proven to be the real pinned Neon/Vercel Production target — production-identity.ts)
// can mint it, and only for the exact merchant already bound to that identity's own validated
// Square payment configuration, never a caller-supplied merchant string.
import {exactProductionIdentityConfiguration, type ExactProductionIdentity} from '../../../auth/src/production-identity';

export type ProductionReconciliationTarget = Readonly<{merchantId: string; database: string}>;
export type ProductionReconciliationAuthority = Readonly<{kind: 'PRODUCTION_RECONCILIATION_AUTHORITY'}>;
const issued = new WeakMap<ProductionReconciliationAuthority, ProductionReconciliationTarget>();

/** The only way to obtain this capability: a genuine ExactProductionIdentity whose bound
 * configuration carries a validated Square PRODUCTION payment binding. Without it,
 * PgPaymentReconciliation's existing Sandbox path is untouched; holding it requires every
 * operation to use the *_production SQL surface (migration 0040) — exactly what a Production
 * payment role (scripts/production-payment-roles.ts) is granted EXECUTE on and nothing else. */
export function issueProductionReconciliationAuthority(identity: ExactProductionIdentity): ProductionReconciliationAuthority {
  const config = exactProductionIdentityConfiguration(identity);
  if (!config || !config.payment || config.payment.provider !== 'SQUARE' || config.payment.environment !== 'PRODUCTION' || !config.payment.merchantId || !config.database?.name) {
    throw new Error('PRODUCTION_RECONCILIATION_AUTHORITY_REQUIRED');
  }
  const authority: ProductionReconciliationAuthority = Object.freeze({kind: 'PRODUCTION_RECONCILIATION_AUTHORITY'});
  issued.set(authority, Object.freeze({merchantId: config.payment.merchantId, database: config.database.name}));
  return authority;
}
export function productionReconciliationTarget(authority?: ProductionReconciliationAuthority): ProductionReconciliationTarget | null {
  return authority ? issued.get(authority) ?? null : null;
}
