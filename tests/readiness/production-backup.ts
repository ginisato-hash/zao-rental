import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {createHash, randomBytes} from 'node:crypto';
import {access, chmod, mkdir, mkdtemp, readFile, symlink, writeFile, rm} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import * as age from 'age-encryption';
import {
  type BackupAdapters, type BackupEnv, type FsAccessChecker,
  EXPECTED_PRODUCTION_BUCKET, EXPECTED_PRODUCTION_CA_ROOT, EXPECTED_PRODUCTION_HOST_FINGERPRINT_SHA256,
  assertCaRootUsable, assertOrdinaryFile, assertProductionHost, assertProductionHostFingerprint, assertProductionPort,
  buildPgDumpChildEnv, encryptFileToFileStreaming, fingerprintHost, isDesignatedDailyRun, minimalPgChildEnv, objectKey,
  parseBackupClass, parseScheduledAt, readBackupEnv, redactSecrets, runProductionBackup, spawnPgDump,
} from '../../scripts/production-backup';
import worker, {TARGET_REF, TARGET_REPO, TARGET_WORKFLOW, dispatchProductionBackup} from '../../apps/backup-scheduler-worker/src/index';
import {startIsolatedPostgres} from '../../scripts/postgres';

// ── GitHub `schedule:` scheduler source: the workflow shell is executed for real (extracted from the YAML) ──
const WORKFLOWS = join(import.meta.dirname, '../../.github/workflows');
const readWorkflow = (name: string): string => readFileSync(join(WORKFLOWS, name), 'utf8');
/** Returns the `run: |` script of the step with the given name (indentation stripped). */
function stepScript(yaml: string, stepName: string): string {
  const lines = yaml.split('\n');
  const start = lines.findIndex(l => l.includes(`- name: ${stepName}`));
  assert.ok(start >= 0, `step not found: ${stepName}`);
  const run = lines.findIndex((l, i) => i > start && /^\s+run: \|\s*$/.test(l));
  assert.ok(run > start, `no run block in step: ${stepName}`);
  const indent = (lines[run + 1]!.match(/^\s*/) ?? [''])[0].length;
  const out: string[] = [];
  for (let i = run + 1; i < lines.length; i++) {
    const l = lines[i]!;
    if (l.trim() !== '' && (l.match(/^\s*/) ?? [''])[0].length < indent) break;
    out.push(l.slice(indent));
  }
  return out.join('\n');
}
/** A `date` shim (GNU-compatible subset, also on macOS) and a `gh` shim so the YAML shell runs on any host. */
async function shimDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'bk-sched-'));
  await writeFile(join(dir, 'date'), `#!/usr/bin/env node
const a = process.argv.slice(2).filter(x => x !== '-u');
let t = Number(process.env.FAKE_NOW_EPOCH) * 1000, fmt = '';
for (let i = 0; i < a.length; i++) {
  if (a[i] === '-d') { const v = a[++i]; t = v.startsWith('@') ? Number(v.slice(1)) * 1000 : Date.parse(v); }
  else if (a[i].startsWith('+')) fmt = a[i].slice(1);
}
const d = new Date(t), p = (n, w = 2) => String(n).padStart(w, '0');
process.stdout.write(fmt.replace(/%([sYmdHMS])/g, (_, c) => ({s: String(Math.floor(t / 1000)), Y: p(d.getUTCFullYear(), 4), m: p(d.getUTCMonth() + 1),
  d: p(d.getUTCDate()), H: p(d.getUTCHours()), M: p(d.getUTCMinutes()), S: p(d.getUTCSeconds())})[c]) + '\\n');
`, {mode: 0o755});
  await writeFile(join(dir, 'gh'), `#!/bin/sh
case "$1" in
  api)
    case "$2" in
      */jobs) id="\${2%/jobs}"; id="\${id##*/}"; case " $FAKE_OK_IDS " in *" $id "*) echo 1 ;; *) echo 0 ;; esac ;;
      */workflows/*) printf '%s\\n' "$FAKE_STATE" ;;
      */actions/runs/*) printf '%s\\n' "$FAKE_CREATED" ;;
      *) exit 99 ;;
    esac ;;
  run) printf '%s\\n' "$FAKE_RUNS" ;;
  *) exit 99 ;;
esac
`, {mode: 0o755});
  return dir;
}
function runShell(script: string, env: Record<string, string>, shims: string): {code: number | null; output: Record<string, string>; stdout: string} {
  const out = join(shims, 'github_output');
  const r = spawnSync('bash', ['-c', script], {env: {PATH: `${shims}:${process.env.PATH ?? ''}`, GITHUB_OUTPUT: out, ...env} as unknown as NodeJS.ProcessEnv, encoding: 'utf8'});
  let raw = '';
  try { raw = readFileSync(out, 'utf8'); } catch { /* no output written */ }
  const output = Object.fromEntries(raw.split('\n').filter(Boolean).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
  try { spawnSync('rm', ['-f', out]); } catch { /* ignore */ }
  return {code: r.status, output, stdout: r.stdout + r.stderr};
}
const epoch = (iso: string): string => String(Date.parse(iso) / 1000);

let passed = 0;
async function check(name: string, fn: () => Promise<void>): Promise<void> {
  await fn();
  passed++;
  console.log(`PASS ${name}`);
}

function baseEnv(overrides: Partial<BackupEnv> = {}): BackupEnv {
  return {
    PGHOST: 'ep-synthetic-1234.ap-southeast-1.aws.neon.tech', PGPORT: '5432', PGDATABASE: 'zao_rental_production',
    PGUSER: 'backup_reader', PGPASSWORD: 'SYNTHETIC_TEST_PASSWORD_' + randomBytes(6).toString('hex'),
    PRODUCTION_BACKUP_BUCKET: EXPECTED_PRODUCTION_BUCKET, AGE_BACKUP_RECIPIENT: 'age1qyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqycs5x2u2z',
    R2_ACCOUNT_ID: 'synthetic-account', R2_ACCESS_KEY_ID: 'synthetic-key', R2_SECRET_ACCESS_KEY: 'synthetic-secret',
    ...overrides,
  };
}

/** The orchestrator tests below exercise pipeline/failure logic, not the exact-fingerprint identity
 * binding (F4), which by design cannot be exercised with a synthetic hostname — see the dedicated F4
 * accept/reject tests, which compute their own self-consistent test fingerprint instead of needing to
 * know the real Production hostname. */
const TEST_SCHEDULED_AT = new Date('2026-09-21T05:17:00.000Z');

type Captured = {plaintextPath?: string; ciphertextPath?: string; uploads: {bucket: string; key: string; filePath: string; contentLength: number; bytesAtUploadTime: Buffer}[]};

function fakeAdapters(overrides: Partial<BackupAdapters> = {}, captured: Captured = {uploads: []}): BackupAdapters {
  return {
    dump: async (_env, outFile) => { captured.plaintextPath = outFile; await writeFile(outFile, 'SYNTHETIC PLAINTEXT DUMP BYTES ' + randomBytes(8).toString('hex')); return {exitCode: 0, stderrTail: ''}; },
    validate: async () => ({ok: true}),
    encryptToFile: async (plaintextPath, ciphertextPath) => {
      captured.ciphertextPath = ciphertextPath;
      const plaintext = await readFile(plaintextPath);
      const ciphertext = Buffer.concat([Buffer.from('AGE-ENCRYPTED:'), plaintext]);
      await writeFile(ciphertextPath, ciphertext);
      return {sha256: createHash('sha256').update(plaintext).digest('hex'), bytes: ciphertext.length};
    },
    upload: async (bucket, key, filePath, contentLength) => {
      // Read now, while the file still exists: the orchestrator deletes both temp files in its own
      // `finally` immediately after upload returns, on both success and failure paths.
      const bytesAtUploadTime = await readFile(filePath);
      captured.uploads.push({bucket, key, filePath, contentLength, bytesAtUploadTime});
    },
    toolVersions: async () => ({pgDump: 'test-pg_dump', pgRestore: 'test-pg_restore'}),
    ...overrides,
  };
}

async function main(): Promise<void> {
  await check('1. missing env fails closed with a named-key error', async () => {
    assert.throws(() => readBackupEnv({} as NodeJS.ProcessEnv), /BACKUP_ENV_MISSING/);
    const partial = {...baseEnv()} as Record<string, string | undefined>;
    delete partial.PGPASSWORD;
    assert.throws(() => readBackupEnv(partial as NodeJS.ProcessEnv), /BACKUP_ENV_MISSING:PGPASSWORD/);
  });

  await check('2. pooled Neon hostname rejected for dump source', async () => {
    assert.throws(() => assertProductionHost('ep-synthetic-1234-pooler.ap-southeast-1.aws.neon.tech'), /BACKUP_HOST_POOLED_REJECTED/);
  });

  await check('3. non-Neon Production host rejected', async () => {
    assert.throws(() => assertProductionHost('db.example.com'), /BACKUP_HOST_NON_NEON_REJECTED/);
    assert.throws(() => assertProductionHost('localhost'), /BACKUP_HOST_LOCALHOST_REJECTED/);
  });

  await check('4. password/connection string never appears in logs/errors', async () => {
    assert.equal(redactSecrets('leaked SECRET123 in the middle', ['SECRET123']), 'leaked [REDACTED] in the middle');
    // Built by concatenation, not a literal: a connection-string-shaped literal here would
    // itself trip scripts/check-secrets.mjs's own connection-string heuristic.
    const synthConnectionString = ['postgres:/', '/', 'u', ':', 'p', '@host/db'].join('');
    assert.equal(redactSecrets('uri ' + synthConnectionString, []), 'uri [REDACTED_CONNECTION_STRING]');
    const dir = await mkdtemp(join(tmpdir(), 'fake-pg-dump-'));
    const fakeBin = join(dir, 'pg_dump');
    const password = 'REAL_SECRET_' + randomBytes(6).toString('hex');
    await writeFile(fakeBin, `#!/bin/sh\necho "leak of $PGPASSWORD" 1>&2\nexit 1\n`);
    await chmod(fakeBin, 0o755);
    const usableCaRoot = join(dir, 'ca.crt');
    await writeFile(usableCaRoot, 'SYNTHETIC CA BUNDLE'); // must exist so the F8 pre-check lets this test reach the fake binary
    const env = baseEnv({PGPASSWORD: password});
    const previousPath = process.env.PATH;
    process.env.PATH = `${dir}:${previousPath}`;
    try {
      const outFile = join(dir, 'out.dump');
      const result = await spawnPgDump(env, outFile, usableCaRoot);
      assert.equal(result.exitCode, 1);
      assert.ok(!result.stderrTail.includes(password), 'stderrTail must not contain the raw password');
      assert.ok(result.stderrTail.includes('[REDACTED]'));
    } finally { process.env.PATH = previousPath; }
  });

  await check('5. pg_dump non-zero exit blocks encryption/upload', async () => {
    const captured: Captured = {uploads: []};
    const adapters = fakeAdapters({dump: async () => ({exitCode: 1, stderrTail: 'synthetic failure'})}, captured);
    await assert.rejects(runProductionBackup(baseEnv(), adapters, {backupClass: 'hourly', scheduledAt: TEST_SCHEDULED_AT}), /BACKUP_PG_DUMP_FAILED/);
    assert.equal(captured.uploads.length, 0);
  });

  await check('6. zero-byte dump blocks upload and cleans plaintext', async () => {
    const captured: Captured = {uploads: []};
    const adapters = fakeAdapters({dump: async (_env, outFile) => { captured.plaintextPath = outFile; await writeFile(outFile, ''); return {exitCode: 0, stderrTail: ''}; }}, captured);
    await assert.rejects(runProductionBackup(baseEnv(), adapters, {backupClass: 'hourly', scheduledAt: TEST_SCHEDULED_AT}), /BACKUP_EMPTY_ARCHIVE_REJECTED/);
    assert.equal(captured.uploads.length, 0);
    await assert.rejects(access(captured.plaintextPath!), /ENOENT/);
  });

  await check('7. pg_restore validation failure blocks upload and cleans plaintext', async () => {
    const captured: Captured = {uploads: []};
    const adapters = fakeAdapters({validate: async () => ({ok: false})}, captured);
    await assert.rejects(runProductionBackup(baseEnv(), adapters, {backupClass: 'hourly', scheduledAt: TEST_SCHEDULED_AT}), /BACKUP_ARCHIVE_VALIDATION_FAILED/);
    assert.equal(captured.uploads.length, 0);
    await assert.rejects(access(captured.plaintextPath!), /ENOENT/);
  });

  await check('8. age encryption failure blocks upload and cleans plaintext (no ciphertext ever written)', async () => {
    const captured: Captured = {uploads: []};
    const adapters = fakeAdapters({encryptToFile: async () => { throw new Error('synthetic encryption failure'); }}, captured);
    await assert.rejects(runProductionBackup(baseEnv(), adapters, {backupClass: 'hourly', scheduledAt: TEST_SCHEDULED_AT}), /synthetic encryption failure/);
    assert.equal(captured.uploads.length, 0);
    await assert.rejects(access(captured.plaintextPath!), /ENOENT/);
    assert.equal(captured.ciphertextPath, undefined);
  });

  await check('9. R2 upload failure cleans both plaintext and ciphertext temp files', async () => {
    const captured: Captured = {uploads: []};
    const adapters = fakeAdapters({upload: async () => { throw new Error('synthetic upload failure'); }}, captured);
    await assert.rejects(runProductionBackup(baseEnv(), adapters, {backupClass: 'hourly', scheduledAt: TEST_SCHEDULED_AT}), /synthetic upload failure/);
    await assert.rejects(access(captured.plaintextPath!), /ENOENT/);
    await assert.rejects(access(captured.ciphertextPath!), /ENOENT/);
  });

  await check('10. only the encrypted temp file (never the plaintext) is passed to the upload adapter', async () => {
    const captured: Captured = {uploads: []};
    const adapters = fakeAdapters({}, captured);
    await runProductionBackup(baseEnv(), adapters, {backupClass: 'hourly', scheduledAt: TEST_SCHEDULED_AT});
    assert.equal(captured.uploads.length, 1);
    assert.notEqual(captured.uploads[0]!.filePath, captured.plaintextPath);
    assert.equal(captured.uploads[0]!.filePath, captured.ciphertextPath);
    const uploadedBytes = captured.uploads[0]!.bytesAtUploadTime;
    assert.ok(uploadedBytes.toString('utf8').startsWith('AGE-ENCRYPTED:'), 'upload adapter must receive the encrypted file, not raw plaintext');
    assert.equal(uploadedBytes.length, captured.uploads[0]!.contentLength, 'ContentLength must match the actual encrypted file size');
    // Both temp files are gone once the orchestrator returns — cleanup runs even on success.
    await assert.rejects(access(captured.plaintextPath!), /ENOENT/);
    await assert.rejects(access(captured.ciphertextPath!), /ENOENT/);
  });

  await check('11. hourly object key is deterministic', async () => {
    const at = new Date('2026-09-21T05:17:00.000Z');
    const k1 = objectKey('hourly', at), k2 = objectKey('hourly', at);
    assert.equal(k1, k2);
    assert.equal(k1, `hourly/2026/09/21/${at.toISOString().replace(/[:.]/g, '-')}.dump.age`);
  });

  await check('12. daily promotion occurs only at the designated UTC run', async () => {
    assert.equal(isDesignatedDailyRun(new Date('2026-09-21T09:17:00.000Z')), true);
    assert.equal(isDesignatedDailyRun(new Date('2026-09-21T08:17:00.000Z')), false);
    assert.equal(isDesignatedDailyRun(new Date('2026-09-21T10:17:00.000Z')), false);
    const captured: Captured = {uploads: []};
    const promoted = await runProductionBackup(baseEnv(), fakeAdapters({}, captured), {backupClass: 'hourly', scheduledAt: new Date('2026-09-21T09:17:00.000Z')});
    assert.equal(promoted.dailyPromoted, true);
    assert.equal(captured.uploads.length, 2);
    assert.ok(captured.uploads.some((u) => u.key.startsWith('daily/')));
    const captured2: Captured = {uploads: []};
    const notPromoted = await runProductionBackup(baseEnv(), fakeAdapters({}, captured2), {backupClass: 'hourly', scheduledAt: new Date('2026-09-21T05:17:00.000Z')});
    assert.equal(notPromoted.dailyPromoted, false);
    assert.equal(captured2.uploads.length, 1);
  });

  await check('13. invalid backup class rejected (parseBackupClass, objectKey, and the orchestrator)', async () => {
    assert.throws(() => parseBackupClass(undefined), /BACKUP_CLASS_INVALID/);
    assert.throws(() => parseBackupClass('garbage'), /BACKUP_CLASS_INVALID/);
    assert.throws(() => parseBackupClass('Hourly'), /BACKUP_CLASS_INVALID/, 'case must match exactly, no silent coercion');
    assert.equal(parseBackupClass('hourly'), 'hourly');
    assert.equal(parseBackupClass('daily'), 'daily');
    assert.throws(() => objectKey('weekly' as unknown as 'hourly', new Date()), /BACKUP_CLASS_INVALID/);
    await assert.rejects(runProductionBackup(baseEnv(), fakeAdapters(), {backupClass: 'weekly' as unknown as 'hourly', scheduledAt: TEST_SCHEDULED_AT}), /BACKUP_CLASS_INVALID/);
  });

  await check('14. wrong bucket rejected before any upload, and at the readBackupEnv boundary', async () => {
    assert.throws(() => readBackupEnv(baseEnv({PRODUCTION_BACKUP_BUCKET: 'some-other-bucket'}) as unknown as NodeJS.ProcessEnv), /BACKUP_BUCKET_MISMATCH_REJECTED/);
    await assert.rejects(runProductionBackup(baseEnv({PRODUCTION_BACKUP_BUCKET: 'some-other-bucket'}), fakeAdapters(), {backupClass: 'hourly', scheduledAt: TEST_SCHEDULED_AT}), /BACKUP_BUCKET_MISMATCH_REJECTED/);
  });

  await check('15. symlink/special local artifact rejected at both the plaintext and ciphertext path', async () => {
    const targetDir = await mkdtemp(join(tmpdir(), 'backup-symlink-target-'));
    const target = join(targetDir, 'real.txt');
    await writeFile(target, 'not a dump');

    const captured1: Captured = {uploads: []};
    const plaintextSymlinkAdapters = fakeAdapters({dump: async (_env, outFile) => { captured1.plaintextPath = outFile; await symlink(target, outFile); return {exitCode: 0, stderrTail: ''}; }}, captured1);
    await assert.rejects(runProductionBackup(baseEnv(), plaintextSymlinkAdapters, {backupClass: 'hourly', scheduledAt: TEST_SCHEDULED_AT}), /BACKUP_SPECIAL_FILE_REJECTED/);
    assert.equal(captured1.uploads.length, 0);

    const captured2: Captured = {uploads: []};
    const ciphertextSymlinkAdapters = fakeAdapters({
      encryptToFile: async (_plaintextPath, ciphertextPath) => { captured2.ciphertextPath = ciphertextPath; await symlink(target, ciphertextPath); return {sha256: 'irrelevant', bytes: 1}; },
    }, captured2);
    await assert.rejects(runProductionBackup(baseEnv(), ciphertextSymlinkAdapters, {backupClass: 'hourly', scheduledAt: TEST_SCHEDULED_AT}), /BACKUP_SPECIAL_FILE_REJECTED/);
    assert.equal(captured2.uploads.length, 0);

    await assertOrdinaryFile(target); // sanity: an ordinary file at a different path is accepted
  });

  await check('16. workflow declares a dedicated non-cancelling concurrency group', async () => {
    const yaml = await readFile(join(import.meta.dirname, '../../.github/workflows/production-backup.yml'), 'utf8');
    assert.match(yaml, /concurrency:\s*\n\s*group:\s*production-backup/);
    assert.match(yaml, /cancel-in-progress:\s*false/);
  });

  await check('17. workflow triggers are exactly one hourly :17 schedule + workflow_dispatch (no push/pull_request), and declare scheduled_at', async () => {
    const yaml = await readFile(join(import.meta.dirname, '../../.github/workflows/production-backup.yml'), 'utf8');
    const onBlock = yaml.match(/^on:\n((?:[ \t]+.*\n?)*)/m)?.[1] ?? '';
    assert.ok(onBlock.includes('workflow_dispatch'), 'on: block must include workflow_dispatch');
    assert.ok(onBlock.includes('scheduled_at'), 'on: block must declare the scheduled_at input (F5)');
    assert.deepEqual([...onBlock.matchAll(/- cron: '([^']+)'/g)].map(m => m[1]), ['17 * * * *'], 'exactly one cron, minute 17 hourly');
    for (const forbidden of ['push:', 'pull_request:', 'pull_request_target:']) {
      assert.ok(!onBlock.includes(forbidden), `on: block must not include ${forbidden}`);
    }
  });

  await check('18. Production job is gated by main + the future activation variable', async () => {
    const yaml = await readFile(join(import.meta.dirname, '../../.github/workflows/production-backup.yml'), 'utf8');
    assert.match(yaml, /PRODUCTION_BACKUP_ACTIVATION/);
    assert.match(yaml, /R4_APPROVED/);
    assert.match(yaml, /refs\/heads\/main/);
  });

  await check('S1. fail-closed exclusive scheduler-source gate: only the explicitly selected source runs; unset/garbage fail closed before any secret', async () => {
    const shims = await shimDir();
    try {
      const gate = stepScript(readWorkflow('production-backup.yml'), 'Activation gate (must run before any secret is referenced)');
      const run = (event: string, source: string, ref = 'refs/heads/main', activation = 'R4_APPROVED', repoSource = source) =>
        runShell(gate, {GATE_EVENT: event, GATE_REF: ref, GATE_ACTIVATION: activation, GATE_SOURCE: source, GATE_REPO_SOURCE: repoSource}, shims);
      const expectRun = (r: ReturnType<typeof run>, code: number, passedOut: string, label: string) => {
        assert.equal(r.code, code, `${label}: exit code (${r.stdout})`);
        assert.equal(r.output.passed, passedOut, `${label}: passed output`);
      };
      for (const bad of ['', 'github_schedule', 'GITHUB_SCHEDULE ', 'both', 'true'])
        for (const event of ['schedule', 'workflow_dispatch']) expectRun(run(event, bad), 1, 'false', `${event} with selector ${JSON.stringify(bad)} => fail closed`);
      expectRun(run('schedule', 'GITHUB_SCHEDULE', 'refs/heads/main', 'R4_APPROVED', 'CLOUDFLARE_DISPATCH'), 1, 'false', 'environment-scoped value differs from the repository value => fail closed');
      expectRun(run('workflow_dispatch', 'CLOUDFLARE_DISPATCH', 'refs/heads/main', 'R4_APPROVED', ''), 1, 'false', 'variable only visible at environment scope => fail closed');
      expectRun(run('schedule', 'CLOUDFLARE_DISPATCH'), 0, 'false', 'schedule, Cloudflare selected => inert');
      expectRun(run('schedule', 'GITHUB_SCHEDULE'), 0, 'true', 'schedule, GitHub selected => runs');
      expectRun(run('workflow_dispatch', 'CLOUDFLARE_DISPATCH'), 0, 'true', 'dispatch, Cloudflare selected => runs');
      expectRun(run('workflow_dispatch', 'GITHUB_SCHEDULE'), 1, 'false', 'dispatch while GitHub is the source => refused (red)');
      expectRun(run('push', 'GITHUB_SCHEDULE'), 1, 'false', 'unsupported event => refused');
      expectRun(run('schedule', 'GITHUB_SCHEDULE', 'refs/heads/feature'), 1, 'false', 'non-main ref => refused');
      expectRun(run('schedule', 'GITHUB_SCHEDULE', 'refs/heads/main', ''), 0, 'false', 'activation not approved => inert');
      expectRun(run('workflow_dispatch', '', 'refs/heads/main', ''), 0, 'false', 'activation not approved wins over the selector check');
    } finally { await rm(shims, {recursive: true, force: true}); }
  });

  await check('S2. schedule scheduled_at = the immutable run created_at as-is (no invented :17 slot); delays, reruns, per-second keys, daily promotion; stale/future refused', async () => {
    const shims = await shimDir();
    try {
      const yaml = readWorkflow('production-backup.yml');
      const slot = stepScript(yaml, 'Resolve scheduled_at (secret-free)');
      const resolve = (event: string, created: string, now: string, input = '') =>
        runShell(slot, {SLOT_EVENT: event, SLOT_INPUT: input, SLOT_REPO: 'o/r', SLOT_RUN_ID: '1', FAKE_CREATED: created, FAKE_NOW_EPOCH: epoch(now)}, shims);
      const at = (created: string, now = created) => resolve('schedule', created, now).output.scheduled_at;
      // created_at is used as-is, whatever the delay of the event (no modulo-hour mapping)
      for (const c of ['2026-09-21T09:17:00Z', '2026-09-21T09:24:31Z', '2026-09-21T10:18:00Z', '2026-09-21T11:49:59Z', '2026-09-21T00:01:00Z'])
        assert.equal(at(c), c.replace('Z', '.000Z'), `created_at ${c} is used verbatim`);
      // a 09:17 event delayed 61 minutes is created at 10:18: it is labelled 10:18, NOT 10:17, and does not claim the 09h daily promotion
      assert.equal(isDesignatedDailyRun(parseScheduledAt(at('2026-09-21T10:18:00Z')!)), false, 'delayed 09:17 event (created 10:18) is not promoted');
      assert.equal(isDesignatedDailyRun(parseScheduledAt(at('2026-09-21T09:24:31Z')!)), true, 'run created in UTC hour 09 is promoted');
      assert.equal(isDesignatedDailyRun(parseScheduledAt(at('2026-09-21T05:20:00Z')!)), false);
      // a rerun keeps created_at: same scheduled_at and key, as long as the job starts within the age limit
      const first = at('2026-09-21T09:24:31Z', '2026-09-21T09:25:00Z')!, rerun = at('2026-09-21T09:24:31Z', '2026-09-21T09:50:00Z')!;
      assert.equal(first, rerun);
      assert.equal(objectKey('hourly', parseScheduledAt(first)), objectKey('hourly', parseScheduledAt(rerun)));
      // runs created in different seconds get different keys (same-second creation is NOT excluded by design: it would overwrite)
      const keys = ['2026-09-21T10:18:00Z', '2026-09-21T10:18:01Z', '2026-09-21T10:40:00Z'].map(c => objectKey('hourly', parseScheduledAt(at(c)!)));
      assert.equal(new Set(keys).size, 3);
      assert.match(keys[0]!, /^hourly\/2026\/09\/21\/2026-09-21T10-18-00-000Z\.dump\.age$/);
      // refuse: queue age beyond 30 min (long queue, or a rerun much later), a future created_at, malformed values
      assert.equal(resolve('schedule', '2026-09-21T09:24:31Z', '2026-09-21T09:54:32Z').code, 1, '1801 s old => refused');
      assert.equal(resolve('schedule', '2026-09-21T09:24:31Z', '2026-09-21T09:54:31Z').code, 0, '1800 s old => accepted');
      assert.equal(resolve('schedule', '2026-09-21T09:24:31Z', '2026-09-22T17:45:00Z').code, 1, 'rerun a day later => refused, not mislabelled');
      assert.equal(resolve('schedule', '2026-09-21T09:30:01Z', '2026-09-21T09:24:31Z').code, 1, 'created_at in the future (> 300 s) => refused');
      assert.equal(resolve('schedule', '2026-09-21T09:24:31Z', '2026-09-21T09:20:00Z').code, 0, 'small clock skew tolerated');
      for (const bad of ['', 'null', '2026-09-21 09:17:00', 'garbage']) assert.equal(resolve('schedule', bad, '2026-09-21T09:30:00Z').code, 1, `malformed created_at ${JSON.stringify(bad)}`);
      assert.equal(resolve('workflow_dispatch', 'ignored', '2030-01-01T00:00:00Z', '2026-09-21T05:17:00.000Z').output.scheduled_at, '2026-09-21T05:17:00.000Z', 'Cloudflare dispatch input passes through unchanged');
      assert.match(yaml, /\n  slot:\n[\s\S]*?permissions:\n      actions: read\n/, 'only the slot job has actions: read');
      assert.match(yaml, /needs\.slot\.outputs\.scheduled_at/);
    } finally { await rm(shims, {recursive: true, force: true}); }
  });

  await check('S2b. job graph semantics: slot/backup conditions across selector x event x slot result (evaluated from the YAML expressions)', async () => {
    const yaml = readWorkflow('production-backup.yml');
    const cond = (job: string): string => {
      const start = yaml.indexOf(`\n  ${job}:`); const rest = yaml.slice(start + 1);
      const end = rest.slice(1).search(/\n  [a-z]+:\n/);
      const text = end < 0 ? rest : rest.slice(0, end + 1);
      return text.match(/\n    if: (.*)\n/)?.[1]?.replace(/^\$\{\{\s*|\s*\}\}$/g, '') ?? '';
    };
    const slotIf = cond('slot'), backupIf = cond('backup');
    assert.ok(slotIf && backupIf, 'both jobs declare an if');
    // a tiny evaluator for exactly the expression forms used (github.event_name, needs.selector.outputs.source, ==, ||, &&, !, failure(), cancelled())
    const evalIf = (expr: string, ctx: {event: string; source: string; needs: Record<string, string>}): boolean => {
      const js = expr
        .replace(/github\.event_name/g, JSON.stringify(ctx.event))
        .replace(/needs\.selector\.outputs\.source/g, JSON.stringify(ctx.source))
        .replace(/failure\(\)/g, String(Object.values(ctx.needs).includes('failure')))
        .replace(/cancelled\(\)/g, String(Object.values(ctx.needs).includes('cancelled')))
        .replace(/==/g, '===');
      assert.ok(/^[\s!&|()='a-z_"A-Z0-9]*$/.test(js), `unexpected expression form: ${js}`);
      return Function(`"use strict"; return (${js});`)() as boolean;
    };
    const SOURCES = ['', 'garbage', 'CLOUDFLARE_DISPATCH', 'GITHUB_SCHEDULE'];
    for (const source of SOURCES) for (const event of ['schedule', 'workflow_dispatch']) {
      const slotRuns = evalIf(slotIf, {event, source, needs: {selector: 'success'}});
      assert.equal(slotRuns, event === 'workflow_dispatch' || source === 'GITHUB_SCHEDULE', `slot runs? event=${event} source=${source}`);
      for (const slotResult of slotRuns ? ['success', 'failure', 'cancelled'] : ['skipped']) {
        const backupRuns = evalIf(backupIf, {event, source, needs: {selector: 'success', slot: slotResult}});
        assert.equal(backupRuns, slotResult === 'success' || slotResult === 'skipped', `backup runs? event=${event} source=${source} slot=${slotResult}`);
      }
    }
    // the cases that matter: Cloudflare dispatch still reaches the gate (slot runs and succeeds); a skipped slot (schedule while Cloudflare is the source) still reaches the gate, which then skips; a failed/cancelled slot never reaches any secret
    assert.equal(evalIf(backupIf, {event: 'workflow_dispatch', source: 'CLOUDFLARE_DISPATCH', needs: {selector: 'success', slot: 'success'}}), true);
    assert.equal(evalIf(backupIf, {event: 'schedule', source: 'CLOUDFLARE_DISPATCH', needs: {selector: 'success', slot: 'skipped'}}), true);
    assert.equal(evalIf(backupIf, {event: 'schedule', source: 'GITHUB_SCHEDULE', needs: {selector: 'success', slot: 'failure'}}), false);
    assert.match(yaml, /\n  backup:\n    needs: \[selector, slot\]\n/);
    assert.ok(!/\n  selector:[\s\S]*?\n    environment:[\s\S]*?\n  slot:/.test(yaml), 'selector job has no environment (repository scope)');
  });

  await check('S3. the backup job consumes only the resolved scheduled_at; scripts/production-backup.ts, secrets, permissions and environment are unchanged', async () => {
    const yaml = readWorkflow('production-backup.yml');
    assert.match(yaml, /SCHEDULED_AT: \$\{\{ needs\.slot\.outputs\.scheduled_at \}\}/);
    assert.ok(!/SCHEDULED_AT: \$\{\{ inputs\./.test(yaml), 'the backup step must not read the raw input');
    const sha = createHash('sha256').update(readFileSync(join(import.meta.dirname, '../../scripts/production-backup.ts'))).digest('hex');
    assert.equal(sha, 'a571e89675c70c38d342c54441db66313c976c55b1d31e1be873ece2105596e6');
    const slotJob = yaml.slice(yaml.indexOf('\n  slot:'), yaml.indexOf('\n  backup:'));
    assert.ok(!slotJob.includes('secrets.') && !slotJob.includes('environment:') && !slotJob.includes('checkout'), 'slot job: no secret, no environment, no checkout');
    const gateStart = yaml.indexOf('- name: Activation gate'); const gateEnd = yaml.indexOf('- name: Prepare CA root');
    assert.ok(!yaml.slice(gateStart, gateEnd).includes('secrets.'), 'gate step references no secret');
    assert.deepEqual([...new Set([...yaml.matchAll(/secrets\.(\w+)/g)].map(m => m[1]))].sort(), [
      'PRODUCTION_BACKUP_PGDATABASE', 'PRODUCTION_BACKUP_PGHOST', 'PRODUCTION_BACKUP_PGPASSWORD', 'PRODUCTION_BACKUP_PGPORT', 'PRODUCTION_BACKUP_PGUSER',
      'PRODUCTION_BACKUP_R2_ACCESS_KEY_ID', 'PRODUCTION_BACKUP_R2_ACCOUNT_ID', 'PRODUCTION_BACKUP_R2_SECRET_ACCESS_KEY']);
    assert.match(yaml, /\npermissions:\n  contents: read\n/);
    assert.match(yaml, /environment: production-backup/);
  });

  await check('S4. freshness counts only runs whose backup STEP succeeded (skipped-gate runs are not backups) and goes red on missing/stale/disabled', async () => {
    const yaml = readWorkflow('production-backup-freshness.yml');
    assert.match(yaml, /permissions:\n  actions: read\n/);
    assert.ok(!/secrets\./.test(yaml) && !/environment:/.test(yaml), 'no secret, no environment');
    assert.ok(!/\n(\s*)(push|pull_request|pull_request_target):/.test(yaml));
    const shims = await shimDir();
    try {
      const script = stepScript(yaml, 'Check scheduled backup freshness');
      const NOW = '2026-09-21T11:47:00.000Z';
      const run = (source: string, state: string, runs: Array<[number, string]>, okIds: number[]) =>
        runShell(script, {FRESH_SOURCE: source, GH_TOKEN: 'x', REPO: 'o/r', FAKE_NOW_EPOCH: epoch(NOW), FAKE_STATE: state,
          FAKE_RUNS: runs.map(([id, t]) => `${id} ${t}`).join('\n'), FAKE_OK_IDS: okIds.join(' ')}, shims);
      const runs: Array<[number, string]> = [[4, '2026-09-21T11:24:00Z'], [3, '2026-09-21T10:23:00Z'], [2, '2026-09-21T09:25:00Z'], [1, '2026-09-21T08:22:00Z']];
      assert.equal(run('', 'active', [], []).code, 0, 'inert when GitHub is not the source');
      assert.equal(run('CLOUDFLARE_DISPATCH', 'disabled_inactivity', [], []).code, 0, 'inert for the Cloudflare source');
      assert.equal(run('GITHUB_SCHEDULE', 'active', runs, [1, 2, 3, 4]).code, 0, 'fresh + daily slot present, all steps succeeded => green');
      assert.equal(run('GITHUB_SCHEDULE', 'disabled_inactivity', runs, [1, 2, 3, 4]).code, 1, 'auto-disabled workflow => red');
      assert.equal(run('GITHUB_SCHEDULE', 'active', [], []).code, 1, 'no run at all => red');
      assert.equal(run('GITHUB_SCHEDULE', 'active', runs, []).code, 1, 'overall-success runs whose backup step did not succeed (gate skip) => red, not green');
      assert.equal(run('GITHUB_SCHEDULE', 'active', runs, [1, 2]).code, 1, 'recent runs skipped, only old ones have a real backup => red');
      assert.equal(run('GITHUB_SCHEDULE', 'active', runs, [3, 4]).code, 1, 'recent real backups but the UTC-hour-09 run was a skip => red');
      assert.equal(run('GITHUB_SCHEDULE', 'active', [[4, '2026-09-21T11:24:00Z'], [3, '2026-09-21T10:23:00Z'], [1, '2026-09-21T08:22:00Z']], [1, 3, 4]).code, 1, 'no run created in UTC hour 09 within 25h (delayed past 10:00) => red');
      assert.equal(run('GITHUB_SCHEDULE', 'active', [[4, '2026-09-21T11:24:00Z'], [2, '2026-09-21T09:00:00Z']], [2, 4]).code, 0, 'boundary: created 09:00:00 is in the daily hour');
      assert.equal(run('GITHUB_SCHEDULE', 'active', [[4, '2026-09-21T11:24:00Z'], [2, '2026-09-21T09:59:59Z']], [2, 4]).code, 0, 'boundary: created 09:59:59 is in the daily hour');
      assert.equal(run('GITHUB_SCHEDULE', 'active', [[4, '2026-09-21T11:24:00Z'], [2, '2026-09-21T10:00:00Z']], [2, 4]).code, 1, 'boundary: created 10:00:00 is not');
      assert.equal(run('GITHUB_SCHEDULE', 'active', [[2, '2026-09-21T09:25:00Z'], [1, '2026-09-21T08:22:00Z']], [1, 2]).code, 1, 'newest real backup older than 100 minutes => red');
      assert.equal(run('GITHUB_SCHEDULE', 'active', [[4, '2026-09-21T11:24:00Z'], [2, '2026-09-20T09:25:00Z']], [2, 4]).code, 1, 'daily slot run older than 25 hours => red');
    } finally { await rm(shims, {recursive: true, force: true}); }
  });

  await check('19. Worker dispatch target/ref/workflow are fixed constants, never request-controlled', async () => {
    assert.equal(TARGET_REPO, 'ginisato-hash/zao-rental');
    assert.equal(TARGET_WORKFLOW, 'production-backup.yml');
    assert.equal(TARGET_REF, 'main');
    let capturedUrl = '', capturedBody = '';
    const fakeFetch = (async (url: string, init?: RequestInit) => {
      capturedUrl = String(url); capturedBody = String(init?.body ?? '');
      return new Response(null, {status: 204});
    }) as typeof fetch;
    const result = await dispatchProductionBackup({GITHUB_ACTIONS_DISPATCH_TOKEN: 'synthetic-token'}, '2026-09-21T09:17:00.000Z', fakeFetch);
    assert.equal(result.ok, true);
    assert.ok(capturedUrl.includes(TARGET_REPO));
    assert.ok(capturedUrl.includes(TARGET_WORKFLOW));
    const body = JSON.parse(capturedBody);
    assert.equal(body.ref, TARGET_REF);
    assert.equal(body.inputs.scheduled_at, '2026-09-21T09:17:00.000Z');
  });

  await check('20. Worker never logs the dispatch token', async () => {
    const logs: string[] = [];
    const originalLog = console.log, originalError = console.error;
    console.log = (...a: unknown[]) => { logs.push(a.join(' ')); };
    console.error = (...a: unknown[]) => { logs.push(a.join(' ')); };
    const token = 'SECRET_DISPATCH_TOKEN_' + randomBytes(6).toString('hex');
    let capturedAuth = '';
    const fakeFetch = (async (_url: string, init?: RequestInit) => {
      capturedAuth = String((init?.headers as Record<string, string> | undefined)?.Authorization ?? '');
      return new Response(null, {status: 500});
    }) as typeof fetch;
    try {
      const result = await dispatchProductionBackup({GITHUB_ACTIONS_DISPATCH_TOKEN: token}, '2026-09-21T09:17:00.000Z', fakeFetch);
      assert.equal(result.ok, false);
      assert.ok(capturedAuth.includes(token), 'sanity: token is sent in the Authorization header');
    } finally { console.log = originalLog; console.error = originalError; }
    assert.ok(!logs.join('\n').includes(token), 'token must never appear in any logged line');
  });

  await check('21. Worker scheduled() converts Cloudflare scheduledTime (epoch ms) to the canonical ISO input', async () => {
    let capturedBody = '';
    const fakeFetch = (async (_url: string, init?: RequestInit) => { capturedBody = String(init?.body ?? ''); return new Response(null, {status: 204}); }) as typeof fetch;
    const waits: Promise<unknown>[] = [];
    const ctx = {waitUntil: (p: Promise<unknown>) => { waits.push(p); }};
    const epochMs = Date.parse('2026-09-21T09:17:00.000Z');
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fakeFetch;
    try {
      await worker.scheduled({cron: '17 * * * *', scheduledTime: epochMs}, {GITHUB_ACTIONS_DISPATCH_TOKEN: 'synthetic'}, ctx);
      await Promise.all(waits);
    } finally { globalThis.fetch = originalFetch; }
    assert.equal(JSON.parse(capturedBody).inputs.scheduled_at, '2026-09-21T09:17:00.000Z');
  });

  await check('22. child processes receive a minimal explicit env — unrelated parent secrets never leak', async () => {
    const source = {
      PATH: '/usr/bin', HOME: '/home/runner', LANG: 'C.UTF-8',
      SYNTHETIC_R2_SECRET: 'must-not-leak', AGE_BACKUP_RECIPIENT: 'must-not-leak-either', GITHUB_ACTIONS_DISPATCH_TOKEN: 'must-not-leak-either',
    } as unknown as NodeJS.ProcessEnv;
    const result = minimalPgChildEnv(source, {PGHOST: 'x', PGPASSWORD: 'y'});
    assert.equal(result.PATH, '/usr/bin');
    assert.equal(result.HOME, '/home/runner');
    assert.equal(result.PGHOST, 'x');
    assert.equal(result.PGPASSWORD, 'y');
    assert.equal(result.SYNTHETIC_R2_SECRET, undefined);
    assert.equal(result.AGE_BACKUP_RECIPIENT, undefined);
    assert.equal(result.GITHUB_ACTIONS_DISPATCH_TOKEN, undefined);
  });

  await check('23. Production host identity is bound to one exact fingerprint, not any *.neon.tech host', async () => {
    // Self-consistent test fingerprint: computed from a synthetic hostname, never the real Production
    // one (which this test suite has no way to know and must not try to discover).
    const testHost = 'ep-r2b-f4-test-9c2e.ap-southeast-1.aws.neon.tech';
    const testFingerprint = fingerprintHost(testHost);
    // Accept path: matching fingerprint passes.
    assertProductionHostFingerprint(testHost, testFingerprint);
    // Reject path: a different, syntactically valid direct Neon hostname does not match.
    const otherHost = 'ep-different-0000.ap-southeast-1.aws.neon.tech';
    assert.throws(() => assertProductionHostFingerprint(otherHost, testFingerprint), /BACKUP_HOST_FINGERPRINT_MISMATCH_REJECTED/);
    // readBackupEnv end-to-end, using the injectable expected-fingerprint parameter (never sourced
    // from an env var, so this override path is unreachable from the real CLI entrypoint).
    const env = readBackupEnv(baseEnv({PGHOST: testHost}) as unknown as NodeJS.ProcessEnv, testFingerprint);
    assert.equal(env.PGHOST, testHost);
    assert.throws(() => readBackupEnv(baseEnv({PGHOST: otherHost}) as unknown as NodeJS.ProcessEnv, testFingerprint), /BACKUP_HOST_FINGERPRINT_MISMATCH_REJECTED/);
    // The real committed constant is exactly 64 lowercase hex characters (a SHA-256 digest), not a hostname.
    assert.match(EXPECTED_PRODUCTION_HOST_FINGERPRINT_SHA256, /^[0-9a-f]{64}$/);
  });

  await check('24. Production port must be exactly 5432', async () => {
    assert.throws(() => assertProductionPort('6543'), /BACKUP_PORT_REJECTED/);
    assert.doesNotThrow(() => assertProductionPort('5432'));
    assert.throws(() => readBackupEnv(baseEnv({PGPORT: '6543'}) as unknown as NodeJS.ProcessEnv), /BACKUP_PORT_REJECTED/);
  });

  await check('25. scheduled-occurrence timestamp is validated strictly, never falls back to the wall clock', async () => {
    assert.throws(() => parseScheduledAt(undefined), /BACKUP_SCHEDULED_AT_MISSING/);
    assert.throws(() => parseScheduledAt(''), /BACKUP_SCHEDULED_AT_MISSING/);
    assert.throws(() => parseScheduledAt('not-a-timestamp'), /BACKUP_SCHEDULED_AT_INVALID/);
    assert.throws(() => parseScheduledAt('2026-09-21T05:17:00+09:00'), /BACKUP_SCHEDULED_AT_INVALID/, 'only canonical Z-suffixed UTC is accepted, no ambiguous offset form');
    assert.throws(() => parseScheduledAt('2026-09-21'), /BACKUP_SCHEDULED_AT_INVALID/);
    const parsed = parseScheduledAt('2026-09-21T05:17:00.000Z');
    assert.equal(parsed.toISOString(), '2026-09-21T05:17:00.000Z');
  });

  await check('26. a retry of the same scheduled occurrence resolves to the same deterministic object key', async () => {
    const scheduledAt = parseScheduledAt('2026-09-21T05:17:00.000Z');
    const captured1: Captured = {uploads: []};
    const r1 = await runProductionBackup(baseEnv(), fakeAdapters({}, captured1), {backupClass: 'hourly', scheduledAt});
    const captured2: Captured = {uploads: []};
    const r2 = await runProductionBackup(baseEnv(), fakeAdapters({}, captured2), {backupClass: 'hourly', scheduledAt});
    assert.equal(r1.key, r2.key, 'retrying the same scheduled occurrence must not produce a new object key');
  });

  await check('27. streaming-only design: production-backup.ts never imports readFile (whole-buffer regression guard)', async () => {
    const source = await readFile(join(import.meta.dirname, '../../scripts/production-backup.ts'), 'utf8');
    const importLine = source.split('\n').find((l) => l.includes("from 'node:fs/promises'"));
    assert.ok(importLine, 'expected a node:fs/promises import for mkdtemp/rm/lstat');
    assert.ok(!/\breadFile\b/.test(importLine!), 'scripts/production-backup.ts must not import readFile — the plaintext/ciphertext path must stay streaming-only, never a whole-buffer read');
  });

  await check('28. streaming encryption produces a byte-identical round trip and a correct plaintext hash', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'backup-stream-unit-'));
    try {
      const plaintextPath = join(dir, 'plain.dump');
      const ciphertextPath = join(dir, 'cipher.dump.age');
      const payload = 'streaming unit test payload '.repeat(50_000); // ~1.4MB, large enough to span multiple stream chunks
      await writeFile(plaintextPath, payload);
      const identity = await age.generateIdentity();
      const recipient = await age.identityToRecipient(identity);
      const {sha256, bytes} = await encryptFileToFileStreaming(plaintextPath, ciphertextPath, recipient);
      assert.equal(sha256, createHash('sha256').update(payload).digest('hex'));
      const cipherStat = await readFile(ciphertextPath);
      assert.equal(cipherStat.length, bytes);
      const decrypter = new age.Decrypter();
      decrypter.addIdentity(identity);
      const decrypted = await decrypter.decrypt(new Uint8Array(cipherStat));
      assert.equal(createHash('sha256').update(decrypted).digest('hex'), sha256);
    } finally { await rm(dir, {recursive: true, force: true}).catch(() => {}); }
  });

  // ---- F8: explicit libpq CA root for sslmode=verify-full ----

  await check('29 (F8-A). pg_dump child env carries the fixed Production CA root, alongside the existing TLS settings', async () => {
    const env = buildPgDumpChildEnv(baseEnv(), EXPECTED_PRODUCTION_CA_ROOT);
    assert.equal(env.PGSSLROOTCERT, EXPECTED_PRODUCTION_CA_ROOT);
    assert.equal(env.PGSSLMODE, 'verify-full');
    assert.equal(env.PGCHANNELBINDING, 'require');
    assert.equal(EXPECTED_PRODUCTION_CA_ROOT, '/etc/ssl/certs/ca-certificates.crt');
  });

  await check('30 (F8-B). an ambient PGSSLROOTCERT can never override the fixed Production CA path', async () => {
    const attackerSource = {PATH: '/usr/bin', PGSSLROOTCERT: '/tmp/fake-attacker-cert.pem'} as unknown as NodeJS.ProcessEnv;
    const env = buildPgDumpChildEnv(baseEnv(), EXPECTED_PRODUCTION_CA_ROOT, attackerSource);
    assert.equal(env.PGSSLROOTCERT, EXPECTED_PRODUCTION_CA_ROOT);
    assert.notEqual(env.PGSSLROOTCERT, '/tmp/fake-attacker-cert.pem');
    // Defense in depth: minimalPgChildEnv's own allow-list never carries PGSSLROOTCERT through at all,
    // regardless of what buildPgDumpChildEnv does with its extras.
    const minimal = minimalPgChildEnv(attackerSource, {});
    assert.equal(minimal.PGSSLROOTCERT, undefined);
  });

  await check('31 (F8-C). missing CA root fails closed before any pg_dump spawn, upload, or DB connection attempt', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'backup-ca-missing-'));
    try {
      await assert.rejects(assertCaRootUsable(join(dir, 'does-not-exist.crt')), /BACKUP_CA_ROOT_MISSING/);
      // No pg_dump binary reachable at all: if spawnPgDump tried to spawn before checking the CA root,
      // this would fail with BACKUP_PG_DUMP_SPAWN_ERROR instead — proving the CA check runs first.
      const previousPath = process.env.PATH;
      process.env.PATH = dir;
      try {
        const captured: Captured = {uploads: []};
        const adapters = fakeAdapters({dump: (env, outFile) => spawnPgDump(env, outFile, join(dir, 'does-not-exist.crt'))}, captured);
        await assert.rejects(runProductionBackup(baseEnv(), adapters, {backupClass: 'hourly', scheduledAt: TEST_SCHEDULED_AT}), /BACKUP_CA_ROOT_MISSING/);
        assert.equal(captured.uploads.length, 0);
      } finally { process.env.PATH = previousPath; }
    } finally { await rm(dir, {recursive: true, force: true}).catch(() => {}); }
  });

  await check('32 (F8-D). a non-file CA root (directory, or a symlink to a valid file) fails closed', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'backup-ca-nonfile-'));
    try {
      await assert.rejects(assertCaRootUsable(dir), /BACKUP_CA_ROOT_NOT_ORDINARY_FILE/, 'a directory must be rejected');
      const realCa = join(dir, 'real-ca.crt');
      await writeFile(realCa, 'SYNTHETIC CA BUNDLE');
      const linkedCa = join(dir, 'linked-ca.crt');
      await symlink(realCa, linkedCa);
      await assert.rejects(assertCaRootUsable(linkedCa), /BACKUP_CA_ROOT_NOT_ORDINARY_FILE/, 'a symlink must be rejected even when it points at a valid file');
      await assert.doesNotReject(assertCaRootUsable(realCa), 'sanity: the real ordinary file it points to is accepted directly');
    } finally { await rm(dir, {recursive: true, force: true}).catch(() => {}); }
  });

  await check('33 (F8-E). an unreadable CA root fails closed, via a deterministic injected EACCES (not chmod/root-dependent)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'backup-ca-unreadable-'));
    try {
      const caPath = join(dir, 'unreadable-ca.crt');
      await writeFile(caPath, 'SYNTHETIC CA BUNDLE');
      const alwaysDenied: FsAccessChecker = async () => { throw Object.assign(new Error('EACCES'), {code: 'EACCES'}); };
      await assert.rejects(assertCaRootUsable(caPath, alwaysDenied), /BACKUP_CA_ROOT_UNREADABLE/);
      // Sanity: the same file with the real accessibility checker (default) is accepted.
      await assert.doesNotReject(assertCaRootUsable(caPath));
    } finally { await rm(dir, {recursive: true, force: true}).catch(() => {}); }
  });

  await check('34 (F8-F). unrelated child processes (pg_restore --list, version probes) remain fully secret-free, including a fake ambient CA path', async () => {
    const source = {
      PATH: '/usr/bin', HOME: '/home/runner',
      PGSSLROOTCERT: '/tmp/fake-attacker-cert.pem', SYNTHETIC_R2_SECRET: 'must-not-leak',
      AGE_BACKUP_RECIPIENT: 'must-not-leak-either', GITHUB_ACTIONS_DISPATCH_TOKEN: 'must-not-leak-either',
    } as unknown as NodeJS.ProcessEnv;
    const result = minimalPgChildEnv(source, {});
    assert.equal(result.PGSSLROOTCERT, undefined);
    assert.equal(result.SYNTHETIC_R2_SECRET, undefined);
    assert.equal(result.AGE_BACKUP_RECIPIENT, undefined);
    assert.equal(result.GITHUB_ACTIONS_DISPATCH_TOKEN, undefined);
    assert.equal(result.PATH, '/usr/bin');
  });

  // ---- F9: the pinned postgres:18 job container has no CA bundle; the workflow prepares exactly the root the backup verifies against ----
  const workflowSteps = async (): Promise<{yaml: string; steps: Map<string, string>}> => {
    const yaml = await readFile(join(import.meta.dirname, '../../.github/workflows/production-backup.yml'), 'utf8');
    const steps = new Map<string, string>();
    for (const block of yaml.split(/\n      - name: /).slice(1)) steps.set(block.split('\n')[0]!.trim(), block);
    return {yaml, steps};
  };
  const CA_STEP = 'Prepare CA root (secret-free)';

  await check('35 (F9-A). workflow has a secret-free CA preparation step, gated by the activation gate output', async () => {
    const {steps} = await workflowSteps();
    const block = steps.get(CA_STEP);
    assert.ok(block, 'CA preparation step must exist');
    assert.match(block, /if: steps\.gate\.outputs\.passed == 'true'/);
    assert.match(block, /set -eu\b/);
  });

  await check('36 (F9-B). CA preparation runs after the activation gate and before any step that references a secret (including the Production backup step)', async () => {
    const {steps} = await workflowSteps();
    const order = [...steps.keys()];
    const ca = order.indexOf(CA_STEP);
    const gate = order.findIndex((n) => n.startsWith('Activation gate'));
    const backup = order.indexOf('Run production backup');
    assert.ok(gate >= 0 && ca > gate && backup > ca, `order must be gate < CA < backup, got ${order.join(' | ')}`);
    const firstSecretStep = order.findIndex((n) => /secrets\./.test(steps.get(n)!));
    assert.ok(firstSecretStep > ca, 'no step that references a secret may precede the CA preparation');
  });

  await check('37 (F9-C). CA preparation installs only ca-certificates without recommends, then proves the exact root is an ordinary readable file', async () => {
    const {steps} = await workflowSteps();
    const block = steps.get(CA_STEP)!;
    assert.match(block, /DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ca-certificates\n/);
    const installs = block.match(/apt-get install[^\n]*/g) ?? [];
    assert.equal(installs.length, 1, 'exactly one install command');
    for (const probe of ['test -f', 'test ! -L', 'test -r']) {
      assert.ok(block.includes(`${probe} ${EXPECTED_PRODUCTION_CA_ROOT}\n`), `${probe} on the exact root path`);
    }
    assert.equal(EXPECTED_PRODUCTION_CA_ROOT, '/etc/ssl/certs/ca-certificates.crt');
  });

  await check('38 (F9-D). CA preparation references no secret, var or env', async () => {
    const {steps} = await workflowSteps();
    const block = steps.get(CA_STEP)!;
    assert.ok(!/secrets\./.test(block), 'no secrets.* in the CA step');
    assert.ok(!/vars\./.test(block) && !/\n\s+env:/.test(block), 'no vars/env in the CA step');
  });

  await check('39 (F9-E). TLS stays verify-full + channel binding on the fixed root; no fallback CA path, ambient PGSSLROOTCERT, sslmode downgrade or image change', async () => {
    const {yaml} = await workflowSteps();
    assert.match(yaml, /image: postgres:18@sha256:86c951e05bf56c93d95d397747fb8820ac76cc3bedb78f43abd83eedbe3666ae\n/);
    for (const forbidden of ['PGSSLROOTCERT', 'PGSSLMODE', 'sslmode', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'NODE_EXTRA_CA_CERTS', 'NODE_TLS_REJECT_UNAUTHORIZED', 'update-ca-certificates']) {
      assert.ok(!yaml.includes(forbidden), `the workflow must not mention ${forbidden}`);
    }
    const childEnv = buildPgDumpChildEnv(baseEnv(), EXPECTED_PRODUCTION_CA_ROOT, {PATH: '/usr/bin', PGSSLROOTCERT: '/tmp/ambient.pem'} as unknown as NodeJS.ProcessEnv);
    assert.equal(childEnv.PGSSLMODE, 'verify-full');
    assert.equal(childEnv.PGCHANNELBINDING, 'require');
    assert.equal(childEnv.PGSSLROOTCERT, EXPECTED_PRODUCTION_CA_ROOT);
  });

  await goAgeInteroperabilityProof();
  await syntheticPg18IntegrationProof();
  await caRootPinnedImageProof();
}

