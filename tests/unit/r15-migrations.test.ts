import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {migrationPlan} from '../../packages/db/src/index';
import {verifyR15MigrationSources} from '../../scripts/hosted-payment-migrations';
test('R15 archived migration bytes remain unchanged; frozen verifier rejects the expanded Avatar plan',async()=>{
 const historical=JSON.parse(await readFile('docs/execution/p6/r14-evidence/migration-hashes.json','utf8')) as {id:string;file:string;sha256:string}[];
 const additions=JSON.parse(await readFile('docs/execution/p6/r15-governance/migration-additions.json','utf8')) as typeof historical;
 assert.equal(historical.length,29);assert.equal(additions.length,1);const sources=[...historical,...additions];
 for(const [i,source]of sources.entries()){
  assert.equal(source.id,String(i+1).padStart(4,'0'));assert.equal(migrationPlan[i]!.id,source.id);assert.equal(migrationPlan[i]!.file,source.file);
  assert.equal(createHash('sha256').update(await readFile('packages/db/migrations/'+source.file)).digest('hex'),source.sha256);
 }
 // Preserve the historical activation boundary; never expand the R15 verifier.
 await assert.rejects(()=>verifyR15MigrationSources(),/R15_MIGRATION_RANGE_MISMATCH/);
});
