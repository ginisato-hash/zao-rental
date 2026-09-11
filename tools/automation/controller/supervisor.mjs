// Trusted guardian. Worker gets no IPC descriptor. Parent disconnect kills only this new POSIX group.
import { spawn } from 'node:child_process';
let child, done = false, stopping = false, output = '', reason = 'EXIT', timer;
function finish(code, why) {
  if (stopping) return; stopping = true; reason = why; clearTimeout(timer);
  if (process.connected) process.send({ kind: 'result', exitCode: code, reason, output, guardianEnvironmentKeys: Object.keys(process.env) });
  // Guardian remains alive anchoring the PGID until the final kill, preventing group-ID reuse.
  try { process.kill(-process.pid, 'SIGTERM'); } catch {}
  setTimeout(() => { try { process.kill(-process.pid, 'SIGKILL'); } catch { process.exit(125); } }, 150);
}
process.on('SIGTERM', () => { if (!stopping) finish(143, 'CANCEL'); });
process.on('disconnect', () => { if (!stopping) finish(143, 'PARENT_DISCONNECTED'); });
process.on('uncaughtException', () => finish(125, 'GUARDIAN_ERROR'));
process.on('message', msg => {
  if (msg.kind === 'cancel') return finish(143, 'CANCEL');
  if (msg.kind !== 'start' || done) return finish(125, 'INVALID_CONTROL');
  done = true;
  const p = msg.plan;
  timer = setTimeout(() => finish(124, 'TIMEOUT'), msg.timeoutMs);
  child = spawn(p.executable, p.args, { cwd: p.cwd, env: p.env, shell: false, detached: false, stdio: ['pipe', 'pipe', 'pipe'] });
  if (process.connected) process.send({ kind: 'started', pid: child.pid, pgid: process.pid });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => {
    output += chunk.toString(); if (Buffer.byteLength(output) > 128 * 1024) finish(125, 'OUTPUT_LIMIT');
  });
  child.stdin.on('error', () => {}); child.stdin.end(p.stdin);
  child.on('error', () => finish(127, 'SPAWN_ERROR'));
  // exit instead of close: orphan descendants may still hold inherited stdout pipes.
  child.on('exit', code => finish(code ?? 128, 'EXIT'));
});
