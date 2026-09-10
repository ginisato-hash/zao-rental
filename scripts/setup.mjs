import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
if (process.version !== 'v24.15.0') throw new Error('Use Node 24.15.0 from .nvmrc');
mkdirSync('.local', { recursive: true, mode: 0o700 });
for (const args of [['ci', '--no-audit', '--no-fund'], ['exec', '--', 'playwright', 'install', 'chromium']]) {
  const result = spawnSync('npm', args, { stdio: 'inherit', env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: '.local/browsers', NEXT_TELEMETRY_DISABLED: '1' } });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log('Setup complete. Run npm run verify; no service or scheduler was installed.');
