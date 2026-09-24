import test from 'node:test';
import assert from 'node:assert/strict';
import type {Pool} from 'pg';
import {environmentIdentifiers,tokenNormaliser} from '../../scripts/production-bootstrap';

/** Answers the two catalog queries environmentIdentifiers() issues: identity, then derived roles.
 * `derived` stands for whatever pg_roles would return; the SQL filter itself is proven on a real
 * cluster by tests/operations/production-bootstrap-delta.ts. */
const fake=(database:string,owner:string,derived:string[])=>({query:async(sql:string)=>
 /current_database\(\) database/.test(sql)?{rows:[{database,owner}]}:{rows:derived.map(rolname=>({rolname}))}}) as unknown as Pool;

test('Neon-named owner: neondb / neondb_owner maps to four distinct placeholders',async()=>{
 const map=await environmentIdentifiers(fake('neondb','neondb_owner',['neondb_custody','neondb_custody_executor']));
 assert.deepEqual([...map].sort(),[
  ['neondb','<DATABASE>'],['neondb_custody','<DATABASE>_custody'],
  ['neondb_custody_executor','<DATABASE>_custody_executor'],['neondb_owner','<MIGRATION_OWNER>']]);
 assert.equal(tokenNormaliser(map)('neondb_custody_executor neondb_owner neondb'),'<DATABASE>_custody_executor <MIGRATION_OWNER> <DATABASE>');
});
test('a database named after its owner is still refused',async()=>{
 await assert.rejects(environmentIdentifiers(fake('neondb','neondb',[])),/PRODUCTION_FINGERPRINT_AMBIGUOUS_IDENTITY neondb/);
});
test('a true collision still fails closed',async()=>{
 // The owner reported as a derived role (the pre-fix query shape) and a duplicated derived role.
 await assert.rejects(environmentIdentifiers(fake('neondb','neondb_owner',['neondb_owner'])),/PRODUCTION_FINGERPRINT_IDENTIFIER_COLLISION neondb_owner/);
 await assert.rejects(environmentIdentifiers(fake('neondb','neondb_owner',['neondb_custody','neondb_custody'])),/PRODUCTION_FINGERPRINT_IDENTIFIER_COLLISION neondb_custody/);
});
test('a foreign role is never folded into this database',()=>{
 const normalise=tokenNormaliser(new Map([['neondb','<DATABASE>'],['neondb_owner','<MIGRATION_OWNER>'],['neondb_custody','<DATABASE>_custody']]));
 assert.equal(normalise('neondb2_custody otherdb_owner neondbx_custody'),'neondb2_custody otherdb_owner neondbx_custody');
});
