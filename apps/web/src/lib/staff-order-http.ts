import {createHash} from 'node:crypto';
import type {StaffPrincipal,StaffState} from '../../../../packages/auth/src/staff-auth';
import {HoldError} from '../../../../packages/contracts/src/hold';
import {exact} from '../../../../packages/contracts/src/pricing';
import {isContractError} from '../../../../packages/contracts/src/contract-error';
import {GROUP_JSON_BYTES} from '../../../../packages/contracts/src/http-body-limits';
import type {GuestBookingService} from '../../../../packages/core/src/guest/service';
import type {StaffOrderActor,StaffOrderDrafts} from '../../../../packages/core/src/operations/staff-order-drafts';
import {readJson} from './ledger-http';

const privateHeaders={'Cache-Control':'private, no-store','Vary':'Cookie','Referrer-Policy':'no-referrer'};
export type StaffOrderFactory=(principal:StaffPrincipal,identity:StaffOrderActor)=>{drafts:StaffOrderDrafts;service:GuestBookingService<StaffOrderActor>};

/** Staff New order API (Issue #47 consolidated order §6). Same steps and checks as the guest flow, run as the signed-in
 * staff member: the identity is the server-verified session from the staff stamp; the browser never supplies actor,
 * session, mode, merchant or location. Without the commercial composition every route answers 503 (no simulation). */
export function staffOrderHandler(state:(h:Headers)=>Promise<StaffState>,factory:StaffOrderFactory|null,origin:string){return async(req:Request)=>{try{
 const s=await state(req.headers);if(s.status!=='authorized')throw new HoldError('UNAUTHENTICATED',401);
 const has=(p:string)=>(s.principal.permissions as string[]).includes(p);if(!has('BOOKING_VIEW'))throw new HoldError('FORBIDDEN',403);
 const stamp=req.headers.get('x-zao-session');if(!stamp||stamp!==createHash('sha256').update(s.stamp).digest('hex'))throw new HoldError('SESSION_CHANGED',409);
 if(!factory)throw new HoldError('PAYMENT_NOT_CONNECTED_CHARGE_DISABLED',503);
 const url=new URL(req.url),path=url.pathname.slice('/api/staff-orders'.length);if(url.search)throw new HoldError('INVALID_QUERY',422);
 const [sessionId]=JSON.parse(s.stamp) as [string];const identity={subject:s.principal.subject,sessionId},{drafts,service:svc}=factory(s.principal,identity);
 const withCustomer=async()=>{const d=await drafts.read(identity);return {...await svc.get(),customerProfileId:drafts.customerProfileId(d)??null};};
 if(req.method==='GET'){if(path==='/draft')return Response.json(await withCustomer(),{headers:privateHeaders});if(path==='/options')return Response.json(await svc.options(),{headers:privateHeaders});throw new HoldError('NOT_FOUND',404);}
 if(req.method!=='POST')throw new HoldError('METHOD_NOT_ALLOWED',405);if(req.headers.get('origin')!==origin)throw new HoldError('ORIGIN_REJECTED',403);
 // Completing an order needs what the underlying steps need; the services re-check each permission themselves.
 if(!has('BOOKING_CREATE'))throw new HoldError('FORBIDDEN',403);
 const v=await readJson(req,GROUP_JSON_BYTES);let result:unknown;
 switch(path){
  case '/context':exact(v,[]);await drafts.open(identity);result=await withCustomer();break;
  case '/restart':exact(v,[]);await drafts.restart(identity);result=await withCustomer();break;
  case '/customer':{const b=exact(v,['draftId','expectedRevision','customerId']);await drafts.selectCustomer(identity,b.draftId,b.expectedRevision,b.customerId);result=await withCustomer();break;}
  case '/draft':await svc.save(v);result=await withCustomer();break;
  case '/preview':await svc.preview(v);result=await withCustomer();break;
  case '/selection':await svc.choose(v);result=await withCustomer();break;
  case '/accept-price':await svc.acceptPrice(v);result=await withCustomer();break;
  case '/prepare-payment':if(!svc.commercialEnabled())throw new HoldError('PAYMENT_NOT_CONNECTED_CHARGE_DISABLED',503);await svc.preparePayment(v);result=await withCustomer();break;
  case '/checkout':if(!svc.commercialEnabled())throw new HoldError('PAYMENT_NOT_CONNECTED_CHARGE_DISABLED',503);await svc.checkout(v);result=await withCustomer();break;
  case '/reconcile':exact(v,[]);await svc.reconcile();result=await withCustomer();break;
  default:throw new HoldError('NOT_FOUND',404);
 }
 return Response.json(result,{headers:privateHeaders});
}catch(e){const err=isContractError(e)?e:new HoldError('STAFF_ORDER_FAILED',500);return Response.json({error:err.code},{status:err.status,headers:privateHeaders});}};}
