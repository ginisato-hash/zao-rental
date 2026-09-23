import {exact} from '../../../contracts/src/pricing';
import {FlowError} from '../../../contracts/src/rental-flow';
export const notificationEvents=['BOOKING_CONFIRMED','BOOKING_RECOVERY','BOOKING_CANCELLED','BOOKING_AMENDED','PAYMENT_ACTION_REQUIRED','REFUND_STATUS'] as const;
export type NotificationEvent=typeof notificationEvents[number];
export const notificationStates=['PENDING','SENDING','SENT','RETRYABLE_FAILURE','PERMANENT_FAILURE','SUPPRESSED','UNKNOWN'] as const;
export type NotificationState=typeof notificationStates[number];
export type NotificationLocale='ja'|'en';
export type SafeDeliveryFailure='DELIVERY_UNCONNECTED'|'RATE_LIMITED'|'PROVIDER_UNAVAILABLE'|'PERMANENT_REJECT'|'ACCEPTANCE_UNKNOWN'|'RETRY_EXHAUSTED'|'RECOVERY_EXPIRED_OR_REVOKED'|'TEMPLATE_UNAVAILABLE'|'RECIPIENT_UNAVAILABLE'|'NONE';
export type NotificationMessage={idempotencyKey:string;eventType:NotificationEvent;recipient:string;locale:NotificationLocale;subject:string;text:string};
export type DeliveryResult={state:'ACCEPTED';providerMessageId:string}|{state:'NOT_ACCEPTED';code:'RATE_LIMITED'|'PROVIDER_UNAVAILABLE'}|{state:'REJECTED';code:'PERMANENT_REJECT'}|{state:'UNKNOWN'};
/** No default transport or credentials. Provider idempotency/lookup are capabilities,
 * not an exactly-once guarantee. A timeout always leaves acceptance ambiguous. */
export interface BookingNotificationDelivery{
 send(message:NotificationMessage,signal:AbortSignal):Promise<DeliveryResult>;
 lookup?(idempotencyKey:string,signal:AbortSignal):Promise<DeliveryResult>;
}
export function safeDeliveryResult(input:unknown):DeliveryResult{
 if(!input||typeof input!=='object')return {state:'UNKNOWN'};
 try{const state=(input as {state?:unknown}).state;
  if(state==='ACCEPTED'){const v=exact(input,['state','providerMessageId']);if(typeof v.providerMessageId==='string'&&/^[-A-Za-z0-9_]{1,128}$/.test(v.providerMessageId))return {state,providerMessageId:v.providerMessageId};}
  if(state==='NOT_ACCEPTED'){const v=exact(input,['state','code']);if(v.code==='RATE_LIMITED'||v.code==='PROVIDER_UNAVAILABLE')return {state,code:v.code};}
  if(state==='REJECTED'){const v=exact(input,['state','code']);if(v.code==='PERMANENT_REJECT')return {state,code:v.code};}
 }catch{/* No raw provider data is retained. */}return {state:'UNKNOWN'};
}
export type NotificationSnapshot={bookingId:string;pickupStore:string;returnStore:string;startDate:string;endDate:string;totalJpy:number;paymentStatus:string;cancellation?:{refundStatus:string;refundAmountJpy:number;maximumRefundJpy:number}};
/** Input is materialized from the canonical booking/quote, never from browser text.
 * Returned body is ephemeral delivery material, never an audit/outbox payload. */
