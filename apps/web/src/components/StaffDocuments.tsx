'use client';
import {useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {useRouter,useSearchParams} from 'next/navigation';
import {st} from './staff-i18n';
import {useStaffLocale} from './staff-locale';
import {StaffSessionBoundary,invalidateStaffView} from './StaffSessionBoundary';
import {STORE_LABEL} from './guest-format';
import {fmtDate,fmtYen,statusLabel,paymentLabel,pickupTime,returnTime} from './order-labels';
import './staff-orders.css';
import './staff-documents.css';

// Booqable Documents (Issue #47 consolidated order, Documents row): choose a document from real records, view, print.
// Only documents backed by existing data: the booking confirmation (station copy) from the order detail, the going-out /
// coming-back work list from the Dashboard read, and entries to the saved quotes and the item label sheets. No invoice,
// receipt or tax document is produced here.
type Row={id:string;ref:string;customer:string|null;status:string;startDate:string;endDate:string;slot:string;people:number;pickupStore:string;returnStore:string};
type Detail={order:Row&{email:string|null;state:string;paymentStatus:string|null;originalStartDate:string;originalEndDate:string;amended:boolean;totalJpy:number|null};
 current:{period:{startDate:string;endDate:string;slot:string};members:{key:string;product?:string;items:{family:string}[]}[]};
 terms:{version:string;locale:string;acceptedAt:string}|null;cancellationPolicy:{policyVersion:string;freeCancellationUntil:string}|null};
type Dash={from:string;to:string;goingOut:Row[];comingBack:Row[];goingOutTotal:number;comingBackTotal:number;max:number;complete:boolean;days:{date:string;goingOut:number;comingBack:number;complete:boolean}[]};
const FAMILY:Record<string,[string,string]>={SKI:['スキー','Ski'],SKI_BOOT:['スキーブーツ','Ski boots'],SNOWBOARD:['スノーボード','Snowboard'],SNOWBOARD_BOOT:['スノーボードブーツ','Snowboard boots'],POLE:['ポール','Poles'],WEAR_JACKET:['ウェア（上）','Wear (top)'],WEAR_PANTS:['ウェア（下）','Wear (bottom)']};
const L={
 booking:['予約確認書（店舗控え）','Booking confirmation (station copy)'],bookingHelp:['予約番号で予約を開き、内容を表示・印刷します。領収書・請求書ではありません。','Open a booking by its number to view and print it. This is not a receipt or invoice.'],
 work:['作業リスト','Work list'],workHelp:['店舗と日付を選び、貸出予定・返却予定を印刷します。','Choose a station and date to print going-out and coming-back lists.'],
 quotes:['見積','Quotes'],quotesHelp:['保存した見積は見積の画面で確認できます（作成者・店舗の範囲内）。','Saved quotes are on the quotes screen (within your own and your stations’).'],
 labels:['用品ラベル','Item labels'],labelsHelp:['個体を台帳で開くと、そのQRラベルを印刷できます。','Open an item in the ledger to print its QR label.'],
 orderNo:['予約番号（8桁以上）','Booking number (8+ characters)'],open:['開く','Open'],station:['店舗','Station'],date:['日付','Date'],show:['表示','Show'],print:['印刷','Print'],back:['書類一覧へ','All documents'],
 notFound:['該当する予約が見つかりません。','No matching booking.'],several:['複数の予約が一致しました。予約番号をもう少し長く入力してください。','Several bookings match. Enter more of the number.'],failed:['読み込めませんでした。','Could not load.'],
 customer:['お客様','Customer'],status:['状態','Status'],payment:['支払状況','Payment'],pickup:['受取','Pickup'],ret:['返却','Return'],people:['人数','Guests'],items:['用品','Items'],total:['予約金額（税込）','Booked amount (tax incl.)'],
 terms:['同意した規約','Accepted terms'],cancel:['無料キャンセル期限','Free cancellation until'],original:['当初の日程','Original dates'],guest:['利用者','Guest'],
 notReceipt:['この書類は予約内容の確認用です。領収書・請求書ではありません。','This document confirms the booking details. It is not a receipt or an invoice.'],
 goingOut:['貸出予定','Going out'],comingBack:['返却予定','Coming back'],none:['予定はありません。','Nothing scheduled.'],
 time:['時刻','Time'],order:['予約番号','Order'],checked:['確認','Check'],
 splitTitle:['この期間は1枚の作業リストに収まりません','This period does not fit in one work list'],
 splitHelp:['欠けた作業リストは印刷しません。日ごとの作業リストを開いて、それぞれ印刷してください。','A partial work list is never printed. Open each day’s work list and print it.'],
 splitDay:['日付','Day'],splitOpen:['作業リストを開く','Open work list'],splitTooMany:['1日分も上限を超えています。予約一覧のCSVで全件を出力してください。','Even this day is over the limit. Export all orders as CSV from Orders.'],
 notPrintable:['この画面は不完全なため、作業リストとして印刷できません。','This page is incomplete and cannot be printed as a work list.'],
} as const;

export function StaffDocuments({stamp,stores}:{stamp:string;stores:string[]}){
 const {locale}=useStaffLocale(),en=locale==='en',tx=(k:keyof typeof L)=>L[k][en?1:0];
 const params=useSearchParams(),router=useRouter(),doc=params.get('doc')??'',id=params.get('id')??'';
 const ymd=(k:string)=>/^\d{4}-\d{2}-\d{2}$/.test(params.get(k)??'')?params.get(k)!:'';
 const store=stores.includes(params.get('store')??'')?params.get('store')!:stores[0]??'',date=ymd('date'),from=ymd('from')||date,to=ymd('to')||from;
 const [ref,setRef]=useState(''),[find,setFind]=useState<'notFound'|'several'|'failed'|null>(null),[pickDate,setPickDate]=useState(date),[pickStore,setPickStore]=useState(store);
 const go=(q:Record<string,string>)=>router.push('/staff/documents?'+new URLSearchParams(q).toString());
 async function openBooking(){const v=ref.trim().replace(/^#/,'');if(v.length<8)return setFind('notFound');setFind(null);
  try{const r=await fetch('/api/operations/orders?'+new URLSearchParams({stores:[...stores].join(','),search:v,pageSize:'2'}),{cache:'no-store',headers:{'x-zao-session':stamp}});if(r.status===401||r.status===403){invalidateStaffView();return;}if(!r.ok)throw Error();
   const d=await r.json() as {total:number;rows:Row[]};if(d.total===0)return setFind('notFound');if(d.total>1)return setFind('several');go({doc:'booking',id:d.rows[0]!.id});}catch{setFind('failed');}}
 if(doc==='booking'&&/^[0-9a-f-]{36}$/.test(id))return <StaffSessionBoundary stamp={stamp}><BookingDoc stamp={stamp} id={id}/></StaffSessionBoundary>;
 if(doc==='work'&&store&&from)return <StaffSessionBoundary stamp={stamp}><WorkDoc stamp={stamp} store={store} from={from} to={to}/></StaffSessionBoundary>;
 return <StaffSessionBoundary stamp={stamp}><main className="ox">
  <div className="ox-head"><h1>{st(locale,'documents')}</h1></div>
  <div className="ox-docs">
   <section className="sx-card ox-doc" aria-labelledby="doc-booking"><h2 id="doc-booking">{tx('booking')}</h2><p className="sx-help">{tx('bookingHelp')}</p>
    <form onSubmit={e=>{e.preventDefault();void openBooking();}}><label className="sx-field">{tx('orderNo')}<input value={ref} onChange={e=>setRef(e.target.value)} maxLength={40} autoComplete="off"/></label><button className="sx-btn sx-btn--primary">{tx('open')}</button></form>
    {find&&<p role="alert" className="sx-alert">{tx(find)}</p>}</section>
   <section className="sx-card ox-doc" aria-labelledby="doc-work"><h2 id="doc-work">{tx('work')}</h2><p className="sx-help">{tx('workHelp')}</p>
    <form onSubmit={e=>{e.preventDefault();if(pickStore&&pickDate)go({doc:'work',store:pickStore,date:pickDate});}}>
     {stores.length>1&&<label className="sx-field">{tx('station')}<select value={pickStore} onChange={e=>setPickStore(e.target.value)}>{stores.map(s=><option key={s} value={s}>{STORE_LABEL[s]??s}</option>)}</select></label>}
     <label className="sx-field">{tx('date')}<input type="date" value={pickDate} onChange={e=>setPickDate(e.target.value)} required/></label><button className="sx-btn sx-btn--primary">{tx('show')}</button></form></section>
   <section className="sx-card ox-doc" aria-labelledby="doc-quotes"><h2 id="doc-quotes">{tx('quotes')}</h2><p className="sx-help">{tx('quotesHelp')}</p><Link href="/staff/quotes">{tx('quotes')}</Link></section>
   <section className="sx-card ox-doc" aria-labelledby="doc-labels"><h2 id="doc-labels">{tx('labels')}</h2><p className="sx-help">{tx('labelsHelp')}</p><Link href="/staff/ledger">{st(locale,'inventory')}</Link></section>
  </div>
 </main></StaffSessionBoundary>;
}

// DOC-01: a document result belongs to exactly one (url, staff session stamp). Another session — even on the same url —
// never sees it, not even while its own request is pending; 401/403/404/failure replace it with an error (no content, no
// print button); a late answer from an earlier url or stamp is dropped by the request generation.
function useJson<T>(url:string,stamp:string){
 const key=url+'|'+stamp;
 const [state,setState]=useState<{key:string;data?:T;error?:'notFound'|'failed'|'forbidden'}|null>(null),gen=useRef(0);
 useEffect(()=>{const ticket=++gen.current;queueMicrotask(async()=>{try{const r=await fetch(url,{cache:'no-store',headers:{'x-zao-session':stamp}});
  if(ticket!==gen.current)return;if(r.status===401||r.status===403){setState({key,error:'forbidden'});invalidateStaffView();return;}
  if(r.status===404){setState({key,error:'notFound'});return;}if(!r.ok)throw Error();const v=await r.json() as T;if(ticket===gen.current)setState({key,data:v});}catch{if(ticket===gen.current)setState({key,error:'failed'});}});},[url,stamp,key]);
 return state?.key===key?state:null;
}

function DocFrame({title,children}:{title:string;children:React.ReactNode}){
 const {locale}=useStaffLocale(),en=locale==='en',tx=(k:keyof typeof L)=>L[k][en?1:0];
 return <main className="ox ox-print"><div className="ox-head ox-noprint"><Link href="/staff/documents">← {tx('back')}</Link><button type="button" className="sx-btn sx-btn--primary" onClick={()=>window.print()}>{tx('print')}</button></div>
  <article className="ox-paper"><p className="ox-paper-brand">SALOMON RENTAL STATION ZAO</p><h1>{title}</h1>{children}</article></main>;
}

function BookingDoc({stamp,id}:{stamp:string;id:string}){
 const {locale}=useStaffLocale(),en=locale==='en',tx=(k:keyof typeof L)=>L[k][en?1:0];
 const s=useJson<Detail>('/api/operations/orders/'+encodeURIComponent(id),stamp);
 if(!s)return <main className="ox"><p role="status">…</p></main>;
 if(s.error||!s.data)return <main className="ox"><p role="alert" className="sx-alert">{tx(s.error==='notFound'?'notFound':'failed')}</p><Link href="/staff/documents">{tx('back')}</Link></main>;
 const d=s.data,o=d.order,p=d.current.period;
 return <DocFrame title={tx('booking')}><dl className="ox-dl">
  <dt>{tx('order')}</dt><dd>#{o.ref}</dd><dt>{tx('customer')}</dt><dd>{o.customer??'—'}</dd>
  <dt>{tx('status')}</dt><dd>{statusLabel(locale,o.status)}</dd><dt>{tx('payment')}</dt><dd>{paymentLabel(locale,o.paymentStatus)}</dd>
  <dt>{tx('pickup')}</dt><dd>{fmtDate(locale,p.startDate)} {pickupTime(p.slot)} · {STORE_LABEL[o.pickupStore]??o.pickupStore}</dd>
  <dt>{tx('ret')}</dt><dd>{fmtDate(locale,p.endDate)} {returnTime(p.slot)} · {STORE_LABEL[o.returnStore]??o.returnStore}</dd>
  {o.amended&&<><dt>{tx('original')}</dt><dd>{fmtDate(locale,o.originalStartDate)} – {fmtDate(locale,o.originalEndDate)}</dd></>}
  <dt>{tx('people')}</dt><dd>{o.people}</dd>
  <dt>{tx('items')}</dt><dd><ul>{d.current.members.map((m,n)=><li key={m.key}>{tx('guest')} {n+1}: {m.items.map(i=>FAMILY[i.family]?.[en?1:0]??i.family).join(' · ')}</li>)}</ul></dd>
  <dt>{tx('total')}</dt><dd>{fmtYen(locale,o.totalJpy)}</dd>
  {d.terms&&<><dt>{tx('terms')}</dt><dd>{d.terms.version} · {new Intl.DateTimeFormat(en?'en-GB':'ja-JP',{timeZone:'Asia/Tokyo',dateStyle:'medium',timeStyle:'short'}).format(new Date(d.terms.acceptedAt))}</dd></>}
  {d.cancellationPolicy&&<><dt>{tx('cancel')}</dt><dd>{new Intl.DateTimeFormat(en?'en-GB':'ja-JP',{timeZone:'Asia/Tokyo',dateStyle:'medium',timeStyle:'short'}).format(new Date(d.cancellationPolicy.freeCancellationUntil))} JST</dd></>}
 </dl><p className="sx-help">{tx('notReceipt')}</p></DocFrame>;
}

// DASH-PRINT-01: the work list is complete or it is not shown. It reads the dedicated work-list endpoint (same rules as the
// Dashboard panels, one snapshot); over the bound the page lists the days instead, each of which opens a complete list.
function WorkDoc({stamp,store,from,to}:{stamp:string;store:string;from:string;to:string}){
 const {locale}=useStaffLocale(),en=locale==='en',tx=(k:keyof typeof L)=>L[k][en?1:0];
 const s=useJson<Dash>('/api/operations/work-list?'+new URLSearchParams({store,from,to}),stamp);
 if(!s)return <main className="ox"><p role="status">…</p></main>;
 if(s.error||!s.data)return <main className="ox"><p role="alert" className="sx-alert">{tx('failed')}</p><Link href="/staff/documents">{tx('back')}</Link></main>;
 const d=s.data,multi=from!==to,title=`${tx('work')} · ${STORE_LABEL[store]??store} · ${fmtDate(locale,from)}${multi?' – '+fmtDate(locale,to):''}`;
 // Over the bound the server withholds the rows (never a partial list). Offer one complete list per day from the same
 // snapshot's per-day counts; nothing on this page is a work list, and the print stylesheet says so if printed anyway.
 if(!d.complete)return <main className="ox ox-print ox-incomplete"><div className="ox-head"><Link href="/staff/documents">← {tx('back')}</Link></div>
  <p className="ox-print-refusal">{tx('notPrintable')}</p>
  <section className="sx-card ox-split" aria-labelledby="ox-split-h"><h1 id="ox-split-h">{title}</h1>
   <p role="alert" className="sx-alert">{tx('splitTitle')} ({tx('goingOut')} {d.goingOutTotal} · {tx('comingBack')} {d.comingBackTotal} / {en?'limit':'上限'} {d.max})</p><p className="sx-help">{tx('splitHelp')}</p>
   <table className="sx-table"><thead><tr><th>{tx('splitDay')}</th><th>{tx('goingOut')}</th><th>{tx('comingBack')}</th><th><span className="sx-visually-hidden">{tx('splitOpen')}</span></th></tr></thead>
    <tbody>{d.days.filter(x=>x.goingOut+x.comingBack>0).map(x=><tr key={x.date}><td>{fmtDate(locale,x.date)}</td><td>{x.goingOut}</td><td>{x.comingBack}</td>
     <td>{x.complete?<Link href={'/staff/documents?'+new URLSearchParams({doc:'work',store,from:x.date,to:x.date})}>{tx('splitOpen')}</Link>:<span className="sx-help">{tx('splitTooMany')}</span>}</td></tr>)}</tbody></table>
  </section></main>;
 const table=(rows:Row[],kind:'out'|'back',totalN:number)=><section aria-label={kind==='out'?tx('goingOut'):tx('comingBack')}><h2>{kind==='out'?tx('goingOut'):tx('comingBack')} · {totalN}</h2>
  {rows.length?<table className="sx-table"><thead><tr>{multi&&<th>{tx('date')}</th>}<th>{tx('time')}</th><th>{tx('order')}</th><th>{tx('customer')}</th><th>{tx('people')}</th><th>{tx('status')}</th><th>{tx('checked')}</th></tr></thead>
   <tbody>{rows.map(r=><tr key={r.id}>{multi&&<td>{fmtDate(locale,kind==='out'?r.startDate:r.endDate)}</td>}<td>{kind==='out'?pickupTime(r.slot):returnTime(r.slot)}</td><td>#{r.ref}</td><td>{r.customer??'—'}</td><td>{r.people}</td><td>{statusLabel(locale,r.status)}</td><td>☐</td></tr>)}</tbody></table>:<p>{tx('none')}</p>}</section>;
 return <DocFrame title={title}>{table(d.goingOut,'out',d.goingOutTotal)}{table(d.comingBack,'back',d.comingBackTotal)}</DocFrame>;
}
