import {createHash,createHmac} from 'node:crypto';
import type {Pool} from 'pg';
import type {GuestActor} from '../../../auth/src/booking-actor';
import {FlowError,flowId,flowHash,reservationQr} from '../../../contracts/src/rental-flow';
export const BOOKING_ACCESS_COOKIE='zao_booking_access';
export const BOOKING_CANCEL_COOKIE='zao_booking_cancel';
const tokenPattern=/^[-_A-Za-z0-9]{43}$/;
const digest=(token:string)=>createHash('sha256').update(token).digest('hex');
/** A read-only capability, deliberately not a GuestActor or staff principal.
 * Key comes from approved server composition; never generated/defaulted on a request.
 * HMAC-SHA256 supports exact-request response-loss reissue without storing raw tokens. */
export class BookingAccess {
 constructor(private pool:Pool,private key:Uint8Array,private keyVersion:string){
  if(key.byteLength!==32||!/^[A-Za-z0-9_-]{1,64}$/.test(keyVersion))throw new FlowError('BOOKING_ACCESS_UNCONFIGURED',503);
  this.key=Uint8Array.from(key);
 }
 async issue(actor:GuestActor,bookingId:unknown,requestId:unknown){
  flowId(bookingId);flowId(requestId);
  const token=createHmac('sha256',this.key).update(JSON.stringify(['zao-booking-read-v1',this.keyVersion,actor.subject,bookingId,requestId])).digest('base64url');
  try{
   const r=(await this.pool.query('SELECT * FROM booking_access.issue($1,$2,$3,$4,$5,$6,$7)',[actor.contextId,actor.subject,actor.tokenHash,bookingId,requestId,digest(token),this.keyVersion])).rows[0];
   if(!r)throw new Error();
   return {token,expiresAt:(r.expires_at as Date).toISOString(),maxAgeSeconds:Math.max(0,r.remaining_seconds as number),replayed:r.replayed as boolean};
  }catch{throw new FlowError('BOOKING_ACCESS_DENIED',401);}
 }
 async read(token:unknown,cancelToken?:unknown){
  if(typeof token!=='string'||!tokenPattern.test(token))throw new FlowError('BOOKING_ACCESS_DENIED',401);
  const r=(await this.pool.query('SELECT * FROM booking_access.read($1)',[digest(token)])).rows[0];
  if(!r)throw new FlowError('BOOKING_ACCESS_DENIED',401);
  const cancellation=(await this.pool.query('SELECT booking_access.cancellation_status($1) v',[digest(token)])).rows[0].v as {cancelledAt:string|null;freeCancellationUntil:string;refundStatus:string|null;refundAmountJpy:number;maximumRefundJpy:number|null}|null;
  const cancellationAllowed=typeof cancelToken==='string'&&tokenPattern.test(cancelToken)&&(await this.pool.query('SELECT booking_access.cancellation_ready($1,$2) v',[digest(cancelToken),r.booking_id])).rows[0].v===true;
  return {cancellation,cancellationAllowed,id:r.booking_id as string,state:r.state as string,mode:r.mode as string,pickupStore:r.pickup_store as string,returnStore:r.return_store as string,period:r.period as {startDate:string;endDate:string;slot:string},dueAt:(r.due_at as Date).toISOString(),totalJpy:Number(r.total_jpy),priceSha256:r.price_sha256 as string,expiresAt:(r.expires_at as Date).toISOString(),qr:r.state==='CANCELLED'?null:reservationQr(r.booking_id),chargeReady:r.mode==='SQUARE_PRODUCTION',readOnly:true as const};
 }
 async cancellationPreview(token:unknown,bookingId:unknown){
  flowId(bookingId);if(typeof token!=='string'||!tokenPattern.test(token))throw new FlowError('CANCELLATION_AUTHORITY_DENIED',401);
  try{const v=(await this.pool.query('SELECT booking_access.cancellation_preview($1,$2) v',[digest(token),bookingId])).rows[0].v;return {...v,previewHash:flowHash(v)};}catch{throw new FlowError('CANCELLATION_AUTHORITY_DENIED',401);}
 }
 async cancel(token:unknown,bookingId:unknown,key:unknown,previewHash:unknown){
  flowId(bookingId);flowId(key);if(typeof token!=='string'||!tokenPattern.test(token))throw new FlowError('CANCELLATION_AUTHORITY_DENIED',401);
  if(typeof previewHash!=='string'||!/^[a-f0-9]{64}$/.test(previewHash))throw new FlowError('CANCELLATION_PREVIEW_REQUIRED',422);
  const c=await this.pool.connect();try{
   await c.query('BEGIN');await c.query("SET LOCAL lock_timeout='2s';SET LOCAL statement_timeout='5s'");
   const v=(await c.query('SELECT booking_access.cancellation_preview($1,$2) v',[digest(token),bookingId])).rows[0].v;
   if(v.cancelled){await c.query('COMMIT');return v.cancelled;}
   if(flowHash(v)!==previewHash)throw new FlowError('CANCELLATION_PREVIEW_CHANGED',409);
   const result=(await c.query('SELECT booking_access.cancel($1,$2,$3,$4::jsonb) v',[digest(token),bookingId,key,JSON.stringify(v)])).rows[0].v;
   await c.query('COMMIT');return result;
  }catch(e){await c.query('ROLLBACK');if(e instanceof FlowError)throw e;throw new FlowError('CANCELLATION_AUTHORITY_DENIED',401);}finally{c.release();}
 }
 async revoke(token:unknown){if(typeof token==='string'&&tokenPattern.test(token))await this.pool.query('SELECT booking_access.revoke($1)',[digest(token)]);}
}
export function bookingAccessToken(headers:Headers,name=BOOKING_ACCESS_COOKIE){
 const values=(headers.get('cookie')??'').split(';').map(s=>s.trim()).filter(s=>s.startsWith(name+'='));
 return values.length===1?values[0]!.slice(name.length+1):undefined;
}
export function bookingAccessCookie(token:string,secure:boolean,maxAgeSeconds:number){
 if(token!==''&&!tokenPattern.test(token)||!Number.isSafeInteger(maxAgeSeconds)||maxAgeSeconds<0)throw new FlowError('BOOKING_ACCESS_COOKIE_INVALID',500);
 return `${BOOKING_ACCESS_COOKIE}=${token}; Path=/api/booking-access; HttpOnly; SameSite=Strict; Max-Age=${Math.min(34560000,maxAgeSeconds)}${secure?'; Secure':''}`;
}

export function bookingCancellationCookie(token:string,secure:boolean,maxAgeSeconds:number){
 return bookingAccessCookie(token,secure,Math.min(600,maxAgeSeconds)).replace(BOOKING_ACCESS_COOKIE+'=',BOOKING_CANCEL_COOKIE+'=');
}
