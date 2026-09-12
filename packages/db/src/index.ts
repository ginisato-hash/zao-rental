import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import { assertTelemetryEventName } from '@rental/core';
import * as schema from './schema';
export const migrationsDirectory = fileURLToPath(new URL('../migrations/', import.meta.url));

export const migrationPlan = [
  {id:'0001', file:'0001_foundation.sql'}, {id:'0002', file:'0002_ledger.sql'}, {id:'0003',file:'0003_staff_auth.sql'}, {id:'0004',file:'0004_period_hold.sql'}, {id:'0005',file:'0005_store_transfer.sql'}, {id:'0006',file:'0006_pricing_quote.sql'}, {id:'0007',file:'0007_recommendation.sql'}, {id:'0008',file:'0008_staff_settings_boundary.sql'},
] as const;
export async function migrate(pool: Pool): Promise<void> {
  const entries=await Promise.all(migrationPlan.map(async entry => {
    const sql=await readFile(`${migrationsDirectory}/${entry.file}`,'utf8');
    return {...entry,sql,checksum:createHash('sha256').update(sql).digest('hex')};
  }));
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(71820401)');
    await client.query('CREATE TABLE IF NOT EXISTS foundation_migrations (id text PRIMARY KEY, checksum text NOT NULL)');
    const prior=(await client.query<{id:string;checksum:string}>('SELECT id,checksum FROM foundation_migrations ORDER BY id')).rows;
    for(let i=0;i<prior.length;i++) {
      if(prior[i]!.id!==entries[i]?.id)throw new Error('Migration history is not a supported prefix');
      if(prior[i]!.checksum!==entries[i]!.checksum)throw new Error('Migration checksum drift');
    }
    for(const entry of entries.slice(prior.length)) {
      await client.query(entry.sql);
      await client.query('INSERT INTO foundation_migrations VALUES ($1,$2)',[entry.id,entry.checksum]);
    }
    await client.query('COMMIT');
  } catch(error) {await client.query('ROLLBACK');throw error;}
  finally {client.release();}
}
export async function seed(pool: Pool, namespace: string): Promise<void> {
  await drizzle(pool, { schema }).insert(schema.foundationMetadata).values({ namespace, seedVersion: 'foundation-v1' }).onConflictDoNothing();
}
export async function recordTelemetry(pool: Pool, eventId: string, namespace: string, name: string): Promise<void> {
  assertTelemetryEventName(name);
  await drizzle(pool, { schema }).insert(schema.telemetryEvents).values({ eventId, namespace, name }).onConflictDoNothing();
}
