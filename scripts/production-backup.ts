import {spawn} from 'node:child_process';
import {createHash, randomUUID} from 'node:crypto';
import {createReadStream, createWriteStream} from 'node:fs';
import {mkdtemp, rm, lstat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable, Writable, Transform} from 'node:stream';
import {Encrypter} from 'age-encryption';
import {S3Client, PutObjectCommand} from '@aws-sdk/client-s3';

// R2B mechanism only. The live Production path stays disabled until a separate
// R4 activation authority sets PRODUCTION_BACKUP_ACTIVATION and injects real secrets.
export type BackupClass = 'hourly' | 'daily';

/** Fixed, non-negotiable target — never read from an env var that a stray config could redirect. */
export const EXPECTED_PRODUCTION_BUCKET = 'zao-rental-prod-backup';
export const EXPECTED_PRODUCTION_PORT = '5432';
/** SHA-256 of the accepted Production direct-host name (lowercased/trimmed). Not the hostname itself. */
export const EXPECTED_PRODUCTION_HOST_FINGERPRINT_SHA256 = '7ad9939654fde65fa8bf8c4c043e33ca9053036d2137cf7616d365a11876c3fc';
export const PGAPPNAME = 'zao-rental-production-backup';
export const LOCK_TIMEOUT_MS = 30_000;
/** 09:17 UTC / 18:17 JST — a documented low-activity window; the external scheduler dispatches hourly at :17. */
export const DAILY_PROMOTION_UTC_HOUR = 9;
/** Ambient env vars a Postgres client tool may legitimately need; never DB/R2/age secrets beyond what's passed explicitly. */
const ALLOWED_AMBIENT_CHILD_ENV_KEYS = ['PATH', 'HOME', 'LANG', 'LC_ALL', 'TMPDIR', 'TEMP', 'TMP'] as const;

const REQUIRED_ENV_KEYS = [
  'PGHOST', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGPASSWORD',
  'PRODUCTION_BACKUP_BUCKET', 'AGE_BACKUP_RECIPIENT',
  'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY',
] as const;

export interface BackupEnv {
  PGHOST: string; PGPORT: string; PGDATABASE: string; PGUSER: string; PGPASSWORD: string;
  PRODUCTION_BACKUP_BUCKET: string; AGE_BACKUP_RECIPIENT: string;
  R2_ACCOUNT_ID: string; R2_ACCESS_KEY_ID: string; R2_SECRET_ACCESS_KEY: string;
}

/** Never place the password or a full connection string in an error/log line. */
export function redactSecrets(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const s of secrets) if (s) out = out.split(s).join('[REDACTED]');
  return out.replace(/postgres(?:ql)?:\/\/[^\s]*@[^\s]+/gi, '[REDACTED_CONNECTION_STRING]');
}

/** Structural shape only (host name pattern) — safe to test with any synthetic `.neon.tech` host. */
export function assertProductionHost(host: string): void {
  const h = host.trim().toLowerCase();
  if (!h) throw new Error('BACKUP_HOST_EMPTY');
  if (h === 'localhost' || h === '127.0.0.1' || h === '::1') throw new Error('BACKUP_HOST_LOCALHOST_REJECTED');
  if (h.includes('-pooler')) throw new Error('BACKUP_HOST_POOLED_REJECTED');
  if (!h.endsWith('.neon.tech')) throw new Error('BACKUP_HOST_NON_NEON_REJECTED');
}

export function assertProductionPort(port: string): void {
  if (port !== EXPECTED_PRODUCTION_PORT) throw new Error('BACKUP_PORT_REJECTED');
}

export function fingerprintHost(host: string): string {
  return createHash('sha256').update(host.trim().toLowerCase()).digest('hex');
}

/**
 * Binds the backup to one exact accepted Production endpoint identity, not merely "any Neon host".
 * `expected` defaults to the real committed constant and is never sourced from an env var — only a
 * caller can override it, and the CLI entrypoint never does, so this cannot be redirected by a
 * misconfigured secret. Tests pass their own `expected` to exercise both the accept and reject paths
 * without ever needing to know the real Production hostname.
 */
export function assertProductionHostFingerprint(host: string, expected: string = EXPECTED_PRODUCTION_HOST_FINGERPRINT_SHA256): void {
  if (fingerprintHost(host) !== expected) throw new Error('BACKUP_HOST_FINGERPRINT_MISMATCH_REJECTED');
}

export function parseBackupClass(value: string | undefined): BackupClass {
  if (value !== 'hourly' && value !== 'daily') throw new Error('BACKUP_CLASS_INVALID');
  return value;
}

const SCHEDULED_AT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

