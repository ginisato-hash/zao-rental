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
import {statusLabel,statusTone,fmtDate,fmtYen} from './order-labels';
import './staff-orders.css';

type Customer={key:string;name:string|null;email:string|null;bookings:number;lastStart:string|null;legacy:boolean};
type Order={id:string;ref:string;status:string;startDate:string;endDate:string;pickupStore:string;totalJpy:number|null};
type Detail={key:string;legacy:boolean;name:string|null;email:string|null;orders:Order[]};
const L={
 search:['氏名・メールで検索','Search by name or email'],name:['顧客','Customer'],email:['メール','Email'],bookings:['予約数','Orders'],last:['直近の受取','Latest pickup'],
 none:['該当する顧客はありません。','No customers match.'],failed:['読み込めませんでした。','Could not load.'],retry:['再読み込み','Retry'],prev:['前へ','Previous'],next:['次へ','Next'],
 legacy:['導入前の予約','Before customer records'],back:['顧客一覧','Customers'],history:['予約履歴','Order history'],notFound:['顧客が見つからないか、閲覧権限がありません。','Customer not found or not visible to you.'],
 linkTitle:['同じ顧客に関連付ける','Link to the same customer'],linkHelp:['この予約を、同じ方の別の予約と同じ顧客として扱います。取り消しはできません。名前やメールが同じでも自動では関連付けません。','Treat this order as the same person as another order. This cannot be undone. Matching names or emails are never linked automatically.'],
 pick:['関連付け先','Link to'],review:['内容を確認','Review'],thisOrder:['対象の予約','This order'],outcome:['結果','Result'],cancel:['取消','Cancel'],
 outcomeText:['この予約は関連付け先と同じ顧客として扱われます。取り消せません。','This order will be treated as the same customer as the target. This cannot be undone.'],confirm:['関連付ける','Link'],done:['関連付けました。','Linked.'],conflict:['この予約はすでに関連付けられています。画面を更新してください。','This order is already linked. Refresh the page.'],
} as const;

export function StaffCustomers({locale:serverLocale,stamp}:{locale:StaffLocale;stamp:string}){
 const locale=useStaffLocaleOr(serverLocale);
 const tx=(k:keyof typeof L)=>L[k][locale==='en'?1:0],en=locale==='en';
 const params=useSearchParams(),router=useRouter(),get=(k:string)=>params.get(k)??'';
 const page=Math.max(1,Number(get('page'))||1);
 const [search,setSearch]=useState(get('search')),[loaded,setLoaded]=useState<{key:string;data:{total:number;pageSize:number;rows:Customer[]}}|null>(null),[failedKey,setFailedKey]=useState<string|null>(null),[reload,setReload]=useState(0),gen=useRef(0);
 const query=new URLSearchParams({page:String(page),...(get('search')?{search:get('search')}:{})}).toString(),viewKey=query+'|'+stamp,data=loaded?.key===viewKey&&failedKey!==viewKey?loaded.data:null;
 const set=(patch:Record<string,string>)=>{const q=new URLSearchParams(params.toString());for(const [k,v] of Object.entries(patch))if(v)q.set(k,v);else q.delete(k);router.replace('/staff/customers?'+q.toString(),{scroll:false});};
 useEffect(()=>{const ticket=++gen.current;queueMicrotask(async()=>{
  try{const r=await fetch('/api/operations/customers?'+query,{cache:'no-store',headers:{'x-zao-session':stamp}});if(r.status===401||r.status===403){invalidateStaffView();return;}
   if(!r.ok)throw Error();const v=await r.json();if(ticket===gen.current){setLoaded({key:query+'|'+stamp,data:v});setFailedKey(null);}}catch{if(ticket===gen.current)setFailedKey(query+'|'+stamp);}
 });},[query,stamp,reload]);
 const pages=data?Math.max(1,Math.ceil(data.total/data.pageSize)):1;
 const csv=useCsvDownload(viewKey+'|'+locale,stamp),csvQuery=new URLSearchParams({...(get('search')?{search:get('search')}:{}),format:'csv',lang:locale});
 return <StaffSessionBoundary stamp={stamp}><main className="ox">
  <div className="ox-head"><h1>{st(locale,'customers')}</h1>
   <form role="search" className="ox-search" onSubmit={e=>{e.preventDefault();set({search:search.trim(),page:''});}}><input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder={tx('search')} aria-label={tx('search')}/></form>
   {data&&<CsvButton csv={csv} url={'/api/operations/customers?'+csvQuery} filename="customers.csv"/>}</div>
  {failedKey===viewKey&&<p className="sx-alert" role="alert">{tx('failed')} <button type="button" className="sx-link" onClick={()=>setReload(n=>n+1)}>{tx('retry')}</button></p>}
  {data&&!data.rows.length&&<p className="sx-empty">{tx('none')}</p>}
  {!data&&failedKey!==viewKey&&<p className="sx-status" role="status">…</p>}
  {data&&data.rows.length>0&&<div className="sx-card ox-table-wrap"><table className="sx-table ox-table"><thead><tr><th>{tx('name')}</th><th>{tx('email')}</th><th className="ox-num">{tx('bookings')}</th><th>{tx('last')}</th></tr></thead>
   <tbody>{data.rows.map(c=><tr key={c.key} onClick={e=>{if(!(e.target as Element).closest('a'))router.push('/staff/customers/'+encodeURIComponent(c.key));}}>
    <td><Link href={'/staff/customers/'+encodeURIComponent(c.key)}>{c.name??'—'}</Link>{c.legacy&&<><br/><small className="sx-help">{tx('legacy')}</small></>}</td>
    <td>{c.email??'—'}</td><td className="ox-num">{c.bookings}</td><td>{c.lastStart?fmtDate(locale,c.lastStart):'—'}</td></tr>)}</tbody></table></div>}
  {data&&data.total>0&&<nav className="ox-pager" aria-label={locale==='en'?'Pages':'ページ'}><span className="sx-help">{en?`${data.total} customers`:`${data.total}件`}</span>
   <button type="button" className="sx-btn" disabled={page<=1} onClick={()=>set({page:String(page-1)})}>{tx('prev')}</button><button type="button" className="sx-btn" disabled={page>=pages} onClick={()=>set({page:String(page+1)})}>{tx('next')}</button></nav>}
 </main></StaffSessionBoundary>;
}

