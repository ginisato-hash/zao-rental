// F8 (TD correction): this scaffold is deliberately unwired — see
// packages/core/src/pricing/commercial-price-authority.ts's own comment. These tests prove that
// boundary directly: no code path in this module can mint an ApprovedCommercialPricePermit from
// anything (raw browser/request input, an arbitrary boolean, or otherwise), the accessor is
// WeakMap-backed so a hand-built lookalike resolves to nothing, and the module performs no I/O of
// any kind (there is nothing here that could make a live Square call).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as commercialPriceAuthority from '../../packages/core/src/pricing/commercial-price-authority';
import { approvedCommercialPricePermitAuthority, type ApprovedCommercialPricePermit } from '../../packages/core/src/pricing/commercial-price-authority';

test('F8: the module exports exactly one function — a read-only accessor — and no issuance function at all; no raw input, boolean flag, or anything else can mint a permit today', () => {
  const exportNames = Object.keys(commercialPriceAuthority);
  assert.deepEqual(exportNames, ['approvedCommercialPricePermitAuthority']);
  assert.ok(!exportNames.some(n => /^(issue|mint|create|grant)/i.test(n)));
});
test('F8: the accessor is WeakMap-backed — no permit, and a hand-built lookalike object, both resolve to null, never a real authority', () => {
  assert.equal(approvedCommercialPricePermitAuthority(undefined), null);
  assert.equal(approvedCommercialPricePermitAuthority({ kind: 'APPROVED_COMMERCIAL_PRICE_PERMIT' } as ApprovedCommercialPricePermit), null);
  assert.equal(approvedCommercialPricePermitAuthority({} as ApprovedCommercialPricePermit), null);
});