// ---- F9: secret-free proof that the workflow's CA preparation yields the exact root in the pinned image ----

async function dockerRun(args: string[]): Promise<{code: number | null; out: string}> {
  // Docker client settings only; no Production credential or other env is ever passed to the client or the container.
  const env: Record<string, string | undefined> = {PATH: process.env.PATH, HOME: process.env.HOME};
  for (const k of ['DOCKER_HOST', 'DOCKER_CONFIG', 'DOCKER_CONTEXT']) if (process.env[k]) env[k] = process.env[k];
  return new Promise((resolve) => {
    const child = spawn('docker', args, {env: env as NodeJS.ProcessEnv, stdio: ['ignore', 'pipe', 'pipe']});
    let out = '';
    child.stdout?.on('data', (c: Buffer) => { out += c.toString(); });
    child.stderr?.on('data', (c: Buffer) => { out += c.toString(); });
    child.on('close', (code: number | null) => resolve({code, out}));
    child.on('error', () => resolve({code: null, out}));
  });
}

async function caRootPinnedImageProof(): Promise<void> {
  const root = EXPECTED_PRODUCTION_CA_ROOT;
  if ((await commandOutput('docker', ['--version'])) === null) {
    const reason = 'Docker is unavailable';
    if (process.env.CI === 'true') throw new Error(`BACKUP_TEST_CA_ROOT_PROOF_UNAVAILABLE_IN_CI: ${reason}`);
    console.log(`SKIP mandatory pinned-image CA root proof: ${reason}. Expected only in this local sandbox; this SKIP is disallowed whenever CI=true. NOT counted as PASS.`);
    return;
  }
  const yaml = await readFile(join(import.meta.dirname, '../../.github/workflows/production-backup.yml'), 'utf8');
  const block = yaml.split(/\n      - name: /).find((b) => b.startsWith('Prepare CA root (secret-free)'));
  assert.ok(block, 'CA preparation step must exist');
  const script = (block.split('        run: |\n')[1] ?? '').split('\n').map((l) => l.replace(/^ {10}/, '')).join('\n').trim();
  assert.ok(script.includes('apt-get install'), 'the exact workflow script is what runs in the image');
  // The defect this step fixes: the pinned image has no CA bundle at the exact path the backup verifies against.
  const before = await dockerRun(['run', '--rm', '--entrypoint', 'sh', PINNED_PG18_IMAGE, '-c', `test ! -e ${root}`]);
  assert.equal(before.code, 0, `the pinned image is expected to lack ${root} before preparation (docker output: ${before.out.slice(0, 300)})`);
  // The exact workflow script, with no env and no credential, then an independent ordinary-file proof.
  const after = await dockerRun(['run', '--rm', '--entrypoint', 'sh', PINNED_PG18_IMAGE, '-c', `${script}\nstat -c '%F' ${root}`]);
  assert.equal(after.code, 0, `CA preparation failed in the pinned image (docker output: ${after.out.slice(-400)})`);
  assert.ok(after.out.trim().endsWith('regular file'), 'the exact root is an ordinary file after preparation');
  passed++;
  console.log(`PASS F9. the workflow's CA preparation, run unchanged in ${PINNED_PG18_IMAGE} with no credential/env, turns an absent ${root} into an ordinary readable file (secret-free)`);
}

