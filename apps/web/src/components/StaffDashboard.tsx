'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {useRouter,useSearchParams} from 'next/navigation';
import {st,type StaffLocale} from './staff-i18n';
import {StaffSessionBoundary,invalidateStaffView} from './StaffSessionBoundary';
import {STORE_LABEL} from './guest-format';
import {statusLabel,statusTone,pickupTime,returnTime,fmtDate} from './order-labels';
import './staff-orders.css';

type Row={id:string;ref:string;customer:string|null;status:string;startDate:string;endDate:string;slot:string;people:number;pickupStore:string;returnStore:string;lateOut:boolean;lateBack:boolean};
type Data={today:string;store:string;range:string;from:string;to:string;goingOut:Row[];comingBack:Row[];goingOutTotal:number;comingBackTotal:number;cap:number;lateOut:number;lateBack:number};
type Range='today'|'tomorrow'|'next7'|'nextWeek'|'nextMonth'|'date';
const RANGES:Range[]=['today','tomorrow','next7','nextWeek','nextMonth','date'];
const L={
 goingOut:['貸出予定','Going out'],comingBack:['返却予定','Coming back'],today:['今日','Today'],tomorrow:['明日','Tomorrow'],next7:['次の7日間','Next 7 days'],
 nextWeek:['来週','Next week'],nextMonth:['来月','Next month'],date:['日付を指定','Pick a date'],print:['帳票を印刷','Print list'],
 viewLate:['遅れ','Late'],lateOut:['貸出遅れ','Late pickups'],lateBack:['返却遅れ','Late returns'],viewAll:['すべて表示','View all'],none:['予定はありません。','Nothing scheduled.'],all:['すべて','All'],
 period:['期間','Period'],station:['店舗','Station'],failed:['読み込めませんでした。','Could not load.'],retry:['再読み込み','Retry'],
 prep:['当日作業・準備','Today’s work and preparation'],people:['名','people'],show:['表示','Show'],
} as const;

/** Booqable Dashboard: Going out (left) / Coming back (right) on desktop; on a phone the same data as one list with
 * All / Going out / Coming back. Rows open the order; late and view-all open the filtered order list. */
