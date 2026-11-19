'use client';
import {useStaffLocaleOr} from './staff-locale';
import {useEffect,useRef,useState} from 'react';
import {useRouter} from 'next/navigation';
import {st,type StaffLocale} from './staff-i18n';
import {StaffSessionBoundary,invalidateStaffView} from './StaffSessionBoundary';
import {BookingSearchInput} from './BookingSearchInput';
import {AssetQrInput} from './AssetQrInput';
import './staff-orders.css';

const L={
 order:['予約','Order'],item:['用品','Item'],help:['読み取る対象を選んでください。','Choose what you are scanning.'],
 notFound:['この用品は見つからないか、閲覧できる店舗にありません。','This item was not found or is not at a station you can see.'],failed:['照合できませんでした。','Could not look it up.'],
} as const;

/** Booqable Scan: the purpose is chosen first. A booking QR/number opens the read-only order; an item QR (the item's own
 * UUID label; a ski's two labels are one item) opens its product at its current station. Only canonical ids are
 * accepted by the existing parsers; no scanned URL is ever opened. Business actions stay on the order/product screens. */
export function StaffScan({locale:serverLocale,stamp,canOrders,canItems}:{locale:StaffLocale;stamp:string;canOrders:boolean;canItems:boolean}){
 const locale=useStaffLocaleOr(serverLocale);
 const tx=(k:keyof typeof L)=>L[k][locale==='en'?1:0],router=useRouter();
 const [mode,setMode]=useState<'order'|'item'>(canOrders?'order':'item'),[msg,setMsg]=useState('');
 // Every lookup belongs to one generation (mode + stamp + mount). Switching mode, leaving the page or starting another
 // lookup invalidates earlier ones, so a late answer can never navigate away from what the staff member chose since.
 const generation=useRef(0),alive=useRef(true);
 useEffect(()=>{alive.current=true;const g=generation;return()=>{alive.current=false;g.current++;};},[]);
 useEffect(()=>{generation.current++;},[mode,stamp]);
 const switchMode=(m:'order'|'item')=>{generation.current++;setMsg('');setMode(m);};
 function openOrder(id:string){generation.current++;router.push('/staff/orders/'+encodeURIComponent(id));}
 async function onAsset(id:string){
  const own=++generation.current,current=()=>alive.current&&generation.current===own;
  const r=await fetch('/api/operations/assets/'+encodeURIComponent(id),{cache:'no-store',headers:{'x-zao-session':stamp}});
  if(!current())return;
  if(r.status===401){invalidateStaffView();return;}if(r.status===404||r.status===403){setMsg('notFound');return;}if(!r.ok){setMsg('failed');throw Error();}
  const v=await r.json() as {modelId:string;store:string};if(!current())return;
  router.push('/staff/inventory/'+encodeURIComponent(v.modelId)+'?'+new URLSearchParams({store:v.store}).toString());
 }
 return <StaffSessionBoundary stamp={stamp}><main className="ox">
  <h1>{st(locale,'scan')}</h1><p className="sx-help">{tx('help')}</p>
  <div className="sx-seg ox-tabs" role="tablist">{canOrders&&<button type="button" role="tab" aria-selected={mode==='order'} onClick={()=>switchMode('order')}>{tx('order')}</button>}
   {canItems&&<button type="button" role="tab" aria-selected={mode==='item'} onClick={()=>switchMode('item')}>{tx('item')}</button>}</div>
  <div className="sx-card" style={{padding:'16px 20px'}}>
   {mode==='order'&&canOrders&&<BookingSearchInput onBooking={openOrder}/>}
   {mode==='item'&&canItems&&<AssetQrInput onAsset={onAsset}/>}
  </div>
  {msg&&<p role="alert">{tx(msg as 'notFound'|'failed')}</p>}
 </main></StaffSessionBoundary>;
}
