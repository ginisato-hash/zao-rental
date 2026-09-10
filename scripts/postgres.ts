import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { resolve } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import { Pool } from 'pg';
import { assertPortFree, rejectAmbientDatabase, worktreeIdentity } from './worktree';
// Dedicated real PostgreSQL process and fresh data for each invocation. No host services are installed.
export async function startIsolatedPostgres() {
  rejectAmbientDatabase();
  const identity = worktreeIdentity();
  await assertPortFree(identity.dbPort);
  const parent = resolve('.local/postgres');
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const databaseDir = await mkdtemp(`${parent}/run-`);
  const password = randomBytes(24).toString('hex');
  const cluster = new EmbeddedPostgres({
    databaseDir, user: identity.user, password, port: identity.dbPort,
    authMethod: 'scram-sha-256', persistent: true, createPostgresUser: false,
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
    postgresFlags: ['-h', '127.0.0.1', '-k', databaseDir, '-c', 'log_statement=none'],
    onLog: () => {}, onError: () => {},
  });
  let started = false;
  try {
    await cluster.initialise();
    await cluster.start(); started = true;
    await cluster.createDatabase(identity.database);
    const pool = new Pool({ host: '127.0.0.1', port: identity.dbPort, user: identity.user, password, database: identity.database, max: 6 });
    return { identity, pool, databaseDir, async stop() { try { await pool.end(); } finally { await cluster.stop(); } } };
  } catch (error) { if (started) await cluster.stop(); throw error; }
}