// ---- F2: mandatory cross-implementation proof against the official Go age CLI ----

const AGE_VERSION = '1.3.2';
const AGE_RELEASES: Record<string, {asset: string; sha256: string}> = {
  'linux-x64': {asset: `age-v${AGE_VERSION}-linux-amd64.tar.gz`, sha256: 'cbe24006683f8eb669266162894b9a522a1af52f2665fbc63a4bb032ed26ac10'},
  'darwin-arm64': {asset: `age-v${AGE_VERSION}-darwin-arm64.tar.gz`, sha256: 'e2020b073c44f692685a24d6abc378817eb81ffaaf49fd0531ef8565f767f2f5'},
};

function ageReleaseKey(): string | null {
  if (process.platform === 'linux' && process.arch === 'x64') return 'linux-x64';
  if (process.platform === 'darwin' && process.arch === 'arm64') return 'darwin-arm64';
  return null;
}

async function runOk(bin: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(bin, args, {stdio: ['ignore', 'ignore', 'ignore'] as const});
    child.on('close', (code) => code === 0 ? resolve() : reject(new Error(`${bin} ${args.join(' ')} exited ${code}`)));
    child.on('error', reject);
  });
}

/**
 * Downloads the official FiloSottile/age release (no curl-pipe-shell: bytes are fetched, checksum
 * verified, and only then written to disk and extracted with `tar`), caches it under `.local/`, and
 * returns paths to the verified `age`/`age-keygen` binaries. Returns null on an unsupported platform.
 */
