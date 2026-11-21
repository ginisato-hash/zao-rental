'use client';
import {useEffect,useRef,useState} from 'react';
import {useRouter,useSearchParams} from 'next/navigation';
import {st} from './staff-i18n';
import {useStaffLocale} from './staff-locale';
import {StaffSessionBoundary,invalidateStaffView} from './StaffSessionBoundary';
import {useCsvDownload} from './use-csv-download';
import {STORE_LABEL} from './guest-format';
import {fmtDate,fmtYen} from './order-labels';
import './staff-orders.css';

type Column={key:string;kind:'date'|'station'|'count'|'jpy'};
type Data={type:string;from:string|null;to:string|null;stores:string[];asOf:string;columns:Column[];rows:Record<string,string|number>[];totals:Record<string,number>};
const TYPES=['bookings','pickups','returns','money','care'] as const;
const L={
 bookings:['予約','Bookings'],pickups:['貸出','Pickups'],returns:['返却','Returns'],money:['入金・返金','Payments and refunds'],care:['点検・ウェア整備（現在）','Inspection and wear care (now)'],
 bookingsHelp:['作成日ごとの予約数（受取店舗）。予約金額は確定・完了した予約の予約時金額で、入金額ではありません。','Bookings by creation date at the pickup station. The booked amount is the price of confirmed or completed bookings, not money received.'],
 pickupsHelp:['実際に貸し出した日・店舗ごとの予約数、用品数、ウェア枚数。','Orders, gear items and wear pieces handed out, by actual date and station.'],
 returnsHelp:['実際に受領した日・店舗ごとの用品数とウェア枚数。','Gear items and wear pieces received, by actual date and station.'],
 moneyHelp:['実際に動いたお金だけを表示します。入金は完了日、返金は依頼日で集計し、完了・処理中・失敗を分けます。予約金額とは別です。','Only money that actually moved. Payments by completion date, refunds by request date, split into completed, in progress and failed. Separate from booked amounts.'],
 careHelp:['現在の状態です（期間は使いません）。','Current state (no period).'],
 type:['レポート','Report'],station:['店舗','Station'],from:['開始日','From'],to:['終了日','To'],show:['表示','Show'],csv:['CSVを保存','Download CSV'],
 total:['合計','Total'],none:['この条件のデータはありません。','No data for these filters.'],failed:['読み込めませんでした。','Could not load.'],retry:['再読み込み','Retry'],
 date:['日付','Date'],created:['作成','Created'],confirmed:['確定','Confirmed'],paymentPending:['決済確認中','Payment pending'],cancelled:['キャンセル','Cancelled'],bookedJpy:['予約金額','Booked amount'],
 orders:['予約','Orders'],items:['用品','Gear items'],wearPieces:['ウェア（枚）','Wear pieces'],collectedJpy:['入金','Collected'],refundedJpy:['返金完了','Refunded'],refundInProgressJpy:['返金処理中','Refund in progress'],refundFailedJpy:['返金失敗','Refund failed'],
 awaitingInspection:['検品待ち','Awaiting inspection'],wearInCare:['ウェア整備中（枚）','Wear in care (pieces)'],asOf:['集計時点','As of'],range:['最大92日まで','Up to 92 days'],
} as const;

