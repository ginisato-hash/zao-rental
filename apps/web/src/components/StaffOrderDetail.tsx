'use client';
import {useStaffLocaleOr} from './staff-locale';
import {Fragment,useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {type StaffLocale} from './staff-i18n';
import {StaffSessionBoundary,invalidateStaffView} from './StaffSessionBoundary';
import {STORE_LABEL} from './guest-format';
import {staffLabel} from './staff-labels';
import {statusLabel,statusTone,paymentLabel,fmtDate,fmtYen,pickupTime,returnTime} from './order-labels';
import './staff-orders.css';

type Order={id:string;ref:string;customer:string|null;email:string|null;state:string;status:string;paymentStatus:string|null;pickupStore:string;returnStore:string;startDate:string;endDate:string;slot:string;
 originalStartDate:string;originalEndDate:string;amended:boolean;people:number;totalJpy:number|null;createdAt:string;lateOut:boolean;lateBack:boolean;outItems:number};
type Item={family:string;variantIds?:string[];modelPromise?:{modelId?:string;season?:string;variantId?:string}};
type Member={key:string;sport?:string;wearSport?:string;product?:string;age?:string;tier?:string;items:Item[]};
type Variant={id:string;family:string;age:string;tier:string;size:string;model:string};
type Detail={order:Order;current:{period:{startDate:string;endDate:string;slot:string};members:Member[]};original:{period:{startDate:string;endDate:string}};
 loans:{requirementKey:string;family:string;state:string;checkedOutAt:string;receivedStore:string|null;receivedAt:string|null;inspectedAt:string|null}[];
 wear:{requirementKey:string;quantity:number;returned:number}[];variants?:Variant[];payments:{state:string;amountJpy:number;createdAt:string}[];
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
/** What the booking's conditions say about an item, never what was physically handed out. Wear names one exact size. Gear names the acceptable
 * variants: with a model promise (the contract allows exactly that one variant, so it is the booked size) the promised model and its size are stated; without one everything is listed as options (grouped per
 * model so a size is never attached to the wrong model). An id that no longer resolves shows nothing. */
function itemDetail(item:Item,variants:Variant[]|undefined,l:StaffLocale):string[]{
 const en=l==='en',found=(item.variantIds??[]).map(id=>variants?.find(v=>v.id===id)).filter((v):v is Variant=>!!v);
 const sizeList=(vs:Variant[])=>{const sizes=[...new Set(vs.map(v=>v.size))];return sizes.length>4?sizes.slice(0,4).join(' / ')+` +${sizes.length-4}`:sizes.join(' / ');};
 if(item.family.startsWith('WEAR_'))return found.length?[`${en?'Booked size':'予約サイズ'}: ${[...new Set(found.map(v=>v.model))].join(' / ')} · ${sizeList(found)}`]:[];
 if(item.modelPromise){
  const promised=item.modelPromise.variantId?variants?.find(v=>v.id===item.modelPromise!.variantId):undefined,own=promised?found.filter(v=>v.model===promised.model):found;
  return [`${en?'Promised model':'確約モデル'}: ${promised?promised.model:'—'}`,...(own.length?[`${en?'Booked size':'予約サイズ'}: ${sizeList(own)}`]:[])];
 }
 if(!found.length)return [];
 const groups=[...new Set(found.map(v=>v.model))].map(m=>`${m} ${sizeList(found.filter(v=>v.model===m))}`);
 return [`${en?'Options':'候補'}: ${groups.join(' ／ ')}`];
}
const when=(iso:string,l:StaffLocale)=>new Intl.DateTimeFormat(l==='en'?'en-GB':'ja-JP',{timeZone:'Asia/Tokyo',dateStyle:'medium',timeStyle:'short'}).format(new Date(iso))+' JST';

/** Booqable order detail: header with status and the primary actions top-right, then schedule, items/custody, payment,
 * and the accepted terms. Readable with BOOKING_VIEW; each action is shown only to holders of its own permission. */
export function StaffOrderDetail({locale:serverLocale,stamp,id,can}:{locale:StaffLocale;stamp:string;id:string;can:{checkout:boolean;ret:boolean;amend:boolean}}){
 const locale=useStaffLocaleOr(serverLocale);
 const tx=(k:keyof typeof L)=>L[k][locale==='en'?1:0],fam=(f:string)=>FAMILY[f]?.[locale==='en'?1:0]??f;
 const [loadedDetail,setLoadedDetail]=useState<{key:string;data:Detail}|null>(null),[errState,setErrState]=useState<{key:string;kind:'NOT_FOUND'|'FAILED'}|null>(null),[reload,setReload]=useState(0),gen=useRef(0);
 useEffect(()=>{const ticket=++gen.current,reqKey=id+'|'+stamp;queueMicrotask(async()=>{
  try{const r=await fetch('/api/operations/orders/'+encodeURIComponent(id),{cache:'no-store',headers:{'x-zao-session':stamp}});
   if(r.status===401){invalidateStaffView();return;}if(r.status===404||r.status===403){if(ticket===gen.current)setErrState({key:reqKey,kind:'NOT_FOUND'});return;}
   if(!r.ok)throw Error();const v=await r.json() as Detail;if(ticket===gen.current){setLoadedDetail({key:reqKey,data:v});setErrState(null);}}catch{if(ticket===gen.current)setErrState({key:reqKey,kind:'FAILED'});}
 });},[id,stamp,reload]);
 // The shown detail and its actions belong to exactly this request key (target + session); failures and target
 // changes hide them instead of leaving the previous record usable.
 const viewKey=id+'|'+stamp,error=errState?.key===viewKey?errState.kind:null,data=loadedDetail?.key===viewKey&&!error?loadedDetail.data:null;
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
      {o.amended&&<><dt>{tx('amended')}</dt><dd>{fmtDate(locale,o.originalStartDate)} – {fmtDate(locale,o.originalEndDate)}</dd></>}
      <dt>{locale==='en'?'Booked at':'受付日時'}</dt><dd>{when(o.createdAt,locale)}</dd></dl></section>
    <section className="ox-panel sx-card" aria-labelledby="od-pay"><header className="ox-panel-h"><h2 id="od-pay">{tx('payment')}</h2></header>
     <dl className="od-dl"><dt>{tx('total')}</dt><dd>{fmtYen(locale,o.totalJpy)}</dd>
      {data.payments.map((p,n)=><Fragment key={n}><dt>{paymentLabel(locale,p.state)}</dt><dd>{fmtYen(locale,p.amountJpy)} · {when(p.createdAt,locale)}</dd></Fragment>)}</dl></section>
   </div>
   <section className="ox-panel sx-card" style={{marginTop:20}} aria-labelledby="od-items"><header className="ox-panel-h"><h2 id="od-items">{tx('items')}</h2></header>
    <table className="sx-table"><tbody>{data.current.members.flatMap(m=>{
      const person=`${tx('person')} ${m.key.replace(/\D/g,'')||m.key}`,tags=[m.product,m.product==='WEAR_SET'?m.wearSport:undefined,m.age,m.tier].filter((x):x is string=>!!x).map(x=>staffLabel(x,locale)).join(' · ');
      return m.items.map((i,n)=>{const key=m.key+':'+i.family,isWear=i.family.startsWith('WEAR_'),loan=isWear?undefined:data.loans.find(l=>l.requirementKey===key),wl=isWear?data.wear.find(w=>w.requirementKey===key):undefined;
       const status=isWear?(wl?(wl.quantity-wl.returned>0?`${tx('out')} ${wl.quantity-wl.returned}/${wl.quantity}`:`${tx('received')} ${wl.returned}/${wl.quantity}`):tx('notYet')):!loan?tx('notYet'):loan.state==='OUT'?`${tx('out')} · ${when(loan.checkedOutAt,locale)}`:`${tx('received')}${loan.receivedStore?' · '+(STORE_LABEL[loan.receivedStore]??''):''}${loan.inspectedAt?' · '+tx('inspected'):''}`;
       return <tr key={key}><td>{n===0?<>{person}{tags&&<div className="sx-help">{tags}</div>}</>:null}</td><td>{fam(i.family)}{itemDetail(i,data.variants,locale).map((t,k)=><div key={k} className="sx-help">{t}</div>)}</td><td>{status}</td></tr>;});})}
     {data.wear.filter(w=>!data.current.members.some(m=>m.items.some(i=>m.key+':'+i.family===w.requirementKey))).map(w=><tr key={w.requirementKey}><td colSpan={2}>{tx('wear')}</td><td>{w.quantity-w.returned>0?`${tx('out')} ${w.quantity-w.returned}/${w.quantity}`:`${tx('received')} ${w.returned}/${w.quantity}`}</td></tr>)}</tbody></table></section>
   <section className="ox-panel sx-card" style={{marginTop:20}} aria-labelledby="od-terms"><header className="ox-panel-h"><h2 id="od-terms">{tx('contract')}</h2></header>
    <dl className="od-dl">{data.terms?<><dt>{data.terms.version}</dt><dd>{data.terms.locale.toUpperCase()} · {when(data.terms.acceptedAt,locale)}</dd></>:<dd className="sx-help">{tx('termsNone')}</dd>}
     {data.cancellationPolicy&&<><dt>{tx('free')}</dt><dd>{when(data.cancellationPolicy.freeCancellationUntil,locale)} ({data.cancellationPolicy.policyVersion})</dd></>}</dl></section>
  </>}
 </main></StaffSessionBoundary>;
}
