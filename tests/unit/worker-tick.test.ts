import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {acceptanceDatabaseConfig} from '../../scripts/lib/production-payment-acceptance';
import {productionPaymentRoleNames} from '../../scripts/production-payment-roles';
import type {ProductionConfiguration} from '../../packages/auth/src/production-config';
import {
  WORKER_TICK_ACTIVATION, WORKER_TICK_BUDGET_MS, WORKER_TICK_ENV_KEYS, authorizeWorkerTick, handleWorkerTick, readWorkerTickEnv,
  workerTickDatabaseUrls, workerTickLimit, workerTickPlan, type WorkerTickEnv, type WorkerTickInput,
} from '../../packages/core/src/payment/worker-tick';

const SECRET = 'cron-secret-' + 'x'.repeat(24);
const NOW = new Date('2035-01-01T00:10:30.000Z');
const database = {host: 'ep-synthetic-direct.ap-southeast-1.aws.neon.tech', name: 'neondb'};
const env: WorkerTickEnv = {
  CRON_SECRET: SECRET, PRODUCTION_WORKER_TICK_ACTIVATION: WORKER_TICK_ACTIVATION, PRODUCTION_WORKER_ACCEPTED_AFTER: '2034-12-31T00:00:00Z',
  PRODUCTION_WORKER_DB_PASSWORD_DISPATCHER: 'dispatcher-password-synthetic', PRODUCTION_WORKER_DB_PASSWORD_WORKER: 'worker-password-synthetic-1',
  PRODUCTION_WORKER_DB_PASSWORD_PROJECTOR: 'projector-password-synthetic',
};
const bearer = 'Bearer ' + SECRET;

function harness(overrides: Partial<WorkerTickInput> = {}, runWorker: (input: unknown) => Promise<unknown> = async () => ({state: 'COMPLETED', projected: 2, deferred: 1, refundCreates: 0, refundLookups: 3, backlog: {pendingPayments: 3, oldestPendingAgeSeconds: 42, detail: 'must-not-leak-either'}, secret: 'must-not-leak'})) {
  const calls = {run: [] as unknown[], resolve: 0, log: [] as string[]};
  const input: WorkerTickInput = {
    authorization: bearer, env, now: NOW,
    runtime: {runWorker: async i => { calls.run.push(i); return runWorker(i); }},
    resolve: () => { calls.resolve++; return {database, lookup: {tag: 'lookup'}}; },
    log: line => calls.log.push(line), ...overrides,
  };
  return {calls, input};
}

test('only an exact Bearer CRON_SECRET of at least 32 characters authorizes a tick', () => {
  assert.equal(authorizeWorkerTick(bearer, SECRET), true);
  for (const [header, secret] of [
    [null, SECRET], ['', SECRET], ['Bearer wrong' + 'x'.repeat(30), SECRET], [bearer + 'x', SECRET], [SECRET, SECRET], ['bearer ' + SECRET, SECRET],
    [bearer, undefined], ['Bearer short', 'short'], ['Bearer ', ''],
  ] as const) assert.equal(authorizeWorkerTick(header, secret), false, String(header));
});

test('the tick reads exactly its seven named variables and nothing else from the environment (no refund variable exists)', () => {
  assert.deepEqual([...WORKER_TICK_ENV_KEYS].sort(), ['CRON_SECRET', 'PRODUCTION_WORKER_ACCEPTED_AFTER', 'PRODUCTION_WORKER_DB_PASSWORD_DISPATCHER',
    'PRODUCTION_WORKER_DB_PASSWORD_PROJECTOR', 'PRODUCTION_WORKER_DB_PASSWORD_WORKER', 'PRODUCTION_WORKER_NOTIFICATION_LIMIT', 'PRODUCTION_WORKER_TICK_ACTIVATION']);
  const read = readWorkerTickEnv({...env, PRODUCTION_WORKER_NOTIFICATION_LIMIT: '1', PRODUCTION_WORKER_REFUND_CREATE_LIMIT: '20', PRODUCTION_WORKER_REFUND_BUDGET_JPY: '100000000',
    PRODUCTION_DB_PASSWORD_GUEST: 'unrelated-secret', PRODUCTION_SQUARE_ACCESS_TOKEN: 'unrelated-token', PRODUCTION_WORKER_DB_PASSWORD_EXTRA: 'x'});
  assert.deepEqual(Object.keys(read).sort(), [...WORKER_TICK_ENV_KEYS].sort());
});

