import {migrationPlan} from './index';
import {connectProductionDatabase, type ProductionDatabaseCredential} from './production-connection';
import {readDatabaseReadiness} from './internal/database-readiness';
import {exactProductionIdentityConfiguration, type ExactProductionIdentity} from '../../auth/src/production-identity';
import type {ProductionConfiguration} from '../../auth/src/production-config';

export type ProductionDbReadiness =
  | { status: 'CONNECTED'; migrationsApplied: number; migrationsExpected: number; schemaComplete: boolean }
  | { status: 'FAILED'; reason: string };

/** Pure target facts only. Derivation neither connects nor grants Production authority. */
export function deriveProductionDbReadinessTarget(c: Readonly<ProductionConfiguration>) {
  return Object.freeze({
    service: 'content_read' as const,
    host: c.database.host.trim().toLowerCase(),
    database: c.database.name,
    role: c.database.roles.content_read,
    migrationsExpected: migrationPlan.length,
  });
}

/** Separate read-only operational probe; dark runtime READY is not database evidence.
 * The registered exact identity is checked before even an injected transport is called.
 * Only transport is replaceable; the identity issuer and pinned facts are not injectable. */
export async function probeProductionDatabaseReadiness(
  identity: ExactProductionIdentity,
  credential: ProductionDatabaseCredential,
  connect: typeof connectProductionDatabase = connectProductionDatabase,
): Promise<ProductionDbReadiness> {
  const c = exactProductionIdentityConfiguration(identity);
  if (!c) return { status: 'FAILED', reason: 'PRODUCTION_IDENTITY_REQUIRED' };
  const target = deriveProductionDbReadinessTarget(c);
  return readDatabaseReadiness(c, target.migrationsExpected, () => connect(c, target.service, credential));
}
