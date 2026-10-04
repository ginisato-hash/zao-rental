import {timingSafeEqual} from 'node:crypto';
import {productionPaymentRoleNames} from '../../../../scripts/production-payment-roles';
import {normalWorkerPlan,type NormalWorkerPlan} from './normal-production-worker';

/** One finite worker tick behind an authenticated scheduler request (Vercel Cron). It reuses the already-composed,
 * exact-identity Production runtime and `runWorker`; it adds no scheduling loop, no retry and no new provider call.
 * Notification, refund-create and refund-budget limits are fixed at 0 here: a live window needs a reviewed change. */
export const WORKER_TICK_ACTIVATION = 'NORMAL_WORKER_TICK_APPROVED';
/** Inside the 60 s hard ceiling that `normalWorkerPlan` enforces; an in-flight lookup still settles under its own timeout. */
export const WORKER_TICK_BUDGET_MS = 50_000;
export const WORKER_TICK_BATCH_SIZE = 20;
/** The complete, fixed set of environment names this module ever reads (never an env scan). */
export const WORKER_TICK_ENV_KEYS = Object.freeze([
  'CRON_SECRET', 'PRODUCTION_WORKER_TICK_ACTIVATION', 'PRODUCTION_WORKER_ACCEPTED_AFTER',
  'PRODUCTION_WORKER_DB_PASSWORD_DISPATCHER', 'PRODUCTION_WORKER_DB_PASSWORD_WORKER', 'PRODUCTION_WORKER_DB_PASSWORD_PROJECTOR',
] as const);
export type WorkerTickEnv = Partial<Record<(typeof WORKER_TICK_ENV_KEYS)[number], string | undefined>>;
type Source = Readonly<Record<string, string | undefined>>;

export function readWorkerTickEnv(env: Source): WorkerTickEnv {
  const out: WorkerTickEnv = {};
  for (const key of WORKER_TICK_ENV_KEYS) { const v = env[key]; if (typeof v === 'string') out[key] = v; }
  return out;
}

/** Constant-time `Authorization: Bearer <CRON_SECRET>` check. A missing or short secret never authorizes. */
export function authorizeWorkerTick(authorization: string | null, secret: string | undefined): boolean {
  if (!secret || secret.length < 32 || !authorization) return false;
  const expected = Buffer.from('Bearer ' + secret), got = Buffer.from(authorization);
  return expected.length === got.length && timingSafeEqual(expected, got);
}

export function workerTickPlan(env: WorkerTickEnv, now: Date): NormalWorkerPlan {
  const after = env.PRODUCTION_WORKER_ACCEPTED_AFTER;
  if (!after || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(after)) throw new Error('WORKER_TICK_CUTOFF_INVALID');
  return normalWorkerPlan({
    workerId: 'normal-tick-' + now.toISOString().slice(0, 16).replace(/[^0-9]/g, ''), acceptedBookingsAfter: after,
    deadline: new Date(now.getTime() + WORKER_TICK_BUDGET_MS).toISOString(), batchSize: WORKER_TICK_BATCH_SIZE,
    notificationLimit: 0, refundCreateLimit: 0, refundBudgetJpy: 0,
  }, now.getTime());
}

/** Exact-role URLs in the only shape `acceptanceDatabaseConfig` accepts: the configured direct host and database, verify-full. */
export function workerTickDatabaseUrls(database: {host: string; name: string}, env: WorkerTickEnv): Record<'dispatcher' | 'worker' | 'projector', string> {
  const roles = productionPaymentRoleNames(database.name);
  const passwords = {dispatcher: env.PRODUCTION_WORKER_DB_PASSWORD_DISPATCHER, worker: env.PRODUCTION_WORKER_DB_PASSWORD_WORKER, projector: env.PRODUCTION_WORKER_DB_PASSWORD_PROJECTOR};
  const url = (role: 'dispatcher' | 'worker' | 'projector') => {
    const password = passwords[role];
    if (!password || password.length < 16) throw new Error('WORKER_TICK_CREDENTIAL_MISSING');
    // Built through URL so credentials are encoded by the platform and no credential-bearing literal exists in source.
    const url = new URL('postgresql://' + database.host + '/' + database.name);
    url.username = roles[role]; url.password = password; url.search = '?sslmode=verify-full';
    return url.toString();
  };
  return {dispatcher: url('dispatcher'), worker: url('worker'), projector: url('projector')};
}