async function ensureOfficialAge(): Promise<{ageBin: string; ageKeygenBin: string} | null> {
  const key = ageReleaseKey();
  if (!key) return null;
  const release = AGE_RELEASES[key]!;
  const cacheDir = join(process.cwd(), '.local', 'age-cli', `v${AGE_VERSION}-${key}`);
  const ageBin = join(cacheDir, 'age', 'age');
  const ageKeygenBin = join(cacheDir, 'age', 'age-keygen');
  try { await access(ageBin); await access(ageKeygenBin); return {ageBin, ageKeygenBin}; } catch { /* not cached yet */ }
  await mkdir(cacheDir, {recursive: true});
  const url = `https://github.com/FiloSottile/age/releases/download/v${AGE_VERSION}/${release.asset}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`BACKUP_TEST_AGE_DOWNLOAD_FAILED:${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const actualSha256 = createHash('sha256').update(bytes).digest('hex');
  if (actualSha256 !== release.sha256) throw new Error(`BACKUP_TEST_AGE_CHECKSUM_MISMATCH:expected=${release.sha256}:actual=${actualSha256}`);
  const tarPath = join(cacheDir, release.asset);
  await writeFile(tarPath, bytes);
  await runOk('tar', ['xzf', tarPath, '-C', cacheDir]);
  await chmod(ageBin, 0o755).catch(() => {});
  await chmod(ageKeygenBin, 0o755).catch(() => {});
  return {ageBin, ageKeygenBin};
}

async function goAgeInteroperabilityProof(): Promise<void> {
  const official = await ensureOfficialAge();
  if (!official) {
    console.log(`SKIP F2 cross-implementation proof: no pinned official age v${AGE_VERSION} binary for ${process.platform}/${process.arch} in this suite. NOT counted as PASS.`);
    return;
  }
  const dir = await mkdtemp(join(tmpdir(), 'age-interop-'));
  try {
    const identityPath = join(dir, 'identity.txt');
    await runOk(official.ageKeygenBin, ['-o', identityPath]);
    const identityText = await readFile(identityPath, 'utf8');
    const recipient = identityText.match(/^# public key: (age1\S+)/m)?.[1];
    const identityLine = identityText.split('\n').find((l) => l.startsWith('AGE-SECRET-KEY-'));
    assert.ok(recipient, 'age-keygen output must include the public-key comment line');
    assert.ok(identityLine, 'age-keygen output must include the AGE-SECRET-KEY- line');

    // Direction 1: R2B (age-encryption, streaming) encrypts -> official Go age CLI decrypts.
    const plaintextPath = join(dir, 'fixture.txt');
    const fixtureBytes = 'R2B cross-implementation fixture ' + randomBytes(16).toString('hex');
    await writeFile(plaintextPath, fixtureBytes);
    const ciphertextPath = join(dir, 'fixture.dump.age');
    const {sha256: plaintextSha256} = await encryptFileToFileStreaming(plaintextPath, ciphertextPath, recipient!);
    const decryptedPath = join(dir, 'fixture.decrypted.txt');
    await runOk(official.ageBin, ['-d', '-i', identityPath, '-o', decryptedPath, ciphertextPath]);
    const decryptedByGoSha256 = createHash('sha256').update(await readFile(decryptedPath)).digest('hex');
    assert.equal(decryptedByGoSha256, plaintextSha256, 'official Go age CLI must decrypt the R2B-produced ciphertext to the original bytes');

    // Direction 2 (preferred, included): official Go age CLI encrypts -> age-encryption decrypts.
    const ciphertext2Path = join(dir, 'fixture2.age');
    await runOk(official.ageBin, ['-r', recipient!, '-o', ciphertext2Path, plaintextPath]);
    const decrypter = new age.Decrypter();
    decrypter.addIdentity(identityLine!.trim());
    const decrypted2 = await decrypter.decrypt(new Uint8Array(await readFile(ciphertext2Path)));
    assert.equal(createHash('sha256').update(decrypted2).digest('hex'), plaintextSha256, 'age-encryption must decrypt a ciphertext produced by the official Go age CLI');

    passed++;
    console.log(`PASS F2. cross-implementation proof: R2B <-> official Go age v${AGE_VERSION} (${official.ageBin}) round-trips correctly in both directions; disposable identity/plaintext cleaned up`);
  } finally {
    await rm(dir, {recursive: true, force: true}).catch(() => {});
  }
}

// ---- F3: mandatory (non-skippable in CI) PostgreSQL 18 dump/restore proof ----

const PINNED_PG18_IMAGE = 'postgres:18@sha256:86c951e05bf56c93d95d397747fb8820ac76cc3bedb78f43abd83eedbe3666ae';

async function commandOutput(bin: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn(bin, args, {stdio: ['ignore', 'pipe', 'ignore'] as const});
    let out = '';
    child.stdout.on('data', (c: Buffer) => { out += c.toString(); });
    child.on('close', (code) => resolve(code === 0 ? out.trim() : null));
    child.on('error', () => resolve(null));
  });
}

