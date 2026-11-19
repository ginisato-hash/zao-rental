'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {st,type StaffKey,type StaffLocale} from './staff-i18n';
import {StaffSessionBoundary,invalidateStaffView} from './StaffSessionBoundary';
import {STORE_LABEL} from './guest-format';
import {storeQuery} from './StaffInboxBell';
import {currentStateNote} from './order-labels';

type Item={id:string;bookingId:string;state:string;kind:'BOOKING_CONFIRMED'|'PAYMENT_REVIEW';source:'LIVE'|'HISTORY_IMPORT';store:string;createdAt:string;acknowledgedAt:string|null;acknowledgedBy:string|null;startDate:string;endDate:string;people:number;customer:string|null;totalJpy:number|null};
type Page={unacknowledged:number;attention:number;total:number;items:Item[];next:{before:string;beforeId:string}|null};
const when=(iso:string,l:StaffLocale)=>new Intl.DateTimeFormat(l==='en'?'en-GB':'ja-JP',{timeZone:'Asia/Tokyo',dateStyle:'medium',timeStyle:'short'}).format(new Date(iso))+' JST';
const yen=(n:number|null,l:StaffLocale)=>n===null?'—':new Intl.NumberFormat(l==='en'?'en-JP':'ja-JP',{style:'currency',currency:'JPY'}).format(n);

/** Full inbox: server-side filter and keyset paging, so every unacknowledged booking is reachable. */
export function StaffNotifications({locale,stamp,stores}:{locale:StaffLocale;stamp:string;stores:string[]}){
 const t=(k:StaffKey)=>st(locale,k);
 const [openOnly,setOpenOnly]=useState(true),[items,setItems]=useState<Item[]>([]),[meta,setMeta]=useState<Omit<Page,'items'>|null>(null),[failed,setFailed]=useState(false),[busy,setBusy]=useState(false);
 const gen=useRef(0);
 const load=useCallback(async(append:boolean,next?:Page['next'])=>{
  const ticket=++gen.current;setBusy(true);
  try{const q=new URLSearchParams({stores:storeQuery(stores),limit:'25',...(openOnly?{openOnly:'1'}:{}),...(append&&next?next:{})});
   const r=await fetch('/api/operations/inbox?'+q,{cache:'no-store',headers:{'x-zao-session':stamp}});if(r.status===401||r.status===403){invalidateStaffView();return;}
   if(!r.ok)throw Error();const v=await r.json() as Page;if(ticket!==gen.current)return;
   setItems(prev=>append?[...prev,...v.items]:v.items);setMeta(v);setFailed(false);
  }catch{if(ticket===gen.current)setFailed(true);}finally{if(ticket===gen.current)setBusy(false);}
 },[openOnly,stamp,stores]);
 useEffect(()=>{queueMicrotask(()=>void load(false));},[load]);
 async function ack(i:Item){const r=await fetch('/api/operations/inbox/ack',{method:'POST',cache:'no-store',headers:{'content-type':'application/json','x-zao-session':stamp},body:JSON.stringify({requestKey:crypto.randomUUID(),input:{eventId:i.id}})}).catch(()=>null);
  if(r?.status===401){invalidateStaffView();return;}if(r?.ok)void load(false);else setFailed(true);}
 return <StaffSessionBoundary stamp={stamp}><main>
  <h1>{t('inboxTitle')}</h1>
  <div className="sx-seg" role="group" aria-label={t('inboxTitle')} style={{marginBottom:16}}>
   <button type="button" aria-pressed={openOnly} onClick={()=>setOpenOnly(true)}>{t('openOnly')}{meta&&openOnly?` (${meta.total})`:''}</button>
   <button type="button" aria-pressed={!openOnly} onClick={()=>setOpenOnly(false)}>{t('all')}{meta&&!openOnly?` (${meta.total})`:''}</button>
  </div>
  {failed&&<p className="sx-alert" role="alert">{t('inboxUnavailable')} <button type="button" className="sx-link" onClick={()=>void load(false)}>{t('retry')}</button></p>}
  {meta&&!items.length&&!failed&&<p className="sx-empty">{openOnly?t('inboxEmpty'):t('inboxAllEmpty')}</p>}
  {items.length>0&&<div className="sx-card" style={{overflowX:'auto'}}><table className="sx-table">
   <thead><tr><th>{locale==='en'?'Order':'予約番号'}</th><th>{t('customers')}</th><th>{locale==='en'?'Status':'状態'}</th><th>{locale==='en'?'Pickup':'受取'}</th><th>{t('stations')}</th><th>{locale==='en'?'Total':'金額'}</th><th>{locale==='en'?'Received':'受信'}</th><th/></tr></thead>
   <tbody>{items.map(i=><tr key={i.id}>
    <td><Link href={`/staff/orders/${encodeURIComponent(i.bookingId)}`}>{i.bookingId.slice(0,8).toUpperCase()}</Link></td>
    <td>{i.customer??'—'}<br/><small className="sx-help">{i.people} {t('people')}</small></td>
    <td>{i.kind==='PAYMENT_REVIEW'?<span className="sx-tag sx-tag--warn">{t('paymentReview')}</span>:i.source==='HISTORY_IMPORT'?t('imported'):t('confirmed')}{currentStateNote(locale,i.kind,i.state)&&<><br/><small className="sx-tag sx-tag--warn">{t('nowState')}{currentStateNote(locale,i.kind,i.state)}</small></>}</td>
    <td>{i.startDate}{i.endDate!==i.startDate?` – ${i.endDate}`:''}</td><td>{STORE_LABEL[i.store]??'—'}</td><td>{yen(i.totalJpy,locale)}</td>
    <td>{when(i.createdAt,locale)}</td>
    <td>{i.acknowledgedAt?<small className="sx-help">{t('by')}{i.acknowledgedBy??'—'}<br/>{when(i.acknowledgedAt,locale)}</small>:<button type="button" className="sx-btn sx-btn--quiet" onClick={()=>void ack(i)}>{t('acknowledge')}</button>}</td>
   </tr>)}</tbody></table></div>}
  {meta?.next&&<p><button type="button" className="sx-btn" disabled={busy} onClick={()=>void load(true,meta.next)}>{t('loadMore')}</button></p>}
 </main></StaffSessionBoundary>;
}
