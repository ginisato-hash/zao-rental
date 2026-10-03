'use client';
import {useEffect,useRef,useState} from 'react';
import {useRouter} from 'next/navigation';
import Link from 'next/link';
import type {StoreId} from '../../../../packages/contracts/src/ledger';
import {StaffSessionBoundary,invalidateStaffView} from './StaffSessionBoundary';
import {BookingSearchInput} from './BookingSearchInput';
import {useOperationsRequest} from './useOperationsRequest';
import {STORE_LABEL} from './guest-format';
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
const STATE_LABEL:Record<string,string>={DRAFT:'未確定（決済前）',PAYMENT_PENDING:'決済照合待ち',PAYMENT_REVIEW:'決済要確認',CONFIRMED:'確定済み',COMPLETED:'利用完了',CANCELLED:'キャンセル済み',CONFIRMED_DEV:'確定済み',COMPLETED_DEV:'利用完了'};
// Presentational mapping only, per UX-5D authorization — an unknown future enum value must
// fail safe to 詳細確認, never be guessed from booking state/counts on the client.
const ACTION_LABEL:Record<string,string>={CHECK_PAYMENT_OR_EXCEPTION:'要確認',PREPARE_EQUIPMENT:'準備',CHECKOUT:'貸出',OUT_WAIT_RETURN:'貸出中',RECEIVE_RETURN:'返却受付',INSPECTION_PENDING:'検品待ち',WEAR_CARE_IN_PROGRESS:'ウェア整備中',COMPLETE:'完了',NEEDS_DETAIL_REVIEW:'詳細確認',NO_ACTION:'対応なし'};
const TASK_ACTION_LABEL:Record<string,string>={INSPECT:'検品',NO_ACTION:'対応なし',CARE_IN_PROGRESS:'ウェア整備中',NEEDS_DETAIL_REVIEW:'詳細確認'};
// A bookingId only ever opens the pickup/return workflow when the server's own action enum
// says there is pickup/return/detail work to do — never for COMPLETE/NO_ACTION.
const ACTIONABLE=new Set(['CHECK_PAYMENT_OR_EXCEPTION','PREPARE_EQUIPMENT','CHECKOUT','OUT_WAIT_RETURN','RECEIVE_RETURN','INSPECTION_PENDING','WEAR_CARE_IN_PROGRESS','NEEDS_DETAIL_REVIEW']);
// Presentational names for server enums (never recomputed): an unknown value fails safe to generic copy.
const SLOT_LABEL:Record<string,string>={DAY:'1日',AM:'午前',PM:'午後',MULTIDAY:'複数日'};
const FAMILY_LABEL:Record<string,string>={SKI:'スキー',SNOWBOARD:'スノーボード',SKI_BOOT:'スキーブーツ',SNOWBOARD_BOOT:'スノーボードブーツ',POLE:'ポール',WEAR_JACKET:'ウェア（上）',WEAR_PANTS:'ウェア（下）'};
const AGE_LABEL:Record<string,string>={ADULT:'大人',KIDS:'子供'};
const SEVERITY_LABEL:Record<string,string>={INFO:'情報',WARN:'注意',ERROR:'重大'};
const stateLabel=(s:string)=>STATE_LABEL[s]??'状態を確認中';
const slotLabel=(s:string)=>SLOT_LABEL[s]??'—';
const storeName=(s:string|null)=>s?STORE_LABEL[s]??'店舗':'—';
// A raw error code is never shown; the retry control is the section's own 更新 / もう一度読み込む.
const loadErrorText=(what:string,raw:string)=>/^[A-Z][A-Z0-9_]*$/.test(raw)||/fetch|network|load failed/i.test(raw)?what+'を読み込めませんでした。通信状況を確認し、もう一度読み込んでください。':raw;
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
 const bookingsReq=useOperationsRequest(stamp,'staff-home-bookings');
 const [bookings,setBookings]=useState<BookingRow[]|null>(null);
 const [activeStore,setActiveStore]=useState<StoreId>(stores[0]!);
 // Tagged by the store it was fetched for AND carrying `date` together with the rows (not a
 // separate piece of state) — see loadManifest below for why. While manifestState.store !==
 // activeStore (the moment activeStore changes, before the fresh response lands), the derived
 // values below are null — so a stale task card, or a stale business date, from the previous
 // store is never visible, not even for one render (UX-5D §"Store selection", UX5D-R02).
 const [manifestState,setManifestState]=useState<{store:StoreId|null;date:string|null;rows:ManifestRow[];cursor:string|null;hasMore:boolean}>({store:null,date:null,rows:[],cursor:null,hasMore:false});
 const [manifestBusy,setManifestBusy]=useState(false),[manifestMessage,setManifestMessage]=useState('');
 const forActiveStore=manifestState.store===activeStore?manifestState:null;
 const manifestRows=forActiveStore?forActiveStore.rows:null,manifestCursor=forActiveStore?forActiveStore.cursor:null,manifestHasMore=forActiveStore?forActiveStore.hasMore:false;
 // Business-date authority for the whole page: the Manifest server's own inventory_clock()
 // date (UX-5D), never the browser's clock. Null until the current context's own response
 // arrives (see manifestState above for why this is derived, not a separate state slice).
 const manifestDate=forActiveStore?forActiveStore.date:null;
 // UX5D-R01: useOperationsRequest's single in-flight lock silently drops a new load() call
 // while a previous one is still pending, with nothing to retry it later — a store switch
 // during a slow request could then leave the UI permanently on the old store's (correctly
 // hidden) rows until a manual refresh. Manifest reads are idempotent GETs, so instead of
 // sharing that lock, every loadManifest() call here fires its own request immediately and
 // is tagged with a monotonically increasing generation; only the response matching the
 // *current* generation is ever applied. A store switch (or any new request) always fires
 // right away, and a late/superseded response — from the old store, an old load-more page,
 // or simply an out-of-order same-store reply — is dropped rather than ever being rendered.
 const manifestGeneration=useRef(0);
 // One navigation per press: a second click while the route is opening is ignored. The guard lifts
 // itself so a cancelled or restored navigation never leaves the cards permanently disabled.
 const [opening,setOpening]=useState(false);
 function openBooking(id:string){if(opening)return;setOpening(true);window.setTimeout(()=>setOpening(false),4000);router.push('/staff/rentals?booking='+id);}
 function loadManifest(store:StoreId,cursor:string|null,append:boolean){
  const generation=++manifestGeneration.current;
  const qs='/api/operations/manifest?store='+store+'&section=all&pageSize=50'+(cursor?'&cursor='+encodeURIComponent(cursor):'');
  void (async()=>{
   setManifestBusy(true);
   try{
    const r=await fetch(qs,{cache:'no-store',headers:{'x-zao-session':stamp}});
    const value=await r.json();
    if(r.status===401||r.status===403||value.error==='SESSION_CHANGED'){invalidateStaffView();return;}
    if(generation!==manifestGeneration.current)return; // superseded — never apply a stale response
    if(!r.ok){setManifestMessage(value.error??'OPERATION_FAILED');return;}
    const data=value as ManifestResponse;
    setManifestMessage('');
    setManifestState(prev=>{const priorRows=append&&prev.store===store?prev.rows:[],seen=new Set(priorRows.map(x=>x.key));return {store,date:data.date,rows:[...priorRows,...data.rows.filter(x=>!seen.has(x.key))],cursor:data.nextCursor,hasMore:data.hasMore};});
   }catch(e){if(generation===manifestGeneration.current)setManifestMessage((e as Error).message);}
   finally{if(generation===manifestGeneration.current)setManifestBusy(false);}
  })();
 }
 // UX5D-R03: the only Refresh button a BOOKING_VIEW-only principal ever sees is this one, and
 // it depended solely on browser time before — a page left open across the server's own
 // business-date boundary would keep filtering Today against the old date until a full
 // reload. Refresh now always restarts the authoritative Manifest date read too, not only
 // /api/bookings, for every composition.
 function refreshToday(){void bookingsReq.load<BookingRow[]>('/api/bookings',setBookings);loadManifest(activeStore,null,false);}
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
    <div className="staff-card-head"><strong>{row.displayName}</strong><span className="staff-chip">{stateLabel(row.bookingState)}</span></div>
    <p>{row.period.startDate} → {row.period.endDate} · {slotLabel(row.period.slot)}</p>
    <p>{storeName(row.pickupStore)} → {storeName(row.returnStore)}{row.totalJpy!==undefined?' · '+money(row.totalJpy):''}</p>
    <p className="staff-card-action"><span>次にすること</span><strong>{label}</strong></p>
    {row.exception?.attention&&<p className="staff-card-attention">要注意{row.exception.topSeverity?'（'+(SEVERITY_LABEL[row.exception.topSeverity]??'確認')+'）':''}</p>}
    {canOpen&&<button className="staff-card-primary" disabled={opening} onClick={()=>openBooking(row.bookingId)}>{label}へ進む</button>}
   </article>;
  }
  const label=taskActionLabel(row.taskAction);
  return <article className="staff-card" key={row.key}>
   <div className="staff-card-head"><strong>{FAMILY_LABEL[row.family]??'用品'}{row.size?' '+row.size+(row.age?' / '+(AGE_LABEL[row.age]??''):''):''}</strong><span className="staff-chip staff-chip--muted">在庫タスク</span></div>
   <p>{storeName(row.sourceStore)} → {storeName(row.actualStore)}</p>
   <p className="staff-card-action"><span>次にすること</span><strong>{label}</strong></p>
  </article>;
 }
 const manifestError=manifestMessage?loadErrorText('本日の業務',manifestMessage):'';
 const manifestKind=manifestError?'error':manifestRows===null||manifestBusy?'loading':manifestRows.length?'ready':'empty';
 const manifestStatus=manifestError||(manifestRows===null?'本日の業務を読み込んでいます…':manifestBusy?'最新の状態を読み込んでいます…':'');
 return <main className="holds staff-home"><header className="staff-home-header"><div><p className="staff-secondary">ZAO Rental · スタッフ業務</p><h1>スタッフホーム</h1></div><nav><a href="/staff/logout">ログアウト</a></nav></header>
 {canBookingView&&<section aria-label="店舗・営業日" className="staff-context">
  {showManifest&&<label>対象店舗<select aria-label="対象店舗" value={activeStore} onChange={e=>setActiveStore(e.target.value as StoreId)}>{stores.map(s=><option key={s} value={s}>{storeName(s)}</option>)}</select></label>}
  <p className="staff-context-date"><span>営業日</span><strong>{manifestDate?manifestDate+'（JST）':'確認しています…'}</strong></p>
 </section>}
 {effectivePickup&&<BookingSearchInput onBooking={openBooking}/>}
 {showManifest&&<section aria-label="本日の業務" aria-busy={manifestBusy} className="staff-manifest"><div className="staff-section-head"><h2>本日の業務</h2><button disabled={manifestBusy} onClick={()=>loadManifest(activeStore,null,false)}>更新</button></div>
  <p className="staff-secondary">{storeName(activeStore)}{manifestDate?' · '+manifestDate:''} の貸出・返却・検品タスクです。実際の操作は貸出・返却の画面で行います。</p>
  <div className={'staff-state staff-state--'+manifestKind}><p role="status">{manifestStatus}</p>{manifestKind==='error'&&<button disabled={manifestBusy} onClick={()=>loadManifest(activeStore,null,false)}>もう一度読み込む</button>}</div>
  {manifestRows&&(manifestRows.length?<div className="staff-card-grid">{manifestRows.map(manifestCard)}</div>:!manifestError&&!manifestBusy&&<p className="staff-empty">現在対応が必要な項目はありません。</p>)}
  {manifestHasMore&&<button className="staff-more" aria-busy={manifestBusy} disabled={manifestBusy} onClick={()=>loadManifest(activeStore,manifestCursor,true)}>さらに読み込む</button>}
  <Link href="/staff/rentals">貸出・返却の画面を開く</Link>
 </section>}
 {canBookingView&&<section aria-label="本日の予約"><div className="staff-section-head"><h2>本日の予約</h2>
  {/* UX-5E: the Refresh button and status line must never be gated behind manifestDate itself
      -- a BOOKING_VIEW-only principal has no "本日の業務" section and therefore no other retry
      control anywhere on the page, so if the very first Manifest date read fails (401/403 is
      handled separately by StaffSessionBoundary; this covers 409/503/network failure), this
      button is the only way to recover without a full page reload. */}
  <button disabled={bookingsReq.busy||manifestBusy} onClick={refreshToday}>更新</button></div>
  <p role="status">{bookingsReq.message?loadErrorText('本日の予約',bookingsReq.message):manifestError||(manifestDate?'':'業務日付を確認しています…')}</p>
  {manifestDate&&<><p className="staff-secondary">本日が利用期間に含まれる予約（{manifestDate} JST）。完全な入出庫予定表ではありません。</p>
   {bookings&&(todays.length?<div className="staff-card-grid">{todays.map(b=><article className="staff-card" key={b.id}><div className="staff-card-head"><strong>{b.display_name??'（氏名未取得）'}</strong><span className="staff-chip">{stateLabel(b.state)}</span></div><p>{b.period!.startDate} → {b.period!.endDate} · {slotLabel(b.period!.slot)}</p><p>{storeName(b.pickup_store)} → {storeName(b.return_store)} · {money(b.total_jpy)}</p>{effectivePickup&&<button className="staff-card-primary" disabled={opening} onClick={()=>openBooking(b.id)}>貸出・受付で状態を確認</button>}</article>)}</div>:<p className="staff-empty">本日が利用期間に含まれる予約はありません。</p>)}
  </>}
 </section>}
 {canOperationsView&&<section aria-label="運用の注意事項"><h2>運用の注意事項</h2><p>本日の業務カードの「要注意」表示、または以下から詳細を確認してください。</p><Link href="/admin/ops">運用例外の画面を開く</Link></section>}
 <details className="staff-secondary-links"><summary>その他の管理機能</summary><nav>{canInventoryView&&<a href="/staff/ledger">道具の台帳</a>}{canInventoryView&&<a href="/admin/inventory">棚卸・CSV投入</a>}{canBookingView&&<a href="/staff/amendments">変更・返金依頼</a>}{canTransferView&&<a href="/staff/transfers">店舗間移動</a>}{canQuoteView&&<a href="/staff/quotes">見積</a>}{canHoldView&&<a href="/staff/holds">期間在庫・HOLD</a>}{canHoldView&&canQuoteView&&<a href="/staff/recommendations">サイズ推薦</a>}{canInventoryView&&<a href="/staff/wear">ウェアの数量貸出・返却</a>}<a href="/staff/password">パスワード変更</a>{canManageStaff&&<a href="/staff/users">スタッフ管理</a>}</nav></details>
 </main>;
}
