import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import {diskPreflight,cleanupSuccessfulClusters} from './test-hygiene.ts';
const ownerRunId=randomUUID();
console.log('DISK_PREFLIGHT '+JSON.stringify(diskPreflight(process.cwd(),'VERIFY')));
const runId = new Date().toISOString().replaceAll(':', '-');
const directory = `.local/evidence/${runId}`; mkdirSync(directory, { recursive: true });
const commands = [];
for (const name of ['check:reference', 'check:secrets', 'test:reference', 'lint', 'typecheck', 'test:unit', ...(process.platform === 'darwin' ? ['test:controller:macos'] : []), 'test:integration', 'test:inventory', 'test:transfer', 'test:pricing', 'test:recommendation', 'build', 'test:auth', 'test:holds-ui', 'test:transfers-ui', 'test:quotes-ui', 'test:recommendations-ui', 'test:recommendation-audit', 'test:recommendation-continuation', 'test:stabilization-s01', 'test:stabilization-upgrade', 'test:stabilization-cd', 'test:stabilization-eg', 'test:stabilization-mixed', 'test:square-activation', 'test:flow-payment', 'test:flow-ui', 'test:asset-reader', 'test:flow-restart', 'test:flow-scope-race', 'test:custody', 'test:custody-ui', 'test:late-pickup', 'test:staff-home-ui', 'test:wear', 'test:wear-ui', 'test:wear-mixed', 'test:content-fixture', 'test:public-guest', 'test:public-content', 'test:public-ui', 'test:staff-diagnostic', 'test:readiness-guest', 'test:readiness-ui', 'test:integration-p2', 'test:activation-p4', 'test:booking-recovery', 'test:booking-recovery-ui', 'test:production-rehearsal', 'test:r15-regression', 'test:avatar', 'test:operations', 'test:operations-ui', 'test:operations-console', 'test:operations-console-ui', 'test:operations-manifest', 'test:operations-restore', 'test:operations-baseline', 'test:m2a-import', 'test:m2a-connection', 'test:m2a-rehearsal', 'test:m2a-launch', 'test:m2a-launch-ui', 'test:m2b-security', 'test:m2b-bootstrap', 'test:production-runtime', 'test:production-runtime-ui', 'test:notification', 'test:notification-ui', 'test:e2e']) {
  const start = new Date().toISOString();
  const commandId=randomUUID();
  const result = spawnSync('npm', ['run', name], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, env: { ...process.env, ZAO_TEST_RUN_ID:ownerRunId,ZAO_TEST_COMMAND_ID:commandId,NEXT_TELEMETRY_DISABLED: '1', PLAYWRIGHT_BROWSERS_PATH: '.local/browsers' } });
  const output = (result.stdout ?? '') + (result.stderr ?? '');
  const log = `${directory}/${name.replaceAll(':', '-')}.log`;
  writeFileSync(log, output); process.stdout.write(output);
  const cleanup=cleanupSuccessfulClusters(process.cwd(),{runId:ownerRunId,commandId,exitCode:result.status??1,logPath:log,logSha256:createHash('sha256').update(output).digest('hex')});
  const disposed_clusters=cleanup.filter(x=>x.result==='DISPOSED_SUCCESSFUL_OWNED').length;
  commands.push({ ownerRunId,commandId,cleanup,disposed_clusters, command: `npm run ${name}`, exit_code: result.status ?? 1, start, log_path: log });
  writeFileSync(`${directory}/commands.json`, JSON.stringify({ runId, commands }, null, 2) + '\n');
  if (result.status !== 0) { console.error(`Verification failed; evidence: ${directory}`); process.exit(result.status ?? 1); }
}
console.log(`Verification passed; evidence: ${directory}`);
