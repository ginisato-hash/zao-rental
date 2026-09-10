import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import type { Pool } from 'pg';
import { trackPoolLifecycle } from '../../scripts/pool-lifecycle';
test('database stop must wait for delayed socket end after pool.end resolves', async () => {
  const pool = Object.assign(new EventEmitter(), { end: async () => {} });
  const close = trackPoolLifecycle(pool as unknown as Pool);
  const client = new EventEmitter(); pool.emit('connect', client);
  let completed = false; const closing = close().then(() => { completed = true; });
  await Promise.resolve(); await Promise.resolve(); assert.equal(completed, false);
  client.emit('end'); await closing; assert.equal(completed, true);
});
test('background connection errors fail closure without exposing attached client', async () => {
  const pool = Object.assign(new EventEmitter(), { end: async () => {} });
  const close = trackPoolLifecycle(pool as unknown as Pool);
  pool.emit('error', Object.assign(new Error('sensitive test detail'), { code: '57P01', client: { secret: 'synthetic-marker' } }));
  await assert.rejects(close(), error => { assert.ok(error instanceof Error); assert.match(error.message, /57P01/); assert.ok(!error.message.includes('sensitive')); assert.ok(!error.message.includes('synthetic-marker')); return true; });
});
