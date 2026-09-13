 'use client';
import {useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import type {BookingAccess} from '../../../../packages/core/src/guest/booking-access';
type View=Awaited<ReturnType<BookingAccess['read']>>&{qrImage:string};
async function request(path:string,body?:unknown){const r=await fetch('/api/booking-access'+path,{method:body===undefined?'GET':'POST',cache:'no-store',headers:{'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});const v=await r.json();if(!r.ok)throw new Error(v.error);return v;}
export function SaveBookingAccess({bookingId,locale}:{bookingId:string;locale:string}){
 const [status,setStatus]=useState(''),[saved,setSaved]=useState(false),[busy,setBusy]=useState(false);const active=useRef(false);
 async function save(){if(active.current)return;active.current=true;setBusy(true);setSaved(false);try{
  // Only a non-secret request id persists here. Reusing it survives an unacknowledged response.
  const key='zao-booking-access-request:'+bookingId;let requestId=sessionStorage.getItem(key);if(!requestId){requestId=crypto.randomUUID();sessionStorage.setItem(key,requestId);}
  await request('/issue',{bookingId,requestId});setSaved(true);setStatus('この端末で元の返却期限まで予約確認・QRを閲覧できます。');
 }catch{setStatus('保存の完了は未確認です。同じ要求を再照合してください。入力用アクセスも失った場合は、メール復旧接続待ちです。');}finally{active.current=false;setBusy(false);}}
 return <section aria-label="予約閲覧の保存"><button disabled={busy} onClick={()=>void save()}>予約閲覧をこの端末へ保存</button><p role="status">{status}</p>{saved&&<Link href={'/'+locale+'/reservation'}>保存した予約とQRを開く</Link>}<p>共有端末では保存せず、利用後は閲覧権を失効してください。別端末へのメール配送は未接続です。</p></section>;
}
export function ConfirmedBooking(){
 const [view,setView]=useState<View|null>(null),[message,setMessage]=useState('読み込み中…'),[busy,setBusy]=useState(false);const ticket=useRef(0);
 async function reload(){const n=++ticket.current;setView(null);try{const v=await request('');if(n===ticket.current){setView(v);setMessage('');}}catch{if(n===ticket.current)setMessage('予約の閲覧権がないか、失効・期限切れです。予約を変更する権限はありません。');}}
 useEffect(()=>{let cancelled=false;const n=++ticket.current;request('').then(v=>{if(!cancelled&&n===ticket.current){setView(v);setMessage('');}}).catch(()=>{if(!cancelled&&n===ticket.current)setMessage('予約の閲覧権がないか、失効・期限切れです。');});const blur=()=>{++ticket.current;setView(null);},focus=()=>{void reload();};window.addEventListener('pagehide',blur);window.addEventListener('focus',focus);window.addEventListener('pageshow',focus);return()=>{cancelled=true;window.removeEventListener('pagehide',blur);window.removeEventListener('focus',focus);window.removeEventListener('pageshow',focus);};},[]);

 return <section aria-label="保存済み予約"><h1>予約確認・QR</h1><p>開発用の合成予約です。実決済・本番予約ではありません。</p>{view&&<><p>{view.state} / {view.mode}</p><p>{view.period.startDate} → {view.period.endDate}</p><p>{view.pickupStore} → {view.returnStore}</p><p>元の返却期限: <time>{view.dueAt}</time></p><p>保存済み参考総額: {view.totalJpy} JPY（請求確定不可）</p><picture><img src={view.qrImage} width={240} height={240} alt="保存済み予約QR"/></picture><p>QRは予約の識別子です。貸出には店舗スタッフによる認証・権限確認が必要です。</p></>}{message&&<p role="status">{message}</p>}<button onClick={()=>void reload()}>予約を再読込</button><button disabled={busy} onClick={async()=>{
  ++ticket.current;setView(null);setBusy(true);
  try{
   // Only a non-secret booking ID is kept across a lost revocation acknowledgement.
   // It can clear client retry metadata, never grant server authority.
   const pendingKey='zao-booking-access-pending-revoke';
   if(view)sessionStorage.setItem(pendingKey,view.id);
   const bookingId=sessionStorage.getItem(pendingKey);
   await request('/revoke',{});
   // A later explicit Save gesture starts a fresh request. Never clear on issue error
   // or unacknowledged revoke, and never revive the revoked database row/key.
   if(bookingId)sessionStorage.removeItem('zao-booking-access-request:'+bookingId);
   sessionStorage.removeItem(pendingKey);
   ++ticket.current;setView(null);setMessage('この端末の予約閲覧権を失効しました。');
  }catch{setMessage('失効完了は未確認です。再度照合してください。');}finally{setBusy(false);}
 }}>この端末の予約閲覧権を失効</button></section>;
}