function majorVersion(versionOutput: string | null): number | null {
  const m = versionOutput?.match(/PostgreSQL\)\s+(\d+)(?:\.\d+)?/);
  return m ? parseInt(m[1]!, 10) : null;
}

interface PgToolRunner {
  label: string;
  dump(pgEnv: Record<string, string>, outFile: string): Promise<number>;
  restoreList(dumpFile: string): Promise<number>;
  restore(pgEnv: Record<string, string>, dumpFile: string, targetDb: string): Promise<number>;
}

function directPgToolRunner(label: string): PgToolRunner {
  const run = (bin: string, args: string[], pgEnv: Record<string, string>) => new Promise<number>((resolve, reject) => {
    const child = spawn(bin, args, {env: minimalPgChildEnv(process.env, pgEnv), stdio: ['ignore', 'ignore', 'ignore'] as const});
    child.on('close', (code) => resolve(code ?? 1));
    child.on('error', reject);
  });
  return {
    label,
    dump: (pgEnv, outFile) => run('pg_dump', ['-Fc', '--no-owner', '--no-acl', '-f', outFile], pgEnv),
    restoreList: (dumpFile) => run('pg_restore', ['--list', dumpFile], {}),
    restore: (pgEnv, dumpFile, targetDb) => run('pg_restore', ['--no-owner', '--no-acl', '-d', targetDb, dumpFile], pgEnv),
  };
}

