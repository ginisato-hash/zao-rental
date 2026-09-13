import {createHash} from 'node:crypto';
import type {StaffState} from '../../../../packages/auth/src/staff-auth';
import type {CustodyService} from '../../../../packages/core/src/rental/custody-service';
import type {FlowIdentity} from '../../../../packages/core/src/payment/booking-service';
import {FlowError,flowId,flowObject} from '../../../../packages/contracts/src/rental-flow';
import {LedgerError} from '../../../../packages/contracts/src/ledger';
import {readJson} from './ledger-http';
const privateHeaders={'Cache-Control':'private, no-store','Vary':'Cookie','Referrer-Policy':'no-referrer'};
export function custodyHandler(state:(h:Headers)=>Promise<StaffState>,service:(id:FlowIdentity)=>CustodyService,origin:string,composition:'UNCONNECTED'|'ISOLATED_TEST'='UNCONNECTED'){return async(request:Request)=>{try{
 const s=await state(request.headers);if(s.status!=='authorized')throw new FlowError('UNAUTHENTICATED',401);if(!s.principal.permissions.includes('BOOKING_VIEW'))throw new FlowError('FORBIDDEN',403);
 const stamp=request.headers.get('x-zao-session');if(stamp&&stamp!==createHash('sha256').update(s.stamp).digest('hex'))throw new FlowError('SESSION_CHANGED',409);
 if(composition!=='ISOLATED_TEST')throw new FlowError('DEVELOPMENT_CUSTODY_NOT_CONNECTED',503);
 const [sessionId]=JSON.parse(s.stamp) as [string,unknown],svc=service({subject:s.principal.subject,sessionId}),url=new URL(request.url),path=url.pathname.slice('/api/custody'.length);
 if(request.method==='GET'){
  if(path==='/returns'&&[...url.searchParams.keys()].join() ==='store')return Response.json(await svc.returns(url.searchParams.get('store')!),{headers:privateHeaders});
  if(url.search)throw new FlowError('INVALID_QUERY',422);
  const m=/^\/(booking|batch)\/([a-f0-9-]{36})$/.exec(path);if(!m)throw new FlowError('NOT_FOUND',404);
  return Response.json(m[1]==='booking'?await svc.checkoutView(m[2]!):await svc.getBatch(m[2]!),{headers:privateHeaders});
 }
 if(request.method!=='POST')throw new FlowError('METHOD_NOT_ALLOWED',405);if(request.headers.get('origin')!==origin)throw new FlowError('ORIGIN_REJECTED',403);if(url.search)throw new FlowError('INVALID_QUERY',422);
 const body=flowObject(await readJson(request),['requestKey','input']);flowId(body.requestKey);
 let result:unknown;
 switch(path){case '/complete-no-pickup':result=await svc.completeNoPickup(body.requestKey,body.input);break;case '/prepare':result=await svc.prepare(body.requestKey,body.input);break;case '/checkout':result=await svc.checkout(body.requestKey,body.input);break;case '/batch':{const v=flowObject(body.input,['store']);if(typeof v.store!=='string')throw new FlowError('INVALID_STORE',422);result=await svc.createBatch(body.requestKey,v.store);break;}case '/scan':result=await svc.scan(body.requestKey,body.input);break;case '/confirm':result=await svc.confirm(body.requestKey,body.input);break;case '/inspection':result=await svc.inspection(body.requestKey,body.input);break;default:throw new FlowError('NOT_FOUND',404);}
 return Response.json(result,{headers:privateHeaders});
 }catch(e){const err=e instanceof FlowError||e instanceof LedgerError?e:new FlowError('CUSTODY_OPERATION_FAILED',500);return Response.json({error:err.code},{status:err.status,headers:privateHeaders});}};}