/**
 * The authoritative timestamp for object keys and daily-promotion classification is the scheduler's
 * own occurrence time, never the local runtime clock — so a delayed/retried run stays classified as
 * the occurrence it was meant to serve, and a retry of the same occurrence reuses the same object key.
 */
export function parseScheduledAt(value: string | undefined): Date {
  if (!value) throw new Error('BACKUP_SCHEDULED_AT_MISSING');
  if (!SCHEDULED_AT_PATTERN.test(value)) throw new Error('BACKUP_SCHEDULED_AT_INVALID');
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) throw new Error('BACKUP_SCHEDULED_AT_INVALID');
  return at;
}

/** Fail closed: every required var must be present, by name only — never a default/fallback. */
export function readBackupEnv(env: NodeJS.ProcessEnv, expectedHostFingerprint: string = EXPECTED_PRODUCTION_HOST_FINGERPRINT_SHA256): BackupEnv {
  const missing = REQUIRED_ENV_KEYS.filter((k) => !env[k]);
  if (missing.length) throw new Error(`BACKUP_ENV_MISSING:${missing.join(',')}`);
  const out: BackupEnv = {
    PGHOST: env.PGHOST!, PGPORT: env.PGPORT!, PGDATABASE: env.PGDATABASE!, PGUSER: env.PGUSER!, PGPASSWORD: env.PGPASSWORD!,
    PRODUCTION_BACKUP_BUCKET: env.PRODUCTION_BACKUP_BUCKET!, AGE_BACKUP_RECIPIENT: env.AGE_BACKUP_RECIPIENT!,
    R2_ACCOUNT_ID: env.R2_ACCOUNT_ID!, R2_ACCESS_KEY_ID: env.R2_ACCESS_KEY_ID!, R2_SECRET_ACCESS_KEY: env.R2_SECRET_ACCESS_KEY!,
  };
  assertProductionHost(out.PGHOST);
  assertProductionPort(out.PGPORT);
  if (out.PRODUCTION_BACKUP_BUCKET !== EXPECTED_PRODUCTION_BUCKET) throw new Error('BACKUP_BUCKET_MISMATCH_REJECTED');
  // Fingerprint last: it is the one check a synthetic test host can never satisfy (by design), so
  // every other validation stays independently testable ahead of it.
  assertProductionHostFingerprint(out.PGHOST, expectedHostFingerprint);
  return out;
}

export function objectKey(backupClass: BackupClass, at: Date): string {
  parseBackupClass(backupClass);
  const y = at.getUTCFullYear();
  const m = String(at.getUTCMonth() + 1).padStart(2, '0');
  const d = String(at.getUTCDate()).padStart(2, '0');
  const ts = at.toISOString().replace(/[:.]/g, '-');
  return `${backupClass}/${y}/${m}/${d}/${ts}.dump.age`;
}

/** Exactly one designated run per UTC day also promotes into daily/. Local wall-clock time is never authority. */
export function isDesignatedDailyRun(at: Date): boolean {
  return at.getUTCHours() === DAILY_PROMOTION_UTC_HOUR;
}

export async function assertOrdinaryFile(path: string): Promise<void> {
  const stat = await lstat(path);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('BACKUP_SPECIAL_FILE_REJECTED');
}

/** Builds the minimal env for a spawned Postgres client tool: no R2/age/Worker secret ever reaches it. */
export function minimalPgChildEnv(source: NodeJS.ProcessEnv, extra: Record<string, string>): NodeJS.ProcessEnv {
  const out: Record<string, string> = {};
  for (const k of ALLOWED_AMBIENT_CHILD_ENV_KEYS) { const v = source[k]; if (v !== undefined) out[k] = v; }
  return {...out, ...extra} as NodeJS.ProcessEnv;
}

// ---- Default adapters: real pg_dump/pg_restore/age/R2 I/O. Tests inject fakes instead. ----

export interface DumpResult { exitCode: number; stderrTail: string }

export async function spawnPgDump(env: BackupEnv, outFile: string): Promise<DumpResult> {
  return new Promise((resolve) => {
    const child = spawn('pg_dump', ['-Fc', '--no-owner', '--no-acl', '-f', outFile], {
      env: minimalPgChildEnv(process.env, {
        PGHOST: env.PGHOST, PGPORT: env.PGPORT, PGDATABASE: env.PGDATABASE,
        PGUSER: env.PGUSER, PGPASSWORD: env.PGPASSWORD,
        PGSSLMODE: 'verify-full', PGCHANNELBINDING: 'require', PGAPPNAME,
        PGOPTIONS: `-c lock_timeout=${LOCK_TIMEOUT_MS}`,
      }),
      stdio: ['ignore', 'ignore', 'pipe'] as const,
    });
    let stderr = '';
    child.stderr.on('data', (c: Buffer) => { stderr += c.toString(); });
    child.on('close', (code) => resolve({exitCode: code ?? 1, stderrTail: redactSecrets(stderr.slice(-2000), [env.PGPASSWORD])}));
    child.on('error', () => resolve({exitCode: 1, stderrTail: 'BACKUP_PG_DUMP_SPAWN_ERROR'}));
  });
}

