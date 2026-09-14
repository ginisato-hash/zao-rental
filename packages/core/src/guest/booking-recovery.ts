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
 constructor(private pool:Pool,key:Uint8Array,private keyVersion:string,private delivery?:BookingRecoveryDelivery,private deliveryTimeoutMs=5000){if(!Number.isSafeInteger(deliveryTimeoutMs)||deliveryTimeoutMs<1||deliveryTimeoutMs>30000||key.byteLength!==32||!/^[A-Za-z0-9_-]{1,64}$/.test(keyVersion))throw new FlowError('BOOKING_RECOVERY_UNCONFIGURED',503);this.key=Uint8Array.from(key);}
 private token(purpose:string,values:string[]){return createHmac('sha256',this.key).update(JSON.stringify([purpose,this.keyVersion,...values])).digest('base64url');}
 async prepare(actor:GuestActor,bookingId:unknown,requestId:unknown){
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
 async exchange(code:unknown,requestId:unknown){
  if(typeof code!=='string'||!pattern.test(code))throw new FlowError('BOOKING_RECOVERY_DENIED',401);flowId(requestId);
  const token=this.token('zao-booking-recovered-read-v1',[hash(code),requestId]);
  try{const r=(await this.pool.query('SELECT * FROM booking_access.exchange_recovery($1,$2,$3,$4)',[hash(code),requestId,hash(token),this.keyVersion])).rows[0];if(!r)throw new Error();return {token,expiresAt:(r.expires_at as Date).toISOString(),maxAgeSeconds:Number(r.remaining_seconds),replayed:Boolean(r.replayed)};}catch{throw new FlowError('BOOKING_RECOVERY_DENIED',401);}
 }
 async revoke(code:unknown){if(typeof code!=='string'||!pattern.test(code))throw new FlowError('BOOKING_RECOVERY_DENIED',401);await this.pool.query('SELECT booking_access.revoke_recovery($1)',[hash(code)]);}
}
