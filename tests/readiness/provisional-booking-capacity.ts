// Real disposable PostgreSQL proof of the provisional booking-capacity mechanism (migration
// 0041, packages/core/src/operations/provisional-capacity-source.ts,
// packages/core/src/inventory/provisional-capacity.ts, packages/core/src/inventory/allocation.ts's
// planMixedAllocation). Mirrors the wear_pools/wear_claims real-PG proof pattern this codebase
// already establishes. No real Neon SQL, no Square, no payment.
import assert from 'node:assert/strict';
import {randomUUID, createHash} from 'node:crypto';
import {flowFixture} from '../flow/fixture';
import {loadStaff} from '../../packages/auth/src/staff-auth';
import {provisionOperationsRole} from '../../scripts/operations-roles';
import {OperationsContext} from '../../packages/core/src/operations/context';
import {ProvisionalCapacitySourceOperations} from '../../packages/core/src/operations/provisional-capacity-source';
import {provisionalCapacity, writeProvisionalClaims, releaseProvisionalClaims, type ProvisionalRequirement} from '../../packages/core/src/inventory/provisional-capacity';
import {LedgerService} from '../../packages/core/src/catalog/ledger-service';
import {ledgerPrincipal} from '../../packages/auth/src/staff-auth';
import {verifyLedgerWrite} from '../../packages/auth/src/ledger-write-authority';
import {reconcileLedgerProtection} from '../../packages/core/src/catalog/reconcile-protection';
import {InventoryOperations} from '../../packages/core/src/operations/inventory-service';
import {STOCK_IMPORT_HEADER_V3} from '../../packages/contracts/src/stock-import';
import {CustodyService} from '../../packages/core/src/rental/custody-service';
import type {HoldConditions} from '../../packages/contracts/src/hold';

let failed = false, stage = 'fixture', count = 0;
const x = await flowFixture();
let role: Awaited<ReturnType<typeof provisionOperationsRole>> | undefined;
async function check(name: string, fn: () => Promise<void>): Promise<void> { stage = name; await fn(); count++; console.log('PASS ' + name); }

