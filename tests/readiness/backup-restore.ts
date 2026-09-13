import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {writeFile,mkdir} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import type {Pool} from 'pg';
import {flowFixture} from '../flow/fixture';
import {migrate} from '../../packages/db/src/index';
import {canonical} from '../../packages/contracts/src/hold';
import {restoreEvidence} from '../../packages/contracts/src/production-operations';
import {backupOwnedCluster,restoreOwnedCluster} from '../../scripts/isolated-backup';
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
async function fingerprint(pool:Pool){const tables=(await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows as {tablename:string}[];const values:Record<string,{rows:number;sha256:string}>={};for(const {tablename} of tables){assert.match(tablename,/^[A-Za-z_][A-Za-z0-9_]*$/);const rows=(await pool.query('SELECT to_jsonb(t) AS value FROM public."'+tablename+'" t')).rows.map(r=>canonical(r.value)).sort();values[tablename]={rows:rows.length,sha256:hash(canonical(rows))};}return values;}
let x:Awaited<ReturnType<typeof flowFixture>>|undefined,restored:Awaited<ReturnType<typeof restoreOwnedCluster>>|undefined,sourceStopped=false,appPoolsClosed=false,failed=false,stage='setup';
try{
 x=await flowFixture();await x.draft();const before=await fingerprint(x.db.pool),migration=(await x.db.pool.query('SELECT * FROM foundation_migrations ORDER BY id')).rows,major=(await x.db.pool.query('SHOW server_version_num')).rows[0].server_version_num;
 // All application-role pools close before the physical cluster stop/copy.
 await x.flow.close();await x.roles.close();appPoolsClosed=true;stage='cold backup';const backup=await backupOwnedCluster(x.db,()=>{sourceStopped=true;});
 console.log('PASS stopped owned source before verified cold backup; no live-file copying');
 stage='corruption gate';await assert.rejects(restoreOwnedCluster({...backup,sha256:'0'.repeat(64)}),/RESTORE_DIGEST_MISMATCH/);console.log('PASS corrupt backup digest stops before restore/start');
 stage='restore';const start=performance.now();restored=await restoreOwnedCluster(backup);assert.notEqual(restored.directory,backup.source);assert.deepEqual(await fingerprint(restored.pool),before);assert.deepEqual((await restored.pool.query('SELECT * FROM foundation_migrations ORDER BY id')).rows,migration);assert.equal((await restored.pool.query('SHOW server_version_num')).rows[0].server_version_num,major);
 console.log('PASS restored all tables/rows and immutable migration checksums into a new isolated directory');
 stage='pre-migration restore';await migrate(restored.pool);assert.deepEqual(await fingerprint(restored.pool),before);
 const c=await restored.pool.connect();try{await c.query('BEGIN');await c.query('CREATE TABLE synthetic_failed_migration(id int)');await assert.rejects(c.query('SELECT definitely_missing_function()'));await c.query('ROLLBACK');}finally{c.release();}
 assert.equal((await restored.pool.query("SELECT to_regclass('public.synthetic_failed_migration') t")).rows[0].t,null);assert.deepEqual(await fingerprint(restored.pool),before);
 console.log('PASS pre-migration backup restored; migration replay and failed-DDL rollback preserve inventory/payment/audit tables');
 const proof=restoreEvidence({backupSha256:backup.sha256,schemaSha256:hash(canonical(migration)),sourceIdentity:backup.source.split('/').slice(-2).join('/'),restoredIdentity:restored.directory.split('/').slice(-2).join('/'),integrityPassed:true,verifiedAt:new Date().toISOString(),method:'COLD_CLUSTER_SAME_MAJOR',rpoSeconds:0,rtoSeconds:(performance.now()-start)/1000});
 await mkdir('.local/benchmarks',{recursive:true});await writeFile('.local/benchmarks/p2-restore.json',JSON.stringify({...proof,tableCount:Object.keys(before).length,rowCount:Object.values(before).reduce((n,t)=>n+t.rows,0),syntheticOnly:true,productionBackup:false,rolesWithinSameCluster:true,providerRestore:false,physicalBackupContainsSyntheticSecrets:true,backupExcludedFromArtifacts:true},null,2)+'\n');
 console.log('P2 isolated backup/restore: 4 cases passed; synthetic cold same-major cluster, not production SLA or provider restore.');
}catch(e){failed=true;console.error('P2_RESTORE_FAILED '+stage+' '+(e as Error).name);console.error((e as Error).stack?.split('\n').filter(s=>s.includes('/tests/readiness/')||s.includes('/scripts/isolated-backup')).join('\n'));}finally{await restored?.stop();if(x&&!sourceStopped){if(appPoolsClosed)await x.db.stop();else await x.close();}console.log('Owned backup/restore source and restored PostgreSQL stopped.');}if(failed)process.exit(1);
