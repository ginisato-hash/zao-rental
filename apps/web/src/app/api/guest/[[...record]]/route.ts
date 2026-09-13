import {publicRuntime,guestService} from '../../../../lib/public-runtime';
import {guestHandler} from '../../../../lib/guest-http';
export const dynamic='force-dynamic';
export const GET=async(r:Request)=>{const p=publicRuntime();if(!p)return Response.json({error:'GUEST_PREVIEW_UNCONNECTED'},{status:503,headers:{'Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow'}});return guestHandler(p.contexts,guestService,p.r.config.origin)(r);};
export const POST=GET;
