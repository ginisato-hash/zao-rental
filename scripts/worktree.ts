import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { createServer } from 'node:net';
export function identityForPath(absolutePath: string) {
  const hash = createHash('sha256').update(absolutePath).digest('hex');
  const namespace = `zr_${hash.slice(0, 12)}`;
  const slot = parseInt(hash.slice(0, 6), 16) % 9000;
  return { root: absolutePath, namespace, database: namespace, user: namespace, dbPort: 20000 + slot, webPort: 30000 + slot, seedVersion: 'foundation-v1' };
}
export function worktreeIdentity() { return identityForPath(realpathSync(process.cwd())); }
export async function assertPortFree(port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const server = createServer();
    server.once('error', () => reject(new Error(`Port ${port} is occupied; refusing to attach or kill any process`)));
    server.listen(port, '127.0.0.1', () => server.close((error) => error ? reject(error) : resolve()));
  });
}
export function rejectAmbientDatabase(): void {
  if (process.env.DATABASE_URL || process.env.PGHOST || process.env.PGDATABASE || process.env.PGUSER || process.env.PGPASSWORD || process.env.PGPORT || process.env.PGSERVICE || process.env.PGSERVICEFILE) {
    throw new Error('Ambient database configuration detected; unset it before running isolated ZAO Rental setup');
  }
}