export async function spawnPgRestoreList(dumpPath: string): Promise<{ok: boolean}> {
  return new Promise((resolve) => {
    const child = spawn('pg_restore', ['--list', dumpPath], {env: minimalPgChildEnv(process.env, {}), stdio: ['ignore', 'pipe', 'ignore'] as const});
    let out = '';
    child.stdout.on('data', (c: Buffer) => { out += c.toString(); });
    child.on('close', (code) => resolve({ok: code === 0 && out.trim().length > 0}));
    child.on('error', () => resolve({ok: false}));
  });
}

async function toolVersion(bin: string): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn(bin, ['--version'], {env: minimalPgChildEnv(process.env, {}), stdio: ['ignore', 'pipe', 'ignore'] as const});
    let out = '';
    child.stdout.on('data', (c: Buffer) => { out += c.toString(); });
    child.on('close', () => resolve(out.trim() || `${bin}:UNKNOWN`));
    child.on('error', () => resolve(`${bin}:NOT_FOUND`));
  });
}

export async function defaultToolVersions(): Promise<{pgDump: string; pgRestore: string}> {
  const [pgDump, pgRestore] = await Promise.all([toolVersion('pg_dump'), toolVersion('pg_restore')]);
  return {pgDump, pgRestore};
}

/**
 * Streams plaintext -> age ciphertext file-to-file. Never materializes the full plaintext or full
 * ciphertext as an in-memory buffer: a hashing Transform computes the plaintext SHA-256 as bytes pass
 * through on their way into the age Streams API, and the resulting ciphertext stream is piped directly
 * to a temporary file. This file intentionally does not import `readFile` for the dump/ciphertext path —
 * a regression back to whole-buffer processing is caught by the "no whole-file read" static test in
 * tests/readiness/production-backup.ts.
 */
export async function encryptFileToFileStreaming(plaintextPath: string, ciphertextPath: string, recipient: string): Promise<{sha256: string; bytes: number}> {
  const hash = createHash('sha256');
  const hashing = new Transform({
    transform(chunk: Buffer, _enc, cb) { hash.update(chunk); cb(null, chunk); },
  });
  const nodeReadable = createReadStream(plaintextPath).pipe(hashing);
  // age-encryption's public types reference the ambient (lib.dom) Streams API; Node's own
  // node:stream/web types are structurally close but not identical, hence the double cast.
  const webReadable = Readable.toWeb(nodeReadable) as unknown as ReadableStream<Uint8Array>;
  const encrypter = new Encrypter();
  encrypter.addRecipient(recipient);
  const cipherStream = await encrypter.encrypt(webReadable);
  const fileWrite = createWriteStream(ciphertextPath);
  await cipherStream.pipeTo(Writable.toWeb(fileWrite) as unknown as WritableStream<Uint8Array>);
  const stat = await lstat(ciphertextPath);
  return {sha256: hash.digest('hex'), bytes: stat.size};
}

export function createR2Client(env: BackupEnv): S3Client {
  return new S3Client({
    region: 'auto',
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY},
  });
}

/** Only PutObject, streamed from the already-encrypted temp file. No delete/admin operation exists here. */
export async function uploadFileStreaming(client: S3Client, bucket: string, key: string, filePath: string, contentLength: number): Promise<void> {
  if (bucket !== EXPECTED_PRODUCTION_BUCKET) throw new Error('BACKUP_BUCKET_MISMATCH_REJECTED');
  await client.send(new PutObjectCommand({Bucket: bucket, Key: key, Body: createReadStream(filePath), ContentLength: contentLength}));
}

// ---- Orchestrator ----

export interface BackupAdapters {
  dump: (env: BackupEnv, outFile: string) => Promise<DumpResult>;
  validate: (dumpPath: string) => Promise<{ok: boolean}>;
  encryptToFile: (plaintextPath: string, ciphertextPath: string, recipient: string) => Promise<{sha256: string; bytes: number}>;
  upload: (bucket: string, key: string, filePath: string, contentLength: number) => Promise<void>;
  toolVersions: () => Promise<{pgDump: string; pgRestore: string}>;
}

