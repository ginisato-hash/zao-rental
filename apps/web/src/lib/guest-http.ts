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
export function guestHandler(contexts:GuestContexts,service:(a:GuestActor)=>GuestBookingService,origin:string,simulation=false){return async(req:Request)=>{try{
 const url=new URL(req.url),path=url.pathname.slice('/api/guest'.length);if(url.search)throw new HoldError('INVALID_QUERY',422);
 if(!['GET','POST'].includes(req.method))throw new HoldError('METHOD_NOT_ALLOWED',405);
 if(req.method==='POST'&&(req.headers.get('origin')!==origin||req.headers.get('sec-fetch-site')==='cross-site'))throw new HoldError('ORIGIN_REJECTED',403);
 if(req.method==='POST'&&path==='/context'){const body=await readJson(req);if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length)throw new HoldError('INVALID_INPUT');
  const existing=guestToken(req.headers);if(existing){try{const actor=await contexts.resolve(existing);return Response.json({created:false,draft:await service(actor).get(),simulation},{headers:privateHeaders});}catch(e){if(!(e instanceof HoldError)||e.status!==401)throw e;}}
  const c=await contexts.create(),actor=await contexts.resolve(c.token);return Response.json({created:true,draft:await service(actor).get(),simulation},{status:201,headers:{...privateHeaders,'Set-Cookie':guestCookie(c.token,origin.startsWith('https:'))}});}
 const actor=await contexts.resolve(guestToken(req.headers)),svc=service(actor);
 if(req.method==='GET'){if(path==='/draft')return Response.json({...await svc.get(),simulation},{headers:privateHeaders});if(path==='/options')return Response.json(await svc.options(),{headers:privateHeaders});throw new HoldError('NOT_FOUND',404);}
 const v=await readJson(req,GROUP_JSON_BYTES);let result:unknown;
 switch(path){case '/draft':result=await svc.save(v);break;case '/preview':result=await svc.preview(v);break;case '/selection':result=await svc.choose(v);break;case '/accept-price':result=await svc.acceptPrice(v);break;case '/checkout':if(!simulation)throw new HoldError('PAYMENT_NOT_CONNECTED_CHARGE_DISABLED',503);result=await svc.checkout(v);break;case '/reconcile':exact(v,[]);if(!simulation)throw new HoldError('PAYMENT_NOT_CONNECTED_CHARGE_DISABLED',503);result=await svc.reconcile();break;case '/logout':exact(v,[]);await contexts.revoke(actor);return Response.json({revoked:true},{headers:{...privateHeaders,'Set-Cookie':guestCookie('',origin.startsWith('https:'),true)}});default:throw new HoldError('NOT_FOUND',404);}
 return Response.json(result,{headers:privateHeaders});
 }catch(e){const err=e instanceof HoldError||e instanceof FlowError||e instanceof LedgerError?e:new HoldError('GUEST_OPERATION_FAILED',500);return Response.json({error:err.code},{status:err.status,headers:privateHeaders});}};}
