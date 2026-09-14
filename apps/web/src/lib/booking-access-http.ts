import type {BookingRecovery} from '../../../../packages/core/src/guest/booking-recovery';
import QRCode from 'qrcode';
import {BookingAccess,bookingAccessCookie,bookingAccessToken} from '../../../../packages/core/src/guest/booking-access';
import {GuestContexts,guestToken} from '../../../../packages/core/src/guest/context';
import {FlowError} from '../../../../packages/contracts/src/rental-flow';
import {HoldError} from '../../../../packages/contracts/src/hold';
import {exact} from '../../../../packages/contracts/src/pricing';
import {readJson} from './ledger-http';
const headers={'Cache-Control':'private, no-store','Vary':'Cookie','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow'};
export function bookingAccessHandler(access:BookingAccess,contexts:GuestContexts,origin:string,guard?:(r:Request)=>Promise<void>,recovery?:BookingRecovery){return async(req:Request)=>{
 try{
  if(process.env.NODE_ENV==='production'&&(!guard||!origin.startsWith('https:')))throw new FlowError('BOOKING_ACCESS_UNCONFIGURED',503);
  const url=new URL(req.url),path=url.pathname.slice('/api/booking-access'.length);
  if(url.search)throw new FlowError('INVALID_QUERY',422);
  if(!['GET','POST'].includes(req.method))throw new FlowError('METHOD_NOT_ALLOWED',405);
  if(req.method==='POST'&&(req.headers.get('origin')!==origin||req.headers.get('sec-fetch-site')==='cross-site'))throw new FlowError('ORIGIN_REJECTED',403);
  await guard?.(req);
  if(req.method==='GET'&&path===''){
   const booking=await access.read(bookingAccessToken(req.headers));
   return Response.json({...booking,qrImage:await QRCode.toDataURL(booking.qr,{width:240,margin:2})},{headers});
  }
  if(req.method==='POST'&&path==='/issue'){
   const v=exact(await readJson(req),['bookingId','requestId']);
   const actor=await contexts.resolve(guestToken(req.headers));
   const r=await access.issue(actor,v.bookingId,v.requestId);
   // Raw capability is only transported in HttpOnly Set-Cookie, never JSON/DOM/URL.
   return Response.json({saved:true,expiresAt:r.expiresAt,replayed:r.replayed},{headers:{...headers,'Set-Cookie':bookingAccessCookie(r.token,origin.startsWith('https:'),r.maxAgeSeconds)}});
  }
  if(req.method==='POST'&&['/recovery/prepare','/recovery/exchange','/recovery/revoke'].includes(path)){
   if(!recovery)throw new FlowError('BOOKING_RECOVERY_UNCONFIGURED',503);
   if(path==='/recovery/prepare'){
    const v=exact(await readJson(req),['bookingId','requestId']);const actor=await contexts.resolve(guestToken(req.headers));
    return Response.json(await recovery.prepare(actor,v.bookingId,v.requestId),{headers});
   }
   if(path==='/recovery/exchange'){
    const v=exact(await readJson(req),['code','requestId']),r=await recovery.exchange(v.code,v.requestId);
    return Response.json({recovered:true,expiresAt:r.expiresAt,replayed:r.replayed,readOnly:true},{headers:{...headers,'Set-Cookie':bookingAccessCookie(r.token,origin.startsWith('https:'),r.maxAgeSeconds)}});
   }
   const v=exact(await readJson(req),['code']);await recovery.revoke(v.code);return Response.json({revoked:true},{headers});
  }
  if(req.method==='POST'&&path==='/revoke'){
   exact(await readJson(req),[]);await access.revoke(bookingAccessToken(req.headers));
   return Response.json({revoked:true},{headers:{...headers,'Set-Cookie':bookingAccessCookie('',origin.startsWith('https:'),0)}});
  }
  throw new FlowError('NOT_FOUND',404);
 }catch(e){const error=e instanceof FlowError||e instanceof HoldError?e:new FlowError('BOOKING_ACCESS_FAILED',500);return Response.json({error:error.code},{status:error.status,headers});}
};}
