import {staffState,publicStamp} from '../../../lib/staff-runtime';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 const state=await staffState(request.headers);
 const headers={'Cache-Control':'private, no-store','Vary':'Cookie'};
 if(state.status!=='authorized')return Response.json({status:state.status},{status:state.status==='anonymous'?401:403,headers});
 return Response.json({status:state.status,stamp:publicStamp(state.stamp),role:state.principal.role,storeIds:state.principal.storeIds,permissions:state.principal.permissions},{headers});
}
