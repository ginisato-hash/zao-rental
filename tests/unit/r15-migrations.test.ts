import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyR15MigrationSources} from '../../scripts/hosted-payment-migrations';
test('R15 migrations 0001–0029 equal the preserved R14 evidence',async()=>{
 const sources=await verifyR15MigrationSources();assert.equal(sources.length,30);assert.equal(sources[29]!.id,'0030');assert.equal(sources[0]!.id,'0001');assert.equal(sources[28]!.id,'0029');
});
