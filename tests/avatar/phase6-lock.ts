import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {startIsolatedPostgres} from '../../scripts/postgres';
import {migrate} from '../../packages/db/src/index';
import {importLocalArtwork} from '../../scripts/avatar-artwork-local';
const db=await startIsolatedPostgres();
try{
 await migrate(db.pool);
 const lock=await db.pool.connect();
 let elapsed=0;
 try{
  await lock.query('BEGIN');await lock.query('LOCK TABLE content_workspace IN ACCESS EXCLUSIVE MODE');
  const start=performance.now();
  await assert.rejects(importLocalArtwork(db.pool),{code:'55P03'});
  elapsed=performance.now()-start;assert.ok(elapsed>=1400&&elapsed<8000);
 }finally{await lock.query('ROLLBACK');lock.release();}
 for(const table of ['content_workspace','content_media_objects','content_revision_records','content_outbox','avatar_visuals'])assert.equal((await db.pool.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n,0);
 const result=await importLocalArtwork(db.pool);assert.equal(result.metadata.length,3);
 assert.equal((await db.pool.query('SELECT count(*)::int n FROM avatar_current_visuals')).rows[0].n,3);
 await assert.rejects(importLocalArtwork(db.pool),{message:'ARTWORK_FRESH_CONTENT_REQUIRED'});
 assert.equal((await db.pool.query('SELECT count(*)::int n FROM avatar_visuals')).rows[0].n,3);
 await writeFile('docs/execution/avatar-phase6/lock-proof.json',JSON.stringify({status:'PASS',lockTimeoutMs:1500,statementTimeoutMs:5000,conflictingConnection:true,sqlstate:'55P03',elapsedMs:elapsed,failedImportRows:0,normalImportCount:3,repeatedImportRejected:true,cleanup:'Owned pools and PostgreSQL closed in finally'},null,2)+'\n');
 console.log('ARTWORK-1 bounded conflict / atomic rollback / normal import PASS');
}finally{await db.stop();}
