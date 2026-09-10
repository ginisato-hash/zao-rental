import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { migrate, seed, recordTelemetry } from '@rental/db';
import { startIsolatedPostgres } from './postgres';
const db = await startIsolatedPostgres();
let count = 0;
async function check(name: string, fn: () => Promise<void>) { await fn(); count++; console.log(`PASS ${name}`); }
try {
  const result = await db.pool.query('SELECT version(), current_database(), current_user');
  console.log(JSON.stringify({ postgres: result.rows[0].version, database: result.rows[0].current_database, user: result.rows[0].current_user, port: db.identity.dbPort }));
  await check('fresh migration and concurrent replay are idempotent', async () => {
    await Promise.all([migrate(db.pool), migrate(db.pool)]);
    assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM foundation_migrations')).rows[0].n, 1);
  });
  await check('seed is worktree scoped and repeatable', async () => {
    await seed(db.pool, db.identity.namespace); await seed(db.pool, db.identity.namespace);
    assert.deepEqual((await db.pool.query('SELECT * FROM foundation_metadata')).rows, [{ namespace: db.identity.namespace, seed_version: 'foundation-v1' }]);
  });
  await check('concurrent duplicate telemetry records one event', async () => {
    const id = randomUUID();
    await Promise.all(Array.from({ length: 6 }, () => recordTelemetry(db.pool, id, db.identity.namespace, 'foundation.probe')));
    assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM telemetry_events')).rows[0].n, 1);
  });
  await check('SQL constraints reject unsupported event and foreign seed', async () => {
    await assert.rejects(db.pool.query('INSERT INTO telemetry_events(event_id, namespace, name) VALUES ($1,$2,$3)', [randomUUID(), db.identity.namespace, 'customer.email']), { code: '23514' });
    await assert.rejects(recordTelemetry(db.pool, randomUUID(), 'zr_000000000000', 'foundation.probe'), (e: unknown) => e instanceof Error && 'cause' in e && (e.cause as { code?: string }).code === '23503');
  });
  await check('failed transaction leaves no partial event', async () => {
    const client = await db.pool.connect(); const id = randomUUID();
    try { await client.query('BEGIN'); await client.query('INSERT INTO telemetry_events(event_id, namespace, name) VALUES ($1,$2,$3)', [id, db.identity.namespace, 'foundation.probe']); await client.query('ROLLBACK'); }
    finally { client.release(); }
    assert.equal((await db.pool.query('SELECT * FROM telemetry_events WHERE event_id=$1', [id])).rowCount, 0);
  });
  await check('migration checksum drift is rejected', async () => {
    await db.pool.query("UPDATE foundation_migrations SET checksum='tampered' WHERE id='0001'");
    await assert.rejects(migrate(db.pool), /Migration checksum drift/);
  });
  await check('unauthenticated database client is rejected', async () => {
    const denied = new Pool({ host: '127.0.0.1', port: db.identity.dbPort, database: db.identity.database, user: db.identity.user, password: 'deliberately-invalid', connectionTimeoutMillis: 2000 });
    try { await assert.rejects(denied.query('SELECT 1'), { code: '28P01' }); } finally { await denied.end(); }
  });
  console.log(`Integration: ${count} passed; 0 skipped. No booking/payment runtime claims.`);
} finally { await db.stop(); console.log('Owned PostgreSQL process stopped.'); }
