 'use client';
import {useProductionCopy} from './ProductionCopy';
import {BookingCancellation} from './BookingCancellation';
import {useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {BookingRecoveryForm,PrepareBookingRecovery} from './BookingRecovery';
import {storeName,yen,jstDateTime} from './guest-format';
import type {BookingAccess} from '../../../../packages/core/src/guest/booking-access';
type View=Awaited<ReturnType<BookingAccess['read']>>&{qrImage:string|null};
async function request(path:string,body?:unknown){const r=await fetch('/api/booking-access'+path,{method:body===undefined?'GET':'POST',cache:'no-store',headers:{'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});const v=await r.json();if(!r.ok)throw new Error(v.error);return v;}
export function SaveBookingAccess({bookingId,locale}:{bookingId:string;locale:string}){
 const ja=locale==='ja',t=(j:string,e:string)=>ja?j:e;
 const [status,setStatus]=useState(''),[saved,setSaved]=useState(false),[busy,setBusy]=useState(false);const active=useRef(false);
 async function save(){if(active.current)return;active.current=true;setBusy(true);setSaved(false);try{
  // Only a non-secret request id persists here. Reusing it survives an unacknowledged response.
  const key='zao-booking-access-request:'+bookingId;let requestId=sessionStorage.getItem(key);if(!requestId){requestId=crypto.randomUUID();sessionStorage.setItem(key,requestId);}
  await request('/issue',{bookingId,requestId});setSaved(true);setStatus(t('この端末に予約を保存しました。返却期限まで予約とQRを確認できます。','Your booking is saved on this device. You can open it and its QR until the return deadline.'));
 }catch{setStatus(t('保存を確認できませんでした。もう一度「この端末に予約を保存」を押してください。','We could not confirm the save. Please select ‘Save booking on this device’ again.'));}finally{active.current=false;setBusy(false);}}
 return <section aria-label={t('予約の保存','Save booking')}><button disabled={busy} onClick={()=>void save()}>{t('この端末に予約を保存','Save booking on this device')}</button><p role="status">{status}</p>{saved&&<Link href={'/'+locale+'/reservation'}>{t('保存した予約とQRを開く','Open the saved booking and QR')}</Link>}<p>{t('ご自身の端末に保存してください。共有端末では、利用後に予約情報を削除してください。','Save on your own device. On a shared device, remove the saved booking after use.')}</p><details className="guest-secondary"><summary>{t('別の端末で予約を見る','View booking on another device')}</summary><PrepareBookingRecovery bookingId={bookingId} locale={locale}/></details></section>;
}
function pendingRevoke(){try{return sessionStorage.getItem('zao-booking-access-pending-revoke');}catch{return null;}}
export function ConfirmedBooking({locale}:{locale:string}){
 const productionCopy=useProductionCopy();
 const ja=locale==='ja',t=(j:string,e:string)=>ja?j:e;
 const [view,setView]=useState<View|null>(null),[message,setMessage]=useState(t('読み込み中…','Loading…')),[busy,setBusy]=useState(false),[reading,setReading]=useState(true),[pendingBookingId,setPendingBookingId]=useState<string|null>(null);const ticket=useRef(0),revoking=useRef(false);
 // UX-3A: a 503 here means booking confirmation is not connected in this environment, not that
 // this specific booking's access was denied or has expired -- the error code is explicit
 // (BOOKING_ACCESS_UNCONFIGURED, see /api/booking-access), so the two must not share one message.
 function accessErrorText(e:unknown){return e instanceof Error&&e.message==='BOOKING_ACCESS_UNCONFIGURED'?t('この環境では予約確認機能が準備中です。しばらくしてからもう一度お試しください。','Booking confirmation is not ready in this environment yet. Please try again shortly.'):t('この端末に予約が見つかりません。確認コードを使って予約を開いてください。','No saved booking was found on this device. Use your verification code to open it.');}
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

 return <section className="st-res" aria-label={t('保存済み予約','Saved booking')}><h1>{t('予約確認・QR','Booking confirmation & QR')}</h1>{view&&view.mode!=='SQUARE_PRODUCTION'&&!productionCopy&&<p className="guest-preview-note">{t('開発用の合成予約です。実決済・本番予約ではありません。','This is a synthetic development booking. No real payment or production booking.')}</p>}{view&&<div className="st-res-card"><p className="st-res-state">{view.state==='CANCELLED'?t('予約はキャンセルされました','Booking cancelled'):['COMPLETED_DEV','COMPLETED'].includes(view.state)?t('ご利用が完了しました','Rental completed'):t('予約が確認されました','Booking confirmed')}</p><p className="st-res-dates">{view.period.startDate} → {view.period.endDate}</p><p>{t('受取','Pickup')}: {storeName(ja,view.pickupStore)} → {t('返却','Return')}: {storeName(ja,view.returnStore)}</p><p>{t('返却期限','Return deadline')}: <time dateTime={view.dueAt}>{jstDateTime(ja,view.dueAt)}</time></p><p className="st-res-total">{(view.mode==='SQUARE_PRODUCTION'||productionCopy)?t('お支払い金額（税込）','Booking total (tax included)'):t('保存済み参考総額','Saved reference total')}: {yen(ja,view.totalJpy)}{view.mode!=='SQUARE_PRODUCTION'&&!productionCopy&&t('（請求確定不可）',' (not a final charge)')}</p>{view.qrImage&&<picture className="st-res-qr"><img src={view.qrImage} width={240} height={240} alt={t('保存済み予約QR','Saved booking QR')}/></picture>}<p className="st-res-note">{t('受取時にこのQRをスタッフへお見せください。ご本人確認をお願いする場合があります。','Show this QR to the staff at pickup. We may ask you to confirm your identity.')}</p>{view.cancellationAllowed||view.cancellation?.cancelledAt?<BookingCancellation locale={ja?'ja':'en'} status={view.cancellation} accessBookingId={view.id} onCancelled={reload}/>:<p className="st-res-note">{t('キャンセルする場合は、確認コードで予約を開き直してください。確認後10分以内にお手続きください。','To cancel, reopen your booking with a verification code and complete cancellation within ten minutes.')}</p>}</div>}{message&&<p role="status">{message}</p>}<div className="st-res-acts"><button disabled={busy||reading} onClick={()=>void reload()}>{t('予約を再読込','Reload booking')}</button><button className="st-danger" disabled={busy||reading||(!view&&!pendingBookingId)} onClick={async()=>{
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
   ++ticket.current;setView(null);setMessage(t('この端末から予約情報を削除しました。予約自体はキャンセルされません。','The saved booking has been removed from this device. Your booking has not been cancelled.'));
  }catch{setMessage(t('削除を確認できませんでした。もう一度お試しください。','We could not confirm removal. Please try again.'));}finally{revoking.current=false;setBusy(false);setReading(false);}
 }}>{t('この端末から予約情報を削除','Remove booking from this device')}</button></div><details className="guest-secondary"><summary>{t('別の端末で予約を見る','View booking on another device')}</summary><BookingRecoveryForm locale={locale} beforeChange={()=>{revoking.current=true;++ticket.current;setView(null);setReading(true);setBusy(true);}} afterChange={()=>{revoking.current=false;setBusy(false);void reload();}}/></details></section>;
}
