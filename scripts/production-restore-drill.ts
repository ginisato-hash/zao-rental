import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createReadStream, createWriteStream} from 'node:fs';
import {lstat, mkdtemp, readFile, realpath, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {isAbsolute, join, relative} from 'node:path';
import {Readable, Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {Decrypter, identityToRecipient} from 'age-encryption';
import {GetObjectCommand, S3Client} from '@aws-sdk/client-s3';
import {Pool} from 'pg';
import {migrationPlan, migrationsDirectory} from '../packages/db/src/index';
import {EXPECTED_PRODUCTION_BUCKET, EXPECTED_PRODUCTION_HOST_FINGERPRINT_SHA256, fingerprintHost, redactSecrets} from './production-backup';
import {CRITICAL, criticalFingerprint, validateRestored} from './local-restore';
import {registryDigest} from './lib/registry-digest';

// Production backup RESTORE drill. Read-only against R2 (GetObject only), restores only into an
// empty, loopback, disposable `zr_<12 hex>` database and never into Production. A SYNTHETIC drill and
// a PRODUCTION-data drill are different evidence classes; only the latter requires key custody to be
// confirmed, and neither one approves a Production RPO/RTO by itself.
// The repository's owned-database convention (zr_<12 hex>); historical dev guards in the migrations require it too.
export const DISPOSABLE_DATABASE_PATTERN = /^zr_[a-f0-9]{12}$/;
const LOOPBACK_HOSTS = ['127.0.0.1', '::1', 'localhost'];
const CHILD_ENV_KEYS = ['PATH', 'HOME', 'LANG', 'LC_ALL', 'TMPDIR'] as const;
const BACKUP_KEY_PATTERN = /^(hourly|daily)\/\d{4}\/\d{2}\/\d{2}\/\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.dump\.age$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export type DataClass = 'SYNTHETIC' | 'PRODUCTION';
export interface RestoreTarget {host: string; port: number; user: string; password: string; database: string}
export interface CustodyConfirmation {status: 'CUSTODY_CONFIRMED'; roundtrip: 'PASS'; locations: number; recipientSha256Prefix: string}

/** Loopback + owned disposable-name only. The Production host fingerprint check is defence in depth. */
export function assertDisposableTarget(target: RestoreTarget, productionHostFingerprint: string = EXPECTED_PRODUCTION_HOST_FINGERPRINT_SHA256): void {
  if (!LOOPBACK_HOSTS.includes(target.host.trim().toLowerCase())) throw new Error('RESTORE_TARGET_NOT_LOOPBACK_REJECTED');
  if (fingerprintHost(target.host) === productionHostFingerprint) throw new Error('RESTORE_TARGET_IS_PRODUCTION_REJECTED');
  if (!Number.isInteger(target.port) || target.port < 1024 || target.port > 65535) throw new Error('RESTORE_TARGET_PORT_REJECTED');
  if (!DISPOSABLE_DATABASE_PATTERN.test(target.database)) throw new Error('RESTORE_TARGET_NOT_DISPOSABLE_NAME_REJECTED');
  if (!target.user || !target.password) throw new Error('RESTORE_TARGET_CREDENTIAL_MISSING');
}

/** A restore target must be brand new: no relations, extra schemas, functions or extensions. */
export async function assertEmptyTarget(pool: Pool): Promise<void> {
  const n = async (sql: string) => Number((await pool.query(sql)).rows[0].n);
  const relations = await n(`SELECT count(*)::int n FROM pg_class c JOIN pg_namespace s ON s.oid=c.relnamespace
    WHERE s.nspname NOT IN ('pg_catalog','information_schema') AND s.nspname !~ '^pg_toast' AND c.relkind IN ('r','p','v','m','S','f')`);
  const schemas = await n(`SELECT count(*)::int n FROM pg_namespace WHERE nspname NOT IN ('public','information_schema') AND nspname !~ '^pg_'`);
  const functions = await n(`SELECT count(*)::int n FROM pg_proc p JOIN pg_namespace s ON s.oid=p.pronamespace WHERE s.nspname NOT IN ('pg_catalog','information_schema')`);
  const extensions = await n(`SELECT count(*)::int n FROM pg_extension WHERE extname<>'plpgsql'`);
  if (relations || schemas || functions || extensions) throw new Error('RESTORE_TARGET_NOT_EMPTY_REJECTED');
}

/** The identity file is read once, in memory; it must be a caller-owned 0600 regular file outside the checkout. */
export async function loadAgeIdentity(path: string, checkoutRoot: string): Promise<string> {
  if (!isAbsolute(path)) throw new Error('RESTORE_IDENTITY_FILE_INVALID');
  const stat = await lstat(path);
  const rel = relative(await realpath(checkoutRoot), await realpath(path));
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o600 || stat.size > 4096 || !rel.startsWith('..')
    || (process.getuid && stat.uid !== process.getuid())) throw new Error('RESTORE_IDENTITY_FILE_INVALID');
  const keys = (await readFile(path, 'utf8')).split(/\r?\n/).filter(l => /^AGE-SECRET-KEY-1[A-Z0-9]+$/.test(l.trim()));
  if (keys.length !== 1) throw new Error('RESTORE_IDENTITY_FILE_INVALID');
  return keys[0]!.trim();
}

/** Machine-checkable form of the Owner's off-Mac custody reply (recipient hash prefix of the SAME identity). */
export async function assertCustodyConfirmed(identity: string, confirmation: CustodyConfirmation): Promise<void> {
  const c = confirmation as Partial<CustodyConfirmation> | undefined;
  if (c?.status !== 'CUSTODY_CONFIRMED' || c.roundtrip !== 'PASS' || !Number.isInteger(c.locations) || (c.locations ?? 0) < 1
    || !/^[a-f0-9]{12}$/.test(c.recipientSha256Prefix ?? '')) throw new Error('RESTORE_CUSTODY_NOT_CONFIRMED');
  const recipient = await identityToRecipient(identity);
  if (createHash('sha256').update(recipient).digest('hex').slice(0, 12) !== c.recipientSha256Prefix) throw new Error('RESTORE_CUSTODY_RECIPIENT_MISMATCH');
}

/** Streams age ciphertext -> plaintext file, hashing on the way. A partial or unverified plaintext is always removed.
 * The ciphertext is hashed as it is read by the decrypter, so `ciphertextSha256` is the sha256 of the exact encrypted bytes that were decrypted, whichever adapter wrote the file. */
export async function decryptBackupToFile(a: {ciphertextPath: string; plaintextPath: string; identity: string; expectedSha256: string; expectedBytes?: number | undefined}): Promise<{sha256: string; bytes: number; ciphertextSha256: string; ciphertextBytes: number}> {
  if (!SHA256_PATTERN.test(a.expectedSha256)) throw new Error('RESTORE_EXPECTED_SHA256_INVALID');
  const hash = createHash('sha256');
  let bytes = 0;
  const counting = new Transform({transform(chunk: Buffer, _enc, cb) { hash.update(chunk); bytes += chunk.length; cb(null, chunk); }});
  const cipherHash = createHash('sha256');
  let cipherBytes = 0;
  const cipherTap = new Transform({transform(chunk: Buffer, _enc, cb) { cipherHash.update(chunk); cipherBytes += chunk.length; cb(null, chunk); }});
  // Never remove (or overwrite) a file this call did not create.
  if (await lstat(a.plaintextPath).then(() => true, () => false)) throw new Error('RESTORE_PLAINTEXT_PATH_EXISTS');
  const source = createReadStream(a.ciphertextPath);
  source.on('error', error => cipherTap.destroy(error));
  try {
    const decrypter = new Decrypter();
    decrypter.addIdentity(a.identity);
    const cipher = Readable.toWeb(source.pipe(cipherTap)) as unknown as ReadableStream<Uint8Array>;
    let plain: ReadableStream<Uint8Array>;
    try { plain = await decrypter.decrypt(cipher); } catch { throw new Error('RESTORE_WRONG_KEY_REJECTED'); }
    try {
      await pipeline(Readable.fromWeb(plain as never), counting, createWriteStream(a.plaintextPath, {flags: 'wx', mode: 0o600}));
    } catch { throw new Error('RESTORE_CIPHERTEXT_INVALID'); }
    const sha256 = hash.digest('hex');
    if (sha256 !== a.expectedSha256 || (a.expectedBytes !== undefined && bytes !== a.expectedBytes)) throw new Error('RESTORE_PLAINTEXT_INTEGRITY_MISMATCH');
    return {sha256, bytes, ciphertextSha256: cipherHash.digest('hex'), ciphertextBytes: cipherBytes};
  } catch (error) {
    source.destroy(); cipherTap.destroy();
    await rm(a.plaintextPath, {force: true});
    throw error;
  }
}

function sanitizedEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  const env: Record<string, string> = {};
  for (const k of CHILD_ENV_KEYS) { const v = process.env[k]; if (v) env[k] = v; }
  return {...env, ...extra} as NodeJS.ProcessEnv;
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv, secrets: string[]): Promise<{stdout: string}> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {env, stdio: ['ignore', 'pipe', 'pipe']});
    let stdout = '', stderr = '';
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr = (stderr + d).slice(-600); });
    child.on('error', () => reject(new Error('RESTORE_TOOL_UNAVAILABLE')));
    child.on('close', code => code === 0 ? resolve({stdout}) : reject(new Error('RESTORE_PG_RESTORE_FAILED:' + redactSecrets(stderr, secrets).trim().slice(-300))));
  });
}