test('notification limit: unset => 0; bounded integer opens it; malformed/out of range stops the tick. Refund CREATE is always 0', () => {
  const zero = workerTickPlan(env, NOW);
  assert.deepEqual([zero.notificationLimit, zero.refundCreateLimit, zero.refundBudgetJpy], [0, 0, 0]);
  for (const [raw, want] of [['0', 0], ['1', 1], ['5', 5], ['20', 20]] as const) {
    const plan = workerTickPlan({...env, PRODUCTION_WORKER_NOTIFICATION_LIMIT: raw}, NOW);
    assert.deepEqual([plan.notificationLimit, plan.refundCreateLimit, plan.refundBudgetJpy], [want, 0, 0], raw);
  }
  for (const bad of ['', ' 1', '1 ', '-1', '+1', '01', '1.0', '1e1', '0x10', 'NaN', 'Infinity', 'twenty', '1,0', '９', '21', '1000000000'])
    assert.throws(() => workerTickPlan({...env, PRODUCTION_WORKER_NOTIFICATION_LIMIT: bad}, NOW), /WORKER_TICK_LIMIT_INVALID/, JSON.stringify(bad));
  // refund variables, even if present in the platform environment, are never read: CREATE and budget stay 0
  const sneaky = readWorkerTickEnv({...env, PRODUCTION_WORKER_REFUND_CREATE_LIMIT: '20', PRODUCTION_WORKER_REFUND_BUDGET_JPY: '100000000'});
  const plan = workerTickPlan(sneaky, NOW);
  assert.deepEqual([plan.refundCreateLimit, plan.refundBudgetJpy], [0, 0]);
  assert.equal(workerTickLimit({}, 'PRODUCTION_WORKER_NOTIFICATION_LIMIT'), 0);
});

test('two consecutive ticks each carry the same bounded notification limit and refund CREATE 0 (per-tick, nothing accumulates or escalates)', async () => {
  const live = {...env, PRODUCTION_WORKER_TICK_ACTIVATION: WORKER_TICK_ACTIVATION, PRODUCTION_WORKER_NOTIFICATION_LIMIT: '3'};
  const h1 = harness({env: live, now: NOW}), h2 = harness({env: live, now: new Date(NOW.getTime() + 60_000)});
  for (const h of [h1, h2]) assert.equal((await handleWorkerTick(h.input)).status, 200);
  const plans = [h1, h2].map(h => (h.calls.run[0] as {plan: {notificationLimit: number; refundCreateLimit: number; refundBudgetJpy: number; workerId: string}}).plan);
  for (const p of plans) assert.deepEqual([p.notificationLimit, p.refundCreateLimit, p.refundBudgetJpy], [3, 0, 0]);
  assert.notEqual(plans[0]!.workerId, plans[1]!.workerId, 'each tick is its own finite worker');
  const off = harness({env: {...live, PRODUCTION_WORKER_NOTIFICATION_LIMIT: 'x'}});
  const stopped = await handleWorkerTick(off.input);
  assert.equal(stopped.status, 500); assert.equal(off.calls.run.length, 0, 'an invalid limit stops before any worker/provider call');
  assert.equal((stopped.body as {code?: string}).code, 'WORKER_TICK_LIMIT_INVALID');
});

test('plan is finite and, with no limit variables set, keeps notification, refund-create and refund-budget limits at zero', () => {
  const plan = workerTickPlan(env, NOW);
  assert.equal(plan.batchSize, 20);
  assert.deepEqual([plan.notificationLimit, plan.refundCreateLimit, plan.refundBudgetJpy], [0, 0, 0]);
  assert.equal(Date.parse(plan.deadline) - NOW.getTime(), WORKER_TICK_BUDGET_MS);
  assert.ok(WORKER_TICK_BUDGET_MS < 60_000);
  assert.match(plan.workerId, /^normal-tick-\d{12}$/);
  assert.ok(Object.isFrozen(plan));
  for (const accepted of [undefined, '', 'not-a-time', '2034-12-31T00:00:00+09:00', '2026-10-03T09:14:38Z', '2035-01-02T00:00:00Z'])
    assert.throws(() => workerTickPlan({...env, PRODUCTION_WORKER_ACCEPTED_AFTER: accepted as string}, NOW), accepted === undefined || accepted === '' || accepted === 'not-a-time' || accepted.includes('+09:00') ? /WORKER_TICK_CUTOFF_INVALID/ : /NORMAL_WORKER_/);
});