export function defaultAdapters(client: S3Client): BackupAdapters {
  return {
    dump: spawnPgDump,
    validate: spawnPgRestoreList,
    encryptToFile: encryptFileToFileStreaming,
    upload: (bucket, key, filePath, contentLength) => uploadFileStreaming(client, bucket, key, filePath, contentLength),
    toolVersions: defaultToolVersions,
  };
}

export interface BackupResult {
  key: string; sha256: string; bytes: number; generatedAt: string;
  backupClass: BackupClass; dailyPromoted: boolean; dailyKey: string | null;
  toolVersions: {pgDump: string; pgRestore: string};
}

export async function runProductionBackup(
  env: BackupEnv,
  adapters: BackupAdapters,
  opts: {backupClass: BackupClass; scheduledAt: Date},
): Promise<BackupResult> {
  assertProductionHost(env.PGHOST);
  assertProductionPort(env.PGPORT);
  if (env.PRODUCTION_BACKUP_BUCKET !== EXPECTED_PRODUCTION_BUCKET) throw new Error('BACKUP_BUCKET_MISMATCH_REJECTED');
  const backupClass = parseBackupClass(opts.backupClass);
  const scheduledAt = opts.scheduledAt;
  const dir = await mkdtemp(join(tmpdir(), 'zao-backup-'));
  const plaintextPath = join(dir, `${randomUUID()}.dump`);
  const ciphertextPath = join(dir, `${randomUUID()}.dump.age`);
  let plaintextWritten = false;
  let ciphertextWritten = false;
  try {
    const {exitCode, stderrTail} = await adapters.dump(env, plaintextPath);
    if (exitCode !== 0) throw new Error(`BACKUP_PG_DUMP_FAILED:${stderrTail}`);
    plaintextWritten = true;
    await assertOrdinaryFile(plaintextPath);
    const plainStat = await lstat(plaintextPath);
    if (plainStat.size === 0) throw new Error('BACKUP_EMPTY_ARCHIVE_REJECTED');
    const {ok} = await adapters.validate(plaintextPath);
    if (!ok) throw new Error('BACKUP_ARCHIVE_VALIDATION_FAILED');
    const {sha256, bytes: cipherBytes} = await adapters.encryptToFile(plaintextPath, ciphertextPath, env.AGE_BACKUP_RECIPIENT);
    ciphertextWritten = true;
    await assertOrdinaryFile(ciphertextPath);
    if (cipherBytes === 0) throw new Error('BACKUP_ENCRYPTION_INVALID');
    const key = objectKey(backupClass, scheduledAt);
    await adapters.upload(env.PRODUCTION_BACKUP_BUCKET, key, ciphertextPath, cipherBytes);
    const dailyPromoted = backupClass === 'hourly' && isDesignatedDailyRun(scheduledAt);
    let dailyKey: string | null = null;
    if (dailyPromoted) {
      dailyKey = objectKey('daily', scheduledAt);
      await adapters.upload(env.PRODUCTION_BACKUP_BUCKET, dailyKey, ciphertextPath, cipherBytes);
    }
    const toolVersions = await adapters.toolVersions();
    return {key, sha256, bytes: plainStat.size, generatedAt: scheduledAt.toISOString(), backupClass, dailyPromoted, dailyKey, toolVersions};
  } finally {
    if (plaintextWritten) await rm(plaintextPath, {force: true}).catch(() => {});
    if (ciphertextWritten) await rm(ciphertextPath, {force: true}).catch(() => {});
    await rm(dir, {recursive: true, force: true}).catch(() => {});
  }
}

// ---- CLI entrypoint. Requires BACKUP_MODE=production so a stray local invocation cannot touch it. ----

async function main(): Promise<void> {
  if (process.env.BACKUP_MODE !== 'production') throw new Error('BACKUP_MODE_NOT_PRODUCTION');
  if (process.env.PRODUCTION_BACKUP_ACTIVATION !== 'R4_APPROVED') throw new Error('BACKUP_ACTIVATION_GATE_NOT_APPROVED');
  const env = readBackupEnv(process.env);
  const backupClass = parseBackupClass(process.env.BACKUP_CLASS);
  const scheduledAt = parseScheduledAt(process.env.SCHEDULED_AT);
  const client = createR2Client(env);
  const result = await runProductionBackup(env, defaultAdapters(client), {backupClass, scheduledAt});
  console.log(JSON.stringify({...result, secretsExposed: false}));
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  main().catch((error: unknown) => {
    console.error('PRODUCTION_BACKUP_FAILED', (error as Error).message);
    process.exit(1);
  });
}
