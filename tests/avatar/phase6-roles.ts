import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {Pool} from 'pg';
import {startIsolatedPostgres} from '../../scripts/postgres';
import {migrate} from '../../packages/db/src/index';
import {provisionLocalAvatarRoles} from '../../scripts/avatar-hosted-roles';
import {proveAvatarRole} from '../../scripts/avatar-role-proof';
import {importLocalArtwork} from '../../scripts/avatar-artwork-local';
const db=await startIsolatedPostgres();let avatar:Pool|undefined,hold:Pool|undefined;
try{
 await migrate(db.pool);const configs=await provisionLocalAvatarRoles(db.pool);avatar=new Pool(configs.avatar_read);
 hold=new Pool(configs.hold);
 for(const table of ['provisional_capacity_claims','provisional_capacity_buckets']){
  await hold.query(`SELECT * FROM ${table} LIMIT 0`);
  for(const sql of [`INSERT INTO ${table} DEFAULT VALUES`,`UPDATE ${table} SET id=DEFAULT WHERE false`,`DELETE FROM ${table} WHERE false`])await assert.rejects(hold.query(sql),(e:{code?:string})=>e.code==='42501');
 }
 await hold.query("SELECT provisional_capacity_effective_quantity('00000000-0000-4000-8000-000000000001'::uuid)");
 const proof=await proveAvatarRole(avatar),art=await importLocalArtwork(db.pool);
 assert.equal((await avatar.query('SELECT count(*)::int n FROM avatar_current_visuals')).rows[0].n,3);
 for(const v of art.metadata)assert.ok((await avatar.query('SELECT avatar_visual_derivative($1,$2) bytes',[v.id,v.derivativeSha256])).rows[0].bytes.length>0);
 await assert.rejects(provisionLocalAvatarRoles(db.pool));
 await writeFile('docs/execution/avatar-phase6/roles-local-proof.json',JSON.stringify({...proof,approvedDerivativeCount:3,repeatedProvisionRejected:true,hosted:false},null,2)+'\n');console.log('PASS local Avatar role negative proof and exact3 approved bytes');
}finally{await avatar?.end();await hold?.end();await db.stop();}