export function StaffDashboard({locale,stamp,stores}:{locale:StaffLocale;stamp:string;stores:string[]}){
 const tx=(k:keyof typeof L)=>L[k][locale==='en'?1:0];
 const params=useSearchParams(),router=useRouter();
 const store=stores.includes(params.get('store')??'')?params.get('store')!:stores[0]??'';
 const range=(RANGES as string[]).includes(params.get('range')??'')?params.get('range') as Range:'today';
 const date=params.get('date')??'';
 const [loaded,setLoaded]=useState<{key:string;data:Data}|null>(null),[failed,setFailed]=useState<string|null>(null),[pane,setPane]=useState<'all'|'out'|'back'>('all');
 const key=[store,range,date].join('|'),data=loaded?.key===key?loaded.data:null;
 const gen=useRef(0);
 const set=(patch:Record<string,string>)=>{const q=new URLSearchParams(params.toString());for(const [k,v] of Object.entries(patch))if(v)q.set(k,v);else q.delete(k);router.replace('/staff?'+q.toString(),{scroll:false});};
 const load=useCallback(async()=>{
  if(!store||(range==='date'&&!/^\d{4}-\d{2}-\d{2}$/.test(date)))return;const ticket=++gen.current;
  try{const q=new URLSearchParams({store,range,...(range==='date'?{date}:{})});const r=await fetch('/api/operations/dashboard?'+q,{cache:'no-store',headers:{'x-zao-session':stamp}});
   if(r.status===401||r.status===403){invalidateStaffView();return;}if(!r.ok)throw Error();const v=await r.json() as Data;if(ticket===gen.current){setLoaded({key:[store,range,date].join('|'),data:v});setFailed(null);}}
  catch{if(ticket===gen.current)setFailed([store,range,date].join('|'));}
 },[store,range,date,stamp]);
 useEffect(()=>{queueMicrotask(()=>void load());},[load]);
 const list=(rows:Row[],kind:'out'|'back')=>rows.length?<ul className="ox-rows">{rows.map(r=><li key={kind+r.id}><Link href={`/staff/rentals?booking=${encodeURIComponent(r.id)}`}>
  <span className="ox-time">{data&&data.from!==data.to&&<small>{fmtDate(locale,kind==='out'?r.startDate:r.endDate)}</small>}{kind==='out'?pickupTime(r.slot):returnTime(r.slot)}</span>
  <span className="ox-who"><b>{r.customer??'—'}</b><small>{r.people} {tx('people')} · <span className={'ox-status ox-status--'+statusTone(r.status)}>{statusLabel(locale,r.status)}</span>{(kind==='out'?r.lateOut:r.lateBack)&&<span className="ox-status ox-status--orange"> · {tx('viewLate')}</span>}</small></span>
  <span className="ox-ref"><b>#{r.ref}</b><small>{STORE_LABEL[kind==='out'?r.pickupStore:r.returnStore]??'—'}</small></span></Link></li>)}</ul>:<p className="sx-empty">{tx('none')}</p>;
 const orders=(extra:Record<string,string>)=>'/staff/orders?'+new URLSearchParams({stores:store,...extra});
 const panel=(kind:'out'|'back')=>{const rows=kind==='out'?data?.goingOut??[]:data?.comingBack??[],late=kind==='out'?data?.lateOut??0:data?.lateBack??0,total=kind==='out'?data?.goingOutTotal??0:data?.comingBackTotal??0;
  return <section className={'ox-panel sx-card'+(pane!=='all'&&pane!==kind?' ox-hide-m':'')} aria-labelledby={'ox-'+kind}>
   <header className="ox-panel-h"><h2 id={'ox-'+kind}>{kind==='out'?tx('goingOut'):tx('comingBack')} {data&&<span className="ox-count">{total}</span>}</h2>
    {kind==='out'&&<button type="button" className="sx-btn ox-noprint" onClick={()=>window.print()}>{tx('print')}</button>}</header>
   {data?list(rows,kind):failed!==key&&<p className="sx-status" role="status">…</p>}{data&&total>rows.length&&<p className="sx-help ox-more">{locale==='en'?`Showing ${rows.length} of ${total}. Use View all for the rest.`:`${total}件中${rows.length}件を表示中。残りは「すべて表示」から。`}</p>}
   <footer className="ox-panel-f ox-noprint"><Link href={orders({tab:'late',late:kind})} className={late?'ox-late':''}>{kind==='out'?tx('lateOut'):tx('lateBack')} {late}</Link>
    {data&&<Link href={orders({direction:kind,from:data.from,to:data.to})}>{tx('viewAll')}</Link>}</footer>
  </section>;};
 return <StaffSessionBoundary stamp={stamp}><main className="ox">
  <div className="ox-head"><h1>{st(locale,'dashboard')}</h1><Link className="sx-btn ox-noprint" href="/staff/today">{tx('prep')}</Link></div>
  <div className="ox-controls ox-noprint">
   {stores.length>1&&<div className="sx-seg" role="group" aria-label={tx('station')}>{stores.map(s=><button key={s} type="button" aria-pressed={s===store} onClick={()=>set({store:s})}>{STORE_LABEL[s]??'—'}</button>)}</div>}
   <label className="ox-range"><span className="sx-visually-hidden">{tx('period')}</span>
    <select value={range} onChange={e=>set({range:e.target.value,date:e.target.value==='date'?(date||data?.today||''):''})}>{RANGES.map(r=><option key={r} value={r}>{tx(r)}</option>)}</select></label>
   {range==='date'&&<input type="date" className="ox-date" aria-label={tx('date')} value={date} onChange={e=>set({date:e.target.value})}/>}
   {data&&<span className="sx-help">{data.from===data.to?fmtDate(locale,data.from):`${fmtDate(locale,data.from)} – ${fmtDate(locale,data.to)}`}</span>}
  </div>
  <div className="sx-seg ox-pane ox-noprint" role="group" aria-label={tx('show')}>
   {(['all','out','back'] as const).map(p=><button key={p} type="button" aria-pressed={pane===p} onClick={()=>setPane(p)}>{p==='all'?tx('all'):p==='out'?tx('goingOut'):tx('comingBack')}</button>)}
  </div>
  {failed===key&&<p className="sx-alert" role="alert">{tx('failed')} <button type="button" className="sx-link" onClick={()=>void load()}>{tx('retry')}</button></p>}
  <div className="ox-grid">{panel('out')}{panel('back')}</div>
 </main></StaffSessionBoundary>;
}
