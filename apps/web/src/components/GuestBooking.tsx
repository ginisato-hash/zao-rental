 'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {SaveBookingAccess} from './BookingAccess';
import {BookingCancellation,type CancellationStatus} from './BookingCancellation';
import {SquareCardPayment} from './SquareCardPayment';
import {GuestRecovery} from './GuestRecovery';
import {GuestAvatarPreview} from './GuestAvatarPreview';
import type {Direction} from '../../../../packages/contracts/src/recommendation';
import type {Locale} from '../../../../packages/core/src/content/public-pages';
import './public.css';
import './guest.css';
type Member={key:string;sport:string;heightCm:number|null;footCm:number|null;adultAtStart:boolean;tier:string;ski:{weightKg:number;ageAtStart:number;level:string}|null;poleSize:string|null;premiumModel:string|null;jacketSize:string|null;pantsSize:string|null;wearSport:string|null};
type Input={pickupStore:string;returnStore:string;period:{startDate:string;endDate:string;slot:string};members:Member[]};
type Options={models:{key:string;name:string;season:string;sport:string;lengths:string[]}[];sizes:{key:string;label:string;family:string;age:string;tier:string}[]};
type Contact={displayName:string;email:string;termsAccepted:boolean};
type Draft={checkout?:{applicationId:string;locations:Record<string,string>}|null;id:string;revision:number;input:Input|null;locked:boolean;priceReviewRequired:boolean;selection:{directions:Record<string,string>;wantAdvance:boolean;contact?:Contact}|null;preview:{members:{key:string;reason:string|null;price:Record<string,unknown>|null;priceError:string|null;candidates:Record<string,{lengthCm:number}|null>}[]}|null;hold:{state:string;expiresAt:string}|null;estimate:{subtotalJpy:number;bundleDiscountJpy?:number;advanceDiscountJpy:number;totalJpy:number}|null;reviewHash:string|null;quote:{snapshot:{totalJpy:number};snapshotSha256:string;validity:string}|null;booking:{cancellation:CancellationStatus|null;id:string;state:string;qr:string|null;qrImage:string|null;payments:{state:string}[];priceSnapshot:{totalJpy:number}}|null;simulation?:boolean};
let starting:Promise<unknown>|null=null;
// CH-04 previously cached the whole Input (including body measurements) under this key,
// unscoped to any context/draft id. UIR-01: a cookie expiry or explicit logout creates a
// fresh guest context (POST /context returns 201, not 401) and open() only overwrites input
// when the new draft already has one, so the old context's body data reappeared and could be
// resubmitted under the new context. UIR-02: JSON.parse with no shape check could also hand
// render code a malformed object. Full read/write of this cache is removed; only a one-time
// discard of any value a pre-fix session already wrote remains.
const INPUT_STORAGE_KEY='zao-guest-draft-input';
function clearStoredInput(){try{sessionStorage.removeItem(INPUT_STORAGE_KEY);}catch{}}
async function request(path:string,body?:unknown){const r=await fetch('/api/guest'+path,{cache:'no-store',method:body===undefined?'GET':'POST',headers:{'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});const data=await r.json();if(!r.ok)throw Object.assign(new Error(data.error),{status:r.status});return data;}
function blank(n:number):Member{return {key:'person-'+n,sport:'SKI',heightCm:170,footCm:25.5,adultAtStart:true,tier:'REGULAR',ski:{weightKg:60,ageAtStart:30,level:'BEGINNER'},poleSize:null,premiumModel:null,jacketSize:null,pantsSize:null,wearSport:null};}
function blankInput():Input{return {pickupStore:'MOUNTAIN_BASE',returnStore:'MOUNTAIN_BASE',period:{startDate:'',endDate:'',slot:'DAY'},members:[blank(1)]};}
function periodValid(i:Input):boolean{return Boolean(i.period.startDate&&i.period.endDate&&i.period.endDate>=i.period.startDate);}
// UIR-03/UIR-04: the step reachable via history (or an in-app back/forward action) must
// reflect what is actually safe to show right now, not just which fields happen to exist on
// the last-fetched draft. Once a draft is locked (a HOLD/payment attempt already submitted, or
// a confirmed booking), every editable field is disabled regardless of step -- there is no way
// for a local edit to diverge from it any more, and hiding it behind a lower step would revive
// nothing editable while incorrectly blocking a legitimate view of an already-confirmed review
// (the server also does not always echo `input` back once locked, which alone would otherwise
// wrongly cap this at step 1). Before locking, two independent conditions must hold before any
// server-derived step (preview/selection/review) can be reached again: the currently displayed
// input must still match what the server actually has on file for this draft (inputSynced), and
// once a selection exists, the displayed candidate directions/advance choice must still match it
// (selectionSynced). Diverge either one -- e.g. editing equipment after already reaching the
// final review, then using Back/Forward -- and only the local, always-safe step 1 form (or
// step 0) remains reachable until the user explicitly resubmits through the normal
// save/preview/selection calls, which is the only path allowed to restore a higher step.
function computeMaxStep(d:Draft|null,input:Input,directions:Record<string,string>,advance:boolean):number{
 if(!d)return 0;
 if(d.locked)return 3;
 let m=periodValid(input)?1:0;
 const inputSynced=Boolean(d.input)&&JSON.stringify(input)===JSON.stringify(d.input);
 if(!inputSynced)return m;
 if(d.preview)m=2;
 const selectionSynced=!d.selection||(JSON.stringify(directions)===JSON.stringify(d.selection.directions)&&advance===d.selection.wantAdvance);
 if(!selectionSynced)return m;
 if(d.selection||d.booking||d.hold)m=3;
 return m;
}
const GUEST_ERROR_COPY:Record<string,{ja:string;en:string}>={STALE_DRAFT:{ja:'この予約はほかの操作で更新されました。最新の内容を読み込み直してください。',en:'This draft changed elsewhere. Reload the latest saved result.'},SELECTION_INVALID:{ja:'選択したサイズの組み合わせが無効になりました。候補をもう一度選び直してください。',en:'The selected size combination is no longer valid. Choose your sizes again.'},CATALOG_SELECTION_INVALID:{ja:'選択した用品が現在の在庫条件に合いません。用品とサイズをやり直してください。',en:'The selected item no longer matches the current catalogue. Redo the equipment and size step.'},MODEL_RELEASE_CHANGED:{ja:'選択したモデルが変更されました。モデルを選び直してください。',en:'The selected model has changed. Choose a model again.'},PRICE_CHANGED_REVIEW_REQUIRED:{ja:'料金が更新されました。下の新しい見積を確認してください。',en:'The price changed. Review the new estimate below.'},HOLD_OR_QUOTE_RECONCILIATION_REQUIRED:{ja:'在庫の仮押さえ状態が変わりました。もう一度照合してください。',en:'The stock hold state changed. Reconcile again.'},STALE_PRICE_REVIEW:{ja:'確認待ちの見積が古くなりました。最新の内容を読み込み直してください。',en:'The pending price review is out of date. Reload the latest saved result.'},PRICE_REVIEW_REQUIRED:{ja:'進める前に新しい見積の確認が必要です。',en:'Review the updated estimate before continuing.'},PRICE_REVIEW_UNAVAILABLE:{ja:'見積の確認情報を取得できませんでした。最新の内容を読み込み直してください。',en:'The estimate details could not be loaded. Reload the latest saved result.'},DRAFT_ALREADY_SELECTED:{ja:'この内容はすでに確定済みです。最新の内容を読み込み直してください。',en:'This selection is already confirmed. Reload the latest saved result.'},INVALID_PERIOD:{ja:'利用開始日・終了日を確認してください（終了日は開始日以降、最大10日）。',en:'Check the start and end dates (end date on or after start, up to 10 days).'},INVALID_GROUP:{ja:'利用人数を確認してください。',en:'Check the number of people in the group.'},INVALID_LOCALE:{ja:'表示言語の設定に問題がありました。ページを再読み込みしてください。',en:'There was a problem with the language setting. Reload the page.'},MODEL_NOT_RELEASED:{ja:'選択したモデルは現在公開されていません。別のモデルを選んでください。',en:'The selected model is not currently available. Choose another model.'},SELECTION_REQUIRED:{ja:'全員分のサイズを選択してください。',en:'Choose a size for every person before continuing.'},INPUT_REQUIRED:{ja:'必須項目が未入力です。内容を確認してください。',en:'Some required details are missing. Check the form and try again.'},IDEMPOTENCY_MISMATCH:{ja:'直前の操作と内容が一致しませんでした。もう一度やり直してください。',en:'The request did not match the previous attempt. Please try again.'},FORBIDDEN:{ja:'この操作を行う権限がありません。',en:'You do not have permission to do this.'},NO_PAYMENT_ATTEMPT:{ja:'まだ決済の照合対象がありません。',en:'There is nothing to reconcile yet.'},PAYMENT_NOT_CONNECTED_CHARGE_DISABLED:{ja:'この環境では決済接続が未設定です。',en:'Payment is not connected in this environment.'},PAYMENT_READ_UNCONNECTED:{ja:'この環境では決済状態を確認できません。',en:'Payment status cannot be checked in this environment.'},GUEST_UNCONNECTED:{ja:'この環境では予約機能が未接続です。',en:'Booking is not connected in this environment.'},GUEST_PREVIEW_UNCONNECTED:{ja:'この環境では候補確認が未接続です。',en:'Preview is not connected in this environment.'},CONTRACT_VERSION_REQUIRED:{ja:'条件の再確認が必要です。用品とサイズをもう一度選び直してください。',en:'Your selection needs to be reconfirmed. Redo the equipment and size step.'},DUPLICATE_MEMBER:{ja:'利用者の情報が重複しています。人数と入力内容を確認してください。',en:'Duplicate person details were found. Check the group size and each person’s details.'},INVALID_EQUIPMENT_PROFILE:{ja:'身長・足サイズなどの入力を確認してください。',en:'Check the height, foot size and related details you entered.'},INVALID_RECOMMENDATION_INPUT:{ja:'用品の選択内容に問題があります。用品とサイズをやり直してください。',en:'There is a problem with the equipment selection. Redo the equipment and size step.'},INVALID_WEAR_PROFILE:{ja:'ウェアのサイズ選択を確認してください。',en:'Check the wear size you selected.'},MODEL_PROMISE_REQUIRED:{ja:'Premiumではモデルの選択が必要です。',en:'Choose a model to continue with Premium.'},POLE_VARIANT_MISMATCH:{ja:'ポールのサイズ選択を確認してください。',en:'Check the pole size you selected.'},PRODUCT_NOT_OFFERED:{ja:'選択した組み合わせは現在ご利用いただけません。用品とサイズをやり直してください。',en:'That combination is not currently available. Redo the equipment and size step.'},SIZE_NOT_APPLICABLE:{ja:'その年齢区分・プランではそのサイズを選べません。',en:'That size is not available for the chosen age category or plan.'},SKI_PROFILE_OR_AGE_MISMATCH:{ja:'年齢区分とスキー情報の入力を確認してください。',en:'Check that the age category and ski details match.'},UNNECESSARY_SNOWBOARD_INPUT:{ja:'スノーボード選択時はスキー用の項目を入力しないでください。',en:'Clear the ski-only fields when snowboard is selected.'},WEAR_VARIANT_MISMATCH:{ja:'ウェアのサイズ選択を確認してください。',en:'Check the wear size you selected.'},ANALYTICS_SHAPE:{ja:'内部データの形式でエラーが発生しました。もう一度お試しください。',en:'An internal data error occurred. Please try again.'},IMMUTABLE_RESERVATION:{ja:'この予約は確定済みのため変更できません。',en:'This booking is already confirmed and can no longer be changed.'},INCOMPLETE_SET:{ja:'選択した構成が揃っていません。用品とサイズを確認してください。',en:'The selected set is incomplete. Check the equipment and size step.'},INCOMPLETE_WEAR_SET:{ja:'ウェアの構成が揃っていません。ジャケット・パンツのサイズを確認してください。',en:'The wear set is incomplete. Check the jacket and pants sizes.'},INVALID_CLOCK:{ja:'日時の取得でエラーが発生しました。もう一度お試しください。',en:'There was a problem reading the current time. Please try again.'},INVALID_CONDITIONS:{ja:'利用日と全構成品のサイズを選択してください。',en:'Choose the rental dates and a size for every item.'},INVALID_CONTINUATION_CONTEXT:{ja:'続きの操作を行うための情報が正しくありません。最新の内容を読み込み直してください。',en:'The context for continuing is invalid. Reload the latest saved result.'},INVALID_DATE:{ja:'有効な日付を指定してください。',en:'Enter a valid date.'},INVALID_PRODUCT_CLASS:{ja:'選択した用品の種類に問題があります。用品とサイズをやり直してください。',en:'There is a problem with the selected equipment type. Redo the equipment and size step.'},MODEL_PROMISE_MISMATCH:{ja:'選択したモデルが条件と一致しません。モデルを選び直してください。',en:'The selected model no longer matches. Choose a model again.'},PERIOD_ENDED:{ja:'指定した利用期間はすでに終了しています。日程を選び直してください。',en:'The selected rental period has already ended. Choose different dates.'},WEAR_EXPLICIT_SIZE_REQUIRED:{ja:'ウェアはサイズを明示的に選択してください。',en:'Choose an explicit size for the wear item.'}};
const BOOKING_STATE_COPY:Record<string,{ja:string;en:string}>={CONFIRMED:{ja:'予約が確認されました',en:'Booking confirmed'},CANCELLED:{ja:'キャンセル済み',en:'Cancelled'},DRAFT:{ja:'未確定',en:'Not yet submitted'},PAYMENT_PENDING:{ja:'決済照合待ち',en:'Waiting on payment'},PAYMENT_REVIEW:{ja:'決済確認が必要です',en:'Payment needs review'},CONFIRMED_DEV:{ja:'予約が確認されました',en:'Booking confirmed'},COMPLETED:{ja:'ご利用が完了しました',en:'Rental completed'},COMPLETED_DEV:{ja:'ご利用が完了しました',en:'Rental completed'}};
const PAYMENT_STATE_COPY:Record<string,{ja:string;en:string}>={SUBMITTING:{ja:'送信中',en:'Submitting'},UNKNOWN:{ja:'確認できませんでした。しばらくしてからもう一度照合してください',en:'Could not be confirmed yet. Reconcile again shortly.'},PENDING:{ja:'処理中',en:'Pending'},COMPLETED:{ja:'完了',en:'Completed'},FAILED:{ja:'失敗しました',en:'Failed'},REVIEW:{ja:'確認が必要です',en:'Needs review'}};
// UX-3A: HOLD/quote validity are internal reconciliation states. Map every known value to a
// customer-facing sentence; an unmapped value still falls back to customer-safe generic text
// rather than ever rendering the raw enum.
const HOLD_STATE_COPY:Record<string,{ja:string;en:string}>={ACTIVE:{ja:'確保中',en:'Reserved'},RELEASED:{ja:'解放されました',en:'Released'},CANCELLED:{ja:'取り消されました',en:'Cancelled'},EXPIRED:{ja:'期限切れです',en:'Expired'}};
const holdStateText=(ja:boolean,s:string)=>{const c=HOLD_STATE_COPY[s];return c?(ja?c.ja:c.en):(ja?'状態を確認中です':'Status is being checked');};
const QUOTE_VALIDITY_COPY:Record<string,{ja:string;en:string}>={VALID_PRIVATE_ESTIMATE:{ja:'有効です',en:'Valid'},EXPIRED:{ja:'期限切れのため再確認が必要です',en:'Expired — please reload and review'},HOLD_EXPIRED_OR_RELEASED:{ja:'在庫確保が終了したため再確認が必要です',en:'The stock hold ended — please reload and review'},HOLD_CONDITIONS_MISMATCH:{ja:'内容が変更されたため再確認が必要です',en:'Conditions changed — please reload and review'},HOLD_RECONCILIATION_REQUIRED:{ja:'決済状況の確認待ちです',en:'Waiting on a payment reconciliation'}};
const quoteValidityText=(ja:boolean,s:string)=>{const c=QUOTE_VALIDITY_COPY[s];return c?(ja?c.ja:c.en):(ja?'状態を確認中です':'Status is being checked');};
const SLOT_OPTIONS:[string,string][]=[['DAY','1日 / Day'],['AM','午前 / Morning'],['PM','午後 / Afternoon'],['MULTIDAY','2日以上 / Multi-day']];
const STORE_LABEL:Record<string,string>={MOUNTAIN_BASE:'Mountain Base',ONSEN_BASE:'Onsen Base'};
export function GuestBooking({locale}:{locale:Locale}){const ja=locale==='ja',t=(j:string,e:string)=>ja?j:e;
 const [draft,setDraft]=useState<Draft|null>(null),[options,setOptions]=useState<Options>({models:[],sizes:[]}),[input,setInput]=useState<Input>(blankInput),[step,setStep]=useState(0),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[directions,setDirections]=useState<Record<string,string>>({}),[accepted,setAccepted]=useState(false),[advance,setAdvance]=useState(false),[contact,setContact]=useState<Contact>({displayName:'',email:'',termsAccepted:false}),[simulation,setSimulation]=useState(false);
 const alive=useRef(true),ticket=useRef(0),inFlight=useRef(false);
 // CH-04A: the displayed step is reflected in browser history so Back/Forward move one
 // step instead of leaving the app. Only the step number (an allowlisted, non-secret
 // integer) ever goes into history.state -- never input, contact, tokens or booking data.
 // initializedRef distinguishes the initial mount's resume (which replaces the starting
 // entry, however far along a saved draft already is) from later genuine forward progress
 // within this session (which pushes a new entry).
 const initializedRef=useRef(false),draftRef=useRef<Draft|null>(null);
 // UIR-04: a step NUMBER is not a real-history ENTRY COUNT -- a direct visit/restore (the
 // mount effect below, or open()'s own initial replaceState) can jump the step value without
 // creating any new real browser entries. historyStackRef/historyPosRef instead track only
 // the real entries this mounted instance actually knows for certain, so backToStep never
 // guesses history.go()'s distance from arithmetic on step numbers alone.
 const historyStackRef=useRef<{step:number}[]>([{step:0}]),historyPosRef=useRef(0);
 // Set only when this exact mount landed on an entry that already carried one of our own
 // step numbers (a hard reload mid-navigation, not just a soft popstate, still preserves an
 // entry's own state -- observed live: history.go() across more than one entry can fall back
 // to a full document reload here). null means a genuine fresh visit, where open() below
 // should adopt the server's own maxForDraft outright to resume progress from a prior
 // session; a number means open() must instead clamp THAT requested step, never silently
 // overriding it with maxForDraft the way a fresh visit does.
 const initialRequestedStepRef=useRef<number|null>(null);
 // UX-3A: the unsaved-changes warning must reflect an edit the visitor actually made on the
 // step they are currently viewing, not just "current input differs from last saved input" --
 // that condition is also true for one render immediately after pushStep(1) advances past a
 // freshly-filled step 0, before anything on step 1 itself has been touched. touched is
 // cleared on every step change (a navigation, not an edit) and set only inside the handlers
 // that actually change a field's value.
 const [touched,setTouched]=useState(false);
 const liveRef=useRef({input,directions,advance});
 // CH-04B (still OPEN/DESIGN_GATE): there is no reload-safe autosave for un-submitted
 // input -- reviving the browser-side cache UIR-01/02 removed is explicitly out of scope.
 // What this batch adds instead: an accurate signal for whether the current step 0-1 input
 // differs from the last value the server actually accepted, used to warn before an in-app
 // link or a browser tab close would silently discard it. savedInputJson is null until the
 // server has confirmed an input at least once; it never stores anything beyond what the
 // server already has (in memory only, not persisted), so it isn't a new persistence surface.
 const [savedInputJson,setSavedInputJson]=useState<string|null>(null);
 // UX-4A: UI-only presentation state -- which person's card is expanded when the group has
 // more than one person. Never read by computeMaxStep/contractSynced and never sent to the
 // server; the member data contract is unchanged.
 const [activePerson,setActivePerson]=useState(0);
 const activePersonIdx=Math.min(activePerson,input.members.length-1);
 // UX3R-01: keep the authoritative "would a nav/close actually lose data" signal completely
 // separate from step-touched presentation state. unsavedInput alone drives guardNav/beforeunload
 // and must stay true across a step transition -- entering dates on step 0 and immediately
 // advancing to step 1 without saving is still real unsaved input. touched (reset on every step
 // change) only controls whether the visible banner is shown; it must never gate the actual
 // protection below.
 const unsavedInput=step<2&&JSON.stringify(input)!==(savedInputJson??JSON.stringify(blankInput()));
 const showUnsavedHint=touched&&unsavedInput;
 // UIR-03 defense in depth: even if some other path ever let step 3 render with data that no
 // longer matches what the server actually holds for this draft, checkout must still refuse
 // to submit the old server contract as if it reflected newer, unsaved local choices.
 const contractSynced=!draft||((!draft.input||JSON.stringify(input)===JSON.stringify(draft.input))&&(!draft.selection||(JSON.stringify(directions)===JSON.stringify(draft.selection.directions)&&advance===draft.selection.wantAdvance)));
 useEffect(()=>{draftRef.current=draft;liveRef.current={input,directions,advance};});
 useEffect(()=>{
  // Any mount that was not specifically caused by a Back/Forward action (Navigation Timing's
  // own 'back_forward' type -- covers both a real gesture and our own history.go() falling
  // back to a hard reload, observed live in this app) must start a brand new baseline and let
  // open() below adopt the server's own maxForDraft outright, EVEN IF history.state already
  // holds one of our old {step} objects. This covers two different cases that would otherwise
  // wrongly clamp to a stale step: a genuine fresh top-level visit ('navigate' -- a typed URL
  // or this harness's page.goto, where a browser can reuse/coalesce a joint session-history
  // entry across same-URL visits and leave a stale value behind here), and a same-URL
  // location.reload() after a context-changing action such as GuestRecovery's own recovery
  // flow ('reload' -- the freshly recovered server draft, not the pre-recovery step, must win).
  const navType=(performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming|undefined)?.type;
  const existing=history.state as {step?:number}|null;
  if(navType==='back_forward'&&typeof existing?.step==='number'){
   // Reusing an entry from before this mount (e.g. remounted after a reload landing
   // mid-history). Only this one entry is known for certain; it becomes our sole baseline
   // rather than assuming any further real entries exist behind it.
   initialRequestedStepRef.current=existing.step;
   historyStackRef.current=[{step:existing.step}];historyPosRef.current=0;
  }else{
   history.replaceState({step:0},'');historyStackRef.current=[{step:0}];historyPosRef.current=0;
  }
  const onPopState=(e:PopStateEvent)=>{
   const requested=typeof (e.state as {step?:number}|null)?.step==='number'?(e.state as {step:number}).step:0;
   const {input:li,directions:ld,advance:la}=liveRef.current;
   const target=Math.min(Math.max(requested,0),computeMaxStep(draftRef.current,li,ld,la));
   // Whatever real entry we just landed on becomes the new sole known baseline: after a
   // native Back/Forward we no longer assume anything about entries further back really
   // being ours, so a later backToStep falls back to a safe push instead of guessing.
   historyStackRef.current=[{step:target}];historyPosRef.current=0;
   setTouched(false);setStep(target);
  };
  window.addEventListener('popstate',onPopState);
  return()=>window.removeEventListener('popstate',onPopState);
 },[]);
 const open=useCallback((d:Draft)=>{setDraft(d);if(d.input){setInput(d.input);setSavedInputJson(JSON.stringify(d.input));}if(d.selection){setDirections(d.selection.directions);setAdvance(d.selection.wantAdvance);if(d.selection.contact)setContact(d.selection.contact);}
  // Server state is authoritative, history is not: maxForDraft is the step this draft's own
  // data actually supports right now, computed against what local state will become right
  // after the setInput/setDirections/setAdvance calls above (the server's own field when the
  // draft provides one, otherwise whatever was already displayed) -- never a stale guess.
  // The step UI never renders before `draft` is set (see the {draft&&...} gate below), so
  // there is nothing to preserve from before this call. A genuine fresh visit (no requested
  // step recorded on this entry) always adopts maxForDraft outright, e.g. correctly resuming
  // progress from a prior session, or resetting to step 0 if this context has since been
  // invalidated (cookies cleared) and no longer supports any step. But if this mount landed
  // on an entry that already requested a specific step -- including via the hard-reload
  // fallback a multi-entry history.go() was observed to trigger in this app -- that request
  // is clamped against maxForDraft rather than silently overridden by it, so Back/Forward
  // (or an in-app back action) still reaches the step it actually asked for whenever the
  // server data still supports it.
  const {input:li,directions:ld,advance:la}=liveRef.current;
  const maxForDraft=computeMaxStep(d,d.input??li,d.selection?d.selection.directions:ld,d.selection?d.selection.wantAdvance:la);
  if(!initializedRef.current){
   const requested=initialRequestedStepRef.current;
   const target=requested===null?maxForDraft:Math.min(Math.max(requested,0),maxForDraft);
   history.replaceState({step:target},'');historyStackRef.current=[{step:target}];historyPosRef.current=0;setTouched(false);setStep(target);
  }else if(maxForDraft>historyStackRef.current[historyPosRef.current]!.step){
   history.pushState({step:maxForDraft},'');historyStackRef.current=historyStackRef.current.slice(0,historyPosRef.current+1).concat({step:maxForDraft});historyPosRef.current++;setTouched(false);setStep(maxForDraft);
  }
  initializedRef.current=true;
  if(d.simulation!==undefined){setSimulation(d.simulation);if(d.simulation&&!d.selection?.contact)setContact(c=>c.displayName||c.email?c:{...c,displayName:'SYNTHETIC Guest',email:'synthetic-guest@example.invalid'});}
 },[]);
 // Forward: only pushes a new entry when this is genuinely new progress (n beyond anything
 // already recorded in our own known stack). Back: always pushes a fresh entry too, rather
 // than retracing an existing one with history.go() -- go() was observed, live, to sometimes
 // fall back to a full reload that Navigation Timing reports as a plain 'reload', identical to
 // an unrelated same-URL location.reload() elsewhere in this app (GuestRecovery's own), making
 // the two impossible to tell apart from here; a go()-triggered instance of that fallback loses
 // the very step it was trying to retrace. Always pushing avoids relying on go() at all: no
 // guessed distance, no ambiguous reload to recover from, and the browser's own Back button
 // afterwards still correctly undoes exactly this step change, same as any other push here.
 function pushStep(n:number){if(n>historyStackRef.current[historyPosRef.current]!.step){history.pushState({step:n},'');historyStackRef.current=historyStackRef.current.slice(0,historyPosRef.current+1).concat({step:n});historyPosRef.current++;}setTouched(false);setStep(n);}
 function backToStep(n:number){history.pushState({step:n},'');historyStackRef.current=historyStackRef.current.slice(0,historyPosRef.current+1).concat({step:n});historyPosRef.current++;setTouched(false);setStep(n);}
 function editInput(fn:(i:Input)=>Input){setTouched(true);setInput(fn);}
 useEffect(()=>{alive.current=true;const n=++ticket.current;if(!starting)starting=request('/context',{}).finally(()=>{starting=null;});starting.then(async()=>{const [d,o]=await Promise.all([request('/draft'),request('/options')]);if(alive.current&&n===ticket.current){open(d);setOptions(o);}}).catch(e=>{if(alive.current&&n===ticket.current)setMessage(e.message);});return()=>{alive.current=false;};},[open]);
 useEffect(()=>{clearStoredInput();},[]);
 // Auxiliary only, per CH-04B's scope: beforeunload is not guaranteed to fire (notably on
 // mobile), so this is a best-effort browser-native prompt for a real tab close/reload, not
 // a substitute for the in-app link guard below, which is the actual mechanism for the
 // cases this app controls (locale switch, closing the booking context).
 useEffect(()=>{const onBeforeUnload=(e:BeforeUnloadEvent)=>{if(unsavedInput){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',onBeforeUnload);return()=>window.removeEventListener('beforeunload',onBeforeUnload);},[unsavedInput]);
 function guardNav(e:React.MouseEvent){if(unsavedInput&&!window.confirm(t('保存されていない入力があります。移動すると内容が失われます。続けますか？','You have unsaved input. Leaving now will lose it. Continue?')))e.preventDefault();}
 async function run(fn:()=>Promise<Draft>){if(inFlight.current)return;inFlight.current=true;setBusy(true);const n=++ticket.current;try{const d=await fn();if(alive.current&&n===ticket.current){open(d);setMessage('');}}catch(e){if(alive.current&&n===ticket.current){if((e as {status?:number}).status===401){setDraft(null);setInput(blankInput());setDirections({});clearStoredInput();setSavedInputJson(null);}setMessage((e as Error).message);}}finally{inFlight.current=false;if(alive.current)setBusy(false);}}
 function member(n:number,patch:Partial<Member>){editInput(i=>({...i,members:i.members.map((m,j)=>j===n?{...m,...patch}:m)}));}
 function sport(n:number,s:string){member(n,{sport:s,tier:s==='WEAR'?'STANDARD':'REGULAR',ski:s==='SKI'?{weightKg:60,ageAtStart:30,level:'BEGINNER'}:null,heightCm:s==='WEAR'?null:170,footCm:s==='WEAR'?null:25.5,poleSize:null,premiumModel:null,jacketSize:null,pantsSize:null,wearSport:s==='WEAR'?'SKI':null});}
 const sizes=(m:Member,f:string)=>options.sizes.filter(v=>v.family===f&&v.age===(m.adultAtStart?'ADULT':'KIDS')&&v.tier===(f.startsWith('WEAR_')?'STANDARD':m.tier));
 const money=(n:unknown)=>typeof n==='number'?new Intl.NumberFormat(locale==='ja'?'ja-JP':'en-JP',{style:'currency',currency:'JPY',maximumFractionDigits:0}).format(n):'—';const errorText=(code:string)=>{const c=GUEST_ERROR_COPY[code];if(c)return ja?c.ja:c.en;return ja?'処理でエラーが発生しました。もう一度お試しください。':'Something went wrong. Please try again.';};const bookingStateText=(s:string)=>{const c=BOOKING_STATE_COPY[s];return c?(ja?c.ja:c.en):s;};const paymentStateText=(s:string)=>{const c=PAYMENT_STATE_COPY[s];return c?(ja?c.ja:c.en):s;};const jstTime=(iso:string)=>{const d=new Date(iso);if(Number.isNaN(d.getTime()))return iso;return new Intl.DateTimeFormat(locale==='ja'?'ja-JP':'en-JP',{timeZone:'Asia/Tokyo',dateStyle:'medium',timeStyle:'short'}).format(d)+' JST';};const storeLabel=(v:string)=>STORE_LABEL[v]??v;const slotLabel=(v:string)=>SLOT_OPTIONS.find(([k])=>k===v)?.[1]??v;const sportLabel=(s:string)=>s==='SKI'?t('スキーセット','Ski set'):s==='SNOWBOARD'?t('スノーボードセット','Snowboard set'):s==='WEAR'?t('ウェアのみ','Wear only'):s;const tierLabel=(tr:string)=>tr==='REGULAR'?'Regular':tr==='PREMIUM'?'Premium':tr==='STANDARD'?t('スタンダード','Standard'):tr;
 return <div className="public-shell" lang={locale}><header className="public-header"><Link className="wordmark" href={'/'+locale} onClick={guardNav}>ZAO<span>RENTAL</span></Link><nav aria-label={t('メインナビゲーション','Main navigation')}><Link href={'/'+locale+'/rental'} onClick={guardNav}>{t('プランを見る','View plans')}</Link><Link href={'/'+(ja?'en':'ja')+'/book'} hrefLang={ja?'en':'ja'} onClick={guardNav}>{t('EN','日本語')}</Link></nav></header><main className="guest-main"><p className="public-kicker">YOUR SNOW DAY</p><h1>{t('みんなのレンタルを選ぶ','Plan the group’s rental')}</h1>{!draft?.checkout&&<p>{t('開発プレビューです。架空の情報だけを使用してください。実決済・本番予約は行いません。','Development preview: use synthetic details only. No real payment or production booking.')}</p>}<ol className="guest-steps" aria-label={t('予約の流れ','Booking steps')}>{[t('日程','Dates'),t('用品とサイズ','Equipment'),t('候補を選ぶ','Choose sizes'),t('全員分を確認','Review group')].map((s,n)=><li key={s} aria-current={step===n?'step':undefined}>{n+1}. {s}</li>)}</ol>
 {showUnsavedHint&&<p role="status">{t('保存されていない変更があります。移動すると失われます。','You have unsaved changes. Leaving now will lose them.')}</p>}
 {message&&<p role="alert" className="guest-alert">{errorText(message)}</p>}
 {!draft&&<p role="status">{t('予約用の画面を開いています…','Opening your booking workspace…')}</p>}
 {draft&&<>{step<3&&<fieldset disabled={busy||draft.locked}><legend>{step===0?t('日程・店舗','Dates & stores'):step===1?t('一人ずつ選択','Choose for each person'):t('保存済みの条件','Saved conditions')}</legend>
 {step===0&&<><div className="guest-grid"><label>{t('利用開始日','Start date')}<input type="date" value={input.period.startDate} onChange={e=>editInput(i=>({...i,period:{...i.period,startDate:e.target.value,endDate:i.period.endDate&&i.period.endDate>=e.target.value?i.period.endDate:e.target.value}}))}/></label><label>{t('利用終了日','End date')}<input type="date" min={input.period.startDate||undefined} value={input.period.endDate} onChange={e=>editInput(i=>({...i,period:{...i.period,endDate:e.target.value}}))}/></label><label>{t('利用枠','Rental slot')}<select aria-label={t('利用枠','Rental slot')} value={input.period.slot} onChange={e=>editInput(i=>({...i,period:{...i.period,slot:e.target.value}}))}>{SLOT_OPTIONS.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>{(['pickupStore','returnStore'] as const).map(f=><label key={f}>{f==='pickupStore'?t('受取店舗','Pickup store'):t('返却店舗','Return store')}<select aria-label={f==='pickupStore'?t('受取店舗','Pickup store'):t('返却店舗','Return store')} value={input[f]} onChange={e=>editInput(i=>({...i,[f]:e.target.value}))}>{Object.entries(STORE_LABEL).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>)}</div><button disabled={!input.period.startDate||!input.period.endDate||input.period.endDate<input.period.startDate} onClick={()=>pushStep(1)}>{t('用品を選ぶ','Choose equipment')}</button></>}
 {step===1&&<><div className="guest-compare"><article><h2>Regular</h2><p>{t('サイズ・年齢区分・クラスを選びます。モデルは確約しません。','Choose size, age category and class. No specific model promise.')}</p></article><article><h2>Premium</h2><p>{t('モデル・シーズン・長さを選択条件として保存します。','Your selected model, season and length become the promise.')}</p></article></div><label>{t('利用人数','Group size')}<input type="number" min={1} max={20} value={input.members.length} onChange={e=>{const n=Number(e.target.value);if(Number.isInteger(n)&&n>0&&n<=20)editInput(i=>({...i,members:Array.from({length:n},(_,j)=>i.members[j]??blank(j+1))}));}}/></label>
 {input.members.map((m,n)=>{const card=<article className="guest-person" key={m.key}><h2>{t('利用者','Person')} {n+1}</h2><div className="guest-grid"><label>{t('用品','Equipment')} {n+1}<select aria-label={t('用品','Equipment')+' '+(n+1)} value={m.sport} onChange={e=>sport(n,e.target.value)}><option value="SKI">{t('スキーセット','Ski set')}</option><option value="SNOWBOARD">{t('スノーボードセット','Snowboard set')}</option><option value="WEAR">{t('ウェアのみ','Wear only')}</option></select></label><label>{t('年齢区分','Age category')} {n+1}<select aria-label={t('年齢区分','Age category')+' '+(n+1)} value={m.adultAtStart?'ADULT':'KIDS'} onChange={e=>member(n,{adultAtStart:e.target.value==='ADULT',tier:m.sport==='WEAR'?'STANDARD':'REGULAR',poleSize:null,premiumModel:null,jacketSize:null,pantsSize:null,...(m.ski?{ski:{...m.ski,ageAtStart:e.target.value==='ADULT'?30:10}}:{})})}><option value="ADULT">{t('大人','Adult')}</option><option value="KIDS">{t('子供','Child')}</option></select></label>
 {m.sport!=='WEAR'&&<><label>{t('プラン','Plan')} {n+1}<select aria-label={t('プラン','Plan')+' '+(n+1)} value={m.tier} onChange={e=>member(n,{tier:e.target.value,premiumModel:null,poleSize:null})}><option value="REGULAR">Regular</option>{m.adultAtStart&&<option value="PREMIUM">Premium</option>}</select></label><label>{t('身長cm','Height cm')} {n+1}<input type="number" value={m.heightCm??''} onChange={e=>member(n,{heightCm:Number(e.target.value)})}/></label><label>{t('足サイズcm','Foot size cm')} {n+1}<input type="number" step="0.5" value={m.footCm??''} onChange={e=>member(n,{footCm:Number(e.target.value)})}/></label></>}
 {m.ski&&<><label>{t('体重kg','Weight kg')} {n+1}<input type="number" value={m.ski.weightKg} onChange={e=>member(n,{ski:{...m.ski!,weightKg:Number(e.target.value)}})}/></label><label>{t('開始日の年齢','Age at start')} {n+1}<input type="number" value={m.ski.ageAtStart} onChange={e=>member(n,{ski:{...m.ski!,ageAtStart:Number(e.target.value)}})}/></label><label>{t('スキーレベル','Ski level')} {n+1}<select aria-label={t('スキーレベル','Ski level')+' '+(n+1)} value={m.ski.level} onChange={e=>member(n,{ski:{...m.ski!,level:e.target.value}})}><option value="BEGINNER">{t('初級','Beginner')}</option><option value="INTERMEDIATE">{t('中級','Intermediate')}</option><option value="ADVANCED">{t('上級','Advanced')}</option></select></label><label>{t('ポールのサイズ','Pole size')} {n+1}<select aria-label={t('ポールのサイズ','Pole size')+' '+(n+1)} value={m.poleSize??''} onChange={e=>member(n,{poleSize:e.target.value||null})}><option value="">{t('選択してください','Choose a size')}</option>{sizes(m,'POLE').map(v=><option key={v.key} value={v.key}>{v.label}</option>)}</select></label></>}
 {m.tier==='PREMIUM'&&<label>{t('モデルとシーズン','Model and season')} {n+1}<select aria-label={t('モデルとシーズン','Model and season')+' '+(n+1)} value={m.premiumModel??''} onChange={e=>member(n,{premiumModel:e.target.value||null})}><option value="">{t('確認済みモデルから選択','Choose a verified model')}</option>{options.models.filter(p=>p.sport===m.sport).map(p=><option value={p.key} key={p.key}>{p.name} · {p.season} · {p.lengths.join(', ')}</option>)}</select>{!options.models.some(p=>p.sport===m.sport)&&<small>{t('公開確認済みモデルはまだありません。','No models are approved for this preview yet.')}</small>}</label>}
 {m.sport==='WEAR'&&<label>{t('ウェアの用途','Wear sport')} {n+1}<select aria-label={t('ウェアの用途','Wear sport')+' '+(n+1)} value={m.wearSport??'SKI'} onChange={e=>member(n,{wearSport:e.target.value})}><option value="SKI">Ski</option><option value="SNOWBOARD">Snowboard</option></select></label>}
 {(['jacketSize','pantsSize'] as const).map((f,i)=><label key={f}>{i===0?t('ジャケットサイズ','Jacket size'):t('パンツサイズ','Pants size')} {n+1}<select aria-label={(i===0?t('ジャケットサイズ','Jacket size'):t('パンツサイズ','Pants size'))+' '+(n+1)} value={m[f]??''} onChange={e=>member(n,{[f]:e.target.value||null})}><option value="">{t('選択なし','Not selected')}</option>{sizes(m,i===0?'WEAR_JACKET':'WEAR_PANTS').map(v=><option value={v.key} key={v.key}>{v.label}</option>)}</select></label>)}</div></article>;return input.members.length>1?<details className="guest-person-toggle" key={m.key} open={n===activePersonIdx} onToggle={()=>setActivePerson(n)}><summary>{t('利用者','Person')} {n+1} · {sportLabel(m.sport)}</summary>{card}</details>:card;})}
 <p>{t('候補確認ではまだ在庫を確保しません。','Reviewing candidates does not hold stock yet.')}</p><button onClick={()=>backToStep(0)}>{t('日程に戻る','Back to dates')}</button><button aria-busy={busy} disabled={input.members.some(m=>m.sport==='SKI'&&!m.poleSize)} onClick={()=>void run(async()=>{const saved=await request('/draft',{draftId:draft.id,expectedRevision:draft.revision,input});return request('/preview',{draftId:saved.id,expectedRevision:saved.revision});})}>{t('候補と参考料金を確認','Review sizes and estimates')}</button>{input.members.some(m=>m.sport==='SKI'&&!m.poleSize)&&<p>{t('スキーを選んだ方はポールのサイズも選んでください。','Choose a pole size for everyone renting a ski set.')}</p>}</>}
 {step===2&&draft.preview&&<><p>{t('候補は目安です。長さを明示的に選択してください。','Suggestions are a guide. Choose a length explicitly.')}</p>{draft.preview.members.map((m,n)=><article className="guest-person" key={m.key}><h2>{t('利用者','Person')} {n+1}</h2><p>{t('参考料金','Estimate')}: {money(m.price?.totalJpy)}</p><div className="guest-candidates">{(['SHORTER','RECOMMENDED','LONGER'] as const).map(d=>{const c=m.candidates[d];return c&&<label className={'guest-candidate'+(d==='RECOMMENDED'?' guest-candidate--primary':'')} key={d}><input type="radio" name={m.key} checked={directions[m.key]===d} onChange={()=>setDirections(x=>({...x,[m.key]:d}))}/><span className="guest-candidate-label">{t(d==='RECOMMENDED'?'おすすめ':d==='SHORTER'?'短め':'長め',d==='RECOMMENDED'?'Recommended':d==='SHORTER'?'Shorter':'Longer')}</span><span className="guest-candidate-value">{c.lengthCm?c.lengthCm+' cm':t('上下サイズ確認','Wear sizes confirmed')}</span></label>;})}</div>{m.reason&&<p>{m.reason}</p>}<GuestAvatarPreview key={draft.id+':'+draft.revision+':'+m.key} scope={{draftId:draft.id,revision:draft.revision,memberKey:m.key}} direction={(directions[m.key]??'RECOMMENDED') as Direction} locale={locale}/></article>)}<label className="guest-choice"><input type="checkbox" checked={accepted} onChange={e=>setAccepted(e.target.checked)}/>{t('全員のサイズ・モデル条件・ウェア構成を確認した','I confirm each person’s size, model promise and wear selections')}</label><label className="guest-choice"><input type="checkbox" checked={advance} onChange={e=>setAdvance(e.target.checked)}/>{t('事前決済5％調整の見込みを確認する','Evaluate potential 5% advance-payment eligibility')}</label><button onClick={()=>backToStep(1)}>{t('用品とサイズに戻る','Back to equipment')}</button><button aria-busy={busy} disabled={!accepted||draft.preview.members.some(m=>!directions[m.key])} onClick={()=>void run(()=>request('/selection',{draftId:draft.id,expectedRevision:draft.revision,directions,wantAdvance:advance,couponCode:null,acceptedModelPolicy:true}))}>{t('全員分の最終確認へ','Review the whole group')}</button></>}
 {step===2&&!draft.preview&&<p>{t('候補の内容を読み込めませんでした。前の画面からやり直してください。','The candidates could not be loaded. Go back and try again.')}</p>}
 </fieldset>}
 {step===3&&<section className="guest-review" aria-label={t('全員分の確認','Group review')}><h2>{t('最終確認','Final review')}</h2>
 {draft.booking&&<div role="status" className="guest-result"><h3>{bookingStateText(draft.booking.state)}</h3><p>{money(draft.booking.priceSnapshot.totalJpy)}</p>{draft.booking.payments.map((p,n)=><p key={n}>{t('決済状況','Payment status')}: {paymentStateText(p.state)}</p>)}{['CONFIRMED_DEV','CONFIRMED'].includes(draft.booking.state)&&<SaveBookingAccess bookingId={draft.booking.id} locale={locale}/>}{draft.booking.qrImage&&<picture><img src={draft.booking.qrImage} width={240} height={240} alt={t('開発予約QR','Development booking QR')}/></picture>}{!['CONFIRMED_DEV','CONFIRMED','CANCELLED'].includes(draft.booking.state)&&<button disabled={busy} onClick={()=>void run(()=>request('/reconcile',{}))}>{t('決済状況を更新','Check for a payment update')}</button>}</div>}
 {draft.booking&&!['COMPLETED_DEV','COMPLETED'].includes(draft.booking.state)&&<BookingCancellation locale={locale} status={draft.booking.cancellation} onCancelled={async()=>{await run(()=>request('/draft'));}}/>}
 {(()=>{const body=<>{!draft.locked&&<button disabled={busy} onClick={()=>backToStep(1)}>{t('条件を編集して再計算','Edit and recalculate')}</button>}{draft.booking&&<p>{t('予約番号','Booking reference')}: <strong>{draft.booking.id}</strong></p>}<p>{input.period.startDate} → {input.period.endDate} · {slotLabel(input.period.slot)}</p><p>{storeLabel(input.pickupStore)} → {storeLabel(input.returnStore)}</p>{input.members.map((m,n)=><article key={m.key}><h3>{t('利用者','Person')} {n+1} · {sportLabel(m.sport)} · {tierLabel(m.tier)}</h3><p>{draft.preview?.members[n]?.candidates[directions[m.key]??'']?.lengthCm||'—'} cm · {options.models.find(p=>p.key===m.premiumModel)?.name??t('モデル非指定','No specific model')} · {(()=>{const jacket=options.sizes.find(v=>v.key===m.jacketSize)?.label,pants=options.sizes.find(v=>v.key===m.pantsSize)?.label;return jacket||pants?[jacket,pants].filter(Boolean).join(' / '):t('ウェアの選択なし','No wear selected');})()}</p></article>)}<p>{t('見積は最終確定額ではありません。','This estimate is not the final charge.')}</p><small className="guest-note">{t('税区分・利用規約は公開前確認中です。','Tax display and terms of use remain under review before launch.')}</small>
 {draft.estimate&&<dl className="guest-price"><dt>{t('小計','Subtotal')}</dt><dd>{money(draft.estimate.subtotalJpy)}</dd>{Boolean(draft.estimate.bundleDiscountJpy)&&<><dt>{t('ウェア調整','Wear adjustment')}</dt><dd>{money(draft.estimate.bundleDiscountJpy)}</dd></>}{Boolean(draft.estimate.advanceDiscountJpy)&&<><dt>{t('事前決済調整（見込み）','Estimated advance adjustment')}</dt><dd>{money(draft.estimate.advanceDiscountJpy)}</dd></>}<dt>{t('全員分の参考総額','Group estimate')}</dt><dd><strong>{money(draft.estimate.totalJpy)}</strong></dd></dl>}
 <label>{draft.checkout?t('お名前','Name'):t('お名前（架空）','Name (synthetic)')}<input value={contact.displayName} disabled={busy||draft.locked} onChange={e=>setContact(c=>({...c,displayName:e.target.value}))}/></label><label>{draft.checkout?t('メール','Email'):t('メール（架空）','Email (synthetic)')}<input type="email" value={contact.email} disabled={busy||draft.locked} onChange={e=>setContact(c=>({...c,email:e.target.value}))}/></label><label className="guest-choice"><input type="checkbox" checked={contact.termsAccepted} disabled={busy||draft.locked} onChange={e=>setContact(c=>({...c,termsAccepted:e.target.checked}))}/>{draft.checkout?t('利用開始48時間前までは全額返金。それ以降は自動返金なしのキャンセル規定に同意します。','I accept the cancellation policy: full refund until 48 hours before the rental starts; no automatic refund after that.'):t('合成データによる開発確認であることを確認','I understand this is a synthetic development preview')}</label>
 {!draft.booking&&!draft.checkout&&<button className="guest-cta-sticky" aria-busy={busy} disabled={busy||!contact.termsAccepted||!simulation||!contractSynced} onClick={()=>void run(()=>request('/checkout',{locale,draftId:draft.id,expectedRevision:draft.revision,reviewHash:draft.reviewHash,contact:{displayName:contact.displayName,email:contact.email,termsAccepted:contact.termsAccepted}}))}>{busy?t('処理しています…','Working…'):draft.locked?t('同じ内容で予約確定を再送信','Resend the same booking confirmation'):t('この内容で予約を確定する（開発用決済）','Confirm this booking (test payment)')}</button>}{!contractSynced&&<p role="status">{t('内容が変更されています。前の画面からもう一度選択し直し、最新の内容で確認してください。','Your selections changed. Go back and choose again so the review matches your latest choices.')}</p>}{busy&&<p role="status">{t('処理中です。しばらくそのままお待ちください。','Working. Please wait, do not press again.')}</p>}{!simulation&&!draft.checkout&&<p>{t('この環境では決済接続が未設定です。','Payment is not connected in this environment.')}</p>}
 {draft.checkout&&!draft.booking&&draft.estimate&&<SquareCardPayment applicationId={draft.checkout.applicationId} locationId={draft.checkout.locations[input.pickupStore]!} amountJpy={draft.estimate.totalJpy} email={contact.email} locale={locale} disabled={busy||!contact.termsAccepted||!contact.displayName.trim()||!contact.email||!contractSynced||draft.priceReviewRequired} onPay={async paymentSource=>{await run(()=>request('/checkout',{locale,draftId:draft.id,expectedRevision:draft.revision,reviewHash:draft.reviewHash,contact:{displayName:contact.displayName,email:contact.email,termsAccepted:contact.termsAccepted},paymentSource}));}}/>}
 {draft.quote&&!draft.booking&&draft.priceReviewRequired&&<button disabled={busy} onClick={()=>void run(()=>request('/accept-price',{draftId:draft.id,expectedRevision:draft.revision,snapshotSha256:draft.quote!.snapshotSha256}))}>{t('保存済みの新しい見積を確認・承認する','Review and accept the new saved estimate')}</button>}
 {draft.hold&&<p>{['CONFIRMED_DEV','CONFIRMED'].includes(draft.booking?.state??'')?t('確認済み予約は元の契約期間の在庫保護を維持。参考：初期HOLD期限','Confirmed booking retains contract-period protection. Initial HOLD expiry for reference'):t('在庫HOLD期限','Inventory HOLD expiry')}: <time dateTime={draft.hold.expiresAt}>{jstTime(draft.hold.expiresAt)}</time>{!['CONFIRMED_DEV','CONFIRMED','CANCELLED'].includes(draft.booking?.state??'')&&<> / {holdStateText(ja,draft.hold.state)}</>}</p>}{draft.quote&&<p>{t('保存済み見積','Saved estimate')}: {money(draft.quote.snapshot.totalJpy)} / {quoteValidityText(ja,draft.quote.validity)}</p>}</>;
 return draft.booking?<details className="guest-secondary"><summary>{t('予約内容の詳細','Booking details')}</summary>{body}</details>:body;})()}
 </section>}
 <button disabled={busy} onClick={()=>void run(()=>request('/draft'))}>{t('保存済みの結果を再読込','Reload saved result')}</button><button disabled={busy} onClick={()=>void run(async()=>{await request('/logout',{});setDraft(null);setInput(blankInput());setDirections({});clearStoredInput();setSavedInputJson(null);location.assign(new URL('/'+locale,location.origin).href);return draft;})}>{t('この予約画面を閉じる','Close this booking context')}</button>
 </>}</main><details className="guest-secondary guest-main"><summary>{t('予約をお持ちの方はこちら','Already have a booking?')}</summary><GuestRecovery locale={locale}/></details></div>;
}
