'use client';
import {useStaffLocale} from './staff-locale';
import {StaffSessionBoundary} from './StaffSessionBoundary';
import {staffLabel,shortRef,TechnicalDetails} from './staff-labels';
import {useRef,useState} from 'react';
import {storeDisplayName} from '../../../../packages/contracts/src/store-display';
type Exception={id:string;eventType:string;correlationId:string;bookingId:string|null;assetId:string|null;store:string;severity:string;status:string;occurredAt:string;resolvedAt:string|null;resolutionActor:string|null;resolutionReason:string|null;sourceConditionActive:boolean|null;sourceType?:string;refund?:{channel:'STORE'|'ONLINE';amountJpy:number;state:string;dispatched:boolean;providerIdPresent:boolean}|null};
type Cursor={beforeTime:string;beforeId:string}|null;
const TYPES=['PAYMENT_PENDING','PAYMENT_UNKNOWN','WEBHOOK_RECONCILIATION_REQUIRED','WEBHOOK_FAILED','HOLD_EXPIRED','TRANSFER_DELAYED','RETURN_INSPECTION_REQUIRED','INVENTORY_INVARIANT_FAILED','REFUND_PENDING','REFUND_UNKNOWN','NOTIFICATION_FAILED','STORAGE_FAILED','BOOKING_RECOVERY_FAILED','DB_UNAVAILABLE','PROVIDER_TIMEOUT'];
// Refund rows are observation only: no resend control. An ID-present row is reconciled by GET in the worker; an ID-less dispatched
// (or REVIEW) row is never re-POSTed and needs manual investigation against the provider dashboard.
function refundStatus(r:NonNullable<Exception['refund']>,en=false){if(r.state==='PENDING'&&!r.dispatched)return en?'Waiting to send (handled automatically)':'送信待ち（自動処理の対象）';if(r.providerIdPresent&&r.state==='UNKNOWN')return en?'Checking the refund result':'返金結果を確認中';return en?'Check the refund result in the payment service’s dashboard (no automatic resend)':'決済サービスの管理画面で返金結果を確認してください（自動再送なし）';}
function elapsed(at:string,en=false){const m=Math.max(0,Math.floor((Date.now()-Date.parse(at))/60000));return m<60?m+(en?' min':'分'):m<1440?Math.floor(m/60)+(en?' h':'時間'):Math.floor(m/1440)+(en?' d':'日');}
const COMPONENTS=['APP','DB','GUEST','PAYMENT_ADAPTER','WEBHOOK','MEDIA','NOTIFICATION'];
export function OpsWorkspace({stamp,stores,systemScope,canAcknowledge}:{stamp:string;stores:readonly string[];systemScope:boolean;canAcknowledge:boolean}){
 const __i18n=useStaffLocale(),en=__i18n.locale==='en',locale=__i18n.locale,tr_=(j:string,e:string)=>en?e:j,p=(j:string,e:string)=>[j,e] as const,pick=(m:string|readonly [string,string])=>typeof m==='string'?m:m[en?1:0];void en;void locale;void p;void pick;
 const scopes=systemScope?[...stores,'SYSTEM']:[...stores];
 const [store,setStore]=useState(scopes[0]??''),[type,setType]=useState(''),[severity,setSeverity]=useState(''),[status,setStatus]=useState('UNACKNOWLEDGED'),[ageHours,setAgeHours]=useState('0');
 const [rows,setRows]=useState<Exception[]>([]),[cursor,setCursor]=useState<Cursor>(null),[health,setHealth]=useState<Record<string,string>|null>(null);
 const [busy,setBusy]=useState(false),[message,setMessage]=useState<string|readonly [string,string]>(''),[reason,setReason]=useState('TRIAGED');
 const active=useRef(false),requests=useRef(new Map<string,string>());
 function query(next:Cursor){const p=new URLSearchParams({store,ageHours,status});if(type)p.set('type',type);if(severity)p.set('severity',severity);if(next){p.set('beforeTime',next.beforeTime);p.set('beforeId',next.beforeId);}return p.toString();}
 async function load(next:Cursor){if(active.current||!store)return;active.current=true;setBusy(true);try{
  const r=await fetch('/api/operations/exceptions?'+query(next),{cache:'no-store',headers:{'x-zao-session':stamp}});
  if(!r.ok)throw Error();const body=await r.json() as {exceptions:Exception[];next:Cursor};
  setRows(previous=>next?[...previous,...body.exceptions]:body.exceptions);setCursor(body.next);
  setMessage(body.exceptions.length?'':p('該当する例外はありません。','No matching exceptions.'));
 }catch{if(!next)setRows([]);setCursor(null);setMessage(p('運用状況を取得できません。権限と接続を確認してください。','Could not load the operations status. Check your permissions and the connection.'));}finally{active.current=false;setBusy(false);}}
 async function loadHealth(){try{const r=await fetch('/api/admin/readiness',{cache:'no-store',headers:{'x-zao-session':stamp}});if(!r.ok)throw Error();setHealth((await r.json()).components as Record<string,string>);}catch{setHealth(null);setMessage(p('稼働状況を取得できません。','Could not load service health.'));}}
 async function acknowledge(e:Exception){if(active.current)return;active.current=true;setBusy(true);
  const intent=e.id+':'+store+':'+reason;let key=requests.current.get(intent);if(!key){key=crypto.randomUUID();requests.current.set(intent,key);}
  try{const r=await fetch('/api/operations/exception-acknowledge',{method:'POST',cache:'no-store',headers:{'content-type':'application/json','x-zao-session':stamp},body:JSON.stringify({requestKey:key,input:{id:e.id,store,reason}})});
   if(!r.ok){setMessage(p('確認済みにできません。権限と店舗範囲を確認してください。','Could not mark it as acknowledged. Check your permissions and station scope.'));return;}
   setRows(previous=>previous.map(v=>v.id===e.id?{...v,status:'ACKNOWLEDGED',resolutionReason:reason}:v));
   setMessage(p('スタッフが確認したことのみ記録しました。入金・返金・在庫・予約の状態は変わりません。','Only the staff acknowledgement was recorded. Payments, refunds, stock and bookings did not change.'));
  }catch{setMessage(p('受付結果は未確認です。同じ操作を繰り返しても同じ要求として照合します。','Not confirmed yet. Repeating the action reconciles the same request.'));}finally{active.current=false;setBusy(false);}}
 return <StaffSessionBoundary stamp={stamp}><main><h1>{tr_('運用例外','Operations exceptions')}</h1>
 <details><summary>{tr_('「確認済み」の意味','What “acknowledged” means')}</summary></details>
 <section aria-label={tr_('絞り込み','Filters')}>
  <label>{tr_('範囲','Scope')}<select aria-label={tr_('範囲','Scope')} value={store} disabled={busy} onChange={e=>{setStore(e.target.value);setRows([]);setCursor(null);}}>{scopes.map(s=><option key={s} value={s}>{storeDisplayName(s)}</option>)}</select></label>
  <label>{tr_('種別','Type')}<select aria-label={tr_('種別','Type')} value={type} disabled={busy} onChange={e=>setType(e.target.value)}><option value="">{tr_('すべて','All')}</option>{TYPES.map(t=><option key={t} value={t}>{staffLabel(t,locale)}</option>)}</select></label>
  <label>{tr_('重大度','Severity')}<select aria-label={tr_('重大度','Severity')} value={severity} disabled={busy} onChange={e=>setSeverity(e.target.value)}><option value="">{tr_('すべて','All')}</option><option value="INFO">{tr_('情報','Info')}</option><option value="WARN">{tr_('注意','Warning')}</option><option value="ERROR">{tr_('重大','Critical')}</option></select></label>
  <label>{tr_('状態','Status')}<select aria-label={tr_('状態','Status')} value={pick(status)} disabled={busy} onChange={e=>setStatus(e.target.value)}><option value="UNACKNOWLEDGED">{tr_('未確認','Not acknowledged')}</option><option value="ACKNOWLEDGED">{tr_('確認済み','Acknowledged')}</option><option value="ALL">{tr_('すべて','All')}</option></select></label>
  <label>{tr_('経過時間(以上)','Age (at least)')}<input aria-label={tr_('経過時間','Age')} type="number" min="0" max="8760" step="1" value={ageHours} disabled={busy} onChange={e=>setAgeHours(e.target.value)}/></label>
  <button disabled={busy||!store} onClick={()=>{setCursor(null);void load(null);}}>{tr_('読み込む','Load')}</button>
  <button disabled={busy} onClick={()=>void loadHealth()}>{tr_('稼働状況','Service health')}</button>
  {canAcknowledge&&<label>{tr_('確認理由','Reason')}<select aria-label={tr_('確認理由','Reason')} value={reason} disabled={busy} onChange={e=>setReason(e.target.value)}><option value="TRIAGED">{tr_('内容を確認した','Reviewed the content')}</option><option value="ASSIGNED">{tr_('担当者を割り当てた','Assigned someone')}</option><option value="VERIFIED_WITH_CANONICAL_RECORD">{tr_('正式な記録と突き合わせた','Checked against the official record')}</option></select></label>}
 </section>
 {message&&<p role="status">{pick(message)}</p>}
 {health&&<section aria-label={tr_('稼働状況','Service health')}><h2>{tr_('稼働状況','Service health')}</h2><ul>{COMPONENTS.map(c=><li key={c}>{staffLabel(c,locale)}: {staffLabel(health[c]??'UNAVAILABLE',locale)}</li>)}</ul></section>}
 <section aria-label={tr_('例外一覧','Exceptions')}>{rows.map(e=><article key={e.id} style={{overflowWrap:'anywhere',borderBottom:'1px solid #bbb',padding:'1rem 0'}}>
  <h2>{staffLabel(e.eventType,locale)}</h2><p>{tr_('確認すること：','To check: ')}{e.refund?tr_('決済サービスの返金履歴と予約の入金・返金残額を照合してください。','Reconcile the payment service’s refund history with the booking’s paid and refundable amounts.'):e.eventType.startsWith('PAYMENT')||e.eventType.startsWith('WEBHOOK')?tr_('予約の決済状況と決済サービスの履歴を確認してください。','Check the booking’s payment state against the payment service’s history.'):e.eventType.startsWith('RETURN')?tr_('返却用品の検品状況を確認してください。','Check the inspection state of the returned items.'):tr_('該当する業務画面で最新の状態を確認し、担当者へ引き継いでください。','Check the latest state on the relevant screen and hand it over to the person in charge.')}</p>
  <p>{tr_('重大度: ','Severity: ')}{staffLabel(e.severity,locale)}{tr_(' / 状態: ',' / status: ')}{e.status==='ACKNOWLEDGED'?tr_('確認済み','Acknowledged'):tr_('未確認','Not acknowledged')}</p>
  <p>{tr_('発生元の状態: ','Source state: ')}{e.sourceConditionActive===null?tr_('実行時の観測（業務状態の照合対象なし）','Runtime observation (no business state to reconcile)'):e.sourceConditionActive?tr_('現在も継続中','Still ongoing'):tr_('現在は解消（業務画面で確認してください）','Resolved now (check on the business screen)')}</p>
  <p>{tr_('範囲: ','Scope: ')}{storeDisplayName(e.store)}</p>
  {e.refund&&<p>{e.refund.channel==='ONLINE'?tr_('オンライン返金','Online refund'):tr_('店頭返金','Refund at the station')}{tr_(' / 金額: ¥',' / amount: ¥')}{e.refund.amountJpy.toLocaleString('ja-JP')}{tr_(' / 経過: ',' / age: ')}{elapsed(e.occurredAt,en)} / {refundStatus(e.refund,en)}</p>}
  {e.bookingId&&<p>{tr_('予約: ','Booking: ')}{shortRef(e.bookingId,locale)}</p>}{e.assetId&&<p>{tr_('用品: ','Item: ')}{shortRef(e.assetId,locale)}</p>}
  <p>{tr_('発生:','Occurred: ')} <time>{e.occurredAt}</time>{e.resolvedAt&&<> {tr_('/ 確認:',' / acknowledged: ')} <time>{e.resolvedAt}</time></>}</p>
  {e.status==='ACKNOWLEDGED'&&<p>{tr_('確認理由: ','Reason: ')}{staffLabel(e.resolutionReason,locale)}{tr_('（業務状態は未変更）','(business state unchanged)')}</p>}
  {canAcknowledge&&e.status!=='ACKNOWLEDGED'&&<button disabled={busy} onClick={()=>void acknowledge(e)}>{tr_('確認済みにする','Mark as acknowledged')}</button>}
 <TechnicalDetails locale={locale}><p>{e.eventType} / {e.severity} / {e.status}</p><p>{tr_('照合ID ','Reconciliation ID ')}{e.correlationId}{tr_(' / 予約ID ',' / booking ID ')}{e.bookingId}{tr_(' / 用品ID ',' / item ID ')}{e.assetId}</p></TechnicalDetails></article>)}</section>
 {cursor&&<button disabled={busy} onClick={()=>void load(cursor)}>{tr_('さらに読み込む','Load more')}</button>}
 </main></StaffSessionBoundary>;
}
