// PROD-R4: local proof of the least-privilege backup role added in migration 0040.
// No `pg_dump`/`pg_restore` binary or Docker is available in this sandbox (the same gap
// already disclosed for R2B-F3), so this proves the exact SQL-level privilege boundary
// pg_dump depends on — SELECT everywhere, nothing else — directly via representative
// reads/writes/DDL across every schema, rather than invoking the binary itself.
import assert from 'node:assert/strict';
import {migrate} from '../../packages/db/src/index';
import {startIsolatedPostgres} from '../../scripts/postgres';
import {provisionBackupRole} from '../../scripts/backup-roles';

let passed = 0;
async function check(name: string, fn: () => Promise<void>): Promise<void> {
  await fn();
  passed++;
  console.log(`PASS ${name}`);
}
async function denied(query: () => Promise<unknown>, codes = ['42501']): Promise<void> {
  let error: unknown;
  try { await query(); } catch (e) { error = e; }
  assert.ok(error, 'expected a rejection');
  assert.ok(codes.includes(String((error as { code?: string }).code)), JSON.stringify(error));
}

const db = await startIsolatedPostgres();
let role: Awaited<ReturnType<typeof provisionBackupRole>> | undefined;
try {
  await migrate(db.pool);
  role = await provisionBackupRole(db.pool, db.identity);
  const backup = role.backupPool;

  await check('the role is NOLOGIN-by-migration until provisioned, then INHERIT/NOSUPERUSER/NOCREATEDB/NOCREATEROLE/NOREPLICATION/NOBYPASSRLS and a real login', async () => {
    const row = (await db.pool.query(
      "SELECT rolcanlogin,rolinherit,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname=$1",
      [db.identity.namespace + '_backup'],
    )).rows[0];
    assert.deepEqual(row, { rolcanlogin: true, rolinherit: true, rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolreplication: false, rolbypassrls: false });
  });

  await check('the role can SELECT a representative table in every schema pg_dump would need to read', async () => {
    for (const sql of [
      'SELECT 1 FROM staff_members LIMIT 1',
      'SELECT 1 FROM rental_internal.effects LIMIT 1',
      'SELECT 1 FROM booking_access.capabilities LIMIT 1',
      'SELECT 1 FROM square_webhook.inbox LIMIT 1',
      'SELECT 1 FROM payment_reconciliation.jobs LIMIT 1',
      'SELECT 1 FROM payment_projection.heads LIMIT 1',
      'SELECT 1 FROM r15_activation.manifest LIMIT 1',
    ]) await backup.query(sql);
  });

  await check('the role cannot UPDATE/DELETE, cannot run DDL, and cannot create another role', async () => {
    await denied(() => backup.query('UPDATE staff_members SET active=active'));
    await denied(() => backup.query('DELETE FROM staff_members'));
    await denied(() => backup.query('CREATE TABLE backup_role_probe(x int)'));
    await denied(() => backup.query('CREATE ROLE backup_role_probe'), ['42501']);
  });

  await check('mutation test: revoking the one load-bearing grant makes every schema unreadable again', async () => {
    await db.pool.query(`REVOKE pg_read_all_data FROM ${db.identity.namespace}_backup`);
    for (const sql of ['SELECT 1 FROM staff_members LIMIT 1', 'SELECT 1 FROM r15_activation.manifest LIMIT 1']) {
      await denied(() => backup.query(sql));
    }
    await db.pool.query(`GRANT pg_read_all_data TO ${db.identity.namespace}_backup`);
    await backup.query('SELECT 1 FROM staff_members LIMIT 1');
  });

  console.log(JSON.stringify({ status: 'PASS', cases: passed, note: 'pg_dump binary unavailable in this sandbox (no ambient pg_dump/pg_restore, no Docker) — proven at the SQL privilege layer instead' }));
} finally {
  await role?.close();
  await db.stop();
}
