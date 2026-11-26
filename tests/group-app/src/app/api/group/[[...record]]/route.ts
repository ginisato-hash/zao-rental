import {groupHandler} from '../../../../../../../apps/web/src/lib/group-http';
import {groupBoundary} from '../../../../../../../apps/web/src/lib/group-runtime';
export const dynamic='force-dynamic';
// Test composition only: the per-peer budget can be lowered by the launcher to prove the rate limit end to end.
const peer=Number(process.env.ZAO_TEST_GROUP_PEER_LIMIT??'2000');
const handle=groupHandler(()=>{if(process.env.NODE_ENV!=='development')throw new Error('TEST_COMPOSITION_FORBIDDEN');return groupBoundary({peerRequests:peer,globalRequests:peer*10});});
export const GET=handle;
export const POST=handle;
