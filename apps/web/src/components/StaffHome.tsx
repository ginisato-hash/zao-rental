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
type ManifestPickup={isPickupToday:boolean;equipmentRequired:boolean;equipmentPrepared:boolean;equipmentCheckedOut:boolean;noPickup:boolean;timing:string;wearRequired:boolean;wearCheckedOut:boolean};
type ManifestReturn={equipmentReturnDueToday:boolean;outCount:number;receivedHereCount:number;inspectionPendingHereCount:number;wearReturnDueToday:boolean;wearOutstandingQuantity:number;wearReturnedPendingQuantity:number;wearCleaningQuantity:number;wearTodayBlockedQuantity:number;wearUnavailableQuantity:number;wearReadyQuantity:number};
type ManifestException={attention:boolean;count:number;topSeverity:'INFO'|'WARN'|'ERROR'|null};
// Every field here is exactly what ManifestService already decided server-side; the client
// only ever maps an enum to a label below, never recomputes one from these facts.
type ManifestBookingRow={rowKind:'BOOKING_SCOPED';key:string;bookingId:string;displayName:string;period:{startDate:string;endDate:string;slot:string};pickupStore:string;returnStore:string;bookingState:string;equipmentCount:number;nextAction:string;totalJpy?:number;pickup?:ManifestPickup;return?:ManifestReturn;exception?:ManifestException};
// CUSTODY_ONLY: an actual-store operational item task, never a booking card — no bookingId,
// customer name, price or booking period/state exists on this shape at all.
type ManifestCustodyRow={rowKind:'CUSTODY_ONLY';key:string;sourceStore:string;actualStore:string;family:string;taskState:string;taskAction:string;size?:string;age?:string;requirementKey?:string};
type ManifestRow=ManifestBookingRow|ManifestCustodyRow;
type ManifestResponse={store:string;date:string;section:string;generatedAt:string;pageSize:number;nextCursor:string|null;hasMore:boolean;rows:ManifestRow[]};
const STATE_LABEL:Record<string,string>={DRAFT:'未確定（決済前）',PAYMENT_PENDING:'決済照合待ち',PAYMENT_REVIEW:'決済要確認',CONFIRMED_DEV:'確定済み',COMPLETED_DEV:'利用完了'};
// Presentational mapping only, per UX-5D authorization — an unknown future enum value must
// fail safe to 詳細確認, never be guessed from booking state/counts on the client.
const ACTION_LABEL:Record<string,string>={CHECK_PAYMENT_OR_EXCEPTION:'要確認',PREPARE_EQUIPMENT:'準備',CHECKOUT:'貸出',OUT_WAIT_RETURN:'貸出中',RECEIVE_RETURN:'返却受付',INSPECTION_PENDING:'検品待ち',WEAR_CARE_IN_PROGRESS:'ウェア整備中',COMPLETE:'完了',NEEDS_DETAIL_REVIEW:'詳細確認',NO_ACTION:'対応なし'};
const TASK_ACTION_LABEL:Record<string,string>={INSPECT:'検品',NO_ACTION:'対応なし',CARE_IN_PROGRESS:'ウェア整備中',NEEDS_DETAIL_REVIEW:'詳細確認'};
// A bookingId only ever opens the pickup/return workflow when the server's own action enum
// says there is pickup/return/detail work to do — never for COMPLETE/NO_ACTION.
const ACTIONABLE=new Set(['CHECK_PAYMENT_OR_EXCEPTION','PREPARE_EQUIPMENT','CHECKOUT','OUT_WAIT_RETURN','RECEIVE_RETURN','INSPECTION_PENDING','WEAR_CARE_IN_PROGRESS','NEEDS_DETAIL_REVIEW']);
function actionLabel(action:string){return ACTION_LABEL[action]??'詳細確認';}
function taskActionLabel(action:string){return TASK_ACTION_LABEL[action]??'詳細確認';}
function money(raw:string|number|null){const n=Number(raw);return Number.isFinite(n)?new Intl.NumberFormat('ja-JP',{style:'currency',currency:'JPY',maximumFractionDigits:0}).format(n):'—';}
type Props={stamp:string;stores:StoreId[];canBookingView:boolean;canCheckout:boolean;canReturn:boolean;canOperationsView:boolean;canInventoryView:boolean;canTransferView:boolean;canQuoteView:boolean;canHoldView:boolean;canManageStaff:boolean};
export function StaffHome(p:Props){return <StaffSessionBoundary stamp={p.stamp}><Home {...p}/></StaffSessionBoundary>;}
function Home({stamp,stores,canBookingView,canCheckout,canReturn,canOperationsView,canInventoryView,canTransferView,canQuoteView,canHoldView,canManageStaff}:Props){
 const router=useRouter();
 // /staff/rentals and the custody HTTP handler both require BOOKING_VIEW before checkout/return
 // authorization is even considered, so Staff Home must offer these surfaces only when the
 // destination route's full, composed permission set is met — never RENTAL_CHECKOUT/RENTAL_RETURN
 // alone, which a permission override can grant while BOOKING_VIEW is independently denied.
 const effectivePickup=canBookingView&&canCheckout,effectiveReturn=canBookingView&&canReturn,showManifest=effectivePickup||effectiveReturn;
 const bookingsReq=useOperationsRequest(stamp,'staff-home-bookings'),manifestReq=useOperationsRequest(stamp,'staff-home-manifest');
 const [bookings,setBookings]=useState<BookingRow[]|null>(null);
 const [activeStore,setActiveStore]=useState<StoreId>(stores[0]!);
 // Tagged by the store it was fetched for, not reset imperatively on store change: while
 // manifestState.store !== activeStore (the moment activeStore changes, before the fresh
 // response lands), the derived manifestRows below is null — so a stale task card from the
 // previous store is never visible, not even for one render (UX-5D §"Store selection").
 const [manifestState,setManifestState]=useState<{store:StoreId|null;rows:ManifestRow[];cursor:string|null;hasMore:boolean}>({store:null,rows:[],cursor:null,hasMore:false});
 const forActiveStore=manifestState.store===activeStore?manifestState:null;
 const manifestRows=forActiveStore?forActiveStore.rows:null,manifestCursor=forActiveStore?forActiveStore.cursor:null,manifestHasMore=forActiveStore?forActiveStore.hasMore:false;
 // Business-date authority for the whole page: the Manifest server's own inventory_clock()
 // date (UX-5D), never the browser's clock. Null until the first Manifest response arrives.
 const [manifestDate,setManifestDate]=useState<string|null>(null);
 function openBooking(id:string){router.push('/staff/rentals?booking='+id);}
 function loadManifest(store:StoreId,cursor:string|null,append:boolean){
  const qs='/api/operations/manifest?store='+store+'&section=all&pageSize=50'+(cursor?'&cursor='+encodeURIComponent(cursor):'');
  void manifestReq.load<ManifestResponse>(qs,data=>{
   setManifestDate(data.date);
   setManifestState(prev=>{const priorRows=append&&prev.store===store?prev.rows:[],seen=new Set(priorRows.map(r=>r.key));return {store,rows:[...priorRows,...data.rows.filter(r=>!seen.has(r.key))],cursor:data.nextCursor,hasMore:data.hasMore};});
  });
 }
 useEffect(()=>{if(canBookingView)void bookingsReq.load<BookingRow[]>('/api/bookings',setBookings);
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[canBookingView]);
 useEffect(()=>{if(canBookingView)loadManifest(activeStore,null,false);
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[canBookingView,activeStore]);
 const todays=manifestDate?(bookings??[]).filter(b=>b.period&&b.period.startDate<=manifestDate&&manifestDate<=b.period.endDate):[];
 function manifestCard(row:ManifestRow){
  if(row.rowKind==='BOOKING_SCOPED'){
   const label=actionLabel(row.nextAction),canOpen=ACTIONABLE.has(row.nextAction)&&showManifest;
   return <article className="staff-card" key={row.key}>
    <p><strong>{row.period.startDate} → {row.period.endDate}</strong> · {row.period.slot}</p>
    <p>{row.displayName}</p>
    <p>{STATE_LABEL[row.bookingState]??row.bookingState}</p>
    <p>{row.pickupStore}→{row.returnStore}{row.totalJpy!==undefined?' · '+money(row.totalJpy):''}</p>
    <p className="staff-card-action">{label}</p>
    {row.exception?.attention&&<p className="staff-card-attention">要注意{row.exception.topSeverity?'（'+row.exception.topSeverity+'）':''}</p>}
    {canOpen&&<button className="staff-card-primary" onClick={()=>openBooking(row.bookingId)}>{label}へ進む</button>}
   </article>;
  }
  const label=taskActionLabel(row.taskAction);
  return <article className="staff-card" key={row.key}>
   <p><strong>{row.family}</strong>{row.size?' '+row.size+(row.age?' / '+row.age:''):row.requirementKey?' '+row.requirementKey:''}</p>
   <p>{row.sourceStore}→{row.actualStore}</p>
   <p className="staff-card-action">{label}</p>
  </article>;
 }
 return <main className="holds staff-home"><header><p>ZAO Rental · 合成データ専用</p><h1>スタッフホーム</h1><nav><a href="/staff/logout">ログアウト</a></nav></header>
 {effectivePickup&&<BookingSearchInput onBooking={openBooking}/>}
 {canBookingView&&<section aria-label="本日の予約"><h2>本日</h2>
  {manifestDate?<><p className="staff-secondary">本日が利用期間に含まれる予約（{manifestDate} JST）。完全な入出庫予定表ではありません。</p>
   <button disabled={bookingsReq.busy} onClick={()=>void bookingsReq.load<BookingRow[]>('/api/bookings',setBookings)}>更新</button>
   <p role="status">{bookingsReq.message}</p>
   {bookings&&(todays.length?<div className="staff-card-grid">{todays.map(b=><article className="staff-card" key={b.id}><p><strong>{b.period!.startDate} → {b.period!.endDate}</strong> · {b.period!.slot}</p><p>{b.display_name??'（氏名未取得）'}</p><p>{STATE_LABEL[b.state]??b.state}</p><p>{b.pickup_store}→{b.return_store} · {money(b.total_jpy)}</p>{effectivePickup&&<button className="staff-card-primary" onClick={()=>openBooking(b.id)}>貸出・受付で状態を確認</button>}</article>)}</div>:<p>本日が利用期間に含まれる予約はありません。</p>)}
  </>:<p role="status">業務日付を確認しています…</p>}
 </section>}
 {showManifest&&<section aria-label="本日の業務"><h2>本日の業務</h2><p className="staff-secondary">対象店舗の当日の貸出・返却・検品タスクです。実際の操作は貸出・返却の画面で行います。</p>
  <label>対象店舗<select aria-label="対象店舗" value={activeStore} onChange={e=>setActiveStore(e.target.value as StoreId)}>{stores.map(s=><option key={s} value={s}>{s}</option>)}</select></label>
  <button disabled={manifestReq.busy} onClick={()=>loadManifest(activeStore,null,false)}>更新</button>
  <p role="status">{manifestReq.message}</p>
  {manifestRows&&(manifestRows.length?<div className="staff-card-grid">{manifestRows.map(manifestCard)}</div>:<p>現在対応が必要な項目はありません。</p>)}
  {manifestHasMore&&<button disabled={manifestReq.busy} onClick={()=>loadManifest(activeStore,manifestCursor,true)}>さらに読み込む</button>}
  <Link href="/staff/rentals">貸出・返却の画面を開く</Link>
 </section>}
 {canOperationsView&&<section aria-label="運用の注意事項"><h2>運用の注意事項</h2><p>本日の業務カードの「要注意」表示、または以下から詳細を確認してください。</p><Link href="/admin/ops">運用例外の画面を開く</Link></section>}
 <details className="staff-secondary-links"><summary>その他の管理機能</summary><nav>{canInventoryView&&<a href="/staff/ledger">道具の台帳</a>}{canInventoryView&&<a href="/admin/inventory">棚卸・CSV投入</a>}{canBookingView&&<a href="/staff/amendments">変更・返金依頼</a>}{canTransferView&&<a href="/staff/transfers">店舗間移動</a>}{canQuoteView&&<a href="/staff/quotes">見積</a>}{canHoldView&&<a href="/staff/holds">期間在庫・HOLD</a>}{canHoldView&&canQuoteView&&<a href="/staff/recommendations">サイズ推薦</a>}{canInventoryView&&<a href="/staff/wear">ウェアの数量貸出・返却</a>}<a href="/staff/password">パスワード変更</a>{canManageStaff&&<a href="/staff/users">スタッフ管理</a>}</nav></details>
 </main>;
}
