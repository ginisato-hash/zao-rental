import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { migrate, seed, recordTelemetry } from '@rental/db';
import { startIsolatedPostgres } from './postgres';
import { assertPortFree } from './worktree';
const db = await startIsolatedPostgres();
try {
  await migrate(db.pool); await seed(db.pool, db.identity.namespace); await recordTelemetry(db.pool, randomUUID(), db.identity.namespace, 'foundation.ready'); await assertPortFree(db.identity.webPort);
  console.log(`ZAO Rental: http://127.0.0.1:${db.identity.webPort}; isolated seed ${db.identity.namespace}`);
  const web = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', 'apps/web', '--hostname', '127.0.0.1', '--port', String(db.identity.webPort)], { stdio: 'inherit', env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' } });
  const stop = () => web.kill('SIGTERM'); process.once('SIGINT', stop); process.once('SIGTERM', stop);
  const code = await new Promise<number>((resolve, reject) => { web.once('error', reject); web.once('exit', (code) => resolve(code ?? 1)); });
  process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); process.exitCode = code;
} finally { await db.stop(); }
