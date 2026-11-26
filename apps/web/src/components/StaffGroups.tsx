'use client';
import {useEffect,useMemo,useRef,useState} from 'react';
import Link from 'next/link';
import {useStaffLocaleOr} from './staff-locale';
import {st,type StaffLocale} from './staff-i18n';
import {StaffSessionBoundary,invalidateStaffView} from './StaffSessionBoundary';
import {groupError,gt,type GKey} from './staff-groups-text';
import {jstDateTime,storeName,yen} from './guest-format';
import {groupEntranceUrl} from '../lib/group-entrance-url';
import './staff-orders.css';
import './staff-groups.css';

type Row={id:string;groupNumber:string;status:string;label:string;memberCount:number;period:{startDate:string;endDate:string};pickupStore:string;returnStore:string;createdAt:string;heldAt:string|null;daysHeld:number|null;startDatePassedDays:number;openRequests:number;totalJpy:number|null;confirmedTotalJpy:number|null;settlement:string|null;occupiesInventory:boolean};
type Entrance={configured:boolean;enabled:boolean;generation:number;updatedAt:string|null;history:{generation:number;action:string;reason:string;occurredAt:string}[]};
const STATUS_SETS:Record<string,string[]|null>={ALL:['REVIEW_HELD','CHANGES_REQUESTED','CONFIRMED','RELEASED','CANCELLED'],HELD:['REVIEW_HELD','CHANGES_REQUESTED'],PENDING:['REVIEW_HELD'],CHANGES:['CHANGES_REQUESTED'],CONFIRMED:['CONFIRMED'],RELEASED:['RELEASED'],CANCELLED:['CANCELLED'],DRAFT:['DRAFT','QUOTED']};
const STATUS_OPTIONS:[string,GKey][]=[['ALL','sAll'],['HELD','sHeld'],['PENDING','sPending'],['CHANGES','sChanges'],['CONFIRMED','sConfirmed'],['RELEASED','sReleased'],['CANCELLED','sCancelled'],['DRAFT','sDraft']];
const SORTS:[string,GKey][]=[['oldest','oldest'],['newest','newest'],['startDate','startDate'],['size','size'],['amount','amount']];
const jstToday=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo'}).format(new Date());
const dayDiff=(a:string,b:string)=>Math.round((Date.parse(a)-Date.parse(b))/86400000);

