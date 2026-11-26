import type {BookingNotificationDelivery,DeliveryResult,NotificationMessage} from '../../packages/core/src/notification/contracts';
/** Test-only capturing adapter: nothing leaves the process. Synthetic recipients only. */
export class CaptureDelivery implements BookingNotificationDelivery{
 sent:NotificationMessage[]=[];lookups:string[]=[];
 /** Next results consumed in order; empty => ACCEPTED. */
 script:(DeliveryResult|'THROW'|'HANG'|'LOST_AFTER_ACCEPT')[]=[];
 known=new Map<string,string>();
 gate?:Promise<void>|undefined;
 onSend?:((m:NotificationMessage)=>Promise<void>)|undefined;
 lookup?:(key:string)=>Promise<DeliveryResult>;
 constructor(withLookup=true){
  if(withLookup)this.lookup=async key=>{this.lookups.push(key);const id=this.known.get(key);return id?{state:'ACCEPTED',providerMessageId:id}:{state:'UNKNOWN'};};
 }
 async send(m:NotificationMessage,signal:AbortSignal):Promise<DeliveryResult>{
  if(this.gate)await this.gate;
  if(this.onSend)await this.onSend(m);
  this.sent.push(m);const next=this.script.shift();
  if(next==='THROW')throw new Error('boom');
  if(next==='HANG')return new Promise(()=>{signal.addEventListener('abort',()=>{});});
  if(next==='LOST_AFTER_ACCEPT'){this.known.set(m.idempotencyKey,'msg_lost_'+this.sent.length);return {state:'UNKNOWN'};}
  if(next)return next;
  const id='msg_'+this.sent.length;this.known.set(m.idempotencyKey,id);return {state:'ACCEPTED',providerMessageId:id};
 }
}
