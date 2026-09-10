import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import { assertTelemetryEventName } from '@rental/core';
import * as schema from './schema';
export const migrationsDirectory = fileURLToPath(new URL('../migrations/', import.meta.url));
export async function migrate(pool: Pool): Promise<void> {
  const sql = await readFile(`${migrationsDirectory}/0001_foundation.sql`, 'utf8');
  const checksum = createHash('sha256').update(sql).digest('hex');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(71820401)');
    await client.query('CREATE TABLE IF NOT EXISTS foundation_migrations (id text PRIMARY KEY, checksum text NOT NULL)');
    const prior = await client.query<{ checksum: string }>('SELECT checksum FROM foundation_migrations WHERE id = $1', ['0001']);
    if (prior.rows[0] && prior.rows[0].checksum !== checksum) throw new Error('Migration checksum drift');
    if (!prior.rowCount) {
      await client.query(sql);
      await client.query('INSERT INTO foundation_migrations VALUES ($1, $2)', ['0001', checksum]);
    }
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
export async function seed(pool: Pool, namespace: string): Promise<void> {
  await drizzle(pool, { schema }).insert(schema.foundationMetadata).values({ namespace, seedVersion: 'foundation-v1' }).onConflictDoNothing();
}
export async function recordTelemetry(pool: Pool, eventId: string, namespace: string, name: string): Promise<void> {
  assertTelemetryEventName(name);
  await drizzle(pool, { schema }).insert(schema.telemetryEvents).values({ eventId, namespace, name }).onConflictDoNothing();
}
