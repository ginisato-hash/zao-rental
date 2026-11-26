'use client';
import {useStaffLocaleOr} from './staff-locale';
import {useEffect,useRef,useState} from 'react';
import {useRouter} from 'next/navigation';
import {st,type StaffLocale} from './staff-i18n';
import {StaffSessionBoundary,invalidateStaffView} from './StaffSessionBoundary';
import {BookingSearchInput} from './BookingSearchInput';
import {AssetQrInput} from './AssetQrInput';
import {storeName} from './guest-format';
import './staff-orders.css';

type Identity={assetId:string;modelId:string;modelCode:string;modelName:string;size:string;store:string;status:string;loan:{state:string;pickupStore:string;bookingRef:string}|null};
const STATUS:Record<string,readonly [string,string]>={AVAILABLE:['利用可能','Available'],MAINTENANCE:['整備中','Maintenance'],UNVERIFIED:['未確認','Unverified'],RETIRED:['廃止','Retired']};

const L={
 order:['予約','Order'],item:['用品','Item'],help:['読み取る対象を選んでください。','Choose what you are scanning.'],
 isOrder:['これは予約のQRまたは予約IDです。「予約」タブで読み取ってください。','This is a booking QR or ID. Scan it on the Booking tab.'],
 notFound:['この用品は見つからないか、閲覧できる店舗にありません。','This item was not found or is not at a station you can see.'],failed:['照合できませんでした。','Could not look it up.'],
} as const;

/** Booqable Scan: the purpose is chosen first. A booking QR/number opens the read-only order; an item QR (the item's own
 * UUID label; a ski's two labels are one item) opens its product at its current station. Only canonical ids are
 * accepted by the existing parsers; no scanned URL is ever opened. Business actions stay on the order/product screens. */
export function StaffScan({locale:serverLocale,stamp,canOrders,canItems}:{locale:StaffLocale;stamp:string;canOrders:boolean;canItems:boolean}){
 const locale=useStaffLocaleOr(serverLocale);
 const tx=(k:keyof typeof L)=>L[k][locale==='en'?1:0],router=useRouter();
 const [mode,setMode]=useState<'order'|'item'>(canOrders?'order':'item'),[msg,setMsg]=useState(''),[identity,setIdentity]=useState<Identity|null>(null);
 // Every lookup belongs to one generation (mode + stamp + mount). Switching mode, leaving the page or starting another
 // lookup invalidates earlier ones, so a late answer can never navigate away from what the staff member chose since.
 const generation=useRef(0),alive=useRef(true);
 useEffect(()=>{alive.current=true;const g=generation;return()=>{alive.current=false;g.current++;};},[]);
 useEffect(()=>{generation.current++;},[mode,stamp]);
 const switchMode=(m:'order'|'item')=>{generation.current++;setMsg('');setIdentity(null);setMode(m);};
 function openOrder(id:string){generation.current++;router.push('/staff/orders/'+encodeURIComponent(id));}
 async function onAsset(id:string){
  const own=++generation.current,current=()=>alive.current&&generation.current===own;setMsg('');setIdentity(null);
  const r=await fetch('/api/operations/assets/'+encodeURIComponent(id),{cache:'no-store',headers:{'x-zao-session':stamp}});
  if(!current())return;
  if(r.status===401){invalidateStaffView();return;}if(r.status===404||r.status===403){
   // A booking id scanned on the Item tab is told apart from an unknown/foreign item (read-only check, never navigates).
   if(canOrders){const o=await fetch('/api/operations/orders/'+encodeURIComponent(id),{cache:'no-store',headers:{'x-zao-session':stamp}}).catch(()=>null);if(!current())return;if(o&&o.ok){setMsg('isOrder');return;}}
   setMsg('notFound');return;}if(!r.ok){setMsg('failed');throw Error();}
  const v=await r.json() as Identity;if(!current())return;
  // Show the one identified item first (id, model, size, status, station, loan); the product page is opened only by a person.
  setIdentity(v);
 }
 return <StaffSessionBoundary stamp={stamp}><main className="ox">
  <h1>{st(locale,'scanQr')}</h1>
  <div className="sx-seg ox-tabs" role="tablist">{canOrders&&<button type="button" role="tab" aria-selected={mode==='order'} onClick={()=>switchMode('order')}>{tx('order')}</button>}
   {canItems&&<button type="button" role="tab" aria-selected={mode==='item'} onClick={()=>switchMode('item')}>{tx('item')}</button>}</div>
  <div className="sx-card" style={{padding:'16px 20px'}}>
   {mode==='order'&&canOrders&&<BookingSearchInput onBooking={openOrder} stamp={stamp}/>}
   {mode==='item'&&canItems&&<AssetQrInput onAsset={onAsset} stopAfterRead/>}
  </div>
  {msg&&<p role="alert">{tx(msg as 'notFound'|'failed'|'isOrder')}</p>}
  {identity&&<section className="sx-card" aria-label={locale==='en'?'Identified item':'特定した用品'} style={{padding:'16px 20px'}}>
   <h2>{identity.modelName}</h2>
   <dl>
    <dt>{locale==='en'?'Item ID':'個体ID'}</dt><dd><code>{identity.assetId}</code></dd>
    <dt>{locale==='en'?'Model / size':'モデル / サイズ'}</dt><dd>{identity.modelCode} / {identity.size}</dd>
    <dt>{locale==='en'?'Status':'状態'}</dt><dd>{(STATUS[identity.status]??[identity.status,identity.status])[locale==='en'?1:0]}</dd>
    <dt>{locale==='en'?'Station':'店舗'}</dt><dd>{storeName(locale!=='en',identity.store)}</dd>
    <dt>{locale==='en'?'Loan':'貸出'}</dt><dd>{identity.loan?(locale==='en'?'On loan':'貸出中')+' · #'+identity.loan.bookingRef+' · '+storeName(locale!=='en',identity.loan.pickupStore):(locale==='en'?'Not on loan':'貸出なし')}</dd>
   </dl>
   {identity.loan&&<p role="status">{locale==='en'?'This item is on loan. Do not hand it out again; receive the return first.':'この用品は貸出中です。重ねて貸し出さず、先に返却を受け付けてください。'}</p>}
   <button type="button" onClick={()=>router.push('/staff/inventory/'+encodeURIComponent(identity.modelId)+'?'+new URLSearchParams({store:identity.store}).toString())}>{locale==='en'?'Open model page':'モデルページを開く'}</button>
  </section>}
 </main></StaffSessionBoundary>;
}
