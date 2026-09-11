import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { verifyRelease, type Release } from './release';
export type ProcessPlan = { executable: string; args: string[]; cwd: string; env: Record<string, string>; stdin: string };
export type ProcessResult = { exitCode: number; reason: string; output: string; guardianEnvironmentKeys: string[] };
export async function runBounded(release: Release, node: string, plan: ProcessPlan, timeoutMs: number, signal?: AbortSignal, onStart?: (pid: number, pgid: number) => void): Promise<ProcessResult> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 10 || timeoutMs > 3_600_000 || signal?.aborted) throw new Error('CANCELLED_OR_INVALID_TIMEOUT');
  await verifyRelease(release.directory, release.manifestHash, plan.cwd);
  return new Promise((accept, reject) => {
    // Next's ambient web types require NODE_ENV, but a Node-only guardian intentionally omits it.
    // This assertion changes only the type, not the explicitly constructed runtime environment.
    const guardian = spawn(node, [resolve(release.directory, 'supervisor.mjs')], { cwd: release.directory, env: Object.assign(Object.create(null) as NodeJS.ProcessEnv, { PATH: '/usr/bin:/bin' }), detached: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    let result: ProcessResult | undefined;
    const cancel = () => { if (guardian.connected) guardian.send({ kind: 'cancel' }); };
    signal?.addEventListener('abort', cancel, { once: true });
    guardian.on('message', msg => {
      const event = msg as { kind: string; pid: number; pgid: number } & ProcessResult;
      if (event.kind === 'started') onStart?.(event.pid, event.pgid);
      if (event.kind === 'result') result = { exitCode: event.exitCode, reason: event.reason, output: event.output, guardianEnvironmentKeys: event.guardianEnvironmentKeys };
    });
    guardian.once('error', reject);
    guardian.once('close', () => { signal?.removeEventListener('abort', cancel); if (!result) reject(new Error('GUARDIAN_LOST_RECONCILE_REQUIRED')); else accept(result); });
    guardian.send({ kind: 'start', plan, timeoutMs });
    if (signal?.aborted) cancel();
  });
}
