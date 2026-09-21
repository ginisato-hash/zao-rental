import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {startIsolatedPostgres} from '../../scripts/postgres';
import {migrate} from '../../packages/db/src/index';
import {importPhase6Artwork,phase6RightsBasis} from '../../scripts/avatar-artwork-hosted';
const db=await startIsolatedPostgres();
try{
 await migrate(db.pool);const lock=await db.pool.connect();let elapsed=0;
 try{await lock.query('BEGIN');await lock.query('LOCK TABLE content_workspace IN ACCESS EXCLUSIVE MODE');const start=performance.now();await assert.rejects(importPhase6Artwork(db.pool),{code:'55P03'});elapsed=performance.now()-start;assert.ok(elapsed>1400&&elapsed<8000);}finally{await lock.query('ROLLBACK');lock.release();}
 for(const table of ['content_workspace','content_media_objects','content_revision_records','content_outbox','avatar_visuals'])assert.equal((await db.pool.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n,0);
 const art=await importPhase6Artwork(db.pool);assert.equal(art.receipt.rightsBasis,phase6RightsBasis);assert.equal(art.receipt.productionApproved,false);assert.equal((await db.pool.query('SELECT count(*)::int n FROM avatar_current_visuals')).rows[0].n,3);await assert.rejects(importPhase6Artwork(db.pool),{message:'PHASE6_UNEXPECTED_CONTENT_STATE'});
 await writeFile('docs/execution/avatar-phase6/import-local-proof.json',JSON.stringify({status:'PASS',boundedLockSqlstate:'55P03',elapsedMs:elapsed,rollbackRows:0,approvedVisuals:3,repeatedImportRefused:true,timeouts:art.receipt.timeouts,rightsBasis:phase6RightsBasis,hosted:false},null,2)+'\n');console.log('PASS Phase6 import bounded lock / rollback / exact3 / repeat denial');
}finally{await db.stop();}