export async function assertPgRestoreVersion(pgRestorePath: string): Promise<string> {
  if (!isAbsolute(pgRestorePath)) throw new Error('RESTORE_TOOL_PATH_INVALID');
  const stat = await lstat(pgRestorePath);
  if (!stat.isFile() || !(stat.mode & 0o111)) throw new Error('RESTORE_TOOL_PATH_INVALID');
  const version = (await run(pgRestorePath, ['--version'], sanitizedEnv({}), [])).stdout.trim();
  if (!/^pg_restore \(PostgreSQL\) 18\.\d+/.test(version)) throw new Error('RESTORE_TOOL_VERSION_REJECTED');
  return version;
}

/** Single-transaction restore into the disposable target. No Production connection string exists in this module. */
export async function runPgRestore(a: {pgRestorePath: string; dumpPath: string; target: RestoreTarget}): Promise<void> {
  const t = a.target;
  const args = ['--no-owner', '--no-acl', '--exit-on-error', '--single-transaction', '--no-password',
    '--host', t.host, '--port', String(t.port), '--username', t.user, '--dbname', t.database, a.dumpPath];
  await run(a.pgRestorePath, args, sanitizedEnv({PGPASSWORD: t.password, PGSSLMODE: 'disable', PGAPPNAME: 'zao-rental-restore-drill'}), [t.password]);
}

