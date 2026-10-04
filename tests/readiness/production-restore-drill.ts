import assert from 'node:assert/strict';
import {randomBytes, createHash} from 'node:crypto';
import {chmod, copyFile, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {GetObjectCommand, type S3Client} from '@aws-sdk/client-s3';
import {Pool} from 'pg';
import * as age from 'age-encryption';
import {migrate, migrationPlan} from '../../packages/db/src/index';
import {EXPECTED_PRODUCTION_BUCKET, encryptFileToFileStreaming, fingerprintHost} from '../../scripts/production-backup';
import {
  DISPOSABLE_DATABASE_PATTERN, assertCustodyConfirmed, assertDisposableTarget, assertEmptyTarget, assertPgRestoreVersion, decryptBackupToFile,
  loadAgeIdentity, r2FetchAdapter, runPgRestore, runRestoreDrill, verifyRestoredDatabase,
  type CustodyConfirmation, type DrillAdapters, type RestoreTarget,
} from '../../scripts/production-restore-drill';
import {startIsolatedPostgres} from '../../scripts/postgres';

// Synthetic fixtures only: random bytes stand in for a pg_dump archive, an embedded loopback cluster stands in for
// the disposable restore target, and a shell script stands in for pg_restore. Nothing here touches R2 or Production,
// and none of it substitutes for a real Production restore drill.
let passed = 0;
async function check(name: string, fn: () => Promise<void>): Promise<void> { await fn(); passed++; console.log(`PASS ${name}`); }
const rejects = (fn: () => Promise<unknown> | unknown, code: string) => assert.rejects(async () => { await fn(); }, (e: Error) => { assert.ok(e.message.startsWith(code), `${code} expected, got ${e.message}`); return true; });
const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const exists = (p: string) => lstat(p).then(() => true, () => false);

const root = await mkdtemp(join(tmpdir(), 'zao-restore-drill-test-'));
const KEY = 'hourly/2026/10/04/2026-10-04T05-17-00-000Z.dump.age';
const SCHEDULED_AT = '2026-10-04T05:17:00.000Z';
let db: Awaited<ReturnType<typeof startIsolatedPostgres>> | undefined;
let failedStage = 'setup';
try {
  const identity = await age.generateIdentity();
  const recipient = await age.identityToRecipient(identity);
  const otherIdentity = await age.generateIdentity();
  const plainPath = join(root, 'fixture.dump'), cipherPath = join(root, 'fixture.dump.age');
  const plain = randomBytes(300_000);
  await writeFile(plainPath, plain);
  const enc = await encryptFileToFileStreaming(plainPath, cipherPath, recipient);
  assert.equal(enc.sha256, sha(plain));
  const custody: CustodyConfirmation = {status: 'CUSTODY_CONFIRMED', roundtrip: 'PASS', locations: 2, recipientSha256Prefix: sha(recipient).slice(0, 12)};
  const loopback = (database: string): RestoreTarget => ({host: '127.0.0.1', port: 55432, user: 'drill', password: 'SYNTHETIC_' + randomBytes(6).toString('hex'), database});

  failedStage = 'target identity';
  await check('target must be loopback, non-Production and an owned disposable zr_<12 hex> name', async () => {
    assertDisposableTarget(loopback('zr_abcdef012345'));
    for (const host of ['ep-synthetic-1.ap-southeast-1.aws.neon.tech', '10.0.0.5', 'db.internal', '0.0.0.0'])
      await rejects(() => assertDisposableTarget({...loopback('zr_abcdef012345'), host}), 'RESTORE_TARGET_NOT_LOOPBACK_REJECTED');
    await rejects(() => assertDisposableTarget(loopback('zr_abcdef012345'), fingerprintHost('127.0.0.1')), 'RESTORE_TARGET_IS_PRODUCTION_REJECTED');
    for (const database of ['neondb', 'zr_drill_abc123', 'zr_abcdef01234', 'zr_abcdef0123456', 'ZR_ABCDEF012345', 'zr_abcdef012345;drop', 'postgres'])
      await rejects(() => assertDisposableTarget(loopback(database)), 'RESTORE_TARGET_NOT_DISPOSABLE_NAME_REJECTED');
    await rejects(() => assertDisposableTarget({...loopback('zr_abcdef012345'), port: 80}), 'RESTORE_TARGET_PORT_REJECTED');
    await rejects(() => assertDisposableTarget({...loopback('zr_abcdef012345'), password: ''}), 'RESTORE_TARGET_CREDENTIAL_MISSING');
    assert.ok(DISPOSABLE_DATABASE_PATTERN.test('zr_0123456789ab'));
  });

  failedStage = 'identity file';
  await check('age identity file must be caller-owned 0600, regular, outside the checkout and hold exactly one key', async () => {
    const good = join(root, 'identity.txt');
    await writeFile(good, `# created: synthetic\n# public key: ${recipient}\n${identity}\n`, {mode: 0o600});
    assert.equal(await loadAgeIdentity(good, process.cwd()), identity);
    const loose = join(root, 'identity-loose.txt'); await writeFile(loose, identity + '\n', {mode: 0o600}); await chmod(loose, 0o644);
    await rejects(() => loadAgeIdentity(loose, process.cwd()), 'RESTORE_IDENTITY_FILE_INVALID');
    const link = join(root, 'identity-link.txt'); await symlink(good, link);
    await rejects(() => loadAgeIdentity(link, process.cwd()), 'RESTORE_IDENTITY_FILE_INVALID');
    const two = join(root, 'identity-two.txt'); await writeFile(two, identity + '\n' + otherIdentity + '\n', {mode: 0o600});
    await rejects(() => loadAgeIdentity(two, process.cwd()), 'RESTORE_IDENTITY_FILE_INVALID');
    const none = join(root, 'identity-none.txt'); await writeFile(none, 'not a key\n', {mode: 0o600});
    await rejects(() => loadAgeIdentity(none, process.cwd()), 'RESTORE_IDENTITY_FILE_INVALID');
    await rejects(() => loadAgeIdentity('identity.txt', process.cwd()), 'RESTORE_IDENTITY_FILE_INVALID');
    const inside = join(process.cwd(), '.local', 'restore-drill-test-' + randomBytes(4).toString('hex'));
    await mkdir(inside, {recursive: true});
    try { const f = join(inside, 'identity.txt'); await writeFile(f, identity + '\n', {mode: 0o600}); await rejects(() => loadAgeIdentity(f, process.cwd()), 'RESTORE_IDENTITY_FILE_INVALID'); }
    finally { await rm(inside, {recursive: true, force: true}); }
  });

  failedStage = 'custody gate';
  await check('Production-class decryption needs a custody confirmation bound to the same identity', async () => {
    await assertCustodyConfirmed(identity, custody);
    await rejects(() => assertCustodyConfirmed(otherIdentity, custody), 'RESTORE_CUSTODY_RECIPIENT_MISMATCH');
    await rejects(() => assertCustodyConfirmed(identity, undefined as never), 'RESTORE_CUSTODY_NOT_CONFIRMED');
    await rejects(() => assertCustodyConfirmed(identity, {...custody, status: 'NOT_CONFIRMED' as never}), 'RESTORE_CUSTODY_NOT_CONFIRMED');
    await rejects(() => assertCustodyConfirmed(identity, {...custody, roundtrip: 'FAIL' as never}), 'RESTORE_CUSTODY_NOT_CONFIRMED');
    await rejects(() => assertCustodyConfirmed(identity, {...custody, locations: 0}), 'RESTORE_CUSTODY_NOT_CONFIRMED');
    await rejects(() => assertCustodyConfirmed(identity, {...custody, recipientSha256Prefix: 'ZZZ'}), 'RESTORE_CUSTODY_NOT_CONFIRMED');
  });

  failedStage = 'decrypt';
  await check('decrypt verifies key, ciphertext integrity and plaintext hash, and never leaves unverified plaintext', async () => {
    const out = join(root, 'ok.dump');
    const r = await decryptBackupToFile({ciphertextPath: cipherPath, plaintextPath: out, identity, expectedSha256: sha(plain), expectedBytes: plain.length});
    assert.deepEqual(r, {sha256: sha(plain), bytes: plain.length});
    assert.ok((await readFile(out)).equals(plain));
    await rm(out);
    const bad = join(root, 'bad.dump');
    await rejects(() => decryptBackupToFile({ciphertextPath: cipherPath, plaintextPath: bad, identity: otherIdentity, expectedSha256: sha(plain)}), 'RESTORE_WRONG_KEY_REJECTED');
    assert.equal(await exists(bad), false);
    const cipher = await readFile(cipherPath);
    const tampered = Buffer.from(cipher); tampered[tampered.length - 100] = tampered[tampered.length - 100]! ^ 0xff;
    const tamperedPath = join(root, 'tampered.age'); await writeFile(tamperedPath, tampered);
    await rejects(() => decryptBackupToFile({ciphertextPath: tamperedPath, plaintextPath: bad, identity, expectedSha256: sha(plain)}), 'RESTORE_CIPHERTEXT_INVALID');
    assert.equal(await exists(bad), false);
    const truncatedPath = join(root, 'truncated.age'); await writeFile(truncatedPath, cipher.subarray(0, cipher.length - 50));
    await rejects(() => decryptBackupToFile({ciphertextPath: truncatedPath, plaintextPath: bad, identity, expectedSha256: sha(plain)}), 'RESTORE_CIPHERTEXT_INVALID');
    assert.equal(await exists(bad), false);
    await rejects(() => decryptBackupToFile({ciphertextPath: cipherPath, plaintextPath: bad, identity, expectedSha256: sha('other')}), 'RESTORE_PLAINTEXT_INTEGRITY_MISMATCH');
    assert.equal(await exists(bad), false);
    await rejects(() => decryptBackupToFile({ciphertextPath: cipherPath, plaintextPath: bad, identity, expectedSha256: sha(plain), expectedBytes: plain.length + 1}), 'RESTORE_PLAINTEXT_INTEGRITY_MISMATCH');
    assert.equal(await exists(bad), false);
    await rejects(() => decryptBackupToFile({ciphertextPath: cipherPath, plaintextPath: bad, identity, expectedSha256: 'not-a-hash'}), 'RESTORE_EXPECTED_SHA256_INVALID');
    const existing = join(root, 'existing.dump'); await writeFile(existing, 'keep me');
    await rejects(() => decryptBackupToFile({ciphertextPath: cipherPath, plaintextPath: existing, identity, expectedSha256: sha(plain)}), 'RESTORE_PLAINTEXT_PATH_EXISTS');
    assert.equal(await readFile(existing, 'utf8'), 'keep me');
  });

  failedStage = 'pg_restore tool';
  await check('pg_restore must be an absolute executable of major 18 and runs with a sanitized environment and no password argument', async () => {
    const tool = join(root, 'tool'); await mkdir(tool);
    const script = (version: string, exit: number, stderr: string) => `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "pg_restore (PostgreSQL) ${version}"; exit 0; fi\nd=$(dirname "$0")\nprintf '%s\\n' "$@" > "$d/args.txt"\nenv | sort > "$d/env.txt"\n${stderr ? `echo "${stderr}" >&2\n` : ''}exit ${exit}\n`;
    const ok = join(tool, 'pg_restore'); await writeFile(ok, script('18.6', 0, ''), {mode: 0o755});
    assert.match(await assertPgRestoreVersion(ok), /^pg_restore \(PostgreSQL\) 18\.6$/);
    const old = join(tool, 'pg_restore17'); await writeFile(old, script('17.5', 0, ''), {mode: 0o755});
    await rejects(() => assertPgRestoreVersion(old), 'RESTORE_TOOL_VERSION_REJECTED');
    await rejects(() => assertPgRestoreVersion('pg_restore'), 'RESTORE_TOOL_PATH_INVALID');
    const noexec = join(tool, 'pg_restore_noexec'); await writeFile(noexec, script('18.6', 0, ''), {mode: 0o644});
    await rejects(() => assertPgRestoreVersion(noexec), 'RESTORE_TOOL_PATH_INVALID');
    const target = loopback('zr_abcdef012345');
    process.env.AWS_SECRET_ACCESS_KEY = 'AMBIENT_SECRET_SHOULD_NOT_LEAK'; process.env.PGPASSWORD = 'AMBIENT_PGPASSWORD_SHOULD_NOT_LEAK';
    await runPgRestore({pgRestorePath: ok, dumpPath: '/dump/file', target});
    delete process.env.AWS_SECRET_ACCESS_KEY; delete process.env.PGPASSWORD;
    const args = (await readFile(join(tool, 'args.txt'), 'utf8')).trim().split('\n'), env = await readFile(join(tool, 'env.txt'), 'utf8');
    for (const flag of ['--no-owner', '--no-acl', '--exit-on-error', '--single-transaction', '--no-password']) assert.ok(args.includes(flag), flag);
    assert.equal(args[args.indexOf('--dbname') + 1], target.database); assert.equal(args.at(-1), '/dump/file');
    assert.ok(!args.join(' ').includes(target.password), 'password never on the command line');
    assert.ok(env.includes('PGPASSWORD=' + target.password) && env.includes('PGSSLMODE=disable'));
    assert.ok(!env.includes('AMBIENT_'), 'ambient secrets are not inherited');
    const failing = join(tool, 'pg_restore_fail'); await writeFile(failing, script('18.6', 3, 'connection failed password=' + target.password), {mode: 0o755});
    await assert.rejects(() => runPgRestore({pgRestorePath: failing, dumpPath: '/dump/file', target}), (e: Error) => {
      assert.ok(e.message.startsWith('RESTORE_PG_RESTORE_FAILED')); assert.ok(!e.message.includes(target.password), 'failure output is redacted'); return true;
    });
  });

  failedStage = 'r2 adapter';
  await check('R2 adapter issues GetObject only, on the one pinned bucket, and streams to a new file', async () => {
    const sent: unknown[] = [];
    const client = {send: async (command: unknown) => { sent.push(command); return {Body: Readable.from([Buffer.from('ciphertext-bytes')])}; }} as unknown as S3Client;
    const fetch = r2FetchAdapter(client);
    const out = join(root, 'fetched.age');
    assert.deepEqual(await fetch(KEY, out), {bytes: 16});
    assert.equal(sent.length, 1); assert.ok(sent[0] instanceof GetObjectCommand);
    assert.deepEqual((sent[0] as GetObjectCommand).input, {Bucket: EXPECTED_PRODUCTION_BUCKET, Key: KEY});
    await assert.rejects(() => fetch(KEY, out)); // never overwrites
    assert.throws(() => r2FetchAdapter(client, 'another-bucket'), /RESTORE_BUCKET_MISMATCH_REJECTED/);
    await rejects(() => r2FetchAdapter({send: async () => ({})} as unknown as S3Client)(KEY, join(root, 'empty.age')), 'RESTORE_OBJECT_EMPTY');
  });

  failedStage = 'static boundary';
  await check('restore module has no R2 write/delete command, no Production connection and never reads the dump into memory', async () => {
    const source = await readFile(new URL('../../scripts/production-restore-drill.ts', import.meta.url), 'utf8');
    for (const forbidden of [/PutObject/, /DeleteObject/, /CopyObject/, /DeleteBucket/, /neon\.tech/, /sslmode=/i, /PRODUCTION_[A-Z_]*PASSWORD/, /readFile\([^)]*(dump|cipher|plain)/i])
      assert.ok(!forbidden.test(source), String(forbidden));
  });

  failedStage = 'drill with disposable cluster';
  db = await startIsolatedPostgres();
  const dbPassword = (db.pool.options as {password?: string}).password ?? '';
  async function newTarget(): Promise<RestoreTarget> {
    const database = 'zr_' + randomBytes(6).toString('hex');
    await db!.pool.query(`CREATE DATABASE ${database}`);
    return {host: '127.0.0.1', port: db!.identity.dbPort, user: db!.identity.user, password: dbPassword, database};
  }
  const openTarget = (t: RestoreTarget) => new Pool({host: t.host, port: t.port, user: t.user, password: t.password, database: t.database, max: 4});
  const counters = {fetch: 0, restore: 0};
  const times = [new Date('2026-10-04T05:30:00.000Z'), new Date('2026-10-04T05:30:42.000Z')];
  function adapters(restoreMutation?: (pool: Pool) => Promise<void>): DrillAdapters {
    let tick = 0;
    return {
      fetchCiphertext: async (_key, out) => { counters.fetch++; await copyFile(cipherPath, out); return {bytes: (await lstat(out)).size}; },
      // Stands in for pg_restore: the target ends up with the full migrated schema and registry, like a restored dump would.
      restore: async (_dump, target) => { counters.restore++; const p = openTarget(target); try { await migrate(p); await restoreMutation?.(p); } finally { await p.end(); } },
      openTarget, toolVersion: async () => 'pg_restore (PostgreSQL) 18.6 [synthetic stand-in]', now: () => times[Math.min(tick++, 1)]!,
    };
  }
  const work = join(root, 'drill-work'); await mkdir(work);
  const input = (target: RestoreTarget, extra: Partial<Parameters<typeof runRestoreDrill>[1]> = {}) =>
    ({dataClass: 'SYNTHETIC' as const, key: KEY, scheduledAt: SCHEDULED_AT, expected: {sha256: sha(plain), bytes: plain.length}, identity, target, workParent: work, ...extra});

  await check('synthetic drill passes: decrypt, restore, registry equal, relationships valid, counts only, no RPO/RTO approval, temp files gone', async () => {
    const target = await newTarget(); counters.fetch = counters.restore = 0;
    const result = await runRestoreDrill(adapters(), input(target), fingerprintHost('production.invalid'));
    assert.equal(result.status, 'DRILL_PASS'); assert.equal(result.dataClass, 'SYNTHETIC');
    assert.equal(result.plaintextSha256, sha(plain)); assert.equal(result.plaintextBytes, plain.length);
    assert.equal(result.verification.migrations, migrationPlan.length);
    assert.ok(result.verification.foreignKeys > 0 && Object.keys(result.verification.critical).length > 0);
    assert.equal(result.restoreSeconds, 42); assert.equal(result.observedBackupAgeSeconds, 13 * 60 + 42);
    assert.equal(result.productionRpoRtoApproved, false);
    assert.deepEqual(await readdir(work), [], 'plaintext and ciphertext copies are removed');
    assert.ok(!JSON.stringify(result).includes(identity) && !JSON.stringify(result).includes(dbPassword));
    assert.deepEqual(counters, {fetch: 1, restore: 1});
  });

  await check('a non-empty target is refused before anything is downloaded or restored', async () => {
    const target = await newTarget(); const p = openTarget(target); await migrate(p); await p.end();
    counters.fetch = counters.restore = 0;
    await rejects(() => runRestoreDrill(adapters(), input(target)), 'RESTORE_TARGET_NOT_EMPTY_REJECTED');
    assert.deepEqual(counters, {fetch: 0, restore: 0}); assert.deepEqual(await readdir(work), []);
    const probe = openTarget(target); try { await assert.doesNotReject(() => verifyRestoredDatabase(probe)); await rejects(() => assertEmptyTarget(probe), 'RESTORE_TARGET_NOT_EMPTY_REJECTED'); } finally { await probe.end(); }
  });

  await check('migration registry drift after restore is rejected and cleaned up', async () => {
    const target = await newTarget(); counters.fetch = counters.restore = 0;
    await rejects(() => runRestoreDrill(adapters(p => p.query("UPDATE foundation_migrations SET checksum='0'||substr(checksum,2) WHERE id='0001'").then(() => undefined)), input(target)), 'RESTORE_MIGRATION_REGISTRY_MISMATCH');
    assert.deepEqual(counters, {fetch: 1, restore: 1}); assert.deepEqual(await readdir(work), []);
  });

  await check('wrong key stops before restore and leaves no plaintext', async () => {
    const target = await newTarget(); counters.fetch = counters.restore = 0;
    await rejects(() => runRestoreDrill(adapters(), input(target, {identity: otherIdentity})), 'RESTORE_WRONG_KEY_REJECTED');
    assert.deepEqual(counters, {fetch: 1, restore: 0}); assert.deepEqual(await readdir(work), []);
  });

  await check('Production-class drill without custody confirmation never fetches or decrypts; with it, the evidence class is PRODUCTION', async () => {
    const target = await newTarget(); counters.fetch = counters.restore = 0;
    await rejects(() => runRestoreDrill(adapters(), input(target, {dataClass: 'PRODUCTION'})), 'RESTORE_CUSTODY_NOT_CONFIRMED');
    await rejects(() => runRestoreDrill(adapters(), input(target, {dataClass: 'PRODUCTION', custody: {...custody, recipientSha256Prefix: '0'.repeat(12)}})), 'RESTORE_CUSTODY_RECIPIENT_MISMATCH');
    assert.deepEqual(counters, {fetch: 0, restore: 0});
    const result = await runRestoreDrill(adapters(), input(target, {dataClass: 'PRODUCTION', custody}));
    assert.equal(result.dataClass, 'PRODUCTION'); assert.equal(result.productionRpoRtoApproved, false);
  });

  await check('invalid backup keys and non-disposable targets are rejected up front', async () => {
    const target = await newTarget(); counters.fetch = counters.restore = 0;
    for (const key of ['hourly/x.age', '../hourly/2026/10/04/2026-10-04T05-17-00-000Z.dump.age', KEY + '/extra', 'weekly/2026/10/04/2026-10-04T05-17-00-000Z.dump.age'])
      await rejects(() => runRestoreDrill(adapters(), input(target, {key})), 'RESTORE_BACKUP_KEY_INVALID');
    await rejects(() => runRestoreDrill(adapters(), input({...target, database: 'neondb'})), 'RESTORE_TARGET_NOT_DISPOSABLE_NAME_REJECTED');
    await rejects(() => runRestoreDrill(adapters(), input(target, {scheduledAt: 'not-a-time'})), 'RESTORE_SCHEDULED_AT_INVALID');
    assert.deepEqual(counters, {fetch: 0, restore: 0});
  });
  failedStage = 'done';
  console.log(`RESTORE_DRILL_SYNTHETIC_PASS ${passed} checks (not a Production restore, RPO or RTO)`);
} catch (error) {
  console.error(`FAIL ${failedStage}: ${(error as Error).message}`);
  process.exitCode = 1;
} finally {
  await db?.stop().catch(() => undefined);
  await rm(root, {recursive: true, force: true});
}
