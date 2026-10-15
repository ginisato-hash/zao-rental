import {exact} from '../../../contracts/src/pricing';
import {FlowError} from '../../../contracts/src/rental-flow';
import {storeDisplayName} from '../../../contracts/src/store-display';
export const notificationEvents=['BOOKING_CONFIRMED','BOOKING_RECOVERY','BOOKING_CANCELLED','BOOKING_AMENDED','PAYMENT_ACTION_REQUIRED','REFUND_STATUS'] as const;
export type NotificationEvent=typeof notificationEvents[number];
export const notificationStates=['PENDING','SENDING','SENT','RETRYABLE_FAILURE','PERMANENT_FAILURE','SUPPRESSED','UNKNOWN'] as const;
export type NotificationState=typeof notificationStates[number];
export type NotificationLocale='ja'|'en';
export type SafeDeliveryFailure='DELIVERY_UNCONNECTED'|'RATE_LIMITED'|'PROVIDER_UNAVAILABLE'|'PERMANENT_REJECT'|'ACCEPTANCE_UNKNOWN'|'RETRY_EXHAUSTED'|'RECOVERY_EXPIRED_OR_REVOKED'|'TEMPLATE_UNAVAILABLE'|'RECIPIENT_UNAVAILABLE'|'NONE';
export type NotificationMessage={idempotencyKey:string;eventType:NotificationEvent;recipient:string;locale:NotificationLocale;subject:string;text:string;html?:string};
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
/** HTML text/attribute escaping for every dynamic value placed in the email markup. */
export function escapeHtml(v:string){return v.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'} as Record<string,string>)[c]!);}
export type NotificationSnapshot={bookingId:string;pickupStore:string;returnStore:string;startDate:string;endDate:string;totalJpy:number;paymentStatus:string;cancellation?:{refundStatus:string;refundAmountJpy:number;maximumRefundJpy:number}};
/** Input is materialized from the canonical booking/quote, never from browser text.
 * Returned body is ephemeral delivery material, never an audit/outbox payload. */
export function renderBookingNotification(event:NotificationEvent,locale:NotificationLocale,s:NotificationSnapshot,origin:string,recovery?:{code:string;expiresAt:string}){
 const u=new URL(origin);if(u.origin!==origin||!['http:','https:'].includes(u.protocol)||u.username||u.password||u.protocol==='http:'&&u.hostname!=='127.0.0.1')throw new FlowError('NOTIFICATION_CONFIGURATION_INVALID',503);
 if(!['ja','en'].includes(locale)||!Number.isSafeInteger(s.totalJpy)||s.totalJpy<0||!/^[-A-Za-z0-9]{1,64}$/.test(s.bookingId)||![s.pickupStore,s.returnStore,s.paymentStatus].every(v=>/^[-A-Z_]{1,64}$/.test(v))||![s.startDate,s.endDate].every(v=>/^\d{4}-\d{2}-\d{2}$/.test(v)))throw new FlowError('NOTIFICATION_SNAPSHOT_INVALID',503);
 const access=origin+'/'+locale+'/reservation',ja=locale==='ja',t=(j:string,e:string)=>ja?j:e;
 const yen=(n:number)=>'¥'+n.toLocaleString('en-US');
 // Customer copy only: internal payment/refund enums are mapped, never printed.
 const payment:Record<string,[string,string]>={COMPLETED:['お支払い済み','Paid'],PENDING:['お支払いを確認中','Payment being confirmed'],SUBMITTING:['お支払いを確認中','Payment being confirmed'],UNKNOWN:['お支払いを確認中','Payment being confirmed'],REVIEW:['お支払いをスタッフが確認中','Payment under staff review'],FAILED:['お支払いが完了していません','Payment not completed']};
 const brand='SALOMON STATION ZAO';
 const render=(subject:string,title:string,rows:[string,string][],notes:string[],links:[string,string][])=>({subject,
  text:[title,'',...rows.map(([k,v])=>k+': '+v),...(notes.length?['',...notes]:[]),'',...links.map(([k,v])=>k+': '+v),'','— '+brand].join('\n'),
  html:`<!doctype html><html lang="${locale}"><body style="margin:0;padding:24px;background:#f4f4f2;color:#111;font-family:-apple-system,'Helvetica Neue',Arial,sans-serif"><div style="max-width:560px;margin:0 auto;background:#fff;border-top:6px solid #111"><div style="padding:24px 24px 8px"><p style="margin:0;font-size:12px;letter-spacing:.12em;font-weight:700">${escapeHtml(brand)}</p><h1 style="margin:12px 0 0;font-size:22px">${escapeHtml(title)}</h1></div><table role="presentation" style="width:100%;border-collapse:collapse;margin:16px 0">${rows.map(([k,v])=>`<tr><th align="left" style="padding:8px 24px;font-size:13px;color:#555;font-weight:400;width:40%;border-top:1px solid #eee">${escapeHtml(k)}</th><td style="padding:8px 24px;font-size:15px;font-weight:700;border-top:1px solid #eee">${escapeHtml(v)}</td></tr>`).join('')}</table>${notes.map(n=>`<p style="margin:0 24px 12px;font-size:14px;line-height:1.6">${escapeHtml(n)}</p>`).join('')}<div style="padding:8px 24px 24px">${links.map(([k,v])=>`<p style="margin:8px 0"><a href="${escapeHtml(v)}" style="color:#111;font-weight:700">${escapeHtml(k)}</a></p>`).join('')}</div></div></body></html>`});
 if(event==='BOOKING_CONFIRMED'){const pay=payment[s.paymentStatus]??['お支払いを確認中','Payment being confirmed'];
  return render(ja?`${brand} ご予約が確定しました`:`${brand} booking confirmed`,t('ご予約ありがとうございます。予約が確定しました。','Thank you. Your booking is confirmed.'),
   [[t('予約番号','Booking reference'),s.bookingId],[t('受取','Pickup'),storeDisplayName(s.pickupStore)+' · '+s.startDate],[t('返却','Return'),storeDisplayName(s.returnStore)+' · '+s.endDate],[t('合計（税込）','Total (tax included)'),yen(s.totalJpy)],[t('お支払い','Payment'),pay[ja?0:1]]],
   [t('受取時に予約確認ページのQRをスタッフへお見せください。別の端末では、予約確認ページで予約番号と登録メールアドレスを入力すると、確認コードをメールでお送りします。','Show the QR on your booking page at pickup. On another device, enter your booking reference and registered email on the booking page and we will email you a code.'),t('利用開始の48時間前までは全額返金。それ以降の自動返金はありません。キャンセルは取り消せません。','Full refund until 48 hours before the rental starts; no automatic refund after that. Cancellation cannot be undone.')],
   [[t('予約確認・QR','Booking and QR'),access],[t('受取・返却のご案内','Pickup and return guide'),origin+'/'+locale+'/pickup-return'],[t('キャンセル・返金規定','Cancellation and refund policy'),origin+'/'+locale+'/legal/cancellation']]);}
 if(event==='BOOKING_CANCELLED'&&s.cancellation){const c=s.cancellation;if(!Number.isSafeInteger(c.refundAmountJpy)||c.refundAmountJpy<0||!Number.isSafeInteger(c.maximumRefundJpy)||c.maximumRefundJpy<0||!['REFUND_NONE','REFUND_PENDING','REFUND_UNKNOWN','REFUND_COMPLETED','REFUND_FAILED','PAYMENT_UNKNOWN'].includes(c.refundStatus))throw new FlowError('NOTIFICATION_SNAPSHOT_INVALID',503);
  const status:Record<string,[string,string]>={REFUND_NONE:['自動返金なし','No automatic refund'],REFUND_PENDING:['返金処理待ち','Refund pending'],REFUND_UNKNOWN:['返金結果を確認中','Refund status being verified'],REFUND_COMPLETED:['返金完了','Refund completed'],REFUND_FAILED:['返金にはスタッフの確認が必要です','Refund requires staff review'],PAYMENT_UNKNOWN:['決済結果を確認中。決済完了が確認された場合に返金します','Payment is being verified. A completed payment will be refunded']};
  return render(ja?`${brand} 予約キャンセルのお知らせ`:`${brand} booking cancelled`,t('ご予約のキャンセルが完了しました。','Your booking has been cancelled.'),
   [[t('予約番号','Booking reference'),s.bookingId],[t('返金済み金額','Amount refunded'),yen(c.refundAmountJpy)],[t('決済結果による返金上限','Maximum refund subject to payment verification'),yen(c.maximumRefundJpy)],[t('返金状況','Refund status'),status[c.refundStatus]![ja?0:1]]],[],
   [[t('予約確認','Booking page'),access]]);
 }
 if(event==='BOOKING_RECOVERY'&&recovery&&/^[-_A-Za-z0-9]{43}$/.test(recovery.code)&&Number.isFinite(Date.parse(recovery.expiresAt)))return render(ja?`${brand} 予約確認ページの再表示コード`:`${brand} booking access code`,t('予約確認ページを開くためのコードです。','Your code to open your booking page.'),
   [[t('予約番号','Booking reference'),s.bookingId],[t('確認コード','Recovery code'),recovery.code],[t('有効期限','Expires'),recovery.expiresAt]],
   [t('コードは予約確認ページに入力してください。本人確認後10分間、キャンセル手続きも行えます。予約内容の変更や支払はできません。','Enter the code on your booking page. Verification also gives you ten minutes to cancel. It does not allow amendments or payments.'),t('このコードは第三者へ共有しないでください。','Do not share this code with anyone.')],
   [[t('予約確認・QR','Booking and QR'),access]]);
 throw new FlowError('NOTIFICATION_EVENT_UNCONNECTED',503);
}
