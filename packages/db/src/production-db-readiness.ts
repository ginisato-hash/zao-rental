// F1-B (TD correction): DB connectivity/identity proof must never be conflated with "the dark
// hosting composition reached READY" — with every business flag off, composeProductionRuntime
// opens zero connections, so its READY state proves nothing about the database at all. This is
// the separate, explicit, read-only probe that actually proves it: connect as the least-privilege
// `content_read` Production role (scripts/production-app-roles.ts), verify its identity/privilege
// floor with the existing verifyProductionDatabase(), read the applied migration count, then
// close. Zero writes. Zero Square/R2/notification IO.
import type {Pool} from 'pg';
import {migrationPlan} from './index';
import {connectProductionDatabase, verifyProductionDatabase, type ProductionDatabaseCredential} from './production-connection';
import {exactProductionIdentityConfiguration, type ExactProductionIdentity} from '../../auth/src/production-identity';
import type {ProductionConfiguration} from '../../auth/src/production-config';

export type ProductionDbReadiness =
  | { status: 'CONNECTED'; migrationsApplied: number; migrationsExpected: number; schemaComplete: boolean }
  | { status: 'FAILED'; reason: string };

/** V4 (TD correction): pure work function — operates on a plain `ProductionConfiguration`
 * directly, no `ExactProductionIdentity` capability needed (impossible to construct in a test
 * with no test-only issuer anywhere). This is where the actual connect/verify/read-migration-
 * count logic lives, fully real-PostgreSQL-testable against a disposable local database (named
 * `neondb` to match `EXPECTED_PRODUCTION_DATABASE_NAME`, per the transport-injection pattern
 * below) without ever needing a real identity or the real hostname.
 *
 * `connect` defaults to the real, TLS-enforcing `connectProductionDatabase` — production callers
 * never pass it. It exists only so a local real-PostgreSQL test can substitute a plain `Pool`
 * (no real Neon TLS certificate exists to test against locally), exactly the same injectable-
 * connect pattern `ProductionRuntimeInput.connect`/`composeProductionRuntime` already establish
 * for the identical problem — see tests/readiness/normal-production-fixture.ts. Transport
 * injection only; there is no identity/authority injection anywhere in this module. */
export async function probeConfiguredDatabaseReadiness(
  c: Readonly<ProductionConfiguration>,
  credential: ProductionDatabaseCredential,
  connect: typeof connectProductionDatabase = connectProductionDatabase,
): Promise<ProductionDbReadiness> {
  let pool: Pool | undefined;
  try {
    pool = await connect(c, 'content_read', credential);
    await verifyProductionDatabase(pool, c, 'content_read');
    const row = (await pool.query('SELECT count(*)::int n FROM foundation_migrations')).rows[0] as { n: number };
    return {
      status: 'CONNECTED',
      migrationsApplied: row.n,
      migrationsExpected: migrationPlan.length,
      schemaComplete: row.n === migrationPlan.length,
    };
  } catch (e) {
    return { status: 'FAILED', reason: e instanceof Error ? e.message : 'UNKNOWN' };
  } finally {
    await pool?.end().catch(() => {});
  }
}

/** Never called from bootstrapProductionRuntime()/instrumentation.ts — this is its own,
 * independently-invoked operational check, exactly like Phase D's bootstrap runbook.
 *
 * V3-C/V4 (TD correction): takes an already-issued `ExactProductionIdentity` rather than an
 * arbitrary `ProductionConfiguration` — the same capability-parameter shape
 * `productionProjectionPermit`/`issueProductionReconciliationAuthority` already require, so this
 * can never be pointed at an unverified target; only a config that already passed the real,
 * override-free `issueExactProductionIdentity` reaches the connection attempt at all. This thin
 * wrapper's own accept path is provable only in the real Production environment; its actual
 * connect/verify logic is proven separately and fully via `probeConfiguredDatabaseReadiness` above. */
export async function probeProductionDatabaseReadiness(
  identity: ExactProductionIdentity,
  credential: ProductionDatabaseCredential,
  connect: typeof connectProductionDatabase = connectProductionDatabase,
): Promise<ProductionDbReadiness> {
  const c = exactProductionIdentityConfiguration(identity);
  if (!c) return { status: 'FAILED', reason: 'PRODUCTION_IDENTITY_REQUIRED' };
  return probeConfiguredDatabaseReadiness(c, credential, connect);
}
