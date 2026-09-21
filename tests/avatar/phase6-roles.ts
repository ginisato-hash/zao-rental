import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {Pool} from 'pg';
import {startIsolatedPostgres} from '../../scripts/postgres';
import {migrate} from '../../packages/db/src/index';
import {provisionLocalAvatarRoles} from '../../scripts/avatar-hosted-roles';
import {proveAvatarRole} from '../../scripts/avatar-role-proof';
import {importLocalArtwork} from '../../scripts/avatar-artwork-local';
const db=await startIsolatedPostgres();let avatar:Pool|undefined;
try{
 await migrate(db.pool);const configs=await provisionLocalAvatarRoles(db.pool);avatar=new Pool(configs.avatar_read);
 const proof=await proveAvatarRole(avatar),art=await importLocalArtwork(db.pool);
 assert.equal((await avatar.query('SELECT count(*)::int n FROM avatar_current_visuals')).rows[0].n,3);
 for(const v of art.metadata)assert.ok((await avatar.query('SELECT avatar_visual_derivative($1,$2) bytes',[v.id,v.derivativeSha256])).rows[0].bytes.length>0);
 await assert.rejects(provisionLocalAvatarRoles(db.pool));
 await writeFile('docs/execution/avatar-phase6/roles-local-proof.json',JSON.stringify({...proof,approvedDerivativeCount:3,repeatedProvisionRejected:true,hosted:false},null,2)+'\n');console.log('PASS local Avatar role negative proof and exact3 approved bytes');
}finally{await avatar?.end();await db.stop();}