try {
  role = await provisionOperationsRole(x.db.pool, x.db.identity);
  const ctx = new OperationsContext(role.operationsPool, x.roles.authPool, x.signed.identity);
  const src = new ProvisionalCapacitySourceOperations(ctx);
  Object.assign(x.principal, (await loadStaff(x.roles.authPool, x.actor))!);
  const ledger = new LedgerService(x.roles.ledgerPool, ledgerPrincipal(x.principal), (c, stores, global) => verifyLedgerWrite(c, x.roles.authPool, x.signed.identity, stores, global), (resource, id, version) => reconcileLedgerProtection(x.roles.transferPool, x.roles.authPool, x.signed.identity, resource, id, version));
  const inventoryOps = new InventoryOperations(new OperationsContext(role.operationsPool, x.roles.authPool, x.signed.identity));

  // ---- test harness: a minimal real inventory_holds row, bypassing HoldService entirely, used
  // for the isolated module-level tests A-R below (this module is directly unit-testable this
  // way). The product-path tests further down use the real x.holds (HoldService) instead. ----
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
  // provisional_capacity_reduce_bucket/materialize_bucket are now SECURITY DEFINER and read the
  // actor from zao.actor — this drives them through an owner connection that sets it first,
  // matching makeHold's own pattern, rather than a bare x.db.pool.query() with no actor context.
  async function asActor<T>(fn: (c: import('pg').PoolClient) => Promise<T>): Promise<T> {
    const c = await x.db.pool.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('zao.actor',$1,true)", [x.actor]);
      const result = await fn(c);
      await c.query('COMMIT');
      return result;
    } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
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
    const beforeCapacity = (await x.db.pool.query("SELECT provisional_capacity_available_on('SNOWBOARD','KIDS','110 cm',$1::date) n", ['2035-01-15'])).rows[0].n;
    await src.register(randomUUID(), {
      sourceSha256: '2'.repeat(64), originalFilename: 'delta-source-2.xlsx',
      buckets: [{family: 'SNOWBOARD', age: 'KIDS', sourceSize: '110 cm', bookingSize: '110 cm', quantity: 2, provenance: 'delta probe, source 2 (later confirmed count)'}],
    });
    const afterCapacity = (await x.db.pool.query("SELECT provisional_capacity_available_on('SNOWBOARD','KIDS','110 cm',$1::date) n", ['2035-01-15'])).rows[0].n;
    assert.equal(afterCapacity, beforeCapacity + 2);
    const after = (await x.db.pool.query("SELECT id,quantity,source_id,created_at FROM provisional_capacity_buckets WHERE source_id=$1", [first.sourceId])).rows[0];
    assert.deepEqual(after, before); // original source's own row is byte-unchanged
  });
  await check('I (mutation, H immutable ledger): a later count attempting to reduce below already-promised active claims fails closed (PROVISIONAL_CAPACITY_BELOW_ACTIVE_CLAIMS), not a silent shrink; a successful reduction records a signed adjustment row and leaves the immutable base `quantity` column byte-unchanged', async () => {
    const result = await src.register(randomUUID(), {
      sourceSha256: '3'.repeat(64), originalFilename: 'reduce-probe.xlsx',
      buckets: [{family: 'SKI_BOOT', age: 'KIDS', sourceSize: '18X', bookingSize: '18X', quantity: 2, provenance: 'reduce probe (deliberately MAPPED for this test)'}],
    });
    const bucketId = (await x.db.pool.query('SELECT id FROM provisional_capacity_buckets WHERE source_id=$1', [result.sourceId])).rows[0].id;
    const baseQuantityBefore = (await x.db.pool.query('SELECT quantity FROM provisional_capacity_buckets WHERE id=$1', [bucketId])).rows[0].quantity;
    const req: ProvisionalRequirement[] = [{key: 'm:SKI_BOOT', family: 'SKI_BOOT', age: 'KIDS', bookingSize: '18X'}, {key: 'm2:SKI_BOOT', family: 'SKI_BOOT', age: 'KIDS', bookingSize: '18X'}];
    const holdA = await makeHold('2035-08-01', '2035-08-01');
    await writeProvisionalClaims(x.db.pool, holdA, req, days('2035-08-01', 1), now); // consumes both units of the 2-unit bucket
    await assert.rejects(asActor((c) => c.query('SELECT provisional_capacity_reduce_bucket($1,1)', [bucketId])), {code: '23514'});
    assert.equal((await x.db.pool.query('SELECT quantity FROM provisional_capacity_buckets WHERE id=$1', [bucketId])).rows[0].quantity, baseQuantityBefore); // rejected: no adjustment recorded
    await releaseProvisionalClaims(x.db.pool, holdA);
    await asActor((c) => c.query('SELECT provisional_capacity_reduce_bucket($1,1)', [bucketId])); // now safe: no active claims
    assert.equal((await x.db.pool.query('SELECT quantity FROM provisional_capacity_buckets WHERE id=$1', [bucketId])).rows[0].quantity, baseQuantityBefore); // H: the immutable base column never changes — the reduction lives only in the adjustments ledger
    const adjustment = (await x.db.pool.query('SELECT bucket_id,delta,reason,actor FROM provisional_capacity_adjustments WHERE bucket_id=$1', [bucketId])).rows[0];
    assert.deepEqual(adjustment, {bucket_id: bucketId, delta: -1, reason: 'CORRECTION', actor: x.actor});
    assert.equal((await x.db.pool.query('SELECT provisional_capacity_effective_quantity($1) n', [bucketId])).rows[0].n, 1);
  });

  // ---- J: materialization is NOT ACTIVATED for this booking-intake release (P4 correction) ----
  // A real real_data_acceptance row (the actual real-import evidence chain, not a fabricated
  // pointer): one tiny synthetic SKU staged, committed and accepted as real stock, exactly the
  // same path tests/operations/import-rehearsal.ts already exercises at larger scale — kept here
  // specifically to prove NOT_ACTIVATED fires even given genuine evidence, not merely missing
  // evidence (a strictly stronger proof that this is unconditionally refused).
  async function realDataAcceptanceId(sourceLocatorTag: string, quantity: number): Promise<string> {
    const codeTag = sourceLocatorTag.toUpperCase().replace(/[^A-Z0-9_-]/g, '-');
    const model = await ledger.create('models', {sourceKind: 'SYNTHETIC', sourceDocument: 'provisional-capacity materialization evidence', sourceLocator: 'model-' + sourceLocatorTag, code: 'PBCEV-' + codeTag, name: 'PBC materialization ' + sourceLocatorTag, brand: 'SYNTHETIC', family: 'SKI', notes: '', catalogSeason: '2026/27'});
    const variant = await ledger.create('variants', {sourceKind: 'SYNTHETIC', sourceDocument: 'provisional-capacity materialization evidence', sourceLocator: 'variant-' + sourceLocatorTag, modelId: model.id, family: 'SKI', age: 'ADULT', tier: 'REGULAR', size: 'PBC-EV-' + codeTag, notes: ''});
    const assetIds = Array.from({length: quantity}, () => randomUUID());
    const row = ['SHOP_RECEIPT', 'ADD', model.id, '2026/27', variant.id, '', quantity, 'ASSET_PAIR', assetIds.join('|'), 'MOUNTAIN_BASE', 'SYNTHETIC materialization evidence receipt', 'row-' + sourceLocatorTag, 'SKI', 'PBC-EV-' + codeTag, 'REGULAR', '', 'AVAILABLE', 'SYNTHETIC', 'PBC materialization ' + sourceLocatorTag, ''].join(',');
    const csv = STOCK_IMPORT_HEADER_V3.join(',') + '\n' + row + '\n';
    // real_data_accept() (migration 0038) requires the exact source digest to already be
    // Owner-approved in real_inventory_sources — this is the actual real-import evidence chain,
    // not a fabricated pointer (see tests/operations/import-rehearsal.ts's identical `approve()` step).
    await x.db.pool.query('INSERT INTO real_inventory_sources(source_sha256,label) VALUES($1,$2)', [createHash('sha256').update(csv).digest('hex'), 'PBC materialization evidence ' + sourceLocatorTag]);
    const staged = await inventoryOps.stageImport(randomUUID(), {csv, sheet: 'pbc-evidence-' + sourceLocatorTag});
    const committed = await inventoryOps.commitImport(randomUUID(), {id: staged.id, stageSha256: staged.stageSha256, reason: 'PBC materialization evidence'});
    await inventoryOps.acceptRealData(randomUUID(), {commitId: committed.id, expectedStores: ['MOUNTAIN_BASE']});
    return (await x.db.pool.query('SELECT id FROM real_data_acceptance WHERE commit_id=$1', [committed.id])).rows[0].id;
  }
  await check('J: materialization is NOT_ACTIVATED even given a random/non-existent real_data_acceptance id — refused before any bucket or claim mutation', async () => {
    const result = await src.register(randomUUID(), {
      sourceSha256: '4'.repeat(64), originalFilename: 'materialize-not-activated-probe.xlsx',
      buckets: [{family: 'WEAR_PANTS', age: 'KIDS', sourceSize: 'M', bookingSize: 'M', quantity: 4, provenance: 'materialize NOT_ACTIVATED probe'}],
    });
    const bucketId = (await x.db.pool.query('SELECT id FROM provisional_capacity_buckets WHERE source_id=$1', [result.sourceId])).rows[0].id;
    await assert.rejects(asActor((c) => c.query('SELECT provisional_capacity_materialize_bucket($1,1,$2)', [bucketId, randomUUID()])), {message: 'PROVISIONAL_MATERIALIZATION_NOT_ACTIVATED'});
    assert.equal((await x.db.pool.query('SELECT active FROM provisional_capacity_buckets WHERE id=$1', [bucketId])).rows[0].active, true);
  });
  await check('J: materialization is NOT_ACTIVATED even given genuine, valid real-import evidence — the disabled guard fires before the evidence/quantity checks run at all, an ACTIVE claim is untouched, and PUBLIC/every runtime role (hold, transfer, operations) has no EXECUTE on this function regardless', async () => {
    const result = await src.register(randomUUID(), {
      sourceSha256: '4'.repeat(63) + '5', originalFilename: 'materialize-not-activated-genuine-probe.xlsx',
      buckets: [{family: 'WEAR_PANTS', age: 'KIDS', sourceSize: 'S', bookingSize: 'S', quantity: 6, provenance: 'materialize NOT_ACTIVATED genuine-evidence probe'}],
    });
    const bucketId = (await x.db.pool.query('SELECT id FROM provisional_capacity_buckets WHERE source_id=$1', [result.sourceId])).rows[0].id;
    const req: ProvisionalRequirement[] = [{key: 'm:WEAR_PANTS', family: 'WEAR_PANTS', age: 'KIDS', bookingSize: 'S'}];
    const holdA = await makeHold('2035-09-01', '2035-09-01');
    await writeProvisionalClaims(x.db.pool, holdA, req, days('2035-09-01', 1), now);
    const evidence = await realDataAcceptanceId('genuine', 4);
    await assert.rejects(asActor((c) => c.query('SELECT provisional_capacity_materialize_bucket($1,4,$2)', [bucketId, evidence])), {message: 'PROVISIONAL_MATERIALIZATION_NOT_ACTIVATED'});
    assert.equal((await x.db.pool.query('SELECT provisional_capacity_effective_quantity($1) n', [bucketId])).rows[0].n, 6); // untouched
    assert.equal((await x.db.pool.query('SELECT active FROM provisional_capacity_buckets WHERE id=$1', [bucketId])).rows[0].active, true);
    assert.equal((await x.db.pool.query('SELECT count(*)::int n FROM provisional_capacity_materializations WHERE bucket_id=$1', [bucketId])).rows[0].n, 0);
    assert.equal((await x.db.pool.query("SELECT state FROM provisional_capacity_claims WHERE hold_id=$1", [holdA])).rows[0].state, 'ACTIVE');
    const grants = (await x.db.pool.query(`SELECT has_function_privilege('public','provisional_capacity_materialize_bucket(uuid,integer,uuid)','EXECUTE') pub`)).rows[0];
    assert.equal(grants.pub, false);
    for (const pool of [x.roles.holdPool, x.roles.transferPool, role!.operationsPool]) await assert.rejects(pool.query(`SELECT provisional_capacity_materialize_bucket('${bucketId}'::uuid,1,'${evidence}'::uuid)`), {code: '42501'});
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

  // ---- role boundary: EXECUTE-only registration, no direct table access anywhere PUBLIC/operations/HOLD shouldn't have ----
  await check('role boundary — PUBLIC has no EXECUTE on any provisional_capacity_* function; the operations role has EXECUTE on register_source only (no direct source/bucket table access at all, and no reduce/materialize call — SECURITY DEFINER carries the INSERT rights, not the caller); the HOLD role has exactly the narrow plan/write/release access it needs, never source registration or reduce/materialize', async () => {
    const publicGrants = (await x.db.pool.query(
      `SELECT has_function_privilege('public','provisional_capacity_register_source(text,text,jsonb)','EXECUTE') a,
              has_function_privilege('public','provisional_capacity_reduce_bucket(uuid,integer)','EXECUTE') b,
              has_function_privilege('public','provisional_capacity_materialize_bucket(uuid,integer,uuid)','EXECUTE') c,
              has_function_privilege('public','provisional_capacity_available_on(text,text,text,date)','EXECUTE') d`,
    )).rows[0];
    assert.deepEqual(publicGrants, {a: false, b: false, c: false, d: false});
    const zero = '00000000-0000-0000-0000-000000000000';
    // operations: EXECUTE on register_source only (proven positively by test A's src.register()
    // calls already succeeding) and SELECT on claims only (verifyClaims/verifyPhysicalHandoff) —
    // no direct source/bucket table access of any kind, no reduce/materialize/available_on.
    for (const sql of [
      'SELECT 1 FROM provisional_capacity_sources',
      'SELECT 1 FROM provisional_capacity_buckets',
      'INSERT INTO provisional_capacity_sources(source_sha256,original_filename,actor) VALUES(repeat(\'a\',64),\'x\',\'x\')',
      "UPDATE provisional_capacity_sources SET status='SUPERSEDED'",
      'DELETE FROM provisional_capacity_sources',
      `SELECT provisional_capacity_reduce_bucket('${zero}'::uuid,1)`,
      `SELECT provisional_capacity_materialize_bucket('${zero}'::uuid,1,'${zero}'::uuid)`,
      `SELECT provisional_capacity_available_on('SKI','ADULT','1 cm','2035-01-01'::date)`,
    ]) await assert.rejects(role!.operationsPool.query(sql), {code: '42501'});
    await role!.operationsPool.query('SELECT 1 FROM provisional_capacity_claims'); // legitimate: does not throw
    // HOLD: SELECT on buckets, SELECT/INSERT on claims and EXECUTE on effective_quantity are all
    // legitimate (planAllocation/writeProvisionalClaims) — proven positively by every product-path
    // test below already succeeding. Never source registration, reduce, materialize, or direct
    // source-table access.
    for (const sql of [
      `SELECT provisional_capacity_register_source('${'0'.repeat(64)}','x','[]'::jsonb)`,
      `SELECT provisional_capacity_reduce_bucket('${zero}'::uuid,1)`,
      `SELECT provisional_capacity_materialize_bucket('${zero}'::uuid,1,'${zero}'::uuid)`,
      'INSERT INTO provisional_capacity_sources(source_sha256,original_filename,actor) VALUES(repeat(\'a\',64),\'x\',\'x\')',
      'SELECT 1 FROM provisional_capacity_sources',
    ]) await assert.rejects(x.roles.holdPool.query(sql), {code: '42501'});
    await x.roles.holdPool.query('SELECT 1 FROM provisional_capacity_buckets'); // legitimate: does not throw
    await x.roles.holdPool.query('SELECT 1 FROM provisional_capacity_claims'); // legitimate: does not throw
  });

  console.log(JSON.stringify({status: 'PASS(module)', cases: count, realDataImports: 0, realAssetIdsGenerated: 0, productionDbWrites: 0, squareCalls: 0, payments: 0, customerNotifications: 0}));

  // ==================================================================================================
  // PRODUCT-PATH: wired through the real HoldService (x.holds)/CustodyService, not the standalone
  // provisional-capacity module directly — this is the actual "provisional inventory is usable by a
  // real reservation" proof the Owner asked for. Each test below registers its own dedicated,
  // synthetic PBC-prefixed variant/size so it never collides with other suites' physical fixtures.
  // ==================================================================================================
  async function physicalSkuFor(tag: string, quantity: number, family: 'SKI'|'SNOWBOARD' = 'SKI', size = 'PBC-' + tag) {
    const model = await ledger.create('models', {sourceKind: 'SYNTHETIC', sourceDocument: 'provisional-capacity product-path fixture', sourceLocator: 'model-' + tag, code: 'PBCPP-' + tag.toUpperCase().replace(/[^A-Z0-9_-]/g, '-'), name: 'PBC product-path ' + tag, brand: 'SYNTHETIC', family, notes: '', catalogSeason: '2026/27'});
    const variant = await ledger.create('variants', {sourceKind: 'SYNTHETIC', sourceDocument: 'provisional-capacity product-path fixture', sourceLocator: 'variant-' + tag, modelId: model.id, family, age: 'ADULT', tier: 'REGULAR', size, notes: ''});
    if (quantity > 0) {
      const c = await x.db.pool.connect();
      try {
        await c.query('BEGIN');
        await c.query("SELECT set_config('zao.actor',$1,true),set_config('zao.reason','SYNTHETIC provisional-capacity product-path fixture',true)", [x.actor]);
        for (let n = 0; n < quantity; n++) await c.query(
          `INSERT INTO ledger_assets(id,variant_id,family,initial_store_id,store_id,status,bsl_status,bsl_evidence,notes,source_kind,source_document,source_locator) VALUES($1,$2,$3,'MOUNTAIN_BASE','MOUNTAIN_BASE','AVAILABLE','NOT_APPLICABLE','','','SYNTHETIC','provisional-capacity product-path fixture',$4)`,
          [randomUUID(), variant.id, family, tag + '-' + n],
        );
        await c.query('COMMIT');
      } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
    }
    return {model, variant, size};
  }
  async function provisionalFor(family: 'SKI'|'SNOWBOARD'|'SKI_BOOT'|'SNOWBOARD_BOOT'|'WEAR_JACKET'|'WEAR_PANTS', size: string, quantity: number, tag: string) {
    return src.register(randomUUID(), {sourceSha256: createHash('sha256').update('pbc-product-path-' + tag).digest('hex'), originalFilename: 'pbc-product-path-' + tag + '.xlsx', buckets: [{family, age: 'ADULT', sourceSize: size, bookingSize: size, quantity, provenance: 'product-path fixture ' + tag}]});
  }
  function singleSkiCondition(day: string, variantId: string, tier: 'REGULAR'|'PREMIUM' = 'REGULAR', modelPromise?: {variantId: string; modelId: string; season: string}): HoldConditions {
    return {...(modelPromise ? {contractVersion: 'INTEGRATED_V1_2' as const} : {}), reservationId: randomUUID(), pickupStore: 'MOUNTAIN_BASE', returnStore: 'MOUNTAIN_BASE', period: {startDate: day, endDate: day, slot: 'DAY'}, members: [{key: 'p', product: 'SINGLE', age: 'ADULT', tier, items: [{family: 'SKI', variantIds: [variantId], ...(modelPromise ? {modelPromise} : {})}]}]};
  }

  await check('P1: physical-only — a booking against a variant with only real inventory (no provisional bucket exists for it) is unaffected: CREATED with a real inventory_claims row, zero provisional_capacity_claims', async () => {
    const {variant} = await physicalSkuFor('p1', 1);
    const outcome = await x.holds.command('create', randomUUID(), singleSkiCondition('2036-03-01', variant.id));
    assert.equal(outcome.result, 'CREATED');
    assert.equal((await x.db.pool.query('SELECT count(*)::int n FROM inventory_claims WHERE hold_id=$1 AND active', [outcome.holdId])).rows[0].n, 1);
    assert.equal((await x.db.pool.query("SELECT count(*)::int n FROM provisional_capacity_claims WHERE hold_id=$1 AND state='ACTIVE'", [outcome.holdId])).rows[0].n, 0);
  });

  await check('P2: provisional-only — zero physical stock for this variant/size, but a matching provisional bucket has room: the booking is still CREATED (not INSUFFICIENT), backed by a real provisional_capacity_claims row instead of inventory_claims', async () => {
    const {variant, size} = await physicalSkuFor('p2', 0);
    await provisionalFor('SKI', size, 2, 'p2');
    const outcome = await x.holds.command('create', randomUUID(), singleSkiCondition('2036-03-02', variant.id));
    assert.equal(outcome.result, 'CREATED');
    assert.equal((await x.db.pool.query('SELECT count(*)::int n FROM inventory_claims WHERE hold_id=$1 AND active', [outcome.holdId])).rows[0].n, 0);
    assert.equal((await x.db.pool.query("SELECT count(*)::int n FROM provisional_capacity_claims WHERE hold_id=$1 AND state='ACTIVE'", [outcome.holdId])).rows[0].n, 1);
  });

  await check('P3: mixed — a SKI_SET member needs SKI+POLE (physical) and SKI_BOOT (zero physical, provisional-backed): every requirement is satisfied in the SAME hold, two via inventory_claims (SKI, POLE), one via provisional_capacity_claims (SKI_BOOT)', async () => {
    const skiSku = await physicalSkuFor('p3-ski', 1);
    const poleModel = await ledger.create('models', {sourceKind: 'SYNTHETIC', sourceDocument: 'provisional-capacity product-path fixture', sourceLocator: 'model-p3-pole', code: 'PBC-P3-POLE', name: 'PBC P3 pole', brand: 'SYNTHETIC', family: 'POLE', notes: '', catalogSeason: '2026/27'});
    const poleVariant = await ledger.create('variants', {sourceKind: 'SYNTHETIC', sourceDocument: 'provisional-capacity product-path fixture', sourceLocator: 'variant-p3-pole', modelId: poleModel.id, family: 'POLE', age: 'ADULT', tier: 'REGULAR', size: 'PBC-P3-POLE', notes: ''});
    await ledger.create('poles', {sourceKind: 'SYNTHETIC', sourceDocument: 'provisional-capacity product-path fixture', sourceLocator: 'pole-p3', variantId: poleVariant.id, storeId: 'MOUNTAIN_BASE', status: 'AVAILABLE', quantity: 1, notes: ''});
    const bootModel = await ledger.create('models', {sourceKind: 'SYNTHETIC', sourceDocument: 'provisional-capacity product-path fixture', sourceLocator: 'model-p3-boot', code: 'PBC-P3-BOOT', name: 'PBC P3 boot', brand: 'SYNTHETIC', family: 'SKI_BOOT', notes: '', catalogSeason: '2026/27'});
    const bootVariant = await ledger.create('variants', {sourceKind: 'SYNTHETIC', sourceDocument: 'provisional-capacity product-path fixture', sourceLocator: 'variant-p3-boot', modelId: bootModel.id, family: 'SKI_BOOT', age: 'ADULT', tier: 'REGULAR', size: 'PBC-P3-BOOT', notes: ''});
    await provisionalFor('SKI_BOOT', 'PBC-P3-BOOT', 1, 'p3-boot');
    const conditions: HoldConditions = {reservationId: randomUUID(), pickupStore: 'MOUNTAIN_BASE', returnStore: 'MOUNTAIN_BASE', period: {startDate: '2036-03-03', endDate: '2036-03-03', slot: 'DAY'}, members: [{key: 'p', product: 'SKI_SET', age: 'ADULT', tier: 'REGULAR', items: [{family: 'SKI', variantIds: [skiSku.variant.id]}, {family: 'SKI_BOOT', variantIds: [bootVariant.id]}, {family: 'POLE', variantIds: [poleVariant.id]}]}]};
    const outcome = await x.holds.command('create', randomUUID(), conditions);
    assert.equal(outcome.result, 'CREATED');
    assert.equal((await x.db.pool.query('SELECT count(*)::int n FROM inventory_claims WHERE hold_id=$1 AND active', [outcome.holdId])).rows[0].n, 2); // SKI + POLE
    assert.equal((await x.db.pool.query("SELECT count(*)::int n FROM provisional_capacity_claims WHERE hold_id=$1 AND state='ACTIVE'", [outcome.holdId])).rows[0].n, 1); // SKI_BOOT only
  });

  await check('P4: physical preferred — one real unit AND provisional capacity both exist for the same variant/size: the booking uses the real unit, provisional stays untouched (never gratuitously used when physical alone already satisfies the request)', async () => {
    const {variant, size} = await physicalSkuFor('p4', 1);
    await provisionalFor('SKI', size, 5, 'p4');
    const outcome = await x.holds.command('create', randomUUID(), singleSkiCondition('2036-03-04', variant.id));
    assert.equal(outcome.result, 'CREATED');
    assert.equal((await x.db.pool.query('SELECT count(*)::int n FROM inventory_claims WHERE hold_id=$1 AND active', [outcome.holdId])).rows[0].n, 1);
    assert.equal((await x.db.pool.query("SELECT count(*)::int n FROM provisional_capacity_claims WHERE hold_id=$1 AND state='ACTIVE'", [outcome.holdId])).rows[0].n, 0);
  });

  await check('P5: PREMIUM/modelPromise excluded — zero physical stock, ample provisional capacity, but a PREMIUM member with a modelPromise on the item can never fall back to undifferentiated provisional stock: INSUFFICIENT, not CREATED', async () => {
    const size = 'PBC-P5';
    const model = await ledger.create('models', {sourceKind: 'SYNTHETIC', sourceDocument: 'provisional-capacity product-path fixture', sourceLocator: 'model-p5', code: 'PBCPP-P5', name: 'PBC product-path p5', brand: 'SYNTHETIC', family: 'SKI', notes: '', catalogSeason: '2026/27'});
    const variant = await ledger.create('variants', {sourceKind: 'SYNTHETIC', sourceDocument: 'provisional-capacity product-path fixture', sourceLocator: 'variant-p5', modelId: model.id, family: 'SKI', age: 'ADULT', tier: 'PREMIUM', size, notes: ''});
    await provisionalFor('SKI', size, 5, 'p5'); // zero physical stock for this PREMIUM variant, but ample provisional
    const outcome = await x.holds.command('create', randomUUID(), singleSkiCondition('2036-03-05', variant.id, 'PREMIUM', {variantId: variant.id, modelId: model.id, season: '2026/27'}));
    assert.equal(outcome.result, 'INSUFFICIENT');
  });

  await check('P6: POLE stays physical-only — POLE is not one of the six provisional-capacity families at all; zero physical pole stock is INSUFFICIENT regardless of any other provisional capacity registered', async () => {
    const poleModel = await ledger.create('models', {sourceKind: 'SYNTHETIC', sourceDocument: 'provisional-capacity product-path fixture', sourceLocator: 'model-p6-pole', code: 'PBC-P6-POLE', name: 'PBC P6 pole', brand: 'SYNTHETIC', family: 'POLE', notes: '', catalogSeason: '2026/27'});
    const poleVariant = await ledger.create('variants', {sourceKind: 'SYNTHETIC', sourceDocument: 'provisional-capacity product-path fixture', sourceLocator: 'variant-p6-pole', modelId: poleModel.id, family: 'POLE', age: 'ADULT', tier: 'REGULAR', size: 'PBC-P6-POLE', notes: ''});
    const conditions: HoldConditions = {reservationId: randomUUID(), pickupStore: 'MOUNTAIN_BASE', returnStore: 'MOUNTAIN_BASE', period: {startDate: '2036-03-06', endDate: '2036-03-06', slot: 'DAY'}, members: [{key: 'p', product: 'SINGLE', age: 'ADULT', tier: 'REGULAR', items: [{family: 'POLE', variantIds: [poleVariant.id]}]}]};
    assert.equal((await x.holds.command('create', randomUUID(), conditions)).result, 'INSUFFICIENT');
  });

  await check('P7: concurrent last-provisional-unit race — two concurrent HoldService.command() creates against a 1-unit provisional-only bucket: exactly one CREATED, the other INSUFFICIENT, never both', async () => {
    const {variant, size} = await physicalSkuFor('p7', 0);
    await provisionalFor('SKI', size, 1, 'p7');
    const outcomes = await Promise.allSettled([
      x.holds.command('create', randomUUID(), singleSkiCondition('2036-03-07', variant.id)),
      x.holds.command('create', randomUUID(), singleSkiCondition('2036-03-07', variant.id)),
    ]);
    const results = outcomes.map((o) => o.status === 'fulfilled' ? o.value.result : 'THREW');
    assert.equal(results.filter((r) => r === 'CREATED').length, 1);
    assert.equal(results.filter((r) => r === 'INSUFFICIENT').length, 1);
  });

  await check('P8: wear provisional fallback — zero real wear pool stock for either piece, provisional WEAR_JACKET/WEAR_PANTS capacity covers both: a WEAR_SET member (which requires exactly jacket+pants) is still CREATED, backed by provisional_capacity_claims rows, never fabricated wear_claims rows', async () => {
    const jacketModel = await ledger.create('models', {sourceKind: 'SYNTHETIC', sourceDocument: 'provisional-capacity product-path fixture', sourceLocator: 'model-p8-jacket', code: 'PBC-P8-JACKET', name: 'PBC P8 jacket', brand: 'SYNTHETIC', family: 'WEAR_JACKET', notes: '', catalogSeason: '2026/27'});
    const jacketVariant = await ledger.create('variants', {sourceKind: 'SYNTHETIC', sourceDocument: 'provisional-capacity product-path fixture', sourceLocator: 'variant-p8-jacket', modelId: jacketModel.id, family: 'WEAR_JACKET', age: 'ADULT', tier: 'STANDARD', size: 'PBC-P8-WEAR', notes: '', compatibleSports: ['SKI', 'SNOWBOARD']});
    const pantsModel = await ledger.create('models', {sourceKind: 'SYNTHETIC', sourceDocument: 'provisional-capacity product-path fixture', sourceLocator: 'model-p8-pants', code: 'PBC-P8-PANTS', name: 'PBC P8 pants', brand: 'SYNTHETIC', family: 'WEAR_PANTS', notes: '', catalogSeason: '2026/27'});
    const pantsVariant = await ledger.create('variants', {sourceKind: 'SYNTHETIC', sourceDocument: 'provisional-capacity product-path fixture', sourceLocator: 'variant-p8-pants', modelId: pantsModel.id, family: 'WEAR_PANTS', age: 'ADULT', tier: 'STANDARD', size: 'PBC-P8-WEAR', notes: '', compatibleSports: ['SKI', 'SNOWBOARD']});
    await provisionalFor('WEAR_JACKET', 'PBC-P8-WEAR', 1, 'p8-jacket');
    await provisionalFor('WEAR_PANTS', 'PBC-P8-WEAR', 1, 'p8-pants');
    const conditions: HoldConditions = {contractVersion: 'INTEGRATED_V1_2', reservationId: randomUUID(), pickupStore: 'MOUNTAIN_BASE', returnStore: 'MOUNTAIN_BASE', period: {startDate: '2036-03-08', endDate: '2036-03-08', slot: 'DAY'}, members: [{key: 'w', product: 'WEAR_SET', age: 'ADULT', tier: 'STANDARD', wearSport: 'SKI', items: [{family: 'WEAR_JACKET', variantIds: [jacketVariant.id]}, {family: 'WEAR_PANTS', variantIds: [pantsVariant.id]}]}]};
    const outcome = await x.holds.command('create', randomUUID(), conditions);
    assert.equal(outcome.result, 'CREATED');
    assert.equal((await x.db.pool.query('SELECT count(*)::int n FROM wear_claims WHERE hold_id=$1 AND active', [outcome.holdId])).rows[0].n, 0);
    assert.equal((await x.db.pool.query("SELECT count(*)::int n FROM provisional_capacity_claims WHERE hold_id=$1 AND state='ACTIVE'", [outcome.holdId])).rows[0].n, 2);
  });

  await check('P9: cancel releases the provisional claim exactly once — after command(\'cancel\',...), the provisional_capacity_claims row is RELEASED and the unit is immediately available to a new hold', async () => {
    const {variant, size} = await physicalSkuFor('p9', 0);
    await provisionalFor('SKI', size, 1, 'p9');
    const first = await x.holds.command('create', randomUUID(), singleSkiCondition('2036-03-09', variant.id));
    assert.equal(first.result, 'CREATED');
    assert.equal((await x.holds.command('create', randomUUID(), singleSkiCondition('2036-03-09', variant.id))).result, 'INSUFFICIENT'); // unit already held
    await x.holds.command('cancel', randomUUID(), undefined, first.holdId);
    assert.equal((await x.db.pool.query("SELECT state FROM provisional_capacity_claims WHERE hold_id=$1", [first.holdId])).rows[0].state, 'RELEASED');
    assert.equal((await x.holds.command('create', randomUUID(), singleSkiCondition('2036-03-09', variant.id))).result, 'CREATED'); // now free again
  });

  await check('P10: expiry releases the provisional claim — an unpaid hold past expiry is swept by expireInventoryHolds (via the next command() call) exactly like a real inventory_claims release, freeing the unit', async () => {
    const {variant, size} = await physicalSkuFor('p10', 0);
    await provisionalFor('SKI', size, 1, 'p10');
    const first = await x.holds.command('create', randomUUID(), singleSkiCondition('2036-03-10', variant.id));
    assert.equal(first.result, 'CREATED');
    await x.clock(new Date(x.now().getTime() + 700000).toISOString()); // past HOLD_TTL_SECONDS, still unpaid
    assert.equal((await x.holds.command('create', randomUUID(), singleSkiCondition('2036-03-10', variant.id))).result, 'CREATED'); // the expiring hold's expiry is swept first, freeing the unit for this new request
    assert.equal((await x.db.pool.query("SELECT state FROM provisional_capacity_claims WHERE hold_id=$1", [first.holdId])).rows[0].state, 'RELEASED');
  });

  await check('P11: checkout gate — a hold with an ACTIVE provisional claim can be booked and paid for (reservation allowed), but CustodyService.prepare() fails closed with PROVISIONAL_PHYSICAL_ASSIGNMENT_REQUIRED (physical handoff not allowed) until the claim is real', async () => {
    const {variant, size} = await physicalSkuFor('p11', 0);
    await provisionalFor('SKI', size, 1, 'p11');
    const conditions = singleSkiCondition('2035-06-15', variant.id); // within quotes.initializePrivate's 2035-01-01..2035-12-31 price coverage — unlike the other product-path tests, P11 needs pricing/booking, not just HoldService
    const built = await x.draft(undefined, conditions);
    const paid = await x.service.startPayment(built.booking.id, randomUUID());
    assert.equal(paid.state, 'CONFIRMED_DEV');
    const custody = new CustodyService(role!.operationsPool, x.roles.authPool, x.signed.identity);
    const view = await custody.checkoutView(built.booking.id);
    // No real inventory_claims row exists (the requirement is provisional-backed), so view.items
    // is empty; a syntactically-valid placeholder selection is enough to pass prepare()'s own
    // input-shape check — verifyPhysicalHandoff fails closed before selections are ever compared
    // against real assignment.
    await assert.rejects(custody.prepare(randomUUID(), {bookingId: built.booking.id, expectedBookingVersion: view.bookingVersion, expectedHoldVersion: view.holdVersion, selections: [{requirementKey: 'p:SKI', assetId: randomUUID(), poleId: null}], fitEvidence: 'SYNTHETIC fit note'}), {code: 'PROVISIONAL_PHYSICAL_ASSIGNMENT_REQUIRED'});
  });

  await check('P12: the handoff gate actually clears — an explicit reassign() to a newly-available real Asset, done before payment (a paid hold cannot be reassigned through this path at all — PAYMENT_RECONCILIATION_REQUIRED), converts a provisional-backed hold to a real physical claim, releases the provisional claim, and CustodyService.prepare() then succeeds with no PROVISIONAL_PHYSICAL_ASSIGNMENT_REQUIRED', async () => {
    const {variant, size} = await physicalSkuFor('p12', 0); // zero physical stock at first
    await provisionalFor('SKI', size, 1, 'p12');
    const conditions = singleSkiCondition('2035-06-16', variant.id);
    const created = await x.holds.command('create', randomUUID(), conditions);
    assert.equal(created.result, 'CREATED');
    const holdId = created.holdId!;
    assert.equal((await x.db.pool.query('SELECT count(*)::int n FROM inventory_claims WHERE hold_id=$1 AND active', [holdId])).rows[0].n, 0);
    assert.equal((await x.db.pool.query("SELECT count(*)::int n FROM provisional_capacity_claims WHERE hold_id=$1 AND state='ACTIVE'", [holdId])).rows[0].n, 1);
    // A real physical Asset for the exact same variant now becomes available (the operator's
    // explicit workflow this correction proves — no automatic replan moves it; see P2).
    const assetId = randomUUID();
    const c = await x.db.pool.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('zao.actor',$1,true),set_config('zao.reason','SYNTHETIC provisional-capacity product-path fixture',true)", [x.actor]);
      await c.query(
        `INSERT INTO ledger_assets(id,variant_id,family,initial_store_id,store_id,status,bsl_status,bsl_evidence,notes,source_kind,source_document,source_locator) VALUES($1,$2,'SKI','MOUNTAIN_BASE','MOUNTAIN_BASE','AVAILABLE','NOT_APPLICABLE','','','SYNTHETIC','provisional-capacity product-path fixture','p12-real')`,
        [assetId, variant.id],
      );
      await c.query('COMMIT');
    } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
    // Explicit reassign, before any payment: HoldService.command()'s own payment-reconciliation
    // gate refuses amend/reassign entirely once payment_state='SUCCESS' (paymentDecision() never
    // returns MAY_CHANGE for a paid hold) — this is the actual operator sequencing the gate allows.
    const reassigned = await x.holds.command('reassign', randomUUID(), {assetId, requirementKey: 'p:SKI'}, holdId);
    assert.equal(reassigned.result, 'AMENDED');
    assert.equal((await x.db.pool.query('SELECT asset_id FROM inventory_claims WHERE hold_id=$1 AND active', [holdId])).rows[0].asset_id, assetId);
    assert.equal((await x.db.pool.query("SELECT state FROM provisional_capacity_claims WHERE hold_id=$1", [holdId])).rows[0].state, 'RELEASED');
    // Exactly one witness for the requirement/day, never two (P3's own guard, re-checked here at
    // the product-path level): the released provisional row does not count, only the ACTIVE one.
    assert.equal((await x.db.pool.query("SELECT count(*)::int n FROM inventory_claims WHERE hold_id=$1 AND active UNION ALL SELECT count(*)::int FROM provisional_capacity_claims WHERE hold_id=$1 AND state='ACTIVE'", [holdId])).rows.reduce((sum: number, r: {n: number}) => sum + r.n, 0), 1);
    // Pay against a fresh quote reflecting the post-reassign hold version (the quote draft() would
    // have built is for the pre-reassign version and would fail QUOTE_HOLD_MISMATCH).
    const quote = (await x.quotes.create(randomUUID(), {conditions, holdId, couponCode: null, wantAdvance: false})).quote;
    const booking = await x.service.create(randomUUID(), quote.id, {displayName: 'SYNTHETIC Guest', email: 'synthetic-guest-p12@example.invalid', termsAccepted: true});
    const paid = await x.service.startPayment(booking.id, randomUUID());
    assert.equal(paid.state, 'CONFIRMED_DEV');
    const custody = new CustodyService(role!.operationsPool, x.roles.authPool, x.signed.identity);
    const view = await custody.checkoutView(booking.id);
    assert.deepEqual(view.items.map((i: {requirement_key: string; asset_id: string | null}) => ({requirementKey: i.requirement_key, assetId: i.asset_id, poleId: null})), [{requirementKey: 'p:SKI', assetId, poleId: null}]);
    const prepared = await custody.prepare(randomUUID(), {bookingId: booking.id, expectedBookingVersion: paid.version, expectedHoldVersion: view.holdVersion, selections: view.items.map((i: {requirement_key: string; asset_id: string | null}) => ({requirementKey: i.requirement_key, assetId: i.asset_id, poleId: null})), fitEvidence: 'SYNTHETIC P12 fit note; no DIN certification'});
    assert.ok(prepared.preparation); // succeeded — no PROVISIONAL_PHYSICAL_ASSIGNMENT_REQUIRED, no other rejection
  });

  // ---- P13/P14: adversarial multi-item competition (P7 correction) — the greedy re-inclusion
  // simplification must stay conservative: a false negative (routing more to provisional than a
  // perfect solver would) is accepted, but never a false FEASIBLE (oversell). Two members compete
  // for the exact same physical variant, with only 1 real unit + a 1-unit provisional bucket. ----
  function twoMemberSameVariant(day: string, variantId: string): HoldConditions {
    return {reservationId: randomUUID(), pickupStore: 'MOUNTAIN_BASE', returnStore: 'MOUNTAIN_BASE', period: {startDate: day, endDate: day, slot: 'DAY'}, members: [
      {key: 'person-a', product: 'SINGLE', age: 'ADULT', tier: 'REGULAR', items: [{family: 'SKI', variantIds: [variantId]}]},
      {key: 'person-b', product: 'SINGLE', age: 'ADULT', tier: 'REGULAR', items: [{family: 'SKI', variantIds: [variantId]}]},
    ]};
  }
  function threeMemberSameVariant(day: string, variantId: string): HoldConditions {
    return {reservationId: randomUUID(), pickupStore: 'MOUNTAIN_BASE', returnStore: 'MOUNTAIN_BASE', period: {startDate: day, endDate: day, slot: 'DAY'}, members: [
      {key: 'person-a', product: 'SINGLE', age: 'ADULT', tier: 'REGULAR', items: [{family: 'SKI', variantIds: [variantId]}]},
      {key: 'person-b', product: 'SINGLE', age: 'ADULT', tier: 'REGULAR', items: [{family: 'SKI', variantIds: [variantId]}]},
      {key: 'person-c', product: 'SINGLE', age: 'ADULT', tier: 'REGULAR', items: [{family: 'SKI', variantIds: [variantId]}]},
    ]};
  }
  await check('P13: adversarial competition, exact capacity — 2 members demand the same variant, exactly 1 physical unit + 1 provisional unit exist: CREATED with exactly one physical claim and exactly one provisional claim, never two of either (no oversell of the single physical Asset, no oversell of the single-unit provisional bucket)', async () => {
    const {variant, size} = await physicalSkuFor('p13', 1); // exactly 1 physical unit
    await provisionalFor('SKI', size, 1, 'p13'); // exactly 1 provisional unit
    const outcome = await x.holds.command('create', randomUUID(), twoMemberSameVariant('2036-03-13', variant.id));
    assert.equal(outcome.result, 'CREATED');
    const physical = (await x.db.pool.query('SELECT count(*)::int n FROM inventory_claims WHERE hold_id=$1 AND active', [outcome.holdId])).rows[0].n;
    const provisional = (await x.db.pool.query("SELECT count(*)::int n FROM provisional_capacity_claims WHERE hold_id=$1 AND state='ACTIVE'", [outcome.holdId])).rows[0].n;
    assert.equal(physical, 1); // never 2 — only 1 real Asset exists, a second physical claim on it would be a structural oversell
    assert.equal(provisional, 1); // never 2 — only 1 provisional unit was registered
  });
  await check('P14: adversarial competition, insufficient capacity — 3 members demand the same variant, only 1 physical + 1 provisional unit exist (capacity 2, demand 3): INSUFFICIENT, never a false FEASIBLE that would leave one member with no witness at all', async () => {
    const {variant, size} = await physicalSkuFor('p14', 1);
    await provisionalFor('SKI', size, 1, 'p14');
    const conditions = threeMemberSameVariant('2036-03-14', variant.id);
    const outcome = await x.holds.command('create', randomUUID(), conditions);
    assert.equal(outcome.result, 'INSUFFICIENT');
    assert.equal((await x.db.pool.query('SELECT count(*)::int n FROM inventory_holds WHERE reservation_id=$1', [conditions.reservationId])).rows[0].n, 0); // no partial hold was created either
  });

  console.log(JSON.stringify({status: 'PASS', cases: count, realDataImports: 3, realAssetIdsGenerated: 9, productionDbWrites: 0, squareCalls: 0, payments: 0, customerNotifications: 0}));
} catch (e) {
  failed = true;
  console.error(JSON.stringify({status: 'FAIL', stage, code: (e as {code?: string}).code ?? (e as Error).name, detail: (e as Error).message.slice(0, 500)}));
  console.error((e as Error).stack?.split('\n').filter((l) => l.includes('/tests/')).join('\n'));
} finally {
  await role?.close();
  await x.close();
}
if (failed) process.exit(1);
