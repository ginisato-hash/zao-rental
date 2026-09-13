import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
const runId = new Date().toISOString().replaceAll(':', '-');
const directory = `.local/evidence/${runId}`; mkdirSync(directory, { recursive: true });
const commands = [];
for (const name of ['check:reference', 'check:secrets', 'test:reference', 'lint', 'typecheck', 'test:unit', ...(process.platform === 'darwin' ? ['test:controller:macos'] : []), 'test:integration', 'test:inventory', 'test:transfer', 'test:pricing', 'test:recommendation', 'build', 'test:auth', 'test:holds-ui', 'test:transfers-ui', 'test:quotes-ui', 'test:recommendations-ui', 'test:recommendation-audit', 'test:recommendation-continuation', 'test:stabilization-s01', 'test:stabilization-upgrade', 'test:stabilization-cd', 'test:stabilization-eg', 'test:stabilization-mixed', 'test:flow-payment', 'test:flow-ui', 'test:asset-reader', 'test:flow-restart', 'test:flow-scope-race', 'test:custody', 'test:custody-ui', 'test:late-pickup', 'test:wear', 'test:wear-ui', 'test:wear-mixed', 'test:content-fixture', 'test:public-guest', 'test:public-content', 'test:public-ui', 'test:readiness-guest', 'test:readiness-ui', 'test:integration-p2', 'test:e2e']) {
  const start = new Date().toISOString();
  const result = spawnSync('npm', ['run', name], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1', PLAYWRIGHT_BROWSERS_PATH: '.local/browsers' } });
  const output = (result.stdout ?? '') + (result.stderr ?? '');
  const log = `${directory}/${name.replaceAll(':', '-')}.log`;
  writeFileSync(log, output); process.stdout.write(output);
  commands.push({ command: `npm run ${name}`, exit_code: result.status ?? 1, start, log_path: log });
  writeFileSync(`${directory}/commands.json`, JSON.stringify({ runId, commands }, null, 2) + '\n');
  if (result.status !== 0) { console.error(`Verification failed; evidence: ${directory}`); process.exit(result.status ?? 1); }
}
console.log(`Verification passed; evidence: ${directory}`);
