 'use client';
import {useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {BookingRecoveryForm,PrepareBookingRecovery} from './BookingRecovery';
import type {BookingAccess} from '../../../../packages/core/src/guest/booking-access';
type View=Awaited<ReturnType<BookingAccess['read']>>&{qrImage:string};
async function request(path:string,body?:unknown){const r=await fetch('/api/booking-access'+path,{method:body===undefined?'GET':'POST',cache:'no-store',headers:{'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});const v=await r.json();if(!r.ok)throw new Error(v.error);return v;}
export function SaveBookingAccess({bookingId,locale}:{bookingId:string;locale:string}){
 const ja=locale==='ja',t=(j:string,e:string)=>ja?j:e;
 const [status,setStatus]=useState(''),[saved,setSaved]=useState(false),[busy,setBusy]=useState(false);const active=useRef(false);
 async function save(){if(active.current)return;active.current=true;setBusy(true);setSaved(false);try{
  // Only a non-secret request id persists here. Reusing it survives an unacknowledged response.
  const key='zao-booking-access-request:'+bookingId;let requestId=sessionStorage.getItem(key);if(!requestId){requestId=crypto.randomUUID();sessionStorage.setItem(key,requestId);}
  await request('/issue',{bookingId,requestId});setSaved(true);setStatus(t('この端末で元の返却期限まで予約確認・QRを閲覧できます。','You can view this booking and its QR on this device until the original return deadline.'));
 }catch{setStatus(t('保存の完了は未確認です。同じ要求を再照合してください。入力用アクセスも失った場合は、メール復旧接続待ちです。','Save could not be confirmed. Reconcile the same request again. If you also lose access on this device, email-based recovery is not yet connected.'));}finally{active.current=false;setBusy(false);}}
 return <section aria-label={t('予約閲覧の保存','Save booking access')}><button disabled={busy} onClick={()=>void save()}>{t('予約閲覧をこの端末へ保存','Save booking access to this device')}</button><p role="status">{status}</p>{saved&&<Link href={'/'+locale+'/reservation'}>{t('保存した予約とQRを開く','Open the saved booking and QR')}</Link>}<p>{t('共有端末では保存せず、利用後は閲覧権を失効してください。別端末へのメール配送は未接続です。','Do not save this on a shared device, and revoke access after use. Email delivery to another device is not yet connected.')}</p><PrepareBookingRecovery bookingId={bookingId} locale={locale}/></section>;
}
function pendingRevoke(){try{return sessionStorage.getItem('zao-booking-access-pending-revoke');}catch{return null;}}
export function ConfirmedBooking({locale}:{locale:string}){
 const ja=locale==='ja',t=(j:string,e:string)=>ja?j:e;
 const [view,setView]=useState<View|null>(null),[message,setMessage]=useState(t('読み込み中…','Loading…')),[busy,setBusy]=useState(false),[reading,setReading]=useState(true),[pendingBookingId,setPendingBookingId]=useState<string|null>(null);const ticket=useRef(0),revoking=useRef(false);
 // UX-3A: a 503 here means booking confirmation is not connected in this environment, not that
 // this specific booking's access was denied or has expired -- the error code is explicit
 // (BOOKING_ACCESS_UNCONFIGURED, see /api/booking-access), so the two must not share one message.
 function accessErrorText(e:unknown){return e instanceof Error&&e.message==='BOOKING_ACCESS_UNCONFIGURED'?t('この環境では予約確認機能が準備中です。しばらくしてからもう一度お試しください。','Booking confirmation is not ready in this environment yet. Please try again shortly.'):t('予約の閲覧権がないか、失効・期限切れです。予約を変更する権限はありません。','You do not have viewing access to this booking, or it has expired or been revoked. You cannot change the booking.');}
 async function reload(){if(revoking.current)return;const n=++ticket.current;setReading(true);setView(null);try{const v=await request('');if(n===ticket.current){setView(v);setMessage('');}}catch(e){if(n===ticket.current)setMessage(accessErrorText(e));}finally{if(n===ticket.current){setPendingBookingId(pendingRevoke());setReading(false);}}}
 useEffect(()=>{
  let cancelled=false;const n=++ticket.current;
  request('').then(v=>{if(!cancelled&&n===ticket.current){setView(v);setMessage('');}})
   .catch(e=>{if(!cancelled&&n===ticket.current)setMessage(accessErrorText(e));})
   .finally(()=>{if(!cancelled&&n===ticket.current){setPendingBookingId(pendingRevoke());setReading(false);}});
  const blur=()=>{++ticket.current;setView(null);setReading(false);},focus=()=>{void reload();};
  window.addEventListener('pagehide',blur);window.addEventListener('focus',focus);window.addEventListener('pageshow',focus);
  return()=>{cancelled=true;window.removeEventListener('pagehide',blur);window.removeEventListener('focus',focus);window.removeEventListener('pageshow',focus);};
 // eslint-disable-next-line react-hooks/exhaustive-deps -- ja/t are derived from the locale prop, stable for the lifetime of this route
 },[]);

 return <section aria-label={t('保存済み予約','Saved booking')}><h1>{t('予約確認・QR','Booking confirmation & QR')}</h1><p>{t('開発用の合成予約です。実決済・本番予約ではありません。','This is a synthetic development booking. No real payment or production booking.')}</p>{view&&<><p>{view.state==='COMPLETED_DEV'?t('ご利用が完了しました','Rental completed'):t('予約が確認されました','Booking confirmed')}</p><p>{view.period.startDate} → {view.period.endDate}</p><p>{view.pickupStore} → {view.returnStore}</p><p>{t('元の返却期限','Original return deadline')}: <time>{view.dueAt}</time></p><p>{t('保存済み参考総額','Saved reference total')}: {view.totalJpy} JPY{t('（請求確定不可）',' (not a final charge)')}</p><picture><img src={view.qrImage} width={240} height={240} alt={t('保存済み予約QR','Saved booking QR')}/></picture><p>{t('QRは予約の識別子です。貸出には店舗スタッフによる認証・権限確認が必要です。','The QR is a booking identifier. Handover still requires in-person authentication and authorization by staff.')}</p></>}{message&&<p role="status">{message}</p>}<button disabled={busy||reading} onClick={()=>void reload()}>{t('予約を再読込','Reload booking')}</button><button disabled={busy||reading||(!view&&!pendingBookingId)} onClick={async()=>{
  if(revoking.current||reading||(!view&&!pendingBookingId))return;
  revoking.current=true;++ticket.current;setView(null);setBusy(true);
  try{
   // Only a non-secret booking ID is kept across a lost revocation acknowledgement.
   // It can clear client retry metadata, never grant server authority.
   const pendingKey='zao-booking-access-pending-revoke';
   const bookingId=view?.id??pendingBookingId;
   if(!bookingId)throw new Error('BOOKING_BINDING_UNAVAILABLE');
   sessionStorage.setItem(pendingKey,bookingId);setPendingBookingId(bookingId);
   await request('/revoke',{});
   // A later explicit Save gesture starts a fresh request. Never clear on issue error
   // or unacknowledged revoke, and never revive the revoked database row/key.
   if(bookingId)sessionStorage.removeItem('zao-booking-access-request:'+bookingId);
   sessionStorage.removeItem(pendingKey);setPendingBookingId(null);
   ++ticket.current;setView(null);setMessage(t('この端末の予約閲覧権を失効しました。','Viewing access on this device has been revoked.'));
  }catch{setMessage(t('失効完了は未確認です。再度照合してください。','Revocation could not be confirmed. Reconcile again.'));}finally{revoking.current=false;setBusy(false);setReading(false);}
 }}>{t('この端末の予約閲覧権を失効','Revoke viewing access on this device')}</button><BookingRecoveryForm locale={locale} beforeChange={()=>{revoking.current=true;++ticket.current;setView(null);setReading(true);setBusy(true);}} afterChange={()=>{revoking.current=false;setBusy(false);void reload();}}/></section>;
}
