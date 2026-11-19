'use client';
import {useState} from 'react';
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
export function StaffScan({locale,stamp,canOrders,canItems}:{locale:StaffLocale;stamp:string;canOrders:boolean;canItems:boolean}){
 const tx=(k:keyof typeof L)=>L[k][locale==='en'?1:0],router=useRouter();
 const [mode,setMode]=useState<'order'|'item'>(canOrders?'order':'item'),[msg,setMsg]=useState('');
 async function onAsset(id:string){
  const r=await fetch('/api/operations/assets/'+encodeURIComponent(id),{cache:'no-store',headers:{'x-zao-session':stamp}});
  if(r.status===401){invalidateStaffView();return;}if(r.status===404||r.status===403){setMsg(tx('notFound'));return;}if(!r.ok){setMsg(tx('failed'));throw Error();}
  const v=await r.json() as {modelId:string;store:string};router.push(`/staff/inventory/${v.modelId}?store=${v.store}`);
 }
 return <StaffSessionBoundary stamp={stamp}><main className="ox">
  <h1>{st(locale,'scan')}</h1><p className="sx-help">{tx('help')}</p>
  <div className="sx-seg ox-tabs" role="tablist">{canOrders&&<button type="button" role="tab" aria-selected={mode==='order'} onClick={()=>setMode('order')}>{tx('order')}</button>}
   {canItems&&<button type="button" role="tab" aria-selected={mode==='item'} onClick={()=>setMode('item')}>{tx('item')}</button>}</div>
  <div className="sx-card" style={{padding:'16px 20px'}}>
   {mode==='order'&&canOrders&&<BookingSearchInput onBooking={id=>router.push('/staff/orders/'+id)}/>}
   {mode==='item'&&canItems&&<AssetQrInput onAsset={onAsset}/>}
  </div>
  {msg&&<p role="alert">{msg}</p>}
 </main></StaffSessionBoundary>;
}
