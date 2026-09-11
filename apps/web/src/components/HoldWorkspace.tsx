 'use client';
import {useEffect,useRef,useState} from 'react';
import {StaffSessionBoundary,invalidateStaffView} from './StaffSessionBoundary';
import type {HoldConditions,Period} from '../../../../packages/contracts/src/hold';
import type {StoreId} from '../../../../packages/contracts/src/ledger';
import './holds.css';
type Variant={id:string;family:string;age:string;tier:string;size:string;name:string};
type Hold={id:string;conditions:HoldConditions;state:string;expiresAt:string;version:number;paymentState:string;period:{startsAt:string;dueAt:string;occupancyStartsAt:string;occupancyEndsAt:string};history:{event:string;actor:string}[]};
type Member=HoldConditions['members'][number];
type Pending={path:string;body:unknown};
const pendingKey='zao-rental-hold-pending-v1';
function recoverPending(stamp:string):{pending:Pending|null;blocked:boolean}{
 try{
  const raw=sessionStorage.getItem(pendingKey);if(!raw)return {pending:null,blocked:false};const saved=JSON.parse(raw);
  if(saved.stamp!==stamp)return {pending:null,blocked:false};
  if(typeof saved.path!=='string'||!/^$|^\/[a-f0-9-]{36}\/(amend|cancel|expire|reassign)$/.test(saved.path)||typeof saved.body?.requestKey!=='string')throw new Error('INVALID_PENDING');
  return {pending:{path:saved.path,body:saved.body},blocked:false};
 }catch{return {pending:null,blocked:true};}
}

