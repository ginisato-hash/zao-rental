import type {StaffState,StaffPrincipal} from '../../../../packages/auth/src/staff-auth';
import {createHash} from 'node:crypto';
import {TransferService} from '../../../../packages/core/src/transfer/transfer-service';
import {TransferError,object,type TransferOperation} from '../../../../packages/contracts/src/transfer';
import {HoldError} from '../../../../packages/contracts/src/hold';
import {LedgerError} from '../../../../packages/contracts/src/ledger';
import {readJson} from './ledger-http';
const headers={'Cache-Control':'private, no-store','Vary':'Cookie'};
export function transferHandler(state:(h:Headers)=>Promise<StaffState>,service:(p:StaffPrincipal)=>TransferService,origin:string){return async(request:Request)=>{
 try{const s=await state(request.headers);if(s.status!=='authorized')throw new TransferError(s.status==='anonymous'?'UNAUTHENTICATED':'FORBIDDEN',s.status==='anonymous'?401:403);
  if(!s.principal.permissions.includes('TRANSFER_VIEW'))throw new TransferError('FORBIDDEN',403);const stamp=request.headers.get('x-zao-session');if(stamp&&stamp!==createHash('sha256').update(s.stamp).digest('hex'))throw new TransferError('SESSION_CHANGED',409);
  const url=new URL(request.url),path=url.pathname.slice('/api/transfers'.length);if(url.search)throw new TransferError('INVALID_QUERY');const svc=service(s.principal);
  if(request.method==='GET')return Response.json(path===''?await svc.list():path==='/options'?await svc.options():await svc.get(path.slice(1)),{headers});
  if(request.method!=='POST')throw new TransferError('METHOD_NOT_ALLOWED',405);if(request.headers.get('origin')!==origin)throw new TransferError('ORIGIN_REJECTED',403);
  const match=/^\/([a-f0-9-]{36})\/(add|dispatch|receive|ready|cancel|issue)$/.exec(path);if(path!==''&&!match)throw new TransferError('NOT_FOUND',404);const body=object(await readJson(request),['requestKey','input']);if(typeof body.requestKey!=='string')throw new TransferError('INVALID_ID');
  return Response.json(await svc.command((match?.[2]??'create') as TransferOperation,body.requestKey,body.input,match?.[1]),{headers,status:path===''?201:200});
 }catch(e){const err=e instanceof HoldError||e instanceof LedgerError?e:new TransferError('TRANSFER_OPERATION_FAILED',500);return Response.json({error:err.code},{status:err.status,headers});}
};}