function dockerPgToolRunner(hostDir: string): PgToolRunner {
  const run = (bin: string, args: string[], pgEnv: Record<string, string>) => new Promise<number>((resolve, reject) => {
    const dockerArgs = [
      'run', '--rm', '--network', 'host',
      ...Object.keys(pgEnv).flatMap((k) => ['-e', k]),
      '-v', `${hostDir}:${hostDir}`, '-w', hostDir,
      '--entrypoint', bin,
      PINNED_PG18_IMAGE, ...args,
    ];
    // Values are forwarded from this spawn's own env by bare `-e KEY` (not `-e KEY=value`), so no
    // secret ever appears in `docker run`'s argv/process list.
    const child = spawn('docker', dockerArgs, {env: {...process.env, ...pgEnv}, stdio: ['ignore', 'ignore', 'ignore'] as const});
    child.on('close', (code) => resolve(code ?? 1));
    child.on('error', reject);
  });
  return {
    label: `Docker (${PINNED_PG18_IMAGE})`,
    dump: (pgEnv, outFile) => run('pg_dump', ['-Fc', '--no-owner', '--no-acl', '-f', outFile], pgEnv),
    restoreList: (dumpFile) => run('pg_restore', ['--list', dumpFile], {}),
    restore: (pgEnv, dumpFile, targetDb) => run('pg_restore', ['--no-owner', '--no-acl', '-d', targetDb, dumpFile], pgEnv),
  };
}

