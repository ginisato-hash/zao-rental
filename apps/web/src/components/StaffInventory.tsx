'use client';
import {useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {useRouter,useSearchParams} from 'next/navigation';
import {st,type StaffLocale} from './staff-i18n';
import {StaffSessionBoundary,invalidateStaffView} from './StaffSessionBoundary';
import {STORE_LABEL} from './guest-format';
import './staff-orders.css';

export type Counts={registered:number;onHand:number;availableNow:number;care:number;maintenance:number;out:number;incoming:number};
type Row={id:string;code:string;name:string;brand:string;family:string;variants:number;counts:Counts};
const FAMILIES=['SKI','SKI_BOOT','SNOWBOARD','SNOWBOARD_BOOT','POLE','WEAR'] as const;
export const FAMILY_LABEL:Record<string,[string,string]>={SKI:['スキー','Skis'],SKI_BOOT:['スキーブーツ','Ski boots'],SNOWBOARD:['スノーボード','Snowboards'],SNOWBOARD_BOOT:['スノーボードブーツ','Snowboard boots'],POLE:['ポール','Poles'],WEAR:['ウェア','Wear']};
export const COUNT_LABEL:Record<keyof Counts,[string,string]>={registered:['台帳','Ledger'],onHand:['店内','On hand'],availableNow:['貸出可','Available now'],care:['点検・洗浄','Inspection / care'],maintenance:['整備','Maintenance'],out:['貸出中','Out'],incoming:['移送中','Incoming']};
const L={
 search:['商品名・ブランド・コードで検索','Search by name, brand or code'],family:['種類','Type'],all:['すべて','All'],station:['店舗','Station'],product:['商品','Product'],
 sizes:['サイズ','Sizes'],none:['該当する商品はありません。','No products match.'],failed:['読み込めませんでした。','Could not load.'],retry:['再読み込み','Retry'],
 stocktake:['棚卸・CSV','Stocktake / CSV'],ledger:['台帳の登録・編集','Register / edit ledger'],wear:['ウェア','Wear'],transfers:['移送','Transfers'],labels:['ラベル','Labels'],
 note:['「貸出可」は今この店にあり、点検済みで貸せる数です。期間の予約可否は商品詳細で確認します。','“Available now” is what is here, inspected and rentable now. Check bookability for dates on the product page.'],
} as const;

/** Booqable Inventory list: search, left filters, product table with the separated stock counts, and entry points to the
 * existing stocktake/CSV, ledger, wear, transfer and label screens. */
export function StaffInventory({locale,stamp,stores,can}:{locale:StaffLocale;stamp:string;stores:string[];can:{edit:boolean;transfer:boolean}}){
 const tx=(k:keyof typeof L)=>L[k][locale==='en'?1:0],en=locale==='en';
 const params=useSearchParams(),router=useRouter(),get=(k:string)=>params.get(k)??'';
 const store=stores.includes(get('store'))?get('store'):stores[0]??'',family=(FAMILIES as readonly string[]).includes(get('family'))?get('family'):'';
 const [search,setSearch]=useState(get('search')),[loaded,setLoaded]=useState<{key:string;rows:Row[]}|null>(null),[failedKey,setFailedKey]=useState<string|null>(null),[reload,setReload]=useState(0),gen=useRef(0);
 const query=new URLSearchParams({store,...(family?{family}:{}),...(get('search')?{search:get('search')}:{})}).toString(),rows=loaded?.key===query?loaded.rows:null;
 const set=(patch:Record<string,string>)=>{const q=new URLSearchParams(params.toString());for(const [k,v] of Object.entries(patch))if(v)q.set(k,v);else q.delete(k);router.replace('/staff/inventory?'+q.toString(),{scroll:false});};
 useEffect(()=>{if(!store)return;const ticket=++gen.current;queueMicrotask(async()=>{
  try{const r=await fetch('/api/operations/products?'+query,{cache:'no-store',headers:{'x-zao-session':stamp}});if(r.status===401||r.status===403){invalidateStaffView();return;}
   if(!r.ok)throw Error();const v=await r.json() as {rows:Row[]};if(ticket===gen.current){setLoaded({key:query,rows:v.rows});setFailedKey(null);}}catch{if(ticket===gen.current)setFailedKey(query);}
 });},[query,store,stamp,reload]);
 const cols:(keyof Counts)[]=['availableNow','onHand','out','care','maintenance','incoming','registered'];
 return <StaffSessionBoundary stamp={stamp}><main className="ox">
  <div className="ox-head"><h1>{st(locale,'inventory')}</h1>
   <form role="search" className="ox-search" onSubmit={e=>{e.preventDefault();set({search:search.trim()});}}><input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder={tx('search')} aria-label={tx('search')}/></form>
   {can.edit&&<Link className="sx-btn" href="/admin/inventory">{tx('stocktake')}</Link>}
  </div>
  <p className="sx-help">{tx('note')}</p>
  <div className="ox-layout">
   <aside className="ox-filters" aria-label={tx('family')}>
    {stores.length>1&&<fieldset><legend>{tx('station')}</legend>{stores.map(s=><label key={s} className="sx-check"><input type="radio" name="inv-store" checked={s===store} onChange={()=>set({store:s})}/>{STORE_LABEL[s]??'—'}</label>)}</fieldset>}
    <fieldset><legend>{tx('family')}</legend>
     <label className="sx-check"><input type="radio" name="inv-family" checked={!family} onChange={()=>set({family:''})}/>{tx('all')}</label>
     {FAMILIES.map(f=><label key={f} className="sx-check"><input type="radio" name="inv-family" checked={family===f} onChange={()=>set({family:f})}/>{FAMILY_LABEL[f]![en?1:0]}</label>)}</fieldset>
    <nav aria-label={st(locale,'inventory')}><ul className="sx-links">
     <li><Link href="/staff/ledger">{tx('ledger')}</Link></li><li><Link href="/staff/wear">{tx('wear')}</Link></li>
     {can.transfer&&<li><Link href="/staff/transfers">{tx('transfers')}</Link></li>}<li><Link href="/admin/assets">{tx('labels')}</Link></li></ul></nav>
   </aside>
   <section className="ox-list" aria-live="polite">
    {failedKey===query&&<p className="sx-alert" role="alert">{tx('failed')} <button type="button" className="sx-link" onClick={()=>setReload(n=>n+1)}>{tx('retry')}</button></p>}
    {rows&&!rows.length&&<p className="sx-empty">{tx('none')}</p>}
    {!rows&&failedKey!==query&&<p className="sx-status" role="status">…</p>}
    {rows&&rows.length>0&&<div className="sx-card ox-table-wrap"><table className="sx-table ox-table">
     <thead><tr><th>{tx('product')}</th><th>{tx('family')}</th><th className="ox-num">{tx('sizes')}</th>{cols.map(c=><th key={c} className="ox-num">{COUNT_LABEL[c][en?1:0]}</th>)}</tr></thead>
     <tbody>{rows.map(r=><tr key={r.id} onClick={e=>{if(!(e.target as Element).closest('a'))router.push(`/staff/inventory/${r.id}?store=${store}`);}}>
      <td><Link href={`/staff/inventory/${r.id}?store=${store}`}>{r.brand} {r.name}</Link><br/><small className="sx-help">{r.code}</small></td>
      <td>{FAMILY_LABEL[r.family]?.[en?1:0]??r.family}</td><td className="ox-num">{r.variants}</td>{cols.map(c=><td key={c} className="ox-num">{r.counts[c]}</td>)}</tr>)}</tbody></table></div>}
   </section>
  </div>
 </main></StaffSessionBoundary>;
}
