import type {StaffState} from '../../../../packages/auth/src/staff-auth';
import {canManage} from '../../../../packages/auth/src/staff-auth';
import type {StartupStage} from '../../../../packages/auth/src/production-config';
export type RuntimeReadiness={ready:boolean;stage:StartupStage};
const headers={'Cache-Control':'private, no-store','Vary':'Cookie','X-Robots-Tag':'noindex, nofollow'};
/** Public readiness deliberately reveals no component, identity or failure detail. */
export function readinessResponse(state:RuntimeReadiness){return Response.json({status:state.ready?'READY':'UNAVAILABLE'},{status:state.ready?200:503,headers});}
export function readinessDetails(state:RuntimeReadiness,staff:StaffState,components:unknown){
 if(staff.status!=='authorized'||!staff.principal)return Response.json({error:'UNAUTHENTICATED'},{status:401,headers});
 // Operations console readers see the same fixed safe enums; no component identity,
 // credential state, host or error detail is added for either audience.
 if(!canManage(staff.principal)&&!staff.principal.permissions.includes('OPERATIONS_VIEW'))return Response.json({error:'FORBIDDEN'},{status:403,headers});
 // Copy only the fixed safe enums, even if a future adapter adds diagnostic fields.
 const input=components&&typeof components==='object'?components as Record<string,unknown>:{};
 const allowed=['READY','UNAVAILABLE','OFF','CONFIGURED','CONFIGURED_ACTIVATION_PENDING','UNCONNECTED'];
 const safe=Object.fromEntries(['APP','DB','GUEST','PAYMENT_ADAPTER','MEDIA','NOTIFICATION'].map(k=>[k,typeof input[k]==='string'&&allowed.includes(input[k] as string)?input[k]:'UNAVAILABLE']));
 return Response.json({status:state.ready?'READY':'UNAVAILABLE',stage:state.stage,components:safe},{headers});
}
