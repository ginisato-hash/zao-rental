import {createHash} from 'node:crypto';
import type {Pool} from 'pg';
import {FlowError,flowId,flowHash} from '../../../contracts/src/rental-flow';
import type {BookingRecovery} from '../guest/booking-recovery';
import {renderBookingNotification,safeDeliveryResult,type BookingNotificationDelivery,type DeliveryResult,type NotificationEvent,type NotificationLocale} from './contracts';
type Claim={id:string;claimId:string;dedupeKey:string};
type Material={eventType:NotificationEvent;locale:NotificationLocale;bookingId:string;recipient:string;conditions:{pickupStore:string;returnStore:string;period:{startDate:string;endDate:string}};priceSnapshot:{totalJpy:number};priceSha256:string;paymentStatus:string;recovery:Parameters<BookingRecovery['notificationProof']>[1]|null};
/** Server operator entry point. No scheduler, environment lookup or default provider.
 * SQL reserves dispatch durably. Only authoritative NOT_ACCEPTED is retried. */
export class BookingNotificationWorker{
 constructor(private pool:Pool,private origin:string,private recovery:BookingRecovery,private adapter?:BookingNotificationDelivery,private timeoutMs=5000){if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000)throw new FlowError('NOTIFICATION_CONFIGURATION_INVALID',503);}
 status(){return this.adapter?'CONFIGURED':'BOOKING_RECOVERY_DELIVERY_UNCONNECTED';}
 async enqueueConfirmed(bookingId:string){flowId(bookingId);return (await this.pool.query('SELECT notification_enqueue_confirmed($1) id',[bookingId])).rows[0].id as string|null;}
 async synchronize(){return Number((await this.pool.query('SELECT notification_sync_confirmed() n')).rows[0].n);}
 private async bounded(call:(signal:AbortSignal)=>Promise<DeliveryResult>){const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;try{return safeDeliveryResult(await Promise.race([call(controller.signal),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error());},this.timeoutMs);})]));}catch{return {state:'UNKNOWN'} as const;}finally{clearTimeout(timer);}}
 async dispatch(id:string){flowId(id);if(!this.adapter)return {state:'UNCONNECTED' as const};
  const claim=(await this.pool.query('SELECT notification_claim($1) v',[id])).rows[0].v as Claim|null;if(!claim)return {state:'NOT_CLAIMED' as const};
  const settle=async(result:DeliveryResult|{state:'SUPPRESSED';code:'RECOVERY_EXPIRED_OR_REVOKED'|'TEMPLATE_UNAVAILABLE'|'RECIPIENT_UNAVAILABLE'})=>{
   const saved=await this.pool.query('SELECT notification_settle($1,$2,$3,$4,$5) applied',[id,claim.claimId,result.state,'providerMessageId' in result?result.providerMessageId:null,'code' in result?result.code:'ACCEPTANCE_UNKNOWN']);return {state:saved.rows[0].applied?result.state:'UNKNOWN'};};
  // Errors before materialization cannot result in a provider call. DB uncertainty
  // leaves SENDING reserved; recovery converts the expired claim to lookup-only UNKNOWN.
  const m=(await this.pool.query('SELECT notification_material($1,$2) v',[id,claim.claimId])).rows[0].v as Material|null;
  if(!m)return settle({state:'SUPPRESSED',code:'RECOVERY_EXPIRED_OR_REVOKED'});
  if(typeof m.recipient!=='string'||m.recipient.length>254||!/^[^\s@\r\n]+@[^\s@\r\n]+\.[^\s@\r\n]+$/.test(m.recipient))return settle({state:'SUPPRESSED',code:'RECIPIENT_UNAVAILABLE'});
  let body:{subject:string;text:string};try{
   if(flowHash(m.priceSnapshot)!==m.priceSha256)throw Error();
   const proof=m.recovery?this.recovery.notificationProof(m.bookingId,m.recovery):undefined;
   body=renderBookingNotification(m.eventType,m.locale,{bookingId:m.bookingId,pickupStore:m.conditions.pickupStore,returnStore:m.conditions.returnStore,...m.conditions.period,totalJpy:m.priceSnapshot.totalJpy,paymentStatus:m.paymentStatus},this.origin,proof);
  }catch{return settle({state:'SUPPRESSED',code:'TEMPLATE_UNAVAILABLE'});}
  const result=await this.bounded(signal=>this.adapter!.send({idempotencyKey:createHash('sha256').update(claim.dedupeKey).digest('hex'),eventType:m.eventType,recipient:m.recipient,locale:m.locale,...body},signal));
  return settle(result);
 }
 async reconcile(id:string){flowId(id);if(!this.adapter)return {state:'UNCONNECTED' as const};const key=(await this.pool.query('SELECT notification_unknown($1) v',[id])).rows[0].v as string|null;if(!key)return {state:'NOT_UNKNOWN' as const};
  const result=await this.bounded(signal=>this.adapter!.lookup(createHash('sha256').update(key).digest('hex'),signal));
  // No missing-result lookup or operator action can silently authorize another send.
  if(result.state==='ACCEPTED')await this.pool.query('SELECT notification_reconciled($1,$2)',[id,result.providerMessageId]);return {state:result.state==='ACCEPTED'?'SENT':'UNKNOWN'};
 }
 async runBatch(){await this.synchronize();if(!this.adapter)return {state:'UNCONNECTED',processed:0};const rows=(await this.pool.query('SELECT id,action FROM notification_due()')).rows;for(const row of rows)if(row.action==='LOOKUP')await this.reconcile(row.id);else await this.dispatch(row.id);return {state:'PROCESSED',processed:rows.length};}
}
