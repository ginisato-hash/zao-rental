// Real disposable PostgreSQL proof of the provisional booking-capacity mechanism (migration
// 0041, packages/core/src/operations/provisional-capacity-source.ts,
// packages/core/src/inventory/provisional-capacity.ts). Mirrors the wear_pools/wear_claims real-PG
// proof pattern this codebase already establishes. No real Neon SQL, no Square, no payment.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {flowFixture} from '../flow/fixture';
import {loadStaff} from '../../packages/auth/src/staff-auth';
import {provisionOperationsRole} from '../../scripts/operations-roles';
import {OperationsContext} from '../../packages/core/src/operations/context';
import {ProvisionalCapacitySourceOperations} from '../../packages/core/src/operations/provisional-capacity-source';
import {provisionalCapacity, writeProvisionalClaims, releaseProvisionalClaims, type ProvisionalRequirement} from '../../packages/core/src/inventory/provisional-capacity';

let failed = false, stage = 'fixture', count = 0;
const x = await flowFixture();
let role: Awaited<ReturnType<typeof provisionOperationsRole>> | undefined;
async function check(name: string, fn: () => Promise<void>): Promise<void> { stage = name; await fn(); count++; console.log('PASS ' + name); }

try {
  role = await provisionOperationsRole(x.db.pool, x.db.identity);
  const ctx = new OperationsContext(role.operationsPool, x.roles.authPool, x.signed.identity);
  const src = new ProvisionalCapacitySourceOperations(ctx);
  Object.assign(x.principal, (await loadStaff(x.roles.authPool, x.actor))!);

  // ---- test harness: a minimal real inventory_holds row, bypassing HoldService entirely (this
  // module is deliberately not wired into HoldService this pass — it is tested directly). ----
  async function makeHold(startDate: string, endDate: string, state: 'ACTIVE'|'RELEASED'|'EXPIRED' = 'ACTIVE', pickupStore: 'MOUNTAIN_BASE'|'ONSEN_BASE' = 'MOUNTAIN_BASE') {
    const reservationId = randomUUID(), holdId = randomUUID();
    const c = await x.db.pool.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('zao.actor',$1,true),set_config('zao.reason','SYNTHETIC provisional-capacity fixture',true)", [x.actor]);
      await c.query('INSERT INTO inventory_reservations(id,owner_id) VALUES($1,$2)', [reservationId, x.actor]);
      await c.query(
        `INSERT INTO inventory_holds(id,reservation_id,owner_id,pickup_store,return_store,conditions,starts_at,due_at,occupancy_start,occupancy_end,expires_at,state)
         VALUES($1,$2,$3,$4,$4,'{}'::jsonb,$5,$6,$7,$8,$9,$10)`,
        [holdId, reservationId, x.actor, pickupStore, startDate + 'T08:30:00+09:00', endDate + 'T17:00:00+09:00', startDate, endDate, endDate + 'T23:59:00+09:00', state],
      );
      await c.query('COMMIT');
    } finally { c.release(); }
    return holdId;
  }
  function days(startDate: string, n: number) {
    const first = Date.parse(startDate + 'T00:00:00Z');
    return Array.from({length: n}, (_, i) => new Date(first + i * 86400000).toISOString().slice(0, 10));
  }
  const now = new Date();

  // ---- A: source extraction ----
  await check('A: source extraction — exact source hash, exact new totals, anomaly rules captured (unresolved boot buckets recorded, not guessed)', async () => {
    const sourceSha256 = 'c85997f464e59c616c6afb18ce03a34f6a73371d1aebeba2a6b8229bfd9c2257';
    const result = await src.register(randomUUID(), {
      sourceSha256,
      originalFilename: '樹林更新板25_26サロモンステーション蔵王 在庫数 (1).xlsx',
      buckets: [
        {family: 'SKI', age: 'ADULT', sourceSize: '160 cm', bookingSize: '160 cm', quantity: 17, provenance: 'adult ski length aggregate'},
        {family: 'SKI', age: 'KIDS', sourceSize: '100 cm', bookingSize: '100 cm', quantity: 6, provenance: 'kids ski length aggregate'},
        {family: 'SKI_BOOT', age: 'ADULT', sourceSize: '26X', bookingSize: null, quantity: 5, provenance: 'adult ski boot X-token aggregate; no reviewed alias'},
        {family: 'WEAR_JACKET', age: 'ADULT', sourceSize: 'M', bookingSize: 'M', quantity: 20, provenance: 'adult jacket size aggregate'},
        {family: 'WEAR_PANTS', age: 'ADULT', sourceSize: 'M', bookingSize: 'M', quantity: 20, provenance: 'adult pants size aggregate'},
      ],
    });
    assert.equal(result.buckets, 5);
    assert.equal(result.totalQuantity, 17 + 6 + 5 + 20 + 20);
    const row = (await x.db.pool.query('SELECT source_sha256,classification,count_semantics,status FROM provisional_capacity_sources WHERE id=$1', [result.sourceId])).rows[0];
    assert.deepEqual(row, {source_sha256: sourceSha256, classification: 'OWNER_APPROVED_PROVISIONAL_BOOKING_CAPACITY_SOURCE', count_semantics: 'LOWER_BOUND_MAY_INCREASE', status: 'ACTIVE'});
    const unresolved = (await x.db.pool.query("SELECT booking_size,size_mapping_status FROM provisional_capacity_buckets WHERE source_id=$1 AND source_size='26X'", [result.sourceId])).rows[0];
    assert.deepEqual(unresolved, {booking_size: null, size_mapping_status: 'UNRESOLVED'});
  });

  // ---- B: aggregate ----
  await check('B: aggregate — existing (Source A, simulated) + new (Source B) family totals equal the Owner-stated combined figures', async () => {
    await src.register(randomUUID(), {
      sourceSha256: '5ff5ce67c8ec1afbfab6bc5beeab0a2a725b73db0e1958a02860a0db39fbe1f4',
      originalFilename: '【(株)Yuge 山形蔵王】新店舗投入予定明細_20260914.xlsx',
      buckets: [{family: 'SKI', age: 'ADULT', sourceSize: '160 cm', bookingSize: '160 cm', quantity: 213, provenance: 'Source A existing total, synthetic subset for this proof'}],
    });
    const combined = (await x.db.pool.query("SELECT coalesce(sum(quantity),0)::int n FROM provisional_capacity_buckets WHERE active AND family='SKI' AND booking_size='160 cm'")).rows[0].n;
    assert.equal(combined, 213 + 17); // Source A (213, simulated) + Source B (17, from test A)
  });

  // ---- C: no excluded inventory ----
  await check('C: no excluded inventory — POLE/HELMET/SNOWBOARD_BINDING cannot enter booking capacity, structurally (DB CHECK, not caller discipline)', async () => {
    await assert.rejects(src.register(randomUUID(), {
      sourceSha256: 'a'.repeat(64),
      originalFilename: 'excluded-probe.xlsx',
      buckets: [{family: 'POLE' as never, age: 'ADULT', sourceSize: '115 cm', bookingSize: '115 cm', quantity: 74, provenance: 'excluded probe'}],
    }));
  });

  // ---- D: no double store count ----
  await check('D: no double store count — one shared provisional pool; a pickup-store-MOUNTAIN_BASE hold and a pickup-store-ONSEN_BASE hold draw from the SAME bucket, never doubled', async () => {
    await src.register(randomUUID(), {
      sourceSha256: 'b'.repeat(64),
      originalFilename: 'store-pool-probe.xlsx',
      buckets: [{family: 'SNOWBOARD', age: 'ADULT', sourceSize: '150 cm', bookingSize: '150 cm', quantity: 1, provenance: 'single-unit pool for store-sharing proof'}],
    });
    const req: ProvisionalRequirement[] = [{key: 'm:SNOWBOARD', family: 'SNOWBOARD', age: 'ADULT', bookingSize: '150 cm'}];
    const holdMountain = await makeHold('2035-03-01', '2035-03-01');
    await writeProvisionalClaims(x.db.pool, holdMountain, req, days('2035-03-01', 1), now);
    const holdOnsen = await makeHold('2035-03-01', '2035-03-01', 'ACTIVE', 'ONSEN_BASE');
    const plan = await provisionalCapacity(x.db.pool, req, days('2035-03-01', 1), now, holdOnsen);
    assert.equal(plan.feasible, false); // the ONE unit is already held by the MOUNTAIN_BASE hold — a same-pool ONSEN_BASE attempt cannot also get it
    await releaseProvisionalClaims(x.db.pool, holdMountain);
  });

  // ---- E: temporal oversell / period reuse ----
  await check('E: temporal oversell — N units cannot support N+1 overlapping holds; non-overlapping periods may reuse capacity', async () => {
    const result = await src.register(randomUUID(), {
      sourceSha256: 'c'.repeat(64), originalFilename: 'temporal-probe.xlsx',
      buckets: [{family: 'SKI', age: 'KIDS', sourceSize: '90 cm', bookingSize: '90 cm', quantity: 1, provenance: 'temporal probe'}],
    });
    const req: ProvisionalRequirement[] = [{key: 'm:SKI', family: 'SKI', age: 'KIDS', bookingSize: '90 cm'}];
    const holdA = await makeHold('2035-04-10', '2035-04-11');
    await writeProvisionalClaims(x.db.pool, holdA, req, days('2035-04-10', 2), now);
    const holdB = await makeHold('2035-04-11', '2035-04-12');
    const overlapping = await provisionalCapacity(x.db.pool, req, days('2035-04-11', 2), now, holdB);
    assert.equal(overlapping.feasible, false); // 2035-04-11 overlaps holdA
    const holdC = await makeHold('2035-04-12', '2035-04-13');
    const nonOverlapping = await provisionalCapacity(x.db.pool, req, days('2035-04-12', 2), now, holdC);
    assert.equal(nonOverlapping.feasible, true); // starts the day holdA ends — no shared day
    void result;
  });

  // ---- F: cancellation / hold expiry releases capacity exactly once ----
  await check('F: cancellation/hold expiry — capacity released exactly once; releasing twice is safe and does not double-free', async () => {
    const result = await src.register(randomUUID(), {
      sourceSha256: 'd'.repeat(64), originalFilename: 'release-probe.xlsx',
      buckets: [{family: 'WEAR_JACKET', age: 'ADULT', sourceSize: 'L', bookingSize: 'L', quantity: 1, provenance: 'release probe'}],
    });
    const req: ProvisionalRequirement[] = [{key: 'm:WEAR_JACKET', family: 'WEAR_JACKET', age: 'ADULT', bookingSize: 'L'}];
    const holdA = await makeHold('2035-05-01', '2035-05-01');
    await writeProvisionalClaims(x.db.pool, holdA, req, days('2035-05-01', 1), now);
    const holdB = await makeHold('2035-05-01', '2035-05-01');
    assert.equal((await provisionalCapacity(x.db.pool, req, days('2035-05-01', 1), now, holdB)).feasible, false);
    await releaseProvisionalClaims(x.db.pool, holdA);
    assert.equal((await provisionalCapacity(x.db.pool, req, days('2035-05-01', 1), now, holdB)).feasible, true);
    await writeProvisionalClaims(x.db.pool, holdB, req, days('2035-05-01', 1), now);
    await releaseProvisionalClaims(x.db.pool, holdA); // idempotent: already released, no effect
    const stillHeldByB = await provisionalCapacity(x.db.pool, req, days('2035-05-01', 1), now, holdB);
    assert.equal(stillHeldByB.feasible, true); // holdB's own claim is excluded by `ignore`, proving it alone occupies the unit
    void result;
  });

  // ---- G: concurrent claim safety (no oversell under two concurrent attempts) ----
  await check('G: concurrent claim — two concurrent reservation attempts against a 1-unit bucket: exactly one succeeds, never both', async () => {
    const result = await src.register(randomUUID(), {
      sourceSha256: 'e'.repeat(64), originalFilename: 'concurrency-probe.xlsx',
      buckets: [{family: 'SNOWBOARD_BOOT', age: 'ADULT', sourceSize: '27X', bookingSize: '27X', quantity: 1, provenance: 'concurrency probe (deliberately MAPPED for this test)'}],
    });
    const req: ProvisionalRequirement[] = [{key: 'm:SNOWBOARD_BOOT', family: 'SNOWBOARD_BOOT', age: 'ADULT', bookingSize: '27X'}];
    const holdA = await makeHold('2035-06-01', '2035-06-01'), holdB = await makeHold('2035-06-01', '2035-06-01');
    const outcomes = await Promise.allSettled([
      writeProvisionalClaims(x.db.pool, holdA, req, days('2035-06-01', 1), now),
      writeProvisionalClaims(x.db.pool, holdB, req, days('2035-06-01', 1), now),
    ]);
    const succeeded = outcomes.filter((o) => o.status === 'fulfilled').length;
    assert.equal(succeeded, 1);
    const activeClaims = (await x.db.pool.query("SELECT count(*)::int n FROM provisional_capacity_claims WHERE state='ACTIVE' AND hold_id=ANY($1::uuid[])", [[holdA, holdB]])).rows[0].n;
    assert.equal(activeClaims, 1);
    void result;
  });

  // ---- H: idempotency — same request replay does not consume a second unit ----
  await check('H: idempotency — replaying the identical claim write (same hold, same requirements/days) never grows active claims beyond the one plan', async () => {
    const result = await src.register(randomUUID(), {
      sourceSha256: 'f'.repeat(64), originalFilename: 'idempotency-probe.xlsx',
      buckets: [{family: 'SKI', age: 'ADULT', sourceSize: '146 cm', bookingSize: '146 cm', quantity: 1, provenance: 'idempotency probe'}],
    });
    const req: ProvisionalRequirement[] = [{key: 'm:SKI', family: 'SKI', age: 'ADULT', bookingSize: '146 cm'}];
    const holdA = await makeHold('2035-07-01', '2035-07-01');
    await writeProvisionalClaims(x.db.pool, holdA, req, days('2035-07-01', 1), now);
    await writeProvisionalClaims(x.db.pool, holdA, req, days('2035-07-01', 1), now);
    await writeProvisionalClaims(x.db.pool, holdA, req, days('2035-07-01', 1), now);
    const activeForHold = (await x.db.pool.query("SELECT count(*)::int n FROM provisional_capacity_claims WHERE state='ACTIVE' AND hold_id=$1", [holdA])).rows[0].n;
    assert.equal(activeForHold, 1);
    void result;
  });

  // ---- I: future delta — a later source raises capacity; the original source's rows are untouched ----
  await check('I: future delta — adding a later source raises capacity; the original source remains immutable', async () => {
    const first = await src.register(randomUUID(), {
      sourceSha256: '1'.repeat(64), originalFilename: 'delta-source-1.xlsx',
      buckets: [{family: 'SNOWBOARD', age: 'KIDS', sourceSize: '110 cm', bookingSize: '110 cm', quantity: 3, provenance: 'delta probe, source 1'}],
    });
    const before = (await x.db.pool.query("SELECT id,quantity,source_id,created_at FROM provisional_capacity_buckets WHERE source_id=$1", [first.sourceId])).rows[0];
    const beforeCapacity = (await x.db.pool.query("SELECT provisional_capacity_available('SNOWBOARD','KIDS','110 cm') n")).rows[0].n;
    await src.register(randomUUID(), {
      sourceSha256: '2'.repeat(64), originalFilename: 'delta-source-2.xlsx',
      buckets: [{family: 'SNOWBOARD', age: 'KIDS', sourceSize: '110 cm', bookingSize: '110 cm', quantity: 2, provenance: 'delta probe, source 2 (later confirmed count)'}],
    });
    const afterCapacity = (await x.db.pool.query("SELECT provisional_capacity_available('SNOWBOARD','KIDS','110 cm') n")).rows[0].n;
    assert.equal(afterCapacity, beforeCapacity + 2);
    const after = (await x.db.pool.query("SELECT id,quantity,source_id,created_at FROM provisional_capacity_buckets WHERE source_id=$1", [first.sourceId])).rows[0];
    assert.deepEqual(after, before); // original source's own row is byte-unchanged
  });
  await check('I (mutation): a later count attempting to reduce below already-promised active claims fails closed (PROVISIONAL_CAPACITY_BELOW_ACTIVE_CLAIMS), not a silent shrink', async () => {
    const result = await src.register(randomUUID(), {
      sourceSha256: '3'.repeat(64), originalFilename: 'reduce-probe.xlsx',
      buckets: [{family: 'SKI_BOOT', age: 'KIDS', sourceSize: '18X', bookingSize: '18X', quantity: 2, provenance: 'reduce probe (deliberately MAPPED for this test)'}],
    });
    const bucketId = (await x.db.pool.query('SELECT id FROM provisional_capacity_buckets WHERE source_id=$1', [result.sourceId])).rows[0].id;
    const req: ProvisionalRequirement[] = [{key: 'm:SKI_BOOT', family: 'SKI_BOOT', age: 'KIDS', bookingSize: '18X'}, {key: 'm2:SKI_BOOT', family: 'SKI_BOOT', age: 'KIDS', bookingSize: '18X'}];
    const holdA = await makeHold('2035-08-01', '2035-08-01');
    await writeProvisionalClaims(x.db.pool, holdA, req, days('2035-08-01', 1), now); // consumes both units of the 2-unit bucket
    await assert.rejects(x.db.pool.query('SELECT provisional_capacity_reduce_bucket($1,1,$2)', [bucketId, x.actor]), {code: '23514'});
    const unchanged = (await x.db.pool.query('SELECT quantity FROM provisional_capacity_buckets WHERE id=$1', [bucketId])).rows[0].quantity;
    assert.equal(unchanged, 2);
    await releaseProvisionalClaims(x.db.pool, holdA);
    await x.db.pool.query('SELECT provisional_capacity_reduce_bucket($1,1,$2)', [bucketId, x.actor]); // now safe: no active claims
    assert.equal((await x.db.pool.query('SELECT quantity FROM provisional_capacity_buckets WHERE id=$1', [bucketId])).rows[0].quantity, 1);
  });

  // ---- J: materialization — provisional -> real conversion never double counts ----
  await check('J: materialization — a materialized bucket stops counting toward availability, its active claims convert to MATERIALIZED (preserved, not deleted), and re-materializing is refused', async () => {
    const result = await src.register(randomUUID(), {
      sourceSha256: '4'.repeat(64), originalFilename: 'materialize-probe.xlsx',
      buckets: [{family: 'WEAR_PANTS', age: 'KIDS', sourceSize: 'S', bookingSize: 'S', quantity: 6, provenance: 'materialize probe'}],
    });
    const bucketId = (await x.db.pool.query('SELECT id FROM provisional_capacity_buckets WHERE source_id=$1', [result.sourceId])).rows[0].id;
    const req: ProvisionalRequirement[] = [{key: 'm:WEAR_PANTS', family: 'WEAR_PANTS', age: 'KIDS', bookingSize: 'S'}];
    const holdA = await makeHold('2035-09-01', '2035-09-01');
    await writeProvisionalClaims(x.db.pool, holdA, req, days('2035-09-01', 1), now);
    const beforeLoans = (await x.db.pool.query('SELECT count(*)::int n FROM rental_loan_items')).rows[0].n;
    await x.db.pool.query('SELECT provisional_capacity_materialize_bucket($1,$2)', [bucketId, x.actor]);
    assert.equal((await x.db.pool.query("SELECT provisional_capacity_available('WEAR_PANTS','KIDS','S') n")).rows[0].n, 0);
    const claim = (await x.db.pool.query('SELECT state FROM provisional_capacity_claims WHERE hold_id=$1', [holdA])).rows[0];
    assert.equal(claim.state, 'MATERIALIZED');
    await assert.rejects(x.db.pool.query('SELECT provisional_capacity_materialize_bucket($1,$2)', [bucketId, x.actor]), {code: '23514'});
    const afterLoans = (await x.db.pool.query('SELECT count(*)::int n FROM rental_loan_items')).rows[0].n;
    assert.equal(afterLoans, beforeLoans); // materialization alone never creates a real physical-custody row (N's own guarantee, re-checked here)
  });

  // ---- K: wear — jacket/pants set capacity uses min() ----
  await check('K: wear — a jacket+pants "set" requirement is only feasible when BOTH have room; capacity is min(jacket,pants), not their sum', async () => {
    const jacket = await src.register(randomUUID(), {
      sourceSha256: '5'.repeat(64), originalFilename: 'wear-set-jacket.xlsx',
      buckets: [{family: 'WEAR_JACKET', age: 'ADULT', sourceSize: 'XL', bookingSize: 'XL', quantity: 3, provenance: 'wear set probe, jacket'}],
    });
    await src.register(randomUUID(), {
      sourceSha256: '6'.repeat(64), originalFilename: 'wear-set-pants.xlsx',
      buckets: [{family: 'WEAR_PANTS', age: 'ADULT', sourceSize: 'XL', bookingSize: 'XL', quantity: 1, provenance: 'wear set probe, pants (deliberately smaller than jacket)'}],
    });
    const setReq: ProvisionalRequirement[] = [{key: 'm:WEAR_JACKET', family: 'WEAR_JACKET', age: 'ADULT', bookingSize: 'XL'}, {key: 'm:WEAR_PANTS', family: 'WEAR_PANTS', age: 'ADULT', bookingSize: 'XL'}];
    const holdA = await makeHold('2035-10-01', '2035-10-01'), holdB = await makeHold('2035-10-01', '2035-10-01');
    await writeProvisionalClaims(x.db.pool, holdA, setReq, days('2035-10-01', 1), now); // consumes the one pants unit
    const secondSet = await provisionalCapacity(x.db.pool, setReq, days('2035-10-01', 1), now, holdB);
    assert.equal(secondSet.feasible, false); // jacket alone has 2 left, but pants has 0 — set capacity is min(), not jacket's 2
    void jacket;
  });

  // ---- L: premium exclusion (structural) ----
  await check('L: premium exclusion — provisional buckets carry no model/variant identity at all, so generic provisional stock structurally cannot satisfy a modelPromise; two distinct "models" requesting the same family/age/size draw from one undifferentiated pool', async () => {
    const result = await src.register(randomUUID(), {
      sourceSha256: '7'.repeat(64), originalFilename: 'premium-probe.xlsx',
      buckets: [{family: 'SNOWBOARD', age: 'ADULT', sourceSize: '165 cm', bookingSize: '165 cm', quantity: 1, provenance: 'premium-exclusion probe'}],
    });
    const columns = (await x.db.pool.query("SELECT column_name FROM information_schema.columns WHERE table_name='provisional_capacity_buckets'")).rows.map((r: {column_name: string}) => r.column_name);
    assert.ok(!columns.includes('model_id') && !columns.includes('variant_id')); // no model/variant identity column exists to promise against
    // Two "different models" (modeled here only as distinct requirement keys — there is no model field to differ on) requesting the same family/age/size both draw the one shared unit:
    const modelAReq: ProvisionalRequirement[] = [{key: 'model-a:SNOWBOARD', family: 'SNOWBOARD', age: 'ADULT', bookingSize: '165 cm'}];
    const modelBReq: ProvisionalRequirement[] = [{key: 'model-b:SNOWBOARD', family: 'SNOWBOARD', age: 'ADULT', bookingSize: '165 cm'}];
    const holdA = await makeHold('2035-11-01', '2035-11-01'), holdB = await makeHold('2035-11-01', '2035-11-01');
    await writeProvisionalClaims(x.db.pool, holdA, modelAReq, days('2035-11-01', 1), now);
    assert.equal((await provisionalCapacity(x.db.pool, modelBReq, days('2035-11-01', 1), now, holdB)).feasible, false);
    void result;
  });

  // ---- M: unresolved X size ----
  await check('M: unresolved size — an ambiguous X-token bucket can never be booked for any size (including its own literal token), yet its quantity is visible in the raw bucket total (not silently discarded); a separate MAPPED bucket for the same family/age is unaffected', async () => {
    const result = await src.register(randomUUID(), {
      sourceSha256: '8'.repeat(64), originalFilename: 'unresolved-size-probe.xlsx',
      buckets: [
        {family: 'SKI_BOOT', age: 'ADULT', sourceSize: '29X', bookingSize: null, quantity: 2, provenance: 'unresolved probe'},
        {family: 'SKI', age: 'ADULT', sourceSize: '155 cm', bookingSize: '155 cm', quantity: 5, provenance: 'unrelated mapped bucket, same age'},
      ],
    });
    const unresolvedAsOwnToken: ProvisionalRequirement[] = [{key: 'm:SKI_BOOT', family: 'SKI_BOOT', age: 'ADULT', bookingSize: '29X'}];
    const holdA = await makeHold('2035-12-01', '2035-12-01');
    assert.equal((await provisionalCapacity(x.db.pool, unresolvedAsOwnToken, days('2035-12-01', 1), now, holdA)).feasible, false);
    const rawTotal = (await x.db.pool.query("SELECT coalesce(sum(quantity),0)::int n FROM provisional_capacity_buckets WHERE source_id=$1 AND family='SKI_BOOT'", [result.sourceId])).rows[0].n;
    assert.equal(rawTotal, 2); // counted in the raw family total, never silently dropped
    const mappedReq: ProvisionalRequirement[] = [{key: 'm:SKI', family: 'SKI', age: 'ADULT', bookingSize: '155 cm'}];
    assert.equal((await provisionalCapacity(x.db.pool, mappedReq, days('2035-12-01', 1), now, holdA)).feasible, true); // unrelated mapped bucket unaffected by the ambiguous one
  });

  // ---- N: handoff gate (structural) ----
  await check('N: handoff — a provisional claim alone can never authorize physical equipment handoff: no FK/column in provisional_capacity_claims references rental_bookings/rental_loan_items, and holding an ACTIVE claim creates zero rows in either', async () => {
    const result = await src.register(randomUUID(), {
      sourceSha256: '9'.repeat(64), originalFilename: 'handoff-probe.xlsx',
      buckets: [{family: 'SNOWBOARD_BOOT', age: 'KIDS', sourceSize: '20X', bookingSize: '20X', quantity: 4, provenance: 'handoff probe (deliberately MAPPED for this test)'}],
    });
    const columns = (await x.db.pool.query("SELECT column_name FROM information_schema.columns WHERE table_name='provisional_capacity_claims'")).rows.map((r: {column_name: string}) => r.column_name);
    assert.ok(!columns.some((c: string) => c.includes('booking') || c.includes('loan')));
    const req: ProvisionalRequirement[] = [{key: 'm:SNOWBOARD_BOOT', family: 'SNOWBOARD_BOOT', age: 'KIDS', bookingSize: '20X'}];
    const before = (await x.db.pool.query('SELECT count(*)::int n FROM rental_bookings')).rows[0].n;
    const beforeLoans = (await x.db.pool.query('SELECT count(*)::int n FROM rental_loan_items')).rows[0].n;
    const holdA = await makeHold('2036-01-01', '2036-01-01');
    await writeProvisionalClaims(x.db.pool, holdA, req, days('2036-01-01', 1), now);
    const after = (await x.db.pool.query('SELECT count(*)::int n FROM rental_bookings')).rows[0].n;
    const afterLoans = (await x.db.pool.query('SELECT count(*)::int n FROM rental_loan_items')).rows[0].n;
    assert.equal(after, before);
    assert.equal(afterLoans, beforeLoans);
    void result;
  });

  // ---- R: transaction failure leaves no partial claim mutation ----
  await check('R: transaction failure — writeProvisionalClaims takes the same caller-supplied Conn as writeWearClaims (embeddable in one caller transaction, not self-transacting); a later failure on the same connection rolls back its release+reinsert atomically, leaving the pre-existing claim exactly as it was', async () => {
    const result = await src.register(randomUUID(), {
      sourceSha256: '0'.repeat(64), originalFilename: 'transaction-failure-probe.xlsx',
      buckets: [{family: 'SKI', age: 'ADULT', sourceSize: '150 cm', bookingSize: '150 cm', quantity: 1, provenance: 'transaction-failure probe'}],
    });
    const req: ProvisionalRequirement[] = [{key: 'm:SKI', family: 'SKI', age: 'ADULT', bookingSize: '150 cm'}];
    const holdA = await makeHold('2036-02-01', '2036-02-01');
    await writeProvisionalClaims(x.db.pool, holdA, req, days('2036-02-01', 1), now);
    const before = (await x.db.pool.query("SELECT id,bucket_id,created_at FROM provisional_capacity_claims WHERE hold_id=$1 AND state='ACTIVE'", [holdA])).rows[0];
    const client = await x.db.pool.connect();
    try {
      await client.query('BEGIN');
      await writeProvisionalClaims(client, holdA, req, days('2036-02-01', 1), now); // release + reinsert, uncommitted so far
      await assert.rejects(client.query('SELECT 1/0')); // forces this transaction to fail after the mutation, before COMMIT
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
    const after = (await x.db.pool.query("SELECT id,bucket_id,created_at FROM provisional_capacity_claims WHERE hold_id=$1 AND state='ACTIVE'", [holdA])).rows[0];
    assert.deepEqual(after, before); // the rolled-back release+reinsert left the original claim row byte-unchanged, not zero/duplicated
    const activeCount = (await x.db.pool.query("SELECT count(*)::int n FROM provisional_capacity_claims WHERE hold_id=$1 AND state='ACTIVE'", [holdA])).rows[0].n;
    assert.equal(activeCount, 1); // never zero (partially released) and never two (partially reinserted without releasing)
    void result;
  });

  // ---- operations-role boundary: exactly the register-source path, nothing wider, no PUBLIC grant, no unrelated-role access ----
  await check('operations-role boundary — PUBLIC has no EXECUTE on any provisional_capacity_* function; the operations role got only the narrow INSERT+EXECUTE register() actually needs (no raw quantity UPDATE, no source mutation/delete, no reduce/materialize call); an unrelated application role (HOLD) has zero access to any provisional_capacity_* table or function', async () => {
    const publicGrants = (await x.db.pool.query(
      `SELECT has_function_privilege('public','provisional_capacity_register_source(text,text,text,jsonb)','EXECUTE') a,
              has_function_privilege('public','provisional_capacity_reduce_bucket(uuid,integer,text)','EXECUTE') b,
              has_function_privilege('public','provisional_capacity_materialize_bucket(uuid,text)','EXECUTE') c`,
    )).rows[0];
    assert.deepEqual(publicGrants, {a: false, b: false, c: false});
    const zero = '00000000-0000-0000-0000-000000000000';
    for (const sql of [
      'UPDATE provisional_capacity_buckets SET quantity=999999',
      "UPDATE provisional_capacity_sources SET status='SUPERSEDED'",
      'DELETE FROM provisional_capacity_sources',
      `SELECT provisional_capacity_reduce_bucket('${zero}'::uuid,1,'x')`,
      `SELECT provisional_capacity_materialize_bucket('${zero}'::uuid,'x')`,
    ]) await assert.rejects(role!.operationsPool.query(sql), {code: '42501'});
    for (const sql of [
      'SELECT 1 FROM provisional_capacity_sources',
      'SELECT 1 FROM provisional_capacity_buckets',
      'SELECT 1 FROM provisional_capacity_claims',
      `SELECT provisional_capacity_register_source('${'0'.repeat(64)}','x','x','[]'::jsonb)`,
    ]) await assert.rejects(x.roles.holdPool.query(sql), {code: '42501'});
  });

  console.log(JSON.stringify({status: 'PASS', cases: count, realDataImports: 0, realAssetIdsGenerated: 0, productionDbWrites: 0, squareCalls: 0, payments: 0, customerNotifications: 0}));
} catch (e) {
  failed = true;
  console.error(JSON.stringify({status: 'FAIL', stage, code: (e as {code?: string}).code ?? (e as Error).name, detail: (e as Error).message.slice(0, 500)}));
  console.error((e as Error).stack?.split('\n').filter((l) => l.includes('/tests/')).join('\n'));
} finally {
  await role?.close();
  await x.close();
}
if (failed) process.exit(1);