export function StaffGroups({locale:serverLocale,stamp,stores,canEntrance}:{locale:StaffLocale;stamp:string;stores:string[];canEntrance:boolean}){
 const locale=useStaffLocaleOr(serverLocale),ja=locale!=='en',tx=(k:GKey)=>gt(locale,k);
 const [rows,setRows]=useState<Row[]|null>(null),[failed,setFailed]=useState<string|null>(null),[reload,setReload]=useState(0),gen=useRef(0);
 const initial=typeof window==='undefined'?'':new URLSearchParams(window.location.search).get('q')??'';
 const [status,setStatus]=useState('ALL'),[store,setStore]=useState(''),[q,setQ]=useState(initial),[sort,setSort]=useState('oldest');
 useEffect(()=>{const ticket=++gen.current;queueMicrotask(async()=>{
  try{const qs=new URLSearchParams({status:STATUS_SETS[status]!.join(',')});if(store)qs.set('store',store);
   const r=await fetch('/api/staff/groups?'+qs,{cache:'no-store',headers:{'x-zao-session':stamp}});if(r.status===401){invalidateStaffView();return;}
   const v=await r.json().catch(()=>({})) as {groups?:Row[];error?:string};if(!r.ok)throw new Error(v.error??'LOAD');if(ticket===gen.current){setRows(v.groups??[]);setFailed(null);}}
  catch(e){if(ticket===gen.current)setFailed(e instanceof Error?e.message:'LOAD');}
 });},[stamp,reload,status,store]);
 const today=jstToday();
 const view=useMemo(()=>{
  const needle=q.trim().toLowerCase();let list=(rows??[]).filter(r=>!needle||r.groupNumber.toLowerCase().includes(needle)||r.label.toLowerCase().includes(needle));
  const by:Record<string,(a:Row,b:Row)=>number>={oldest:(a,b)=>Date.parse(a.heldAt??a.createdAt)-Date.parse(b.heldAt??b.createdAt),newest:(a,b)=>Date.parse(b.heldAt??b.createdAt)-Date.parse(a.heldAt??a.createdAt),startDate:(a,b)=>a.period.startDate.localeCompare(b.period.startDate),size:(a,b)=>b.memberCount-a.memberCount,amount:(a,b)=>(b.confirmedTotalJpy??b.totalJpy??0)-(a.confirmedTotalJpy??a.totalJpy??0)};
  list=[...list].sort(by[sort]??by.oldest!);return list;
 },[rows,q,sort]);
 return <StaffSessionBoundary stamp={stamp}><main className="ox gx">
  <div className="ox-head"><h1>{st(locale,'groups')}</h1></div>
  <p className="sx-help">{tx('listHelp')}</p>
  {canEntrance&&<Entrance stamp={stamp} locale={locale}/>}
  <section className="sx-card gx-card" aria-labelledby="gx-list">
   <h2 id="gx-list" className="gx-sr">{tx('title')}</h2>
   <div className="gx-filters">
    <label>{tx('filterStatus')}<select value={status} onChange={e=>{setRows(null);setStatus(e.target.value);}}>{STATUS_OPTIONS.map(([v,k])=><option key={v} value={v}>{tx(k)}</option>)}</select></label>
    <label>{tx('filterStore')}<select value={store} onChange={e=>{setRows(null);setStore(e.target.value);}}><option value="">{tx('allStores')}</option>{stores.map(s=><option key={s} value={s}>{storeName(ja,s)}</option>)}</select></label>
    <label className="gx-grow">{tx('search')}<input type="search" value={q} onChange={e=>setQ(e.target.value)} autoComplete="off"/></label>
    <label>{tx('sort')}<select value={sort} onChange={e=>setSort(e.target.value)}>{SORTS.map(([v,k])=><option key={v} value={v}>{tx(k)}</option>)}</select></label>
   </div>
   {failed&&<p className="sx-alert" role="alert">{failed==='GROUP_NOT_CONNECTED'||failed==='FORBIDDEN'?groupError(failed,locale):tx('loadFailed')} <button type="button" className="sx-link" onClick={()=>setReload(n=>n+1)}>{tx('retry')}</button></p>}
   {!rows&&!failed&&<p className="sx-status" role="status">{tx('loading')}</p>}
   {rows&&!view.length&&<p className="sx-empty">{tx('none')}</p>}
   {rows&&view.length>0&&<div className="ox-table-wrap"><table className="sx-table gx-table"><thead><tr>
    <th>{tx('cNumber')}</th><th>{tx('cName')}</th><th>{tx('cStatus')}</th><th>{tx('cReceived')}</th><th>{tx('cDays')}</th><th>{tx('cUse')}</th><th>{tx('cPeople')}</th><th>{tx('cAmount')}</th><th>{tx('cSettle')}</th><th>{tx('cRequests')}</th><th>{tx('cStock')}</th><th>{tx('cStore')}</th></tr></thead>
    <tbody>{view.map(r=>{
     const soon=r.occupiesInventory&&r.startDatePassedDays===0&&dayDiff(r.period.startDate,today)<=7&&dayDiff(r.period.startDate,today)>=0;
     return <tr key={r.id} data-group={r.groupNumber}>
      <td><Link href={`/staff/groups/${r.id}`}><strong>{r.groupNumber}</strong></Link></td><td className="gx-name">{r.label}</td>
      <td><span className={'gx-badge gx-badge--'+r.status}>{tx(('st.'+r.status) as GKey)}</span></td>
      <td>{jstDateTime(ja,r.heldAt??r.createdAt)}</td>
      <td>{r.daysHeld===null?'—':r.daysHeld+(ja?tx('days'):' '+tx('days'))}</td>
      <td>{r.period.startDate}{r.period.endDate!==r.period.startDate?' – '+r.period.endDate:''}
       {r.occupiesInventory&&r.startDatePassedDays>0&&<><br/><span className="gx-badge gx-badge--warn">{tx('attentionPassed')} {r.startDatePassedDays}{ja?'':' '}{tx('passedDays')}</span></>}
       {soon&&<><br/><span className="gx-badge gx-badge--soon">{tx('attentionSoon')}</span></>}</td>
      <td>{r.memberCount}</td>
      <td>{r.confirmedTotalJpy!==null?<>{yen(ja,r.confirmedTotalJpy)}<br/><small>{tx('confirmedAmount')}</small></>:r.totalJpy!==null?<>{yen(ja,r.totalJpy)}<br/><small>{tx('estimate')}</small></>:'—'}</td>
      <td>{r.settlement?tx(('se.'+r.settlement) as GKey):'—'}</td>
      <td>{r.openRequests>0?<strong>{r.openRequests}</strong>:0}</td>
      <td>{r.occupiesInventory?tx('held'):tx('notHeld')}</td>
      <td>{storeName(ja,r.pickupStore)}{r.returnStore!==r.pickupStore?' → '+storeName(ja,r.returnStore):''}</td></tr>;})}</tbody></table></div>}
  </section>
 </main></StaffSessionBoundary>;
}

