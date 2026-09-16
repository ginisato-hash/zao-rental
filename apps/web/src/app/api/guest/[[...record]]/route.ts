import {hostedPreviewUnavailable} from '../../../../lib/hosted-preview-diagnostics';
import {hostedPreviewRuntime,phase6Requested} from '../../../../lib/hosted-preview-runtime';
import {hostedPreviewRequestOrigin} from '../../../../../../../packages/auth/src/hosted-preview-config';
import {publicRuntime,guestService} from '../../../../lib/public-runtime';
import {guestHandler} from '../../../../lib/guest-http';
export const dynamic='force-dynamic';
export const GET=async(r:Request)=>{if(phase6Requested()){try{const origin=hostedPreviewRequestOrigin(r),h=(await hostedPreviewRuntime())!;return await guestHandler(h.contexts,h.service,origin,false,h.security)(r);}catch(e){return hostedPreviewUnavailable(e);}}const p=process.env.NODE_ENV==='production'?null:publicRuntime();if(!p)return Response.json({error:'GUEST_PREVIEW_UNCONNECTED'},{status:503,headers:{'Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow'}});return guestHandler(p.contexts,guestService,p.r.config.origin)(r);};
export const POST=GET;
