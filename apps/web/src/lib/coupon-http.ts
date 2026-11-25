import type {StaffState,StaffPrincipal} from '../../../../packages/auth/src/staff-auth';
import {createHash} from 'node:crypto';
import {PricingError,exact,id,parseCoupon} from '../../../../packages/contracts/src/pricing';
import {HoldError} from '../../../../packages/contracts/src/hold';
import {readJson} from './ledger-http';

// Coupon administration API. Terms are immutable (coupon_versions): "edit" means switching active/inactive; changed terms are a new code.
export interface CouponAdminService{
 listCoupons():Promise<unknown>;
 createCoupon(couponId:string,input:unknown):Promise<unknown>;
 setCouponActive(couponId:string,input:{active:boolean;reason?:string},requestKey?:string):Promise<unknown>;
}
const headers={'Cache-Control':'private, no-store','Vary':'Cookie'};
const REASON_MAX=160;
export function couponHandler(state:(h:Headers)=>Promise<StaffState>,service:(p:StaffPrincipal)=>CouponAdminService,origin:string){return async(request:Request)=>{try{
 const s=await state(request.headers);if(s.status!=='authorized')throw new PricingError(s.status==='anonymous'?'UNAUTHENTICATED':'FORBIDDEN',s.status==='anonymous'?401:403);
 if(!s.principal.permissions.includes('QUOTE_VIEW'))throw new PricingError('FORBIDDEN',403);
 const stamp=request.headers.get('x-zao-session');if(stamp&&stamp!==createHash('sha256').update(s.stamp).digest('hex'))throw new PricingError('SESSION_CHANGED',409);
 const url=new URL(request.url);if(url.pathname!=='/api/coupons')throw new PricingError('NOT_FOUND',404);if(url.search)throw new PricingError('INVALID_QUERY');
 const svc=service(s.principal),canEdit=s.principal.permissions.includes('PRICE_EDIT')&&s.principal.role==='ADMIN'&&s.principal.scope==='ALL';
 if(request.method==='GET'){const v=await svc.listCoupons() as Record<string,unknown>;return Response.json({...v,canEdit},{headers});}
 if(request.method!=='POST')throw new PricingError('METHOD_NOT_ALLOWED',405);
 if(request.headers.get('origin')!==origin)throw new PricingError('ORIGIN_REJECTED',403);
 if(!canEdit)throw new PricingError('FORBIDDEN',403);
 const body=exact(await readJson(request),['requestKey','input']);id(body.requestKey);
 const input=body.input;if(!input||typeof input!=='object'||Array.isArray(input))throw new PricingError('INVALID_INPUT');
 const op=(input as {operation?:unknown}).operation;
 if(op==='create'){const t=exact(input,['operation','terms']).terms;parseCoupon(t);return Response.json(await svc.createCoupon(body.requestKey as string,t),{headers,status:201});}
 if(op==='setActive'){const v=exact(input,['operation','couponId','active','reason']);id(v.couponId);if(typeof v.active!=='boolean')throw new PricingError('INVALID_INPUT');
  const reason=v.reason===null||v.reason===undefined?undefined:v.reason;if(reason!==undefined&&(typeof reason!=='string'||reason.length>REASON_MAX))throw new PricingError('INVALID_INPUT');
  return Response.json(await svc.setCouponActive(v.couponId as string,{active:v.active,...(reason?{reason:reason.trim()}:{})},body.requestKey as string),{headers});}
 throw new PricingError('INVALID_INPUT');
 }catch(e){const err=e instanceof HoldError?e:new PricingError('COUPON_OPERATION_FAILED',500);return Response.json({error:err.code},{status:err.status,headers});}};}
