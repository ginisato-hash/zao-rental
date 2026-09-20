'use client';
import {useEffect,useState} from 'react';
import {useRouter} from 'next/navigation';
import Link from 'next/link';
import type {StoreId} from '../../../../packages/contracts/src/ledger';
import {StaffSessionBoundary} from './StaffSessionBoundary';
import {BookingSearchInput} from './BookingSearchInput';
import {useOperationsRequest} from './useOperationsRequest';
import './holds.css';
import './staff-home.css';
type BookingRow={id:string;state:string;version:number;period:{startDate:string;endDate:string;slot:string}|null;pickup_store:string|null;return_store:string|null;display_name:string|null;total_jpy:string|null;mode:string};
type Returns={batches:{id:string}[];received:{loan_item_id:string;family:string;requirement_key:string;version:number;inspection_id:string|null}[]};
type SafeException={id:string;eventType:string;correlationId:string;bookingId:string|null;assetId:string|null;store:string;severity:string;status:string;occurredAt:string;resolvedAt:string|null};
const STATE_LABEL:Record<string,string>={DRAFT:'未確定（決済前）',PAYMENT_PENDING:'決済照合待ち',PAYMENT_REVIEW:'決済要確認',CONFIRMED_DEV:'確定済み',COMPLETED_DEV:'利用完了'};
function todayJst(){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo'}).format(new Date());}
function money(raw:string|null){const n=Number(raw);return Number.isFinite(n)?new Intl.NumberFormat('ja-JP',{style:'currency',currency:'JPY',maximumFractionDigits:0}).format(n):'—';}
type Props={stamp:string;stores:StoreId[];canBookingView:boolean;canCheckout:boolean;canReturn:boolean;canOperationsView:boolean;canInventoryView:boolean;canTransferView:boolean;canQuoteView:boolean;canHoldView:boolean;canManageStaff:boolean};
export function StaffHome(p:Props){return <StaffSessionBoundary stamp={p.stamp}><Home {...p}/></StaffSessionBoundary>;}
function Home({stamp,stores,canBookingView,canCheckout,canReturn,canOperationsView,canInventoryView,canTransferView,canQuoteView,canHoldView,canManageStaff}:Props){
 const router=useRouter();
 // /staff/rentals and the custody HTTP handler both require BOOKING_VIEW before checkout/return
 // authorization is even considered, so Staff Home must offer these surfaces only when the
 // destination route's full, composed permission set is met — never RENTAL_CHECKOUT/RENTAL_RETURN
 // alone, which a permission override can grant while BOOKING_VIEW is independently denied.
 const effectivePickup=canBookingView&&canCheckout,effectiveReturn=canBookingView&&canReturn;
 const bookingsReq=useOperationsRequest(stamp,'staff-home-bookings'),returnsReq=useOperationsRequest(stamp,'staff-home-returns'),exceptionsReq=useOperationsRequest(stamp,'staff-home-exceptions');
 const [bookings,setBookings]=useState<BookingRow[]|null>(null),[returnStore,setReturnStore]=useState(stores[0]),[returns,setReturns]=useState<Returns|null>(null),[opsStore,setOpsStore]=useState(stores[0]),[exceptions,setExceptions]=useState<{exceptions:SafeException[]}|null>(null);
 function openBooking(id:string){router.push('/staff/rentals?booking='+id);}
 useEffect(()=>{if(canBookingView)void bookingsReq.load<BookingRow[]>('/api/bookings',setBookings);
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[canBookingView]);
 useEffect(()=>{if(effectiveReturn&&returnStore)void returnsReq.load<Returns>('/api/custody/returns?store='+returnStore,setReturns);
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[effectiveReturn,returnStore]);
 useEffect(()=>{if(canOperationsView&&opsStore)void exceptionsReq.load<{exceptions:SafeException[]}>('/api/operations/exceptions?store='+opsStore+'&ageHours=0&status=UNACKNOWLEDGED',setExceptions);
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[canOperationsView,opsStore]);
 const today=todayJst(),todays=(bookings??[]).filter(b=>b.period&&b.period.startDate<=today&&today<=b.period.endDate);
 const inspectionPending=(returns?.received??[]).filter(r=>!r.inspection_id).length;
 return <main className="holds staff-home"><header><p>ZAO Rental · 合成データ専用</p><h1>スタッフホーム</h1><nav><a href="/staff/logout">ログアウト</a></nav></header>
 {effectivePickup&&<BookingSearchInput onBooking={openBooking}/>}
 {canBookingView&&<section aria-label="本日の予約"><h2>本日</h2><p className="staff-secondary">本日が利用期間に含まれる予約（{today} JST）。完全な入出庫予定表ではありません。</p>
  <button disabled={bookingsReq.busy} onClick={()=>void bookingsReq.load<BookingRow[]>('/api/bookings',setBookings)}>更新</button>
  <p role="status">{bookingsReq.message}</p>
  {bookings&&(todays.length?<div className="staff-card-grid">{todays.map(b=><article className="staff-card" key={b.id}><p><strong>{b.period!.startDate} → {b.period!.endDate}</strong> · {b.period!.slot}</p><p>{b.display_name??'（氏名未取得）'}</p><p>{STATE_LABEL[b.state]??b.state}</p><p>{b.pickup_store}→{b.return_store} · {money(b.total_jpy)}</p>{effectivePickup&&<button className="staff-card-primary" onClick={()=>openBooking(b.id)}>貸出・受付で状態を確認</button>}</article>)}</div>:<p>本日が利用期間に含まれる予約はありません。</p>)}
 </section>}
 {effectivePickup&&<section aria-label="貸出・受付"><h2>貸出・受付</h2><p>予約QR・検索、または本日のカードから開くと、この画面に予約IDが引き継がれます。</p><Link href="/staff/rentals">貸出・受付の画面を開く</Link></section>}
 {effectiveReturn&&<section aria-label="返却の進行状況"><h2>返却の進行状況</h2><label>店舗<select aria-label="返却店舗" value={returnStore} onChange={e=>setReturnStore(e.target.value as StoreId)}>{stores.map(s=><option key={s} value={s}>{s}</option>)}</select></label>
  <button disabled={returnsReq.busy} onClick={()=>void returnsReq.load<Returns>('/api/custody/returns?store='+returnStore,setReturns)}>更新</button>
  <p role="status">{returnsReq.message}</p>
  {returns&&<p>保存済みの返却バッチ {returns.batches.length}件 · 受領済み・検品待ち {inspectionPending}件</p>}
  <Link href="/staff/rentals">返却の画面を開く</Link></section>}
 {canOperationsView&&<section aria-label="運用の注意事項"><h2>運用の注意事項</h2><label>範囲<select aria-label="運用の範囲" value={opsStore} onChange={e=>setOpsStore(e.target.value as StoreId)}>{stores.map(s=><option key={s} value={s}>{s}</option>)}</select></label>
  <button disabled={exceptionsReq.busy} onClick={()=>void exceptionsReq.load<{exceptions:SafeException[]}>('/api/operations/exceptions?store='+opsStore+'&ageHours=0&status=UNACKNOWLEDGED',setExceptions)}>更新</button>
  <p role="status">{exceptionsReq.message}</p>
  {exceptions&&(exceptions.exceptions.length?<ul>{exceptions.exceptions.slice(0,5).map(e=><li key={e.id}>{e.severity} · {e.eventType} · {e.store}</li>)}</ul>:<p>現在、未確認の例外はありません。</p>)}
  <Link href="/admin/ops">運用例外の画面を開く</Link></section>}
 <details className="staff-secondary-links"><summary>その他の管理機能</summary><nav>{canInventoryView&&<a href="/staff/ledger">道具の台帳</a>}{canInventoryView&&<a href="/admin/inventory">棚卸・CSV投入</a>}{canBookingView&&<a href="/staff/amendments">変更・返金依頼</a>}{canTransferView&&<a href="/staff/transfers">店舗間移動</a>}{canQuoteView&&<a href="/staff/quotes">見積</a>}{canHoldView&&<a href="/staff/holds">期間在庫・HOLD</a>}{canHoldView&&canQuoteView&&<a href="/staff/recommendations">サイズ推薦</a>}{canInventoryView&&<a href="/staff/wear">ウェアの数量貸出・返却</a>}<a href="/staff/password">パスワード変更</a>{canManageStaff&&<a href="/staff/users">スタッフ管理</a>}</nav></details>
 </main>;
}
