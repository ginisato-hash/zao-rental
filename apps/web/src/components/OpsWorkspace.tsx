'use client';
import {StaffSessionBoundary} from './StaffSessionBoundary';
import Link from 'next/link';
import {useRef,useState} from 'react';
type Exception={id:string;eventType:string;correlationId:string;bookingId:string|null;assetId:string|null;store:string;severity:string;status:string;occurredAt:string;resolvedAt:string|null;resolutionActor:string|null;resolutionReason:string|null;sourceConditionActive:boolean|null};
type Cursor={beforeTime:string;beforeId:string}|null;
const TYPES=['PAYMENT_PENDING','PAYMENT_UNKNOWN','WEBHOOK_RECONCILIATION_REQUIRED','WEBHOOK_FAILED','HOLD_EXPIRED','TRANSFER_DELAYED','RETURN_INSPECTION_REQUIRED','INVENTORY_INVARIANT_FAILED','REFUND_PENDING','REFUND_UNKNOWN','NOTIFICATION_FAILED','STORAGE_FAILED','BOOKING_RECOVERY_FAILED','DB_UNAVAILABLE','PROVIDER_TIMEOUT'];
const COMPONENTS=['APP','DB','GUEST','PAYMENT_ADAPTER','MEDIA','NOTIFICATION'];
export function OpsWorkspace({stamp,stores,systemScope,canAcknowledge}:{stamp:string;stores:readonly string[];systemScope:boolean;canAcknowledge:boolean}){
 const scopes=systemScope?[...stores,'SYSTEM']:[...stores];
 const [store,setStore]=useState(scopes[0]??''),[type,setType]=useState(''),[severity,setSeverity]=useState(''),[status,setStatus]=useState('UNACKNOWLEDGED'),[ageHours,setAgeHours]=useState('0');
 const [rows,setRows]=useState<Exception[]>([]),[cursor,setCursor]=useState<Cursor>(null),[health,setHealth]=useState<Record<string,string>|null>(null);
 const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[reason,setReason]=useState('TRIAGED');
 const active=useRef(false),requests=useRef(new Map<string,string>());
 function query(next:Cursor){const p=new URLSearchParams({store,ageHours,status});if(type)p.set('type',type);if(severity)p.set('severity',severity);if(next){p.set('beforeTime',next.beforeTime);p.set('beforeId',next.beforeId);}return p.toString();}
 async function load(next:Cursor){if(active.current||!store)return;active.current=true;setBusy(true);try{
  const r=await fetch('/api/operations/exceptions?'+query(next),{cache:'no-store',headers:{'x-zao-session':stamp}});
  if(!r.ok)throw Error();const body=await r.json() as {exceptions:Exception[];next:Cursor};
  setRows(previous=>next?[...previous,...body.exceptions]:body.exceptions);setCursor(body.next);
  setMessage(body.exceptions.length?'':'該当する例外はありません。');
 }catch{if(!next)setRows([]);setCursor(null);setMessage('運用状況を取得できません。権限と接続を確認してください。');}finally{active.current=false;setBusy(false);}}
 async function loadHealth(){try{const r=await fetch('/api/admin/readiness',{cache:'no-store',headers:{'x-zao-session':stamp}});if(!r.ok)throw Error();setHealth((await r.json()).components as Record<string,string>);}catch{setHealth(null);setMessage('稼働状況を取得できません。');}}
 async function acknowledge(e:Exception){if(active.current)return;active.current=true;setBusy(true);
  const intent=e.id+':'+store+':'+reason;let key=requests.current.get(intent);if(!key){key=crypto.randomUUID();requests.current.set(intent,key);}
  try{const r=await fetch('/api/operations/exception-acknowledge',{method:'POST',cache:'no-store',headers:{'content-type':'application/json','x-zao-session':stamp},body:JSON.stringify({requestKey:key,input:{id:e.id,store,reason}})});
   if(!r.ok){setMessage('確認済みにできません。権限と店舗範囲を確認してください。');return;}
   setRows(previous=>previous.map(v=>v.id===e.id?{...v,status:'ACKNOWLEDGED',resolutionReason:reason}:v));
   setMessage('スタッフが確認したことのみ記録しました。入金・返金・在庫・予約の状態は変わりません。');
  }catch{setMessage('受付結果は未確認です。同じ操作を繰り返しても同じ要求として照合します。');}finally{active.current=false;setBusy(false);}}
 return <StaffSessionBoundary stamp={stamp}><main><h1>運用例外</h1><nav><Link href="/staff/ledger">スタッフ台帳</Link></nav>
 <p>ここは業務状態の記録ではなく観測です。確認操作は「スタッフが見た」ことだけを残し、入金・返金・予約・在庫・受け渡し・配送の状態は変更しません。実際の状態は必ず各業務画面で確認してください。</p>
 <section aria-label="絞り込み">
  <label>範囲<select aria-label="範囲" value={store} disabled={busy} onChange={e=>{setStore(e.target.value);setRows([]);setCursor(null);}}>{scopes.map(s=><option key={s}>{s}</option>)}</select></label>
  <label>種別<select aria-label="種別" value={type} disabled={busy} onChange={e=>setType(e.target.value)}><option value="">すべて</option>{TYPES.map(t=><option key={t}>{t}</option>)}</select></label>
  <label>重大度<select aria-label="重大度" value={severity} disabled={busy} onChange={e=>setSeverity(e.target.value)}><option value="">すべて</option><option>INFO</option><option>WARN</option><option>ERROR</option></select></label>
  <label>状態<select aria-label="状態" value={status} disabled={busy} onChange={e=>setStatus(e.target.value)}><option value="UNACKNOWLEDGED">未確認</option><option value="ACKNOWLEDGED">確認済み</option><option value="ALL">すべて</option></select></label>
  <label>経過時間(以上)<input aria-label="経過時間" type="number" min="0" max="8760" step="1" value={ageHours} disabled={busy} onChange={e=>setAgeHours(e.target.value)}/></label>
  <button disabled={busy||!store} onClick={()=>{setCursor(null);void load(null);}}>読み込む</button>
  <button disabled={busy} onClick={()=>void loadHealth()}>稼働状況</button>
  {canAcknowledge&&<label>確認理由<select aria-label="確認理由" value={reason} disabled={busy} onChange={e=>setReason(e.target.value)}><option value="TRIAGED">内容を確認した</option><option value="ASSIGNED">担当者を割り当てた</option><option value="VERIFIED_WITH_CANONICAL_RECORD">正式な記録と突き合わせた</option></select></label>}
 </section>
 {message&&<p role="status">{message}</p>}
 {health&&<section aria-label="稼働状況"><h2>稼働状況</h2><ul>{COMPONENTS.map(c=><li key={c}>{c}: {health[c]??'UNAVAILABLE'}</li>)}</ul></section>}
 <section aria-label="例外一覧">{rows.map(e=><article key={e.id} style={{overflowWrap:'anywhere',borderBottom:'1px solid #bbb',padding:'1rem 0'}}>
  <h2>{e.eventType}</h2>
  <p>重大度: {e.severity} / 状態: {e.status==='ACKNOWLEDGED'?'確認済み':'未確認'}</p>
  <p>発生元の状態: {e.sourceConditionActive===null?'実行時の観測（業務状態の照合対象なし）':e.sourceConditionActive?'現在も継続中':'現在は解消（業務画面で確認してください）'}</p>
  <p>範囲: {e.store} / 照合ID: {e.correlationId}</p>
  {e.bookingId&&<p>予約: {e.bookingId}</p>}{e.assetId&&<p>資産: {e.assetId}</p>}
  <p>発生: <time>{e.occurredAt}</time>{e.resolvedAt&&<> / 確認: <time>{e.resolvedAt}</time></>}</p>
  {e.status==='ACKNOWLEDGED'&&<p>確認理由: {e.resolutionReason}（業務状態は未変更）</p>}
  {canAcknowledge&&e.status!=='ACKNOWLEDGED'&&<button disabled={busy} onClick={()=>void acknowledge(e)}>確認済みにする</button>}
 </article>)}</section>
 {cursor&&<button disabled={busy} onClick={()=>void load(cursor)}>さらに読み込む</button>}
 </main></StaffSessionBoundary>;
}