async function resolvePg18Tool(hostDir: string): Promise<{runner: PgToolRunner | null; reason: string}> {
  const ambientMajor = majorVersion(await commandOutput('pg_dump', ['--version']));
  if (ambientMajor === 18) return {runner: directPgToolRunner('ambient pg_dump/pg_restore (confirmed PostgreSQL 18)'), reason: 'ambient pg_dump/pg_restore report PostgreSQL 18'};
  const ambientDescription = ambientMajor === null ? 'absent from PATH' : `PostgreSQL ${ambientMajor}, not 18`;
  const dockerAvailable = (await commandOutput('docker', ['--version'])) !== null;
  if (!dockerAvailable) return {runner: null, reason: `ambient pg_dump is ${ambientDescription}, and Docker is unavailable`};
  // Defense in depth: confirm the pinned image's own client tools actually report major 18 before trusting them.
  const dockerVersionOut = await new Promise<string | null>((resolve) => {
    const child = spawn('docker', ['run', '--rm', '--entrypoint', 'pg_dump', PINNED_PG18_IMAGE, '--version'], {stdio: ['ignore', 'pipe', 'ignore'] as const});
    let out = '';
    child.stdout.on('data', (c: Buffer) => { out += c.toString(); });
    child.on('close', (code) => resolve(code === 0 ? out.trim() : null));
    child.on('error', () => resolve(null));
  });
  const dockerMajor = majorVersion(dockerVersionOut);
  if (dockerMajor !== 18) return {runner: null, reason: `ambient pg_dump is ${ambientDescription}, and the pinned Docker image reported ${dockerVersionOut ?? 'no version'} instead of PostgreSQL 18`};
  return {runner: dockerPgToolRunner(hostDir), reason: `ambient pg_dump is ${ambientDescription}; using the pinned ${PINNED_PG18_IMAGE} via Docker (confirmed PostgreSQL 18)`};
}

