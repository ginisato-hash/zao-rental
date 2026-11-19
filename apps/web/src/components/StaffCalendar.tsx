'use client';
import {useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {useRouter,useSearchParams} from 'next/navigation';
import {st} from './staff-i18n';
import {useStaffLocale} from './staff-locale';
import {StaffSessionBoundary,invalidateStaffView} from './StaffSessionBoundary';
import {STORE_LABEL} from './guest-format';
import {fmtDate} from './order-labels';
import './staff-orders.css';
import './staff-calendar.css';

type Bar={kind:'BOOKING'|'HOLD'|'OUT'|'OVERDUE'|'RETURNED'|'CARE'|'BLOCK'|'TRANSFER';start:string;end:string;bookingId?:string|null;ref?:string|null;customer?:string|null;state?:string|null;detail?:string|null};
type Item={id:string;ref:string;family:string;model:string;size:string;age:string;tier:string;status:string;station:string;bars:Bar[]};
type Data={store:string;today:string;from:string;to:string;days:number;family:string|null;total:number;page:number;pageSize:number;items:Item[]};
const SPANS=[7,14,28] as const;
const FAMILIES=['SKI','SNOWBOARD','SKI_BOOT','SNOWBOARD_BOOT'] as const;
const L={
 station:['店舗','Station'],span7:['1週間','1 week'],span14:['2週間','2 weeks'],span28:['4週間','4 weeks'],period:['表示期間','Period'],
 prev:['前へ','Previous'],next:['次へ','Next'],today:['今日','Today'],family:['種類','Type'],allFamilies:['すべての種類','All types'],
 SKI:['スキー','Ski'],SNOWBOARD:['スノーボード','Snowboard'],SKI_BOOT:['スキーブーツ','Ski boots'],SNOWBOARD_BOOT:['スノーボードブーツ','Snowboard boots'],
 item:['用品','Item'],none:['この条件の用品はありません。','No items for these filters.'],failed:['読み込めませんでした。','Could not load.'],retry:['再読み込み','Retry'],
 legend:['凡例','Legend'],BOOKING:['予約','Booked'],HOLD:['仮押さえ（予約前）','Hold (not yet booked)'],OUT:['貸出中','Out'],OVERDUE:['返却遅れ','Overdue'],
 RETURNED:['返却済み','Returned'],CARE:['点検待ち','Awaiting inspection'],BLOCK:['利用不可','Unavailable'],TRANSFER:['店舗間移動','Transfer'],
 MAINTENANCE:['整備中','Maintenance'],TRANSFER_UNVERIFIED:['移動未確認','Transfer unverified'],otherStation:['他店の予約','Other station'],
 due:['返却期限','Due'],help:['予定（予約・仮押さえ）と現物（貸出・返却・点検）を分けて表示します。ここでは日程を変更できません。','Planned (booked, hold) and physical (out, returned, inspection) are shown separately. Dates cannot be changed here.'],
 statusNot:['利用状態','Status'],UNVERIFIED:['未確認','Unverified'],showing:['件中','of'],
} as const;

/** Booqable Calendar: items as rows, days as columns, bars for what holds each item; a bar opens the same order detail. */
export function StaffCalendar({stamp,stores}:{stamp:string;stores:string[]}){
 const {locale}=useStaffLocale(),en=locale==='en',tx=(k:keyof typeof L)=>L[k][en?1:0];
 const params=useSearchParams(),router=useRouter();
 const store=stores.includes(params.get('store')??'')?params.get('store')!:stores[0]??'';
 const days=(SPANS as readonly number[]).includes(Number(params.get('days')))?Number(params.get('days')):7;
 const family=(FAMILIES as readonly string[]).includes(params.get('family')??'')?params.get('family')!:'';
 const from=/^\d{4}-\d{2}-\d{2}$/.test(params.get('from')??'')?params.get('from')!:'';
 const page=Math.max(1,Number(params.get('page'))||1);
 const set=(patch:Record<string,string>,keepPage=false)=>{const q=new URLSearchParams(params.toString());for(const [k,v] of Object.entries(patch))if(v)q.set(k,v);else q.delete(k);if(!keepPage)q.delete('page');router.replace('/staff/calendar?'+q.toString(),{scroll:false});};
 const query=new URLSearchParams({store,days:String(days),page:String(page),...(from?{from}:{}),...(family?{family}:{})}).toString();
 const key=query+'|'+stamp;
 const [loaded,setLoaded]=useState<{key:string;data:Data}|null>(null),[failed,setFailed]=useState<string|null>(null),[reload,setReload]=useState(0);
 const gen=useRef(0);
 useEffect(()=>{if(!store)return;const ticket=++gen.current;queueMicrotask(async()=>{
  try{const r=await fetch('/api/operations/calendar?'+query,{cache:'no-store',headers:{'x-zao-session':stamp}});if(r.status===401||r.status===403){invalidateStaffView();return;}
   if(!r.ok)throw Error();const v=await r.json() as Data;if(ticket===gen.current){setLoaded({key:query+'|'+stamp,data:v});setFailed(null);}}catch{if(ticket===gen.current)setFailed(query+'|'+stamp);}
 });},[query,stamp,store,reload]);
 // Rows belong to the exact query that produced them; a failed refresh hides them too.
 const data=loaded?.key===key&&failed!==key?loaded.data:null;
 const dates=data?Array.from({length:data.days},(_,i)=>{const t=new Date(data.from+'T00:00:00Z');t.setUTCDate(t.getUTCDate()+i);return t.toISOString().slice(0,10);}):[];
 const shift=(n:number)=>{if(!data)return;const t=new Date(data.from+'T00:00:00Z');t.setUTCDate(t.getUTCDate()+n);set({from:t.toISOString().slice(0,10)});};
 const dayHead=(d:string)=>{const t=new Date(d+'T00:00:00Z');return {num:String(t.getUTCDate()),dow:new Intl.DateTimeFormat(en?'en-US':'ja-JP',{weekday:'short',timeZone:'UTC'}).format(t),weekend:[0,6].includes(t.getUTCDay())};};
 const station=(s:string)=>STORE_LABEL[s]??s;
 const barLabel=(b:Bar)=>{
  if(b.kind==='BOOKING'||b.kind==='OUT'||b.kind==='OVERDUE'||b.kind==='RETURNED')return `#${b.ref}${b.customer?' '+b.customer:b.bookingId&&b.customer===null?' · '+tx('otherStation'):''}`;
  if(b.kind==='BLOCK')return b.detail==='MAINTENANCE'?tx('MAINTENANCE'):b.detail==='TRANSFER_UNVERIFIED'?tx('TRANSFER_UNVERIFIED'):tx('BLOCK');
  if(b.kind==='TRANSFER'&&b.detail){const [s,d]=b.detail.split('>');return `${tx('TRANSFER')} ${station(s!)} → ${station(d!)}`;}
  return tx(b.kind);};
 const title=(b:Bar)=>[tx(b.kind),barLabel(b),b.start===b.end?fmtDate(locale,b.start):`${fmtDate(locale,b.start)} – ${fmtDate(locale,b.end)}`,b.kind==='OVERDUE'&&b.detail?`${tx('due')} ${fmtDate(locale,b.detail)}`:''].filter(Boolean).join(' · ');
 // Overlapping bars of one item go to separate lanes so none is hidden.
 const lanes=(bars:Bar[])=>{const ends:string[]=[];return bars.map(b=>{let lane=ends.findIndex(e=>e<b.start);if(lane<0){lane=ends.length;ends.push(b.end);}else ends[lane]=b.end;return {b,lane};});};
 const pages=data?Math.max(1,Math.ceil(data.total/data.pageSize)):1;
 return <StaffSessionBoundary stamp={stamp}><main className="ox cx">
  <div className="ox-head"><h1>{st(locale,'calendar')}</h1></div>
  <div className="ox-controls">
   {stores.length>1&&<div className="sx-seg" role="group" aria-label={tx('station')}>{stores.map(s=><button key={s} type="button" aria-pressed={s===store} onClick={()=>set({store:s})}>{station(s)}</button>)}</div>}
   <div className="sx-seg" role="group" aria-label={tx('period')}>{SPANS.map(n=><button key={n} type="button" aria-pressed={n===days} onClick={()=>set({days:n===7?'':String(n)})}>{tx(`span${n}` as 'span7')}</button>)}</div>
   <div className="cx-nav"><button type="button" className="sx-btn" disabled={!data} onClick={()=>shift(-days)} aria-label={tx('prev')}>‹</button><button type="button" className="sx-btn" onClick={()=>set({from:''})}>{tx('today')}</button><button type="button" className="sx-btn" disabled={!data} onClick={()=>shift(days)} aria-label={tx('next')}>›</button></div>
   <label className="ox-range"><span className="sx-visually-hidden">{tx('family')}</span><select value={family} onChange={e=>set({family:e.target.value})}><option value="">{tx('allFamilies')}</option>{FAMILIES.map(f=><option key={f} value={f}>{tx(f)}</option>)}</select></label>
   {data&&<span className="sx-help">{`${fmtDate(locale,data.from)} – ${fmtDate(locale,data.to)}`}</span>}
  </div>
  <p className="sx-help">{tx('help')}</p>
  <ul className="cx-legend" aria-label={tx('legend')}>{(['BOOKING','HOLD','OUT','OVERDUE','RETURNED','CARE','BLOCK','TRANSFER'] as const).map(k=><li key={k}><span className={'cx-swatch cx-bar--'+k}/>{tx(k)}</li>)}</ul>
  {failed===key&&<p className="sx-alert" role="alert">{tx('failed')} <button type="button" className="sx-link" onClick={()=>setReload(n=>n+1)}>{tx('retry')}</button></p>}
  {data&&!data.items.length&&<p className="sx-empty">{tx('none')}</p>}
  {data&&data.items.length>0&&<div className="sx-card cx-wrap"><section className="cx-grid" aria-label={st(locale,'calendar')} style={{gridTemplateColumns:`220px repeat(${data.days},${data.days>14?34:data.days>7?52:96}px)`}}>
   <div className="cx-row cx-head"><div className="cx-cell cx-item">{tx('item')}</div>{dates.map(d=>{const h=dayHead(d);return <div key={d} className={'cx-cell cx-day'+(h.weekend?' cx-weekend':'')+(d===data.today?' cx-today':'')}><b>{h.num}</b><small>{h.dow}</small></div>;})}</div>
   {data.items.map(i=>{const placed=lanes(i.bars),rowsN=Math.max(1,...placed.map(p=>p.lane+1));return <div key={i.id} className="cx-row" style={{gridTemplateRows:`repeat(${Math.max(2,rowsN)},24px)`}}>
    <div className="cx-cell cx-item" style={{gridRow:`1 / span ${Math.max(2,rowsN)}`}}><b>{i.model}</b><small>{tx(i.family as 'SKI')} · {i.size} · #{i.ref}{i.status!=='AVAILABLE'&&<> · <span className="ox-status ox-status--orange">{i.status==='MAINTENANCE'?tx('MAINTENANCE'):i.status==='UNVERIFIED'?tx('UNVERIFIED'):i.status}</span></>}</small></div>
    {dates.map((d,n)=><div key={d} className={'cx-cell cx-bg'+(dayHead(d).weekend?' cx-weekend':'')+(d===data.today?' cx-today':'')} style={{gridColumn:n+2,gridRow:`1 / span ${Math.max(2,rowsN)}`}} aria-hidden="true"/>)}
    {placed.map(({b,lane},n)=>{const s=dates.indexOf(b.start),e=dates.indexOf(b.end);if(s<0||e<0)return null;const style={gridColumn:`${s+2} / ${e+3}`,gridRow:lane+1};const cls='cx-bar cx-bar--'+b.kind;
     return b.bookingId?<Link key={n} href={`/staff/orders/${encodeURIComponent(b.bookingId)}`} className={cls} style={style} title={title(b)} aria-label={title(b)}>{barLabel(b)}</Link>:<span key={n} className={cls} style={style} title={title(b)}>{barLabel(b)}</span>;})}
   </div>;})}
  </section></div>}
  {data&&data.total>data.pageSize&&<nav className="ox-pager" aria-label={en?'Pages':'ページ'}><span className="sx-help">{en?`${(page-1)*data.pageSize+1}–${Math.min(page*data.pageSize,data.total)} ${tx('showing')} ${data.total}`:`${data.total}${tx('showing')} ${(page-1)*data.pageSize+1}–${Math.min(page*data.pageSize,data.total)}`}</span>
   <button type="button" className="sx-btn" disabled={page<=1} onClick={()=>set({page:String(page-1)},true)}>{tx('prev')}</button><button type="button" className="sx-btn" disabled={page>=pages} onClick={()=>set({page:String(page+1)},true)}>{tx('next')}</button></nav>}
 </main></StaffSessionBoundary>;
}
