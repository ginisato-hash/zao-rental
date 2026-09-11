import 'server-only';
import {ledgerHandler} from './ledger-http';
import {getRuntime,staffState,publicStamp} from './staff-runtime';
import {LedgerService} from '../../../../packages/core/src/catalog/ledger-service';
import {ledgerPrincipal} from '../../../../packages/auth/src/staff-auth';
import {LedgerError} from '../../../../packages/contracts/src/ledger';
export async function handleLedger(request:Request){
 const runtime=getRuntime();
 const handler=ledgerHandler(async()=>{
  const state=await staffState(request.headers);
  if(state.status!=='authorized'){if(state.status!=='anonymous')throw new LedgerError('FORBIDDEN',403);return null;}
  if(['POST','PATCH'].includes(request.method)&&!/^\/api\/ledger\/(assets|poles)(?:\/|$)/.test(new URL(request.url).pathname)&&state.principal.scope!=='ALL')throw new LedgerError('FORBIDDEN',403);
  // Any stale browser session/scope must discard prior data, including requests already in flight.
  const stamp=request.headers.get('x-zao-session');
  if(stamp&&stamp!==publicStamp(state.stamp))throw new LedgerError('SESSION_CHANGED',409);
  if(!state.principal.permissions.includes('INVENTORY_VIEW'))throw new LedgerError('FORBIDDEN',403);
  return ledgerPrincipal(state.principal);
 },principal=>{
  if(!runtime)throw new LedgerError('STORAGE_NOT_CONNECTED',503);
  return new LedgerService(runtime.ledgerPool,principal);
 },runtime?.config.origin);
 const response=await handler(request);
 if(response.status===404&&/^\/api\/ledger\/(assets|poles)\/[a-f0-9-]{36}$/.test(new URL(request.url).pathname))return Response.json({error:'FORBIDDEN'},{status:403,headers:{'Cache-Control':'private, no-store','Vary':'Cookie'}});
 return response;
}
