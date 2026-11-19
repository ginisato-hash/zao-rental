'use client';
import {useStaffLocaleOr} from './staff-locale';
import {useEffect,useRef,useState} from 'react';
import {invalidateStaffView} from './StaffSessionBoundary';

type Customer={key:string;name:string|null;email:string|null;bookings:number;lastStart:string|null;legacy:boolean};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const L={
 title:['お客様','Customer'],newCustomer:['新しいお客様として登録','New customer'],existing:['既存のお客様','Existing customer'],
 search:['名前・メールで検索','Search by name or email'],find:['検索','Search'],none:['該当するお客様はいません。','No customers match.'],
 failed:['検索できませんでした。','Could not search.'],choose:['このお客様にする','Use this customer'],selected:['選択中','Selected'],
 help:['既存のお客様を選ぶと、この注文はそのお客様の履歴に入ります。連絡先は次の画面でお客様ご本人に入力・確認していただきます。','Choosing an existing customer adds this order to their history. Contact details are entered and confirmed by the customer on the next screens.'],
 fixed:['予約作成後はお客様を変更できません。','The customer cannot be changed after the booking is created.'],legacy:['旧予約（未リンク）は選べません。顧客画面でリンクしてください。','Unlinked legacy bookings cannot be chosen; link them on the Customers page first.'],
} as const;

/** Booqable New order "Customer" panel. The choice is explicit (new customer, or one existing profile the staff member
 * can see) and is stored on the server draft; the server re-checks visibility and the booking transaction checks again.
 * Search results are bound to query + stamp; a late answer from an earlier search is ignored. */
export function StaffOrderCustomer({locale:serverLocale,stamp,selected,locked,busy,onSelect}:{locale:'ja'|'en';stamp:string;selected:string|null;locked:boolean;busy:boolean;onSelect:(customerId:string|null)=>void}){
 const locale=useStaffLocaleOr(serverLocale);
 const tx=(k:keyof typeof L)=>L[k][locale==='en'?1:0];
 const [search,setSearch]=useState(''),[query,setQuery]=useState<string|null>(null),[result,setResult]=useState<{key:string;rows:Customer[]}|null>(null),[failedKey,setFailedKey]=useState<string|null>(null),gen=useRef(0);
 const viewKey=query===null?null:query+'|'+stamp,rows=viewKey&&result?.key===viewKey&&failedKey!==viewKey?result.rows:null;
 useEffect(()=>{if(query===null)return;const ticket=++gen.current,key=query+'|'+stamp;queueMicrotask(async()=>{
  try{const r=await fetch('/api/operations/customers?'+new URLSearchParams({search:query,pageSize:'10'}),{cache:'no-store',headers:{'x-zao-session':stamp}});
   if(r.status===401){invalidateStaffView();return;}if(!r.ok)throw Error();const v=await r.json() as {rows:Customer[]};if(ticket===gen.current){setResult({key,rows:v.rows});setFailedKey(null);}}
  catch{if(ticket===gen.current)setFailedKey(key);}
 });},[query,stamp]);
 const chosen=rows?.find(r=>r.key===selected)??null;
 return <section className="guest-panel sx-card" aria-labelledby="staff-order-customer" style={{padding:'16px 20px',marginBottom:16}}>
  <h2 id="staff-order-customer">{tx('title')}</h2>
  <p role="status">{tx('selected')}: {selected?(chosen?`${chosen.name??'—'} ${chosen.email?'· '+chosen.email:''}`:tx('existing')):tx('newCustomer')}</p>
  {locked?<p className="sx-help">{tx('fixed')}</p>:<>
   <p className="sx-help">{tx('help')}</p>
   {selected&&<button type="button" className="guest-secondary-button" disabled={busy} onClick={()=>onSelect(null)}>{tx('newCustomer')}</button>}
   <form role="search" onSubmit={e=>{e.preventDefault();const q=search.trim();if(q)setQuery(q);}}>
    <input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder={tx('search')} aria-label={tx('search')}/> <button type="submit" className="guest-secondary-button" disabled={!search.trim()}>{tx('find')}</button>
   </form>
   {viewKey&&failedKey===viewKey&&<p role="alert">{tx('failed')}</p>}
   {rows&&!rows.length&&<p>{tx('none')}</p>}
   {rows&&rows.length>0&&<ul className="sx-links">{rows.map(r=><li key={r.key}>
    {r.name??'—'}{r.email?` · ${r.email}`:''} ({r.bookings})
    {r.legacy||!UUID.test(r.key)?<small className="sx-help"> {tx('legacy')}</small>:r.key===selected?<strong> {tx('selected')}</strong>:<button type="button" className="sx-link" disabled={busy} onClick={()=>onSelect(r.key)}>{tx('choose')}</button>}
   </li>)}</ul>}
  </>}
 </section>;
}
