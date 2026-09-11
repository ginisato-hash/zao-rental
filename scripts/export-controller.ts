import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { mkdir, copyFile, readFile, writeFile, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { digest } from '../tools/automation/controller/store';
import { outside, verifyRelease, RELEASE_FILES } from '../tools/automation/controller/release';
export async function exportController(repository: string, destination: string, policyFile: string) {
  const source = await realpath(repository);
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: source, encoding: 'utf8' }).trim();
  const tree = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: source, encoding: 'utf8' }).trim();
  // Release creation is a trusted maintainer operation. Dirty source is allowed only for tests;
  // its exact bytes are hashed, and its git revision is recorded as provenance, not approval.
  await mkdir(destination, { mode: 0o700 }); const target = await realpath(destination);
  if (!outside(source, target) || !outside(target, source)) throw new Error('RELEASE_MUST_BE_OUTSIDE_SOURCE');
  await build({ absWorkingDir: source, entryPoints: ['tools/automation/controller/entry.ts'], bundle: true, platform: 'node', format: 'esm', outfile: resolve(target, 'controller.mjs'), packages: 'bundle', banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" } });
  for (const name of ['supervisor.mjs', 'worker-probe.mjs']) await copyFile(resolve(source, 'tools/automation/controller', name), resolve(target, name));
  for (const name of ['review-result.schema.json','task-result.schema.json','review-receipt.schema.json']) await copyFile(resolve(source, 'docs/execution/schemas', name), resolve(target, name));
  await copyFile(policyFile, resolve(target, 'policy.json'));
  const files: Record<string,string> = {};
  for (const name of RELEASE_FILES) files[name] = digest(await readFile(resolve(target, name)));
  const manifest = { version: 'e02-preflight-1', sourceSha: sha, sourceTree: tree, files };
  const raw = JSON.stringify(manifest, null, 2) + '\n'; await writeFile(resolve(target, 'manifest.json'), raw, { flag: 'wx', mode: 0o600 });
  return verifyRelease(target, digest(raw), source);
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 5) throw new Error('USAGE: export-controller <repository> <NEW-outside-release-directory> <protected-policy-file>');
  console.log(JSON.stringify(await exportController(process.argv[2]!, process.argv[3]!, process.argv[4]!)));
}
