import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateWorkerFreshness, parseTickLines, type TickRecord} from '../../packages/core/src/payment/worker-freshness';
import {main} from '../../scripts/production-worker-freshness';

const NOW = Date.parse('2035-01-01T00:10:00Z');
const at = (secondsAgo: number) => NOW - secondsAgo * 1000;
const ok = (secondsAgo: number, extra: Partial<TickRecord> = {}): TickRecord => ({time: at(secondsAgo), event: 'normal_worker_tick', state: 'COMPLETED', pendingPayments: 0, oldestPendingAgeSeconds: 0, ...extra});
const failed = (secondsAgo: number, state = 'STOP'): TickRecord => ({time: at(secondsAgo), event: 'normal_worker_tick', state, code: 'NORMAL_WORKER_OPERATION_FAILED_NO_RETRY'});
const dormant = (secondsAgo: number): TickRecord => ({time: at(secondsAgo), event: 'normal_worker_tick_dormant'});

test('a recent completed tick is healthy', () => {
  const r = evaluateWorkerFreshness([ok(240), ok(180), ok(60)], {now: NOW, expectedActive: true});
  assert.equal(r.status, 'OK'); assert.deepEqual(r.reasons, []); assert.equal(r.lastSuccessAgeSeconds, 60);
});

test('expected active with no completed tick for five minutes alerts, and only completed ticks count', () => {
  assert.deepEqual(evaluateWorkerFreshness([ok(301)], {now: NOW, expectedActive: true}).reasons, ['NO_SUCCESSFUL_TICK_WITHIN_WINDOW']);
  assert.equal(evaluateWorkerFreshness([ok(300)], {now: NOW, expectedActive: true}).status, 'OK');
  assert.equal(evaluateWorkerFreshness([], {now: NOW, expectedActive: true}).status, 'ALERT');
  // dormant answers, provider stops and failures never count as success, however recent
  assert.ok(evaluateWorkerFreshness([ok(400), dormant(30), dormant(90)], {now: NOW, expectedActive: true}).reasons.includes('NO_SUCCESSFUL_TICK_WITHIN_WINDOW'));
  assert.ok(evaluateWorkerFreshness([ok(400), failed(30, 'PROVIDER_STOP')], {now: NOW, expectedActive: true}).reasons.includes('NO_SUCCESSFUL_TICK_WITHIN_WINDOW'));
});

test('a deployment that went dormant while it should be running is called out explicitly', () => {
  const r = evaluateWorkerFreshness([ok(100), dormant(40)], {now: NOW, expectedActive: true});
  assert.deepEqual(r.reasons, ['DORMANT_WHILE_EXPECTED_ACTIVE']);
});

test('repeated failures and an aging backlog alert even while ticks keep arriving', () => {
  assert.deepEqual(evaluateWorkerFreshness([ok(200), failed(150), failed(100, 'PROVIDER_STOP'), failed(40)], {now: NOW, expectedActive: true}).reasons, ['CONSECUTIVE_TICK_FAILURES']);
  assert.equal(evaluateWorkerFreshness([ok(200), failed(150), failed(100), ok(40)], {now: NOW, expectedActive: true}).status, 'OK');
  assert.deepEqual(evaluateWorkerFreshness([ok(30, {pendingPayments: 4, oldestPendingAgeSeconds: 901})], {now: NOW, expectedActive: true}).reasons, ['BACKLOG_AGING']);
  assert.equal(evaluateWorkerFreshness([ok(30, {pendingPayments: 4, oldestPendingAgeSeconds: 900})], {now: NOW, expectedActive: true}).status, 'OK');
});

test('an intentional stop never alerts and is never counted as a success', () => {
  const r = evaluateWorkerFreshness([dormant(30), dormant(90)], {now: NOW, expectedActive: false});
  assert.equal(r.status, 'NOT_EXPECTED'); assert.equal(r.lastSuccessAgeSeconds, null); assert.equal(r.dormantTicks, 2);
  assert.equal(evaluateWorkerFreshness([failed(30)], {now: NOW, expectedActive: false}).status, 'NOT_EXPECTED');
});

test('evaluation is independent of the worker: it needs only log lines, in the raw or Vercel shape, and ignores everything else', () => {
  const raw = JSON.stringify({event: 'normal_worker_tick', state: 'COMPLETED', pendingPayments: 1, oldestPendingAgeSeconds: 12, durationMs: 800});
  const wrapped = JSON.stringify({timestamp: at(30), message: raw, level: 'info', source: 'lambda'});
  const iso = JSON.stringify({time: new Date(at(90)).toISOString(), message: JSON.stringify({event: 'normal_worker_tick_dormant'})});
  const records = parseTickLines([wrapped, iso, 'not json', JSON.stringify({event: 'something_else', timestamp: at(5)}), JSON.stringify({message: '{"event":"normal_worker_tick"}'}), raw], at(10));
  assert.deepEqual(records.map(r => [r.event, r.state ?? null]), [['normal_worker_tick_dormant', null], ['normal_worker_tick', 'COMPLETED'], ['normal_worker_tick', 'COMPLETED']]);
  assert.equal(evaluateWorkerFreshness(records, {now: NOW, expectedActive: true}).status, 'OK');
});

test('the monitor command exits 2 on alert, 0 otherwise, rejects ambiguous arguments and delivers nothing', async () => {
  const line = (secondsAgo: number, state: string) => JSON.stringify({timestamp: at(secondsAgo), message: JSON.stringify({event: 'normal_worker_tick', state})});
  const stale = await main(['--expected-active'], async () => line(900, 'COMPLETED') + '\n', NOW);
  assert.equal(stale.code, 2); assert.equal(stale.output['status'], 'ALERT'); assert.equal(stale.output['alertDelivery'], 'HELD_NO_CONFIRMED_RECIPIENT');
  const fresh = await main(['--expected-active'], async () => line(20, 'COMPLETED') + '\n', NOW);
  assert.equal(fresh.code, 0); assert.equal(fresh.output['alertDelivery'], 'NOT_NEEDED');
  assert.equal((await main(['--intentional-stop'], async () => '', NOW)).code, 0);
  for (const argv of [[], ['--expected-active', '--intentional-stop'], ['--other']]) await assert.rejects(main(argv, async () => '', NOW), /FRESHNESS_ARGUMENTS_REJECTED/);
});
