import {createHash} from 'node:crypto';
import type {StaffState} from '../../../../packages/auth/src/staff-auth';
import type {BookingService,FlowIdentity} from '../../../../packages/core/src/payment/booking-service';
import {FlowError,flowId,flowObject} from '../../../../packages/contracts/src/rental-flow';
import {LedgerError} from '../../../../packages/contracts/src/ledger';
import {readJson} from './ledger-http';
const privateHeaders={'Cache-Control':'private, no-store','Vary':'Cookie','Referrer-Policy':'no-referrer'};
export function bookingHandler(state:(h:Headers)=>Promise<StaffState>,service:(identity:FlowIdentity)=>BookingService,origin:string,composition:'UNCONNECTED'|'ISOLATED_TEST'='UNCONNECTED'){return async(request:Request)=>{try{
 const s=await state(request.headers);if(s.status!=='authorized')throw new FlowError('UNAUTHENTICATED',401);if(!s.principal.permissions.includes('BOOKING_VIEW'))throw new FlowError('FORBIDDEN',403);const stamp=request.headers.get('x-zao-session');if(stamp&&stamp!==createHash('sha256').update(s.stamp).digest('hex'))throw new FlowError('SESSION_CHANGED',409);
 const url=new URL(request.url),path=url.pathname.slice('/api/bookings'.length);if(url.search)throw new FlowError('INVALID_QUERY',422);
 if(request.method==='GET'&&path==='/capabilities')return Response.json({mode:composition,chargeReady:false,simulated:composition==='ISOLATED_TEST',rental:composition==='ISOLATED_TEST'?'SYNTHETIC_CUSTODY':'UNCONNECTED'}, {headers:privateHeaders});
 if(composition!=='ISOLATED_TEST')throw new FlowError('PAYMENT_NOT_CONNECTED_CHARGE_DISABLED',503);
 // stamp was obtained from the server-verified session, never from a submitted subject/role/store.
 const [sessionId]=JSON.parse(s.stamp) as [string,unknown];const svc=service({subject:s.principal.subject,sessionId});
 if(request.method==='GET')return Response.json(path===''?await svc.list():await svc.get(path.slice(1)),{headers:privateHeaders});
 if(request.method!=='POST')throw new FlowError('METHOD_NOT_ALLOWED',405);if(request.headers.get('origin')!==origin)throw new FlowError('ORIGIN_REJECTED',403);if(!s.principal.permissions.includes('BOOKING_CREATE'))throw new FlowError('FORBIDDEN',403);
 const raw=await readJson(request);let result:unknown;
 if(path===''){const b=flowObject(raw,['requestKey','quoteId','contact']);flowId(b.requestKey);flowId(b.quoteId);result=await svc.create(b.requestKey,b.quoteId,b.contact);}
 else{const m=/^\/([a-f0-9-]{36})\/(payment|reconcile)$/.exec(path);if(!m)throw new FlowError('NOT_FOUND',404);flowId(m[1]);if(m[2]==='payment'){const b=flowObject(raw,['requestKey']);flowId(b.requestKey);result=await svc.startPayment(m[1],b.requestKey);}else{flowObject(raw,[]);result=await svc.reconcile(m[1]);}}
 return Response.json(result,{status:path===''?201:200,headers:privateHeaders});
 }catch(e){const err=e instanceof FlowError||e instanceof LedgerError?e:new FlowError('BOOKING_OPERATION_FAILED',500);return Response.json({error:err.code},{status:err.status,headers:privateHeaders});}};}
