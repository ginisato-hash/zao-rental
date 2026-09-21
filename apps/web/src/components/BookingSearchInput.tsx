'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import jsQR from 'jsqr';
import {bookingIdFromInput} from '../../../../packages/contracts/src/reservation-qr';
// Input only: resolves an existing canonical booking UUID or reservation QR payload to a
// booking ID and hands it to the parent. Never creates a booking, never touches custody state,
// never repurposes AssetQrInput's Asset-only camera/manual path.
export function BookingSearchInput({onBooking}:{onBooking:(id:string)=>void}){
 const video=useRef<HTMLVideoElement>(null),canvas=useRef<HTMLCanvasElement>(null),stream=useRef<MediaStream|null>(null),frame=useRef<number|null>(null),generation=useRef(0),alive=useRef(false),last=useRef('');
 const [starting,setStarting]=useState(false),[running,setRunning]=useState(false),[manual,setManual]=useState(''),[message,setMessage]=useState('');
 const callback=useRef(onBooking);useEffect(()=>{callback.current=onBooking;},[onBooking]);
 const stop=useCallback(()=>{generation.current++;if(frame.current!==null)cancelAnimationFrame(frame.current);frame.current=null;stream.current?.getTracks().forEach(t=>t.stop());stream.current=null;if(video.current)video.current.srcObject=null;last.current='';if(alive.current){setStarting(false);setRunning(false);}},[]);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;stop();};},[stop]);
 useEffect(()=>{const hide=()=>{if(document.hidden)stop();};document.addEventListener('visibilitychange',hide);return()=>document.removeEventListener('visibilitychange',hide);},[stop]);
 function resolve(raw:string){const id=bookingIdFromInput(raw);if(!id){setMessage('予約IDまたは予約QRの内容を確認してください。');return;}setMessage('');callback.current(id);}
 async function start(){if(starting||running)return;const own=++generation.current;setStarting(true);setMessage('');last.current='';
  try{const media=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});if(!alive.current||generation.current!==own){media.getTracks().forEach(t=>t.stop());return;}stream.current=media;video.current!.srcObject=media;await video.current!.play();if(!alive.current||generation.current!==own)return;setStarting(false);setRunning(true);let at=0;
   const read=(now:number)=>{if(!alive.current||generation.current!==own)return;const v=video.current,c=canvas.current;if(now-at>=150&&v&&c&&v.readyState>=2&&v.videoWidth){at=now;const scale=Math.min(1,640/v.videoWidth);c.width=Math.round(v.videoWidth*scale);c.height=Math.round(v.videoHeight*scale);const ctx=c.getContext('2d',{willReadFrequently:true});if(ctx){ctx.drawImage(v,0,0,c.width,c.height);const qr=jsQR(ctx.getImageData(0,0,c.width,c.height).data,c.width,c.height);if(qr&&qr.data!==last.current){last.current=qr.data;resolve(qr.data);}}}if(generation.current===own)frame.current=requestAnimationFrame(read);};frame.current=requestAnimationFrame(read);
  }catch(e){if(alive.current&&generation.current===own){stop();setMessage((e as Error).name==='NotAllowedError'?'カメラの許可がありません。予約IDを手入力できます。':'カメラを開始できませんでした。予約IDを手入力できます。');}}
 }
 return <section aria-label="予約QR・検索" className="staff-search"><h2>予約QR・検索</h2><p>予約QR、または予約番号（UUID）を入力してください。</p>
 <video ref={video} muted playsInline aria-label="予約QRカメラ" hidden={!running} style={{width:'100%',maxWidth:480,maxHeight:360}}/><canvas ref={canvas} hidden/>
 <div className="staff-actions"><button type="button" disabled={starting||running} onClick={()=>void start()}>カメラで読み取る</button><button type="button" disabled={!starting&&!running} onClick={stop}>カメラを止める</button></div>
 <label>予約番号または予約QR<input value={manual} onChange={e=>setManual(e.target.value)} maxLength={120}/></label><button type="button" disabled={!manual.trim()} onClick={()=>resolve(manual)}>この予約を開く</button>
 <p role="status">{starting?'カメラの許可を待っています。':message}</p></section>;
}
