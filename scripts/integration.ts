import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import { migrate, migrationPlan, seed, recordTelemetry } from '@rental/db';
import { startIsolatedPostgres } from './postgres';
const db = await startIsolatedPostgres();
let count = 0;
async function check(name: string, fn: () => Promise<void>) { await fn(); count++; console.log(`PASS ${name}`); }
try {
  const result = await db.pool.query('SELECT version(), current_database(), current_user');
  console.log(JSON.stringify({ postgres: result.rows[0].version, database: result.rows[0].current_database, user: result.rows[0].current_user, port: db.identity.dbPort }));
  await check('fresh migration and concurrent replay are idempotent', async () => {
    await Promise.all([migrate(db.pool), migrate(db.pool)]);
    assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM foundation_migrations')).rows[0].n, migrationPlan.length);
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
} finally { await db.stop(); console.log('Owned PostgreSQL process stopped.'); }

// A second fresh owned cluster keeps the initial-concurrency test above independent.
// The only object removed below is this test's own collision fixture, never an existing schema.
// Pool constructor options are inherited by every physical client, including replacements.
const recovery = await startIsolatedPostgres({ statementTimeoutMs: 5000 });
try {
  await check('failed initial migration rolls back DDL and ledger, releases lock, then recovers', async () => {
    // Reserve another backend BEFORE migrate() so the lock probe cannot accidentally use
    // the migrator's own backend (PostgreSQL advisory locks are reentrant per session).
    const observer = await recovery.pool.connect();
    try {
      await observer.query('CREATE TABLE telemetry_events (sentinel text)');
      await observer.query("INSERT INTO telemetry_events VALUES ('test-owned-collision')");
      // Migration creates its ledger and metadata first, then hits this name collision.
      await assert.rejects(migrate(recovery.pool), { code: '42P07' });
      const state = await observer.query("SELECT to_regclass('foundation_migrations') AS ledger, to_regclass('foundation_metadata') AS metadata");
      assert.deepEqual(state.rows[0], { ledger: null, metadata: null });
      assert.deepEqual((await observer.query('SELECT sentinel FROM telemetry_events')).rows, [{ sentinel: 'test-owned-collision' }]);
      await observer.query('BEGIN');
      try {
        assert.equal((await observer.query('SELECT pg_try_advisory_xact_lock(71820401) AS acquired')).rows[0].acquired, true);
      } finally { await observer.query('ROLLBACK'); }
      await observer.query('DROP TABLE telemetry_events');
    } finally { observer.release(); }
    await migrate(recovery.pool);
    await migrate(recovery.pool);
    assert.deepEqual((await recovery.pool.query('SELECT id FROM foundation_migrations ORDER BY id')).rows, [{ id: '0001' }, { id: '0002' }, { id: '0003' }, { id: '0004' }, { id: '0005' }, { id: '0006' }, { id: '0007' }, { id: '0008' }, { id: '0009' }, { id: '0010' }, { id: '0011' }, { id: '0012' }, { id: '0013' }, { id: '0014' }, { id: '0015' }, { id: '0016' }, { id: '0017' }, { id: '0018' }, { id: '0019' }, { id: '0020' }, { id: '0021' }, { id: '0022' }, { id: '0023' }, { id: '0024' }, { id: '0025' }, { id: '0026' }, { id: '0027' }, { id: '0028' }, { id: '0029' }, { id: '0030' }, { id: '0031' }, { id: '0032' }, { id: '0033' }, { id: '0034' }, { id: '0035' }, { id: '0036' }, { id: '0037' }, { id: '0038' }, { id: '0039' }]);
    await seed(recovery.pool, recovery.identity.namespace);
    await recordTelemetry(recovery.pool, randomUUID(), recovery.identity.namespace, 'foundation.probe');
    assert.equal((await recovery.pool.query('SELECT count(*)::int AS n FROM telemetry_events')).rows[0].n, 1);
  });
  await check('statement timeout cancels queries on two distinct pooled backends', async () => {
    const clients: PoolClient[] = [];
    try {
      // Hold both simultaneously so this cannot pass by reacquiring the same backend.
      clients.push(await recovery.pool.connect()); clients.push(await recovery.pool.connect());
      const pids = await Promise.all(clients.map(async client => (await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid));
      assert.notEqual(pids[0], pids[1]);
      const checks = await Promise.allSettled(clients.map(async client => {
        assert.equal((await client.query('SHOW statement_timeout')).rows[0].statement_timeout, '5s');
        // Finite sleep: a missing timeout makes the assertion fail after 6s, never hang.
        await assert.rejects(client.query('SELECT pg_sleep(6)'), { code: '57014' });
        assert.equal((await client.query('SELECT 1 AS healthy')).rows[0].healthy, 1);
      }));
      // Wait for every query to settle before releasing clients and stopping the cluster.
      for (const result of checks) if (result.status === 'rejected') throw result.reason;
    } finally { for (const client of clients) client.release(); }
  });
} finally { await recovery.stop(); console.log('Owned recovery-test PostgreSQL process stopped.'); }
console.log(`Integration: ${count} passed; 0 skipped. No booking/payment runtime claims.`);