test('role URLs are exactly what the production role parser accepts, and a missing or short password stops the tick', () => {
  const urls = workerTickDatabaseUrls(database, env);
  const roles = productionPaymentRoleNames(database.name);
  const configuration = {database: {host: database.host, name: database.name, roles: {operations: database.name + '_operations'}}} as unknown as ProductionConfiguration;
  for (const role of ['dispatcher', 'worker', 'projector'] as const) {
    const config = acceptanceDatabaseConfig(configuration, role, urls[role]);
    assert.equal(config.user, roles[role]); assert.equal(config.host, database.host); assert.equal(config.database, database.name);
    assert.equal(config.password, {dispatcher: env.PRODUCTION_WORKER_DB_PASSWORD_DISPATCHER, worker: env.PRODUCTION_WORKER_DB_PASSWORD_WORKER, projector: env.PRODUCTION_WORKER_DB_PASSWORD_PROJECTOR}[role]);
  }
  assert.throws(() => workerTickDatabaseUrls(database, {...env, PRODUCTION_WORKER_DB_PASSWORD_WORKER: undefined}), /WORKER_TICK_CREDENTIAL_MISSING/);
  assert.throws(() => workerTickDatabaseUrls(database, {...env, PRODUCTION_WORKER_DB_PASSWORD_PROJECTOR: 'short'}), /WORKER_TICK_CREDENTIAL_MISSING/);
});

test('an unauthorized request touches nothing and reveals nothing', async () => {
  for (const authorization of [null, 'Bearer nope', bearer + 'x']) {
    const {calls, input} = harness({authorization});
    assert.deepEqual(await handleWorkerTick(input), {status: 401, body: {state: 'UNAUTHORIZED'}});
    assert.deepEqual([calls.run.length, calls.resolve, calls.log.length], [0, 0, 0]);
  }
});

test('without the activation token the tick answers NOT_ACTIVATED and does no database or provider work', async () => {
  for (const token of [undefined, '', 'APPROVED', 'normal_worker_tick_approved']) {
    const {calls, input} = harness({env: {...env, PRODUCTION_WORKER_TICK_ACTIVATION: token as string}});
    assert.deepEqual(await handleWorkerTick(input), {status: 200, body: {state: 'NOT_ACTIVATED'}});
    assert.deepEqual([calls.run.length, calls.resolve], [0, 0]);
    assert.deepEqual(calls.log.map(l => JSON.parse(l).event), ['normal_worker_tick_dormant'], 'dormant answers are logged under their own event');
  }
});

test('a runtime that is not ready is a 503 and never builds transports', async () => {
  const {calls, input} = harness({runtime: null});
  assert.deepEqual(await handleWorkerTick(input), {status: 503, body: {state: 'RUNTIME_NOT_READY'}});
  assert.equal(calls.resolve, 0);
});

test('an authorized tick runs the finite worker once with zero live limits and logs a safe summary only', async () => {
  const {calls, input} = harness();
  const response = await handleWorkerTick(input);
  assert.equal(response.status, 200);
  assert.deepEqual({...response.body, durationMs: undefined}, {state: 'COMPLETED', projected: 2, deferred: 1, refundCreates: 0, refundLookups: 3, pendingPayments: 3, oldestPendingAgeSeconds: 42, durationMs: undefined});
  assert.equal(calls.run.length, 1); assert.equal(calls.resolve, 1);
  const sent = calls.run[0] as {plan: {notificationLimit: number; refundCreateLimit: number; refundBudgetJpy: number}; databaseUrls: Record<string, string>; preflight: boolean; lookup: unknown};
  assert.deepEqual([sent.plan.notificationLimit, sent.plan.refundCreateLimit, sent.plan.refundBudgetJpy, sent.preflight], [0, 0, 0, false]);
  assert.deepEqual(Object.keys(sent.databaseUrls).sort(), ['dispatcher', 'projector', 'worker']);
  assert.deepEqual(sent.lookup, {tag: 'lookup'});
  assert.equal(calls.log.length, 1);
  const logged = calls.log.join('') + JSON.stringify(response.body);
  for (const forbidden of ['must-not-leak', 'must-not-leak-either', 'password', 'postgresql://', SECRET]) assert.ok(!logged.includes(forbidden), forbidden);
  assert.equal(JSON.parse(calls.log[0]!).event, 'normal_worker_tick');
});

