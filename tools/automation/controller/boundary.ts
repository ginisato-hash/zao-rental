import { readFile, realpath, lstat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { digest } from './store';
import { outside, type Release } from './release';
export type SandboxBinding = { codex: string; codexHash: string; node: string; nodeHash: string; worktree: string; scratch: string; commonGit: string; release: Release };
export async function sandboxPlan(binding: SandboxBinding, worker: string, workerArgs: string[]) {
  if (process.platform !== 'darwin') throw new Error('MACOS_BOUNDARY_REQUIRED_NO_FALLBACK');
  const { codex, node, worktree, scratch, commonGit, release } = binding;
  for (const [path, hash] of [[codex, binding.codexHash], [node, binding.nodeHash]]) {
    if (!path || !hash || !/^[a-f0-9]{64}$/.test(hash) || digest(await readFile(path)) !== hash) throw new Error('RUNTIME_HASH_CHANGED');
  }
  const root = await realpath(worktree); const temp = await realpath(scratch);
  if (!outside(root, temp) || !outside(temp, root) || !outside(release.directory, temp) || !outside(temp, release.directory)) throw new Error('SCRATCH_OVERLAP');
  if (!outside(root, commonGit) && commonGit !== resolve(root, '.git')) throw new Error('INVALID_GIT_BOUNDARY');
  if (!outside(temp, commonGit)) throw new Error('SCRATCH_OVERLAPS_GIT');
  const executable = await realpath(worker);
  if (executable !== resolve(release.directory, 'worker-probe.mjs')) throw new Error('UNAPPROVED_PROBE_EXECUTABLE');
  if (!(await lstat(executable)).isFile()) throw new Error('INVALID_PROBE');
  // TMPDIR is the approved run scratch itself: a :tmpdir deny would cancel its exact grant.
  // The default root deny still excludes every unrelated temporary directory.
  const filesystem: Record<string, string> = { ':root': 'deny', ':minimal': 'read', '/System/Library/OpenSSL': 'read', ':slash_tmp': 'deny', [root]: 'write', [temp]: 'write', [commonGit]: 'deny', [resolve(root, '.git')]: 'deny', [resolve(root, '.codex')]: 'deny', [resolve(root, '.claude')]: 'deny', [resolve(root, '.env')]: 'deny', [release.directory]: 'read', [dirname(await realpath(node))]: 'read' };
  // The whole profile is a CLI override; candidate config cannot add permissions to this profile.
  const profile = `{ filesystem = { ${Object.entries(filesystem).map(([k,v]) => `${JSON.stringify(k)} = ${JSON.stringify(v)}`).join(', ')} }, network = { enabled = false } }`;
  const args = ['sandbox', '-c', `permissions.zao_e02=${profile}`, '-P', 'zao_e02', '--include-managed-config', '-C', root, '--', node, executable, ...workerArgs];
  return { executable: codex, args, cwd: root, env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', TMPDIR: temp }, stdin: '', profileHash: digest(profile), runtimeHashes: { codex: binding.codexHash, node: binding.nodeHash } };
}
