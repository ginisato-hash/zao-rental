import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash, randomBytes} from 'node:crypto';
import {access, chmod, mkdtemp, readFile, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import * as age from 'age-encryption';
import {
  type BackupAdapters, type BackupEnv, EXPECTED_PRODUCTION_BUCKET,
  assertOrdinaryFile, assertProductionHost, isDesignatedDailyRun, objectKey,
  readBackupEnv, redactSecrets, runProductionBackup, spawnPgDump,
} from '../../scripts/production-backup';
import {TARGET_REF, TARGET_REPO, TARGET_WORKFLOW, dispatchProductionBackup} from '../../apps/backup-scheduler-worker/src/index';
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

function fakeAdapters(overrides: Partial<BackupAdapters> = {}, captured: {plaintextPath?: string; uploads: {bucket: string; key: string; body: Uint8Array}[]} = {uploads: []}): BackupAdapters {
  return {
    dump: async (_env, outFile) => { captured.plaintextPath = outFile; await writeFile(outFile, 'SYNTHETIC PLAINTEXT DUMP BYTES ' + randomBytes(8).toString('hex')); return {exitCode: 0, stderrTail: ''}; },
    validate: async () => ({ok: true}),
    encrypt: async (plaintext) => Buffer.concat([Buffer.from('AGE-ENCRYPTED:'), Buffer.from(plaintext)]),
    upload: async (bucket, key, body) => { captured.uploads.push({bucket, key, body}); },
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
    const captured = {uploads: []} as {plaintextPath?: string; uploads: {bucket: string; key: string; body: Uint8Array}[]};
    const adapters = fakeAdapters({dump: async () => ({exitCode: 1, stderrTail: 'synthetic failure'})}, captured);
    await assert.rejects(runProductionBackup(baseEnv(), adapters, {backupClass: 'hourly'}), /BACKUP_PG_DUMP_FAILED/);
    assert.equal(captured.uploads.length, 0);
  });

  await check('6. zero-byte dump blocks upload', async () => {
    const captured = {uploads: []} as {plaintextPath?: string; uploads: {bucket: string; key: string; body: Uint8Array}[]};
    const adapters = fakeAdapters({dump: async (_env, outFile) => { captured.plaintextPath = outFile; await writeFile(outFile, ''); return {exitCode: 0, stderrTail: ''}; }}, captured);
    await assert.rejects(runProductionBackup(baseEnv(), adapters, {backupClass: 'hourly'}), /BACKUP_EMPTY_ARCHIVE_REJECTED/);
    assert.equal(captured.uploads.length, 0);
    await assert.rejects(access(captured.plaintextPath!), /ENOENT/);
  });

  await check('7. pg_restore validation failure blocks upload', async () => {
    const captured = {uploads: []} as {plaintextPath?: string; uploads: {bucket: string; key: string; body: Uint8Array}[]};
    const adapters = fakeAdapters({validate: async () => ({ok: false})}, captured);
    await assert.rejects(runProductionBackup(baseEnv(), adapters, {backupClass: 'hourly'}), /BACKUP_ARCHIVE_VALIDATION_FAILED/);
    assert.equal(captured.uploads.length, 0);
    await assert.rejects(access(captured.plaintextPath!), /ENOENT/);
  });

  await check('8. age encryption failure blocks upload and cleans plaintext', async () => {
    const captured = {uploads: []} as {plaintextPath?: string; uploads: {bucket: string; key: string; body: Uint8Array}[]};
    const adapters = fakeAdapters({encrypt: async () => { throw new Error('synthetic encryption failure'); }}, captured);
    await assert.rejects(runProductionBackup(baseEnv(), adapters, {backupClass: 'hourly'}), /synthetic encryption failure/);
    assert.equal(captured.uploads.length, 0);
    await assert.rejects(access(captured.plaintextPath!), /ENOENT/);
  });

  await check('9. R2 upload failure still cleans plaintext', async () => {
    const captured = {uploads: []} as {plaintextPath?: string; uploads: {bucket: string; key: string; body: Uint8Array}[]};
    const adapters = fakeAdapters({upload: async () => { throw new Error('synthetic upload failure'); }}, captured);
    await assert.rejects(runProductionBackup(baseEnv(), adapters, {backupClass: 'hourly'}), /synthetic upload failure/);
    await assert.rejects(access(captured.plaintextPath!), /ENOENT/);
  });

  await check('10. only encrypted bytes are passed to the upload adapter', async () => {
    const captured = {uploads: []} as {plaintextPath?: string; uploads: {bucket: string; key: string; body: Uint8Array}[]};
    const adapters = fakeAdapters({}, captured);
    await runProductionBackup(baseEnv(), adapters, {backupClass: 'hourly', now: new Date('2026-09-21T05:00:00.000Z')});
    assert.equal(captured.uploads.length, 1);
    const uploaded = Buffer.from(captured.uploads[0]!.body).toString('utf8');
    // The fake encryptor deterministically wraps its input as 'AGE-ENCRYPTED:<input>'; the upload
    // adapter must receive exactly that wrapped form, never the raw plaintext bytes on their own.
    assert.ok(uploaded.startsWith('AGE-ENCRYPTED:'), 'upload adapter must receive the encrypt() output, not raw plaintext');
    const rawPlaintextWouldLookLike = uploaded.slice('AGE-ENCRYPTED:'.length);
    assert.notEqual(uploaded, rawPlaintextWouldLookLike);
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
    const captured = {uploads: []} as {plaintextPath?: string; uploads: {bucket: string; key: string; body: Uint8Array}[]};
    const promoted = await runProductionBackup(baseEnv(), fakeAdapters({}, captured), {backupClass: 'hourly', now: new Date('2026-09-21T09:17:00.000Z')});
    assert.equal(promoted.dailyPromoted, true);
    assert.equal(captured.uploads.length, 2);
    assert.ok(captured.uploads.some((u) => u.key.startsWith('daily/')));
    const captured2 = {uploads: []} as {plaintextPath?: string; uploads: {bucket: string; key: string; body: Uint8Array}[]};
    const notPromoted = await runProductionBackup(baseEnv(), fakeAdapters({}, captured2), {backupClass: 'hourly', now: new Date('2026-09-21T05:17:00.000Z')});
    assert.equal(notPromoted.dailyPromoted, false);
    assert.equal(captured2.uploads.length, 1);
  });

  await check('13. invalid backup class rejected', async () => {
    assert.throws(() => objectKey('weekly' as unknown as 'hourly', new Date()), /BACKUP_CLASS_INVALID/);
    await assert.rejects(runProductionBackup(baseEnv(), fakeAdapters(), {backupClass: 'weekly' as unknown as 'hourly'}), /BACKUP_CLASS_INVALID/);
  });

  await check('14. wrong bucket rejected before any upload', async () => {
    assert.throws(() => readBackupEnv(baseEnv({PRODUCTION_BACKUP_BUCKET: 'some-other-bucket'}) as unknown as NodeJS.ProcessEnv), /BACKUP_BUCKET_MISMATCH_REJECTED/);
    await assert.rejects(runProductionBackup(baseEnv({PRODUCTION_BACKUP_BUCKET: 'some-other-bucket'}), fakeAdapters(), {backupClass: 'hourly'}), /BACKUP_BUCKET_MISMATCH_REJECTED/);
  });

  await check('15. symlink/special local artifact rejected', async () => {
    const captured = {uploads: []} as {plaintextPath?: string; uploads: {bucket: string; key: string; body: Uint8Array}[]};
    const target = join(await mkdtemp(join(tmpdir(), 'backup-symlink-target-')), 'real.txt');
    await writeFile(target, 'not a dump');
    const adapters = fakeAdapters({dump: async (_env, outFile) => { captured.plaintextPath = outFile; await symlink(target, outFile); return {exitCode: 0, stderrTail: ''}; }}, captured);
    await assert.rejects(runProductionBackup(baseEnv(), adapters, {backupClass: 'hourly'}), /BACKUP_SPECIAL_FILE_REJECTED/);
    assert.equal(captured.uploads.length, 0);
    await assertOrdinaryFile(target); // sanity: an ordinary file at a different path is accepted
  });

  await check('16. workflow declares a dedicated non-cancelling concurrency group', async () => {
    const yaml = await readFile(join(import.meta.dirname, '../../.github/workflows/production-backup.yml'), 'utf8');
    assert.match(yaml, /concurrency:\s*\n\s*group:\s*production-backup/);
    assert.match(yaml, /cancel-in-progress:\s*false/);
  });

  await check('17. workflow has no schedule/push/pull_request/pull_request_target trigger', async () => {
    const yaml = await readFile(join(import.meta.dirname, '../../.github/workflows/production-backup.yml'), 'utf8');
    const onBlock = yaml.match(/^on:\n((?:[ \t]+.*\n?)*)/m)?.[1] ?? '';
    assert.ok(onBlock.includes('workflow_dispatch'), 'on: block must include workflow_dispatch');
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
    const result = await dispatchProductionBackup({GITHUB_ACTIONS_DISPATCH_TOKEN: 'synthetic-token'}, fakeFetch);
    assert.equal(result.ok, true);
    assert.ok(capturedUrl.includes(TARGET_REPO));
    assert.ok(capturedUrl.includes(TARGET_WORKFLOW));
    assert.equal(JSON.parse(capturedBody).ref, TARGET_REF);
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
      const result = await dispatchProductionBackup({GITHUB_ACTIONS_DISPATCH_TOKEN: token}, fakeFetch);
      assert.equal(result.ok, false);
      assert.ok(capturedAuth.includes(token), 'sanity: token is sent in the Authorization header');
    } finally { console.log = originalLog; console.error = originalError; }
    assert.ok(!logs.join('\n').includes(token), 'token must never appear in any logged line');
  });

  await syntheticIntegrationProof();
}

