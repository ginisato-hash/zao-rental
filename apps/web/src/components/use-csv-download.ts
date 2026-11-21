'use client';
import {useEffect,useRef,useState} from 'react';
import {invalidateStaffView} from './StaffSessionBoundary';

/** REP-02 for every staff CSV (Reports, Orders, Customers, Inventory). A CSV belongs to the view key it was requested for
 * (the screen's query, the session stamp and the display language — CSV-UX-01) and to this mounted page. It is saved only if, after the response and again
 * after the body, the page is still mounted, still shows that same key, and no newer CSV request started; otherwise it is
 * discarded and the request aborted. One CSV request at a time. 401/403 ends the staff view; an HTTP error or a network
 * failure is reported (shown by CsvButton) and saves nothing; a request this page aborted itself is silent. */
export function useCsvDownload(key:string,stamp:string){
 const live=useRef({key,mounted:true}),gen=useRef(0),abort=useRef<AbortController|null>(null);
 const [busy,setBusy]=useState(false),[failed,setFailed]=useState<{key:string;code:string}|null>(null);
 useEffect(()=>{live.current.key=key;gen.current++;abort.current?.abort();},[key]);
 useEffect(()=>{const l=live.current,g=gen,ab=abort;l.mounted=true;return()=>{l.mounted=false;g.current++;ab.current?.abort();};},[]);
 async function download(url:string,filename:string){
  if(busy)return;const ticket=++gen.current,startKey=key,ctl=new AbortController();abort.current?.abort();abort.current=ctl;
  const current=()=>live.current.mounted&&live.current.key===startKey&&gen.current===ticket;setBusy(true);setFailed(null);
  try{const r=await fetch(url,{cache:'no-store',headers:{'x-zao-session':stamp},signal:ctl.signal});
   if(!current())return;if(r.status===401||r.status===403){invalidateStaffView();return;}
   if(!r.ok){const code=await r.json().then((v:{error?:string})=>v.error??'FAILED',()=>'FAILED');if(current())setFailed({key:startKey,code});return;}
   const blob=await r.blob();if(!current())return;
   const href=URL.createObjectURL(blob),a=document.createElement('a');a.href=href;a.download=filename;document.body.append(a);a.click();a.remove();URL.revokeObjectURL(href);
  }catch{if(!ctl.signal.aborted&&current())setFailed({key:startKey,code:'NETWORK'});/* nothing is saved */}finally{if(live.current.mounted)setBusy(false);}
 }
 return {busy,failed:failed?.key===key?failed.code:null,download};
}
