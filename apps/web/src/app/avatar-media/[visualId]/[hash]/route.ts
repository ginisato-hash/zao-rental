import {staffState} from '../../../../lib/staff-runtime';
import {publicRuntime} from '../../../../lib/public-runtime';
import {avatarMediaHandler} from '../../../../lib/avatar-media-http';
import {PostgresAvatarVisuals} from '../../../../../../../packages/db/src/avatar-visuals';
export const dynamic='force-dynamic';
export const runtime='nodejs';
export const GET=avatarMediaHandler(staffState,()=>{
 const r=publicRuntime();if(!r)return null;const visuals=new PostgresAvatarVisuals(r.readPool);
 return {findForDelivery:(id,hash,now)=>visuals.findForDelivery(id,hash,now),async readBytes(hash){return (await r.readPool.query('SELECT bytes FROM content_media_objects WHERE sha256=$1',[hash])).rows[0]?.bytes??null;}};
});
