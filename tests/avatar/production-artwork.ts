import assert from 'node:assert/strict';
import {startIsolatedPostgres} from '../../scripts/postgres';
import {migrate} from '../../packages/db/src/index';
import {applyProductionAvatarArtwork,productionAvatarRightsBasis} from '../../scripts/production-avatar-artwork';
import {PostgresAvatarVisuals} from '../../packages/db/src/avatar-visuals';
import {provisionAvatarReadRole} from '../../scripts/avatar-read-role';
const db=await startIsolatedPostgres();
let role:Awaited<ReturnType<typeof provisionAvatarReadRole>>|undefined;
try{
 await migrate(db.pool);const c=await db.pool.connect();
 try{
  await assert.rejects(applyProductionAvatarArtwork(c,'wrong_database',db.identity.user),{message:'PRODUCTION_AVATAR_OWNER_IDENTITY'});
  const lock=await db.pool.connect();try{await lock.query('BEGIN');await lock.query('LOCK TABLE content_workspace IN ACCESS EXCLUSIVE MODE');await assert.rejects(applyProductionAvatarArtwork(c,db.identity.database,db.identity.user),{code:'55P03'});}finally{await lock.query('ROLLBACK');lock.release();}
  for(const table of ['content_workspace','content_media_objects','content_revision_records','content_outbox','avatar_visuals'])assert.equal((await c.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n,0);
  const receipt=await applyProductionAvatarArtwork(c,db.identity.database,db.identity.user);assert.equal(receipt.rightsBasis,productionAvatarRightsBasis);assert.equal(receipt.bindings.length,3);
  role=await provisionAvatarReadRole(db.pool,db.identity);const visuals=new PostgresAvatarVisuals(role.avatarPool);
  assert.equal((await visuals.read([],new Date())).length,3);
  for(const b of receipt.bindings){assert.ok(await visuals.findForDelivery(b.visualId,b.derivativeSha256,new Date()));assert.ok((await visuals.readBytes(b.visualId,b.derivativeSha256))!.length>0);}
  await assert.rejects(applyProductionAvatarArtwork(c,db.identity.database,db.identity.user),{message:'PRODUCTION_AVATAR_EXISTING_CONTENT_RECONCILE'});
  const state=(await c.query('SELECT value FROM content_workspace')).rows[0].value;
  for(const m of state.catalog.media)m.rightsConfirmed=false;
  await c.query('UPDATE content_workspace SET value=$1',[JSON.stringify(state)]);assert.equal((await visuals.read([],new Date())).length,0);
  for(const b of receipt.bindings)assert.equal(await visuals.readBytes(b.visualId,b.derivativeSha256),null);
  console.log('PASS exact public artwork intake, owner/lock refusal, transaction rollback, three eligible images, repeated-import denial and rights revocation; owned local PostgreSQL only');
 }finally{c.release();}
}finally{await role?.close();await db.stop();}
