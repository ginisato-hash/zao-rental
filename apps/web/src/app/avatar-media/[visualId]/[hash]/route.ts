import {staffState} from '../../../../lib/staff-runtime';
import {avatarRuntime} from '../../../../lib/avatar-runtime';
import {avatarMediaHandler} from '../../../../lib/avatar-media-http';
export const dynamic='force-dynamic';
export const runtime='nodejs';
export const GET=avatarMediaHandler(staffState,visualId=>{
 const visuals=avatarRuntime();if(!visuals)return null;
 return {findForDelivery:(id,hash,now)=>visuals.findForDelivery(id,hash,now),readBytes:hash=>visuals.readBytes(visualId,hash)};
});