export interface WorkerTickRuntime { runWorker(input: {plan: unknown; databaseUrls: Record<'dispatcher' | 'worker' | 'projector', string>; lookup: never; preflight?: boolean}): Promise<unknown> }
export interface WorkerTickInput {
  authorization: string | null; env: WorkerTickEnv; now: Date;
  runtime: WorkerTickRuntime | null;
  /** Resolved lazily so an unauthorized or dormant request never builds provider transports. */
  resolve: () => {database: {host: string; name: string}; lookup: unknown};
  log: (line: string) => void;
}
export interface WorkerTickResponse { status: number; body: Record<string, unknown> }

let inFlight = false;
/** Safe summary only: a state code and counters. Never an error object, URL, role, key or provider payload. */
function summary(result: unknown): Record<string, unknown> {
  const r = (result ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {state: typeof r.state === 'string' ? r.state : 'UNKNOWN'};
  for (const k of ['projected', 'deferred', 'refundCreates', 'refundLookups']) if (typeof r[k] === 'number') out[k] = r[k];
  const backlog = (r['backlog'] ?? {}) as Record<string, unknown>;
  for (const k of ['pendingPayments', 'oldestPendingAgeSeconds']) if (typeof backlog[k] === 'number') out[k] = backlog[k];
  return out;
}

export async function handleWorkerTick(input: WorkerTickInput): Promise<WorkerTickResponse> {
  if (!authorizeWorkerTick(input.authorization, input.env.CRON_SECRET)) return {status: 401, body: {state: 'UNAUTHORIZED'}};
  // Start/stop switch: until the exact token is present this deployment answers without any database or provider work.
  // A dormant answer is logged under its own event name so it can prove the scheduler arrives, and is never counted as a successful tick.
  if (input.env.PRODUCTION_WORKER_TICK_ACTIVATION !== WORKER_TICK_ACTIVATION) { input.log(JSON.stringify({event: 'normal_worker_tick_dormant'})); return {status: 200, body: {state: 'NOT_ACTIVATED'}}; }
  if (inFlight) return {status: 200, body: {state: 'SKIPPED_IN_FLIGHT'}};
  inFlight = true;
  const started = Date.now();
  try {
    if (!input.runtime) return {status: 503, body: {state: 'RUNTIME_NOT_READY'}};
    const plan = workerTickPlan(input.env, input.now);
    const {database, lookup} = input.resolve();
    const result = await input.runtime.runWorker({plan, databaseUrls: workerTickDatabaseUrls(database, input.env), lookup: lookup as never, preflight: false});
    const body: Record<string, unknown> = {...summary(result), durationMs: Date.now() - started};
    input.log(JSON.stringify({event: 'normal_worker_tick', ...body}));
    // PROVIDER_STOP (auth or rate limit at the provider) is a real stop: surface it as a failed scheduled run.
    return {status: body['state'] === 'COMPLETED' ? 200 : 500, body};
  } catch (error) {
    const code = String((error as Error)?.message ?? '').match(/^[A-Z][A-Z0-9_]{3,80}/)?.[0];
    const body = {state: 'STOP', code: code?.startsWith('WORKER_TICK_') || code?.startsWith('NORMAL_WORKER_') ? code : 'NORMAL_WORKER_OPERATION_FAILED_NO_RETRY', durationMs: Date.now() - started};
    input.log(JSON.stringify({event: 'normal_worker_tick', ...body}));
    return {status: 500, body};
  } finally { inFlight = false; }
}
