'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {st,type StaffLocale} from './staff-i18n';
import {STORE_LABEL} from './guest-format';
import {invalidateStaffView} from './StaffSessionBoundary';
import {currentStateNote,fmtDate} from './order-labels';

type Item={id:string;bookingId:string;state:string;kind:'BOOKING_CONFIRMED'|'PAYMENT_REVIEW';source:'LIVE'|'HISTORY_IMPORT';store:string;returnStore:string;createdAt:string;acknowledgedAt:string|null;acknowledgedBy:string|null;startDate:string;endDate:string;slot:string;people:number;customer:string|null};
type Page={unacknowledged:number;attention:number;total:number;latest:string|null;items:Item[];next:{before:string;beforeId:string}|null};
const BASE=30000,MAX=300000;
const jst=(iso:string,l:StaffLocale)=>new Intl.DateTimeFormat(l==='en'?'en-GB':'ja-JP',{timeZone:'Asia/Tokyo',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(iso));

/** Header bell. Foreground sync every 30 s plus on tab return; one request in flight, exponential backoff on failure,
 * and a generation counter so a slow older response never overwrites a newer one. A failed read is shown as a failure,
 * never as zero. Opening the panel does not acknowledge anything. */
export function StaffInboxBell({locale,stamp,stores}:{locale:StaffLocale;stamp:string;stores:string[]}){
 const t=(k:Parameters<typeof st>[1])=>st(locale,k);
 const [page,setPage]=useState<Page|null>(null),[failed,setFailed]=useState(false),[open,setOpen]=useState(false),[busyAck,setBusyAck]=useState<string|null>(null);
 const gen=useRef(0),inflight=useRef(false),delay=useRef(BASE),timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined),lastSeen=useRef<string|null>(null),alive=useRef(true);
 const query='/api/operations/inbox?'+new URLSearchParams({stores:storeQuery(stores),openOnly:'1',limit:'10'});
 const notify=useCallback((p:Page)=>{
  if(!p.latest)return;const prev=lastSeen.current;lastSeen.current=p.latest;
  if(prev&&p.latest>prev&&typeof Notification!=='undefined'&&Notification.permission==='granted'&&localStorageFlag()&&document.visibilityState!=='visible'){
   try{new Notification(t('inboxTitle'),{body:p.items[0]?`${STORE_LABEL[p.items[0].store]??''} ${p.items[0].startDate}`:'',tag:'zao-booking'});}catch{/* not supported */}
  }
 },[locale]);// eslint-disable-line react-hooks/exhaustive-deps
 const sync=useCallback(async()=>{
  if(inflight.current||!stores.length)return;inflight.current=true;const ticket=++gen.current;
  try{const r=await fetch(query,{cache:'no-store',headers:{'x-zao-session':stamp}});
   if(r.status===401||r.status===403){invalidateStaffView();return;}
   if(!r.ok)throw Error();const v=await r.json() as Page;if(!alive.current||ticket!==gen.current)return;
   setPage(v);setFailed(false);delay.current=BASE;notify(v);
  }catch{if(alive.current&&ticket===gen.current){setFailed(true);delay.current=Math.min(MAX,delay.current*2);}}
  finally{inflight.current=false;if(alive.current&&document.visibilityState==='visible'){clearTimeout(timer.current);timer.current=setTimeout(()=>void sync(),delay.current);}}
 },[query,stamp,stores.length,notify]);
 useEffect(()=>{const generation=gen;alive.current=true;void sync();const vis=()=>{if(document.visibilityState==='visible')void sync();else clearTimeout(timer.current);};
  document.addEventListener('visibilitychange',vis);return()=>{alive.current=false;generation.current++;clearTimeout(timer.current);document.removeEventListener('visibilitychange',vis);};},[sync]);
 async function ack(item:Item){if(busyAck)return;setBusyAck(item.id);
  try{const r=await fetch('/api/operations/inbox/ack',{method:'POST',cache:'no-store',headers:{'content-type':'application/json','x-zao-session':stamp},body:JSON.stringify({requestKey:crypto.randomUUID(),input:{eventId:item.id}})});
   if(r.status===401){invalidateStaffView();return;}if(r.ok){gen.current++;inflight.current=false;await sync();}else setFailed(true);}
  catch{setFailed(true);}finally{setBusyAck(null);}}
 const count=page?page.unacknowledged+page.attention:0;
 return <div className="sx-bell">
  <button type="button" className="sx-iconbtn" aria-haspopup="dialog" aria-expanded={open} onClick={()=>setOpen(o=>!o)} aria-label={t('notifications')+(page?` (${count})`:'')}>
   <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>
   {failed?<span className="sx-badge sx-badge--warn" aria-hidden="true">!</span>:count>0&&<span className="sx-badge" aria-hidden="true">{count>99?'99+':count}</span>}
  </button>
  {open&&<div className="sx-pop" role="dialog" aria-label={t('inboxTitle')}>
   <div className="sx-pop-h"><h2>{t('inboxTitle')}</h2><button type="button" className="sx-link" onClick={()=>setOpen(false)}>{t('close')}</button></div>
   {failed&&<p className="sx-alert" role="alert">{t('inboxUnavailable')} <button type="button" className="sx-link" onClick={()=>{delay.current=BASE;void sync();}}>{t('retry')}</button></p>}
   {page&&!page.items.length&&!failed&&<p className="sx-empty">{t('inboxEmpty')}</p>}
   {page&&page.items.length>0&&<ul className="sx-inbox">{page.items.map(i=><li key={i.id}>
    <Link href={`/staff/orders/${encodeURIComponent(i.bookingId)}`} onClick={()=>setOpen(false)}>
     <span className={'sx-tag'+(i.kind==='PAYMENT_REVIEW'?' sx-tag--warn':'')}>{i.kind==='PAYMENT_REVIEW'?t('paymentReview'):i.source==='HISTORY_IMPORT'?t('imported'):t('confirmed')}</span>
     <b>{i.customer??'—'}</b>{currentStateNote(locale,i.kind,i.state)&&<span className="sx-tag sx-tag--warn">{t('nowState')}{currentStateNote(locale,i.kind,i.state)}</span>}<span>{STORE_LABEL[i.store]??i.store} · {fmtDate(locale,i.startDate)}{i.endDate!==i.startDate?` – ${fmtDate(locale,i.endDate)}`:''} · {i.people}{locale==='en'?' ':''}{t('people')}</span>
     <small>{jst(i.createdAt,locale)} JST</small>
    </Link>
    <button type="button" className="sx-btn sx-btn--quiet" disabled={busyAck===i.id} onClick={()=>void ack(i)}>{t('acknowledge')}</button>
   </li>)}</ul>}
   <div className="sx-pop-f"><Link href="/staff/notifications" onClick={()=>setOpen(false)}>{t('viewAll')}{page?` (${page.total})`:''}</Link></div>
  </div>}
 </div>;
}
/** Store IDs for the query string only (never rendered). */
export const storeQuery=(ids:readonly string[])=>ids.filter(Boolean).reduce((a,b)=>a?a+','+b:b,'');
export function localStorageFlag(){try{return localStorage.getItem('zao-staff-browser-alerts')==='1';}catch{return false;}}