async function syntheticPg18IntegrationProof(): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'backup-e2e-'));
  const {runner, reason} = await resolvePg18Tool(dir);
  if (!runner) {
    if (process.env.CI === 'true') {
      await rm(dir, {recursive: true, force: true}).catch(() => {});
      throw new Error(`BACKUP_TEST_PG18_PROOF_UNAVAILABLE_IN_CI: ${reason}`);
    }
    console.log(`SKIP mandatory PostgreSQL 18 dump/restore proof: ${reason}. Expected only in this local sandbox (no Docker, no PG18 client tools); this SKIP is disallowed whenever CI=true. NOT counted as PASS.`);
    await rm(dir, {recursive: true, force: true}).catch(() => {});
    return;
  }
  console.log(`Using ${runner.label} for the PG18 round-trip proof.`);
  // A worktree's isolated-Postgres port is derived deterministically from its own path (see
  // scripts/worktree.ts), so two startIsolatedPostgres() instances cannot run concurrently from the
  // same worktree. The source `db` is fully stopped — and its port freed — before `restoreDb` starts.
  let sourceStopped = false;
  const db = await startIsolatedPostgres();
  try {
    await db.pool.query('CREATE TABLE synthetic_widgets (id serial primary key, name text not null, created_at timestamptz not null default now())');
    await db.pool.query("INSERT INTO synthetic_widgets (name) VALUES ('alpha'), ('beta'), ('gamma')");
    const before = (await db.pool.query('SELECT id, name FROM synthetic_widgets ORDER BY id')).rows;
    const pgEnv = {PGHOST: '127.0.0.1', PGPORT: String(db.identity.dbPort), PGDATABASE: db.identity.database, PGUSER: db.identity.user, PGPASSWORD: String(db.pool.options.password)};
    const dumpFile = join(dir, 'synthetic.dump');
    assert.equal(await runner.dump(pgEnv, dumpFile), 0, `${runner.label} pg_dump failed`);
    assert.equal(await runner.restoreList(dumpFile), 0, `${runner.label} pg_restore --list failed`);
    const plaintext = await readFile(dumpFile);
    const sha256Before = createHash('sha256').update(plaintext).digest('hex');
    await db.stop();
    sourceStopped = true;
    const identity = await age.generateIdentity();
    const recipient = await age.identityToRecipient(identity);
    const ciphertextPath = join(dir, 'synthetic.dump.age');
    const {sha256} = await encryptFileToFileStreaming(dumpFile, ciphertextPath, recipient);
    assert.equal(sha256, sha256Before);
    const decrypter = new age.Decrypter();
    decrypter.addIdentity(identity);
    const decrypted = await decrypter.decrypt(new Uint8Array(await readFile(ciphertextPath)));
    assert.equal(createHash('sha256').update(decrypted).digest('hex'), sha256Before);
    const restoreDb = await startIsolatedPostgres();
    try {
      const restoredFile = join(dir, 'restored.dump');
      await writeFile(restoredFile, decrypted);
      const restorePgEnv = {PGHOST: '127.0.0.1', PGPORT: String(restoreDb.identity.dbPort), PGUSER: restoreDb.identity.user, PGPASSWORD: String(restoreDb.pool.options.password)};
      assert.equal(await runner.restore(restorePgEnv, restoredFile, restoreDb.identity.database), 0, `${runner.label} pg_restore failed`);
      const after = (await restoreDb.pool.query('SELECT id, name FROM synthetic_widgets ORDER BY id')).rows;
      assert.deepEqual(after, before);
      passed++;
      console.log(`PASS F3. mandatory PostgreSQL 18 dump -> validate -> encrypt(streaming) -> decrypt -> restore proof via ${runner.label} reproduces identical rows (mechanism proof only, not Production restore acceptance)`);
    } finally { await restoreDb.stop(); }
  } finally {
    if (!sourceStopped) await db.stop();
    await rm(dir, {recursive: true, force: true}).catch(() => {});
  }
}

main().then(() => {
  console.log(`Production backup mechanism: ${passed} cases passed (see any SKIP line above for what a local sandbox cannot exercise).`);
}).catch((error: unknown) => {
  console.error('PRODUCTION_BACKUP_TEST_FAILED', (error as Error).stack ?? error);
  process.exit(1);
});