function Entrance({stamp,locale}:{stamp:string;locale:StaffLocale}){
 const tx=(k:GKey)=>gt(locale,k);const [e,setE]=useState<Entrance|null>(null),[reason,setReason]=useState(''),[busy,setBusy]=useState(false),[msg,setMsg]=useState<{kind:'ok'|'err';text:string}|null>(null),[shown,setShown]=useState<string|null>(null),[reload,setReload]=useState(0);
 useEffect(()=>{let live=true;queueMicrotask(async()=>{try{const r=await fetch('/api/staff/groups/entrance',{cache:'no-store',headers:{'x-zao-session':stamp}});if(r.status===401){invalidateStaffView();return;}if(r.ok&&live)setE(await r.json() as Entrance);}catch{/* the panel just stays empty */}});return()=>{live=false;};},[stamp,reload]);
 const run=async(op:'rotate'|'enable'|'disable',confirmKey:GKey)=>{
  setMsg(null);const why=reason.trim();if(!why||why.length>200){setMsg({kind:'err',text:groupError('REASON_REQUIRED',locale)});return;}
  if(!window.confirm(tx(confirmKey)))return;setBusy(true);
  try{const r=await fetch('/api/staff/groups/entrance/'+op,{method:'POST',headers:{'content-type':'application/json','x-zao-session':stamp},body:JSON.stringify({reason:why})});
   if(r.status===401){invalidateStaffView();return;}
   const v=await r.json().catch(()=>({})) as {error?:string;token?:string};
   if(!r.ok){setMsg({kind:'err',text:groupError(v.error,locale)});return;}
   setShown(op==='rotate'&&v.token?groupEntranceUrl(window.location.origin,locale,v.token):null);setReason('');setMsg({kind:'ok',text:tx('entDone')});setReload(n=>n+1);
  }catch{setMsg({kind:'err',text:tx('lostResponse')});}finally{setBusy(false);}
 };
 const state=!e?'…':!e.configured?tx('entNone'):e.enabled?tx('entOn'):tx('entOff');
 return <details className="sx-card gx-card gx-entrance"><summary>{tx('entTitle')} <span className="gx-badge" data-testid="entrance-state">{state}</span></summary>
  <p className="sx-help">{tx('entHelp')}</p>
  {e&&<p>{tx('entState')}: <strong>{state}</strong>{e.configured&&<> · {tx('entGen')} {e.generation}</>}</p>}
  <label className="gx-field">{tx('entReason')}<input type="text" maxLength={200} value={reason} onChange={ev=>setReason(ev.target.value)} autoComplete="off"/></label>
  <div className="gx-actions">
   <button type="button" className="sx-btn" disabled={busy} onClick={()=>void run('rotate','entConfirmRotate')}>{e?.configured?tx('entReissue'):tx('entIssue')}</button>
   {e?.configured&&e.enabled&&<button type="button" className="sx-btn" disabled={busy} onClick={()=>void run('disable','entConfirmStop')}>{tx('entStop')}</button>}
   {e?.configured&&!e.enabled&&<button type="button" className="sx-btn" disabled={busy} onClick={()=>void run('enable','entConfirmResume')}>{tx('entResume')}</button>}
  </div>
  {msg&&<p className={msg.kind==='ok'?'sx-status':'sx-alert'} role={msg.kind==='ok'?'status':'alert'}>{msg.text}</p>}
  {shown&&<div className="gx-url"><label className="gx-field">{tx('entUrl')}<input type="text" readOnly value={shown} onFocus={ev=>ev.currentTarget.select()}/></label>
   <button type="button" className="sx-btn" onClick={()=>{void navigator.clipboard?.writeText(shown).then(()=>setMsg({kind:'ok',text:tx('entCopied')})).catch(()=>{});}}>{tx('entCopy')}</button></div>}
  {e&&e.history.length>0&&<><h3>{tx('entHistory')}</h3><ul className="gx-list">{e.history.map((h,i)=><li key={i}>{jstDateTime(locale!=='en',h.occurredAt)} · {h.action} · {tx('entGen')} {h.generation} · {h.reason}</li>)}</ul></>}
 </details>;
}
