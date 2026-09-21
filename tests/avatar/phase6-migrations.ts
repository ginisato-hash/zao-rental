import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {startIsolatedPostgres} from '../../scripts/postgres';
import {avatarMigrationSources,avatarMigrationPreflight,applyAvatarMigrationTransaction} from '../../scripts/avatar-hosted-migrations';
const db=await startIsolatedPostgres(),results:string[]=[];
try{
 const sources=await avatarMigrationSources();
 for(const s of sources.slice(0,30)){await db.pool.query(s.sql);await db.pool.query('CREATE TABLE IF NOT EXISTS foundation_migrations(id text PRIMARY KEY,checksum text NOT NULL)');await db.pool.query('INSERT INTO foundation_migrations VALUES($1,$2)',[s.id,s.sha256]);}
 const prior=(await db.pool.query('SELECT * FROM foundation_migrations ORDER BY id')).rows;
 await avatarMigrationPreflight(db.pool,sources,db.identity.database,db.identity.user);results.push('exact historical0001-0030 preflight');
 await assert.rejects(avatarMigrationPreflight(db.pool,sources,'unexpected',db.identity.user));results.push('wrong database denied');
 await db.pool.query("UPDATE foundation_migrations SET checksum='synthetic-drift' WHERE id='0030'");await assert.rejects(avatarMigrationPreflight(db.pool,sources,db.identity.database,db.identity.user));await db.pool.query("UPDATE foundation_migrations SET checksum=$1 WHERE id='0030'",[sources[29]!.sha256]);results.push('checksum drift denied');
 await db.pool.query('CREATE TABLE avatar_visuals(synthetic int)');await assert.rejects(avatarMigrationPreflight(db.pool,sources,db.identity.database,db.identity.user));await db.pool.query('DROP TABLE avatar_visuals');results.push('partial object state denied');
 const broken=structuredClone(sources);broken[31]!.sql+='\nSELECT * FROM nonexistent_phase6_fixture;';
 await assert.rejects(applyAvatarMigrationTransaction(db.pool,broken,db.identity.database,db.identity.user),{sqlstate:'42P01',migrationId:'0032'});
 await avatarMigrationPreflight(db.pool,sources,db.identity.database,db.identity.user);results.push('0032 failure rolls back0031 and both history writes');
 assert.equal((await applyAvatarMigrationTransaction(db.pool,sources,db.identity.database,db.identity.user)).status,'PASS');
 assert.deepEqual((await db.pool.query("SELECT * FROM foundation_migrations WHERE id<='0030' ORDER BY id")).rows,prior);assert.equal((await db.pool.query('SELECT count(*)::int n FROM foundation_migrations')).rows[0].n,32);results.push('exact0031/0032 applied atomically without historical change');
 await assert.rejects(avatarMigrationPreflight(db.pool,sources,db.identity.database,db.identity.user));results.push('completed history refuses another dispatch');
 await writeFile('docs/execution/avatar-phase6/migration-local-proof.json',JSON.stringify({status:'PASS',checks:results,hosted:false,ownedResourcesClosed:true},null,2)+'\n');console.log('PASS '+results.length+' migration local PG cases');
}finally{await db.stop();}
