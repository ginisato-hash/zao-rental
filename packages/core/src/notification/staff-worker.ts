import {createHash} from 'node:crypto';
import type {Pool} from 'pg';
import {flowId} from '../../../contracts/src/rental-flow';
import {STORE_DISPLAY_NAMES} from '../../../contracts/src/store-display';
import {safeDeliveryResult,type BookingNotificationDelivery,type DeliveryResult} from './contracts';

type Material={id:string;locale:'ja'|'en';bookingId:string;recipient:string|null;store:string;returnStore:string;startDate:string;endDate:string;slot:string;people:number};
const SLOT:Record<string,{ja:string;en:string}>={DAY:{ja:'1日',en:'full day'},AM:{ja:'午前 8:30',en:'morning, 8:30'},PM:{ja:'午後 13:00',en:'afternoon, 13:00'},MULTIDAY:{ja:'複数日',en:'multi-day'}};
const EMAIL=/^[^\s@\r\n]+@[^\s@\r\n]+\.[^\s@\r\n]+$/;

/** Staff new-booking email. It carries only what a staff member needs to notice the booking and a sign-in-required link;
 * the customer's name, contact details and amount stay behind staff authentication. */
export function renderStaffBookingNotification(m:Omit<Material,'id'|'recipient'>,origin:string){
 const ja=m.locale==='ja',store=(s:string)=>STORE_DISPLAY_NAMES[s as keyof typeof STORE_DISPLAY_NAMES]??s,slot=SLOT[m.slot]?.[m.locale]??m.slot;
 if(!/^https:\/\/[^/]+$|^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)||!/^\d{4}-\d{2}-\d{2}$/.test(m.startDate)||!/^\d{4}-\d{2}-\d{2}$/.test(m.endDate))throw Error('TEMPLATE_UNAVAILABLE');
 const ref=m.bookingId.slice(0,8).toUpperCase(),link=`${origin}/staff/orders/${encodeURIComponent(m.bookingId)}`;
 const period=m.startDate===m.endDate?m.startDate:`${m.startDate} – ${m.endDate}`;
 const subject=ja?`新規予約 ${ref}｜${store(m.store)} ${m.startDate}`:`New booking ${ref} | ${store(m.store)} ${m.startDate}`;
 const text=(ja?[
  '新しい予約が確定しました。',
  `予約番号：${ref}`,`受取店舗：${store(m.store)}${m.returnStore!==m.store?`（返却：${store(m.returnStore)}）`:''}`,`受取日：${period}（${slot}）`,`人数：${m.people}名`,'',
  `詳細（スタッフログインが必要です）：${link}`,'','この通知はスタッフ設定で受信を選んだ方にだけ送信しています。'
 ]:[
  'A new booking has been confirmed.',
  `Booking: ${ref}`,`Pickup station: ${store(m.store)}${m.returnStore!==m.store?` (return: ${store(m.returnStore)})`:''}`,`Pickup: ${period} (${slot})`,`People: ${m.people}`,'',
  `Details (staff sign-in required): ${link}`,'','You receive this because you turned on new-booking emails in staff settings.'
 ]).join('\n');
 return {subject,text};
}

/** Staff email queue worker. Same reservation/settlement model as BookingNotificationWorker; never touches bookings. */
export class StaffNotificationWorker{
 constructor(private pool:Pool,private origin:string,private adapter:BookingNotificationDelivery,private timeoutMs=5000){}
 private async bounded(call:(signal:AbortSignal)=>Promise<DeliveryResult>){const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;try{return safeDeliveryResult(await Promise.race([call(controller.signal),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error());},this.timeoutMs);})]));}catch{return {state:'UNKNOWN'} as const;}finally{clearTimeout(timer);}}
 async dispatch(id:string){flowId(id);
  const claim=(await this.pool.query('SELECT staff_notification_claim($1) v',[id])).rows[0].v as {id:string;claimId:string;dedupeKey:string}|null;if(!claim)return {state:'NOT_CLAIMED' as const};
  const settle=async(result:DeliveryResult|{state:'SUPPRESSED';code:'TEMPLATE_UNAVAILABLE'|'RECIPIENT_UNAVAILABLE'})=>{
   const saved=await this.pool.query('SELECT staff_notification_settle($1,$2,$3,$4,$5) applied',[id,claim.claimId,result.state,'providerMessageId' in result?result.providerMessageId:null,'code' in result?result.code:'ACCEPTANCE_UNKNOWN']);return {state:saved.rows[0].applied?result.state:'UNKNOWN'};};
  const m=(await this.pool.query('SELECT staff_notification_material($1,$2) v',[id,claim.claimId])).rows[0].v as Material|null;
  if(!m||typeof m.recipient!=='string'||m.recipient.length>254||!EMAIL.test(m.recipient))return settle({state:'SUPPRESSED',code:'RECIPIENT_UNAVAILABLE'});
  let body:{subject:string;text:string};try{body=renderStaffBookingNotification(m,this.origin);}catch{return settle({state:'SUPPRESSED',code:'TEMPLATE_UNAVAILABLE'});}
  return settle(await this.bounded(signal=>this.adapter.send({idempotencyKey:createHash('sha256').update(claim.dedupeKey).digest('hex'),eventType:'STAFF_BOOKING_CONFIRMED',recipient:m.recipient!,locale:m.locale,...body},signal)));
 }
 async reconcile(id:string){flowId(id);const key=(await this.pool.query('SELECT staff_notification_unknown($1) v',[id])).rows[0].v as string|null;if(!key||!this.adapter.lookup)return {state:'UNKNOWN' as const};
  const result=await this.bounded(signal=>this.adapter.lookup!(createHash('sha256').update(key).digest('hex'),signal));
  if(result.state==='ACCEPTED')await this.pool.query('SELECT staff_notification_reconciled($1,$2)',[id,result.providerMessageId]);return {state:result.state==='ACCEPTED'?'SENT':'UNKNOWN'};
 }
 /** One bounded pass: resynchronize missed captures, then at most `limit` deliveries before the deadline. */
 async runBatch(limit:number,deadline:Date){
  if(limit<1||Date.now()>=deadline.getTime())return {processed:0};
  await this.pool.query('SELECT staff_events_sync()');let processed=0;if(Date.now()>=deadline.getTime())return {processed};
  for(const row of (await this.pool.query('SELECT id,action FROM staff_notification_due($1)',[limit])).rows as {id:string;action:string}[]){
   if(Date.now()>=deadline.getTime())break;if(row.action==='LOOKUP')await this.reconcile(row.id);else await this.dispatch(row.id);processed++;
  }
  return {processed};
 }
}
