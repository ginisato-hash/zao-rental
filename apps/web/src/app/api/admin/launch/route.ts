import {getRuntime,staffState} from '../../../../lib/staff-runtime';
import {getProductionRuntime} from '../../../../lib/production-runtime';
import {OperationsContext} from '../../../../../../../packages/core/src/operations/context';
import {LaunchGate} from '../../../../../../../packages/core/src/operations/launch-gate';
import {FlowError,flowId} from '../../../../../../../packages/contracts/src/rental-flow';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store','Vary':'Cookie','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow'};
/** Read-only gate. It reports state and accepts no action, secret or activation. */
export async function GET(request:Request){
 try{
  const s=await staffState(request.headers);if(s.status!=='authorized')throw new FlowError('UNAUTHENTICATED',401);
  if(!s.principal.permissions.includes('OPERATIONS_VIEW'))throw new FlowError('FORBIDDEN',403);
  const r=getRuntime();if(!r?.operationsPool)throw new FlowError('OPERATIONS_UNCONNECTED',503);
  const url=new URL(request.url);if([...url.searchParams.keys()].some(k=>k!=='runId'))throw new FlowError('INVALID_QUERY',422);
  const runId=url.searchParams.get('runId');if(runId!==null)flowId(runId);
  const [sessionId]=JSON.parse(s.stamp) as [string];
  const gate=new LaunchGate(new OperationsContext(r.operationsPool,r.authPool,{subject:s.principal.subject,sessionId}));
  // Backup provider metadata is supplied only when a connection gate has been recorded.
  return Response.json(await gate.status({runId,components:getProductionRuntime()?.safeStatus()??null,backup:null}),{headers});
 }catch(e){const error=e instanceof FlowError?e:new FlowError('LAUNCH_GATE_FAILED',500);return Response.json({error:error.code},{status:error.status,headers});}
}
