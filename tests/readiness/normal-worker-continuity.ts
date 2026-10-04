import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import type {flowFixture} from '../flow/fixture';
import {pendingCommercialBookingFixture, syntheticMerchant} from '../fixtures/commercial-booking';
import {PaymentReconciliationWorker, type PaymentContextReader, type PaymentReconciliationRepository, type ReconciliationClaim} from '../../packages/core/src/payment/payment-reconciliation';
import {normalProjectionReference, normalWorkerPlan, runNormalProductionTick, type NormalProjectionCandidate, type NormalWorkerPorts} from '../../packages/core/src/payment/normal-production-worker';
import {normalBacklog} from '../../packages/db/src/normal-production-worker';
import {PgProjectionTransaction} from '../../packages/db/src/internal/payment-projection';
import {decidePaymentProjection, verifyProjectionSource} from '../../packages/core/src/payment/payment-projection';
import {flowHash, type PaymentObservation} from '../../packages/contracts/src/rental-flow';

const APPLICATION = 'zao_continuity_test';

/** Continuity of the scheduled worker against one real PostgreSQL: two independent consumers (separate pools, so separate
 * sessions), backlog larger than a batch, skipped ticks, a consumer that stops after claiming, and warm repeated ticks.
 * Fake provider lookup only; no real payment, refund or mail. Complements `normalWorkerAcceptance`, which already proves
 * the same-tick replay, claim crash recovery, UNKNOWN refund never resent and bounded CREATE/LOOKUP lanes. */
