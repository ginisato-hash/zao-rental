import {hostedPreviewRuntime,phase6Requested} from '../../../../lib/hosted-preview-runtime';
import {publicRuntime,guestService} from '../../../../lib/public-runtime';
import {guestHandler} from '../../../../lib/guest-http';
export const dynamic='force-dynamic';
export const GET=async(r:Request)=>{if(phase6Requested()){try{const h=(await hostedPreviewRuntime())!;return await guestHandler(h.contexts,h.service,h.origin,false,h.security)(r);}catch{return Response.json({error:'GUEST_PREVIEW_UNAVAILABLE'},{status:503,headers:{'Cache-Control':'private, no-store','X-Robots-Tag':'noindex, nofollow'}});}}const p=publicRuntime();if(!p)return Response.json({error:'GUEST_PREVIEW_UNCONNECTED'},{status:503,headers:{'Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow'}});return guestHandler(p.contexts,guestService,p.r.config.origin)(r);};
export const POST=GET;