/** Registry equals the source migration set byte-for-byte, relationships hold, contract-critical rows are fingerprinted (counts + digests only). */
/** Contract-critical tables that a backup taken before the given migration cannot contain. */
const CRITICAL_TABLE_ADDED_BY: Readonly<Record<string, string>> = {'public.provisional_capacity_receipts': '0054'};

/** `expectedMigrations` is the number of source migrations the DUMP was taken at: a pre-0054 Production backup holds the first 53, not the current 55.
 * The registry must equal that exact prefix byte-for-byte (id and checksum); later migrations are never expected, and a registry with more rows than expected is refused. */
export async function verifyRestoredDatabase(pool: Pool, expectedMigrations: number = migrationPlan.length) {
  if (!Number.isInteger(expectedMigrations) || expectedMigrations < 1 || expectedMigrations > migrationPlan.length) throw new Error('RESTORE_EXPECTED_MIGRATIONS_INVALID');
  const registry = (await pool.query<{id: string; checksum: string}>('SELECT id,checksum FROM foundation_migrations ORDER BY id')).rows;
  if (registry.length !== expectedMigrations) throw new Error('RESTORE_MIGRATION_REGISTRY_MISMATCH');
  for (const [i, entry] of migrationPlan.slice(0, expectedMigrations).entries()) {
    const expected = createHash('sha256').update(await readFile(`${migrationsDirectory}/${entry.file}`, 'utf8')).digest('hex');
    if (registry[i]!.id !== entry.id || registry[i]!.checksum !== expected) throw new Error('RESTORE_MIGRATION_REGISTRY_MISMATCH');
  }
  const applied = new Set<string>(migrationPlan.slice(0, expectedMigrations).map(e => e.id));
  const tables = CRITICAL.filter(t => { const by = CRITICAL_TABLE_ADDED_BY[t]; return by === undefined || applied.has(by); });
  const relations = await validateRestored(pool);
  // `registrySha256` lets the restore evidence be matched to the migration files of the release that will install 0054/0055 on this registry.
  return {migrations: registry.length, registrySha256: registryDigest(registry), ...relations, critical: await criticalFingerprint(pool, tables)};
}