export async function normalWorkerContinuity(x: Awaited<ReturnType<typeof flowFixture>>) {
  const previous = x.now().toISOString();
  await x.clock(new Date().toISOString());
  const since = new Date(Date.now() - 1000).toISOString(), options = x.db.pool.options as {host: string; port: number; user: string; password: string; database: string};
  const independent = () => new Pool({host: options.host, port: options.port, user: options.user, password: options.password, database: options.database, max: 3, application_name: APPLICATION});
  const sessions = async () => Number((await x.db.pool.query("SELECT count(*)::int n FROM pg_stat_activity WHERE application_name=$1", [APPLICATION])).rows[0].n);
  const stuck = async () => Number((await x.db.pool.query("SELECT count(*)::int n FROM pg_stat_activity WHERE application_name=$1 AND state LIKE 'idle in transaction%'", [APPLICATION])).rows[0].n);
  const baseline = await sessions();
  assert.equal(baseline, 0);
  const days = ['2035-11-01', '2035-11-02', '2035-11-03', '2035-11-04', '2035-11-05', '2035-11-06', '2035-11-07'];
  const bookings: Awaited<ReturnType<typeof pendingCommercialBookingFixture>>[] = [];
  for (const day of days) bookings.push(await pendingCommercialBookingFixture(x, day));
  const observations = new Map<string, PaymentObservation>(bookings.map(b => [b.observation.providerId, b.observation]));
  for (const b of bookings) await x.db.pool.query("SELECT square_webhook.receive_production($1,'payment.updated',$2,$3,$4)", ['continuity-' + randomUUID(), syntheticMerchant, b.observation.providerId, flowHash(b.observation)]);
  const counters = {lookups: new Map<string, number>(), closed: 0};
  const projected = async () => Number((await x.db.pool.query('SELECT count(*)::int n FROM payment_projection.events WHERE booking_id=ANY($1::uuid[])', [bookings.map(b => b.bookingId)])).rows[0].n);

  function repositoryFor(pool: Pool): PaymentReconciliationRepository {
    return {
      async dispatch(_e, n) { return (await pool.query('SELECT payment_reconciliation.dispatch_normal($1,$2,$3) n', [syntheticMerchant, n, since])).rows[0].n; },
      async claimBatch(_e, id, n) { return (await pool.query('SELECT payment_reconciliation.claim_normal($1,$2,$3,$4) v', [id, n, syntheticMerchant, since])).rows.map(({v}) => ({...v, leaseExpiresAt: new Date(v.leaseExpiresAt), deadlineAt: new Date(v.deadlineAt)})); },
      async finalize(c, o) { return (await pool.query('SELECT payment_reconciliation.finalize_production($1,$2,$3,$4,$5,$6,$7) ok', [c.id, c.leaseToken, c.truthRevision, o.state, o.code, o.retrySeconds, o.truth])).rows[0].ok; },
      diagnostics: async () => [],
    };
  }
  function portsFor(pool: Pool): NormalWorkerPorts {
    const repository = repositoryFor(pool);
    const contexts: PaymentContextReader = {async load(c) { return (await pool.query('SELECT payment_reconciliation.load_context_production($1,$2,$3) v', [c.environment, c.merchantId, c.paymentId])).rows[0].v; }};
    const reconciliation = new PaymentReconciliationWorker(repository, contexts, {async lookupPayment(r) {
      counters.lookups.set(r.paymentId, (counters.lookups.get(r.paymentId) ?? 0) + 1);
      const observation = observations.get(r.paymentId); assert.ok(observation);
      return {kind: 'OBSERVED', observation};
    }});
    return {
      reconciliation,
      candidates: async limit => (await pool.query<{v: NormalProjectionCandidate}>('SELECT payment_projection.normal_candidates($1,$2,$3) v', [syntheticMerchant, since, limit])).rows.map(r => r.v),
      project: async candidate => {
        const ref = normalProjectionReference(candidate), c = await pool.connect();
        try {
          await c.query('BEGIN'); await c.query('SELECT pg_advisory_xact_lock(71820600)');
          const tx = new PgProjectionTransaction(c, ref), state = await tx.load(), prior = await tx.prior(ref.observationFingerprint);
          if (prior) { await tx.linkReplay(ref); await c.query('COMMIT'); return {...prior.result, duplicate: true}; }
          const now = await tx.time(), observed = verifyProjectionSource(ref, await tx.source(), now, 'PRODUCTION'), result = await tx.persist(state, decidePaymentProjection(state, observed, now), ref, now);
          await c.query('COMMIT'); return result;
        } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
      },
      notifications: null, refunds: null, refundCandidates: async () => [],
      close: async () => { counters.closed++; },
    };
  }
  const plan = (workerId: string, batchSize: number) => normalWorkerPlan({workerId, acceptedBookingsAfter: since, deadline: new Date(Date.now() + 60000).toISOString(), batchSize, notificationLimit: 0, refundCreateLimit: 0, refundBudgetJpy: 0});
  const poolA = independent(), poolB = independent();
  poolA.on('error', () => {}); poolB.on('error', () => {});
  try {
    const A = portsFor(poolA), B = portsFor(poolB);

    // Ticks were skipped while seven payments arrived: nothing is lost and nothing has moved.
    assert.equal(await projected(), 0); assert.equal(counters.lookups.size, 0);
    const locations = [...new Set(bookings.map(b => b.locationId))];
    const waiting = await normalBacklog(x.db.pool, syntheticMerchant, locations, since);
    assert.equal(waiting.pendingPayments, bookings.length, 'the backlog metric sees every skipped payment'); assert.ok(waiting.oldestPendingAgeSeconds >= 0);

    // First tick back: two independent sessions at once, batch 2 over a backlog of 7. No payment is looked up twice and
    // the work is bounded by the batch, not by the backlog.
    const first = await Promise.all([runNormalProductionTick(plan('continuity-a-1', 2), A), runNormalProductionTick(plan('continuity-b-1', 2), B)]);
    assert.ok(first.every(r => r.state === 'COMPLETED'));
    const afterFirst = await projected();
    assert.ok(afterFirst >= 2 && afterFirst <= 4, 'one round of two batch-2 consumers handles at most 4: ' + afterFirst);
    assert.ok([...counters.lookups.values()].every(n => n === 1), 'concurrent consumers never look up one payment twice');
    assert.ok(await stuck() === 0);

    // Remaining backlog drains over later ticks; every payment is looked up and projected exactly once.
    let rounds = 1;
    while (await projected() < bookings.length && rounds < 8) {
      rounds++;
      await Promise.all([runNormalProductionTick(plan('continuity-a-' + rounds, 2), A), runNormalProductionTick(plan('continuity-b-' + rounds, 2), B)]);
    }
    assert.equal(await projected(), bookings.length); assert.ok(rounds >= 2, 'a backlog larger than one batch needs more than one round');
    assert.deepEqual([...counters.lookups.values()].sort(), bookings.map(() => 1));
    // A further tick with nothing left does no provider work and projects nothing.
    const idle = await runNormalProductionTick(plan('continuity-idle', 2), A);
    assert.equal(idle.state, 'COMPLETED'); assert.deepEqual(await normalBacklog(x.db.pool, syntheticMerchant, locations, since), {pendingPayments: 0, oldestPendingAgeSeconds: 0}, 'a drained backlog reads zero'); assert.equal(await projected(), bookings.length); assert.ok([...counters.lookups.values()].every(n => n === 1));

    // A consumer claims and then stops (no finalize). The other session cannot take the leased payment; once the lease
    // lapses it is recovered once, and the stale claim can no longer finalize.
    const late = await pendingCommercialBookingFixture(x, '2035-11-08'); observations.set(late.observation.providerId, late.observation);
    await x.db.pool.query("SELECT square_webhook.receive_production($1,'payment.updated',$2,$3,$4)", ['continuity-' + randomUUID(), syntheticMerchant, late.observation.providerId, flowHash(late.observation)]);
    const repositoryA = repositoryFor(poolA);
    await repositoryA.dispatch('PRODUCTION', 20);
    const claims = await repositoryA.claimBatch('PRODUCTION', 'continuity-stopped', 20); assert.equal(claims.length, 1);
    await runNormalProductionTick(plan('continuity-b-leased', 2), B);
    assert.equal(counters.lookups.get(late.observation.providerId) ?? 0, 0, 'a leased payment is not taken by the other session');
    await x.db.pool.query("UPDATE payment_reconciliation.jobs SET lease_expires_at=statement_timestamp()-interval '1 second',claim_after=statement_timestamp()-interval '1 second' WHERE id=$1", [claims[0]!.id]);
    await runNormalProductionTick(plan('continuity-b-recovered', 2), B);
    assert.equal(counters.lookups.get(late.observation.providerId), 1);
    assert.equal(await repositoryA.finalize(claims[0] as ReconciliationClaim, {state: 'BLOCKED', code: 'AUTH_BLOCKED', retrySeconds: null, truth: null}), false);
    assert.equal(Number((await x.db.pool.query('SELECT count(*)::int n FROM payment_projection.events WHERE booking_id=$1', [late.bookingId])).rows[0].n), 1);

    // Warm process: many consecutive ticks across both sessions complete every time, close their ports every time,
    // and never leave a session idle inside a transaction.
    const closedBefore = counters.closed;
    for (let i = 0; i < 6; i++) { assert.equal((await runNormalProductionTick(plan('continuity-warm-' + i, 2), i % 2 ? A : B)).state, 'COMPLETED'); assert.equal(await stuck(), 0); }
    assert.equal(counters.closed - closedBefore, 6);
    assert.ok([...counters.lookups.values()].every(n => n === 1), 'warm repeats never re-lookup a settled payment');
    assert.ok(await sessions() > 0 && await sessions() <= 6, 'only the two pools\' bounded sessions exist');
  } finally {
    await Promise.all([poolA.end(), poolB.end()]);
    for (let i = 0; i < 40 && await sessions() > 0; i++) await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(await sessions(), 0, 'every session of both pools is gone after cleanup');
    await x.clock(previous);
  }
  console.log('PASS normal worker continuity: two independent sessions, backlog beyond batch drains once, skipped ticks recover, stopped consumer recovers after lease, warm ticks clean up; provider calls fake');
}
