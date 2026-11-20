'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {st,type StaffLocale} from './staff-i18n';
import {STORE_LABEL} from './guest-format';
import {invalidateStaffView} from './StaffSessionBoundary';
import {currentStateNote,fmtDate} from './order-labels';

type Item={id:string;bookingId:string;state:string;kind:'BOOKING_CONFIRMED'|'PAYMENT_REVIEW';source:'LIVE'|'HISTORY_IMPORT';store:string;returnStore:string;createdAt:string;acknowledgedAt:string|null;acknowledgedBy:string|null;startDate:string;endDate:string;slot:string;people:number;customer:string|null};
type Page={unacknowledged:number;attention:number;total:number;latest:string|null;items:Item[];next:{before:string;beforeId:string}|null};
const BASE=30000,HIDDEN=60000,MAX=300000;
const jst=(iso:string,l:StaffLocale)=>new Intl.DateTimeFormat(l==='en'?'en-GB':'ja-JP',{timeZone:'Asia/Tokyo',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(iso));

/** Header bell. Sync every 30 s while the tab is visible and every 60 s while it is hidden (BROWSER-01: the opt-in browser
 * notification is shown only for a hidden tab, so a hidden tab must keep reading), at once on tab return; one request in
 * flight, exponential backoff on failure, and a generation counter so a slow older response never overwrites a newer one.
 * A failed read is shown as a failure, never as zero. Opening the panel does not acknowledge anything. Best effort only:
 * a closed browser gets nothing here (the persistent inbox and the optional email cover that). */
export function StaffInboxBell({locale,stamp,stores}:{locale:StaffLocale;stamp:string;stores:string[]}){
 const t=(k:Parameters<typeof st>[1])=>st(locale,k);
 const [page,setPage]=useState<Page|null>(null),[failed,setFailed]=useState(false),[open,setOpen]=useState(false),[busyAck,setBusyAck]=useState<string|null>(null);
 const gen=useRef(0),inflight=useRef(false),delay=useRef(BASE),timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined),baseline=useRef<{key:string;at:string}|null>(null),leader=useRef(false),alive=useRef(true),[syncedAt,setSyncedAt]=useState<string|null>(null);
 const query='/api/operations/inbox?'+new URLSearchParams({stores:storeQuery(stores),openOnly:'1',limit:'10'});
 // BROWSER-01. The first successful read for this session stamp and station scope only sets the baseline (the backlog and
 // anything already there never notify; a new login or scope starts over). After that, only LIVE confirmed bookings that
 // are unacknowledged and newer than the baseline count, each event id at most once across all tabs of this browser, and
 // only with the staff member's own opt-in, browser permission granted, and the tab hidden. Only one hidden tab of this
 // browser (the holder of a Web Lock) shows them, since storage written by one tab reaches others late. No customer data.
 const notify=useCallback((p:Page,key:string)=>{
  const base=baseline.current;
  if(!base||base.key!==key){baseline.current={key,at:p.latest??''};return;}
  const fresh=p.items.filter(i=>i.source==='LIVE'&&i.kind==='BOOKING_CONFIRMED'&&!i.acknowledgedAt&&i.createdAt>base.at);
  if(p.latest&&p.latest>base.at)baseline.current={key,at:p.latest};
  if(!fresh.length||!leader.current||typeof Notification==='undefined'||Notification.permission!=='granted'||!localStorageFlag()||document.visibilityState==='visible')return;
  const mine=claimNotification(fresh.map(i=>i.id));if(!mine.length)return;
  const first=fresh.find(i=>mine.includes(i.id))!;
  try{new Notification(t('inboxTitle'),{body:(mine.length>1?(locale==='en'?`${mine.length} new bookings · `:`新しい予約 ${mine.length}件 · `):'')+`${STORE_LABEL[first.store]??''} ${first.startDate}`,tag:'zao-booking'});}catch{/* not supported */}
 },[locale]);// eslint-disable-line react-hooks/exhaustive-deps
 const sync=useCallback(async()=>{
  if(inflight.current||!stores.length)return;inflight.current=true;const ticket=++gen.current;
  try{const r=await fetch(query,{cache:'no-store',headers:{'x-zao-session':stamp}});
   if(r.status===401||r.status===403||r.status===409){baseline.current=null;invalidateStaffView();return;}
   if(!r.ok)throw Error();const v=await r.json() as Page;if(!alive.current||ticket!==gen.current)return;
   setPage(v);setFailed(false);setSyncedAt(new Date().toISOString());delay.current=BASE;notify(v,stamp+'|'+query);
  }catch{if(alive.current&&ticket===gen.current){setFailed(true);delay.current=Math.min(MAX,delay.current*2);}}
  finally{inflight.current=false;if(alive.current){clearTimeout(timer.current);timer.current=setTimeout(()=>void sync(),document.visibilityState==='visible'?delay.current:Math.max(delay.current,HIDDEN));}}
 },[query,stamp,stores.length,notify]);
 useEffect(()=>{const generation=gen;alive.current=true;void sync();const vis=()=>{if(document.visibilityState==='visible'){clearTimeout(timer.current);void sync();}};
  document.addEventListener('visibilitychange',vis);return()=>{alive.current=false;generation.current++;clearTimeout(timer.current);document.removeEventListener('visibilitychange',vis);};},[sync]);
 // One notifying tab per browser: among the hidden staff tabs, the one holding this Web Lock shows notifications. A tab
 // asks for it when it is hidden and gives it back when it is shown, closed or unmounted; the next hidden tab takes over.
 useEffect(()=>{const locks=typeof navigator!=='undefined'?navigator.locks:undefined;if(!locks){leader.current=true;return;}
  let held:{stop:AbortController;release:()=>void}|null=null;
  const drop=()=>{leader.current=false;held?.stop.abort();held?.release();held=null;};
  const take=()=>{if(held)return;const h={stop:new AbortController(),release:()=>{}};held=h;
   locks.request('zao-staff-browser-alerts',{signal:h.stop.signal},()=>{if(held!==h)return;leader.current=true;return new Promise<void>(r=>{h.release=r;});}).catch(()=>{/* aborted */});};
  const vis=()=>{if(document.visibilityState==='visible')drop();else take();};vis();
  document.addEventListener('visibilitychange',vis);return()=>{document.removeEventListener('visibilitychange',vis);drop();};},[]);
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
   <div className="sx-pop-f"><Link href="/staff/notifications" onClick={()=>setOpen(false)}>{t('viewAll')}{page?` (${page.total})`:''}</Link>{syncedAt&&<small className="sx-help" data-testid="inbox-synced">{locale==='en'?`Checked ${jst(syncedAt,locale)} JST`:`最終確認 ${jst(syncedAt,locale)} JST`}</small>}</div>
  </div>}
 </div>;
}
/** Store IDs for the query string only (never rendered). */
export const storeQuery=(ids:readonly string[])=>ids.filter(Boolean).reduce((a,b)=>a?a+','+b:b,'');
/** Shared across tabs of this browser: the inbox event ids (opaque UUIDs, no customer data) already notified, newest 100.
 * Returns the ids this tab claims; another tab that already claimed an id gets nothing for it. Without storage: nothing. */
function claimNotification(ids:string[]){try{const k='zao-staff-browser-alerts-notified',raw=localStorage.getItem(k),seen:string[]=raw?JSON.parse(raw) as string[]:[];
 const mine=ids.filter(id=>!seen.includes(id));if(mine.length)localStorage.setItem(k,JSON.stringify([...seen,...mine].slice(-100)));return mine;}catch{return [];}}
export function localStorageFlag(){try{return localStorage.getItem('zao-staff-browser-alerts')==='1';}catch{return false;}}
