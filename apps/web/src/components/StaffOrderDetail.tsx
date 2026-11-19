'use client';
import {Fragment,useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {type StaffLocale} from './staff-i18n';
import {StaffSessionBoundary,invalidateStaffView} from './StaffSessionBoundary';
import {STORE_LABEL} from './guest-format';
import {statusLabel,statusTone,paymentLabel,fmtDate,fmtYen,pickupTime,returnTime} from './order-labels';
import './staff-orders.css';

type Order={id:string;ref:string;customer:string|null;email:string|null;state:string;status:string;paymentStatus:string|null;pickupStore:string;returnStore:string;startDate:string;endDate:string;slot:string;
 originalStartDate:string;originalEndDate:string;amended:boolean;people:number;totalJpy:number|null;lateOut:boolean;lateBack:boolean;outItems:number};
type Member={key:string;sport?:string;product?:string;items:{family:string}[]};
type Detail={order:Order;current:{period:{startDate:string;endDate:string;slot:string};members:Member[]};original:{period:{startDate:string;endDate:string}};
 loans:{requirementKey:string;family:string;state:string;checkedOutAt:string;receivedStore:string|null;receivedAt:string|null;inspectedAt:string|null}[];
 wear:{requirementKey:string;quantity:number;returned:number}[];payments:{state:string;amountJpy:number;createdAt:string}[];
 terms:{version:string;locale:string;acceptedAt:string}|null;cancellationPolicy:{policyVersion:string;freeCancellationUntil:string}|null};
const L={
 back:['予約一覧','Orders'],schedule:['日程','Schedule'],pickup:['受取','Pickup'],ret:['返却','Return'],amended:['変更前','Before change'],
 items:['用品','Items'],person:['人','Person'],custody:['貸出・返却','Custody'],out:['貸出中','Out'],received:['返却済み','Returned'],inspected:['点検済み','Inspected'],notYet:['未貸出','Not handed out'],
 wear:['ウェア','Wear'],payment:['支払い','Payment'],total:['予約金額','Booking total'],contract:['規約・取消条件','Terms and cancellation'],
 termsNone:['この予約には新しい規約の同意記録がありません（当時の条件が適用されます）。','No new-terms acceptance is recorded for this booking (the terms at the time apply).'],
 free:['無料キャンセル期限','Free cancellation until'],prepare:['準備・貸出','Prepare / check out'],doReturn:['返却','Return'],change:['変更・返金依頼','Change / refund'],
 notFound:['予約が見つからないか、閲覧権限がありません。','Order not found or not visible to you.'],failed:['読み込めませんでした。','Could not load.'],retry:['再読み込み','Retry'],people:['名','people'],
 late:['遅れ','Late'],
} as const;
const FAMILY:Record<string,[string,string]>={SKI:['スキー','Ski'],SKI_BOOT:['スキーブーツ','Ski boots'],SNOWBOARD:['スノーボード','Snowboard'],SNOWBOARD_BOOT:['スノーボードブーツ','Snowboard boots'],POLE:['ポール','Poles'],WEAR_JACKET:['ジャケット','Jacket'],WEAR_PANTS:['パンツ','Pants']};
const when=(iso:string,l:StaffLocale)=>new Intl.DateTimeFormat(l==='en'?'en-GB':'ja-JP',{timeZone:'Asia/Tokyo',dateStyle:'medium',timeStyle:'short'}).format(new Date(iso))+' JST';

/** Booqable order detail: header with status and the primary actions top-right, then schedule, items/custody, payment,
 * and the accepted terms. Readable with BOOKING_VIEW; each action is shown only to holders of its own permission. */
export function StaffOrderDetail({locale,stamp,id,can}:{locale:StaffLocale;stamp:string;id:string;can:{checkout:boolean;ret:boolean;amend:boolean}}){
 const tx=(k:keyof typeof L)=>L[k][locale==='en'?1:0],fam=(f:string)=>FAMILY[f]?.[locale==='en'?1:0]??f;
 const [data,setData]=useState<Detail|null>(null),[error,setError]=useState<'NOT_FOUND'|'FAILED'|null>(null),[reload,setReload]=useState(0),gen=useRef(0);
 useEffect(()=>{const ticket=++gen.current;queueMicrotask(async()=>{
  try{const r=await fetch('/api/operations/orders/'+encodeURIComponent(id),{cache:'no-store',headers:{'x-zao-session':stamp}});
   if(r.status===401){invalidateStaffView();return;}if(r.status===404||r.status===403){if(ticket===gen.current)setError('NOT_FOUND');return;}
   if(!r.ok)throw Error();const v=await r.json() as Detail;if(ticket===gen.current){setData(v);setError(null);}}catch{if(ticket===gen.current)setError('FAILED');}
 });},[id,stamp,reload]);
 const o=data?.order;
 return <StaffSessionBoundary stamp={stamp}><main className="ox">
  <p><Link href="/staff/orders" className="sx-link">‹ {tx('back')}</Link></p>
  {error==='NOT_FOUND'&&<p className="sx-alert" role="alert">{tx('notFound')}</p>}
  {error==='FAILED'&&<p className="sx-alert" role="alert">{tx('failed')} <button type="button" className="sx-link" onClick={()=>setReload(n=>n+1)}>{tx('retry')}</button></p>}
  {!o&&!error&&<p className="sx-status" role="status">…</p>}
  {o&&data&&<>
   <div className="ox-head"><h1>#{o.ref}</h1><span className={'ox-status ox-status--'+statusTone(o.status)}>{statusLabel(locale,o.status)}{(o.lateOut||o.lateBack)&&` · ${tx('late')}`}</span>
    <span style={{marginLeft:'auto'}}/>
    {can.checkout&&<Link className="sx-btn sx-btn--primary" href={`/staff/rentals?booking=${encodeURIComponent(o.id)}`}>{tx('prepare')}</Link>}
    {can.ret&&<Link className="sx-btn" href={`/staff/rentals?booking=${encodeURIComponent(o.id)}#return`}>{tx('doReturn')}</Link>}
    {can.amend&&<Link className="sx-btn" href={`/staff/amendments?booking=${encodeURIComponent(o.id)}`}>{tx('change')}</Link>}
   </div>
   <p className="sx-help">{o.customer??'—'}{o.email?` · ${o.email}`:''} · {o.people} {tx('people')}</p>
   <div className="ox-grid">
    <section className="ox-panel sx-card" aria-labelledby="od-schedule"><header className="ox-panel-h"><h2 id="od-schedule">{tx('schedule')}</h2></header>
     <dl className="od-dl"><dt>{tx('pickup')}</dt><dd>{fmtDate(locale,o.startDate)} {pickupTime(o.slot)} · {STORE_LABEL[o.pickupStore]??'—'}</dd>
      <dt>{tx('ret')}</dt><dd>{fmtDate(locale,o.endDate)} {returnTime(o.slot)} · {STORE_LABEL[o.returnStore]??'—'}</dd>
      {o.amended&&<><dt>{tx('amended')}</dt><dd>{fmtDate(locale,o.originalStartDate)} – {fmtDate(locale,o.originalEndDate)}</dd></>}</dl></section>
    <section className="ox-panel sx-card" aria-labelledby="od-pay"><header className="ox-panel-h"><h2 id="od-pay">{tx('payment')}</h2></header>
     <dl className="od-dl"><dt>{tx('total')}</dt><dd>{fmtYen(locale,o.totalJpy)}</dd>
      {data.payments.map((p,n)=><Fragment key={n}><dt>{paymentLabel(locale,p.state)}</dt><dd>{fmtYen(locale,p.amountJpy)} · {when(p.createdAt,locale)}</dd></Fragment>)}</dl></section>
   </div>
   <section className="ox-panel sx-card" style={{marginTop:20}} aria-labelledby="od-items"><header className="ox-panel-h"><h2 id="od-items">{tx('items')}</h2></header>
    <table className="sx-table"><tbody>{data.current.members.flatMap(m=>m.items.filter(i=>!i.family.startsWith('WEAR_')).map(i=>{const key=m.key+':'+i.family,loan=data.loans.find(l=>l.requirementKey===key);
     return <tr key={key}><td>{tx('person')} {m.key.replace(/\D/g,'')||m.key}</td><td>{fam(i.family)}</td><td>{!loan?tx('notYet'):loan.state==='OUT'?`${tx('out')} · ${when(loan.checkedOutAt,locale)}`:`${tx('received')}${loan.receivedStore?' · '+(STORE_LABEL[loan.receivedStore]??''):''}${loan.inspectedAt?' · '+tx('inspected'):''}`}</td></tr>;}))}
     {data.wear.map(w=><tr key={w.requirementKey}><td colSpan={2}>{tx('wear')}</td><td>{w.quantity-w.returned>0?`${tx('out')} ${w.quantity-w.returned}/${w.quantity}`:`${tx('received')} ${w.returned}/${w.quantity}`}</td></tr>)}</tbody></table></section>
   <section className="ox-panel sx-card" style={{marginTop:20}} aria-labelledby="od-terms"><header className="ox-panel-h"><h2 id="od-terms">{tx('contract')}</h2></header>
    <dl className="od-dl">{data.terms?<><dt>{data.terms.version}</dt><dd>{data.terms.locale.toUpperCase()} · {when(data.terms.acceptedAt,locale)}</dd></>:<dd className="sx-help">{tx('termsNone')}</dd>}
     {data.cancellationPolicy&&<><dt>{tx('free')}</dt><dd>{when(data.cancellationPolicy.freeCancellationUntil,locale)} ({data.cancellationPolicy.policyVersion})</dd></>}</dl></section>
  </>}
 </main></StaffSessionBoundary>;
}