export interface DrillAdapters {
  fetchCiphertext: (key: string, outPath: string) => Promise<{bytes: number}>;
  restore: (dumpPath: string, target: RestoreTarget) => Promise<void>;
  openTarget: (target: RestoreTarget) => Pool;
  toolVersion: () => Promise<string>;
  now: () => Date;
}
export interface DrillInput {
  dataClass: DataClass; key: string; scheduledAt: string; expected: {sha256: string; bytes?: number};
  identity: string; custody?: CustodyConfirmation; target: RestoreTarget; workParent?: string;
  /** Source migrations the dump was taken at (default: all). A pre-0054 Production backup is 53. */
  expectedMigrations?: number;
}
export interface DrillResult {
  status: 'DRILL_PASS'; dataClass: DataClass; key: string; backupScheduledAt: string; plaintextSha256: string; plaintextBytes: number;
  ciphertextBytes: number; ciphertextSha256: string; toolVersion: string; startedAt: string; finishedAt: string; restoreSeconds: number; observedBackupAgeSeconds: number;
  verification: Awaited<ReturnType<typeof verifyRestoredDatabase>>; productionRpoRtoApproved: false;
}

export async function runRestoreDrill(adapters: DrillAdapters, input: DrillInput, productionHostFingerprint: string = EXPECTED_PRODUCTION_HOST_FINGERPRINT_SHA256): Promise<DrillResult> {
  if (!BACKUP_KEY_PATTERN.test(input.key)) throw new Error('RESTORE_BACKUP_KEY_INVALID');
  const expectedMigrations = input.expectedMigrations ?? migrationPlan.length;
  if (!Number.isInteger(expectedMigrations) || expectedMigrations < 1 || expectedMigrations > migrationPlan.length) throw new Error('RESTORE_EXPECTED_MIGRATIONS_INVALID');
  const scheduledAt = new Date(input.scheduledAt);
  if (Number.isNaN(scheduledAt.getTime())) throw new Error('RESTORE_SCHEDULED_AT_INVALID');
  assertDisposableTarget(input.target, productionHostFingerprint);
  // Real Production data is never decrypted unless the off-Mac custody of its key is machine-confirmed.
  if (input.dataClass === 'PRODUCTION') await assertCustodyConfirmed(input.identity, input.custody as CustodyConfirmation);
  const toolVersion = await adapters.toolVersion();
  const pool = adapters.openTarget(input.target);
  const work = await mkdtemp(join(input.workParent ?? tmpdir(), 'zao-restore-drill-'));
  try {
    await assertEmptyTarget(pool);
    const startedAt = adapters.now();
    const ciphertextPath = join(work, 'backup.dump.age'), plaintextPath = join(work, 'backup.dump');
    const {bytes: ciphertextBytes} = await adapters.fetchCiphertext(input.key, ciphertextPath);
    const plain = await decryptBackupToFile({ciphertextPath, plaintextPath, identity: input.identity, expectedSha256: input.expected.sha256, expectedBytes: input.expected.bytes});
    // The hash and the byte count describe the same encrypted bytes the adapter wrote and the decrypter read.
    if (plain.ciphertextBytes !== ciphertextBytes) throw new Error('RESTORE_CIPHERTEXT_INVALID');
    await adapters.restore(plaintextPath, input.target);
    const verification = await verifyRestoredDatabase(pool, expectedMigrations);
    const finishedAt = adapters.now();
    return {status: 'DRILL_PASS', dataClass: input.dataClass, key: input.key, backupScheduledAt: scheduledAt.toISOString(), plaintextSha256: plain.sha256, plaintextBytes: plain.bytes,
      ciphertextBytes, ciphertextSha256: plain.ciphertextSha256, toolVersion, startedAt: startedAt.toISOString(), finishedAt: finishedAt.toISOString(),
      restoreSeconds: (finishedAt.getTime() - startedAt.getTime()) / 1000, observedBackupAgeSeconds: (finishedAt.getTime() - scheduledAt.getTime()) / 1000,
      verification, productionRpoRtoApproved: false};
  } finally {
    // Plaintext and ciphertext copies never outlive the drill, whether it passed or failed.
    await rm(work, {recursive: true, force: true});
    await pool.end();
  }
}

/** Read-only R2 adapter: GetObject on the one pinned bucket, streamed to a file. No write/delete command is imported. */
export function r2FetchAdapter(client: S3Client, bucket: string = EXPECTED_PRODUCTION_BUCKET): DrillAdapters['fetchCiphertext'] {
  if (bucket !== EXPECTED_PRODUCTION_BUCKET) throw new Error('RESTORE_BUCKET_MISMATCH_REJECTED');
  return async (key, outPath) => {
    const response = await client.send(new GetObjectCommand({Bucket: bucket, Key: key}));
    if (!response.Body) throw new Error('RESTORE_OBJECT_EMPTY');
    await pipeline(response.Body as Readable, createWriteStream(outPath, {flags: 'wx', mode: 0o600}));
    return {bytes: (await lstat(outPath)).size};
  };
}

