import { mkdir, writeFile } from 'node:fs/promises';
import { claimTask, commandPlan, evaluate, validateApproval } from './runner';
import { simulationFixture } from './fixtures';
const args = process.argv.slice(2);
if (args.length !== 1 || args[0] !== '--dry-run') {
  console.error('BLOCKED: live execution is not implemented or authorized. Only --dry-run is accepted.'); process.exit(2);
}
const fixture = simulationFixture();
const approval = validateApproval(fixture.signed, fixture.policy, fixture.approval.specHash);
const stateDirectory = '.local/runner-simulation';
const lock = await claimTask(stateDirectory, approval);
try {
  const result = { mode: 'SIMULATION_ONLY', liveEnabled: false, runId: lock.claim.token, claim: lock.claim,
    commandsNotExecuted: commandPlan(approval, '<new-isolated-worktree>', 'ginisato-hash/zao-rental'),
    simulatedResult: evaluate(approval, fixture.policy, fixture.evidence, 0, 1),
    unexecuted: ['codex exec', 'draft PR', 'GitHub CI', 'Claude review', 'repair loop', 'merge'] };
  await mkdir(`${stateDirectory}/runs`, { recursive: true });
  await writeFile(`${stateDirectory}/runs/${lock.claim.token}.json`, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify(result, null, 2));
} finally { await lock.release(); }
