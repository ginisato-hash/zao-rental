import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { resolve } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import { Pool } from 'pg';
import { trackPoolLifecycle } from './pool-lifecycle';
import { assertPortFree, rejectAmbientDatabase, worktreeIdentity } from './worktree';
// Dedicated real PostgreSQL process and fresh data for each invocation. No host services are installed.
export async function startIsolatedPostgres(options: { statementTimeoutMs?: number } = {}) {
  if (options.statementTimeoutMs !== undefined && (!Number.isSafeInteger(options.statementTimeoutMs) || options.statementTimeoutMs <= 0)) throw new Error('Statement timeout must be a positive integer');
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
    postgresFlags: ['-h', '127.0.0.1', '-c', 'unix_socket_directories=', '-c', 'log_statement=none'],
    onLog: () => {}, onError: () => {},
  });
  let started = false;
  try {
    // The launcher briefly creates an initdb password file; force owner-only permissions.
    const previousUmask = process.umask(0o077);
    try { await cluster.initialise(); } finally { process.umask(previousUmask); }
    await cluster.start(); started = true;
    await cluster.createDatabase(identity.database);
    const pool = new Pool({ host: '127.0.0.1', port: identity.dbPort, user: identity.user, password, database: identity.database, max: 6, statement_timeout: options.statementTimeoutMs });
    const closePool = trackPoolLifecycle(pool);
    return { identity, pool, databaseDir, async stop() { try { await closePool(); } finally { await cluster.stop(); } } };
  } catch (error) { if (started) await cluster.stop(); throw error; }
}
