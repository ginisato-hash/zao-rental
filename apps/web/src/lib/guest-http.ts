import type {GuestSecurity} from '../../../../packages/core/src/guest/security';
import {GuestContexts,guestToken,guestCookie} from '../../../../packages/core/src/guest/context';
import type {GuestBookingService} from '../../../../packages/core/src/guest/service';
import type {GuestActor} from '../../../../packages/auth/src/booking-actor';
import {HoldError} from '../../../../packages/contracts/src/hold';
import {exact} from '../../../../packages/contracts/src/pricing';
import {FlowError} from '../../../../packages/contracts/src/rental-flow';
import {LedgerError} from '../../../../packages/contracts/src/ledger';
import {GROUP_JSON_BYTES} from '../../../../packages/contracts/src/http-body-limits';
import {readJson} from './ledger-http';
const privateHeaders={'Cache-Control':'private, no-store','Vary':'Cookie','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow'};
export function guestHandler(contexts:GuestContexts,service:(a:GuestActor)=>GuestBookingService,origin:string,simulation=false,security?:{service:GuestSecurity;peer:(r:Request)=>string|undefined},recoveryEnabled=true){return async(req:Request)=>{try{
 if(process.env.NODE_ENV==='production'&&(!security||simulation||!origin.startsWith('https:')))throw new HoldError('GUEST_SECURITY_UNCONFIGURED',503);
 const url=new URL(req.url),path=url.pathname.slice('/api/guest'.length);if(url.search)throw new HoldError('INVALID_QUERY',422);
 if(!['GET','POST'].includes(req.method))throw new HoldError('METHOD_NOT_ALLOWED',405);
 if(req.method==='POST'&&(req.headers.get('origin')!==origin||req.headers.get('sec-fetch-site')==='cross-site'))throw new HoldError('ORIGIN_REJECTED',403);
 if(security)await security.service.guard(security.peer(req));
 if(!recoveryEnabled&&['/recover','/recovery-code'].includes(path))throw new HoldError('RECOVERY_UNCONNECTED',503);
 if(req.method==='POST'&&path==='/recover'){if(!security)throw new HoldError('RECOVERY_UNCONNECTED',503);const v=exact(await readJson(req),['code','requestId']);const c=await security.service.recover(v.code,v.requestId);return Response.json({recovered:true,replayed:c.replayed},{headers:{...privateHeaders,'Set-Cookie':guestCookie(c.token,origin.startsWith('https:'),false,c.maxAgeSeconds)}});}
 if(req.method==='POST'&&path==='/context'){const body=await readJson(req);if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length)throw new HoldError('INVALID_INPUT');
  const existing=guestToken(req.headers);if(existing){try{const actor=await contexts.resolve(existing);return Response.json({created:false,draft:await service(actor).get(),simulation},{headers:privateHeaders});}catch(e){if(!(e instanceof HoldError)||e.status!==401)throw e;}}
  const c=security?await security.service.create():await contexts.create(),actor=await contexts.resolve(c.token);return Response.json({created:true,draft:await service(actor).get(),simulation},{status:201,headers:{...privateHeaders,'Set-Cookie':guestCookie(c.token,origin.startsWith('https:'),false,security?.service.policy.contextSeconds)}});}
 const actor=await contexts.resolve(guestToken(req.headers)),svc=service(actor);
 if(req.method==='GET'){if(path==='/security'){if(!security)throw new HoldError('RECOVERY_UNCONNECTED',503);return Response.json(await security.service.metadata(actor),{headers:privateHeaders});}if(path==='/draft')return Response.json({...await svc.get(),simulation},{headers:privateHeaders});if(path==='/options')return Response.json(await svc.options(),{headers:privateHeaders});throw new HoldError('NOT_FOUND',404);}
 const v=await readJson(req,GROUP_JSON_BYTES);let result:unknown;
 switch(path){case '/cancellation-preview':exact(v,[]);result=await svc.cancellationPreview();break;case '/cancel':result=await svc.cancel(v);break;case '/recovery-code':{if(!security)throw new HoldError('RECOVERY_UNCONNECTED',503);const body=exact(v,['expectedRevision']);result=await security.service.enroll(actor,body.expectedRevision);break;}case '/draft':result=await svc.save(v);break;case '/preview':result=await svc.preview(v);break;case '/selection':result=await svc.choose(v);break;case '/accept-price':result=await svc.acceptPrice(v);break;case '/checkout':if(!simulation&&!svc.commercialEnabled())throw new HoldError('PAYMENT_NOT_CONNECTED_CHARGE_DISABLED',503);result=await svc.checkout(v);break;case '/reconcile':exact(v,[]);if(!simulation&&!svc.commercialEnabled())throw new HoldError('PAYMENT_NOT_CONNECTED_CHARGE_DISABLED',503);result=await svc.reconcile();break;case '/logout':exact(v,[]);await contexts.revoke(actor);return Response.json({revoked:true},{headers:{...privateHeaders,'Set-Cookie':guestCookie('',origin.startsWith('https:'),true)}});default:throw new HoldError('NOT_FOUND',404);}
 return Response.json(result,{headers:privateHeaders});
 }catch(e){const err=e instanceof HoldError||e instanceof FlowError||e instanceof LedgerError?e:new HoldError('GUEST_OPERATION_FAILED',500);return Response.json({error:err.code},{status:err.status,headers:{...privateHeaders,...(err.status===429?{'Retry-After':String(security?.service.policy.windowSeconds??60)}:{})}});}};}
