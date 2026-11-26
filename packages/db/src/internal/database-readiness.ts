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
    // Never the driver message (it can carry host, role or credential text): only a fixed code, else a fixed enum.
    const code = (e as { code?: unknown } | null)?.code, text = e instanceof Error ? e.message : '';
    return { status: 'FAILED', reason: /^[A-Z][A-Z0-9]*_[A-Z0-9_]{1,78}$/.test(text) ? text : typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) ? 'SQLSTATE_' + code : 'DATABASE_READINESS_FAILED' };
  } finally {
    await pool?.end().catch(() => {});
  }
}