/** Local ciphertext source: the object was already read from R2 (for example with the Owner-authorized wrangler OAuth read) into a caller-owned regular
 * file, so no R2 credential has to be handed to this process. The age authentication tags and the expected plaintext hash still gate every byte. */
export function localCiphertextAdapter(sourcePath: string): DrillAdapters['fetchCiphertext'] {
  return async (_key, outPath) => {
    if (!isAbsolute(sourcePath)) throw new Error('RESTORE_CIPHERTEXT_FILE_INVALID');
    const stat = await lstat(sourcePath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || (process.getuid && stat.uid !== process.getuid())) throw new Error('RESTORE_CIPHERTEXT_FILE_INVALID');
    await pipeline(createReadStream(sourcePath), createWriteStream(outPath, {flags: 'wx', mode: 0o600}));
    return {bytes: (await lstat(outPath)).size};
  };
}

/** Exactly one ciphertext source: the read-only R2 adapter or a local file. */
export function selectCiphertextSource(input: {r2?: unknown; ciphertextPath?: unknown}): 'R2' | 'LOCAL' {
  if ((input.r2 === undefined) === (input.ciphertextPath === undefined)) throw new Error('RESTORE_INPUT_SOURCE_INVALID');
  if (input.ciphertextPath !== undefined && (typeof input.ciphertextPath !== 'string' || !isAbsolute(input.ciphertextPath))) throw new Error('RESTORE_INPUT_SOURCE_INVALID');
  return input.r2 !== undefined ? 'R2' : 'LOCAL';
}

interface CliInput {
  r2?: {accountId: string; accessKeyId: string; secretAccessKey: string}; ciphertextPath?: string; key: string; scheduledAt: string;
  expected: {sha256: string; bytes?: number}; identityPath: string; custody: CustodyConfirmation; pgRestorePath: string; target: RestoreTarget;
  expectedMigrations?: number;
}

async function readCliInput(path: string, checkoutRoot: string): Promise<CliInput> {
  if (!isAbsolute(path)) throw new Error('RESTORE_INPUT_FILE_INVALID');
  const stat = await lstat(path);
  const rel = relative(await realpath(checkoutRoot), await realpath(path));
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o600 || stat.size > 65536 || !rel.startsWith('..')
    || (process.getuid && stat.uid !== process.getuid())) throw new Error('RESTORE_INPUT_FILE_INVALID');
  return JSON.parse(await readFile(path, 'utf8')) as CliInput;
}

/** Operator entry point. PRODUCTION-class only; reads R2 (GetObject) and restores to a loopback disposable DB. */
export async function main(argv: string[]): Promise<void> {
  const [command, flag, path, ...extra] = argv;
  if (command !== 'run' || flag !== '--input' || !path || extra.length) throw new Error('RESTORE_ARGUMENTS_REJECTED');
  const checkoutRoot = process.cwd();
  const input = await readCliInput(path, checkoutRoot);
  const identity = await loadAgeIdentity(input.identityPath, checkoutRoot);
  const source = selectCiphertextSource(input);
  const fetchCiphertext = source === 'LOCAL' ? localCiphertextAdapter(input.ciphertextPath!)
    : r2FetchAdapter(new S3Client({region: 'auto', endpoint: `https://${input.r2!.accountId}.r2.cloudflarestorage.com`,
      credentials: {accessKeyId: input.r2!.accessKeyId, secretAccessKey: input.r2!.secretAccessKey}}));
  const adapters: DrillAdapters = {
    fetchCiphertext,
    restore: (dumpPath, target) => runPgRestore({pgRestorePath: input.pgRestorePath, dumpPath, target}),
    openTarget: t => new Pool({host: t.host, port: t.port, user: t.user, password: t.password, database: t.database, max: 4}),
    toolVersion: () => assertPgRestoreVersion(input.pgRestorePath),
    now: () => new Date(),
  };
  const result = await runRestoreDrill(adapters, {dataClass: 'PRODUCTION', key: input.key, scheduledAt: input.scheduledAt, expected: input.expected,
    identity, custody: input.custody, target: input.target, ...(input.expectedMigrations === undefined ? {} : {expectedMigrations: input.expectedMigrations})});
  console.log(JSON.stringify(result));
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  main(process.argv.slice(2)).catch(error => {
    // Safe code only: never the provider error object, key, URL or connection details.
    console.error(JSON.stringify({status: 'STOP', code: String((error as Error)?.message ?? 'RESTORE_DRILL_FAILED').split(':')[0]!.replace(/[^A-Z0-9_]/g, '').slice(0, 80) || 'RESTORE_DRILL_FAILED'}));
    process.exitCode = 1;
  });
}
