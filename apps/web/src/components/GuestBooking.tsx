 'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {SaveBookingAccess} from './BookingAccess';
import {BookingCancellation,type CancellationStatus} from './BookingCancellation';
import {SquareCardPayment} from './SquareCardPayment';
import {GuestRecovery} from './GuestRecovery';
import {GuestAvatarPreview} from './GuestAvatarPreview';
import {STORE_LABEL,storeName,yen,jstDateTime} from './guest-format';
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
// CH-04B: reload-safe recovery of unsaved step 0-1 Input, scoped to exactly one server draft. Only
// Input is stored (never contact, payment, access/recovery/QR or session data), under a versioned
// per-draft key, and only in sessionStorage. A cached value is restored only while the same unlocked
// draft is still at the same revision with the same server Input; anything else is discarded. A
// restore changes local state only: no request is sent, and contractSynced stays false until the
// ordinary server save path runs again.
const DRAFT_INPUT_PREFIX='zao-guest-draft-input:v2:';
type InputEnvelope={schemaVersion:2;draftId:string;baseRevision:number;baseServerInputFingerprint:string;input:Input};
/** Deterministic non-secret digest of the server Input the cache was based on (equality check only). */
function inputFingerprint(v:unknown){const s=JSON.stringify(v??null);let a=0xdeadbeef,b=0x41c6ce57;for(let i=0;i<s.length;i++){const c=s.charCodeAt(i);a=Math.imul(a^c,2654435761);b=Math.imul(b^c,1597334677);}a=Math.imul(a^(a>>>16),2246822507)^Math.imul(b^(b>>>13),3266489909);b=Math.imul(b^(b>>>16),2246822507)^Math.imul(a^(a>>>13),3266489909);return (b>>>0).toString(16).padStart(8,'0')+(a>>>0).toString(16).padStart(8,'0');}
const isStr=(v:unknown)=>typeof v==='string',isNum=(v:unknown)=>typeof v==='number'&&Number.isFinite(v),isOptStr=(v:unknown)=>v===null||typeof v==='string';
const exactKeys=(v:object,keys:string[])=>Object.keys(v).sort().join()===[...keys].sort().join();
function isMember(v:unknown):v is Member{if(!v||typeof v!=='object'||Array.isArray(v))return false;const m=v as Record<string,unknown>,ski=m.ski as Record<string,unknown>|null;
 return exactKeys(m,['key','sport','heightCm','footCm','adultAtStart','tier','ski','poleSize','premiumModel','jacketSize','pantsSize','wearSport'])&&isStr(m.key)&&isStr(m.sport)&&(m.heightCm===null||isNum(m.heightCm))&&(m.footCm===null||isNum(m.footCm))&&typeof m.adultAtStart==='boolean'&&isStr(m.tier)
  &&(ski===null||(!!ski&&typeof ski==='object'&&exactKeys(ski,['weightKg','ageAtStart','level'])&&isNum(ski.weightKg)&&isNum(ski.ageAtStart)&&isStr(ski.level)))&&isOptStr(m.poleSize)&&isOptStr(m.premiumModel)&&isOptStr(m.jacketSize)&&isOptStr(m.pantsSize)&&isOptStr(m.wearSport);}
function isInput(v:unknown):v is Input{if(!v||typeof v!=='object'||Array.isArray(v))return false;const i=v as Record<string,unknown>,p=i.period as Record<string,unknown>|null;
 return exactKeys(i,['pickupStore','returnStore','period','members'])&&isStr(i.pickupStore)&&isStr(i.returnStore)&&!!p&&typeof p==='object'&&exactKeys(p,['startDate','endDate','slot'])&&isStr(p.startDate)&&isStr(p.endDate)&&isStr(p.slot)&&Array.isArray(i.members)&&i.members.length>=1&&i.members.length<=20&&i.members.every(isMember);}
