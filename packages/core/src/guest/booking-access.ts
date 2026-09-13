import {createHash,createHmac} from 'node:crypto';
import type {Pool} from 'pg';
import type {GuestActor} from '../../../auth/src/booking-actor';
import {FlowError,flowId,reservationQr} from '../../../contracts/src/rental-flow';
export const BOOKING_ACCESS_COOKIE='zao_booking_access';
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
 async read(token:unknown){
  if(typeof token!=='string'||!tokenPattern.test(token))throw new FlowError('BOOKING_ACCESS_DENIED',401);
  const r=(await this.pool.query('SELECT * FROM booking_access.read($1)',[digest(token)])).rows[0];
  if(!r)throw new FlowError('BOOKING_ACCESS_DENIED',401);
  return {id:r.booking_id as string,state:r.state as string,mode:r.mode as string,pickupStore:r.pickup_store as string,returnStore:r.return_store as string,period:r.period as {startDate:string;endDate:string;slot:string},dueAt:(r.due_at as Date).toISOString(),totalJpy:Number(r.total_jpy),priceSha256:r.price_sha256 as string,expiresAt:(r.expires_at as Date).toISOString(),qr:reservationQr(r.booking_id),chargeReady:false as const,readOnly:true as const};
 }
 async revoke(token:unknown){if(typeof token==='string'&&tokenPattern.test(token))await this.pool.query('SELECT booking_access.revoke($1)',[digest(token)]);}
}
export function bookingAccessToken(headers:Headers){
 const values=(headers.get('cookie')??'').split(';').map(s=>s.trim()).filter(s=>s.startsWith(BOOKING_ACCESS_COOKIE+'='));
 return values.length===1?values[0]!.slice(BOOKING_ACCESS_COOKIE.length+1):undefined;
}
export function bookingAccessCookie(token:string,secure:boolean,maxAgeSeconds:number){
 if(token!==''&&!tokenPattern.test(token)||!Number.isSafeInteger(maxAgeSeconds)||maxAgeSeconds<0)throw new FlowError('BOOKING_ACCESS_COOKIE_INVALID',500);
 return `${BOOKING_ACCESS_COOKIE}=${token}; Path=/api/booking-access; HttpOnly; SameSite=Strict; Max-Age=${Math.min(34560000,maxAgeSeconds)}${secure?'; Secure':''}`;
}
