 'use client';
import {RequestBookingRecovery} from './RequestBookingRecovery';
import {useRef,useState} from 'react';
export function BookingRecoveryForm({beforeChange,afterChange}:{beforeChange:()=>void;afterChange:()=>void}){
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
   if(action==='revoke'){setCode('');setMessage('復旧コードと、そのコードで発行した閲覧権を失効しました。');return;}
   if(result.recovered!==true)throw new Error();setCode('');window.location.reload();
  }catch{setCode('');setMessage('復旧結果は未確認、またはコードが失効しています。同じコードを再入力して照合してください。別の要求や予約は作成しません。');}finally{active.current=false;setBusy(false);afterChange();}
 }
 return <section aria-label="予約閲覧の復旧"><h2>別の端末で予約を確認</h2><p>事前に受け取った復旧コードを入力してください。予約の変更・支払・貸出はできません。元の返却期限を過ぎると利用できません。</p><form method="post" onSubmit={e=>{e.preventDefault();void send('exchange');}}><label>予約復旧コード<input type="password" autoComplete="off" maxLength={43} value={code} onChange={e=>setCode(e.target.value)} disabled={busy}/></label><button disabled={busy||!code}>復旧コードで予約を開く</button><button type="button" disabled={busy||!code} onClick={()=>void send('revoke')}>この復旧コードを失効</button></form>{message&&<p role="status">{message}</p>}<RequestBookingRecovery/></section>;
}
export function PrepareBookingRecovery({bookingId}:{bookingId:string}){
 const [busy,setBusy]=useState(false),[message,setMessage]=useState('');const active=useRef(false);
 return <section aria-label="予約復旧コードの配送"><button disabled={busy} onClick={async()=>{if(active.current)return;active.current=true;setBusy(true);try{const storage='zao-booking-recovery-prepare:'+bookingId;let requestId=sessionStorage.getItem(storage);if(!requestId){requestId=crypto.randomUUID();sessionStorage.setItem(storage,requestId);}const r=await fetch('/api/booking-access/recovery/prepare',{method:'POST',cache:'no-store',headers:{'content-type':'application/json'},body:JSON.stringify({bookingId,requestId})});if(!r.ok)throw new Error();const v=await r.json();setMessage(v.delivery==='QUEUED'?'配送要求を保存しました。配送事業者は未接続で、送信完了ではありません。':v.delivery==='DELIVERED'?'接続済みの配送先への受け渡しを確認しました。':'配送の完了は未確認です。同じ要求の照合を続けてください。');}catch{setMessage('配送は未接続、または受付できません。コードをチャットへ送らないでください。');}finally{active.current=false;setBusy(false);}}}>復旧コードの配送・照合</button>{message&&<p role="status">{message}</p>}</section>;
}