function draftInputKeys(){const out:string[]=[];try{for(let n=0;n<sessionStorage.length;n++){const k=sessionStorage.key(n);if(k?.startsWith(DRAFT_INPUT_PREFIX))out.push(k);}}catch{}return out;}
/** Removes every draft-input cache except the one belonging to keepDraftId (if given). */
function clearDraftInputs(keepDraftId?:string){for(const k of draftInputKeys())if(keepDraftId===undefined||k!==DRAFT_INPUT_PREFIX+keepDraftId)try{sessionStorage.removeItem(k);}catch{}}
function writeDraftInput(e:InputEnvelope){try{sessionStorage.setItem(DRAFT_INPUT_PREFIX+e.draftId,JSON.stringify(e));}catch{}}
function removeDraftInput(draftId:string){try{sessionStorage.removeItem(DRAFT_INPUT_PREFIX+draftId);}catch{}}
/** The restorable Input for exactly this draft, or null. A present but non-restorable value is discarded. */
function takeDraftInput(d:{id:string;revision:number;input:Input|null;locked:boolean;booking:unknown}):Input|null{
 let raw:string|null;try{raw=sessionStorage.getItem(DRAFT_INPUT_PREFIX+d.id);}catch{return null;}
 if(raw===null)return null;
 try{const e=JSON.parse(raw) as Partial<InputEnvelope>|null;
  if(e&&typeof e==='object'&&e.schemaVersion===2&&e.draftId===d.id&&!d.locked&&!d.booking&&e.baseRevision===d.revision&&e.baseServerInputFingerprint===inputFingerprint(d.input)&&isInput(e.input)&&JSON.stringify(e.input)!==JSON.stringify(d.input))return e.input;
 }catch{}
 removeDraftInput(d.id);return null;
}
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
const GUEST_ERROR_COPY:Record<string,{ja:string;en:string}>={LEGAL_DOCUMENTS_NOT_APPROVED:{ja:'利用規約などの公開準備中のため、現在はお支払いいただけません。',en:'Payment is not available yet while the terms and policies are being prepared for publication.'},STALE_DRAFT:{ja:'この予約はほかの操作で更新されました。最新の内容を読み込み直してください。',en:'This draft changed elsewhere. Reload the latest saved result.'},SELECTION_INVALID:{ja:'選択したサイズの組み合わせが無効になりました。候補をもう一度選び直してください。',en:'The selected size combination is no longer valid. Choose your sizes again.'},CATALOG_SELECTION_INVALID:{ja:'選択した用品が現在の在庫条件に合いません。用品とサイズをやり直してください。',en:'The selected item no longer matches the current catalogue. Redo the equipment and size step.'},MODEL_RELEASE_CHANGED:{ja:'選択したモデルが変更されました。モデルを選び直してください。',en:'The selected model has changed. Choose a model again.'},PRICE_CHANGED_REVIEW_REQUIRED:{ja:'料金が更新されました。新しい合計金額を確認してから、もう一度お支払いください。',en:'The price has changed. Review the new total, then pay again.'},HOLD_OR_QUOTE_RECONCILIATION_REQUIRED:{ja:'選択した条件では在庫を確保できませんでした。この予約画面を閉じて、用品・サイズ・日程を変えてやり直してください。',en:'We could not reserve stock for this selection. Close this booking screen and start again with different equipment, sizes or dates.'},STALE_PRICE_REVIEW:{ja:'見積が更新されたか、在庫の確保期限が切れました。最新の内容を読み込み直してください。',en:'The estimate changed or the stock reservation expired. Reload the latest saved result.'},PRICE_REVIEW_REQUIRED:{ja:'進める前に新しい見積の確認が必要です。',en:'Review the updated estimate before continuing.'},PRICE_REVIEW_UNAVAILABLE:{ja:'見積の確認情報を取得できませんでした。最新の内容を読み込み直してください。',en:'The estimate details could not be loaded. Reload the latest saved result.'},DRAFT_ALREADY_SELECTED:{ja:'この内容はすでに確定済みです。最新の内容を読み込み直してください。',en:'This selection is already confirmed. Reload the latest saved result.'},INVALID_PERIOD:{ja:'利用開始日・終了日を確認してください（終了日は開始日以降、最大10日）。',en:'Check the start and end dates (end date on or after start, up to 10 days).'},INVALID_GROUP:{ja:'利用人数を確認してください。',en:'Check the number of people in the group.'},INVALID_LOCALE:{ja:'表示言語の設定に問題がありました。ページを再読み込みしてください。',en:'There was a problem with the language setting. Reload the page.'},MODEL_NOT_RELEASED:{ja:'選択したモデルは現在公開されていません。別のモデルを選んでください。',en:'The selected model is not currently available. Choose another model.'},SELECTION_REQUIRED:{ja:'全員分のサイズを選択してください。',en:'Choose a size for every person before continuing.'},INPUT_REQUIRED:{ja:'必須項目が未入力です。内容を確認してください。',en:'Some required details are missing. Check the form and try again.'},IDEMPOTENCY_MISMATCH:{ja:'直前の操作と内容が一致しませんでした。もう一度やり直してください。',en:'The request did not match the previous attempt. Please try again.'},FORBIDDEN:{ja:'この操作を行う権限がありません。',en:'You do not have permission to do this.'},NO_PAYMENT_ATTEMPT:{ja:'まだ決済の照合対象がありません。',en:'There is nothing to reconcile yet.'},PAYMENT_NOT_CONNECTED_CHARGE_DISABLED:{ja:'この環境では決済接続が未設定です。',en:'Payment is not connected in this environment.'},PAYMENT_READ_UNCONNECTED:{ja:'この環境では決済状態を確認できません。',en:'Payment status cannot be checked in this environment.'},GUEST_UNCONNECTED:{ja:'この環境では予約機能が未接続です。',en:'Booking is not connected in this environment.'},GUEST_PREVIEW_UNCONNECTED:{ja:'この環境では候補確認が未接続です。',en:'Preview is not connected in this environment.'},CONTRACT_VERSION_REQUIRED:{ja:'条件の再確認が必要です。用品とサイズをもう一度選び直してください。',en:'Your selection needs to be reconfirmed. Redo the equipment and size step.'},DUPLICATE_MEMBER:{ja:'利用者の情報が重複しています。人数と入力内容を確認してください。',en:'Duplicate person details were found. Check the group size and each person’s details.'},INVALID_EQUIPMENT_PROFILE:{ja:'身長・足サイズなどの入力を確認してください。',en:'Check the height, foot size and related details you entered.'},INVALID_RECOMMENDATION_INPUT:{ja:'用品の選択内容に問題があります。用品とサイズをやり直してください。',en:'There is a problem with the equipment selection. Redo the equipment and size step.'},INVALID_WEAR_PROFILE:{ja:'ウェアのサイズ選択を確認してください。',en:'Check the wear size you selected.'},MODEL_PROMISE_REQUIRED:{ja:'Premiumではモデルの選択が必要です。',en:'Choose a model to continue with Premium.'},POLE_VARIANT_MISMATCH:{ja:'ポールのサイズ選択を確認してください。',en:'Check the pole size you selected.'},PRODUCT_NOT_OFFERED:{ja:'選択した組み合わせは現在ご利用いただけません。用品とサイズをやり直してください。',en:'That combination is not currently available. Redo the equipment and size step.'},SIZE_NOT_APPLICABLE:{ja:'その年齢区分・プランではそのサイズを選べません。',en:'That size is not available for the chosen age category or plan.'},SKI_PROFILE_OR_AGE_MISMATCH:{ja:'年齢区分とスキー情報の入力を確認してください。',en:'Check that the age category and ski details match.'},UNNECESSARY_SNOWBOARD_INPUT:{ja:'スノーボード選択時はスキー用の項目を入力しないでください。',en:'Clear the ski-only fields when snowboard is selected.'},WEAR_VARIANT_MISMATCH:{ja:'ウェアのサイズ選択を確認してください。',en:'Check the wear size you selected.'},ANALYTICS_SHAPE:{ja:'内部データの形式でエラーが発生しました。もう一度お試しください。',en:'An internal data error occurred. Please try again.'},IMMUTABLE_RESERVATION:{ja:'この予約は確定済みのため変更できません。',en:'This booking is already confirmed and can no longer be changed.'},INCOMPLETE_SET:{ja:'選択した構成が揃っていません。用品とサイズを確認してください。',en:'The selected set is incomplete. Check the equipment and size step.'},INCOMPLETE_WEAR_SET:{ja:'ウェアの構成が揃っていません。ジャケット・パンツのサイズを確認してください。',en:'The wear set is incomplete. Check the jacket and pants sizes.'},INVALID_CLOCK:{ja:'日時の取得でエラーが発生しました。もう一度お試しください。',en:'There was a problem reading the current time. Please try again.'},INVALID_CONDITIONS:{ja:'利用日と全構成品のサイズを選択してください。',en:'Choose the rental dates and a size for every item.'},INVALID_CONTINUATION_CONTEXT:{ja:'続きの操作を行うための情報が正しくありません。最新の内容を読み込み直してください。',en:'The context for continuing is invalid. Reload the latest saved result.'},INVALID_DATE:{ja:'有効な日付を指定してください。',en:'Enter a valid date.'},INVALID_PRODUCT_CLASS:{ja:'選択した用品の種類に問題があります。用品とサイズをやり直してください。',en:'There is a problem with the selected equipment type. Redo the equipment and size step.'},MODEL_PROMISE_MISMATCH:{ja:'選択したモデルが条件と一致しません。モデルを選び直してください。',en:'The selected model no longer matches. Choose a model again.'},PERIOD_ENDED:{ja:'指定した利用期間はすでに終了しています。日程を選び直してください。',en:'The selected rental period has already ended. Choose different dates.'},WEAR_EXPLICIT_SIZE_REQUIRED:{ja:'ウェアはサイズを明示的に選択してください。',en:'Choose an explicit size for the wear item.'}};
const BOOKING_STATE_COPY:Record<string,{ja:string;en:string}>={CONFIRMED:{ja:'予約が確認されました',en:'Booking confirmed'},CANCELLED:{ja:'キャンセル済み',en:'Cancelled'},DRAFT:{ja:'未確定',en:'Not yet submitted'},PAYMENT_PENDING:{ja:'決済照合待ち',en:'Waiting on payment'},PAYMENT_REVIEW:{ja:'決済確認が必要です',en:'Payment needs review'},CONFIRMED_DEV:{ja:'予約が確認されました',en:'Booking confirmed'},COMPLETED:{ja:'ご利用が完了しました',en:'Rental completed'},COMPLETED_DEV:{ja:'ご利用が完了しました',en:'Rental completed'}};
const PAYMENT_STATE_COPY:Record<string,{ja:string;en:string}>={SUBMITTING:{ja:'送信中',en:'Submitting'},UNKNOWN:{ja:'確認できませんでした。しばらくしてからもう一度照合してください',en:'Could not be confirmed yet. Reconcile again shortly.'},PENDING:{ja:'処理中',en:'Pending'},COMPLETED:{ja:'完了',en:'Completed'},FAILED:{ja:'失敗しました',en:'Failed'},REVIEW:{ja:'確認が必要です',en:'Needs review'}};
// UX-3A: quote validity is an internal reconciliation state. Map every known value to a
// customer-facing sentence; an unmapped value still falls back to customer-safe generic text
// rather than ever rendering the raw enum. (HOLD state is shown only through the NR-03 panels.)
const QUOTE_VALIDITY_COPY:Record<string,{ja:string;en:string}>={VALID_PRIVATE_ESTIMATE:{ja:'有効です',en:'Valid'},EXPIRED:{ja:'期限切れのため再確認が必要です',en:'Expired — please reload and review'},HOLD_EXPIRED_OR_RELEASED:{ja:'在庫確保が終了したため再確認が必要です',en:'The stock hold ended — please reload and review'},HOLD_CONDITIONS_MISMATCH:{ja:'内容が変更されたため再確認が必要です',en:'Conditions changed — please reload and review'},HOLD_RECONCILIATION_REQUIRED:{ja:'決済状況の確認待ちです',en:'Waiting on a payment reconciliation'}};
const quoteValidityText=(ja:boolean,s:string)=>{const c=QUOTE_VALIDITY_COPY[s];return c?(ja?c.ja:c.en):(ja?'状態を確認中です':'Status is being checked');};
const SLOT_OPTIONS:[string,string,string][]=[['DAY','1日','Full day'],['AM','午前','Morning'],['PM','午後','Afternoon'],['MULTIDAY','2日以上','Multi-day']];
/** The stepper names exactly the four actual stages, 1:1 with the step numbers below. */
const STEPS:[string,string][]=[['日程・店舗','Dates & stores'],['用品・利用者情報','Equipment & people'],['候補選択','Choose sizes'],['全員分確認・支払い','Review & pay']];
// CH-02: a preview reason is an internal feasibility code; only mapped customer copy is shown.
const PREVIEW_REASON_COPY:Record<string,{ja:string;en:string}>={INSUFFICIENT:{ja:'選択した条件では在庫を確保できる候補がありません。用品またはサイズを変更してください。',en:'No option can be reserved for these conditions. Change the equipment or sizes.'},TRANSFER_PLAN_REQUIRED:{ja:'この組み合わせは店舗間の移動が必要なため、現在はご案内できません。受取・返却店舗または日程を変更してください。',en:'This combination needs a transfer between stores and cannot be offered right now. Change the stores or dates.'},INDETERMINATE:{ja:'在庫を確認できない候補がありました。条件を変更するか、しばらくしてからもう一度お試しください。',en:'Some options could not be checked. Change the conditions or try again shortly.'},INDETERMINATE_SOME_CANDIDATES:{ja:'一部の候補は在庫を確認できませんでした。表示されている候補から選んでください。',en:'Some options could not be checked. Choose from the options shown.'}};
const previewReasonText=(ja:boolean,r:string)=>{const c=PREVIEW_REASON_COPY[r];return c?(ja?c.ja:c.en):(ja?'一部の候補はご案内できません。条件を変更してください。':'Some options are not available. Change the conditions.');};
// After these checkout/price outcomes the server draft itself changed (new quote, lock, hold state),
// so the saved draft is re-read (GET only) to show the actual current state. Never a payment retry.
const REFRESH_ON_ERROR=new Set(['PRICE_CHANGED_REVIEW_REQUIRED','PRICE_REVIEW_REQUIRED','HOLD_OR_QUOTE_RECONCILIATION_REQUIRED']);
export type GuestLegalLinks={complete:boolean;terms?:string|undefined;cancellation?:string|undefined};
export function GuestBooking({locale,legal}:{locale:Locale;legal?:GuestLegalLinks}){const ja=locale==='ja',t=(j:string,e:string)=>ja?j:e;
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
 // savedInputJson: the last Input the server actually accepted (in memory only), null until the
 // server has confirmed one. It drives the unsaved-input warning and, since CH-04B, whether the
 // draft-scoped sessionStorage envelope (see takeDraftInput above) is kept or removed.
 const [savedInputJson,setSavedInputJson]=useState<string|null>(null);
 // UX-4A: UI-only presentation state -- which person's card is expanded when the group has
 // more than one person. Never read by computeMaxStep/contractSynced and never sent to the
 // server; the member data contract is unchanged.
 const [activePerson,setActivePerson]=useState(0);
 // CH-04B: true after this mount restored unsaved Input from the draft-scoped cache (status only).
 const [restoredNotice,setRestoredNotice]=useState(false);
 // Inline validation: a field's message appears only after it lost focus (shown) or after a forward
 // attempt on the current step (attempted), never while first typing; it disappears once corrected.
 const [shown,setShown]=useState<Record<string,boolean>>({}),[attempted,setAttempted]=useState(-1);
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
 const open=useCallback((d:Draft)=>{
  // CH-04B: a cache belongs to exactly the current draft (another draft's is a different guest
  // context and is dropped); a locked or booked draft keeps none. Only the initial load of this
  // mount (a hard reload or new visit) may restore, and only under takeDraftInput's conditions.
  clearDraftInputs(d.locked||d.booking?undefined:d.id);
  const restored=!initializedRef.current?takeDraftInput(d):null;
  setDraft(d);if(d.input){setInput(d.input);setSavedInputJson(JSON.stringify(d.input));}if(restored){setInput(restored);setRestoredNotice(true);}if(d.selection){setDirections(d.selection.directions);setAdvance(d.selection.wantAdvance);if(d.selection.contact)setContact(d.selection.contact);}
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
  const maxForDraft=computeMaxStep(d,restored??d.input??li,d.selection?d.selection.directions:ld,d.selection?d.selection.wantAdvance:la);
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
 function pushStep(n:number){if(n>historyStackRef.current[historyPosRef.current]!.step){history.pushState({step:n},'');historyStackRef.current=historyStackRef.current.slice(0,historyPosRef.current+1).concat({step:n});historyPosRef.current++;}setTouched(false);setAttempted(-1);setStep(n);}
 function backToStep(n:number){history.pushState({step:n},'');historyStackRef.current=historyStackRef.current.slice(0,historyPosRef.current+1).concat({step:n});historyPosRef.current++;setTouched(false);setAttempted(-1);setStep(n);}
 function editInput(fn:(i:Input)=>Input){setTouched(true);setInput(fn);}
 useEffect(()=>{alive.current=true;const n=++ticket.current;if(!starting)starting=request('/context',{}).finally(()=>{starting=null;});starting.then(async()=>{const [d,o]=await Promise.all([request('/draft'),request('/options')]);if(alive.current&&n===ticket.current){open(d);setOptions(o);}}).catch(e=>{if(alive.current&&n===ticket.current)setMessage(e.message);});return()=>{alive.current=false;};},[open]);
 useEffect(()=>{clearStoredInput();},[]);
 // CH-04B: keep the draft-scoped envelope exactly while step 0-1 Input is unsaved; remove it once the
 // server has the same Input (a successful save) or the draft is locked/booked.
 useEffect(()=>{if(!draft)return;if(draft.locked||draft.booking){clearDraftInputs();return;}
  if(unsavedInput)writeDraftInput({schemaVersion:2,draftId:draft.id,baseRevision:draft.revision,baseServerInputFingerprint:inputFingerprint(draft.input),input});else removeDraftInput(draft.id);
 },[draft,input,unsavedInput]);
 // Auxiliary only, per CH-04B's scope: beforeunload is not guaranteed to fire (notably on
 // mobile), so this is a best-effort browser-native prompt for a real tab close/reload, not
 // a substitute for the in-app link guard below, which is the actual mechanism for the
 // cases this app controls (locale switch, closing the booking context).
 useEffect(()=>{const onBeforeUnload=(e:BeforeUnloadEvent)=>{if(unsavedInput){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',onBeforeUnload);return()=>window.removeEventListener('beforeunload',onBeforeUnload);},[unsavedInput]);
 function guardNav(e:React.MouseEvent){if(unsavedInput&&!window.confirm(t('保存されていない入力があります。移動すると内容が失われます。続けますか？','You have unsaved input. Leaving now will lose it. Continue?')))e.preventDefault();}
 async function run(fn:()=>Promise<Draft>){if(inFlight.current)return;inFlight.current=true;setBusy(true);const n=++ticket.current;try{const d=await fn();if(alive.current&&n===ticket.current){open(d);setMessage('');setRestoredNotice(false);}}catch(e){if(alive.current&&n===ticket.current){const code=(e as Error).message;if((e as {status?:number}).status===401){setDraft(null);setInput(blankInput());setDirections({});clearStoredInput();clearDraftInputs();setSavedInputJson(null);}setMessage(code);
  // The draft changed server-side; show its actual state. A read only -- nothing is resubmitted.
  if(REFRESH_ON_ERROR.has(code)){try{const fresh=await request('/draft');if(alive.current&&n===ticket.current)open(fresh);}catch{}}}}finally{inFlight.current=false;if(alive.current)setBusy(false);}}
 function member(n:number,patch:Partial<Member>){editInput(i=>({...i,members:i.members.map((m,j)=>j===n?{...m,...patch}:m)}));}
 function sport(n:number,s:string){member(n,{sport:s,tier:s==='WEAR'?'STANDARD':'REGULAR',ski:s==='SKI'?{weightKg:60,ageAtStart:30,level:'BEGINNER'}:null,heightCm:s==='WEAR'?null:170,footCm:s==='WEAR'?null:25.5,poleSize:null,premiumModel:null,jacketSize:null,pantsSize:null,wearSport:s==='WEAR'?'SKI':null});}
 const sizes=(m:Member,f:string)=>options.sizes.filter(v=>v.family===f&&v.age===(m.adultAtStart?'ADULT':'KIDS')&&v.tier===(f.startsWith('WEAR_')?'STANDARD':m.tier));
 const money=(n:unknown)=>yen(ja,typeof n==='number'?n:null);const errorText=(code:string)=>{const c=GUEST_ERROR_COPY[code];if(c)return ja?c.ja:c.en;return ja?'処理でエラーが発生しました。もう一度お試しください。':'Something went wrong. Please try again.';};const jstTime=(iso:string)=>jstDateTime(ja,iso);const storeLabel=(v:string)=>storeName(ja,v);const slotLabel=(v:string)=>{const o=SLOT_OPTIONS.find(([k])=>k===v);return o?(ja?o[1]:o[2]):'—';};const sportLabel=(s:string)=>s==='SKI'?t('スキーセット','Ski set'):s==='SNOWBOARD'?t('スノーボードセット','Snowboard set'):s==='WEAR'?t('ウェアのみ','Wear only'):t('用品','Equipment');const tierLabel=(tr:string)=>tr==='REGULAR'?'Regular':tr==='PREMIUM'?'Premium':tr==='STANDARD'?t('スタンダード','Standard'):'—';const directionLabel=(d:string)=>d==='RECOMMENDED'?t('おすすめ','Recommended'):d==='SHORTER'?t('短め','Shorter'):d==='LONGER'?t('長め','Longer'):'';
 // Client-side checks mirror only the existing server contract (dates, per-person set completeness,
 // Premium model promise, jacket+pants as one wear set); the server remains the authority.
 function stepErrors(n:number):Record<string,string>{const e:Record<string,string>={};
  if(n===0){
   const {startDate,endDate,slot}=input.period,days=(Date.parse(endDate+'T00:00:00Z')-Date.parse(startDate+'T00:00:00Z'))/86400000+1;
   if(!startDate)e.startDate=t('利用開始日を選択してください。','Choose a start date.');
   if(!endDate)e.endDate=t('利用終了日を選択してください。','Choose an end date.');
   else if(startDate&&endDate<startDate)e.endDate=t('利用終了日は開始日以降にしてください。','The end date must be on or after the start date.');
   else if(days>10)e.endDate=t('利用期間は最大10日です。','The rental period must be no more than 10 days.');
   if(days===1&&!['AM','PM','DAY'].includes(slot))e.slot=t('1日の利用は午前・午後・1日から選択してください。','For one day, choose Morning, Afternoon or Full day.');
   else if(days>=2&&days<=10&&slot!=='MULTIDAY')e.slot=t('2〜10日の利用は複数日を選択してください。','For 2–10 days, choose Multiple days.');
  }
  if(n===1)input.members.forEach((m,j)=>{const k=(f:string)=>'m'+j+'-'+f;
   if(m.sport!=='WEAR'){
    if(!(typeof m.heightCm==='number'&&Number.isInteger(m.heightCm)&&m.heightCm>=50&&m.heightCm<=250))e[k('height')]=t('身長は50〜250cmの整数で入力してください。','Enter a whole-number height from 50 to 250 cm.');
    if(!(typeof m.footCm==='number'&&Number.isFinite(m.footCm)&&m.footCm>=5&&m.footCm<=50&&Math.abs(Math.round(m.footCm/0.1)-m.footCm/0.1)<=1e-10))e[k('foot')]=t('足サイズは5〜50cmの範囲で0.1cm単位で入力してください。','Enter a foot size from 5 to 50 cm in 0.1 cm increments.');
   }
   if(m.ski){
    if(!(Number.isFinite(m.ski.weightKg)&&m.ski.weightKg>=5&&m.ski.weightKg<=300))e[k('weight')]=t('体重は5〜300kgの範囲で入力してください。','Enter a weight from 5 to 300 kg.');
    if(!(Number.isInteger(m.ski.ageAtStart)&&m.ski.ageAtStart>=0&&m.ski.ageAtStart<=120))e[k('age')]=t('開始日の年齢は0〜120歳の整数で入力してください。','Enter a whole-number age from 0 to 120 at the start date.');
    else if(m.adultAtStart!==(m.ski.ageAtStart>=13))e[k('age')]=t('開始日の年齢に合わせて、13歳以上は大人、12歳以下は子供を選択してください。','Match the age category to the age at start: Adult for 13 or older, Child for 12 or younger.');
    if(!m.poleSize)e[k('pole')]=t('ポールのサイズを選択してください。','Choose a pole size.');
   }
   if(m.tier==='PREMIUM'&&!m.premiumModel)e[k('model')]=t('Premiumではモデルを選択してください。','Choose a model to continue with Premium.');
   const wear=m.sport==='WEAR'||m.jacketSize!==null||m.pantsSize!==null;if(wear&&!m.jacketSize)e[k('jacket')]=t(m.sport==='WEAR'?'ジャケットのサイズを選択してください。':'ウェアは上下セットです。ジャケットのサイズも選択してください。',m.sport==='WEAR'?'Choose a jacket size.':'Wear is a jacket and pants set. Choose a jacket size too.');if(wear&&!m.pantsSize)e[k('pants')]=t(m.sport==='WEAR'?'パンツのサイズを選択してください。':'ウェアは上下セットです。パンツのサイズも選択してください。',m.sport==='WEAR'?'Choose a pants size.':'Wear is a jacket and pants set. Choose a pants size too.');
  });
  if(n===2&&draft?.preview){draft.preview.members.forEach((m,j)=>{if(!directions[m.key])e['c'+j]=t('長さを1つ選んでください。','Choose one length.');});if(!accepted)e.accepted=t('内容を確認したらチェックを入れてください。','Tick this box once you have checked the details.');}
  if(n===3){if(!contact.displayName.trim())e.name=t('お名前を入力してください。','Enter your name.');if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email))e.email=t('メールアドレスを正しく入力してください。','Enter a valid email address.');if(!contact.termsAccepted)e.terms=t('内容に同意したらチェックを入れてください。','Tick this box to accept.');}
  return e;}
 const errors=draft?stepErrors(step):{};
 const reveal=(key:string)=>setShown(v=>v[key]?v:{...v,[key]:true});
 const errorFor=(key:string)=>(shown[key]||attempted===step)?errors[key]:undefined;
 // Visual required/optional marker (aria-hidden); required-ness itself is conveyed by aria-required.
 const flag=(required:boolean)=><span className={'guest-flag'+(required?' guest-flag--required':'')} aria-hidden="true">{required?t('必須','Required'):t('任意','Optional')}</span>;
 const fieldError=(key:string)=>{const m=errorFor(key);return m?<p className="guest-field-error" id={'guest-err-'+key}>{m}</p>:null;};
 const invalid=(key:string)=>errorFor(key)?{'aria-invalid':true as const,'aria-describedby':'guest-err-'+key}:{};
 /** A forward action: only runs when the current step has no error; otherwise shows every message and
  * moves focus to the first one. */
 function attempt(n:number,go:()=>void){const e=stepErrors(n),keys=Object.keys(e);if(!keys.length){go();return;}setAttempted(n);
  const first=keys[0]!,person=/^m(\d+)-/.exec(first);if(person)setActivePerson(Number(person[1]));requestAnimationFrame(()=>requestAnimationFrame(()=>{const el=document.querySelector('[aria-describedby="guest-err-'+first+'"]') as HTMLElement|null;el?.focus();}));}
 // CH-02: a raw booking/payment enum is never rendered; an unmapped value falls back to generic copy.
 const bookingStatusText=(s:string)=>{const c=BOOKING_STATE_COPY[s];return c?(ja?c.ja:c.en):t('予約の状態を確認しています','Checking the booking status');};const paymentStatusText=(s:string)=>{const c=PAYMENT_STATE_COPY[s];return c?(ja?c.ja:c.en):t('状態を確認しています','Checking the status');};
 const dateRange=(p:Input['period'])=>p.startDate===p.endDate?p.startDate:p.startDate+' → '+p.endDate;
 const confirmedBooking=['CONFIRMED_DEV','CONFIRMED'].includes(draft?.booking?.state??'');
 // Server-derived pre-booking states. NR-03: an expired/released HOLD or a failed stock reservation
 // is never payable; a changed price must be explicitly accepted before paying again (no blind retry).
 const holdEnded=Boolean(draft&&!draft.booking&&draft.hold&&draft.hold.state!=='ACTIVE');
 const stockFailed=Boolean(draft&&!draft.booking&&draft.locked&&!draft.hold);
 const priceChanged=Boolean(draft&&!draft.booking&&!holdEnded&&draft.priceReviewRequired&&draft.quote?.validity==='VALID_PRIVATE_ESTIMATE');
 const legalBlocked=Boolean(draft?.checkout)&&legal!==undefined&&!legal.complete;const payBlocked=!contractSynced||Boolean(draft?.priceReviewRequired)||holdEnded||stockFailed||legalBlocked;
 function closeContext(){void run(async()=>{await request('/logout',{});setDraft(null);setInput(blankInput());setDirections({});clearStoredInput();clearDraftInputs();setRestoredNotice(false);setSavedInputJson(null);location.assign(new URL('/'+locale,location.origin).href);return draft!;});}
 const checkoutBody=()=>({locale,draftId:draft!.id,expectedRevision:draft!.revision,reviewHash:draft!.reviewHash,contact:{displayName:contact.displayName,email:contact.email,termsAccepted:contact.termsAccepted}});
 // The field name is the label's whole text, so exact label matching and the accessible name stay
 // unchanged; the required/optional marker is rendered outside the <label>, beside it.
 const label=(text:string)=><span className="guest-label-text">{text}</span>;
 return <div className="public-shell" lang={locale}><header className="public-header"><Link className="wordmark" href={'/'+locale} onClick={guardNav}>ZAO<span>RENTAL</span></Link><nav aria-label={t('メインナビゲーション','Main navigation')}><Link href={'/'+locale+'/rental'} onClick={guardNav}>{t('プランを見る','View plans')}</Link><Link href={'/'+(ja?'en':'ja')+'/book'} hrefLang={ja?'en':'ja'} onClick={guardNav}>{t('EN','日本語')}</Link></nav></header><main className="guest-main"><p className="public-kicker">YOUR SNOW DAY</p><h1>{t('みんなのレンタルを選ぶ','Plan the group’s rental')}</h1>{draft&&!draft.checkout&&<p className="guest-preview-note">{t('開発プレビューです。架空の情報だけを使用してください。実決済・本番予約は行いません。','Development preview: use synthetic details only. No real payment or production booking.')}</p>}
 <ol className="guest-steps" aria-label={t('予約の流れ','Booking steps')}>{STEPS.map(([j,e],n)=><li key={n} aria-current={step===n?'step':undefined} className={n<step?'guest-step--done':undefined}><span className="guest-step-number" aria-hidden="true">{n+1}</span><span>{t(j,e)}</span></li>)}</ol>
 {restoredNotice&&step<2&&<p role="status" className="guest-status">{t('未保存の入力を復元しました','Unsaved entries restored')}</p>}
 {showUnsavedHint&&<p role="status" className="guest-status">{t('保存されていない変更があります。移動すると失われます。','You have unsaved changes. Leaving now will lose them.')}</p>}
 {message&&<p role="alert" className="guest-alert">{errorText(message)}</p>}
 {!draft&&<p role="status">{t('予約用の画面を開いています…','Opening your booking workspace…')}</p>}
 {draft&&<>{step<3&&<fieldset disabled={busy||draft.locked}><legend>{t(...STEPS[Math.min(step,2)]!)}</legend>
 {step===0&&<><div className="guest-grid">
  <div className="guest-field">{flag(true)}<label>{label(t('利用開始日','Start date'))}<input type="date" aria-required="true" value={input.period.startDate} onBlur={()=>reveal('startDate')} {...invalid('startDate')} onChange={e=>editInput(i=>({...i,period:{...i.period,startDate:e.target.value,endDate:i.period.endDate&&i.period.endDate>=e.target.value?i.period.endDate:e.target.value}}))}/></label>{fieldError('startDate')}</div>
  <div className="guest-field">{flag(true)}<label>{label(t('利用終了日','End date'))}<input type="date" aria-required="true" min={input.period.startDate||undefined} value={input.period.endDate} onBlur={()=>reveal('endDate')} {...invalid('endDate')} onChange={e=>editInput(i=>({...i,period:{...i.period,endDate:e.target.value}}))}/></label>{fieldError('endDate')}</div>
  <div className="guest-field">{flag(true)}<label>{label(t('利用枠','Rental slot'))}<select aria-label={t('利用枠','Rental slot')} value={input.period.slot} onBlur={()=>reveal('slot')} {...invalid('slot')} onChange={e=>editInput(i=>({...i,period:{...i.period,slot:e.target.value}}))}>{SLOT_OPTIONS.map(([v,j,e])=><option key={v} value={v}>{ja?j:e}</option>)}</select></label>{fieldError('slot')}</div>
  {(['pickupStore','returnStore'] as const).map(f=><div className="guest-field" key={f}>{flag(true)}<label>{label(f==='pickupStore'?t('受取店舗','Pickup store'):t('返却店舗','Return store'))}<select aria-label={f==='pickupStore'?t('受取店舗','Pickup store'):t('返却店舗','Return store')} value={input[f]} onChange={e=>editInput(i=>({...i,[f]:e.target.value}))}>{Object.entries(STORE_LABEL).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label></div>)}
 </div><div className="guest-actions"><button className="guest-primary" onClick={()=>attempt(0,()=>pushStep(1))}>{t('用品を選ぶ','Choose equipment')}</button></div></>}
 {step===1&&<><div className="guest-compare"><article><h2>Regular</h2><p>{t('サイズ・年齢区分・クラスを選びます。モデルは確約しません。','Choose size, age category and class. No specific model promise.')}</p></article><article><h2>Premium</h2><p>{t('モデル・シーズン・長さを選択条件として保存します。','Your selected model, season and length become the promise.')}</p></article></div>
 <div className="guest-field guest-field--narrow">{flag(true)}<label>{label(t('利用人数','Group size'))}<input type="number" inputMode="numeric" min={1} max={20} value={input.members.length} onChange={e=>{const n=Number(e.target.value);if(Number.isInteger(n)&&n>0&&n<=20)editInput(i=>({...i,members:Array.from({length:n},(_,j)=>i.members[j]??blank(j+1))}));}}/></label></div>
 {input.members.map((m,n)=>{const k=(f:string)=>'m'+n+'-'+f,wearRequired=m.sport==='WEAR'||m.jacketSize!==null||m.pantsSize!==null;const card=<article className="guest-person" key={m.key}><h2>{t('利用者','Person')} {n+1}</h2><div className="guest-grid">
  <div className="guest-field">{flag(true)}<label>{label(t('用品','Equipment')+' '+(n+1))}<select aria-label={t('用品','Equipment')+' '+(n+1)} value={m.sport} onChange={e=>sport(n,e.target.value)}><option value="SKI">{t('スキーセット','Ski set')}</option><option value="SNOWBOARD">{t('スノーボードセット','Snowboard set')}</option><option value="WEAR">{t('ウェアのみ','Wear only')}</option></select></label></div>
  <div className="guest-field">{flag(true)}<label>{label(t('年齢区分','Age category')+' '+(n+1))}<select aria-label={t('年齢区分','Age category')+' '+(n+1)} value={m.adultAtStart?'ADULT':'KIDS'} onChange={e=>member(n,{adultAtStart:e.target.value==='ADULT',tier:m.sport==='WEAR'?'STANDARD':'REGULAR',poleSize:null,premiumModel:null,jacketSize:null,pantsSize:null,...(m.ski?{ski:{...m.ski,ageAtStart:e.target.value==='ADULT'?30:10}}:{})})}><option value="ADULT">{t('大人','Adult')}</option><option value="KIDS">{t('子供','Child')}</option></select></label></div>
  {m.sport!=='WEAR'&&<><div className="guest-field">{flag(true)}<label>{label(t('プラン','Plan')+' '+(n+1))}<select aria-label={t('プラン','Plan')+' '+(n+1)} value={m.tier} onChange={e=>member(n,{tier:e.target.value,premiumModel:null,poleSize:null})}><option value="REGULAR">Regular</option>{m.adultAtStart&&<option value="PREMIUM">Premium</option>}</select></label></div>
   <div className="guest-field">{flag(true)}<label>{label(t('身長cm','Height cm')+' '+(n+1))}<input type="number" inputMode="numeric" min={50} max={250} step={1} aria-required="true" value={m.heightCm??''} onBlur={()=>reveal(k('height'))} {...invalid(k('height'))} onChange={e=>member(n,{heightCm:Number(e.target.value)})}/></label>{fieldError(k('height'))}</div>
   <div className="guest-field">{flag(true)}<label>{label(t('足サイズcm','Foot size cm')+' '+(n+1))}<input type="number" inputMode="decimal" min={5} max={50} step={0.1} aria-required="true" value={m.footCm??''} onBlur={()=>reveal(k('foot'))} {...invalid(k('foot'))} onChange={e=>member(n,{footCm:Number(e.target.value)})}/></label>{fieldError(k('foot'))}</div></>}
  {m.ski&&<><div className="guest-field">{flag(true)}<label>{label(t('体重kg','Weight kg')+' '+(n+1))}<input type="number" inputMode="numeric" min={5} max={300} step="any" aria-required="true" value={m.ski.weightKg} onBlur={()=>reveal(k('weight'))} {...invalid(k('weight'))} onChange={e=>member(n,{ski:{...m.ski!,weightKg:Number(e.target.value)}})}/></label>{fieldError(k('weight'))}</div>
   <div className="guest-field">{flag(true)}<label>{label(t('開始日の年齢','Age at start')+' '+(n+1))}<input type="number" inputMode="numeric" min={0} max={120} step={1} aria-required="true" value={m.ski.ageAtStart} onBlur={()=>reveal(k('age'))} {...invalid(k('age'))} onChange={e=>member(n,{ski:{...m.ski!,ageAtStart:Number(e.target.value)}})}/></label>{fieldError(k('age'))}</div>
   <div className="guest-field">{flag(true)}<label>{label(t('スキーレベル','Ski level')+' '+(n+1))}<select aria-label={t('スキーレベル','Ski level')+' '+(n+1)} value={m.ski.level} onChange={e=>member(n,{ski:{...m.ski!,level:e.target.value}})}><option value="BEGINNER">{t('初級','Beginner')}</option><option value="INTERMEDIATE">{t('中級','Intermediate')}</option><option value="ADVANCED">{t('上級','Advanced')}</option></select></label></div>
   <div className="guest-field">{flag(true)}<label>{label(t('ポールのサイズ','Pole size')+' '+(n+1))}<select aria-label={t('ポールのサイズ','Pole size')+' '+(n+1)} aria-required="true" value={m.poleSize??''} onBlur={()=>reveal(k('pole'))} {...invalid(k('pole'))} onChange={e=>member(n,{poleSize:e.target.value||null})}><option value="">{t('選択してください','Choose a size')}</option>{sizes(m,'POLE').map(v=><option key={v.key} value={v.key}>{v.label}</option>)}</select></label>{fieldError(k('pole'))}</div></>}
  {m.tier==='PREMIUM'&&<div className="guest-field">{flag(true)}<label>{label(t('モデルとシーズン','Model and season')+' '+(n+1))}<select aria-label={t('モデルとシーズン','Model and season')+' '+(n+1)} aria-required="true" value={m.premiumModel??''} onBlur={()=>reveal(k('model'))} {...invalid(k('model'))} onChange={e=>member(n,{premiumModel:e.target.value||null})}><option value="">{t('確認済みモデルから選択','Choose a verified model')}</option>{options.models.filter(p=>p.sport===m.sport).map(p=><option value={p.key} key={p.key}>{p.name} · {p.season} · {p.lengths.join(', ')}</option>)}</select>{!options.models.some(p=>p.sport===m.sport)&&<small>{t('公開確認済みモデルはまだありません。','No models are approved for this preview yet.')}</small>}</label>{fieldError(k('model'))}</div>}
  {m.sport==='WEAR'&&<div className="guest-field">{flag(true)}<label>{label(t('ウェアの用途','Wear sport')+' '+(n+1))}<select aria-label={t('ウェアの用途','Wear sport')+' '+(n+1)} value={m.wearSport??'SKI'} onChange={e=>member(n,{wearSport:e.target.value})}><option value="SKI">{t('スキー','Ski')}</option><option value="SNOWBOARD">{t('スノーボード','Snowboard')}</option></select></label></div>}
  {(['jacketSize','pantsSize'] as const).map((f,i)=>{const key=k(i===0?'jacket':'pants'),name=(i===0?t('ジャケットサイズ','Jacket size'):t('パンツサイズ','Pants size'))+' '+(n+1);return <div className="guest-field" key={f}>{flag(m.sport==='WEAR')}<label>{label(name)}<select aria-label={name} aria-required={wearRequired||undefined} value={m[f]??''} onBlur={()=>reveal(key)} {...invalid(key)} onChange={e=>member(n,{[f]:e.target.value||null})}><option value="">{t('選択なし','Not selected')}</option>{sizes(m,i===0?'WEAR_JACKET':'WEAR_PANTS').map(v=><option value={v.key} key={v.key}>{v.label}</option>)}</select></label>{fieldError(key)}</div>;})}
 </div></article>;const personHasError=Object.keys(errors).some(e=>e.startsWith('m'+n+'-')&&errorFor(e));return input.members.length>1?<details className="guest-person-toggle" key={m.key} open={n===activePersonIdx} onToggle={e=>{if((e.currentTarget as HTMLDetailsElement).open)setActivePerson(n);}}><summary>{t('利用者','Person')} {n+1} · {sportLabel(m.sport)}{personHasError&&<span className="guest-flag guest-flag--error">{t('要確認','Check')}</span>}</summary>{card}</details>:card;})}
 <p className="guest-hint">{t('候補確認ではまだ在庫を確保しません。','Reviewing candidates does not hold stock yet.')}</p><div className="guest-actions"><button className="guest-secondary-button" onClick={()=>backToStep(0)}>{t('日程に戻る','Back to dates')}</button><button className="guest-primary" aria-busy={busy} onClick={()=>attempt(1,()=>void run(async()=>{const saved=await request('/draft',{draftId:draft.id,expectedRevision:draft.revision,input});return request('/preview',{draftId:saved.id,expectedRevision:saved.revision});}))}>{t('候補と参考料金を確認','Review sizes and estimates')}</button></div></>}
 {step===2&&draft.preview&&<><p className="guest-hint">{t('候補は目安です。長さを明示的に選択してください。','Suggestions are a guide. Choose a length explicitly.')}</p>{draft.preview.members.map((m,n)=><article className="guest-person" key={m.key}><h2>{t('利用者','Person')} {n+1}</h2><p>{t('参考料金','Estimate')}: {money(m.price?.totalJpy)}</p><div className="guest-candidates" role="radiogroup" aria-label={t('利用者','Person')+' '+(n+1)} {...invalid('c'+n)}>{(['SHORTER','RECOMMENDED','LONGER'] as const).map(d=>{const c=m.candidates[d];return c&&<label className={'guest-candidate'+(d==='RECOMMENDED'?' guest-candidate--primary':'')} key={d}><input type="radio" name={m.key} checked={directions[m.key]===d} onChange={()=>setDirections(x=>({...x,[m.key]:d}))}/><span className="guest-candidate-label">{directionLabel(d)}</span><span className="guest-candidate-value">{c.lengthCm?c.lengthCm+' cm':t('上下サイズ確認','Wear sizes confirmed')}</span></label>;})}</div>{fieldError('c'+n)}{m.reason&&<p className="guest-hint">{previewReasonText(ja,m.reason)}</p>}<GuestAvatarPreview key={draft.id+':'+draft.revision+':'+m.key} scope={{draftId:draft.id,revision:draft.revision,memberKey:m.key}} direction={(directions[m.key]??'RECOMMENDED') as Direction} locale={locale}/></article>)}
 <label className="guest-choice"><input type="checkbox" checked={accepted} {...invalid('accepted')} onChange={e=>setAccepted(e.target.checked)}/>{t('全員のサイズ・モデル条件・ウェア構成を確認した','I confirm each person’s size, model promise and wear selections')}</label>{fieldError('accepted')}<label className="guest-choice"><input type="checkbox" checked={advance} onChange={e=>setAdvance(e.target.checked)}/>{t('事前決済5％調整の見込みを確認する','Evaluate potential 5% advance-payment eligibility')}</label>
 <div className="guest-actions"><button className="guest-secondary-button" onClick={()=>backToStep(1)}>{t('用品とサイズに戻る','Back to equipment')}</button><button className="guest-primary" aria-busy={busy} onClick={()=>attempt(2,()=>void run(()=>request('/selection',{draftId:draft.id,expectedRevision:draft.revision,directions,wantAdvance:advance,couponCode:null,acceptedModelPolicy:true})))}>{t('全員分の最終確認へ','Review the whole group')}</button></div></>}
 {step===2&&!draft.preview&&<p>{t('候補の内容を読み込めませんでした。前の画面からやり直してください。','The candidates could not be loaded. Go back and try again.')}</p>}
 </fieldset>}
 {step===3&&<section className="guest-review" aria-label={t('全員分の確認','Group review')}><h2>{t('最終確認','Final review')}</h2>
 {draft.booking&&<div role="status" className="guest-result"><h3>{bookingStatusText(draft.booking.state)}</h3><p className="guest-result-total">{money(draft.booking.priceSnapshot.totalJpy)}</p>{draft.booking.payments.map((p,n)=><p key={n}>{t('決済状況','Payment status')}: {paymentStatusText(p.state)}</p>)}{confirmedBooking&&<SaveBookingAccess bookingId={draft.booking.id} locale={locale}/>}{draft.booking.qrImage&&<picture><img src={draft.booking.qrImage} width={240} height={240} alt={draft.booking.state==='CONFIRMED_DEV'?t('開発予約QR','Development booking QR'):t('予約QR','Booking QR')}/></picture>}{!['CONFIRMED_DEV','CONFIRMED','CANCELLED'].includes(draft.booking.state)&&<button disabled={busy} onClick={()=>void run(()=>request('/reconcile',{}))}>{t('決済状況を更新','Check for a payment update')}</button>}</div>}
 {draft.booking&&!['COMPLETED_DEV','COMPLETED'].includes(draft.booking.state)&&<BookingCancellation locale={locale} status={draft.booking.cancellation} onCancelled={async()=>{await run(()=>request('/draft'));}}/>}
 {(()=>{const body=<>
  {!draft.locked&&<button className="guest-secondary-button" disabled={busy} onClick={()=>backToStep(1)}>{t('条件を編集して再計算','Edit and recalculate')}</button>}
  {draft.booking&&<p>{t('予約番号','Booking reference')}: <strong>{draft.booking.id}</strong></p>}
  <dl className="guest-facts"><div><dt>{t('日程','Dates')}</dt><dd>{dateRange(input.period)} · {slotLabel(input.period.slot)}</dd></div><div><dt>{t('受取店舗','Pickup store')}</dt><dd>{storeLabel(input.pickupStore)}</dd></div><div><dt>{t('返却店舗','Return store')}</dt><dd>{storeLabel(input.returnStore)}</dd></div><div><dt>{t('人数','People')}</dt><dd>{ja?input.members.length+'名':input.members.length+(input.members.length===1?' person':' people')}</dd></div></dl>
  <div className="guest-review-people">{input.members.map((m,n)=>{const dir=directions[m.key]??'',length=draft.preview?.members[n]?.candidates[dir]?.lengthCm,jacket=options.sizes.find(v=>v.key===m.jacketSize)?.label,pants=options.sizes.find(v=>v.key===m.pantsSize)?.label;return <article key={m.key}><h3>{t('利用者','Person')} {n+1} · {sportLabel(m.sport)} · {tierLabel(m.tier)}</h3><dl className="guest-facts guest-facts--compact">{m.sport!=='WEAR'&&<div><dt>{t('長さ','Length')}</dt><dd>{length?length+' cm'+(dir?'（'+directionLabel(dir)+'）':''):'—'}</dd></div>}{m.sport!=='WEAR'&&<div><dt>{t('モデル','Model')}</dt><dd>{options.models.find(p=>p.key===m.premiumModel)?.name??t('モデル非指定','No specific model')}</dd></div>}<div><dt>{t('ウェア','Wear')}</dt><dd>{jacket||pants?[jacket,pants].filter(Boolean).join(' / '):t('ウェアの選択なし','No wear selected')}</dd></div></dl></article>;})}</div>
  {draft.estimate&&<dl className="guest-price"><dt>{t('小計','Subtotal')}</dt><dd>{money(draft.estimate.subtotalJpy)}</dd>{Boolean(draft.estimate.bundleDiscountJpy)&&<><dt>{t('ウェア調整','Wear adjustment')}</dt><dd>{money(draft.estimate.bundleDiscountJpy)}</dd></>}{Boolean(draft.estimate.advanceDiscountJpy)&&<><dt>{t('事前決済調整（見込み）','Estimated advance adjustment')}</dt><dd>{money(draft.estimate.advanceDiscountJpy)}</dd></>}<dt>{t('全員分の参考総額','Group estimate')}</dt><dd><strong>{money(draft.estimate.totalJpy)}</strong></dd></dl>}
  <p className="guest-hint">{t('見積は最終確定額ではありません。','This estimate is not the final charge.')}</p>{legalBlocked&&<p role="status" className="guest-alert">{t('利用規約などの公開準備中のため、現在はお支払いいただけません。','Payment is not available yet while the terms and policies are being prepared for publication.')}</p>}<small className="guest-note">{legal?.complete?t('表示料金はすべて税込です。','All prices include Japanese consumption tax.'):t('表示料金はすべて税込です。利用規約は公開前確認中です。','All prices include Japanese consumption tax. Terms of use remain under review before launch.')}</small>
  {priceChanged&&<section className="guest-attention" aria-label={t('料金の更新','Price update')}><h3>{t('料金が更新されました','The price has changed')}</h3><p>{t('お支払い前に、新しい合計金額をご確認ください。','Please check the new total before paying.')}</p><dl className="guest-price-change"><dt>{t('前回の参考総額','Previous estimate')}</dt><dd>{money(draft.estimate?.totalJpy)}</dd><dt>{t('新しい合計金額','New total')}</dt><dd><strong>{money(draft.quote!.snapshot.totalJpy)}</strong></dd></dl><button className="guest-primary" disabled={busy} onClick={()=>void run(()=>request('/accept-price',{draftId:draft.id,expectedRevision:draft.revision,snapshotSha256:draft.quote!.snapshotSha256}))}>{t('新しい料金を確認して続ける','Review the new price and continue')}</button></section>}
  {(holdEnded||stockFailed)&&<section className="guest-attention" aria-label={t('予約を続けられません','This booking cannot continue')}><h3>{holdEnded?t('在庫の確保期限が切れました','The stock reservation has expired'):t('在庫を確保できませんでした','Stock could not be reserved')}</h3><p>{holdEnded?t('この内容ではお支払いできません。この予約画面を閉じて、条件を確認してから最初からやり直してください。','This selection can no longer be paid for. Close this booking screen, check the conditions and start again.'):t('選択した条件では在庫を確保できなかったか、条件が変わりました。この内容ではお支払いできません。この予約画面を閉じて、用品・サイズ・日程を見直してやり直してください。','Stock could not be reserved for this selection, or the conditions changed. It can no longer be paid for. Close this booking screen and start again, reviewing the equipment, sizes or dates.')}</p><button className="guest-primary" disabled={busy} onClick={closeContext}>{t('最初から予約をやり直す','Start the booking again')}</button></section>}
  {!draft.booking&&!holdEnded&&!stockFailed&&<div className="guest-contact"><div className="guest-field">{flag(true)}<label>{label(draft.checkout?t('お名前','Name'):t('お名前（架空）','Name (synthetic)'))}<input autoComplete="name" aria-required="true" value={contact.displayName} disabled={busy||draft.locked} onBlur={()=>reveal('name')} {...invalid('name')} onChange={e=>setContact(c=>({...c,displayName:e.target.value}))}/></label>{fieldError('name')}</div><div className="guest-field">{flag(true)}<label>{label(draft.checkout?t('メール','Email'):t('メール（架空）','Email (synthetic)'))}<input type="email" inputMode="email" autoComplete="email" aria-required="true" value={contact.email} disabled={busy||draft.locked} onBlur={()=>reveal('email')} {...invalid('email')} onChange={e=>setContact(c=>({...c,email:e.target.value}))}/></label>{fieldError('email')}</div><label className="guest-choice"><input type="checkbox" checked={contact.termsAccepted} disabled={busy||draft.locked} {...invalid('terms')} onChange={e=>setContact(c=>({...c,termsAccepted:e.target.checked}))}/>{draft.checkout?t('利用開始48時間前までは全額返金。それ以降は自動返金なしのキャンセル規定に同意します。','I accept the cancellation policy: full refund until 48 hours before the rental starts; no automatic refund after that.'):t('合成データによる開発確認であることを確認','I understand this is a synthetic development preview')}</label>{draft.checkout&&(legal?.terms||legal?.cancellation)&&<p className="guest-hint">{legal?.terms&&<a href={legal.terms} target="_blank" rel="noopener">{t('利用規約','Terms of use')}</a>}{legal?.terms&&legal?.cancellation&&' · '}{legal?.cancellation&&<a href={legal.cancellation} target="_blank" rel="noopener">{t('キャンセル・返金規定','Cancellation and refund policy')}</a>}</p>}{fieldError('terms')}</div>}
  {!draft.booking&&!draft.checkout&&!holdEnded&&!stockFailed&&<button className="guest-cta-sticky guest-primary" aria-busy={busy} disabled={busy||!simulation||payBlocked} onClick={()=>attempt(3,()=>void run(()=>request('/checkout',checkoutBody())))}>{busy?t('処理しています…','Working…'):draft.locked?t('この内容でもう一度支払う（開発用決済）','Pay again with these details (test payment)'):t('この内容で支払う（開発用決済）','Pay with these details (test payment)')}</button>}{!contractSynced&&<p role="status">{t('内容が変更されています。前の画面からもう一度選択し直し、最新の内容で確認してください。','Your selections changed. Go back and choose again so the review matches your latest choices.')}</p>}{busy&&<p role="status">{t('処理中です。しばらくそのままお待ちください。','Working. Please wait, do not press again.')}</p>}{!simulation&&!draft.checkout&&<p>{t('この環境では決済接続が未設定です。','Payment is not connected in this environment.')}</p>}
  {draft.checkout&&!draft.booking&&draft.estimate&&!holdEnded&&!stockFailed&&<SquareCardPayment applicationId={draft.checkout.applicationId} locationId={draft.checkout.locations[input.pickupStore]!} amountJpy={draft.estimate.totalJpy} email={contact.email} locale={locale} disabled={busy||!contact.termsAccepted||!contact.displayName.trim()||!contact.email||payBlocked} onPay={async paymentSource=>{await run(()=>request('/checkout',{...checkoutBody(),paymentSource}));}}/>}
  {draft.hold&&(confirmedBooking?<p className="guest-hint">{t('予約確定済みのため、ご利用期間の在庫は確保されています。','Your booking is confirmed, so stock is reserved for your rental period.')}</p>:draft.hold.state==='ACTIVE'&&!draft.booking&&<p className="guest-hint">{t('在庫の確保期限','Stock reserved until')}: <time dateTime={draft.hold.expiresAt}>{jstTime(draft.hold.expiresAt)}</time></p>)}{draft.quote&&!draft.booking&&<p className="guest-hint">{t('保存済みの見積','Saved estimate')}: {money(draft.quote.snapshot.totalJpy)} / {quoteValidityText(ja,draft.quote.validity)}</p>}</>;
 return draft.booking?<details className="guest-secondary"><summary>{t('予約内容の詳細','Booking details')}</summary>{body}</details>:body;})()}
 </section>}
 <div className="guest-footer-actions"><button className="guest-secondary-button" disabled={busy} onClick={()=>void run(()=>request('/draft'))}>{t('保存済みの結果を再読込','Reload saved result')}</button><button className="guest-secondary-button" disabled={busy} onClick={closeContext}>{t('この予約画面を閉じる','Close this booking context')}</button></div>
 </>}</main><details className="guest-secondary guest-main"><summary>{t('予約をお持ちの方はこちら','Already have a booking?')}</summary><GuestRecovery locale={locale}/></details></div>;
}
