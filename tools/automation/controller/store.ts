import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, realpath, rename, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { hostname } from 'node:os';
import { execFileSync } from 'node:child_process';
export const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export function id(value: string) { if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(value)) throw new Error('INVALID_ID'); return value; }
export async function durableJson(path: string, value: unknown) {
  const temp = `${path}.${randomUUID()}.tmp`;
  const file = await open(temp, 'wx', 0o600);
  try { await file.writeFile(JSON.stringify(value)); await file.sync(); } finally { await file.close(); }
  await rename(temp, path);
  const directory = await open(resolve(path, '..'), 'r');
  try { await directory.sync(); } finally { await directory.close(); }
}
export function processIdentity(pid = process.pid) {
  return execFileSync('/bin/ps', ['-p', String(pid), '-o', 'lstart='], { encoding: 'utf8' }).trim();
}
export async function repositoryState(worktree: string) {
  // No optional index writes, external filters, shell or repository hook execution.
  const common = execFileSync('git', ['--no-optional-locks', '-C', worktree, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' }).trim();
  const canonical = await realpath(common);
  return { common: canonical, root: resolve(canonical, 'zao-e02-controller'), repositoryId: digest(canonical) };
}
export type LeaseIdentity = { token: string; taskId: string; runId: string; pid: number; processStart: string; host: string; worktree: string; repositoryId: string; claimedAt: string; leaseUntil: string };
export async function acquireRepositoryLease(worktree: string, taskId: string, runId: string) {
  id(taskId); id(runId);
  const state = await repositoryState(worktree);
  await mkdir(state.root, { recursive: true, mode: 0o700 });
  const lock = resolve(state.root, 'repository.lock');
  try { await mkdir(lock, { mode: 0o700 }); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('REPOSITORY_BUSY_OR_RECOVERY_REQUIRED');
    throw error;
  }
  const owner: LeaseIdentity = { token: randomUUID(), taskId, runId, pid: process.pid, processStart: processIdentity(), host: hostname(), worktree: await realpath(worktree), repositoryId: state.repositoryId, claimedAt: new Date().toISOString(), leaseUntil: new Date(Date.now() + 3_600_000).toISOString() };
  // A crash before owner.json is persisted intentionally leaves an unrecoverable-by-automation lock.
  await durableJson(resolve(lock, 'owner.json'), owner);
  let released = false;
  return { state, owner, async assertOwned() {
    if (released) throw new Error('LEASE_RELEASED');
    const current = JSON.parse(await readFile(resolve(lock, 'owner.json'), 'utf8')) as LeaseIdentity;
    if (current.token !== owner.token || current.pid !== process.pid || current.processStart !== processIdentity() || current.host !== hostname()) throw new Error('LEASE_OWNERSHIP_CHANGED');
  }, async release() {
    await this.assertOwned(); await rm(lock, { recursive: true }); released = true;
  } };
}
export type Lease = Awaited<ReturnType<typeof acquireRepositoryLease>>;
export type OperationRecord = { state: 'INTENT' | 'DONE'; inputHash: string; kind: string; result?: unknown };
export type RunRecord = { version: 1; runId: string; taskId: string; bindingHash: string; releaseHash: string; branch: string; status: string; operations: Record<string, OperationRecord>; startedAt: number; modelAttempts: number; reviewAttempts: number; fixRound: number };
export class Journal {
  private constructor(readonly lease: Lease, readonly path: string, readonly data: RunRecord) {}
  static async load(lease: Lease, taskId: string, bindingHash: string, releaseHash: string) {
    await lease.assertOwned(); id(taskId);
    const path = resolve(lease.state.root, `${taskId}.json`);
    let data: RunRecord;
    try {
      data = JSON.parse(await readFile(path, 'utf8')) as RunRecord;
      if (data.version !== 1 || data.taskId !== taskId || data.bindingHash !== bindingHash || data.releaseHash !== releaseHash || data.runId !== lease.owner.runId) throw new Error('RUN_BINDING_CHANGED');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      data = { version: 1, runId: lease.owner.runId, taskId, bindingHash, releaseHash, branch: `codex/${taskId.toLowerCase()}`, status: 'CREATED', operations: {}, startedAt: Date.now(), modelAttempts: 0, reviewAttempts: 0, fixRound: 0 };
      await durableJson(path, data);
    }
    return new Journal(lease, path, data);
  }
  async save() { await this.lease.assertOwned(); await durableJson(this.path, this.data); }
}
