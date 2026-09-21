import {spawn} from 'node:child_process';
import {createHash, randomUUID} from 'node:crypto';
import {mkdtemp, readFile, rm, lstat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Encrypter} from 'age-encryption';
import {S3Client, PutObjectCommand} from '@aws-sdk/client-s3';

// R2B mechanism only. The live Production path stays disabled until a separate
// R4 activation authority sets PRODUCTION_BACKUP_ACTIVATION and injects real secrets.
export type BackupClass = 'hourly' | 'daily';

/** Fixed, non-negotiable target — never read from an env var that a stray config could redirect. */
export const EXPECTED_PRODUCTION_BUCKET = 'zao-rental-prod-backup';
export const PGAPPNAME = 'zao-rental-production-backup';
export const LOCK_TIMEOUT_MS = 30_000;
/** 09:17 UTC / 18:17 JST — a documented low-activity window; the external scheduler dispatches hourly at :17. */
export const DAILY_PROMOTION_UTC_HOUR = 9;

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

export function assertProductionHost(host: string): void {
  const h = host.trim().toLowerCase();
  if (!h) throw new Error('BACKUP_HOST_EMPTY');
  if (h === 'localhost' || h === '127.0.0.1' || h === '::1') throw new Error('BACKUP_HOST_LOCALHOST_REJECTED');
  if (h.includes('-pooler')) throw new Error('BACKUP_HOST_POOLED_REJECTED');
  if (!h.endsWith('.neon.tech')) throw new Error('BACKUP_HOST_NON_NEON_REJECTED');
}

/** Fail closed: every required var must be present, by name only — never a default/fallback. */
export function readBackupEnv(env: NodeJS.ProcessEnv): BackupEnv {
  const missing = REQUIRED_ENV_KEYS.filter((k) => !env[k]);
  if (missing.length) throw new Error(`BACKUP_ENV_MISSING:${missing.join(',')}`);
  const out: BackupEnv = {
    PGHOST: env.PGHOST!, PGPORT: env.PGPORT!, PGDATABASE: env.PGDATABASE!, PGUSER: env.PGUSER!, PGPASSWORD: env.PGPASSWORD!,
    PRODUCTION_BACKUP_BUCKET: env.PRODUCTION_BACKUP_BUCKET!, AGE_BACKUP_RECIPIENT: env.AGE_BACKUP_RECIPIENT!,
    R2_ACCOUNT_ID: env.R2_ACCOUNT_ID!, R2_ACCESS_KEY_ID: env.R2_ACCESS_KEY_ID!, R2_SECRET_ACCESS_KEY: env.R2_SECRET_ACCESS_KEY!,
  };
  assertProductionHost(out.PGHOST);
  if (out.PRODUCTION_BACKUP_BUCKET !== EXPECTED_PRODUCTION_BUCKET) throw new Error('BACKUP_BUCKET_MISMATCH_REJECTED');
  return out;
}

