import {getRuntime,staffState,publicStamp} from '../../../../lib/staff-runtime';
import {readJson} from '../../../../lib/ledger-http';
import {listAccounts,writeAccount} from '../../../../../../../packages/auth/src/accounts';
import {canManage} from '../../../../../../../packages/auth/src/staff-auth';
import {LedgerError} from '../../../../../../../packages/contracts/src/ledger';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store','Vary':'Cookie'};
async function handle(request:Request){try{
 const state=await staffState(request.headers);if(state.status!=='authorized')throw new LedgerError('AUTHENTICATION_REQUIRED',401);
 const stamp=request.headers.get('x-zao-session');if(stamp&&stamp!==publicStamp(state.stamp))throw new LedgerError('SESSION_CHANGED',409);
 if(!canManage(state.principal))throw new LedgerError('FORBIDDEN',403);
 const runtime=getRuntime()!;const match=/^\/api\/staff-users(?:\/([a-f0-9-]{36}))?$/.exec(new URL(request.url).pathname);if(!match)throw new LedgerError('NOT_FOUND',404);
 const id=match[1];
 if(request.method==='GET'&&!id)return Response.json({items:await listAccounts(runtime.authPool,state.principal)},{headers});
 if(!['POST','PATCH'].includes(request.method)||(request.method==='PATCH')!==Boolean(id))throw new LedgerError('METHOD_NOT_ALLOWED',405);
 if(request.headers.get('origin')!==runtime.config.origin)throw new LedgerError('ORIGIN_REJECTED',403);
 const result=await writeAccount(runtime.authPool,state.principal,id,await readJson(request));return Response.json(result,{status:id?200:201,headers});
}catch(error){const known=error instanceof LedgerError?error:new LedgerError('STAFF_OPERATION_FAILED',500);return Response.json({error:known.code},{status:known.status,headers});}}
export const GET=handle;export const POST=handle;export const PATCH=handle;
