'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import jsQR from 'jsqr';
import {useStaffLocale} from './staff-locale';
import {classifyScan} from '../../../../packages/contracts/src/reservation-qr';
import {invalidateStaffView} from './StaffSessionBoundary';
import {statusLabel,fmtDate} from './order-labels';
import {storeName} from './guest-format';
// Input only: turns a booking QR, a canonical booking UUID or the short number shown on screen (#XXXXXXXX) into ONE booking id
// and hands it to the parent. A short number that matches several bookings shows the candidates and a person chooses; nothing is
// ever picked automatically. Read-only: never creates a booking, never touches custody state or payment. A decoded value that is
// not one of the known formats is never opened or fetched ("unsupported code"). The camera image is decoded in this browser only.
type Candidate={id:string;ref:string;customer:string|null;status:string;pickupStore:string;returnStore:string;startDate:string;endDate:string};
export function BookingSearchInput({onBooking,stamp}:{onBooking:(id:string)=>void;stamp?:string}){
 const {locale}=useStaffLocale(),t=(j:string,e:string)=>locale==='en'?e:j,p=(j:string,e:string)=>[j,e] as const;
 const video=useRef<HTMLVideoElement>(null),canvas=useRef<HTMLCanvasElement>(null),stream=useRef<MediaStream|null>(null),frame=useRef<number|null>(null),generation=useRef(0),alive=useRef(false),last=useRef(''),busy=useRef(false),lookup=useRef(0);
 const [starting,setStarting]=useState(false),[running,setRunning]=useState(false),[pending,setPending]=useState(false),[scanned,setScanned]=useState(false),[manual,setManual]=useState(''),[messagePair,setMessage]=useState<readonly [string,string]|null>(null),[candidates,setCandidates]=useState<{ref:string;rows:Candidate[];truncated:boolean}|null>(null);
 const message=messagePair?(locale==='en'?messagePair[1]:messagePair[0]):'';
 const callback=useRef(onBooking);useEffect(()=>{callback.current=onBooking;},[onBooking]);
 const stop=useCallback(()=>{generation.current++;if(frame.current!==null)cancelAnimationFrame(frame.current);frame.current=null;stream.current?.getTracks().forEach(t=>t.stop());stream.current=null;if(video.current)video.current.srcObject=null;last.current='';if(alive.current){setStarting(false);setRunning(false);}},[]);
 const invalidate=useCallback(()=>{lookup.current++;},[]);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;invalidate();stop();};},[stop,invalidate]);
 useEffect(()=>{const hide=()=>{if(document.hidden)stop();};document.addEventListener('visibilitychange',hide);return()=>document.removeEventListener('visibilitychange',hide);},[stop]);
 useEffect(()=>{const off=()=>{stop();setMessage(p('通信が切れました。通信が戻ってからもう一度読み取るか、予約番号を手入力してください。','You are offline. Reconnect and scan again, or type the booking number.'));};window.addEventListener('offline',off);return()=>window.removeEventListener('offline',off);},[stop]);
 const get=(path:string)=>fetch(path,{cache:'no-store',headers:stamp?{'x-zao-session':stamp}:{}});
 async function resolve(raw:string,fromCamera=false){
  if(busy.current)return;const c=classifyScan(raw);
  if(c.kind==='unsupported'){setCandidates(null);setMessage(p('対応していないコードです。予約QR、予約番号（#から始まる8桁）、予約IDを読み取ってください。','Unsupported code. Scan a booking QR, or enter the booking number (# and 8 characters) or booking ID.'));return;}
  if(!navigator.onLine){setMessage(p('通信できないため照合していません。通信が戻ってからやり直してください。','Not looked up: you are offline. Try again when the connection is back.'));return;}
  if(fromCamera)stop();
  const own=++lookup.current,current=()=>alive.current&&lookup.current===own;busy.current=true;setPending(true);setCandidates(null);setMessage(null);setScanned(fromCamera);
  try{
   if(c.kind==='short'){
    const r=await get('/api/operations/orders/lookup?'+new URLSearchParams({ref:c.ref}).toString());if(!current())return;
    if(r.status===401){invalidateStaffView();return;}
    if(r.status===403){setMessage(p('予約を検索する権限がありません。予約QRか予約IDで開いてください。','You do not have permission to search bookings. Use the booking QR or booking ID.'));return;}
    if(!r.ok){setMessage(p('検索できませんでした。もう一度お試しください。','The search failed. Please try again.'));return;}
    const v=await r.json() as {ref:string;matches:Candidate[];truncated:boolean};if(!current())return;
    if(!v.matches.length){setMessage(p('#'+v.ref+' に一致する予約は見つかりません。番号と店舗の権限を確認してください。','No booking matches #'+v.ref+'. Check the number and your station access.'));return;}
    if(v.matches.length===1&&!v.truncated){setMessage(null);callback.current(v.matches[0]!.id);return;}
    setCandidates({ref:v.ref,rows:v.matches,truncated:v.truncated});setMessage(p('同じ番号の予約が複数あります。開く予約を選んでください。','Several bookings share this number. Choose the booking to open.'));return;
   }
   // A canonical id: confirm it is a booking this person can see, and tell an item label apart from a booking.
   const o=await get('/api/operations/orders/'+encodeURIComponent(c.id));if(!current())return;
   if(o.status===401){invalidateStaffView();return;}
   if(o.ok||o.status===403){callback.current(c.id);return;}
   if(o.status===404){
    const a=c.kind==='uuid'?await get('/api/operations/assets/'+encodeURIComponent(c.id)):null;if(!current())return;
    if(a&&a.ok){setMessage(p('これは用品のQRです。「用品」タブで読み取ってください。','This is an item QR. Scan it on the Item tab.'));return;}
    setMessage(p('この予約は見つからないか、閲覧できる店舗にありません。','This booking was not found or is not at a station you can see.'));return;
   }
   setMessage(p('照合できませんでした。もう一度お試しください。','Could not look it up. Please try again.'));
  }catch{if(current())setMessage(p('通信できませんでした。通信を確認してもう一度お試しください。','The connection failed. Check it and try again.'));}
  finally{busy.current=false;if(alive.current)setPending(false);}
 }
 async function start(){if(starting||running)return;
  if(typeof navigator==='undefined'||!navigator.mediaDevices?.getUserMedia){setMessage(p('このブラウザ・接続ではカメラを使えません（HTTPS接続が必要です）。予約番号を手入力できます。','The camera is unavailable in this browser or connection (HTTPS is required). You can type the booking number.'));return;}
  const own=++generation.current;setStarting(true);setMessage(null);setCandidates(null);setScanned(false);last.current='';
  try{const media=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});if(!alive.current||generation.current!==own){media.getTracks().forEach(t=>t.stop());return;}stream.current=media;video.current!.srcObject=media;await video.current!.play();if(!alive.current||generation.current!==own)return;setStarting(false);setRunning(true);let at=0;
   const read=(now:number)=>{if(!alive.current||generation.current!==own)return;const v=video.current,c=canvas.current;if(!busy.current&&now-at>=150&&v&&c&&v.readyState>=2&&v.videoWidth){at=now;const scale=Math.min(1,640/v.videoWidth);c.width=Math.round(v.videoWidth*scale);c.height=Math.round(v.videoHeight*scale);const ctx=c.getContext('2d',{willReadFrequently:true});if(ctx){ctx.drawImage(v,0,0,c.width,c.height);const qr=jsQR(ctx.getImageData(0,0,c.width,c.height).data,c.width,c.height);if(qr&&qr.data!==last.current){last.current=qr.data;void resolve(qr.data,true);}}}if(generation.current===own)frame.current=requestAnimationFrame(read);};frame.current=requestAnimationFrame(read);
  }catch(e){if(alive.current&&generation.current===own){stop();const n=(e as Error).name;setMessage(n==='NotAllowedError'||n==='SecurityError'?p('カメラの許可がありません。予約番号を手入力できます。','Camera permission was denied. You can type the booking number.'):n==='NotFoundError'||n==='OverconstrainedError'?p('カメラが見つかりません。予約番号を手入力できます。','No camera found. You can type the booking number.'):p('カメラを開始できませんでした。予約番号を手入力できます。','The camera could not start. You can type the booking number.'));}}
 }
 return <section aria-label={t('予約QR・検索','Booking QR / search')} className="staff-search"><h2>{t('予約QR・検索','Booking QR / search')}</h2>
 <video ref={video} muted playsInline aria-label={t('予約QRカメラ','Booking QR camera')} hidden={!running} style={{width:'100%',maxWidth:480,maxHeight:360}}/><canvas ref={canvas} hidden/>
 <div className="staff-actions"><button type="button" disabled={starting||running} onClick={()=>void start()}>{t('カメラで読み取る','Scan with camera')}</button>{(starting||running)&&<button type="button" onClick={stop}>{t('カメラを止める','Stop camera')}</button>}{scanned&&!starting&&!running&&<button type="button" onClick={()=>void start()}>{t('もう一度読み取る','Scan again')}</button>}</div>
 <label>{t('予約番号または予約QR','Booking number or booking QR')}<input value={manual} onChange={e=>setManual(e.target.value)} maxLength={120} onKeyDown={e=>{if(e.key==='Enter'&&manual.trim()&&!pending)void resolve(manual);}}/></label><button type="button" disabled={!manual.trim()||pending} onClick={()=>void resolve(manual)}>{t('この予約を開く','Open this booking')}</button>
 <p role="status">{starting?t('カメラの許可を待っています。','Waiting for camera permission.'):pending?t('照合しています…','Looking up…'):message}</p>
 {candidates&&<ul aria-label={t('候補の予約','Candidate bookings')} className="staff-candidates">{candidates.rows.map(r=><li key={r.id}><span><strong>#{r.ref}</strong> {r.customer??'—'} · {fmtDate(locale,r.startDate)}–{fmtDate(locale,r.endDate)} · {storeName(locale!=='en',r.pickupStore)} · {statusLabel(locale,r.status)}</span> <button type="button" onClick={()=>callback.current(r.id)}>{t('この予約を選ぶ','Choose this booking')}</button></li>)}{candidates.truncated&&<li>{t('候補が多すぎるため先頭のみ表示しています。予約QRか予約IDで開いてください。','Too many candidates; only the first are shown. Use the booking QR or booking ID.')}</li>}</ul>}
 </section>;
}
