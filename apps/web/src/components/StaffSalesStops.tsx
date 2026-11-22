'use client';
import {useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {useStaffLocaleOr} from './staff-locale';
import {st,type StaffLocale} from './staff-i18n';
import {StaffSessionBoundary,invalidateStaffView} from './StaffSessionBoundary';
import {STORE_LABEL} from './guest-format';
import {statusLabel,statusTone,fmtDate} from './order-labels';
import './staff-orders.css';
import './staff-sales-stops.css';

// Day-level sales stop (temporary closure). Choose a period and one or both stations, then stop or release every day at once.
// The public booking page refuses any period that touches a stopped day; staff New order warns. Existing bookings are only
// listed here (never changed) so staff can contact the customers.
type Stop={store:string;day:string;reason:string;createdBy:string;createdAt:string};
type Affected={id:string;ref:string;customer:string|null;status:string;pickupStore:string;returnStore:string;startDate:string;endDate:string;stoppedDays:string[]};
type History={store:string;day:string;action:'STOP'|'RELEASE';reason:string;actor:string;occurredAt:string};
type View={from:string;to:string;stores:string[];stops:Stop[];bookingView:boolean;affected:Affected[]|null;affectedTotal:number|null;affectedPage:number;affectedPageSize:number;history:History[];canEdit:boolean};
const STORES=['MOUNTAIN_BASE','ONSEN_BASE'] as const;
const L={
 intro:['臨時休業などで、日にち単位で予約の受付を止めます。期間と店舗を選んで一括で設定・解除できます。','Stop taking bookings for whole days, for example for a temporary closure. Choose a period and stations to stop or release every day at once.'],
 rule:['売り止め日を1日でも含む予約（受取〜返却の期間）は、お客様のWeb予約では受け付けません。スタッフの新規予約では警告が表示され、確認すれば作成できます。すでに入っている予約は変更・取消されません。','A booking whose rental period includes any stopped day cannot be made on the public booking page. Staff New order shows a warning and can continue after confirming. Existing bookings are never changed or cancelled.'],
 setTitle:['売り止めの設定','Set a sales stop'],from:['開始日','From'],to:['終了日','To'],stations:['店舗','Stations'],reason:['理由（スタッフのみ表示）','Reason (staff only)'],
 reasonPh:['例：臨時休業（悪天候）','e.g. Temporary closure (weather)'],stop:['売り止めにする','Stop sales'],release:['売り止めを解除','Release'],
 confirmStop:['の売り止めを設定します。よろしいですか？','will be stopped. Continue?'],confirmRelease:['の売り止めを解除します。よろしいですか？','will be released. Continue?'],
 done:['件の日を変更しました。','day(s) changed.'],noChange:['変更はありませんでした（すでにその状態です）。','Nothing changed (already in that state).'],
 failed:['保存できませんでした。もう一度お試しください。','Could not save. Please try again.'],invalid:['期間・店舗・理由を確認してください（最長366日）。','Check the period, stations and reason (up to 366 days).'],
 forbidden:['この店舗の売り止めを変更する権限がありません。','You do not have permission to change sales stops for this station.'],
 viewOnly:['閲覧のみ（変更には在庫編集の権限が必要です）','View only (changing needs inventory edit permission)'],
 listTitle:['売り止め中の日','Stopped days'],showFrom:['表示期間','Showing'],none:['この期間に売り止めの日はありません。','No stopped days in this period.'],
 affectedTitle:['売り止め日にかかっている既存の予約','Existing bookings on stopped days'],affectedHelp:['自動では変更・取消されません。必要に応じてお客様へご連絡ください。','These are not changed or cancelled automatically. Contact the customers if needed.'],
 affectedNone:['売り止め日にかかっている予約はありません。','No bookings fall on stopped days.'],
 noBookingView:['予約の表示には予約閲覧の権限が必要です（売り止めの設定・履歴は表示できます）。','Seeing bookings needs the booking view permission (sales stops and history are still shown).'],
 total:['全','Total '],items:['件','bookings'],showing:['件目を表示','shown'],prev:['前へ','Previous'],next:['次へ','Next'],order:['予約','Order'],customer:['顧客','Customer'],status:['状態','Status'],period:['期間','Period'],days:['売り止め日','Stopped days'],
 historyTitle:['変更履歴','History'],STOP:['売り止め','Stopped'],RELEASE:['解除','Released'],at:['日時','At'],
 loadFailed:['読み込めませんでした。','Could not load.'],retry:['再読み込み','Retry'],apply:['表示','Show'],
} as const;
const jst=(d:Date)=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo'}).format(d);
const fmtAt=(l:StaffLocale,v:string)=>new Intl.DateTimeFormat(l==='en'?'en-GB':'ja-JP',{timeZone:'Asia/Tokyo',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(v));

export function StaffSalesStops({locale:serverLocale,stamp}:{locale:StaffLocale;stamp:string}){
 const locale=useStaffLocaleOr(serverLocale),en=locale==='en',tx=(k:keyof typeof L)=>L[k][en?1:0];
 const today=jst(new Date());
 // The default list period (today + 120 days) is decided by the server's business clock, not the browser's.
 const [range,setRange]=useState<{from:string;to:string}>({from:'',to:''}),[draftRange,setDraftRange]=useState({from:'',to:''});
 const [data,setData]=useState<View|null>(null),[loadFailed,setLoadFailed]=useState(false),[reload,setReload]=useState(0),[affPage,setAffPage]=useState(1),gen=useRef(0);
 // Station choice starts from the stations this account may change (PR74-UI-01), never a hidden station it cannot.
 const [from,setFrom]=useState(today),[to,setTo]=useState(today),[stores,setStores]=useState<string[]|null>(null),[reason,setReason]=useState('');
 const [busy,setBusy]=useState(false),[msg,setMsg]=useState<{kind:'ok'|'err';text:string}|null>(null),pending=useRef<{key:string;body:string}|null>(null);
 useEffect(()=>{const ticket=++gen.current;queueMicrotask(async()=>{
  try{const q=new URLSearchParams({...(range.from?{from:range.from}:{}),...(range.to?{to:range.to}:{}),...(affPage>1?{page:String(affPage)}:{})});const r=await fetch('/api/operations/sales-stops?'+q,{cache:'no-store',headers:{'x-zao-session':stamp}});
   if(r.status===401){invalidateStaffView();return;}if(!r.ok)throw Error();const v=await r.json() as View;if(ticket===gen.current){setData(v);setLoadFailed(false);}}
  catch{if(ticket===gen.current)setLoadFailed(true);}
 });},[range,stamp,reload,affPage]);
 const allowed=STORES.filter(s=>data?.stores.includes(s)),chosen=(stores??allowed).filter(s=>(allowed as string[]).includes(s));
 const label=(s:string)=>STORE_LABEL[s]??s;
 const submit=async(stop:boolean)=>{
  setMsg(null);if(!from||!to||to<from||!chosen.length||!reason.trim()){setMsg({kind:'err',text:tx('invalid')});return;}
  const what=`${fmtDate(locale,from)}〜${fmtDate(locale,to)}（${chosen.map(label).join('・')}）`;
  if(!window.confirm(what+(en?' ':'')+tx(stop?'confirmStop':'confirmRelease')))return;
  const body=JSON.stringify({stores:chosen,from,to,stop,reason:reason.trim()});
  // The same request key is reused only to retry exactly the same change after a lost response.
  if(!pending.current||pending.current.body!==body)pending.current={key:crypto.randomUUID(),body};
  setBusy(true);
  try{const r=await fetch('/api/operations/sales-stops',{method:'POST',headers:{'content-type':'application/json','x-zao-session':stamp},body:JSON.stringify({requestKey:pending.current.key,input:JSON.parse(body)})});
   if(r.status===401){invalidateStaffView();return;}
   const v=await r.json().catch(()=>({}));pending.current=null;
   if(!r.ok){setMsg({kind:'err',text:r.status===403?tx('forbidden'):r.status===422?tx('invalid'):tx('failed')});return;}
   setMsg({kind:'ok',text:v.changed>0?`${v.changed}${en?' ':''}${tx('done')}`:tx('noChange')});setReload(n=>n+1);
  }catch{setMsg({kind:'err',text:tx('failed')});}finally{setBusy(false);}
 };
 const byDay=new Map<string,Stop[]>();for(const s of data?.stops??[])byDay.set(s.day,[...(byDay.get(s.day)??[]),s]);
 return <StaffSessionBoundary stamp={stamp}><main className="ox">
  <div className="ox-head"><h1>{st(locale,'salesStops')}</h1></div>
  <p className="sx-help">{tx('intro')}</p>
  <p className="sx-help">{tx('rule')}</p>
  {data&&!data.canEdit&&<p className="sx-status">{tx('viewOnly')}</p>}
  {data?.canEdit&&<section className="sx-card" aria-labelledby="ss-set"><h2 id="ss-set">{tx('setTitle')}</h2>
   <div className="ss-form">
    <label>{tx('from')}<input type="date" value={from} min={today} onChange={e=>{setFrom(e.target.value);if(!to||to<e.target.value)setTo(e.target.value);}}/></label>
    <label>{tx('to')}<input type="date" value={to} min={from||today} onChange={e=>setTo(e.target.value)}/></label>
    <fieldset><legend>{tx('stations')}</legend>{allowed.map(s=><label key={s} className="ss-check"><input type="checkbox" checked={chosen.includes(s)} onChange={e=>setStores(e.target.checked?[...chosen,s].sort():chosen.filter(x=>x!==s))}/>{label(s)}</label>)}</fieldset>
    <label className="ss-reason">{tx('reason')}<input type="text" maxLength={160} value={reason} placeholder={tx('reasonPh')} onChange={e=>setReason(e.target.value)}/></label>
   </div>
   <div className="ss-actions"><button type="button" className="sx-btn sx-btn--primary" disabled={busy} onClick={()=>submit(true)}>{tx('stop')}</button>
    <button type="button" className="sx-btn" disabled={busy} onClick={()=>submit(false)}>{tx('release')}</button></div>
   {msg&&<p className={msg.kind==='ok'?'sx-status':'sx-alert'} role={msg.kind==='ok'?'status':'alert'}>{msg.text}</p>}
  </section>}
  <section className="sx-card" aria-labelledby="ss-list"><h2 id="ss-list">{tx('listTitle')}</h2>
   <form className="ss-form ss-range" onSubmit={e=>{e.preventDefault();setAffPage(1);setRange(draftRange);}}>
    <label>{tx('from')}<input type="date" value={draftRange.from} onChange={e=>setDraftRange(r=>({...r,from:e.target.value}))}/></label>
    <label>{tx('to')}<input type="date" value={draftRange.to} min={draftRange.from} onChange={e=>setDraftRange(r=>({...r,to:e.target.value}))}/></label>
    <button type="submit" className="sx-btn">{tx('apply')}</button>
    {data&&<span className="sx-help">{tx('showFrom')}：{fmtDate(locale,data.from)}〜{fmtDate(locale,data.to)}</span>}
   </form>
   {loadFailed&&<p className="sx-alert" role="alert">{tx('loadFailed')} <button type="button" className="sx-link" onClick={()=>setReload(n=>n+1)}>{tx('retry')}</button></p>}
   {!data&&!loadFailed&&<p className="sx-status" role="status">…</p>}
   {data&&!data.stops.length&&<p className="sx-empty">{tx('none')}</p>}
   {data&&data.stops.length>0&&<div className="ox-table-wrap"><table className="sx-table ox-table"><thead><tr><th>{tx('period')}</th><th>{tx('stations')}</th><th>{tx('reason')}</th></tr></thead>
    <tbody>{[...byDay.entries()].map(([d,rows])=><tr key={d}><td>{fmtDate(locale,d)}</td><td>{rows.map(r=>label(r.store)).join('・')}</td><td>{[...new Set(rows.map(r=>r.reason))].join(' / ')}</td></tr>)}</tbody></table></div>}
  </section>
  <section className="sx-card" aria-labelledby="ss-affected"><h2 id="ss-affected">{tx('affectedTitle')}</h2>
   <p className="sx-help">{tx('affectedHelp')}</p>
   {data&&data.affected===null&&<p className="sx-status">{tx('noBookingView')}</p>}
   {data&&data.affected&&!data.affected.length&&<p className="sx-empty">{tx('affectedNone')}</p>}
   {data&&data.affected&&data.affected.length>0&&<>
    <p className="sx-help" role="status">{tx('total')}{data.affectedTotal}{en?' ':''}{tx('items')}（{(data.affectedPage-1)*data.affectedPageSize+1}〜{(data.affectedPage-1)*data.affectedPageSize+data.affected.length}{en?' ':''}{tx('showing')}）</p>
    <div className="ox-table-wrap"><table className="sx-table ox-table"><thead><tr><th>{tx('order')}</th><th>{tx('customer')}</th><th>{tx('status')}</th><th>{tx('period')}</th><th>{tx('days')}</th></tr></thead>
    <tbody>{data.affected.map(a=><tr key={a.id}><td><Link href={'/staff/orders/'+a.id}>#{a.ref}</Link></td><td>{a.customer??'—'}</td>
     <td><span className={'ox-status ox-status--'+statusTone(a.status)}>{statusLabel(locale,a.status)}</span></td>
     <td>{fmtDate(locale,a.startDate)}（{label(a.pickupStore)}）〜{fmtDate(locale,a.endDate)}（{label(a.returnStore)}）</td>
     <td>{a.stoppedDays.map(d=>fmtDate(locale,d)).join('、')}</td></tr>)}</tbody></table></div>
    {(data.affectedTotal??0)>data.affectedPageSize&&<div className="ss-actions">
     <button type="button" className="sx-btn" disabled={data.affectedPage<=1} onClick={()=>setAffPage(p=>Math.max(1,p-1))}>{tx('prev')}</button>
     <button type="button" className="sx-btn" disabled={data.affectedPage*data.affectedPageSize>=(data.affectedTotal??0)} onClick={()=>setAffPage(p=>p+1)}>{tx('next')}</button></div>}
   </>}
  </section>
  {data&&data.history.length>0&&<section className="sx-card" aria-labelledby="ss-history"><h2 id="ss-history">{tx('historyTitle')}</h2>
   <div className="ox-table-wrap"><table className="sx-table ox-table"><thead><tr><th>{tx('at')}</th><th>{tx('period')}</th><th>{tx('stations')}</th><th>{tx('status')}</th><th>{tx('reason')}</th></tr></thead>
    <tbody>{data.history.map((h,i)=><tr key={i}><td>{fmtAt(locale,h.occurredAt)}</td><td>{fmtDate(locale,h.day)}</td><td>{label(h.store)}</td><td>{tx(h.action)}</td><td>{h.reason}</td></tr>)}</tbody></table></div>
  </section>}
 </main></StaffSessionBoundary>;
}
