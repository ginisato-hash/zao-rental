import 'server-only';
import {hostedPreviewRuntime,phase6Requested} from './hosted-preview-runtime';
import {avatarGuestSecurity} from '../../../../packages/core/src/avatar/guest-rate';
import {guestPeerKey} from '../../../../packages/core/src/guest/security';
import {publicRuntime} from './public-runtime';
import {avatarRuntime} from './avatar-runtime';
import {loadGuestAvatar} from '../../../../packages/core/src/avatar/guest';
import {assertLocalAvatarOrigin,type GuestAvatarBoundary} from './guest-avatar-http';
export async function guestAvatarBoundary():Promise<GuestAvatarBoundary|null>{
 if(phase6Requested())return (await hostedPreviewRuntime())!.avatar;
 if(process.env.NODE_ENV==='production')return null;
 const p=publicRuntime(),visuals=avatarRuntime();if(!p||!visuals)return null;
 const security=avatarGuestSecurity(p.guestPool,p.contexts,p.r.config.authSecret);
 return {guard:req=>{assertLocalAvatarOrigin(req,p.r.config.origin);return security.guard(guestPeerKey('127.0.0.1',p.r.config.authSecret));},load:(headers,scope)=>loadGuestAvatar(p.contexts,p.r.recommendationPool,visuals,headers,scope),
  reader:id=>({findForDelivery:(visualId,hash,now)=>visuals.findForDelivery(visualId,hash,now),readBytes:hash=>visuals.readBytes(id,hash)})};
}