const names:Record<string,string>={SKI:'スキー（1ペア）',SNOWBOARD:'ボード（1枚）',SKI_BOOT:'スキーブーツ（1足）',SNOWBOARD_BOOT:'ボードブーツ（1足）',POLE:'ポール（1ペア）'};
const messages:Record<string,string>={INVALID_CONDITIONS:'利用日と全構成品のサイズを選択してください',INVALID_PERIOD:'利用区分に合う1〜10日の期間を指定してください',VARIANT_MISMATCH:'選択したサイズ・区分を確認してください',INVALID_DATE:'有効な日付を指定してください',FEASIBLE:'全員・全構成品を確保できる見込みです（参考値）',CREATED:'グループ全体の仮押さえを取得しました',AMENDED:'仮押さえ条件を一括変更しました',RELEASED:'仮押さえを取り消しました',EXPIRED:'仮押さえは期限切れです',UNCHANGED:'まだ期限内です',INSUFFICIENT:'全期間・全構成品を満たす在庫が不足しています',TRANSFER_PLAN_REQUIRED:'移動計画が必要です。E07の保護・受領確認は未接続です',INDETERMINATE:'判定できませんでした。売り切れとは限りません',PAYMENT_RECONCILIATION_REQUIRED:'決済状態の照合が必要です。仮押さえは変更していません'};
function member(key:string):Member{return {key,product:'SKI_SET',age:'ADULT',tier:'REGULAR',items:[{family:'SKI',variantIds:[]},{family:'SKI_BOOT',variantIds:[]},{family:'POLE',variantIds:[]}]};}
export function HoldWorkspace(props:{stamp:string;stores:StoreId[];canEdit:boolean}){return <StaffSessionBoundary stamp={props.stamp}><Workspace {...props}/></StaffSessionBoundary>;}
function Workspace({stamp,stores,canEdit}:{stamp:string;stores:StoreId[];canEdit:boolean}){
 // Mounted only after StaffSessionBoundary has verified the current browser session.
 const [recovery]=useState(()=>recoverPending(stamp));
 const [variants,setVariants]=useState<Variant[]>([]),[holds,setHolds]=useState<Hold[]>([]),[selected,setSelected]=useState<Hold|null>(null),[message,setMessage]=useState(recovery.blocked?'未確認の要求を安全に保存・復元できません。この画面からの変更を停止しました。':recovery.pending?'前回の要求結果が未確認です。同じ要求を照合してください。':''),[busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(Boolean(recovery.pending)),[storageBlocked,setStorageBlocked]=useState(recovery.blocked);
 const [pickup,setPickup]=useState<StoreId>(stores[0]!),[returned,setReturned]=useState<StoreId>(stores[0]!),[period,setPeriod]=useState<Period>({startDate:'',endDate:'',slot:'DAY'}),[members,setMembers]=useState<Member[]>([member('person-1')]);
 const alive=useRef(true),generation=useRef(0),pending=useRef<Pending|null>(recovery.pending),reservation=useRef<string|null>(null);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 useEffect(()=>{try{const raw=sessionStorage.getItem(pendingKey);if(raw&&JSON.parse(raw).stamp!==stamp)sessionStorage.removeItem(pendingKey);}catch{/* A different session's envelope is never loaded, even if deletion fails. */}},[stamp]);
 function persistPending(value:Pending|null){try{if(value)sessionStorage.setItem(pendingKey,JSON.stringify({stamp,...value}));else sessionStorage.removeItem(pendingKey);return true;}catch{setStorageBlocked(true);setMessage('要求の保存を確認できないため変更を停止しました。');return false;}}

 async function call(path:string,body?:unknown){const r=await fetch('/api/holds'+path,{method:body===undefined?'GET':'POST',cache:'no-store',headers:{'Content-Type':'application/json','x-zao-session':stamp},...(body===undefined?{}:{body:JSON.stringify(body)})});const b=await r.json();if([401,403].includes(r.status)||b.error==='SESSION_CHANGED'){invalidateStaffView();throw new Error('SESSION_CHANGED');}if(!r.ok){const e=Object.assign(new Error(b.error??'REQUEST_FAILED'),{definite:r.status<500});throw e;}return b;}
 useEffect(()=>{let current=true;Promise.all([fetch('/api/holds/options',{headers:{'x-zao-session':stamp},cache:'no-store'}),fetch('/api/holds',{headers:{'x-zao-session':stamp},cache:'no-store'})]).then(async rs=>{if(rs.some(r=>!r.ok)){invalidateStaffView();return;}const [v,h]=await Promise.all(rs.map(r=>r.json()));if(current){setVariants(v);setHolds(h);}}).catch(()=>{if(current)setMessage('読込に失敗しました');});return()=>{current=false;};},[stamp]);
 function choose(h:Hold){generation.current++;setSelected(h);setPickup(h.conditions.pickupStore);setReturned(h.conditions.returnStore);setPeriod(h.conditions.period);setMembers(h.conditions.members);reservation.current=h.conditions.reservationId;setMessage('');}
 function conditions():HoldConditions{reservation.current??=crypto.randomUUID();return {reservationId:reservation.current,pickupStore:pickup,returnStore:returned,period,members};}
 async function perform(path:string,body:unknown,write:boolean){
  if(storageBlocked)return;
  if(write){const next={path,body};if(!persistPending(next))return;pending.current=next;setUncertain(true);}
  const ticket=++generation.current;setBusy(true);setMessage('');
  try{const result=await call(path,body);if(!alive.current||ticket!==generation.current)return;
   setMessage(result.replayed&&result.hold?.state!=='ACTIVE'?(messages[result.hold?.state]??'以前の要求は処理済みです。現在の記録を確認してください'):(messages[result.result]??result.result));
   if(result.hold){setSelected(result.hold);setPickup(result.hold.conditions.pickupStore);setReturned(result.hold.conditions.returnStore);setPeriod(result.hold.conditions.period);setMembers(result.hold.conditions.members);reservation.current=result.hold.conditions.reservationId;}
   if(write&&persistPending(null)){pending.current=null;setUncertain(false);setHolds(await call(''));}
  }catch(e){if(alive.current&&ticket===generation.current&&(e as {definite?:boolean}).definite&&persistPending(null)){pending.current=null;setUncertain(false);}if(alive.current&&ticket===generation.current)setMessage(messages[(e as Error).message]??'要求が完了したか確認できません。再送時は同じ要求キーを使用します。');}
  finally{if(alive.current&&ticket===generation.current)setBusy(false);}
 }
 const blocked=busy||uncertain||storageBlocked;
 function updateMember(i:number,next:Member){setMembers(members.map((m,n)=>n===i?next:m));}
 return <main className="holds"><header><p>ZAO Rental · 開発用実DB</p><h1>期間在庫と仮押さえ</h1><nav><a href="/staff/ledger">台帳へ</a> · <a href="/staff/logout">ログアウト</a></nav></header>
 <p>照会は参考値です。HOLD取得時に再確認します。仮押さえは予約確定・決済・貸出ではありません。期限は10分、条件変更では延長しません。</p>
 <fieldset disabled={blocked}><legend>利用条件（日本時間）</legend><div className="hold-grid"><label>受取店舗<select value={pickup} onChange={e=>setPickup(e.target.value as StoreId)}>{stores.map(s=><option key={s}>{s}</option>)}</select></label><label>返却予定店舗<select value={returned} onChange={e=>setReturned(e.target.value as StoreId)}>{stores.map(s=><option key={s}>{s}</option>)}</select></label><label>開始日<input type="date" value={period.startDate} onChange={e=>setPeriod({...period,startDate:e.target.value,...(period.slot!=='MULTIDAY'?{endDate:e.target.value}:{})})}/></label><label>最終日<input type="date" value={period.endDate} onChange={e=>setPeriod({...period,endDate:e.target.value})}/></label><label>利用区分<select value={period.slot} onChange={e=>setPeriod({...period,slot:e.target.value as Period['slot']})}><option value="AM">AM 08:30–12:00</option><option value="PM">PM 13:00–17:00</option><option value="DAY">1日 08:30–17:00</option><option value="MULTIDAY">複数日（最大10日）</option></select></label></div>
 {members.map((m,i)=><fieldset key={m.key}><legend>{i+1}人目（個人情報不要）</legend><div className="hold-grid"><label>商品<select value={m.product} onChange={e=>{const p=e.target.value as Member['product'];updateMember(i,{...m,product:p,items:(p==='SKI_SET'?['SKI','SKI_BOOT','POLE']:p==='SNOWBOARD_SET'?['SNOWBOARD','SNOWBOARD_BOOT']:['SKI']).map(f=>({family:f as Member['items'][number]['family'],variantIds:[]}))});}}><option>SKI_SET</option><option>SNOWBOARD_SET</option><option>SINGLE</option></select></label><label>年齢区分<select value={m.age} onChange={e=>updateMember(i,{...m,age:e.target.value as Member['age'],items:m.items.map(it=>({...it,variantIds:[]}))})}><option>ADULT</option><option>KIDS</option></select></label><label>クラス<select value={m.tier} onChange={e=>updateMember(i,{...m,tier:e.target.value as Member['tier'],items:m.items.map(it=>({...it,variantIds:[]}))})}><option>REGULAR</option><option>PREMIUM</option></select></label>
 {m.product==='SINGLE'&&<label>単品種別<select value={m.items[0]!.family} onChange={e=>updateMember(i,{...m,items:[{family:e.target.value as Member['items'][number]['family'],variantIds:[]}]})}>{Object.entries(names).map(([key,name])=><option key={key} value={key}>{name}</option>)}</select></label>}
 {m.items.map((item,j)=><label key={item.family}>{names[item.family]}<select multiple aria-label={`${i+1}人目 ${names[item.family]}`} value={item.variantIds} onChange={e=>updateMember(i,{...m,items:m.items.map((it,k)=>k===j?{...it,variantIds:[...e.target.selectedOptions].map(o=>o.value)}:it)})}>{variants.filter(v=>v.family===item.family&&v.age===m.age&&v.tier===m.tier).map(v=><option value={v.id} key={v.id}>{v.size} · {v.name}</option>)}</select></label>)}</div><p>必要サイズを選択。複数選択は許容する代替候補です。安全適合の自動判定はしません。</p>{members.length>1&&<button onClick={()=>setMembers(members.filter((_,n)=>i!==n))}>この人を削除</button>}</fieldset>)}
 <button disabled={members.length>=20} onClick={()=>setMembers([...members,member(crypto.randomUUID().slice(0,8))])}>人数を追加</button>
 </fieldset>
 <div className="hold-actions"><button disabled={blocked} onClick={()=>void perform(selected?`/${selected.id}/availability`:'/availability',conditions(),false)}>在庫を照会</button><button disabled={blocked||!canEdit} onClick={()=>void perform(selected?`/${selected.id}/amend`:'',{requestKey:crypto.randomUUID(),conditions:conditions()},true)}>{selected?'条件を一括変更':'グループを仮押さえ'}</button>{selected&&<button disabled={blocked||!canEdit} onClick={()=>void perform(`/${selected.id}/cancel`,{requestKey:crypto.randomUUID()},true)}>仮押さえを取り消す</button>}<button disabled={blocked} onClick={()=>{setSelected(null);reservation.current=null;setMessage('新しい要求');}}>新しい要求</button></div>
 {uncertain&&!busy&&<button disabled={storageBlocked} onClick={()=>{const p=pending.current;if(p)void perform(p.path,p.body,true);}}>同じ要求を照合・再送</button>}
 <p role="status">{message}</p>{selected&&<section aria-label="HOLD詳細"><h2>仮押さえの記録</h2><p>状態：{selected.state} / 決済境界：{selected.paymentState}</p><button disabled={blocked||!canEdit} onClick={()=>void perform(`/${selected.id}/expire`,{requestKey:crypto.randomUUID()},true)}>期限を確認</button><p>有効期限：{new Date(selected.expiresAt).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'})}（日本時間）</p><p>利用：{selected.conditions.period.startDate}〜{selected.conditions.period.endDate} {selected.conditions.period.slot}</p><p>在庫占有：開始日から最終日までの全日。AM後の同日PM再利用はできません。</p><p>記録ID：{selected.id} / 版 {selected.version}</p><ul>{selected.history.map((h,i)=><li key={i}>{h.event}（サーバー確認済み操作者）</li>)}</ul></section>}
 <section><h2>自分のHOLD（最新100件）</h2>{holds.map(h=><button key={h.id} disabled={blocked} onClick={()=>choose(h)}>{h.conditions.period.startDate} · {h.conditions.period.slot} · {h.state} · {h.id.slice(0,8)}</button>)}</section></main>;
}
