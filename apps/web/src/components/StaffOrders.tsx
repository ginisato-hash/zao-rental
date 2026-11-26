'use client';
import {useStaffLocaleOr} from './staff-locale';
import {useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {useRouter,useSearchParams} from 'next/navigation';
import {st,type StaffLocale} from './staff-i18n';
import {useCsvDownload} from './use-csv-download';
import {CsvButton} from './CsvButton';
import {StaffSessionBoundary,invalidateStaffView} from './StaffSessionBoundary';
import {STORE_LABEL} from './guest-format';
import {ORDER_STATUSES,statusLabel,statusTone,paymentLabel,fmtDate,fmtYen} from './order-labels';
import './staff-orders.css';

type Row={id:string;ref:string;customer:string|null;email:string|null;status:string;paymentStatus:string|null;pickupStore:string;returnStore:string;startDate:string;endDate:string;totalJpy:number|null;createdAt:string;lateOut:boolean;lateBack:boolean;shortage?:Shortage};
type Shortage='INSUFFICIENT'|'TRANSFER_PLAN_REQUIRED'|'INDETERMINATE';
type Data={today:string;tab:string;total:number;page:number;pageSize:number;counts:{all:number;upcoming:number;late:number;lateOut:number;lateBack:number;shortage:number|null;shortageIndeterminate:number|null};paymentOptions:string[];rows:Row[]};
// Booking time (JST): when the order was received, shown so staff can see new bookings at a glance.
const bookedAt=(l:StaffLocale,iso:string)=>new Intl.DateTimeFormat(l==='en'?'en-GB':'ja-JP',{timeZone:'Asia/Tokyo',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(iso));
const L={
 all:['すべて','All'],upcoming:['今後','Upcoming'],late:['遅れ','Late'],shortage:['不足あり','With shortage'],
 INSUFFICIENT:['在庫不足','Short of stock'],TRANSFER_PLAN_REQUIRED:['店舗間移動が必要','Transfer needed'],INDETERMINATE:['判定できません','Could not determine'],
 shortageHelp:['まだ渡していない用品が、予約期間中に確保できない予約です。在庫・予約は変更していません。','Orders whose items not yet handed out cannot be covered for their period. Nothing in stock or bookings was changed.'],
 undetermined:['件は判定できませんでした（不足なしという意味ではありません）。','could not be determined (this does not mean no shortage).'],search:['予約番号・氏名・メールで検索','Search by order, name or email'],
 order:['予約番号','Order'],booked:['受付日時','Booked at'],customer:['顧客','Customer'],status:['状態','Status'],pickup:['受取','Pickup'],ret:['返却','Return'],total:['金額','Total'],payment:['支払状況','Payment'],
 filters:['絞り込み','Filters'],station:['店舗','Station'],from:['受取日（から）','Pickup from'],to:['受取日（まで）','Pickup to'],fromBack:['返却日（から）','Return from'],toBack:['返却日（まで）','Return to'],clear:['条件をクリア','Clear filters'],
 none:['該当する予約はありません。','No orders match.'],lateOut:['貸出遅れ','Late pickups'],lateBack:['返却遅れ','Late returns'],
 dirOut:['受取日・受取店で絞り込み中','Filtered by pickup date and station'],dirBack:['返却日・返却店で絞り込み中','Filtered by return date and station'],failed:['読み込めませんでした。','Could not load.'],retry:['再読み込み','Retry'],
 prev:['前へ','Previous'],next:['次へ','Next'],of:['件中','of'],
 related:['関連する業務','Related work'],quotes:['見積','Quotes'],holds:['仮押さえ','Holds'],recommendations:['サイズ推薦','Size recommendations'],amendments:['変更・返金依頼','Changes and refunds'],
} as const;

/** Booqable Orders: title, search and New order; tabs All / Upcoming / Late; left filters (status, payment, date range,
 * station); table Order / Customer / Status / Pickup / Return / Total / Payment. Every count and page is server-side. */
export function StaffOrders({locale:serverLocale,stamp,stores,canCreate,more}:{locale:StaffLocale;stamp:string;stores:string[];canCreate:boolean;more?:{quotes:boolean;holds:boolean;recommendations:boolean;amendments:boolean;groups?:boolean}}){
 const locale=useStaffLocaleOr(serverLocale);
 const tx=(k:keyof typeof L)=>L[k][locale==='en'?1:0],en=locale==='en';
 const params=useSearchParams(),router=useRouter();
 const get=(k:string)=>params.get(k)??'';
 const selectedStores=(get('stores')?get('stores').split(','):stores).filter(s=>stores.includes(s));
 const tab=['all','upcoming','late','shortage'].includes(get('tab'))?get('tab'):'all',page=Math.max(1,Number(get('page'))||1);
 const statuses=get('status')?get('status').split(','):[],payments=get('payment')?get('payment').split(','):[];
 const [search,setSearch]=useState(get('search')),[loaded,setLoaded]=useState<{query:string;data:Data}|null>(null),[failedQuery,setFailedQuery]=useState<string|null>(null);
 const gen=useRef(0);
 const set=(patch:Record<string,string>,keepPage=false)=>{const q=new URLSearchParams(params.toString());for(const [k,v] of Object.entries(patch))if(v)q.set(k,v);else q.delete(k);if(!keepPage)q.delete('page');router.replace('/staff/orders?'+q.toString(),{scroll:false});};
 const toggle=(key:'status'|'payment',list:string[],v:string)=>set({[key]:(list.includes(v)?list.filter(x=>x!==v):[...list,v]).join(',')});
 const query=new URLSearchParams({stores:(selectedStores.length?selectedStores:stores).join(','),tab,page:String(page),pageSize:'25',...(statuses.length?{status:statuses.join(',')}:{}),...(payments.length?{payment:payments.join(',')}:{}),...(get('from')?{from:get('from')}:{}),...(get('to')?{to:get('to')}:{}),...(['out','back'].includes(get('direction'))?{direction:get('direction')}:{}),...(tab==='late'&&['out','back'].includes(get('late'))?{late:get('late')}:{}),...(get('search')?{search:get('search')}:{})}).toString();
 // Results belong to the exact query that produced them; after any change they are hidden until the new answer arrives.
 const failed=failedQuery===query+'|'+stamp,data=loaded?.query===query+'|'+stamp&&!failed?loaded.data:null;
 const [reload,setReload]=useState(0);
 useEffect(()=>{const ticket=++gen.current;queueMicrotask(async()=>{
  try{const r=await fetch('/api/operations/orders?'+query,{cache:'no-store',headers:{'x-zao-session':stamp}});if(r.status===401||r.status===403){invalidateStaffView();return;}
   if(!r.ok)throw Error();const v=await r.json() as Data;if(ticket===gen.current){setLoaded({query:query+'|'+stamp,data:v});setFailedQuery(null);}}catch{if(ticket===gen.current)setFailedQuery(query+'|'+stamp);}
 });},[query,stamp,reload]);
 const pages=data?Math.max(1,Math.ceil(data.total/data.pageSize)):1;
 // CSV: the same filters as the list (all pages), saved only for this query and session (REP-02).
 const csv=useCsvDownload(query+'|'+stamp+'|'+locale,stamp),csvQuery=new URLSearchParams(query);csvQuery.delete('page');csvQuery.delete('pageSize');csvQuery.set('format','csv');csvQuery.set('lang',locale);
 return <StaffSessionBoundary stamp={stamp}><main className="ox">
  <div className="ox-head"><h1>{st(locale,'orders')}</h1>
   <form role="search" className="ox-search" onSubmit={e=>{e.preventDefault();set({search:search.trim()});}}><input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder={tx('search')} aria-label={tx('search')}/></form>
   {data&&<CsvButton csv={csv} url={'/api/operations/orders?'+csvQuery} filename={`orders-${data.today}.csv`}/>}
   <Link className="sx-btn" href="/staff/scan">{st(locale,'scanBooking')}</Link>
   {canCreate&&<Link className="sx-btn sx-btn--primary" href="/staff/orders/new">{st(locale,'newOrder')}</Link>}</div>
  {more&&(more.quotes||more.holds||more.recommendations||more.amendments||more.groups)&&<nav className="ox-related" aria-label={tx('related')}>{more.quotes&&<Link href="/staff/quotes">{tx('quotes')}</Link>}{more.holds&&<Link href="/staff/holds">{tx('holds')}</Link>}{more.recommendations&&<Link href="/staff/recommendations">{tx('recommendations')}</Link>}{more.amendments&&<Link href="/staff/amendments">{tx('amendments')}</Link>}{more.groups&&<Link href="/staff/groups">{st(locale,'groups')}</Link>}</nav>}
  <div className="sx-seg ox-tabs" role="tablist" aria-label={st(locale,'orders')}>{(['all','upcoming','late','shortage'] as const).map(t=><button key={t} type="button" role="tab" aria-selected={tab===t} onClick={()=>set({tab:t==='all'?'':t,late:''})}>{tx(t)}{data&&data.counts[t]!==null&&data.counts[t]!==undefined?` ${data.counts[t]}`:''}</button>)}</div>
  {tab==='late'&&<div className="sx-seg ox-tabs" role="group" aria-label={tx('late')}>{(['','out','back'] as const).map(k=><button key={k||'both'} type="button" aria-pressed={get('late')===k} onClick={()=>set({late:k})}>{k===''?tx('all'):k==='out'?tx('lateOut'):tx('lateBack')}{data?` ${k===''?data.counts.late:k==='out'?data.counts.lateOut:data.counts.lateBack}`:''}</button>)}</div>}
  {tab==='shortage'&&<p className="sx-help">{data&&(data.counts.shortageIndeterminate??0)>0&&<> <strong role="status">{en?`${data.counts.shortageIndeterminate} ${tx('undetermined')}`:`${data.counts.shortageIndeterminate}${tx('undetermined')}`}</strong></>}</p>}
  {['out','back'].includes(get('direction'))&&<p className="sx-help">{get('direction')==='out'?tx('dirOut'):tx('dirBack')} <button type="button" className="sx-link" onClick={()=>set({direction:''})}>{tx('clear')}</button></p>}
  <div className="ox-layout">
   <aside className="ox-filters" aria-label={tx('filters')}>
    {stores.length>1&&<fieldset><legend>{tx('station')}</legend>{stores.map(s=><label key={s} className="sx-check"><input type="checkbox" checked={selectedStores.includes(s)} onChange={()=>{const next=selectedStores.includes(s)?selectedStores.filter(x=>x!==s):[...selectedStores,s];set({stores:next.length&&next.length<stores.length?next.join(','):''});}}/>{STORE_LABEL[s]??'—'}</label>)}</fieldset>}
    <fieldset><legend>{tx('status')}</legend>{ORDER_STATUSES.map(s=><label key={s} className="sx-check"><input type="checkbox" checked={statuses.includes(s)} onChange={()=>toggle('status',statuses,s)}/>{statusLabel(locale,s)}</label>)}</fieldset>
    {data&&data.paymentOptions.length>0&&<fieldset><legend>{tx('payment')}</legend>{data.paymentOptions.map(p=><label key={p} className="sx-check"><input type="checkbox" checked={payments.includes(p)} onChange={()=>toggle('payment',payments,p)}/>{paymentLabel(locale,p)}</label>)}</fieldset>}
    <fieldset><legend>{get('direction')==='back'?tx('ret'):tx('pickup')}</legend><label className="sx-field">{get('direction')==='back'?tx('fromBack'):tx('from')}<input type="date" value={get('from')} onChange={e=>set({from:e.target.value})}/></label><label className="sx-field">{get('direction')==='back'?tx('toBack'):tx('to')}<input type="date" value={get('to')} onChange={e=>set({to:e.target.value})}/></label></fieldset>
    <button type="button" className="sx-link" onClick={()=>router.replace('/staff/orders',{scroll:false})}>{tx('clear')}</button>
   </aside>
   <section className="ox-list" aria-live="polite">
    {failed&&<p className="sx-alert" role="alert">{tx('failed')} <button type="button" className="sx-link" onClick={()=>setReload(n=>n+1)}>{tx('retry')}</button></p>}
    {data&&!data.rows.length&&!failed&&<p className="sx-empty">{tx('none')}</p>}
    {data&&data.rows.length>0&&<div className="sx-card ox-table-wrap"><table className="sx-table ox-table">
     <thead><tr><th>{tx('order')}</th><th>{tx('booked')}</th><th>{tx('customer')}</th><th>{tx('status')}</th><th>{tx('pickup')}</th><th>{tx('ret')}</th><th className="ox-num">{tx('total')}</th><th>{tx('payment')}</th></tr></thead>
     <tbody>{data.rows.map(r=><tr key={r.id} onClick={e=>{if(!(e.target as Element).closest('a'))router.push(`/staff/orders/${encodeURIComponent(r.id)}`);}}>
      <td><Link href={`/staff/orders/${encodeURIComponent(r.id)}`}>#{r.ref}</Link></td>
      <td className="ox-booked">{bookedAt(locale,r.createdAt)}</td>
      <td>{r.customer??'—'}</td>
      <td><span className={'ox-status ox-status--'+statusTone(r.status)}>{statusLabel(locale,r.status)}</span>{(r.lateOut||r.lateBack)&&<span className="ox-status ox-status--orange"> · {tx('late')}</span>}{r.shortage&&<><br/><span className={'ox-status ox-status--'+(r.shortage==='INDETERMINATE'?'grey':r.shortage==='INSUFFICIENT'?'red':'orange')} data-shortage={r.shortage}>{tx(r.shortage)}</span></>}</td>
      <td>{fmtDate(locale,r.startDate)}<br/><small className="sx-help">{STORE_LABEL[r.pickupStore]??'—'}</small></td>
      <td>{fmtDate(locale,r.endDate)}<br/><small className="sx-help">{STORE_LABEL[r.returnStore]??'—'}</small></td>
      <td className="ox-num">{fmtYen(locale,r.totalJpy)}</td><td>{paymentLabel(locale,r.paymentStatus)}</td></tr>)}</tbody></table></div>}
    {data&&data.total>0&&<nav className="ox-pager" aria-label={locale==='en'?'Pages':'ページ'}><span className="sx-help">{en?`${(page-1)*data.pageSize+1}–${Math.min(page*data.pageSize,data.total)} ${tx('of')} ${data.total}`:`${data.total}${tx('of')} ${(page-1)*data.pageSize+1}–${Math.min(page*data.pageSize,data.total)}`}</span>
     <button type="button" className="sx-btn" disabled={page<=1} onClick={()=>set({page:String(page-1)},true)}>{tx('prev')}</button><button type="button" className="sx-btn" disabled={page>=pages} onClick={()=>set({page:String(page+1)},true)}>{tx('next')}</button></nav>}
   </section>
  </div>
 </main></StaffSessionBoundary>;
}