export function renderBookingNotification(event:NotificationEvent,locale:NotificationLocale,s:NotificationSnapshot,origin:string,recovery?:{code:string;expiresAt:string}){
 const u=new URL(origin);if(u.origin!==origin||!['http:','https:'].includes(u.protocol)||u.username||u.password||u.protocol==='http:'&&u.hostname!=='127.0.0.1')throw new FlowError('NOTIFICATION_CONFIGURATION_INVALID',503);
 if(!['ja','en'].includes(locale)||!Number.isSafeInteger(s.totalJpy)||s.totalJpy<0||!/^[-A-Za-z0-9]{1,64}$/.test(s.bookingId)||![s.pickupStore,s.returnStore,s.paymentStatus].every(v=>/^[-A-Z_]{1,64}$/.test(v))||![s.startDate,s.endDate].every(v=>/^\d{4}-\d{2}-\d{2}$/.test(v)))throw new FlowError('NOTIFICATION_SNAPSHOT_INVALID',503);
 const access=origin+'/'+locale+'/reservation';
 if(event==='BOOKING_CONFIRMED')return locale==='ja'?{subject:'ZAO Rental ご予約内容の確認',text:`予約番号: ${s.bookingId}\n受取: ${s.pickupStore} ${s.startDate}\n返却: ${s.returnStore} ${s.endDate}\n保存済み料金: ${s.totalJpy} JPY\n支払状態: ${s.paymentStatus}\n予約確認・QR: ${access}\n別端末では予約番号と登録メールで復旧を依頼できます。QRの貸出処理にはスタッフ認証が必要です。`}:{subject:'ZAO Rental booking confirmation',text:`Booking reference: ${s.bookingId}\nPickup: ${s.pickupStore} ${s.startDate}\nReturn: ${s.returnStore} ${s.endDate}\nSaved total: ${s.totalJpy} JPY\nPayment status: ${s.paymentStatus}\nBooking and QR access: ${access}\nOn another device, request recovery with your booking reference and registered email. QR checkout requires staff authorization.`};
 if(event==='BOOKING_CANCELLED'&&s.cancellation){const c=s.cancellation;if(!Number.isSafeInteger(c.refundAmountJpy)||c.refundAmountJpy<0||!Number.isSafeInteger(c.maximumRefundJpy)||c.maximumRefundJpy<0||!['REFUND_NONE','REFUND_PENDING','REFUND_UNKNOWN','REFUND_COMPLETED','REFUND_FAILED','PAYMENT_UNKNOWN'].includes(c.refundStatus))throw new FlowError('NOTIFICATION_SNAPSHOT_INVALID',503);
  const status:Record<string,[string,string]>={REFUND_NONE:['自動返金なし','No automatic refund'],REFUND_PENDING:['返金処理待ち','Refund pending'],REFUND_UNKNOWN:['返金結果を確認中','Refund status being verified'],REFUND_COMPLETED:['返金完了','Refund completed'],REFUND_FAILED:['返金にはスタッフの確認が必要です','Refund requires staff review'],PAYMENT_UNKNOWN:['決済結果を確認中。決済完了が確認された場合に返金します','Payment is being verified. A completed payment will be refunded']};
  return locale==='ja'?{subject:'ZAO Rental 予約キャンセルの確認',text:`予約番号: ${s.bookingId}\n予約はキャンセルされました。\n返金済み金額: ${c.refundAmountJpy} JPY\n決済結果による返金上限: ${c.maximumRefundJpy} JPY\n${status[c.refundStatus]![0]}\n予約確認: ${access}`}:{subject:'ZAO Rental booking cancelled',text:`Booking reference: ${s.bookingId}\nYour booking is cancelled.\nAmount refunded: ${c.refundAmountJpy} JPY\nMaximum refund subject to payment verification: ${c.maximumRefundJpy} JPY\n${status[c.refundStatus]![1]}\nBooking access: ${access}`};
 }
 if(event==='BOOKING_RECOVERY'&&recovery&&/^[-_A-Za-z0-9]{43}$/.test(recovery.code)&&Number.isFinite(Date.parse(recovery.expiresAt)))return locale==='ja'?{subject:'ZAO Rental 予約閲覧の復旧',text:`予約番号: ${s.bookingId}\n復旧コード: ${recovery.code}\n有効期限: ${recovery.expiresAt}\n予約確認・QR: ${access}\nコードは上のページに入力してください。本人確認後10分間、キャンセル手続きも行えます。予約内容の変更や支払はできません。第三者へ共有しないでください。`}:{subject:'ZAO Rental booking access recovery',text:`Booking reference: ${s.bookingId}\nRecovery code: ${recovery.code}\nExpires: ${recovery.expiresAt}\nBooking and QR access: ${access}\nEnter the code on this page. Verification also gives you ten minutes to cancel. It does not allow amendments or payments. Do not share the code.`};
 throw new FlowError('NOTIFICATION_EVENT_UNCONNECTED',503);
}