/** Booqable Reports: choose a report → period and stations → view, or download the same rows as CSV. */
export function StaffReports({stamp,stores}:{stamp:string;stores:string[]}){
 const {locale}=useStaffLocale(),en=locale==='en',tx=(k:keyof typeof L)=>L[k][en?1:0];
 const params=useSearchParams(),router=useRouter(),get=(k:string)=>params.get(k)??'';
 const type=(TYPES as readonly string[]).includes(get('type'))?get('type') as typeof TYPES[number]:'bookings';
 const selected=(get('stores')?get('stores').split(','):stores).filter(s=>stores.includes(s));
 const set=(patch:Record<string,string>)=>{const q=new URLSearchParams(params.toString());for(const [k,v] of Object.entries(patch))if(v)q.set(k,v);else q.delete(k);router.replace('/staff/reports?'+q.toString(),{scroll:false});};
 const query=new URLSearchParams({type,stores:(selected.length?selected:stores).join(','),...(type!=='care'&&get('from')?{from:get('from')}:{}),...(type!=='care'&&get('to')?{to:get('to')}:{})}).toString();
 const [loaded,setLoaded]=useState<{key:string;data:Data}|null>(null),[failed,setFailed]=useState<string|null>(null),[reload,setReload]=useState(0);
 const gen=useRef(0),key=query+'|'+stamp;
 useEffect(()=>{const ticket=++gen.current;queueMicrotask(async()=>{
  try{const r=await fetch('/api/operations/reports?'+query,{cache:'no-store',headers:{'x-zao-session':stamp}});if(r.status===401||r.status===403){invalidateStaffView();return;}
   if(!r.ok)throw Error();const v=await r.json() as Data;if(ticket===gen.current){setLoaded({key:query+'|'+stamp,data:v});setFailed(null);}}catch{if(ticket===gen.current)setFailed(query+'|'+stamp);}
 });},[query,stamp,reload]);
 // Rows belong to the exact query that produced them; a failed refresh hides them too.
 const data=loaded?.key===key&&failed!==key?loaded.data:null;
 const cell=(c:Column,v:string|number|undefined)=>c.kind==='date'?fmtDate(locale,String(v)):c.kind==='station'?STORE_LABEL[String(v)]??String(v):c.kind==='jpy'?fmtYen(locale,Number(v)):String(v??0);
 // REP-02 (shared with the Orders / Customers / Inventory CSVs): saved only for this query, session and mounted page.
 const csv=useCsvDownload(key+'|'+locale,stamp),csvBusy=csv.busy;
 const download=()=>csv.download('/api/operations/reports?'+query+'&format=csv',`report-${type}-${data?.from??'now'}-${data?.to??''}.csv`.replace(/-\.csv$/,'.csv'));
 return <StaffSessionBoundary stamp={stamp}><main className="ox">
  <div className="ox-head"><h1>{st(locale,'reports')}</h1>{data&&<button type="button" className="sx-btn" disabled={csvBusy} aria-busy={csvBusy} onClick={()=>void download()}>{tx('csv')}</button>}</div>
  <div className="sx-seg ox-tabs" role="tablist" aria-label={tx('type')}>{TYPES.map(t=><button key={t} type="button" role="tab" aria-selected={type===t} onClick={()=>set({type:t==='bookings'?'':t})}>{tx(t)}</button>)}</div>
  
  <div className="ox-controls">
   {stores.length>1&&<div className="sx-seg" role="group" aria-label={tx('station')}>{stores.map(s=><button key={s} type="button" aria-pressed={selected.includes(s)} onClick={()=>{const next=selected.includes(s)?selected.filter(x=>x!==s):[...selected,s];set({stores:next.length&&next.length<stores.length?next.join(','):''});}}>{STORE_LABEL[s]??s}</button>)}</div>}
   {type!=='care'&&<><label className="sx-field">{tx('from')}<input type="date" value={get('from')||data?.from||''} onChange={e=>set({from:e.target.value})}/></label><label className="sx-field">{tx('to')}<input type="date" value={get('to')||data?.to||''} onChange={e=>set({to:e.target.value})}/></label></>}
  </div>
  {(failed===key||csv.failed)&&<p className="sx-alert" role="alert">{tx('failed')} <button type="button" className="sx-link" onClick={()=>setReload(n=>n+1)}>{tx('retry')}</button></p>}
  {data&&!data.rows.length&&<p className="sx-empty">{tx('none')}</p>}
  {data&&data.rows.length>0&&<div className="sx-card ox-table-wrap"><table className="sx-table ox-table" aria-label={tx(type)}>
   <thead><tr>{data.columns.map(c=><th key={c.key} className={c.kind==='count'||c.kind==='jpy'?'ox-num':undefined}>{tx(c.key as 'date')}</th>)}</tr></thead>
   <tbody>{data.rows.map((r,n)=><tr key={n}>{data.columns.map(c=><td key={c.key} className={c.kind==='count'||c.kind==='jpy'?'ox-num':undefined}>{cell(c,r[c.key])}</td>)}</tr>)}</tbody>
   <tfoot><tr>{data.columns.map((c,n)=><td key={c.key} className={c.kind==='count'||c.kind==='jpy'?'ox-num':undefined}>{c.kind==='count'||c.kind==='jpy'?<b>{cell(c,data.totals[c.key])}</b>:n===0?<b>{tx('total')}</b>:''}</td>)}</tr></tfoot>
  </table></div>}
  {data&&<p className="sx-help">{tx('asOf')}: {new Intl.DateTimeFormat(en?'en-GB':'ja-JP',{timeZone:'Asia/Tokyo',dateStyle:'medium',timeStyle:'short'}).format(new Date(data.asOf))} JST</p>}
 </main></StaffSessionBoundary>;
}
