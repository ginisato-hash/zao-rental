import type {Pool} from 'pg';
import type {ProductionConfiguration} from '../../../auth/src/production-config';
import type {ProductionDbReadiness} from '../production-db-readiness';
import {verifyProductionDatabase} from '../production-connection';

/** Internal transport worker, never re-exported as a product API. It has no credentials,
 * default connector, or ability to open a Production connection on its own. The public
 * readiness entrypoint must establish exact identity before supplying the transport.
 * Disposable PostgreSQL tests supply their owned local transport directly here. */
export async function readDatabaseReadiness(
  c: Readonly<ProductionConfiguration>,
  migrationsExpected: number,
  open: () => Promise<Pool>,
): Promise<ProductionDbReadiness> {
  let pool: Pool | undefined;
  try {
    pool = await open();
    await verifyProductionDatabase(pool, c, 'content_read');
    const row = (await pool.query('SELECT count(*)::int n FROM foundation_migrations')).rows[0] as { n: number };
    return { status: 'CONNECTED', migrationsApplied: row.n, migrationsExpected, schemaComplete: row.n === migrationsExpected };
  } catch (e) {
    return { status: 'FAILED', reason: e instanceof Error ? e.message : 'UNKNOWN' };
  } finally {
    await pool?.end().catch(() => {});
  }
}
