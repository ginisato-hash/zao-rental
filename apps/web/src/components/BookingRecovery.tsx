 'use client';
import {RequestBookingRecovery} from './RequestBookingRecovery';
import {useRef,useState} from 'react';
export function BookingRecoveryForm({beforeChange,afterChange,locale}:{beforeChange:()=>void;afterChange:()=>void;locale:string}){
 const ja=locale==='ja',t=(j:string,e:string)=>ja?j:e;
 const [code,setCode]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState('');const active=useRef(false);
 async function send(action:'exchange'|'revoke'){
  if(active.current)return;active.current=true;setBusy(true);setMessage('');beforeChange();
  try{
   if(!/^[-_A-Za-z0-9]{43}$/.test(code))throw new Error();
   // Persist only a digest + random request id. Re-enter the code after reload;
   // raw proof never goes into URL/sessionStorage/localStorage or analytics.
   const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(code))),v=>v.toString(16).padStart(2,'0')).join('');
   const storage='zao-booking-recovery-exchange:'+digest;let requestId=sessionStorage.getItem(storage);if(!requestId){requestId=crypto.randomUUID();sessionStorage.setItem(storage,requestId);}
   const r=await fetch('/api/booking-access/recovery/'+action,{method:'POST',cache:'no-store',headers:{'content-type':'application/json'},body:JSON.stringify(action==='exchange'?{code,requestId}:{code})});
   if(!r.ok)throw new Error();const result=await r.json();
   if(action==='revoke'){setCode('');setMessage(t('この確認コードと、このコードで保存した予約情報を削除しました。予約自体はキャンセルされません。','This code and bookings saved with it have been removed. The booking itself has not been cancelled.'));return;}
   if(result.recovered!==true)throw new Error();setCode('');window.location.reload();
  }catch{setCode('');setMessage(t('予約を開けませんでした。同じコードをもう一度入力してください。期限切れの場合は新しいコードを受け取ってください。','We could not open the booking. Enter the same code again. If it has expired, request a new code.'));}finally{active.current=false;setBusy(false);afterChange();}
 }
 return <section aria-label={t('確認コードで予約を開く','Open booking with a code')}><h2>{t('確認コードで予約を開く','Open your booking')}</h2><p>{t('メールで受け取った確認コードを入力してください。キャンセルする場合は、確認後10分以内にお手続きください。','Enter the verification code from your email. If you wish to cancel, complete cancellation within ten minutes of verification.')}</p><form method="post" onSubmit={e=>{e.preventDefault();void send('exchange');}}><label>{t('確認コード','Verification code')}<input type="password" autoComplete="off" maxLength={43} value={code} onChange={e=>setCode(e.target.value)} disabled={busy}/></label><button disabled={busy||!code}>{t('予約を開く','Open the booking with this code')}</button><button className="st-danger" type="button" disabled={busy||!code} onClick={()=>void send('revoke')}>{t('この確認コードを無効にする','Deactivate this code')}</button></form>{message&&<p role="status">{message}</p>}<RequestBookingRecovery/></section>;
}
export function PrepareBookingRecovery({bookingId,locale}:{bookingId:string;locale:string}){
 const ja=locale==='ja',t=(j:string,e:string)=>ja?j:e;
 const [busy,setBusy]=useState(false),[message,setMessage]=useState('');const active=useRef(false);
 return <section aria-label={t('確認コードをメールで受け取る','Receive a verification code by email')}><button disabled={busy} onClick={async()=>{if(active.current)return;active.current=true;setBusy(true);try{const storage='zao-booking-recovery-prepare:'+bookingId;let requestId=sessionStorage.getItem(storage);if(!requestId){requestId=crypto.randomUUID();sessionStorage.setItem(storage,requestId);}const r=await fetch('/api/booking-access/recovery/prepare',{method:'POST',cache:'no-store',headers:{'content-type':'application/json'},body:JSON.stringify({bookingId,requestId})});if(!r.ok)throw new Error();const v=await r.json();setMessage(v.delivery==='QUEUED'?t('確認コードの送信を受け付けました。メールが届くまでお待ちください。','Your request is queued. Please wait for the email.'):v.delivery==='DELIVERED'?t('確認コードを登録メールアドレスへ送りました。','The verification code has been sent to your registered email.'):t('メールの送信を確認中です。しばらくしてからもう一度お試しください。','Email delivery is being checked. Please try again shortly.'));}catch{setMessage(t('現在、確認コードを送信できません。しばらくしてからもう一度お試しください。','We cannot send a verification code right now. Please try again shortly.'));}finally{active.current=false;setBusy(false);}}}>{t('確認コードをメールで受け取る','Receive a verification code by email')}</button>{message&&<p role="status">{message}</p>}</section>;
}