async function syntheticIntegrationProof(): Promise<void> {
  const available = await new Promise<boolean>((resolve) => {
    const child = spawn('pg_dump', ['--version'], {stdio: 'ignore'});
    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0));
  });
  if (!available) {
    console.log('SKIP synthetic dump/encrypt/decrypt/restore proof: pg_dump/pg_restore PostgreSQL 18 client tools are not on PATH in this environment. '
      + 'This is expected in a local dev sandbox with no docker/apt/brew access; the pinned PostgreSQL 18 container in '
      + '.github/workflows/production-backup.yml provides pg_dump/pg_restore in CI. NOT counted as PASS.');
    return;
  }
  const db = await startIsolatedPostgres();
  try {
    await db.pool.query('CREATE TABLE synthetic_widgets (id serial primary key, name text not null, created_at timestamptz not null default now())');
    await db.pool.query("INSERT INTO synthetic_widgets (name) VALUES ('alpha'), ('beta'), ('gamma')");
    const before = (await db.pool.query('SELECT id, name FROM synthetic_widgets ORDER BY id')).rows;
    const dir = await mkdtemp(join(tmpdir(), 'backup-e2e-'));
    const dumpFile = join(dir, 'synthetic.dump');
    await new Promise<void>((resolve, reject) => {
      const child = spawn('pg_dump', ['-Fc', '--no-owner', '--no-acl', '-f', dumpFile], {
        env: {...process.env, PGHOST: '127.0.0.1', PGPORT: String(db.identity.dbPort), PGDATABASE: db.identity.database, PGUSER: db.identity.user, PGPASSWORD: String(db.pool.options.password)},
      });
      child.on('close', (code: number | null) => code === 0 ? resolve() : reject(new Error('pg_dump exited ' + code)));
      child.on('error', reject);
    });
    await new Promise<void>((resolve, reject) => {
      const child = spawn('pg_restore', ['--list', dumpFile], {stdio: ['ignore', 'ignore', 'ignore'] as const});
      child.on('close', (code: number | null) => code === 0 ? resolve() : reject(new Error('pg_restore --list exited ' + code)));
      child.on('error', reject);
    });
    const plaintext = await readFile(dumpFile);
    const sha256Before = createHash('sha256').update(plaintext).digest('hex');
    const identity = await age.generateIdentity();
    const recipient = await age.identityToRecipient(identity);
    const encrypter = new age.Encrypter(); encrypter.addRecipient(recipient);
    const encrypted = await encrypter.encrypt(plaintext);
    const decrypter = new age.Decrypter(); decrypter.addIdentity(identity);
    const decrypted = await decrypter.decrypt(encrypted);
    assert.equal(createHash('sha256').update(decrypted).digest('hex'), sha256Before);
    const restoreDb = await startIsolatedPostgres();
    try {
      const restoredFile = join(dir, 'restored.dump');
      await writeFile(restoredFile, decrypted);
      await new Promise<void>((resolve, reject) => {
        const child = spawn('pg_restore', ['--no-owner', '--no-acl', '-d', restoreDb.identity.database, restoredFile], {
          env: {...process.env, PGHOST: '127.0.0.1', PGPORT: String(restoreDb.identity.dbPort), PGUSER: restoreDb.identity.user, PGPASSWORD: String(restoreDb.pool.options.password)},
        });
        child.on('close', (code: number | null) => code === 0 ? resolve() : reject(new Error('pg_restore exited ' + code)));
        child.on('error', reject);
      });
      const after = (await restoreDb.pool.query('SELECT id, name FROM synthetic_widgets ORDER BY id')).rows;
      assert.deepEqual(after, before);
      console.log('PASS 21. synthetic dump -> encrypt -> decrypt -> restore into an isolated PostgreSQL 18 fixture reproduces identical rows (mechanism proof only, not Production restore acceptance)');
      passed++;
    } finally { await restoreDb.stop(); }
  } finally { await db.stop(); }
}

main().then(() => {
  console.log(`Production backup mechanism: ${passed} cases passed (see SKIP line above if the local environment lacks pg_dump/pg_restore).`);
}).catch((error: unknown) => {
  console.error('PRODUCTION_BACKUP_TEST_FAILED', (error as Error).stack ?? error);
  process.exit(1);
});
