import { readFile, realpath, lstat, readdir } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { digest } from './store';
export const RELEASE_FILES = ['controller.mjs', 'supervisor.mjs', 'policy.json', 'review-result.schema.json', 'task-result.schema.json', 'review-receipt.schema.json', 'worker-probe.mjs'] as const;
export type ReleaseManifest = { version: 'e02-preflight-1'; sourceSha: string; sourceTree: string; files: Record<string, string> };
export type Release = { directory: string; manifestHash: string; manifest: ReleaseManifest };
export function outside(root: string, path: string) { const r = relative(root, path); return r === '..' || r.startsWith(`..${sep}`) || isAbsolute(r); }
export async function verifyRelease(directory: string, manifestHash: string, candidate: string): Promise<Release> {
  if (!/^[a-f0-9]{64}$/.test(manifestHash)) throw new Error('INVALID_RELEASE_PIN');
  const [canonical, worktree] = await Promise.all([realpath(directory), realpath(candidate)]);
  if (!outside(worktree, canonical) || !outside(canonical, worktree)) throw new Error('RELEASE_OVERLAPS_CANDIDATE');
  const raw = await readFile(resolve(canonical, 'manifest.json'));
  if (digest(raw) !== manifestHash) throw new Error('RELEASE_MANIFEST_CHANGED');
  const manifest = JSON.parse(raw.toString()) as ReleaseManifest;
  if (manifest.version !== 'e02-preflight-1' || !/^[a-f0-9]{40}$/.test(manifest.sourceSha) || !/^[a-f0-9]{40}$/.test(manifest.sourceTree) || JSON.stringify(Object.keys(manifest.files).sort()) !== JSON.stringify([...RELEASE_FILES].sort())) throw new Error('INVALID_RELEASE_MANIFEST');
  if (JSON.stringify((await readdir(canonical)).sort()) !== JSON.stringify([...RELEASE_FILES, 'manifest.json'].sort())) throw new Error('UNMANIFESTED_RELEASE_FILE');
  for (const name of RELEASE_FILES) {
    const path = resolve(canonical, name); const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || digest(await readFile(path)) !== manifest.files[name]) throw new Error('RELEASE_FILE_CHANGED');
  }
  return { directory: canonical, manifestHash, manifest };
}