test('a provider stop is a failed scheduled run, not a silent success', async () => {
  const {input} = harness({}, async () => ({state: 'PROVIDER_STOP', reconciliation: {results: []}}));
  const response = await handleWorkerTick(input);
  assert.equal(response.status, 500); assert.equal(response.body.state, 'PROVIDER_STOP');
});

test('failures expose only a stable code, never the underlying error text', async () => {
  const leaky = harness({}, async () => { throw new Error(['connect ', 'postgresql', '://', 'role', ':SUPERSECRETPASSWORD', '@host/db failed'].join('')); });
  const generic = await handleWorkerTick(leaky.input);
  assert.equal(generic.status, 500); assert.equal(generic.body.code, 'NORMAL_WORKER_OPERATION_FAILED_NO_RETRY');
  assert.ok(!JSON.stringify(generic.body).includes('SUPERSECRET') && !leaky.calls.log.join('').includes('SUPERSECRET'));
  const known = await handleWorkerTick(harness({}, async () => { throw new Error('NORMAL_WORKER_ROLE_NOT_READY'); }).input);
  assert.equal(known.body.code, 'NORMAL_WORKER_ROLE_NOT_READY');
  const missing = await handleWorkerTick(harness({env: {...env, PRODUCTION_WORKER_DB_PASSWORD_WORKER: undefined}}).input);
  assert.equal(missing.body.code, 'WORKER_TICK_CREDENTIAL_MISSING');
  const cutoff = await handleWorkerTick(harness({env: {...env, PRODUCTION_WORKER_ACCEPTED_AFTER: '2026-10-03T09:14:38Z'}}).input);
  assert.equal(cutoff.status, 500);
});

test('overlapping invocations in one instance never run two ticks, and the guard resets after success or failure', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const first = harness({}, async () => { await gate; return {state: 'COMPLETED'}; });
  const running = handleWorkerTick(first.input);
  await new Promise(resolve => setImmediate(resolve));
  const second = harness();
  assert.deepEqual(await handleWorkerTick(second.input), {status: 200, body: {state: 'SKIPPED_IN_FLIGHT'}});
  assert.equal(second.calls.run.length, 0);
  release();
  assert.equal((await running).status, 200);
  assert.equal((await handleWorkerTick(harness({}, async () => { throw new Error('boom'); }).input)).status, 500);
  assert.equal((await handleWorkerTick(harness().input)).status, 200);
});

test('scheduler wiring is exactly one per-minute cron on the protected GET route with the platform maximum duration', async () => {
  const vercel = JSON.parse(await readFile(new URL('../../vercel.json', import.meta.url), 'utf8')) as {crons: {path: string; schedule: string}[]};
  assert.deepEqual(vercel.crons, [{path: '/api/internal/worker-tick', schedule: '* * * * *'}]);
  const route = await readFile(new URL('../../apps/web/src/app/api/internal/worker-tick/route.ts', import.meta.url), 'utf8');
  assert.match(route, /export const maxDuration = 60;/); assert.match(route, /export async function GET\(/);
  assert.ok(!/export (async )?function (POST|PUT|PATCH|DELETE)/.test(route));
  const source = await readFile(new URL('../../packages/core/src/payment/worker-tick.ts', import.meta.url), 'utf8');
  assert.ok(!/process\.env/.test(source), 'environment is passed in, never scanned');
  // Only the notification limit is configurable (bounded, default 0); refund CREATE/budget are fixed at 0 in code.
  assert.equal((source.match(/workerTickLimit\(env, '/g) ?? []).length, 1, 'only the notification limit is read through the bounded parser');
  assert.ok(/if \(raw === undefined\) return 0;/.test(source), 'an unset limit is 0');
  assert.ok(/refundCreateLimit: 0, refundBudgetJpy: 0,/.test(source), 'refund CREATE is never enabled by the scheduled worker');
});
