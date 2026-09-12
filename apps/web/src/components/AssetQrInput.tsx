'use client';
import {useCallback,useEffect,useRef,useState,useSyncExternalStore} from 'react';
import jsQR from 'jsqr';
import {assetIdFromQr} from '../../../../packages/contracts/src/asset-qr';
// Input only: the parent must authorize/persist an exact loan-cycle candidate and expose acknowledgement.
// Camera pixels stay in this browser. This component never fetches, saves or confirms a return.
const subscribe=()=>()=>{};
export function AssetQrInput({onAsset,disabled=false}:{onAsset:(id:string)=>Promise<void>;disabled?:boolean}){
 const video=useRef<HTMLVideoElement>(null),canvas=useRef<HTMLCanvasElement>(null),stream=useRef<MediaStream|null>(null),frame=useRef<number|null>(null),generation=useRef(0),alive=useRef(false),busy=useRef(false),last=useRef(''),callback=useRef(onAsset);
 const ready=useSyncExternalStore(subscribe,()=>true,()=>false);
 const [starting,setStarting]=useState(false),[running,setRunning]=useState(false),[manual,setManual]=useState(''),[message,setMessage]=useState('');useEffect(()=>{callback.current=onAsset;},[onAsset]);
 const stop=useCallback(()=>{generation.current++;if(frame.current!==null)cancelAnimationFrame(frame.current);frame.current=null;stream.current?.getTracks().forEach(t=>t.stop());stream.current=null;if(video.current)video.current.srcObject=null;last.current='';if(alive.current){setStarting(false);setRunning(false);}},[]);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;stop();};},[stop]);
 useEffect(()=>{if(disabled)stop();},[disabled,stop]);
 useEffect(()=>{const hide=()=>{if(document.hidden)stop();};document.addEventListener('visibilitychange',hide);return()=>document.removeEventListener('visibilitychange',hide);},[stop]);
 async function emit(raw:string){const id=assetIdFromQr(raw);if(!id){setMessage('用品の個体IDを読み取ってください。');return;}if(busy.current)return;busy.current=true;try{await callback.current(id);if(alive.current)setMessage('コードを読み取りました。保存・受領の結果は照合画面で確認してください。');}catch{if(alive.current){stop();setMessage('照合できませんでした。未確認の要求を確認してから再開してください。');}}finally{busy.current=false;}}
 async function start(){if(disabled||starting||running||!ready)return;const own=++generation.current;setStarting(true);setMessage('');last.current='';
  try{const media=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});if(!alive.current||generation.current!==own){media.getTracks().forEach(t=>t.stop());return;}stream.current=media;video.current!.srcObject=media;await video.current!.play();if(!alive.current||generation.current!==own)return;setStarting(false);setRunning(true);let at=0;
   const read=(now:number)=>{if(!alive.current||generation.current!==own)return;const v=video.current,c=canvas.current;if(!busy.current&&now-at>=150&&v&&c&&v.readyState>=2&&v.videoWidth){at=now;const scale=Math.min(1,640/v.videoWidth);c.width=Math.round(v.videoWidth*scale);c.height=Math.round(v.videoHeight*scale);const ctx=c.getContext('2d',{willReadFrequently:true});if(ctx){ctx.drawImage(v,0,0,c.width,c.height);const qr=jsQR(ctx.getImageData(0,0,c.width,c.height).data,c.width,c.height);if(qr&&qr.data!==last.current){last.current=qr.data;void emit(qr.data);}}}if(generation.current===own)frame.current=requestAnimationFrame(read);};frame.current=requestAnimationFrame(read);
  }catch{if(alive.current&&generation.current===own){stop();setMessage('カメラを開始できませんでした。個体IDを手入力できます。');}}
 }
 return <section aria-label="用品QR入力"><h2>用品QRを読み取る</h2><p>左右が同じIDのスキー・ブーツは、片方を1回読み取れば1組です。</p><video ref={video} muted playsInline aria-label="用品QRカメラ" hidden={!running} style={{width:'100%',maxWidth:480,maxHeight:360}}/><canvas ref={canvas} hidden/>
 <div style={{display:'flex',flexWrap:'wrap',gap:8}}><button type="button" disabled={!ready||disabled||starting||running} onClick={()=>void start()}>カメラを開く</button><button type="button" disabled={!starting&&!running} onClick={stop}>カメラを止める</button></div>
 <label>用品の個体ID<input value={manual} onChange={e=>setManual(e.target.value)} maxLength={80} disabled={!ready||disabled} style={{display:'block',maxWidth:'100%',boxSizing:'border-box'}}/></label><button type="button" disabled={!ready||disabled||!manual} onClick={()=>void emit(manual)}>入力したIDを照合へ送る</button><p role="status">{starting?'カメラの許可を待っています。':message}</p></section>;
}
