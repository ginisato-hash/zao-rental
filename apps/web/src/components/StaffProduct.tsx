'use client';
import {useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {type StaffLocale} from './staff-i18n';
import {StaffSessionBoundary,invalidateStaffView} from './StaffSessionBoundary';
import {STORE_LABEL} from './guest-format';
import {COUNT_LABEL,FAMILY_LABEL,type Counts} from './StaffInventory';
import './staff-orders.css';

type Variant={id:string;age:string;tier:string;size:string;counts:Counts};
type Item={id:string;size:string;origin:string;here:string;status:string;bslStatus:string;bslMm:number|null;out:boolean;transitTo:string|null;uninspected:boolean;transferNotReady:boolean};
type Detail={store:string;model:{id:string;code:string;name:string;brand:string;family:string};variants:Variant[];items:Item[];history:{at:string;resource:string;action:string;reason:string;entityId:string}[]};
const L={
 back:['在庫一覧','Inventory'],variants:['サイズ','Sizes'],items:['個体','Items'],history:['履歴','History'],size:['サイズ','Size'],
 check:['期間の予約可否','Bookable for dates'],from:['開始日','From'],to:['終了日','To'],run:['確認','Check'],feasible:['予約可能','Bookable'],insufficient:['在庫不足','Not enough stock'],indeterminate:['判定できません','Cannot decide'],
 checkHelp:['予約と同じ在庫計算（現物・確保・移送・予備枠）で判定します。何も確保しません。','Uses the same allocation as booking (stock, holds, transfers, buffer). Nothing is reserved.'],
 state:['状態','State'],where:['所在','Location'],out:['貸出中','Out'],transit:['移送中','In transit to'],care:['点検待ち','Awaiting inspection'],readying:['移送受領・準備中','Transfer received, readying'],
 bsl:['BSL','BSL'],none:['ありません。','None.'],failed:['読み込めませんでした。','Could not load.'],notFound:['商品が見つかりません。','Product not found.'],retry:['再読み込み','Retry'],
 status_AVAILABLE:['利用可','Available'],status_MAINTENANCE:['整備中','Maintenance'],status_UNVERIFIED:['未確認','Unverified'],status_RETIRED:['廃棄','Retired'],
} as const;
const when=(iso:string,l:StaffLocale)=>new Intl.DateTimeFormat(l==='en'?'en-GB':'ja-JP',{timeZone:'Asia/Tokyo',dateStyle:'medium',timeStyle:'short'}).format(new Date(iso));

/** Booqable product detail: tabs Sizes / Items / History, plus a read-only "bookable for dates" check that reuses the
 * existing holds availability (planMixedAllocation) for the selected size and station. */
export function StaffProduct({locale,stamp,id,store,canCheck}:{locale:StaffLocale;stamp:string;id:string;store:string;canCheck:boolean}){
 const tx=(k:keyof typeof L)=>L[k][locale==='en'?1:0],en=locale==='en';
 const [loadedDetail,setLoadedDetail]=useState<{key:string;data:Detail}|null>(null),[errState,setErrState]=useState<{key:string;kind:'NOT_FOUND'|'FAILED'}|null>(null),[tab,setTab]=useState<'variants'|'items'|'history'>('variants'),[reload,setReload]=useState(0),gen=useRef(0);
 const [variant,setVariant]=useState(''),[from,setFrom]=useState(''),[to,setTo]=useState(''),[checked,setChecked]=useState<{key:string;result:string}|null>(null),[busy,setBusy]=useState(false),checkGen=useRef(0);
 // A bookability answer is valid only for exactly this product, station, size, dates and session.
 const checkKey=[id,store,variant,from,to,stamp].join('|'),result=checked?.key===checkKey?checked.result:null;
 useEffect(()=>{const ticket=++gen.current,reqKey=id+'|'+store+'|'+stamp;queueMicrotask(async()=>{
  try{const r=await fetch(`/api/operations/products/${encodeURIComponent(id)}?store=${encodeURIComponent(store)}`,{cache:'no-store',headers:{'x-zao-session':stamp}});
   if(r.status===401||r.status===403){invalidateStaffView();return;}if(r.status===404){if(ticket===gen.current)setErrState({key:reqKey,kind:'NOT_FOUND'});return;}
   if(!r.ok)throw Error();const v=await r.json() as Detail;if(ticket===gen.current){setLoadedDetail({key:reqKey,data:v});setErrState(null);}}catch{if(ticket===gen.current)setErrState({key:reqKey,kind:'FAILED'});}
 });},[id,store,stamp,reload]);
 // The shown detail and its actions belong to exactly this request key (target + session); failures and target
 // changes hide them instead of leaving the previous record usable.
 const viewKey=id+'|'+store+'|'+stamp,error=errState?.key===viewKey?errState.kind:null,data=loadedDetail?.key===viewKey&&!error?loadedDetail.data:null;
 async function check(){
  const v=data?.variants.find(x=>x.id===variant);if(!v||!from||!to||!data)return;const own=++checkGen.current,key=checkKey;setBusy(true);setChecked(null);
  const family=data.model.family;
  const conditions={reservationId:crypto.randomUUID(),pickupStore:store,returnStore:store,period:{startDate:from,endDate:to,slot:from===to?'DAY':'MULTIDAY'},
   members:[{key:'check-1',product:'SINGLE',age:v.age,tier:v.tier,items:[{family,variantIds:[v.id]}]}]};
  try{const r=await fetch('/api/holds/availability',{method:'POST',cache:'no-store',headers:{'content-type':'application/json','x-zao-session':stamp},body:JSON.stringify(conditions)});
   if(r.status===401){invalidateStaffView();return;}const body=await r.json() as {result?:{result?:string}|string;error?:string};
   const verdict=typeof body.result==='string'?body.result:body.result?.result;if(own===checkGen.current)setChecked({key,result:r.ok?(verdict??'INDETERMINATE'):(body.error??'INDETERMINATE')});}
  catch{if(own===checkGen.current)setChecked({key,result:'INDETERMINATE'});}finally{if(own===checkGen.current)setBusy(false);}
 }
 const counts:(keyof Counts)[]=['availableNow','onHand','out','care','maintenance','incoming','registered'];
 const statusText=(i:Item)=>i.out?tx('out'):i.transitTo?`${tx('transit')} ${STORE_LABEL[i.transitTo]??''}`:i.uninspected?tx('care'):i.transferNotReady?tx('readying'):((L as Record<string,readonly [string,string]>)['status_'+i.status]?.[en?1:0]??i.status);
 return <StaffSessionBoundary stamp={stamp}><main className="ox">
  <p><Link href={`/staff/inventory?store=${store}`} className="sx-link">‹ {tx('back')}</Link></p>
  {error==='NOT_FOUND'&&<p className="sx-alert" role="alert">{tx('notFound')}</p>}
  {error==='FAILED'&&<p className="sx-alert" role="alert">{tx('failed')} <button type="button" className="sx-link" onClick={()=>setReload(n=>n+1)}>{tx('retry')}</button></p>}
  {!data&&!error&&<p className="sx-status" role="status">…</p>}
  {data&&<>
   <div className="ox-head"><h1>{data.model.brand} {data.model.name}</h1><span className="sx-help">{FAMILY_LABEL[data.model.family]?.[en?1:0]} · {data.model.code} · {STORE_LABEL[store]??''}</span></div>
   <div className="sx-seg ox-tabs" role="tablist">{(['variants','items','history'] as const).map(t=><button key={t} type="button" role="tab" aria-selected={tab===t} onClick={()=>setTab(t)}>{tx(t)}</button>)}</div>
   {tab==='variants'&&<div className="sx-card ox-table-wrap"><table className="sx-table"><thead><tr><th>{tx('size')}</th>{counts.map(c=><th key={c} className="ox-num">{COUNT_LABEL[c][en?1:0]}</th>)}</tr></thead>
    <tbody>{data.variants.map(v=><tr key={v.id}><td>{v.size} <small className="sx-help">{v.age==='KIDS'?(en?'Kids':'キッズ'):(en?'Adult':'大人')} · {v.tier}</small></td>{counts.map(c=><td key={c} className="ox-num">{v.counts[c]}</td>)}</tr>)}</tbody></table></div>}
   {tab==='items'&&(data.items.length?<div className="sx-card ox-table-wrap"><table className="sx-table"><thead><tr><th>ID</th><th>{tx('size')}</th><th>{tx('state')}</th><th>{tx('where')}</th>{data.model.family==='SKI_BOOT'&&<th>{tx('bsl')}</th>}</tr></thead>
    <tbody>{data.items.map(i=><tr key={i.id}><td><code>{i.id.slice(0,8).toUpperCase()}</code></td><td>{i.size}</td><td>{statusText(i)}</td><td>{STORE_LABEL[i.here]??i.here}</td>{data.model.family==='SKI_BOOT'&&<td>{i.bslMm?`${i.bslMm} mm`:'—'}</td>}</tr>)}</tbody></table></div>:<p className="sx-empty">{tx('none')}</p>)}
   {tab==='history'&&(data.history.length?<ul className="sx-inbox sx-card">{data.history.map((h,n)=><li key={n}><span><b>{h.resource} · {h.action}</b><br/><small className="sx-help">{h.reason} · {when(h.at,locale)}</small></span></li>)}</ul>:<p className="sx-empty">{tx('none')}</p>)}
   {canCheck&&!data.model.family.startsWith('WEAR')&&<section className="sx-card" style={{padding:'16px 20px',marginTop:20}} aria-labelledby="pc-title"><h2 id="pc-title" style={{marginTop:0}}>{tx('check')}</h2><p className="sx-help">{tx('checkHelp')}</p>
    <div className="ox-controls"><label className="sx-field">{tx('size')}<select aria-label={tx('size')} value={variant} onChange={e=>setVariant(e.target.value)}><option value="">—</option>{data.variants.map(v=><option key={v.id} value={v.id}>{v.size} · {v.age} · {v.tier}</option>)}</select></label>
     <label className="sx-field">{tx('from')}<input type="date" aria-label={tx('from')} value={from} onChange={e=>setFrom(e.target.value)}/></label><label className="sx-field">{tx('to')}<input type="date" aria-label={tx('to')} value={to} onChange={e=>setTo(e.target.value)}/></label>
     <button type="button" className="sx-btn sx-btn--primary" disabled={busy||!variant||!from||!to} onClick={()=>void check()}>{tx('run')}</button></div>
    {result&&<p role="status" className={result==='FEASIBLE'?'':'sx-alert'}>{result==='FEASIBLE'?tx('feasible'):result==='INSUFFICIENT'?tx('insufficient'):tx('indeterminate')}</p>}</section>}
  </>}
 </main></StaffSessionBoundary>;
}
