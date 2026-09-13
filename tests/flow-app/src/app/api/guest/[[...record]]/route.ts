import {GuestSecurity,guestPeerKey} from '../../../../../../../packages/core/src/guest/security';
import {publicRuntime,guestService} from '../../../../../../../apps/web/src/lib/public-runtime';
import {guestHandler} from '../../../../../../../apps/web/src/lib/guest-http';
import {testFlowService} from '../../../../../../flow/test-runtime';
export const dynamic='force-dynamic';
export const GET=async(r:Request)=>{if(process.env.NODE_ENV!=='development')throw new Error('TEST_COMPOSITION_FORBIDDEN');const p=publicRuntime();if(!p)return Response.json({error:'GUEST_PREVIEW_UNCONNECTED'},{status:503});return guestHandler(p.contexts,a=>guestService(a,testFlowService(a,p.guestPool)),p.r.config.origin,true,process.env.ZAO_TEST_PUBLIC_P1==='1'?{service:new GuestSecurity(p.guestPool,p.contexts,{version:'SYNTHETIC-P1-UI',contextSeconds:3600,absoluteSeconds:86400,recoverySeconds:7200,replaySeconds:300,retentionSeconds:3600,windowSeconds:60,peerRequests:100,globalRequests:1000},p.r.config.authSecret),peer:()=>guestPeerKey('SYNTHETIC-LOOPBACK',p.r.config.authSecret)}:undefined)(r);};
export const POST=GET;
