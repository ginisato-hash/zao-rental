import {spawn} from 'node:child_process';
import {chmod, mkdir, readFile, writeFile} from 'node:fs/promises';
import {delimiter, join} from 'node:path';

// Real PostgreSQL 18 client tools for restore proofs. Resolution order: an explicit directory, the checksum-verified
// user-space build under .local, ambient PATH, then the pinned container image from the Production Backup workflow
// (wrapper scripts, so the same code path works on a CI runner). Nothing here touches Production.
export interface Pg18Tools { binDir: string; label: string }

export function run(command: string, args: string[], env: Record<string, string> = {}): Promise<{code: number; stdout: string; stderr: string}> {
  return new Promise(resolve => {
    const child = spawn(command, args, {env: {PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', ...env} as unknown as NodeJS.ProcessEnv, stdio: ['ignore', 'pipe', 'pipe'] as const});
    let stdout = '', stderr = '';
    child.stdout.on('data', d => { stdout += d; }); child.stderr.on('data', d => { stderr = (stderr + d).slice(-400); });
    child.on('error', () => resolve({code: 127, stdout: '', stderr: 'spawn failed'}));
    child.on('close', code => resolve({code: code ?? 1, stdout, stderr}));
  });
}
const isMajor18 = (out: string, tool: string) => new RegExp(`^${tool} \\(PostgreSQL\\) 18\\.\\d+`).test(out.trim());
async function bothAre18(binDir: string): Promise<boolean> {
  for (const tool of ['pg_dump', 'pg_restore']) {
    const r = await run(join(binDir, tool), ['--version']);
    if (r.code !== 0 || !isMajor18(r.stdout, tool)) return false;
  }
  return true;
}

/** The exact image the Production Backup workflow pins, read from the workflow so the two cannot drift. */
export async function pinnedPg18Image(): Promise<string> {
  const workflow = await readFile(new URL('../../.github/workflows/production-backup.yml', import.meta.url), 'utf8');
  const image = workflow.match(/image:\s*(postgres:18@sha256:[a-f0-9]{64})/)?.[1];
  if (!image) throw new Error('PINNED_PG18_IMAGE_NOT_FOUND');
  return image;
}

export async function resolvePg18Tools(workDir: string): Promise<{tools: Pg18Tools | null; reason: string}> {
  const explicit = [process.env.ZAO_PG18_BIN_DIR, join(process.cwd(), '.local', 'pg-client-18.6', 'bin')].filter((d): d is string => Boolean(d));
  for (const dir of explicit) if (await bothAre18(dir)) return {tools: {binDir: dir, label: `PostgreSQL 18 client tools in ${dir.includes('.local') ? '.local/pg-client-18.6 (checksum-verified user-space build)' : 'ZAO_PG18_BIN_DIR'}`}, reason: 'direct tools'};
  for (const dir of (process.env.PATH ?? '').split(delimiter).filter(Boolean)) if (await bothAre18(dir)) return {tools: {binDir: dir, label: 'ambient PostgreSQL 18 client tools'}, reason: 'ambient tools'};
  if ((await run('docker', ['--version'])).code !== 0) return {tools: null, reason: 'no PostgreSQL 18 client tools (explicit, .local build or PATH) and Docker is unavailable'};
  const image = await pinnedPg18Image(), binDir = join(workDir, 'docker-bin');
  await mkdir(binDir, {recursive: true});
  for (const tool of ['pg_dump', 'pg_restore']) {
    // Bare `-e KEY` forwards a value from this process's environment, so no secret appears in docker's argv.
    const script = `#!/bin/sh\nexec docker run --rm --network host -e PGPASSWORD -e PGSSLMODE -e PGAPPNAME -e PGHOST -e PGPORT -e PGUSER -e PGDATABASE -v "${workDir}:${workDir}" -w "${workDir}" --entrypoint ${tool} ${image} "$@"\n`;
    await writeFile(join(binDir, tool), script, {mode: 0o755}); await chmod(join(binDir, tool), 0o755);
  }
  if (!(await bothAre18(binDir))) return {tools: null, reason: 'the pinned Docker image did not report PostgreSQL 18'};
  return {tools: {binDir, label: `Docker ${image}`}, reason: 'pinned container'};
}
