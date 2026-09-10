import type { Pool } from 'pg';
// pg-pool can resolve end() after removing clients but before their socket end events.
// Wait for actual disconnect before terminating the owned PostgreSQL server.
export function trackPoolLifecycle(pool: Pool) {
  const disconnects = new Set<Promise<void>>();
  let failureCode: string | undefined;
  pool.on('connect', client => {
    const disconnected = new Promise<void>(resolve => client.once('end', resolve));
    disconnects.add(disconnected);
    void disconnected.then(() => disconnects.delete(disconnected));
  });
  pool.on('error', (error: Error & { code?: string }) => {
    // Never throw/log the provider Error: pg-pool attaches a Client with connection metadata.
    failureCode = /^[0-9A-Z]{5}$/.test(error.code ?? '') ? error.code : 'DATABASE_ERROR';
  });
  return async function close() {
    await pool.end();
    await Promise.all([...disconnects]);
    if (failureCode) throw new Error(`PostgreSQL background connection failure (${failureCode}); details withheld`);
  };
}
