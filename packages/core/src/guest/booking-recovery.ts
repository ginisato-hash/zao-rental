import {createHash,createHmac} from 'node:crypto';
import type {Pool} from 'pg';
import type {GuestActor} from '../../../auth/src/booking-actor';
import {FlowError,flowId} from '../../../contracts/src/rental-flow';
export type RecoveryMessage={messageId:string;recipient:string;code:string;expiresAt:string};
export type RecoveryDeliveryReceipt={messageId:string;state:'DELIVERED'|'UNKNOWN'};
/** Approved server-side provider only. No default transport, URL link, logging or
 * environment credentials. Provider must deduplicate messageId and support lookup.
 * The recipient comes from the confirmed DB record, never a browser override. */
export interface BookingRecoveryDelivery{deliver(message:RecoveryMessage,signal:AbortSignal):Promise<RecoveryDeliveryReceipt>;lookup(messageId:string,signal:AbortSignal):Promise<RecoveryDeliveryReceipt>;}
const pattern=/^[-_A-Za-z0-9]{43}$/;const hash=(v:string)=>createHash('sha256').update(v).digest('hex');
export class BookingRecovery{
 private key:Uint8Array;
 constructor(private pool:Pool,key:Uint8Array,private keyVersion:string,private delivery?:BookingRecoveryDelivery,private deliveryTimeoutMs=5000,private durableQueue=false){if(!Number.isSafeInteger(deliveryTimeoutMs)||deliveryTimeoutMs<1||deliveryTimeoutMs>30000||key.byteLength!==32||!/^[A-Za-z0-9_-]{1,64}$/.test(keyVersion))throw new FlowError('BOOKING_RECOVERY_UNCONFIGURED',503);this.key=Uint8Array.from(key);}
 private token(purpose:string,values:string[]){return createHmac('sha256',this.key).update(JSON.stringify([purpose,this.keyVersion,...values])).digest('base64url');}
 async prepare(actor:GuestActor,bookingId:unknown,requestId:unknown){
  if(this.durableQueue)return this.queue(actor,bookingId,requestId);
  if(!this.delivery)throw new FlowError('BOOKING_RECOVERY_DELIVERY_UNCONNECTED',503);flowId(bookingId);flowId(requestId);
  const code=this.token('zao-booking-recovery-v1',[actor.subject,bookingId,requestId]);let r;
  try{r=(await this.pool.query('SELECT * FROM booking_access.prepare_recovery($1,$2,$3,$4,$5,$6,$7)',[actor.contextId,actor.subject,actor.tokenHash,bookingId,requestId,hash(code),this.keyVersion])).rows[0];if(!r)throw new Error();}catch{throw new FlowError('BOOKING_RECOVERY_DENIED',401);}
  const messageId=hash(JSON.stringify(['booking-recovery-message',bookingId,requestId])),expiresAt=(r.expires_at as Date).toISOString();
  // A durable row reserves the only send. A crash/unknown result uses provider lookup,
  // never another send. If lookup cannot prove delivery, retain UNKNOWN for operator action.
  if(r.delivered)return {delivery:'DELIVERED' as const,expiresAt,replayed:true};
  let receipt:RecoveryDeliveryReceipt;
  const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
  try{receipt=await Promise.race([r.replayed?this.delivery.lookup(messageId,controller.signal):this.delivery.deliver({messageId,recipient:r.recipient,code,expiresAt},controller.signal),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('DELIVERY_UNKNOWN'));},this.deliveryTimeoutMs);})]);}catch{return {delivery:'UNKNOWN' as const,expiresAt,replayed:Boolean(r.replayed)};}finally{clearTimeout(timer);}
  if(receipt.messageId!==messageId||receipt.state!=='DELIVERED')return {delivery:'UNKNOWN' as const,expiresAt,replayed:Boolean(r.replayed)};
  await this.pool.query('SELECT booking_access.recovery_delivered($1)',[hash(code)]);
  return {delivery:'DELIVERED' as const,expiresAt,replayed:Boolean(r.replayed)};
 }
 async queue(actor:GuestActor,bookingId:unknown,requestId:unknown,locale:'ja'|'en'='ja'){
  flowId(bookingId);flowId(requestId);const code=this.token('zao-booking-recovery-v1',[actor.subject,bookingId,requestId]);
  try{const r=(await this.pool.query('SELECT * FROM booking_access.queue_recovery($1,$2,$3,$4,$5,$6,$7,$8)',[actor.contextId,actor.subject,actor.tokenHash,bookingId,requestId,hash(code),this.keyVersion,locale])).rows[0];if(!r)throw Error();return {delivery:'QUEUED' as const,expiresAt:(r.expires_at as Date).toISOString(),replayed:Boolean(r.replayed)};}catch(e){throw new FlowError((e as {code?:string}).code==='P0429'?'BOOKING_RECOVERY_RATE_LIMITED':'BOOKING_RECOVERY_DENIED',(e as {code?:string}).code==='P0429'?429:401);}
 }
 async request(bookingId:unknown,email:unknown,requestId:unknown,locale:unknown){
  flowId(bookingId);flowId(requestId);if(typeof email!=='string'||email.length>254||!['ja','en'].includes(locale as string))throw new FlowError('INVALID_RECOVERY_REQUEST',422);
  const canonicalEmail=email.trim().toLowerCase(),code=this.token('zao-booking-recovery-email-v1',[bookingId,requestId]);
  // Public shape is identical for absent/foreign/matching/budget-suppressed inputs.
  // Transport/database failures do not reveal whether the submitted booking exists.
  try{await this.pool.query('SELECT booking_access.request_recovery($1,$2,$3,$4,$5,$6)',[bookingId,canonicalEmail,requestId,hash(code),this.keyVersion,locale]);}catch{/* Safe generic acknowledgement; no body, code or address logging. */}
  return {accepted:true as const,delivery:'QUEUED_IF_ELIGIBLE' as const};
 }
 notificationProof(bookingId:string,r:{requestId:string;ownerId:string;derivation:string;codeHash:string;keyVersion:string;expiresAt:string}){
  if(r.keyVersion!==this.keyVersion||!['EMAIL_V1','GUEST_V1'].includes(r.derivation))throw new FlowError('BOOKING_RECOVERY_UNCONFIGURED',503);
  const code=r.derivation==='EMAIL_V1'?this.token('zao-booking-recovery-email-v1',[bookingId,r.requestId]):this.token('zao-booking-recovery-v1',[r.ownerId,bookingId,r.requestId]);
  if(hash(code)!==r.codeHash)throw new FlowError('BOOKING_RECOVERY_DENIED',401);return {code,expiresAt:r.expiresAt};
 }
 async exchange(code:unknown,requestId:unknown){
  if(typeof code!=='string'||!pattern.test(code))throw new FlowError('BOOKING_RECOVERY_DENIED',401);flowId(requestId);
  const token=this.token('zao-booking-recovered-read-v1',[hash(code),requestId]),cancelToken=this.token('zao-booking-cancel-v1',[hash(code),requestId]);
  try{const r=(await this.pool.query('SELECT * FROM booking_access.exchange_recovery_with_cancellation($1,$2,$3,$4,$5)',[hash(code),requestId,hash(token),hash(cancelToken),this.keyVersion])).rows[0];if(!r)throw new Error();return {token,expiresAt:(r.expires_at as Date).toISOString(),maxAgeSeconds:Number(r.remaining_seconds),replayed:Boolean(r.replayed),cancelToken:r.cancel_expires_at?cancelToken:null,cancelMaxAgeSeconds:Number(r.cancel_remaining_seconds)};}catch{throw new FlowError('BOOKING_RECOVERY_DENIED',401);}
 }
 async revoke(code:unknown){if(typeof code!=='string'||!pattern.test(code))throw new FlowError('BOOKING_RECOVERY_DENIED',401);await this.pool.query('SELECT booking_access.revoke_recovery($1)',[hash(code)]);}
}
