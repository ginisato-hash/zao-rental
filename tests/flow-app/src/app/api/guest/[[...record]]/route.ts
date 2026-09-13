import {publicRuntime,guestService} from '../../../../../../../apps/web/src/lib/public-runtime';
import {guestHandler} from '../../../../../../../apps/web/src/lib/guest-http';
import {testFlowService} from '../../../../../../flow/test-runtime';
export const dynamic='force-dynamic';
export const GET=async(r:Request)=>{if(process.env.NODE_ENV!=='development')throw new Error('TEST_COMPOSITION_FORBIDDEN');const p=publicRuntime();if(!p)return Response.json({error:'GUEST_PREVIEW_UNCONNECTED'},{status:503});return guestHandler(p.contexts,a=>guestService(a,testFlowService(a,p.guestPool)),p.r.config.origin,true)(r);};
export const POST=GET;
