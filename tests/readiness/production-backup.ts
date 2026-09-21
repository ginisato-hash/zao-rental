import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash, randomBytes} from 'node:crypto';
import {access, chmod, mkdir, mkdtemp, readFile, symlink, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import * as age from 'age-encryption';
import {
  type BackupAdapters, type BackupEnv, EXPECTED_PRODUCTION_BUCKET, EXPECTED_PRODUCTION_HOST_FINGERPRINT_SHA256,
  assertOrdinaryFile, assertProductionHost, assertProductionHostFingerprint, assertProductionPort,
  encryptFileToFileStreaming, fingerprintHost, isDesignatedDailyRun, minimalPgChildEnv, objectKey,
  parseBackupClass, parseScheduledAt, readBackupEnv, redactSecrets, runProductionBackup, spawnPgDump,
} from '../../scripts/production-backup';
import worker, {TARGET_REF, TARGET_REPO, TARGET_WORKFLOW, dispatchProductionBackup} from '../../apps/backup-scheduler-worker/src/index';
import {startIsolatedPostgres} from '../../scripts/postgres';

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
    const env = baseEnv({PGPASSWORD: password});
    const previousPath = process.env.PATH;
    process.env.PATH = `${dir}:${previousPath}`;
    try {
      const outFile = join(dir, 'out.dump');
      const result = await spawnPgDump(env, outFile);
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

  await check('17. workflow has no schedule/push/pull_request/pull_request_target trigger, and declares scheduled_at', async () => {
    const yaml = await readFile(join(import.meta.dirname, '../../.github/workflows/production-backup.yml'), 'utf8');
    const onBlock = yaml.match(/^on:\n((?:[ \t]+.*\n?)*)/m)?.[1] ?? '';
    assert.ok(onBlock.includes('workflow_dispatch'), 'on: block must include workflow_dispatch');
    assert.ok(onBlock.includes('scheduled_at'), 'on: block must declare the scheduled_at input (F5)');
    for (const forbidden of ['schedule:', 'push:', 'pull_request:', 'pull_request_target:']) {
      assert.ok(!onBlock.includes(forbidden), `on: block must not include ${forbidden}`);
    }
  });

  await check('18. Production job is gated by main + the future activation variable', async () => {
    const yaml = await readFile(join(import.meta.dirname, '../../.github/workflows/production-backup.yml'), 'utf8');
    assert.match(yaml, /PRODUCTION_BACKUP_ACTIVATION/);
    assert.match(yaml, /R4_APPROVED/);
    assert.match(yaml, /refs\/heads\/main/);
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

  await goAgeInteroperabilityProof();
  await syntheticPg18IntegrationProof();
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
    await db.stop();
    await rm(dir, {recursive: true, force: true}).catch(() => {});
  }
}

main().then(() => {
  console.log(`Production backup mechanism: ${passed} cases passed (see any SKIP line above for what a local sandbox cannot exercise).`);
}).catch((error: unknown) => {
  console.error('PRODUCTION_BACKUP_TEST_FAILED', (error as Error).stack ?? error);
  process.exit(1);
});