export function objectKey(backupClass: BackupClass, at: Date): string {
  if (backupClass !== 'hourly' && backupClass !== 'daily') throw new Error('BACKUP_CLASS_INVALID');
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

// ---- Default adapters: real pg_dump/pg_restore/age/R2 I/O. Tests inject fakes instead. ----

export interface DumpResult { exitCode: number; stderrTail: string }

export async function spawnPgDump(env: BackupEnv, outFile: string): Promise<DumpResult> {
  return new Promise((resolve) => {
    const child = spawn('pg_dump', ['-Fc', '--no-owner', '--no-acl', '-f', outFile], {
      env: {
        ...process.env,
        PGHOST: env.PGHOST, PGPORT: env.PGPORT, PGDATABASE: env.PGDATABASE,
        PGUSER: env.PGUSER, PGPASSWORD: env.PGPASSWORD,
        PGSSLMODE: 'verify-full', PGCHANNELBINDING: 'require', PGAPPNAME,
        PGOPTIONS: `-c lock_timeout=${LOCK_TIMEOUT_MS}`,
      },
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
    const child = spawn('pg_restore', ['--list', dumpPath], {stdio: ['ignore', 'pipe', 'ignore'] as const});
    let out = '';
    child.stdout.on('data', (c: Buffer) => { out += c.toString(); });
    child.on('close', (code) => resolve({ok: code === 0 && out.trim().length > 0}));
    child.on('error', () => resolve({ok: false}));
  });
}

async function toolVersion(bin: string): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn(bin, ['--version'], {stdio: ['ignore', 'pipe', 'ignore'] as const});
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

export async function encryptWithAge(plaintext: Uint8Array, recipient: string): Promise<Uint8Array> {
  const e = new Encrypter();
  e.addRecipient(recipient);
  return e.encrypt(plaintext);
}

export function createR2Client(env: BackupEnv): S3Client {
  return new S3Client({
    region: 'auto',
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY},
  });
}

/** Only PutObject. No delete/admin operation is implemented anywhere in this module. */
export async function uploadEncrypted(client: S3Client, bucket: string, key: string, body: Uint8Array): Promise<void> {
  if (bucket !== EXPECTED_PRODUCTION_BUCKET) throw new Error('BACKUP_BUCKET_MISMATCH_REJECTED');
  await client.send(new PutObjectCommand({Bucket: bucket, Key: key, Body: body}));
}

// ---- Orchestrator ----

export interface BackupAdapters {
  dump: (env: BackupEnv, outFile: string) => Promise<DumpResult>;
  validate: (dumpPath: string) => Promise<{ok: boolean}>;
  encrypt: (plaintext: Uint8Array, recipient: string) => Promise<Uint8Array>;
  upload: (bucket: string, key: string, body: Uint8Array) => Promise<void>;
  toolVersions: () => Promise<{pgDump: string; pgRestore: string}>;
}

export function defaultAdapters(client: S3Client): BackupAdapters {
  return {
    dump: spawnPgDump,
    validate: spawnPgRestoreList,
    encrypt: encryptWithAge,
    upload: (bucket, key, body) => uploadEncrypted(client, bucket, key, body),
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
  opts: {backupClass: BackupClass; now?: Date},
): Promise<BackupResult> {
  assertProductionHost(env.PGHOST);
  if (env.PRODUCTION_BACKUP_BUCKET !== EXPECTED_PRODUCTION_BUCKET) throw new Error('BACKUP_BUCKET_MISMATCH_REJECTED');
  if (opts.backupClass !== 'hourly' && opts.backupClass !== 'daily') throw new Error('BACKUP_CLASS_INVALID');
  const now = opts.now ?? new Date();
  const dir = await mkdtemp(join(tmpdir(), 'zao-backup-'));
  const plaintextPath = join(dir, `${randomUUID()}.dump`);
  let plaintextWritten = false;
  try {
    const {exitCode, stderrTail} = await adapters.dump(env, plaintextPath);
    if (exitCode !== 0) throw new Error(`BACKUP_PG_DUMP_FAILED:${stderrTail}`);
    plaintextWritten = true;
    await assertOrdinaryFile(plaintextPath);
    const stat = await lstat(plaintextPath);
    if (stat.size === 0) throw new Error('BACKUP_EMPTY_ARCHIVE_REJECTED');
    const {ok} = await adapters.validate(plaintextPath);
    if (!ok) throw new Error('BACKUP_ARCHIVE_VALIDATION_FAILED');
    const plaintext = await readFile(plaintextPath);
    const sha256 = createHash('sha256').update(plaintext).digest('hex');
    const encrypted = await adapters.encrypt(plaintext, env.AGE_BACKUP_RECIPIENT);
    if (encrypted.length === 0 || Buffer.compare(Buffer.from(encrypted), plaintext) === 0) throw new Error('BACKUP_ENCRYPTION_INVALID');
    const key = objectKey(opts.backupClass, now);
    await adapters.upload(env.PRODUCTION_BACKUP_BUCKET, key, encrypted);
    const dailyPromoted = opts.backupClass === 'hourly' && isDesignatedDailyRun(now);
    let dailyKey: string | null = null;
    if (dailyPromoted) {
      dailyKey = objectKey('daily', now);
      await adapters.upload(env.PRODUCTION_BACKUP_BUCKET, dailyKey, encrypted);
    }
    const toolVersions = await adapters.toolVersions();
    return {key, sha256, bytes: stat.size, generatedAt: now.toISOString(), backupClass: opts.backupClass, dailyPromoted, dailyKey, toolVersions};
  } finally {
    if (plaintextWritten) await rm(plaintextPath, {force: true}).catch(() => {});
    await rm(dir, {recursive: true, force: true}).catch(() => {});
  }
}

// ---- CLI entrypoint. Requires BACKUP_MODE=production so a stray local invocation cannot touch it. ----

async function main(): Promise<void> {
  if (process.env.BACKUP_MODE !== 'production') throw new Error('BACKUP_MODE_NOT_PRODUCTION');
  if (process.env.PRODUCTION_BACKUP_ACTIVATION !== 'R4_APPROVED') throw new Error('BACKUP_ACTIVATION_GATE_NOT_APPROVED');
  const env = readBackupEnv(process.env);
  const client = createR2Client(env);
  const backupClass: BackupClass = process.env.BACKUP_CLASS === 'daily' ? 'daily' : 'hourly';
  const result = await runProductionBackup(env, defaultAdapters(client), {backupClass});
  console.log(JSON.stringify({...result, secretsExposed: false}));
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  main().catch((error: unknown) => {
    console.error('PRODUCTION_BACKUP_FAILED', (error as Error).message);
    process.exit(1);
  });
}
