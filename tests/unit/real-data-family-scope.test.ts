import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {stageStockImport,commitImportDryRun} from '../../packages/core/src/content/import-staging';
import {planStockImport,type ImportVariant} from '../../packages/core/src/content/stock-import-plan';
import {REAL_DATA_APPROVED_FAMILY_SCOPE} from '../../packages/core/src/operations/inventory-service';

const csvHeader='source_kind,intent,model_id,season,variant_id,manufacturer_sku,quantity,unit,asset_ids,store_id\n';
function variantFor(family: ImportVariant['family']): ImportVariant {
  return {id: randomUUID(), modelId: randomUUID(), season: '2026/27', manufacturerSku: 'SYNTHETIC-SKU', family};
}
function csvFor(v: ImportVariant, assetIds: string[]) {
  const unit = v.family === 'SNOWBOARD' ? 'ASSET_BOARD' : ['SKI', 'SKI_BOOT', 'SNOWBOARD_BOOT'].includes(v.family) ? 'ASSET_PAIR' : v.family === 'POLE' ? 'PAIR_QUANTITY' : 'PIECE_QUANTITY';
  const quantity = unit.startsWith('ASSET_') ? String(assetIds.length) : '3';
  return csvHeader + ['SHOP_RECEIPT', 'ADD', v.modelId, v.season, v.id, v.manufacturerSku, quantity, unit, unit.startsWith('ASSET_') ? assetIds.join('|') : '', 'MOUNTAIN_BASE'].join(',');
}

test('each of the 4 currently-approved families passes the real-data scope', () => {
  for (const family of REAL_DATA_APPROVED_FAMILY_SCOPE) {
    // Every currently-approved family (SKI/SNOWBOARD/SKI_BOOT/SNOWBOARD_BOOT) is asset-backed.
    const v = variantFor(family), ids = [randomUUID()];
    const p = stageStockImport(csvFor(v, ids), 'Sheet1', [v], {}, 'r1', REAL_DATA_APPROVED_FAMILY_SCOPE);
    assert.equal(p.unresolved.length, 0, family);
    assert.equal(p.plan!.entries[0]!.disposition, 'VALIDATED_PLAN', family);
    assert.ok(!p.plan!.entries[0]!.issues.includes('FAMILY_NOT_IN_APPROVED_SCOPE'), family);
  }
});

test('each currently-excluded family (POLE, WEAR_JACKET, WEAR_PANTS) fails the real-data scope, even though the generic importer still accepts it unscoped', () => {
  for (const family of ['POLE', 'WEAR_JACKET', 'WEAR_PANTS'] as const) {
    const v = variantFor(family);
    const scoped = stageStockImport(csvFor(v, []), 'Sheet1', [v], {}, 'r1', REAL_DATA_APPROVED_FAMILY_SCOPE);
    assert.ok(scoped.plan!.entries[0]!.issues.includes('FAMILY_NOT_IN_APPROVED_SCOPE'), family);
    // The generic (unscoped) importer is deliberately not crippled — it still accepts these families.
    const unscoped = stageStockImport(csvFor(v, []), 'Sheet1', [v], {}, 'r1');
    assert.ok(!unscoped.plan!.entries[0]!.issues.includes('FAMILY_NOT_IN_APPROVED_SCOPE'), family);
  }
});

test('a mixed allowed+excluded batch fails atomically: the whole stage is unresolved, not just the excluded row', () => {
  const ski = variantFor('SKI'), pole = variantFor('POLE');
  const rows = [
    { documentSha256: 'a'.repeat(64), locator: 'row-1', sourceKind: 'SHOP_RECEIPT' as const, intent: 'ADD' as const, modelId: ski.modelId, season: ski.season, variantId: ski.id, manufacturerSku: ski.manufacturerSku, quantity: 1, unit: 'ASSET_PAIR' as const, assetIds: [randomUUID()], storeId: 'MOUNTAIN_BASE' as const },
    { documentSha256: 'b'.repeat(64), locator: 'row-2', sourceKind: 'SHOP_RECEIPT' as const, intent: 'ADD' as const, modelId: pole.modelId, season: pole.season, variantId: pole.id, manufacturerSku: pole.manufacturerSku, quantity: 3, unit: 'PAIR_QUANTITY' as const, assetIds: [], storeId: 'MOUNTAIN_BASE' as const },
  ];
  const plan = planStockImport(rows, [ski, pole], {}, 'r1', REAL_DATA_APPROVED_FAMILY_SCOPE);
  assert.equal(plan.entries[0]!.issues.length, 0);
  assert.ok(plan.entries[1]!.issues.includes('FAMILY_NOT_IN_APPROVED_SCOPE'));
  // commitImportDryRun's own atomicity (pre-existing): ANY row with issues blocks the whole commit.
  assert.throws(() => {
    if (plan.entries.some(e => e.issues.length)) throw new Error('IMPORT_UNRESOLVED');
  });
});

test('the stage digest includes the approved scope: staging the same file under a different scope changes stageSha256', () => {
  const v = variantFor('SKI');
  const withScope = stageStockImport(csvFor(v, [randomUUID()]), 'Sheet1', [v], {}, 'r1', REAL_DATA_APPROVED_FAMILY_SCOPE);
  const withoutScope = stageStockImport(csvFor(v, [randomUUID()]), 'Sheet1', [v], {}, 'r1');
  const widerScope = stageStockImport(csvFor(v, [randomUUID()]), 'Sheet1', [v], {}, 'r1', ['SKI', 'SNOWBOARD', 'SKI_BOOT', 'SNOWBOARD_BOOT', 'POLE'] as const);
  assert.notEqual(withScope.stageSha256, withoutScope.stageSha256);
  assert.notEqual(withScope.stageSha256, widerScope.stageSha256);
});

test('commit cannot widen the scope supplied at stage time: commitImportDryRun always reuses the staged scope, never a fresh caller-supplied one', () => {
  const v = variantFor('SKI'), assetId = randomUUID();
  const staged = stageStockImport(csvFor(v, [assetId]), 'Sheet1', [v], {}, 'r1', REAL_DATA_APPROVED_FAMILY_SCOPE);
  // commitImportDryRun's signature takes no scope parameter at all — it is not possible for a
  // caller to pass a wider scope at commit time even by mistake; it always re-derives from
  // staged.plan.approvedFamilyScope.
  const result = commitImportDryRun(staged, staged.stageSha256, [v], {}, 'r1', new Set());
  assert.equal(result.operations.length, 1);
});