export function StaffCustomer({locale:serverLocale,stamp,customerKey,canLink}:{locale:StaffLocale;stamp:string;customerKey:string;canLink:boolean}){
 const locale=useStaffLocaleOr(serverLocale);
 const tx=(k:keyof typeof L)=>L[k][locale==='en'?1:0],router=useRouter();
 const [loadedDetail,setLoadedDetail]=useState<{key:string;data:Detail}|null>(null),[errState,setErrState]=useState<{key:string;kind:'NOT_FOUND'|'FAILED'}|null>(null),[reload,setReload]=useState(0),gen=useRef(0);
 const [q,setQ]=useState(''),[cands,setCands]=useState<{key:string;rows:Customer[]}|null>(null),[target,setTarget]=useState(''),[review,setReview]=useState<string|null>(null),[msg,setMsg]=useState(''),[busy,setBusy]=useState(false),requestKey=useRef<string|null>(null);
 useEffect(()=>{const ticket=++gen.current,reqKey=customerKey+'|'+stamp;queueMicrotask(async()=>{
  try{const r=await fetch('/api/operations/customers/'+encodeURIComponent(customerKey),{cache:'no-store',headers:{'x-zao-session':stamp}});
   if(r.status===401){invalidateStaffView();return;}if(r.status===404||r.status===403){if(ticket===gen.current)setErrState({key:reqKey,kind:'NOT_FOUND'});return;}
   if(!r.ok)throw Error();const v=await r.json() as Detail;if(ticket===gen.current){setLoadedDetail({key:reqKey,data:v});setErrState(null);}}catch{if(ticket===gen.current)setErrState({key:reqKey,kind:'FAILED'});}
 });},[customerKey,stamp,reload]);
 const viewKey=customerKey+'|'+stamp,error=errState?.key===viewKey?errState.kind:null,data=loadedDetail?.key===viewKey&&!error?loadedDetail.data:null;
 // Link candidates and the pending confirmation belong to this customer page, session and chosen target only.
 const candidates=cands?.key===viewKey?cands.rows:[],chosen=candidates.find(c=>c.key===target)??null,confirming=review===viewKey+'|'+target&&!!chosen&&!!data;
 async function find(){const r=await fetch('/api/operations/customers?'+new URLSearchParams({search:q,pageSize:'10'}),{cache:'no-store',headers:{'x-zao-session':stamp}}).catch(()=>null);
  const key=viewKey;if(r?.ok)setCands({key,rows:((await r.json()).rows as Customer[]).filter(c=>c.key!==data?.key)});}
 async function link(){if(!data||!target||busy||!confirming)return;setBusy(true);setMsg('');requestKey.current??=crypto.randomUUID();
  try{const r=await fetch('/api/operations/customers/link',{method:'POST',cache:'no-store',headers:{'content-type':'application/json','x-zao-session':stamp},body:JSON.stringify({requestKey:requestKey.current,input:{bookingId:data.orders[0]!.id,target}})});
   if(r.status===401){invalidateStaffView();return;}if(r.status===409){setMsg('conflict');requestKey.current=null;return;}if(!r.ok)throw Error();
   const v=await r.json() as {customerId:string};setMsg('done');requestKey.current=null;router.push('/staff/customers/'+encodeURIComponent(v.customerId));}
  catch{setMsg('failed');}finally{setBusy(false);}}
 return <StaffSessionBoundary stamp={stamp}><main className="ox">
  <p><Link href="/staff/customers" className="sx-link">‹ {tx('back')}</Link></p>
  {error==='NOT_FOUND'&&<p className="sx-alert" role="alert">{tx('notFound')}</p>}
  {error==='FAILED'&&<p className="sx-alert" role="alert">{tx('failed')} <button type="button" className="sx-link" onClick={()=>setReload(n=>n+1)}>{tx('retry')}</button></p>}
  {data&&<>
   <div className="ox-head"><h1>{data.name??'—'}</h1>{data.legacy&&<span className="sx-help">{tx('legacy')}</span>}</div>
   <p className="sx-help">{data.email??''}</p>
   <h2>{tx('history')}</h2>
   <div className="sx-card ox-table-wrap"><table className="sx-table ox-table"><tbody>{data.orders.map(o=><tr key={o.id}><td><Link href={'/staff/orders/'+o.id}>#{o.ref}</Link></td>
    <td><span className={'ox-status ox-status--'+statusTone(o.status)}>{statusLabel(locale,o.status)}</span></td><td>{fmtDate(locale,o.startDate)} – {fmtDate(locale,o.endDate)}</td><td>{STORE_LABEL[o.pickupStore]??'—'}</td><td className="ox-num">{fmtYen(locale,o.totalJpy)}</td></tr>)}</tbody></table></div>
   {canLink&&data.legacy&&<section className="sx-card" style={{padding:'16px 20px',marginTop:20}} aria-labelledby="cl-title"><h2 id="cl-title" style={{marginTop:0}}>{tx('linkTitle')}</h2><p className="sx-help">{tx('linkHelp')}</p>
    <div className="ox-controls"><input type="search" aria-label={tx('search')} placeholder={tx('search')} value={q} onChange={e=>setQ(e.target.value)}/><button type="button" className="sx-btn" onClick={()=>void find()}>{tx('search')}</button></div>
    {candidates.length>0&&<div className="ox-controls"><select aria-label={tx('pick')} value={target} onChange={e=>{setTarget(e.target.value);setReview(null);requestKey.current=null;}}><option value="">—</option>{candidates.map(c=><option key={c.key} value={c.key}>{c.name??'—'} · {c.email??''} · {c.bookings}</option>)}</select>
     <button type="button" className="sx-btn" disabled={!chosen||busy} onClick={()=>setReview(viewKey+'|'+target)}>{tx('review')}</button></div>}
    {confirming&&chosen&&data&&<div className="sx-card" role="group" aria-label={tx('review')} style={{padding:'12px 16px',marginTop:12}}>
     <dl className="od-dl"><dt>{tx('thisOrder')}</dt><dd>#{data.orders[0]!.ref} · {data.name??'—'}</dd><dt>{tx('pick')}</dt><dd>{chosen.name??'—'} · {chosen.email??''} · {chosen.bookings} {tx('bookings')}</dd><dt>{tx('outcome')}</dt><dd>{tx('outcomeText')}</dd></dl>
     <div className="ox-controls"><button type="button" className="sx-btn sx-btn--primary" disabled={busy} onClick={()=>void link()}>{tx('confirm')}</button><button type="button" className="sx-btn" disabled={busy} onClick={()=>{setReview(null);requestKey.current=null;}}>{tx('cancel')}</button></div></div>}
    {msg&&<p role="status">{tx(msg as 'conflict'|'done'|'failed')}</p>}</section>}
  </>}
 </main></StaffSessionBoundary>;
}
