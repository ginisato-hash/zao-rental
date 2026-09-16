import 'server-only';
import {publicRuntime} from './public-runtime';
import {avatarRuntime} from './avatar-runtime';
import {loadGuestAvatar} from '../../../../packages/core/src/avatar/guest';
import type {GuestAvatarBoundary} from './guest-avatar-http';
export function guestAvatarBoundary():GuestAvatarBoundary|null{
 const p=publicRuntime(),visuals=avatarRuntime();if(!p||!visuals)return null;
 return {load:(headers,scope)=>loadGuestAvatar(p.contexts,p.r.recommendationPool,visuals,headers,scope),
  reader:id=>({findForDelivery:(visualId,hash,now)=>visuals.findForDelivery(visualId,hash,now),readBytes:hash=>visuals.readBytes(id,hash)})};
}
